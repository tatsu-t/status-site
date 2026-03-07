import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadConfig, saveConfig, generateId } from '@/lib/config';

const PAIRS_PATH = join(process.cwd(), 'data', 'pending-pairs.json');
const AGENTS_PATH = join(process.cwd(), 'data', 'pending-agents.json');

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
  const { token, name, group, icon } = await req.json();
  if (!token || !name) {
    return NextResponse.json({ error: 'Missing token or name' }, { status: 400 });
  }

  const agents = loadJSON<PendingAgent>(AGENTS_PATH);
  const agent = agents.find(a => a.token === token);
  if (!agent) {
    return NextResponse.json({ error: 'Pending agent not found' }, { status: 404 });
  }

  const config = loadConfig();
  config.services.push({
    id: generateId(),
    name,
    type: 'agent-push',
    target: '',
    group: group || 'Remote Agents',
    icon: icon || 'bi-server',
    auth: { user: 'agent', pass: agent.agent_key },
  });
  saveConfig(config);

  // Remove from pending lists
  const remainingAgents = agents.filter(a => a.token !== token);
  saveJSON(AGENTS_PATH, remainingAgents);

  const pairs = loadJSON<PendingPair>(PAIRS_PATH);
  saveJSON(PAIRS_PATH, pairs.filter(p => p.token !== token));

  return NextResponse.json({ success: true });
}
