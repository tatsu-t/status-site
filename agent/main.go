package main

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	agentKey  string
	hostname  string
	startTime = time.Now()

	// CPU tracking
	cpuMu       sync.Mutex
	cpuPercent  float64
	prevIdle    uint64
	prevTotal   uint64
configMu        sync.Mutex
dockerWatchDyn  string
systemdWatchDyn string
)

func main() {
	agentKey = os.Getenv("AGENT_KEY")
	if agentKey == "" {
		log.Fatal("AGENT_KEY environment variable is required")
	}

	port := os.Getenv("AGENT_PORT")
	if port == "" {
		port = "8765"
	}

	hostname = os.Getenv("AGENT_HOSTNAME")
	if hostname == "" {
		h, err := os.Hostname()
		if err != nil {
			hostname = "unknown"
		} else {
			hostname = h
		}
	}

	// Start CPU sampling goroutine
	go cpuSampler()
	// Poll config from server (uses push URL base)
	if configURL := os.Getenv("AGENT_PUSH_URL"); configURL != "" {
		baseURL := configURL[:strings.LastIndex(configURL, "/api/")]
		go configPollLoop(baseURL, 5*time.Minute)
	}

	// Push mode: if AGENT_PUSH_URL is set, start pushing status
	pushURL := os.Getenv("AGENT_PUSH_URL")
	if pushURL != "" {
		intervalStr := os.Getenv("AGENT_PUSH_INTERVAL")
		interval := 30
		if intervalStr != "" {
			if v, err := strconv.Atoi(intervalStr); err == nil && v > 0 {
				interval = v
			}
		}
		go pushLoop(pushURL, time.Duration(interval)*time.Second)
	}

	// HTTP server mode (default: enabled)
	httpEnabled := os.Getenv("AGENT_HTTP")
	if httpEnabled == "" {
		httpEnabled = "true"
	}

	if httpEnabled != "false" {
		mux := http.NewServeMux()
		mux.HandleFunc("/health", handleHealth)
		mux.HandleFunc("/status", authMiddleware(handleStatus))
		mux.HandleFunc("/docker", authMiddleware(handleDocker))
		mux.HandleFunc("/systemctl", authMiddleware(handleSystemctl))
		mux.HandleFunc("/disk", authMiddleware(handleDisk))
		mux.HandleFunc("/ping", authMiddleware(handlePing))

		addr := ":" + port
		log.Printf("status-agent starting on %s (hostname=%s)", addr, hostname)
		log.Fatal(http.ListenAndServe(addr, mux))
	} else {
		log.Printf("status-agent push-only mode (hostname=%s)", hostname)
		select {} // block forever
	}
}


// configPollLoop periodically fetches agent config from the server
func configPollLoop(baseURL string, interval time.Duration) {
	time.Sleep(5 * time.Second) // wait for startup
	for {
		func() {
			client := &http.Client{Timeout: 10 * time.Second}
			url := baseURL + "/api/agent-config?key=" + agentKey
			resp, err := client.Get(url)
			if err != nil { return }
			defer resp.Body.Close()
			if resp.StatusCode != 200 { return }
			var cfg struct {
				DockerWatch  string `json:"docker_watch"`
				SystemdWatch string `json:"systemd_watch"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil { return }
			configMu.Lock()
			dockerWatchDyn = cfg.DockerWatch
			systemdWatchDyn = cfg.SystemdWatch
			configMu.Unlock()
			log.Printf("Config updated: docker=%q systemd=%q", cfg.DockerWatch, cfg.SystemdWatch)
		}()
		time.Sleep(interval)
	}
}

// pushLoop periodically collects status and POSTs it to the server
func pushLoop(pushURL string, interval time.Duration) {
	log.Printf("Push mode enabled: POST to %s every %v", pushURL, interval)
	time.Sleep(3 * time.Second)
	for {
		pushStatus(pushURL)
		time.Sleep(interval)
	}
}

func collectStatus() map[string]interface{} {
	cpuMu.Lock()
	cpu := cpuPercent
	cpuMu.Unlock()
	mem := getMemoryPercent()
	disk := getDiskPercent("/")
	uptime := time.Since(startTime).Seconds()
	data := map[string]interface{}{
		"agent_key":      agentKey,
		"hostname":       hostname,
		"timestamp":      time.Now().UTC().Format(time.RFC3339),
		"is_up":          true,
		"cpu_percent":    round1(cpu),
		"memory_percent": round1(mem),
		"disk_percent":   round1(disk),
		"uptime_seconds": int(uptime),
	}

	// Add docker container statuses if AGENT_DOCKER_WATCH is set
	configMu.Lock()
	dockerWatch := dockerWatchDyn
	if dockerWatch == "" { dockerWatch = os.Getenv("AGENT_DOCKER_WATCH") }
	configMu.Unlock()
	if dockerWatch != "" {
		containers := []map[string]interface{}{}
		for _, name := range strings.Split(dockerWatch, ",") {
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			out, err := exec.Command("docker", "inspect", "--format", "{{.State.Status}}", name).Output()
			status := strings.TrimSpace(string(out))
			if err != nil {
				status = "not_found"
			}
			containers = append(containers, map[string]interface{}{
				"name":    name,
				"running": status == "running",
				"status":  status,
			})
		}
		data["docker_containers"] = containers
}

// Always collect all running container names for discovery
if _, pathErr := exec.LookPath("docker"); pathErr == nil {
psOut, psErr := exec.Command("docker", "ps", "--format", "{{.Names}}").Output()
if psErr == nil {
allNames := []string{}
for _, line := range strings.Split(strings.TrimSpace(string(psOut)), "\n") {
line = strings.TrimSpace(line)
if line != "" {
allNames = append(allNames, line)
}
}
data["all_docker_containers"] = allNames
}
}

	// Add systemd service statuses if AGENT_SYSTEMD_WATCH is set
	configMu.Lock()
	systemdWatch := systemdWatchDyn
	if systemdWatch == "" { systemdWatch = os.Getenv("AGENT_SYSTEMD_WATCH") }
	configMu.Unlock()
	if systemdWatch != "" {
		services := []map[string]interface{}{}
		for _, name := range strings.Split(systemdWatch, ",") {
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			out, _ := exec.Command("systemctl", "is-active", name).Output()
			activeStatus := strings.TrimSpace(string(out))
			services = append(services, map[string]interface{}{
				"name":   name,
				"active": activeStatus == "active",
				"status": activeStatus,
			})
		}
		data["systemd_services"] = services
	}

	return data
}


// pingHost measures TCP connect latency to a host (ms)
func pingHost(rawURL string) int64 {
	u, err := url.Parse(rawURL)
	if err != nil {
		return 0
	}
	host := u.Host
	if u.Port() == "" {
		if u.Scheme == "https" {
			host = host + ":443"
		} else {
			host = host + ":80"
		}
	}
	start := time.Now()
	conn, err := net.DialTimeout("tcp", host, 5*time.Second)
	if err != nil {
		return 0
	}
	conn.Close()
	return time.Since(start).Milliseconds()
}

func pushStatus(pushURL string) {
	data := collectStatus()
	data["ping_ms"] = pingHost(pushURL)
	body, err := json.Marshal(data)
	if err != nil {
		log.Printf("Push marshal error: %v", err)
		return
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(pushURL, "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("Push failed: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		log.Printf("Push returned status %d", resp.StatusCode)
	} else {
		log.Printf("Push OK to %s", pushURL)
	}
}

// authMiddleware checks X-Agent-Key header or Basic auth password
func authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Check X-Agent-Key header
		if key := r.Header.Get("X-Agent-Key"); key == agentKey {
			next(w, r)
			return
		}

		// Check Basic auth (password must match agentKey, username ignored)
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Basic ") {
			decoded, err := base64.StdEncoding.DecodeString(auth[6:])
			if err == nil {
				parts := strings.SplitN(string(decoded), ":", 2)
				if len(parts) == 2 && parts[1] == agentKey {
					next(w, r)
					return
				}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]any{"error": "unauthorized"})
	}
}

func writeJSON(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

// GET /health
func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"ok": true})
}

// GET /status
func handleStatus(w http.ResponseWriter, r *http.Request) {
	cpuMu.Lock()
	cpu := cpuPercent
	cpuMu.Unlock()

	mem := getMemoryPercent()
	disk := getDiskPercent("/")
	uptime := time.Since(startTime).Seconds()

	writeJSON(w, map[string]any{
		"is_up":          true,
		"status":         "active",
		"hostname":       hostname,
		"uptime_seconds": int(uptime),
		"cpu_percent":    round1(cpu),
		"memory_percent": round1(mem),
		"disk_percent":   round1(disk),
	})
}

// GET /docker
func handleDocker(w http.ResponseWriter, r *http.Request) {
	out, err := exec.Command("docker", "ps", "-a", "--format", "{{json .}}").Output()
	if err != nil {
		writeJSON(w, map[string]any{"is_up": false, "error": "docker not available: " + err.Error()})
		return
	}

	var containers []map[string]any
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var c map[string]any
		if err := json.Unmarshal([]byte(line), &c); err == nil {
			containers = append(containers, c)
		}
	}

	if containers == nil {
		containers = []map[string]any{}
	}

	writeJSON(w, map[string]any{
		"is_up":      true,
		"containers": containers,
		"count":      len(containers),
	})
}

// GET /systemctl?name=<service>
func handleSystemctl(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]any{"error": "name parameter required"})
		return
	}

	// Sanitize: only allow alphanumeric, dash, underscore, dot
	for _, c := range name {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.') {
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]any{"error": "invalid service name"})
			return
		}
	}

	out, err := exec.Command("systemctl", "is-active", name).Output()
	status := strings.TrimSpace(string(out))
	if status == "" {
		status = "unknown"
	}
	if err != nil && status == "" {
		status = "unknown"
	}

	writeJSON(w, map[string]any{
		"is_up":   status == "active",
		"status":  status,
		"service": name,
	})
}

// GET /disk?path=<path>
func handleDisk(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}

	// Clean path
	path = filepath.Clean(path)

	out, err := exec.Command("df", "-P", "-B1", path).Output()
	if err != nil {
		writeJSON(w, map[string]any{"is_up": false, "path": path, "error": err.Error()})
		return
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) < 2 {
		writeJSON(w, map[string]any{"is_up": false, "path": path, "error": "unexpected df output"})
		return
	}

	fields := strings.Fields(lines[len(lines)-1])
	if len(fields) < 6 {
		writeJSON(w, map[string]any{"is_up": false, "path": path, "error": "unexpected df output"})
		return
	}

	total, _ := strconv.ParseFloat(fields[1], 64)
	used, _ := strconv.ParseFloat(fields[2], 64)
	free, _ := strconv.ParseFloat(fields[3], 64)

	toGB := func(b float64) float64 { return round1(b / 1073741824) }

	writeJSON(w, map[string]any{
		"is_up":    true,
		"path":     path,
		"mounted":  true,
		"total_gb": toGB(total),
		"used_gb":  toGB(used),
		"free_gb":  toGB(free),
	})
}

// GET /ping?host=<ip>
func handlePing(w http.ResponseWriter, r *http.Request) {
	host := r.URL.Query().Get("host")
	if host == "" {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]any{"error": "host parameter required"})
		return
	}

	ip := net.ParseIP(host)
	if ip == nil {
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]any{"error": "invalid IP address"})
		return
	}

	if !isAllowedIP(ip) {
		w.WriteHeader(http.StatusForbidden)
		writeJSON(w, map[string]any{"error": "IP not in allowed range (RFC1918/CGNAT only)"})
		return
	}

	start := time.Now()
	err := exec.Command("ping", "-c", "1", "-W", "1", host).Run()
	latency := time.Since(start).Milliseconds()

	writeJSON(w, map[string]any{
		"is_up":      err == nil,
		"host":       host,
		"latency_ms": latency,
	})
}

// isAllowedIP checks if IP is RFC1918 or 100.64.0.0/10 (CGNAT/Tailscale)
func isAllowedIP(ip net.IP) bool {
	privateRanges := []struct {
		network string
	}{
		{"10.0.0.0/8"},
		{"172.16.0.0/12"},
		{"192.168.0.0/16"},
		{"100.64.0.0/10"},
	}
	for _, r := range privateRanges {
		_, cidr, _ := net.ParseCIDR(r.network)
		if cidr.Contains(ip) {
			return true
		}
	}
	return false
}

// cpuSampler reads /proc/stat every 2 seconds and updates cpuPercent
func cpuSampler() {
	for {
		idle, total := readCPUStat()
		if prevTotal > 0 {
			deltaIdle := idle - prevIdle
			deltaTotal := total - prevTotal
			if deltaTotal > 0 {
				cpuMu.Lock()
				cpuPercent = (1.0 - float64(deltaIdle)/float64(deltaTotal)) * 100.0
				cpuMu.Unlock()
			}
		}
		prevIdle = idle
		prevTotal = total
		time.Sleep(2 * time.Second)
	}
}

func readCPUStat() (idle, total uint64) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "cpu ") {
			fields := strings.Fields(line)
			if len(fields) < 5 {
				return
			}
			for i := 1; i < len(fields); i++ {
				val, _ := strconv.ParseUint(fields[i], 10, 64)
				total += val
				if i == 4 { // idle is the 4th value (index 4)
					idle = val
				}
			}
			return
		}
	}
	return
}

func getMemoryPercent() float64 {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0
	}
	defer f.Close()

	var memTotal, memAvailable float64
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				memTotal, _ = strconv.ParseFloat(fields[1], 64)
			}
		} else if strings.HasPrefix(line, "MemAvailable:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				memAvailable, _ = strconv.ParseFloat(fields[1], 64)
			}
		}
	}

	if memTotal == 0 {
		return 0
	}
	return ((memTotal - memAvailable) / memTotal) * 100.0
}

func getDiskPercent(path string) float64 {
	out, err := exec.Command("df", "-P", path).Output()
	if err != nil {
		return 0
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) < 2 {
		return 0
	}

	fields := strings.Fields(lines[len(lines)-1])
	if len(fields) < 5 {
		return 0
	}

	// Field 4 is "Use%" like "62%"
	pctStr := strings.TrimSuffix(fields[4], "%")
	pct, _ := strconv.ParseFloat(pctStr, 64)
	return pct
}

func round1(v float64) float64 {
	return float64(int(v*10)) / 10
}
