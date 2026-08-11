import { describe, it, expect } from 'vitest';
import {
  isAccountOnAcl,
  evaluateRemoval,
  runOrphanRemoval,
  OrphanRemovalDeps,
  OrphanGrant,
} from './orphan-removal';

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

const GROUP_GRANT: OrphanGrant = { kind: 'group', itemId: 'grp0000000000000001', title: 'Class A Student' };
const ROOM_GRANT: OrphanGrant = { kind: 'roomItem', itemId: 'room000000000000001', title: 'Class A', aclRole: 'reader' };
const INTENT = {
  accountId: 'AcctUid00000000000001',
  groupId: 'grp0000000000000001',
  roomId: 'room000000000000001',
  grants: [GROUP_GRANT, ROOM_GRANT],
};
const NO_CFG = { maxDeleteAttempts: 3, maxVerifyReads: 2, verifyDelayMs: 0 };

// Builds deps whose ACL reads return a fixed presence answer.
function deps(over: Partial<OrphanRemovalDeps> = {}): OrphanRemovalDeps {
  return {
    deleteFromItem: async () => ({ ok: true, networkOrTimeout: false }),
    readGroupAcl: async () => [],
    readRoomAcl: async () => [],
    sleep: async () => {},
    ...over,
  };
}
const aclWith = (accountId: string) => [{ authorId: accountId, description: '', isGroup: true }];

describe('runOrphanRemoval', () => {
  it('succeeds when both deletes return ok and both ACLs confirm absence', async () => {
    const out = await runOrphanRemoval(INTENT, deps(), NO_CFG);
    expect(out.success).toBe(true);
    expect(out.verifyRan).toBe(true);
    expect(out.surviving).toEqual([]);
  });

  it('succeeds when the delete failed with a 500 but truth says the account is gone', async () => {
    const out = await runOrphanRemoval(
      INTENT,
      deps({ deleteFromItem: async () => ({ ok: false, status: 500, networkOrTimeout: false, error: 'boom' }) }),
      NO_CFG,
    );
    expect(out.success).toBe(true);
    expect(out.deleteOk).toBe(false);
    expect(out.verified).toBe(true);
  });

  it('fails when the deletes returned 2xx but the group membership survives', async () => {
    const out = await runOrphanRemoval(
      INTENT,
      deps({ readGroupAcl: async () => aclWith('AcctUid00000000000001') }),
      NO_CFG,
    );
    expect(out.success).toBe(false);
    expect(out.surviving).toEqual(['group']);
    expect(out.error).toContain('role group');
  });

  it('fails and names the room item when only the room grant survives', async () => {
    const out = await runOrphanRemoval(
      INTENT,
      deps({ readRoomAcl: async () => aclWith('AcctUid00000000000001') }),
      NO_CFG,
    );
    expect(out.success).toBe(false);
    expect(out.surviving).toEqual(['roomItem']);
    expect(out.error).toContain('room item');
  });

  it('retries a 500 up to maxDeleteAttempts per grant', async () => {
    let calls = 0;
    await runOrphanRemoval(
      INTENT,
      deps({
        deleteFromItem: async () => {
          calls += 1;
          return { ok: false, status: 500, networkOrTimeout: false, error: 'boom' };
        },
      }),
      NO_CFG,
    );
    expect(calls).toBe(6); // 3 attempts x 2 grants
  });

  it('does not retry a 4xx', async () => {
    let calls = 0;
    await runOrphanRemoval(
      INTENT,
      deps({
        deleteFromItem: async () => {
          calls += 1;
          return { ok: false, status: 404, networkOrTimeout: false, error: 'not found' };
        },
      }),
      NO_CFG,
    );
    expect(calls).toBe(2); // 1 attempt x 2 grants
  });

  it('still verifies after a 4xx, so an already-absent grant reports success', async () => {
    const out = await runOrphanRemoval(
      INTENT,
      deps({ deleteFromItem: async () => ({ ok: false, status: 404, networkOrTimeout: false, error: 'not found' }) }),
      NO_CFG,
    );
    expect(out.success).toBe(true);
    expect(out.verified).toBe(true);
  });

  it('falls back to the delete status when an ACL read throws', async () => {
    const out = await runOrphanRemoval(
      INTENT,
      deps({ readGroupAcl: async () => null }),
      NO_CFG,
    );
    expect(out.verifyRan).toBe(false);
    expect(out.success).toBe(true); // deletes returned ok, truth unreadable
  });

  it('fails when truth is unreadable and the deletes also failed', async () => {
    const out = await runOrphanRemoval(
      INTENT,
      deps({
        readGroupAcl: async () => null,
        deleteFromItem: async () => ({ ok: false, status: 500, networkOrTimeout: false, error: 'boom' }),
      }),
      NO_CFG,
    );
    expect(out.success).toBe(false);
    expect(out.verifyRan).toBe(false);
  });

  it('treats an empty grant list as success without calling delete', async () => {
    let calls = 0;
    const out = await runOrphanRemoval(
      { ...INTENT, grants: [] },
      deps({ deleteFromItem: async () => { calls += 1; return { ok: true, networkOrTimeout: false }; } }),
      NO_CFG,
    );
    expect(calls).toBe(0);
    expect(out.success).toBe(true);
  });
});
