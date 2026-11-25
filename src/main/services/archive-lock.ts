// Archive lock — PURE, no IO. Counts archive runs in progress so the full sync can refuse to start
// while one runs: the sync wipes and rewrites the tables an archive reads and reconciles. Its own
// module so the sync and the archive services can both import it without a circular import.

let running = 0;

export function archiveRunning(): boolean {
  return running > 0;
}

/** Runs fn with the lock held. The count is taken synchronously, before fn's first await. */
export async function withArchiveLock<T>(fn: () => Promise<T>): Promise<T> {
  running++;
  try {
    return await fn();
  } finally {
    running--;
  }
}
