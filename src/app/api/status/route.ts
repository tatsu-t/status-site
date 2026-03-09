import { NextResponse } from 'next/server';
import os from 'os';
import { loadConfig } from '@/lib/config';
import { checkAllServices } from '@/lib/checker';
import { recordChecks } from '@/lib/history';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const config = loadConfig();
    const results = await checkAllServices(config.services);
    try {
      recordChecks(results.map(r => ({ id: r.id, status: r.status })));
    } catch (e) {
      console.error('[history]', e);
    }
    return NextResponse.json(
      { services: results, checked_at: new Date().toISOString(), group_order: config.group_order || [], server_name: os.hostname() },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Status check error:', error);
    return NextResponse.json(
      { error: 'Failed to check services', services: [] },
      { status: 500 }
    );
  }
}