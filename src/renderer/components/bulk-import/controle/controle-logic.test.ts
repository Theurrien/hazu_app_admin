import { describe, it, expect } from 'vitest';
import {
  controleColumns,
  columnsReady,
  mappedCategories,
  checkRows,
  resetForNewFile,
  type ControleColumns,
} from './controle-logic';

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
