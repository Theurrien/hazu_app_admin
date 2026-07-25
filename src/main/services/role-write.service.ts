import axios from 'axios';
import { getDb } from '../database';
import { getApiEndpoint, getApiKey } from './hazu-api/config';
import { sendApiRequestGetAclInfo } from './hazu-api/api';
import { runReliableRoleWrite, isIdentityInAcl, looksLikeEmail, RoleWriteDeps, GroupMembershipSnapshot } from './role-write';

export interface RoleWriteResult {
  success: boolean;
  verified: boolean;
  reconciledRole: string | null;
  attempts: number;
  error?: string;
}

function isRealRole(role: string | null): boolean {
  return role != null && role !== '_' && role !== '';
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Reliable role write: retry the designated update-user-roles endpoint, verify against the
// role-group ACL (by email, like S1), and reconcile local person_room_assignments from truth.
export async function reliableUpdateUserRole(
  personId: string,
  roomId: string,
  oldRole: string | null,
  newRole: string | null,
): Promise<RoleWriteResult> {
  const db = getDb();

  const adminRow = db.prepare("SELECT value FROM settings WHERE key = 'admin_id'").get() as { value: string } | undefined;
  const templateId = adminRow?.value;
  if (!templateId) {
    return { success: false, verified: false, reconciledRole: null, attempts: 0, error: 'Admin ID not found. Please run sync first.' };
  }

  const personRow = db.prepare('SELECT email FROM persons WHERE id = ?').get(personId) as { email: string | null } | undefined;
  // NOTE: `persons.email` is usually an email but sometimes holds the account UID (a data quirk in
  // Hazu profiles). Keep the raw value — isIdentityInAcl matches it against ACL description OR authorId.
  const emailRaw = (personRow?.email || '').trim();

  const groupIdFor = (role: string | null): string | null => {
    if (!isRealRole(role)) return null;
    const row = db.prepare('SELECT id FROM distribution_groups WHERE room_id = ? AND role = ?').get(roomId, role) as { id: string } | undefined;
    return row?.id ?? null;
  };
  const newGroupId = groupIdFor(newRole);
  const oldGroupId = groupIdFor(oldRole);

  const token = getApiKey();
  const headers = token.length <= 20 ? { token } : { 'x-api-key': token };
  const payload = {
    templateId,
    profileId: personId,
    userTypesInfo: [{ classId: roomId, oldUserType: oldRole || '_', newUserType: newRole || '_' }],
  };

  const isMember = async (groupId: string | null): Promise<boolean> => {
    if (!groupId || !emailRaw) return false;
    const acl = await sendApiRequestGetAclInfo(groupId);
    // Match by email (description) OR account id (authorId) — see isIdentityInAcl.
    return isIdentityInAcl(acl?.data || [], emailRaw);
  };

  const deps: RoleWriteDeps = {
    postUpdateRoles: async () => {
      try {
        await axios.post(`https://${getApiEndpoint()}/api-v2-admin/update-user-roles`, payload, { headers, timeout: 120000 });
        return { ok: true, networkOrTimeout: false };
      } catch (error: unknown) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const networkOrTimeout = !error.response || error.code === 'ECONNABORTED';
          // Full failure detail — the generic message ("Internal server error") is not diagnostic;
          // dump the server's response body and the exact request we sent, for each failed attempt.
          console.error(
            '[role-write] update-user-roles POST failed:',
            'status=', status, 'code=', error.code,
            '\n  body=', JSON.stringify(error.response?.data),
            '\n  sent=', JSON.stringify(payload),
          );
          return { ok: false, status, networkOrTimeout, error: error.response?.data?.message || error.message };
        }
        console.error('[role-write] update-user-roles POST failed (non-axios):', error);
        return { ok: false, networkOrTimeout: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    readMembership: async (): Promise<GroupMembershipSnapshot | null> => {
      // Cannot verify without a local identity to match against role-group ACL entries.
      if (!emailRaw) return null;
      // Cannot verify if a group we need isn't synced locally.
      if (isRealRole(newRole) && !newGroupId) return null;
      if (isRealRole(oldRole) && oldRole !== newRole && !oldGroupId) return null;
      try {
        const inNewGroup = await isMember(newGroupId);
        const inOldGroup = await isMember(oldGroupId);
        // If the local identity isn't a real email and we couldn't match it as an account id in
        // either group, a "not a member" reading is unreliable -> cannot verify, trust the 2xx.
        if (!looksLikeEmail(emailRaw) && !inNewGroup && !inOldGroup) return null;
        return { inNewGroup, inOldGroup };
      } catch {
        return null; // ACL read failure -> cannot verify
      }
    },
    sleep,
  };

  const outcome = await runReliableRoleWrite({ oldRole, newRole }, deps);

  console.log(
    `[role-write] ${personId} @ ${roomId} ${oldRole || '_'}→${newRole || '_'}: ` +
    `success=${outcome.success} postOk=${outcome.postOk} verifyRan=${outcome.verifyRan} ` +
    `verified=${outcome.verified} attempts=${outcome.attempts}` +
    (outcome.error ? ` error=${outcome.error}` : ''),
  );

  // Reconcile local person_room_assignments from truth: after a 2xx, or after a transport-level
  // failure that group truth nonetheless confirms (measured — 500s and timeouts on this endpoint
  // often land anyway). An unconfirmed failure leaves local state untouched.
  if (outcome.postOk || outcome.verified) {
    try {
      if (isRealRole(outcome.reconciledRole)) {
        db.prepare(
          'INSERT OR REPLACE INTO person_room_assignments (person_id, room_id, role, synced_at) VALUES (?, ?, ?, ?)',
        ).run(personId, roomId, outcome.reconciledRole, Date.now());
      } else {
        db.prepare('DELETE FROM person_room_assignments WHERE person_id = ? AND room_id = ?').run(personId, roomId);
      }
    } catch (err) {
      console.error('[role-write] local reconcile failed for', personId, roomId, err);
    }
  }

  return {
    success: outcome.success,
    verified: outcome.verified,
    reconciledRole: outcome.reconciledRole,
    attempts: outcome.attempts,
    error: outcome.error,
  };
}
