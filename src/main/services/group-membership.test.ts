import { describe, it, expect, vi } from 'vitest';
import { resolvePerson, isSystemAccount, computeGroupAssignments } from './group-membership';

const student = (authorId: string, description: string, isGroup = false) => ({
  authorId, description, displayName: description, isGroup, role: 'reader',
});

describe('isSystemAccount', () => {
  it('flags @hazu.io, not real emails', () => {
    expect(isSystemAccount('support@hazu.io')).toBe(true);
    expect(isSystemAccount('student.one@example.invalid')).toBe(false);
    expect(isSystemAccount(null)).toBe(false);
  });
});

describe('resolvePerson', () => {
  const byEmail = new Map([['student.one@example.invalid', '3L0LitHlKovjiK5e3rSN']]);
  it('matches on email (case-insensitive)', () => {
    expect(resolvePerson(student('6Dxet6', 'Student.One@example.invalid'), byEmail)).toEqual({ personId: '3L0LitHlKovjiK5e3rSN' });
  });
  it('uid-only entry is unresolved', () => {
    expect(resolvePerson(student('K3Zgx', 'K3ZgxABxOtcXIzIcRXFzMsYuMh42'), byEmail)).toEqual({ issue: 'unresolved' });
  });
  it('email with no local person is unknown', () => {
    expect(resolvePerson(student('Qfv', 'student.two@example.invalid'), byEmail)).toEqual({ issue: 'unknown' });
  });

  // A profile's hz-config-userid-<identity> tag sometimes carries the account UID rather
  // than an address, so persons.email holds a UID. The ACL entry still names the person by
  // email in `description`, so the email lookup misses — but its `authorId` is that same UID.
  describe('authorId fallback (persons.email holding a UID)', () => {
    const byUid = new Map([['Ab1cDeFgHiJkLmNoPqRs', 'pTeacherProfile']]);

    it('resolves via authorId when the email lookup misses', () => {
      expect(resolvePerson(student('Ab1cDeFgHiJkLmNoPqRs', 'teacher.one@example.invalid'), byEmail, byUid)).toEqual({
        personId: 'pTeacherProfile',
      });
    });

    it('resolves a uid-only ACL entry via authorId instead of reporting unresolved', () => {
      expect(resolvePerson(student('Ab1cDeFgHiJkLmNoPqRs', 'Ab1cDeFgHiJkLmNoPqRs'), byEmail, byUid)).toEqual({
        personId: 'pTeacherProfile',
      });
    });

    it('prefers the email match when both the email and the authorId resolve', () => {
      const both = new Map([['Zz9yXwVuTsRqPoNmLkJi', 'pOtherProfile']]);
      expect(resolvePerson(student('Zz9yXwVuTsRqPoNmLkJi', 'student.one@example.invalid'), byEmail, both)).toEqual({
        personId: '3L0LitHlKovjiK5e3rSN',
      });
    });

    it('stays unknown when neither the email nor the authorId matches a person', () => {
      expect(resolvePerson(student('NoSuchUid00000000000', 'ghost@example.invalid'), byEmail, byUid)).toEqual({
        issue: 'unknown',
      });
    });
  });
});

describe('computeGroupAssignments (CUI-C c fixture)', () => {
  it('resolves members, filters system accounts, records issues', async () => {
    const groups = [{ groupId: 'KC5ob7INtmW3uDvBJXqa', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student' }];
    const acl = {
      data: [
        student('6Dxet6', 'student.one@example.invalid'), // -> assigned
        student('Qfv', 'student.two@example.invalid'),            // -> unknown
        student('K3Zgx', 'K3ZgxABxOtcXIzIcRXFzMsYuMh42'), // -> unresolved (uid-only)
        student('RqoW', 'support@hazu.io'),             // -> filtered
      ],
    };
    const byEmail = new Map([['student.one@example.invalid', '3L0LitHlKovjiK5e3rSN']]);
    const res = await computeGroupAssignments(groups, async () => acl, byEmail);
    expect(res.assignments).toEqual([{ personId: '3L0LitHlKovjiK5e3rSN', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student' }]);
    expect(res.issues).toEqual([
      { type: 'unknown', groupId: 'KC5ob7INtmW3uDvBJXqa', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student', uid: 'Qfv', email: 'student.two@example.invalid', displayName: 'student.two@example.invalid' },
      { type: 'unresolved', groupId: 'KC5ob7INtmW3uDvBJXqa', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student', uid: 'K3Zgx', email: null, displayName: 'K3ZgxABxOtcXIzIcRXFzMsYuMh42' },
    ]);
  });

  it('skips nested-group ACL refs (isGroup) entirely', async () => {
    const groups = [{ groupId: 'KC5ob7INtmW3uDvBJXqa', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student' }];
    const acl = {
      data: [
        student('6Dxet6', 'student.one@example.invalid'),   // -> assigned
        student('grpX', 'hz-share-student-LkxlSjtb0hnG4TpnvDDr', true), // -> skipped (nested group)
      ],
    };
    const byEmail = new Map([['student.one@example.invalid', '3L0LitHlKovjiK5e3rSN']]);
    const res = await computeGroupAssignments(groups, async () => acl, byEmail);
    expect(res.assignments).toEqual([{ personId: '3L0LitHlKovjiK5e3rSN', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student' }]);
    expect(res.issues).toEqual([]);
  });

  it('skips a group whose ACL fetch fails, without aborting healthy groups', async () => {
    const groups = [
      { groupId: 'BAD', roomId: 'roomBad', role: 'student' },
      { groupId: 'KC5ob7INtmW3uDvBJXqa', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student' },
    ];
    const byEmail = new Map([['student.one@example.invalid', '3L0LitHlKovjiK5e3rSN']]);
    const getAcl = async (id: string) => {
      if (id === 'BAD') throw new Error('boom 500');
      return { data: [student('6Dxet6', 'student.one@example.invalid')] };
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await computeGroupAssignments(groups, getAcl, byEmail);
    errSpy.mockRestore();
    expect(res.assignments).toEqual([
      { personId: '3L0LitHlKovjiK5e3rSN', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student' },
    ]);
    expect(res.issues).toEqual([]);
  });

  it('coalesces an empty authorId to "" instead of dropping/crashing', async () => {
    const groups = [{ groupId: 'KC5ob7INtmW3uDvBJXqa', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student' }];
    const acl = { data: [student('', 'ghost@example.invalid')] }; // valid email, not in byEmail -> unknown
    const res = await computeGroupAssignments(groups, async () => acl, new Map());
    expect(res.assignments).toEqual([]);
    expect(res.issues).toEqual([
      { type: 'unknown', groupId: 'KC5ob7INtmW3uDvBJXqa', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student', uid: '', email: 'ghost@example.invalid', displayName: 'ghost@example.invalid' },
    ]);
  });

  it('assigns a member whose local identity is a UID, instead of recording it as unknown', async () => {
    const groups = [{ groupId: 'vOa9sGF9Lsf9GKJdviG6', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'schoolteacher' }];
    const acl = { data: [student('Ab1cDeFgHiJkLmNoPqRs', 'teacher.one@example.invalid')] };
    const byEmail = new Map<string, string>(); // the teacher's persons.email holds a UID, so no email key
    const byUid = new Map([['Ab1cDeFgHiJkLmNoPqRs', 'pTeacherProfile']]);
    const res = await computeGroupAssignments(groups, async () => acl, byEmail, new Set(), byUid);
    expect(res.assignments).toEqual([
      { personId: 'pTeacherProfile', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'schoolteacher' },
    ]);
    expect(res.issues).toEqual([]);
  });

  it('still reports a genuine orphan (no profile under either identity) as unknown', async () => {
    const groups = [{ groupId: 'KC5ob7INtmW3uDvBJXqa', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student' }];
    const acl = { data: [student('OrphanUid00000000000', 'orphan@example.invalid')] };
    const byUid = new Map([['Ab1cDeFgHiJkLmNoPqRs', 'pTeacherProfile']]);
    const res = await computeGroupAssignments(groups, async () => acl, new Map(), new Set(), byUid);
    expect(res.assignments).toEqual([]);
    expect(res.issues).toEqual([
      {
        type: 'unknown',
        groupId: 'KC5ob7INtmW3uDvBJXqa',
        roomId: 'LkxlSjtb0hnG4TpnvDDr',
        role: 'student',
        uid: 'OrphanUid00000000000',
        email: 'orphan@example.invalid',
        displayName: 'orphan@example.invalid',
      },
    ]);
  });

  it('excludes members whose authorId is in excludeUids (super-user group), before resolving', async () => {
    const groups = [{ groupId: 'KC5ob7INtmW3uDvBJXqa', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student' }];
    const acl = {
      data: [
        student('6Dxet6', 'student.one@example.invalid'), // -> assigned (normal member)
        student('SUPER1', 'super.admin@example.invalid'),         // super-user: would otherwise assign
        student('SUPER2', 'ghost.super@example.invalid'),         // super-user: would otherwise be unknown
      ],
    };
    // super.admin IS a local person too — exclusion must win over resolution.
    const byEmail = new Map([
      ['student.one@example.invalid', '3L0LitHlKovjiK5e3rSN'],
      ['super.admin@example.invalid', 'pSuperAdmin'],
    ]);
    const excludeUids = new Set(['SUPER1', 'SUPER2']);
    const res = await computeGroupAssignments(groups, async () => acl, byEmail, excludeUids);
    expect(res.assignments).toEqual([
      { personId: '3L0LitHlKovjiK5e3rSN', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student' },
    ]);
    expect(res.issues).toEqual([]);
  });
});
