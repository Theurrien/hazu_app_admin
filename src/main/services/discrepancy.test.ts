import { describe, it, expect } from 'vitest';
import { parseClassTag, computeDiscrepancies } from './discrepancy';

describe('parseClassTag', () => {
  it('splits on the LAST hyphen and validates the role', () => {
    expect(parseClassTag('hz-config-class-LkxlSjtb0hnG4TpnvDDr-student')).toEqual({
      classId: 'LkxlSjtb0hnG4TpnvDDr',
      role: 'student',
    });
    expect(parseClassTag('hz-config-class-abc-notarole')).toBeNull(); // unknown role
    expect(parseClassTag('hz-share-student-abc')).toBeNull();         // wrong prefix
    expect(parseClassTag('hz-config-class-nohyphen')).toBeNull();     // no role segment
  });

  it('keeps hyphens inside the classId (splits on the LAST hyphen only)', () => {
    expect(parseClassTag('hz-config-class-ab-cd-student')).toEqual({
      classId: 'ab-cd',
      role: 'student',
    });
  });
});

describe('computeDiscrepancies', () => {
  const rooms = [
    { id: 'room1', title: 'CUI-C c', classId: 'class1' },
    { id: 'room2', title: 'CIE X', classId: 'class2' },
  ];

  it('flags orphan-tag + missing-tag, carries unresolved/unknown, ignores consistent rows', () => {
    const persons = [
      // consistent: tag AND assignment for (room1, student) -> NO discrepancy
      { id: 'pA', displayName: 'Alice', email: 'alice@example.invalid', tags: ['hz-config-class-class1-student'] },
      // orphan-tag: tag for (room2, student) but no assignment
      { id: 'pB', displayName: 'Bob', email: 'bob@example.invalid', tags: ['hz-config-class-class2-student'] },
      // missing-tag: assigned (room1, schoolteacher) below but no tag
      { id: 'pC', displayName: 'Carol', email: 'carol@example.invalid', tags: [] },
    ];
    const assignments = [
      { personId: 'pA', roomId: 'room1', role: 'student' },
      { personId: 'pC', roomId: 'room1', role: 'schoolteacher' },
    ];
    const issues = [
      { type: 'unknown' as const, groupId: 'grpUnknown000000001', roomId: 'room1', role: 'student', uid: 'u9', email: 'student.two@example.invalid', displayName: 'Student Two' },
      { type: 'unresolved' as const, groupId: 'grpUnresolved000001', roomId: 'room1', role: 'student', uid: 'uidonly', email: null, displayName: 'uidonly' },
    ];
    const res = computeDiscrepancies({ rooms, persons, assignments, issues });
    expect(res).toEqual([
      { type: 'orphan-tag', roomId: 'room2', roomTitle: 'CIE X', role: 'student', personId: 'pB', email: 'bob@example.invalid', displayName: 'Bob' },
      { type: 'missing-tag', roomId: 'room1', roomTitle: 'CUI-C c', role: 'schoolteacher', personId: 'pC', email: 'carol@example.invalid', displayName: 'Carol' },
      { type: 'unresolved', roomId: 'room1', roomTitle: 'CUI-C c', role: 'student', uid: 'uidonly', email: null, displayName: 'uidonly', groupId: 'grpUnresolved000001' },
      { type: 'unknown', roomId: 'room1', roomTitle: 'CUI-C c', role: 'student', uid: 'u9', email: 'student.two@example.invalid', displayName: 'Student Two', groupId: 'grpUnknown000000001' },
    ]);
  });

  it('reports a tag whose class is absent from local rooms as orphan-tag (no silent drop)', () => {
    const persons = [{ id: 'pX', displayName: 'Xavier', email: 'xavier@example.invalid', tags: ['hz-config-class-ghostclass-student'] }];
    const res = computeDiscrepancies({ rooms, persons, assignments: [], issues: [] });
    expect(res).toEqual([
      { type: 'orphan-tag', roomId: 'ghostclass', roomTitle: null, role: 'student', personId: 'pX', email: 'xavier@example.invalid', displayName: 'Xavier', note: 'tag references a class not in local rooms' },
    ]);
  });

  it('orders same-type discrepancies by room title, then role, then name', () => {
    const sortRooms = [
      { id: 'rA', title: 'Alpha', classId: 'cA' },
      { id: 'rB', title: 'Beta', classId: 'cB' },
    ];
    const persons = [
      { id: 'p1', displayName: 'P1', email: 'p1@x', tags: ['hz-config-class-cB-student'] },
      { id: 'p2', displayName: 'P2', email: 'p2@x', tags: ['hz-config-class-cA-student'] },
      { id: 'p3', displayName: 'P3', email: 'p3@x', tags: ['hz-config-class-cA-courseteacher'] },
      { id: 'p4', displayName: 'Aaron', email: 'a@x', tags: ['hz-config-class-cA-student'] },
    ];
    const res = computeDiscrepancies({ rooms: sortRooms, persons, assignments: [], issues: [] });
    expect(res).toEqual([
      { type: 'orphan-tag', roomId: 'rA', roomTitle: 'Alpha', role: 'courseteacher', personId: 'p3', email: 'p3@x', displayName: 'P3' },
      { type: 'orphan-tag', roomId: 'rA', roomTitle: 'Alpha', role: 'student', personId: 'p4', email: 'a@x', displayName: 'Aaron' },
      { type: 'orphan-tag', roomId: 'rA', roomTitle: 'Alpha', role: 'student', personId: 'p2', email: 'p2@x', displayName: 'P2' },
      { type: 'orphan-tag', roomId: 'rB', roomTitle: 'Beta', role: 'student', personId: 'p1', email: 'p1@x', displayName: 'P1' },
    ]);
  });

  it('carries groupId through from membership_issues onto unknown rows', () => {
    const res = computeDiscrepancies({
      rooms: [{ id: 'room1', title: 'Class A', classId: 'cls1' }],
      persons: [],
      assignments: [],
      issues: [{
        type: 'unknown',
        groupId: 'grp0000000000000001',
        roomId: 'room1',
        role: 'student',
        uid: 'AcctUid00000000000001',
        email: 'orphan@example.invalid',
        displayName: 'Orphan Example',
      }],
    });
    expect(res).toHaveLength(1);
    expect(res[0].groupId).toBe('grp0000000000000001');
  });
});
