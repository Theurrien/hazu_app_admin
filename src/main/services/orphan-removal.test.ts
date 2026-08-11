import { describe, it, expect } from 'vitest';
import { isAccountOnAcl, evaluateRemoval } from './orphan-removal';

const member = (authorId: string, description: string, isGroup = false) => ({
  authorId, description, isGroup,
});

describe('isAccountOnAcl', () => {
  it('matches an isGroup=true room-item entry by account id', () => {
    // Hazu records a person's direct grant on a room item with isGroup=true.
    const acl = [member('AcctUid00000000000001', 'orphan@example.invalid', true)];
    expect(isAccountOnAcl(acl, 'AcctUid00000000000001')).toBe(true);
  });

  it('matches a plain isGroup=false group member by account id', () => {
    const acl = [member('AcctUid00000000000001', 'orphan@example.invalid', false)];
    expect(isAccountOnAcl(acl, 'AcctUid00000000000001')).toBe(true);
  });

  it('returns false when the account is absent', () => {
    const acl = [member('SomeoneElse000000001', 'other@example.invalid', true)];
    expect(isAccountOnAcl(acl, 'AcctUid00000000000001')).toBe(false);
  });

  it('returns false for a blank account id, even against a blank ACL entry', () => {
    expect(isAccountOnAcl([member('', 'x@example.invalid')], '')).toBe(false);
  });

  it('tolerates a null/empty member list', () => {
    expect(isAccountOnAcl([], 'AcctUid00000000000001')).toBe(false);
  });
});

describe('evaluateRemoval', () => {
  it('verifies when the account is gone from both', () => {
    expect(evaluateRemoval({ inGroup: false, onRoom: false })).toEqual({
      verified: true,
      surviving: [],
    });
  });

  it('fails and names the group when the group membership survives', () => {
    expect(evaluateRemoval({ inGroup: true, onRoom: false })).toEqual({
      verified: false,
      surviving: ['group'],
    });
  });

  it('fails and names the room item when the room grant survives', () => {
    expect(evaluateRemoval({ inGroup: false, onRoom: true })).toEqual({
      verified: false,
      surviving: ['roomItem'],
    });
  });

  it('fails and names both when nothing was removed', () => {
    expect(evaluateRemoval({ inGroup: true, onRoom: true })).toEqual({
      verified: false,
      surviving: ['group', 'roomItem'],
    });
  });
});
