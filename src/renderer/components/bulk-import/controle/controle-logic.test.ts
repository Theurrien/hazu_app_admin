import { describe, it, expect } from 'vitest';
import {
  controleColumns,
  columnsReady,
  mappedCategories,
  checkRows,
  resetForNewFile,
  openCount,
  linkFromDecision,
  roomCandidates,
  distinctRoomValues,
  applyStudentOverrides,
  type ControleColumns,
} from './controle-logic';
import type { RoomCategory, RoomResolution, StudentResolution } from '../../../../shared/correspondence';

describe('controleColumns', () => {
  it('reads the column names from the mappings', () => {
    expect(
      controleColumns({
        Mail: 'ctlEmail',
        Prénom: 'ctlFirstName',
        Nom: 'ctlLastName',
        Complet: 'ctlFullName',
        Cl: 'ctlClass',
        Ent: 'ctlCompany',
        Ct: 'ctlCanton',
        Autre: 'email',
      }),
    ).toEqual({
      email: 'Mail',
      firstName: 'Prénom',
      lastName: 'Nom',
      fullName: 'Complet',
      class: 'Cl',
      company: 'Ent',
      canton: 'Ct',
    });
  });
  it('is empty without mappings', () => {
    expect(controleColumns({})).toEqual({});
  });
});

describe('columnsReady', () => {
  it('asks for an identity first', () => {
    expect(columnsReady({ class: 'C' })).toEqual({ ok: false, reason: 'Choisissez une colonne e-mail ou nom.' });
    expect(columnsReady({})).toEqual({ ok: false, reason: 'Choisissez une colonne e-mail ou nom.' });
  });
  it('wants first and last name together', () => {
    const msg = 'Prénom et nom vont ensemble.';
    expect(columnsReady({ firstName: 'P', class: 'C' })).toEqual({ ok: false, reason: msg });
    expect(columnsReady({ lastName: 'N', class: 'C' })).toEqual({ ok: false, reason: msg });
  });
  it('accepts a lone first name when e-mail or full name carries the identity', () => {
    expect(columnsReady({ firstName: 'P', email: 'E', class: 'C' })).toEqual({ ok: true });
    expect(columnsReady({ lastName: 'N', fullName: 'F', class: 'C' })).toEqual({ ok: true });
  });
  it('wants at least one room column', () => {
    expect(columnsReady({ email: 'E' })).toEqual({
      ok: false,
      reason: 'Choisissez au moins une colonne classe, entreprise ou canton.',
    });
  });
  it('is ready with an identity and a room column', () => {
    expect(columnsReady({ firstName: 'P', lastName: 'N', canton: 'K' })).toEqual({ ok: true });
    expect(columnsReady({ fullName: 'F', company: 'E' })).toEqual({ ok: true });
  });
});

describe('mappedCategories', () => {
  it('orders class, enterprise, state', () => {
    expect(mappedCategories({ canton: 'K', company: 'E', class: 'C' })).toEqual(['class', 'enterprise', 'state']);
  });
  it('lists only the mapped ones', () => {
    expect(mappedCategories({ canton: 'K' })).toEqual(['state']);
    expect(mappedCategories({ email: 'E' })).toEqual([]);
  });
});

describe('checkRows', () => {
  const cols: ControleColumns = { email: 'Mail', fullName: 'Nom', class: 'Cl', company: 'Ent', canton: 'Ct' };
  it('trims values and drops empty cells', () => {
    const rows = [
      { Mail: ' a@example.invalid ', Nom: ' Ada Test ', Cl: ' CUI1 ', Ent: '   ', Ct: '' },
      { Mail: '', Nom: 'Bob Test', Cl: '', Ent: 'Firme', Ct: ' NE ' },
    ];
    const { sheet, cells } = checkRows(rows, cols);
    expect(sheet).toEqual([
      { rowIndex: 0, email: 'a@example.invalid', firstName: undefined, lastName: undefined, fullName: 'Ada Test' },
      { rowIndex: 1, email: undefined, firstName: undefined, lastName: undefined, fullName: 'Bob Test' },
    ]);
    expect(cells.get(0)).toEqual({ class: 'CUI1' });
    expect(cells.get(1)).toEqual({ enterprise: 'Firme', state: 'NE' });
  });
  it('leaves rows without identity out of the sheet and rows without cells out of the map', () => {
    const rows = [
      { Mail: '', Nom: '', Cl: 'X', Ent: '', Ct: '' },
      { Mail: 'c@example.invalid', Nom: '', Cl: '', Ent: '', Ct: '' },
    ];
    const { sheet, cells } = checkRows(rows, cols);
    expect(sheet.map((p) => p.rowIndex)).toEqual([1]);
    expect(cells.has(1)).toBe(false);
    expect(cells.get(0)).toEqual({ class: 'X' });
  });
});

describe('resetForNewFile', () => {
  it('is step 1 with no mappings and no ticks', () => {
    const s = resetForNewFile();
    expect(s.step).toBe(1);
    expect(s.mappings).toEqual({});
    expect(s.ticked.size).toBe(0);
  });
  it('returns fresh objects each time', () => {
    expect(resetForNewFile().mappings).not.toBe(resetForNewFile().mappings);
  });
});

describe('openCount', () => {
  it('counts what is not resolved', () => {
    expect(
      openCount([
        { kind: 'saved', hazuId: 'r1' },
        { kind: 'exact', hazuId: 'r2' },
        { kind: 'ignored' },
        { kind: 'stale', suggestionId: null },
        { kind: 'open', suggestionId: 'r3', twins: [] },
        { kind: 'matched', personId: 'p1' },
        { kind: 'check', candidateIds: ['p1'], reason: 'near' },
        { kind: 'unknown' },
        { kind: 'stale' },
      ]),
    ).toBe(5);
  });
  it('reads any iterable, e.g. map values', () => {
    const m = new Map<string, RoomResolution>([['a', { kind: 'open', suggestionId: null, twins: [] }]]);
    expect(openCount(m.values())).toBe(1);
    expect(openCount([])).toBe(0);
  });
});

describe('linkFromDecision', () => {
  it('builds a saved link stamped with now', () => {
    expect(linkFromDecision('class', 'cui 2a', 'CUI 2A', 'r1', 1234)).toEqual({
      category: 'class',
      fileKey: 'cui 2a',
      fileLabel: 'CUI 2A',
      hazuId: 'r1',
      decidedAt: 1234,
    });
  });
  it('keeps an ignored decision as null', () => {
    const l = linkFromDecision('student', 'email:a@example.invalid', 'Exemple Alice', null, 99);
    expect(l.hazuId).toBeNull();
    expect(l.decidedAt).toBe(99);
  });
});

describe('roomCandidates', () => {
  const rooms = [
    { id: 'cat', title: 'École professionnelle', room_type: 'class', parent_id: 'root' },
    { id: 'r1', title: 'CUI 2A', room_type: 'class', parent_id: 'cat' },
    { id: 'r2', title: 'Hôtel Exemple', room_type: 'enterprise', parent_id: 'gone' },
    { id: 'r3', title: 'Sans parent', room_type: 'class', parent_id: null },
  ];
  it('keeps the rooms of the type, with their parent title', () => {
    expect(roomCandidates(rooms, 'class')).toEqual([
      { id: 'cat', title: 'École professionnelle', parentTitle: null },
      { id: 'r1', title: 'CUI 2A', parentTitle: 'École professionnelle' },
      { id: 'r3', title: 'Sans parent', parentTitle: null },
    ]);
  });
  it('gives null when the parent is not a local room', () => {
    expect(roomCandidates(rooms, 'enterprise')).toEqual([{ id: 'r2', title: 'Hôtel Exemple', parentTitle: null }]);
  });
});

describe('distinctRoomValues', () => {
  it('one entry per room key, first spelling kept, in file order', () => {
    const cells = new Map<number, Partial<Record<RoomCategory, string>>>([
      [0, { class: 'CUI 2A', enterprise: 'Hôtel Exemple' }],
      [1, { class: 'cui  2a' }],
      [2, { class: 'RES 1B' }],
    ]);
    expect(distinctRoomValues(cells, 'class')).toEqual([
      { key: 'cui 2a', label: 'CUI 2A' },
      { key: 'res 1b', label: 'RES 1B' },
    ]);
    expect(distinctRoomValues(cells, 'state')).toEqual([]);
  });
});

describe('applyStudentOverrides', () => {
  it('replaces the resolution of overridden rows only', () => {
    const res = new Map<number, { res: StudentResolution; saveKey: string | null }>([
      [0, { res: { kind: 'check', candidateIds: ['p1', 'p2'], reason: 'ambiguous' }, saveKey: null }],
      [1, { res: { kind: 'unknown' }, saveKey: null }],
      [2, { res: { kind: 'matched', personId: 'p3' }, saveKey: 'email:c@example.invalid' }],
    ]);
    const out = applyStudentOverrides(res, new Map([[0, 'p2'], [1, null]]));
    expect(out.get(0)).toEqual({ res: { kind: 'matched', personId: 'p2' }, saveKey: null });
    expect(out.get(1)).toEqual({ res: { kind: 'ignored' }, saveKey: null });
    expect(out.get(2)).toEqual(res.get(2));
    expect(res.get(1)!.res.kind).toBe('unknown'); // input untouched
  });
});
