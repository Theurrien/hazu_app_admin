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
  if (!c.email && !c.fullName && !c.firstName && !c.lastName) {
    return { ok: false, reason: 'Choisissez une colonne e-mail ou nom.' };
  }
  // A lone first or last name is half a name, even beside an e-mail; the full name replaces both.
  if (!c.fullName && (!!c.firstName || !!c.lastName) && !(c.firstName && c.lastName)) {
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

/**
 * Where a new room of `type` is created: the category folder of that type directly under root —
 * the same rule as Room Creation (`findTargetId`). Null when it is not known.
 */
export function creationTargetId(
  rooms: Array<{ id: string; room_type: string; parent_id: string | null }>,
  type: RoomCategory,
  rootHazuId: string | null,
): string | null {
  if (!rootHazuId) return null;
  return rooms.find((r) => r.room_type === type && r.parent_id === rootHazuId)?.id ?? null;
}

/** Why `name` cannot be created among `candidates` (same type), or null when it can. */
export function createNameProblem(name: string, candidates: RoomCandidate[]): string | null {
  const key = roomKey(name);
  if (key === '') return 'nom vide';
  if (candidates.some((c) => roomKey(c.title) === key)) return 'une salle de ce nom existe déjà';
  return null;
}

/** One file value of one room column, for tracking its creation. */
export function creationKey(category: RoomCategory, valueKey: string): string {
  return `${category}|${valueKey}`;
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
 * The cross-check input: rows whose student resolves to a person who is still a local student
 * (ignored rows and persons gone since are not checked),
 * cells looked up by `roomKey` in step 2's resolutions, and the category of every local room of the
 * three checked types — category folders and CIE rooms left out, so naming one is « non vérifiable ».
 */
export function checkInputFrom(
  resolved: ResolvedForCheck,
  cells: Map<number, Partial<Record<RoomCategory, string>>>,
  mapped: RoomCategory[],
  rooms: Array<{ id: string; room_type: string }>,
  assignments: Array<{ person_id: string; room_id: string; role: string }>,
  students: ReadonlyArray<{ id: string }>,
): CheckInput {
  // A person who is no longer a local student at reload is not checked (no line, no fix).
  const studentIds = new Set(students.map((s) => s.id));
  const rows: CheckRow[] = [];
  for (const [rowIndex, res] of [...resolved.students].sort((a, b) => a[0] - b[0])) {
    const personId = isResolved(res) ? resolvedId(res) : null;
    if (personId === null || !studentIds.has(personId)) continue;
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

/** A tick names the line AND the status it had when ticked: a line whose status changes loses its tick. */
export function tickId(line: PairLine): string {
  return `${line.status}|${line.key}`;
}

/** « Cocher les manquants »: ticks every visible « Manquant » line. There is no shortcut for removals. */
export function tickMissing(visible: PairLine[], ticked: Set<string>): Set<string> {
  const out = new Set(ticked);
  for (const l of visible) if (l.status === 'missing') out.add(tickId(l));
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

/** After a recompute: ticks of lines that vanished, changed status, or no longer have a box are dropped. */
export function keepTicks(ticked: Set<string>, lines: PairLine[]): Set<string> {
  const boxed = new Set(lines.filter(hasBox).map(tickId));
  return new Set([...ticked].filter((k) => boxed.has(k)));
}

/** The selection: only lines the operator can see, ticked under their current status, with a box, not locked. */
export function selectedLines(visible: PairLine[], ticked: Set<string>, isLocked: (l: PairLine) => boolean): PairLine[] {
  return visible.filter((l) => ticked.has(tickId(l)) && hasBox(l) && !isLocked(l));
}

export type ConfirmCheck =
  | { ok: true; lines: PairLine[] }
  | { ok: false; reason: 'sync' | 'changed'; lines: PairLine[] };

/**
 * At « Confirmer »: the lines the modal showed, re-derived from the current check. Enqueue only when
 * every shown line is still there with the same status, boxed and unlocked, and the sync is complete;
 * otherwise `lines` is what is still valid, to show again.
 */
export function confirmCheck(
  shown: PairLine[],
  current: PairLine[],
  isLocked: (l: PairLine) => boolean,
  syncIncomplete: boolean,
): ConfirmCheck {
  if (syncIncomplete) return { ok: false, reason: 'sync', lines: [] };
  const wanted = new Set(shown.map(tickId));
  const lines = current.filter((l) => wanted.has(tickId(l)) && hasBox(l) && !isLocked(l));
  if (lines.length > 0 && lines.length === wanted.size) return { ok: true, lines };
  return { ok: false, reason: 'changed', lines };
}

/** At the archive confirmation: only persons still on the leaver list and not queued; none if the sync is incomplete. */
export function plansToEnqueue<T extends { personId: string }>(
  plans: T[],
  leaverIds: ReadonlySet<string>,
  pending: ReadonlySet<string>,
  syncIncomplete: boolean,
): T[] {
  if (syncIncomplete) return [];
  return plans.filter((p) => leaverIds.has(p.personId) && !pending.has(p.personId));
}

/**
 * Student resolutions as the matches `findLeavers` reads: a row resolved to a person is present; a
 * row still to check keeps its candidates (never leavers while undecided); an ignored row is
 * « unknown » (it names nobody, and Verify's warning about such rows applies).
 */
export function leaverMatches(students: Map<number, StudentResolution>): RowMatch[] {
  const out: RowMatch[] = [];
  for (const [rowIndex, res] of [...students].sort((a, b) => a[0] - b[0])) {
    if (res.kind === 'check') {
      // Undecided: its candidates are not leavers until the operator decides.
      out.push({ kind: 'check', rowIndex, candidateIds: res.candidateIds, reason: res.reason });
      continue;
    }
    const personId = isResolved(res) ? resolvedId(res) : null;
    out.push(personId === null ? { kind: 'unknown', rowIndex } : { kind: 'matched', rowIndex, personId, by: 'name' });
  }
  return out;
}
