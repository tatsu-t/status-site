import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { invalidateCache } from '@/lib/config';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  const secret = process.env.RECOVERY_SECRET;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await req.json();
  if (!config || !Array.isArray(config.services)) {
    return NextResponse.json({ error: 'Invalid config' }, { status: 400 });
  }

  const configPath = join(process.cwd(), 'data', 'config.json');
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  invalidateCache();

  return NextResponse.json({ success: true });
}