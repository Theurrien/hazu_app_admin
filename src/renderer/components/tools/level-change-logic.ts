import type { Level, LevelChangeOutcome, LevelChangePlan, LevelChangeStudent, SectionChange } from '../../../shared/level-change-types';
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

/** The adds written without a box: the core lists every uncertain tag inside addTags too. */
export function certainAdds(s: Pick<SectionChange, 'addTags' | 'uncertainTags'>): string[] {
  return s.addTags.filter((t) => !s.uncertainTags.includes(t));
}

/** Something « Appliquer » would write, given the operator's decisions: colour, a certain section
 *  change, an accepted uncertain tag, a forced description, a copy, a delete, or the widget.
 *  A section only « modifiée à la main » (descriptionKept) writes nothing unless forced. */
export function hasApplicableChange(plan: LevelChangePlan | null, decisions: LevelChangeDecisions): boolean {
  if (!plan) return false;
  if (plan.colorChange) return true;
  if (plan.sections.some((s) => !!s.description || certainAdds(s).length > 0 || s.removeTags.length > 0)) return true;
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

/** What a finished run tells the operator, kept on screen until the next pick or preview. */
export interface LevelChangeResultView {
  ok: boolean;
  headline: string;
  /** the profile the run was about (for « Ouvrir le profil dans Hazu ») */
  personId: string;
  remaining: string[];
  ignored: string[];
  notes: string[];
}

export function resultView(
  outcome: LevelChangeOutcome | null, personId: string, failure?: string,
): LevelChangeResultView {
  const failed = (why?: string) => `Changement non terminé${why ? ` — ${why}` : ''}`;
  if (!outcome) {
    return { ok: false, headline: failed(failure ?? 'erreur inconnue'), personId, remaining: [], ignored: [], notes: [] };
  }
  const ok = outcome.success;
  const headline = ok
    ? `Changement appliqué (${outcome.applied} étape${outcome.applied === 1 ? '' : 's'} confirmée${outcome.applied === 1 ? '' : 's'})`
    : failed(outcome.error);
  return { ok, headline, personId, remaining: outcome.remaining, ignored: outcome.ignored, notes: outcome.notes ?? [] };
}

/** A role group left at the wrong share role is never written: a retry cannot fix it. */
export const GROUP_ROLE_HINT =
  'Réessayer ne corrige pas ceci : réglez le rôle dans Hazu, puis Réessayer pour écrire la couleur.';

export function hintFor(line: string): string | null {
  return line.includes('rôle du groupe') && line.includes('à ajuster à la main') ? GROUP_ROLE_HINT : null;
}

/** Appended to the Task Queue line: counts only, the lines themselves are in the Outils section. */
export function taskCountsSuffix(ignored: number, notes: number): string {
  const parts: string[] = [];
  if (ignored > 0) parts.push(`${ignored} ignoré${ignored === 1 ? '' : 's'}`);
  if (notes > 0) parts.push(`${notes} note${notes === 1 ? '' : 's'}`);
  return parts.length ? ` — ${parts.join(', ')} (voir Outils)` : '';
}
