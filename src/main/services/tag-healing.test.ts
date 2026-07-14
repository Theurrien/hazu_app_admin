import { describe, it, expect } from 'vitest';
import { buildClassTag, planTagHeals } from './tag-healing';
import { Discrepancy } from './discrepancy';

describe('buildClassTag', () => {
  it('builds the breadcrumb for a valid classId + role', () => {
    expect(buildClassTag('abc123', 'student')).toBe('hz-config-class-abc123-student');
    expect(buildClassTag('XY9', 'schoolteacher')).toBe('hz-config-class-XY9-schoolteacher');
  });

  it('accepts a hyphenated classId that still round-trips (last-hyphen parse)', () => {
    // parseClassTag splits on the LAST hyphen, so the role (which has no hyphen)
    // is always recovered and the full classId round-trips.
    expect(buildClassTag('ab-cd', 'student')).toBe('hz-config-class-ab-cd-student');
  });

  it('returns null for empty classId or role', () => {
    expect(buildClassTag('', 'student')).toBeNull();
    expect(buildClassTag('abc123', '')).toBeNull();
  });

  it('returns null for a role outside the valid set', () => {
    expect(buildClassTag('abc123', 'bogus')).toBeNull();
    expect(buildClassTag('abc123', 'reader')).toBeNull(); // ACL role, not a breadcrumb role
  });
});

describe('planTagHeals', () => {
  const roomIdToClassId = new Map<string, string>([
    ['room1', 'CLS1'],
    ['room2', 'CLS2'],
  ]);

  const discrepancies: Discrepancy[] = [
    { type: 'missing-tag', roomId: 'room1', roomTitle: 'Room One', role: 'student', personId: 'p1', email: 'a@example.invalid', displayName: 'Alice' },
    { type: 'orphan-tag', roomId: 'room1', roomTitle: 'Room One', role: 'student', personId: 'p2', email: 'b@example.invalid', displayName: 'Bob' },
    { type: 'missing-tag', roomId: 'roomX', roomTitle: null, role: 'schoolteacher', personId: 'p3', email: null, displayName: 'Carol' },
    { type: 'unknown', roomId: 'room2', roomTitle: 'Room Two', role: 'student', uid: 'u1', email: 'c@example.invalid', displayName: 'Dan' },
    { type: 'unresolved', roomId: 'room2', roomTitle: 'Room Two', role: 'student', uid: 'u2', email: null, displayName: 'uid-only' },
  ];

  it('plans only missing-tag rows, with correct tags and carried fields', () => {
    const plan = planTagHeals(discrepancies, roomIdToClassId);
    expect(plan.items).toEqual([
      { personId: 'p1', roomId: 'room1', roomTitle: 'Room One', role: 'student', tag: 'hz-config-class-CLS1-student', displayName: 'Alice', email: 'a@example.invalid' },
    ]);
  });

  it('skips a missing-tag whose room has no class_id', () => {
    const plan = planTagHeals(discrepancies, roomIdToClassId);
    expect(plan.skipped).toEqual([
      { personId: 'p3', roomId: 'roomX', role: 'schoolteacher', reason: 'no class_id for room' },
    ]);
  });

  it('ignores orphan-tag / unknown / unresolved entirely', () => {
    const plan = planTagHeals(discrepancies, roomIdToClassId);
    const touchedPersons = [...plan.items, ...plan.skipped].map((x) => x.personId).sort();
    expect(touchedPersons).toEqual(['p1', 'p3']); // p2 (orphan) never considered
  });
});
