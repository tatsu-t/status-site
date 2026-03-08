import { NextRequest, NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';
import { existsSync, readFileSync } from 'fs';
import { dataPath } from '@/lib/paths';

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agentId');
  if (!agentId) return NextResponse.json({ containers: [] });

  const config = loadConfig();
  const svc = config.services.find((s: { id: string; type: string; auth?: { pass?: string } }) => s.id === agentId && s.type === 'agent-push');
  if (!svc || !svc.auth?.pass) return NextResponse.json({ containers: [] });

  const statesFile = dataPath('agent-states.json');
  if (!existsSync(statesFile)) return NextResponse.json({ containers: [] });

  const states = JSON.parse(readFileSync(statesFile, 'utf-8'));
  const agentState = states[agentId];
  const containers = agentState?.all_docker_containers ?? [];

  return NextResponse.json({ containers });
}
