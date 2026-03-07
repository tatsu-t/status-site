import { NextRequest, NextResponse } from 'next/server';
import { loadConfig, saveConfig, invalidateCache } from '@/lib/config';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { group_order } = body;

  if (!Array.isArray(group_order)) {
    return NextResponse.json({ error: 'group_order must be an array' }, { status: 400 });
  }

  invalidateCache();
  const config = loadConfig();
  config.group_order = group_order;
  saveConfig(config);

  return NextResponse.json({ success: true });
}
