import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { jwtVerify } from 'jose';
import fs from 'fs';
import { dataPath } from '@/lib/paths';

export const dynamic = 'force-dynamic';

function loadWolTargets(): Record<string, { mac: string; name: string; ip: string }> {
  try {
    const data = fs.readFileSync(dataPath('wol-targets.json'), 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function jsonHeaders() {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
  };
}

async function verifyAuth(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get('auth_token')?.value;
  if (!token) return false;
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return false;
    const secret = new TextEncoder().encode(jwtSecret);
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

function pingHost(ip: string): boolean {
  try {
    execSync(`ping -c 1 -W 1 ${ip}`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function handleList() {
  const targets = loadWolTargets();
  const results = Object.entries(targets).map(([key, target]) => ({
    id: key,
    name: target.name,
    mac: target.mac,
    ip: target.ip,
    online: pingHost(target.ip),
  }));
  return NextResponse.json({ targets: results }, { headers: jsonHeaders() });
}

function handleWake(targetName: string) {
  const targets = loadWolTargets();
  const target = targets[targetName];
  if (!target) {
    return NextResponse.json({ error: 'Unknown target' }, { status: 400, headers: jsonHeaders() });
  }
  try {
    execSync(`wakeonlan ${target.mac}`, { timeout: 5000 });
    return NextResponse.json({ success: true, target: target.name, mac: target.mac }, { headers: jsonHeaders() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'WoL failed', detail: msg }, { status: 500, headers: jsonHeaders() });
  }
}

export async function GET(request: NextRequest) {
  const authenticated = await verifyAuth(request);
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: jsonHeaders() });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (!action) {
    return NextResponse.json({ error: 'Missing action parameter' }, { status: 400, headers: jsonHeaders() });
  }

  switch (action) {
    case 'list':
      return handleList();
    case 'wake': {
      const target = searchParams.get('target');
      if (!target) return NextResponse.json({ error: 'Missing target parameter' }, { status: 400, headers: jsonHeaders() });
      return handleWake(target);
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: jsonHeaders() });
  }
}
