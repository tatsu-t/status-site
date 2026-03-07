import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

import { join } from 'path';
const HISTORY_FILE = join(process.cwd(), 'data', 'history.json');
const MAX_HOURS = 90;

export interface HourBucket {
  hour: string;
  up: number;
  unstable: number;
  down: number;
  total: number;
}

type HistoryStore = Record<string, HourBucket[]>;

function loadHistory(): HistoryStore {
  try {
    if (existsSync(HISTORY_FILE)) {
      return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveHistory(h: HistoryStore): void {
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
  writeFileSync(HISTORY_FILE, JSON.stringify(h));
}

export function recordChecks(results: { id: string; status: 'up' | 'down' | 'unstable' }[]): void {
  const h = loadHistory();
  const now = new Date();
  const hour = now.toISOString().slice(0, 13);

  for (const r of results) {
    if (!h[r.id]) h[r.id] = [];
    const buckets = h[r.id];

    let bucket = buckets.find(b => b.hour === hour);
    if (!bucket) {
      bucket = { hour, up: 0, unstable: 0, down: 0, total: 0 };
      buckets.push(bucket);
    }

    bucket[r.status]++;
    bucket.total++;

    if (buckets.length > MAX_HOURS) {
      h[r.id] = buckets.slice(-MAX_HOURS);
    }
  }

  saveHistory(h);
}

export function getHistory(serviceId: string): HourBucket[] {
  const h = loadHistory();
  return h[serviceId] || [];
}

export function getAllHistory(): HistoryStore {
  return loadHistory();
}
