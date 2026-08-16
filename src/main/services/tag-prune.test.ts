import { describe, it, expect } from 'vitest';
import {
  classifyReadResult,
  buildPrunePlan,
  UnmatchedClassId,
  Verdict,
} from './tag-prune';

const alive = (title: string | null = null, parentId: string | null = null): Verdict => ({
  verdict: 'alive',
  title,
  parentId,
});
const deleted = (): Verdict => ({ verdict: 'deleted', title: null, parentId: null });
const unreadable = (): Verdict => ({ verdict: 'unreadable', title: null, parentId: null });

const unmatched = (
  classId: string,
  holders: Array<{ personId: string; tags: string[] }>,
): UnmatchedClassId => ({
  classId,
  tagCount: holders.reduce((n, h) => n + h.tags.length, 0),
  personCount: holders.length,
  holders,
});

describe('classifyReadResult', () => {
  it('classifies an explicit 404 as deleted', () => {
    expect(classifyReadResult({ ok: false, status: 404, networkOrTimeout: false })).toEqual({
      verdict: 'deleted',
      title: null,
      parentId: null,
    });
  });

  it('classifies a 200 as alive, keeping the title and parent id', () => {
    expect(
      classifyReadResult({
        ok: true,
        networkOrTimeout: false,
        snapshot: { title: 'Some Room', parentId: 'Parent00000000000001' },
      }),
    ).toEqual({ verdict: 'alive', title: 'Some Room', parentId: 'Parent00000000000001' });
  });

  it('classifies a 200 with no usable snapshot as alive with null detail', () => {
    expect(classifyReadResult({ ok: true, networkOrTimeout: false })).toEqual({
      verdict: 'alive',
      title: null,
      parentId: null,
    });
  });

  it('classifies a 500 as unreadable', () => {
    expect(classifyReadResult({ ok: false, status: 500, networkOrTimeout: false }).verdict).toBe(
      'unreadable',
    );
  });

  it('classifies a network or timeout failure as unreadable', () => {
    expect(classifyReadResult({ ok: false, networkOrTimeout: true }).verdict).toBe('unreadable');
  });

  // The reason this whole feature is gated on a 404 and nothing else: an expired key
  // returns 401 for EVERY id, and a 401 that meant "deleted" would arm the prune
  // against every live tag in the set.
  it('classifies a 401 as unreadable, never deleted', () => {
    expect(classifyReadResult({ ok: false, status: 401, networkOrTimeout: false }).verdict).toBe(
      'unreadable',
    );
  });

  it('classifies a 403 as unreadable, never deleted', () => {
    expect(classifyReadResult({ ok: false, status: 403, networkOrTimeout: false }).verdict).toBe(
      'unreadable',
    );
  });
});

describe('buildPrunePlan', () => {
  const ID_A = 'Dead0000000000000001';
  const ID_B = 'Dead0000000000000002';
  const ID_LIVE = 'Live0000000000000001';
  const P1 = 'Person00000000000001';
  const P2 = 'Person00000000000002';
  const tagFor = (id: string, role = 'student') => `hz-config-class-${id}-${role}`;

  it('produces deletions only for ids the verdicts call deleted', () => {
    const plan = buildPrunePlan(
      [
        unmatched(ID_A, [{ personId: P1, tags: [tagFor(ID_A)] }]),
        unmatched(ID_LIVE, [{ personId: P2, tags: [tagFor(ID_LIVE)] }]),
      ],
      new Map([
        [ID_A, deleted()],
        [ID_LIVE, alive('A Live Room', 'Parent00000000000001')],
      ]),
    );
    expect(plan.deletions).toEqual([{ personId: P1, items: [{ classId: ID_A, tags: [tagFor(ID_A)] }] }]);
    expect(plan.skipped.map((s) => s.classId)).toEqual([ID_LIVE]);
  });

  it('reports an alive skip with its reason, title and parent id', () => {
    const plan = buildPrunePlan(
      [unmatched(ID_LIVE, [{ personId: P1, tags: [tagFor(ID_LIVE)] }])],
      new Map([[ID_LIVE, alive('A Live Room', 'Parent00000000000001')]]),
    );
    expect(plan.skipped).toEqual([
      {
        classId: ID_LIVE,
        verdict: 'alive',
        reason: expect.stringContaining('still exists'),
        title: 'A Live Room',
        parentId: 'Parent00000000000001',
        tagCount: 1,
      },
    ]);
  });

  it('reports an unreadable skip', () => {
    const plan = buildPrunePlan(
      [unmatched(ID_A, [{ personId: P1, tags: [tagFor(ID_A)] }])],
      new Map([[ID_A, unreadable()]]),
    );
    expect(plan.deletions).toEqual([]);
    expect(plan.skipped[0].verdict).toBe('unreadable');
  });

  // A verdict that never arrived is not a licence to delete.
  it('treats an id with no verdict at all as unreadable', () => {
    const plan = buildPrunePlan([unmatched(ID_A, [{ personId: P1, tags: [tagFor(ID_A)] }])], new Map());
    expect(plan.deletions).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ classId: ID_A, verdict: 'unreadable' });
  });

  it('groups one person holding tags for two dead rooms into a single deletion', () => {
    const plan = buildPrunePlan(
      [
        unmatched(ID_A, [{ personId: P1, tags: [tagFor(ID_A)] }]),
        unmatched(ID_B, [{ personId: P1, tags: [tagFor(ID_B, 'guardian')] }]),
      ],
      new Map([
        [ID_A, deleted()],
        [ID_B, deleted()],
      ]),
    );
    expect(plan.deletions).toHaveLength(1);
    expect(plan.deletions[0]).toEqual({
      personId: P1,
      items: [
        { classId: ID_A, tags: [tagFor(ID_A)] },
        { classId: ID_B, tags: [tagFor(ID_B, 'guardian')] },
      ],
    });
  });

  it('keeps two people holding tags for the same dead room in separate deletions', () => {
    const plan = buildPrunePlan(
      [
        unmatched(ID_A, [
          { personId: P1, tags: [tagFor(ID_A)] },
          { personId: P2, tags: [tagFor(ID_A, 'guardian')] },
        ]),
      ],
      new Map([[ID_A, deleted()]]),
    );
    expect(plan.deletions.map((d) => d.personId)).toEqual([P1, P2]);
  });

  it('counts tags, people and rooms across the whole plan', () => {
    const plan = buildPrunePlan(
      [
        unmatched(ID_A, [
          { personId: P1, tags: [tagFor(ID_A), tagFor(ID_A, 'guardian')] },
          { personId: P2, tags: [tagFor(ID_A)] },
        ]),
        unmatched(ID_B, [{ personId: P1, tags: [tagFor(ID_B)] }]),
        unmatched(ID_LIVE, [{ personId: P2, tags: [tagFor(ID_LIVE)] }]),
      ],
      new Map([
        [ID_A, deleted()],
        [ID_B, deleted()],
        [ID_LIVE, alive()],
      ]),
    );
    expect(plan.tagCount).toBe(4);   // 2 + 1 for ID_A, 1 for ID_B; the live one is not counted
    expect(plan.personCount).toBe(2);
    expect(plan.roomCount).toBe(2);
  });

  it('returns an empty plan for no unmatched ids', () => {
    expect(buildPrunePlan([], new Map())).toEqual({
      deletions: [],
      skipped: [],
      tagCount: 0,
      personCount: 0,
      roomCount: 0,
    });
  });
});
