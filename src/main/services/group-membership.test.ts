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
});
