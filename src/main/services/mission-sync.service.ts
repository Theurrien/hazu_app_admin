import { getDb, query, run, get } from '../database';
import { sendApiRequestList } from './hazu-api/api';
import { MissionSyncStatus } from '../../shared/types';

// ============================================================================
// HELPERS
// ============================================================================

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * Parse mission/reflexion names from item description HTML.
 * Looks for <a> tags and extracts the link text.
 */
function parseMissionNames(description: string): Array<{ name: string; isOfficial: boolean }> {
  const results: Array<{ name: string; isOfficial: boolean }> = [];
  const linkRegex = /<a[^>]*href="[^"]*"[^>]*>(?:<strong>)?([^<]+)(?:<\/strong>)?<\/a>/g;
  let match;
  while ((match = linkRegex.exec(description)) !== null) {
    const name = match[1].trim();
    results.push({ name, isOfficial: name.startsWith('MPE') });
  }
  return results;
}

/**
 * Extract lieu de formation from item tags.
 */
function extractLieu(tags: string[]): string | null {
  for (const tag of tags) {
    if (tag === 'entreprise') return 'entreprise';
    if (tag === 'ecole') return 'ecole';
    if (tag === 'cie') return 'cie';
  }
  return null;
}

/**
 * Parse points from description (e.g., "2 Points – ...")
 */
function parsePoints(description: string): number {
  const match = description.match(/(\d+)\s*Point/);
  return match ? parseInt(match[1], 10) : 0;
}

// ============================================================================
// SYNC LOGIC
// ============================================================================

/**
 * Get current mission sync status
 */
export function getMissionSyncStatus(): MissionSyncStatus {
  const row = get<any>('SELECT * FROM mission_sync_status WHERE id = 1');
  if (!row) {
    return { status: 'idle', students_processed: 0, total_students: 0, last_synced_at: null };
  }
  return {
    status: row.status,
    students_processed: row.students_processed,
    total_students: row.total_students,
    last_synced_at: row.last_synced_at,
  };
}

/**
 * Run the mission sync process.
 * Fetches "Le suivi de ma formation" data for each student and parses mission names.
 */
export async function runMissionSync(): Promise<MissionSyncStatus> {
  // Check if already syncing
  const currentStatus = getMissionSyncStatus();
  if (currentStatus.status === 'syncing') {
    console.log('[MISSION SYNC] Already syncing, skipping');
    return currentStatus;
  }

  // Get all students with AFP/CFC colors
  const students = query<{ id: string; icon: string; color: string }>(
    "SELECT id, icon, color FROM persons WHERE person_type = 'student' AND color IN ('#9AD9EA', '#1A237E')"
  );

  console.log(`[MISSION SYNC] Starting sync for ${students.length} students`);

  // Update status to syncing
  run(
    'UPDATE mission_sync_status SET status = ?, students_processed = 0, total_students = ? WHERE id = 1',
    ['syncing', students.length]
  );

  // Clear old mission tracking data (full re-sync each time)
  run('DELETE FROM mission_tracking');

  let processedCount = 0;

  for (const student of students) {
    try {
      await syncStudentMissions(student.id);
    } catch (error) {
      console.error(`[MISSION SYNC] Error syncing student ${student.id}:`, error);
    }

    processedCount++;
    run(
      'UPDATE mission_sync_status SET students_processed = ? WHERE id = 1',
      [processedCount]
    );
  }

  // Update status to idle
  run(
    'UPDATE mission_sync_status SET status = ?, last_synced_at = ? WHERE id = 1',
    ['idle', Date.now()]
  );

  const finalStatus = getMissionSyncStatus();
  console.log(`[MISSION SYNC] Complete. Processed ${processedCount} students.`);
  return finalStatus;
}

/**
 * Sync mission data for a single student.
 * 1. Fetch children of student Hazu
 * 2. Find "Le suivi de ma formation" by title
 * 3. Fetch items inside and parse missions
 * 4. Upsert into mission_tracking
 */
async function syncStudentMissions(studentId: string): Promise<void> {
  // Step 1: Fetch children of the student Hazu
  const children = await sendApiRequestList(studentId);
  if (!children || children.length === 0) return;

  // Step 2: Find "Le suivi de ma formation"
  const suiviHazu = children.find((child: any) => {
    const title = stripHtml(child.snapshot?.title || '');
    return title === 'Le suivi de ma formation';
  });

  if (!suiviHazu) return; // Student doesn't have this Hazu yet

  // Step 3: Fetch all items inside
  const items = await sendApiRequestList(suiviHazu.snapshot.key);
  if (!items || items.length === 0) return;

  // Step 4: Parse and aggregate missions
  const missionMap = new Map<string, {
    name: string;
    isOfficial: boolean;
    lieu: string;
    itemCount: number;
    totalPoints: number;
  }>();

  for (const item of items) {
    const snapshot = item.snapshot;
    if (!snapshot) continue;

    const description = snapshot.description || '';
    const tags = snapshot.tags || [];

    const missions = parseMissionNames(description);
    const lieu = extractLieu(tags);
    if (!lieu) continue;

    const points = parsePoints(description);

    for (const mission of missions) {
      const key = `${mission.name}|${lieu}`;
      const existing = missionMap.get(key);
      if (existing) {
        existing.itemCount++;
        existing.totalPoints += points;
      } else {
        missionMap.set(key, {
          name: mission.name,
          isOfficial: mission.isOfficial,
          lieu,
          itemCount: 1,
          totalPoints: points,
        });
      }
    }
  }

  // Step 5: Insert into mission_tracking
  const db = getDb();
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO mission_tracking
    (person_id, mission_name, is_official, lieu_de_formation, item_count, total_points, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    for (const entry of missionMap.values()) {
      insertStmt.run(
        studentId,
        entry.name,
        entry.isOfficial ? 1 : 0,
        entry.lieu,
        entry.itemCount,
        entry.totalPoints,
        Date.now()
      );
    }
  });

  insertAll();
}
