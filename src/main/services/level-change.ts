// Level change (CFC <-> AFP) — PURE CORE. No DB, axios or Electron import.
// Spec: docs/specs/2026-11-26-level-change-design.md
//
// Only the difference between the two levels' templates is applied to a profile; a tag the
// templates do not differ on, and any tag specific to the student, is never touched.

import type { Level, LevelChangeOutcome, LevelChangePlan, SectionChange, StudentUnknown } from '../../shared/level-change-types';
import { isWidgetPresent, type LevelChangeDecisions } from '../../shared/level-change-decisions';
import { withRetry, failureMessage } from './room-archive';
// Runtime cycle with these two modules is safe: each only calls the other's functions at call time.
import { copySection, type CopyDeps } from './level-change-copy';
import { countDescendants, deleteSection, widgetDescription } from './level-change-extra';

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
export const TEMPLATE_REFUSAL = 'ce nœud est un modèle — refusé';

/** A node is a template when it sits in the templates folder (or is that folder itself). */
export function isTemplateNode(node: Pick<LcNode, 'id' | 'parentId'>, templateRootId: string): boolean {
  return node.id === templateRootId || node.parentId === templateRootId;
}
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

export function stripTitle(s: string): string {
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

function holdsFamily(P: LcNode, f: string | null): boolean {
  return f !== null && P.tags.some(x => tagFamily(x) === f);
}

function planTags(P: LcNode, T: LcNode, S: LcNode, SA: LcNode[]): { add: string[]; remove: string[]; uncertain: string[] } {
  const have = new Set(P.tags);
  const sTags = new Set(S.tags);
  const tTags = new Set(T.tags);
  const tgtDelta = [...tTags].filter(t => !sTags.has(t));
  const srcDeltaAll = [...new Set(SA.flatMap(n => n.tags))].filter(t => !tTags.has(t));
  const add = new Set<string>();
  const remove = new Set<string>();
  // family-absent adds: the tag points at the template's object, not one of the student's
  const uncertain = new Set<string>();

  for (const t of tgtDelta) {
    const f = tagFamily(t);
    const counterparts = f ? srcDeltaAll.filter(s => tagFamily(s) === f) : [];
    if (counterparts.length > 0) {
      const held = counterparts.filter(s => have.has(s));
      if (held.length > 0) {
        if (!have.has(t)) add.add(t);
        held.forEach(h => remove.add(h));
      } else if (!have.has(t) && !holdsFamily(P, f)) {
        // no tag of the family at all (e.g. an earlier run removed the source tag and the
        // addition never landed): the target tag is added
        add.add(t);
        uncertain.add(t);
      }
      // otherwise the profile holds another tag of the family (e.g. a per-student pointer): left alone
    } else if (!have.has(t)) {
      // never a second tag of a family the profile already holds (e.g. a per-student carnet)
      if (!holdsFamily(P, f)) {
        add.add(t);
        if (f !== null) uncertain.add(t); // an id-less tag only on the target stays certain
      }
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
  return { add: [...add], remove: [...remove], uncertain: [...uncertain] };
}

export function buildPlan(input: PlanInput): LevelChangePlan {
  const { profile, toLevel } = input;
  const fromLevel = otherLevel(toLevel);
  const prof = sectionMap(input.profileChildren);
  const tgt = sectionMap(input.target.children);
  const src = sectionMap(input.source.children);
  const others = input.sourceOthers.map(t => sectionMap(t.children));

  const sections: SectionChange[] = [];
  const templateOnlyItems: LevelChangePlan['templateOnlyItems'] = [];
  const profileOnlyItems: LevelChangePlan['profileOnlyItems'] = [];
  const noSourceCounterpart: string[] = [];

  for (const [key, T] of tgt) {
    const P = prof.get(key);
    if (!P) {
      templateOnlyItems.push({ sectionKey: key, title: stripTitle(T.title), templateSectionId: T.id });
      continue;
    }
    const S = src.get(key);
    if (!S) { noSourceCounterpart.push(stripTitle(P.title)); continue; }
    const SA = [S, ...others.map(m => m.get(key)).filter((n): n is LcNode => !!n)];

    const { add, remove, uncertain } = planTags(P, T, S, SA);

    let description: SectionChange['description'] = null;
    let descriptionKept = false;
    let keptTargetDescription: string | null = null;
    const sD = normDesc(S.description);
    const tD = normDesc(T.description);
    if (sD !== tD) {
      const pD = normDesc(P.description);
      if (pD !== tD) {
        if (SA.some(n => normDesc(n.description) === pD)) {
          description = { from: P.description, to: tD === EMPTY_DESCRIPTION ? EMPTY_DESCRIPTION : T.description };
        } else {
          descriptionKept = true;
          keptTargetDescription = tD === EMPTY_DESCRIPTION ? EMPTY_DESCRIPTION : T.description;
        }
      }
    }

    if (description || descriptionKept || add.length || remove.length) {
      sections.push({
        sectionId: P.id, sectionKey: key, title: stripTitle(P.title), description, descriptionKept,
        addTags: add, removeTags: remove, uncertainTags: uncertain, keptTargetDescription,
      });
    }
  }
  for (const [key, P] of prof) {
    if (tgt.has(key)) continue;
    // descendants are counted by a later step
    profileOnlyItems.push({ sectionKey: key, title: stripTitle(P.title), sectionId: P.id, descendants: null, descendantsExact: false });
  }

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
    sections, noSourceCounterpart,
    templateOnlyItems, profileOnlyItems,
    widget: {
      needed: isWidgetPresent(input.target.ref.description) && !isWidgetPresent(profile.description),
      profileEmpty: normDesc(profile.description) === EMPTY_DESCRIPTION,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Orchestrator. All IO injected. The live read decides, never the status code.

export interface LevelChangeBaseDeps {
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

/** One deps object: the section/colour writes, the copy walk (with access) and the delete. */
export type LevelChangeDeps = LevelChangeBaseDeps & CopyDeps & { remove(id: string): Promise<void> };

export interface LevelChangeInput {
  profileId: string;
  toLevel: Level;
  targetTemplateId: string;
  templateRootId: string;
  dryRun: boolean;
  /** required when dryRun is false; a dry run ignores it */
  decisions?: LevelChangeDecisions;
  /** role-group groupId → role (from distribution_groups), for the access alignment of copies */
  roleGroups: Map<string, string>;
  /** the student's account id; null = identity unresolved (invite grants then stay unconfirmed) */
  studentId: string | null;
  /** why studentId is null (named in the report) */
  studentUnknown?: StudentUnknown | null;
}

const VERIFY_READS = 3;
const VERIFY_DELAY_MS = 750;

/** What this run actually writes to one section, after the decisions. */
interface Write { sectionId: string; title: string; addTags: string[]; removeTags: string[]; descriptionTo: string | null }

function sectionConfirmation(c: Write, live: LcNode | undefined): { tags: boolean; description: boolean } {
  if (!live) return { tags: false, description: false };
  const tags = c.addTags.every(t => live.tags.includes(t)) && c.removeTags.every(t => !live.tags.includes(t));
  const description = c.descriptionTo === null || normDesc(live.description) === normDesc(c.descriptionTo);
  return { tags, description };
}

/** Shown for an item the operator did not tick, or that the preview never showed. */
export const NOT_TICKED = "non coché ou non vu à l'aperçu — ignoré";

/**
 * A section's display title for a report line: from the live plan when it still knows the key,
 * else the title part of the key (lower-cased, as in the key).
 */
function titleOf(plan: LevelChangePlan, key: string): string {
  const known = plan.sections.find(s => s.sectionKey === key)
    ?? plan.templateOnlyItems.find(s => s.sectionKey === key)
    ?? plan.profileOnlyItems.find(s => s.sectionKey === key);
  if (known) return known.title;
  const i = key.indexOf('|');
  return i < 0 ? key : key.slice(0, i);
}

/** Apply the decisions to the live plan: what is written, and what is skipped or without object. */
function applyDecisions(plan: LevelChangePlan, d: LevelChangeDecisions): { writes: Write[]; ignored: string[] } {
  const writes: Write[] = [];
  const ignored: string[] = [];
  const accepted = new Set(d.acceptedTagAdds.map(a => `${a.sectionKey}\u0000${a.tag}`));
  const forced = new Set(d.forcedDescriptions);
  const seenTags = new Set<string>();
  const seenForceable = new Set<string>();

  for (const c of plan.sections) {
    const uncertain = new Set(c.uncertainTags);
    const addTags: string[] = [];
    for (const t of c.addTags) {
      if (!uncertain.has(t)) { addTags.push(t); continue; }
      const k = `${c.sectionKey}\u0000${t}`;
      seenTags.add(k);
      if (accepted.has(k)) addTags.push(t);
      else ignored.push(`« ${c.title} » : étiquette ${t} — ${NOT_TICKED}`);
    }
    let descriptionTo: string | null = c.description ? c.description.to : null;
    if (c.descriptionKept && c.keptTargetDescription !== null) {
      seenForceable.add(c.sectionKey);
      if (forced.has(c.sectionKey)) descriptionTo = c.keptTargetDescription;
    }
    if (addTags.length || c.removeTags.length || descriptionTo !== null) {
      writes.push({ sectionId: c.sectionId, title: c.title, addTags, removeTags: c.removeTags, descriptionTo });
    }
  }
  for (const a of d.acceptedTagAdds) {
    if (!seenTags.has(`${a.sectionKey}\u0000${a.tag}`)) ignored.push(`« ${titleOf(plan, a.sectionKey)} » : étiquette ${a.tag} — décision sans objet — ignorée`);
  }
  for (const k of d.forcedDescriptions) {
    if (!seenForceable.has(k)) ignored.push(`« ${titleOf(plan, k)} » : description — décision sans objet — ignorée`);
  }
  return { writes, ignored };
}

/** The actions this run takes after the section writes, chosen from the live plan. */
interface Actions {
  copies: LevelChangePlan['templateOnlyItems'];
  deletes: LevelChangePlan['profileOnlyItems'];
  widget: boolean;
}

/** Only what the live plan still holds AND the operator ticked; everything else is reported. */
function selectActions(plan: LevelChangePlan, d: LevelChangeDecisions): { actions: Actions; ignored: string[] } {
  const ignored: string[] = [];
  const tick = new Set(d.copySections);
  const copies = plan.templateOnlyItems.filter(i => tick.has(i.sectionKey));
  for (const i of plan.templateOnlyItems) {
    if (!tick.has(i.sectionKey)) ignored.push(`« ${i.title} » : copie — ${NOT_TICKED}`);
  }
  const live = new Set(plan.templateOnlyItems.map(i => i.sectionKey));
  for (const k of new Set(d.copySections)) {
    if (!live.has(k)) ignored.push(`« ${titleOf(plan, k)} » : copie — décision sans objet — ignorée`);
  }
  // a delete needs both the key and the id of a live profile-only section: never another one
  const deletes: Actions['deletes'] = [];
  for (const x of d.deleteSections) {
    const item = plan.profileOnlyItems.find(i => i.sectionKey === x.sectionKey && i.sectionId === x.sectionId);
    if (!item) ignored.push(`« ${titleOf(plan, x.sectionKey)} » : suppression — décision sans objet — ignorée`);
    else if (!deletes.includes(item)) deletes.push(item);
  }
  let widget = false;
  if (plan.widget.needed) {
    if (d.addWidget) widget = true;
    else ignored.push(`widget : ${NOT_TICKED}`);
  } else if (d.addWidget) {
    ignored.push('widget : décision sans objet — ignorée');
  }
  return { actions: { copies, deletes, widget }, ignored };
}

const DUPLICATE_REMOVED_NOTE = 'doublon de la copie supprimé';
const ACCESS_PROBLEM = /^accès non confirmés : « (.*) »$/;
/**
 * The copy is kept with its access unconfirmed. A re-run does not repair it: the section then
 * exists in the profile, is no longer template-only, and existing sections' access is out of scope.
 */
const STUDENT_UNKNOWN_WHY: Record<StudentUnknown, string> = {
  absent: "élève introuvable dans l'accès du profil : ajoutez l'élève au profil, puis réglez l'accès à la main",
  ambiguous: "plusieurs comptes portent l'adresse de l'élève dans l'accès du profil : réglez l'accès à la main",
  unreadable: "accès du profil illisible, l'élève n'a pas pu être identifié : réglez l'accès à la main",
  'no-identity': "profil sans étiquette d'identité (hz-config-userid) : réglez l'accès à la main",
};

function accessLine(
  sectionTitle: string, nodeTitle: string, studentId: string | null, unknown: StudentUnknown | null | undefined,
): string {
  const node = nodeTitle !== sectionTitle ? ` (élément « ${nodeTitle} »)` : '';
  // without the student's account nothing was changed on the copy (R12): say so, why, and what to do
  const why = studentId !== null
    ? 'à corriger à la main'
    : unknown ? STUDENT_UNKNOWN_WHY[unknown] : "élève non identifié : réglez l'accès à la main";
  return `accès non confirmé sur « ${sectionTitle} »${node} — ${why} (une nouvelle exécution ne le refait pas)`;
}

const hasActions = (a: Actions) => a.copies.length > 0 || a.deletes.length > 0 || a.widget;

/**
 * Copies (+ access), deletes, widget — independent of each other, so all are attempted; each is
 * confirmed by its own live read. `applied` counts the confirmed ones.
 */
async function runActions(
  a: Actions, ctx: {
    profile: LcNode; targetRootDescription: string; targetKeys: Set<string>;
    roleGroups: Map<string, string>; studentId: string | null; studentUnknown?: StudentUnknown | null;
  }, deps: LevelChangeDeps,
): Promise<{ applied: number; remaining: string[]; notes: string[] }> {
  const remaining: string[] = [];
  const notes: string[] = [];
  let applied = 0;
  const profileId = ctx.profile.id;

  for (const c of a.copies) {
    const r = await copySection(c.templateSectionId, profileId, deps, ctx.roleGroups, ctx.studentId);
    const failures: string[] = [];
    for (const p of r.problems) {
      const access = ACCESS_PROBLEM.exec(p);
      if (p === DUPLICATE_REMOVED_NOTE) notes.push(`« ${c.title} » : ${p}`); // informational, never a failure
      else if (r.ok) notes.push(`« ${c.title} » : ${p}`);
      else if (access) failures.push(accessLine(c.title, access[1], ctx.studentId, ctx.studentUnknown));
      else failures.push(`« ${c.title} » : ${p}`);
    }
    if (r.ok) { applied++; continue; }
    remaining.push(...(failures.length ? failures : [`« ${c.title} » : copie non confirmée`]));
  }

  for (const x of a.deletes) {
    const r = await deleteSection(profileId, x, ctx.targetKeys, deps);
    if (r.ok) applied++;
    else remaining.push(`« ${x.title} » : ${r.problem ?? 'suppression non confirmée'}`);
  }

  if (a.widget) {
    // Built from the plan-time profile description: valid because no earlier step writes the profile's own description.
    const html = widgetDescription(ctx.profile.description, ctx.targetRootDescription);
    try { await withRetry(deps, () => deps.updateDescription(profileId, html)); } catch { /* verified below */ }
    let ok = false;
    for (let i = 0; i < VERIFY_READS && !ok; i++) {
      if (i > 0) await deps.sleep(VERIFY_DELAY_MS);
      try {
        const p = await withRetry(deps, () => deps.read(profileId));
        ok = !!p && isWidgetPresent(p.description);
      } catch { /* retry */ }
    }
    if (ok) applied++; else remaining.push('widget non confirmé dans la description du profil');
  }
  return { applied, remaining, notes };
}

export async function runLevelChange(input: LevelChangeInput, deps: LevelChangeDeps): Promise<LevelChangeOutcome> {
  const refuse = (error: string, plan: LevelChangePlan | null = null): LevelChangeOutcome =>
    ({ success: false, dryRun: input.dryRun, plan, applied: 0, remaining: [], ignored: [], error });
  const EMPTY = "liste vide — rien n'a été écrit";
  if (!input.dryRun && !input.decisions) return refuse("décisions manquantes — rien n'a été écrit");

  let plan: LevelChangePlan;
  let profile: LcNode | null;
  let targetRef: LcNode | undefined;
  let targetChildren: LcNode[] | null;
  try {
    profile = await withRetry(deps, () => deps.read(input.profileId));
    if (!profile) return refuse('profil introuvable');
    // A template is recognised by where it sits, not by its tag: every student profile is a copy
    // of a template and carries hz-config-profile-student too (measured: all synced students).
    if (isTemplateNode(profile, input.templateRootId)) return refuse(TEMPLATE_REFUSAL);
    const current = levelOfColor(profile.color);
    if (!current) return refuse('niveau du profil non reconnu (couleur inattendue)');

    const rootChildren = await withRetry(deps, () => deps.list(input.templateRootId));
    const templates = studentTemplates(input.templateRootId, rootChildren);
    const targets = templatesFor(templates, profile.icon, input.toLevel);
    targetRef = targets.find(t => t.id === input.targetTemplateId);
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
    targetChildren = await listNonEmpty(targetRef.id);
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

  if (input.dryRun) {
    // Shown before a delete is ticked: one budget for all sections, never smaller than the truth.
    const budget = { remaining: 500 };
    for (const item of plan.profileOnlyItems) {
      // strict listing: an unexpected response shape throws instead of counting as « 0 »
      const r = await countDescendants(item.sectionId, deps.listFull, budget, deps.sleep);
      item.descendants = r.total;
      item.descendantsExact = r.exact;
    }
    return { success: true, dryRun: true, plan, applied: 0, remaining: [], ignored: [] };
  }

  const decided = applyDecisions(plan, input.decisions!);
  const changes = decided.writes;
  const selected = selectActions(plan, input.decisions!);
  const actions = selected.actions;
  const ignored = [...decided.ignored, ...selected.ignored];
  if (changes.length === 0 && !hasActions(actions) && !plan.colorChange) {
    return { success: true, dryRun: false, plan, applied: 0, remaining: [], ignored };
  }

  // Write sections: failures are kept, not fatal — only the live read decides.
  for (const c of changes) {
    const attempt = async (fn: () => Promise<void>) => {
      try { await withRetry(deps, fn); } catch { /* verified below */ }
    };
    // Add before remove: a swap stopped half-way then leaves both tags, which the next plan
    // finishes by removing; the reverse would leave neither.
    if (c.addTags.length) await attempt(() => deps.addTags(c.sectionId, c.addTags));
    if (c.removeTags.length) await attempt(() => deps.removeTags(c.sectionId, c.removeTags));
    if (c.descriptionTo !== null) await attempt(() => deps.updateDescription(c.sectionId, c.descriptionTo!));
  }

  // Verify sections against the re-listed profile.
  let lastLive: LcNode[] = [];
  let sectionsOk = changes.length === 0; // nothing written: nothing to confirm
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
  if (!sectionsOk) {
    if (hasActions(actions)) remaining.push('actions supplémentaires non faites — sections non confirmées');
    if (plan.colorChange) remaining.push('couleur du profil non modifiée — sections non confirmées');
    return { success: false, dryRun: false, plan, applied, remaining, ignored };
  }

  // Copies, deletes and widget, each confirmed by its own read; any failure withholds the colour.
  const acted = await runActions(actions, {
    profile: profile!, targetRootDescription: targetRef!.description,
    targetKeys: new Set(targetChildren!.map(sectionKey)),
    roleGroups: input.roleGroups, studentId: input.studentId, studentUnknown: input.studentUnknown,
  }, deps);
  applied += acted.applied;
  const notes = acted.notes;
  if (acted.remaining.length > 0) {
    remaining.push(...acted.remaining);
    if (plan.colorChange) remaining.push('couleur du profil non modifiée — étapes précédentes non confirmées');
    return { success: false, dryRun: false, plan, applied, remaining, ignored, notes };
  }

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
  return { success: remaining.length === 0, dryRun: false, plan, applied, remaining, ignored, notes };
}
