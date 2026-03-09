import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';
import { checkAllServices, saveLastResults } from '@/lib/checker';
import { recordChecks } from '@/lib/history';

export const dynamic = 'force-dynamic';

// Internal endpoint called by bg-checker in instrumentation.ts.
// Runs all service checks, saves results to cache, and records history.
export async function POST() {
  try {
    const config = loadConfig();
    const results = await checkAllServices(config.services);

    saveLastResults(results);
    try {
      recordChecks(results.map(r => ({ id: r.id, status: r.status })));
    } catch {}

    return NextResponse.json({
      ok: true,
      checked: results.length,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[check] Error:', e);
    return NextResponse.json(
      { ok: false, error: String(e) },
      { status: 500 }
    );
  }
}
