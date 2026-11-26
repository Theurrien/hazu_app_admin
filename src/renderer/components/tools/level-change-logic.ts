import type { Level, LevelChangePlan, LevelChangeStudent } from '../../../shared/level-change-types';
import type { LevelChangeDecisions } from '../../../shared/level-change-decisions';
import { normalizeName } from '../../../shared/person-match';

/** Fewer than 2 characters → nothing; otherwise every query word must occur in the name. */
export function searchStudents(all: LevelChangeStudent[], query: string): LevelChangeStudent[] {
  const q = normalizeName(query);
  if (q.length < 2) return [];
  const words = q.split(' ');
  return all.filter((s) => {
    const name = normalizeName(s.displayName);
    return words.every((w) => name.includes(w));
  });
}

export function eligibility(s: LevelChangeStudent): { ok: true; toLevel: Level } | { ok: false; reason: string } {
  if (s.level === 'cfc') return { ok: true, toLevel: 'afp' };
  if (s.level === 'afp') return { ok: true, toLevel: 'cfc' };
  return { ok: false, reason: 'niveau ni CFC ni AFP' };
}

export function levelLabel(l: Level): 'CFC' | 'AFP' {
  return l === 'cfc' ? 'CFC' : 'AFP';
}

/** Something « Appliquer » would write, given the operator's decisions: colour, a certain section
 *  change, an accepted uncertain tag, a forced description, a copy, a delete, or the widget.
 *  A section only « modifiée à la main » (descriptionKept) writes nothing unless forced. */
export function hasApplicableChange(plan: LevelChangePlan | null, decisions: LevelChangeDecisions): boolean {
  if (!plan) return false;
  if (plan.colorChange) return true;
  if (plan.sections.some((s) => !!s.description || s.addTags.length > 0 || s.removeTags.length > 0)) return true;
  if (plan.sections.some((s) =>
    s.uncertainTags.some((t) => decisions.acceptedTagAdds.some((a) => a.sectionKey === s.sectionKey && a.tag === t)) ||
    (s.descriptionKept && decisions.forcedDescriptions.includes(s.sectionKey)))) return true;
  return decisions.copySections.length > 0 || decisions.deleteSections.length > 0 || decisions.addWidget;
}

export function toggleTagAdd(d: LevelChangeDecisions, sectionKey: string, tag: string): LevelChangeDecisions {
  const has = d.acceptedTagAdds.some((a) => a.sectionKey === sectionKey && a.tag === tag);
  return {
    ...d,
    acceptedTagAdds: has
      ? d.acceptedTagAdds.filter((a) => !(a.sectionKey === sectionKey && a.tag === tag))
      : [...d.acceptedTagAdds, { sectionKey, tag }],
  };
}

export function toggleForced(d: LevelChangeDecisions, sectionKey: string): LevelChangeDecisions {
  return {
    ...d,
    forcedDescriptions: d.forcedDescriptions.includes(sectionKey)
      ? d.forcedDescriptions.filter((k) => k !== sectionKey)
      : [...d.forcedDescriptions, sectionKey],
  };
}

export function toggleCopy(d: LevelChangeDecisions, sectionKey: string): LevelChangeDecisions {
  return {
    ...d,
    copySections: d.copySections.includes(sectionKey)
      ? d.copySections.filter((k) => k !== sectionKey)
      : [...d.copySections, sectionKey],
  };
}

export function setDelete(d: LevelChangeDecisions, sectionKey: string, sectionId: string, on: boolean): LevelChangeDecisions {
  const rest = d.deleteSections.filter((x) => x.sectionKey !== sectionKey);
  return { ...d, deleteSections: on ? [...rest, { sectionKey, sectionId }] : rest };
}

/** How much a profile-only section holds: never shown smaller than the truth. */
export function descendantsLabel(n: number | null, exact: boolean): string {
  if (n === null) return 'contenu inconnu';
  if (!exact) return `au moins ${n}`;
  return `${n} ${n === 1 ? 'élément' : 'éléments'}`;
}
