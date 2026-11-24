// Pure decisions of the Missions overview header and figures — no React, no IO.
import type { FormationSyncStatus } from '../../../shared/formation-types';

/**
 * True when the stored data is newer than the overview on screen: the sync is `idle` and its
 * `lastSyncedAt` is later than the loaded overview's `syncedAt`. Covers a run that finished while
 * the header was unmounted, and a run that is already `idle` when `formationSyncStart` returns.
 */
export function shouldReload(status: FormationSyncStatus, loadedSyncedAt: number | null): boolean {
  if (status.status !== 'idle' || status.lastSyncedAt === null) return false;
  return loadedSyncedAt === null || status.lastSyncedAt > loadedSyncedAt;
}

/**
 * A rate in 0..1 as a rounded percentage; `null` → « — ». Rounding never claims a finished or an
 * empty state it is not: a rate below 1 shows at most « 99 % », a rate above 0 shows « < 1 % ».
 */
export function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  const pct = Math.round(rate * 100);
  if (rate > 0 && pct === 0) return '< 1 %';
  if (rate < 1 && pct === 100) return '99 %';
  return `${pct} %`;
}
