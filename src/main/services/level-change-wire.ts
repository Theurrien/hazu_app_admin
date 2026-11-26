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

/**
 * An /acl response (`{ data: [...] }` or a bare array) → AclRow[]. Nothing is filtered by
 * `isGroup`: the core classifies role groups by `groupId` (a direct grant can carry isGroup:true).
 * An entry without an authorId is kept (authorId '') so a role group it names still fails the
 * access check instead of disappearing from it. Throws on an unexpected response shape.
 */
export function toAclRows(resp: unknown): AclRow[] {
  // An unexpected shape is a failed read, never an empty ACL.
  const list: unknown[] | null = Array.isArray(resp) ? resp : isObj(resp) && Array.isArray(resp.data) ? resp.data : null;
  if (!list) throw new Error('réponse ACL inattendue');
  const out: AclRow[] = [];
  for (const e of list) {
    if (!isObj(e)) continue;
    out.push({
      authorId: e.authorId ? String(e.authorId) : '',
      groupId: e.groupId ? String(e.groupId) : null,
      isGroup: e.isGroup === true,
      role: typeof e.role === 'string' ? e.role : '',
    });
  }
  return out;
}
