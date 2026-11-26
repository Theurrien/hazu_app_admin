/**
 * Cross-check core for Contrôle — pure, no IO. Compares what a spreadsheet names (class, company,
 * canton per student) with the student's assignments in Hazu, and lists what to fix.
 */
import type { RoomCategory } from './correspondence';

export type PairStatus = 'ok' | 'missing' | 'extra' | 'unverifiable' | 'other-role';

export interface PairLine {
  key: string; // `${personId}|${category}|${roomId ?? 'file:' + fileValue}`
  personId: string;
  rowIndexes: number[];
  category: RoomCategory;
  fileValue: string | null; // null on 'extra' lines
  roomId: string | null; // null on 'unverifiable'
  status: PairStatus;
  hazuRole?: string; // on 'other-role'
  multipleInHazu?: number; // enterprise/state only, on 'extra' lines, when the student holds >1 room of that type
}

/** Only mapped, non-empty cells. */
export interface CheckRow {
  rowIndex: number;
  personId: string;
  cells: Partial<Record<RoomCategory, string>>;
}

export type CellResolution = { kind: 'room'; roomId: string } | { kind: 'ignored' };

export interface CheckInput {
  rows: CheckRow[];
  mapped: RoomCategory[];
  cellOf: (category: RoomCategory, value: string) => CellResolution;
  roomCategory: Map<string, RoomCategory>;
  assignments: Array<{ person_id: string; room_id: string; role: string }>;
}

export interface CheckResult {
  lines: PairLine[];
  counts: { students: number; ok: number; missing: number; extra: number; unverifiable: number; otherRole: number };
  duplicatePersons: string[];
}

const CATEGORY_ORDER: RoomCategory[] = ['class', 'enterprise', 'state'];

export function crossCheck(input: CheckInput): CheckResult {
  // Merge the rows of one person: union of the cell values per category, in file order.
  const persons = new Map<string, { rowIndexes: number[]; values: Map<RoomCategory, string[]> }>();
  for (const row of input.rows) {
    let p = persons.get(row.personId);
    if (!p) {
      p = { rowIndexes: [], values: new Map() };
      persons.set(row.personId, p);
    }
    p.rowIndexes.push(row.rowIndex);
    for (const category of input.mapped) {
      const value = row.cells[category];
      if (value === undefined || value === '') continue;
      const list = p.values.get(category) ?? [];
      if (!list.includes(value)) list.push(value);
      p.values.set(category, list);
    }
  }

  // person_room_assignments is UNIQUE(person_id, room_id): one role per person and room.
  const heldBy = new Map<string, Map<string, string>>(); // person → room → role
  for (const a of input.assignments) {
    let rooms = heldBy.get(a.person_id);
    if (!rooms) {
      rooms = new Map();
      heldBy.set(a.person_id, rooms);
    }
    rooms.set(a.room_id, a.role);
  }

  const lines: PairLine[] = [];
  const duplicatePersons: string[] = [];
  for (const personId of [...persons.keys()].sort()) {
    const p = persons.get(personId)!;
    if (p.rowIndexes.length > 1) duplicatePersons.push(personId);
    const held = heldBy.get(personId) ?? new Map<string, string>();
    for (const category of CATEGORY_ORDER) {
      if (!input.mapped.includes(category)) continue;
      const values = p.values.get(category);
      if (!values || values.length === 0) continue;

      const named = new Set<string>();
      let anyIgnored = false;
      const base = { personId, category };
      for (const value of values) {
        const res = input.cellOf(category, value);
        // A room of another type (or unknown locally) can never be added to or compared: unverifiable.
        if (res.kind === 'ignored' || input.roomCategory.get(res.roomId) !== category) {
          anyIgnored = true;
          lines.push({ ...base, rowIndexes: [...p.rowIndexes], key: `${personId}|${category}|file:${value}`, fileValue: value, roomId: null, status: 'unverifiable' });
          continue;
        }
        if (named.has(res.roomId)) continue;
        named.add(res.roomId);
        const role = held.get(res.roomId);
        const key = `${personId}|${category}|${res.roomId}`;
        if (role === 'student') lines.push({ ...base, rowIndexes: [...p.rowIndexes], key, fileValue: value, roomId: res.roomId, status: 'ok' });
        else if (role !== undefined) lines.push({ ...base, rowIndexes: [...p.rowIndexes], key, fileValue: value, roomId: res.roomId, status: 'other-role', hazuRole: role });
        else lines.push({ ...base, rowIndexes: [...p.rowIndexes], key, fileValue: value, roomId: res.roomId, status: 'missing' });
      }

      if (anyIgnored) continue;
      const studentRooms = [...held.entries()]
        .filter(([roomId, role]) => role === 'student' && input.roomCategory.get(roomId) === category)
        .map(([roomId]) => roomId);
      for (const roomId of studentRooms) {
        if (named.has(roomId)) continue;
        const line: PairLine = { ...base, rowIndexes: [...p.rowIndexes], key: `${personId}|${category}|${roomId}`, fileValue: null, roomId, status: 'extra' };
        if (category !== 'class' && studentRooms.length > 1) line.multipleInHazu = studentRooms.length;
        lines.push(line);
      }
    }
  }

  const count = (s: PairStatus) => lines.filter((l) => l.status === s).length;
  return {
    lines,
    counts: {
      students: persons.size,
      ok: count('ok'),
      missing: count('missing'),
      extra: count('extra'),
      unverifiable: count('unverifiable'),
      otherRole: count('other-role'),
    },
    duplicatePersons,
  };
}

export interface Fix {
  lineKey: string;
  personId: string;
  roomId: string;
  oldRole: '_' | 'student';
  newRole: 'student' | '_';
}

export function fixesFor(lines: PairLine[]): Fix[] {
  const fixes: Fix[] = [];
  for (const l of lines) {
    if (l.roomId === null) continue;
    if (l.status === 'missing') fixes.push({ lineKey: l.key, personId: l.personId, roomId: l.roomId, oldRole: '_', newRole: 'student' });
    else if (l.status === 'extra') fixes.push({ lineKey: l.key, personId: l.personId, roomId: l.roomId, oldRole: 'student', newRole: '_' });
  }
  return fixes;
}
