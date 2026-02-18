# Mission Analysis Dashboard — Design Document

**Date:** 2026-02-14
**Status:** Draft

## Overview

A new "Mission Analysis" section in the Hazu Admin app that provides an aggregated view of student mission completion across learning places, professions, and degree levels. The dashboard visualizes how many official missions (MPE) and personal reflexions each group of students has completed, using data synced from the "Le suivi de ma formation" Hazu inside each student's profile.

## Data Model

### Source Data (Hazu API)

The data lives inside each student's Hazu profile:

```
Root
├── Student Hazus (tag: hz-config-profile-student)
│   │  → icon = profession (e.g., fa-utensils for cooking)
│   │  → color = degree level (AFP: #9AD9EA, CFC: #1A237E)
│   │
│   └── Le suivi de ma formation (identified by title)
│       ├── Item: "C. Mise en œuvre des processus..." (competency entry)
│       ├── Item: "D. Apparence et communication"
│       └── ... (can be 600+ items per student)
│
├── Class Hazus (tag: hz-config-room-class)
└── ...
```

Each competency item inside "Le suivi de ma formation" has:
- **title**: Competency category (e.g., "C. Mise en œuvre des processus opérationnels et économiques")
- **description**: Contains an HTML link to the source mission/reflexion and the competency code
  - Link format: `<a href="https://hazu.swiss/..."><strong>MPE 102 - Fond de légumes</strong></a>`
  - Points: `"2 Points – ..."` at the start of the description
  - Competency code in the text (e.g., "c1.3-E Déroulement des travaux...")
- **tags**: Contains the lieu de formation (`entreprise`, `ecole`, or `cie`) and competency codes (e.g., `["c","c1","c1.3","c1.3-E","entreprise"]`)
- **icon**: Per competency category
- **color**: Per competency category

### Key Parsing Rules

1. **Mission name**: Extract from the `<a>` tag's inner text (strip `<strong>` tags)
   - Regex: `/<a[^>]*href="[^"]*"[^>]*>(?:<strong>)?([^<]+)(?:<\/strong>)?<\/a>/g`
2. **Official mission vs reflexion**: Link text starting with `"MPE"` = official mission, everything else = personal reflexion
3. **Lieu de formation**: From the item's tags array — look for `entreprise`, `ecole`, or `cie`
4. **Distinct missions**: Multiple competency items reference the same mission. Count only distinct mission names per student per lieu de formation
5. **Points**: Parse from description with `/(\d+)\s*Point/`

### SQLite Schema

Two new tables, separate from the main sync:

```sql
-- Deduplicated mission/reflexion per student per lieu
CREATE TABLE IF NOT EXISTS mission_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL,
  mission_name TEXT NOT NULL,
  is_official BOOLEAN NOT NULL,       -- true if name starts with "MPE"
  lieu_de_formation TEXT NOT NULL,     -- 'entreprise', 'ecole', 'cie'
  item_count INTEGER DEFAULT 1,       -- how many competency items reference this mission
  total_points INTEGER DEFAULT 0,     -- sum of points from all items for this mission
  synced_at INTEGER,
  UNIQUE(person_id, mission_name, lieu_de_formation)
);

-- Sync metadata for the mission analysis section
CREATE TABLE IF NOT EXISTS mission_sync_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_synced_at INTEGER,
  students_processed INTEGER DEFAULT 0,
  total_students INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle'           -- 'idle', 'syncing', 'error'
);
```

No changes to the existing `persons`, `rooms`, or `person_room_assignments` tables. The dashboard joins against them for filtering.

### Sync Process

Triggered by a dedicated sync button in the Mission Analysis section. Runs independently from the main sync.

**Steps:**

1. Set `mission_sync_status.status = 'syncing'`
2. Query all students: `SELECT id FROM persons WHERE person_type = 'student'`
3. Also need student icon and color — these are NOT currently stored in `persons` table. **Requires adding `icon TEXT` and `color TEXT` columns to the `persons` table** (via migration), and updating the main sync to populate them
4. For each student:
   a. Fetch children of the student Hazu via API: `sendApiRequestList(student.id)`
   b. Find the child with title matching "Le suivi de ma formation" (HTML-stripped comparison: `<p>Le suivi de ma formation</p>` → "Le suivi de ma formation")
   c. If found, fetch all items inside: `sendApiRequestList(suiviId)` — handle `{ data: [...] }` response format
   d. For each item, parse description for mission name and tags for lieu de formation
   e. Group by (mission_name, lieu_de_formation), count items and sum points
   f. Upsert into `mission_tracking`
   g. Update progress: `mission_sync_status.students_processed++`
5. Set `mission_sync_status.status = 'idle'`, update `last_synced_at`

**Performance considerations:**
- ~2 API calls per student (list children + list suivi items)
- For 100 students: ~200 API calls. With ~500ms per call = ~100 seconds
- Show progress bar during sync
- Consider parallel API calls (batch of 5) to speed up

### Schema Migration: Add icon/color to persons

The main sync already fetches person Hazu data. Add to the existing `syncPersons` flow:

```sql
ALTER TABLE persons ADD COLUMN icon TEXT;
ALTER TABLE persons ADD COLUMN color TEXT;
```

Update `syncPersons` to store `snapshot.icon` and `snapshot.color` for each person.

## UI Design

### Page Layout

```
┌─────────────────────────────────────────────────────────┐
│  Mission Analysis                    [Sync ↻] 14.02.26 │
│                                        15:30            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Lieu de formation                                      │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐          │
│  │ Entreprise │ │   École    │ │    CIE     │          │
│  └────────────┘ └────────────┘ └────────────┘          │
│                                                         │
│  Profession          Level           Class              │
│  ┌──┐ ┌──┐ ┌──┐    ┌─────┐ ┌─────┐  ┌──────────────┐ │
│  │🔧│ │🍳│ │🥕│    │ AFP │ │ CFC │  │ All classes ▾│ │
│  └──┘ └──┘ └──┘    └─────┘ └─────┘  └──────────────┘ │
│                                                         │
│                              [Treemap ▣] [Heatmap ▦]   │
│  ┌─────────────────────────────────────────────────────┐│
│  │                                                     ││
│  │              TREEMAP / HEATMAP                      ││
│  │                                                     ││
│  │                                                     ││
│  │                                                     ││
│  │                                                     ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  Summary: 124 students · 6.2 avg missions              │
└─────────────────────────────────────────────────────────┘
```

### Filter Bar

All filters are optional toggles. The visualization adapts to whatever combination is active.

**Lieu de formation** (toggle group, single select):
- Three buttons: Entreprise / École / CIE
- None selected = show all lieux combined
- Filters on `mission_tracking.lieu_de_formation`

**Profession** (toggle group, multi-select):
- Dynamic: populated from distinct `persons.icon` values where `persons.color IN ('#9AD9EA', '#1A237E')`
- Displayed as Font Awesome icon buttons
- Only icons from students with official AFP/CFC colors are shown (filters out non-student icons)
- None selected = show all professions

**Level** (toggle group, single select):
- Two buttons: AFP (with `#9AD9EA` accent) / CFC (with `#1A237E` accent)
- None selected = show both
- Filters on `persons.color`

**Class** (dropdown, single select):
- Populated from `rooms WHERE room_type = 'class'`
- "All classes" default
- Filters via `person_room_assignments` join

### Adaptive Heatmap Rows

The heatmap rows change based on active filters:

| Active filters | Heatmap rows |
|---|---|
| None | One row per profession (icon + label) |
| Lieu only | Same, filtered by lieu |
| Profession selected | Splits into AFP / CFC rows for that profession |
| Profession + Level | Single row, fully filtered |
| Level only | One row per profession, that level only |
| Class selected | Same logic, filtered to students in that class |

### Treemap (Default View)

The treemap fills the main content area below the filters.

**Hierarchy (3 levels):**
1. **Profession** — block labeled with icon + name
2. **Degree** — AFP block uses `#9AD9EA`, CFC block uses `#1A237E`
3. **Mission count** — each leaf represents students with exactly N completed missions

**Block sizing:** Proportional to student count. A block for "12 students with 0 missions" is 12x larger than "1 student with 5 missions".

**Labels:**
- Level 1 (profession): Icon + profession name
- Level 2 (degree): "AFP" or "CFC"
- Level 3 (leaf): "N MPE: X students"

**Interactions:**
- Hover tooltip: "Cuisiniers AFP — 0 missions: 12 students (34%)"
- Click to drill down (ECharts built-in zoom)
- Breadcrumb navigation to zoom back out

**ECharts config highlights:**
- `series.type: 'treemap'`
- `levels` config for each hierarchy depth
- `visibleMin` to hide tiny blocks
- Color mapping: profession colors at level 1, AFP/CFC at level 2

### Heatmap (Alternate View)

**X-axis:** Mission count (0, 1, 2, 3, ... up to max found, typically 0–20)
**Y-axis:** Profession + degree rows (e.g., "Cuisiniers AFP", "Cuisiniers CFC")
**Cell color:** Gradient intensity based on student count (light → dark)
**Cell label:** Exact number of students displayed in each cell

**ECharts config highlights:**
- `series.type: 'heatmap'`
- `visualMap` for the color gradient
- `tooltip` showing full details on hover
- Empty cells (0 students) shown as blank/very light

### View Toggle

Two icon buttons top-right of the chart area:
- Treemap icon (grid/squares) — default active
- Heatmap icon (grid/cells)
- Active state highlighted
- Smooth transition between views

### Sync Button & Status

Located top-right of the filter bar:
- **Idle state:** "↻ Sync" button + "Last: 14.02.2026, 15:30" label
- **Syncing state:** Spinner + "Syncing 12/45 students..." progress text, button disabled
- **Error state:** Red indicator + "Sync failed" with retry button

### Summary Bar

Below the chart, a subtle summary line:
- Total students in current filter
- Average distinct missions per student
- Total distinct missions found

## IPC Channels

New channels for the renderer ↔ main process communication:

```typescript
// In ipc-channels.ts
MISSION_SYNC_START: 'mission:sync:start',
MISSION_SYNC_STATUS: 'mission:sync:status',
MISSION_SYNC_CANCEL: 'mission:sync:cancel',

MISSION_GET_DASHBOARD_DATA: 'mission:dashboard:data',
MISSION_GET_PROFESSIONS: 'mission:professions:get',
```

### `MISSION_SYNC_START`
Triggers the sync process. Returns immediately, sends progress updates via `MISSION_SYNC_STATUS`.

### `MISSION_SYNC_STATUS`
Returns current sync state: `{ status, students_processed, total_students, last_synced_at }`.
Polled by the renderer during sync (~every 2 seconds).

### `MISSION_GET_DASHBOARD_DATA`
Main query for the dashboard. Accepts filters, returns aggregated data:

```typescript
// Request
interface MissionDashboardRequest {
  lieu?: 'entreprise' | 'ecole' | 'cie';
  professions?: string[];   // icon values, e.g., ['fa-utensils']
  level?: 'afp' | 'cfc';   // maps to color
  classId?: string;         // room ID
}

// Response
interface MissionDashboardResponse {
  // For heatmap: one entry per (profession, level, mission_count) combination
  distribution: Array<{
    profession_icon: string;
    level: 'AFP' | 'CFC';
    level_color: string;
    mission_count: number;     // distinct official missions (MPE) completed
    reflexion_count: number;   // distinct non-MPE entries ("Other")
    student_count: number;     // how many students have this exact mission count
  }>;

  // For treemap: same data, structured hierarchically
  treemap: Array<{
    name: string;              // icon class (e.g., 'fa-utensils')
    children: Array<{
      name: string;            // 'AFP' or 'CFC'
      color: string;
      children: Array<{
        name: string;          // e.g., "3 MPE"
        value: number;         // student count
      }>;
    }>;
  }>;

  // Summary stats
  summary: {
    total_students: number;
    avg_missions: number;
    avg_reflexions: number;
    max_missions: number;
    total_distinct_missions: number;
  };
}
```

### `MISSION_GET_PROFESSIONS`
Returns available profession filters (icons only, no text labels):

```typescript
// Response
Array<{
  icon: string;        // e.g., 'fa-utensils'
  student_count: number;
}>
```

## SQL Queries

### Dashboard Data Query

```sql
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
    AND (:lieu IS NULL OR lieu_de_formation = :lieu)
  GROUP BY person_id
) m ON m.person_id = p.id
LEFT JOIN person_room_assignments pra ON pra.person_id = p.id
LEFT JOIN rooms r ON r.id = pra.room_id AND r.room_type = 'class'
WHERE p.person_type = 'student'
  AND p.color IN ('#9AD9EA', '#1A237E')
  AND (:profession IS NULL OR p.icon IN (:professions))
  AND (:level_color IS NULL OR p.color = :level_color)
  AND (:class_id IS NULL OR r.id = :class_id)
GROUP BY p.icon, p.color, mission_count
ORDER BY p.icon, p.color, mission_count;
```

### Professions Query

```sql
SELECT DISTINCT
  p.icon,
  COUNT(*) as student_count
FROM persons p
WHERE p.person_type = 'student'
  AND p.color IN ('#9AD9EA', '#1A237E')
  AND p.icon IS NOT NULL
GROUP BY p.icon
ORDER BY student_count DESC;
```

## File Structure

```
hazu-admin/src/
├── main/
│   ├── database/
│   │   └── index.ts                          # Add migration for new tables + persons columns
│   ├── services/
│   │   └── mission-sync.service.ts           # New: dedicated mission sync logic
│   └── ipc/
│       └── index.ts                          # Add new IPC handlers
├── renderer/
│   ├── pages/
│   │   └── MissionAnalysisPage.tsx           # New: main page component
│   ├── components/
│   │   └── mission-analysis/
│   │       ├── MissionFilterBar.tsx          # Filter bar with all toggle filters
│   │       ├── MissionTreemap.tsx            # ECharts treemap visualization
│   │       ├── MissionHeatmap.tsx            # ECharts heatmap visualization
│   │       ├── MissionSyncButton.tsx         # Sync button with progress
│   │       └── MissionSummaryBar.tsx         # Summary stats below chart
│   └── components/layout/
│       └── Sidebar.tsx                       # Add navigation entry
└── shared/
    ├── types.ts                              # Add mission-related types
    └── ipc-channels.ts                       # Add new channels
```

## Profession Display

Professions are displayed using their **Font Awesome icons only** — no text labels. This keeps the UI portable across different schools where the same icon may represent different profession names. The filter bar shows clickable icon buttons, and the chart axes/labels use the icons.

## Reflexion Handling

Non-MPE entries (personal reflexions) are tracked in the database with `is_official = 0` but displayed only as a single aggregated **"Other"** count alongside the official MPE mission count. The dashboard focuses on official MPE missions as the primary metric; reflexions are secondary context.

## Dependencies

- **echarts** + **echarts-for-react**: Charting library for treemap and heatmap
- No other new dependencies required

## Future Work (v2)

- **Historical tracking**: Store each sync as a timestamped snapshot to enable progression charts ("missions completed this month vs last month"). Deferred from v1 to keep scope manageable — the DB schema is designed to allow adding a `sync_run_id` foreign key later without breaking existing data.
