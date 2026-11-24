import { describe, it, expect } from 'vitest';
import { filterRooms, TYPE_LABEL, formatArchivedAt } from './archive-logic';

const rows = [
  { roomType: 'class' as const, title: 'École CUI 1' },
  { roomType: 'cie' as const, title: 'CIE 2026' },
  { roomType: 'enterprise' as const, title: 'Chez Alice' },
  { roomType: 'state' as const, title: 'Neuchâtel' },
];

describe('filterRooms', () => {
  it('keeps one type', () => {
    expect(filterRooms(rows, new Set(['cie']), '').map((r) => r.title)).toEqual(['CIE 2026']);
  });
  it('keeps two types', () => {
    expect(filterRooms(rows, new Set(['class', 'state']), '')).toHaveLength(2);
  });
  it('empty selection means all', () => {
    expect(filterRooms(rows, new Set(), '')).toHaveLength(4);
  });
  it('search ignores accents and case', () => {
    expect(filterRooms(rows, new Set(), 'ecole').map((r) => r.title)).toEqual(['École CUI 1']);
    expect(filterRooms(rows, new Set(), 'NEUCHATEL')).toHaveLength(1);
  });
  it('combines type and search', () => {
    expect(filterRooms(rows, new Set(['cie']), 'ecole')).toHaveLength(0);
  });
});

describe('TYPE_LABEL', () => {
  it('is exact', () => {
    expect(TYPE_LABEL).toEqual({ class: 'Classe', cie: 'CIE', enterprise: 'Entreprise', state: 'Canton' });
  });
});

describe('formatArchivedAt', () => {
  it('formats dd.mm.yyyy', () => {
    expect(formatArchivedAt(new Date(2026, 10, 4, 12).getTime())).toBe('04.11.2026');
  });
});
