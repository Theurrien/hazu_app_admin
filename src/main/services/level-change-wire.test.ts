import { describe, it, expect } from 'vitest';
import { toAclRows, toCopyNode } from './level-change-wire';
import { buildCreateFullBody, createdIdOf } from './hazu-api/create-full';
import { resolveSelfUid } from './formation/read';

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

  it('accepts a bare array and keeps an entry without authorId', () => {
    expect(toAclRows([{ groupId: 'g2', role: 'reader' }])).toEqual([
      { authorId: '', groupId: 'g2', isGroup: false, role: 'reader' },
    ]);
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

describe('student id rule (resolveSelfUid, used by resolveStudentId)', () => {
  it('a UID is used as is, without the ACL', () => {
    expect(resolveSelfUid('uid123', [])).toBe('uid123');
  });
  it('an e-mail resolves through the profile ACL description, case-insensitively', () => {
    const acl = [{ authorId: 'acc9', description: 'Someone@Example.invalid', isGroup: false }];
    expect(resolveSelfUid('someone@example.invalid', acl)).toBe('acc9');
  });
  it('an e-mail not on the ACL stays unresolved', () => {
    expect(resolveSelfUid('other@example.invalid', [{ authorId: 'a', description: 'x@example.invalid' }])).toBeNull();
    expect(resolveSelfUid(null, [])).toBeNull();
  });
});
