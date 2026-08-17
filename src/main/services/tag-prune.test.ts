import { describe, it, expect } from 'vitest';
import {
  classifyReadResult,
  buildPrunePlan,
  probeClassIds,
  runTagPrune,
  PruneDeletion,
  ReadOutcome,
  TagPruneDeps,
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

  // The reason this whole feature is gated on a 404 and nothing else. Measured 2026-08-17
  // against the live endpoint: a bad key returns 401 for an id that EXISTS and 404 for one
  // that does not. So a credentials failure cannot invent a 404 — but a 401 that meant
  // "deleted" would arm the prune against precisely the rooms that are still alive.
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

// --- Task 2 fixtures -------------------------------------------------------

const ok = (title?: string, parentId?: string): ReadOutcome => ({
  ok: true,
  networkOrTimeout: false,
  snapshot: { title, parentId },
});
const notFound = (): ReadOutcome => ({ ok: false, status: 404, networkOrTimeout: false });
const serverError = (): ReadOutcome => ({ ok: false, status: 500, networkOrTimeout: false });

// Scripted reads: each id maps to a queue of outcomes, consumed one per attempt. The last
// entry repeats once the queue runs dry, so a "always 500" id needs only one entry.
function scriptedReader(script: Record<string, ReadOutcome[]>) {
  const calls: string[] = [];
  const cursors: Record<string, number> = {};
  return {
    calls,
    readItem: async (id: string): Promise<ReadOutcome> => {
      calls.push(id);
      const queue = script[id];
      if (!queue || queue.length === 0) return notFound();
      const i = Math.min(cursors[id] ?? 0, queue.length - 1);
      cursors[id] = (cursors[id] ?? 0) + 1;
      return queue[i];
    },
  };
}

const noSleep = async () => {};

describe('probeClassIds', () => {
  it('retries a 500 and takes the later success', async () => {
    const r = scriptedReader({ A0000000000000000001: [serverError(), ok('Recovered Room')] });
    const out = await probeClassIds(['A0000000000000000001'], { readItem: r.readItem, sleep: noSleep });
    expect(out.get('A0000000000000000001')).toEqual({
      verdict: 'alive',
      title: 'Recovered Room',
      parentId: null,
    });
    expect(r.calls).toEqual(['A0000000000000000001', 'A0000000000000000001']);
  });

  it('never retries a 404 — one read per dead id', async () => {
    const r = scriptedReader({ A0000000000000000001: [notFound()] });
    const out = await probeClassIds(['A0000000000000000001'], { readItem: r.readItem, sleep: noSleep });
    expect(out.get('A0000000000000000001')?.verdict).toBe('deleted');
    expect(r.calls).toEqual(['A0000000000000000001']);
  });

  it('gives up after maxReadAttempts on a persistent 500', async () => {
    const r = scriptedReader({ A0000000000000000001: [serverError()] });
    const out = await probeClassIds(
      ['A0000000000000000001'],
      { readItem: r.readItem, sleep: noSleep },
      { maxReadAttempts: 3 },
    );
    expect(out.get('A0000000000000000001')?.verdict).toBe('unreadable');
    expect(r.calls).toHaveLength(3);
  });

  it('records a hard throw as unreadable and keeps probing the other ids', async () => {
    const calls: string[] = [];
    const readItem = async (id: string): Promise<ReadOutcome> => {
      calls.push(id);
      if (id === 'Boom0000000000000001') throw new Error('socket hang up');
      return notFound();
    };
    const out = await probeClassIds(
      ['Boom0000000000000001', 'B0000000000000000001'],
      { readItem, sleep: noSleep },
      { maxReadAttempts: 1 },
    );
    expect(out.get('Boom0000000000000001')?.verdict).toBe('unreadable');
    expect(out.get('B0000000000000000001')?.verdict).toBe('deleted');
    expect(calls).toContain('B0000000000000000001');
  });

  it('returns one verdict per id', async () => {
    const r = scriptedReader({});
    const out = await probeClassIds(['A0000000000000000001', 'B0000000000000000001'], {
      readItem: r.readItem,
      sleep: noSleep,
    });
    expect([...out.keys()]).toEqual(['A0000000000000000001', 'B0000000000000000001']);
  });
});

describe('runTagPrune', () => {
  const PERSON = 'Person00000000000001';
  const DEAD = 'Dead0000000000000001';
  const LIVE = 'Live0000000000000001';
  const DEAD_TAG = `hz-config-class-${DEAD}-student`;
  const LIVE_TAG = `hz-config-class-${LIVE}-student`;

  const target = (items: PruneDeletion['items']): PruneDeletion => ({ personId: PERSON, items });

  // Builds deps whose probe is scripted per id, whose delete reports a fixed outcome, and
  // whose profile re-read returns a fixed tag list (or null for "cannot verify").
  function deps(opts: {
    reads?: Record<string, ReadOutcome[]>;
    remove?: { ok: boolean; status?: number; networkOrTimeout?: boolean; error?: string };
    after?: string[] | null;
  }): TagPruneDeps & { removed: string[][] } {
    const r = scriptedReader(opts.reads ?? {});
    const removed: string[][] = [];
    return {
      removed,
      probe: r.readItem,
      removeTags: async (_personId, tags) => {
        removed.push(tags);
        const o = opts.remove ?? { ok: true };
        return { ok: o.ok, status: o.status, networkOrTimeout: o.networkOrTimeout ?? false, error: o.error };
      },
      readPersonTags: async () => (opts.after === undefined ? [] : opts.after),
      sleep: noSleep,
    };
  }

  it('deletes the tags of an id the re-probe confirms dead', async () => {
    const d = deps({ reads: { [DEAD]: [notFound()] }, after: [] });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d);
    expect(out.success).toBe(true);
    expect(out.deletedTags).toEqual([DEAD_TAG]);
    expect(d.removed).toEqual([[DEAD_TAG]]);
  });

  // The re-probe is the authorisation, not the plan. An id that came back alive since the
  // modal was shown must lose its tags from the delete set.
  it('drops an id whose re-probe returns alive, and still deletes the others', async () => {
    const d = deps({
      reads: { [DEAD]: [notFound()], [LIVE]: [ok('Back From The Dead', 'Parent00000000000001')] },
      after: [],
    });
    const out = await runTagPrune(
      target([
        { classId: DEAD, tags: [DEAD_TAG] },
        { classId: LIVE, tags: [LIVE_TAG] },
      ]),
      d,
    );
    expect(d.removed).toEqual([[DEAD_TAG]]);
    expect(out.deletedTags).toEqual([DEAD_TAG]);
    expect(out.skippedClassIds).toEqual([
      {
        classId: LIVE,
        verdict: 'alive',
        reason: expect.stringContaining('still exists'),
        title: 'Back From The Dead',
        parentId: 'Parent00000000000001',
        tagCount: 1,
      },
    ]);
  });

  it('drops an id whose re-probe is unreadable', async () => {
    const d = deps({ reads: { [DEAD]: [serverError()] }, after: [] });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d, {
      maxReadAttempts: 1,
    });
    expect(d.removed).toEqual([]);
    expect(out.skippedClassIds[0].verdict).toBe('unreadable');
  });

  // Nothing went wrong — the re-probe simply declined to confirm. An error here would train
  // the operator to ignore red rows.
  it('succeeds without deleting when every id drops', async () => {
    const d = deps({ reads: { [LIVE]: [ok('Still Here')] }, after: [] });
    const out = await runTagPrune(target([{ classId: LIVE, tags: [LIVE_TAG] }]), d);
    expect(out.success).toBe(true);
    expect(out.deletedTags).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('sends one DELETE carrying every confirmed tag for the person', async () => {
    const OTHER = 'Dead0000000000000002';
    const OTHER_TAG = `hz-config-class-${OTHER}-guardian`;
    const d = deps({ reads: { [DEAD]: [notFound()], [OTHER]: [notFound()] }, after: [] });
    await runTagPrune(
      target([
        { classId: DEAD, tags: [DEAD_TAG] },
        { classId: OTHER, tags: [OTHER_TAG] },
      ]),
      d,
    );
    expect(d.removed).toEqual([[DEAD_TAG, OTHER_TAG]]);
  });

  it('fails when the DELETE returns 2xx but the tag survives on re-read', async () => {
    const d = deps({ reads: { [DEAD]: [notFound()] }, after: [DEAD_TAG] });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d, {
      maxVerifyReads: 2,
    });
    expect(out.success).toBe(false);
    expect(out.deleteOk).toBe(true);
    expect(out.surviving).toEqual([DEAD_TAG]);
    expect(out.error).toContain(DEAD_TAG);
  });

  // Measured in S4: a transport failure carries no information about whether the write
  // committed. Only the re-read does.
  it('succeeds when the DELETE fails but the tag is gone on re-read', async () => {
    const d = deps({
      reads: { [DEAD]: [notFound()] },
      remove: { ok: false, status: 500, error: 'boom' },
      after: [],
    });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d);
    expect(out.success).toBe(true);
    expect(out.deleteOk).toBe(false);
    expect(out.verified).toBe(true);
    expect(out.deletedTags).toEqual([DEAD_TAG]);
  });

  it('falls back to the DELETE status when the profile re-read fails', async () => {
    const d = deps({ reads: { [DEAD]: [notFound()] }, after: null });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d);
    expect(out.verifyRan).toBe(false);
    expect(out.success).toBe(true);   // the DELETE returned 2xx
  });

  it('reports failure when the DELETE fails and the profile re-read fails too', async () => {
    const d = deps({
      reads: { [DEAD]: [notFound()] },
      remove: { ok: false, status: 500, error: 'boom' },
      after: null,
    });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d);
    expect(out.success).toBe(false);
    expect(out.error).toBe('boom');
  });

  it('retries a transient DELETE failure and stops at maxDeleteAttempts', async () => {
    const d = deps({
      reads: { [DEAD]: [notFound()] },
      remove: { ok: false, status: 503, error: 'unavailable' },
      after: [DEAD_TAG],
    });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d, {
      maxDeleteAttempts: 3,
      maxVerifyReads: 1,
    });
    expect(out.attempts).toBe(3);
    expect(out.success).toBe(false);
  });

  it('does not retry a 4xx DELETE', async () => {
    const d = deps({
      reads: { [DEAD]: [notFound()] },
      remove: { ok: false, status: 400, error: 'bad request' },
      after: [DEAD_TAG],
    });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d, {
      maxDeleteAttempts: 3,
      maxVerifyReads: 1,
    });
    expect(out.attempts).toBe(1);
  });
});
