import { AclMember, isRetryableError, backoffMs } from './role-write';

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

// Find the ACL entry granting `accountId` access, if any. Unlike isIdentityInAcl in
// role-write.ts, this does NOT skip isGroup entries: Hazu records a person's direct grant on a
// room item with isGroup=true, so skipping them would report absence for access that is still
// live. Matching is by account id only — an orphan has no profile, so there is no local email to
// match against.
export function findAccountOnAcl(members: AclMember[], accountId: string): AclMember | undefined {
  const id = (accountId || '').trim().toLowerCase();
  if (!id) return undefined;
  for (const m of members || []) {
    if ((m.authorId || '').trim().toLowerCase() === id) return m;
  }
  return undefined;
}

// Does this ACL still carry a grant for `accountId`? Thin boolean wrapper over findAccountOnAcl
// so planning (which needs the entry, e.g. to read aclRole) and verification (which only needs
// yes/no) can never silently disagree about who counts as "on the ACL".
export function isAccountOnAcl(members: AclMember[], accountId: string): boolean {
  return findAccountOnAcl(members, accountId) !== undefined;
}

// Access is revoked only when the account is absent from BOTH ACLs. Anything else names what
// survived, so a partial removal is never presented as done.
export function evaluateRemoval(snapshot: RemovalSnapshot): RemovalVerdict {
  const surviving: GrantKind[] = [];
  if (snapshot.inGroup) surviving.push('group');
  if (snapshot.onRoom) surviving.push('roomItem');
  return { verified: surviving.length === 0, surviving };
}

export interface OrphanRemovalIntent {
  accountId: string;
  groupId: string;
  roomId: string;
  grants: OrphanGrant[];
}

export interface OrphanRemovalDeps {
  // One DELETE attempt against an item ACL; classifies its own failure for the retry predicate.
  deleteFromItem: (itemId: string) => Promise<{ ok: boolean; status?: number; networkOrTimeout: boolean; error?: string }>;
  // Read an ACL; null = could not read (HTTP error).
  readGroupAcl: () => Promise<AclMember[] | null>;
  readRoomAcl: () => Promise<AclMember[] | null>;
  sleep: (ms: number) => Promise<void>;
}

export interface OrphanRemovalConfig {
  maxDeleteAttempts?: number;
  maxVerifyReads?: number;
  verifyDelayMs?: number;
}

export interface OrphanRemovalOutcome {
  success: boolean;
  deleteOk: boolean;
  verifyRan: boolean;
  verified: boolean;
  surviving: GrantKind[];
  attempts: number;
  error?: string;
}

const DEFAULT_CFG = { maxDeleteAttempts: 3, maxVerifyReads: 3, verifyDelayMs: 750 };

const LABEL: Record<GrantKind, string> = {
  group: 'role group',
  roomItem: 'room item',
};

// Remove an orphan account's access, then confirm it against the ACLs. All IO injected.
export async function runOrphanRemoval(
  intent: OrphanRemovalIntent,
  deps: OrphanRemovalDeps,
  cfg: OrphanRemovalConfig = {},
): Promise<OrphanRemovalOutcome> {
  const { maxDeleteAttempts, maxVerifyReads, verifyDelayMs } = { ...DEFAULT_CFG, ...cfg };

  // 1. Delete each planned grant, retrying transient failures only.
  let attempts = 0;
  let deleteOk = true;
  let lastError: string | undefined;
  for (const grant of intent.grants) {
    let grantOk = false;
    for (let i = 0; i < maxDeleteAttempts; i++) {
      attempts += 1;
      const r = await deps.deleteFromItem(grant.itemId);
      if (r.ok) {
        grantOk = true;
        break;
      }
      lastError = r.error;
      if (!isRetryableError(r.status, r.networkOrTimeout) || i === maxDeleteAttempts - 1) break;
      await deps.sleep(backoffMs(i));
    }
    if (!grantOk) deleteOk = false;
  }

  // 2. Verify against both ACLs, re-reading through cache lag. Always attempt this, even after a
  //    non-retryable failure: a 404 plausibly means the grant was already absent, and the read
  //    answers the only question that matters — is the access gone?
  let snapshot: RemovalSnapshot | null = null;
  for (let i = 0; i < maxVerifyReads; i++) {
    const groupAcl = await deps.readGroupAcl();
    const roomAcl = await deps.readRoomAcl();
    if (groupAcl === null || roomAcl === null) break; // cannot verify
    snapshot = {
      inGroup: isAccountOnAcl(groupAcl, intent.accountId),
      onRoom: isAccountOnAcl(roomAcl, intent.accountId),
    };
    if (evaluateRemoval(snapshot).verified) break;
    if (i < maxVerifyReads - 1) await deps.sleep(verifyDelayMs);
  }

  // 3. Truth unreadable: fall back to the delete status codes.
  if (snapshot === null) {
    return {
      success: deleteOk,
      deleteOk,
      verifyRan: false,
      verified: false,
      surviving: [],
      attempts,
      error: deleteOk ? undefined : lastError,
    };
  }

  // 4. Truth decides, in both directions.
  const v = evaluateRemoval(snapshot);
  return {
    success: v.verified,
    deleteOk,
    verifyRan: true,
    verified: v.verified,
    surviving: v.surviving,
    attempts,
    error: v.verified
      ? undefined
      : `Access was not fully removed — still present on the ${v.surviving.map((k) => LABEL[k]).join(' and the ')}`,
  };
}
