import type { Level, LevelChangeStudent } from '../../../shared/level-change-types';
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
