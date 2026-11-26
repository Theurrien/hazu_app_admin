import { describe, it, expect } from 'vitest';
import {
  inviteRole, shareRoles, planAclFix, aclMatches, accessState, baselineOf, copySection,
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

const NOFIX = { raiseStudent: null, detachGroups: [], mismatchedGroups: [], blocked: false };

describe('planAclFix — rows classified by groupId, not isGroup', () => {
  it('student stored with isGroup:true is seen: raised when lower', () => {
    const rows = [row(S, 'reader', true, null)];
    expect(planAclFix(rows, ['hz-invite-self-admin'], groups, S).raiseStudent).toBe('admin');
  });
  it('student stored with isGroup:true at admin: no write, matches', () => {
    const rows = [row(S, 'admin', true, null)];
    expect(planAclFix(rows, ['hz-invite-self-admin'], groups, S)).toMatchObject(NOFIX);
    expect(aclMatches(rows, ['hz-invite-self-admin'], groups, S)).toBe(true);
  });
  it('person row with isGroup:true and no groupId is never detached', () => {
    const rows = [row('other', 'reader', true, null)];
    expect(planAclFix(rows, [], groups, S).detachGroups).toEqual([]);
    expect(aclMatches(rows, [], groups, S)).toBe(true);
  });
  it('a role group is recognised by groupId even with isGroup:false', () => {
    expect(planAclFix([row('a-st', 'reader', false, 'g-st')], [], groups, S).detachGroups).toEqual(['g-st']);
  });
});

describe('planAclFix (R12: whole groups by groupId)', () => {
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
  it('per-member rows of a role group without share tag → one detach of that groupId', () => {
    const rows = [row('a1', 'reader', true, 'g-st'), row('a2', 'reader', true, 'g-st'), row('a3', 'editor', true, 'g-st')];
    expect(planAclFix(rows, [], groups, S).detachGroups).toEqual(['g-st']);
  });
  it('a group at the wrong share role: never written, reported as mismatched', () => {
    const tags = ['hz-share-companymentor-editor'];
    const f = planAclFix([row('a-cm', 'reader', true, 'g-cm'), row('b-cm', 'editor', true, 'g-cm')], tags, groups, S);
    expect(f.detachGroups).toEqual([]);
    expect(f.raiseStudent).toBeNull();
    expect(f.mismatchedGroups).toEqual([{ groupId: 'g-cm', role: 'companymentor' }]);
    const ok = planAclFix([row('a-cm', 'editor', true, 'g-cm')], tags, groups, S);
    expect(ok).toMatchObject(NOFIX);
  });
  it('leaves owner groups and other persons alone', () => {
    const rows = [row('own', 'owner', true, 'g-owner'), row('other', 'reader')];
    expect(planAclFix(rows, [], groups, S)).toMatchObject(NOFIX);
    expect(aclMatches(rows, [], groups, S)).toBe(true);
  });
  it('student only reached through a group being detached → granted reader directly first', () => {
    const f = planAclFix([row(S, 'editor', true, 'g-st'), row('a1', 'editor', true, 'g-st')], [], groups, S);
    expect(f.detachGroups).toEqual(['g-st']);
    expect(f.raiseStudent).toBe('reader');
  });
  it('student only through a detached group, invite admin → granted admin', () => {
    const f = planAclFix([row(S, 'reader', true, 'g-st')], ['hz-invite-self-admin'], groups, S);
    expect(f.raiseStudent).toBe('admin');
  });
  it('student also holding a direct row: no grant needed', () => {
    const f = planAclFix([row(S, 'reader', true, 'g-st'), row(S, 'reader')], [], groups, S);
    expect(f.raiseStudent).toBeNull();
    expect(f.detachGroups).toEqual(['g-st']);
  });
  it('studentId null → no detach at all, blocked, unconfirmed', () => {
    const rows = [row('a1', 'reader', true, 'g-st')];
    const f = planAclFix(rows, [], groups, null);
    expect(f.detachGroups).toEqual([]);
    expect(f.blocked).toBe(true);
    expect(aclMatches(rows, [], groups, null)).toBe(false);
  });
  it('studentId null with nothing to detach and no invite: confirmed', () => {
    expect(aclMatches([row('own', 'owner', true, 'g-owner')], [], groups, null)).toBe(true);
  });
});

describe('accessState — read-back against the baseline', () => {
  const tags: string[] = [];
  const before = [row(S, 'reader'), row('a1', 'reader', true, 'g-st'), row('a1', 'owner', true, 'g-owner'), row('x', 'editor')];
  const base = baselineOf(before, tags, groups, S);
  it('the detached group gone, every other row unchanged → confirmed', () => {
    const after = [row(S, 'reader'), row('a1', 'owner', true, 'g-owner'), row('x', 'editor')];
    expect(accessState(after, tags, groups, S, base)).toEqual({ confirmed: true, mismatched: [] });
  });
  it('a member also in an owner group must keep that row', () => {
    const after = [row(S, 'reader'), row('x', 'editor')];
    expect(accessState(after, tags, groups, S, base).confirmed).toBe(false);
  });
  it('another person changed → unconfirmed', () => {
    const after = [row(S, 'reader'), row('a1', 'owner', true, 'g-owner'), row('x', 'reader')];
    expect(accessState(after, tags, groups, S, base).confirmed).toBe(false);
  });
  it('a row of the detached group still there → unconfirmed', () => {
    expect(accessState(before, tags, groups, S, base).confirmed).toBe(false);
  });
  it('the student lost every row → unconfirmed (required reader from the baseline)', () => {
    const after = [row('a1', 'owner', true, 'g-owner'), row('x', 'editor')];
    expect(accessState(after, tags, groups, S, base).confirmed).toBe(false);
  });
  it('a role-group row with an empty authorId is never settled', () => {
    const rows = [row('', 'editor', true, 'g-cm')];
    expect(aclMatches(rows, ['hz-share-companymentor-editor'], groups, S)).toBe(false);
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
  const log = { creates: 0, setRole: [] as string[], detach: [] as string[], removed: [] as string[] };
  const fail: { createTitle?: string; mode?: '4xx' | 'timeout-landed'; once: Set<string>; alwaysTimeout?: string; lag: number } = { once: new Set(), lag: 0 };
  const ignoreAcl = { on: false };
  let initialAcl = (): AclRow[] => [row(S, 'reader'), row('a-st', 'reader', true, 'g-st'), row('b-st', 'editor', true, 'g-st'), row('own', 'owner', true, 'g-owner')];
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
        acls.set(id, initialAcl());
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
      const r = rows.find(x => x.authorId === p && x.groupId === null);
      if (r) r.role = role; else rows.push(row(p, role));
    },
    async detachGroup(id, g) {
      log.detach.push(`${id}:${g}`);
      if (ignoreAcl.on) return;
      acls.set(id, acls.get(id)!.filter(x => x.groupId !== g));
    },
    async sleep() {},
  };
  nodes.set('prof', node('prof', 'root', 'Profile'));
  nodes.set('t-sec', node('t-sec', 'tpl', 'Learning FSRS', {
    tags: ['hz-config-legend', 'hz-invite-self-admin'], rolesSettings: { x: 1 }, icon: 'fa-brain', color: '#abcdef',
  }));
  nodes.set('t-c1', node('t-c1', 't-sec', 'Child', { tags: ['hz-share-companymentor-editor'] }));
  nodes.set('t-c2', node('t-c2', 't-c1', 'Grandchild'));
  return { nodes, acls, deps, log, fail, ignoreAcl, setInitialAcl: (f: () => AclRow[]) => { initialAcl = f; } };
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
    // student raised on the top node; schoolteacher group (no share tag) detached ONCE by its
    // groupId although it has two member rows; owner untouched
    expect(w.acls.get(r.newId!)!.find(x => x.authorId === S)!.role).toBe('admin');
    expect(w.acls.get(r.newId!)!.some(x => x.groupId === 'g-st')).toBe(false);
    expect(w.acls.get(r.newId!)!.some(x => x.authorId === 'own')).toBe(true);
    expect(w.log.detach.filter(d => d.startsWith(r.newId! + ':'))).toEqual([`${r.newId}:g-st`]);
    // Child: share tag companymentor-editor, schoolteacher group detached
    expect(w.acls.get(kids[0].id)!.some(x => x.groupId === 'g-st')).toBe(false);
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
    expect(w.log.detach).toEqual([]);
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

describe('copySection — R12 access cases', () => {
  it('a group at a wrong share role: no write for it, hand-fix line, not ok', async () => {
    const w = world();
    w.setInitialAcl(() => [row(S, 'admin'), row('m1', 'reader', true, 'g-cm'), row('own', 'owner', true, 'g-owner')]);
    // only the child carries hz-share-companymentor-editor; the grandchild detaches g-cm
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(false);
    const child = [...w.nodes.values()].find(x => x.parentId === r.newId)!;
    expect(r.problems).toContain('rôle du groupe companymentor à ajuster à la main sur « Child »');
    expect(r.problems).not.toContain('accès non confirmés : « Child »');
    expect(w.acls.get(child.id)!.filter(x => x.groupId === 'g-cm').map(x => x.role)).toEqual(['reader']);
    expect(w.log.detach.some(d => d === `${child.id}:g-cm`)).toBe(false);
    expect(w.log.setRole.some(s => s.includes(':m1:'))).toBe(false);
  });
  it('a member also in an owner group keeps that row; no DELETE per member', async () => {
    const w = world();
    w.setInitialAcl(() => [row(S, 'admin'), row('a-st', 'reader', true, 'g-st'), row('a-st', 'owner', true, 'g-owner')]);
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(true);
    for (const id of [...w.acls.keys()]) {
      expect(w.acls.get(id)!.some(x => x.authorId === 'a-st' && x.groupId === 'g-owner')).toBe(true);
    }
  });
  it('a detach that also strips another row is caught by the baseline check', async () => {
    const w = world();
    w.setInitialAcl(() => [row(S, 'admin'), row('a-st', 'reader', true, 'g-st'), row('a-st', 'owner', true, 'g-owner')]);
    // a Hazu that removes every row of each member of the detached group (the feared behaviour)
    w.deps.detachGroup = async (id, g) => {
      w.log.detach.push(`${id}:${g}`);
      const members = new Set(w.acls.get(id)!.filter(x => x.groupId === g).map(x => x.authorId));
      w.acls.set(id, w.acls.get(id)!.filter(x => !members.has(x.authorId)));
    };
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(false);
    expect(r.problems.some(p => p.startsWith('accès non confirmés'))).toBe(true);
  });
  it('student reached only via a group being detached → granted directly BEFORE the detach', async () => {
    const w = world();
    w.setInitialAcl(() => [row(S, 'editor', true, 'g-st'), row('own', 'owner', true, 'g-owner')]);
    const order: string[] = [];
    const setRole = w.deps.setRole; const detach = w.deps.detachGroup;
    w.deps.setRole = async (id, p, role) => { order.push(`set:${id}:${p}:${role}`); return setRole(id, p, role); };
    w.deps.detachGroup = async (id, g) => { order.push(`detach:${id}:${g}`); return detach(id, g); };
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(r.ok).toBe(true);
    const grandchild = [...w.nodes.values()].find(x => x.title === 'Grandchild' && x.id.startsWith('new-'))!;
    const gi = order.indexOf(`set:${grandchild.id}:${S}:reader`);
    expect(gi).toBeGreaterThanOrEqual(0);
    expect(gi).toBeLessThan(order.indexOf(`detach:${grandchild.id}:g-st`));
    expect(w.acls.get(grandchild.id)).toEqual([row('own', 'owner', true, 'g-owner'), row(S, 'reader')]);
  });
  it('a direct grant that has not shown yet → no detach until a read shows it', async () => {
    const w = world();
    w.setInitialAcl(() => [row(S, 'editor', true, 'g-st'), row('own', 'owner', true, 'g-owner')]);
    const setRole = w.deps.setRole;
    const pending = new Map<string, () => Promise<void>>();
    // the grant answers 2xx but only shows on the third ACL read after it of that node
    const readsLeft = new Map<string, number>();
    w.deps.setRole = async (id, p, role) => {
      if (!pending.has(id)) { pending.set(id, () => setRole(id, p, role)); readsLeft.set(id, 3); }
    };
    const acl = w.deps.acl;
    w.deps.acl = async (id) => {
      const rows = await acl(id);
      const land = pending.get(id);
      if (land) {
        const left = (readsLeft.get(id) ?? 0) - 1;
        readsLeft.set(id, left);
        if (left <= 0) { pending.delete(id); await land(); }
      }
      return rows;
    };
    const detach = w.deps.detachGroup;
    const early: string[] = [];
    w.deps.detachGroup = async (id, g) => {
      // the core swallows a throwing dep, so record instead of asserting here
      if (!w.acls.get(id)!.some(r => r.authorId === S && r.groupId === null)) early.push(id);
      return detach(id, g);
    };
    const r = await copySection('t-sec', 'prof', w.deps, groups, S);
    expect(early).toEqual([]); // the grant was visible before every detach
    for (const [id, rows] of w.acls) {
      if (!id.startsWith('new-')) continue;
      expect(rows.some(x => x.authorId === S)).toBe(true); // the student never loses access
      expect(rows.some(x => x.groupId === 'g-st')).toBe(false); // the detach still happened
    }
    expect(r.ok).toBe(true); // a lagging grant does not use up the verify budget
  });
  it('studentId null → no detach on any node, unconfirmed', async () => {
    const w = world();
    const r = await copySection('t-sec', 'prof', w.deps, groups, null);
    expect(r.ok).toBe(false);
    expect(w.log.detach).toEqual([]);
    expect(w.log.setRole).toEqual([]);
  });
});
