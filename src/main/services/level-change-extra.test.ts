import { describe, it, expect } from 'vitest';
import { countDescendants, deleteSection, widgetDescription } from './level-change-extra';
import { sectionKey, type LcNode } from './level-change';

const node = (id: string, parentId: string | null, title = id): LcNode =>
  ({ id, parentId, title, description: '', tags: [], icon: 'i', color: '#000' });

function tree(map: Record<string, string[]>, failing: string[] = []) {
  return async (id: string): Promise<LcNode[]> => {
    if (failing.includes(id)) throw new Error('boom');
    return (map[id] ?? []).map(c => node(c, id));
  };
}

describe('countDescendants', () => {
  it('exact on a 3-level tree', async () => {
    const list = tree({ s: ['a', 'b'], a: ['a1', 'a2'], a1: ['a11'] });
    expect(await countDescendants('s', list, { remaining: 500 })).toEqual({ total: 5, exact: true });
  });
  it('a failing sub-listing is not exact; total is what was counted', async () => {
    const list = tree({ s: ['a', 'b'], a: ['a1'] }, ['b']);
    const r = await countDescendants('s', list, { remaining: 500 });
    expect(r.exact).toBe(false);
    expect(r.total).toBe(3);
  });
  it("the section's own listing failing gives null", async () => {
    expect(await countDescendants('s', tree({}, ['s']), { remaining: 500 })).toEqual({ total: null, exact: false });
  });
  it('exhausted budget is not exact and is shared', async () => {
    const list = tree({ s: ['a', 'b', 'c', 'd'] });
    const budget = { remaining: 2 };
    const r = await countDescendants('s', list, budget);
    expect(r).toEqual({ total: 2, exact: false });
    expect(budget.remaining).toBe(0);
    expect((await countDescendants('s', list, budget)).exact).toBe(false);
  });
  it('depth limit with deeper nodes is not exact', async () => {
    const map: Record<string, string[]> = {};
    for (let i = 0; i < 10; i++) map[`n${i}`] = [`n${i + 1}`];
    const r = await countDescendants('n0', tree(map), { remaining: 500 });
    expect(r.exact).toBe(false);
    expect(r.total).toBeGreaterThanOrEqual(6);
  });
});

describe('deleteSection', () => {
  const item = { sectionKey: sectionKey(node('sec', 'P', 'Extra')), sectionId: 'sec' };
  function mk(over: { live?: LcNode | null; removeFails?: boolean; goneAfterFail?: boolean; stays?: boolean; readLies?: boolean; emptyList?: boolean } = {}) {
    let removed = false;
    const calls: string[] = [];
    const live = over.live === undefined ? node('sec', 'P', 'Extra') : over.live;
    const deps = {
      read: async () => (removed && !over.readLies ? null : live),
      list: async (): Promise<LcNode[]> => (removed || !live || over.emptyList ? [] : [live]),
      sleep: async () => {},
      remove: async (id: string) => {
        calls.push(id);
        if (!over.stays) removed = true;
        if (over.removeFails) { const e: any = new Error('x'); e.status = 500; throw e; }
      },
    };
    return { deps, calls };
  }
  it('removes and verifies gone', async () => {
    const { deps, calls } = mk();
    expect(await deleteSection('P', item, new Set(), deps)).toEqual({ ok: true, problem: null });
    expect(calls).toEqual(['sec']);
  });
  it('parent not the profile: not removed', async () => {
    const { deps, calls } = mk({ live: node('sec', 'other') });
    const r = await deleteSection('P', item, new Set(), deps);
    expect(r.ok).toBe(false);
    expect(r.problem).toBeTruthy();
    expect(calls).toEqual([]);
  });
  it('key now in targetKeys: not removed', async () => {
    const live = node('sec', 'P', 'Extra');
    const { deps, calls } = mk({ live });
    const r = await deleteSection('P', item, new Set([sectionKey(live)]), deps);
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it('remove 500 but gone on re-list: ok', async () => {
    const { deps } = mk({ removeFails: true });
    expect((await deleteSection('P', item, new Set(), deps)).ok).toBe(true);
  });
  it('still present after removal: not ok', async () => {
    const { deps } = mk({ stays: true });
    const r = await deleteSection('P', item, new Set(), deps);
    expect(r.ok).toBe(false);
    expect(r.problem).toBeTruthy();
  });
  it('key changed since the preview: not removed', async () => {
    const { deps, calls } = mk({ live: node('sec', 'P', 'Renamed') });
    const r = await deleteSection('P', { sectionKey: 'old|i|#000', sectionId: 'sec' }, new Set(), deps);
    expect(r).toEqual({ ok: false, problem: 'section modifiée depuis l\'aperçu' });
    expect(calls).toEqual([]);
  });
  it('empty listing is not proof: node still readable => not ok', async () => {
    const { deps } = mk({ emptyList: true, stays: true });
    expect((await deleteSection('P', item, new Set(), deps)).ok).toBe(false);
  });
  it('already gone before removal: ok, no write', async () => {
    const { deps, calls } = mk({ live: null });
    expect(await deleteSection('P', item, new Set(), deps)).toEqual({ ok: true, problem: null });
    expect(calls).toEqual([]);
  });
});

describe('widgetDescription', () => {
  it('empty profile description takes the template', () => {
    expect(widgetDescription('', '<w/>')).toBe('<w/>');
    expect(widgetDescription('<p><br></p>', '<w/>')).toBe('<w/>');
  });
  it('otherwise profile text first', () => {
    expect(widgetDescription('<p>x</p>', '<w/>')).toBe('<p>x</p><w/>');
  });
});
