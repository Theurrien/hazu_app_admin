# Hazu Admin

A desktop application for managing the Hazu educational platform — sync rooms, persons, and assignments from the Hazu API, visualize mission completion, and run bulk operations from a fast offline-first interface.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
![Electron](https://img.shields.io/badge/electron-39+-blue)
![React](https://img.shields.io/badge/react-19-61dafb)
![TypeScript](https://img.shields.io/badge/typescript-5.9-3178c6)

---

## What it does

Hazu Admin connects to the Hazu platform API, mirrors your data into a local SQLite database, and gives you a set of management tools:

- **Sync** — pull rooms, persons, and assignments from your Hazu environment on demand
- **Room & Person pages** — browse and inspect all synced entities
- **Assignment Matrix** — a grid view of every person–room assignment, filterable by type
- **Bulk Import** — upload an Excel file to create rooms, create persons, or assign existing persons to rooms, with live preview and per-row control
- **Mission Analysis** — treemap and heatmap dashboards showing student MPE completion by profession, level, and lieu de formation, with drill-down to individual students
- **Discrepancies** — a read-only report of every place Hazu's access groups and its profile tags disagree, with repair actions for the fixable cases
- **Task Queue** — all API writes run through a background queue with per-task status, error reporting, and retry; writes are verified against the server afterwards and marked failed if the change didn't actually take effect

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Install

```bash
git clone https://github.com/Theurrien/hazu_app_admin.git
cd hazu_app_admin
npm install       # also rebuilds native modules for Electron automatically
npm run build
npm start
```

### Configure

On first launch, open **Settings** and fill in:

| Setting | What to enter |
|---------|---------------|
| API Key | Your Hazu platform API key |
| Environment | `swiss` (production), `io`, or `dev` |
| Root Hazu ID | The ID of the root Hazu to sync from |

Then go to **Dashboard → Sync Now** to pull your data.

---

## Usage

### Rooms & Persons

After syncing, the **Rooms** and **Persons** pages list all entities pulled from your Hazu environment.

Rooms are grouped by type:

| Type | Description |
|------|-------------|
| State | Cantons / geographic regions |
| Class | School classes |
| Enterprise | Training companies |
| CIE | Inter-company course locations |

Persons are grouped by role: Student, School Teacher, Course Teacher, Company Mentor, State Advisor, Guardian.

### Bulk Import

Go to **Bulk Import** and pick a workflow tab:

**Create Rooms** — upload a file with room names, pick a room type and template, and queue creation tasks.

**Create Persons** — upload a file with first name, last name, and email columns. Map columns, select a role and profile template, optionally assign grouping columns to link persons to rooms automatically on creation.

**Assign Persons to Rooms** — upload a file with email and room columns. Map columns and pick a role. The app:

1. Resolves each email to a known person and each room name to a known room
2. Flags unresolved entries for manual matching
3. Shows a preview table before you execute — rows already assigned are flagged with their current role and unchecked by default, per-row roles can be changed inline, any row can be unchecked to skip it
4. Queues all included rows into the Task Queue when you click **Assign**

**Verify** — cross-check your file against current assignments to spot gaps or duplicates before importing.

All operations flow through the **Task Queue** panel (top-right) so you can monitor progress, inspect errors, and retry individual failed items without re-importing the file.

### Assignment Matrix

A grid with persons on one axis and rooms on the other. Filter by room type and person type to focus on a specific segment. Edit any cell's role inline — the change is written through the reliable role-write path, verified against the server, and reverted if it didn't take effect, so the grid reflects the real assignment rather than an optimistic guess.

### Discrepancies

Hazu records who has access to a room in two places: the room's **role groups**, which actually
grant access, and **breadcrumb tags** on each person's profile, which merely describe it. The
groups are the truth; the tags drift. This page reports every place the two disagree, computed
offline from the last sync, and offers a repair where one is safe.

| Row type | What it means | Action |
|---|---|---|
| Missing tag | The person is in the group but carries no matching tag | **Heal** — adds the tag |
| Orphan tag | The person carries a tag but is not in the group | None — reported only |
| Unresolved | A group member the sync could not match to a profile | None — reported only |
| Unknown | A group member with an account but no profile at all | **Revoke access** — removes the grant |

Two batch actions sit in the header. **Heal all missing-tags** adds every missing breadcrumb.
**Check & prune missing rooms** probes each class id a tag points at against the live API and,
on confirmation, deletes the tags of rooms Hazu no longer has.

Both destructive actions — revoking access and pruning tags — show you exactly what they will
remove before they do it, and neither trusts the API's success response. Every write is confirmed
by re-reading the server afterwards, and a write the server accepted but the re-read contradicts
is reported as a failure. Only a literal `404` on a room id authorises deleting its tags; a
credentials failure, a timeout, or any other error leaves the tags alone.

### Mission Analysis

1. Run a full sync first (**Dashboard → Sync Now**) so person data is fully populated
2. Go to **Missions → Sync Missions** to fetch per-student mission records from Hazu
3. Choose **Treemap** or **Heatmap** view
4. Filter by lieu de formation, profession, level (AFP / CFC), or class
5. Click any chart cell to see matching students with name, enterprise, mission count, and a direct link to their Hazu profile

---

## For Developers

### Dev setup

```bash
npm install
npm run dev     # Vite + Electron with hot reload
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Development mode with hot reload |
| `npm run build` | Production build |
| `npm start` | Run the built app |
| `npm run dist` | Package for distribution |
| `npm test` | Run the unit suite (vitest) |
| `npm run test:watch` | Same, in watch mode |

### Tests

The write paths that touch real people's data — role assignment, access revocation, tag pruning,
and the room-tree walk — are each split into a **pure core** with every side effect injected, and
a thin IO layer that supplies the real database and HTTP calls. The core carries the decisions:
what counts as a retryable failure, what the server's answer proves, what may be deleted. It
imports nothing from SQLite, axios, or Electron, so the whole decision layer runs under vitest in
under a second with no native module and no network.

```bash
npm test
```

The IO layers have no unit tests by design; they need a live API and the native module. Their gate
is the typecheck, the unchanged suite, and a manual acceptance run against real data.

### Person data — read this before committing

This app manages data about real people, many of them minors. **Never put real names, e-mail
addresses, or Hazu profile IDs into tracked files** — not in source, tests, docs, fixtures, or
commit messages. Git history survives file deletion and a repository's visibility can change; a
single committed export once sat in public history for seven months.

Use `@example.invalid` addresses and invented IDs in fixtures, and write any report containing real
data to `output/`, which is gitignored. Two automated guards enforce this — a pre-commit hook and
an editor hook — both backed by the same script:

```bash
python3 scripts/check-no-person-data.py --all
```

Enable the commit hook once per clone with `git config core.hooksPath .githooks`. If a guard fires,
fix the data rather than the guard. [CLAUDE.md](CLAUDE.md) has the full rule.

### Project structure

```
├── src/
│   ├── main/                  # Electron main process (Node.js)
│   │   ├── database/          # SQLite initialisation & schema
│   │   ├── ipc/               # All IPC handlers
│   │   └── services/          # Hazu API client & sync logic
│   ├── renderer/              # React frontend (Vite)
│   │   ├── pages/             # One file per app page
│   │   ├── components/        # Shared UI components
│   │   └── contexts/          # TaskQueue context
│   └── shared/                # Types & IPC channel constants
├── docs/
│   ├── specs/                 # Design specs, one per feature stage
│   └── plans/                 # Implementation plans built from those specs
├── scripts/                   # Repo tooling (person-data guard)
├── dist/                      # Build output
├── output/                    # Generated reports with real data — gitignored
└── release/                   # Packaged distributables
```

IPC communication: `renderer → preload (contextBridge) → ipcMain handlers → SQLite / Hazu API`

### Tech stack

| Layer | Technology |
|-------|------------|
| Runtime | Electron 39 |
| Frontend | React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| Icons | Font Awesome 6 |
| Database | better-sqlite3 |
| Charts | ECharts (echarts-for-react) |
| Bundler | Vite 7 |
| Packaging | electron-builder |

### Extending the app

- **New IPC channel** — add a constant to `src/shared/ipc-channels.ts`, a handler to `src/main/ipc/index.ts`, and expose it in `src/main/preload.ts`
- **New page** — create `src/renderer/pages/NewPage.tsx`, add a route in `App.tsx`, add a nav item in `Sidebar.tsx`
- **New database column** — update `src/main/database/schema.sql` and the corresponding interface in `src/shared/types.ts`
- **New Task Queue action** — extend the `TaskType` union and the queue processor in `src/renderer/contexts/TaskQueueContext.tsx`, and add a `getLabel()` case in `TaskQueuePanel.tsx`. The switch has no exhaustiveness check, so a missing case renders a blank row and the compiler stays silent.
- **New write against the Hazu API** — follow the pure-core-plus-thin-IO split the existing write paths use, and verify the write by re-reading the server rather than trusting its status code. The endpoints return 500s and timeouts for writes that committed, and 200s for writes that did not.

---

## License

MIT — built for the [Hazu](https://hazu.ch) educational platform.
