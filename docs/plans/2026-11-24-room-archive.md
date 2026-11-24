# Room Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Archive tab that moves one room (class, CIE course, company, canton) with its role groups into a hidden per-room folder in the admin Hazu, removes the members' class tags, and restores it exactly.

**Architecture:** House pattern — a pure core `room-archive.ts` (every Hazu call injected, vitest-runnable) holding the skip-if-done step logic for archive and restore, a thin `room-archive.service.ts` IO layer (real API calls, settings, SQLite reconcile), IPC channels, and an `ArchivePage` whose writes run as Task Queue tasks. The archive record lives in tags on the per-room folder; no new table.

**Tech Stack:** Electron, React, TypeScript, better-sqlite3, axios, vitest.

**Spec:** [docs/specs/2026-11-24-room-archive-design.md](../specs/2026-11-24-room-archive-design.md) — read it before any task. Probe evidence: [docs/archive-move-probe-findings.md](../archive-move-probe-findings.md).

## Global Constraints

- **Access is never changed.** No call to `/api-v2-hazus/{id}/groups`, `/api-v2-permissions/acl` (POST/DELETE), `/acl` DELETE or `propagatePermissionsApi` anywhere in this feature.
- **Nothing is deleted except** the two empty archive folders at the end of a restore, and only after a live listing shows them empty.
- Move: `PUT https://{endpoint}/moveElement`, body `{ id, targetHazuId, loginId }`, header `x-api-key`, `loginId` = setting `user_id`. Success = `200 {"isSuccess":true}`; the live read after it decides.
- Record tags, verbatim: `hz-config-archive` (Archive Hazu), `hz-config-archive-room` (per-room folder), `hz-config-archive-groups` (« Groupes de partage » folder), `hz-config-archive-class-{classId}`, `hz-config-archive-from-{originalParentId}`, `hz-config-archive-type-{class|cie|enterprise|state}`, `hz-config-archive-at-{ms}`.
- Folder titles: Archive Hazu `Archive`; per-room folder = the room's title (HTML stripped); groups folder `Groupes de partage`.
- Profile tag removed on archive / added on restore: exactly `hz-config-class-{classId}-{role}` for `role` in the synced user types. Match the whole tag, never a prefix (class id `abc` must not match `abcd`). The room's own `hz-config-class-{classId}` tag is never touched.
- Order of archive: record folder → groups → room → tags → local reconcile. Order of restore: room → groups → tags → empty folders → local reconcile.
- Every step reads the live state first and skips what is done; a re-run finishes a stopped run.
- Retry transient failures (5xx, 408, 429, network/timeout) with `isRetryableError` / `backoffMs` from `role-write.ts`, 3 attempts. 4xx fails fast.
- Verify tag writes by re-reading the profile: up to 3 reads, 750 ms apart (S7 rule).
- Page `archive` is complete mode only; added in `src/shared/app-mode.ts`. UI copy in French.
- Person-data rule (CLAUDE.md): fixtures use invented ids and `@example.invalid`; no real names, e-mails or profile ids in tracked files.
- **Never start the app against the real userData DB** — copy `~/Library/Application Support/hazu-admin` to the scratchpad and pass `--user-data-dir`.

## Review Focus

1. **A run stopped half-way** (after the groups moved, before the room) — re-running must finish it, not create a second folder or fail on "already moved". Tested in Task 1.
2. **A room whose live parent is no longer a category** (moved by hand in Hazu since the sync) — archive must refuse with a message, not archive from a wrong origin. Tested in Task 1.
3. **Origin category deleted before restore** (read 404) — restore stops with « catégorie d'origine introuvable », moves nothing. Tested in Task 2.
4. **Class-id prefix collisions** — holder `hz-config-class-abcd-student` must survive archiving class `abc`. Tested in Task 1.
5. **Two groups of the same role for one class** (duplicate groups exist in the live container) — all matching groups move and all come back. Tested in Tasks 1 and 2.

---

### Task 0: Live check — how the Archive Hazu stays unlisted (gates Tasks 1–7) — DONE 2026-11-24

Result: Archive Hazu `privacy: 'private'`, per-room folder `privacy: 'unlisted'`, room privacy unchanged; no hide tags. Only a member's own Hazu favourites still reach the room (accepted).

Controller task with the maintainer, no code. Spec §8.

- [ ] **Step 1:** Using a scratch script (scratchpad, not the repo), create `Archive` under `admin_id` tagged `hz-config-archive`, a per-room folder tagged as the record would be, and move the test class `wP5g2WTRCgpW54KQpLAJ` into it. Save its full state first (parent, link, tags, ACL, children).
- [ ] **Step 2:** The maintainer checks from the test teacher account whether the class still shows on the Hazu home / shared lists. Try, one at a time, re-checking after each: (a) the parent's admin-only access alone; (b) tag `hz-config-hide-from-shared` on the class's archive folder; (c) the class itself carrying `hz-config-hide-from-shared`; (d) a `privacy` value on the Archive Hazu if the create call accepts one.
- [ ] **Step 3:** Move the class back; confirm parent, link, tags, ACL, children equal the saved state.
- [ ] **Step 4:** Record the outcome in `docs/archive-move-probe-findings.md` under a new heading « Hiding the archive (check 0.1) »: which option keeps the class off the lists, and whether it needs a tag on the room itself. Ledger a ruling naming `ARCHIVE_HIDE_TAGS` (tags for the Archive Hazu and folders) and `ROOM_HIDE_TAGS` (tags added to the room on archive, removed on restore — empty if none needed). If nothing hides it, both are `[]` and the finding is recorded (spec: the design stands).
- [ ] **Step 5:** Delete the probe Archive Hazu and folder only after the class is back and listed in École professionnelle. Commit the findings doc.

---

### Task 1: Pure core — record tags and `runArchive`

**Files:**
- Create: `src/main/services/room-archive.ts`
- Create: `src/main/services/room-archive.test.ts`
- Create: `src/shared/archive-types.ts`

**Interfaces:**
- Consumes: `isRetryableError(status, networkOrTimeout)`, `backoffMs(attempt)` from `role-write.ts`; the privacy values from Task 0 (below).
- Produces (in `room-archive.ts`):
  ```ts
  export interface HazuNode { id: string; parentId: string | null; title: string; tags: string[] }
  export interface ApiFailure { status?: number; networkOrTimeout: boolean; message: string }  // thrown by deps
  export interface ArchiveDeps {
    read(id: string): Promise<HazuNode | null>;          // null only on 404
    list(parentId: string): Promise<HazuNode[]>;
    create(parentId: string, title: string, tags: string[], privacy: 'private' | 'unlisted'): Promise<string>;  // returns new id
    move(id: string, targetId: string): Promise<void>;
    addTags(id: string, tags: string[]): Promise<void>;
    removeTags(id: string, tags: string[]): Promise<void>;
    sleep(ms: number): Promise<void>;
  }
  export const ARCHIVE_ROOT_TAG, ROOM_FOLDER_TAG, GROUPS_FOLDER_TAG: string;
  export const ARCHIVE_ROOT_PRIVACY = 'private'; export const ROOM_FOLDER_PRIVACY = 'unlisted'; export const GROUPS_FOLDER_PRIVACY = 'private';
  export function buildRecordTags(r: { classId: string; fromParentId: string; roomType: ArchiveRoomType; archivedAt: number }): string[];
  export function parseRecordTags(tags: string[]): { classId: string; fromParentId: string; roomType: ArchiveRoomType; archivedAt: number } | null;  // null if any part missing
  export function classTagsFor(classId: string, roles: string[]): string[];   // hz-config-class-{classId}-{role}
  export function holderTagsToRemove(personTags: string[], classId: string, roles: string[]): string[];
  export function groupsOfClass(children: HazuNode[], classId: string, roles: string[]): Array<{ id: string; role: string }>;  // parses hz-share-{role}-{classId}, exact classId
  export interface ArchiveInput {
    room: { id: string; classId: string; title: string; roomType: ArchiveRoomType };
    expectedParentId: string;          // the synced category
    categoryIds: string[];             // every category's id
    adminId: string; sharingContainerId: string;
    roles: string[];
    holders: Array<{ personId: string; tags: string[] }>;   // from local persons.tags
    now: number;
  }
  export async function runArchive(input: ArchiveInput, deps: ArchiveDeps): Promise<ArchiveOutcome>;
  ```
- Produces (in `src/shared/archive-types.ts`): `ArchiveRoomType = 'class' | 'cie' | 'enterprise' | 'state'`; `StepResult { step: string; status: 'done' | 'skipped' | 'failed'; detail?: string }`; `ArchiveOutcome { success: boolean; steps: StepResult[]; remaining: string[]; error?: string; folderId?: string; removedTags: Array<{ personId: string; tags: string[] }> }`.

`runArchive` steps (spec §6), each wrapped in the retry helper, each skipped when the live read shows it done:
1. `read(room.id)`: null → fail « salle introuvable ». If its parent is a per-room folder whose tags hold `hz-config-archive-class-{classId}` → the room is already moved; continue with the remaining steps. Else if parent ∉ `categoryIds` or ≠ `expectedParentId` → fail « la salle a été déplacée depuis la dernière synchronisation ».
2. Find the Archive Hazu among `list(adminId)` by `ARCHIVE_ROOT_TAG`; create it (tags `[ARCHIVE_ROOT_TAG]`, privacy `ARCHIVE_ROOT_PRIVACY`) if missing.
3. Find the per-room folder in `list(archiveId)` by `hz-config-archive-class-{classId}`; create it with tags `[ROOM_FOLDER_TAG, ...buildRecordTags(...)]`, privacy `ROOM_FOLDER_PRIVACY`, if missing. Then the groups folder inside it by `GROUPS_FOLDER_TAG` (privacy `GROUPS_FOLDER_PRIVACY`).
4. Groups = `groupsOfClass(list(sharingContainerId))` plus those already in the groups folder; `move` each not yet in the groups folder; `read` it back — parent must be the groups folder.
5. `move` the room into the per-room folder if not there; read back. The room's own privacy is not touched.
6. For each holder with `holderTagsToRemove(...)` non-empty: `removeTags`, then re-read via `read(personId)` up to 3× / 750 ms; done when none of those tags remain. The read decides, not the call's status.

Success = room and every group read back inside the folder and no holder still carries a removed tag. Otherwise `success: false` with `remaining` naming what is left.

- [ ] **Step 1: Write the failing tests** in `room-archive.test.ts` with an in-memory fake Hazu (a `Map<id, HazuNode>`; `move` rewrites `parentId`; `removeTags` edits tags; failures injectable per call):
  - `buildRecordTags` → exactly the five spec tags; `parseRecordTags(buildRecordTags(r))` deep-equals `r`; missing `-from-` → null.
  - `holderTagsToRemove(['hz-config-class-abc-student','hz-config-class-abcd-student','hz-config-class-abc'], 'abc', ['student','schoolteacher'])` → `['hz-config-class-abc-student']`.
  - `groupsOfClass` returns both of two `hz-share-student-abc` groups, not `hz-share-student-abcd`.
  - Fresh archive: Archive Hazu, folder, groups folder created once; 5 groups and the room end inside; holders lose the tag; `success: true`.
  - Second run on an archived room: creates nothing, moves nothing, `success: true`, every step `skipped`.
  - Stopped half-way (fake throws on the room move after the groups moved), then re-run with a healthy fake: one folder total, room moved, `success: true`.
  - Room parent ≠ `expectedParentId` and not an archive folder → `success: false`, zero `move` or `create` calls.
  - Move returns OK but read-back shows the old parent → that step `failed`, `success: false`.
  - A 503 on the first `move` then OK → retried, `success: true`; a 403 → no retry, `failed`.
  - Tag removal whose re-read still shows the tag 3 times → `success: false`, `remaining` names the person.
- [ ] **Step 2:** Run `npx vitest run src/main/services/room-archive.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Implement `src/shared/archive-types.ts` and `room-archive.ts` to the interfaces above. No import of DB, axios or Electron.
- [ ] **Step 4:** Run the same command — PASS. Run `npm test` — all green.
- [ ] **Step 5:** Commit `feat(archive): pure core — record tags and runArchive`.

---

### Task 2: Pure core — `runRestore`

**Files:**
- Modify: `src/main/services/room-archive.ts`, `src/main/services/room-archive.test.ts`, `src/shared/archive-types.ts`

**Interfaces:**
- Consumes: Task 1's deps, helpers and record tags.
- Produces:
  ```ts
  export interface RestoreInput {
    folderId: string; sharingContainerId: string; roles: string[];
    membersOf(groupId: string): Promise<{ personIds: string[]; unresolved: number }>;  // service resolves ACL → profiles
  }
  export async function runRestore(input: RestoreInput, deps: ArchiveDeps): Promise<RestoreOutcome>;
  export function archivedEntry(folder: HazuNode, children: HazuNode[]): ArchivedRoom | null;
  ```
  In `archive-types.ts`: `ArchivedRoom { folderId: string; roomId: string | null; title: string; classId: string; roomType: ArchiveRoomType; fromParentId: string; archivedAt: number }`; `RestoreOutcome { success; steps: StepResult[]; remaining: string[]; error?: string; addedTags: Array<{ personId: string; tags: string[] }>; unresolvedMembers: number; roomId?: string }`.

`runRestore` (spec §7): `read(folderId)` → `parseRecordTags`, null → fail « dossier d'archive incomplet ». `read(fromParentId)` null → fail « catégorie d'origine introuvable » before any move. Then move the room (found in the folder by `hz-config-class-{classId}`, or already under `fromParentId`) back and read back; move each group in the groups folder to `sharingContainerId` and read back; for each group's `membersOf`, `addTags(personId, [hz-config-class-{classId}-{role}])` where missing, verified by re-read; finally, if `list(groupsFolder)` is empty remove it, then if `list(folderId)` is empty remove the folder — `deps` gains `remove(id): Promise<void>` for this, used nowhere else.

- [ ] **Step 1: Write the failing tests:**
  - Round trip: archive then restore on the fake → room and groups back under their original parents, every member tag back, both folders gone, `success: true`.
  - Origin 404 → `success: false`, error « catégorie d'origine introuvable », zero `move` calls.
  - Restore re-run after success → no calls except reads, `success: true`.
  - Groups folder still holding an unknown child → it is not removed, step `failed` with detail, the rest done.
  - Two student groups → both moved back, members of both tagged.
  - `membersOf` reporting `unresolved: 2` → carried to `unresolvedMembers`, not a failure.
  - `archivedEntry` builds the list row from a folder and its children; a folder missing `-from-` → null.
- [ ] **Step 2:** `npx vitest run src/main/services/room-archive.test.ts` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command — PASS; `npm test` green.
- [ ] **Step 5:** Commit `feat(archive): pure core — runRestore`.

---

### Task 3: API call and service layer

**Files:**
- Modify: `src/main/services/hazu-api/api.ts`
- Create: `src/main/services/room-archive.service.ts`

**Interfaces:**
- Consumes: `runArchive`, `runRestore`, `archivedEntry`, `groupsOfClass`, `holderTagsToRemove`; `normalizeRow` (formation/parse.ts) for any list/read envelope; `resolvePerson`, `isSystemAccount` (group-membership.ts); `sendApiRequestListChecked`, `sendApiRequestRead`, `sendApiRequestCreate`, `sendApiRequestAddTagsChecked`, `sendApiRequestRemoveTagsChecked`, `sendApiRequestRemove`, `sendApiRequestGetAclInfoChecked`.
- Produces:
  ```ts
  // api.ts
  export const sendApiRequestMoveChecked: (id: string, targetHazuId: string, loginId: string) => Promise<void>;
  // PUT /moveElement, timeout 60_000, rethrows axios errors; throws when body.isSuccess !== true
  // room-archive.service.ts
  export function listArchivableRooms(): ArchivableRoom[];         // local
  export async function listArchivedRooms(): Promise<ArchivedRoom[]>;  // live
  export function planArchive(roomId: string): ArchivePlan;         // local counts for the modal
  export async function archiveRoom(roomId: string): Promise<ArchiveOutcome>;
  export async function planRestore(folderId: string): Promise<RestorePlan>;
  export async function restoreRoom(folderId: string): Promise<RestoreOutcome>;
  ```
  Add to `archive-types.ts`: `ArchivableRoom { id; title; roomType; classId: string | null; parentId: string; memberCount: number; blockedReason: string | null }` (blocked when `class_id` empty: « identifiant de classe manquant »); `ArchivePlan { roomId; title; roomType; classId; groupCount: number; holderCount: number; memberCount: number; warnsDashboards: boolean }` (`warnsDashboards` = enterprise or state with members); `RestorePlan { folderId; title; fromParentTitle: string | null; fromParentExists: boolean; groupCount: number }`.

Deps wiring: wrap API errors into `ApiFailure` (`status` from `error.response?.status`, `networkOrTimeout` from no response / ECONNABORTED / ETIMEDOUT); `read` returns null on 404 only; `loginId` = setting `user_id`, `adminId` = `admin_id`, `sharingContainerId` = `sharing_container_id`, `categoryIds` = rooms-table-independent: `list(root_hazu_id)` children ids, `roles` = `user_types.name`. Holders = `persons` whose parsed `tags` contain any `classTagsFor(classId, roles)`. `membersOf(groupId)`: read the group ACL, skip `isGroup` entries and super-user members (setting `superuser_group_id` ACL, as the sync does) and `isSystemAccount`, resolve with `resolvePerson` against the same email/UID maps the sync builds; unresolved counted.

Local reconcile, in its own try/catch after the core returns (a DB failure never flips a Hazu success), one transaction:
- archive (any outcome where the room read back inside the folder): delete the room's `person_room_assignments`, `membership_issues` and `rooms` row; `distribution_groups.room_id = NULL` for its groups; strip `removedTags` from `persons.tags`.
- restore: add `addedTags` to `persons.tags`; the room row and assignments return with the next sync (the result's message says « Lancez une synchronisation pour voir la salle dans Matrix »).

- [ ] **Step 1:** Add `sendApiRequestMoveChecked` beside `sendApiRequestListChecked`.
- [ ] **Step 2:** Write `room-archive.service.ts`. Every Hazu call goes through the core; the service adds no step logic.
- [ ] **Step 3:** `npx tsc -p tsconfig.main.json --noEmit` — no errors; `npm test` green.
- [ ] **Step 4:** Commit `feat(archive): move API call and service layer`.

---

### Task 4: IPC, preload, Task Queue task types

**Files:**
- Modify: `src/shared/ipc-channels.ts`, `src/main/ipc/index.ts`, `src/main/preload.ts`, `src/renderer/contexts/TaskQueueContext.tsx`, `src/shared/app-mode.ts`, `src/shared/app-mode.test.ts`, `src/renderer/components/TaskQueuePanel.tsx`

**Interfaces:**
- Consumes: Task 3's six service functions and types.
- Produces: channels `ARCHIVE_LIST_ROOMS`, `ARCHIVE_LIST_ARCHIVED`, `ARCHIVE_PLAN`, `ARCHIVE_EXECUTE`, `ARCHIVE_RESTORE_PLAN`, `ARCHIVE_RESTORE_EXECUTE`; preload methods `listArchivableRooms()`, `listArchivedRooms()`, `planArchive(roomId)`, `archiveRoom(roomId)`, `planRestore(folderId)`, `restoreRoom(folderId)`; task types `archiveRoom { roomId; roomTitle }` and `restoreRoom { folderId; roomTitle }` with `addArchiveRoomTask` / `addRestoreRoomTask`; `PageId` gains `'archive'` in `ALL_PAGES` only; `TaskType` (both copies) gains both types, complete mode only.

Plan handlers rethrow (the page shows the error); execute handlers return the outcome (the queue shows failure and offers retry). The queue marks a task `success` only when `outcome.success`; otherwise `error` with `outcome.remaining.join(', ')`. The panel labels: « Archiver {title} » / « Restaurer {title} ».

- [ ] **Step 1:** Extend `app-mode.test.ts`: `visiblePages('complete')` includes `'archive'`; `visiblePages('cie')` does not; the two new task types are hidden in CIE mode. Run `npx vitest run src/shared/app-mode.test.ts` — FAIL.
- [ ] **Step 2:** Implement channels, handlers, preload (with Window typings), task types and runner branches, `app-mode.ts`.
- [ ] **Step 3:** Run the app-mode test — PASS; `npm test` green; `npm run build` succeeds.
- [ ] **Step 4:** Commit `feat(archive): IPC, preload and Task Queue tasks`.

---

### Task 5: Archive page

**Files:**
- Create: `src/renderer/pages/ArchivePage.tsx`, `src/renderer/components/archive/ArchiveConfirmModal.tsx`, `src/renderer/components/archive/RestoreConfirmModal.tsx`, `src/renderer/components/archive/archive-logic.ts`, `src/renderer/components/archive/archive-logic.test.ts`
- Modify: `src/renderer/App.tsx`, `src/renderer/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: Task 4's preload methods and task adders.
- Produces: `archive-logic.ts` — `filterRooms<T extends { roomType: ArchiveRoomType; title: string }>(rows: T[], types: Set<ArchiveRoomType>, query: string): T[]` (empty set = all, accent- and case-insensitive title search) and `TYPE_LABEL: Record<ArchiveRoomType, string>` = `{ class: 'Classe', cie: 'CIE', enterprise: 'Entreprise', state: 'Canton' }`.

Layout (spec §9): two sections, « Salles actives » (local) and « Archivées » (live, with a loading state and a read error shown in place), sharing the four filter buttons and a search field. Active rows: title, type, member count, Archiver button — disabled with `blockedReason` shown when set. Archived rows: title, type, archive date, Restaurer. Archiver → `planArchive` → `ArchiveConfirmModal` (counts; the dashboards warning when `warnsDashboards`) → `addArchiveRoomTask`. Restaurer → `planRestore` → `RestoreConfirmModal` (origin title, or « catégorie d'origine introuvable » with the confirm disabled) → `addRestoreRoomTask`. Both lists reload when the queue drains (the BulkImportPage pattern). Sidebar entry `Archive` with an archive-box icon, after Missions.

- [ ] **Step 1:** Write `archive-logic.test.ts`: filter by one type, by two, by none; search « ecole » matches « École »; `TYPE_LABEL` exact. Run `npx vitest run src/renderer/components/archive/archive-logic.test.ts` — FAIL.
- [ ] **Step 2:** Implement logic, page, modals, route, sidebar.
- [ ] **Step 3:** Test — PASS; `npm test` green; `npm run build` succeeds.
- [ ] **Step 4:** Commit `feat(archive): Archive tab`.

---

### Task 6: Live acceptance on the test class

Controller task with the maintainer. Scratch userData copy only.

- [ ] **Step 1:** Start the built app with `--user-data-dir` on a fresh scratch copy; sync; unlock; open Archive. « Cui Test 2 » listed under Classe.
- [ ] **Step 2:** Archive it. Expect: Task Queue success; live read shows Archive → « Cui Test 2 » folder with the five record tags → the class and an empty « Groupes de partage » (the class has no groups); class ACL and children unchanged vs. the saved state; the test teacher account's class tag removed; the class gone from Matrix; listed under Archivées; check 0.1's hiding confirmed from the test account.
- [ ] **Step 3:** Re-run Archive via the queue's retry on a deliberately interrupted run (kill the network after the folder is created, then retry): one folder only, success.
- [ ] **Step 4:** Restore. Expect: class back under École professionnelle with its original link, tags, ACL, children; folders removed; after a sync, Matrix shows it with the same `class_id`. (The class has no groups, so tag re-adding is checked by the unit tests; note that in the findings.)
- [ ] **Step 5:** Record results in `docs/archive-move-probe-findings.md` (« Acceptance »), no person data.

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md` (project structure tree, a new « Room Archive » section after Missions, Testing step 7c), `docs/specs/2026-11-24-room-archive-design.md` (status → implemented)

- [ ] **Step 1:** CLAUDE.md section: the layout in Hazu, the record tags, archive/restore order and why moves precede tags, the success rule, « access is never changed », the hide setting from Task 0, the files, the known consequences (path links, company dashboards).
- [ ] **Step 2:** `python3 scripts/check-no-person-data.py --all` — clean.
- [ ] **Step 3:** Commit `docs(archive): CLAUDE.md section and spec status`.
