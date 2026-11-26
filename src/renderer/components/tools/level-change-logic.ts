import type { Level, LevelChangePlan, LevelChangeStudent } from '../../../shared/level-change-types';
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

/** Something « Appliquer » would write: colour, or a section with tags or a description.
 *  A section only listed as « modifiée à la main » (descriptionKept) writes nothing. */
export function hasApplicableChange(plan: LevelChangePlan | null): boolean {
  if (!plan) return false;
  return plan.colorChange || plan.sections.some((s) => !!s.description || s.addTags.length > 0 || s.removeTags.length > 0);
}
