#!/bin/bash
# Install status-agent on a new device
# Usage: ./agent-install.sh <AGENT_KEY>
# Example: ./agent-install.sh abc123 (key from admin panel)
set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <SERVER_URL> <AGENT_KEY>"
  echo "Example: $0 https://status.example.com abc123"
  exit 1
fi

SERVER_URL="$1"
AGENT_KEY="$2"

echo "[1/4] Detecting architecture..."
ARCH=$(uname -m)
case $ARCH in
  x86_64)  ARCH_NAME="amd64" ;;
  aarch64) ARCH_NAME="arm64" ;;
  armv7l|armv6l) ARCH_NAME="arm" ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac
echo "  arch: $ARCH_NAME"

echo "[2/4] Installing status-agent binary..."
curl -sSL "${SERVER_URL}/agents/agent-linux-${ARCH_NAME}" -o /tmp/status-agent-new
chmod +x /tmp/status-agent-new
mv -f /tmp/status-agent-new /usr/local/bin/status-agent
echo "  installed: /usr/local/bin/status-agent"

echo "[3/4] Creating systemd service..."
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
systemctl enable --now status-agent
echo "  service started"

echo "[4/4] Verifying..."
sleep 3
systemctl is-active status-agent && echo "  status-agent: active"

# Check Docker availability
if command -v docker &> /dev/null; then
  echo "  Docker detected - container monitoring enabled automatically"
else
  echo "  Docker NOT found - install Docker to enable container monitoring"
fi

echo ""
echo "Done! The agent will appear in the dashboard within 30 seconds."
echo "Make sure the AGENT_KEY matches the one registered in the admin panel."
