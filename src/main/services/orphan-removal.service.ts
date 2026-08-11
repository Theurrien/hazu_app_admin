import { getDb } from '../database';
import { sendApiRequestGetAclInfo, sendApiRequestRemoveUser } from './hazu-api/api';
import { runOrphanRemoval, isAccountOnAcl, OrphanGrant, OrphanRemovalDeps } from './orphan-removal';
import { AclMember } from './role-write';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function titleFor(table: 'distribution_groups' | 'rooms', id: string): string {
  const row = getDb().prepare(`SELECT title FROM ${table} WHERE id = ?`).get(id) as { title: string } | undefined;
  return row?.title || id;
}

async function readAcl(itemId: string): Promise<AclMember[] | null> {
  try {
    const acl = await sendApiRequestGetAclInfo(itemId);
    return (acl?.data || []) as AclMember[];
  } catch {
    return null;
  }
}

// What would be removed. Reads live ACLs so the confirmation modal can never promise to remove
// a grant that is already gone.
export async function planOrphanRemoval(
  accountId: string,
  groupId: string,
  roomId: string,
): Promise<OrphanGrant[]> {
  const grants: OrphanGrant[] = [];

  const groupAcl = await readAcl(groupId);
  if (groupAcl && isAccountOnAcl(groupAcl, accountId)) {
    grants.push({ kind: 'group', itemId: groupId, title: titleFor('distribution_groups', groupId) });
  }

  const roomAcl = await readAcl(roomId);
  if (roomAcl) {
    const entry = roomAcl.find((m) => (m.authorId || '').trim().toLowerCase() === accountId.trim().toLowerCase());
    if (entry) {
      grants.push({
        kind: 'roomItem',
        itemId: roomId,
        title: titleFor('rooms', roomId),
        aclRole: (entry as { role?: string }).role,
      });
    }
  }

  return grants;
}

// Revoke an orphan account's access to a room, then confirm it against both ACLs.
export async function revokeOrphanAccess(
  accountId: string,
  groupId: string,
  roomId: string,
): Promise<{ success: boolean; error?: string }> {
  const grants = await planOrphanRemoval(accountId, groupId, roomId);

  const deps: OrphanRemovalDeps = {
    deleteFromItem: async (itemId: string) => {
      try {
        const res = await sendApiRequestRemoveUser(itemId, accountId);
        // sendApiRequestRemoveUser swallows its error and returns null on failure.
        if (res === null) return { ok: false, networkOrTimeout: true, error: `DELETE /acl failed for ${itemId}` };
        return { ok: true, networkOrTimeout: false };
      } catch (error: unknown) {
        return {
          ok: false,
          networkOrTimeout: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    readGroupAcl: () => readAcl(groupId),
    readRoomAcl: () => readAcl(roomId),
    sleep,
  };

  const outcome = await runOrphanRemoval({ accountId, groupId, roomId, grants }, deps);

  console.log(
    `[orphan-removal] account=${accountId} room=${roomId} group=${groupId}: ` +
    `success=${outcome.success} deleteOk=${outcome.deleteOk} verifyRan=${outcome.verifyRan} ` +
    `verified=${outcome.verified} surviving=[${outcome.surviving.join(',')}] attempts=${outcome.attempts}` +
    (outcome.error ? ` error=${outcome.error}` : ''),
  );

  // Reconcile local state from truth: the issue row only goes when the access is confirmed gone.
  // Its own try/catch so a SQLite failure cannot flip a real API success.
  if (outcome.success) {
    try {
      getDb()
        .prepare('DELETE FROM membership_issues WHERE uid = ? AND group_id = ? AND room_id = ?')
        .run(accountId, groupId, roomId);
    } catch (err) {
      console.error('[orphan-removal] local reconcile failed for', accountId, roomId, err);
    }
  }

  return { success: outcome.success, error: outcome.error };
}
