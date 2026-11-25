import { describe, it, expect } from 'vitest';
import { filterRooms, TYPE_LABEL, formatArchivedAt, plainTitle } from './archive-logic';

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

describe('plainTitle', () => {
  it('strips tags and decodes entities', () => {
    expect(plainTitle('<p>A &amp; B&nbsp;&lt;c&gt; &quot;d&quot; l&#39;e</p>')).toBe('A & B <c> "d" l\'e');
  });
  it('decodes &amp; last', () => {
    expect(plainTitle('&amp;lt;')).toBe('&lt;');
  });
});

describe('filterRooms with HTML titles', () => {
  it('searches the plain text, not the markup', () => {
    const r = [{ roomType: 'class' as const, title: '<b>École</b> A &amp; B' }];
    expect(filterRooms(r, new Set(), 'ecole a & b')).toHaveLength(1);
    expect(filterRooms(r, new Set(), 'strong')).toHaveLength(0);
    expect(filterRooms(r, new Set(), '<b>')).toHaveLength(0);
  });
});
