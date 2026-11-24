import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

// Formation overview tables — kept identical to the block in schema.sql (the built app has no
// schema.sql beside it and runs the inline schema; the migration runs this on every start).
const FORMATION_SCHEMA = `
-- ============================================================================
-- MISSIONS — FORMATION OVERVIEW (raw-ish facts per apprentice; rules run at query time)
-- ============================================================================

-- One row per apprentice the formation sync has tried to read.
-- read_ok = the stored rows come from a successful read; stale = the latest read failed,
-- so the rows are from an earlier one (error = that latest failure).
CREATE TABLE IF NOT EXISTS formation_student (
    person_id TEXT PRIMARY KEY,
    read_ok INTEGER NOT NULL,
    error TEXT,
    stale INTEGER NOT NULL DEFAULT 0,
    profile_created INTEGER,
    user_id_tag TEXT,
    self_uid TEXT,
    timeline_ok INTEGER NOT NULL,
    mpe_found INTEGER NOT NULL,
    mpc_found INTEGER NOT NULL,
    plan_start_ms INTEGER,
    empty_listings INTEGER NOT NULL DEFAULT 0,
    failed_parts TEXT NOT NULL DEFAULT '[]',
    synced_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS formation_copy (
    person_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    kind TEXT NOT NULL,
    copy_id TEXT NOT NULL,
    semester INTEGER,
    mandate TEXT,
    level TEXT,
    profession TEXT,
    title TEXT NOT NULL,
    date_created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_formation_copy_person ON formation_copy(person_id);

CREATE TABLE IF NOT EXISTS formation_assessment (
    person_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    copy_id TEXT NOT NULL,
    author_id TEXT,
    author_name TEXT NOT NULL,
    points REAL NOT NULL,
    feedback TEXT,
    date_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_formation_assessment_person ON formation_assessment(person_id);

CREATE TABLE IF NOT EXISTS formation_report (
    person_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    kind TEXT NOT NULL,
    report_id TEXT NOT NULL,
    semester INTEGER,
    published INTEGER NOT NULL,
    published_at INTEGER,
    course_id TEXT,
    date_created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_formation_report_person ON formation_report(person_id);

CREATE TABLE IF NOT EXISTS formation_plan_retired (
    person_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    slot_key TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_formation_plan_retired_person ON formation_plan_retired(person_id);

-- School-wide reference data, replaced as a whole by each successful run.
CREATE TABLE IF NOT EXISTS formation_catalogue (
    ord INTEGER NOT NULL,
    kind TEXT NOT NULL,
    profession TEXT NOT NULL,
    level TEXT NOT NULL,
    semester INTEGER NOT NULL,
    mandate TEXT NOT NULL,
    title TEXT NOT NULL,
    slot_id TEXT NOT NULL
);

-- professionsByIcon / levelsByColor / catalogueIcons, as JSON.
CREATE TABLE IF NOT EXISTS formation_reference (
    key TEXT PRIMARY KEY,
    json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS formation_sync_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'idle',
    processed INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    last_synced_at INTEGER,
    last_error TEXT
);
-- Seeded: the old Missions tab broke because its status row was never created.
INSERT OR IGNORE INTO formation_sync_status (id, status) VALUES (1, 'idle');
`;

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

  // Migration: Add membership_issues table
  try {
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='membership_issues'").all();
    if (t.length === 0) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS membership_issues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL, group_id TEXT NOT NULL, room_id TEXT NOT NULL,
          role TEXT NOT NULL, uid TEXT NOT NULL, email TEXT, display_name TEXT,
          synced_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_membership_issues_room ON membership_issues(room_id);
      `);
      console.log('Migration: Added membership_issues table');
    }
  } catch (error) {
    console.error('Migration error (membership_issues):', error);
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

  // Migration: Seed admin_password setting
  try {
    const adminPw = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get();
    if (!adminPw) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('admin_password', 'hazu_app_ADMIN_password')").run();
      console.log('Migration: Seeded admin_password setting');
    }
  } catch (error) {
    console.error('Migration error (admin_password):', error);
  }

  // Migration: Missions formation overview — the old mission tables go, the formation tables
  // come (CREATE IF NOT EXISTS, status row seeded). Then a startup reset: a status left at
  // 'syncing' means the app was closed mid-run; that run is gone, its data untouched.
  try {
    db.exec(`
      DROP TABLE IF EXISTS mission_tracking;
      DROP TABLE IF EXISTS mission_sync_status;
    `);
    db.exec(FORMATION_SCHEMA);
    db.prepare("UPDATE formation_sync_status SET status = 'idle' WHERE id = 1 AND status = 'syncing'").run();
  } catch (error) {
    console.error('Migration error (formation tables):', error);
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

  `);
  db.exec(FORMATION_SCHEMA);
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
