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
  // Why group truth was not read, when verifyRan is false after a check was attempted:
  // 'unverifiable' = a permanent gap (no identity, group not synced, account unconfirmed);
  // 'read-error' = every ACL read in the loop failed, with the last message in verifyError.
  verifySkipped?: 'unverifiable' | 'read-error';
  verifyError?: string;
}

export interface RoleWriteDeps {
  // One POST attempt; classifies its own failure for the retry predicate.
  postUpdateRoles: () => Promise<{ ok: boolean; status?: number; networkOrTimeout: boolean; error?: string }>;
  // Read current group truth. null = cannot verify, permanently (no identity, group not synced,
  // account unconfirmed) — retrying cannot help. THROW = a transient read error, which the verify
  // loop retries.
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

// Decide whether a membership reading can be trusted, given how the local identity is shaped.
//
// An absence reading ("in neither group") is only evidence if we know the identity we searched
// for is the one the ACL would key this person by. An email identity matches ACL `description`
// and is always trustworthy. A UID identity matches `authorId` — but a UID that is stale, wrong,
// or never linked would also fail to match, so a bare absence proves nothing on its own.
//
// `confirmLinkedAccount` resolves that ambiguity by reading the profile's own ACL: a UID that
// appears there names a live account, which makes "not in the role group" a true negative. It is
// only consulted when it can change the answer — a hit in either group already settles it.
//
// Returning null means "cannot verify", which leaves the write's status code to decide. A failed
// account read is rethrown rather than turned into null: it is transient, not a fact about the
// identity, and the verify loop retries it.
export async function resolveMembershipReading(
  identity: string,
  reading: GroupMembershipSnapshot,
  confirmLinkedAccount: () => Promise<boolean>,
): Promise<GroupMembershipSnapshot | null> {
  if (!(identity || '').trim()) return null;
  if (reading.inNewGroup || reading.inOldGroup) return reading;
  if (looksLikeEmail(identity)) return reading;
  return (await confirmLinkedAccount()) ? reading : null;
}

export interface UpdateUserRolesPayload {
  templateId: string;
  profileId: string;
  userTypesInfo: Array<{ classId: string; oldUserType: string; newUserType: string }>;
}

// Body for POST /api-v2-admin/update-user-roles. `templateId` is the SCHOOL TEMPLATE — the root
// hazu (`root_hazu_id`), the same value the create-group / remove-group calls send — and NOT the
// hz-config-admin hazu (`admin_id`). Hazu support confirmed the admin id is the wrong value here.
// "No role" is encoded as '_' on either side.
export function buildUpdateUserRolesPayload(args: {
  schoolTemplateId: string;
  profileId: string;
  classId: string;
  oldRole: string | null;
  newRole: string | null;
}): UpdateUserRolesPayload {
  return {
    templateId: args.schoolTemplateId,
    profileId: args.profileId,
    userTypesInfo: [{ classId: args.classId, oldUserType: args.oldRole || '_', newUserType: args.newRole || '_' }],
  };
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

interface TruthReading {
  snapshot: GroupMembershipSnapshot | null;
  verifySkipped?: 'unverifiable' | 'read-error';
  verifyError?: string;
}

// Read group truth, re-reading through cache lag. A thrown read is transient and retried within the
// same budget; a null is a permanent cannot-verify and ends the loop at once.
async function readTruth(
  intent: RoleWriteIntent,
  deps: RoleWriteDeps,
  maxVerifyReads: number,
  verifyDelayMs: number,
): Promise<TruthReading> {
  let snapshot: GroupMembershipSnapshot | null = null;
  let verifyError: string | undefined;
  for (let i = 0; i < maxVerifyReads; i++) {
    let s: GroupMembershipSnapshot | null;
    try {
      s = await deps.readMembership();
    } catch (err) {
      verifyError = err instanceof Error ? err.message : String(err);
      if (i < maxVerifyReads - 1) await deps.sleep(verifyDelayMs);
      continue;
    }
    if (s === null) return snapshot ? { snapshot } : { snapshot: null, verifySkipped: 'unverifiable' };
    snapshot = s;
    if (evaluateVerification(intent, s).verified) break;
    if (i < maxVerifyReads - 1) await deps.sleep(verifyDelayMs);
  }
  if (snapshot) return { snapshot };
  return { snapshot: null, verifySkipped: 'read-error', verifyError };
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
  let lastRetryable = false;
  while (attempts < maxWriteAttempts) {
    attempts += 1;
    const r = await deps.postUpdateRoles();
    if (r.ok) {
      postOk = true;
      break;
    }
    lastError = r.error;
    lastRetryable = isRetryableError(r.status, r.networkOrTimeout);
    if (!lastRetryable || attempts >= maxWriteAttempts) break;

    // A timeout does not mean the server-side job died: Hazu support measured a role change whose
    // permission update outlasts the client timeout. Resending re-triggers that heavy job, so check
    // group truth first and stop if the write has already landed. Only a timeout/network failure —
    // a 5xx is an answer, and the measured 5xx-then-landed cases are caught by the final verify.
    if (r.networkOrTimeout) {
      const pre = await readTruth(intent, deps, maxVerifyReads, verifyDelayMs);
      if (pre.snapshot) {
        const v = evaluateVerification(intent, pre.snapshot);
        if (v.verified) {
          return { success: true, postOk: false, verifyRan: true, verified: true, reconciledRole: v.reconciledRole, partial: false, attempts };
        }
      }
    }
    await deps.sleep(backoffMs(attempts - 1));
  }

  // A transport-level failure says nothing about whether the write committed: measured against
  // this endpoint, 500s and timeouts routinely land anyway. So verify those against truth too.
  // A 4xx is excluded — it was rejected at the boundary, and with no evidence it can commit, a
  // read could only ever "confirm" pre-existing state and would mask a malformed request.
  if (!postOk && !lastRetryable) {
    return { success: false, postOk: false, verifyRan: false, verified: false, reconciledRole: null, partial: false, attempts, error: lastError };
  }

  // 2. Verify against group truth, re-reading through cache lag and transient read errors.
  const { snapshot, verifySkipped, verifyError } = await readTruth(intent, deps, maxVerifyReads, verifyDelayMs);
  const skipped = verifyError !== undefined ? { verifySkipped, verifyError } : { verifySkipped };

  // 3. Could not read truth. After a 2xx, trust it and reconcile optimistically to intent; after
  //    a failed write there is nothing to trust, so the failure stands.
  if (snapshot === null) {
    if (!postOk) {
      return { success: false, postOk: false, verifyRan: false, verified: false, reconciledRole: null, partial: false, attempts, error: lastError, ...skipped };
    }
    const optimistic = isRealRole(intent.newRole) ? intent.newRole : null;
    return { success: true, postOk: true, verifyRan: false, verified: false, reconciledRole: optimistic, partial: false, attempts, ...skipped };
  }
  // 4. Decide from truth. Truth outranks the status code in BOTH directions: a 2xx it contradicts
  //    is a failure, and a transport failure it confirms is a success — the write landed anyway.
  const v = evaluateVerification(intent, snapshot);

  if (!postOk) {
    return {
      success: v.verified,
      postOk: false,
      verifyRan: true,
      verified: v.verified,
      // Only reconcile local state off a failed write when truth actually confirms the intent;
      // an unconfirmed failure leaves local state untouched.
      reconciledRole: v.verified ? v.reconciledRole : null,
      partial: v.partial,
      attempts,
      error: v.verified ? undefined : lastError,
    };
  }

  return {
    success: v.verified, // truth was read, so truth decides — the 2xx does not override it
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
