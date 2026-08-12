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

export interface DiscoveredCategory {
  node: TreeNode;
  roomType: RoomType;
}

export interface DiscoveredRoom {
  node: TreeNode;
  classId: string;
  roomType: RoomType | null;   // null when neither a self-tag nor a typed ancestor gave one
  parentId: string;            // the TRUE parent: a category or a sub-folder
  depth: number;
}

export interface WalkNote {
  id: string;
  title: string;
  depth: number;
  parentId: string;    // the id of the node's own parent, for grouping log lines
  parentTitle: string; // the parent's title — '' when unknown (e.g. the parent is root)
}

export interface WalkResult {
  categories: DiscoveredCategory[];
  rooms: DiscoveredRoom[];
  truncatedAt: WalkNote[];      // folders visited and classified, but not descended into
                                 // because the depth cap was reached — their children are unread
  readFailures: WalkNote[];     // nodes whose children could not be listed
  unexpectedRooms: WalkNote[];  // rooms found at depth 1 — dropped rather than written, since a
                                 // depth-1 parent_id === rootId would collide with the category
                                 // predicate CreateRoomModal relies on
  calls: number;                // listChildren invocations
}

export interface RoomTreeDeps {
  // Returns the node's children, or null if they could not be read.
  listChildren: (id: string) => Promise<Array<{ snapshot: TreeNode }> | null>;
}

export interface RoomTreeConfig {
  maxDepth?: number;
}

// One level beyond where every hidden room sits today, leaving headroom for the CIE
// year-folder structure without walking the calendar subtree's grandchildren.
export const DEFAULT_MAX_DEPTH = 4;

/**
 * Walk the room tree from `rootId`, collecting categories and rooms.
 *
 * Depth is counted from root: root's children are depth 1 (the category layer), rooms
 * directly beneath a category are depth 2. A folder sitting at `maxDepth` is recorded in
 * `truncatedAt` rather than descended into, so a bounded sweep never reads as complete
 * coverage. Rooms are never descended into — their children are content, not rooms.
 *
 * Throws only if the ROOT listing fails: the caller clears the rooms table before calling
 * this, so an empty result there would silently wipe every room.
 */
export async function walkRoomTree(
  rootId: string,
  deps: RoomTreeDeps,
  config: RoomTreeConfig = {},
): Promise<WalkResult> {
  const maxDepth = config.maxDepth ?? DEFAULT_MAX_DEPTH;
  const result: WalkResult = {
    categories: [],
    rooms: [],
    truncatedAt: [],
    readFailures: [],
    unexpectedRooms: [],
    calls: 0,
  };
  const visited = new Set<string>([rootId]);

  // `parentId` is the id of the container this node was found under (in scope at every call
  // site via `containerId`); `parentTitle` is that container's own title, taken from its note
  // where one exists — root has no note, so its children get '' (the renderer falls back to
  // the id, same as it does for a titleless node).
  const note = (node: TreeNode, depth: number, parentId: string, parentTitle: string): WalkNote => ({
    id: node.key,
    title: node.title || '',
    depth,
    parentId,
    parentTitle,
  });

  // List the children of `containerId` — which sit at `depth` — and process them.
  // `containerNote` is null only for the root, which has no note to record.
  async function descend(
    containerId: string,
    containerNote: WalkNote | null,
    depth: number,
    inheritedType: RoomType | null,
  ): Promise<void> {
    result.calls += 1;
    const children = await deps.listChildren(containerId);

    if (children === null) {
      if (containerNote === null) {
        throw new Error('Failed to fetch children from root Hazu');
      }
      // An unreadable subtree is not an empty one.
      result.readFailures.push(containerNote);
      return;
    }

    for (const child of children) {
      const node = child?.snapshot;
      if (!node?.key || visited.has(node.key)) continue;
      visited.add(node.key);

      const classification = classifyNode(node, inheritedType);
      const parentTitle = containerNote?.title ?? '';

      if (classification.kind === 'room') {
        if (depth === 1) {
          // A class-tagged node directly under root. Root has no category ancestor here, so
          // parentId would be rootId — indistinguishable from a category container under
          // CreateRoomModal's `room_type === type && parent_id === rootHazuId` predicate.
          // Drop it loudly instead of writing a room that would silently misconfigure creation.
          result.unexpectedRooms.push(note(node, depth, containerId, parentTitle));
          continue;
        }
        result.rooms.push({
          node,
          classId: classification.classId as string,
          roomType: classification.roomType,
          parentId: containerId,
          depth,
        });
        continue;
      }

      if (classification.kind === 'category' && depth === 1) {
        result.categories.push({ node, roomType: classification.roomType as RoomType });
      }

      // Depth 1 is the category layer. Root's other children — person containers,
      // administration, general information — are not walked, exactly as before.
      if (depth === 1 && classification.kind !== 'category') continue;

      if (depth >= maxDepth) {
        result.truncatedAt.push(note(node, depth, containerId, parentTitle));
        continue;
      }

      await descend(
        node.key,
        note(node, depth, containerId, parentTitle),
        depth + 1,
        classification.kind === 'category' ? classification.roomType : inheritedType,
      );
    }
  }

  await descend(rootId, null, 1, null);
  return result;
}

// How many parent-groups to print before collapsing the rest into an overflow marker. A
// permanent wall of individual names (e.g. ~62 Calendrier scolaire calendar entries that each
// 401 on their own children) trains the operator to stop reading it, which is exactly what
// "truncation/failure is never silent" exists to prevent — so notes are grouped by parent
// first, and only the resulting group *lines* are capped, not the raw entries.
export const DEFAULT_NOTE_GROUP_CAP = 10;

/**
 * Render a list of WalkNotes (readFailures, truncatedAt, or unexpectedRooms) as one log-ready
 * line: one summary per distinct parent ("<count> under "<parent>""), capped to `maxGroups`
 * groups with an overflow marker, always closing with the true total count so it can never
 * read as complete when it isn't.
 *
 * Pure and side-effect free — callers strip HTML from `title`/`parentTitle` before handing
 * notes in, since this module has no stripHtml (and no HTTP/DB) to call.
 */
export function summarizeWalkNotes(notes: WalkNote[], maxGroups: number = DEFAULT_NOTE_GROUP_CAP): string {
  if (notes.length === 0) return '';

  const order: string[] = [];
  const groups = new Map<string, { label: string; count: number }>();
  for (const n of notes) {
    let group = groups.get(n.parentId);
    if (!group) {
      group = { label: n.parentTitle || n.parentId, count: 0 };
      groups.set(n.parentId, group);
      order.push(n.parentId);
    }
    group.count += 1;
  }

  const lines = order.map((parentId) => {
    const group = groups.get(parentId) as { label: string; count: number };
    return `${group.count} under "${group.label}"`;
  });

  const shown = lines.slice(0, maxGroups);
  const body = lines.length > maxGroups
    ? `${shown.join(', ')} … and ${lines.length - maxGroups} more group(s)`
    : shown.join(', ');

  return `${body} (${notes.length} total)`;
}
