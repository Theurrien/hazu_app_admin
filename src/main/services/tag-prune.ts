/**
 * Dead-tag pruning: pure core.
 *
 * No DB, no HTTP, no Electron — every side effect is injected, so the whole decision layer runs
 * under vitest without the native module or the network. tag-prune.service.ts supplies the real IO.
 *
 * The rule this file exists to enforce: only an explicit 404 authorises deleting a tag.
 */

import { isRetryableError, backoffMs } from './role-write';

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

export interface ProbeDeps {
  // One GET /read attempt, with its failure already classified.
  readItem: (classId: string) => Promise<ReadOutcome>;
  sleep: (ms: number) => Promise<void>;
}

export interface ProbeConfig {
  maxReadAttempts?: number;
}

const DEFAULT_PROBE_CFG = { maxReadAttempts: 3 };

/**
 * Probe every id, retrying transient failures only. Sequential on purpose: the sweep is small,
 * and hammering an API we are about to delete against buys nothing.
 *
 * One id's failure never aborts the sweep — a reader that throws instead of classifying is
 * still just an unread, and the remaining ids are probed regardless.
 */
export async function probeClassIds(
  ids: readonly string[],
  deps: ProbeDeps,
  cfg: ProbeConfig = {},
): Promise<Map<string, Verdict>> {
  const { maxReadAttempts } = { ...DEFAULT_PROBE_CFG, ...cfg };
  const out = new Map<string, Verdict>();

  for (const classId of ids) {
    let verdict: Verdict = { verdict: 'unreadable', title: null, parentId: null };

    for (let i = 0; i < maxReadAttempts; i++) {
      let res: ReadOutcome;
      try {
        res = await deps.readItem(classId);
      } catch {
        res = { ok: false, networkOrTimeout: true };
      }
      verdict = classifyReadResult(res);

      // A 404 is deterministic: isRetryableError says no, so this breaks on the first read.
      if (res.ok || !isRetryableError(res.status, res.networkOrTimeout)) break;
      if (i < maxReadAttempts - 1) await deps.sleep(backoffMs(i));
    }

    out.set(classId, verdict);
  }

  return out;
}

export interface TagPruneDeps {
  probe: (classId: string) => Promise<ReadOutcome>;
  // One DELETE attempt; classifies its own failure for the retry predicate.
  removeTags: (
    personId: string,
    tags: string[],
  ) => Promise<{ ok: boolean; status?: number; networkOrTimeout: boolean; error?: string }>;
  // The profile's current tags, or null if they could not be read.
  readPersonTags: (personId: string) => Promise<string[] | null>;
  sleep: (ms: number) => Promise<void>;
}

export interface TagPruneConfig {
  maxReadAttempts?: number;
  maxDeleteAttempts?: number;
  maxVerifyReads?: number;
  verifyDelayMs?: number;
}

export interface TagPruneOutcome {
  success: boolean;
  deletedTags: string[];
  skippedClassIds: SkippedId[];
  surviving: string[];
  deleteOk: boolean;
  verifyRan: boolean;
  verified: boolean;
  attempts: number;
  error?: string;
}

const DEFAULT_PRUNE_CFG = {
  maxReadAttempts: 3,
  maxDeleteAttempts: 3,
  maxVerifyReads: 3,
  verifyDelayMs: 750,
};

/**
 * Remove one person's dead breadcrumb tags, then confirm it against a fresh profile read.
 * All IO injected.
 *
 * Step 1 is the authorisation: the plan the operator confirmed does not license anything, so
 * this re-probes the ids in its OWN payload. That can only ever shrink the delete set.
 */
export async function runTagPrune(
  target: PruneDeletion,
  deps: TagPruneDeps,
  cfg: TagPruneConfig = {},
): Promise<TagPruneOutcome> {
  const c = { ...DEFAULT_PRUNE_CFG, ...cfg };

  // 1. Re-probe this task's own ids. Only a fresh 404 authorises a deletion.
  const verdicts = await probeClassIds(
    target.items.map((i) => i.classId),
    { readItem: deps.probe, sleep: deps.sleep },
    { maxReadAttempts: c.maxReadAttempts },
  );

  const confirmed: PruneItem[] = [];
  const skippedClassIds: SkippedId[] = [];
  for (const item of target.items) {
    const v = verdicts.get(item.classId);
    const verdict: RoomVerdict = v?.verdict ?? 'unreadable';
    if (verdict === 'deleted') {
      confirmed.push(item);
      continue;
    }
    skippedClassIds.push({
      classId: item.classId,
      verdict,
      reason: SKIP_REASON[verdict],
      title: v?.title ?? null,
      parentId: v?.parentId ?? null,
      tagCount: item.tags.length,
    });
  }

  const tags = confirmed.flatMap((i) => i.tags);
  if (tags.length === 0) {
    // Nothing re-confirmed. Not a failure: nothing went wrong, and nothing was deleted.
    return {
      success: true,
      deletedTags: [],
      skippedClassIds,
      surviving: [],
      deleteOk: true,
      verifyRan: false,
      verified: false,
      attempts: 0,
    };
  }

  // 2. One DELETE for all of this person's confirmed-dead tags, retrying transient failures.
  let attempts = 0;
  let deleteOk = false;
  let lastError: string | undefined;
  for (let i = 0; i < c.maxDeleteAttempts; i++) {
    attempts += 1;
    const r = await deps.removeTags(target.personId, tags);
    if (r.ok) {
      deleteOk = true;
      break;
    }
    lastError = r.error;
    if (!isRetryableError(r.status, r.networkOrTimeout) || i === c.maxDeleteAttempts - 1) break;
    await deps.sleep(backoffMs(i));
  }

  // 3. Verify against a fresh profile read, re-reading through cache lag. This runs even after
  //    a failed delete: measured in S4, a transport failure carries no information about
  //    whether the write committed — only the read does.
  let surviving: string[] | null = null;
  for (let i = 0; i < c.maxVerifyReads; i++) {
    const current = await deps.readPersonTags(target.personId);
    if (current === null) break; // cannot verify
    const present = new Set(current);
    surviving = tags.filter((t) => present.has(t));
    if (surviving.length === 0) break;
    if (i < c.maxVerifyReads - 1) await deps.sleep(c.verifyDelayMs);
  }

  // 4. Truth unreadable: fall back to the delete status code.
  if (surviving === null) {
    return {
      success: deleteOk,
      deletedTags: deleteOk ? tags : [],
      skippedClassIds,
      surviving: [],
      deleteOk,
      verifyRan: false,
      verified: false,
      attempts,
      error: deleteOk ? undefined : lastError,
    };
  }

  // 5. Truth decides, in both directions.
  const stillThere = surviving;
  const verified = stillThere.length === 0;
  return {
    success: verified,
    deletedTags: tags.filter((t) => !stillThere.includes(t)),
    skippedClassIds,
    surviving: stillThere,
    deleteOk,
    verifyRan: true,
    verified,
    attempts,
    error: verified
      ? undefined
      : `${stillThere.length} tag(s) still present after the delete: ${stillThere.join(', ')}`,
  };
}
