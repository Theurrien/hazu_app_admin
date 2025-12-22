/**
 * Sync Service - Hazu → SQLite
 *
 * Fetches rooms and persons from Hazu API and stores them in SQLite.
 */

import { getDb, run } from "../database";
import { sendApiRequestList, sendApiRequestGetAclInfo } from "./hazu-api/api";
import { getRootHazuId, isConfigured } from "./hazu-api/config";
import { HazuEntity } from "./hazu-api/interfaces";

// Tag patterns for identifying entity types
const ROOM_TAG_PATTERNS = {
  state: "hz-config-room-state",
  class: "hz-config-room-class",
  enterprise: "hz-config-room-entreprise",
  cie: "hz-config-room-cie",
} as const;

const PERSON_TAG_PATTERNS = {
  student: "hz-config-profile-student",
  companymentor: "hz-config-profile-companymentor",
  schoolteacher: "hz-config-profile-schoolteacher",
  courseteacher: "hz-config-profile-courseteacher",
  stateadvisor: "hz-config-profile-stateadvisor",
  guardian: "hz-config-profile-guardian",
} as const;

type RoomType = keyof typeof ROOM_TAG_PATTERNS;
type PersonType = keyof typeof PERSON_TAG_PATTERNS;

interface SyncProgress {
  status: "idle" | "syncing" | "completed" | "error";
  message: string;
  roomsProcessed: number;
  personsProcessed: number;
  assignmentsProcessed: number;
  errors: string[];
}

let syncProgress: SyncProgress = {
  status: "idle",
  message: "",
  roomsProcessed: 0,
  personsProcessed: 0,
  assignmentsProcessed: 0,
  errors: [],
};

export function getSyncProgress(): SyncProgress {
  return { ...syncProgress };
}

function resetProgress(): void {
  console.log('[SYNC] Starting sync...');
  syncProgress = {
    status: "syncing",
    message: "Starting sync...",
    roomsProcessed: 0,
    personsProcessed: 0,
    assignmentsProcessed: 0,
    errors: [],
  };
}

function clearOldData(): void {
  const db = getDb();
  console.log('[SYNC] Clearing old data before sync...');

  // Clear assignments first (foreign key constraint)
  db.exec("DELETE FROM person_room_assignments");

  // Clear persons and rooms
  db.exec("DELETE FROM persons");
  db.exec("DELETE FROM rooms");

  console.log('[SYNC] Old data cleared');
}

function identifyRoomType(tags: string[]): RoomType | null {
  for (const [type, tagPattern] of Object.entries(ROOM_TAG_PATTERNS)) {
    if (tags.includes(tagPattern)) {
      return type as RoomType;
    }
  }
  return null;
}

function identifyPersonType(tags: string[]): PersonType | null {
  for (const [type, tagPattern] of Object.entries(PERSON_TAG_PATTERNS)) {
    // Check for exact match or tag starting with pattern
    if (tags.some(tag => tag === tagPattern || tag.startsWith(tagPattern + "-"))) {
      return type as PersonType;
    }
  }
  return null;
}

async function syncRooms(): Promise<void> {
  const db = getDb();
  const rootId = getRootHazuId();

  console.log('[SYNC] Fetching room categories from root...');
  syncProgress.message = "Fetching rooms from Hazu...";

  // Level 1: Fetch direct children of root - these are CATEGORY folders
  const categories = await sendApiRequestList(rootId);
  if (!categories) {
    throw new Error("Failed to fetch children from root Hazu");
  }

  console.log(`[SYNC] Found ${categories.length} direct children of root`);

  // Find room category folders (hz-config-room-*)
  for (const category of categories) {
    const categorySnapshot = category.snapshot;
    const categoryTags = categorySnapshot.tags || [];
    const roomType = identifyRoomType(categoryTags);

    if (roomType) {
      const categoryTitle = stripHtml(categorySnapshot.title);
      console.log(`[SYNC] Found room category: ${categoryTitle} (${roomType})`);

      // Level 2: Fetch children of this category
      const children = await sendApiRequestList(categorySnapshot.key);
      if (children) {
        let roomCount = 0;

        for (const child of children) {
          const roomSnapshot = child.snapshot;
          const roomTags = roomSnapshot.tags || [];

          // Only save if it has hz-config-class-* tag (actual room)
          const classId = extractClassId(roomTags);
          if (!classId) {
            continue; // Skip non-room Hazus
          }

          const stmt = db.prepare(`
            INSERT OR REPLACE INTO rooms (id, title, description, color, icon, room_type, parent_id, class_id, tags, raw_data, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          stmt.run(
            roomSnapshot.key,
            stripHtml(roomSnapshot.title),
            stripHtml(roomSnapshot.description || ""),
            roomSnapshot.color || "",
            roomSnapshot.icon || "",
            roomType,  // Type comes from parent category
            categorySnapshot.key,  // Parent is the category folder
            classId,  // The ID from hz-config-class-ID tag
            JSON.stringify(roomTags),
            JSON.stringify(roomSnapshot),
            Date.now()
          );

          syncProgress.roomsProcessed++;
          roomCount++;
        }

        console.log(`[SYNC] Found ${roomCount} actual rooms in ${categoryTitle} (filtered by hz-config-class-* tag)`);
      }
    }
  }

  console.log(`[SYNC] Synced ${syncProgress.roomsProcessed} rooms total`);
}

// Extract class ID from hz-config-class-* tag
// Class IDs are alphanumeric only, so we extract only alphanumeric characters
// This handles inconsistent tags like "hz-config-class-ID-" (trailing hyphen)
function extractClassId(tags: string[]): string | null {
  const prefix = "hz-config-class-";
  for (const tag of tags) {
    if (tag.startsWith(prefix)) {
      const remainder = tag.substring(prefix.length);
      // Extract only alphanumeric characters (the actual ID)
      const match = remainder.match(/^[a-zA-Z0-9]+/);
      return match ? match[0] : null;
    }
  }
  return null;
}

// Helper to strip HTML tags from strings
function stripHtml(str: string): string {
  return str?.replace(/<[^>]*>/g, '').trim() || "";
}

// Extract webhook config from admin item's form HTML
function extractWebhookConfig(html: string): { webhookUrl: string; templateId: string } | null {
  // Extract form action URL
  const actionMatch = html.match(/action="([^"]+)"/);
  const webhookUrl = actionMatch?.[1] || '';

  // Extract templateLink from hidden input
  const templateMatch = html.match(/name="hazu\[templateLink\]"\s+value="([^"]+)"/);
  const templateId = templateMatch?.[1] || '';

  if (!webhookUrl || !templateId) {
    return null;
  }

  return { webhookUrl, templateId };
}

async function syncRoomsRecursive(parentId: string): Promise<void> {
  const db = getDb();
  const children = await sendApiRequestList(parentId);
  if (!children) return;

  for (const child of children) {
    const snapshot = child.snapshot;
    const tags = snapshot.tags || [];
    const roomType = identifyRoomType(tags);

    if (roomType) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO rooms (id, title, description, color, icon, room_type, parent_id, tags, raw_data, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        snapshot.key,
        snapshot.title,
        snapshot.description || "",
        snapshot.color || "",
        snapshot.icon || "",
        roomType,
        snapshot.parentId,
        JSON.stringify(tags),
        JSON.stringify(snapshot),
        Date.now()
      );

      syncProgress.roomsProcessed++;
      syncProgress.message = `Synced ${syncProgress.roomsProcessed} rooms...`;
    }

    // Continue recursively
    if (snapshot.type === "hazu") {
      await syncRoomsRecursive(snapshot.key);
    }
  }
}

async function syncPersonsFromContainers(): Promise<void> {
  const db = getDb();
  const rootId = getRootHazuId();

  console.log('[SYNC] Fetching persons from person containers...');
  syncProgress.message = "Fetching persons from containers...";

  // Recursively find person containers and their children
  await findAndSyncPersonContainers(rootId);

  console.log(`[SYNC] Synced ${syncProgress.personsProcessed} persons`);
  syncProgress.message = `Synced ${syncProgress.personsProcessed} persons...`;
}

async function findAndSyncPersonContainers(parentId: string): Promise<void> {
  const db = getDb();

  // Level 1: Fetch direct children of root - these are CATEGORY folders
  const categories = await sendApiRequestList(parentId);
  if (!categories) return;

  console.log(`[SYNC] Checking ${categories.length} children for person categories...`);

  for (const category of categories) {
    const categorySnapshot = category.snapshot;
    const categoryTags = categorySnapshot.tags || [];

    // Check if this is a person category folder (has hz-config-profile-* tags)
    const personType = identifyPersonType(categoryTags);

    if (personType) {
      const categoryTitle = stripHtml(categorySnapshot.title);
      console.log(`[SYNC] Found person category: ${categoryTitle} (${personType})`);

      // Level 2: Fetch children of this category
      const children = await sendApiRequestList(categorySnapshot.key);
      if (children) {
        let personCount = 0;

        for (const child of children) {
          const personSnapshot = child.snapshot;
          const personTags = personSnapshot.tags || [];

          // Only save if it has hz-config-userid-* tag (actual person)
          const userId = extractUserId(personTags);
          if (!userId) {
            continue; // Skip non-person Hazus (e.g., companies)
          }

          // Extract name from title (usually "FirstName LastName")
          const displayName = stripHtml(personSnapshot.title);
          const nameParts = displayName.split(" ");
          const firstName = nameParts[0] || "";
          const lastName = nameParts.slice(1).join(" ") || "";

          const stmt = db.prepare(`
            INSERT OR REPLACE INTO persons (id, email, first_name, last_name, display_name, person_type, role, tags, raw_data, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          stmt.run(
            personSnapshot.key,       // Hazu ID
            userId,                   // Email or user ID from hz-config-userid-* tag
            firstName,
            lastName,
            displayName,              // Title of the Hazu
            personType,               // Type comes from parent category
            "reader",
            JSON.stringify(personTags),
            JSON.stringify(personSnapshot),
            Date.now()
          );

          personCount++;
          syncProgress.personsProcessed++;

          // Extract room assignments from person's tags
          syncPersonRoomAssignments(personSnapshot.key, personTags);
        }

        console.log(`[SYNC] Found ${personCount} actual persons in ${categoryTitle} (filtered by hz-config-userid-* tag)`);
      }
    }
  }
}

// Extract user ID/email from hz-config-userid-* tag
function extractUserId(tags: string[]): string | null {
  const prefix = "hz-config-userid-";
  for (const tag of tags) {
    if (tag.startsWith(prefix)) {
      return tag.substring(prefix.length);
    }
  }
  return null;
}

// Parse assignment tag: hz-config-class-{CLASS_ID}-{ROLE}
// Returns classId and role, or null if not a valid assignment tag
function parseAssignmentTag(tag: string): { classId: string; role: string } | null {
  const prefix = "hz-config-class-";
  if (!tag.startsWith(prefix)) return null;

  const remainder = tag.substring(prefix.length);  // "kzlJ3rVjLImfvVnvTDhm-student"
  const lastHyphen = remainder.lastIndexOf("-");
  if (lastHyphen === -1) return null;

  const classId = remainder.substring(0, lastHyphen);
  const role = remainder.substring(lastHyphen + 1);

  // Validate role is a known person type
  const validRoles = Object.keys(PERSON_TAG_PATTERNS);
  if (!validRoles.includes(role)) return null;

  return { classId, role };
}

function syncPersonRoomAssignments(personId: string, tags: string[]): void {
  const db = getDb();

  // Get all rooms with their class_ids
  const rooms = db.prepare("SELECT id, class_id FROM rooms WHERE class_id IS NOT NULL").all() as Array<{ id: string; class_id: string }>;

  // Build a map of class_id -> room_id
  const classIdToRoomId = new Map<string, string>();
  for (const room of rooms) {
    classIdToRoomId.set(room.class_id, room.id);
  }

  // Parse assignment tags and create assignments with correct roles
  for (const tag of tags) {
    const parsed = parseAssignmentTag(tag);
    if (!parsed) continue;

    const roomId = classIdToRoomId.get(parsed.classId);
    if (!roomId) continue;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO person_room_assignments (person_id, room_id, role, synced_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(personId, roomId, parsed.role, Date.now());
    syncProgress.assignmentsProcessed++;
  }
}

async function syncPersonsRecursive(parentId: string): Promise<void> {
  const db = getDb();
  const children = await sendApiRequestList(parentId);
  if (!children) return;

  for (const child of children) {
    const snapshot = child.snapshot;
    const tags = snapshot.tags || [];
    const personType = identifyPersonType(tags);

    if (personType) {
      try {
        const aclInfo = await sendApiRequestGetAclInfo(snapshot.key);
        const aclEntries = aclInfo?.data || [];

        for (const entry of aclEntries) {
          if (!entry.isGroup && entry.key) {
            const stmt = db.prepare(`
              INSERT OR REPLACE INTO persons (id, email, first_name, last_name, display_name, person_type, role, tags, raw_data, synced_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const displayName = entry.displayName || "";
            const nameParts = displayName.split(" ");
            const firstName = nameParts[0] || "";
            const lastName = nameParts.slice(1).join(" ") || "";

            stmt.run(
              entry.authorId || entry.key,
              entry.description || "",
              firstName,
              lastName,
              displayName,
              personType,
              entry.role || "reader",
              JSON.stringify(tags),
              JSON.stringify(entry),
              Date.now()
            );

            syncProgress.personsProcessed++;
            syncProgress.message = `Synced ${syncProgress.personsProcessed} persons...`;
          }
        }
      } catch (error) {
        console.error(`Error fetching ACL for ${snapshot.key}:`, error);
      }
    }

    if (snapshot.type === "hazu") {
      await syncPersonsRecursive(snapshot.key);
    }
  }
}

async function syncAssignments(): Promise<void> {
  const db = getDb();

  syncProgress.message = "Syncing assignments...";

  // Get all rooms
  const rooms = db.prepare("SELECT id, raw_data FROM rooms").all() as Array<{ id: string; raw_data: string }>;

  for (const room of rooms) {
    try {
      const aclInfo = await sendApiRequestGetAclInfo(room.id);
      const aclEntries = aclInfo?.data || [];

      for (const entry of aclEntries) {
        if (!entry.isGroup && entry.authorId) {
          // Check if this person exists in our persons table
          const person = db.prepare("SELECT id FROM persons WHERE id = ?").get(entry.authorId);

          if (person) {
            const stmt = db.prepare(`
              INSERT OR REPLACE INTO person_room_assignments (person_id, room_id, role, synced_at)
              VALUES (?, ?, ?, ?)
            `);

            stmt.run(entry.authorId, room.id, entry.role || "reader", Date.now());
            syncProgress.assignmentsProcessed++;
          }
        }
      }
    } catch (error) {
      console.error(`Error fetching ACL for room ${room.id}:`, error);
    }
  }

  syncProgress.message = `Synced ${syncProgress.assignmentsProcessed} assignments...`;
}

async function syncAdminConfig(): Promise<void> {
  const rootId = getRootHazuId();

  console.log('[SYNC] Fetching first-level children to find Admin Hazu...');

  // Fetch first-level children of root
  const firstLevelChildren = await sendApiRequestList(rootId);
  if (!firstLevelChildren) {
    console.log('[SYNC] Failed to fetch first-level children');
    return;
  }

  // Find and process Admin Hazu (hz-config-admin)
  const adminHazu = firstLevelChildren.find((child: HazuEntity) =>
    child.snapshot.tags?.includes('hz-config-admin')
  );

  if (!adminHazu) {
    console.log('[SYNC] No Admin Hazu found (hz-config-admin tag)');
    return;
  }

  console.log('[SYNC] Found Admin Hazu:', adminHazu.snapshot.key);

  // Save admin_id
  run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
    ['admin_id', adminHazu.snapshot.key, Date.now()]);

  // Get children of admin Hazu to find the config item
  const adminChildren = await sendApiRequestList(adminHazu.snapshot.key);
  if (!adminChildren) {
    console.log('[SYNC] Failed to fetch Admin Hazu children');
    return;
  }

  let foundConfig = false;
  for (const child of adminChildren) {
    const description = child.snapshot.description || '';
    const config = extractWebhookConfig(description);
    if (config) {
      console.log('[SYNC] Found webhook config:', config.webhookUrl);
      run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
        ['webhook_url', config.webhookUrl, Date.now()]);
      run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
        ['template_id', config.templateId, Date.now()]);
      foundConfig = true;
      break;
    }
  }

  if (!foundConfig) {
    console.log('[SYNC] No webhook config found in Admin Hazu children');
  }
}

export async function runFullSync(): Promise<SyncProgress> {
  if (!isConfigured()) {
    return {
      status: "error",
      message: "API not configured. Please set API key and Root Hazu ID in Settings.",
      roomsProcessed: 0,
      personsProcessed: 0,
      assignmentsProcessed: 0,
      errors: ["API not configured"],
    };
  }

  resetProgress();

  try {
    // Clear old data before syncing (full refresh)
    clearOldData();

    // Step 0: Extract admin configuration (webhook URL and template ID)
    await syncAdminConfig();

    // Step 1: Sync rooms (extracts class_ids from hz-config-class-* tags)
    await syncRooms();

    // Step 2: Sync persons from their containers
    // (also syncs assignments by matching person tags to room class_ids)
    await syncPersonsFromContainers();

    // Note: Assignments are synced within syncPersonsFromContainers()
    // by matching person tags against room class_ids

    // Update last sync time
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_sync_at', ?)").run(
      Date.now().toString()
    );

    syncProgress.status = "completed";
    syncProgress.message = `Sync completed! Rooms: ${syncProgress.roomsProcessed}, Persons: ${syncProgress.personsProcessed}, Assignments: ${syncProgress.assignmentsProcessed}`;

    return getSyncProgress();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    syncProgress.status = "error";
    syncProgress.message = `Sync failed: ${errorMessage}`;
    syncProgress.errors.push(errorMessage);
    return getSyncProgress();
  }
}
