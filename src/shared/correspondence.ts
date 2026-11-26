/**
 * Correspondence core for Contrôle — pure, no IO. Resolves the values of a spreadsheet (room
 * names, students) to Hazu rooms and persons, using links the operator saved earlier.
 */
import { cleanEmail, matchRows, nameKey, rowName } from './person-match';
import type { HazuPerson, SheetPerson } from './person-match';

export type CorrCategory = 'student' | 'class' | 'enterprise' | 'state';
export type RoomCategory = Exclude<CorrCategory, 'student'>;

export interface SavedLink {
  category: CorrCategory;
  fileKey: string;
  fileLabel: string;
  /** null = ignored on purpose */
  hazuId: string | null;
  decidedAt: number;
}

export interface RoomCandidate {
  id: string;
  title: string;
  parentTitle: string | null;
}

export type RoomResolution =
  | { kind: 'saved'; hazuId: string }
  | { kind: 'exact'; hazuId: string }
  | { kind: 'ignored' }
  | { kind: 'stale'; suggestionId: string | null }
  | { kind: 'open'; suggestionId: string | null; twins: string[] };

export type StudentResolution =
  | { kind: 'saved'; personId: string }
  | { kind: 'matched'; personId: string }
  | { kind: 'ignored' }
  | { kind: 'stale' }
  | { kind: 'check'; candidateIds: string[]; reason: 'conflict' | 'ambiguous' | 'near' }
  | { kind: 'unknown' };

/** Trim, collapse spaces, lower case. Accents are kept. */
export function roomKey(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function rowNameKey(p: SheetPerson): string {
  return nameKey(rowName(p));
}

/** Keys of a row, e-mail first, only those that exist. */
export function studentKeys(p: SheetPerson): string[] {
  const keys: string[] = [];
  const email = cleanEmail(p.email);
  if (email !== '') keys.push(`email:${email}`);
  const name = rowNameKey(p);
  if (name !== '') keys.push(`name:${name}`);
  return keys;
}

function linkMap(saved: SavedLink[], category: CorrCategory): Map<string, SavedLink> {
  const m = new Map<string, SavedLink>();
  for (const l of saved) {
    if (l.category !== category) continue;
    m.set(category === 'student' ? l.fileKey : roomKey(l.fileKey), l);
  }
  return m;
}

export function resolveRoomValues(
  category: RoomCategory,
  values: string[],
  rooms: RoomCandidate[],
  saved: SavedLink[],
  suggest: (value: string, titles: string[]) => string | null,
): Map<string, RoomResolution> {
  const links = linkMap(saved, category);
  const ids = new Set(rooms.map((r) => r.id));
  const out = new Map<string, RoomResolution>();

  const suggestionFor = (value: string): string | null => {
    const title = suggest(value, rooms.map((r) => r.title));
    if (title === null) return null;
    const hits = rooms.filter((r) => r.title === title);
    return hits.length === 1 ? hits[0].id : null; // never preselect one twin silently
  };

  for (const value of values) {
    const key = roomKey(value);
    if (key === '' || out.has(key)) continue;

    const link = links.get(key);
    if (link) {
      if (link.hazuId === null) out.set(key, { kind: 'ignored' });
      else if (ids.has(link.hazuId)) out.set(key, { kind: 'saved', hazuId: link.hazuId });
      else out.set(key, { kind: 'stale', suggestionId: suggestionFor(value) });
      continue;
    }

    const same = rooms.filter((r) => roomKey(r.title) === key);
    if (same.length === 1) out.set(key, { kind: 'exact', hazuId: same[0].id });
    else if (same.length > 1) out.set(key, { kind: 'open', suggestionId: null, twins: same.map((r) => r.id) });
    else out.set(key, { kind: 'open', suggestionId: suggestionFor(value), twins: [] });
  }
  return out;
}

export function resolveStudents(
  rows: SheetPerson[],
  students: HazuPerson[],
  saved: SavedLink[],
): Map<number, { res: StudentResolution; saveKey: string | null }> {
  const links = linkMap(saved, 'student');
  const known = new Set(students.map((s) => s.id));
  const matches = new Map(matchRows(rows, students).map((m) => [m.rowIndex, m]));

  // Rows without an e-mail that share a name key cannot be told apart by it.
  const nameCount = new Map<string, number>();
  for (const r of rows) {
    const n = rowNameKey(r);
    if (n !== '') nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
  }

  const out = new Map<number, { res: StudentResolution; saveKey: string | null }>();
  for (const row of rows) {
    const email = cleanEmail(row.email);
    const collides = (nameCount.get(rowNameKey(row)) ?? 0) > 1;
    const keys = studentKeys(row).filter((k) => !(collides && k.startsWith('name:')));
    const saveKey = keys[0] ?? null;

    // The first defined link in key order wins, even when it is stale.
    const hitKey = keys.find((k) => links.has(k));
    const link = hitKey === undefined ? undefined : links.get(hitKey);
    let res: StudentResolution | null = null;
    if (link) {
      if (link.hazuId === null) res = { kind: 'ignored' };
      else if (!known.has(link.hazuId)) res = { kind: 'stale' };
      else {
        const linked = students.find((s) => s.id === link.hazuId);
        const others =
          email === ''
            ? []
            : students.filter((s) => s.id !== link.hazuId && cleanEmail(s.email) === email);
        const linkedEmail = cleanEmail(linked?.email);
        // Found by name only, and both sides carry a real address that differs: the name is not enough.
        const differs = hitKey!.startsWith('name:') && email !== '' && linkedEmail !== '' && linkedEmail !== email;
        res =
          others.length > 0 || differs
            ? { kind: 'check', candidateIds: [link.hazuId, ...others.map((s) => s.id)], reason: 'conflict' }
            : { kind: 'saved', personId: link.hazuId };
      }
    }
    if (res === null) {
      const m = matches.get(row.rowIndex);
      if (m === undefined || m.kind === 'unknown') res = { kind: 'unknown' };
      else if (m.kind === 'matched') res = { kind: 'matched', personId: m.personId };
      else res = { kind: 'check', candidateIds: m.candidateIds, reason: m.reason };
    }
    out.set(row.rowIndex, { res, saveKey });
  }
  return out;
}

export function isResolved(r: RoomResolution | StudentResolution): boolean {
  return r.kind === 'saved' || r.kind === 'exact' || r.kind === 'matched' || r.kind === 'ignored';
}

export function resolvedId(r: RoomResolution | StudentResolution): string | null {
  if (r.kind === 'saved' || r.kind === 'exact') return 'hazuId' in r ? r.hazuId : r.personId;
  if (r.kind === 'matched') return r.personId;
  return null;
}
