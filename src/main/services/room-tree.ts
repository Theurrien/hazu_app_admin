/**
 * Pure room-tree classification and traversal.
 *
 * No DB, no HTTP, no Electron: the child-lister is injected, so the whole walk runs under
 * vitest without the native module or the network. sync.service.ts supplies the real IO.
 */

import { RoomType } from '../../shared/types';

// The tag that marks a Hazu node as a room (or a room category) of a given type.
// Owned here rather than in sync.service.ts so the pure module has no dependency on the
// IO layer; sync.service.ts imports what it needs from here.
export const ROOM_TYPE_TAGS: Record<RoomType, string> = {
  state: 'hz-config-room-state',
  class: 'hz-config-room-class',
  enterprise: 'hz-config-room-entreprise',
  cie: 'hz-config-room-cie',
};

const CLASS_TAG_PREFIX = 'hz-config-class-';

// The subset of a Hazu snapshot the walk reads. Every field but `key` is optional so
// fixtures stay small; a real HazuSnapshot is structurally assignable to this.
export interface TreeNode {
  key: string;
  title?: string;
  description?: string;
  color?: string;
  icon?: string;
  parentId?: string;
  tags?: string[];
}

export type NodeKind = 'category' | 'room' | 'folder';

export interface NodeClassification {
  kind: NodeKind;
  classId: string | null;
  roomType: RoomType | null;
}

export function identifyRoomType(tags: string[]): RoomType | null {
  for (const [type, tag] of Object.entries(ROOM_TYPE_TAGS)) {
    if (tags.includes(tag)) return type as RoomType;
  }
  return null;
}

// Read the class id out of a hz-config-class-* tag. Class ids are alphanumeric, so this takes
// the leading alphanumeric run — which tolerates both "hz-config-class-<id>-<role>" on a
// profile and the trailing-hyphen form "hz-config-class-<id>-" that room nodes carry.
export function extractClassId(tags: string[]): string | null {
  for (const tag of tags) {
    if (tag.startsWith(CLASS_TAG_PREFIX)) {
      const match = tag.substring(CLASS_TAG_PREFIX.length).match(/^[a-zA-Z0-9]+/);
      return match ? match[0] : null;
    }
  }
  return null;
}

// What is this node, and what type does it carry? `inheritedType` is the type of the nearest
// category ancestor. A class tag makes a node a room regardless of what else it carries.
export function classifyNode(node: TreeNode, inheritedType: RoomType | null): NodeClassification {
  const tags = node.tags || [];
  const selfType = identifyRoomType(tags);
  const classId = extractClassId(tags);

  if (classId) {
    return { kind: 'room', classId, roomType: selfType ?? inheritedType };
  }
  if (selfType) {
    return { kind: 'category', classId: null, roomType: selfType };
  }
  return { kind: 'folder', classId: null, roomType: null };
}
