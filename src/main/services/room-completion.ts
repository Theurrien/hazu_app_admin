/**
 * Complete a freshly created room locally, so it can be used without a full sync.
 *
 * Pure core: no DB, no HTTP, no Electron. The reads are injected, so it runs under vitest.
 * room-completion.service.ts supplies the real IO and writes the result to SQLite.
 *
 * A room created through the create-group webhook used to be stored with no `class_id` and
 * no `distribution_groups` rows until the next sync. Without those, the S4 role-write path
 * could not verify an assignment to the new room against group truth (it fell back to
 * trusting the status code), and nothing linked the room to its role groups.
 */

import { extractClassId, TreeNode } from './room-tree';

// Read a room×role share tag: "hz-share-<role>-<classId>". Only roles known from the synced
// user types count, so the super-user group and any unrelated share tag are ignored.
export function parseShareTag(tags: string[], validRoles: string[]): { role: string; classId: string } | null {
  const prefix = 'hz-share-';

  for (const tag of tags) {
    if (!tag.startsWith(prefix)) continue;

    const remainder = tag.substring(prefix.length); // "student-<classId>"
    const firstHyphen = remainder.indexOf('-');
    if (firstHyphen === -1) continue;

    const role = remainder.substring(0, firstHyphen);
    const classId = remainder.substring(firstHyphen + 1);

    if (!validRoles.includes(role)) continue;

    return { role, classId };
  }

  return null;
}

export interface NewRoomGroup {
  node: TreeNode;
  role: string;
  classId: string;
}

export interface RoomCompletionDeps {
  // Tags of the room as Hazu stores it now, or null if the read failed.
  readRoomTags: (roomId: string) => Promise<string[] | null>;
  // Children of the sharing container (all room×role groups), or null if the read failed.
  listShareGroups: () => Promise<Array<{ snapshot: TreeNode }> | null>;
  validRoles: string[];
  sleep: (ms: number) => Promise<void>;
}

export interface RoomCompletionConfig {
  attempts?: number; // reads of the sharing container before settling for what was found
  delayMs?: number;  // pause between those reads, to ride out Hazu's listing lag
}

export interface RoomCompletionResult {
  classId: string | null;
  groups: NewRoomGroup[];
  // Why the result is incomplete — null when the class id and one group per role were found.
  note: string | null;
}

/**
 * Find the new room's class id and its role groups.
 *
 * The class id comes from the webhook's snapshot tags when present, otherwise from one read of
 * the room. Groups are matched by the class id in their share tag. Every synced room has exactly
 * one group per role, so the sharing container is re-read (up to `attempts` times) until all
 * roles are present — the groups are created by the same webhook call but may not be listed yet.
 *
 * Never throws: an incomplete result is reported in `note`, and the next full sync fills the gap.
 */
export async function completeNewRoom(
  roomId: string,
  snapshotTags: string[],
  deps: RoomCompletionDeps,
  config: RoomCompletionConfig = {},
): Promise<RoomCompletionResult> {
  const attempts = Math.max(1, config.attempts ?? 3);
  const delayMs = config.delayMs ?? 1000;

  let classId = extractClassId(snapshotTags);
  if (!classId) {
    let tags: string[] | null = null;
    try {
      tags = await deps.readRoomTags(roomId);
    } catch {
      tags = null;
    }
    if (tags === null) {
      return { classId: null, groups: [], note: 'could not read the new room to find its class id' };
    }
    classId = extractClassId(tags);
  }
  if (!classId) {
    return { classId: null, groups: [], note: 'the new room carries no hz-config-class-* tag' };
  }

  let groups: NewRoomGroup[] = [];
  let lastReadFailed = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await deps.sleep(delayMs);

    let children: Array<{ snapshot: TreeNode }> | null;
    try {
      children = await deps.listShareGroups();
    } catch {
      children = null;
    }
    if (children === null) {
      lastReadFailed = true;
      continue;
    }
    lastReadFailed = false;

    groups = [];
    for (const child of children) {
      const node = child?.snapshot;
      if (!node?.key) continue;
      const parsed = parseShareTag(node.tags || [], deps.validRoles);
      if (parsed && parsed.classId === classId) {
        groups.push({ node, role: parsed.role, classId });
      }
    }

    const roles = new Set(groups.map((g) => g.role));
    if (deps.validRoles.every((r) => roles.has(r))) {
      return { classId, groups, note: null };
    }
  }

  if (groups.length === 0 && lastReadFailed) {
    return { classId, groups, note: 'could not read the sharing container' };
  }
  const missing = deps.validRoles.filter((r) => !groups.some((g) => g.role === r));
  return { classId, groups, note: `no role group found yet for: ${missing.join(', ')}` };
}
