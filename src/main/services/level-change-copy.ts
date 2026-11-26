// Level change — copy of a template-only section into a profile, with access alignment. PURE core:
// every call is injected (vitest-runnable, no native module).
//
// Create is never resent blindly: a timeout says nothing about whether the node landed, so after a
// transient failure the parent is re-listed and the new node matched by title+icon+colour before any
// resend (room-archive's createOnce matches by an identifying tag, which a copy does not have —
// hence the small local equivalent below).
import { ApiFailure, withRetry } from './room-archive';
import { isRetryableError, backoffMs } from './role-write';
import { sectionKey } from './level-change';

export interface CopyNode {
  id: string;
  parentId: string | null;
  type: string;
  title: string;
  description: string;
  icon: string | null;
  color: string | null;
  privacy: string | null;
  tags: string[];
  rolesSettings: unknown | null;
}
export interface AclRow { authorId: string; groupId: string | null; isGroup: boolean; role: string }
export interface CopyDeps {
  readFull(id: string): Promise<CopyNode | null>;
  /** Parent echo removed; throws on failure. */
  listFull(parentId: string): Promise<CopyNode[]>;
  /** Returns the new id; throws ApiFailure. */
  create(parentId: string, from: CopyNode): Promise<string>;
  remove(id: string): Promise<void>;
  acl(id: string): Promise<AclRow[]>;
  setRole(itemId: string, principalId: string, role: string): Promise<void>;
  removeFromAcl(itemId: string, principalId: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export const ROLE_RANK: Record<string, number> = { reader: 1, editor: 2, admin: 3, owner: 4 };
const MAX_DEPTH = 20;
const MAX_ATTEMPTS = 3;
const VERIFY_READS = 3;
const VERIFY_DELAY_MS = 750;
export const PARTIAL_COPY_PROBLEM = 'copie incomplète — supprimée, à refaire';

const INVITE_RE = /^hz-invite-self-(reader|editor|admin)$/;
const SHARE_RE = /^hz-share-([a-z]+)-(reader|editor|admin|owner)$/;

export function inviteRole(tags: string[]): string | null {
  for (const t of tags) {
    const m = INVITE_RE.exec(t);
    if (m) return m[1];
  }
  return null;
}

/** role → aclRole from `hz-share-{role}-{aclRole}` tags. */
export function shareRoles(tags: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of tags) {
    const m = SHARE_RE.exec(t);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

export interface AclFix {
  raiseStudent: string | null;
  setGroups: Array<{ principalId: string; role: string }>;
  removeGroups: string[];
}

function isRoleGroup(r: AclRow, roleGroups: Map<string, string>): boolean {
  // classified by groupId, never by isGroup: a person's direct grant can be stored with isGroup:true
  return !!r.groupId && roleGroups.has(r.groupId);
}

function studentRank(rows: AclRow[], studentId: string): number {
  let best = 0;
  for (const r of rows) {
    if (r.authorId === studentId) best = Math.max(best, ROLE_RANK[r.role] ?? 0);
  }
  return best;
}

export function planAclFix(
  rows: AclRow[], tags: string[], roleGroups: Map<string, string>, studentId: string | null,
): AclFix {
  const fix: AclFix = { raiseStudent: null, setGroups: [], removeGroups: [] };
  const invite = inviteRole(tags);
  if (invite && studentId && studentRank(rows, studentId) < (ROLE_RANK[invite] ?? 0)) {
    fix.raiseStudent = invite;
  }
  const shares = shareRoles(tags);
  for (const r of rows) {
    if (!isRoleGroup(r, roleGroups)) continue;
    const want = shares.get(roleGroups.get(r.groupId as string) as string);
    if (want === undefined) fix.removeGroups.push(r.authorId);
    else if (r.role !== want) fix.setGroups.push({ principalId: r.authorId, role: want });
  }
  return fix;
}

export function aclMatches(
  rows: AclRow[], tags: string[], roleGroups: Map<string, string>, studentId: string | null,
): boolean {
  if (inviteRole(tags) && !studentId) return false;
  const f = planAclFix(rows, tags, roleGroups, studentId);
  return f.raiseStudent === null && f.setGroups.length === 0 && f.removeGroups.length === 0;
}

export interface CopyResult { ok: boolean; newId: string | null; problems: string[] }

/** Re-list the parent up to 3 times (750 ms apart) for a node matching `from` that is not excluded. */
async function findLanded(
  deps: CopyDeps, parentId: string, from: CopyNode, exclude: Set<string>,
): Promise<string | null> {
  const key = sectionKey(from);
  for (let i = 0; i < VERIFY_READS; i++) {
    if (i > 0) await deps.sleep(VERIFY_DELAY_MS);
    try {
      const children = await withRetry(deps, () => deps.listFull(parentId));
      const landed = children.find(c => !exclude.has(c.id) && sectionKey(c) === key);
      if (landed) return landed.id;
    } catch {
      // an unreadable listing is retried within the same budget
    }
  }
  return null;
}

/**
 * Create `from` under `parentId` once; `exclude` = ids that must never be adopted as the landed node.
 * After a transient failure — including the last one — the parent is re-listed (3 reads, riding out
 * cache lag) and a landed node adopted before anything is resent or the failure is rethrown.
 */
async function createOnce(
  deps: CopyDeps, parentId: string, from: CopyNode, exclude: Set<string>,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.create(parentId, from);
    } catch (e) {
      const f = e as Partial<ApiFailure>;
      if (!isRetryableError(f?.status, f?.networkOrTimeout === true)) throw e;
      if (attempt + 1 < MAX_ATTEMPTS) await deps.sleep(backoffMs(attempt));
      const landed = await findLanded(deps, parentId, from, exclude);
      if (landed) return landed;
      if (attempt + 1 >= MAX_ATTEMPTS) throw e;
    }
  }
}

interface Copied { id: string; node: CopyNode }

async function copyTree(
  deps: CopyDeps, from: CopyNode, newParentId: string, depth: number,
  exclude: Set<string>, visited: Set<string>, copies: Copied[],
): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error('profondeur maximale dépassée');
  if (visited.has(from.id)) throw new Error('cycle dans le modèle');
  visited.add(from.id);
  const newId = await createOnce(deps, newParentId, from, exclude);
  exclude.add(newId);
  copies.push({ id: newId, node: from });
  const kids = await withRetry(deps, () => deps.listFull(from.id));
  for (const k of kids) await copyTree(deps, k, newId, depth + 1, exclude, visited, copies);
}

async function countSubtree(deps: CopyDeps, id: string, depth: number, seen: Set<string>): Promise<number> {
  if (depth > MAX_DEPTH || seen.has(id)) return 0;
  seen.add(id);
  const kids = await withRetry(deps, () => deps.listFull(id));
  let n = 1;
  for (const k of kids) n += await countSubtree(deps, k.id, depth + 1, seen);
  return n;
}

/** Remove, then confirm by listing the parent that the node is gone (a 404 on retry proves nothing). */
async function removeVerified(deps: CopyDeps, parentId: string, id: string): Promise<boolean> {
  try { await withRetry(deps, () => deps.remove(id)); } catch { /* the listing decides */ }
  for (let i = 0; i < VERIFY_READS; i++) {
    if (i > 0) await deps.sleep(VERIFY_DELAY_MS);
    try {
      const kids = await withRetry(deps, () => deps.listFull(parentId));
      if (!kids.some(c => c.id === id)) return true;
    } catch { /* retried */ }
  }
  return false;
}

async function alignAcl(
  deps: CopyDeps, c: Copied, roleGroups: Map<string, string>, studentId: string | null,
): Promise<boolean> {
  const tags = c.node.tags;
  for (let i = 0; i < VERIFY_READS; i++) {
    if (i > 0) await deps.sleep(VERIFY_DELAY_MS);
    try {
      const rows = await withRetry(deps, () => deps.acl(c.id));
      if (aclMatches(rows, tags, roleGroups, studentId)) return true;
      const fix = planAclFix(rows, tags, roleGroups, studentId);
      if (fix.raiseStudent && studentId) {
        const role = fix.raiseStudent;
        await withRetry(deps, () => deps.setRole(c.id, studentId, role));
      }
      for (const g of fix.setGroups) await withRetry(deps, () => deps.setRole(c.id, g.principalId, g.role));
      for (const p of fix.removeGroups) await withRetry(deps, () => deps.removeFromAcl(c.id, p));
    } catch {
      // an unreadable or failed step is decided by the next read
    }
  }
  try {
    const rows = await withRetry(deps, () => deps.acl(c.id));
    return aclMatches(rows, tags, roleGroups, studentId);
  } catch {
    return false;
  }
}

export async function copySection(
  templateSectionId: string, profileId: string, deps: CopyDeps,
  roleGroups: Map<string, string>, studentId: string | null,
): Promise<CopyResult> {
  const fail = (problem: string, newId: string | null = null): CopyResult => ({ ok: false, newId, problems: [problem] });

  let template: CopyNode | null;
  let before: CopyNode[];
  try {
    template = await withRetry(deps, () => deps.readFull(templateSectionId));
    before = await withRetry(deps, () => deps.listFull(profileId));
  } catch (e) {
    return fail(`lecture impossible : ${(e as { message?: string })?.message ?? String(e)}`);
  }
  if (!template) return fail('section du modèle introuvable');

  const exclude = new Set<string>(before.map(n => n.id));
  const copies: Copied[] = [];
  let topId: string | null = null;
  let complete = false;
  try {
    await copyTree(deps, template, profileId, 0, exclude, new Set<string>(), copies);
    topId = copies[0]?.id ?? null;
    if (topId) {
      const copied = await countSubtree(deps, topId, 0, new Set<string>());
      complete = copied === copies.length;
    }
  } catch {
    topId = copies[0]?.id ?? null;
    complete = false;
  }

  const key = sectionKey(template);
  const freshOf = async (): Promise<string[]> => {
    const kids = await withRetry(deps, () => deps.listFull(profileId));
    return kids.filter(c => !before.some(o => o.id === c.id) && sectionKey(c) === key).map(c => c.id);
  };

  if (!complete) {
    // A create that failed finally may still have landed: sweep every fresh node of this key.
    const victims = new Set<string>(topId ? [topId] : []);
    try { for (const id of await freshOf()) victims.add(id); } catch { /* nothing more known */ }
    let stuck = false;
    for (const id of victims) if (!(await removeVerified(deps, profileId, id))) stuck = true;
    return stuck ? fail(`${PARTIAL_COPY_PROBLEM} (suppression échouée)`, topId) : fail(PARTIAL_COPY_PROBLEM);
  }

  const notes: string[] = [];
  let extrasStuck = false;
  try {
    const extras = (await freshOf()).filter(id => id !== topId);
    for (const id of extras) {
      if (await removeVerified(deps, profileId, id)) notes.push('doublon de la copie supprimé');
      else { extrasStuck = true; notes.push('doublon de la copie non supprimé'); }
    }
  } catch {
    extrasStuck = true;
    notes.push('doublons possibles non vérifiés');
  }

  const problems: string[] = [];
  for (const c of copies) {
    if (!(await alignAcl(deps, c, roleGroups, studentId))) {
      problems.push(`accès non confirmés : « ${c.node.title} »`);
    }
  }
  return { ok: problems.length === 0 && !extrasStuck, newId: topId, problems: [...notes, ...problems] };
}
