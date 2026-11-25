import { describe, it, expect } from 'vitest';
import {
  nameKey,
  matchRows,
  resolvedPersonByRow,
  findLeavers,
  type HazuPerson,
  type SheetPerson,
} from './person-match';

const p = (id: string, displayName: string, email: string | null = null): HazuPerson => ({
  id,
  displayName,
  email,
});

describe('nameKey', () => {
  it('ignores case, accents, hyphens and word order', () => {
    expect(nameKey('Zoé-Anne  DUPONT')).toBe(nameKey('dupont zoe anne'));
  });
  it('is empty for blank input', () => {
    expect(nameKey('  - ')).toBe('');
  });
});

describe('matchRows', () => {
  it('matches equal e-mails ignoring case and spaces', () => {
    const persons = [p('a', 'Anna Keller', 'anna@example.invalid')];
    const rows: SheetPerson[] = [{ rowIndex: 0, email: '  Anna@Example.Invalid ' }];
    expect(matchRows(rows, persons)).toEqual([
      { kind: 'matched', rowIndex: 0, personId: 'a', by: 'email' },
    ]);
  });

  it('matches by name when the person e-mail is a UID and the names are swapped', () => {
    const persons = [p('a', 'Keller Anna', 'uid12345')];
    const rows: SheetPerson[] = [{ rowIndex: 3, firstName: 'Anna', lastName: 'Keller' }];
    expect(matchRows(rows, persons)).toEqual([
      { kind: 'matched', rowIndex: 3, personId: 'a', by: 'name' },
    ]);
  });

  it('flags a conflict when the e-mail hits A and the name equals B', () => {
    const persons = [
      p('a', 'Anna Keller', 'anna@example.invalid'),
      p('b', 'Lukas Brunner', 'lukas@example.invalid'),
    ];
    const rows: SheetPerson[] = [
      { rowIndex: 0, email: 'anna@example.invalid', fullName: 'Lukas Brunner' },
    ];
    expect(matchRows(rows, persons)).toEqual([
      { kind: 'check', rowIndex: 0, candidateIds: ['a', 'b'], reason: 'conflict' },
    ]);
  });

  it('sends an e-mail hit whose name disagrees to à vérifier (copy-down error), with A alone', () => {
    const persons = [p('a', 'Anna Keller', 'anna@example.invalid')];
    const rows: SheetPerson[] = [
      { rowIndex: 0, email: 'anna@example.invalid', fullName: 'Someone Else' },
    ];
    expect(matchRows(rows, persons)).toEqual([
      { kind: 'check', rowIndex: 0, candidateIds: ['a'], reason: 'conflict' },
    ]);
  });

  it('a disagreeing name lists A first, then near-name persons, without duplicates', () => {
    const persons = [
      p('a', 'Anna Keller', 'anna@example.invalid'),
      p('c', 'Lukas Brunner', 'lukas@example.invalid'),
    ];
    const rows: SheetPerson[] = [
      { rowIndex: 0, email: 'anna@example.invalid', fullName: 'Lukas Brunnerr' },
    ];
    expect(matchRows(rows, persons)).toEqual([
      { kind: 'check', rowIndex: 0, candidateIds: ['a', 'c'], reason: 'conflict' },
    ]);
  });

  it('keeps an e-mail hit when the name is near A', () => {
    const persons = [p('a', 'Anna Maria Keller', 'anna@example.invalid')];
    const rows: SheetPerson[] = [
      { rowIndex: 0, email: 'anna@example.invalid', fullName: 'Anna Keller' },
    ];
    expect(matchRows(rows, persons)).toEqual([
      { kind: 'matched', rowIndex: 0, personId: 'a', by: 'email' },
    ]);
  });

  it('keeps an e-mail hit when the row has no name', () => {
    const persons = [p('a', 'Anna Keller', 'anna@example.invalid')];
    const rows: SheetPerson[] = [{ rowIndex: 0, email: 'anna@example.invalid', fullName: '  ' }];
    expect(matchRows(rows, persons)).toEqual([
      { kind: 'matched', rowIndex: 0, personId: 'a', by: 'email' },
    ]);
  });

  it('flags two persons with the same name as ambiguous', () => {
    const persons = [p('a', 'Anna Keller'), p('b', 'Keller Anna')];
    const rows: SheetPerson[] = [{ rowIndex: 0, fullName: 'Anna Keller' }];
    expect(matchRows(rows, persons)).toEqual([
      { kind: 'check', rowIndex: 0, candidateIds: ['a', 'b'], reason: 'ambiguous' },
    ]);
  });

  it('flags a name that is a proper subset of another as near', () => {
    const persons = [p('a', 'Anna Maria Keller')];
    const rows: SheetPerson[] = [{ rowIndex: 0, fullName: 'Anna Keller' }];
    expect(matchRows(rows, persons)).toEqual([
      { kind: 'check', rowIndex: 0, candidateIds: ['a'], reason: 'near' },
    ]);
  });

  it('flags a one-typo long word as near, but not a short one', () => {
    const persons = [p('a', 'Lukas Brunner'), p('b', 'Lia Moser')];
    const rows: SheetPerson[] = [
      { rowIndex: 0, fullName: 'Lukas Brunnerr' },
      { rowIndex: 1, fullName: 'Lea Moser' },
    ];
    expect(matchRows(rows, persons)).toEqual([
      { kind: 'check', rowIndex: 0, candidateIds: ['a'], reason: 'near' },
      { kind: 'unknown', rowIndex: 1 },
    ]);
  });

  it('is unknown when both names are empty and there is no e-mail', () => {
    const persons = [p('a', '')];
    const rows: SheetPerson[] = [{ rowIndex: 0 }];
    expect(matchRows(rows, persons)).toEqual([{ kind: 'unknown', rowIndex: 0 }]);
  });

  it('lets two rows match the same student, who is then not a leaver', () => {
    const persons = [p('a', 'Anna Keller', 'anna@example.invalid')];
    const rows: SheetPerson[] = [
      { rowIndex: 0, email: 'anna@example.invalid' },
      { rowIndex: 1, fullName: 'Anna Keller' },
    ];
    const matches = matchRows(rows, persons);
    expect(matches.map((m) => m.kind)).toEqual(['matched', 'matched']);
    expect(findLeavers(persons, matches, [], new Map(), { all: true })).toEqual([]);
  });
});

describe('findLeavers', () => {
  const a = p('a', 'Anna Keller');
  const b = p('b', 'Zoe Dupont');
  const c = p('c', 'Max Muster');
  const classIdsOf = new Map<string, string[]>([
    ['a', ['k1']],
    ['b', ['k2']],
  ]);

  it('returns [] without a filter', () => {
    expect(findLeavers([a], [], [], classIdsOf, null)).toEqual([]);
  });

  it('keeps everyone with all, sorted by displayName', () => {
    expect(findLeavers([b, a, c], [], [], classIdsOf, { all: true }).map((x) => x.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('keeps students in selected classes only', () => {
    const f = { all: false as const, classIds: ['k1'], includeNoClass: false };
    expect(findLeavers([a, b, c], [], [], classIdsOf, f).map((x) => x.id)).toEqual(['a']);
  });

  it('keeps students without a class only with includeNoClass', () => {
    const f = { all: false as const, classIds: ['k1'], includeNoClass: true };
    expect(findLeavers([a, b, c], [], [], classIdsOf, f).map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('treats undecided check candidates as present, rejected ones as leavers', () => {
    const matches = [
      { kind: 'check' as const, rowIndex: 0, candidateIds: ['a'], reason: 'near' as const },
    ];
    const all = { all: true as const };
    expect(findLeavers([a], matches, [], new Map(), all)).toEqual([]);
    expect(findLeavers([a], matches, [{ rowIndex: 0, personId: null }], new Map(), all)).toEqual([a]);
    expect(findLeavers([a], matches, [{ rowIndex: 0, personId: 'a' }], new Map(), all)).toEqual([]);
  });
});

describe('resolvedPersonByRow', () => {
  it('includes matched rows and confirmed check rows only', () => {
    const matches = [
      { kind: 'matched' as const, rowIndex: 0, personId: 'a', by: 'email' as const },
      { kind: 'check' as const, rowIndex: 1, candidateIds: ['b', 'c'], reason: 'ambiguous' as const },
      { kind: 'check' as const, rowIndex: 2, candidateIds: ['d'], reason: 'near' as const },
      { kind: 'unknown' as const, rowIndex: 3 },
    ];
    const m = resolvedPersonByRow(matches, [
      { rowIndex: 1, personId: 'c' },
      { rowIndex: 2, personId: null },
    ]);
    expect([...m.entries()]).toEqual([
      [0, 'a'],
      [1, 'c'],
    ]);
  });
});

describe('decisions on unknown rows', () => {
  const matches = [
    { kind: 'matched' as const, rowIndex: 0, personId: 'a', by: 'email' as const },
    { kind: 'unknown' as const, rowIndex: 1 },
  ];
  const students = [p('a', 'Ana Test'), p('b', 'Bob Muster')];
  const all = { all: true as const };
  it('a decision on an unknown row resolves it', () => {
    const m = resolvedPersonByRow(matches, [{ rowIndex: 1, personId: 'b' }]);
    expect(m.get(1)).toBe('b');
  });
  it('the attached person leaves the leaver list', () => {
    expect(findLeavers(students, matches, [], new Map(), all).map((s) => s.id)).toEqual(['b']);
    expect(findLeavers(students, matches, [{ rowIndex: 1, personId: 'b' }], new Map(), all)).toEqual([]);
  });
  it('a null decision on an unknown row changes nothing', () => {
    const m = resolvedPersonByRow(matches, [{ rowIndex: 1, personId: null }]);
    expect([...m.entries()]).toEqual([[0, 'a']]);
  });
});
