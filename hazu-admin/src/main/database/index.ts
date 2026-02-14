import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

// Get database path in user data directory
function getDatabasePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'hazu-admin.db');
}

// Initialize database
export async function initDatabase(): Promise<void> {
  const dbPath = getDatabasePath();

  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  console.log('Initializing database at:', dbPath);

  // Create database connection
  db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Run schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
    console.log('Database schema initialized');
  } else {
    // If schema.sql not found (in dev), use inline schema
    runInlineSchema();
    console.log('Database schema initialized (inline)');
  }

  // Run migrations
  runMigrations();
}

// Database migrations
function runMigrations(): void {
  if (!db) return;

  // Migration: Add class_id column to rooms table
  try {
    const columns = db.prepare("PRAGMA table_info(rooms)").all() as Array<{ name: string }>;
    const hasClassId = columns.some(col => col.name === 'class_id');
    if (!hasClassId) {
      db.exec("ALTER TABLE rooms ADD COLUMN class_id TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_rooms_class_id ON rooms(class_id)");
      console.log('Migration: Added class_id column to rooms table');
    }
  } catch (error) {
    console.error('Migration error (class_id):', error);
  }

  // Migration: Add user_types table
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_types'").all();
    if (tables.length === 0) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_types (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            synced_at INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_usertypes_name ON user_types(name);
      `);
      console.log('Migration: Added user_types table');
    }
  } catch (error) {
    console.error('Migration error (user_types):', error);
  }

  // Migration: Add distribution_groups table
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='distribution_groups'").all();
    if (tables.length === 0) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS distribution_groups (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            room_class_id TEXT NOT NULL,
            role TEXT NOT NULL,
            room_id TEXT,
            tags TEXT DEFAULT '[]',
            raw_data TEXT,
            synced_at INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_distgroups_room ON distribution_groups(room_id);
        CREATE INDEX IF NOT EXISTS idx_distgroups_role ON distribution_groups(role);
        CREATE INDEX IF NOT EXISTS idx_distgroups_class_id ON distribution_groups(room_class_id);
      `);
      console.log('Migration: Added distribution_groups table');
    }
  } catch (error) {
    console.error('Migration error (distribution_groups):', error);
  }

  // Migration: Recreate person_room_assignments table without CHECK constraint
  // This allows flexible role values (student, companymentor, schoolteacher, etc.)
  try {
    // Check if we need to migrate by looking for the old default value
    const tableInfo = db.prepare("PRAGMA table_info(person_room_assignments)").all() as Array<{ name: string; dflt_value: string | null }>;
    const roleColumn = tableInfo.find(col => col.name === 'role');

    // If default is 'reader', we need to migrate to new schema with 'student' default
    if (roleColumn && roleColumn.dflt_value === "'reader'") {
      console.log('Migration: Recreating person_room_assignments table with new schema...');

      // Drop and recreate the table (data will be repopulated on next sync)
      db.exec("DROP TABLE IF EXISTS person_room_assignments");
      db.exec(`
        CREATE TABLE person_room_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          person_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'student',
          synced_at INTEGER,
          created_at INTEGER DEFAULT (strftime('%s', 'now')),
          updated_at INTEGER DEFAULT (strftime('%s', 'now')),
          FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE,
          FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
          UNIQUE(person_id, room_id)
        )
      `);
      db.exec("CREATE INDEX IF NOT EXISTS idx_assignments_person ON person_room_assignments(person_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_assignments_room ON person_room_assignments(room_id)");

      console.log('Migration: person_room_assignments table recreated successfully');
    }
  } catch (error) {
    console.error('Migration error (person_room_assignments):', error);
  }

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
}

// Inline schema for development
function runInlineSchema(): void {
  if (!db) return;

  db.exec(`
    -- Rooms
    CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        color TEXT,
        icon TEXT,
        room_type TEXT NOT NULL,
        parent_id TEXT,
        class_id TEXT,
        tags TEXT DEFAULT '[]',
        raw_data TEXT,
        synced_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

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

    -- Assignments
    CREATE TABLE IF NOT EXISTS person_room_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        synced_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(person_id, room_id)
    );

    -- Change log
    CREATE TABLE IF NOT EXISTS change_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        old_data TEXT,
        new_data TEXT,
        status TEXT DEFAULT 'pending',
        error_message TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        synced_at INTEGER
    );

    -- Settings
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Sync metadata
    CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Tag mappings
    CREATE TABLE IF NOT EXISTS tag_mappings (
        tag TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        semantic_value TEXT NOT NULL,
        description TEXT
    );

    -- User types (dynamic roles)
    CREATE TABLE IF NOT EXISTS user_types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        synced_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Distribution groups (room + role assignment targets)
    CREATE TABLE IF NOT EXISTS distribution_groups (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        room_class_id TEXT NOT NULL,
        role TEXT NOT NULL,
        room_id TEXT,
        tags TEXT DEFAULT '[]',
        raw_data TEXT,
        synced_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
    );

    -- Mission tracking (deduplicated per student per lieu)
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

    -- Mission sync status
    CREATE TABLE IF NOT EXISTS mission_sync_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_synced_at INTEGER,
        students_processed INTEGER DEFAULT 0,
        total_students INTEGER DEFAULT 0,
        status TEXT DEFAULT 'idle'
    );
  `);
}

// Get database instance
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// Close database
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Query helper
export function query<T = any>(sql: string, params: any[] = []): T[] {
  const stmt = getDb().prepare(sql);
  return stmt.all(...params) as T[];
}

// Run helper (for inserts, updates, deletes)
export function run(sql: string, params: any[] = []): Database.RunResult {
  const stmt = getDb().prepare(sql);
  return stmt.run(...params);
}

// Get single row
export function get<T = any>(sql: string, params: any[] = []): T | undefined {
  const stmt = getDb().prepare(sql);
  return stmt.get(...params) as T | undefined;
}

// Transaction helper
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  const transaction = db.transaction(fn);
  return transaction();
}
