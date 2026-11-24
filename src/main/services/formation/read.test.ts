import { describe, it, expect, vi } from 'vitest';
import { backoffMs } from '../role-write';
import {
  listWithRetry, readReference, readStudent, runPool, resolveSelfUid,
  MPE_CATALOGUE_ROOT, type ReadDeps,
} from './read';

type R = Record<string, any>;
const row = (id: string, o: R = {}) => ({ key: id, type: 'hazu', title: id, tags: [], dateCreated: 1, ...o });

/** Fake API: each listing carries the parent row first, as the live API does. */
function fake(tree: Record<string, R[]>, fail: Record<string, any> = {}, acls: Record<string, any[]> = {}) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const deps: ReadDeps = {
    async list(id) {
      calls.push(id);
      if (fail[id]) throw fail[id];
      return [row(id, { type: 'hazu', dateCreated: 777 }), ...(tree[id] ?? [])];
    },
    async acl(id) { return { data: acls[id] ?? [] }; },
    async sleep(ms) { sleeps.push(ms); },
  };
  return { deps, calls, sleeps };
}
const http = (status: number) => Object.assign(new Error('http ' + status), { response: { status }, isAxiosError: true });

describe('listWithRetry', () => {
  it('retries a 503 twice then succeeds', async () => {
    let n = 0;
    const sleeps: number[] = [];
    const deps: ReadDeps = {
      async list(id) { if (n++ < 2) throw http(503); return [row(id), row('c1')]; },
      async acl() { return { data: [] }; },
      async sleep(ms) { sleeps.push(ms); },
    };
    const out = await listWithRetry(deps, 'p');
    expect(out.map(r => r.id)).toEqual(['c1']);
    expect(n).toBe(3);
    expect(sleeps).toEqual([backoffMs(0), backoffMs(1)]);
  });
  it('throws a 404 at once', async () => {
    const { deps, calls } = fake({}, { p: http(404) });
    await expect(listWithRetry(deps, 'p')).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
  it('re-reads an empty listing once and counts the second empty', async () => {
    const { deps, calls } = fake({});
    const c = { emptyRetries: 0 };
    expect(await listWithRetry(deps, 'p', c)).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(c.emptyRetries).toBe(1);
  });
  it('counts every list call in counters.reads', async () => {
    const { deps } = fake({ p: [row('c')] });
    const c = { emptyRetries: 0, reads: 0 };
    await listWithRetry(deps, 'p', c);
    expect(c.reads).toBe(1);
  });
});

describe('resolveSelfUid', () => {
  it('returns a uid-looking tag value as is', () => expect(resolveSelfUid('uid123', [])).toBe('uid123'));
  it('matches an e-mail case-insensitively', () =>
    expect(resolveSelfUid('kid@example.invalid', [{ authorId: 'u9', description: 'Kid@Example.invalid' }])).toBe('u9'));
  it('returns null without a match', () => expect(resolveSelfUid('kid@example.invalid', [{ authorId: 'u9', description: 'x@example.invalid' }])).toBeNull());
  it('skips group entries', () =>
    expect(resolveSelfUid('kid@example.invalid', [{ authorId: 'g', description: 'kid@example.invalid', isGroup: true }])).toBeNull());
  it('null stays null', () => expect(resolveSelfUid(null, [])).toBeNull());
});

const mpeTags = (sem: number, man: string) => ['hz-config-mpe', 'hz-config-mpe-level-cfc', `hz-config-mpe-semester-${sem}`, `hz-config-mpe-mandate-${man}`];

function fullTree(): Record<string, R[]> {
  return {
    'prof-001': [
      row('study-co', { tags: ['hz-config-study-company'] }),
      row('study-cie', { title: 'Mandats CIE' }),
      row('suivi-co', { tags: ['hz-config-suivi-company'] }),
      row('suivi-cie', { title: 'CIE - Suivi' }),
      row('tl1', { tags: [] }),
    ],
    tl1: [row('t-a', { type: 'item', description: 'hazu.swiss/m1 3 Points Feedback : bien' })],
    'study-co': [row('m1', { tags: mpeTags(1, '1') }), row('import', { title: 'Import' })],
    import: [row('m2', { tags: mpeTags(2, '2') })],
    'study-cie': [row('c1', { tags: ['hz-config-mpc', 'hz-config-mpc-level-cfc', 'hz-config-mpc-semester-1', 'hz-config-mpc-mandate-1'] })],
    'suivi-co': [
      row('rep1', { tags: ['hz-config-report-company', 'hz-config-report-semester-1', 'hz-config-report-published'] }),
      row('plan1', { type: 'item', tags: ['hz-plan-settings', 'hz-plan-start-1700000000000'] }),
    ],
    'suivi-cie': [row('rc1', { tags: ['rap_cie', 'hz-config-cie-report-course9'] })],
  };
}
const P = { personId: 'prof-001', tags: ['hz-config-skills-timeline-tl1', 'hz-config-userid-uid123'] };

describe('readStudent', () => {
  it('reads a full profile', async () => {
    const { deps } = fake(fullTree());
    const s = await readStudent(deps, P);
    expect(s).toMatchObject({ ok: true, error: null, profileCreated: 777, userIdTag: 'uid123', selfUid: 'uid123', timelineOk: true });
    expect(s.facts.map(f => f.copyId)).toEqual(['m1']);
    expect(s.mpe.found).toBe(true);
    expect(s.mpe.copies.map(c => c.id).sort()).toEqual(['m1', 'm2']);
    expect(s.mpc.copies.map(c => c.id)).toEqual(['c1']);
    expect(s.reports.map(r => r.kind).sort()).toEqual(['cie', 'company']);
    expect(s.plan.startMs).toBe(1700000000000);
  });
  it('finds the timeline as the child tagged hz-config-skills without a pointer tag', async () => {
    const t = fullTree();
    t['prof-001'][4] = row('tl2', { tags: ['hz-config-skills'] });
    t.tl2 = t.tl1;
    const { deps } = fake(t);
    const s = await readStudent(deps, { personId: 'prof-001', tags: [] });
    expect(s.timelineOk).toBe(true);
    expect(s.facts).toHaveLength(1);
    expect(s.userIdTag).toBeNull();
  });
  it('reports ok:false when the profile listing throws', async () => {
    const { deps } = fake(fullTree(), { 'prof-001': http(404) });
    const s = await readStudent(deps, P);
    expect(s.ok).toBe(false);
    expect(s.error).toContain('404');
  });
  it('degrades only the timeline when its listing throws', async () => {
    const { deps } = fake(fullTree(), { tl1: http(401) });
    const s = await readStudent(deps, P);
    expect(s).toMatchObject({ ok: true, timelineOk: false, facts: [] });
    expect(s.mpe.found).toBe(true);
  });
  it('stops descent at depth 3 and warns once', async () => {
    const t = fullTree();
    t['study-co'] = [row('d1', { title: 'd1' })];
    t.d1 = [row('d2')]; t.d2 = [row('d3')]; t.d3 = [row('d4')]; t.d4 = [row('deep', { tags: mpeTags(1, '9') })];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { deps, calls } = fake(t);
    const s = await readStudent(deps, P);
    expect(s.mpe.copies).toEqual([]);
    expect(calls).not.toContain('d4');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it.each([
    ['timeline', 'tl1'], ['mpe', 'study-co'], ['mpc', 'study-cie'], ['suivi-company', 'suivi-co'], ['suivi-cie', 'suivi-cie'],
  ])('flags a failed %s part', async (part, id) => {
    const { deps } = fake(fullTree(), { [id]: http(503) });
    const s = await readStudent(deps, P);
    expect(s.ok).toBe(true);
    expect(s.failedParts).toEqual([part]);
    expect(s.error).toContain('503');
  });
  it('flags a failing nested mandate folder as the whole kind', async () => {
    const { deps } = fake(fullTree(), { import: http(503) });
    expect((await readStudent(deps, P)).failedParts).toEqual(['mpe']);
  });
  it('leaves failedParts empty on a clean read', async () => expect((await readStudent(fake(fullTree()).deps, P)).failedParts).toEqual([]));
  it('does not read the ACL for a non-e-mail identity', async () => {
    const { deps } = fake(fullTree());
    const acl = vi.spyOn(deps, 'acl');
    await readStudent(deps, P);
    expect(acl).not.toHaveBeenCalled();
  });
  it('counts reads', async () => {
    const { deps } = fake(fullTree());
    const c = { reads: 0 };
    await readStudent(deps, P, c);
    expect(c.reads).toBeGreaterThan(5);
  });
});

describe('readReference', () => {
  const slotTags = (k: 'mpe' | 'mpc', l: string, s: number, m: string) => [`hz-config-${k}`, `hz-config-${k}-level-${l}`, `hz-config-${k}-semester-${s}`, `hz-config-${k}-mandate-${m}`];
  const tree = (): Record<string, R[]> => ({
    [MPE_CATALOGUE_ROOT]: [
      row('f-cui', { icon: 'ic-cui', tags: ['hz-config-template-mpe-cui'] }),
      row('f-dhi', { icon: 'ic-dhi', tags: ['hz-config-template-mpe-dhi'] }),
      row('f-arch', { title: 'Archive', tags: ['hz-config-template-mpe-old'] }),
      row('f-none', { title: 'Misc' }),
    ],
    'f-cui': [row('s1', { tags: slotTags('mpe', 'cfc', 1, '1') }), row('sub', { title: 'Sub' }), row('a', { title: 'Archive' })],
    sub: [row('s2', { tags: slotTags('mpc', 'afp', 2, '3') })],
    a: [row('hidden', { tags: slotTags('mpe', 'cfc', 9, '9') })],
    'f-dhi': [row('s3', { tags: slotTags('mpe', 'afp', 1, '1') })],
    cfgA: [row('other')],
    cfgB: [
      row('prof', { tags: ['hz-config-professions'] }),
      row('lev', { tags: ['hz-config-levels'] }),
    ],
    prof: [row('p1', { title: '<p>Cuisine</p>', icon: 'ic-cui', order: 2 }), row('p2', { title: 'Hotellerie', icon: 'ic-dhi', order: 1 })],
    lev: [row('l1', { title: 'CFC', color: '#ABCDEF' })],
  });
  it('collects slots, skips archives and reads config from the first parent that has it', async () => {
    const { deps } = fake(tree());
    const ref = await readReference(deps, ['cfgA', 'cfgB']);
    expect(ref.slots.map(s => s.id).sort()).toEqual(['s1', 's2', 's3']);
    expect(ref.slots.find(s => s.id === 's2')).toMatchObject({ kind: 'mpc', profession: 'cui' });
    expect(ref.catalogueIcons).toEqual({ 'ic-cui': 'cui', 'ic-dhi': 'dhi' });
    expect(ref.professionsByIcon['ic-cui']).toEqual({ title: 'Cuisine', order: 2 });
    expect(ref.levelsByColor).toEqual({ '#abcdef': 'CFC' });
  });
  it('rejects when a profession subfolder listing keeps failing', async () => {
    const { deps } = fake(tree(), { sub: http(503) });
    await expect(readReference(deps, ['cfgB'])).rejects.toThrow();
  });
  it('rejects on an unreadable config parent instead of falling through', async () => {
    const { deps } = fake(tree(), { cfgA: http(503) });
    await expect(readReference(deps, ['cfgA', 'cfgB'])).rejects.toThrow();
  });
  it('throws when the catalogue root listing fails', async () => {
    const { deps } = fake(tree(), { [MPE_CATALOGUE_ROOT]: http(404) });
    await expect(readReference(deps, ['cfgB'])).rejects.toThrow();
  });
});

describe('runPool', () => {
  it('never exceeds the concurrency and keeps input order', async () => {
    let active = 0, peak = 0;
    const done: number[] = [];
    const out = await runPool([5, 1, 4, 2, 3], 2, async n => {
      active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, n));
      active--;
      return n * 10;
    }, n => done.push(n));
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
    expect(done).toEqual([1, 2, 3, 4, 5]);
  });
});
