import { AclMember } from './role-write';

export type GrantKind = 'group' | 'roomItem';

// One place an orphan account's access lives. `itemId` is the role-group id for 'group'
// and the room id for 'roomItem'.
export interface OrphanGrant {
  kind: GrantKind;
  itemId: string;
  title: string;
  aclRole?: string; // room-item entries only: reader / editor
}

export interface RemovalSnapshot {
  inGroup: boolean;
  onRoom: boolean;
}

export interface RemovalVerdict {
  verified: boolean;
  surviving: GrantKind[];
}

// Does this ACL still carry a grant for `accountId`? Unlike isIdentityInAcl in role-write.ts,
// this does NOT skip isGroup entries: Hazu records a person's direct grant on a room item with
// isGroup=true, so skipping them would report absence for access that is still live. Matching is
// by account id only — an orphan has no profile, so there is no local email to match against.
export function isAccountOnAcl(members: AclMember[], accountId: string): boolean {
  const id = (accountId || '').trim().toLowerCase();
  if (!id) return false;
  for (const m of members || []) {
    if ((m.authorId || '').trim().toLowerCase() === id) return true;
  }
  return false;
}

// Access is revoked only when the account is absent from BOTH ACLs. Anything else names what
// survived, so a partial removal is never presented as done.
export function evaluateRemoval(snapshot: RemovalSnapshot): RemovalVerdict {
  const surviving: GrantKind[] = [];
  if (snapshot.inGroup) surviving.push('group');
  if (snapshot.onRoom) surviving.push('roomItem');
  return { verified: surviving.length === 0, surviving };
}
