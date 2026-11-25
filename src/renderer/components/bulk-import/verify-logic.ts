import {
  findLeavers,
  type CheckDecision,
  type ClassFilter,
  type RowMatch,
  type SheetPerson,
  type HazuPerson,
} from '../../../shared/person-match';

export interface VerifyColumns {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  room: string | null;
}

/** A person check needs an e-mail, a full name, or first AND last name. */
export function canRunPersonCheck(c: VerifyColumns): boolean {
  return !!c.email || !!c.fullName || (!!c.firstName && !!c.lastName);
}

export function canRunAssignmentDiff(c: VerifyColumns): boolean {
  return canRunPersonCheck(c) && !!c.room;
}

/** Sheet rows as SheetPerson; rowIndex = index in `rows`; rows with no e-mail and no name are dropped. */
export function sheetPersons(rows: Record<string, string>[], c: VerifyColumns): SheetPerson[] {
  const cell = (row: Record<string, string>, col: string | null): string | undefined => {
    if (!col) return undefined;
    const v = (row[col] ?? '').toString().trim();
    return v === '' ? undefined : v;
  };
  const out: SheetPerson[] = [];
  rows.forEach((row, rowIndex) => {
    const p: SheetPerson = {
      rowIndex,
      email: cell(row, c.email),
      firstName: cell(row, c.firstName),
      lastName: cell(row, c.lastName),
      fullName: cell(row, c.fullName),
    };
    if (p.email || p.firstName || p.lastName || p.fullName) out.push(p);
  });
  return out;
}

/** person id → ids of the school classes (rooms of type 'class') they are assigned to. */
export function buildClassIdsOf(
  assignments: Array<{ person_id: string; room_id: string }>,
  rooms: Array<{ id: string; room_type: string }>,
): Map<string, string[]> {
  const classRooms = new Set(rooms.filter((r) => r.room_type === 'class').map((r) => r.id));
  const out = new Map<string, string[]>();
  for (const a of assignments) {
    if (!classRooms.has(a.room_id)) continue;
    const list = out.get(a.person_id);
    if (list) {
      if (!list.includes(a.room_id)) list.push(a.room_id);
    } else out.set(a.person_id, [a.room_id]);
  }
  return out;
}

/** Header numbers: `absent` students missing from the file, out of `inClasses` students in the chosen classes. */
export function leaverCounts(
  students: HazuPerson[],
  matches: RowMatch[],
  decisions: CheckDecision[],
  classIdsOf: Map<string, string[]>,
  filter: ClassFilter | null,
): { absent: number; inClasses: number } {
  return {
    absent: findLeavers(students, matches, decisions, classIdsOf, filter).length,
    // No row matched, none doubtful: every student in the chosen classes counts.
    inClasses: findLeavers(students, [], [], classIdsOf, filter).length,
  };
}
