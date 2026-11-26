import { describe, it, expect } from 'vitest';
import {
  inviteRole, shareRoles, planAclFix, aclMatches, copySection,
  type CopyNode, type CopyDeps, type AclRow,
} from './level-change-copy';

const groups = new Map([['g-st', 'schoolteacher'], ['g-cm', 'companymentor']]);
const S = 'student-1';
const row = (authorId: string, role: string, isGroup = false, groupId: string | null = null): AclRow =>
  ({ authorId, groupId, isGroup, role });

describe('tags', () => {
  it('inviteRole', () => {
    expect(inviteRole(['x', 'hz-invite-self-admin'])).toBe('admin');
    expect(inviteRole(['x'])).toBeNull();
  });
  it('shareRoles', () => {
    expect(shareRoles(['hz-share-companymentor-editor', 'hz-share-schoolteacher-reader']))
      .toEqual(new Map([['companymentor', 'editor'], ['schoolteacher', 'reader']]));
  });
});

describe('planAclFix — rows classified by groupId, not isGroup', () => {
  it('student stored with isGroup:true is seen: raised when lower', () => {
    const rows = [row(S, 'reader', true, null)];
    expect(planAclFix(rows, ['hz-invite-self-admin'], groups, S).raiseStudent).toBe('admin');
  });
  it('student stored with isGroup:true at admin: no write, matches', () => {
    const rows = [row(S, 'admin', true, null)];
    expect(planAclFix(rows, ['hz-invite-self-admin'], groups, S)).toEqual({ raiseStudent: null, setGroups: [], removeGroups: [] });
    expect(aclMatches(rows, ['hz-invite-self-admin'], groups, S)).toBe(true);
  });
  it('person row with isGroup:true and no groupId is never removed', () => {
    const rows = [row('other', 'reader', true, null)];
    expect(planAclFix(rows, [], groups, S).removeGroups).toEqual([]);
    expect(aclMatches(rows, [], groups, S)).toBe(true);
  });
  it('a role group is recognised by groupId even with isGroup:false', () => {
    expect(planAclFix([row('a-st', 'reader', false, 'g-st')], [], groups, S).removeGroups).toEqual(['a-st']);
  });
});

describe('planAclFix', () => {
  it('raises a lower student', () => {
    const f = planAclFix([row(S, 'reader')], ['hz-invite-self-admin'], groups, S);
    expect(f.raiseStudent).toBe('admin');
  });
  it('never lowers', () => {
    expect(planAclFix([row(S, 'admin')], ['hz-invite-self-reader'], groups, S).raiseStudent).toBeNull();
  });
  it('unresolved student: no raise, unconfirmed', () => {
    const rows = [row('someone', 'reader')];
    expect(planAclFix(rows, ['hz-invite-self-admin'], groups, null).raiseStudent).toBeNull();
    expect(aclMatches(rows, ['hz-invite-self-admin'], groups, null)).toBe(false);
  });
  it('removes a role group without share tag', () => {
    const f = planAclFix([row('a-st', 'reader', true, 'g-st')], [], groups, S);
    expect(f.removeGroups).toEqual(['a-st']);
  });
  it('sets a group to the share role; no write when already right', () => {
    const tags = ['hz-share-companymentor-editor'];
    expect(planAclFix([row('a-cm', 'reader', true, 'g-cm')], tags, groups, S).setGroups)
      .toEqual([{ principalId: 'a-cm', role: 'editor' }]);
    const ok = planAclFix([row('a-cm', 'editor', true, 'g-cm')], tags, groups, S);
    expect(ok.setGroups).toEqual([]);
    expect(ok.removeGroups).toEqual([]);
  });
  it('leaves owner groups and other persons alone', () => {
    const rows = [row('own', 'owner', true, 'g-owner'), row('other', 'reader')];
    const f = planAclFix(rows, [], groups, S);
    expect(f).toEqual({ raiseStudent: null, setGroups: [], removeGroups: [] });
    expect(aclMatches(rows, [], groups, S)).toBe(true);
  });
});

// ---- copySection with an in-memory Hazu ------------------------------------------------------

const node = (id: string, parentId: string, title: string, over: Partial<CopyNode> = {}): CopyNode => ({
  id, parentId, type: 'hazu', title, description: `<p>${title}</p>`, icon: 'fa-x', color: '#111111',
  privacy: 'private', tags: [], rolesSettings: null, ...over,
});

function world() {
  const nodes = new Map<string, CopyNode>();
  const acls = new Map<string, AclRow[]>();
  let n = 0;
  const log = { creates: 0, setRole: [] as string[], removeAcl: [] as string[], removed: [] as string[] };
  const fail: { createTitle?: string; mode?: '4xx' | 'timeout-landed'; once: Set<string>; alwaysTimeout?: string; lag: number } = { once: new Set(), lag: 0 };
  const ignoreAcl = { on: false };
  const deps: CopyDeps = {
    async readFull(id) { return nodes.get(id) ?? null; },
    async listFull(p) {
      if (p === 'prof' && fail.lag > 0) { fail.lag--; return [...nodes.values()].filter(x => x.parentId === p && !x.id.startsWith('new-')); }
      return [...nodes.values()].filter(x => x.parentId === p);
    },
    async create(parentId, from) {
      log.creates++;
      const doCreate = () => {
        const id = `new-${++n}`;
        nodes.set(id, { ...from, id, parentId });
        acls.set(id, [row(S, 'reader'), row('a-st', 'reader', true, 'g-st'), row('own', 'owner', true, 'g-owner')]);
        return id;
      };
      if (fail.alwaysTimeout === from.title) {
        if (log.creates === 1) doCreate();
        throw { networkOrTimeout: true, message: 'timeout' };
      }
      if (fail.createTitle === from.title && !fail.once.has(from.title)) {
        fail.once.add(from.title);
        if (fail.mode === '4xx') throw { status: 400, networkOrTimeout: false, message: 'bad' };
        doCreate();
        throw { networkOrTimeout: true, message: 'timeout' };
      }
      return doCreate();
    },
    async remove(id) {
      log.removed.push(id);
      const drop = (i: string) => { for (const c of [...nodes.values()]) if (c.parentId === i) drop(c.id); nodes.delete(i); };
      drop(id);
    },
    async acl(id) { return acls.get(id) ?? []; },
    async setRole(id, p, role) {
      log.setRole.push(`${id}:${p}:${role}`);
      if (ignoreAcl.on) return;
      const rows = acls.get(id)!;
      const r = rows.find(x => x.authorId === p);
      if (r) r.role = role; else rows.push(row(p, role));
    },
    async removeFromAcl(id, p) {
      log.removeAcl.push(`${id}:${p}`);
      if (ignoreAcl.on) return;
      acls.set(id, acls.get(id)!.filter(x => x.authorId !== p));
    },
    async sleep() {},
  };
  nodes.set('prof', node('prof', 'root', 'Profile'));
  nodes.set('t-sec', node('t-sec', 'tpl', 'Learning FSRS', {
    tags: ['hz-config-legend', 'hz-invite-self-admin'], rolesSettings: { x: 1 }, icon: 'fa-brain', color: '#abcdef',
  }));
  nodes.set('t-c1', node('t-c1', 't-sec', 'Child', { tags: ['hz-share-companymentor-editor'] }));
  nodes.set('t-c2', node('t-c2', 't-c1', 'Grandchild'));
  return { nodes, acls, deps, log, fail, ignoreAcl };
}

describe('copySection', () => {
  it('copies the subtree with every field, aligns access, ok', async () => {
    const w = world();
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(true);
    const top = w.nodes.get(r.newId!)!;
    expect(top.parentId).toBe('prof');
    expect(top.tags).toEqual(['hz-config-legend', 'hz-invite-self-admin']);
    expect(top.rolesSettings).toEqual({ x: 1 });
    expect(top.icon).toBe('fa-brain');
    const kids = [...w.nodes.values()].filter(x => x.parentId === r.newId);
    expect(kids.map(k => k.title)).toEqual(['Child']);
    const gk = [...w.nodes.values()].filter(x => x.parentId === kids[0].id);
    expect(gk.map(k => k.title)).toEqual(['Grandchild']);
    // student raised on the top node; reader group removed (no share tag); owner untouched
    expect(w.acls.get(r.newId!)!.find(x => x.authorId === S)!.role).toBe('admin');
    expect(w.acls.get(r.newId!)!.some(x => x.authorId === 'a-st')).toBe(false);
    expect(w.acls.get(r.newId!)!.some(x => x.authorId === 'own')).toBe(true);
    // Child: share tag companymentor-editor, schoolteacher reader removed
    expect(w.acls.get(kids[0].id)!.some(x => x.authorId === 'a-st')).toBe(false);
  });

  it('does not write when the access is already right', async () => {
    const w = world();
    const orig = w.deps.create;
    w.deps.create = async (p, f) => {
      const id = await orig(p, f);
      w.acls.set(id, [row(S, 'admin'), row('own', 'owner', true, 'g-owner')]);
      return id;
    };
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(true);
    expect(w.log.setRole).toEqual([]);
    expect(w.log.removeAcl).toEqual([]);
  });

  it('a failing child create removes the fresh copy', async () => {
    const w = world();
    w.fail.createTitle = 'Grandchild'; w.fail.mode = '4xx';
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['copie incomplète — supprimée, à refaire']);
    expect([...w.nodes.values()].filter(x => x.parentId === 'prof')).toEqual([]);
    expect(w.log.removed.length).toBe(1);
  });

  it('a timed-out top-level create that landed is adopted, not repeated', async () => {
    const w = world();
    w.fail.createTitle = 'Learning FSRS'; w.fail.mode = 'timeout-landed';
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(true);
    expect([...w.nodes.values()].filter(x => x.parentId === 'prof').length).toBe(1);
    // 3 nodes in the subtree, the top create called once
    expect(w.log.creates).toBe(3);
  });

  it('access not confirmed after 3 reads: ok false naming the node, copy kept', async () => {
    const w = world();
    w.ignoreAcl.on = true;
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain('Learning FSRS');
    expect(w.nodes.has(r.newId!)).toBe(true);
  });

  it('student unresolved with an invite tag: unconfirmed, copy kept', async () => {
    const w = world();
    const r = await copySection('t-sec', 'prof', w.deps, groups, null);
    expect(r.ok).toBe(false);
    expect(r.problems.some(p => p.includes('Learning FSRS'))).toBe(true);
    expect(w.nodes.has(r.newId!)).toBe(true);
  });

  it('every create times out, the first landed but is visible only late: adopted, one node, no orphan', async () => {
    const w = world();
    w.fail.alwaysTimeout = 'Learning FSRS';
    w.fail.lag = 4; // snapshot + first attempt's 3 re-lists blind; the second attempt's first re-list sees it
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(true);
    expect(w.log.creates).toBe(2 + 2); // 2 top attempts + child + grandchild
    expect([...w.nodes.values()].filter(x => x.parentId === 'prof').length).toBe(1);
  });

  it('every create times out, the landed node never shows during re-lists: swept and removed', async () => {
    const w = world();
    w.fail.alwaysTimeout = 'Learning FSRS';
    w.fail.lag = 10; // snapshot + 3 attempts x 3 re-lists; the final sweep sees it
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['copie incomplète — supprimée, à refaire']);
    expect(w.log.removed.length).toBe(1);
    expect([...w.nodes.values()].filter(x => x.parentId === 'prof')).toEqual([]);
  });

  it('a lagging listing: first re-list misses, second finds, no resend', async () => {
    const w = world();
    w.fail.createTitle = 'Learning FSRS'; w.fail.mode = 'timeout-landed';
    w.fail.lag = 2; // the initial snapshot read is call 1 (consumes one lag), re-list 1 misses, re-list 2 finds
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(true);
    expect(w.log.creates).toBe(3);
    expect([...w.nodes.values()].filter(x => x.parentId === 'prof').length).toBe(1);
  });

  it('a duplicate fresh node of the same key is removed after the copy', async () => {
    const w = world();
    const orig = w.deps.create;
    let done = false;
    w.deps.create = async (p, f) => {
      const id = await orig(p, f);
      if (!done && f.id === 't-sec') {
        done = true;
        w.nodes.set('stray', { ...f, id: 'stray', parentId: p });
      }
      return id;
    };
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(w.nodes.has('stray')).toBe(false);
    expect(r.problems).toContain('doublon de la copie supprimé');
  });

  it('a created node whose privacy differs from the template is a partial copy, removed', async () => {
    const w = world();
    const orig = w.deps.create;
    w.deps.create = async (p, f) => {
      const id = await orig(p, f);
      if (f.id === 't-c1') w.nodes.set(id, { ...w.nodes.get(id)!, privacy: 'public' });
      return id;
    };
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['copie incomplète — supprimée, à refaire']);
    expect([...w.nodes.values()].filter(x => x.parentId === 'prof')).toEqual([]);
  });

  it('a created node whose type differs from the template is a partial copy, removed', async () => {
    const w = world();
    const orig = w.deps.create;
    w.deps.create = async (p, f) => {
      const id = await orig(p, f);
      w.nodes.set(id, { ...w.nodes.get(id)!, type: 'item' });
      return id;
    };
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(false);
    expect([...w.nodes.values()].filter(x => x.parentId === 'prof')).toEqual([]);
  });

  it('a source with no type and no privacy is not checked on them', async () => {
    const w = world();
    for (const id of ['t-sec', 't-c1', 't-c2']) w.nodes.set(id, { ...w.nodes.get(id)!, type: '', privacy: null });
    const orig = w.deps.create;
    w.deps.create = async (p, f) => {
      const id = await orig(p, f);
      w.nodes.set(id, { ...w.nodes.get(id)!, type: 'hazu', privacy: 'unlisted' });
      return id;
    };
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(true);
  });
});

describe('planAclFix — principal guards', () => {
  it('never removes or re-roles the student through a role group without a share tag', () => {
    const f = planAclFix([row(S, 'reader', true, 'g-st')], [], groups, S);
    expect(f.removeGroups).toEqual([]);
    expect(f.setGroups).toEqual([]);
  });
  it('never emits an empty principal', () => {
    const f = planAclFix([row('', 'reader', true, 'g-st'), row('', 'reader', true, 'g-cm')], ['hz-share-companymentor-editor'], groups, S);
    expect(f).toEqual({ raiseStudent: null, setGroups: [], removeGroups: [] });
  });
});
