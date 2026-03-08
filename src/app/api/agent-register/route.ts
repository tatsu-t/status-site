import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { loadConfig, saveConfig, generateId } from '@/lib/config';
import { dataPath } from '@/lib/paths';

const PAIRS_PATH = dataPath('pending-pairs.json');
const AGENTS_PATH = dataPath('pending-agents.json');
const TOKEN_EXPIRY_MS = 15 * 60 * 1000;

interface PendingPair { token: string; created_at: string; }
interface PendingAgent {
  token: string; hostname: string; ip: string; agent_key: string;
  cpu_percent: number; memory_percent: number; disk_percent: number; registered_at: string;
}

function loadJSON<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return []; }
}

function saveJSON<T>(path: string, data: T[]): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, name, ip, agent_key, group, cpu_percent, memory_percent, disk_percent } = body;

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  // Check if token is a valid pairing token
  const pairs = loadJSON<PendingPair>(PAIRS_PATH);
  const now = Date.now();
  const activePair = pairs.find(
    p => p.token === token && now - new Date(p.created_at).getTime() < TOKEN_EXPIRY_MS
  );

  if (activePair) {
    // Pairing flow: add to pending agents for admin approval
    const agents = loadJSON<PendingAgent>(AGENTS_PATH);
    const hostname = name || 'unknown';

    // Replace if same token already pending
    const filtered = agents.filter(a => a.token !== token);
    filtered.push({
      token,
      hostname,
      ip: ip || '',
      agent_key: agent_key || '',
      cpu_percent: cpu_percent ?? 0,
      memory_percent: memory_percent ?? 0,
      disk_percent: disk_percent ?? 0,
      registered_at: new Date().toISOString(),
    });
    saveJSON(AGENTS_PATH, filtered);

    return NextResponse.json({
      success: true,
      mode: 'pending',
      message: 'Waiting for admin approval',
    });
  }

  // Backward compat: direct registration with admin password
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || token !== adminPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = loadConfig();
  const serviceName = name || 'Remote Agent';
  const serviceGroup = group || 'Remote Agents';

  const newService = {
    id: generateId(),
    name: serviceName,
    type: 'agent-push' as const,
    target: '',
    group: serviceGroup,
    icon: 'bi-server',
    auth: { user: 'agent', pass: agent_key },
  };

  const existingIdx = config.services.findIndex(s => s.name === serviceName);
  if (existingIdx >= 0) {
    config.services[existingIdx] = { ...config.services[existingIdx], ...newService, id: config.services[existingIdx].id };
  } else {
    config.services.push(newService);
  }

  saveConfig(config);

  return NextResponse.json({
    success: true,
    message: 'Registered ' + serviceName,
    service_url: newService.target,
  });
}
