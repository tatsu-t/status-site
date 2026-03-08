import { readFileSync, writeFileSync, existsSync } from 'fs';
import { ServiceConfig } from './config';
import { dataPath } from './paths';
import { withFileLock } from './file-lock';

const FAILURE_FILE = dataPath('failure_counts.json');
const TIMEOUT_MS = 8000;

const AGENT_STATES_FILE = dataPath('agent-states.json');
const AGENT_TIMEOUT_MS = 120000;

interface AgentState {
  hostname: string;
  is_up: boolean;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  uptime_seconds: number;
  last_seen: string;
  docker_containers?: Array<{ name: string; running: boolean; status: string }>;
  all_docker_containers?: string[];
  ping_ms?: number;
  systemd_services?: Array<{ name: string; active: boolean; status: string }>;
}

function loadAgentStates(): Record<string, AgentState> {
  try {
    if (existsSync(AGENT_STATES_FILE)) {
      return JSON.parse(readFileSync(AGENT_STATES_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}
/** Shared helper: check if agent last_seen is within timeout */
function isAgentAlive(agentServiceId: string): { alive: boolean; state: AgentState | null; age: number } {
  const states = loadAgentStates();
  const state = states[agentServiceId] ?? null;
  if (!state) return { alive: false, state: null, age: Infinity };
  const lastSeen = new Date(state.last_seen).getTime();
  if (!Number.isFinite(lastSeen)) return { alive: false, state, age: Infinity };
  const age = Date.now() - lastSeen;
  return { alive: age <= AGENT_TIMEOUT_MS, state, age };
}


async function checkAgentPush(svc: ServiceConfig): Promise<{ up: boolean; elapsed: number; details?: Record<string, unknown> }> {
  const states = loadAgentStates();
  const state = states[svc.id];
  if (!state) {
    return { up: false, elapsed: 0, details: { reason: 'No push received yet' } };
  }
  const lastSeen = new Date(state.last_seen).getTime();
  const age = Date.now() - lastSeen;
  if (age > AGENT_TIMEOUT_MS) {
    return { up: false, elapsed: age, details: { reason: 'Push timeout', last_seen: state.last_seen, age_seconds: Math.floor(age / 1000) } };
  }
  const pingMs = typeof state.ping_ms === 'number' ? state.ping_ms : 0;
  return {
    up: state.is_up,
    elapsed: pingMs,
    details: {
      cpu_percent: state.cpu_percent,
      memory_percent: state.memory_percent,
      disk_percent: state.disk_percent,
      uptime_seconds: state.uptime_seconds,
      last_seen: state.last_seen,
      age_seconds: Math.floor(age / 1000),
      ...(state.docker_containers ? { docker_containers: state.docker_containers } : {}),
      ...(state.systemd_services ? { systemd_services: state.systemd_services } : {}),
    }
  };
}

export interface CheckResult {
  id: string;
  name: string;
  is_up: boolean;
  status: 'up' | 'down' | 'unstable';
  group: string;
  is_disabled: boolean;
  response_time_ms: number;
  failure_count: number;
  icon: string;
  type: string;
  details?: Record<string, unknown>;
}

function loadFailureCounts(): Record<string, number> {
  try {
    if (existsSync(FAILURE_FILE)) {
      return JSON.parse(readFileSync(FAILURE_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveFailureCounts(counts: Record<string, number>) {
  try {
    writeFileSync(FAILURE_FILE, JSON.stringify(counts, null, 2), { mode: 0o644 });
  } catch (e) {
    console.error('Failed to save failure counts:', e);
  }
}

function makeAuthHeader(auth?: { user: string; pass: string }): Record<string, string> {
  if (!auth) return {};
  const encoded = Buffer.from(`${auth.user}:${auth.pass}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

function isActiveStatus(val: unknown): boolean {
  if (val === true || val === 1) return true;
  const s = String(val || '').toLowerCase();
  return ['active', 'running', 'up', 'operational', 'ok', 'active (running)'].includes(s);
}

async function fetchWithTimeout(url: string, headers: Record<string, string> = {}): Promise<{ ok: boolean; status: number; data: unknown; elapsed: number }> {
  if (isBlockedUrl(url)) {
    return { ok: false, status: 0, data: null, elapsed: 0 };
  }
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, cache: 'no-store' });
    const elapsed = Date.now() - start;
    let data: unknown = null;
    try { data = await res.json(); } catch { try { data = await res.text(); } catch {} }
    return { ok: res.ok, status: res.status, data, elapsed };
  } catch {
    return { ok: false, status: 0, data: null, elapsed: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

async function checkPing(svc: ServiceConfig): Promise<{ up: boolean; elapsed: number; details?: Record<string, unknown> }> {
  const target = svc.target;
  // If target is a URL, do HTTP check
  if (target.startsWith('http://') || target.startsWith('https://')) {
    const r = await fetchWithTimeout(target, makeAuthHeader(svc.auth));
    if (!r.ok) return { up: false, elapsed: r.elapsed };
    const d = r.data as Record<string, unknown>;
    // Check JSON response fields first, fall back to HTTP 200 OK
    const up = (d && (isActiveStatus(d?.is_up) || isActiveStatus(d?.status))) ? true : r.ok;
    return { up, elapsed: typeof d?.latency_ms === 'number' ? d.latency_ms : r.elapsed, details: d };
  }
  // For bare IP/hostname, use system ping
  const { execFile } = await import('child_process');
  return new Promise((resolve) => {
    const start = Date.now();
    execFile('ping', ['-c', '1', '-W', '2', target], (err, stdout) => {
      const elapsed = Date.now() - start;
      if (err) return resolve({ up: false, elapsed });
      const match = stdout.match(/time[=<]([\d.]+)\s*ms/);
      const pingTime = match ? Math.round(parseFloat(match[1])) : elapsed;
      resolve({ up: true, elapsed: pingTime });
    });
  });
}

async function checkDocker(svc: ServiceConfig): Promise<{ up: boolean; elapsed: number; details?: Record<string, unknown> }> {
  if (svc.target.startsWith('agent:')) {
    const parts = svc.target.split(':');
    const agentServiceId = parts[1];
    const containerName = parts.slice(2).join(':');
    const { alive, state, age } = isAgentAlive(agentServiceId);
    if (!state) return { up: false, elapsed: 0, details: { reason: 'Agent not found' } };
    if (!alive) return { up: false, elapsed: age, details: { reason: 'Host agent offline', last_seen: state.last_seen, age_seconds: Math.floor(age / 1000) } };
    // Check all_docker_containers (full list) first, then watched docker_containers
    const allContainers = (state.all_docker_containers as string[] | undefined) ?? [];
    const pingMs = typeof state.ping_ms === 'number' ? state.ping_ms : 0;
    if (allContainers.length > 0) {
      const containerNames = containerName.split(",").map(s => s.trim());
      return { up: containerNames.every(n => allContainers.includes(n)), elapsed: pingMs };
    }
    // Fallback: check watched docker_containers
    if (!state.docker_containers) return { up: false, elapsed: 0 };
    const container = state.docker_containers.find((c: { name: string; running: boolean }) => c.name === containerName);
    if (!container) return { up: false, elapsed: 0 };
    return { up: container.running, elapsed: 0 };
  }
  const r = await fetchWithTimeout(svc.target, makeAuthHeader(svc.auth));
  if (!r.ok) return { up: false, elapsed: r.elapsed };
  const d = r.data;
  const containers = Array.isArray(d) ? d : (d as Record<string, unknown>)?.services;
  if (!containers || !Array.isArray(containers)) return { up: false, elapsed: r.elapsed };
  const allUp = (containers as Record<string, unknown>[]).every(s => {
    const st = String(s.State || s.status || s.state || '').toLowerCase();
    return st.includes('running') || st.includes('up');
  });
  return { up: allUp, elapsed: r.elapsed, details: { container_count: containers.length } };
}

async function checkExternal(svc: ServiceConfig): Promise<{ up: boolean; elapsed: number; details?: Record<string, unknown> }> {
  const r = await fetchWithTimeout(svc.target, makeAuthHeader(svc.auth));
  if (!r.ok) return { up: false, elapsed: r.elapsed };
  const d = r.data as Record<string, unknown>;
  const up = isActiveStatus(d?.is_up) || isActiveStatus(d?.status) || d?.success === true;
  return { up, elapsed: r.elapsed, details: d as Record<string, unknown> };
}


async function checkWeb(svc: ServiceConfig): Promise<{ up: boolean; elapsed: number; details?: Record<string, unknown> }> {
  const r = await fetchWithTimeout(svc.target, makeAuthHeader(svc.auth));
  const up = r.status >= 200 && r.status < 400;
  return { up, elapsed: r.elapsed, details: { http_status: r.status } };
}

async function checkSystemctl(svc: ServiceConfig): Promise<{ up: boolean; elapsed: number; details?: Record<string, unknown> }> {
  if (svc.target.startsWith('agent:')) {
    const parts = svc.target.split(':');
    const agentServiceId = parts[1];
    const serviceName = parts.slice(2).join(':');
    const { alive, state, age } = isAgentAlive(agentServiceId);
    if (!state) return { up: false, elapsed: 0, details: { reason: 'Agent not found' } };
    if (!alive) return { up: false, elapsed: age, details: { reason: 'Host agent offline', last_seen: state.last_seen, age_seconds: Math.floor(age / 1000) } };
    if (!state.systemd_services) return { up: false, elapsed: 0 };
    const service = (state.systemd_services as Array<{name: string; active: boolean}>).find(s => s.name === serviceName);
    if (!service) return { up: false, elapsed: 0 };
    const pingMs = typeof state.ping_ms === 'number' ? state.ping_ms : 0;
    return { up: service.active, elapsed: pingMs };
  }
  const r = await fetchWithTimeout(svc.target, makeAuthHeader(svc.auth));
  if (!r.ok) return { up: false, elapsed: r.elapsed };
  const d = r.data as Record<string, unknown>;
  const up = String(d?.state || d?.status || '').toLowerCase().includes('active');
  return { up, elapsed: r.elapsed, details: d as Record<string, unknown> };
}
async function checkGroup(svc: ServiceConfig): Promise<{ up: boolean; elapsed: number; details?: Record<string, unknown> }> {
  const rawTarget = svc.target.startsWith('agent:')
    ? svc.target.slice(6)
    : svc.target;

  let pingMs = 0;
  const downItems: string[] = [];

  for (const spec of rawTarget.split(';').map(s => s.trim()).filter(Boolean)) {
    const colonIdx = spec.indexOf(':');
    if (colonIdx === -1) continue;
    const specType = spec.slice(0, colonIdx);
    const rest = spec.slice(colonIdx + 1);

    if (specType === 'docker') {
      const ci = rest.indexOf(':');
      if (ci === -1) continue;
      const agentId = rest.slice(0, ci);
      const containers = rest.slice(ci + 1).split(',').map(s => s.trim()).filter(Boolean);
      const agentCheck = isAgentAlive(agentId);
      const state = agentCheck.state;
      if (!state || !agentCheck.alive) { downItems.push(...containers); continue; }
      if (typeof state.ping_ms === 'number' && pingMs === 0) pingMs = state.ping_ms as number;
      const allC = (state.all_docker_containers as string[] | undefined) ?? [];
      if (allC.length > 0) {
        downItems.push(...containers.filter(c => !allC.includes(c)));
      } else {
        // Fallback: check watched docker_containers
        const watched = (state.docker_containers as Array<{name: string; running: boolean}> | undefined) ?? [];
        for (const cn of containers) {
          const found = watched.find(w => w.name === cn);
          if (!found || !found.running) downItems.push(cn);
        }
      }
    } else if (specType === 'systemd') {
      const ci = rest.indexOf(':');
      if (ci === -1) continue;
      const agentId = rest.slice(0, ci);
      const services = rest.slice(ci + 1).split(',').map(s => s.trim()).filter(Boolean);
      const agentCheck = isAgentAlive(agentId);
      const state = agentCheck.state;
      if (!state || !agentCheck.alive) { downItems.push(...services); continue; }
      if (typeof state.ping_ms === 'number' && pingMs === 0) pingMs = state.ping_ms as number;
      const watched = (state.systemd_services as Array<{name: string; active: boolean}> | undefined) ?? [];
      for (const svcName of services) {
        const found = watched.find(w => w.name === svcName);
        if (!found || !found.active) downItems.push(svcName);
      }
    } else {
      // Backward compat: old format agentId:c1,c2 (treat as docker)
      const agentId = specType;
      const containers = rest.split(',').map(s => s.trim()).filter(Boolean);
      const agentCheck = isAgentAlive(agentId);
      const state = agentCheck.state;
      if (!state || !agentCheck.alive) { downItems.push(...containers); continue; }
      if (typeof state.ping_ms === 'number' && pingMs === 0) pingMs = state.ping_ms as number;
      const allC = (state.all_docker_containers as string[] | undefined) ?? [];
      if (allC.length > 0) {
        downItems.push(...containers.filter(c => !allC.includes(c)));
      } else {
        const watched = (state.docker_containers as Array<{name: string; running: boolean}> | undefined) ?? [];
        for (const cn of containers) {
          const found = watched.find(w => w.name === cn);
          if (!found || !found.running) downItems.push(cn);
        }
      }
    }
  }

  return {
    up: downItems.length === 0,
    elapsed: pingMs,
    details: { down: downItems },
  };
}


/** Parse TCP target: host:port or [ipv6]:port */
function parseTcpTarget(target: string): { host: string; port: number } | null {
  const ipv6Match = target.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6Match) {
    const port = parseInt(ipv6Match[2], 10);
    if (port < 1 || port > 65535) return null;
    return { host: ipv6Match[1], port };
  }
  const lastColon = target.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const host = target.slice(0, lastColon);
  const port = parseInt(target.slice(lastColon + 1), 10);
  if (!host || isNaN(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

/** Block dangerous IPs (loopback, cloud metadata) */
function isBlockedTcpTarget(ip: string): boolean {
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
  if (ip.startsWith('127.')) return true;
  if (ip === '169.254.169.254') return true;
  if (ip === '0.0.0.0') return true;
  return false;
}

/** Block URLs targeting internal/private networks (SSRF protection for HTTP fetches) */
function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
    if (hostname === '0.0.0.0') return true;
    if (hostname === '169.254.169.254') return true;
    // Block common private ranges when accessed via IP
    const parts = hostname.split('.');
    if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
      const first = parseInt(parts[0]);
      if (first === 10) return true;
      if (first === 172 && parseInt(parts[1]) >= 16 && parseInt(parts[1]) <= 31) return true;
      if (first === 192 && parseInt(parts[1]) === 168) return true;
      if (first === 127) return true;
    }
    return false;
  } catch {
    return true;
  }
}

async function checkTcp(svc: ServiceConfig): Promise<{ up: boolean; elapsed: number; details?: Record<string, unknown> }> {
  let host: string;
  let port: number;

  // SRV record support: target starting with '_' (e.g. _minecraft._tcp.game.example.com)
  if (svc.target.startsWith('_')) {
    const dns = await import('dns');
    try {
      const records = await new Promise<Array<{name: string; port: number; priority: number; weight: number}>>((resolve, reject) => {
        dns.resolveSrv(svc.target, (err, addresses) => {
          if (err) reject(err);
          else resolve(addresses);
        });
      });
      if (!records || records.length === 0) {
        return { up: false, elapsed: 0, details: { reason: 'No SRV records found', srv: svc.target } };
      }
      // Pick lowest priority, then highest weight
      records.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
      host = records[0].name;
      port = records[0].port;
    } catch (e) {
      return { up: false, elapsed: 0, details: { reason: `SRV lookup failed: ${(e as Error).message}`, srv: svc.target } };
    }
  } else {
    const parsed = parseTcpTarget(svc.target);
    if (!parsed) {
      return { up: false, elapsed: 0, details: { reason: 'Invalid target (use host:port or _service._tcp.domain)' } };
    }
    host = parsed.host;
    port = parsed.port;
  }

  // Resolve DNS and check for blocked IPs
  const { createConnection } = await import('net');
  const dns = await import('dns');
  try {
    const resolved = await new Promise<string>((resolve, reject) => {
      dns.lookup(host, (err, address) => {
        if (err) reject(err);
        else resolve(address);
      });
    });
    if (isBlockedTcpTarget(resolved)) {
      return { up: false, elapsed: 0, details: { reason: 'Blocked target address' } };
    }
  } catch (e) {
    return { up: false, elapsed: 0, details: { reason: `DNS resolution failed: ${(e as Error).message}`, host, port } };
  }

  const start = Date.now();
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: TIMEOUT_MS });

    socket.on('connect', () => {
      const elapsed = Date.now() - start;
      socket.destroy();
      resolve({ up: true, elapsed, details: { host, port } });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ up: false, elapsed: Date.now() - start, details: { reason: 'Connection timeout', host, port } });
    });

    socket.on('error', (err) => {
      socket.destroy();
      const elapsed = Date.now() - start;
      const reason = err.message.includes('ECONNREFUSED') ? 'Connection refused'
        : err.message.includes('ETIMEDOUT') ? 'Connection timed out'
        : err.message.includes('ENOTFOUND') ? 'Host not found'
        : err.message;
      resolve({ up: false, elapsed, details: { reason, host, port } });
    });
  });
}

async function checkService(svc: ServiceConfig): Promise<{ up: boolean; elapsed: number; details?: Record<string, unknown> }> {
  if (!svc.target || typeof svc.target !== 'string' || svc.target.trim() === '') {
    return { up: false, elapsed: 0, details: { reason: 'Empty or invalid target' } };
  }
  switch (svc.type) {
    case 'ping': return checkPing(svc);
    case 'docker': return checkDocker(svc);
    case 'group': return checkGroup(svc);
    case 'external': return checkExternal(svc);
    case 'systemctl': return checkSystemctl(svc);
    case 'agent-push': return checkAgentPush(svc);
    case 'web': return checkWeb(svc);
    case 'tcp': return checkTcp(svc);
    default: return { up: false, elapsed: 0, details: { reason: `Unknown service type: ${svc.type}` } };
  }
}

export async function checkAllServices(services: ServiceConfig[]): Promise<CheckResult[]> {
  const counts = loadFailureCounts();

  const results = await Promise.all(
    services.map(async (svc): Promise<CheckResult> => {
      const result = await checkService(svc);
      const prevCount = counts[svc.id] || 0;

      let failureCount: number;
      if (result.up) {
        failureCount = 0;
      } else {
        failureCount = prevCount + 1;
      }
      counts[svc.id] = failureCount;

      let status: 'up' | 'down' | 'unstable';
      let is_up: boolean;
      if (failureCount === 0) {
        status = 'up';
        is_up = true;
      } else if (failureCount === 1) {
        status = 'unstable';
        is_up = true;
      } else {
        status = 'down';
        is_up = false;
      }

      return {
        id: svc.id,
        name: svc.name,
        is_up,
        status,
        group: svc.group,
        is_disabled: false,
        response_time_ms: result.elapsed,
        failure_count: failureCount,
        icon: svc.icon,
        type: svc.type,
        details: result.details,
      };
    })
  );

  withFileLock(FAILURE_FILE, () => {
    saveFailureCounts(counts);
  });
  return results;
}
