import { describe, expect, it } from 'vitest';
import { crossCheck, fixesFor } from './cross-check';
import type { CheckInput, CheckRow } from './cross-check';
import type { RoomCategory } from './correspondence';

const roomCategory = new Map<string, RoomCategory>([
  ['clsA', 'class'], ['clsB', 'class'],
  ['co1', 'enterprise'], ['co2', 'enterprise'],
  ['st1', 'state'],
]);

function input(over: Partial<CheckInput> & { rows: CheckRow[] }): CheckInput {
  return {
    mapped: ['class', 'enterprise', 'state'],
    cellOf: (_c, v) => (v.startsWith('ign') ? { kind: 'ignored' } : { kind: 'room', roomId: v }),
    roomCategory,
    assignments: [],
    ...over,
  };
}
const asg = (person_id: string, room_id: string, role = 'student') => ({ person_id, room_id, role });

describe('crossCheck', () => {
  it('class named and held is ok', () => {
    const r = crossCheck(input({
      rows: [{ rowIndex: 2, personId: 'p1', cells: { class: 'clsA' } }],
      assignments: [asg('p1', 'clsA')],
    }));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ status: 'ok', roomId: 'clsA', category: 'class', key: 'p1|class|clsA' });
  });

  it('class named and not held is missing', () => {
    const r = crossCheck(input({ rows: [{ rowIndex: 2, personId: 'p1', cells: { class: 'clsA' } }] }));
    expect(r.lines.map((l) => l.status)).toEqual(['missing']);
    expect(r.counts.missing).toBe(1);
  });

  it('held with another role is other-role', () => {
    const r = crossCheck(input({
      rows: [{ rowIndex: 2, personId: 'p1', cells: { class: 'clsA' } }],
      assignments: [asg('p1', 'clsA', 'companymentor')],
    }));
    expect(r.lines[0]).toMatchObject({ status: 'other-role', hazuRole: 'companymentor' });
  });

  it('student in A and B, file says A: ok + extra, no multipleInHazu for classes', () => {
    const r = crossCheck(input({
      rows: [{ rowIndex: 2, personId: 'p1', cells: { class: 'clsA' } }],
      assignments: [asg('p1', 'clsA'), asg('p1', 'clsB')],
    }));
    expect(r.lines.map((l) => [l.roomId, l.status])).toEqual([['clsA', 'ok'], ['clsB', 'extra']]);
    const extra = r.lines[1];
    expect(extra.fileValue).toBeNull();
    expect(extra.multipleInHazu).toBeUndefined();
  });

  it('two companies in Hazu, file names one: ok + extra with multipleInHazu 2', () => {
    const r = crossCheck(input({
      rows: [{ rowIndex: 2, personId: 'p1', cells: { enterprise: 'co1' } }],
      assignments: [asg('p1', 'co1'), asg('p1', 'co2')],
    }));
    expect(r.lines.map((l) => [l.roomId, l.status])).toEqual([['co1', 'ok'], ['co2', 'extra']]);
    expect(r.lines[1].multipleInHazu).toBe(2);
  });

  it('empty company cell gives no enterprise line', () => {
    const r = crossCheck(input({
      rows: [{ rowIndex: 2, personId: 'p1', cells: { class: 'clsA' } }],
      assignments: [asg('p1', 'clsA'), asg('p1', 'co1')],
    }));
    expect(r.lines.filter((l) => l.category === 'enterprise')).toEqual([]);
  });

  it('unmapped category gives no lines even with a cell', () => {
    const r = crossCheck(input({
      mapped: ['class'],
      rows: [{ rowIndex: 2, personId: 'p1', cells: { class: 'clsA', state: 'st1' } }],
      assignments: [asg('p1', 'clsA')],
    }));
    expect(r.lines.map((l) => l.category)).toEqual(['class']);
  });

  it('ignored canton value is unverifiable and suppresses extras', () => {
    const r = crossCheck(input({
      rows: [{ rowIndex: 2, personId: 'p1', cells: { state: 'ignored-x' } }],
      assignments: [asg('p1', 'st1')],
    }));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ status: 'unverifiable', roomId: null, fileValue: 'ignored-x', key: 'p1|state|file:ignored-x' });
    expect(r.counts.unverifiable).toBe(1);
  });

  it('same person on two rows is merged', () => {
    const r = crossCheck(input({
      rows: [
        { rowIndex: 3, personId: 'p1', cells: { class: 'clsA' } },
        { rowIndex: 7, personId: 'p1', cells: { class: 'clsB' } },
      ],
      assignments: [asg('p1', 'clsA'), asg('p1', 'clsB')],
    }));
    expect(r.lines.map((l) => l.status)).toEqual(['ok', 'ok']);
    expect(r.lines[0].rowIndexes).toEqual([3, 7]);
    expect(r.duplicatePersons).toEqual(['p1']);
    expect(r.counts.students).toBe(1);
  });

  it('a cie assignment is never a line', () => {
    const r = crossCheck(input({
      rows: [{ rowIndex: 2, personId: 'p1', cells: { class: 'clsA' } }],
      assignments: [asg('p1', 'clsA'), asg('p1', 'cie1')],
    }));
    expect(r.lines).toHaveLength(1);
  });

  it('another person assignments and non-student roles do not create extras', () => {
    const r = crossCheck(input({
      rows: [{ rowIndex: 2, personId: 'p1', cells: { class: 'clsA' } }],
      assignments: [asg('p1', 'clsA'), asg('p1', 'clsB', 'schoolteacher'), asg('p2', 'clsB')],
    }));
    expect(r.lines.map((l) => l.status)).toEqual(['ok']);
  });

  it('sorts by person then category and counts match', () => {
    const r = crossCheck(input({
      rows: [
        { rowIndex: 2, personId: 'p2', cells: { class: 'clsA' } },
        { rowIndex: 3, personId: 'p1', cells: { state: 'ignored', class: 'clsA', enterprise: 'co1' } },
      ],
      assignments: [asg('p1', 'clsA'), asg('p1', 'clsB'), asg('p2', 'clsA', 'x')],
    }));
    expect(r.lines.map((l) => `${l.personId}|${l.category}|${l.status}`)).toEqual([
      'p1|class|ok', 'p1|class|extra', 'p1|enterprise|missing', 'p1|state|unverifiable', 'p2|class|other-role',
    ]);
    expect(r.counts).toEqual({ students: 2, ok: 1, missing: 1, extra: 1, unverifiable: 1, otherRole: 1 });
  });
});

describe('crossCheck hardening', () => {
  it('a named room of another type or unknown is unverifiable, never ok or missing', () => {
    const r = crossCheck(input({
      rows: [{ rowIndex: 2, personId: 'p1', cells: { class: 'cie1', state: 'clsA', enterprise: 'nowhere' } }],
      assignments: [asg('p1', 'cie1'), asg('p1', 'clsA')],
    }));
    expect(r.lines.map((l) => [l.category, l.status, l.roomId])).toEqual([
      ['class', 'unverifiable', null], ['enterprise', 'unverifiable', null], ['state', 'unverifiable', null],
    ]);
    expect(fixesFor(r.lines)).toEqual([]);
  });

  it('lines do not share one rowIndexes array', () => {
    const r = crossCheck(input({
      rows: [{ rowIndex: 2, personId: 'p1', cells: { class: 'clsA' } }],
      assignments: [asg('p1', 'clsA'), asg('p1', 'clsB')],
    }));
    expect(r.lines[0].rowIndexes).not.toBe(r.lines[1].rowIndexes);
  });

  it('ignored value on one row and resolved on another: no extra for a third held room', () => {
    const r = crossCheck(input({
      rows: [
        { rowIndex: 2, personId: 'p1', cells: { enterprise: 'ign-co' } },
        { rowIndex: 5, personId: 'p1', cells: { enterprise: 'co1' } },
      ],
      assignments: [asg('p1', 'co2')],
    }));
    expect(r.lines.map((l) => l.status).sort()).toEqual(['missing', 'unverifiable']);
  });
});

describe('fixesFor', () => {
  it('missing adds, extra removes, the rest nothing', () => {
    const r = crossCheck(input({
      rows: [{ rowIndex: 2, personId: 'p1', cells: { class: 'clsA', enterprise: 'co1', state: 'ign' } }],
      assignments: [asg('p1', 'clsB'), asg('p1', 'co1', 'companymentor')],
    }));
    expect(fixesFor(r.lines)).toEqual([
      { lineKey: 'p1|class|clsA', personId: 'p1', roomId: 'clsA', oldRole: '_', newRole: 'student' },
      { lineKey: 'p1|class|clsB', personId: 'p1', roomId: 'clsB', oldRole: 'student', newRole: '_' },
    ]);
  });
});
