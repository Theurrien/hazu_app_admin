export interface RoleWriteIntent {
  oldRole: string | null;
  newRole: string | null;
}

export interface GroupMembershipSnapshot {
  inNewGroup: boolean;
  inOldGroup: boolean;
}

export interface VerifyResult {
  verified: boolean;
  reconciledRole: string | null;
  partial: boolean;
}

export interface RoleWriteOutcome {
  success: boolean;
  postOk: boolean;
  verifyRan: boolean;
  verified: boolean;
  reconciledRole: string | null;
  partial: boolean;
  attempts: number;
  error?: string;
}

export interface RoleWriteDeps {
  // One POST attempt; classifies its own failure for the retry predicate.
  postUpdateRoles: () => Promise<{ ok: boolean; status?: number; networkOrTimeout: boolean; error?: string }>;
  // Read current group truth; null = could not read (missing local group / ACL read error).
  readMembership: () => Promise<GroupMembershipSnapshot | null>;
  sleep: (ms: number) => Promise<void>;
}

export interface RoleWriteConfig {
  maxWriteAttempts?: number;
  maxVerifyReads?: number;
  verifyDelayMs?: number;
}

const DEFAULT_CFG = { maxWriteAttempts: 3, maxVerifyReads: 3, verifyDelayMs: 750 };

function isRealRole(role: string | null): boolean {
  return role != null && role !== '_' && role !== '';
}

// An ACL member entry as returned by getAclInfo. `isGroup` entries grant access to another
// group rather than to a person, so they are skipped when matching an individual.
export interface AclMember {
  authorId?: string;
  description?: string;
  isGroup?: boolean;
}

// Does `identity` (a person's local `persons.email`) name a member of this ACL?
// Matches a member by email (`description`, case-insensitive) OR by account id (`authorId`).
// The authorId path matters because `persons.email` sometimes holds the account UID instead of
// an email — in which case it equals the ACL entry's authorId, not its description. Emails and
// UIDs occupy disjoint value spaces (emails contain '@', UIDs do not), so this cannot false-match.
export function isIdentityInAcl(members: AclMember[], identity: string): boolean {
  const id = (identity || '').trim().toLowerCase();
  if (!id) return false;
  for (const m of members || []) {
    if (m.isGroup) continue;
    if ((m.description || '').trim().toLowerCase() === id) return true;
    if ((m.authorId || '').trim().toLowerCase() === id) return true;
  }
  return false;
}

// Is this string shaped like an email? Used to decide whether a "not a member" reading can be
// trusted: if the local identity is not an email and was not matched as an account id, we cannot
// verify and fall back to trusting the write's 2xx.
export function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim());
}

// Retry only transient failures: any 5xx, or a network/timeout error. Never a 4xx (deterministic).
export function isRetryableError(status: number | undefined, networkOrTimeout: boolean): boolean {
  if (networkOrTimeout) return true;
  if (status === undefined) return false;
  return status >= 500 && status <= 599;
}

// Exponential backoff for 0-indexed attempt: 500, 1000, 2000, ...
export function backoffMs(attempt: number): number {
  return 500 * Math.pow(2, attempt);
}

// Decide verification + the role local state should be reconciled to, from group truth.
export function evaluateVerification(intent: RoleWriteIntent, snapshot: GroupMembershipSnapshot): VerifyResult {
  const wantNew = isRealRole(intent.newRole);
  const wantOldGone = isRealRole(intent.oldRole) && intent.oldRole !== intent.newRole;
  const { inNewGroup, inOldGroup } = snapshot;

  const newOk = wantNew ? inNewGroup : true;
  const oldOk = wantOldGone ? !inOldGroup : true;
  const verified = newOk && oldOk;

  const reconciledRole =
    inNewGroup && wantNew
      ? intent.newRole
      : inOldGroup && isRealRole(intent.oldRole)
        ? intent.oldRole
        : null;

  const isChange = wantNew && wantOldGone;
  const partial = isChange && !verified && (inNewGroup || !inOldGroup);

  return { verified, reconciledRole, partial };
}

// Orchestrate retry + verify with all IO injected. The unit-tested heart of S4.
export async function runReliableRoleWrite(
  intent: RoleWriteIntent,
  deps: RoleWriteDeps,
  cfg: RoleWriteConfig = {},
): Promise<RoleWriteOutcome> {
  const { maxWriteAttempts, maxVerifyReads, verifyDelayMs } = { ...DEFAULT_CFG, ...cfg };

  // 1. Write with retry on transient failures only.
  let attempts = 0;
  let postOk = false;
  let lastError: string | undefined;
  while (attempts < maxWriteAttempts) {
    attempts += 1;
    const r = await deps.postUpdateRoles();
    if (r.ok) {
      postOk = true;
      break;
    }
    lastError = r.error;
    if (!isRetryableError(r.status, r.networkOrTimeout) || attempts >= maxWriteAttempts) break;
    await deps.sleep(backoffMs(attempts - 1));
  }

  if (!postOk) {
    return { success: false, postOk: false, verifyRan: false, verified: false, reconciledRole: null, partial: false, attempts, error: lastError };
  }

  // 2. Verify against group truth, re-reading through cache lag.
  let snapshot: GroupMembershipSnapshot | null = null;
  let verifyRan = false;
  for (let i = 0; i < maxVerifyReads; i++) {
    const s = await deps.readMembership();
    if (s === null) break; // cannot verify (missing group / read error)
    snapshot = s;
    verifyRan = true;
    if (evaluateVerification(intent, s).verified) break;
    if (i < maxVerifyReads - 1) await deps.sleep(verifyDelayMs);
  }

  // 3. Could not verify -> trust the 2xx; reconcile optimistically to intent.
  if (!verifyRan || snapshot === null) {
    const optimistic = isRealRole(intent.newRole) ? intent.newRole : null;
    return { success: true, postOk: true, verifyRan: false, verified: false, reconciledRole: optimistic, partial: false, attempts };
  }

  // 4. Decide from truth.
  const v = evaluateVerification(intent, snapshot);
  return {
    success: v.verified, // == postOk && !(verifyRan && !verified) when verifyRan
    postOk: true,
    verifyRan: true,
    verified: v.verified,
    reconciledRole: v.reconciledRole,
    partial: v.partial,
    attempts,
    error: v.verified
      ? undefined
      : v.partial
        ? 'Write returned OK but the role change is only partially reflected in the role-group membership'
        : 'Write returned OK but the role-group membership did not reflect the change',
  };
}
