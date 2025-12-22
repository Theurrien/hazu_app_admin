-- Hazu Admin Database Schema
-- Version: 1.0.0

-- ============================================================================
-- CORE ENTITIES
-- ============================================================================

-- Rooms: Classes, Companies, Cantons, Cie
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    color TEXT,
    icon TEXT,
    room_type TEXT NOT NULL CHECK (room_type IN ('state', 'class', 'enterprise', 'cie')),
    parent_id TEXT,
    class_id TEXT,              -- The ID from hz-config-class-* tag (used for person linking)
    tags TEXT DEFAULT '[]',
    raw_data TEXT,
    synced_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(room_type);
CREATE INDEX IF NOT EXISTS idx_rooms_parent ON rooms(parent_id);
CREATE INDEX IF NOT EXISTS idx_rooms_class_id ON rooms(class_id);

-- Persons: Students, Teachers, Mentors, Advisors, Guardians
CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    email TEXT,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT NOT NULL,
    person_type TEXT NOT NULL CHECK (person_type IN ('student', 'companymentor', 'schoolteacher', 'courseteacher', 'stateadvisor', 'guardian')),
    role TEXT CHECK (role IN ('reader', 'editor', 'admin')),
    tags TEXT DEFAULT '[]',
    raw_data TEXT,
    synced_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_persons_type ON persons(person_type);
CREATE INDEX IF NOT EXISTS idx_persons_email ON persons(email);

-- ============================================================================
-- RELATIONSHIPS
-- ============================================================================

-- Person-to-Room Assignments
CREATE TABLE IF NOT EXISTS person_room_assignments (
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
);

CREATE INDEX IF NOT EXISTS idx_assignments_person ON person_room_assignments(person_id);
CREATE INDEX IF NOT EXISTS idx_assignments_room ON person_room_assignments(room_id);

-- ============================================================================
-- SYNC TRACKING
-- ============================================================================

-- Change log for n8n webhook sync
CREATE TABLE IF NOT EXISTS change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'room', 'assignment')),
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'assign', 'unassign')),
    old_data TEXT,
    new_data TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed')),
    error_message TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    synced_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_changelog_status ON change_log(status);
CREATE INDEX IF NOT EXISTS idx_changelog_entity ON change_log(entity_type, entity_id);

-- Sync metadata
CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- ============================================================================
-- TAG MAPPINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS tag_mappings (
    tag TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    semantic_value TEXT NOT NULL,
    description TEXT
);

-- Pre-populate known tag mappings
INSERT OR IGNORE INTO tag_mappings (tag, category, semantic_value, description) VALUES
    -- Room types (category folder tags)
    ('hz-config-room-state', 'room_type', 'state', 'Geographic region/Canton'),
    ('hz-config-room-class', 'room_type', 'class', 'School class'),
    ('hz-config-room-entreprise', 'room_type', 'enterprise', 'Training company'),
    ('hz-config-room-cie', 'room_type', 'cie', 'Company variant'),
    -- Person category tags (for identifying person containers)
    ('hz-config-profile-student', 'person_category', 'student', 'Student container'),
    ('hz-config-profile-companymentor', 'person_category', 'companymentor', 'Company mentor container'),
    ('hz-config-profile-schoolteacher', 'person_category', 'schoolteacher', 'School teacher container'),
    ('hz-config-profile-courseteacher', 'person_category', 'courseteacher', 'Course teacher container'),
    ('hz-config-profile-stateadvisor', 'person_category', 'stateadvisor', 'State advisor container'),
    ('hz-config-profile-guardian', 'person_category', 'guardian', 'Parent/Guardian container'),
    -- Person assignment roles (used in hz-config-class-{ID}-{ROLE} tags)
    ('student', 'person_role', 'student', 'Student role in a room'),
    ('companymentor', 'person_role', 'companymentor', 'Company mentor role in a room'),
    ('schoolteacher', 'person_role', 'schoolteacher', 'School teacher role in a room'),
    ('courseteacher', 'person_role', 'courseteacher', 'Course teacher role in a room'),
    ('stateadvisor', 'person_role', 'stateadvisor', 'State advisor role in a room'),
    ('guardian', 'person_role', 'guardian', 'Parent/Guardian role in a room');

-- ============================================================================
-- SETTINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('api_environment', 'swiss'),
    ('root_hazu_id', ''),
    ('last_sync_at', '0'),
    ('admin_id', ''),
    ('template_id', ''),
    ('webhook_url', ''),
    ('user_id', ''),
    ('user_email', ''),
    ('user_display_name', '');
