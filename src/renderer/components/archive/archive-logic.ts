import type { ArchiveRoomType } from '../../../shared/archive-types';

export const TYPE_LABEL: Record<ArchiveRoomType, string> = {
  class: 'Classe',
  cie: 'CIE',
  enterprise: 'Entreprise',
  state: 'Canton',
};

export const TYPE_ORDER: ArchiveRoomType[] = ['class', 'cie', 'enterprise', 'state'];

/** Room titles may carry HTML; strip it for display. */
export function plainTitle(title: string): string {
  return title.replace(/<[^>]*>/g, '').trim();
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
