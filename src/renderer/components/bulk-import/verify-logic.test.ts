import { describe, it, expect } from 'vitest';
import {
  canRunPersonCheck,
  canRunAssignmentDiff,
  sheetPersons,
  buildClassIdsOf,
  leaverCounts,
  type VerifyColumns,
} from './verify-logic';

const none: VerifyColumns = { email: null, firstName: null, lastName: null, fullName: null, room: null };

describe('canRunPersonCheck / canRunAssignmentDiff', () => {
  it('needs an e-mail, a full name, or first and last name', () => {
    expect(canRunPersonCheck(none)).toBe(false);
    expect(canRunPersonCheck({ ...none, firstName: 'A' })).toBe(false);
    expect(canRunPersonCheck({ ...none, lastName: 'B' })).toBe(false);
    expect(canRunPersonCheck({ ...none, firstName: 'A', lastName: 'B' })).toBe(true);
    expect(canRunPersonCheck({ ...none, fullName: 'N' })).toBe(true);
    expect(canRunPersonCheck({ ...none, email: 'E' })).toBe(true);
  });
  it('the assignment diff also needs the room column', () => {
    expect(canRunAssignmentDiff({ ...none, email: 'E' })).toBe(false);
    expect(canRunAssignmentDiff({ ...none, room: 'R' })).toBe(false);
    expect(canRunAssignmentDiff({ ...none, email: 'E', room: 'R' })).toBe(true);
  });
});

describe('sheetPersons', () => {
  const cols: VerifyColumns = { email: 'E', firstName: 'F', lastName: 'L', fullName: null, room: null };
  it('keeps rowIndex, drops rows with neither e-mail nor name', () => {
    const rows = [
      { E: 'a@example.invalid', F: 'Ana', L: 'Test' },
      { E: '  ', F: '', L: ' ' },
      { E: '', F: 'Bob', L: 'Muster' },
    ];
    expect(sheetPersons(rows, cols)).toEqual([
      { rowIndex: 0, email: 'a@example.invalid', firstName: 'Ana', lastName: 'Test', fullName: undefined },
      { rowIndex: 2, email: undefined, firstName: 'Bob', lastName: 'Muster', fullName: undefined },
    ]);
  });
  it('reads a full name column', () => {
    const r = sheetPersons([{ N: ' Ana Test ' }], { ...none, fullName: 'N' });
    expect(r).toEqual([{ rowIndex: 0, email: undefined, firstName: undefined, lastName: undefined, fullName: 'Ana Test' }]);
  });
  it('a first name without a last name column still counts as a name', () => {
    expect(sheetPersons([{ F: 'Ana' }], { ...none, firstName: 'F' })).toHaveLength(1);
  });
});

describe('buildClassIdsOf', () => {
  it('keeps only class rooms', () => {
    const rooms = [
      { id: 'c1', room_type: 'class' },
      { id: 'e1', room_type: 'enterprise' },
    ];
    const asg = [
      { person_id: 'p1', room_id: 'c1' },
      { person_id: 'p1', room_id: 'e1' },
      { person_id: 'p2', room_id: 'e1' },
    ];
    const m = buildClassIdsOf(asg, rooms);
    expect(m.get('p1')).toEqual(['c1']);
    expect(m.has('p2')).toBe(false);
  });
});

describe('leaverCounts', () => {
  const students = [
    { id: 'a', email: null, displayName: 'A' },
    { id: 'b', email: null, displayName: 'B' },
    { id: 'c', email: null, displayName: 'C' },
  ];
  const classIdsOf = new Map([['a', ['k1']], ['b', ['k1']], ['c', ['k2']]]);
  it('n absent of m in the chosen classes', () => {
    const matches = [{ kind: 'matched' as const, rowIndex: 0, personId: 'a', by: 'email' as const }];
    const f = { all: false as const, classIds: ['k1'], includeNoClass: false };
    expect(leaverCounts(students, matches, [], classIdsOf, f)).toEqual({ absent: 1, inClasses: 2 });
  });
  it('nothing chosen gives zeros', () => {
    expect(leaverCounts(students, [], [], classIdsOf, null)).toEqual({ absent: 0, inClasses: 0 });
  });
});

import { canShowLeavers, droppedRowCount, searchCandidates } from './verify-logic';

describe('canShowLeavers', () => {
  it('needs a name column, not just an e-mail', () => {
    expect(canShowLeavers({ ...none, email: 'E' })).toBe(false);
    expect(canShowLeavers({ ...none, firstName: 'F' })).toBe(false);
    expect(canShowLeavers({ ...none, fullName: 'N' })).toBe(true);
    expect(canShowLeavers({ ...none, firstName: 'F', lastName: 'L' })).toBe(true);
  });
});

describe('droppedRowCount', () => {
  it('counts rows with neither e-mail nor name', () => {
    const cols = { ...none, email: 'E', fullName: 'N' };
    const rows = [{ E: 'a@example.invalid', N: '' }, { E: ' ', N: ' ' }, { E: '', N: '' }];
    expect(droppedRowCount(rows, cols)).toBe(2);
  });
});

describe('searchCandidates', () => {
  const persons = [
    { id: '1', email: null, displayName: 'Zoé Dupont' },
    { id: '2', email: null, displayName: 'Zoe Durand' },
    { id: '3', email: null, displayName: 'Bob Muster' },
  ];
  it('needs at least 2 characters', () => {
    expect(searchCandidates(persons, 'z', new Set())).toEqual([]);
  });
  it('is accent-insensitive and skips claimed persons', () => {
    expect(searchCandidates(persons, 'zoe', new Set(['2'])).map((p) => p.id)).toEqual(['1']);
  });
  it('returns at most 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), email: null, displayName: `Aaa ${i}` }));
    expect(searchCandidates(many, 'aa', new Set())).toHaveLength(20);
  });
});
