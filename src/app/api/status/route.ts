import { NextResponse } from 'next/server';
import os from 'os';
import { loadLastResults } from '@/lib/checker';
import { loadConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const config = loadConfig();
    const cached = loadLastResults();
    if (cached) {
      return NextResponse.json(
        {
          services: cached.services,
          checked_at: new Date(cached.timestamp).toISOString(),
          cached: true,
          group_order: config.group_order || [],
          server_name: os.hostname(),
        },
        {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // No cache yet (first startup) — run checks as fallback
    const { checkAllServices, saveLastResults } = await import('@/lib/checker');
    const { recordChecks } = await import('@/lib/history');

    const results = await checkAllServices(config.services);

    try {
      recordChecks(results.map(r => ({ id: r.id, status: r.status })));
    } catch {}
    saveLastResults(results);

    return NextResponse.json(
      {
        services: results,
        checked_at: new Date().toISOString(),
        cached: false,
        group_order: config.group_order || [],
        server_name: os.hostname(),
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (e) {
    console.error('[status] Error:', e);
    return NextResponse.json(
      { error: 'Failed to load status', services: [] },
      { status: 500 }
    );
  }
}