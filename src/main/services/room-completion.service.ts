import { getDb } from '../database';
import { sendApiRequestList, sendApiRequestRead } from './hazu-api/api';
import { HazuEntity } from './hazu-api/interfaces';
import { completeNewRoom, RoomCompletionResult } from './room-completion';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function setting(key: string): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || '';
}

// The sharing container holds every room×role group. A sync stashes its id; before the first
// sync after this was added, find it under the admin Hazu once and stash it then.
async function sharingContainerId(): Promise<string | null> {
  const stored = setting('sharing_container_id');
  if (stored) return stored;

  const adminId = setting('admin_id');
  if (!adminId) return null;
  const adminChildren = await sendApiRequestList(adminId);
  const container = adminChildren?.find((c: HazuEntity) => c.snapshot.tags?.includes('hz-config-sharing'));
  if (!container) return null;
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sharing_container_id', ?)")
    .run(container.snapshot.key);
  return container.snapshot.key;
}

/**
 * After the create-group webhook returns, give the new local `rooms` row its class id and write
 * its role groups to `distribution_groups`, so assignments to it work — and are verified against
 * group truth — without a full sync. Never throws: whatever could not be found is logged, and
 * the next sync fills it in.
 */
export async function completeAndStoreNewRoom(roomId: string, snapshotTags: string[]): Promise<RoomCompletionResult> {
  const db = getDb();
  const validRoles = (db.prepare('SELECT name FROM user_types').all() as Array<{ name: string }>).map((r) => r.name);

  let result: RoomCompletionResult;
  try {
    const containerId = await sharingContainerId();
    result = await completeNewRoom(roomId, snapshotTags, {
      readRoomTags: async (id) => {
        const data = await sendApiRequestRead(id);
        const tags = data?.snapshot?.tags;
        return Array.isArray(tags) ? tags : null;
      },
      listShareGroups: async () => (containerId ? sendApiRequestList(containerId) : null),
      validRoles,
      sleep,
    });
  } catch (err) {
    result = { classId: null, groups: [], note: `lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  try {
    const now = Date.now();
    const write = db.transaction(() => {
      if (result.classId) {
        db.prepare('UPDATE rooms SET class_id = ? WHERE id = ?').run(result.classId, roomId);
      }
      const ins = db.prepare(`
        INSERT OR REPLACE INTO distribution_groups (id, title, room_class_id, role, room_id, tags, raw_data, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const g of result.groups) {
        ins.run(
          g.node.key,
          (g.node.title || '').replace(/<[^>]*>/g, '').trim(),
          g.classId,
          g.role,
          roomId,
          JSON.stringify(g.node.tags || []),
          JSON.stringify(g.node),
          now,
        );
      }
    });
    write();
  } catch (err) {
    console.error(`[room-completion] room=${roomId}: local write failed:`, err);
  }

  console.log(
    `[room-completion] room=${roomId}: classId=${result.classId ?? 'none'} groups=${result.groups.length}/${validRoles.length}` +
    (result.note ? ` note=${result.note}` : ''),
  );
  return result;
}
