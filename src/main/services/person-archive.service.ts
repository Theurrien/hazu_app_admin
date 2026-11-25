// Person archive — IO LAYER. Wires the pure core (person-archive.ts) to the Hazu API and local SQLite.
// No step logic lives here. Spec: docs/specs/2026-11-25-person-archive-design.md (Local reconcile, Surface).
// Logs carry the person's id only — never a name or an e-mail address.

import { getDb } from '../database';
import { buildDeps, findArchiveRoot, setting, toError } from './room-archive.service';
import { reliableUpdateUserRole } from './role-write.service';
import { getSyncProgress } from './sync.service';
import {
  PERSONS_FOLDER_TAG,
  PersonArchiveDeps,
  archivedPersonEntry,
  runPersonArchive,
  runPersonRestore,
  syncState,
} from './person-archive';
import type { ArchiveDeps } from './room-archive';
import type {
  ArchivedPerson,
  PersonArchiveOutcome,
  PersonArchivePlan,
  PersonRestoreOutcome,
} from '../../shared/archive-types';

interface PersonRow {
  id: string;
  email: string | null;
  display_name: string;
  person_type: string;
}

/** Live person categories: children of root carrying a hz-config-profile-* tag. */
async function livePersonCategoryIds(deps: ArchiveDeps): Promise<string[]> {
  const root = setting('root_hazu_id');
  if (!root) return [];
  return (await deps.list(root))
    .filter((n) => n.tags.some((t) => t.startsWith('hz-config-profile-')))
    .map((n) => n.id);
}

function assignmentsOf(personId: string): Array<{ roomId: string; role: string; title: string }> {
  return (
    getDb()
      .prepare(
        `SELECT a.room_id AS roomId, a.role AS role, r.title AS title
           FROM person_room_assignments a JOIN rooms r ON r.id = a.room_id
          WHERE a.person_id = ?
          ORDER BY r.title`,
      )
      .all(personId) as Array<{ roomId: string; role: string; title: string }>
  );
}

/** A running sync, or one that started and never finished, leaves the local room list partial. */
function currentSyncState() {
  return syncState(setting('last_sync_at'), getSyncProgress().status === 'syncing', Date.now());
}

const SYNC_INCOMPLETE = 'synchronisation incomplète — synchronisez d\'abord';

// ---------------------------------------------------------------------------------------------
// Plan (local only)

export function planPersonArchive(personId: string): PersonArchivePlan {
  const db = getDb();
  const person = db.prepare('SELECT id, email, display_name, person_type FROM persons WHERE id = ?').get(personId) as
    | PersonRow
    | undefined;
  if (!person) throw new Error('personne introuvable');
  const sync = currentSyncState();
  return {
    personId,
    displayName: person.display_name,
    personType: person.person_type,
    rooms: assignmentsOf(personId),
    lastSyncAt: sync.lastSyncAt,
    syncStale: sync.stale,
    syncIncomplete: sync.incomplete,
  };
}

// ---------------------------------------------------------------------------------------------
// Live list

export async function listArchivedPersons(): Promise<ArchivedPerson[]> {
  try {
    const deps = buildDeps();
    const root = await findArchiveRoot(deps);
    if (!root) return [];
    const folder = (await deps.list(root.id)).find((c) => c.tags.includes(PERSONS_FOLDER_TAG));
    if (!folder) return [];
    const out: ArchivedPerson[] = [];
    for (const child of await deps.list(folder.id)) {
      const entry = archivedPersonEntry(child, await deps.list(child.id));
      if (entry) out.push(entry);
    }
    return out.sort((a, b) => b.archivedAt - a.archivedAt);
  } catch (e) {
    throw toError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Archive

/** One transaction; called only on full success. Every table keyed by person_id, then the person. */
function reconcileArchive(person: PersonRow): void {
  const db = getDb();
  const formationTables = [
    'formation_student',
    'formation_copy',
    'formation_assessment',
    'formation_report',
    'formation_plan_retired',
  ];
  db.transaction(() => {
    db.prepare('DELETE FROM person_room_assignments WHERE person_id = ?').run(person.id);
    for (const t of formationTables) db.prepare(`DELETE FROM ${t} WHERE person_id = ?`).run(person.id);
    if (person.email) {
      db.prepare('DELETE FROM membership_issues WHERE uid = ? OR email = ?').run(person.email, person.email);
    }
    db.prepare('DELETE FROM persons WHERE id = ?').run(person.id);
  })();
}

export async function archivePerson(personId: string): Promise<PersonArchiveOutcome> {
  try {
    return await archivePersonUnsafe(personId);
  } catch (e) {
    return { success: false, steps: [], remaining: [personId], error: toError(e).message };
  }
}

async function archivePersonUnsafe(personId: string): Promise<PersonArchiveOutcome> {
  const db = getDb();
  const person = db.prepare('SELECT id, email, display_name, person_type FROM persons WHERE id = ?').get(personId) as
    | PersonRow
    | undefined;
  const fail = (error: string): PersonArchiveOutcome => ({ success: false, steps: [], remaining: [personId], error });
  if (!person) return fail('personne introuvable');
  const adminId = setting('admin_id');
  if (!adminId || !setting('root_hazu_id') || !setting('user_id')) return fail('synchronisation requise');
  // The room list comes from person_room_assignments, which a sync empties first and refills last:
  // during a sync, or after one that failed or was quit, it is partial. Refuse; write nothing.
  if (currentSyncState().incomplete) return fail(SYNC_INCOMPLETE);

  const liveRooms = (
    db.prepare('SELECT id, class_id, title FROM rooms WHERE class_id IS NOT NULL AND class_id != ?').all('') as Array<{
      id: string;
      class_id: string;
      title: string;
    }>
  ).map((r) => ({ roomId: r.id, classId: r.class_id, title: r.title }));
  const assignments = assignmentsOf(personId);

  const deps: PersonArchiveDeps = {
    ...buildDeps(),
    removeRole: async (roomId, role) => {
      const res = await reliableUpdateUserRole(personId, roomId, role, '_', { reconcileOnlyWhenVerified: true });
      // Spec: every room removal must be confirmed by S4's group-truth read. A 2xx that could not be
      // verified (success && !verified) is not a confirmed removal: the profile must not move.
      return {
        success: res.success && res.verified,
        error: res.success && !res.verified ? 'retrait non vérifiable (synchronisation requise ?)' : res.error,
      };
    },
  };

  let outcome: PersonArchiveOutcome;
  try {
    const categoryIds = await livePersonCategoryIds(deps);
    outcome = await runPersonArchive(
      {
        person: { id: person.id, displayName: person.display_name },
        categoryIds,
        adminId,
        assignments,
        liveRooms,
        now: Date.now(),
      },
      deps,
    );
  } catch (e) {
    outcome = fail(toError(e).message);
  }

  if (outcome.success) {
    try {
      reconcileArchive(person);
    } catch (e) {
      console.error('[person-archive] local reconcile failed:', e instanceof Error ? e.message : e);
    }
  }
  const removed = outcome.steps.find((s) => s.step === 'rooms')?.detail;
  console.log(
    `[person-archive] person=${personId} success=${outcome.success} ` +
    `rooms=${removed ?? 0}/${assignments.length} remaining=[${outcome.remaining.join(',')}]`,
  );
  return outcome;
}

// ---------------------------------------------------------------------------------------------
// Restore (no local change: the profile returns with the next sync)

export async function restorePerson(folderId: string): Promise<PersonRestoreOutcome> {
  try {
    const adminId = setting('admin_id');
    if (!adminId || !setting('root_hazu_id') || !setting('user_id')) {
      return { success: false, steps: [], remaining: [folderId], error: 'synchronisation requise' };
    }
    const deps = buildDeps();
    const categoryIds = await livePersonCategoryIds(deps);
    const outcome = await runPersonRestore({ folderId, adminId, categoryIds }, deps);
    console.log(`[person-archive] restore folder=${folderId} success=${outcome.success} remaining=[${outcome.remaining.join(',')}]`);
    return outcome;
  } catch (e) {
    return { success: false, steps: [], remaining: [folderId], error: toError(e).message };
  }
}
