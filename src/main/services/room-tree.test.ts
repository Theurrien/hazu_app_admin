import { describe, it, expect } from 'vitest';
import {
  ROOM_TYPE_TAGS,
  identifyRoomType,
  extractClassId,
  classifyNode,
  TreeNode,
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
