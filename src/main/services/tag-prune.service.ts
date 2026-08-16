import axios from 'axios';
import { getDb } from '../database';
import { sendApiRequestRead, sendApiRequestRemoveTagsChecked } from './hazu-api/api';
import { collectUnmatchedClassIds } from './discrepancy';
import { loadDiscrepancyInput, safeParseTags } from './discrepancy.service';
import {
  buildPrunePlan,
  probeClassIds,
  runTagPrune,
  PruneItem,
  PrunePlan,
  ReadOutcome,
  SkippedId,
  TagPruneDeps,
} from './tag-prune';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Read one item, classifying the failure so the pure core's retry predicate can work.
// sendApiRequestRead rethrows, so the classification happens here. The response body is
// { snapshot: { ... } } — verified live; the function has no other caller in the codebase.
async function readItem(classId: string): Promise<ReadOutcome> {
  try {
    const data = await sendApiRequestRead(classId);
    const snapshot = data?.snapshot ?? {};
    return {
      ok: true,
      networkOrTimeout: false,
      snapshot: { title: snapshot.title, parentId: snapshot.parentId },
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      return {
        ok: false,
        status: error.response?.status,
        networkOrTimeout:
          !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT',
      };
    }
    return { ok: false, networkOrTimeout: false };
  }
}

// A profile's tags as Hazu currently has them, or null if they could not be read. null means
// "cannot verify" and is never treated as "the tags are gone".
async function readPersonTags(personId: string): Promise<string[] | null> {
  try {
    const data = await sendApiRequestRead(personId);
    const tags = data?.snapshot?.tags;
    return Array.isArray(tags) ? tags.filter((t: unknown): t is string => typeof t === 'string') : [];
  } catch {
    return null;
  }
}

/**
 * What would be pruned. Probes every unmatched class id live, so the confirmation modal reports
 * the state of Hazu now rather than a cached guess.
 *
 * Unlike S6's planOrphanRemoval, this does NOT throw when a read fails. That is deliberate: S6's
 * plan enumerates what will be destroyed, so an unreadable ACL means the modal might
 * under-promise. Here an unreadable id only ever REMOVES work from the delete set, so one flaky
 * read must not block pruning every other confirmed-dead room. It is reported as a skip instead.
 * Only a failure to load the discrepancy input propagates.
 */
export async function planTagPrune(): Promise<PrunePlan> {
  const ids = collectUnmatchedClassIds(loadDiscrepancyInput());
  const verdicts = await probeClassIds(ids.map((i) => i.classId), { readItem, sleep });
  const plan = buildPrunePlan(ids, verdicts);

  console.log(
    `[tag-prune] plan: ${ids.length} id(s) probed — ${plan.tagCount} tag(s) across ` +
    `${plan.personCount} person(s) in ${plan.roomCount} room(s) to delete, ` +
    `${plan.skipped.length} skipped`,
  );

  return plan;
}

/**
 * Delete one person's dead breadcrumb tags, then confirm it against a fresh profile read.
 * The core re-probes this person's own class ids first — the plan the operator confirmed
 * authorises nothing.
 */
export async function pruneDeadTags(
  personId: string,
  items: PruneItem[],
): Promise<{ success: boolean; error?: string; deletedTags: string[]; skippedClassIds: SkippedId[] }> {
  const deps: TagPruneDeps = {
    probe: readItem,
    removeTags: (id, tags) => sendApiRequestRemoveTagsChecked(id, tags),
    readPersonTags,
    sleep,
  };

  const outcome = await runTagPrune({ personId, items }, deps);

  console.log(
    `[tag-prune] person=${personId}: success=${outcome.success} ` +
    `deleted=${outcome.deletedTags.length} skipped=${outcome.skippedClassIds.length} ` +
    `deleteOk=${outcome.deleteOk} verifyRan=${outcome.verifyRan} verified=${outcome.verified} ` +
    `surviving=[${outcome.surviving.join(',')}] attempts=${outcome.attempts}` +
    (outcome.error ? ` error=${outcome.error}` : ''),
  );

  // Reconcile local persons.tags from truth — only the tags confirmed gone are dropped.
  // Its own try/catch so a SQLite failure cannot flip a real API success.
  if (outcome.deletedTags.length > 0) {
    try {
      const db = getDb();
      const row = db.prepare('SELECT tags FROM persons WHERE id = ?').get(personId) as
        | { tags: string | null }
        | undefined;
      if (row) {
        const gone = new Set(outcome.deletedTags);
        const kept = safeParseTags(row.tags).filter((t) => !gone.has(t));
        db.prepare('UPDATE persons SET tags = ? WHERE id = ?').run(JSON.stringify(kept), personId);
      }
    } catch (err) {
      console.error('[tag-prune] local reconcile failed for', personId, err);
    }
  }

  return {
    success: outcome.success,
    error: outcome.error,
    deletedTags: outcome.deletedTags,
    skippedClassIds: outcome.skippedClassIds,
  };
}
