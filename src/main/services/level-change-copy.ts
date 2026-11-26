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
import { removeConfirmed } from './level-change-extra';

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
  /** PUT /acl — used only to grant / raise the student directly. */
  setRole(itemId: string, principalId: string, role: string): Promise<void>;
  /** Detach a group from this item only (DELETE /api-v2-hazus/{itemId}/groups); throws on failure. */
  detachGroup(itemId: string, groupId: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export const ROLE_RANK: Record<string, number> = { reader: 1, editor: 2, admin: 3, owner: 4 };
const RANK_ROLE = ['', 'reader', 'editor', 'admin', 'owner'];
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

/**
 * Ruling R12. An item's ACL lists one row per group MEMBER (authorId = the member, groupId = the
 * granting group). A role group is therefore handled as a whole, by its groupId:
 * - no share tag for its role → detached from the node (one call per distinct groupId, never a
 *   per-member DELETE /acl, which could take a member's other access with it);
 * - a share tag whose aclRole differs from the group's current rows → NOT written (no known
 *   endpoint sets a group's role on an item): reported for a hand fix;
 * - a share tag that matches → untouched.
 * The student is only ever granted or raised directly (PUT /acl), never lowered or removed: when
 * every row of the student on the node comes from a group being detached, the student is granted
 * max(reader, invite role) directly first. Student unresolved → no detach at all (blocked).
 */
export interface AclFix {
  /** role to grant the student directly, before any detach */
  raiseStudent: string | null;
  /** distinct groupIds of role groups to detach */
  detachGroups: string[];
  /** role groups at the wrong share role: never written, reported */
  mismatchedGroups: Array<{ groupId: string; role: string }>;
  /** a detach or an invite grant is needed but the student is unresolved: nothing detached */
  blocked: boolean;
  /** the rank the student must hold once the fix is applied */
  studentRequired: number;
}

function isRoleGroup(r: AclRow, roleGroups: Map<string, string>): boolean {
  // classified by groupId, never by isGroup: a person's direct grant can be stored with isGroup:true
  return !!r.groupId && roleGroups.has(r.groupId);
}

function studentRank(rows: AclRow[], studentId: string, skipGroups: Set<string> = new Set()): number {
  let best = 0;
  for (const r of rows) {
    if (r.authorId !== studentId) continue;
    if (r.groupId && skipGroups.has(r.groupId)) continue;
    best = Math.max(best, ROLE_RANK[r.role] ?? 0);
  }
  return best;
}

/** `minStudentRank`: the rank the student held a right to before the first write (the baseline). */
export function planAclFix(
  rows: AclRow[], tags: string[], roleGroups: Map<string, string>, studentId: string | null,
  minStudentRank = 0,
): AclFix {
  const shares = shareRoles(tags);
  const byGroup = new Map<string, AclRow[]>();
  for (const r of rows) {
    if (!isRoleGroup(r, roleGroups)) continue;
    const g = r.groupId as string;
    byGroup.set(g, [...(byGroup.get(g) ?? []), r]);
  }
  const wantDetach: string[] = [];
  const mismatchedGroups: AclFix['mismatchedGroups'] = [];
  for (const [g, gRows] of byGroup) {
    const role = roleGroups.get(g) as string;
    const want = shares.get(role);
    if (want === undefined) wantDetach.push(g);
    else if (gRows.some(r => r.role !== want)) mismatchedGroups.push({ groupId: g, role });
  }

  const invite = inviteRole(tags);
  if (studentId === null) {
    return {
      raiseStudent: null, detachGroups: [], mismatchedGroups,
      blocked: wantDetach.length > 0 || invite !== null, studentRequired: 0,
    };
  }
  const detach = new Set(wantDetach);
  const had = rows.some(r => r.authorId === studentId);
  const studentRequired = Math.max(
    minStudentRank, ROLE_RANK[invite ?? ''] ?? 0, had ? ROLE_RANK.reader : 0);
  const after = studentRank(rows, studentId, detach);
  const raiseStudent = after < studentRequired ? RANK_ROLE[studentRequired] : null;
  return { raiseStudent, detachGroups: wantDetach, mismatchedGroups, blocked: false, studentRequired };
}

const rowKey = (r: AclRow) => `${r.authorId}\u0000${r.groupId ?? ''}\u0000${r.role}`;

/** What the read-back is compared with: taken from the read before the first write. */
export interface AclBaseline {
  detach: Set<string>;
  /** every row that is neither the student's nor a detached group's */
  others: Set<string>;
  studentRequired: number;
}

function othersOf(rows: AclRow[], studentId: string | null, detach: Set<string>): Set<string> {
  return new Set(rows
    .filter(r => !(studentId !== null && r.authorId === studentId))
    .filter(r => !(r.groupId && detach.has(r.groupId)))
    .map(rowKey));
}

export function baselineOf(
  rows: AclRow[], tags: string[], roleGroups: Map<string, string>, studentId: string | null,
): AclBaseline {
  const fix = planAclFix(rows, tags, roleGroups, studentId);
  const detach = new Set(fix.detachGroups);
  return { detach, others: othersOf(rows, studentId, detach), studentRequired: fix.studentRequired };
}

/**
 * `confirmed`: everything the run is responsible for holds — no detached group's row remains, the
 * student holds at least the required role, every other row is unchanged against the baseline.
 * `mismatched`: role groups left at the wrong share role (never written; a hand fix).
 */
export function accessState(
  rows: AclRow[], tags: string[], roleGroups: Map<string, string>, studentId: string | null,
  baseline: AclBaseline = baselineOf(rows, tags, roleGroups, studentId),
): { confirmed: boolean; mismatched: string[] } {
  const fix = planAclFix(rows, tags, roleGroups, studentId, baseline.studentRequired);
  const mismatched = fix.mismatchedGroups.map(m => m.role);
  const fail = { confirmed: false, mismatched };
  // defence in depth: a role-group row without a principal is never taken as settled
  if (rows.some(r => isRoleGroup(r, roleGroups) && !r.authorId)) return fail;
  if (fix.blocked || fix.raiseStudent !== null || fix.detachGroups.length > 0) return fail;
  if (rows.some(r => r.groupId && baseline.detach.has(r.groupId))) return fail;
  if (studentId !== null && studentRank(rows, studentId) < baseline.studentRequired) return fail;
  const now = othersOf(rows, studentId, baseline.detach);
  if (now.size !== baseline.others.size || [...now].some(k => !baseline.others.has(k))) return fail;
  return { confirmed: true, mismatched };
}

export function aclMatches(
  rows: AclRow[], tags: string[], roleGroups: Map<string, string>, studentId: string | null,
  baseline?: AclBaseline,
): boolean {
  const s = accessState(rows, tags, roleGroups, studentId, baseline);
  return s.confirmed && s.mismatched.length === 0;
}

/** A role group at the wrong share role on a copied node: never written, a hand fix. */
export function groupRoleProblem(role: string, nodeTitle: string): string {
  return `rôle du groupe ${role} à ajuster à la main sur « ${nodeTitle} »`;
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

export const FIDELITY_PROBLEM = 'type ou confidentialité différents du modèle';

/**
 * The created node read back: when the source has a type or a privacy, the copy must carry the same
 * (a source without them was sent without them, and is not checked). Up to 3 reads for a node not
 * yet visible; a mismatch or a node never seen throws, which makes the copy partial (removed).
 */
async function checkFidelity(deps: CopyDeps, newId: string, from: CopyNode): Promise<void> {
  if (!from.type && !from.privacy) return;
  for (let i = 0; i < VERIFY_READS; i++) {
    if (i > 0) await deps.sleep(VERIFY_DELAY_MS);
    let got: CopyNode | null;
    try { got = await withRetry(deps, () => deps.readFull(newId)); } catch { continue; }
    if (!got) continue;
    if ((from.type && got.type !== from.type) || (from.privacy && got.privacy !== from.privacy)) {
      throw new Error(FIDELITY_PROBLEM);
    }
    return;
  }
  throw new Error('copie créée introuvable à la relecture');
}

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
  await checkFidelity(deps, newId, from);
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
  return removeConfirmed(
    { sleep: deps.sleep, remove: deps.remove, list: deps.listFull, read: deps.readFull }, parentId, id);
}

/**
 * Align one copied node's access (R12). The baseline is the first ACL read, before any write; every
 * later read is compared with it. Order: student grant first, then the detaches. A step that fails
 * is decided by the next read; the final read decides.
 */
async function alignAcl(
  deps: CopyDeps, c: Copied, roleGroups: Map<string, string>, studentId: string | null,
): Promise<{ confirmed: boolean; mismatched: string[] }> {
  const tags = c.node.tags;
  let baseline: AclBaseline | null = null;
  let last: { confirmed: boolean; mismatched: string[] } = { confirmed: false, mismatched: [] };
  for (let i = 0; i < VERIFY_READS; i++) {
    if (i > 0) await deps.sleep(VERIFY_DELAY_MS);
    try {
      const rows = await withRetry(deps, () => deps.acl(c.id));
      if (!baseline) baseline = baselineOf(rows, tags, roleGroups, studentId);
      last = accessState(rows, tags, roleGroups, studentId, baseline);
      if (last.confirmed) return last; // a mismatch is never written: nothing more to do
      const fix = planAclFix(rows, tags, roleGroups, studentId, baseline.studentRequired);
      if (fix.blocked) return last; // student unresolved: no detach, ever
      if (fix.raiseStudent && studentId) {
        const role = fix.raiseStudent;
        await withRetry(deps, () => deps.setRole(c.id, studentId, role));
      }
      // only groups of the baseline's detach set, one call per distinct groupId
      for (const g of fix.detachGroups.filter(x => baseline!.detach.has(x))) {
        await withRetry(deps, () => deps.detachGroup(c.id, g));
      }
    } catch {
      // an unreadable or failed step is decided by the next read
    }
  }
  if (!baseline) return { confirmed: false, mismatched: [] };
  try {
    const rows = await withRetry(deps, () => deps.acl(c.id));
    return accessState(rows, tags, roleGroups, studentId, baseline);
  } catch {
    return { confirmed: false, mismatched: last.mismatched };
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
    const a = await alignAcl(deps, c, roleGroups, studentId);
    for (const role of a.mismatched) problems.push(groupRoleProblem(role, c.node.title));
    if (!a.confirmed) problems.push(`accès non confirmés : « ${c.node.title} »`);
  }
  return { ok: problems.length === 0 && !extrasStuck, newId: topId, problems: [...notes, ...problems] };
}
