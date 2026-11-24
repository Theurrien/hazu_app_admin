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
-- USER TYPES (Dynamic Roles)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    synced_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
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
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_distgroups_room ON distribution_groups(room_id);
CREATE INDEX IF NOT EXISTS idx_distgroups_role ON distribution_groups(role);
CREATE INDEX IF NOT EXISTS idx_distgroups_class_id ON distribution_groups(room_class_id);

-- ============================================================================
-- MEMBERSHIP ISSUES (Unresolved/Unknown Group Members)
-- ============================================================================

CREATE TABLE IF NOT EXISTS membership_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,          -- 'unresolved' | 'unknown'
    group_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    role TEXT NOT NULL,
    uid TEXT NOT NULL,
    email TEXT,
    display_name TEXT,
    synced_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_membership_issues_room ON membership_issues(room_id);

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
    skipped_subtrees INTEGER NOT NULL DEFAULT 0,
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
    ('user_display_name', ''),
    ('admin_password', 'hazu_app_ADMIN_password');
