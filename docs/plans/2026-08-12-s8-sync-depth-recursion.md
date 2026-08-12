# S8 — Sync Depth Recursion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `syncRooms` find every room in the Hazu tree instead of only the two levels it walks today, so the 31 rooms currently hidden in CIE year sub-folders become real rooms with real assignments.

**Architecture:** Extract the traversal into a new pure module, `room-tree.ts`, whose child-lister is injected — making depth capping, cycle protection, read-failure tolerance and type resolution unit-testable with no network and no native module. `syncRooms` shrinks to "call the walk, write the rows, log the diagnostics." Nothing downstream changes: `runSync` already orders rooms → groups → memberships, and `syncDistributionGroups` links a group to its room by `class_id`.

**Tech Stack:** TypeScript (Node/CommonJS via `tsconfig.main.json`), better-sqlite3, vitest 4.

**Spec:** [docs/specs/2026-08-12-s8-sync-depth-recursion-design.md](../specs/2026-08-12-s8-sync-depth-recursion-design.md)

## Global Constraints

Copied from the spec. Every task's requirements implicitly include this section.

- **Depth is capped, and truncation is never silent.** Default `maxDepth = 4`. Any folder left unvisited at the cap is recorded and logged by name.
- **Never descend into a room.** A node carrying `hz-config-class-*` is a room; its children are content, not rooms.
- **An unreadable subtree is not an empty subtree.** A `listChildren` failure is recorded and logged, never treated as "no children here."
- **Only nodes with `hz-config-class-*` become rooms.** Untagged nodes are folders to walk through, never rows to write.
- **Intermediate folders are not stored.** Only the depth-1 category folders (as today) and actual rooms.
- **Category folders keep `parent_id = root_hazu_id`.** `CreateRoomModal` identifies a category by exactly that predicate ([CreateRoomModal.tsx:86](../../src/renderer/components/CreateRoomModal.tsx:86)).
- **Pure-core + injected IO.** The walk is a pure orchestrator over an injected child-lister, vitest-runnable without the native module or the network.
- **No behaviour change for the 123 rooms already synced.** Their `class_id`, `room_type`, and `parent_id` must be identical after the change.
- **No schema change, no IPC change, no renderer change.**
- Person-data rule (CLAUDE.md): fixtures use invented ids and titles. No real names, addresses, or profile ids anywhere.

### Verification baselines (measured 2026-08-12, before any change)

| check | command | baseline |
|---|---|---|
| tests | `npm test` | **72 passed, 5 files** |
| main typecheck | `npx tsc -p tsconfig.main.json --noEmit` | **0 errors** |
| renderer typecheck | `npx tsc -p tsconfig.json --noEmit` | **9 pre-existing errors** — do not "fix" these; the count must not rise |
| person-data guard | `python3 scripts/check-no-person-data.py --all` | **exit 0** |

## File Structure

| File | Responsibility |
|---|---|
| `src/main/services/room-tree.ts` (new) | Pure tag classification and tree traversal. No DB, no HTTP, no Electron. Owns `ROOM_TYPE_TAGS`, `identifyRoomType`, `extractClassId`, `classifyNode`, `walkRoomTree`. |
| `src/main/services/room-tree.test.ts` (new) | Unit tests over fixture trees. |
| `src/main/services/sync.service.ts` (modify) | `syncRooms` delegates to `walkRoomTree` and writes rows. Loses its local `ROOM_TAG_PATTERNS`, `RoomType`, `identifyRoomType`, `extractClassId`, and the dead `syncRoomsRecursive`. |

## Documented deviations from the spec

Two, both deliberate. A reviewer should treat these as approved, not as findings.

**1. `DiscoveredRoom` carries the raw node instead of copied-out fields.** The spec sketches `DiscoveredRoom` with `title`, `description`, `color`, `icon`, `tags`, `raw`. Doing that would force the pure module to own `stripHtml`, which lives in `sync.service.ts` and has nine other callers there — either duplicating it or exporting a presentation helper out of a pure traversal module. Instead `DiscoveredRoom` carries `node: TreeNode` and `sync.service.ts` extracts and strips exactly as it does today. This also makes the "no behaviour change for the 123 existing rooms" constraint near-trivial to verify, because the writing code barely moves.

**2. `roomType` is `RoomType | null` rather than always resolved.** The spec says a room whose type cannot be resolved is "skipped by the writer with a log line," which requires the walk to return it with no type. `null` carries that, and the writer skips it.

**Not a deviation, but easy to mistake for one:** Task 1 relocates `extractClassId` from `sync.service.ts` into `room-tree.ts` **unchanged**. That is not the deferred reconciliation between `extractClassId` (truncates at the first non-alphanumeric) and `parseClassTag` in `discrepancy.ts` (splits at the last hyphen), which the spec explicitly puts out of scope. The two still disagree in principle and still agree on every live class id. Do not "fix" that here.

---

### Task 1: Pure tag classification

**Files:**
- Create: `src/main/services/room-tree.ts`
- Test: `src/main/services/room-tree.test.ts`

**Interfaces:**
- Consumes: `RoomType` from `src/shared/types.ts` — `export type RoomType = 'state' | 'class' | 'enterprise' | 'cie';`
- Produces, for Task 2 and Task 3:
  - `interface TreeNode { key: string; title?: string; description?: string; color?: string; icon?: string; parentId?: string; tags?: string[] }`
  - `type NodeKind = 'category' | 'room' | 'folder'`
  - `interface NodeClassification { kind: NodeKind; classId: string | null; roomType: RoomType | null }`
  - `function identifyRoomType(tags: string[]): RoomType | null`
  - `function extractClassId(tags: string[]): string | null`
  - `function classifyNode(node: TreeNode, inheritedType: RoomType | null): NodeClassification`
  - `const ROOM_TYPE_TAGS: Record<RoomType, string>`

**Context:** `identifyRoomType` and `extractClassId` already exist as private functions in `sync.service.ts` (lines 92 and 207). This task moves them, unchanged in behaviour, into the pure module so `classifyNode` can use them without dragging in the IO layer. Do **not** modify `sync.service.ts` in this task — Task 3 removes the originals. Two definitions coexisting for one task is expected and fine.

- [ ] **Step 1: Write the failing tests**

Create `src/main/services/room-tree.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/services/room-tree.test.ts`

Expected: FAIL — `Failed to resolve import "./room-tree"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/services/room-tree.ts`:

```typescript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/services/room-tree.test.ts`

Expected: PASS — 18 tests, no warnings in the output.

- [ ] **Step 5: Run the full suite and the main typecheck**

Run: `npm test`
Expected: **90 passed** (72 baseline + 18 new), 6 files.

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: no output (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/services/room-tree.ts src/main/services/room-tree.test.ts
git commit -m "feat(s8): pure room-tree node classification"
```

---

### Task 2: The depth-capped walk

**Files:**
- Modify: `src/main/services/room-tree.ts` (append)
- Test: `src/main/services/room-tree.test.ts` (append)

**Interfaces:**
- Consumes, from Task 1: `TreeNode`, `NodeClassification`, `classifyNode`, `RoomType`.
- Produces, for Task 3:
  - `interface DiscoveredCategory { node: TreeNode; roomType: RoomType }`
  - `interface DiscoveredRoom { node: TreeNode; classId: string; roomType: RoomType | null; parentId: string; depth: number }`
  - `interface WalkNote { id: string; title: string; depth: number }`
  - `interface WalkResult { categories: DiscoveredCategory[]; rooms: DiscoveredRoom[]; truncatedAt: WalkNote[]; readFailures: WalkNote[]; calls: number }`
  - `interface RoomTreeDeps { listChildren: (id: string) => Promise<Array<{ snapshot: TreeNode }> | null> }`
  - `interface RoomTreeConfig { maxDepth?: number }`
  - `const DEFAULT_MAX_DEPTH = 4`
  - `function walkRoomTree(rootId: string, deps: RoomTreeDeps, config?: RoomTreeConfig): Promise<WalkResult>`

**Context:** Depth is counted from root: **root's children are depth 1** (the category layer), rooms directly beneath a category are depth 2, and the hidden CIE rooms are at depth 3. `maxDepth = 4` means nodes at depth 1–4 are visited; a *folder* sitting at depth 4 is recorded in `truncatedAt` rather than descended into.

Three behaviours are easy to get wrong and each has a dedicated test:

1. **Depth 1 is the category layer.** Root has 8 untagged children (person containers, administration, general information). Today they are ignored; the walk must keep ignoring them, or every sync would crawl the entire person tree.
2. **A failed root listing must throw.** `runSync` calls `clearOldData()` before `syncRooms`, so returning an empty result on a root read failure would leave the rooms table empty and report success. The existing code throws `"Failed to fetch children from root Hazu"`; preserve that exactly.
3. **A category below depth 1 is walked, not recorded.** Only depth-1 categories are stored, but a deeper one still contributes its type as the new `inheritedType`.

- [ ] **Step 1: Write the failing tests**

First **extend the existing import** at the top of `src/main/services/room-tree.test.ts` — do not add a second import statement from the same module — so it reads:

```typescript
import {
  ROOM_TYPE_TAGS,
  identifyRoomType,
  extractClassId,
  classifyNode,
  walkRoomTree,
  DEFAULT_MAX_DEPTH,
  TreeNode,
  RoomTreeDeps,
} from './room-tree';
```

Then append to the same file:

```typescript
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
    expect(r.truncatedAt).toEqual([{ id: 'FolderAtCap000000001', title: 'Folder At Cap', depth: 2 }]);
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
    expect(r.readFailures).toEqual([{ id: 'Unreadable0000000001', title: 'Locked Folder', depth: 2 }]);
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
    expect(r).toEqual({ categories: [], rooms: [], truncatedAt: [], readFailures: [], calls: 1 });
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/services/room-tree.test.ts`

Expected: FAIL — `walkRoomTree is not a function` (or an import/type error naming `walkRoomTree`).

- [ ] **Step 3: Write the implementation**

Append to `src/main/services/room-tree.ts`:

```typescript
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
}

export interface WalkResult {
  categories: DiscoveredCategory[];
  rooms: DiscoveredRoom[];
  truncatedAt: WalkNote[];     // folders left unvisited because the depth cap was reached
  readFailures: WalkNote[];    // nodes whose children could not be listed
  calls: number;               // listChildren invocations
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
    calls: 0,
  };
  const visited = new Set<string>([rootId]);

  const note = (node: TreeNode, depth: number): WalkNote => ({
    id: node.key,
    title: node.title || '',
    depth,
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

      if (classification.kind === 'room') {
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
        result.truncatedAt.push(note(node, depth));
        continue;
      }

      await descend(
        node.key,
        note(node, depth),
        depth + 1,
        classification.kind === 'category' ? classification.roomType : inheritedType,
      );
    }
  }

  await descend(rootId, null, 1, null);
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/services/room-tree.test.ts`

Expected: PASS — 30 tests (18 from Task 1 + 12 new), output pristine.

- [ ] **Step 5: Run the full suite and the main typecheck**

Run: `npm test`
Expected: **102 passed** (72 baseline + 30 in `room-tree.test.ts`), 6 files.

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/room-tree.ts src/main/services/room-tree.test.ts
git commit -m "feat(s8): depth-capped room-tree walk with truncation and read-failure tracking"
```

---

### Task 3: Rewire syncRooms and delete the dead recursive walker

**Files:**
- Modify: `src/main/services/sync.service.ts` — replace `syncRooms` (lines 111-202); delete `identifyRoomType` (92-99), `ROOM_TAG_PATTERNS` (14-19), `type RoomType` (30), `extractClassId` (204-218), and the dead `syncRoomsRecursive` (242-280)

**Interfaces:**
- Consumes, from Task 2: `walkRoomTree`, `DEFAULT_MAX_DEPTH`, `WalkNote`, and the `WalkResult` shape.
- Produces: nothing new. No schema, IPC, or renderer change.

**Context:** This is the only task that touches IO, and it has no unit test — `syncRooms` needs the native SQLite module and a live API. Its verification is the typecheck, the unchanged suite, a successful build, and the read-only invariant checks in Step 5. The manual acceptance run belongs to the user.

`syncRoomsRecursive` at line 242 is **dead code** — an abandoned earlier attempt at this same feature, referenced only by its own recursive call at line 277. It recurses without a depth cap into every `type === "hazu"` node and writes room rows with no `class_id`. Leaving it in place next to the real walk would be actively misleading. Deleting it also removes the last caller of `identifyRoomType` inside this file, so the local copies of the tag helpers can go with it.

Exact line numbers above are from the pre-change file. Verify each block by its content before deleting, not by line number alone.

- [ ] **Step 1: Add the import**

In `src/main/services/sync.service.ts`, immediately after the existing import of `computeGroupAssignments` (line 11), add:

```typescript
import { walkRoomTree, DEFAULT_MAX_DEPTH, WalkNote } from "./room-tree";
```

- [ ] **Step 2: Replace the body of `syncRooms`**

Replace the whole of `syncRooms` (from `async function syncRooms(): Promise<void> {` through its closing brace, lines 111-202) with:

```typescript
async function syncRooms(): Promise<void> {
  const db = getDb();
  const rootId = getRootHazuId();

  console.log('[SYNC] Walking the room tree from root...');
  syncProgress.message = "Fetching rooms from Hazu...";

  // Rooms live at varying depths: directly under a category, and (for CIE) inside year
  // sub-folders below it. walkRoomTree finds both; it throws if the root listing fails,
  // which matters because clearOldData() has already emptied the rooms table.
  const tree = await walkRoomTree(rootId, { listChildren: sendApiRequestList });

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO rooms (id, title, description, color, icon, room_type, parent_id, class_id, tags, raw_data, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Category folders: stored so room creation can find a targetId. They keep rootId as their
  // parent — CreateRoomModal identifies a category by exactly that predicate.
  for (const category of tree.categories) {
    const { node, roomType } = category;
    stmt.run(
      node.key,
      stripHtml(node.title || ""),
      stripHtml(node.description || ""),
      node.color || "",
      node.icon || "",
      roomType,
      rootId,
      null,
      JSON.stringify(node.tags || []),
      JSON.stringify(node),
      Date.now()
    );
    syncProgress.roomsProcessed++;
    console.log(`[SYNC] Room category: ${stripHtml(node.title || "")} (${roomType})`);
  }

  let skipped = 0;
  for (const room of tree.rooms) {
    if (!room.roomType) {
      // No room tag of its own and no typed ancestor. Don't guess a type.
      console.warn(`[SYNC] Skipping room ${room.node.key} — no room type could be resolved`);
      skipped++;
      continue;
    }
    stmt.run(
      room.node.key,
      stripHtml(room.node.title || ""),
      stripHtml(room.node.description || ""),
      room.node.color || "",
      room.node.icon || "",
      room.roomType,
      room.parentId,
      room.classId,
      JSON.stringify(room.node.tags || []),
      JSON.stringify(room.node),
      Date.now()
    );
    syncProgress.roomsProcessed++;
  }

  // Name what was missed. A bounded sweep must never read as complete coverage — but the
  // lists can run to dozens of entries, so cap the names and always report the full count.
  const names = (notes: WalkNote[]): string => {
    const shown = notes.slice(0, 10).map((n) => `${stripHtml(n.title || "") || n.id} (d${n.depth})`);
    return notes.length > 10 ? `${shown.join(', ')} … and ${notes.length - 10} more` : shown.join(', ');
  };

  console.log(
    `[SYNC] Room tree: ${tree.categories.length} categories, ${tree.rooms.length} rooms, ` +
    `${tree.calls} listChildren calls`
  );
  if (skipped > 0) {
    console.warn(`[SYNC] ${skipped} room(s) skipped: no resolvable room type`);
  }
  if (tree.readFailures.length > 0) {
    console.warn(
      `[SYNC] ${tree.readFailures.length} subtree(s) could not be read — treated as unknown, ` +
      `NOT as empty: ${names(tree.readFailures)}`
    );
  }
  if (tree.truncatedAt.length > 0) {
    console.warn(
      `[SYNC] Depth cap ${DEFAULT_MAX_DEPTH} reached — ${tree.truncatedAt.length} folder(s) ` +
      `left unvisited: ${names(tree.truncatedAt)}`
    );
  }
  console.log(`[SYNC] Synced ${syncProgress.roomsProcessed} rooms total`);
}
```

- [ ] **Step 3: Delete the superseded helpers and the dead recursive walker**

Delete these five blocks from `src/main/services/sync.service.ts`. Match on content, not line number.

1. `const ROOM_TAG_PATTERNS = { state: ..., class: ..., enterprise: ..., cie: ... } as const;` — now `ROOM_TYPE_TAGS` in `room-tree.ts`.
2. `type RoomType = keyof typeof ROOM_TAG_PATTERNS;` — now imported into `room-tree.ts` from `src/shared/types.ts`.
3. The whole `function identifyRoomType(tags: string[]): RoomType | null { ... }` — now in `room-tree.ts`.
4. The whole `function extractClassId(tags: string[]): string | null { ... }`, together with its three-line leading comment — now in `room-tree.ts`.
5. The whole `async function syncRoomsRecursive(parentId: string): Promise<void> { ... }` — dead code, called only by itself.

Leave `PERSON_TAG_PATTERNS`, `type PersonType`, `identifyPersonType`, and `stripHtml` exactly as they are; they all still have callers.

- [ ] **Step 4: Typecheck — this is what proves the deletions were complete**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: no output. Any `Cannot find name 'RoomType'` / `'identifyRoomType'` / `'extractClassId'` means a caller was missed — find it and decide whether it should import from `./room-tree` or whether the deletion was wrong.

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep -c "error TS"`
Expected: **9** — the pre-existing renderer baseline. Not 0, and not more than 9.

- [ ] **Step 5: Verify the invariants that have no unit test**

```bash
grep -n "syncRoomsRecursive\|identifyRoomType\|ROOM_TAG_PATTERNS" src/main/services/sync.service.ts
```
Expected: **no output**.

```bash
grep -n "INSERT OR REPLACE INTO rooms" src/main/services/sync.service.ts
```
Expected: **exactly one** hit — the single prepared statement in `syncRooms`. Two or more means the dead walker's writer survived.

```bash
grep -n "rootId," src/main/services/sync.service.ts | head
```
Expected: the category `stmt.run(...)` passes `rootId` as `parent_id`. Confirm by reading the surrounding lines that only the category loop does this, and that the room loop passes `room.parentId`.

- [ ] **Step 6: Run the full suite and build**

Run: `npm test`
Expected: 101 passed, 6 files — every one of the 72 pre-existing tests still passing, none skipped.

Run: `npm run build`
Expected: completes with no errors.

Run: `python3 scripts/check-no-person-data.py --all`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/sync.service.ts
git commit -m "fix(s8): walk the room tree to depth 4 instead of stopping at level 2

syncRooms walked exactly root -> hz-config-room-* category -> rooms, so the
31 CIE rooms nested in year sub-folders (CIE 2024, CIE 2025) were invisible
to the app, and the 50 role groups pointing at them stayed unlinked with a
null room_id — which syncGroupMemberships filters out, so their members
produced neither assignments nor issues.

Delegates to the new pure walkRoomTree, which descends only into nodes
without a class tag, caps at depth 4, and records both the folders left
unvisited at the cap and the subtrees whose children could not be listed —
so a bounded sweep never reads as complete coverage.

Also deletes syncRoomsRecursive, dead since it was written and called only
by its own recursive call. It had no depth cap and wrote room rows with no
class_id."
```

---

## Manual acceptance (user-run, after Task 3)

The spec's acceptance list, corrected on one point: at `maxDepth = 4` the six *CIE 25-26* topic folders sit at depth 3 and **are** descended into, so it is their untagged course nodes at depth 4 that appear under truncation, not the topic folders themselves.

1. Sync. Expect **158 rooms** (127 + 31).
2. The log reports the *Calendrier scolaire* calendar entries under read failures (they return 401), and the depth-4 CIE course nodes under truncation.
3. Matrix shows the 10 *CIE 2024* rooms **with** assignments, and the 21 *CIE 2025* rooms as empty columns.
4. `distribution_groups` with `room_id` NULL drops **195 → 145**.
5. Discrepancies: bucket-A orphan tags drop **373 → 277**.
6. Spot-check `0dQJCWrIOAl56pT9aG5X`: a `cie` room titled *2024 CUI-C Cours 1 - Groupe 1*, `parent_id` = `SiqG2Kp4dteCMCxhV30e`, with its 5 role groups linked.
7. Confirm the 123 pre-existing rooms are unchanged in `class_id`, `room_type`, and `parent_id`.

Read-only queries for steps 1, 4 and 7:

```bash
sqlite3 -readonly ~/Library/Application\ Support/hazu-admin/hazu-admin.db "SELECT COUNT(*) FROM rooms; SELECT COUNT(*) FROM distribution_groups WHERE room_id IS NULL; SELECT room_type, COUNT(*) FROM rooms GROUP BY room_type;"
```
