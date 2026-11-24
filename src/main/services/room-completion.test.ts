import { describe, it, expect } from 'vitest';
import { parseShareTag, completeNewRoom, RoomCompletionDeps } from './room-completion';

const ROLES = ['student', 'schoolteacher'];
const CLASS = 'Cls00000000000000001';
const ROOM = 'Room0000000000000001';

const group = (key: string, role: string, classId = CLASS) => ({
  snapshot: { key, title: `${role} group`, tags: [`hz-share-${role}-${classId}`] },
});

function deps(overrides: Partial<RoomCompletionDeps> = {}): RoomCompletionDeps & { sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    sleeps,
    readRoomTags: async () => [`hz-config-class-${CLASS}-`],
    listShareGroups: async () => [group('G1', 'student'), group('G2', 'schoolteacher')],
    validRoles: ROLES,
    sleep: async (ms) => { sleeps.push(ms); },
    ...overrides,
  };
}

describe('parseShareTag', () => {
  it('reads role and class id', () => {
    expect(parseShareTag([`hz-share-student-${CLASS}`], ROLES)).toEqual({ role: 'student', classId: CLASS });
  });
  it('ignores roles that are not synced user types', () => {
    expect(parseShareTag([`hz-share-superuser-${CLASS}`], ROLES)).toBeNull();
  });
  it('ignores unrelated tags', () => {
    expect(parseShareTag(['hz-config-group-superuser', 'hz-share-student'], ROLES)).toBeNull();
  });
});

describe('completeNewRoom', () => {
  it('takes the class id from the snapshot without reading the room', async () => {
    let reads = 0;
    const d = deps({ readRoomTags: async () => { reads++; return []; } });
    const r = await completeNewRoom(ROOM, [`hz-config-class-${CLASS}-`], d);
    expect(r.classId).toBe(CLASS);
    expect(reads).toBe(0);
    expect(r.groups.map((g) => [g.node.key, g.role])).toEqual([['G1', 'student'], ['G2', 'schoolteacher']]);
    expect(r.note).toBeNull();
  });

  it('reads the room once when the snapshot has no class tag', async () => {
    const r = await completeNewRoom(ROOM, ['hz-config-room-cie'], deps());
    expect(r.classId).toBe(CLASS);
    expect(r.note).toBeNull();
  });

  it('reports a room without a class tag and does not list groups', async () => {
    let lists = 0;
    const d = deps({ readRoomTags: async () => ['hz-config-room-cie'], listShareGroups: async () => { lists++; return []; } });
    const r = await completeNewRoom(ROOM, [], d);
    expect(r).toEqual({ classId: null, groups: [], note: 'the new room carries no hz-config-class-* tag' });
    expect(lists).toBe(0);
  });

  it('reports a failed room read instead of throwing', async () => {
    const d = deps({ readRoomTags: async () => { throw new Error('500'); } });
    const r = await completeNewRoom(ROOM, [], d);
    expect(r.classId).toBeNull();
    expect(r.note).toMatch(/could not read the new room/);
  });

  it('only keeps groups of this class', async () => {
    const d = deps({
      listShareGroups: async () => [group('G1', 'student'), group('Gx', 'student', 'Other000000000000001'), group('G2', 'schoolteacher')],
    });
    const r = await completeNewRoom(ROOM, [`hz-config-class-${CLASS}-`], d);
    expect(r.groups.map((g) => g.node.key)).toEqual(['G1', 'G2']);
  });

  it('re-reads until every role has a group, to ride out listing lag', async () => {
    let n = 0;
    const d = deps({
      listShareGroups: async () => (++n < 2 ? [group('G1', 'student')] : [group('G1', 'student'), group('G2', 'schoolteacher')]),
    });
    const r = await completeNewRoom(ROOM, [`hz-config-class-${CLASS}-`], d, { delayMs: 10 });
    expect(n).toBe(2);
    expect(d.sleeps).toEqual([10]);
    expect(r.groups).toHaveLength(2);
    expect(r.note).toBeNull();
  });

  it('settles for the groups found after the last attempt, naming the missing roles', async () => {
    const d = deps({ listShareGroups: async () => [group('G1', 'student')] });
    const r = await completeNewRoom(ROOM, [`hz-config-class-${CLASS}-`], d, { attempts: 3 });
    expect(d.sleeps).toHaveLength(2);
    expect(r.groups.map((g) => g.role)).toEqual(['student']);
    expect(r.note).toBe('no role group found yet for: schoolteacher');
  });

  it('reports an unreadable sharing container', async () => {
    const d = deps({ listShareGroups: async () => null });
    const r = await completeNewRoom(ROOM, [`hz-config-class-${CLASS}-`], d, { attempts: 2 });
    expect(r.classId).toBe(CLASS);
    expect(r.groups).toEqual([]);
    expect(r.note).toBe('could not read the sharing container');
  });
});
