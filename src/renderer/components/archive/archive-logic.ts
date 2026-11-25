import type { ArchiveRoomType } from '../../../shared/archive-types';
import { normalizeName } from '../../../shared/person-match';

export const TYPE_LABEL: Record<ArchiveRoomType, string> = {
  class: 'Classe',
  cie: 'CIE',
  enterprise: 'Entreprise',
  state: 'Canton',
};

export const TYPE_ORDER: ArchiveRoomType[] = ['class', 'cie', 'enterprise', 'state'];

/** Room titles may carry HTML; strip it for display. */
export function plainTitle(title: string): string {
  return title
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Empty `types` = all. The search is accent- and case-insensitive on the plain title. */
export function filterRooms<T extends { roomType: ArchiveRoomType; title: string }>(
  rows: T[],
  types: Set<ArchiveRoomType>,
  query: string
): T[] {
  const q = fold(query.trim());
  return rows.filter(
    (r) => (types.size === 0 || types.has(r.roomType)) && (q === '' || fold(plainTitle(r.title)).includes(q))
  );
}

/** dd.mm.yyyy in local time. */
export function formatArchivedAt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export const PERSON_TYPE_ORDER = ['student', 'companymentor', 'schoolteacher', 'courseteacher', 'stateadvisor', 'guardian'];

export const PERSON_TYPE_LABEL: Record<string, string> = {
  student: 'Élève',
  companymentor: 'Formateur·trice en entreprise',
  schoolteacher: 'Enseignant·e',
  courseteacher: 'Enseignant·e CIE',
  stateadvisor: 'Conseiller·ère cantonal·e',
  guardian: 'Représentant·e légal·e',
};

/**
 * Persons matching the search (name or e-mail, accent/case-insensitive) and the types.
 * Empty search AND no type → [] : the whole school is never rendered.
 */
export function filterPersons<T extends { display_name: string; email: string | null; person_type: string }>(
  persons: T[],
  search: string,
  types: string[]
): T[] {
  const q = normalizeName(search);
  if (q === '' && types.length === 0) return [];
  return persons.filter(
    (p) =>
      (types.length === 0 || types.includes(p.person_type)) &&
      (q === '' || normalizeName(p.display_name).includes(q) || normalizeName(p.email ?? '').includes(q))
  );
}
