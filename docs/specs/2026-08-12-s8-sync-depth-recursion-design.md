# S8 — Sync Depth Recursion: Design Spec

**Date:** 2026-08-12
**Status:** Approved (brainstorming) — ready for implementation plan
**Series:** Matrix group-truth rebuild — **S8**, built *before* S7 (see Sequencing)

**Goal:** Make `syncRooms` find every room in the Hazu tree, not just the two levels it currently walks — so the 31 rooms that are invisible to the app today become real rooms with real assignments.

**Architecture:** Replace the hard-coded two-level loop with a depth-capped recursive walk, factored as a pure orchestrator over an injected child-lister. Everything downstream — group linking, membership resolution, the Matrix, the discrepancy report — already cascades correctly once the rooms exist.

**Tech stack:** Electron main (Node/CommonJS, `tsconfig.main.json`) + better-sqlite3 + axios, vitest.

**Depends on:** nothing new. S1 supplies the group-membership cascade this feeds.

## Sequencing

This spec is built **before** [S7](2026-08-12-s7-missing-room-classification-design.md), reversing the order in which the two were designed. S7 classifies breadcrumb tags whose class id matches no local room; S8 shrinks that population at the source. Running S7 first would measure a number S8 then moves. Concretely, S8 is expected to take S7's probe set from 46 class ids to 36 and its bucket A from 373 tags to 277.

---

## The problem

[`syncRooms`](../../src/main/services/sync.service.ts:111) walks exactly two levels: the direct children of `root_hazu_id` tagged `hz-config-room-*` are stored as category folders, and *their* children carrying an `hz-config-class-*` tag are stored as rooms. Anything nested deeper is invisible.

Hazu has since grown a third level of year sub-folders.

### Measured tree (live, 2026-08-12)

Root has 12 children: 4 tagged room categories and 8 untagged containers (person containers, administration, general information).

| category | rooms | sub-folders |
|---|---|---|
| `7OlGlDMXcozxplpdLZbH` Cantons (state) | 12 | — |
| `oqeZjn1TWa5INqs3sg2I` École professionnelle (class) | 30 | 1 — *Calendrier scolaire* |
| `kJ7Oq00ylnK73bcV1vHm` Entreprise formatrice | 76 | — |
| `PizjouVefdez5HrWlvsp` Cours interentreprises (cie) | 5 | **3** |

The three CIE sub-folders are the entire problem:

| folder | contents |
|---|---|
| `SiqG2Kp4dteCMCxhV30e` *CIE 2024* | **10 rooms — none local** |
| `q48YckWa0hTzkZVbCerz` *CIE 2025* | **21 rooms — none local** |
| `Nub7q25erawnKAO87kmm` *CIE 25-26* | 6 topic folders (BPC, Intendance, Coiffure, Cuisine, Restauration, À traiter) whose course nodes carry **no tags at all** — created but not yet configured as rooms |

*Calendrier scolaire* (`TSR6vZpXW9ALeroL4yNF`) holds 62 calendar entries, no rooms; listing their children returns **401**.

**31 rooms are invisible to the app.**

### Recursion is cheap, because rooms are never descended into

Descending only into nodes *without* an `hz-config-class-*` tag prunes all 118 rooms before a call is spent on them. To see nodes at depth *N* you call `readChildren` on each non-room node at depth *N−1*:

| depth reached | extra `readChildren` | rooms recovered |
|---|---|---|
| 2 (today) | — | — |
| 3 | **4** (*Calendrier scolaire* + the 3 CIE folders) | **31** |
| 4 | ~68 more | 0 today — but where the 2025-26 CIE rooms will land once tagged |

Depth is counted from root: root's children are depth 1 (the categories), rooms directly beneath them are depth 2.

### The cascade downstream is already correct

`distribution_groups` is synced **flat** from the `hz-config-sharing` container, independent of the room tree — 790 groups, of which **195 carry `room_id` NULL** solely because their room is not local. [`syncGroupMemberships`](../../src/main/services/sync.service.ts:755) then selects `WHERE room_id IS NOT NULL`, so those groups' members yield neither assignments nor `membership_issues`. They are invisible, not merely unresolved.

`runSync` already orders rooms (step 2) → distribution groups (step 4) → memberships (step 5), and `syncDistributionGroups` links a group to its room via `SELECT id FROM rooms WHERE class_id = ?`. **Importing the rooms is sufficient; no re-ordering is required.**

### Why a group-driven backfill cannot replace the walk

The tempting shortcut — read every unlinked group's class id and import whatever returns 200 — was measured and rejected. All 39 distinct class ids that have groups but no local room were read: **10 alive, 29 deleted (404), 0 unreadable.** The 10 alive are exactly the *CIE 2024* rooms.

The 21 *CIE 2025* rooms therefore have **no role groups at all**, and a group-driven backfill would silently miss every one of them. Those are precisely the rooms an administrator would want to assign people *into*.

Two corollaries. **Deleted rooms leave their groups behind** — 29 dead rooms still account for roughly 145 local groups, so the presence of a group is no evidence that a room exists. And **every room self-tags its type**: 123/123 local rooms carry an `hz-config-room-*` tag agreeing with the category-derived `room_type`, as do all 10 alive hidden rooms.

## Expected impact

| measure | before | after |
|---|---|---|
| rooms | 127 | **158** |
| `distribution_groups` with `room_id` NULL | 195 | **145** |
| bucket-A orphan tags | 373 | **277** (96 tags across 42 people stop being orphans) |
| distinct unmatched class ids (S7's probe set) | 46 | **36** |

Only 10 of the 31 imported rooms are referenced by any tag or group. The other 21 arrive as empty Matrix columns available for assignment, which is the intent.

The 96 tags leaving bucket A land either in *legit* or in bucket B, depending on what each room's group ACL actually says. This spec does not predict the split; the report will show it.

## Global constraints

- **Depth is capped, and truncation is never silent.** Default `maxDepth = 4`. Any folder left unvisited at the cap is recorded and logged by name. A bounded sweep must never read as complete coverage.
- **Never descend into a room.** A node carrying `hz-config-class-*` is a room; its children are content, not rooms.
- **An unreadable subtree is not an empty subtree.** A `listChildren` failure is recorded and logged, never treated as "no children here."
- **Only nodes with `hz-config-class-*` become rooms.** Untagged nodes are folders to walk through, never rows to write.
- **Intermediate folders are not stored.** Only the depth-1 category folders (as today) and actual rooms.
- **Category folders keep `parent_id = root_hazu_id`.** `CreateRoomModal` identifies a category by exactly that predicate.
- **Pure-core + injected IO.** The walk is a pure orchestrator over an injected child-lister and is vitest-runnable without the native module or the network.
- **No behaviour change for the 123 rooms already synced.** Their type, parent, and class id must be byte-identical after the change.

## Scope

**In scope:** the traversal in `syncRooms`, and the pure walk it delegates to.

**Out of scope:**

- A group-driven backfill for rooms outside root's subtree. Every alive missing room today is inside it. If S7 later surfaces one that is not, that is when to build the net — with a real example.
- Reconciling `extractClassId` (truncates at the first non-alphanumeric) with `parseClassTag` (splits at the last hyphen). They disagree in principle and agree on every live class id, all of which are alphanumeric. A known follow-up, not this change.
- Filtering category folders out of `getRooms()`. They already leak into the Matrix and RoomsPage; this spec declines to make that worse but does not fix it.
- Pruning the ~145 groups belonging to deleted rooms.
- Anything in S7.

## The walk

### Pure core — `src/main/services/room-tree.ts` (new)

```ts
export type RoomType = 'state' | 'class' | 'enterprise' | 'cie';

export interface TreeNode {            // the subset of a Hazu snapshot the walk needs
  key: string;
  title?: string;
  description?: string;
  color?: string;
  icon?: string;
  parentId?: string;
  tags?: string[];
}

export interface DiscoveredRoom {
  id: string;
  classId: string;
  title: string;
  description: string;
  color: string;
  icon: string;
  roomType: RoomType;
  parentId: string;        // the TRUE parent — a category or a sub-folder
  tags: string[];
  raw: unknown;
  depth: number;
}

export interface DiscoveredCategory {
  id: string;
  title: string;
  description: string;
  color: string;
  icon: string;
  roomType: RoomType;
  tags: string[];
  raw: unknown;
}

export interface WalkResult {
  categories: DiscoveredCategory[];
  rooms: DiscoveredRoom[];
  truncatedAt: Array<{ id: string; title: string; depth: number }>;
  readFailures: Array<{ id: string; title: string; depth: number }>;
  calls: number;
}

// What is this node, and what type does it carry? Pure; the unit under test for
// type resolution. `inheritedType` is the type of the nearest category ancestor.
export function classifyNode(
  node: TreeNode,
  inheritedType: RoomType | null,
): { kind: 'category' | 'room' | 'folder'; classId?: string; roomType?: RoomType };

export async function walkRoomTree(
  rootId: string,
  deps: { listChildren: (id: string) => Promise<Array<{ snapshot: TreeNode }> | null> },
  config?: { maxDepth?: number },      // default 4
): Promise<WalkResult>;
```

### Algorithm

1. List root's children (depth 1). A child tagged `hz-config-room-*` and *not* tagged `hz-config-class-*` is a **category**: record it, and descend with its type as the inherited type. Untagged root children are ignored, exactly as today.
2. At each subsequent depth, for every child: `classifyNode`.
   - **room** (`hz-config-class-*` present) — record it and **do not descend**.
   - **folder** (no class tag) — descend if `depth < maxDepth`; otherwise record it in `truncatedAt`.
3. `listChildren` returning `null` records the node in `readFailures` and moves on.
4. A visited-id set guards against repeats and cycles; a node already visited is skipped.

Note that `classifyNode` can return `kind: 'category'` at any depth — a node tagged `hz-config-room-*` with no class tag. Only depth-1 categories are **stored**; a deeper one is walked through like a folder while contributing its type as the new `inheritedType` for its subtree. No such node exists in the tree today (the three CIE sub-folders carry no `hz-config-*` tags at all), so this rule is defined rather than exercised.

## Decisions and their evidence

Three choices that an implementer or reviewer could reasonably second-guess, each recorded with what settled it.

**Room type comes from the node's own tag, falling back to the inherited category type.** All 123 currently-synced rooms and all 10 alive hidden rooms carry an `hz-config-room-*` tag agreeing with the category-derived `room_type` — 123/123 — so this changes nothing today. It exists so a room beneath an untyped folder is still classifiable. A room with neither a self-tag nor an inherited type is skipped by the writer with a log line, rather than written with a guessed type.

**`parent_id` records the true parent, not the category.** The only consumer is [CreateRoomModal.tsx:86](../../src/renderer/components/CreateRoomModal.tsx:86), which finds a category by `room.room_type === type && room.parent_id === rootHazuId`. Category folders keep `rootHazuId`, so that lookup is untouched, and nothing else in the codebase joins on `parent_id`. This is also why the "no behaviour change for the 123 existing rooms" constraint holds: every one of them is a direct child of its category, so its true parent *is* the category and the stored value does not move.

**Intermediate folders are not stored.** [`getRooms`](../../src/main/ipc/index.ts:46) is a bare `SELECT * FROM rooms` with no `class_id` filter, so any row written to that table becomes a Matrix column and a RoomsPage entry. The four category folders already leak through that way. Storing *CIE 2024*, *CIE 2025*, and *Calendrier scolaire* as well would multiply an existing wart; a discovered room's `parent_id` may therefore name a folder that has no row, which nothing joins against.

### `syncRooms` after the change

```
const result = await walkRoomTree(rootId, { listChildren: sendApiRequestList });
// write categories (parent_id = rootId, class_id = null)  — unchanged from today
// write rooms      (parent_id = node's true parent, class_id from its tag)
// log: rooms found, truncatedAt by name, readFailures by name
```

`syncProgress.roomsProcessed` continues to count categories plus rooms, as today.

## Error handling & edge cases

- **Subtree returns 401** (*Calendrier scolaire*'s entries) — `listChildren` yields `null`, recorded in `readFailures`, logged, walk continues.
- **Depth cap reached with folders unvisited** (*CIE 25-26*'s six topic folders at `maxDepth = 4`) — recorded in `truncatedAt` and logged by name.
- **Node with both `hz-config-room-*` and `hz-config-class-*`** — a room, not a category. Rooms self-tag their type; only a node lacking a class tag can be a category.
- **Untagged node at depth 1** — ignored, as today. The 8 non-room root children are never walked.
- **Cycle or repeated id** — visited set; each node walked once.
- **Room whose type cannot be resolved** — skipped by the writer with a log line, rather than written with a bogus type.
- **A category folder that also has rooms nested below sub-folders** — the normal case this spec exists for; both the direct rooms and the nested ones are found.
- **`extractClassId` returns null for a tagged node** (malformed tag) — not a room; treated as a folder and descended into, matching today's `continue`.

## Testing

Pure-core vitest over fixture trees, no native module and no network — matching `role-write.test.ts` / `orphan-removal.test.ts`. Fixtures use invented ids and titles, per the person-data rule in CLAUDE.md.

**`classifyNode`** — a node with `hz-config-class-*` is a room, and its `roomType` comes from its own `hz-config-room-*` tag; with no self-tag it falls back to `inheritedType`; with neither, `roomType` is undefined; a node with `hz-config-room-*` and no class tag is a category; an untagged node is a folder; a malformed class tag yields a folder, not a room.

**`walkRoomTree`** — finds rooms at depths 2, 3 and 4; a folder at `maxDepth` lands in `truncatedAt` and is not descended into; a node with a class tag is never descended into even when the fixture gives it children; `listChildren` returning `null` lands in `readFailures` and does not abort the walk; a cycle is visited once; `calls` counts `listChildren` invocations — one for root plus one per node descended into, and none for a room; an empty tree yields empty arrays rather than throwing; the true `parentId` is recorded on a nested room, not the category's id.

## File-by-file change list

| File | Change |
|---|---|
| `src/main/services/room-tree.ts` | new — pure walk + `classifyNode` |
| `src/main/services/room-tree.test.ts` | new — unit tests over fixture trees |
| `src/main/services/sync.service.ts` | `syncRooms` delegates to `walkRoomTree`; writes categories and rooms; logs truncation and read failures |

No schema change, no IPC change, no renderer change.

## Manual acceptance

1. Sync. Expect **158 rooms** (127 + 31), the *Calendrier scolaire* calendar entries named under read failures (they return 401), and the depth-4 CIE course nodes named under truncation. Note that at `maxDepth = 4` the six *CIE 25-26* topic folders sit at depth 3 and **are** descended into — it is their untagged course-node children at depth 4 that get truncated, not the topic folders themselves.
2. Matrix shows the 10 *CIE 2024* rooms **with** assignments, and the 21 *CIE 2025* rooms as empty columns.
3. `distribution_groups` with `room_id` NULL drops **195 → 145**.
4. Discrepancies: bucket-A orphan tags drop **373 → 277**; the 96 that left appear as legitimate memberships or as bucket B, not as new `unknown` or `unresolved` rows beyond what the newly-read group ACLs genuinely contain.
5. Spot-check `0dQJCWrIOAl56pT9aG5X`: present as a `cie` room titled *2024 CUI-C Cours 1 - Groupe 1*, `parent_id` = `SiqG2Kp4dteCMCxhV30e`, with its 5 role groups linked.
6. Confirm the 123 pre-existing rooms are unchanged in `class_id`, `room_type`, and `parent_id`.
