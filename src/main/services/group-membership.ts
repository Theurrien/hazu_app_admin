import { isRetryableError, backoffMs } from './role-write';

export interface AclMember {
  authorId: string;
  description: string;
  displayName: string;
  isGroup: boolean;
  role: string;
}

export interface RoleGroup {
  groupId: string; // distribution_groups.id (the group entity)
  roomId: string;  // distribution_groups.room_id
  role: string;    // distribution_groups.role (semantic: student/schoolteacher/...)
}

export interface GroupAssignment {
  personId: string;
  roomId: string;
  role: string;
}

export interface MembershipIssue {
  type: 'unresolved' | 'unknown';
  groupId: string;
  roomId: string;
  role: string;
  uid: string;
  email: string | null;
  displayName: string;
}

export interface ComputeResult {
  assignments: GroupAssignment[];
  issues: MembershipIssue[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isSystemAccount(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith('@hazu.io');
}

// A person has TWO identifiers on Hazu: an email address and an account UID. Which one
// lands in `persons.email` depends on what the profile's `hz-config-userid-<identity>` tag
// happened to carry — for a sizeable minority of profiles that is the UID, not an address.
// An ACL entry names the person both ways (`description` = email, `authorId` = UID), so we
// try the email first and fall back to the UID. Matching only on email drops every person
// whose tag holds a UID. This mirrors `isIdentityInAcl` in role-write.ts, which accepts the
// same two identity forms when verifying a write against group truth.
//
// Preconditions: `byEmail` keys MUST be lowercased by the caller (the member email is
// lowercased before lookup). `byUid` keys MUST NOT be — account UIDs are case-sensitive and
// are compared verbatim.
export function resolvePerson(
  member: AclMember,
  byEmail: Map<string, string>,
  byUid: Map<string, string> = new Map(),
): { personId: string } | { issue: 'unresolved' | 'unknown' } {
  const email = (member.description || '').trim().toLowerCase();
  const isEmail = EMAIL_RE.test(email);

  if (isEmail) {
    const byEmailHit = byEmail.get(email);
    if (byEmailHit) return { personId: byEmailHit };
  }

  const uid = (member.authorId || '').trim();
  if (uid) {
    const byUidHit = byUid.get(uid);
    if (byUidHit) return { personId: byUidHit };
  }

  // Neither identity found a profile: an entry that never named an email cannot be mapped
  // at all (`unresolved`); one that did name an email points at a profile we do not have
  // (`unknown` — a genuine orphan account).
  return { issue: isEmail ? 'unknown' : 'unresolved' };
}

export interface ComputeOptions {
  // How many group ACLs are read at once. One read takes ~0.35 s and a sync reads ~835 groups,
  // so a sequential loop alone was ~4–5 minutes. Measured 2026-11-24: 10 parallel reads brought
  // the effective cost to ~0.09 s/read with no errors; 8 leaves headroom.
  concurrency?: number;
  // Attempts per group for transient failures (5xx / network / timeout). More parallel reads
  // make an intermittent 500 likelier, and a skipped group silently drops its assignments
  // (and surfaces them as false discrepancies), so retry before giving up.
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_ACL_CONCURRENCY = 8;
const DEFAULT_ACL_ATTEMPTS = 3;

// Transient = an HTTP 5xx, or an axios error with no response at all (network/timeout).
// Anything else (4xx, or a non-HTTP error) is not worth retrying.
function isTransientAclError(err: unknown): boolean {
  const e = err as { response?: { status?: number }; isAxiosError?: boolean; code?: string } | null;
  const status = e?.response?.status;
  const networkOrTimeout = status === undefined && !!(e?.isAxiosError || e?.code);
  return isRetryableError(status, networkOrTimeout);
}

// Preconditions on `byEmail` / `byUid`: see resolvePerson.
// `excludeUids` holds account UIDs (ACL authorId) to drop entirely — e.g. super-user
// group members, who are granted access everywhere without a real role/tag and would
// otherwise flood assignments/issues as noise. An excluded member yields neither.
//
// ACLs are read `concurrency` at a time; results are assembled in `groups` order, so the
// output is identical to a sequential run.
export async function computeGroupAssignments(
  groups: RoleGroup[],
  getAcl: (id: string) => Promise<{ data: AclMember[] }>,
  byEmail: Map<string, string>,
  excludeUids: Set<string> = new Set(),
  byUid: Map<string, string> = new Map(),
  options: ComputeOptions = {},
): Promise<ComputeResult> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_ACL_CONCURRENCY);
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_ACL_ATTEMPTS);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const readWithRetry = async (groupId: string): Promise<{ data: AclMember[] }> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await getAcl(groupId);
      } catch (err) {
        if (attempt + 1 >= maxAttempts || !isTransientAclError(err)) throw err;
        await sleep(backoffMs(attempt));
      }
    }
  };

  // null = the read failed for good; that group is skipped.
  const acls: Array<{ data: AclMember[] } | null> = new Array(groups.length).fill(null);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < groups.length) {
      const i = next++;
      const g = groups[i];
      try {
        acls[i] = await readWithRetry(g.groupId);
      } catch (err) {
        // One group's ACL read failing (e.g. an intermittent Hazu 500) must not
        // abort the whole batch and blank person_room_assignments. Log and skip.
        console.error(
          `[group-membership] Failed to read ACL for group ${g.groupId} (room ${g.roomId}, role ${g.role}); skipping:`,
          err,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, worker));

  const assignments: GroupAssignment[] = [];
  const issues: MembershipIssue[] = [];

  groups.forEach((g, i) => {
    const acl = acls[i];
    if (!acl) return;
    for (const m of acl.data || []) {
      if (m.isGroup) continue; // nested group refs are not members
      if (m.authorId && excludeUids.has(m.authorId)) continue; // super-user group members: excluded everywhere
      const rawEmail = (m.description || '').trim();
      if (isSystemAccount(rawEmail)) continue;
      const r = resolvePerson(m, byEmail, byUid);
      if ('personId' in r) {
        assignments.push({ personId: r.personId, roomId: g.roomId, role: g.role });
      } else {
        issues.push({
          type: r.issue,
          groupId: g.groupId,
          roomId: g.roomId,
          role: g.role,
          uid: m.authorId || '',
          email: EMAIL_RE.test(rawEmail.toLowerCase()) ? rawEmail : null,
          displayName: m.displayName || '',
        });
      }
    }
  });

  return { assignments, issues };
}
