import { NextResponse } from 'next/server';
import { getAllHistory } from '@/lib/history';

export const dynamic = 'force-dynamic';

export async function GET() {
  const history = getAllHistory();
  return NextResponse.json(history, {
    headers: { 'Cache-Control': 'no-store' }
  });
}
