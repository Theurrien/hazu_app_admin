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
        role TEXT NOT NULL DEFAULT 'reader',
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
