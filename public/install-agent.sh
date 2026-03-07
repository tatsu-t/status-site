#!/bin/bash
SERVER_URL="${1:-http://localhost:3000}"
REGISTER_TOKEN="$2"

# Detect arch
ARCH=$(uname -m)
case $ARCH in
  x86_64)        ARCH_NAME="amd64" ;;
  aarch64)       ARCH_NAME="arm64" ;;
  armv7l|armv6l) ARCH_NAME="arm" ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

# Generate API key
AGENT_KEY=$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | head -c 32)

echo "Installing status-agent (arch: $ARCH_NAME)..."
curl -sSL "${SERVER_URL}/agents/agent-linux-${ARCH_NAME}" -o /tmp/status-agent-new
chmod +x /tmp/status-agent-new
mv -f /tmp/status-agent-new /usr/local/bin/status-agent

# Stop existing service if running
systemctl stop status-agent 2>/dev/null || true

# Create systemd service
cat > /etc/systemd/system/status-agent.service << EOF
[Unit]
Description=Status Agent
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/status-agent
Restart=on-failure
RestartSec=5
Environment=AGENT_KEY=${AGENT_KEY}
Environment=AGENT_PUSH_URL=${SERVER_URL}/api/agent-push
Environment=AGENT_PUSH_INTERVAL=30
Environment=AGENT_HTTP=false

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable status-agent
systemctl start status-agent

echo ""
echo "Agent installed!"
echo "   Key:  ${AGENT_KEY}"
echo "   Push URL: ${SERVER_URL}/api/agent-push"

if [ -n "$REGISTER_TOKEN" ]; then
  echo ""
  echo "Registering with status app..."
  LOCAL_IP=$(hostname -I | awk '{print $1}')
  HOSTNAME=$(hostname)
  CPU_PERCENT=$(top -bn1 | grep 'Cpu(s)' | awk '{print int($2)}' 2>/dev/null || echo "0")
  MEM_PERCENT=$(free | awk '/Mem:/{print int($3/$2*100)}' 2>/dev/null || echo "0")
  DISK_PERCENT=$(df / | awk 'NR==2{print int($5)}' 2>/dev/null || echo "0")

  RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    "${SERVER_URL}/api/agent-register" \
    -d "{\"token\":\"${REGISTER_TOKEN}\",\"name\":\"${HOSTNAME}\",\"ip\":\"${LOCAL_IP}\",\"agent_key\":\"${AGENT_KEY}\",\"group\":\"Remote Agents\",\"cpu_percent\":${CPU_PERCENT},\"memory_percent\":${MEM_PERCENT},\"disk_percent\":${DISK_PERCENT}}")

  if echo "$RESPONSE" | grep -q '"mode":"pending"'; then
    echo "Registered! Waiting for admin to approve in the dashboard..."
  elif echo "$RESPONSE" | grep -q '"success":true'; then
    echo "Registered successfully!"
  else
    echo "Registration failed: $RESPONSE"
    echo "   You can register manually in the admin UI."
  fi
else
  echo ""
  echo "Add to status app admin:"
  echo "   Auth pass: ${AGENT_KEY}"
fi
