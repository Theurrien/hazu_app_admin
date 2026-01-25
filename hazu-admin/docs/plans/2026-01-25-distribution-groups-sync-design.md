# Distribution Groups Sync Design

**Status:** Ready for implementation
**Date:** 2026-01-25

## Overview

Enhance the sync process to fetch Distribution Hazus (sharing groups) from the Hazu API. These are needed for the Assignment workflow to add existing users to rooms with specific roles.

## Background

### Hazu Architecture for Room Assignments

Each room has multiple Distribution Hazus - one per role:

```
Admin Hazu (hz-config-admin)
├── Sharing Config (hz-config-sharing)
│   └── Distribution Hazus (one per room + role)
│       ├── "Entreprise TEST Student"      → tag: hz-share-student-[ROOM_CLASS_ID]
│       ├── "Entreprise TEST Companymentor" → tag: hz-share-companymentor-[ROOM_CLASS_ID]
│       ├── "Entreprise TEST Schoolteacher" → tag: hz-share-schoolteacher-[ROOM_CLASS_ID]
│       └── ...
│
└── User Types Config (hz-config-usertypes)
    └── Role definitions (titles define role names)
        ├── "Student"
        ├── "Companymentor"
        └── ...
```

To assign a user to a room with a specific role, we need the Distribution Hazu ID for that room+role combination.

### Tag Structure

- Distribution groups: `hz-share-{role}-{classId}` (e.g., `hz-share-student-ZXWELTkolFLPwijE5hU9`)
- The `classId` matches the room's `class_id` field (from `hz-config-class-{ID}` tag)

## Database Schema

### New Table: `user_types`

Stores dynamic role definitions (roles vary per root Hazu).

```sql
CREATE TABLE IF NOT EXISTS user_types (
    id TEXT PRIMARY KEY,           -- Hazu ID of the user type item
    name TEXT NOT NULL UNIQUE,     -- Role name (lowercased title, for matching)
    title TEXT NOT NULL,           -- Original title from Hazu
    synced_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usertypes_name ON user_types(name);
```

### New Table: `distribution_groups`

Stores Distribution Hazus for room+role assignment lookup.

```sql
CREATE TABLE IF NOT EXISTS distribution_groups (
    id TEXT PRIMARY KEY,           -- Hazu ID of the distribution group
    title TEXT NOT NULL,           -- e.g., "Entreprise TEST Student"
    room_class_id TEXT NOT NULL,   -- The ID from hz-share-{role}-{ID} tag
    role TEXT NOT NULL,            -- student, companymentor, etc.
    room_id TEXT,                  -- FK to rooms table (matched via class_id)
    tags TEXT DEFAULT '[]',
    raw_data TEXT,
    synced_at INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE INDEX IF NOT EXISTS idx_distgroups_room ON distribution_groups(room_id);
CREATE INDEX IF NOT EXISTS idx_distgroups_role ON distribution_groups(role);
CREATE INDEX IF NOT EXISTS idx_distgroups_class_id ON distribution_groups(room_class_id);
```

## Sync Functions

### `syncUserTypes()`

Fetches role definitions from `hz-config-usertypes` container.

```typescript
async function syncUserTypes(): Promise<void> {
  const db = getDb();

  const adminId = db.prepare("SELECT value FROM settings WHERE key = 'admin_id'")
    .get()?.value;

  if (!adminId) {
    console.log('[SYNC] No admin_id found, skipping user types');
    return;
  }

  const adminChildren = await sendApiRequestList(adminId);
  const userTypesContainer = adminChildren?.find(child =>
    child.snapshot.tags?.includes('hz-config-usertypes')
  );

  if (!userTypesContainer) {
    console.log('[SYNC] No user types container found (hz-config-usertypes)');
    return;
  }

  const userTypes = await sendApiRequestList(userTypesContainer.snapshot.key);
  if (!userTypes) return;

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
}
```

### `syncDistributionGroups()`

Fetches Distribution Hazus from `hz-config-sharing` container.

```typescript
async function syncDistributionGroups(): Promise<void> {
  const db = getDb();

  const adminId = db.prepare("SELECT value FROM settings WHERE key = 'admin_id'")
    .get()?.value;

  if (!adminId) {
    console.log('[SYNC] No admin_id found, skipping distribution groups');
    return;
  }

  // Get valid roles from user_types table
  const validRoles = db.prepare("SELECT name FROM user_types")
    .all()
    .map((row: any) => row.name);

  if (validRoles.length === 0) {
    console.log('[SYNC] No user types found, skipping distribution groups');
    return;
  }

  // Find hz-config-sharing container inside Admin Hazu
  const adminChildren = await sendApiRequestList(adminId);
  const sharingContainer = adminChildren?.find(child =>
    child.snapshot.tags?.includes('hz-config-sharing')
  );

  if (!sharingContainer) {
    console.log('[SYNC] No sharing container found (hz-config-sharing)');
    return;
  }

  console.log('[SYNC] Found sharing container:', sharingContainer.snapshot.key);

  // Fetch Distribution Hazus
  const distGroups = await sendApiRequestList(sharingContainer.snapshot.key);
  if (!distGroups) return;

  console.log(`[SYNC] Found ${distGroups.length} distribution groups`);

  for (const group of distGroups) {
    const tags = group.snapshot.tags || [];
    const parsed = parseShareTag(tags, validRoles);
    if (!parsed) continue;

    // Link to room via class_id
    const room = db.prepare("SELECT id FROM rooms WHERE class_id = ?")
      .get(parsed.classId) as { id: string } | undefined;

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
}

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

## Updated Sync Flow

### `runFullSync()` Order

```typescript
export async function runFullSync(): Promise<SyncProgress> {
  // ... validation ...

  resetProgress();

  try {
    clearOldData();

    // Step 0: Extract admin configuration (admin_id, webhook)
    await syncAdminConfig();

    // Step 1: Sync user types (needed for role validation)
    await syncUserTypes();

    // Step 2: Sync rooms (needed for distribution group linking)
    await syncRooms();

    // Step 3: Sync persons from containers
    await syncPersonsFromContainers();

    // Step 4: Sync distribution groups
    await syncDistributionGroups();

    // ... update last_sync_at ...
  }
}
```

### Updated `clearOldData()`

```typescript
function clearOldData(): void {
  const db = getDb();
  console.log('[SYNC] Clearing old data before sync...');

  db.exec("DELETE FROM person_room_assignments");
  db.exec("DELETE FROM persons");
  db.exec("DELETE FROM rooms");
  db.exec("DELETE FROM distribution_groups");
  db.exec("DELETE FROM user_types");

  console.log('[SYNC] Old data cleared');
}
```

### Updated `SyncProgress` Interface

```typescript
interface SyncProgress {
  status: "idle" | "syncing" | "completed" | "error";
  message: string;
  roomsProcessed: number;
  personsProcessed: number;
  assignmentsProcessed: number;
  distributionGroupsProcessed: number;
  userTypesProcessed: number;
  errors: string[];
}
```

## Usage in Assignment Workflow

To find the Distribution Hazu ID for assigning a user:

```typescript
// Given: roomId and role (e.g., "student")
const distGroup = db.prepare(`
  SELECT id FROM distribution_groups
  WHERE room_id = ? AND role = ?
`).get(roomId, role);

// Use distGroup.id as classId in the add-users API call
```

## API Integration

The synced distribution groups enable the `POST /api-v2-admin/add-users` endpoint:

```json
{
  "users": [
    {
      "userEmail": "john@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "sourceId": "template-id",
      "targetId": "profile-container-id",
      "classIds": [
        {
          "classId": "<distribution_group.id>",
          "userType": "student"
        }
      ]
    }
  ]
}
```

## Files to Modify

1. `src/main/database/schema.sql` - Add new tables
2. `src/main/services/sync.service.ts` - Add sync functions, update flow
3. `src/shared/types.ts` - Add TypeScript interfaces (optional)

## Testing

After implementation:
1. Run sync from Dashboard
2. Check SQLite for `user_types` table populated
3. Check SQLite for `distribution_groups` table with room links
4. Verify `room_id` foreign keys resolve correctly
