import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import crypto from 'crypto';
import { dataPath } from '@/lib/paths';

const PAIRS_PATH = dataPath('pending-pairs.json');
const AGENTS_PATH = dataPath('pending-agents.json');
const TOKEN_EXPIRY_MS = 15 * 60 * 1000;

interface PendingPair {
  token: string;
  created_at: string;
}

interface PendingAgent {
  token: string;
  hostname: string;
  ip: string;
  agent_key: string;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  registered_at: string;
}

function loadJSON<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveJSON<T>(path: string, data: T[]): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

export async function POST() {
  const token = crypto.randomBytes(12).toString('base64url').slice(0, 16);
  const pairs = loadJSON<PendingPair>(PAIRS_PATH);
  pairs.push({ token, created_at: new Date().toISOString() });
  saveJSON(PAIRS_PATH, pairs);

  const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
  const command = 'curl -sSL ' + serverUrl + '/install-agent.sh | sudo bash -s -- ' + serverUrl + ' ' + token;

  return NextResponse.json({ token, command });
}

export async function GET() {
  const pairs = loadJSON<PendingPair>(PAIRS_PATH);
  const agents = loadJSON<PendingAgent>(AGENTS_PATH);

  const now = Date.now();
  const activeTokens = new Set(
    pairs
      .filter(p => now - new Date(p.created_at).getTime() < TOKEN_EXPIRY_MS)
      .map(p => p.token)
  );

  const pendingAgents = agents.filter(a => activeTokens.has(a.token));

  return NextResponse.json({ agents: pendingAgents });
}
