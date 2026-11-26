import { describe, it, expect } from 'vitest';
import { toAclRows, toCopyNode, aclEntries, studentIdFromAcl, copiesRefusal, NO_ROLE_GROUPS, PRINCIPAL_MISSING } from './level-change-wire';
import { buildCreateFullBody, createdIdOf, newIdFromCreate, strictListRows } from './hazu-api/create-full';
import { sendApiRequestRemoveUserChecked } from './hazu-api/api';

describe('toCopyNode', () => {
  it('keeps type, privacy, tags and event.rolesSettings from the snapshot envelope', () => {
    const rs = { import: { fromHazu: 'members' }, views: { table: true } };
    const n = toCopyNode({
      snapshot: {
        key: 'n1', parentId: 'p1', type: 'hazu', title: 'Mandats', description: '<p>x</p>',
        icon: 'fa-briefcase', color: '#1A237E', privacy: 'unlisted',
        tags: ['hz-config-legend', 'hz-share-student-editor'], event: { rolesSettings: rs },
      },
    });
    expect(n).toEqual({
      id: 'n1', parentId: 'p1', type: 'hazu', title: 'Mandats', description: '<p>x</p>',
      icon: 'fa-briefcase', color: '#1A237E', privacy: 'unlisted',
      tags: ['hz-config-legend', 'hz-share-student-editor'], rolesSettings: rs,
    });
  });

  it('reads a bare row and gives null privacy / rolesSettings when absent', () => {
    const n = toCopyNode({ id: 'n2', type: 'item', title: 'T', tags: [] });
    expect(n?.privacy).toBeNull();
    expect(n?.rolesSettings).toBeNull();
    expect(n?.type).toBe('item');
  });

  it('rejects a row without id', () => {
    expect(toCopyNode({ snapshot: { title: 'x' } })).toBeNull();
    expect(toCopyNode(null)).toBeNull();
  });
});

describe('toAclRows', () => {
  it('maps every entry, never filtering by isGroup', () => {
    const rows = toAclRows({
      data: [
        { authorId: 'g1', groupId: 'g1', isGroup: true, role: 'editor', description: 'x' },
        { authorId: 'u1', isGroup: true, role: 'reader' },
        { authorId: 'u2', isGroup: false, role: 'admin', groupId: null },
      ],
    });
    expect(rows).toEqual([
      { authorId: 'g1', groupId: 'g1', isGroup: true, role: 'editor' },
      { authorId: 'u1', groupId: null, isGroup: true, role: 'reader' },
      { authorId: 'u2', groupId: null, isGroup: false, role: 'admin' },
    ]);
  });

  it('accepts a bare array; an entry with no principal and no groupId is dropped', () => {
    expect(toAclRows([{ role: 'reader' }, { authorId: '  ', role: 'reader' }, { authorId: 'u', role: 'editor' }])).toEqual([
      { authorId: 'u', groupId: null, isGroup: false, role: 'editor' },
    ]);
  });

  it('an entry with a groupId but no principal fails the whole read (access unconfirmable)', () => {
    expect(() => toAclRows({ data: [{ authorId: 'u', role: 'reader' }, { groupId: 'g2', role: 'reader' }] }))
      .toThrow(PRINCIPAL_MISSING);
  });

  it('throws on an unexpected shape instead of returning an empty ACL', () => {
    expect(() => toAclRows({ nope: 1 })).toThrow();
    expect(() => toAclRows(null)).toThrow();
  });
});

describe('createdIdOf', () => {
  it('reads key | snapshot.key | id | data.key, in that order', () => {
    expect(createdIdOf({ key: 'a', id: 'b' })).toBe('a');
    expect(createdIdOf({ snapshot: { key: 'c' }, id: 'd' })).toBe('c');
    expect(createdIdOf({ id: 'e' })).toBe('e');
    expect(createdIdOf({ data: { key: 'f' } })).toBe('f');
  });
  it('null when no id is present', () => {
    expect(createdIdOf({})).toBeNull();
    expect(createdIdOf(null)).toBeNull();
    expect(createdIdOf('x')).toBeNull();
  });
});

describe('buildCreateFullBody', () => {
  const base = {
    parentId: 'p', type: 'hazu', title: 'T', description: '<p>d</p>', icon: 'fa-x', color: '#9ad9ea',
    privacy: 'private', tags: ['hz-config-legend'], authorId: 'admin', displayName: 'Admin',
  };
  it('sends every field, colour upper-cased, rolesSettings as the dotted event key', () => {
    const rs = { import: { fromHazu: 'members' } };
    expect(buildCreateFullBody({ ...base, rolesSettings: rs })).toEqual({
      parentId: 'p', type: 'hazu', title: 'T', description: '<p>d</p>', icon: 'fa-x', color: '#9AD9EA',
      privacy: 'private', tags: ['hz-config-legend'], authorId: 'admin', displayName: 'Admin',
      'event.rolesSettings': rs,
    });
  });
  it('omits empty optional fields, always sends tags', () => {
    const b = buildCreateFullBody({ ...base, type: '', description: '', icon: null, color: null, privacy: null, tags: [], rolesSettings: null });
    expect(b).toEqual({ parentId: 'p', title: 'T', authorId: 'admin', displayName: 'Admin', tags: [] });
  });
});

describe('studentIdFromAcl (level change identity, no isGroup filter)', () => {
  it('a UID is used as is, without the ACL', () => {
    expect(studentIdFromAcl('uid123', [])).toBe('uid123');
  });
  it('an e-mail resolves through the description, case-insensitively, even on an isGroup:true entry', () => {
    const acl = [
      { authorId: 'g1', description: 'Some group', isGroup: true },
      { authorId: 'acc9', description: 'Someone@Example.invalid', isGroup: true },
    ];
    expect(studentIdFromAcl('someone@example.invalid', acl)).toBe('acc9');
  });
  it('the same account listed twice still resolves', () => {
    const acl = [
      { authorId: 'acc9', description: 'someone@example.invalid', isGroup: false },
      { authorId: 'acc9', description: 'someone@example.invalid', isGroup: true },
    ];
    expect(studentIdFromAcl('someone@example.invalid', acl)).toBe('acc9');
  });
  it('two distinct accounts for the e-mail → unresolved', () => {
    const acl = [
      { authorId: 'a1', description: 'someone@example.invalid' },
      { authorId: 'a2', description: 'SOMEONE@example.invalid' },
    ];
    expect(studentIdFromAcl('someone@example.invalid', acl)).toBeNull();
  });
  it('an e-mail not on the ACL, or no tag, stays unresolved', () => {
    expect(studentIdFromAcl('other@example.invalid', [{ authorId: 'a', description: 'x@example.invalid' }])).toBeNull();
    expect(studentIdFromAcl(null, [])).toBeNull();
    expect(studentIdFromAcl('  ', [])).toBeNull();
  });
});

describe('aclEntries', () => {
  it('reads { data } or an array, throws otherwise', () => {
    expect(aclEntries({ data: [1] })).toEqual([1]);
    expect(aclEntries([2])).toEqual([2]);
    expect(() => aclEntries({})).toThrow();
    expect(() => aclEntries(undefined)).toThrow();
  });
});

describe('copiesRefusal (R11)', () => {
  it('refuses copies when no role group is known', () => {
    expect(copiesRefusal(['k'], 0)).toBe(NO_ROLE_GROUPS);
  });
  it('no copies, or groups known: no refusal', () => {
    expect(copiesRefusal([], 0)).toBeNull();
    expect(copiesRefusal(['k'], 3)).toBeNull();
  });
});

describe('newIdFromCreate', () => {
  it('returns the id', () => {
    expect(newIdFromCreate({ key: 'n1' }, 'p')).toBe('n1');
  });
  it('no id → a networkOrTimeout failure (the core re-lists)', () => {
    expect(() => newIdFromCreate({}, 'p')).toThrow();
    try { newIdFromCreate({}, 'p'); } catch (e) { expect((e as { networkOrTimeout: boolean }).networkOrTimeout).toBe(true); }
  });
  it('the parent id echoed → a networkOrTimeout failure', () => {
    try { newIdFromCreate({ snapshot: { key: 'p' } }, 'p'); expect.unreachable(); }
    catch (e) { expect((e as { networkOrTimeout: boolean }).networkOrTimeout).toBe(true); }
  });
});

describe('strictListRows', () => {
  it('array or { data }, anything else throws', () => {
    expect(strictListRows([1])).toEqual([1]);
    expect(strictListRows({ data: [2] })).toEqual([2]);
    expect(() => strictListRows({ items: [] })).toThrow();
    expect(() => strictListRows(null)).toThrow();
    expect(() => strictListRows('')).toThrow();
  });
});

describe('sendApiRequestRemoveUserChecked', () => {
  it('refuses a call with neither userId nor userEmail, without a request', async () => {
    const r = await sendApiRequestRemoveUserChecked('item1');
    expect(r.ok).toBe(false);
    expect(r.networkOrTimeout).toBe(false);
    const r2 = await sendApiRequestRemoveUserChecked('item1', '', '');
    expect(r2.ok).toBe(false);
  });
});
