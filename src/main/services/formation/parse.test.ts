import { describe, it, expect } from 'vitest';
import {
  normalizeRow,
  childrenOf,
  normalizeTitle,
  facetFrom,
  extractHazuLinks,
  parsePoints,
  parseFeedback,
  timelineFacts,
} from './parse';

describe('normalizeRow', () => {
  it('reads the snapshot envelope', () => expect(normalizeRow({ snapshot: { key: 'a1', type: 'item', title: '<p>T</p>', tags: ['x'], dateCreated: 5 } })).toMatchObject({ id: 'a1', type: 'item', tags: ['x'], dateCreated: 5 }));
  it('reads the {id,data} envelope', () => expect(normalizeRow({ id: 'a2', data: { type: 'hazu', title: 'T' } })?.id).toBe('a2'));
  it('reads a bare row with key and no id', () => expect(normalizeRow({ key: 'a3', type: 'item' })?.id).toBe('a3'));
  it('resolves the author from authorId, then user.key, then user.id', () => {
    expect(normalizeRow({ key: 'k', user: { key: 'u1', displayName: 'Mentor Exemple' } })).toMatchObject({ authorId: 'u1', authorName: 'Mentor Exemple' });
  });
  it('returns null without any id', () => expect(normalizeRow({ type: 'item' })).toBeNull());
});

describe('childrenOf', () => {
  it('drops the parent row the API returns first', () => {
    expect(childrenOf('p', [{ key: 'p', type: 'hazu' }, { key: 'c', type: 'item' }]).map(r => r.id)).toEqual(['c']);
  });
});

describe('helpers', () => {
  it('normalizeTitle strips accents, case and extra whitespace', () => expect(normalizeTitle('<p>Mandats  Pratiques – Aperçu</p>')).toBe('mandats pratiques – apercu'));
  it('facetFrom returns the suffix of the first matching tag', () => {
    expect(facetFrom(['a', 'sem-2', 'sem-3'], 'sem-')).toBe('2');
    expect(facetFrom(['a'], 'sem-')).toBeNull();
  });
});

describe('timeline parsing', () => {
  it('extracts unique hazu.swiss ids', () => expect(extractHazuLinks('<a href="https://hazu.swiss/AbC1">x</a> hazu.swiss/AbC1 hazu.swiss/Z9')).toEqual(['AbC1', 'Z9']));
  it('parses decimal points with a comma', () => expect(parsePoints('<p>1,5 Points – bien</p>')).toBe(1.5));
  it('returns 0 for unparseable points', () => expect(parsePoints('aucun')).toBe(0));
  it('parses a trailing feedback', () => expect(parseFeedback('<p>2 Points</p><p><strong>Feedback</strong> : soigné</p>')).toBe('soigné'));
  it('emits one fact per (item, link) and ignores hazu rows', () => {
    const rows = [
      { id: 't1', parentId: 'tl', type: 'item', title: '', description: '2 Points <a href="https://hazu.swiss/c1">MPE 101</a> hazu.swiss/c2', tags: ['entreprise'], icon: null, color: null, dateCreated: 10, authorId: 'u1', authorName: 'A', order: null },
      { id: 'h1', parentId: 'tl', type: 'hazu', title: '', description: 'hazu.swiss/c3', tags: [], icon: null, color: null, dateCreated: 11, authorId: 'u1', authorName: 'A', order: null },
    ];
    expect(timelineFacts(rows).map(f => f.copyId)).toEqual(['c1', 'c2']);
    expect(timelineFacts(rows)[0]).toMatchObject({ points: 2, authorId: 'u1', dateMs: 10 });
  });
});
