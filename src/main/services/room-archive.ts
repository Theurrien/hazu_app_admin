// Room archive — PURE CORE. All IO is injected through ArchiveDeps; this file imports no DB, axios
// or Electron. Spec: docs/specs/2026-11-24-room-archive-design.md (§5, §6, §11).
//
// The live state decides, not the status codes: every step reads first and skips what is done, and
// every write is verified by a read-back. A stopped run is finished by running it again.

import { isRetryableError, backoffMs } from './role-write';
import type { ArchiveOutcome, ArchiveRoomType, StepResult } from '../../shared/archive-types';

export interface HazuNode {
  id: string;
  parentId: string | null;
  title: string;
  tags: string[];
}

/** Thrown by the injected deps on a failed call. */
export interface ApiFailure {
  status?: number;
  networkOrTimeout: boolean;
  message: string;
}

export interface ArchiveDeps {
  /** null only on 404. */
  read(id: string): Promise<HazuNode | null>;
  list(parentId: string): Promise<HazuNode[]>;
  /** Returns the new id. */
  create(parentId: string, title: string, tags: string[], privacy: 'private' | 'unlisted'): Promise<string>;
  move(id: string, targetId: string): Promise<void>;
  addTags(id: string, tags: string[]): Promise<void>;
  removeTags(id: string, tags: string[]): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export const ARCHIVE_ROOT_TAG = 'hz-config-archive';
export const ROOM_FOLDER_TAG = 'hz-config-archive-room';
export const GROUPS_FOLDER_TAG = 'hz-config-archive-groups';
export const ARCHIVE_ROOT_PRIVACY = 'private';
export const ROOM_FOLDER_PRIVACY = 'unlisted';
export const GROUPS_FOLDER_PRIVACY = 'private';

export const ARCHIVE_ROOT_TITLE = 'Archive';
export const GROUPS_FOLDER_TITLE = 'Groupes de partage';

const CLASS_PREFIX = 'hz-config-archive-class-';
const FROM_PREFIX = 'hz-config-archive-from-';
const TYPE_PREFIX = 'hz-config-archive-type-';
const AT_PREFIX = 'hz-config-archive-at-';
const ROOM_TYPES: ArchiveRoomType[] = ['class', 'cie', 'enterprise', 'state'];

const MAX_ATTEMPTS = 3;
const VERIFY_READS = 3;
const VERIFY_DELAY_MS = 750;

export interface ArchiveRecord {
  classId: string;
  fromParentId: string;
  roomType: ArchiveRoomType;
  archivedAt: number;
}

/** The five tags of a per-room folder: the room marker plus the four record tags. */
export function buildRecordTags(r: ArchiveRecord): string[] {
  return [
    ROOM_FOLDER_TAG,
    `${CLASS_PREFIX}${r.classId}`,
    `${FROM_PREFIX}${r.fromParentId}`,
    `${TYPE_PREFIX}${r.roomType}`,
    `${AT_PREFIX}${r.archivedAt}`,
  ];
}

/** null if any part is missing or malformed. */
export function parseRecordTags(tags: string[]): ArchiveRecord | null {
  const find = (prefix: string): string | null => {
    const t = tags.find(x => x.startsWith(prefix) && x.length > prefix.length);
    return t ? t.slice(prefix.length) : null;
  };
  const classId = find(CLASS_PREFIX);
  const fromParentId = find(FROM_PREFIX);
  const type = find(TYPE_PREFIX);
  const at = find(AT_PREFIX);
  if (!classId || !fromParentId || !type || !at) return null;
  if (!ROOM_TYPES.includes(type as ArchiveRoomType)) return null;
  if (!/^\d+$/.test(at)) return null;
  return { classId, fromParentId, roomType: type as ArchiveRoomType, archivedAt: Number(at) };
}

/** hz-config-class-{classId}-{role}, whole tags. */
export function classTagsFor(classId: string, roles: string[]): string[] {
  return roles.map(role => `hz-config-class-${classId}-${role}`);
}

/** Exact-match removal set: class id `abc` never matches `abcd`; the room's own class tag is untouched. */
export function holderTagsToRemove(personTags: string[], classId: string, roles: string[]): string[] {
  const wanted = new Set(classTagsFor(classId, roles));
  return personTags.filter(t => wanted.has(t));
}

/** Role groups of a class: tag hz-share-{role}-{classId}, exact class id. Duplicates are all returned. */
export function groupsOfClass(
  children: HazuNode[],
  classId: string,
  roles: string[],
): Array<{ id: string; role: string }> {
  const out: Array<{ id: string; role: string }> = [];
  for (const child of children) {
    for (const role of roles) {
      if (child.tags.includes(`hz-share-${role}-${classId}`)) {
        out.push({ id: child.id, role });
        break;
      }
    }
  }
  return out;
}

export interface ArchiveInput {
  room: { id: string; classId: string; title: string; roomType: ArchiveRoomType };
  expectedParentId: string;
  categoryIds: string[];
  adminId: string;
  sharingContainerId: string;
  roles: string[];
  holders: Array<{ personId: string; tags: string[] }>;
  now: number;
}

// ---------------------------------------------------------------------------------------------

function failureMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** Run a deps call, retrying transient failures (5xx / network / timeout), 3 attempts. 4xx fails fast. */
async function withRetry<T>(deps: ArchiveDeps, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const f = e as Partial<ApiFailure>;
      const retryable = isRetryableError(f?.status, f?.networkOrTimeout === true);
      if (!retryable || attempt + 1 >= MAX_ATTEMPTS) throw e;
      await deps.sleep(backoffMs(attempt));
    }
  }
}

/** Read until `ok(node)` holds (up to 3 reads, 750 ms apart); returns whether it did. */
async function readUntil(
  deps: ArchiveDeps,
  id: string,
  ok: (n: HazuNode | null) => boolean,
): Promise<boolean> {
  for (let i = 0; i < VERIFY_READS; i++) {
    if (i > 0) await deps.sleep(VERIFY_DELAY_MS);
    const n = await withRetry(deps, () => deps.read(id));
    if (ok(n)) return true;
  }
  return false;
}

/** Move `id` into `targetId` unless already there; the read-back decides. */
async function moveVerified(
  deps: ArchiveDeps,
  node: HazuNode,
  targetId: string,
): Promise<'moved' | 'skipped'> {
  if (node.parentId === targetId) return 'skipped';
  await withRetry(deps, () => deps.move(node.id, targetId));
  const landed = await readUntil(deps, node.id, n => n?.parentId === targetId);
  if (!landed) throw { networkOrTimeout: false, message: `déplacement non confirmé pour ${node.id}` } as ApiFailure;
  return 'moved';
}


/** Strip tags, decode common entities, collapse whitespace. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Create a child once. A failure status says nothing about whether the write committed, so after a
 * retryable failure the parent is re-listed and a child carrying the identifying tag is adopted
 * before anything is resent.
 */
async function createOnce(
  deps: ArchiveDeps,
  parentId: string,
  title: string,
  tags: string[],
  privacy: 'private' | 'unlisted',
  identifyingTag: string,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.create(parentId, title, tags, privacy);
    } catch (e) {
      const f = e as Partial<ApiFailure>;
      if (!isRetryableError(f?.status, f?.networkOrTimeout === true) || attempt + 1 >= MAX_ATTEMPTS) throw e;
      await deps.sleep(backoffMs(attempt));
      const children = await withRetry(deps, () => deps.list(parentId));
      const landed = children.find(c => c.tags.includes(identifyingTag));
      if (landed) return landed.id;
    }
  }
}

export async function runArchive(input: ArchiveInput, deps: ArchiveDeps): Promise<ArchiveOutcome> {
  const { room, roles } = input;
  const steps: StepResult[] = [];
  const removedTags: Array<{ personId: string; tags: string[] }> = [];
  let folderId: string | undefined;

  const fail = (step: string, detail: string, remaining: string[]): ArchiveOutcome => {
    steps.push({ step, status: 'failed', detail });
    return { success: false, steps, remaining, error: detail, folderId, removedTags };
  };

  // 1. The room: exists, and where is it?
  let roomNode: HazuNode | null;
  let roomAlreadyArchived = false;
  try {
    roomNode = await withRetry(deps, () => deps.read(room.id));
    if (!roomNode) return fail('room-read', 'salle introuvable', [room.id]);
    const parent = roomNode.parentId ? await withRetry(deps, () => deps.read(roomNode!.parentId!)) : null;
    let inArchiveFolder = false;
    if (
      parent &&
      parent.tags.includes(ROOM_FOLDER_TAG) &&
      parent.tags.includes(`${CLASS_PREFIX}${room.classId}`)
    ) {
      // Tags alone prove nothing: the folder must itself sit in the Archive Hazu.
      const adminChildren = await withRetry(deps, () => deps.list(input.adminId));
      const archive = adminChildren.find(c => c.tags.includes(ARCHIVE_ROOT_TAG));
      inArchiveFolder = !!archive && parent.parentId === archive.id;
    }
    if (inArchiveFolder && parent) {
      roomAlreadyArchived = true;
      folderId = parent.id;
    } else if (
      !roomNode.parentId ||
      !input.categoryIds.includes(roomNode.parentId) ||
      roomNode.parentId !== input.expectedParentId
    ) {
      return fail('room-read', 'la salle a été déplacée depuis la dernière synchronisation', [room.id]);
    }
    steps.push({ step: 'room-read', status: 'done' });
  } catch (e) {
    return fail('room-read', failureMessage(e), [room.id]);
  }

  // 2. Archive Hazu, per-room folder, groups folder.
  let archiveId: string;
  try {
    const adminChildren = await withRetry(deps, () => deps.list(input.adminId));
    const existing = adminChildren.find(c => c.tags.includes(ARCHIVE_ROOT_TAG));
    if (existing) {
      archiveId = existing.id;
      steps.push({ step: 'archive-root', status: 'skipped' });
    } else {
      archiveId = await createOnce(
        deps, input.adminId, ARCHIVE_ROOT_TITLE, [ARCHIVE_ROOT_TAG], ARCHIVE_ROOT_PRIVACY, ARCHIVE_ROOT_TAG,
      );
      steps.push({ step: 'archive-root', status: 'done' });
    }
  } catch (e) {
    return fail('archive-root', failureMessage(e), []);
  }

  let groupsFolderId: string;
  try {
    const classTag = `${CLASS_PREFIX}${room.classId}`;
    if (roomAlreadyArchived && folderId) {
      // The room sits in this folder: it is THE folder for the remaining steps.
      steps.push({ step: 'room-folder', status: 'skipped' });
    } else {
      const archived = await withRetry(deps, () => deps.list(archiveId));
      const folder = archived.find(c => c.tags.includes(classTag));
      if (folder) {
        folderId = folder.id;
        steps.push({ step: 'room-folder', status: 'skipped' });
      } else {
        folderId = await createOnce(
          deps,
          archiveId,
          stripHtml(room.title) || room.classId,
          buildRecordTags({
            classId: room.classId,
            fromParentId: input.expectedParentId,
            roomType: room.roomType,
            archivedAt: input.now,
          }),
          ROOM_FOLDER_PRIVACY,
          classTag,
        );
        steps.push({ step: 'room-folder', status: 'done' });
      }
    }
  } catch (e) {
    return fail('room-folder', failureMessage(e), []);
  }
  const roomFolderId = folderId!;

  try {
    const inside = await withRetry(deps, () => deps.list(roomFolderId));
    const gf = inside.find(c => c.tags.includes(GROUPS_FOLDER_TAG));
    if (gf) {
      groupsFolderId = gf.id;
      steps.push({ step: 'groups-folder', status: 'skipped' });
    } else {
      groupsFolderId = await createOnce(
        deps, roomFolderId, GROUPS_FOLDER_TITLE, [GROUPS_FOLDER_TAG], GROUPS_FOLDER_PRIVACY, GROUPS_FOLDER_TAG,
      );
      steps.push({ step: 'groups-folder', status: 'done' });
    }
  } catch (e) {
    return fail('groups-folder', failureMessage(e), []);
  }

  // 3. Role groups into the groups folder (live listing of the container + what is already inside).
  try {
    const container = await withRetry(deps, () => deps.list(input.sharingContainerId));
    const toMove = groupsOfClass(container, room.classId, roles);
    const alreadyInside = await withRetry(deps, () => deps.list(groupsFolderId));
    const allIds = new Set<string>([...toMove.map(g => g.id), ...alreadyInside.map(g => g.id)]);
    const nodes = new Map<string, HazuNode>();
    for (const c of container) nodes.set(c.id, c);
    for (const c of alreadyInside) nodes.set(c.id, c);

    let moved = 0;
    const left: string[] = [];
    let lastError = '';
    for (const id of allIds) {
      try {
        const r = await moveVerified(deps, nodes.get(id)!, groupsFolderId);
        if (r === 'moved') moved++;
      } catch (e) {
        left.push(id);
        lastError = failureMessage(e);
      }
    }
    if (left.length) return fail('groups', lastError, left);
    steps.push({ step: 'groups', status: moved > 0 ? 'done' : 'skipped', detail: `${moved}/${allIds.size}` });
  } catch (e) {
    return fail('groups', failureMessage(e), []);
  }

  // 4. The room into its folder.
  try {
    if (roomAlreadyArchived) {
      steps.push({ step: 'room', status: 'skipped' });
    } else {
      const r = await moveVerified(deps, roomNode, roomFolderId);
      steps.push({ step: 'room', status: r === 'moved' ? 'done' : 'skipped' });
    }
  } catch (e) {
    return fail('room', failureMessage(e), [room.id]);
  }

  // 5. Tags off every holder; the profile read decides.
  const stillTagged: string[] = [];
  let tagError = '';
  let removedAny = false;
  for (const holder of input.holders) {
    try {
      const live = await withRetry(deps, () => deps.read(holder.personId));
      if (!live) continue; // profile gone: nothing to remove
      const toRemove = holderTagsToRemove(live.tags, room.classId, roles);
      if (toRemove.length === 0) continue;
      let callError = '';
      try {
        await withRetry(deps, () => deps.removeTags(holder.personId, toRemove));
      } catch (e) {
        callError = failureMessage(e); // a failed call may still have landed: the read decides
      }
      const gone = await readUntil(deps, holder.personId, n => !n || holderTagsToRemove(n.tags, room.classId, roles).length === 0);
      if (gone) {
        removedAny = true;
        removedTags.push({ personId: holder.personId, tags: toRemove });
      } else {
        stillTagged.push(holder.personId);
        tagError = callError || 'étiquette toujours présente après relecture';
      }
    } catch (e) {
      stillTagged.push(holder.personId);
      tagError = failureMessage(e);
    }
  }
  if (stillTagged.length) return fail('tags', tagError, stillTagged);
  steps.push({ step: 'tags', status: removedAny ? 'done' : 'skipped' });

  return { success: true, steps, remaining: [], folderId, removedTags };
}
