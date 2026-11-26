import { describe, expect, it } from 'vitest';
import {
  isResolved,
  resolveRoomValues,
  resolveStudents,
  resolvedId,
  roomKey,
  studentKeys,
} from './correspondence';
import type { RoomCandidate, SavedLink } from './correspondence';
import { nameKey } from './person-match';
import type { HazuPerson } from './person-match';

const link = (category: SavedLink['category'], fileKey: string, hazuId: string | null): SavedLink => ({
  category,
  fileKey,
  fileLabel: fileKey,
  hazuId,
  decidedAt: 1,
});
const room = (id: string, title: string): RoomCandidate => ({ id, title, parentTitle: null });
const none = () => null;
const person = (id: string, displayName: string, email: string | null = null): HazuPerson => ({
  id,
  displayName,
  email,
});

describe('keys', () => {
  it('roomKey ignores case and spacing, keeps accents', () => {
    expect(roomKey(' Cui  2a ')).toBe(roomKey('CUI 2A'));
    expect(roomKey('Écully')).not.toBe(roomKey('Ecully'));
  });
  it('studentKeys lists e-mail then name', () => {
    expect(
      studentKeys({ rowIndex: 0, email: 'A.B@Example.invalid', firstName: 'Ana', lastName: 'Bé' }),
    ).toEqual(['email:a.b@example.invalid', `name:${nameKey('Ana Bé')}`]);
    expect(studentKeys({ rowIndex: 0, firstName: 'Ana', lastName: 'Bé' })).toEqual([
      `name:${nameKey('Ana Bé')}`,
    ]);
  });
});

describe('resolveRoomValues', () => {
  const rooms = [room('r1', 'CUI 2A'), room('r2', 'CUI 2B')];
  it('saved link wins over an exact title', () => {
    const m = resolveRoomValues('class', ['CUI 2A'], rooms, [link('class', 'cui 2a', 'r2')], none);
    expect(m.get('cui 2a')).toEqual({ kind: 'saved', hazuId: 'r2' });
  });
  it('saved null is ignored; missing id is stale with a suggestion', () => {
    const m = resolveRoomValues(
      'class',
      ['x', 'y'],
      rooms,
      [link('class', 'x', null), link('class', 'y', 'gone')],
      () => 'CUI 2B',
    );
    expect(m.get('x')).toEqual({ kind: 'ignored' });
    expect(m.get('y')).toEqual({ kind: 'stale', suggestionId: 'r2' });
  });
  it('links are per category', () => {
    const m = resolveRoomValues('enterprise', ['CUI 2A'], rooms, [link('class', 'cui 2a', 'r2')], none);
    expect(m.get('cui 2a')).toEqual({ kind: 'exact', hazuId: 'r1' });
  });
  it('exact on one title; twins stay open', () => {
    expect(resolveRoomValues('class', [' cui 2a'], rooms, [], none).get('cui 2a')).toEqual({
      kind: 'exact',
      hazuId: 'r1',
    });
    const twins = [room('a', 'CUI 2A'), room('b', 'CUI 2A')];
    expect(resolveRoomValues('class', ['CUI 2A'], twins, [], () => 'CUI 2A').get('cui 2a')).toEqual({
      kind: 'open',
      suggestionId: null,
      twins: ['a', 'b'],
    });
  });
  it('no match → open with the suggestion', () => {
    expect(resolveRoomValues('class', ['CUI 2C'], rooms, [], () => 'CUI 2B').get('cui 2c')).toEqual({
      kind: 'open',
      suggestionId: 'r2',
      twins: [],
    });
  });
});

describe('resolveStudents', () => {
  const students = [
    person('p1', 'Ana Bé', 'ana@example.invalid'),
    person('p2', 'Carl Dumont', 'carl@example.invalid'),
  ];
  it('saved link → saved', () => {
    const rows = [{ rowIndex: 0, fullName: 'Zed Qux' }];
    const m = resolveStudents(rows, students, [link('student', `name:${nameKey('Zed Qux')}`, 'p2')]);
    expect(m.get(0)?.res).toEqual({ kind: 'saved', personId: 'p2' });
  });
  it('saved person no longer a student → stale', () => {
    const rows = [{ rowIndex: 0, fullName: 'Zed Qux' }];
    const m = resolveStudents(rows, students, [link('student', `name:${nameKey('Zed Qux')}`, 'gone')]);
    expect(m.get(0)?.res).toEqual({ kind: 'stale' });
  });
  it('saved null → ignored', () => {
    const rows = [{ rowIndex: 0, fullName: 'Zed Qux' }];
    const m = resolveStudents(rows, students, [link('student', `name:${nameKey('Zed Qux')}`, null)]);
    expect(m.get(0)?.res).toEqual({ kind: 'ignored' });
  });
  it('saved link contradicted by the e-mail → conflict', () => {
    const rows = [{ rowIndex: 0, email: 'Carl@Example.invalid', fullName: 'Ana Bé' }];
    const m = resolveStudents(rows, students, [link('student', `name:${nameKey('Ana Bé')}`, 'p1')]);
    expect(m.get(0)?.res).toEqual({ kind: 'check', candidateIds: ['p1', 'p2'], reason: 'conflict' });
  });
  it('no link → matcher result, saveKey first key', () => {
    const rows = [{ rowIndex: 0, email: 'ana@example.invalid', fullName: 'Ana Bé' }];
    const r = resolveStudents(rows, students, []).get(0);
    expect(r?.res).toEqual({ kind: 'matched', personId: 'p1' });
    expect(r?.saveKey).toBe('email:ana@example.invalid');
  });
  it('rows sharing a name without e-mail ignore the name link and get no saveKey', () => {
    const twins = [person('p3', 'Ana Bé'), person('p4', 'Ana Bé')];
    const rows = [
      { rowIndex: 0, fullName: 'Ana Bé' },
      { rowIndex: 1, fullName: 'Ana Bé' },
    ];
    const m = resolveStudents(rows, twins, [link('student', `name:${nameKey('Ana Bé')}`, 'p3')]);
    for (const i of [0, 1]) {
      expect(m.get(i)?.saveKey).toBeNull();
      expect(m.get(i)?.res.kind).toBe('check');
    }
  });
});

describe('isResolved / resolvedId', () => {
  it('classifies kinds', () => {
    expect(isResolved({ kind: 'saved', hazuId: 'a' })).toBe(true);
    expect(isResolved({ kind: 'exact', hazuId: 'a' })).toBe(true);
    expect(isResolved({ kind: 'matched', personId: 'a' })).toBe(true);
    expect(isResolved({ kind: 'ignored' })).toBe(true);
    expect(isResolved({ kind: 'stale' })).toBe(false);
    expect(isResolved({ kind: 'open', suggestionId: null, twins: [] })).toBe(false);
    expect(isResolved({ kind: 'check', candidateIds: [], reason: 'near' })).toBe(false);
    expect(isResolved({ kind: 'unknown' })).toBe(false);
  });
  it('resolvedId', () => {
    expect(resolvedId({ kind: 'exact', hazuId: 'a' })).toBe('a');
    expect(resolvedId({ kind: 'saved', personId: 'b' })).toBe('b');
    expect(resolvedId({ kind: 'matched', personId: 'c' })).toBe('c');
    expect(resolvedId({ kind: 'ignored' })).toBeNull();
    expect(resolvedId({ kind: 'unknown' })).toBeNull();
  });
});
