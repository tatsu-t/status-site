import { NextRequest, NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });

  const config = loadConfig();
  const svc = config.services.find(s => s.auth?.pass === key && s.type === 'agent-push');
  if (!svc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    docker_watch: svc.docker_watch || '',
    systemd_watch: svc.systemd_watch || '',
  });
}
