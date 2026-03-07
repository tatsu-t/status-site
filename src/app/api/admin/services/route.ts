import { NextRequest, NextResponse } from 'next/server';
import { loadConfig, saveConfig, invalidateCache, generateId } from '@/lib/config';
import { AppConfig } from '@/lib/config';

function syncConfigToBackups(config: AppConfig) {
  const secret = process.env.RECOVERY_SECRET;
  if (!secret) return;
  const urls = (process.env.BACKUP_CONFIG_URLS || '').split(',').filter(Boolean);
  for (const url of urls) {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secret}` },
      body: JSON.stringify(config),
    }).catch(() => {});
  }
}

export async function GET() {
  invalidateCache();
  const config = loadConfig();
  return NextResponse.json(config);
}

export async function POST(request: NextRequest) {
  const service = await request.json();
  invalidateCache();
  const config = loadConfig();
  service.id = generateId();
  config.services.push(service);
  saveConfig(config);
  syncConfigToBackups(config);
  return NextResponse.json({ success: true, id: service.id });
}

export async function PUT(request: NextRequest) {
  const service = await request.json();
  invalidateCache();
  const config = loadConfig();
  const index = config.services.findIndex(s => s.id === service.id);
  if (index === -1) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 });
  }
  config.services[index] = service;
  saveConfig(config);
  syncConfigToBackups(config);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }
  invalidateCache();
  const config = loadConfig();
  config.services = config.services.filter(s => s.id !== id);
  saveConfig(config);
  syncConfigToBackups(config);
  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  invalidateCache();
  const body = await request.json();
  const { id, direction } = body;

  const config = loadConfig();
  const idx = config.services.findIndex(s => s.id === id);

  if (idx === -1) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 });
  }

  const newIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= config.services.length) {
    return NextResponse.json({ error: 'Cannot move further' }, { status: 400 });
  }

  const arr = [...config.services];
  [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
  config.services = arr;
  saveConfig(config);
  invalidateCache();
  syncConfigToBackups(config);

  return NextResponse.json({ success: true });
}