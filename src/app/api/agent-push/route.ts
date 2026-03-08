import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { loadConfig } from '@/lib/config';
import { dataPath, ensureDataDir } from '@/lib/paths';

const STATES_FILE = dataPath('agent-states.json');

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

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { agent_key, hostname, is_up, cpu_percent, memory_percent, disk_percent, uptime_seconds, docker_containers, all_docker_containers, systemd_services, ping_ms } = body;

  if (!agent_key) {
    return NextResponse.json({ error: 'Missing agent_key' }, { status: 400 });
  }

  // Verify agent_key matches a registered agent-push service
  const config = loadConfig();
  const agent = config.services.find(s => s.type === 'agent-push' && s.auth?.pass === agent_key);

  if (!agent) {
    return NextResponse.json({ error: 'Unknown agent' }, { status: 401 });
  }

  // Load existing states
  let states: Record<string, AgentState> = {};
  if (existsSync(STATES_FILE)) {
    try { states = JSON.parse(readFileSync(STATES_FILE, 'utf-8')); } catch {}
  }

  // Update state keyed by agent id
  const agentState: AgentState = {
    hostname: hostname || agent.name,
    is_up: is_up !== false,
    cpu_percent: cpu_percent || 0,
    memory_percent: memory_percent || 0,
    disk_percent: disk_percent || 0,
    uptime_seconds: uptime_seconds || 0,
    last_seen: new Date().toISOString(),
  };
  if (docker_containers) agentState.docker_containers = docker_containers;
  if (all_docker_containers) agentState.all_docker_containers = all_docker_containers;
  if (typeof ping_ms === 'number') agentState.ping_ms = ping_ms;
  if (systemd_services) agentState.systemd_services = systemd_services;
  states[agent.id] = agentState;

  // Ensure data dir exists
  ensureDataDir();
  writeFileSync(STATES_FILE, JSON.stringify(states, null, 2));

  // Relay to backup servers (fire-and-forget, non-blocking)
  const isRelay = req.headers.get('X-Relay') === 'true';
  if (!isRelay) {
    const backupUrls = (process.env.BACKUP_PUSH_URLS || '').split(',').filter(Boolean);
    for (const url of backupUrls) {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Relay': 'true' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      })
        .then(r => { if (!r.ok) console.warn(`Agent push relay failed to ${url}: HTTP ${r.status}`); })
        .catch(e => console.error(`Agent push relay error for ${url}:`, e.message));
    }
  }

  return NextResponse.json({ success: true });
}
