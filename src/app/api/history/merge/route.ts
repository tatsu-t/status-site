import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dataPath, ensureDataDir } from '@/lib/paths';

const HISTORY_FILE = dataPath('history.json');

interface HourBucket {
  hour: string;
  up: number;
  unstable: number;
  down: number;
  total: number;
}

type HistoryStore = Record<string, HourBucket[]>;

export async function POST(req: NextRequest) {
  // Auth via RECOVERY_SECRET
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  const secret = process.env.RECOVERY_SECRET;

  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { history: incoming } = await req.json() as { history: HistoryStore };
  if (!incoming || typeof incoming !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  // Load local history
  let local: HistoryStore = {};
  try {
    if (existsSync(HISTORY_FILE)) {
      local = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch {}

  let merged = 0;

  for (const [serviceId, buckets] of Object.entries(incoming)) {
    if (!Array.isArray(buckets)) continue;
    if (!local[serviceId]) local[serviceId] = [];

    for (const inBucket of buckets) {
      const existing = local[serviceId].find(b => b.hour === inBucket.hour);
      if (!existing) {
        local[serviceId].push(inBucket);
        merged++;
      } else if (inBucket.total > existing.total) {
        existing.up = inBucket.up;
        existing.unstable = inBucket.unstable;
        existing.down = inBucket.down;
        existing.total = inBucket.total;
        merged++;
      }
    }
  }

  ensureDataDir();
  writeFileSync(HISTORY_FILE, JSON.stringify(local));

  return NextResponse.json({ merged });
}
