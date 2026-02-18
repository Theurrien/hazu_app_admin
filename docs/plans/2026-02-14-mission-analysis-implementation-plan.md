# Mission Analysis Dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Mission Analysis dashboard page that shows aggregated student mission (MPE) completion data with treemap and heatmap visualizations, filtered by learning place, profession, level, and class.

**Architecture:** Electron main process handles a dedicated mission sync service (separate from the main sync) that fetches "Le suivi de ma formation" data from the Hazu API, parses mission names from HTML descriptions, and stores deduplicated results in SQLite. The React renderer displays the data using ECharts (treemap + heatmap) with adaptive filter controls.

**Tech Stack:** Electron, React, better-sqlite3, ECharts (echarts + echarts-for-react), Tailwind CSS, TypeScript

**Design doc:** `docs/plans/2026-02-14-mission-analysis-dashboard-design.md`

---

### Task 1: Install ECharts dependencies

**Files:**
- Modify: `hazu-admin/package.json`

**Step 1: Install packages**

Run:
```bash
cd hazu-admin && npm install echarts echarts-for-react
```

**Step 2: Verify installation**

Run:
```bash
cd hazu-admin && node -e "require('echarts'); console.log('echarts OK')"
```
Expected: `echarts OK`

**Step 3: Commit**

```bash
git add hazu-admin/package.json hazu-admin/package-lock.json
git commit -m "feat(mission-analysis): add echarts dependencies"
```

---

### Task 2: Database migrations — add icon/color to persons + mission tables

**Files:**
- Modify: `hazu-admin/src/main/database/index.ts` (add migrations in `runMigrations()`)

**Step 1: Add migration for icon/color columns on persons table**

In `hazu-admin/src/main/database/index.ts`, add at the end of `runMigrations()`:

```typescript
  // Migration: Add icon and color columns to persons table (for mission analysis)
  try {
    const personColumns = db.prepare("PRAGMA table_info(persons)").all() as Array<{ name: string }>;
    const hasIcon = personColumns.some(col => col.name === 'icon');
    if (!hasIcon) {
      db.exec("ALTER TABLE persons ADD COLUMN icon TEXT");
      db.exec("ALTER TABLE persons ADD COLUMN color TEXT");
      console.log('Migration: Added icon and color columns to persons table');
    }
  } catch (error) {
    console.error('Migration error (persons icon/color):', error);
  }
```

**Step 2: Add migration for mission_tracking table**

Append to `runMigrations()`:

```typescript
  // Migration: Add mission_tracking table
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mission_tracking'").all();
    if (tables.length === 0) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mission_tracking (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          person_id TEXT NOT NULL,
          mission_name TEXT NOT NULL,
          is_official INTEGER NOT NULL DEFAULT 0,
          lieu_de_formation TEXT NOT NULL,
          item_count INTEGER DEFAULT 1,
          total_points INTEGER DEFAULT 0,
          synced_at INTEGER,
          UNIQUE(person_id, mission_name, lieu_de_formation)
        );
        CREATE INDEX IF NOT EXISTS idx_mission_tracking_person ON mission_tracking(person_id);
        CREATE INDEX IF NOT EXISTS idx_mission_tracking_lieu ON mission_tracking(lieu_de_formation);
        CREATE INDEX IF NOT EXISTS idx_mission_tracking_official ON mission_tracking(is_official);
      `);
      console.log('Migration: Added mission_tracking table');
    }
  } catch (error) {
    console.error('Migration error (mission_tracking):', error);
  }
```

**Step 3: Add migration for mission_sync_status table**

Append to `runMigrations()`:

```typescript
  // Migration: Add mission_sync_status table
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mission_sync_status'").all();
    if (tables.length === 0) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mission_sync_status (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_synced_at INTEGER,
          students_processed INTEGER DEFAULT 0,
          total_students INTEGER DEFAULT 0,
          status TEXT DEFAULT 'idle'
        );
        INSERT INTO mission_sync_status (id, status) VALUES (1, 'idle');
      `);
      console.log('Migration: Added mission_sync_status table');
    }
  } catch (error) {
    console.error('Migration error (mission_sync_status):', error);
  }
```

**Step 4: Also add icon/color to the inline schema**

In `runInlineSchema()`, update the persons CREATE TABLE to include `icon TEXT` and `color TEXT` columns after `role TEXT`:

```sql
    -- Persons
    CREATE TABLE IF NOT EXISTS persons (
        id TEXT PRIMARY KEY,
        email TEXT,
        first_name TEXT,
        last_name TEXT,
        display_name TEXT NOT NULL,
        person_type TEXT NOT NULL,
        role TEXT,
        icon TEXT,
        color TEXT,
        tags TEXT DEFAULT '[]',
        raw_data TEXT,
        synced_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
```

And add the two new tables (mission_tracking and mission_sync_status) at the end of `runInlineSchema()`.

**Step 5: Verify the app starts**

Run:
```bash
cd hazu-admin && npm run build && npm start
```
Expected: App launches without errors. Check console for migration messages.

**Step 6: Commit**

```bash
git add hazu-admin/src/main/database/index.ts
git commit -m "feat(mission-analysis): add database migrations for mission tracking"
```

---

### Task 3: Update main sync to store icon/color on persons

**Files:**
- Modify: `hazu-admin/src/main/services/sync.service.ts` (the `findAndSyncPersonContainers` function, around line 335-351)

**Step 1: Update the INSERT statement for persons**

In `findAndSyncPersonContainers()`, find the `stmt` that does `INSERT OR REPLACE INTO persons`. Currently it inserts these columns:
```
(id, email, first_name, last_name, display_name, person_type, role, tags, raw_data, synced_at)
```

Update to include `icon` and `color`:
```typescript
          const stmt = db.prepare(`
            INSERT OR REPLACE INTO persons (id, email, first_name, last_name, display_name, person_type, role, icon, color, tags, raw_data, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          stmt.run(
            personSnapshot.key,
            userId,
            firstName,
            lastName,
            displayName,
            personType,
            "reader",
            personSnapshot.icon || null,
            personSnapshot.color || null,
            JSON.stringify(personTags),
            JSON.stringify(personSnapshot),
            Date.now()
          );
```

**Step 2: Verify build**

Run:
```bash
cd hazu-admin && npm run build
```
Expected: No TypeScript errors.

**Step 3: Commit**

```bash
git add hazu-admin/src/main/services/sync.service.ts
git commit -m "feat(mission-analysis): store icon and color for persons during sync"
```

---

### Task 4: Add shared types and IPC channels

**Files:**
- Modify: `hazu-admin/src/shared/types.ts`
- Modify: `hazu-admin/src/shared/ipc-channels.ts`

**Step 1: Add mission-related types to `types.ts`**

Append at the end of `hazu-admin/src/shared/types.ts`:

```typescript
// === Mission Analysis Types ===

export type LieuDeFormation = 'entreprise' | 'ecole' | 'cie';

export interface MissionTrackingRow {
  id: number;
  person_id: string;
  mission_name: string;
  is_official: number; // 0 or 1 (SQLite boolean)
  lieu_de_formation: LieuDeFormation;
  item_count: number;
  total_points: number;
  synced_at: number;
}

export interface MissionSyncStatus {
  status: 'idle' | 'syncing' | 'error';
  students_processed: number;
  total_students: number;
  last_synced_at: number | null;
}

export interface MissionDashboardRequest {
  lieu?: LieuDeFormation;
  professions?: string[];
  level?: 'afp' | 'cfc';
  classId?: string;
}

export interface MissionDistributionRow {
  profession_icon: string;
  level: 'AFP' | 'CFC';
  level_color: string;
  mission_count: number;
  student_count: number;
}

export interface MissionDashboardResponse {
  distribution: MissionDistributionRow[];
  summary: {
    total_students: number;
    avg_missions: number;
    avg_reflexions: number;
    max_missions: number;
    total_distinct_missions: number;
  };
}

export interface MissionProfession {
  icon: string;
  student_count: number;
}
```

**Step 2: Add IPC channels to `ipc-channels.ts`**

Add before the closing `} as const;`:

```typescript
  // Mission Analysis
  MISSION_SYNC_START: 'mission:sync:start',
  MISSION_SYNC_STATUS: 'mission:sync:status',
  MISSION_GET_DASHBOARD_DATA: 'mission:dashboard:data',
  MISSION_GET_PROFESSIONS: 'mission:professions:get',
```

**Step 3: Commit**

```bash
git add hazu-admin/src/shared/types.ts hazu-admin/src/shared/ipc-channels.ts
git commit -m "feat(mission-analysis): add shared types and IPC channels"
```

---

### Task 5: Create mission sync service

**Files:**
- Create: `hazu-admin/src/main/services/mission-sync.service.ts`

**Step 1: Create the mission sync service**

Create `hazu-admin/src/main/services/mission-sync.service.ts`:

```typescript
import { getDb, query, run, get, transaction } from '../database';
import { getApiConfig } from './sync.service';
import axios from 'axios';
import { MissionSyncStatus } from '../../shared/types';

// ============================================================================
// HELPERS
// ============================================================================

function getAuthHeaders(): Record<string, string> {
  const config = getApiConfig();
  if (!config) throw new Error('API not configured');
  const key = config.apiKey;
  return key.length <= 20 ? { token: key } : { 'x-api-key': key };
}

function getApiEndpoint(): string {
  const config = getApiConfig();
  if (!config) throw new Error('API not configured');
  const endpoints: Record<string, string> = {
    swiss: 'europe-west6-hazu-ch.cloudfunctions.net',
    io: 'us-central1-blazing-torch-5326.cloudfunctions.net',
    dev: 'europe-west6-hazu-ch-dev.cloudfunctions.net',
  };
  return endpoints[config.environment] || endpoints.swiss;
}

async function fetchChildren(parentId: string): Promise<any[]> {
  const apiPath = getApiEndpoint();
  const response = await axios.get(`https://${apiPath}/readChildren`, {
    headers: getAuthHeaders(),
    params: { parentId },
  });
  const data = response.data;
  return Array.isArray(data) ? data : data.data || [];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * Parse mission/reflexion names from item description HTML.
 * Looks for <a> tags and extracts the link text.
 * Returns array of { name, isOfficial } objects.
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
 * Looks for 'entreprise', 'ecole', or 'cie' in the tags array.
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
  const db = getDb();

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
  const children = await fetchChildren(studentId);

  // Step 2: Find "Le suivi de ma formation"
  const suiviHazu = children.find((child: any) => {
    const title = stripHtml(child.snapshot?.title || '');
    return title === 'Le suivi de ma formation';
  });

  if (!suiviHazu) {
    return; // Student doesn't have this Hazu yet
  }

  // Step 3: Fetch all items inside
  const items = await fetchChildren(suiviHazu.snapshot.key);
  if (items.length === 0) return;

  // Step 4: Parse and aggregate missions
  // Key: `${missionName}|${lieu}` → { name, isOfficial, lieu, itemCount, totalPoints }
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
    if (!lieu) continue; // Skip items without a lieu tag

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
```

**Step 2: Verify build**

Run:
```bash
cd hazu-admin && npm run build
```

**Note:** The `getApiConfig` import may need adjusting. Check if `sync.service.ts` exports `getApiConfig`. If not, read the config from the settings table directly:

```typescript
function getApiConfig(): { apiKey: string; environment: string; rootHazuId: string } | null {
  const apiKey = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['api_key']);
  const env = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['environment']);
  if (!apiKey || !env) return null;
  return { apiKey: apiKey.value, environment: env.value, rootHazuId: '' };
}
```

**Step 3: Commit**

```bash
git add hazu-admin/src/main/services/mission-sync.service.ts
git commit -m "feat(mission-analysis): add mission sync service"
```

---

### Task 6: Add IPC handlers for mission analysis

**Files:**
- Modify: `hazu-admin/src/main/ipc/index.ts`
- Modify: `hazu-admin/src/main/preload.ts`

**Step 1: Add IPC handlers in `index.ts`**

Add at the end of `registerIpcHandlers()`, before the closing brace. Import the mission sync service at the top of the file:

```typescript
import { runMissionSync, getMissionSyncStatus } from '../services/mission-sync.service';
```

Then add the handlers:

```typescript
  // ============================================================================
  // MISSION ANALYSIS
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.MISSION_SYNC_START, async () => {
    try {
      // Run async — don't await (the renderer polls status)
      runMissionSync().catch(err => {
        console.error('[IPC] Mission sync error:', err);
        run('UPDATE mission_sync_status SET status = ? WHERE id = 1', ['error']);
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.MISSION_SYNC_STATUS, async () => {
    return getMissionSyncStatus();
  });

  ipcMain.handle(IPC_CHANNELS.MISSION_GET_PROFESSIONS, async () => {
    return query(`
      SELECT DISTINCT p.icon, COUNT(*) as student_count
      FROM persons p
      WHERE p.person_type = 'student'
        AND p.color IN ('#9AD9EA', '#1A237E')
        AND p.icon IS NOT NULL
      GROUP BY p.icon
      ORDER BY student_count DESC
    `);
  });

  ipcMain.handle(IPC_CHANNELS.MISSION_GET_DASHBOARD_DATA, async (_event, filters: any) => {
    const { lieu, professions, level, classId } = filters || {};

    // Map level to color
    const levelColor = level === 'afp' ? '#9AD9EA' : level === 'cfc' ? '#1A237E' : null;

    // Build the distribution query dynamically (SQLite doesn't support array params well)
    let professionFilter = '';
    const params: any[] = [];

    if (lieu) {
      // Param index 1
    }
    if (professions && professions.length > 0) {
      const placeholders = professions.map(() => '?').join(',');
      professionFilter = `AND p.icon IN (${placeholders})`;
    }

    // Build complete query
    const sql = `
      SELECT
        p.icon AS profession_icon,
        CASE p.color
          WHEN '#9AD9EA' THEN 'AFP'
          WHEN '#1A237E' THEN 'CFC'
        END AS level,
        p.color AS level_color,
        COALESCE(m.mission_count, 0) AS mission_count,
        COUNT(*) AS student_count
      FROM persons p
      LEFT JOIN (
        SELECT
          person_id,
          COUNT(DISTINCT mission_name) AS mission_count
        FROM mission_tracking
        WHERE is_official = 1
          ${lieu ? "AND lieu_de_formation = ?" : ""}
        GROUP BY person_id
      ) m ON m.person_id = p.id
      ${classId ? "INNER JOIN person_room_assignments pra ON pra.person_id = p.id INNER JOIN rooms r ON r.id = pra.room_id AND r.room_type = 'class' AND r.id = ?" : ""}
      WHERE p.person_type = 'student'
        AND p.color IN ('#9AD9EA', '#1A237E')
        ${professionFilter}
        ${levelColor ? "AND p.color = ?" : ""}
      GROUP BY p.icon, p.color, mission_count
      ORDER BY p.icon, p.color, mission_count
    `;

    // Build params array in order
    const queryParams: any[] = [];
    if (lieu) queryParams.push(lieu);
    if (classId) queryParams.push(classId);
    if (professions && professions.length > 0) queryParams.push(...professions);
    if (levelColor) queryParams.push(levelColor);

    const distribution = query(sql, queryParams);

    // Summary stats
    const summaryResult = query<any>(`
      SELECT
        COUNT(DISTINCT p.id) as total_students,
        MAX(COALESCE(m.mc, 0)) as max_missions
      FROM persons p
      LEFT JOIN (
        SELECT person_id, COUNT(DISTINCT mission_name) as mc
        FROM mission_tracking WHERE is_official = 1
        ${lieu ? "AND lieu_de_formation = ?" : ""}
        GROUP BY person_id
      ) m ON m.person_id = p.id
      WHERE p.person_type = 'student'
        AND p.color IN ('#9AD9EA', '#1A237E')
    `, lieu ? [lieu] : []);

    const reflexionResult = query<any>(`
      SELECT COUNT(DISTINCT mission_name) as total
      FROM mission_tracking WHERE is_official = 0
      ${lieu ? "AND lieu_de_formation = ?" : ""}
    `, lieu ? [lieu] : []);

    const totalStudents = summaryResult[0]?.total_students || 0;
    const maxMissions = summaryResult[0]?.max_missions || 0;

    // Calculate averages from distribution
    let totalMissionCount = 0;
    let studentSum = 0;
    for (const row of distribution) {
      totalMissionCount += (row as any).mission_count * (row as any).student_count;
      studentSum += (row as any).student_count;
    }

    return {
      distribution,
      summary: {
        total_students: totalStudents,
        avg_missions: studentSum > 0 ? Math.round((totalMissionCount / studentSum) * 10) / 10 : 0,
        avg_reflexions: 0, // Simplified for v1
        max_missions: maxMissions,
        total_distinct_missions: reflexionResult[0]?.total || 0,
      },
    };
  });
```

**Step 2: Update preload.ts**

Add the new IPC channels to the preload constants AND the electronAPI bridge. Also update the Window type declaration.

In the `IPC_CHANNELS` constant at the top:
```typescript
  MISSION_SYNC_START: 'mission:sync:start',
  MISSION_SYNC_STATUS: 'mission:sync:status',
  MISSION_GET_DASHBOARD_DATA: 'mission:dashboard:data',
  MISSION_GET_PROFESSIONS: 'mission:professions:get',
```

In the `contextBridge.exposeInMainWorld('electronAPI', { ... })`:
```typescript
  // Mission Analysis
  missionSyncStart: () =>
    ipcRenderer.invoke(IPC_CHANNELS.MISSION_SYNC_START),
  missionSyncStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.MISSION_SYNC_STATUS),
  missionGetDashboardData: (filters: any) =>
    ipcRenderer.invoke(IPC_CHANNELS.MISSION_GET_DASHBOARD_DATA, filters),
  missionGetProfessions: () =>
    ipcRenderer.invoke(IPC_CHANNELS.MISSION_GET_PROFESSIONS),
```

In the Window type declaration:
```typescript
      missionSyncStart: () => Promise<{ success: boolean; error?: string }>;
      missionSyncStatus: () => Promise<{
        status: 'idle' | 'syncing' | 'error';
        students_processed: number;
        total_students: number;
        last_synced_at: number | null;
      }>;
      missionGetDashboardData: (filters: any) => Promise<any>;
      missionGetProfessions: () => Promise<Array<{ icon: string; student_count: number }>>;
```

**Step 3: Verify build**

Run:
```bash
cd hazu-admin && npm run build
```

**Step 4: Commit**

```bash
git add hazu-admin/src/main/ipc/index.ts hazu-admin/src/main/preload.ts
git commit -m "feat(mission-analysis): add IPC handlers and preload bridge"
```

---

### Task 7: Add page routing and sidebar navigation

**Files:**
- Modify: `hazu-admin/src/renderer/App.tsx`
- Modify: `hazu-admin/src/renderer/components/layout/Sidebar.tsx`
- Create: `hazu-admin/src/renderer/pages/MissionAnalysisPage.tsx` (placeholder)

**Step 1: Create placeholder page**

Create `hazu-admin/src/renderer/pages/MissionAnalysisPage.tsx`:

```tsx
import React from 'react';

function MissionAnalysisPage() {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--hazu-text)' }}>
        Mission Analysis
      </h2>
      <p style={{ color: 'var(--hazu-text-muted)' }}>Coming soon...</p>
    </div>
  );
}

export default MissionAnalysisPage;
```

**Step 2: Update App.tsx**

Add import:
```typescript
import MissionAnalysisPage from './pages/MissionAnalysisPage';
```

Update `Page` type:
```typescript
type Page = 'dashboard' | 'rooms' | 'persons' | 'matrix' | 'import' | 'missions' | 'settings';
```

Add case in `renderPage()`:
```typescript
      case 'missions':
        return <MissionAnalysisPage />;
```

**Step 3: Update Sidebar.tsx**

Add import:
```typescript
import { ..., faBullseye } from '@fortawesome/free-solid-svg-icons';
```

Update the `Page` type to include `'missions'`.

Add nav item after `import` entry:
```typescript
  { id: 'missions', label: 'Missions', icon: faBullseye },
```

**Step 4: Verify the page renders**

Run:
```bash
cd hazu-admin && npm run dev
```
Expected: Click "Missions" in sidebar → shows "Mission Analysis" placeholder.

**Step 5: Commit**

```bash
git add hazu-admin/src/renderer/pages/MissionAnalysisPage.tsx hazu-admin/src/renderer/App.tsx hazu-admin/src/renderer/components/layout/Sidebar.tsx
git commit -m "feat(mission-analysis): add page routing and sidebar navigation"
```

---

### Task 8: Build MissionSyncButton component

**Files:**
- Create: `hazu-admin/src/renderer/components/mission-analysis/MissionSyncButton.tsx`

**Step 1: Create the sync button component**

Create `hazu-admin/src/renderer/components/mission-analysis/MissionSyncButton.tsx`:

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSync } from '@fortawesome/free-solid-svg-icons';

interface MissionSyncButtonProps {
  onSyncComplete: () => void;
}

export function MissionSyncButton({ onSyncComplete }: MissionSyncButtonProps) {
  const [status, setStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [lastSynced, setLastSynced] = useState<number | null>(null);

  // Poll sync status
  const pollStatus = useCallback(async () => {
    const result = await window.electronAPI.missionSyncStatus();
    setStatus(result.status);
    setProgress({ processed: result.students_processed, total: result.total_students });
    setLastSynced(result.last_synced_at);
    return result.status;
  }, []);

  // Load initial status
  useEffect(() => {
    pollStatus();
  }, [pollStatus]);

  // Poll while syncing
  useEffect(() => {
    if (status !== 'syncing') return;
    const interval = setInterval(async () => {
      const currentStatus = await pollStatus();
      if (currentStatus !== 'syncing') {
        clearInterval(interval);
        onSyncComplete();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [status, pollStatus, onSyncComplete]);

  const handleSync = async () => {
    setStatus('syncing');
    setProgress({ processed: 0, total: 0 });
    await window.electronAPI.missionSyncStart();
  };

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}, ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-3">
      {status === 'syncing' ? (
        <span className="text-sm" style={{ color: 'var(--hazu-text-muted)' }}>
          <FontAwesomeIcon icon={faSync} spin className="mr-2" />
          Syncing {progress.processed}/{progress.total} students...
        </span>
      ) : (
        <>
          {lastSynced && (
            <span className="text-xs" style={{ color: 'var(--hazu-text-muted)' }}>
              Last: {formatDate(lastSynced)}
            </span>
          )}
          <button
            onClick={handleSync}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              backgroundColor: status === 'error' ? '#FEE2E2' : 'var(--hazu-bg)',
              color: status === 'error' ? '#DC2626' : 'var(--hazu-primary)',
              border: '1px solid var(--hazu-border)',
            }}
          >
            <FontAwesomeIcon icon={faSync} />
            {status === 'error' ? 'Retry Sync' : 'Sync'}
          </button>
        </>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add hazu-admin/src/renderer/components/mission-analysis/MissionSyncButton.tsx
git commit -m "feat(mission-analysis): add MissionSyncButton component"
```

---

### Task 9: Build MissionFilterBar component

**Files:**
- Create: `hazu-admin/src/renderer/components/mission-analysis/MissionFilterBar.tsx`

**Step 1: Create the filter bar component**

Create `hazu-admin/src/renderer/components/mission-analysis/MissionFilterBar.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { IconDefinition, findIconDefinition, IconLookup } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { library } from '@fortawesome/fontawesome-svg-core';

// Register all solid icons so we can look them up dynamically
library.add(fas);

type LieuDeFormation = 'entreprise' | 'ecole' | 'cie';

interface MissionFilterBarProps {
  lieu: LieuDeFormation | null;
  onLieuChange: (lieu: LieuDeFormation | null) => void;
  selectedProfessions: Set<string>;
  onToggleProfession: (icon: string) => void;
  level: 'afp' | 'cfc' | null;
  onLevelChange: (level: 'afp' | 'cfc' | null) => void;
  classId: string | null;
  onClassChange: (classId: string | null) => void;
  classes: Array<{ id: string; title: string }>;
  professions: Array<{ icon: string; student_count: number }>;
}

function resolveIcon(faClass: string): IconLookup | null {
  // Convert "fa-utensils" to { prefix: 'fas', iconName: 'utensils' }
  const name = faClass.replace(/^fa-/, '');
  try {
    const def = findIconDefinition({ prefix: 'fas', iconName: name as any });
    return def ? { prefix: 'fas', iconName: name as any } : null;
  } catch {
    return null;
  }
}

export function MissionFilterBar({
  lieu, onLieuChange,
  selectedProfessions, onToggleProfession,
  level, onLevelChange,
  classId, onClassChange,
  classes, professions,
}: MissionFilterBarProps) {

  const lieuOptions: { value: LieuDeFormation; label: string }[] = [
    { value: 'entreprise', label: 'Entreprise' },
    { value: 'ecole', label: 'École' },
    { value: 'cie', label: 'CIE' },
  ];

  return (
    <div className="space-y-3">
      {/* Row 1: Lieu de formation */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider w-24" style={{ color: 'var(--hazu-text-muted)' }}>
          Lieu
        </span>
        <div className="flex gap-1">
          {lieuOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => onLieuChange(lieu === opt.value ? null : opt.value)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: lieu === opt.value ? 'var(--hazu-primary)' : 'var(--hazu-bg)',
                color: lieu === opt.value ? '#fff' : 'var(--hazu-text)',
                border: '1px solid var(--hazu-border)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: Profession icons + Level + Class */}
      <div className="flex items-center gap-4">
        {/* Professions */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider w-24" style={{ color: 'var(--hazu-text-muted)' }}>
            Profession
          </span>
          <div className="flex gap-1">
            {professions.map(prof => {
              const iconLookup = resolveIcon(prof.icon);
              const isActive = selectedProfessions.has(prof.icon);
              return (
                <button
                  key={prof.icon}
                  onClick={() => onToggleProfession(prof.icon)}
                  className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
                  style={{
                    backgroundColor: isActive ? 'var(--hazu-primary)' : 'var(--hazu-bg)',
                    color: isActive ? '#fff' : 'var(--hazu-text)',
                    border: '1px solid var(--hazu-border)',
                  }}
                  title={`${prof.icon} (${prof.student_count} students)`}
                >
                  {iconLookup ? (
                    <FontAwesomeIcon icon={iconLookup as any} className="text-sm" />
                  ) : (
                    <span className="text-xs">?</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Level */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--hazu-text-muted)' }}>
            Level
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => onLevelChange(level === 'afp' ? null : 'afp')}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: level === 'afp' ? '#9AD9EA' : 'var(--hazu-bg)',
                color: level === 'afp' ? '#1a1a1a' : 'var(--hazu-text)',
                border: '1px solid var(--hazu-border)',
              }}
            >
              AFP
            </button>
            <button
              onClick={() => onLevelChange(level === 'cfc' ? null : 'cfc')}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: level === 'cfc' ? '#1A237E' : 'var(--hazu-bg)',
                color: level === 'cfc' ? '#fff' : 'var(--hazu-text)',
                border: '1px solid var(--hazu-border)',
              }}
            >
              CFC
            </button>
          </div>
        </div>

        {/* Class dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--hazu-text-muted)' }}>
            Class
          </span>
          <select
            value={classId || ''}
            onChange={(e) => onClassChange(e.target.value || null)}
            className="px-3 py-1.5 rounded-lg text-sm border"
            style={{
              backgroundColor: 'var(--hazu-bg)',
              color: 'var(--hazu-text)',
              borderColor: 'var(--hazu-border)',
            }}
          >
            <option value="">All classes</option>
            {classes.map(c => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add hazu-admin/src/renderer/components/mission-analysis/MissionFilterBar.tsx
git commit -m "feat(mission-analysis): add MissionFilterBar component"
```

---

### Task 10: Build MissionTreemap component

**Files:**
- Create: `hazu-admin/src/renderer/components/mission-analysis/MissionTreemap.tsx`

**Step 1: Create the treemap component**

Create `hazu-admin/src/renderer/components/mission-analysis/MissionTreemap.tsx`:

```tsx
import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

interface DistributionRow {
  profession_icon: string;
  level: 'AFP' | 'CFC';
  level_color: string;
  mission_count: number;
  student_count: number;
}

interface MissionTreemapProps {
  data: DistributionRow[];
}

export function MissionTreemap({ data }: MissionTreemapProps) {
  const option = useMemo(() => {
    // Group by profession → level → mission count
    const professionMap = new Map<string, Map<string, Array<{ mission_count: number; student_count: number }>>>();

    for (const row of data) {
      if (!professionMap.has(row.profession_icon)) {
        professionMap.set(row.profession_icon, new Map());
      }
      const levelMap = professionMap.get(row.profession_icon)!;
      if (!levelMap.has(row.level)) {
        levelMap.set(row.level, []);
      }
      levelMap.get(row.level)!.push({
        mission_count: row.mission_count,
        student_count: row.student_count,
      });
    }

    const treemapData = Array.from(professionMap.entries()).map(([icon, levelMap]) => ({
      name: icon,
      children: Array.from(levelMap.entries()).map(([level, entries]) => ({
        name: level,
        children: entries.map(e => ({
          name: `${e.mission_count} MPE`,
          value: e.student_count,
        })),
      })),
    }));

    return {
      tooltip: {
        formatter: (info: any) => {
          const { treePathInfo, value } = info;
          if (treePathInfo.length === 4) {
            // Leaf: mission count level
            const profession = treePathInfo[1]?.name || '';
            const level = treePathInfo[2]?.name || '';
            const mpe = treePathInfo[3]?.name || '';
            return `<strong>${profession}</strong> ${level}<br/>${mpe}: ${value} students`;
          }
          return `${info.name}: ${value || ''} students`;
        },
      },
      series: [{
        type: 'treemap',
        data: treemapData,
        width: '100%',
        height: '100%',
        roam: false,
        nodeClick: 'zoomToNode',
        breadcrumb: {
          show: true,
          top: 5,
          left: 10,
        },
        levels: [
          {
            // Level 0: profession
            itemStyle: {
              borderColor: '#fff',
              borderWidth: 3,
              gapWidth: 3,
            },
            upperLabel: {
              show: true,
              height: 30,
              color: '#333',
              fontWeight: 'bold',
              fontSize: 14,
            },
          },
          {
            // Level 1: AFP / CFC
            itemStyle: {
              borderColor: '#fff',
              borderWidth: 2,
              gapWidth: 2,
            },
            upperLabel: {
              show: true,
              height: 24,
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 12,
            },
            colorMappingBy: 'value',
            color: ['#9AD9EA', '#1A237E'],
          },
          {
            // Level 2: mission count leaves
            itemStyle: {
              borderColor: 'rgba(255,255,255,0.5)',
              borderWidth: 1,
              gapWidth: 1,
            },
            label: {
              show: true,
              formatter: '{b}\n{c}',
              fontSize: 11,
              color: '#fff',
            },
          },
        ],
      }],
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-96" style={{ color: 'var(--hazu-text-muted)' }}>
        No data available. Run a sync first.
      </div>
    );
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: '500px', width: '100%' }}
      notMerge
    />
  );
}
```

**Step 2: Commit**

```bash
git add hazu-admin/src/renderer/components/mission-analysis/MissionTreemap.tsx
git commit -m "feat(mission-analysis): add MissionTreemap component"
```

---

### Task 11: Build MissionHeatmap component

**Files:**
- Create: `hazu-admin/src/renderer/components/mission-analysis/MissionHeatmap.tsx`

**Step 1: Create the heatmap component**

Create `hazu-admin/src/renderer/components/mission-analysis/MissionHeatmap.tsx`:

```tsx
import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

interface DistributionRow {
  profession_icon: string;
  level: 'AFP' | 'CFC';
  level_color: string;
  mission_count: number;
  student_count: number;
}

interface MissionHeatmapProps {
  data: DistributionRow[];
}

export function MissionHeatmap({ data }: MissionHeatmapProps) {
  const option = useMemo(() => {
    if (data.length === 0) return {};

    // Build Y-axis labels: unique "icon LEVEL" combinations
    const yLabels: string[] = [];
    const ySet = new Set<string>();
    for (const row of data) {
      const label = `${row.profession_icon} ${row.level}`;
      if (!ySet.has(label)) {
        ySet.add(label);
        yLabels.push(label);
      }
    }

    // Find max mission count for X-axis
    const maxMissions = Math.max(...data.map(r => r.mission_count), 0);
    const xLabels = Array.from({ length: maxMissions + 1 }, (_, i) => String(i));

    // Build heatmap data: [xIndex, yIndex, value]
    const heatmapData: number[][] = [];
    let maxValue = 0;

    for (const row of data) {
      const yLabel = `${row.profession_icon} ${row.level}`;
      const yIndex = yLabels.indexOf(yLabel);
      const xIndex = row.mission_count;
      heatmapData.push([xIndex, yIndex, row.student_count]);
      maxValue = Math.max(maxValue, row.student_count);
    }

    return {
      tooltip: {
        position: 'top',
        formatter: (params: any) => {
          const [x, y, val] = params.data;
          return `<strong>${yLabels[y]}</strong><br/>${x} missions: ${val} students`;
        },
      },
      grid: {
        top: 30,
        bottom: 60,
        left: 160,
        right: 40,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        name: 'Missions completed',
        nameLocation: 'center',
        nameGap: 35,
        splitArea: { show: true },
      },
      yAxis: {
        type: 'category',
        data: yLabels,
        splitArea: { show: true },
        axisLabel: {
          fontSize: 12,
          fontWeight: 'bold',
        },
      },
      visualMap: {
        min: 0,
        max: maxValue || 1,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        top: 0,
        inRange: {
          color: ['#f0f0f0', '#9AD9EA', '#1A237E'],
        },
      },
      series: [{
        type: 'heatmap',
        data: heatmapData,
        label: {
          show: true,
          formatter: (params: any) => {
            const val = params.data[2];
            return val > 0 ? String(val) : '';
          },
          fontSize: 11,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      }],
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-96" style={{ color: 'var(--hazu-text-muted)' }}>
        No data available. Run a sync first.
      </div>
    );
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: Math.max(300, data.length * 40 + 120) + 'px', width: '100%' }}
      notMerge
    />
  );
}
```

**Step 2: Commit**

```bash
git add hazu-admin/src/renderer/components/mission-analysis/MissionHeatmap.tsx
git commit -m "feat(mission-analysis): add MissionHeatmap component"
```

---

### Task 12: Build MissionSummaryBar component

**Files:**
- Create: `hazu-admin/src/renderer/components/mission-analysis/MissionSummaryBar.tsx`

**Step 1: Create the summary bar component**

Create `hazu-admin/src/renderer/components/mission-analysis/MissionSummaryBar.tsx`:

```tsx
import React from 'react';

interface MissionSummaryBarProps {
  totalStudents: number;
  avgMissions: number;
  maxMissions: number;
}

export function MissionSummaryBar({ totalStudents, avgMissions, maxMissions }: MissionSummaryBarProps) {
  return (
    <div
      className="flex items-center gap-6 px-4 py-2 rounded-lg text-sm"
      style={{
        backgroundColor: 'var(--hazu-bg)',
        color: 'var(--hazu-text-muted)',
        border: '1px solid var(--hazu-border)',
      }}
    >
      <span><strong>{totalStudents}</strong> students</span>
      <span><strong>{avgMissions}</strong> avg missions</span>
      <span><strong>{maxMissions}</strong> max missions</span>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add hazu-admin/src/renderer/components/mission-analysis/MissionSummaryBar.tsx
git commit -m "feat(mission-analysis): add MissionSummaryBar component"
```

---

### Task 13: Wire up MissionAnalysisPage with all components

**Files:**
- Modify: `hazu-admin/src/renderer/pages/MissionAnalysisPage.tsx`

**Step 1: Replace placeholder with full page**

Replace the contents of `hazu-admin/src/renderer/pages/MissionAnalysisPage.tsx`:

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTableCells, faChartPie } from '@fortawesome/free-solid-svg-icons';
import { MissionSyncButton } from '../components/mission-analysis/MissionSyncButton';
import { MissionFilterBar } from '../components/mission-analysis/MissionFilterBar';
import { MissionTreemap } from '../components/mission-analysis/MissionTreemap';
import { MissionHeatmap } from '../components/mission-analysis/MissionHeatmap';
import { MissionSummaryBar } from '../components/mission-analysis/MissionSummaryBar';

type ViewMode = 'treemap' | 'heatmap';
type LieuDeFormation = 'entreprise' | 'ecole' | 'cie';

function MissionAnalysisPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('treemap');

  // Filter state
  const [lieu, setLieu] = useState<LieuDeFormation | null>(null);
  const [selectedProfessions, setSelectedProfessions] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState<'afp' | 'cfc' | null>(null);
  const [classId, setClassId] = useState<string | null>(null);

  // Data state
  const [professions, setProfessions] = useState<Array<{ icon: string; student_count: number }>>([]);
  const [classes, setClasses] = useState<Array<{ id: string; title: string }>>([]);
  const [distribution, setDistribution] = useState<any[]>([]);
  const [summary, setSummary] = useState({ total_students: 0, avg_missions: 0, max_missions: 0 });

  // Load filter options
  useEffect(() => {
    window.electronAPI.missionGetProfessions().then(setProfessions);
    window.electronAPI.getRooms('class').then(rooms => {
      setClasses(rooms.map((r: any) => ({ id: r.id, title: r.title })));
    });
  }, []);

  // Fetch dashboard data when filters change
  const fetchData = useCallback(async () => {
    const filters: any = {};
    if (lieu) filters.lieu = lieu;
    if (selectedProfessions.size > 0) filters.professions = Array.from(selectedProfessions);
    if (level) filters.level = level;
    if (classId) filters.classId = classId;

    const result = await window.electronAPI.missionGetDashboardData(filters);
    setDistribution(result.distribution || []);
    setSummary(result.summary || { total_students: 0, avg_missions: 0, max_missions: 0 });
  }, [lieu, selectedProfessions, level, classId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleProfession = (icon: string) => {
    setSelectedProfessions(prev => {
      const next = new Set(prev);
      if (next.has(icon)) {
        next.delete(icon);
      } else {
        next.add(icon);
      }
      return next;
    });
  };

  const handleSyncComplete = () => {
    // Reload professions and data after sync
    window.electronAPI.missionGetProfessions().then(setProfessions);
    fetchData();
  };

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold" style={{ color: 'var(--hazu-text)' }}>
          Mission Analysis
        </h2>
        <MissionSyncButton onSyncComplete={handleSyncComplete} />
      </div>

      {/* Filter bar */}
      <div
        className="rounded-xl p-4"
        style={{
          backgroundColor: 'var(--hazu-card-bg)',
          border: '1px solid var(--hazu-border)',
        }}
      >
        <MissionFilterBar
          lieu={lieu}
          onLieuChange={setLieu}
          selectedProfessions={selectedProfessions}
          onToggleProfession={handleToggleProfession}
          level={level}
          onLevelChange={setLevel}
          classId={classId}
          onClassChange={setClassId}
          classes={classes}
          professions={professions}
        />
      </div>

      {/* View toggle + Chart */}
      <div
        className="rounded-xl p-4"
        style={{
          backgroundColor: 'var(--hazu-card-bg)',
          border: '1px solid var(--hazu-border)',
        }}
      >
        {/* Toggle buttons */}
        <div className="flex justify-end gap-1 mb-3">
          <button
            onClick={() => setViewMode('treemap')}
            className="p-2 rounded-lg transition-colors"
            style={{
              backgroundColor: viewMode === 'treemap' ? 'var(--hazu-primary)' : 'transparent',
              color: viewMode === 'treemap' ? '#fff' : 'var(--hazu-text-muted)',
            }}
            title="Treemap view"
          >
            <FontAwesomeIcon icon={faChartPie} />
          </button>
          <button
            onClick={() => setViewMode('heatmap')}
            className="p-2 rounded-lg transition-colors"
            style={{
              backgroundColor: viewMode === 'heatmap' ? 'var(--hazu-primary)' : 'transparent',
              color: viewMode === 'heatmap' ? '#fff' : 'var(--hazu-text-muted)',
            }}
            title="Heatmap view"
          >
            <FontAwesomeIcon icon={faTableCells} />
          </button>
        </div>

        {/* Chart */}
        {viewMode === 'treemap' ? (
          <MissionTreemap data={distribution} />
        ) : (
          <MissionHeatmap data={distribution} />
        )}
      </div>

      {/* Summary bar */}
      <MissionSummaryBar
        totalStudents={summary.total_students}
        avgMissions={summary.avg_missions}
        maxMissions={summary.max_missions}
      />
    </div>
  );
}

export default MissionAnalysisPage;
```

**Step 2: Verify the full page works**

Run:
```bash
cd hazu-admin && npm run dev
```
Expected: Navigate to Missions page. See filter bar, empty chart with "No data" message, sync button. Click sync, wait for it to complete, see data populate.

**Step 3: Commit**

```bash
git add hazu-admin/src/renderer/pages/MissionAnalysisPage.tsx
git commit -m "feat(mission-analysis): wire up full MissionAnalysisPage"
```

---

### Task 14: Test end-to-end and fix issues

**Step 1: Build and launch**

Run:
```bash
cd hazu-admin && npm run build && npm start
```

**Step 2: Run main sync first**

Go to Dashboard → Sync to populate persons and rooms data (needed for icon/color migration to take effect on existing data).

**Step 3: Navigate to Missions**

- Verify filter bar shows profession icons and class dropdown
- Click Sync button
- Watch progress indicator
- Verify treemap populates with data
- Toggle to heatmap view
- Test filters: lieu, profession, level, class
- Verify summary bar shows correct stats

**Step 4: Fix any issues encountered**

Common issues to watch for:
- `getApiConfig` import path — may need to read from settings table directly
- `{ data: [...] }` vs `[...]` response format from API — `fetchChildren` in mission-sync.service.ts handles both
- Font Awesome icon resolution — check if `library.add(fas)` works with the installed FA version
- ECharts tree level colors — the AFP/CFC color mapping may need adjustment in the treemap `levels` config

**Step 5: Commit fixes**

```bash
git add -A
git commit -m "fix(mission-analysis): end-to-end testing fixes"
```

---

## Summary of All Tasks

| # | Task | Files | Type |
|---|---|---|---|
| 1 | Install ECharts | package.json | dependency |
| 2 | Database migrations | database/index.ts | backend |
| 3 | Update main sync (icon/color) | sync.service.ts | backend |
| 4 | Shared types + IPC channels | types.ts, ipc-channels.ts | shared |
| 5 | Mission sync service | mission-sync.service.ts | backend (new) |
| 6 | IPC handlers + preload | ipc/index.ts, preload.ts | backend |
| 7 | Page routing + sidebar | App.tsx, Sidebar.tsx | frontend |
| 8 | MissionSyncButton | MissionSyncButton.tsx | frontend (new) |
| 9 | MissionFilterBar | MissionFilterBar.tsx | frontend (new) |
| 10 | MissionTreemap | MissionTreemap.tsx | frontend (new) |
| 11 | MissionHeatmap | MissionHeatmap.tsx | frontend (new) |
| 12 | MissionSummaryBar | MissionSummaryBar.tsx | frontend (new) |
| 13 | Wire up page | MissionAnalysisPage.tsx | frontend |
| 14 | End-to-end testing | various | integration |

**Dependency order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → (8,9,10,11,12 in parallel) → 13 → 14
