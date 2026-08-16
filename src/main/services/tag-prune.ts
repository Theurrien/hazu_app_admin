/**
 * Dead-tag pruning: pure core.
 *
 * No DB, no HTTP, no Electron — every side effect is injected, so the whole decision layer runs
 * under vitest without the native module or the network. tag-prune.service.ts supplies the real IO.
 *
 * The rule this file exists to enforce: only an explicit 404 authorises deleting a tag.
 */

export type RoomVerdict = 'deleted' | 'alive' | 'unreadable';

// The result of one GET /read attempt, with its failure already classified so the retry
// predicate can tell a doomed 4xx from a worth-retrying 5xx.
export interface ReadOutcome {
  ok: boolean;
  status?: number;
  networkOrTimeout: boolean;
  snapshot?: { title?: string; parentId?: string };
}

// What a probe learned about one class id. `title` and `parentId` are non-null only when alive.
export interface Verdict {
  verdict: RoomVerdict;
  title: string | null;
  parentId: string | null;
}

// One distinct class id referenced by breadcrumb tags that map to no local room, with the
// tags and the people carrying them.
export interface UnmatchedClassId {
  classId: string;
  tagCount: number;
  personCount: number;
  holders: Array<{ personId: string; tags: string[] }>;
}

// An id the prune declined to act on, and why. Shown in the confirmation modal.
export interface SkippedId {
  classId: string;
  verdict: 'alive' | 'unreadable';
  reason: string;
  title: string | null;
  parentId: string | null;
  tagCount: number;
}

// The tags to remove for one class id. Kept grouped by id rather than flattened, because a
// task's re-probe must be able to drop one id's tags while still deleting the rest.
export interface PruneItem {
  classId: string;
  tags: string[];
}

export interface PruneDeletion {
  personId: string;
  items: PruneItem[];
}

export interface PrunePlan {
  deletions: PruneDeletion[];
  skipped: SkippedId[];
  tagCount: number;
  personCount: number;
  roomCount: number;
}

export const SKIP_REASON: Record<'alive' | 'unreadable', string> = {
  alive:
    'the room still exists in Hazu — these breadcrumbs are correct, and the sync did not import it',
  unreadable:
    'Hazu did not answer for this id — only an explicit 404 authorises a deletion',
};

// Classify one read. ONLY a literal 404 yields 'deleted'. Everything else that is not a success
// is 'unreadable', including 401 and 403: an expired key fails every read, and treating that as
// "deleted" would arm the prune against every live tag in the set.
export function classifyReadResult(res: ReadOutcome): Verdict {
  if (res.ok) {
    return {
      verdict: 'alive',
      title: res.snapshot?.title ?? null,
      parentId: res.snapshot?.parentId ?? null,
    };
  }
  if (res.status === 404) return { verdict: 'deleted', title: null, parentId: null };
  return { verdict: 'unreadable', title: null, parentId: null };
}

// Turn verdicts + the unmatched set into what to delete, grouped by person, and what was
// skipped and why. An id with no verdict is treated as unreadable — a verdict that never
// arrived is not a licence to delete.
export function buildPrunePlan(
  ids: UnmatchedClassId[],
  verdicts: Map<string, Verdict>,
): PrunePlan {
  const byPerson = new Map<string, PruneDeletion>();
  const skipped: SkippedId[] = [];
  const deadIds = new Set<string>();
  let tagCount = 0;

  for (const id of ids) {
    const v = verdicts.get(id.classId);
    const verdict: RoomVerdict = v?.verdict ?? 'unreadable';

    if (verdict !== 'deleted') {
      skipped.push({
        classId: id.classId,
        verdict,
        reason: SKIP_REASON[verdict],
        title: v?.title ?? null,
        parentId: v?.parentId ?? null,
        tagCount: id.tagCount,
      });
      continue;
    }

    deadIds.add(id.classId);
    for (const holder of id.holders) {
      let entry = byPerson.get(holder.personId);
      if (!entry) {
        entry = { personId: holder.personId, items: [] };
        byPerson.set(holder.personId, entry);
      }
      entry.items.push({ classId: id.classId, tags: holder.tags });
      tagCount += holder.tags.length;
    }
  }

  const deletions = [...byPerson.values()];
  return {
    deletions,
    skipped,
    tagCount,
    personCount: deletions.length,
    roomCount: deadIds.size,
  };
}
