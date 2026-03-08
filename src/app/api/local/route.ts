import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import fs from 'fs';
import { dataPath } from '@/lib/paths';

export const dynamic = 'force-dynamic';

function loadPingWhitelist(): string[] {
  try {
    const data = fs.readFileSync(dataPath('local-config.json'), 'utf-8');
    const config = JSON.parse(data);
    return config.ping_whitelist || ['127.0.0.1'];
  } catch {
    return ['127.0.0.1'];
  }
}

function isAllowedIP(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  const raw = ip.replace('::ffff:', '');
  const parts = raw.split('.').map(Number);
  if (parts.length === 4) {
    // Tailscale CGNAT range 100.64.0.0/10
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // LAN
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  return false;
}

function getClientIP(request: NextRequest): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '127.0.0.1'
  );
}

function jsonHeaders() {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
  };
}

function handleDocker() {
  const dockerSocket = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
  try {
    const output = execSync(
      `curl -s --unix-socket ${dockerSocket} 'http://localhost/containers/json?all=1'`,
      { timeout: 5000 }
    );
    return NextResponse.json(JSON.parse(output.toString()), { headers: jsonHeaders() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Docker query failed', detail: msg }, { status: 500, headers: jsonHeaders() });
  }
}

function handleStorage() {
  const storageMountPath = process.env.STORAGE_MOUNT_PATH || '/mnt/filesystem';
  try {
    fs.accessSync(storageMountPath, fs.constants.W_OK);
    return NextResponse.json(
      { status: 'active', path: storageMountPath, label: 'External SSD', type: 'hardware' },
      { headers: jsonHeaders() }
    );
  } catch {
    return NextResponse.json(
      { status: 'down', path: storageMountPath, label: 'External SSD', type: 'hardware' },
      { headers: jsonHeaders() }
    );
  }
}

function handlePing(host: string) {
  const whitelist = loadPingWhitelist();
  if (!whitelist.includes(host)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 403, headers: jsonHeaders() });
  }
  try {
    execSync(`ping -c 1 -W 1 ${host}`, { timeout: 3000 });
    return NextResponse.json({ status: 'active', host }, { headers: jsonHeaders() });
  } catch {
    return NextResponse.json({ status: 'down', host }, { headers: jsonHeaders() });
  }
}

function handleSystemctl(name: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return NextResponse.json({ error: 'Invalid service name' }, { status: 400, headers: jsonHeaders() });
  }
  try {
    const output = execSync(`systemctl is-active ${name}`, { timeout: 5000 });
    const status = output.toString().trim() === 'active' ? 'active' : 'down';
    return NextResponse.json({ status, service: name }, { headers: jsonHeaders() });
  } catch {
    return NextResponse.json({ status: 'down', service: name }, { headers: jsonHeaders() });
  }
}

export async function GET(request: NextRequest) {
  const clientIP = getClientIP(request);
  if (!isAllowedIP(clientIP)) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: jsonHeaders() }
    );
  }

  const { searchParams } = new URL(request.url);
  const service = searchParams.get('service');

  if (!service) {
    return NextResponse.json({ error: 'Missing service parameter' }, { status: 400, headers: jsonHeaders() });
  }

  switch (service) {
    case 'docker':
      return handleDocker();
    case 'storage':
      return handleStorage();
    case 'ping': {
      const host = searchParams.get('host');
      if (!host) return NextResponse.json({ error: 'Missing host parameter' }, { status: 400, headers: jsonHeaders() });
      return handlePing(host);
    }
    case 'systemctl': {
      const name = searchParams.get('name');
      if (!name) return NextResponse.json({ error: 'Missing name parameter' }, { status: 400, headers: jsonHeaders() });
      return handleSystemctl(name);
    }
    default:
      return NextResponse.json({ error: 'Unknown service' }, { status: 400, headers: jsonHeaders() });
  }
}
