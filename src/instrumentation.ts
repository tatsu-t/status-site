export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Auto-recover history from backup servers on startup
  // Delay to let the app fully initialize
  setTimeout(async () => {
    try {
      await autoRecoverHistory();
    } catch (e) {
      console.error('[auto-recover] Failed:', e);
    }
  }, 15000);

  // Background status checker — runs checks every 2 minutes and caches results.
  // Frontend /api/status reads cached results for instant response.
  setTimeout(() => {
    const localUrl = 'http://127.0.0.1:' + (process.env.PORT || '3000');
    const runCheck = async () => {
      try {
        const res = await fetch(`${localUrl}/api/status/check`, {
          method: 'POST',
          signal: AbortSignal.timeout(60_000),
        });
        if (res.ok) {
          const data = await res.json() as { checked?: number };
          console.log(`[bg-checker] Checked ${data.checked ?? '?'} services`);
        } else {
          console.error(`[bg-checker] HTTP ${res.status}`);
        }
      } catch (e) {
        console.error('[bg-checker] Failed:', e);
      }
    };
    runCheck();
    setInterval(runCheck, 120_000);
    console.log('[bg-checker] Started — checking every 2 min');
  }, 30_000);
}

async function autoRecoverHistory() {
  const secret = process.env.RECOVERY_SECRET;
  if (!secret) return;

  const backups = [
    process.env.BACKUP_RECOVER_URL_1,
    process.env.BACKUP_RECOVER_URL_2,
  ].filter(Boolean);

  const localUrl = 'http://127.0.0.1:' + (process.env.PORT || '3000');

  let totalMerged = 0;

  for (const backupBase of backups) {
    try {
      const exportRes = await fetch(`${backupBase}/api/history/export`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!exportRes.ok) continue;

      const history = await exportRes.json();
      if (!history || typeof history !== 'object') continue;

      const mergeRes = await fetch(`${localUrl}/api/history/merge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ history }),
        signal: AbortSignal.timeout(15000),
      });

      if (mergeRes.ok) {
        const result = await mergeRes.json() as { merged?: number };
        if ((result.merged ?? 0) > 0) {
          console.log(`[auto-recover] Merged ${result.merged} buckets from ${backupBase}`);
          totalMerged += result.merged ?? 0;
        }
      }
    } catch {
      // backup unreachable, skip
    }
  }

  if (totalMerged > 0) {
    console.log(`[auto-recover] Total merged: ${totalMerged} history buckets`);
  } else {
    console.log('[auto-recover] No history gaps to fill');
  }
}
