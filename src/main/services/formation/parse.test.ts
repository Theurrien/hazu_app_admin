import { describe, it, expect } from 'vitest';
import type { Row } from '../../../shared/formation-types';
import {
  normalizeRow,
  childrenOf,
  normalizeTitle,
  normalizeHex,
  facetFrom,
  extractHazuLinks,
  parsePoints,
  parseFeedback,
  timelineFacts,
  isArchiveFolder,
  catalogueSlot,
  splitStudyChildren,
  companyReports,
  cieReports,
  planFacts,
  findStudyPlace,
  findSuiviCompany,
  pickIdTag,
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
  it('counts only item rows, as loadStudentTimeline does (any other type is ignored)', () => {
    const base = { parentId: 'tl', title: '', tags: [], icon: null, color: null, dateCreated: 1, authorId: 'u1', authorName: 'A', order: null };
    const rows = [
      { ...base, id: 'i1', type: 'item', description: '1 Point hazu.swiss/c1' },
      { ...base, id: 'f1', type: 'file', description: '1 Point hazu.swiss/c2' },
      { ...base, id: 'l1', type: '', description: '1 Point hazu.swiss/c3' },
    ];
    expect(timelineFacts(rows).map(f => f.copyId)).toEqual(['c1']);
  });
});

const row = (p: Partial<Row>): Row => ({ id: 'r', parentId: null, type: 'hazu', title: '', description: '', tags: [], icon: null, color: null, dateCreated: 0, authorId: null, authorName: null, order: null, ...p });
const MPE = ['hz-config-mpe', 'hz-config-mpe-semester-2', 'hz-config-mpe-mandate-03', 'hz-config-mpe-level-cfc'];

describe('normalizeRow author and timeline carry-overs', () => {
  it('prefers an explicit authorId over user.key', () => expect(normalizeRow({ key: 'k', authorId: 'a1', user: { key: 'u1' } })?.authorId).toBe('a1'));
  it('falls back to user.id', () => expect(normalizeRow({ key: 'k', user: { id: 'u2' } })?.authorId).toBe('u2'));
  it('timelineFacts uses Inconnu without a displayName and carries feedback', () => {
    const f = timelineFacts([row({ id: 't', type: 'item', description: '1 Points hazu.swiss/c1 Feedback : ok', authorId: 'u' })]);
    expect(f[0]).toMatchObject({ authorName: 'Inconnu', feedback: 'ok' });
  });
});

describe('catalogueSlot', () => {
  it('builds a slot from the facets', () => expect(catalogueSlot(row({ id: 'm1', title: 'MPE 1', tags: MPE }), 'mpe', 'cuisine')).toMatchObject({ id: 'm1', semester: 2, mandate: '03', level: 'cfc', profession: 'cuisine', kind: 'mpe' }));
  it('rejects an item', () => expect(catalogueSlot(row({ type: 'item', tags: MPE }), 'mpe', 'p')).toBeNull());
  it('rejects the sibling kind', () => expect(catalogueSlot(row({ tags: [...MPE, 'hz-config-mpc'] }), 'mpe', 'p')).toBeNull());
  it('rejects a row without a level', () => expect(catalogueSlot(row({ tags: MPE.filter(t => !t.includes('level')) }), 'mpe', 'p')).toBeNull());
});

describe('splitStudyChildren', () => {
  it('splits copies from folders and skips items and the overview', () => {
    const copy = row({ id: 'c1', tags: MPE });
    const r = splitStudyChildren([copy, row({ id: 'f1' }), row({ id: 'i1', type: 'item', tags: ['hz-config-mpe'] }), row({ id: 'o', title: 'Mandats pratiques - Aperçu et planification' })], 'mpe');
    expect(r.copies.map(c => c.id)).toEqual(['c1']);
    expect(r.copies[0]).toMatchObject({ semester: 2, mandate: '03', level: 'cfc' });
    expect(r.descend).toEqual(['f1']);
  });
  it('never descends into a room (a CIE course filed in the study place)', () => {
    const room = row({ id: 'course', tags: ['hz-config-room-cie', 'hz-config-class-cls-001'] });
    const r = splitStudyChildren([room, row({ id: 'f1' })], 'mpc');
    expect(r.descend).toEqual(['f1']);
    expect(r.copies).toEqual([]);
  });
});

describe('pickIdTag', () => {
  const P = 'hz-config-skills-timeline-';
  it('skips a composite tag and takes the bare id after it', () =>
    expect(pickIdTag([`${P}tl9-enable-x1`, `${P}tl1`], P)).toBe('tl1'));
  it('returns null when only composites (or an empty value) carry the prefix', () =>
    expect(pickIdTag([`${P}tl9-enable-x1`, P], P)).toBeNull());
  it('returns null without the prefix', () => expect(pickIdTag(['other'], P)).toBeNull());
});

describe('isArchiveFolder', () => {
  it('matches only Archive', () => {
    expect(isArchiveFolder(row({ title: ' Archive ' }))).toBe(true);
    expect(isArchiveFolder(row({ title: 'Archives 2024' }))).toBe(false);
  });
});

describe('reports', () => {
  it('parses a published company report', () => {
    const r = companyReports([
      row({ id: 'a', tags: ['hz-config-report-company', 'hz-config-report-semester-3', 'hz-config-report-published', 'hz-config-report-published-at-1700000000000'] }),
      row({ id: 'b', tags: ['hz-config-report-company', 'hz-config-report-staging'] }),
      row({ id: 'c', tags: ['hz-config-report-company'] }),
    ]);
    expect(r.map(x => x.id)).toEqual(['a', 'c']);
    expect(r[0]).toMatchObject({ kind: 'company', semester: 3, published: true, publishedAt: 1700000000000 });
    expect(r[1]).toMatchObject({ semester: null, published: false });
  });
  it('parses a sent CIE report', () => {
    expect(cieReports([row({ id: 'x', tags: ['rap_cie', 'hz-config-cie-report-crs1', 'hz-config-report-sent'] })])[0]).toMatchObject({ kind: 'cie', courseId: 'crs1', published: true });
  });
});

describe('planFacts', () => {
  const rec = (tags: string[], dateCreated: number) => row({ type: 'item', tags, dateCreated });
  it('takes the newest start', () => {
    expect(planFacts([rec(['hz-plan-settings', 'hz-plan-start-100'], 1), rec(['hz-plan-settings', 'hz-plan-start-200'], 2)]).startMs).toBe(200);
  });
  it('retires a skipped slot unless a newer clear follows', () => {
    const base = ['hz-plan-entry', 'hz-plan-kind-mandate'];
    const f = planFacts([
      rec([...base, 'hz-plan-slot-cfc-3-12', 'hz-plan-skip'], 5),
      rec([...base, 'hz-plan-slot-cfc-3-12', 'hz-plan-clear'], 6),
      rec([...base, 'hz-plan-slot-cfc-1-01', 'hz-plan-skip'], 1),
    ]);
    expect(f.retiredSlots).toEqual(['cfc-1-01']);
  });
  it('returns nulls for no records', () => expect(planFacts([])).toEqual({ startMs: null, retiredSlots: [] }));
});

describe('findStudyPlace', () => {
  const rows = [row({ id: 't', tags: ['tag-x'], title: 'Autre' }), row({ id: 'm', title: '<p>Mes Mandats Entreprise 2025</p>' })];
  it('prefers the tag', () => expect(findStudyPlace(rows, 'tag-x', 'mandats entreprise')?.id).toBe('t'));
  it('falls back to a title that contains the needle, as loadStudentMandates does', () =>
    expect(findStudyPlace(rows, 'nope', 'mandats entreprise')?.id).toBe('m'));
  it('returns null otherwise', () => expect(findStudyPlace(rows, 'nope', 'mandats cie')).toBeNull());
});

describe('findSuiviCompany', () => {
  const TAG = 'hz-config-suivi-company';
  it('takes a hazu carrying the tag', () =>
    expect(findSuiviCompany([row({ id: 'i', type: 'item', tags: [TAG] }), row({ id: 'h', tags: [TAG] })])?.id).toBe('h'));
  it('falls back to a fa-info hazu titled Entreprise - Suivi', () =>
    expect(findSuiviCompany([row({ id: 'x', title: 'Entreprise - Suivi' }), row({ id: 'y', title: 'Entreprise - Suivi', icon: 'fa-info' })])?.id).toBe('y'));
  it('never takes an item, nor a title match without the fa-info icon', () =>
    expect(findSuiviCompany([row({ id: 'i', type: 'item', tags: [TAG] }), row({ id: 'x', title: 'Entreprise - Suivi' })])).toBeNull());
});

describe('normalizeHex', () => {
  it('trims and lower-cases a colour', () => { expect(normalizeHex('  #9AD9EA\t')).toBe('#9ad9ea'); });
});
