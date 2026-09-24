import { describe, it, expect } from 'vitest';
import {
  isRetryableError,
  backoffMs,
  evaluateVerification,
  runReliableRoleWrite,
  isIdentityInAcl,
  looksLikeEmail,
  RoleWriteDeps,
  GroupMembershipSnapshot,
  resolveMembershipReading,
  buildUpdateUserRolesPayload,
} from './role-write';

const noSleep = async () => {};

describe('buildUpdateUserRolesPayload', () => {
  it('sends the school template (root hazu) as templateId, not the hz-config-admin hazu', () => {
    // Hazu support: templateId must be the school template itself — the same root the
    // create-group / remove-group calls send. The hz-config-admin id is the wrong value here.
    const payload = buildUpdateUserRolesPayload({
      schoolTemplateId: 'ROOT_TEMPLATE_ID',
      profileId: 'PROFILE_ID',
      classId: 'CLASS_ID',
      oldRole: null,
      newRole: 'student',
    });
    expect(payload).toEqual({
      templateId: 'ROOT_TEMPLATE_ID',
      profileId: 'PROFILE_ID',
      userTypesInfo: [{ classId: 'CLASS_ID', oldUserType: '_', newUserType: 'student' }],
    });
  });

  it('encodes a removal as newUserType "_"', () => {
    const payload = buildUpdateUserRolesPayload({
      schoolTemplateId: 'ROOT_TEMPLATE_ID',
      profileId: 'PROFILE_ID',
      classId: 'CLASS_ID',
      oldRole: 'student',
      newRole: null,
    });
    expect(payload.userTypesInfo).toEqual([{ classId: 'CLASS_ID', oldUserType: 'student', newUserType: '_' }]);
  });
});

describe('isIdentityInAcl', () => {
  const members = [
    { authorId: 'AAA111', description: 'real@example.invalid', isGroup: false },
    { authorId: 'ACCTUID00000000000000000001', description: 'student.three@example.invalid', isGroup: false },
    { authorId: 'GRPID', description: 'nested-group', isGroup: true },
  ];

  it('matches a member by email description (case-insensitive)', () => {
    expect(isIdentityInAcl(members, 'REAL@example.invalid')).toBe(true);
  });

  it('matches by authorId when persons.email holds an account UID, not an email', () => {
    // A real observed data shape, not a hypothetical: some profiles carry the account UID in
    // persons.email instead of an address. The ACL then keys that member by authorId while
    // description holds the real email, so only the authorId path recovers the identity.
    expect(isIdentityInAcl(members, 'ACCTUID00000000000000000001')).toBe(true);
  });

  it('skips isGroup entries and returns false for a genuine non-member', () => {
    expect(isIdentityInAcl(members, 'nested-group')).toBe(false); // group entry, skipped
    expect(isIdentityInAcl(members, 'nobody@example.invalid')).toBe(false);
  });

  it('returns false for a blank identity or empty ACL', () => {
    expect(isIdentityInAcl(members, '')).toBe(false);
    expect(isIdentityInAcl([], 'real@example.invalid')).toBe(false);
  });
});

describe('looksLikeEmail', () => {
  it('recognises emails and rejects UIDs / blanks / junk', () => {
    expect(looksLikeEmail('student.three@example.invalid')).toBe(true);
    expect(looksLikeEmail('ACCTUID00000000000000000001')).toBe(false);
    expect(looksLikeEmail('')).toBe(false);
    expect(looksLikeEmail('not an email')).toBe(false);
  });
});

describe('isRetryableError', () => {
  it('retries 5xx and network/timeout, not 4xx', () => {
    expect(isRetryableError(500, false)).toBe(true);
    expect(isRetryableError(503, false)).toBe(true);
    expect(isRetryableError(400, false)).toBe(false);
    expect(isRetryableError(404, false)).toBe(false);
    expect(isRetryableError(undefined, true)).toBe(true);
    expect(isRetryableError(undefined, false)).toBe(false);
  });
});

describe('backoffMs', () => {
  it('grows exponentially from 500ms', () => {
    expect(backoffMs(0)).toBe(500);
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
  });
});

describe('evaluateVerification', () => {
  it('assign: verified iff in the new-role group', () => {
    expect(evaluateVerification({ oldRole: '_', newRole: 'student' }, { inNewGroup: true, inOldGroup: false }))
      .toEqual({ verified: true, reconciledRole: 'student', partial: false });
    expect(evaluateVerification({ oldRole: '_', newRole: 'student' }, { inNewGroup: false, inOldGroup: false }))
      .toEqual({ verified: false, reconciledRole: null, partial: false });
  });

  it('remove: verified iff absent from the old-role group', () => {
    expect(evaluateVerification({ oldRole: 'student', newRole: '_' }, { inNewGroup: false, inOldGroup: false }))
      .toEqual({ verified: true, reconciledRole: null, partial: false });
    expect(evaluateVerification({ oldRole: 'student', newRole: '_' }, { inNewGroup: false, inOldGroup: true }))
      .toEqual({ verified: false, reconciledRole: 'student', partial: false });
  });

  it('change: verified iff in new and not in old; flags partial when half-applied', () => {
    const intent = { oldRole: 'student', newRole: 'companymentor' };
    expect(evaluateVerification(intent, { inNewGroup: true, inOldGroup: false }))
      .toEqual({ verified: true, reconciledRole: 'companymentor', partial: false });
    expect(evaluateVerification(intent, { inNewGroup: true, inOldGroup: true }))
      .toEqual({ verified: false, reconciledRole: 'companymentor', partial: true });
    expect(evaluateVerification(intent, { inNewGroup: false, inOldGroup: true }))
      .toEqual({ verified: false, reconciledRole: 'student', partial: false });
    expect(evaluateVerification(intent, { inNewGroup: false, inOldGroup: false }))
      .toEqual({ verified: false, reconciledRole: null, partial: true });
  });
});

describe('runReliableRoleWrite', () => {
  const assign = { oldRole: '_', newRole: 'student' };
  const okMembership = async (): Promise<GroupMembershipSnapshot> => ({ inNewGroup: true, inOldGroup: false });

  it('retries a transient 5xx then succeeds, and verifies', async () => {
    let calls = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => {
        calls += 1;
        if (calls < 3) return { ok: false, status: 503, networkOrTimeout: false, error: 'boom' };
        return { ok: true, networkOrTimeout: false };
      },
      readMembership: okMembership,
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(out.attempts).toBe(3);
    expect(out).toMatchObject({ success: true, postOk: true, verifyRan: true, verified: true, reconciledRole: 'student' });
  });

  it('does not retry a 4xx', async () => {
    let calls = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => { calls += 1; return { ok: false, status: 400, networkOrTimeout: false, error: 'bad' }; },
      readMembership: okMembership,
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(calls).toBe(1);
    expect(out).toMatchObject({ success: false, postOk: false, verifyRan: false, error: 'bad' });
  });

  // Measured against the endpoint (2026-07-21 retest): two profiles returned HTTP 500 on all
  // four add attempts while the member actually landed in the group; the original sweep saw 15
  // of 22 non-responses that had in fact been applied. A transport-level failure therefore says
  // nothing about whether the write committed — only group truth does. Verification must run on
  // the failure path too, or Matrix reverts a cell whose change actually took effect.
  it('reports success when a 5xx write actually landed (truth confirms)', async () => {
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => ({ ok: false, status: 500, networkOrTimeout: false, error: 'server error' }),
      readMembership: async () => ({ inNewGroup: true, inOldGroup: false }),
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(out).toMatchObject({ success: true, postOk: false, verifyRan: true, verified: true, reconciledRole: 'student' });
    expect(out.error).toBeUndefined();
  });

  it('reports success when a timed-out write actually landed', async () => {
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => ({ ok: false, networkOrTimeout: true, error: 'timeout of 120000ms exceeded' }),
      readMembership: async () => ({ inNewGroup: true, inOldGroup: false }),
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(out).toMatchObject({ success: true, postOk: false, verifyRan: true, verified: true, reconciledRole: 'student' });
  });

  it('stays failed when a 5xx write did not land, and keeps the transport error', async () => {
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => ({ ok: false, status: 500, networkOrTimeout: false, error: 'server error' }),
      readMembership: async () => ({ inNewGroup: false, inOldGroup: false }),
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(out).toMatchObject({ success: false, postOk: false, verifyRan: true, verified: false, error: 'server error' });
    // Truth did not confirm: local state must not be reconciled off the back of a failed write.
    expect(out.reconciledRole).toBeNull();
  });

  it('stays failed when the write failed and truth cannot be read', async () => {
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => ({ ok: false, status: 500, networkOrTimeout: false, error: 'server error' }),
      readMembership: async () => null,
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(out).toMatchObject({ success: false, postOk: false, verifyRan: false, verified: false, reconciledRole: null });
  });

  it('fails when the write is 2xx but truth never confirms', async () => {
    let reads = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => ({ ok: true, networkOrTimeout: false }),
      readMembership: async () => { reads += 1; return { inNewGroup: false, inOldGroup: false }; },
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(reads).toBe(3);
    expect(out).toMatchObject({ success: false, postOk: true, verifyRan: true, verified: false, reconciledRole: null });
    expect(typeof out.error).toBe('string');
    expect(out.error!.length).toBeGreaterThan(0);
  });

  it('trusts the 2xx when truth cannot be read (verifyRan false)', async () => {
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => ({ ok: true, networkOrTimeout: false }),
      readMembership: async () => null,
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(out).toMatchObject({ success: true, postOk: true, verifyRan: false, verified: false, reconciledRole: 'student' });
  });

  // A failed ACL read is transient: one bad read must not end verification. Before this, a single
  // throw inside readMembership was swallowed into null and the loop broke on its first pass, so a
  // write was logged verifyRan=false with no reason and the remaining reads never happened.
  it('retries a transient ACL read error within the verify loop', async () => {
    let reads = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => ({ ok: true, networkOrTimeout: false }),
      readMembership: async () => {
        reads += 1;
        if (reads === 1) throw new Error('ACL read failed');
        return { inNewGroup: true, inOldGroup: false };
      },
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(reads).toBe(2);
    expect(out).toMatchObject({ success: true, verifyRan: true, verified: true, reconciledRole: 'student' });
    expect(out.verifySkipped).toBeUndefined();
  });

  it('reports read-error with the message when every verify read fails', async () => {
    let reads = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => ({ ok: false, networkOrTimeout: true, error: 'timeout of 120000ms exceeded' }),
      readMembership: async () => { reads += 1; throw new Error('ACL read failed'); },
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps, { maxWriteAttempts: 1 });
    expect(reads).toBe(3);
    expect(out).toMatchObject({
      success: false, postOk: false, verifyRan: false, verifySkipped: 'read-error', verifyError: 'ACL read failed',
      error: 'timeout of 120000ms exceeded',
    });
  });

  it('does not retry a permanent cannot-verify (null) and says so', async () => {
    let reads = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => ({ ok: true, networkOrTimeout: false }),
      readMembership: async () => { reads += 1; return null; },
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(reads).toBe(1);
    expect(out).toMatchObject({ success: true, verifyRan: false, verifySkipped: 'unverifiable' });
  });

  // Option A: a timeout says nothing about whether the server-side job is still running. Hazu
  // support measured a role change whose permission update outlasts the 120 s client timeout;
  // resending blindly re-triggers that heavy job. So read group truth before each resend.
  it('does not resend after a timeout when group truth already confirms the write', async () => {
    let posts = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => { posts += 1; return { ok: false, networkOrTimeout: true, error: 'timeout' }; },
      readMembership: okMembership,
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(posts).toBe(1);
    expect(out).toMatchObject({ success: true, postOk: false, verifyRan: true, verified: true, reconciledRole: 'student', attempts: 1 });
    expect(out.error).toBeUndefined();
  });

  it('resends after a timeout when group truth does not yet confirm the write', async () => {
    let posts = 0;
    let reads = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => {
        posts += 1;
        return posts === 1 ? { ok: false, networkOrTimeout: true, error: 'timeout' } : { ok: true, networkOrTimeout: false };
      },
      // Absent through the pre-resend check (3 reads), present after the second POST.
      readMembership: async () => { reads += 1; return { inNewGroup: reads > 3, inOldGroup: false }; },
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(posts).toBe(2);
    expect(out).toMatchObject({ success: true, postOk: true, verified: true, attempts: 2 });
  });

  it('still resends after a timeout when the pre-resend check cannot verify', async () => {
    let posts = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => {
        posts += 1;
        return posts === 1 ? { ok: false, networkOrTimeout: true, error: 'timeout' } : { ok: true, networkOrTimeout: false };
      },
      readMembership: async () => null,
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(posts).toBe(2);
    expect(out).toMatchObject({ success: true, postOk: true, verifyRan: false });
  });

  it('does not read truth before resending after a 5xx (Option A is timeout-only)', async () => {
    let posts = 0;
    let reads = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => {
        posts += 1;
        return posts < 3 ? { ok: false, status: 500, networkOrTimeout: false, error: 'boom' } : { ok: true, networkOrTimeout: false };
      },
      readMembership: async () => { reads += 1; return { inNewGroup: true, inOldGroup: false }; },
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(posts).toBe(3);
    expect(reads).toBe(1);
    expect(out).toMatchObject({ success: true, postOk: true, attempts: 3 });
  });

  it('stops verifying as soon as truth confirms (cache lag)', async () => {
    let reads = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => ({ ok: true, networkOrTimeout: false }),
      readMembership: async () => { reads += 1; return { inNewGroup: reads >= 2, inOldGroup: false }; },
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(reads).toBe(2);
    expect(out).toMatchObject({ success: true, verified: true, reconciledRole: 'student' });
  });
});

describe('resolveMembershipReading', () => {
  const absent: GroupMembershipSnapshot = { inNewGroup: false, inOldGroup: false };
  const neverCalled = async () => {
    throw new Error('confirmLinkedAccount should not have been called');
  };

  it('trusts an absence reading for an email identity without confirming the account', async () => {
    const r = await resolveMembershipReading('student@example.invalid', absent, neverCalled);
    expect(r).toEqual(absent);
  });

  it('trusts an absence reading for a UID identity confirmed as a linked account', async () => {
    // The fix: a UID that really names an account on the profile's own ACL makes "not in the
    // group" a true negative, not an unreadable identity. Without this the write is reported
    // as an unverifiable success on a 2xx that did nothing.
    const r = await resolveMembershipReading('ACCTUID00000000000000000001', absent, async () => true);
    expect(r).toEqual(absent);
  });

  it('cannot verify an absence reading for a UID that names no linked account', async () => {
    const r = await resolveMembershipReading('ACCTUID00000000000000000001', absent, async () => false);
    expect(r).toBeNull();
  });

  it('does not spend an account read when the identity was found in a group', async () => {
    const present: GroupMembershipSnapshot = { inNewGroup: true, inOldGroup: false };
    const r = await resolveMembershipReading('ACCTUID00000000000000000001', present, neverCalled);
    expect(r).toEqual(present);
  });

  it('cannot verify a blank identity', async () => {
    expect(await resolveMembershipReading('', absent, neverCalled)).toBeNull();
  });

  it('rethrows when the account-confirmation read itself fails, so the verify loop retries it', async () => {
    // A failed read is transient, not a fact about the identity — null would end verification.
    await expect(
      resolveMembershipReading('ACCTUID00000000000000000001', absent, async () => {
        throw new Error('ACL read failed');
      }),
    ).rejects.toThrow('ACL read failed');
  });
});
