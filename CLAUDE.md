# CLAUDE.md - Hazu Admin Desktop App

This is the development guide for Claude and other AI assistants working on the Hazu Admin desktop application.

## Person Data — Hard Rule

**Never put real person data from the schools into tracked files.** No e-mail addresses, no
names, no Hazu profile/account IDs of students, teachers, mentors, advisors or guardians —
not in source, not in tests, not in docs, not in commit messages, not in fixtures, not "just
for a moment while debugging".

This app manages data about real people, many of them minors. Anything committed is
effectively permanent: git history survives file deletion, and a repository's visibility can
change. In December 2025 an app export (`hazu_admin.html`) was committed and sat in public
history for seven months, exposing 156 addresses. Its removal required rewriting every commit.

**Instead:**

| Need | Do this |
|---|---|
| A test fixture / example | Invent one at `@example.invalid` (RFC 2606 — can never resolve) |
| A generated report with real data | Write it to `output/` — gitignored, never committed |
| To debug against a real profile | Use the local SQLite DB or a scratch file outside the repo |
| To document a real case | Describe it structurally ("a student whose tag holds a UID"), no identifiers |

**Enforcement** — two automated guards, both backed by
[scripts/check-no-person-data.py](scripts/check-no-person-data.py):

- **git pre-commit hook** ([.githooks/pre-commit](.githooks/pre-commit)) blocks any commit whose
  staged content carries a disallowed address or a `hz-config-userid-<identity>` tag. Enable it
  once per clone: `git config core.hooksPath .githooks`
- **Claude Code PreToolUse hook** ([.claude/settings.json](.claude/settings.json)) blocks the
  `Write`/`Edit` before the data ever reaches disk.

The e-mail check is an **allowlist**: any domain not listed in the script is rejected, so a
school domain nobody anticipated is still caught the first time it appears. `output/` is exempt —
that is what it is for. Audit the whole repo any time with:

```bash
python3 scripts/check-no-person-data.py --all
```

If a guard fires, fix the data — do not weaken the guard.

## Project Overview

Cross-platform Electron + React desktop app for managing the Hazu educational platform. Syncs data locally to SQLite for offline management of persons, rooms, and assignments.

## Quick Commands

```bash
# Install dependencies
npm install

# Development (runs Vite + Electron concurrently)
npm run dev

# Build for production
npm run build

# Start built app
npm start

# Package for distribution
npm run dist
```

## Project Structure

```
hazu-admin/
├── src/
│   ├── main/                    # Electron Main Process (Node.js)
│   │   ├── index.ts            # App entry, window creation
│   │   ├── preload.ts          # IPC bridge (contextBridge)
│   │   ├── database/
│   │   │   ├── index.ts        # SQLite initialization
│   │   │   └── schema.sql      # Database schema
│   │   ├── ipc/
│   │   │   └── index.ts        # All IPC handlers
│   │   └── services/
│   │       ├── hazu-api/       # Hazu API client
│   │       │   ├── api.ts      # HTTP functions
│   │       │   ├── config.ts   # Environment config
│   │       │   ├── helpers.ts  # Utilities
│   │       │   └── interfaces.ts
│   │       ├── sync.service.ts # Hazu → SQLite sync
│   │       └── mission-sync.service.ts # Mission data sync
│   │
│   ├── renderer/               # React Frontend (Vite)
│   │   ├── App.tsx            # Main app with routing
│   │   ├── main.tsx           # React entry point
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── RoomsPage.tsx
│   │   │   ├── PersonsPage.tsx
│   │   │   ├── MatrixPage.tsx
│   │   │   ├── MissionAnalysisPage.tsx
│   │   │   ├── BulkImportPage.tsx
│   │   │   └── SettingsPage.tsx
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   └── Header.tsx
│   │   │   ├── mission-analysis/   # Mission dashboard viz components
│   │   │   │   ├── MissionSyncButton.tsx
│   │   │   │   ├── MissionFilterBar.tsx
│   │   │   │   ├── MissionTreemap.tsx
│   │   │   │   ├── MissionHeatmap.tsx
│   │   │   │   ├── MissionSummaryBar.tsx
│   │   │   │   └── MissionStudentList.tsx
│   │   │   ├── bulk-import/         # Bulk Import workflow components (uploader, mapping, matching, preview, verify)
│   │   │   ├── MatrixGrid.tsx       # Virtualized person × room assignment grid
│   │   │   ├── MatrixFilters.tsx
│   │   │   ├── CreatePersonModal.tsx
│   │   │   ├── CreateRoomModal.tsx
│   │   │   ├── DeleteConfirmationModal.tsx
│   │   │   ├── RenameRoomModal.tsx
│   │   │   └── TaskQueuePanel.tsx   # Task Queue UI (sequential writes)
│   │   ├── hooks/
│   │   │   └── useMatrixData.ts     # Loads + filters/sorts matrix data
│   │   ├── contexts/
│   │   │   └── TaskQueueContext.tsx # Sequential write queue for bulk operations
│   │   └── styles/
│   │       └── global.css      # Tailwind imports
│   │
│   └── shared/                 # Shared between main & renderer
│       ├── types.ts           # TypeScript interfaces
│       └── ipc-channels.ts    # IPC channel constants
│
├── dist/                       # Build output
├── package.json
├── tsconfig.json              # Renderer TypeScript config
├── tsconfig.main.json         # Main process TypeScript config
├── vite.config.ts             # Vite bundler config
├── tailwind.config.js
└── postcss.config.js
```

## Architecture

### Main Process (Electron)
- Runs in Node.js environment
- Handles SQLite database operations
- Makes HTTP requests to Hazu API
- Communicates with renderer via IPC

### Renderer Process (React)
- Runs in Chromium browser context
- No direct Node.js/filesystem access
- Uses `window.electronAPI` for all backend operations
- Styled with Tailwind CSS

### IPC Communication
All communication between renderer and main uses typed IPC channels:

```typescript
// Renderer calls:
const rooms = await window.electronAPI.getRooms();
const result = await window.electronAPI.runSync();

// Main handles via ipcMain.handle()
```

## Database Schema

### Core Tables
- `rooms` - Classes, companies, cantons, CIE locations
- `persons` - Students, teachers, mentors, advisors, guardians (includes `icon` and `color` columns for profession/level identification)
- `person_room_assignments` - Many-to-many relationships
- `change_log` - Track local modifications for n8n sync
- `settings` - App configuration (API key, environment, etc.)
- `tag_mappings` - Hazu tag → semantic type mappings

### Mission Analysis Tables
- `mission_tracking` - Per-student mission records (person_id, mission_name, is_official, lieu_de_formation, item_count, total_points)
- `mission_sync_status` - Tracks sync progress (students_processed, total_students, last_synced_at, status)

### Room Types (identified by tags)
| Tag | Type |
|-----|------|
| `hz-config-room-state` | Canton/State |
| `hz-config-room-class` | School class |
| `hz-config-room-entreprise` | Training company |
| `hz-config-room-cie` | CIE location |

### Person Types (identified by tag prefixes)
| Tag Prefix | Type |
|------------|------|
| `hz-share-student-*` | Student |
| `hz-share-companymentor-*` | Company mentor |
| `hz-share-schoolteacher-*` | School teacher |
| `hz-share-courseteacher-*` | Course teacher |
| `hz-share-stateadvisor-*` | State advisor |
| `hz-share-guardian-*` | Parent/Guardian |

## Key Files to Know

### When modifying IPC communication:
1. `src/shared/ipc-channels.ts` - Add channel constant
2. `src/main/ipc/index.ts` - Add handler
3. `src/main/preload.ts` - Expose to renderer + update types

### When adding new pages:
1. Create `src/renderer/pages/NewPage.tsx`
2. Add route in `src/renderer/App.tsx`
3. Add nav item in `src/renderer/components/layout/Sidebar.tsx`

### When modifying database:
1. Update `src/main/database/schema.sql`
2. Update `src/shared/types.ts` interfaces
3. Add IPC handlers in `src/main/ipc/index.ts`

## Hazu API

The app integrates with the Hazu platform API. Key functions in `src/main/services/hazu-api/api.ts`:

```typescript
sendApiRequestRead(id)           // Read single entity
sendApiRequestList(parentId)     // List children
sendApiRequestCreate(options)    // Create entity
sendApiRequestUpdate(id, options)// Update entity
sendApiRequestGetAclInfo(id)     // Get access control list
sendApiRequestAddGroup(id, group)// Add group access
```

### API Configuration
Stored in SQLite settings table:
- `api_key` - Hazu API key
- `environment` - "swiss" | "io" | "dev"
- `root_hazu_id` - Root Hazu ID to sync from
- `admin_id` - `hz-config-admin` Hazu ID (set by sync; used as `adminId`/`templateId` for user ops)
- `template_id` - Profile-templates container ID (set by sync)

### Person Creation

Handled by the `WEBHOOK_CREATE_PERSON` IPC handler in `src/main/ipc/index.ts` (the
channel name is legacy — it calls the Hazu API directly, not a webhook). Requires a
prior sync so `admin_id` and `template_id` exist in settings.

The modal ([CreatePersonModal.tsx](src/renderer/components/CreatePersonModal.tsx)) first
populates itself via two fetch handlers:
- `PROFILE_CATEGORIES_FETCH` — children of `root_hazu_id` tagged `hz-config-profile-*`; each
  category's `id` is also the **`targetId`** (container) for that role.
- `PROFILE_TEMPLATES_FETCH` — children of `template_id` with the exact tag
  `hz-config-profile-{role}`; the chosen template's `id` is the **`sourceId`**.

**Step 1 — create** via `POST /api-v2-admin/add-users` (**plural, batch**):
```jsonc
// request
{ "users": [ { "sourceId", "adminId", "targetId", "firstName", "lastName", "userEmail" } ] }
// response — the id is results[i].profileId. There is NO nested snapshot and NO `key` field.
{ "totalUsers": 1, "successful": 1, "failed": 0,
  "results": [ { "index": 0, "profileId": "…", "firstName": "…", "lastName": "…",
                 "userEmail": "…", "success": true } ],
  "errors": [] }
```
Read the new id from `results[0].profileId`. The response carries no tags/icon/color, so the
local `persons` row is minimal — the next Dashboard sync (`INSERT OR REPLACE` by `id`) enriches it.

**Step 2 — assign rooms** via the S4 reliable role-write path (`reliableUpdateUserRole`, see
[Reliable Role Writes (S4)](#reliable-role-writes-s4)), once per selected room. It still posts to
`POST /api-v2-admin/update-user-roles` with the same payload, now wrapped in retry + verify + local
reconcile:
```jsonc
{ "templateId": adminId, "profileId": <new id>,
  "userTypesInfo": [ { "classId": roomId, "oldUserType": "_", "newUserType": role } ] }
```
Each per-room call is wrapped in its own try/catch, so room-assignment failures stay logged-but-non-fatal (the person is already created).

> Note: `sendApiRequestCreateUser` in `api.ts` targets the older singular `add-user` endpoint
> and is **not** used by this flow — editing it will not affect person creation.

## Common Tasks

### Adding a new database query
```typescript
// 1. In src/main/ipc/index.ts
ipcMain.handle('myChannel', async (_event, param) => {
  return query('SELECT * FROM table WHERE col = ?', [param]);
});

// 2. In src/shared/ipc-channels.ts
MY_CHANNEL: 'myChannel',

// 3. In src/main/preload.ts
myMethod: (param: string) => ipcRenderer.invoke(IPC_CHANNELS.MY_CHANNEL, param),
// Also add to Window interface
```

### Adding a new React component
```tsx
// Use Tailwind for styling
function MyComponent({ title }: { title: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}
```

## Build Notes

### Native Modules
`better-sqlite3` requires native compilation for Electron. After `npm install`:
```bash
npx @electron/rebuild
```

### TypeScript Configs
- `tsconfig.json` - Renderer (React/Vite)
- `tsconfig.main.json` - Main process (Node.js/CommonJS)

### Tailwind CSS v4
Uses new import syntax:
```css
@import "tailwindcss";
```
With `@tailwindcss/postcss` plugin (not direct tailwindcss).

## Mission Analysis

The Missions tab provides a visual dashboard of student mission (MPE) completion across professions and levels (AFP/CFC).

### How it works
1. **Sync missions**: Click "Sync Missions" on the Missions tab. This fetches each student's mission data from the Hazu API and stores it locally in `mission_tracking`.
2. **Visualize**: Two chart views are available:
   - **Treemap** — Nested rectangles grouped by profession > level > mission count, sized by student count
   - **Heatmap** — Grid with profession+level on Y-axis, mission count on X-axis, colored by student count
3. **Filter**: Use the filter bar to narrow by lieu de formation (entreprise/ecole/cie), profession, level (AFP/CFC), or class.
4. **Drill down**: Click any chart cell to see the matching students with name, enterprise, mission count, and a link to their Hazu profile.

### Key files
- `src/main/services/mission-sync.service.ts` — Fetches and parses mission data from the API
- `src/renderer/pages/MissionAnalysisPage.tsx` — Main page with filters, charts, and student list
- `src/renderer/components/mission-analysis/` — All visualization components

### Prerequisites
- Run the main sync first (Dashboard > Sync) so persons have `icon` and `color` populated
- Then run "Sync Missions" on the Missions tab

## Matrix

The Matrix tab ([MatrixPage.tsx](src/renderer/pages/MatrixPage.tsx)) is a spreadsheet-style grid
for viewing and editing **person × room** assignments directly — persons are rows, rooms are
columns, and every cell is a role dropdown.

### How it works
- **Data** — [useMatrixData.ts](src/renderer/hooks/useMatrixData.ts) loads `getPersons()`,
  `getRooms()`, and `getAllAssignments()` from local SQLite and builds a `personId-roomId → role`
  lookup. No dedicated IPC — it reuses existing read channels.
- **Grid** — [MatrixGrid.tsx](src/renderer/components/MatrixGrid.tsx) is **virtualized** (only
  visible rows/columns rendered, plus a buffer), so it scales to large datasets. The person column
  and room headers stay pinned while cells scroll both directions.
- **Edit a cell** — pick a role from the dropdown (`-`, Student, Mentor, Teacher, Course T.,
  Advisor, Guardian). The change is applied **optimistically** to local state, then enqueued as a
  `roleUpdate` task — the **same** Task Queue + `updateUserRole` → `WEBHOOK_UPDATE_USER_ROLE` →
  S4 reliable role-write path the Bulk Import Assignment tab uses (retry + verify against group-ACL
  truth + local reconcile; see [Reliable Role Writes (S4)](#reliable-role-writes-s4)). On failure —
  including a write the server accepted but group truth does **not** confirm — the cell **reverts**
  via the task's `onError`.
- **Filter/search** — [MatrixFilters.tsx](src/renderer/components/MatrixFilters.tsx) toggles person
  and room types (empty selection = show all) and free-text searches both axes. Rows/columns sort by
  type then alphabetically; searching one axis "smart-sorts" the other so the top match's assigned
  rows/columns float to the front.
- **Delete / rename from headers** — hovering a room header reveals rename + delete; hovering a
  person row reveals delete. These open confirmation modals
  ([DeleteConfirmationModal.tsx](src/renderer/components/DeleteConfirmationModal.tsx),
  [RenameRoomModal.tsx](src/renderer/components/RenameRoomModal.tsx)) and call `deleteRoom` /
  `deletePerson` / `renameRoom` (`WEBHOOK_DELETE_ROOM` / `WEBHOOK_DELETE_PERSON` / `WEBHOOK_RENAME_ROOM`),
  then `refetch()` the grid. Unlike cell edits, these run **immediately** — not through the queue.

### Matrix vs. Bulk Import Assignment
Both write through the same `roleUpdate` task → `WEBHOOK_UPDATE_USER_ROLE` → S4 reliable role-write
helper (`reliableUpdateUserRole`; see [Reliable Role Writes (S4)](#reliable-role-writes-s4)). Matrix
is for **manual, one-cell-at-a-time** edits with live optimistic feedback; the Bulk Import
**Assignment** tab is for **batch** assignment from a spreadsheet. Deleting/renaming rooms and
deleting persons is Matrix-only.

### Prerequisites
- Run the main sync first (Dashboard > Sync) — the grid renders entirely from local SQLite.

## Bulk Import

The Bulk Import tab ([BulkImportPage.tsx](src/renderer/pages/BulkImportPage.tsx)) pushes spreadsheet data (CSV/Excel) **into** Hazu. One shared file upload feeds four sub-workflow tabs:

| Tab | Purpose | Writes |
|-----|---------|--------|
| **Room Creation** | Create rooms from one column of values, each with a template | Creates rooms |
| **Person** | Create persons (students, teachers…), optionally assigning rooms at creation (grouped) | Creates persons |
| **Assignment** | Assign **existing** persons to **existing** rooms with a role | Updates roles |
| **Verify** | Read-only diff of the spreadsheet vs. Hazu's synced state | Nothing |

### Task Queue (all writes go through it)
Writes are never called directly — each workflow **enqueues** tasks into the Task Queue
([TaskQueueContext.tsx](src/renderer/contexts/TaskQueueContext.tsx), rendered by
[TaskQueuePanel.tsx](src/renderer/components/TaskQueuePanel.tsx)). Tasks run **one at a time,
sequentially**, each tracked `queued → processing → success/error` with individual retry. Bulk
Import queues `createRoom`, `createPerson`, `roleUpdate`; the Discrepancies page queues `healTag`
(S3) and `revokeOrphanAccess` (S6) — the full `TaskType` union is all five. The footer buttons only
queue tasks; nothing hits the API until the queue processes them. Modals (create room/person) call
the API directly and push a completed `addNotification` into the same panel.

### Assignment workflow (assigns existing persons to existing rooms — creates nothing)
1. **Map columns** — tag one column as **Email** (`assignEmail`) and one as **Room** (`assignRoom`) in the data preview.
2. **Pick a role** — from synced user types (`getUserTypes()`): student, companymentor, schoolteacher, courseteacher, stateadvisor. Applies to the batch; overridable per row in the preview.
3. **Person Matching** ([PersonMatchingPanel.tsx](src/renderer/components/bulk-import/PersonMatchingPanel.tsx)) — unique emails auto-matched to local persons by **exact, case-insensitive email**; unmatched resolved manually (already-used persons filtered out to prevent double-assignment).
4. **Room Matching** ([RoomMatchingPanel.tsx](src/renderer/components/bulk-import/RoomMatchingPanel.tsx)) — unique room strings auto-matched to local rooms by **exact, case-insensitive title**; unmatched resolved manually. Exact-only (no fuzzy matching — that is Verify-only).
5. **Preview** ([AssignmentPreviewPanel.tsx](src/renderer/components/bulk-import/AssignmentPreviewPanel.tsx)) — resolved rows deduped by `personId:roomId`; rows already present in local `person_room_assignments` are flagged and **auto-excluded**. Toggle rows in/out; override role per row.
6. **Execute** — enqueues one `roleUpdate` task per included row.

Each `roleUpdate` → `updateUserRole(personId, roomId, oldRole, newRole)` → `WEBHOOK_UPDATE_USER_ROLE`
handler → the **S4 reliable role-write path** (`reliableUpdateUserRole`; see
[Reliable Role Writes (S4)](#reliable-role-writes-s4)). It still posts to
`POST /api-v2-admin/update-user-roles` (same endpoint Person Creation uses; `templateId` = `admin_id`),
now wrapped in retry + verify-against-group-ACL-truth. On a **confirmed** write it reconciles local
`person_room_assignments` **from truth** (`INSERT OR REPLACE`, or `DELETE` when the role resolves to
`_`), so no full re-sync is needed; a write the server accepted but truth contradicts returns
`success:false` (the task shows an error, and in Matrix the cell reverts).

### Verify workflow (read-only)
[VerifyAssignmentsTab.tsx](src/renderer/components/bulk-import/VerifyAssignmentsTab.tsx) diffs the
spreadsheet (email + room name) against synced assignments and reports *missing in Hazu*, *extra in
Hazu*, *unmatched rooms*, and *unknown persons*. Room names are matched via strict/normal/loose
fuzzy modes ([fuzzyMatch.ts](src/renderer/utils/fuzzyMatch.ts)). Good to run before and after an
Assignment batch.

### Prerequisites
- Run the main sync first (Dashboard > Sync). Persons, rooms, roles, and `admin_id` all come from
  local SQLite — Assignment/Verify only match against already-synced data.

## Reliable Role Writes (S4)

Role assign/remove writes — Matrix cell edits, Bulk Import **Assignment**, and person-creation room
assignment — all go through one hardened helper so a write is **never falsely reported as
succeeding**. It keeps the designated `POST /api-v2-admin/update-user-roles` endpoint (no ACL/group
bypass) but wraps it in **retry → verify-against-group-ACL-truth → reconcile-local**.

### Files
- [role-write.ts](src/main/services/role-write.ts) — **pure core**, all IO injected (no DB/HTTP
  imports; unit-tested without the native module): `isRetryableError`, `backoffMs`,
  `evaluateVerification` (the assign/remove/change decision table), and the `runReliableRoleWrite`
  orchestrator. Tests in [role-write.test.ts](src/main/services/role-write.test.ts).
- [role-write.service.ts](src/main/services/role-write.service.ts) — **thin IO layer**:
  `reliableUpdateUserRole(personId, roomId, oldRole, newRole)` gathers `admin_id`, the person's
  `email`, and the role-group ids from SQLite, builds the real deps (axios POST +
  `sendApiRequestGetAclInfo` membership reads + `sleep`), runs the orchestrator, then reconciles
  local `person_room_assignments`.

### Flow (all IO injected into the pure core)
1. **Write, retrying only transient failures** — POST `update-user-roles`; retry on 5xx / network /
   timeout with exponential backoff (`500 * 2^n`, up to 3 attempts). A 4xx fails fast.
2. **Verify against group truth** — re-read the role-GROUP ACL (up to 3 reads, 750 ms apart, to ride
   out cache lag) and match the person against ACL entries by email (`description`) **or account id
   (`authorId`)**, skipping `isGroup` entries (`isIdentityInAcl`). The authorId path matters because
   `persons.email` sometimes holds the account UID rather than an email (a Hazu data quirk) — when it
   does, it equals the ACL entry's `authorId`, not its `description`. If the local identity is neither
   a valid email nor a matched account id, verification is treated as **cannot-verify** (trust the 2xx)
   rather than a false negative. Groups are truth; profile tags are not consulted here.
   Verification also runs after a **failed** write, for the reason in the success rule below — a
   4xx is the one exception (rejected at the boundary; a read there could only ever confirm
   pre-existing state and would mask a malformed request).
3. **Reconcile local from truth** — write local `person_room_assignments` to match what the ACL
   actually shows (`INSERT OR REPLACE`, or `DELETE` when the role resolves to `_`) after a 2xx, or
   after a failed write that truth nonetheless **confirms**. The reconcile runs in its own try/catch
   so a local-DB failure can't flip a real API success. A failure truth does *not* confirm leaves
   local state untouched.

### Success rule
**Group truth outranks the status code, in both directions.** Where truth could be read,
`success = verified`; where it could not, `success = postOk`. Concretely:

- a 2xx that group truth **contradicts** → `success:false` (the caller shows an error; in Matrix the
  cell reverts);
- a **transport failure (5xx / network / timeout) that truth confirms** → `success:true`, and local
  state reconciles to truth. This is not defensive coding: measured against this endpoint, two
  profiles returned HTTP 500 on all four add attempts while the member actually landed in the group,
  and 15 of 22 non-responses in the full sweep had in fact been applied. **A failure status carries
  no information about whether the write committed** — only the group ACL does. Without this, Matrix
  reverts a cell whose change actually took effect.
- a write that **cannot be verified** (blank email, role-group not synced locally, or an ACL read
  error) → falls back to the status code: a 2xx is trusted and reconciled optimistically to the
  intended role; a failure stands as a failure.

Each write logs one concise `[role-write] … success=… postOk=… verifyRan=… verified=… attempts=…`
line to the main-process console — a write that landed despite a transport failure reads as
`success=true postOk=false verified=true`. The IPC handler contract is unchanged
(`{ success, error? }`), so the renderer's Task Queue needs no change; the behavior changes are that
an unconfirmed write now correctly reports failure instead of a silent success, and a confirmed
write now correctly reports success instead of a false failure. (The old fire-and-forget `ASSIGNMENTS_EXECUTE`
handler + its `executeAssignments` preload method were removed — they had no renderer callers.)

## Orphan Access Removal (S6)

The Discrepancies page ([DiscrepanciesPage.tsx](src/renderer/pages/DiscrepanciesPage.tsx)) reports
where profile tags and group-ACL truth disagree, computed read-only from the last sync
(`membership_issues`, populated during sync). One row type, **`unknown`** — a group member with an
account id but no local Hazu profile at all, an **orphan** — gets a per-row **`Revoke access`**
button. The rationale: an account with no profile doesn't need room access, so removing it is safe.
This is the one **destructive** write path in the app; every other Discrepancies action (`healTag`,
S3) only adds a tag.

### Access lives in two places
An orphan's access is not just the role-group membership. For roughly two-thirds of measured
orphan grants, Hazu also carries a **direct entry on the room item itself** — and critically,
**that direct grant is recorded with `isGroup: true`**. Revocation therefore removes and verifies
both places: the role group and, when present, the direct room-item ACL entry. Removing only the
group would make the discrepancy row disappear while the room access stayed live — worse than
doing nothing, because the report would go quiet.

### The `isGroup` trap — do not reuse `isIdentityInAcl` here
[role-write.ts](src/main/services/role-write.ts)'s `isIdentityInAcl` **skips entries where
`isGroup` is true** — correct for S4's role-group verification, where a group is never itself a
member of the group. But an orphan's direct room-item grant *is* stored with `isGroup: true`, so
running it through `isIdentityInAcl` would report "absent" for access that is still live, turning a
failed revocation into a false success. [orphan-removal.ts](src/main/services/orphan-removal.ts)
therefore has its own predicate, **`findAccountOnAcl`** (and its boolean wrapper `isAccountOnAcl`),
which matches by account id **without** the `isGroup` skip. If you ever find yourself reaching for
`isIdentityInAcl` to check a room-item ACL, stop — that is this trap.

### Files
- [orphan-removal.ts](src/main/services/orphan-removal.ts) — **pure core**, all IO injected:
  `findAccountOnAcl` / `isAccountOnAcl` (the `isGroup`-safe predicate above), `evaluateRemoval` (the
  both-ACLs-absent decision), and the `runOrphanRemoval` orchestrator. Reuses `isRetryableError` /
  `backoffMs` from role-write.ts. Tests in
  [orphan-removal.test.ts](src/main/services/orphan-removal.test.ts).
- [orphan-removal.service.ts](src/main/services/orphan-removal.service.ts) — **thin IO layer**:
  `planOrphanRemoval(accountId, groupId, roomId)` reads both ACLs live and returns the grants found,
  **throwing** if either ACL can't be read (an unreadable ACL is never treated as an absent grant);
  `revokeOrphanAccess(accountId, groupId, roomId)` re-plans internally, runs the core with real
  deps (`sendApiRequestRemoveUserChecked` + `sendApiRequestGetAclInfo` reads + `sleep`), then
  reconciles `membership_issues` in its own try/catch.
- `src/main/ipc/index.ts` — `ORPHAN_ACCESS_PLAN` (read-only) and `ORPHAN_ACCESS_REVOKE` (write)
  handlers, both `(accountId, groupId, roomId)`.
- [TaskQueueContext.tsx](src/renderer/contexts/TaskQueueContext.tsx) — `revokeOrphanAccess` task
  type, alongside `roleUpdate` / `createRoom` / `createPerson` / `healTag`.
- [RevokeAccessConfirmationModal.tsx](src/renderer/components/RevokeAccessConfirmationModal.tsx) —
  lists every grant about to be removed (role group, and the room item when present, with its
  `aclRole`) and states plainly that this is destructive.
- [DiscrepanciesPage.tsx](src/renderer/pages/DiscrepanciesPage.tsx) — the `Revoke access` button
  (only on `unknown` rows carrying both `uid` and `groupId`); click calls the plan channel and opens
  the modal; confirming enqueues one `revokeOrphanAccess` task; `refetch()` once it settles.

### Flow
1. **Plan** — read the group ACL and the room ACL live; emit one grant per place the account
   actually appears. Throws if either ACL can't be read, so the modal never under-promises what
   will be removed.
2. **Execute, retrying only transient failures** — re-plan internally from the confirmed ids
   (the IPC call only carries `accountId`/`groupId`/`roomId`, not the grant list the modal showed;
   re-planning can only shrink the delete set, never grow it), then `DELETE /acl` per grant via
   `sendApiRequestRemoveUserChecked`, retrying 5xx/network/timeout with backoff. A 4xx fails fast.
3. **Verify against both ACLs regardless of the plan** — re-read the role-group and room-item ACLs
   (up to 3 reads, 750 ms apart, to ride out cache lag) with `isAccountOnAcl`. Unlike S4, this still
   runs after a non-retryable 4xx — a 404 from `DELETE /acl` plausibly means "already absent," and
   the read answers that directly rather than short-circuiting on the status code.
4. **Reconcile local from truth** — on a confirmed removal, delete the matching `membership_issues`
   row, in its own try/catch so a local-DB failure can't flip a real API success. Any survival
   leaves local state untouched.

### Success rule
**Truth outranks the status code, in both directions, and a partial removal is always a failure.**
Success requires an ACL read confirming the account is absent from **both** the role group and the
room item:

- a delete that returns 2xx but truth still shows the account on either ACL → `success:false`,
  naming which one survived;
- a delete that fails (5xx/network/timeout/4xx) but truth confirms the account is gone from both →
  `success:true`, reconciled locally — the same "don't trust the status code" lesson as S4;
- one grant gone and the other still present → always `success:false`, never reported as done;
- truth unreadable (an ACL read error) → falls back to the delete status codes.

Each write logs one line to the main-process console:
`[orphan-removal] account=… room=… group=…: success=… deleteOk=… verifyRan=… verified=…
surviving=[…] attempts=…`.

## Dead-Tag Pruning (S7)

The Discrepancies page also reports **unmatched class ids** — breadcrumb tags of the form
`hz-config-class-<classId>-<role>` on real profiles that name a class id no local room maps to.
Most of these are dead: the room was deleted in Hazu, but nobody cleaned up the breadcrumbs it
left on every assigned person's profile. A **`Check & prune missing rooms`** button probes each
unmatched id live and, on confirmation, permanently deletes the corresponding tags. Unlike S3's
`healTag`, which only adds a tag, this is destructive — the second destructive write path in the
app, after S6.

### The 404-only rule
Only a literal HTTP 404 on the class id's `read` call authorises deleting its tags. A bad key
turns every id whose room still **exists** into a 401; treating a 401 as "deleted" would arm the
prune against exactly those live rooms. So `classifyReadResult` in
[tag-prune.ts](src/main/services/tag-prune.ts) maps anything that isn't a success and isn't a
404 — 401, 403, 500, a timeout, a dropped connection — to `unreadable`, and `unreadable` is
always a skip, never a delete.

**Measured 2026-08-17, and not what the design originally assumed.** A bad key does *not* fail
every read. `GET /read` answers **404 for an unknown id regardless of the key**, and 401 only for
an id that exists; an empty key gives 500. The rule is therefore both narrower and more necessary
than "a broken key breaks everything": a credentials failure cannot manufacture a 404, but it can
strip the protection off every live room in the set, and only the 401→`unreadable` mapping keeps
those tags safe.

The practical consequence is for whoever tests this next. Breaking the API key and re-running the
button proves nothing on its own — today's fifteen unmatched ids are all genuinely dead, so they
answer 404 either way and the modal looks identical whether the rule works or not. To exercise the
rule you need an unmatched id that is **alive**: delete one live room's row from the local `rooms`
table (a sync restores it), and confirm the button counts it while the modal skips it — "Still
exists" with a good key, "Could not read" with a broken one, and the delete total unchanged in
both. Verified that way on 2026-08-17.

### `planTagPrune` does not throw on a failed read — unlike S6
S6's `planOrphanRemoval` throws when an ACL can't be read, because its plan enumerates what will
be *destroyed*: an unreadable ACL there could make the modal under-promise what removal will do.
S7's plan is the opposite shape. An unreadable class id only ever **removes** work from the
delete set — it can never add to it — so one flaky read must not block pruning every other
confirmed-dead id. `planTagPrune` therefore reports a failed read as a skip and keeps going. Do
not "fix" this asymmetry into S6's shape; it follows from what each plan is proving.

### Deletions are grouped by class id, not flattened
A person's plan entry carries `items: Array<{ classId, tags }>`, one entry per class id, rather
than two parallel `classIds`/`tags` arrays. The re-probe (below) must be able to confirm one of a
person's class ids as still-404 while the read for another comes back alive or unreadable, dropping
only that id's tags while still deleting the rest. Flat parallel arrays cannot express "drop this
one id's tags and keep the others" — a `PruneItem[]` grouped by id can.

### The re-probe is the authorisation, not the plan
The plan the operator confirms in the modal licenses nothing by itself. `runTagPrune` re-probes
each class id in its own task's payload before deleting anything, and only a fresh 404 confirms a
tag for deletion. Re-planning can only shrink a delete set between the modal and execution, never
grow it — exactly the S6 discipline (re-plan from confirmed ids, not from what the modal showed).

### Truth outranks the status code, in both directions
Same rule as S4 and S6. After the delete call, `runTagPrune` re-reads the person's profile tags
(up to 3 reads, 750 ms apart, riding out cache lag) and lets that read decide, not the delete's
HTTP status: a 2xx delete whose tags survive the read is not a success, and a delete that failed
transiently but whose tags are confirmed gone by the read is. Truth unreadable falls back to the
delete status code. A run that re-probes to zero confirmed ids is not a failure — it deletes
nothing, succeeds, and says so (see the Task Queue label handling in
[TaskQueuePanel.tsx](src/renderer/components/TaskQueuePanel.tsx)).

### Files
- [tag-prune.ts](src/main/services/tag-prune.ts) — **pure core**, all IO injected: `classifyReadResult`
  (the 404-only rule), `buildPrunePlan`, `probeClassIds`, and the `runTagPrune` orchestrator. Tests
  in [tag-prune.test.ts](src/main/services/tag-prune.test.ts).
- [tag-prune.service.ts](src/main/services/tag-prune.service.ts) — **thin IO layer**:
  `planTagPrune()` and `pruneDeadTags(personId, items)`, wiring real reads/deletes/sleep and
  reconciling local `persons.tags` from the confirmed-deleted set.
- `collectUnmatchedClassIds` in [discrepancy.ts](src/main/services/discrepancy.ts) — the single
  definition of "needs probing": every class id referenced by a breadcrumb tag that maps to no
  local room, grouped by id with its holders and their tags.
- `sendApiRequestRemoveTagsChecked` in [hazu-api/api.ts](src/main/services/hazu-api/api.ts) — the
  checked tag-removal call `runTagPrune` deletes through.
- `src/main/ipc/index.ts` — `TAG_PRUNE_PLAN` (read-only, rethrows so a failed plan reaches the
  page's error banner rather than opening an empty modal) and `TAG_PRUNE_EXECUTE` (write, returns
  its failure so the Task Queue can render and retry it).
- [TaskQueueContext.tsx](src/renderer/contexts/TaskQueueContext.tsx) — `pruneDeadTags` task type,
  alongside `roleUpdate` / `createRoom` / `createPerson` / `healTag` / `revokeOrphanAccess`.
- [PruneTagsConfirmationModal.tsx](src/renderer/components/PruneTagsConfirmationModal.tsx) —
  shows the tag/person/room counts to delete and the skipped ids with their reason, before
  confirming enqueues one `pruneDeadTags` task per person.
- [DiscrepanciesPage.tsx](src/renderer/pages/DiscrepanciesPage.tsx) — the
  `Check & prune missing rooms` button; click probes live and opens the modal; confirming enqueues
  the tasks; `refetch()` once they settle.

### Success rule
Same shape as S4 and S6: where the profile-tag read could confirm the outcome, that read decides;
where it could not, the delete's status code decides.

- a 404-confirmed id whose tags survive the follow-up read → not deleted, `success:false`, naming
  which tags remain;
- a delete that fails transiently but the follow-up read confirms the tags are gone →
  `success:true`, reconciled locally;
- an id that re-probes as `alive` or `unreadable` is dropped from the delete set before the call
  is even made — reported as skipped, not as failed;
- every id in a task skipped → `success:true`, zero tags deleted, reported as such rather than as
  an unqualified success (see the Important-#1 fix in the Task Queue panel).

## Room Tree Sync (S8)

`syncRooms` (in [sync.service.ts](src/main/services/sync.service.ts)) walks the **whole** Hazu room
tree instead of stopping two levels below root. The old code assumed every room sat directly under
its category; in practice CIE rooms live inside year sub-folders, so a fixed-depth walk missed them.

### Files
- [room-tree.ts](src/main/services/room-tree.ts) — **pure core**, no DB/HTTP/Electron import (only
  `RoomType` from `shared/types`): tag classification (`classifyNode`, `identifyRoomType`,
  `extractClassId`), the depth-capped `walkRoomTree` orchestrator, and `summarizeWalkNotes` — the
  log-line grouping renderer described below. The child-lister (`listChildren`) is injected, so the
  whole walk runs under vitest without the native SQLite module or the network.
- [room-tree.test.ts](src/main/services/room-tree.test.ts) — covers classification, walk depth /
  truncation / read-failure / cycle behavior, and `summarizeWalkNotes` grouping, entirely against
  fake in-memory trees.
- `syncRooms` itself supplies the real IO (`sendApiRequestList`, wrapped to bump
  `syncProgress.message` — see below) and writes the walk's `categories`/`rooms` into SQLite.

### What changed for rooms already in the database
Nothing observable for the 123 rooms synced under the old two-level walk — same `id`, `class_id`,
`room_type`, `parent_id`. What changes is what else now shows up:

- **`parent_id` may name a folder that has no row of its own.** A room found three or four levels
  down (e.g. inside a CIE year sub-folder) is written with `parent_id` set to that sub-folder's Hazu
  id — a container the walk passed through but never wrote to `rooms`, since only categories and
  rooms are persisted. Anything that assumes `parent_id` always resolves to a row in `rooms` needs
  to handle a miss.
- **`room_type` resolution order changed.** It used to be inherited from the category
  unconditionally; now it's **self-tag first, nearest typed ancestor as fallback** — a room several
  folders under an "état" category but itself carrying `hz-config-room-cie` is typed `cie`, not
  `state`. See `classifyNode` in room-tree.ts.
- **Category folders still keep `parent_id = root_hazu_id`.**
  [CreateRoomModal.tsx:86](src/renderer/components/CreateRoomModal.tsx) finds a category container
  by exactly `room_type === type && parent_id === rootHazuId` — the walk never emits a category at
  any other depth, and (see below) never emits a *room* at depth 1 either, so that predicate keeps
  meaning exactly one thing.

### Depth cap and what it never does
`walkRoomTree` defaults to `maxDepth = 4` (`DEFAULT_MAX_DEPTH`), counted from root: depth 1 is the
category layer, depth 2 is directly under a category, and so on. Two things it deliberately never
does, plus one guard:

- **It never descends into a room.** A `hz-config-class-*` node's children are course content
  (missions, assignments), not rooms — walking into them would misclassify content as rooms.
- **It never treats an unreadable subtree as empty.** If `listChildren` returns `null` for a
  container, that container is recorded in `readFailures` and skipped — its absence from `rooms`
  reads as "unknown", not "confirmed empty". A failed **root** listing is the one exception: it
  *throws*, because `clearOldData()` has already emptied the `rooms` table before `syncRooms` runs,
  so swallowing that failure would silently wipe every room in the app.
- A room found at **depth 1** (directly under root, bypassing the category layer) is recorded in
  `unexpectedRooms` and dropped rather than written — writing it would give it `parent_id = rootId`,
  indistinguishable from the category predicate above. No root child was class-tagged when this
  shipped, so the case is theoretical — but it now fails loudly (a console warning) instead of
  silently misdirecting `CreateRoomModal`.

### Expect a standing baseline of warnings on every sync
Two sources of noise are expected on **every** sync, not signs of new breakage:
- *Calendrier scolaire*'s ~62 calendar-entry children each return 401 when the walk tries to list
  their own children — they land in `readFailures`.
- Some CIE course nodes sit exactly at the depth-4 cap and are recorded in `truncatedAt` rather than
  descended into.

Both are logged **grouped by parent**, via the exported `summarizeWalkNotes(notes, maxGroups?)` —
e.g. `62 under "Calendrier scolaire" (62 total)` instead of 62 separate lines. A flat per-node list
at that volume trains the reader to stop scanning it, which is exactly what a *new*, unexpected
failure needs not to happen to it. `summarizeWalkNotes` is pure — it takes already-HTML-stripped
`WalkNote[]`, since `room-tree.ts` has no `stripHtml` to call; `syncRooms` strips titles as it
builds the input. The total count is always printed, capped group lines or not, so the summary can
never read as complete when a group got collapsed.

### Progress reporting
The walk is strictly sequential and runs to roughly 77 `listChildren` calls on the first sync
(vs. 5 under the old two-level walk). `syncRooms` wraps the injected `listChildren` in a closure
that bumps a counter and updates `syncProgress.message` before delegating to `sendApiRequestList` —
the same pattern `syncDistributionGroups` and `syncGroupMemberships` use for their own phases — so
the Dashboard doesn't sit on one unchanging string for a long silent stretch. `room-tree.ts` itself
gets no progress callback; the injected-IO seam already does that job.

## Testing the App

1. Run `npm run build`
2. Run `npm start`
3. Go to Settings → Enter API key and Root Hazu ID
4. Click "Sync Now" on Dashboard
5. View synced data in Rooms/Persons pages
6. Open the Matrix tab → edit an assignment cell (optimistic update; runs through the reliable role-write path — verified against group truth, reverts if the change isn't confirmed)
7. Go to Missions tab → Click "Sync Missions" → View mission analysis charts
8. Go to Bulk Import → upload a CSV → try Room/Person/Assignment/Verify (writes run through the Task Queue panel)
9. Go to Discrepancies → try "Heal all missing-tags" on a `missing-tag` row, then "Revoke access" on an `unknown` row (confirm the modal lists every grant, then verify against group truth — reverts to an error if not confirmed)
9b. On the same page, click "Check & prune missing rooms" (probes every unmatched class id live);
   confirm the modal, which lists the tags/persons/rooms to delete and any skipped ids with their
   reason; each confirmed person becomes one `pruneDeadTags` task, re-probed against Hazu before
   deletion and verified against a fresh profile read after

## Future Development

### Phase 2: Full UI
- Room detail pages with assigned persons
- Person detail pages with room assignments
- Search and filtering

### Phase 3: Change Tracking
- Local modifications logged to `change_log`
- Review pending changes before sync
- n8n webhook integration for pushing changes

> Excel/CSV import (persons, rooms, assignments) with validation preview is **implemented** —
> see the [Bulk Import](#bulk-import) section above.
