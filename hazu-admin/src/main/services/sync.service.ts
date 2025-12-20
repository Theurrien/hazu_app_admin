/**
 * Sync Service - Hazu → SQLite
 *
 * Fetches rooms and persons from Hazu API and stores them in SQLite.
 */

import { getDb } from "../database";
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
  student: "hz-share-student-",
  companymentor: "hz-share-companymentor-",
  schoolteacher: "hz-share-schoolteacher-",
  courseteacher: "hz-share-courseteacher-",
  stateadvisor: "hz-share-stateadvisor-",
  guardian: "hz-share-guardian-",
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
  syncProgress = {
    status: "syncing",
    message: "Starting sync...",
    roomsProcessed: 0,
    personsProcessed: 0,
    assignmentsProcessed: 0,
    errors: [],
  };
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
  for (const [type, tagPrefix] of Object.entries(PERSON_TAG_PATTERNS)) {
    if (tags.some(tag => tag.startsWith(tagPrefix))) {
      return type as PersonType;
    }
  }
  return null;
}

async function syncRooms(): Promise<void> {
  const db = getDb();
  const rootId = getRootHazuId();

  syncProgress.message = "Fetching rooms from Hazu...";

  // Fetch all children of root
  const children = await sendApiRequestList(rootId);
  if (!children) {
    throw new Error("Failed to fetch children from root Hazu");
  }

  // Process each child - look for rooms
  for (const child of children) {
    const snapshot = child.snapshot;
    const tags = snapshot.tags || [];
    const roomType = identifyRoomType(tags);

    if (roomType) {
      // This is a room - save it
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
    }

    // Recursively check children for more rooms
    if (snapshot.type === "hazu") {
      await syncRoomsRecursive(snapshot.key);
    }
  }
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

async function syncPersonsFromSharingGroups(): Promise<void> {
  const db = getDb();
  const rootId = getRootHazuId();

  syncProgress.message = "Fetching persons from sharing groups...";

  // Fetch all children and look for sharing group containers
  const children = await sendApiRequestList(rootId);
  if (!children) return;

  for (const child of children) {
    const snapshot = child.snapshot;
    const tags = snapshot.tags || [];

    // Check if this is a sharing group container (has person tags)
    const personType = identifyPersonType(tags);

    if (personType) {
      // Fetch ACL info to get persons in this sharing group
      try {
        const aclInfo = await sendApiRequestGetAclInfo(snapshot.key);
        const aclEntries = aclInfo?.data || [];

        for (const entry of aclEntries) {
          if (!entry.isGroup && entry.key) {
            const stmt = db.prepare(`
              INSERT OR REPLACE INTO persons (id, email, first_name, last_name, display_name, person_type, role, tags, raw_data, synced_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            // Parse name from displayName
            const displayName = entry.displayName || "";
            const nameParts = displayName.split(" ");
            const firstName = nameParts[0] || "";
            const lastName = nameParts.slice(1).join(" ") || "";

            stmt.run(
              entry.authorId || entry.key,
              entry.description || "", // Email is often in description
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
          }
        }
      } catch (error) {
        console.error(`Error fetching ACL for ${snapshot.key}:`, error);
        syncProgress.errors.push(`Failed to fetch ACL for ${snapshot.title}`);
      }
    }

    // Check children for more sharing groups
    if (snapshot.type === "hazu") {
      await syncPersonsRecursive(snapshot.key);
    }
  }

  syncProgress.message = `Synced ${syncProgress.personsProcessed} persons...`;
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
    // Step 1: Sync rooms
    await syncRooms();

    // Step 2: Sync persons
    await syncPersonsFromSharingGroups();

    // Step 3: Sync assignments
    await syncAssignments();

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
