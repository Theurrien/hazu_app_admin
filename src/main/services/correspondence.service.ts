// Contrôle — saved links between spreadsheet values and Hazu persons / rooms. IO LAYER (local SQLite only).
// Nothing here is written to Hazu. File values may be names: never log them.

import { getDb, transaction } from '../database';
import { setting } from './room-archive.service';
import { getSyncProgress } from './sync.service';
import { syncIncompleteMessage, syncState } from './person-archive';
import type { CorrCategory, SavedLink } from '../../shared/correspondence';

const CATEGORIES: readonly CorrCategory[] = ['student', 'class', 'enterprise', 'state'];

function assertCategory(category: unknown): asserts category is CorrCategory {
  if (typeof category !== 'string' || !CATEGORIES.includes(category as CorrCategory)) {
    throw new Error('catégorie invalide');
  }
}

export function listCorrespondences(): SavedLink[] {
  const rows = getDb()
    .prepare('SELECT category, file_key, file_label, hazu_id, decided_at FROM file_correspondence')
    .all() as Array<{
    category: CorrCategory;
    file_key: string;
    file_label: string;
    hazu_id: string | null;
    decided_at: number;
  }>;
  return rows.map((r) => ({
    category: r.category,
    fileKey: r.file_key,
    fileLabel: r.file_label,
    hazuId: r.hazu_id,
    decidedAt: r.decided_at,
  }));
}

/** Upsert in one transaction; any invalid link rejects the whole batch before anything is written. */
export function saveCorrespondences(links: SavedLink[]): void {
  if (!Array.isArray(links)) throw new Error('liste invalide');
  for (const l of links) assertCategory(l?.category);
  const stmt = getDb().prepare(
    `INSERT OR REPLACE INTO file_correspondence (category, file_key, file_label, hazu_id, decided_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  transaction(() => {
    for (const l of links) stmt.run(l.category, l.fileKey, l.fileLabel, l.hazuId, l.decidedAt);
  });
}

export function deleteCorrespondence(category: CorrCategory, fileKey: string): void {
  assertCategory(category);
  getDb().prepare('DELETE FROM file_correspondence WHERE category = ? AND file_key = ?').run(category, fileKey);
}

/** Same sync state the person archive uses: the check reads the last sync's group truth. */
export function controleSyncState(): {
  incomplete: boolean;
  stale: boolean;
  lastSyncAt: number | null;
  message: string | null;
} {
  const s = syncState(
    setting('last_sync_at'),
    getSyncProgress().status === 'syncing',
    Date.now(),
    setting('sync_skipped_groups'),
  );
  return {
    incomplete: s.incomplete,
    stale: s.stale,
    lastSyncAt: s.lastSyncAt,
    message: s.incomplete ? syncIncompleteMessage(s.skippedGroups) : null,
  };
}
