// Level change — operator-decided deletes of profile-only sections, the descendant count shown
// before such a delete, and the widget text. PURE: every call is injected.
import { withRetry } from './room-archive';
import { sectionKey, normDesc, EMPTY_DESCRIPTION, type LcNode, type LevelChangeDeps } from './level-change';

const MAX_DEPTH = 6;
const VERIFY_READS = 3;
const VERIFY_DELAY_MS = 750;

/**
 * Descendants of `id` (the section itself not counted), depth 6, nodes drawn from a budget shared
 * across calls. Never under-reports silently: a failing sub-listing, an exhausted budget or a tree
 * deeper than the limit gives exact:false (« au moins N »). The section's OWN listing failing gives
 * total null — nothing is known.
 */
export async function countDescendants(
  id: string,
  list: (id: string) => Promise<LcNode[]>,
  budget: { remaining: number },
): Promise<{ total: number | null; exact: boolean }> {
  let total = 0;
  let exact = true;
  const seen = new Set<string>([id]);

  async function walk(parent: string, depth: number): Promise<boolean> {
    let kids: LcNode[];
    try { kids = await list(parent); } catch { exact = false; return false; }
    if (depth > MAX_DEPTH) { if (kids.length > 0) exact = false; return true; }
    for (const k of kids) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      if (budget.remaining <= 0) { exact = false; return true; }
      budget.remaining--;
      total++;
      await walk(k.id, depth + 1);
    }
    return true;
  }

  if (!(await walk(id, 1))) return { total: null, exact: false };
  return { total, exact };
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
  if (targetKeys.has(sectionKey(live))) {
    return { ok: false, problem: 'section non supprimée : elle existe aussi dans le modèle cible' };
  }

  try { await withRetry(deps, () => deps.remove(item.sectionId)); } catch { /* the listing decides */ }
  for (let i = 0; i < VERIFY_READS; i++) {
    if (i > 0) await deps.sleep(VERIFY_DELAY_MS);
    try {
      const kids = await withRetry(deps, () => deps.list(profileId));
      if (!kids.some(c => c.id === item.sectionId)) return { ok: true, problem: null };
    } catch { /* retried */ }
  }
  return { ok: false, problem: 'suppression non confirmée : la section est toujours présente' };
}

/** Empty profile description → the template root's; otherwise the profile's text, then the template's. */
export function widgetDescription(profileDesc: string, templateRootDesc: string): string {
  return normDesc(profileDesc) === EMPTY_DESCRIPTION ? templateRootDesc : profileDesc + templateRootDesc;
}
