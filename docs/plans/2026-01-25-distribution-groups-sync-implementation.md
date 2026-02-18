# Distribution Groups Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add user_types and distribution_groups tables to SQLite, sync them during the main sync process.

**Architecture:** Extend existing sync.service.ts with two new sync functions. User types must sync before distribution groups (for role validation). Distribution groups link to rooms via class_id matching.

**Tech Stack:** TypeScript, better-sqlite3, Electron IPC

---

### Task 1: Add Database Tables

**Files:**
- Modify: `src/main/database/schema.sql:128-152`

**Step 1: Add user_types table after tag_mappings section**

Add before the SETTINGS section (after line 128):

```sql
-- ============================================================================
-- USER TYPES (Dynamic Roles)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    synced_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usertypes_name ON user_types(name);

-- ============================================================================
-- DISTRIBUTION GROUPS (Room + Role Assignment Targets)
-- ============================================================================

CREATE TABLE IF NOT EXISTS distribution_groups (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    room_class_id TEXT NOT NULL,
    role TEXT NOT NULL,
    room_id TEXT,
    tags TEXT DEFAULT '[]',
    raw_data TEXT,
    synced_at INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE INDEX IF NOT EXISTS idx_distgroups_room ON distribution_groups(room_id);
CREATE INDEX IF NOT EXISTS idx_distgroups_role ON distribution_groups(role);
CREATE INDEX IF NOT EXISTS idx_distgroups_class_id ON distribution_groups(room_class_id);
```

**Step 2: Commit**

```bash
git add src/main/database/schema.sql
git commit -m "feat(db): add user_types and distribution_groups tables"
```

---

### Task 2: Update SyncProgress Interface

**Files:**
- Modify: `src/main/services/sync.service.ts:32-48`

**Step 1: Add new counters to SyncProgress interface**

Update the interface at line 32:

```typescript
interface SyncProgress {
  status: "idle" | "syncing" | "completed" | "error";
  message: string;
  roomsProcessed: number;
  personsProcessed: number;
  assignmentsProcessed: number;
  userTypesProcessed: number;
  distributionGroupsProcessed: number;
  errors: string[];
}
```

**Step 2: Update initial state at line 41**

```typescript
let syncProgress: SyncProgress = {
  status: "idle",
  message: "",
  roomsProcessed: 0,
  personsProcessed: 0,
  assignmentsProcessed: 0,
  userTypesProcessed: 0,
  distributionGroupsProcessed: 0,
  errors: [],
};
```

**Step 3: Update resetProgress at line 54**

```typescript
function resetProgress(): void {
  console.log('[SYNC] Starting sync...');
  syncProgress = {
    status: "syncing",
    message: "Starting sync...",
    roomsProcessed: 0,
    personsProcessed: 0,
    assignmentsProcessed: 0,
    userTypesProcessed: 0,
    distributionGroupsProcessed: 0,
    errors: [],
  };
}
```

**Step 4: Commit**

```bash
git add src/main/services/sync.service.ts
git commit -m "feat(sync): add userTypes and distributionGroups progress counters"
```

---

### Task 3: Update clearOldData Function

**Files:**
- Modify: `src/main/services/sync.service.ts:66-78`

**Step 1: Add DELETE statements for new tables**

```typescript
function clearOldData(): void {
  const db = getDb();
  console.log('[SYNC] Clearing old data before sync...');

  // Clear assignments first (foreign key constraint)
  db.exec("DELETE FROM person_room_assignments");

  // Clear persons and rooms
  db.exec("DELETE FROM persons");
  db.exec("DELETE FROM rooms");

  // Clear new tables
  db.exec("DELETE FROM distribution_groups");
  db.exec("DELETE FROM user_types");

  console.log('[SYNC] Old data cleared');
}
```

**Step 2: Commit**

```bash
git add src/main/services/sync.service.ts
git commit -m "feat(sync): clear user_types and distribution_groups on sync"
```

---

### Task 4: Add parseShareTag Helper Function

**Files:**
- Modify: `src/main/services/sync.service.ts` (add after parseAssignmentTag function, around line 385)

**Step 1: Add the helper function**

```typescript
/**
 * Parse hz-share-{role}-{classId} tag
 * @param tags - Array of tags from the Hazu entity
 * @param validRoles - Array of valid role names from user_types table
 * @returns Parsed role and classId, or null if no valid tag found
 */
function parseShareTag(tags: string[], validRoles: string[]): { role: string; classId: string } | null {
  const prefix = "hz-share-";

  for (const tag of tags) {
    if (!tag.startsWith(prefix)) continue;

    const remainder = tag.substring(prefix.length);  // "student-ZXWELTkolFLPwijE5hU9"
    const firstHyphen = remainder.indexOf("-");
    if (firstHyphen === -1) continue;

    const role = remainder.substring(0, firstHyphen);
    const classId = remainder.substring(firstHyphen + 1);

    // Validate role against user_types from DB
    if (!validRoles.includes(role)) continue;

    return { role, classId };
  }

  return null;
}
```

**Step 2: Commit**

```bash
git add src/main/services/sync.service.ts
git commit -m "feat(sync): add parseShareTag helper function"
```

---

### Task 5: Add syncUserTypes Function

**Files:**
- Modify: `src/main/services/sync.service.ts` (add after syncAdminConfig function, around line 561)

**Step 1: Add the sync function**

```typescript
async function syncUserTypes(): Promise<void> {
  const db = getDb();

  const adminIdRow = db.prepare("SELECT value FROM settings WHERE key = 'admin_id'").get() as { value: string } | undefined;
  const adminId = adminIdRow?.value;

  if (!adminId) {
    console.log('[SYNC] No admin_id found, skipping user types');
    return;
  }

  syncProgress.message = "Fetching user types...";

  const adminChildren = await sendApiRequestList(adminId);
  if (!adminChildren) {
    console.log('[SYNC] Failed to fetch admin children for user types');
    return;
  }

  const userTypesContainer = adminChildren.find((child: HazuEntity) =>
    child.snapshot.tags?.includes('hz-config-usertypes')
  );

  if (!userTypesContainer) {
    console.log('[SYNC] No user types container found (hz-config-usertypes)');
    return;
  }

  console.log('[SYNC] Found user types container:', userTypesContainer.snapshot.key);

  const userTypes = await sendApiRequestList(userTypesContainer.snapshot.key);
  if (!userTypes) {
    console.log('[SYNC] Failed to fetch user types');
    return;
  }

  console.log(`[SYNC] Found ${userTypes.length} user types`);

  for (const type of userTypes) {
    const title = stripHtml(type.snapshot.title);
    const name = title.toLowerCase();

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO user_types (id, name, title, synced_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(type.snapshot.key, name, title, Date.now());
    syncProgress.userTypesProcessed++;
  }

  console.log(`[SYNC] Synced ${syncProgress.userTypesProcessed} user types`);
  syncProgress.message = `Synced ${syncProgress.userTypesProcessed} user types...`;
}
```

**Step 2: Commit**

```bash
git add src/main/services/sync.service.ts
git commit -m "feat(sync): add syncUserTypes function"
```

---

### Task 6: Add syncDistributionGroups Function

**Files:**
- Modify: `src/main/services/sync.service.ts` (add after syncUserTypes function)

**Step 1: Add the sync function**

```typescript
async function syncDistributionGroups(): Promise<void> {
  const db = getDb();

  const adminIdRow = db.prepare("SELECT value FROM settings WHERE key = 'admin_id'").get() as { value: string } | undefined;
  const adminId = adminIdRow?.value;

  if (!adminId) {
    console.log('[SYNC] No admin_id found, skipping distribution groups');
    return;
  }

  // Get valid roles from user_types table
  const validRolesRows = db.prepare("SELECT name FROM user_types").all() as Array<{ name: string }>;
  const validRoles = validRolesRows.map(row => row.name);

  if (validRoles.length === 0) {
    console.log('[SYNC] No user types found, skipping distribution groups');
    return;
  }

  syncProgress.message = "Fetching distribution groups...";

  const adminChildren = await sendApiRequestList(adminId);
  if (!adminChildren) {
    console.log('[SYNC] Failed to fetch admin children for distribution groups');
    return;
  }

  const sharingContainer = adminChildren.find((child: HazuEntity) =>
    child.snapshot.tags?.includes('hz-config-sharing')
  );

  if (!sharingContainer) {
    console.log('[SYNC] No sharing container found (hz-config-sharing)');
    return;
  }

  console.log('[SYNC] Found sharing container:', sharingContainer.snapshot.key);

  const distGroups = await sendApiRequestList(sharingContainer.snapshot.key);
  if (!distGroups) {
    console.log('[SYNC] Failed to fetch distribution groups');
    return;
  }

  console.log(`[SYNC] Found ${distGroups.length} distribution groups`);

  for (const group of distGroups) {
    const tags = group.snapshot.tags || [];
    const parsed = parseShareTag(tags, validRoles);
    if (!parsed) continue;

    // Link to room via class_id
    const room = db.prepare("SELECT id FROM rooms WHERE class_id = ?").get(parsed.classId) as { id: string } | undefined;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO distribution_groups
      (id, title, room_class_id, role, room_id, tags, raw_data, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      group.snapshot.key,
      stripHtml(group.snapshot.title),
      parsed.classId,
      parsed.role,
      room?.id || null,
      JSON.stringify(tags),
      JSON.stringify(group.snapshot),
      Date.now()
    );

    syncProgress.distributionGroupsProcessed++;
  }

  console.log(`[SYNC] Synced ${syncProgress.distributionGroupsProcessed} distribution groups`);
  syncProgress.message = `Synced ${syncProgress.distributionGroupsProcessed} distribution groups...`;
}
```

**Step 2: Commit**

```bash
git add src/main/services/sync.service.ts
git commit -m "feat(sync): add syncDistributionGroups function"
```

---

### Task 7: Update runFullSync to Call New Functions

**Files:**
- Modify: `src/main/services/sync.service.ts:563-611`

**Step 1: Add calls to new sync functions and update completion message**

```typescript
export async function runFullSync(): Promise<SyncProgress> {
  if (!isConfigured()) {
    return {
      status: "error",
      message: "API not configured. Please set API key and Root Hazu ID in Settings.",
      roomsProcessed: 0,
      personsProcessed: 0,
      assignmentsProcessed: 0,
      userTypesProcessed: 0,
      distributionGroupsProcessed: 0,
      errors: ["API not configured"],
    };
  }

  resetProgress();

  try {
    // Clear old data before syncing (full refresh)
    clearOldData();

    // Step 0: Extract admin configuration (webhook URL and template ID)
    await syncAdminConfig();

    // Step 1: Sync user types (needed for role validation)
    await syncUserTypes();

    // Step 2: Sync rooms (extracts class_ids from hz-config-class-* tags)
    await syncRooms();

    // Step 3: Sync persons from their containers
    // (also syncs assignments by matching person tags to room class_ids)
    await syncPersonsFromContainers();

    // Step 4: Sync distribution groups (needs rooms for linking)
    await syncDistributionGroups();

    // Update last sync time
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_sync_at', ?)").run(
      Date.now().toString()
    );

    syncProgress.status = "completed";
    syncProgress.message = `Sync completed! Rooms: ${syncProgress.roomsProcessed}, Persons: ${syncProgress.personsProcessed}, Assignments: ${syncProgress.assignmentsProcessed}, User Types: ${syncProgress.userTypesProcessed}, Distribution Groups: ${syncProgress.distributionGroupsProcessed}`;

    return getSyncProgress();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    syncProgress.status = "error";
    syncProgress.message = `Sync failed: ${errorMessage}`;
    syncProgress.errors.push(errorMessage);
    return getSyncProgress();
  }
}
```

**Step 2: Commit**

```bash
git add src/main/services/sync.service.ts
git commit -m "feat(sync): integrate user types and distribution groups into sync flow"
```

---

### Task 8: Manual Testing

**Step 1: Rebuild the app**

```bash
npm run build
```

**Step 2: Start the app**

```bash
npm start
```

**Step 3: Run sync from Dashboard**

- Go to Dashboard
- Click "Sync Now"
- Verify completion message shows user types and distribution groups counts

**Step 4: Verify database contents**

Open SQLite database and check:

```sql
-- Check user_types
SELECT * FROM user_types;

-- Check distribution_groups
SELECT dg.title, dg.role, dg.room_class_id, r.title as room_title
FROM distribution_groups dg
LEFT JOIN rooms r ON dg.room_id = r.id
LIMIT 10;
```

**Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address any issues found during testing"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add database tables | schema.sql |
| 2 | Update SyncProgress interface | sync.service.ts |
| 3 | Update clearOldData | sync.service.ts |
| 4 | Add parseShareTag helper | sync.service.ts |
| 5 | Add syncUserTypes function | sync.service.ts |
| 6 | Add syncDistributionGroups function | sync.service.ts |
| 7 | Update runFullSync | sync.service.ts |
| 8 | Manual testing | - |

Total: 7 code tasks + 1 testing task
