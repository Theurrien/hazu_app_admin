import { describe, it, expect } from 'vitest';
import { filterRooms, filterPersons, TYPE_LABEL, formatArchivedAt, plainTitle } from './archive-logic';

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

describe('filterPersons', () => {
  const people = [
    { display_name: 'Élodie Muster', email: 'elodie@example.invalid', person_type: 'student' },
    { display_name: 'Hans Beispiel', email: 'hans@example.invalid', person_type: 'schoolteacher' },
    { display_name: 'Zoé Muster', email: null, person_type: 'student' },
  ];
  it('empty search and no type returns nothing', () => {
    expect(filterPersons(people, '', [])).toEqual([]);
    expect(filterPersons(people, '   ', [])).toEqual([]);
  });
  it('search ignores accents and case on the name', () => {
    expect(filterPersons(people, 'ELODIE', []).map((p) => p.display_name)).toEqual(['Élodie Muster']);
    expect(filterPersons(people, 'zoe', [])).toHaveLength(1);
  });
  it('search also matches the e-mail', () => {
    expect(filterPersons(people, 'hans@', [])).toHaveLength(1);
  });
  it('a type alone lists that type', () => {
    expect(filterPersons(people, '', ['student'])).toHaveLength(2);
  });
  it('combines type and search', () => {
    expect(filterPersons(people, 'muster', ['schoolteacher'])).toHaveLength(0);
    expect(filterPersons(people, 'muster', ['student'])).toHaveLength(2);
  });
});
