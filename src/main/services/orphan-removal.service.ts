import { getDb } from '../database';
import { sendApiRequestGetAclInfo, sendApiRequestRemoveUserChecked } from './hazu-api/api';
import { runOrphanRemoval, findAccountOnAcl, GrantKind, OrphanGrant, OrphanRemovalDeps } from './orphan-removal';
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

const ACL_LABEL: Record<GrantKind, string> = {
  group: 'role group',
  roomItem: 'room item',
};

// What would be removed, plus which of the two ACLs (if any) could not be read. Reads live ACLs
// so the confirmation modal can never promise to remove a grant that is already gone — and so a
// read failure is reported explicitly rather than silently counted as "nothing to remove".
async function planOrphanRemovalInternal(
  accountId: string,
  groupId: string,
  roomId: string,
): Promise<{ grants: OrphanGrant[]; unreadable: GrantKind[] }> {
  const grants: OrphanGrant[] = [];
  const unreadable: GrantKind[] = [];

  const groupAcl = await readAcl(groupId);
  if (groupAcl === null) {
    unreadable.push('group');
  } else if (findAccountOnAcl(groupAcl, accountId)) {
    grants.push({ kind: 'group', itemId: groupId, title: titleFor('distribution_groups', groupId) });
  }

  const roomAcl = await readAcl(roomId);
  if (roomAcl === null) {
    unreadable.push('roomItem');
  } else {
    const entry = findAccountOnAcl(roomAcl, accountId);
    if (entry) {
      grants.push({
        kind: 'roomItem',
        itemId: roomId,
        title: titleFor('rooms', roomId),
        aclRole: (entry as { role?: string }).role,
      });
    }
  }

  return { grants, unreadable };
}

// What would be removed. Reads live ACLs so the confirmation modal can never promise to remove
// a grant that is already gone. Throws if either ACL could not be read — the modal must never be
// handed a plan that silently under-counts a grant because a read failed.
export async function planOrphanRemoval(
  accountId: string,
  groupId: string,
  roomId: string,
): Promise<OrphanGrant[]> {
  const { grants, unreadable } = await planOrphanRemovalInternal(accountId, groupId, roomId);
  if (unreadable.length > 0) {
    throw new Error(`Could not read the ${unreadable.map((k) => ACL_LABEL[k]).join(' and the ')} ACL`);
  }
  return grants;
}

// Revoke an orphan account's access to a room, then confirm it against both ACLs.
export async function revokeOrphanAccess(
  accountId: string,
  groupId: string,
  roomId: string,
): Promise<{ success: boolean; error?: string }> {
  const { grants, unreadable } = await planOrphanRemovalInternal(accountId, groupId, roomId);
  if (unreadable.length > 0) {
    // Cannot confirm what's actually granted — never attempt a delete, and never touch
    // membership_issues, for access we couldn't even read.
    return {
      success: false,
      error: `Could not read the ${unreadable.map((k) => ACL_LABEL[k]).join(' and the ')} ACL — refusing to remove access that could not be confirmed`,
    };
  }

  const deps: OrphanRemovalDeps = {
    // sendApiRequestRemoveUserChecked classifies its own failure (real HTTP status vs.
    // network/timeout) so the pure core's retry predicate can tell a doomed 4xx from a
    // worth-retrying 5xx/network/timeout, instead of every failure looking transient.
    deleteFromItem: (itemId: string) => sendApiRequestRemoveUserChecked(itemId, accountId),
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
