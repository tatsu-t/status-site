import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const LOCK_TIMEOUT = 5000;
const RETRY_INTERVAL = 50;

export function withFileLock<T>(filepath: string, fn: () => T): T {
  const lockPath = filepath + '.lock';
  const dir = dirname(lockPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const deadline = Date.now() + LOCK_TIMEOUT;

  while (true) {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      break;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;

      // Check if lock is stale (older than timeout)
      try {
        const stat = readFileSync(lockPath, 'utf-8');
        const lockPid = parseInt(stat, 10);
        if (lockPid && lockPid !== process.pid) {
          try { process.kill(lockPid, 0); } catch {
            // Process doesn't exist, stale lock
            unlinkSync(lockPath);
            continue;
          }
        }
      } catch { /* lock file gone, retry */ continue; }

      if (Date.now() > deadline) {
        // Force unlock after timeout
        try { unlinkSync(lockPath); } catch {}
        continue;
      }

      // Busy wait (sync context)
      const wait = Date.now() + RETRY_INTERVAL;
      while (Date.now() < wait) { /* spin */ }
    }
  }

  try {
    return fn();
  } finally {
    try { unlinkSync(lockPath); } catch {}
  }
}
