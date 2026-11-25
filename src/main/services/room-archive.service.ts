// Room archive — IO LAYER. Wires the pure core (room-archive.ts) to the Hazu API and local SQLite.
// No step logic lives here: every Hazu call goes through the core's deps. Spec §6–§7, §10–§11.

import axios from 'axios';
import { getDb } from '../database';
import {
  sendApiRequestReadChecked,
  sendApiRequestListChecked,
  sendApiRequestCreateChecked,
  sendApiRequestMoveChecked,
  sendApiRequestAddTagsChecked,
  sendApiRequestRemoveTagsChecked,
  sendApiRequestRemoveChecked,
  sendApiRequestGetAclInfoChecked,
} from './hazu-api/api';
import { normalizeRow } from './formation/parse';
import { resolvePerson, isSystemAccount, AclMember } from './group-membership';
import {
  ApiFailure,
  ArchiveDeps,
  HazuNode,
  ARCHIVE_ROOT_TAG,
  ROOM_FOLDER_TAG,
  GROUPS_FOLDER_TAG,
  archivedEntry,
  classTagsFor,
  groupsOfClass,
  parseRecordTags,
  runArchive,
  runRestore,
} from './room-archive';
import type {
  ArchivableRoom,
  ArchivePlan,
  ArchiveOutcome,
  ArchiveRoomType,
  ArchivedRoom,
  RestoreOutcome,
  RestorePlan,
} from '../../shared/archive-types';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function setting(key: string): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return (row?.value ?? '').trim();
}

function roles(): string[] {
  return (getDb().prepare('SELECT name FROM user_types').all() as Array<{ name: string }>).map((r) => r.name);
}

export function safeTags(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

// Wrap an axios error into the shape the core's retry logic reads.
function toFailure(e: unknown): ApiFailure {
  if (e && typeof e === 'object' && !axios.isAxiosError(e) && 'message' in e && 'networkOrTimeout' in e) {
    return e as ApiFailure;
  }
  if (axios.isAxiosError(e)) {
    return {
      status: e.response?.status,
      networkOrTimeout: !e.response || e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT',
      message: (e.response?.data as { message?: string } | undefined)?.message || e.message,
    };
  }
  return { networkOrTimeout: false, message: e instanceof Error ? e.message : String(e) };
}

/** Anything leaving the service as a rejection is an Error with a readable message. */
export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(toFailure(e).message);
}

async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toFailure(e);
  }
}

function toNode(raw: unknown): HazuNode | null {
  const row = normalizeRow(raw);
  return row ? { id: row.id, parentId: row.parentId, title: row.title, tags: row.tags } : null;
}

export function buildDeps(): ArchiveDeps {
  const loginId = setting('user_id');
  const authorId = loginId;
  const displayName = setting('user_display_name');
  return {
    // null ONLY on a 404; anything else throws.
    read: async (id) => {
      try {
        return toNode(await sendApiRequestReadChecked(id));
      } catch (e) {
        if (axios.isAxiosError(e) && e.response?.status === 404) return null;
        throw toFailure(e);
      }
    },
    list: async (parentId) => {
      const raw = await wrap(() => sendApiRequestListChecked(parentId));
      const out: HazuNode[] = [];
      for (const r of raw) {
        const n = toNode(r);
        if (n && n.id !== parentId) out.push(n);
      }
      return out;
    },
    create: async (parentId, title, tags, privacy) => {
      const data = await wrap(() =>
        sendApiRequestCreateChecked({ parentId, type: 'hazu', title, authorId, displayName, privacy, tags }),
      );
      const id = normalizeRow(data)?.id;
      if (!id) throw { networkOrTimeout: false, message: 'création sans identifiant' } as ApiFailure;
      return id;
    },
    move: (id, targetId) => wrap(() => sendApiRequestMoveChecked(id, targetId, loginId)),
    addTags: (id, tags) => wrap(() => sendApiRequestAddTagsChecked(id, tags)),
    removeTags: async (id, tags) => {
      const r = await sendApiRequestRemoveTagsChecked(id, tags);
      if (!r.ok) throw { status: r.status, networkOrTimeout: r.networkOrTimeout, message: r.error ?? 'échec' } as ApiFailure;
    },
    remove: (id) => wrap(() => sendApiRequestRemoveChecked(id)),
    sleep,
  };
}

async function liveCategoryIds(deps: ArchiveDeps): Promise<string[]> {
  const root = setting('root_hazu_id');
  if (!root) return [];
  // Only real room categories (tagged hz-config-room-*); root also holds the admin Hazu and the
  // profile containers, which must never be accepted as an origin.
  return (await deps.list(root)).filter((n) => n.tags.some((t) => t.startsWith('hz-config-room-'))).map((n) => n.id);
}

// ---------------------------------------------------------------------------------------------
// Local reads

interface RoomRow {
  id: string;
  title: string;
  room_type: ArchiveRoomType;
  parent_id: string | null;
  class_id: string | null;
}

export function listArchivableRooms(): ArchivableRoom[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, title, room_type, parent_id, class_id FROM rooms ORDER BY title')
    .all() as RoomRow[];
  const counts = db
    .prepare('SELECT room_id, COUNT(DISTINCT person_id) AS n FROM person_room_assignments GROUP BY room_id')
    .all() as Array<{ room_id: string; n: number }>;
  const byRoom = new Map(counts.map((c) => [c.room_id, c.n]));
  const rootId = setting('root_hazu_id');
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    roomType: r.room_type,
    classId: r.class_id || null,
    parentId: r.parent_id ?? '',
    memberCount: byRoom.get(r.id) ?? 0,
    blockedReason:
      rootId && r.parent_id === rootId
        ? 'dossier de catégorie'
        : r.class_id ? null : 'identifiant de classe manquant',
  }));
}

function holdersOf(classId: string): Array<{ personId: string; tags: string[] }> {
  const wanted = new Set(classTagsFor(classId, roles()));
  const persons = getDb().prepare('SELECT id, tags FROM persons').all() as Array<{ id: string; tags: string }>;
  const out: Array<{ personId: string; tags: string[] }> = [];
  for (const p of persons) {
    const tags = safeTags(p.tags);
    if (tags.some((t) => wanted.has(t))) out.push({ personId: p.id, tags });
  }
  return out;
}

export function planArchive(roomId: string): ArchivePlan {
  const db = getDb();
  const room = db.prepare('SELECT id, title, room_type, parent_id, class_id FROM rooms WHERE id = ?').get(roomId) as
    | RoomRow
    | undefined;
  if (!room) throw new Error('salle introuvable');
  if (!room.class_id) throw new Error('identifiant de classe manquant');
  const memberCount = (db
    .prepare('SELECT COUNT(DISTINCT person_id) AS n FROM person_room_assignments WHERE room_id = ?')
    .get(roomId) as { n: number }).n;
  const groupCount = (db
    .prepare('SELECT COUNT(*) AS n FROM distribution_groups WHERE room_class_id = ?')
    .get(room.class_id) as { n: number }).n;
  return {
    roomId,
    title: room.title,
    roomType: room.room_type,
    classId: room.class_id,
    groupCount,
    holderCount: holdersOf(room.class_id).length,
    memberCount,
    warnsDashboards: (room.room_type === 'enterprise' || room.room_type === 'state') && memberCount > 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Live reads

export async function findArchiveRoot(deps: ArchiveDeps): Promise<HazuNode | null> {
  const adminId = setting('admin_id');
  if (!adminId) return null;
  return (await deps.list(adminId)).find((c) => c.tags.includes(ARCHIVE_ROOT_TAG)) ?? null;
}

export async function listArchivedRooms(): Promise<ArchivedRoom[]> {
  try {
    const deps = buildDeps();
    const root = await findArchiveRoot(deps);
    if (!root) return [];
    const folders = (await deps.list(root.id)).filter((c) => c.tags.includes(ROOM_FOLDER_TAG));
    const out: ArchivedRoom[] = [];
    for (const folder of folders) {
      const entry = archivedEntry(folder, await deps.list(folder.id));
      if (entry) out.push(entry);
    }
    return out.sort((a, b) => b.archivedAt - a.archivedAt);
  } catch (e) {
    throw toError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Archive

function reconcileArchive(room: RoomRow, outcome: ArchiveOutcome, roleNames: string[]): void {
  const roomBack = !!outcome.folderId && outcome.steps.some((s) => s.step === 'room' && s.status !== 'failed');
  if (!roomBack || !room.class_id) return;
  const db = getDb();
  const skip = new Set(outcome.remaining);
  const classTags = new Set(classTagsFor(room.class_id, roleNames));
  const persons = db.prepare('SELECT id, tags FROM persons').all() as Array<{ id: string; tags: string }>;
  const upd = db.prepare('UPDATE persons SET tags = ? WHERE id = ?');
  db.transaction(() => {
    for (const p of persons) {
      if (skip.has(p.id)) continue;
      const tags = safeTags(p.tags);
      const kept = tags.filter((t) => !classTags.has(t));
      if (kept.length !== tags.length) upd.run(JSON.stringify(kept), p.id);
    }
    // A partial outcome keeps the room row so a retry of archiveRoom(roomId) can still find it.
    if (outcome.success !== true) return;
    db.prepare('DELETE FROM person_room_assignments WHERE room_id = ?').run(room.id);
    db.prepare('DELETE FROM membership_issues WHERE room_id = ?').run(room.id);
    db.prepare('UPDATE distribution_groups SET room_id = NULL WHERE room_id = ?').run(room.id);
    db.prepare('DELETE FROM rooms WHERE id = ?').run(room.id);
  })();
}

export async function archiveRoom(roomId: string): Promise<ArchiveOutcome> {
  try {
    return await archiveRoomUnsafe(roomId);
  } catch (e) {
    return { success: false, steps: [], remaining: [roomId], error: toFailure(e).message, removedTags: [] };
  }
}

async function archiveRoomUnsafe(roomId: string): Promise<ArchiveOutcome> {
  const room = getDb().prepare('SELECT id, title, room_type, parent_id, class_id FROM rooms WHERE id = ?').get(roomId) as
    | RoomRow
    | undefined;
  const fail = (error: string): ArchiveOutcome => ({
    success: false, steps: [], remaining: [roomId], error, removedTags: [],
  });
  if (!room) return fail('salle introuvable');
  if (!room.class_id) return fail('identifiant de classe manquant');
  const rootId = setting('root_hazu_id');
  if (rootId && room.parent_id === rootId) return fail('dossier de catégorie');
  const adminId = setting('admin_id');
  const sharingContainerId = setting('sharing_container_id');
  const roleNames = roles();
  if (!adminId || !sharingContainerId || !setting('user_id') || roleNames.length === 0) {
    return fail('synchronisation requise');
  }

  const deps = buildDeps();
  let outcome: ArchiveOutcome;
  try {
    const categoryIds = await liveCategoryIds(deps);
    outcome = await runArchive(
      {
        room: { id: room.id, classId: room.class_id, title: room.title, roomType: room.room_type },
        expectedParentId: room.parent_id ?? '',
        categoryIds,
        adminId,
        sharingContainerId,
        roles: roleNames,
        holders: holdersOf(room.class_id),
        now: Date.now(),
      },
      deps,
    );
  } catch (e) {
    outcome = fail(toFailure(e).message);
  }

  try {
    reconcileArchive(room, outcome, roleNames);
  } catch (e) {
    console.error('[room-archive] local reconcile failed:', e instanceof Error ? e.message : e);
  }
  console.log(
    `[room-archive] archive room=${roomId} success=${outcome.success} ` +
    `steps=${outcome.steps.map((s) => `${s.step}:${s.status}`).join(',')} remaining=${outcome.remaining.length}`,
  );
  return outcome;
}

// ---------------------------------------------------------------------------------------------
// Restore

export async function planRestore(folderId: string): Promise<RestorePlan> {
  try {
    const deps = buildDeps();
    const folder = await deps.read(folderId);
    if (!folder || !folder.tags.includes(ROOM_FOLDER_TAG)) throw new Error("dossier d'archive introuvable");
    const rec = parseRecordTags(folder.tags);
    if (!rec) throw new Error("dossier d'archive incomplet");
    const origin = await deps.read(rec.fromParentId);
    const categoryIds = await liveCategoryIds(deps);
    const inside = await deps.list(folderId);
    const groupsFolder = inside.find((c) => c.tags.includes(GROUPS_FOLDER_TAG));
    const archivedGroups = groupsFolder ? await deps.list(groupsFolder.id) : [];
    return {
      folderId,
      title: folder.title,
      fromParentTitle: origin ? origin.title : null,
      fromParentExists: !!origin && categoryIds.includes(rec.fromParentId),
      groupCount: groupsOfClass(archivedGroups, rec.classId, roles()).length,
    };
  } catch (e) {
    throw toError(e);
  }
}

async function buildMembersOf(): Promise<(groupId: string) => Promise<{ personIds: string[]; unresolved: number }>> {
  const persons = getDb()
    .prepare("SELECT id, trim(email) AS identity FROM persons WHERE email IS NOT NULL AND trim(email) <> ''")
    .all() as Array<{ id: string; identity: string }>;
  const byEmail = new Map<string, string>();
  const byUid = new Map<string, string>();
  for (const p of persons) {
    byEmail.set(p.identity.toLowerCase(), p.id);
    byUid.set(p.identity, p.id);
  }
  // Super-user group members have access everywhere without a role: not members of the room.
  const exclude = new Set<string>();
  const superId = setting('superuser_group_id');
  if (superId) {
    const acl = await wrap(() => sendApiRequestGetAclInfoChecked(superId)); // a failed read must not silently re-tag them
    if (!Array.isArray(acl?.data)) throw new Error("liste d'accès du groupe super-utilisateur illisible");
    for (const m of acl.data) if (!m.isGroup && m.authorId) exclude.add(m.authorId);
  }
  return async (groupId) => {
    const acl = await wrap(() => sendApiRequestGetAclInfoChecked(groupId));
    const personIds = new Set<string>();
    let unresolved = 0;
    for (const m of (acl?.data || []) as AclMember[]) {
      if (m.isGroup) continue;
      if (m.authorId && exclude.has(m.authorId)) continue;
      if (isSystemAccount(m.description)) continue;
      const r = resolvePerson(m, byEmail, byUid);
      if ('personId' in r) personIds.add(r.personId);
      else unresolved++;
    }
    return { personIds: [...personIds], unresolved };
  };
}

function reconcileRestore(outcome: RestoreOutcome): void {
  if (!outcome.addedTags.length) return;
  const db = getDb();
  const sel = db.prepare('SELECT tags FROM persons WHERE id = ?');
  const upd = db.prepare('UPDATE persons SET tags = ? WHERE id = ?');
  db.transaction(() => {
    for (const a of outcome.addedTags) {
      const row = sel.get(a.personId) as { tags: string } | undefined;
      if (!row) continue;
      const merged = [...new Set([...safeTags(row.tags), ...a.tags])];
      upd.run(JSON.stringify(merged), a.personId);
    }
  })();
}

export async function restoreRoom(folderId: string): Promise<RestoreOutcome> {
  try {
    return await restoreRoomUnsafe(folderId);
  } catch (e) {
    return {
      success: false, steps: [], remaining: [folderId], error: toFailure(e).message,
      addedTags: [], unresolvedMembers: 0,
    };
  }
}

async function restoreRoomUnsafe(folderId: string): Promise<RestoreOutcome> {
  const fail = (error: string): RestoreOutcome => ({
    success: false, steps: [], remaining: [folderId], error, addedTags: [], unresolvedMembers: 0,
  });
  const adminId = setting('admin_id');
  const sharingContainerId = setting('sharing_container_id');
  const roleNames = roles();
  if (!adminId || !sharingContainerId || !setting('user_id') || roleNames.length === 0) {
    return fail('synchronisation requise');
  }

  const deps = buildDeps();
  let outcome: RestoreOutcome;
  try {
    const categoryIds = await liveCategoryIds(deps);
    const membersOf = await buildMembersOf();
    outcome = await runRestore(
      { folderId, adminId, sharingContainerId, roles: roleNames, categoryIds, membersOf },
      deps,
    );
  } catch (e) {
    outcome = fail(toFailure(e).message);
  }

  try {
    reconcileRestore(outcome);
  } catch (e) {
    console.error('[room-archive] local reconcile failed:', e instanceof Error ? e.message : e);
  }
  console.log(
    `[room-archive] restore folder=${folderId} success=${outcome.success} ` +
    `steps=${outcome.steps.map((s) => `${s.step}:${s.status}`).join(',')} remaining=${outcome.remaining.length}`,
  );
  return outcome;
}
