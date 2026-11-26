/**
 * Contrôle, steps 1 to 3 — pure decisions about the column mapping and the sheet rows. No IO, no React.
 */
import { normalizeName, type RowMatch, type SheetPerson } from '../../../../shared/person-match';
import { isResolved, resolvedId, roomKey } from '../../../../shared/correspondence';
import type { CheckInput, CheckRow, PairLine, PairStatus } from '../../../../shared/cross-check';
import type {
  CorrCategory,
  RoomCandidate,
  RoomCategory,
  RoomResolution,
  SavedLink,
  StudentResolution,
} from '../../../../shared/correspondence';
import type { ColumnMapping } from '../ColumnMappingDropdown';

export interface ControleColumns {
  email?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  class?: string;
  company?: string;
  canton?: string;
}

const KEY_OF: Record<string, keyof ControleColumns> = {
  ctlEmail: 'email',
  ctlFirstName: 'firstName',
  ctlLastName: 'lastName',
  ctlFullName: 'fullName',
  ctlClass: 'class',
  ctlCompany: 'company',
  ctlCanton: 'canton',
};

/** Header names by meaning, read from the header → mapping record. */
export function controleColumns(mappings: Record<string, ColumnMapping>): ControleColumns {
  const out: ControleColumns = {};
  for (const [header, mapping] of Object.entries(mappings)) {
    const key = KEY_OF[mapping];
    if (key) out[key] = header;
  }
  return out;
}

export function columnsReady(c: ControleColumns): { ok: true } | { ok: false; reason: string } {
  const named = !!c.fullName || !!c.email;
  if (!c.email && !c.fullName && !c.firstName && !c.lastName) {
    return { ok: false, reason: 'Choisissez une colonne e-mail ou nom.' };
  }
  if (!named && (!c.firstName || !c.lastName)) {
    return { ok: false, reason: 'Prénom et nom vont ensemble.' };
  }
  if (!c.class && !c.company && !c.canton) {
    return { ok: false, reason: 'Choisissez au moins une colonne classe, entreprise ou canton.' };
  }
  return { ok: true };
}

/** The room categories that have a column, always in the order class, enterprise, state. */
export function mappedCategories(c: ControleColumns): RoomCategory[] {
  const out: RoomCategory[] = [];
  if (c.class) out.push('class');
  if (c.company) out.push('enterprise');
  if (c.canton) out.push('state');
  return out;
}

/**
 * Sheet rows as SheetPerson (rowIndex = index in `rows`; rows with no e-mail and no name are left
 * out) plus, per row index, the trimmed non-empty room cells. A row without identity can still
 * have cells in the map; a row without cells is absent from it.
 */
export function checkRows(
  rows: Record<string, string>[],
  c: ControleColumns,
): { sheet: SheetPerson[]; cells: Map<number, Partial<Record<RoomCategory, string>>> } {
  const cell = (row: Record<string, string>, col: string | undefined): string | undefined => {
    if (!col) return undefined;
    const v = (row[col] ?? '').toString().trim();
    return v === '' ? undefined : v;
  };
  const sheet: SheetPerson[] = [];
  const cells = new Map<number, Partial<Record<RoomCategory, string>>>();
  rows.forEach((row, rowIndex) => {
    const p: SheetPerson = {
      rowIndex,
      email: cell(row, c.email),
      firstName: cell(row, c.firstName),
      lastName: cell(row, c.lastName),
      fullName: cell(row, c.fullName),
    };
    if (p.email || p.firstName || p.lastName || p.fullName) sheet.push(p);
    const found: Partial<Record<RoomCategory, string>> = {};
    const cls = cell(row, c.class);
    const ent = cell(row, c.company);
    const st = cell(row, c.canton);
    if (cls) found.class = cls;
    if (ent) found.enterprise = ent;
    if (st) found.state = st;
    if (Object.keys(found).length > 0) cells.set(rowIndex, found);
  });
  return { sheet, cells };
}

export interface ControleState {
  step: 1 | 2 | 3;
  mappings: Record<string, ColumnMapping>;
  ticked: Set<string>;
}

/** A new (or cleared) file: back to step 1, nothing mapped or ticked. Saved links are never touched. */
export function resetForNewFile(): ControleState {
  return { step: 1, mappings: {}, ticked: new Set() };
}

// ---- Step 2: correspondences ----

/** How many resolutions still need the operator (an ignored value counts as resolved). */
export function openCount(res: Iterable<RoomResolution | StudentResolution>): number {
  let n = 0;
  for (const r of res) if (!isResolved(r)) n++;
  return n;
}

/** The link saved for one operator decision; `hazuId` null = ignored on purpose. */
export function linkFromDecision(
  category: CorrCategory,
  fileKey: string,
  fileLabel: string,
  hazuId: string | null,
  now: number,
): SavedLink {
  return { category, fileKey, fileLabel, hazuId, decidedAt: now };
}

/**
 * Local rooms of one type as candidates; parentTitle = title of the local room that is its parent,
 * else null. Category folders (`categoryIds`, from `categoryIdsOf`) are never candidates — and so
 * never twins — but still give their title as a parent.
 */
export function roomCandidates(
  rooms: Array<{ id: string; title: string; room_type: string; parent_id: string | null }>,
  type: RoomCategory,
  categoryIds: ReadonlySet<string> = new Set(),
): RoomCandidate[] {
  const titleOf = new Map(rooms.map((r) => [r.id, r.title]));
  return rooms
    .filter((r) => r.room_type === type && !categoryIds.has(r.id))
    .map((r) => ({ id: r.id, title: r.title, parentTitle: (r.parent_id && titleOf.get(r.parent_id)) || null }));
}

/** Title shown in a list: twins (same `roomKey`) carry their parent folder so they can be told apart. */
export function roomLabel(c: RoomCandidate, all: RoomCandidate[]): string {
  const key = roomKey(c.title);
  const twin = all.some((o) => o.id !== c.id && roomKey(o.title) === key);
  return twin ? `${c.title} — ${c.parentTitle ?? 'dossier inconnu'}` : c.title;
}

/** The distinct values of one room column, one per `roomKey`, first spelling kept, in file order. */
export function distinctRoomValues(
  cells: Map<number, Partial<Record<RoomCategory, string>>>,
  category: RoomCategory,
): Array<{ key: string; label: string }> {
  const seen = new Map<string, string>();
  const rows = [...cells.keys()].sort((a, b) => a - b);
  for (const i of rows) {
    const v = cells.get(i)?.[category];
    if (v === undefined) continue;
    const key = roomKey(v);
    if (key !== '' && !seen.has(key)) seen.set(key, v);
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}

/**
 * Session-only decisions (rows whose key cannot be saved) laid over the resolved rows:
 * a person id → matched, null → ignored. The input map is not modified.
 */
export function applyStudentOverrides(
  res: Map<number, { res: StudentResolution; saveKey: string | null }>,
  overrides: Map<number, string | null>,
): Map<number, { res: StudentResolution; saveKey: string | null }> {
  const out = new Map(res);
  for (const [rowIndex, personId] of overrides) {
    const cur = out.get(rowIndex);
    if (!cur) continue;
    out.set(rowIndex, {
      res: personId === null ? { kind: 'ignored' } : { kind: 'matched', personId },
      saveKey: cur.saveKey,
    });
  }
  return out;
}

/** What step 3 receives from step 2: the student per row and the room per (category, roomKey). */
export interface ResolvedForCheck {
  students: Map<number, StudentResolution>;
  rooms: Partial<Record<RoomCategory, Map<string, RoomResolution>>>;
  /** Category folder ids: never a room to check against (empty when root_hazu_id is unknown). */
  categoryIds: Set<string>;
}

// ---- Step 3: the check ----

const CHECKED_TYPES: ReadonlySet<string> = new Set<RoomCategory>(['class', 'enterprise', 'state']);

/**
 * The cross-check input: rows whose student resolves to a person (ignored rows are not checked),
 * cells looked up by `roomKey` in step 2's resolutions, and the category of every local room of the
 * three checked types — category folders and CIE rooms left out, so naming one is « non vérifiable ».
 */
export function checkInputFrom(
  resolved: ResolvedForCheck,
  cells: Map<number, Partial<Record<RoomCategory, string>>>,
  mapped: RoomCategory[],
  rooms: Array<{ id: string; room_type: string }>,
  assignments: Array<{ person_id: string; room_id: string; role: string }>,
): CheckInput {
  const rows: CheckRow[] = [];
  for (const [rowIndex, res] of [...resolved.students].sort((a, b) => a[0] - b[0])) {
    const personId = isResolved(res) ? resolvedId(res) : null;
    if (personId === null) continue;
    rows.push({ rowIndex, personId, cells: cells.get(rowIndex) ?? {} });
  }
  const roomCategory = new Map<string, RoomCategory>();
  for (const r of rooms) {
    if (CHECKED_TYPES.has(r.room_type) && !resolved.categoryIds.has(r.id)) roomCategory.set(r.id, r.room_type as RoomCategory);
  }
  return {
    rows,
    mapped,
    // Step 3 is only reached with every value resolved; anything else is treated as ignored (unverifiable).
    cellOf: (category, value) => {
      const res = resolved.rooms[category]?.get(roomKey(value));
      const roomId = res && isResolved(res) ? resolvedId(res) : null;
      return roomId === null ? { kind: 'ignored' } : { kind: 'room', roomId };
    },
    roomCategory,
    assignments,
  };
}

/** Only « Manquant » and « En trop » lines have a box. */
export function hasBox(line: PairLine): boolean {
  return line.status === 'missing' || line.status === 'extra';
}

export interface LineFilter {
  /** Empty = every category. */
  categories: RoomCategory[];
  /** Empty = every status. */
  statuses: PairStatus[];
  search: string;
  showOk: boolean;
}

/** The lines to show: no OK line unless `showOk`; grouped by student name, check order kept inside a student. */
export function visibleLines(lines: PairLine[], f: LineFilter, nameOf: (personId: string) => string): PairLine[] {
  const q = normalizeName(f.search);
  const shown = lines.filter(
    (l) =>
      (l.status !== 'ok' || f.showOk) &&
      (f.categories.length === 0 || f.categories.includes(l.category)) &&
      (f.statuses.length === 0 || f.statuses.includes(l.status)) &&
      (q === '' || normalizeName(nameOf(l.personId)).includes(q)),
  );
  const order = new Map(lines.map((l, i) => [l.key, i]));
  return shown.sort(
    (a, b) =>
      nameOf(a.personId).localeCompare(nameOf(b.personId), 'fr') ||
      a.personId.localeCompare(b.personId) ||
      order.get(a.key)! - order.get(b.key)!,
  );
}

/** « Cocher les manquants »: adds every visible « Manquant » key. There is no shortcut for removals. */
export function tickMissing(visible: PairLine[], ticked: Set<string>): Set<string> {
  const out = new Set(ticked);
  for (const l of visible) if (l.status === 'missing') out.add(l.key);
  return out;
}

/** What the confirmation shows: additions, the removal lines, and how many removals are companies. */
export function confirmSummary(lines: PairLine[]): { adds: number; removals: PairLine[]; companyRemovals: number } {
  const removals = lines.filter((l) => l.status === 'extra');
  return {
    adds: lines.filter((l) => l.status === 'missing').length,
    removals,
    companyRemovals: removals.filter((l) => l.category === 'enterprise').length,
  };
}

/** After a recompute: ticks of lines that vanished, or no longer have a box, are dropped. */
export function keepTicks(ticked: Set<string>, lines: PairLine[]): Set<string> {
  const boxed = new Set(lines.filter(hasBox).map((l) => l.key));
  return new Set([...ticked].filter((k) => boxed.has(k)));
}

/**
 * Student resolutions as the matches `findLeavers` reads: a row resolved to a person is present; an
 * ignored row is « unknown » (it names nobody, and Verify's warning about such rows applies).
 */
export function leaverMatches(students: Map<number, StudentResolution>): RowMatch[] {
  const out: RowMatch[] = [];
  for (const [rowIndex, res] of [...students].sort((a, b) => a[0] - b[0])) {
    const personId = isResolved(res) ? resolvedId(res) : null;
    out.push(personId === null ? { kind: 'unknown', rowIndex } : { kind: 'matched', rowIndex, personId, by: 'name' });
  }
  return out;
}
