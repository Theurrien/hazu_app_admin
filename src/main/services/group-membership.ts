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

// Preconditions on `byEmail` / `byUid`: see resolvePerson.
// `excludeUids` holds account UIDs (ACL authorId) to drop entirely — e.g. super-user
// group members, who are granted access everywhere without a real role/tag and would
// otherwise flood assignments/issues as noise. An excluded member yields neither.
export async function computeGroupAssignments(
  groups: RoleGroup[],
  getAcl: (id: string) => Promise<{ data: AclMember[] }>,
  byEmail: Map<string, string>,
  excludeUids: Set<string> = new Set(),
  byUid: Map<string, string> = new Map(),
): Promise<ComputeResult> {
  const assignments: GroupAssignment[] = [];
  const issues: MembershipIssue[] = [];

  for (const g of groups) {
    let acl: { data: AclMember[] };
    try {
      acl = await getAcl(g.groupId);
    } catch (err) {
      // One group's ACL read failing (e.g. an intermittent Hazu 500) must not
      // abort the whole batch and blank person_room_assignments. Log and skip,
      // matching syncAssignments/syncPersonsRecursive in sync.service.ts.
      console.error(
        `[group-membership] Failed to read ACL for group ${g.groupId} (room ${g.roomId}, role ${g.role}); skipping:`,
        err,
      );
      continue;
    }
    for (const m of acl?.data || []) {
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
  }

  return { assignments, issues };
}
