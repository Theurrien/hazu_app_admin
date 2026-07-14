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

// Precondition: `byEmail` keys MUST be lowercased by the caller. This function
// lowercases the member email before an exact `Map.get`, so non-lowercased keys
// will silently miss and resolve to `unknown`.
export function resolvePerson(
  member: AclMember,
  byEmail: Map<string, string>,
): { personId: string } | { issue: 'unresolved' | 'unknown' } {
  const email = (member.description || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { issue: 'unresolved' };
  const personId = byEmail.get(email);
  if (!personId) return { issue: 'unknown' };
  return { personId };
}

// Precondition: `byEmail` keys MUST be lowercased by the caller (see resolvePerson).
export async function computeGroupAssignments(
  groups: RoleGroup[],
  getAcl: (id: string) => Promise<{ data: AclMember[] }>,
  byEmail: Map<string, string>,
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
      const rawEmail = (m.description || '').trim();
      if (isSystemAccount(rawEmail)) continue;
      const r = resolvePerson(m, byEmail);
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
