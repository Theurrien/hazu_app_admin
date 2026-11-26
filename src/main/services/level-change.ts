// Level change (CFC <-> AFP) — PURE CORE. No DB, axios or Electron import.
// Spec: docs/specs/2026-11-26-level-change-design.md
//
// Only the difference between the two levels' templates is applied to a profile; a tag the
// templates do not differ on, and any tag specific to the student, is never touched.

import type { Level, LevelChangeOutcome, LevelChangePlan, SectionChange } from '../../shared/level-change-types';
import { withRetry, failureMessage } from './room-archive';

export interface LcNode {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  tags: string[];
  icon: string | null;
  color: string | null;
}

export interface TemplateTree { ref: LcNode; children: LcNode[] }

export interface PlanInput {
  profile: LcNode;
  profileChildren: LcNode[];
  toLevel: Level;
  target: TemplateTree;
  source: TemplateTree;
  /** other student templates of the source level (same icon) besides the chosen source v3 */
  sourceOthers: TemplateTree[];
}

export const LEVEL_COLORS: Record<Level, string> = { cfc: '#1A237E', afp: '#9AD9EA' };
export const STUDENT_TEMPLATE_TAG = 'hz-config-profile-student';
export const EMPTY_DESCRIPTION = '<p><br></p>';

export function otherLevel(l: Level): Level {
  return l === 'cfc' ? 'afp' : 'cfc';
}

export function levelOfColor(color: string | null): Level | null {
  if (!color) return null;
  const c = color.trim().toLowerCase();
  if (c === LEVEL_COLORS.cfc.toLowerCase()) return 'cfc';
  if (c === LEVEL_COLORS.afp.toLowerCase()) return 'afp';
  return null;
}

function stripTitle(s: string): string {
  return (s ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** Children of the templates container tagged as student templates; the parent echo is dropped. */
export function studentTemplates(rootId: string, children: LcNode[]): LcNode[] {
  return children.filter(n => n.id && n.id !== rootId && n.tags.includes(STUDENT_TEMPLATE_TAG));
}

export function templatesFor(templates: LcNode[], icon: string | null, level: Level): LcNode[] {
  return templates.filter(t => t.icon === icon && levelOfColor(t.color) === level);
}

/** The one template whose title holds `v3` as a word, else null (none or several). */
export function pickV3(candidates: LcNode[]): string | null {
  const hits = candidates.filter(c => /\bv3\b/i.test(stripTitle(c.title)));
  return hits.length === 1 ? hits[0].id : null;
}

export function sectionKey(n: Pick<LcNode, 'title' | 'icon' | 'color'>): string {
  return `${stripTitle(n.title).toLowerCase()}|${n.icon ?? ''}|${(n.color ?? '').toLowerCase()}`;
}

// Removes whitespace between tags on purpose; the same normaliser is used for verification.
export function normDesc(html: string): string {
  const s = (html ?? '').replace(/\s+/g, ' ').trim().replace(/>\s+</g, '><');
  return s === '' || s === EMPTY_DESCRIPTION ? EMPTY_DESCRIPTION : s;
}

/** The tag without its trailing 20-character id, or null when it has none. */
export function tagFamily(tag: string): string | null {
  const m = /^(.*-)[A-Za-z0-9]{20}$/.exec(tag);
  return m ? m[1] : null;
}

/** First entry with an id wins per key. */
function sectionMap(children: LcNode[]): Map<string, LcNode> {
  const m = new Map<string, LcNode>();
  for (const c of children) {
    if (!c.id) continue;
    const k = sectionKey(c);
    if (!m.has(k)) m.set(k, c);
  }
  return m;
}

function planTags(P: LcNode, T: LcNode, S: LcNode, SA: LcNode[]): { add: string[]; remove: string[] } {
  const have = new Set(P.tags);
  const sTags = new Set(S.tags);
  const tTags = new Set(T.tags);
  const tgtDelta = [...tTags].filter(t => !sTags.has(t));
  const srcDeltaAll = [...new Set(SA.flatMap(n => n.tags))].filter(t => !tTags.has(t));
  const add = new Set<string>();
  const remove = new Set<string>();

  for (const t of tgtDelta) {
    const f = tagFamily(t);
    const counterparts = f ? srcDeltaAll.filter(s => tagFamily(s) === f) : [];
    if (counterparts.length > 0) {
      const held = counterparts.filter(s => have.has(s));
      if (held.length > 0) {
        if (!have.has(t)) add.add(t);
        held.forEach(h => remove.add(h));
      }
      // profile holds none of them (e.g. a per-student pointer): left alone
    } else if (!have.has(t)) {
      // never a second tag of a family the profile already holds (e.g. a per-student carnet)
      const heldFamily = f !== null && P.tags.some(x => tagFamily(x) === f);
      if (!heldFamily) add.add(t);
    }
  }

  const tgtFamilies = new Set(tgtDelta.map(tagFamily).filter((f): f is string => f !== null));
  // Unpaired removals come from the source v3 section only: a tag found just on an older
  // template version is a version difference, not a level difference.
  const srcOnly = S.tags.filter(t => !tTags.has(t));
  for (const s of srcOnly) {
    const f = tagFamily(s);
    if (f !== null && tgtFamilies.has(f)) continue; // paired: handled above
    if (have.has(s)) remove.add(s);
  }
  return { add: [...add], remove: [...remove] };
}

export function buildPlan(input: PlanInput): LevelChangePlan {
  const { profile, toLevel } = input;
  const fromLevel = otherLevel(toLevel);
  const prof = sectionMap(input.profileChildren);
  const tgt = sectionMap(input.target.children);
  const src = sectionMap(input.source.children);
  const others = input.sourceOthers.map(t => sectionMap(t.children));

  const sections: SectionChange[] = [];
  const templateOnly: string[] = [];
  const profileOnly: string[] = [];

  for (const [key, T] of tgt) {
    const P = prof.get(key);
    if (!P) { templateOnly.push(stripTitle(T.title)); continue; }
    const S = src.get(key);
    if (!S) continue;
    const SA = [S, ...others.map(m => m.get(key)).filter((n): n is LcNode => !!n)];

    const { add, remove } = planTags(P, T, S, SA);

    let description: SectionChange['description'] = null;
    let descriptionKept = false;
    const sD = normDesc(S.description);
    const tD = normDesc(T.description);
    if (sD !== tD) {
      const pD = normDesc(P.description);
      if (pD !== tD) {
        if (SA.some(n => normDesc(n.description) === pD)) {
          description = { from: P.description, to: tD === EMPTY_DESCRIPTION ? EMPTY_DESCRIPTION : T.description };
        } else {
          descriptionKept = true;
        }
      }
    }

    if (description || descriptionKept || add.length || remove.length) {
      sections.push({
        sectionId: P.id, title: stripTitle(P.title), description, descriptionKept,
        addTags: add, removeTags: remove,
      });
    }
  }
  for (const [key, P] of prof) if (!tgt.has(key)) profileOnly.push(stripTitle(P.title));

  const colorTo = LEVEL_COLORS[toLevel];
  return {
    profileId: profile.id,
    fromLevel, toLevel,
    colorFrom: (profile.color ?? '').toUpperCase(),
    colorTo,
    colorChange: (profile.color ?? '').toLowerCase() !== colorTo.toLowerCase(),
    templates: [
      { id: input.target.ref.id, title: stripTitle(input.target.ref.title), role: 'target' },
      { id: input.source.ref.id, title: stripTitle(input.source.ref.title), role: 'source' },
      ...input.sourceOthers.map(t => ({ id: t.ref.id, title: stripTitle(t.ref.title), role: 'source-other' as const })),
    ],
    sections, profileOnly, templateOnly,
  };
}

// ---------------------------------------------------------------------------------------------
// Orchestrator. All IO injected. The live read decides, never the status code.

export interface LevelChangeDeps {
  /** null only on 404 */
  read(id: string): Promise<LcNode | null>;
  /** throws on failure; parent echo removed */
  list(parentId: string): Promise<LcNode[]>;
  updateDescription(id: string, html: string): Promise<void>;
  updateColor(id: string, hex: string): Promise<void>;
  addTags(id: string, tags: string[]): Promise<void>;
  removeTags(id: string, tags: string[]): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface LevelChangeInput {
  profileId: string;
  toLevel: Level;
  targetTemplateId: string;
  templateRootId: string;
  dryRun: boolean;
}

const VERIFY_READS = 3;
const VERIFY_DELAY_MS = 750;

function sectionConfirmation(c: SectionChange, live: LcNode | undefined): { tags: boolean; description: boolean } {
  if (!live) return { tags: false, description: false };
  const tags = c.addTags.every(t => live.tags.includes(t)) && c.removeTags.every(t => !live.tags.includes(t));
  const description = !c.description || normDesc(live.description) === normDesc(c.description.to);
  return { tags, description };
}

export async function runLevelChange(input: LevelChangeInput, deps: LevelChangeDeps): Promise<LevelChangeOutcome> {
  const refuse = (error: string, plan: LevelChangePlan | null = null): LevelChangeOutcome =>
    ({ success: false, dryRun: input.dryRun, plan, applied: 0, remaining: [], error });
  const EMPTY = "liste vide — rien n'a été écrit";

  let plan: LevelChangePlan;
  try {
    const profile = await withRetry(deps, () => deps.read(input.profileId));
    if (!profile) return refuse('profil introuvable');
    const current = levelOfColor(profile.color);
    if (!current) return refuse('niveau du profil non reconnu (couleur inattendue)');

    const rootChildren = await withRetry(deps, () => deps.list(input.templateRootId));
    const templates = studentTemplates(input.templateRootId, rootChildren);
    const targets = templatesFor(templates, profile.icon, input.toLevel);
    const targetRef = targets.find(t => t.id === input.targetTemplateId);
    if (!targetRef) return refuse('modèle cible invalide pour ce profil');

    const fromTemplates = templatesFor(templates, profile.icon, otherLevel(input.toLevel));
    const sourceId = pickV3(fromTemplates);
    if (!sourceId) return refuse('modèle source introuvable (aucun v3 unique)');
    const sourceRef = fromTemplates.find(t => t.id === sourceId)!;
    const otherRefs = fromTemplates.filter(t => t.id !== sourceId);

    const listNonEmpty = async (id: string): Promise<LcNode[] | null> => {
      const kids = await withRetry(deps, () => deps.list(id));
      return kids.length === 0 ? null : kids;
    };
    const profileChildren = await listNonEmpty(profile.id);
    const targetChildren = await listNonEmpty(targetRef.id);
    const sourceChildren = await listNonEmpty(sourceRef.id);
    const otherChildren: Array<LcNode[] | null> = [];
    for (const o of otherRefs) otherChildren.push(await listNonEmpty(o.id));
    if (!profileChildren || !targetChildren || !sourceChildren || otherChildren.some(c => c === null)) {
      return refuse(EMPTY);
    }

    plan = buildPlan({
      profile, profileChildren, toLevel: input.toLevel,
      target: { ref: targetRef, children: targetChildren },
      source: { ref: sourceRef, children: sourceChildren },
      sourceOthers: otherRefs.map((o, i) => ({ ref: o, children: otherChildren[i]! })),
    });
  } catch (e) {
    return refuse(`lecture impossible : ${failureMessage(e)} — rien n'a été écrit`);
  }

  if (input.dryRun) return { success: true, dryRun: true, plan, applied: 0, remaining: [] };

  const changes = plan.sections.filter(s => s.description || s.addTags.length || s.removeTags.length);
  if (changes.length === 0 && !plan.colorChange) {
    return { success: true, dryRun: false, plan, applied: 0, remaining: [] };
  }

  // Write sections: failures are kept, not fatal — only the live read decides.
  for (const c of changes) {
    const attempt = async (fn: () => Promise<void>) => {
      try { await withRetry(deps, fn); } catch { /* verified below */ }
    };
    if (c.removeTags.length) await attempt(() => deps.removeTags(c.sectionId, c.removeTags));
    if (c.addTags.length) await attempt(() => deps.addTags(c.sectionId, c.addTags));
    if (c.description) await attempt(() => deps.updateDescription(c.sectionId, c.description!.to));
  }

  // Verify sections against the re-listed profile.
  let lastLive: LcNode[] = [];
  let sectionsOk = false;
  for (let i = 0; i < VERIFY_READS && !sectionsOk; i++) {
    if (i > 0) await deps.sleep(VERIFY_DELAY_MS);
    try {
      lastLive = await withRetry(deps, () => deps.list(plan.profileId));
    } catch { continue; }
    sectionsOk = changes.every(c => {
      const r = sectionConfirmation(c, lastLive.find(n => n.id === c.sectionId));
      return r.tags && r.description;
    });
  }

  const remaining: string[] = [];
  let applied = 0;
  for (const c of changes) {
    const r = sectionConfirmation(c, lastLive.find(n => n.id === c.sectionId));
    if (r.tags && r.description) { applied++; continue; }
    if (!r.tags) remaining.push(`« ${c.title} » : étiquettes non confirmées`);
    if (!r.description) remaining.push(`« ${c.title} » : description non confirmée`);
  }
  if (!sectionsOk) return { success: false, dryRun: false, plan, applied, remaining };

  // Colour last: it is what marks the profile as changed, so it only moves once every section holds.
  if (plan.colorChange) {
    try { await withRetry(deps, () => deps.updateColor(plan.profileId, plan.colorTo)); } catch { /* verified below */ }
    let colorOk = false;
    for (let i = 0; i < VERIFY_READS && !colorOk; i++) {
      if (i > 0) await deps.sleep(VERIFY_DELAY_MS);
      try {
        const p = await withRetry(deps, () => deps.read(plan.profileId));
        colorOk = !!p && (p.color ?? '').toLowerCase() === plan.colorTo.toLowerCase();
      } catch { /* retry */ }
    }
    if (colorOk) applied++; else remaining.push('couleur du profil non confirmée');
  }
  return { success: remaining.length === 0, dryRun: false, plan, applied, remaining };
}
