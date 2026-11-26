// Level change — operator-decided deletes of profile-only sections, the descendant count shown
// before such a delete, and the widget text. PURE: every call is injected.
import { withRetry } from './room-archive';
import { sectionKey, normDesc, EMPTY_DESCRIPTION, type LcNode, type LevelChangeDeps } from './level-change';

const MAX_DEPTH = 6;
const VERIFY_READS = 3;
const VERIFY_DELAY_MS = 750;

/**
 * Descendants of `id` (the section itself not counted), depth 6, nodes drawn from a budget shared
 * across calls. `list` must be STRICT (an unexpected response shape throws, never reads as empty).
 * Never under-reports silently: a failing sub-listing, an exhausted budget or a tree deeper than
 * the limit gives exact:false (« au moins N »). The section's OWN listing failing gives total null —
 * nothing is known — and so does an own listing that is still empty after one re-read: an empty
 * listing is never proof of absence, and an irreversible delete must never show an exact « 0 ».
 */
export async function countDescendants(
  id: string,
  list: (id: string) => Promise<{ id: string }[]>,
  budget: { remaining: number },
  sleep?: (ms: number) => Promise<void>,
): Promise<{ total: number | null; exact: boolean }> {
  let total = 0;
  let exact = true;
  const seen = new Set<string>([id]);
  const listOnce = (parent: string) => (sleep ? withRetry({ sleep }, () => list(parent)) : list(parent));

  async function walk(parent: string, depth: number, kids: { id: string }[] | null): Promise<void> {
    if (kids === null) {
      try { kids = await listOnce(parent); } catch { exact = false; return; }
    }
    if (depth > MAX_DEPTH) { if (kids.length > 0) exact = false; return; }
    for (const k of kids) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      if (budget.remaining <= 0) { exact = false; return; }
      budget.remaining--;
      total++;
      await walk(k.id, depth + 1, null);
    }
  }

  let own: { id: string }[];
  try {
    own = await listOnce(id);
    if (own.length === 0) {
      if (sleep) await sleep(VERIFY_DELAY_MS);
      own = await listOnce(id);
    }
  } catch {
    return { total: null, exact: false };
  }
  if (own.length === 0) return { total: null, exact: false };
  await walk(id, 1, own);
  return { total, exact };
}

/**
 * Remove a node, then confirm it is gone: the parent's listing no longer holds it AND a read of the
 * node answers null (404 only). An empty or truncated listing is never proof of absence; a status
 * code is not either. Shared with the copy walk.
 */
export async function removeConfirmed(
  deps: {
    sleep(ms: number): Promise<void>;
    remove(id: string): Promise<void>;
    list(parentId: string): Promise<{ id: string }[]>;
    read(id: string): Promise<unknown | null>;
  },
  parentId: string,
  id: string,
): Promise<boolean> {
  try { await withRetry(deps, () => deps.remove(id)); } catch { /* the live read decides */ }
  for (let i = 0; i < VERIFY_READS; i++) {
    if (i > 0) await deps.sleep(VERIFY_DELAY_MS);
    try {
      const kids = await withRetry(deps, () => deps.list(parentId));
      if (kids.some(c => c.id === id)) continue;
      if ((await withRetry(deps, () => deps.read(id))) === null) return true;
    } catch { /* retried */ }
  }
  return false;
}

/**
 * Remove a profile-only section the operator ticked. The node is re-read first: it must still be a
 * direct child of the profile and still profile-only (its key not among the target's). The live
 * listing of the profile decides success, never the status code. A node already gone is the
 * operator's intent: ok, nothing written.
 */
export async function deleteSection(
  profileId: string,
  item: { sectionKey: string; sectionId: string },
  targetKeys: Set<string>,
  deps: Pick<LevelChangeDeps, 'read' | 'list' | 'sleep'> & { remove(id: string): Promise<void> },
): Promise<{ ok: boolean; problem: string | null }> {
  let live: LcNode | null;
  try {
    live = await withRetry(deps, () => deps.read(item.sectionId));
  } catch (e) {
    return { ok: false, problem: `section illisible avant suppression : ${(e as Error)?.message ?? 'erreur'}` };
  }
  if (live === null) return { ok: true, problem: null };
  if (live.parentId !== profileId) {
    return { ok: false, problem: 'section non supprimée : elle n’est plus directement dans le profil' };
  }
  if (sectionKey(live) !== item.sectionKey) {
    return { ok: false, problem: 'section modifiée depuis l\'aperçu' };
  }
  if (targetKeys.has(sectionKey(live))) {
    return { ok: false, problem: 'section non supprimée : elle existe aussi dans le modèle cible' };
  }

  if (await removeConfirmed(deps, profileId, item.sectionId)) return { ok: true, problem: null };
  return { ok: false, problem: 'suppression non confirmée : la section est toujours présente' };
}

/** Empty profile description → the template root's; otherwise the profile's text, then the template's. */
export function widgetDescription(profileDesc: string, templateRootDesc: string): string {
  return normDesc(profileDesc) === EMPTY_DESCRIPTION ? templateRootDesc : profileDesc + templateRootDesc;
}
