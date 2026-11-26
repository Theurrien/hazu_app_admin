// Level change — raw API rows → the copy core's shapes. PURE (no DB, HTTP or Electron), vitest-runnable.
import { normalizeRow } from './formation/parse';
import type { AclRow, CopyNode } from './level-change-copy';

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

/**
 * One raw /read or /readChildren row → CopyNode. normalizeRow gives id, parent, type, title,
 * description, icon, colour and tags; privacy and `event.rolesSettings` are read from the same
 * envelope (`snapshot ?? data ?? raw`), as the Maintenance copy reads them from `snapshot`
 * (hazu-copy.ts:69-71, :83).
 */
export function toCopyNode(raw: unknown): CopyNode | null {
  const row = normalizeRow(raw);
  if (!row || !isObj(raw)) return null;
  const env: Obj = isObj(raw.snapshot) ? raw.snapshot : isObj(raw.data) ? raw.data : raw;
  const privacy = env.privacy ?? raw.privacy;
  const event = isObj(env.event) ? env.event : isObj(raw.event) ? raw.event : null;
  const rolesSettings = event && event.rolesSettings !== undefined ? event.rolesSettings : null;
  return {
    id: row.id,
    parentId: row.parentId,
    type: row.type,
    title: row.title,
    description: row.description,
    icon: row.icon,
    color: row.color,
    privacy: typeof privacy === 'string' && privacy ? privacy : null,
    tags: row.tags,
    rolesSettings,
  };
}

/** The entries of an /acl response (`{ data: [...] }` or a bare array); any other shape throws. */
export function aclEntries(resp: unknown): unknown[] {
  // An unexpected shape is a failed read, never an empty ACL.
  const list = Array.isArray(resp) ? resp : isObj(resp) && Array.isArray(resp.data) ? resp.data : null;
  if (!list) throw new Error('réponse ACL inattendue');
  return list;
}

export const PRINCIPAL_MISSING = 'entrée ACL de groupe sans principal';

/**
 * An /acl response → AclRow[]. Nothing is filtered by `isGroup`: the core classifies role groups by
 * `groupId` (a direct grant can carry isGroup:true). No row ever leaves with an empty principal:
 * - an entry without authorId and without groupId cannot be a role group nor the student: dropped;
 * - an entry without authorId but WITH a groupId may be a role group the run cannot write to:
 *   the whole read throws, so that node's access stays unconfirmed (as an unreadable ACL), never
 *   « done ».
 */
export function toAclRows(resp: unknown): AclRow[] {
  const out: AclRow[] = [];
  for (const e of aclEntries(resp)) {
    if (!isObj(e)) continue;
    const authorId = typeof e.authorId === 'string' ? e.authorId.trim() : e.authorId ? String(e.authorId) : '';
    const groupId = e.groupId ? String(e.groupId) : null;
    if (!authorId) {
      if (groupId) throw new Error(PRINCIPAL_MISSING);
      continue;
    }
    out.push({ authorId, groupId, isGroup: e.isGroup === true, role: typeof e.role === 'string' ? e.role : '' });
  }
  return out;
}

/**
 * The student's account id for the level change. A tag value without "@" is the id. An e-mail is
 * matched case-insensitively against the profile ACL's `description` — WITHOUT the isGroup filter
 * Missions applies (a direct person grant can carry isGroup:true). Several distinct authorIds for
 * the same e-mail → null (unresolved), never a guess.
 */
export function studentIdFromAcl(identityTag: string | null, entries: unknown[]): string | null {
  const tag = (identityTag ?? '').trim();
  if (!tag) return null;
  if (!tag.includes('@')) return tag;
  const want = tag.toLowerCase();
  const ids = new Set<string>();
  for (const e of entries) {
    if (!isObj(e) || !e.authorId) continue;
    if (String(e.description ?? '').trim().toLowerCase() === want) ids.add(String(e.authorId));
  }
  return ids.size === 1 ? [...ids][0] : null;
}

export const NO_ROLE_GROUPS = "groupes de rôle inconnus — synchronisez d'abord";

/** Ruling R11: copies need the role groups of the last sync to align access; none known → refuse. */
export function copiesRefusal(copySections: string[], roleGroupCount: number): string | null {
  return copySections.length > 0 && roleGroupCount === 0 ? NO_ROLE_GROUPS : null;
}
