import { describe, it, expect } from 'vitest';
import {
  ROOM_TYPE_TAGS,
  identifyRoomType,
  extractClassId,
  classifyNode,
  walkRoomTree,
  summarizeWalkNotes,
  DEFAULT_MAX_DEPTH,
  TreeNode,
  RoomTreeDeps,
  WalkNote,
} from './room-tree';

const node = (key: string, tags: string[] = [], title = key): TreeNode => ({ key, title, tags });

describe('ROOM_TYPE_TAGS', () => {
  it('maps every room type, with the French spelling for enterprise', () => {
    expect(ROOM_TYPE_TAGS).toEqual({
      state: 'hz-config-room-state',
      class: 'hz-config-room-class',
      enterprise: 'hz-config-room-entreprise',
      cie: 'hz-config-room-cie',
    });
  });
});

describe('identifyRoomType', () => {
  it('recognises each room-type tag', () => {
    expect(identifyRoomType(['hz-config-room-state'])).toBe('state');
    expect(identifyRoomType(['hz-config-room-class'])).toBe('class');
    expect(identifyRoomType(['hz-config-room-entreprise'])).toBe('enterprise');
    expect(identifyRoomType(['hz-config-room-cie'])).toBe('cie');
  });

  it('ignores unrelated tags', () => {
    expect(identifyRoomType(['hz-config-sharing', 'something-else'])).toBeNull();
  });

  it('returns null for an empty tag list', () => {
    expect(identifyRoomType([])).toBeNull();
  });
});

describe('extractClassId', () => {
  it('reads the id from a bare class tag', () => {
    expect(extractClassId(['hz-config-class-Abc123XyzRoom00000001'])).toBe('Abc123XyzRoom00000001');
  });

  it('stops at the role suffix', () => {
    expect(extractClassId(['hz-config-class-Abc123XyzRoom00000001-student'])).toBe('Abc123XyzRoom00000001');
  });

  it('tolerates the trailing-hyphen form room nodes carry', () => {
    // Room nodes are tagged "hz-config-class-<id>-" with no role.
    expect(extractClassId(['hz-config-class-Abc123XyzRoom00000001-'])).toBe('Abc123XyzRoom00000001');
  });

  it('returns null when no class tag is present', () => {
    expect(extractClassId(['hz-config-room-cie'])).toBeNull();
  });

  it('returns null for a malformed class tag with no alphanumeric id', () => {
    expect(extractClassId(['hz-config-class--'])).toBeNull();
  });

  it('uses the first class tag it finds', () => {
    expect(extractClassId(['hz-config-class-First0000000000000001', 'hz-config-class-Second000000000000001']))
      .toBe('First0000000000000001');
  });
});

describe('classifyNode', () => {
  it('classifies a class-tagged node as a room, typed from its own room tag', () => {
    const n = node('Room0000000000000001', ['hz-config-room-cie', 'hz-config-class-Room0000000000000001-']);
    expect(classifyNode(n, 'class')).toEqual({
      kind: 'room',
      classId: 'Room0000000000000001',
      roomType: 'cie',   // self-tag wins over the inherited 'class'
    });
  });

  it('falls back to the inherited type when the room has no room tag', () => {
    const n = node('Room0000000000000002', ['hz-config-class-Room0000000000000002-']);
    expect(classifyNode(n, 'enterprise')).toEqual({
      kind: 'room',
      classId: 'Room0000000000000002',
      roomType: 'enterprise',
    });
  });

  it('leaves roomType null when there is neither a self-tag nor an inherited type', () => {
    const n = node('Room0000000000000003', ['hz-config-class-Room0000000000000003-']);
    expect(classifyNode(n, null)).toEqual({
      kind: 'room',
      classId: 'Room0000000000000003',
      roomType: null,
    });
  });

  it('classifies a room-tagged node with no class tag as a category', () => {
    expect(classifyNode(node('Cat00000000000000001', ['hz-config-room-cie']), null)).toEqual({
      kind: 'category',
      classId: null,
      roomType: 'cie',
    });
  });

  it('classifies an untagged node as a folder', () => {
    expect(classifyNode(node('Folder00000000000001', []), 'cie')).toEqual({
      kind: 'folder',
      classId: null,
      roomType: null,
    });
  });

  it('treats a node whose tags are undefined as a folder', () => {
    expect(classifyNode({ key: 'Folder00000000000002' }, null)).toEqual({
      kind: 'folder',
      classId: null,
      roomType: null,
    });
  });

  it('treats a malformed class tag as not-a-room', () => {
    // extractClassId yields null, so this is a folder to walk through, not a room to write.
    expect(classifyNode(node('Odd00000000000000001', ['hz-config-class--']), 'cie')).toEqual({
      kind: 'folder',
      classId: null,
      roomType: null,
    });
  });

  it('prefers room over category when a node carries both tags', () => {
    const n = node('Room0000000000000004', ['hz-config-room-state', 'hz-config-class-Room0000000000000004-']);
    expect(classifyNode(n, null).kind).toBe('room');
  });
});

// A fake Hazu tree: parent id -> its children, or null to simulate an unreadable subtree.
// An id absent from the map has no children.
type FakeTree = Record<string, Array<{ snapshot: TreeNode }> | null>;

const child = (key: string, tags: string[] = [], title = key) => ({ snapshot: node(key, tags, title) });

function fakeDeps(tree: FakeTree): RoomTreeDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listChildren: async (id: string) => {
      calls.push(id);
      return id in tree ? tree[id] : [];
    },
  };
}

const ROOT = 'Root0000000000000001';
const CAT = 'Cat00000000000000001';
const catTags = ['hz-config-room-cie'];
const roomTags = (id: string) => [`hz-config-class-${id}-`];

describe('walkRoomTree', () => {
  it('finds a room at depth 2, directly under a category', async () => {
    const deps = fakeDeps({
      [ROOT]: [child(CAT, catTags)],
      [CAT]: [child('RoomD2000000000000001', roomTags('RoomD2000000000000001'))],
    });
    const r = await walkRoomTree(ROOT, deps);
    expect(r.categories.map((c) => c.node.key)).toEqual([CAT]);
    expect(r.rooms.map((x) => [x.node.key, x.parentId, x.depth])).toEqual([
      ['RoomD2000000000000001', CAT, 2],
    ]);
  });

  it('finds rooms at depth 3 and 4, and records the true parent rather than the category', async () => {
    const deps = fakeDeps({
      [ROOT]: [child(CAT, catTags)],
      [CAT]: [child('FolderD2000000000001')],
      FolderD2000000000001: [
        child('RoomD3000000000000001', roomTags('RoomD3000000000000001')),
        child('FolderD3000000000001'),
      ],
      FolderD3000000000001: [child('RoomD4000000000000001', roomTags('RoomD4000000000000001'))],
    });
    const r = await walkRoomTree(ROOT, deps);
    expect(r.rooms.map((x) => [x.node.key, x.parentId, x.depth])).toEqual([
      ['RoomD3000000000000001', 'FolderD2000000000001', 3],
      ['RoomD4000000000000001', 'FolderD3000000000001', 4],
    ]);
  });

  it('records a folder sitting at maxDepth in truncatedAt and does not descend into it', async () => {
    const deps = fakeDeps({
      [ROOT]: [child(CAT, catTags)],
      [CAT]: [child('FolderAtCap000000001', [], 'Folder At Cap')],
      FolderAtCap000000001: [child('RoomBeyond0000000001', roomTags('RoomBeyond0000000001'))],
    });
    const r = await walkRoomTree(ROOT, deps, { maxDepth: 2 });
    expect(r.truncatedAt).toEqual([
      { id: 'FolderAtCap000000001', title: 'Folder At Cap', depth: 2, parentId: CAT, parentTitle: CAT },
    ]);
    expect(r.rooms).toEqual([]);
    expect(deps.calls).not.toContain('FolderAtCap000000001');
  });

  it('never descends into a room, even when the fixture gives it children', async () => {
    const deps = fakeDeps({
      [ROOT]: [child(CAT, catTags)],
      [CAT]: [child('RoomWithKids00000001', roomTags('RoomWithKids00000001'))],
      RoomWithKids00000001: [child('ContentItem000000001', roomTags('ContentItem000000001'))],
    });
    const r = await walkRoomTree(ROOT, deps);
    expect(r.rooms.map((x) => x.node.key)).toEqual(['RoomWithKids00000001']);
    expect(deps.calls).not.toContain('RoomWithKids00000001');
  });

  it('records an unreadable subtree in readFailures and keeps walking its siblings', async () => {
    const deps = fakeDeps({
      [ROOT]: [child(CAT, catTags)],
      [CAT]: [child('Unreadable0000000001', [], 'Locked Folder'), child('OkFolder000000000001')],
      Unreadable0000000001: null,
      OkFolder000000000001: [child('RoomOk00000000000001', roomTags('RoomOk00000000000001'))],
    });
    const r = await walkRoomTree(ROOT, deps);
    expect(r.readFailures).toEqual([
      { id: 'Unreadable0000000001', title: 'Locked Folder', depth: 2, parentId: CAT, parentTitle: CAT },
    ]);
    expect(r.rooms.map((x) => x.node.key)).toEqual(['RoomOk00000000000001']);
  });

  it('throws when the root listing fails, because the caller has already cleared the rooms table', async () => {
    const deps = fakeDeps({ [ROOT]: null });
    await expect(walkRoomTree(ROOT, deps)).rejects.toThrow('Failed to fetch children from root Hazu');
  });

  it('does not walk root children that are not categories', async () => {
    const deps = fakeDeps({
      [ROOT]: [child(CAT, catTags), child('PersonContainer00001', [], 'Apprenties')],
      [CAT]: [],
      PersonContainer00001: [child('Person00000000000001')],
    });
    const r = await walkRoomTree(ROOT, deps);
    expect(deps.calls).toEqual([ROOT, CAT]);
    expect(r.truncatedAt).toEqual([]);
  });

  it('walks a category below depth 1 without recording it, but adopts its type', async () => {
    const deps = fakeDeps({
      [ROOT]: [child(CAT, ['hz-config-room-class'])],
      [CAT]: [child('DeepCat00000000000001', ['hz-config-room-state'])],
      DeepCat00000000000001: [child('RoomDeep000000000001', roomTags('RoomDeep000000000001'))],
    });
    const r = await walkRoomTree(ROOT, deps);
    expect(r.categories.map((c) => c.node.key)).toEqual([CAT]);
    expect(r.rooms[0].roomType).toBe('state');
  });

  it('visits a cyclic node only once', async () => {
    const deps = fakeDeps({
      [ROOT]: [child(CAT, catTags)],
      [CAT]: [child('LoopFolder0000000001')],
      LoopFolder0000000001: [child(CAT, catTags)],
    });
    const r = await walkRoomTree(ROOT, deps);
    expect(deps.calls).toEqual([ROOT, CAT, 'LoopFolder0000000001']);
    expect(r.categories).toHaveLength(1);
  });

  it('counts listChildren invocations: one for root, one per node descended into, none for a room', async () => {
    const deps = fakeDeps({
      [ROOT]: [child(CAT, catTags)],
      [CAT]: [child('RoomC000000000000001', roomTags('RoomC000000000000001')), child('FolderC00000000000001')],
      FolderC00000000000001: [],
    });
    const r = await walkRoomTree(ROOT, deps);
    expect(r.calls).toBe(3);
    expect(deps.calls).toEqual([ROOT, CAT, 'FolderC00000000000001']);
  });

  it('returns empty collections for a root with no children', async () => {
    const r = await walkRoomTree(ROOT, fakeDeps({ [ROOT]: [] }));
    expect(r).toEqual({
      categories: [],
      rooms: [],
      truncatedAt: [],
      readFailures: [],
      unexpectedRooms: [],
      calls: 1,
    });
  });

  it('records a room found at depth 1 in unexpectedRooms instead of writing it as a room', async () => {
    const deps = fakeDeps({
      [ROOT]: [child('StrayRoom000000000001', roomTags('StrayRoom000000000001'), 'Stray Room')],
    });
    const r = await walkRoomTree(ROOT, deps);
    expect(r.rooms).toEqual([]);
    expect(r.categories).toEqual([]);
    expect(r.unexpectedRooms).toEqual([
      { id: 'StrayRoom000000000001', title: 'Stray Room', depth: 1, parentId: ROOT, parentTitle: '' },
    ]);
    // A depth-1 room has no children to speak of, but confirm the walk doesn't try to descend it.
    expect(deps.calls).toEqual([ROOT]);
  });

  it('keeps walking sibling categories when a depth-1 category fails to list its own children', async () => {
    const CAT2 = 'Cat00000000000000002';
    const deps = fakeDeps({
      [ROOT]: [child(CAT, catTags, 'Failing Category'), child(CAT2, catTags, 'OK Category')],
      [CAT]: null,
      [CAT2]: [child('RoomOk20000000000001', roomTags('RoomOk20000000000001'))],
    });
    const r = await walkRoomTree(ROOT, deps);
    expect(r.readFailures).toEqual([
      { id: CAT, title: 'Failing Category', depth: 1, parentId: ROOT, parentTitle: '' },
    ]);
    // Both categories are still recorded — the failure is on CAT's own children, not on CAT itself.
    expect(r.categories.map((c) => c.node.key)).toEqual([CAT, CAT2]);
    expect(r.rooms.map((x) => x.node.key)).toEqual(['RoomOk20000000000001']);
  });

  it('defaults maxDepth to 4', async () => {
    expect(DEFAULT_MAX_DEPTH).toBe(4);
    const deps = fakeDeps({
      [ROOT]: [child(CAT, catTags)],
      [CAT]: [child('F2000000000000000001')],
      F2000000000000000001: [child('F3000000000000000001')],
      F3000000000000000001: [child('F4000000000000000001')],
      F4000000000000000001: [child('RoomD5000000000000001', roomTags('RoomD5000000000000001'))],
    });
    const r = await walkRoomTree(ROOT, deps);
    expect(r.rooms).toEqual([]);
    expect(r.truncatedAt.map((t) => t.depth)).toEqual([4]);
  });
});

// The ~62 Calendrier scolaire calendar entries that 401 on their own children are the one
// branch guaranteed to fire on every real sync — a pure string function over WalkNote[], so
// it gets tested here rather than deferred to a syncRooms integration test that needs the
// native module and a live API.
describe('summarizeWalkNotes', () => {
  const noteAt = (id: string, parentId: string, parentTitle = parentId): WalkNote => ({
    id,
    title: id,
    depth: 2,
    parentId,
    parentTitle,
  });

  it('returns an empty string for no notes', () => {
    expect(summarizeWalkNotes([])).toBe('');
  });

  it('renders a single entry with its parent and the total', () => {
    expect(summarizeWalkNotes([noteAt('A', 'P1', 'Parent One')])).toBe('1 under "Parent One" (1 total)');
  });

  it('collapses several notes under the same parent into one line', () => {
    const notes = [noteAt('A', 'P1', 'Parent One'), noteAt('B', 'P1', 'Parent One'), noteAt('C', 'P1', 'Parent One')];
    expect(summarizeWalkNotes(notes)).toBe('3 under "Parent One" (3 total)');
  });

  it('keeps notes under different parents on separate lines', () => {
    const notes = [noteAt('A', 'P1', 'Parent One'), noteAt('B', 'P2', 'Parent Two')];
    expect(summarizeWalkNotes(notes)).toBe('1 under "Parent One", 1 under "Parent Two" (2 total)');
  });

  it('falls back to the parent id when parentTitle is empty', () => {
    expect(summarizeWalkNotes([noteAt('A', 'ParentId0000000000001', '')]))
      .toBe('1 under "ParentId0000000000001" (1 total)');
  });

  it('shows every group with no overflow marker exactly at the cap', () => {
    const notes = [noteAt('A', 'P1'), noteAt('B', 'P2')];
    expect(summarizeWalkNotes(notes, 2)).toBe('1 under "P1", 1 under "P2" (2 total)');
  });

  it('caps the groups shown and reports the true total in the overflow text', () => {
    const notes = [noteAt('A', 'P1'), noteAt('B', 'P2'), noteAt('C', 'P3')];
    const result = summarizeWalkNotes(notes, 2);
    expect(result).toBe('1 under "P1", 1 under "P2" … and 1 more group(s) (3 total)');
    expect(result).toContain('(3 total)');
  });
});
