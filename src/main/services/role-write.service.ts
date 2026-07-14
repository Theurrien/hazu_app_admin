import axios from 'axios';
import { getDb } from '../database';
import { getApiEndpoint, getApiKey } from './hazu-api/config';
import { sendApiRequestGetAclInfo } from './hazu-api/api';
import { runReliableRoleWrite, RoleWriteDeps, GroupMembershipSnapshot } from './role-write';

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
  const email = (personRow?.email || '').trim().toLowerCase();

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
    if (!groupId || !email) return false;
    const acl = await sendApiRequestGetAclInfo(groupId);
    for (const m of acl?.data || []) {
      if (m.isGroup) continue;
      if ((m.description || '').trim().toLowerCase() === email) return true;
    }
    return false;
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
          return { ok: false, status, networkOrTimeout, error: error.response?.data?.message || error.message };
        }
        return { ok: false, networkOrTimeout: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    readMembership: async (): Promise<GroupMembershipSnapshot | null> => {
      // Cannot verify if a group we need isn't synced locally.
      if (isRealRole(newRole) && !newGroupId) return null;
      if (isRealRole(oldRole) && oldRole !== newRole && !oldGroupId) return null;
      try {
        const inNewGroup = await isMember(newGroupId);
        const inOldGroup = await isMember(oldGroupId);
        return { inNewGroup, inOldGroup };
      } catch {
        return null; // ACL read failure -> cannot verify
      }
    },
    sleep,
  };

  const outcome = await runReliableRoleWrite({ oldRole, newRole }, deps);

  // Reconcile local person_room_assignments from truth, only when the write reached 2xx.
  if (outcome.postOk) {
    if (isRealRole(outcome.reconciledRole)) {
      db.prepare(
        'INSERT OR REPLACE INTO person_room_assignments (person_id, room_id, role, synced_at) VALUES (?, ?, ?, ?)',
      ).run(personId, roomId, outcome.reconciledRole, Date.now());
    } else {
      db.prepare('DELETE FROM person_room_assignments WHERE person_id = ? AND room_id = ?').run(personId, roomId);
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
