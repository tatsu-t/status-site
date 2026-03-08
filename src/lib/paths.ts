import path from 'path';
import { mkdirSync } from 'fs';

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

export function dataPath(filename: string): string {
  return path.join(DATA_DIR, filename);
}

/** Ensure the data directory exists */
export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}
