// Level change (CFC <-> AFP) — PURE CORE. No DB, axios or Electron import.
// Spec: docs/specs/2026-11-26-level-change-design.md
//
// Only the difference between the two levels' templates is applied to a profile; a tag the
// templates do not differ on, and any tag specific to the student, is never touched.

import type { Level, LevelChangePlan, SectionChange } from '../../shared/level-change-types';

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
      add.add(t);
    }
  }

  const tgtFamilies = new Set(tgtDelta.map(tagFamily).filter((f): f is string => f !== null));
  for (const s of srcDeltaAll) {
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
    colorFrom: LEVEL_COLORS[fromLevel],
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
