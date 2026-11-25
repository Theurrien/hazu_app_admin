# Person Archive and Leaver Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Archive a person (leave every room, move the profile into the Archive Hazu, restorable without rooms) and let Verify find the students missing from a spreadsheet and archive them.

**Architecture:** Two pure cores with all IO injected — `shared/person-match.ts` (row ↔ profile matching, leaver list) and `main/services/person-archive.ts` (archive / restore order) — each with a thin caller: the Verify tab and `person-archive.service.ts`. Room removal reuses the S4 role write; moves, retries and folder creation reuse the room archive's helpers. Each archive or restore is one Task Queue task.

**Tech Stack:** Electron main (TypeScript, better-sqlite3), React + Tailwind renderer, vitest.

**Spec:** [docs/specs/2026-11-25-person-archive-design.md](../specs/2026-11-25-person-archive-design.md) — read it first; this plan argues from it. Model to imitate: [docs/specs/2026-11-24-room-archive-design.md](../specs/2026-11-24-room-archive-design.md) and the "Room Archive" section of `CLAUDE.md`.

## Global Constraints

- **No real person data in any tracked file** (names, addresses, profile ids). Fixtures use invented names at `@example.invalid`. Run `python3 scripts/check-no-person-data.py --all` before every commit.
- **Never start the app against the real user DB.** Copy `~/Library/Application Support/hazu-admin` to the scratchpad and start Electron with `--user-data-dir` on the copy. Archive and restore write to the live Hazu: use test profiles only.
- **The live read decides, not the status code.** Every step reads first and skips what is done; every write is verified by a read-back; a stopped run is finished by running it again.
- **Rooms first, move last.** If any room removal is unconfirmed, the profile is not moved.
- The profile itself is never modified (no tag, no privacy change). The record lives on its folder.
- Folder privacy: « Personnes » `private`, the per-person folder `unlisted`.
- Complete mode only: nothing here is reachable or visible in CIE mode.
- Pure cores import no DB, axios, Electron or React. Tests live beside the core as `*.test.ts`.
- UI wording in French, as in the Archive tab. Work on a branch `feat/person-archive`.

## Review Focus

1. **Empty names.** A row or a profile whose name normalises to nothing must never match by name (two empties are not "the same name"). → Task 1.
2. **Duplicate rows.** Two spreadsheet rows matching the same student: both `matched`, the student is not a leaver, nothing throws. → Task 1.
3. **Re-run on an archived person** (double click, retry after a late success): success, steps `skipped`, no second folder. → Task 3.
4. **A person in no room at all**: the archive goes straight to the move and succeeds. → Task 3.
5. **Undecided « à vérifier » candidate inside the class filter**: not on the leaver list until rejected. → Task 1.

---

### Task 0: Live checks (gate — no product code before this passes)

**Files:**
- Create: `docs/person-archive-probe-findings.md` (structural, no identifiers)
- Scratch scripts and raw output: `output/` (gitignored) or the scratchpad

- [ ] **Step 1:** Ask Urs which test profile and test room to use. Use a scratch userData copy for the key.
- [ ] **Step 2:** Create `Archive/Personnes` (private) and one `unlisted` folder; move the test profile in. Record: id, children, tags, ACL and privacy before and after (must be identical); whether the test account still opens its own profile; whether from there it can reach « Personnes » or another archived person (must not).
- [ ] **Step 3:** With the test profile in one test room, call `update-user-roles` to `_`. Record whether the group membership, the class tag **and** any direct grant on the room item are gone.
- [ ] **Step 4:** Move the profile back, remove the folder, run a sync on the scratch copy; record that the person is back as before.
- [ ] **Step 5:** Write the findings. **If any answer contradicts the spec, stop and report to Urs.** If the direct room grant survives step 3, add to Task 3 an injected `removeDirectGrant(roomId)` step built on the S6 call, and say so in the findings.
- [ ] **Step 6:** Commit the findings file.

---

### Task 1: The matcher and the leaver list

**Files:**
- Create: `src/shared/person-match.ts`, `src/shared/person-match.test.ts`

**Interfaces — Produces:**

```ts
export interface SheetPerson { rowIndex: number; email?: string; firstName?: string; lastName?: string; fullName?: string }
export interface HazuPerson { id: string; email: string | null; displayName: string }
export type RowMatch =
  | { kind: 'matched'; rowIndex: number; personId: string; by: 'email' | 'name' }
  | { kind: 'check'; rowIndex: number; candidateIds: string[]; reason: 'conflict' | 'ambiguous' | 'near' }
  | { kind: 'unknown'; rowIndex: number };
/** personId = the confirmed candidate; null = every candidate rejected. */
export interface CheckDecision { rowIndex: number; personId: string | null }
export type ClassFilter = { all: true } | { all: false; classIds: string[]; includeNoClass: boolean };

export function normalizeName(s: string): string;   // lower case, NFD accents stripped, [-'’.,] → space, spaces collapsed
export function nameKey(s: string): string;          // normalised words, sorted, joined by one space; '' when empty
export function matchRows(rows: SheetPerson[], persons: HazuPerson[]): RowMatch[];
/** Row → person after decisions: matched rows, plus confirmed check rows. */
export function resolvedPersonByRow(matches: RowMatch[], decisions: CheckDecision[]): Map<number, string>;
export function findLeavers(
  students: HazuPerson[], matches: RowMatch[], decisions: CheckDecision[],
  classIdsOf: Map<string, string[]>, filter: ClassFilter | null,
): HazuPerson[];                                     // filter null → []
```

Rules, first that applies (spec « The matcher »):
1. Row name = `fullName` if mapped, else `firstName + ' ' + lastName`. A person's e-mail takes part only if it contains `@`; compare trimmed, lower case.
2. E-mail hits person A. If the row's name key exactly equals another person B's → `check / conflict` `[A, B]`. Otherwise → `matched` by `email` (a disagreeing name alone does not demote an e-mail hit: Hazu names are unreliable).
3. No e-mail hit, non-empty name key equal to exactly one person's → `matched` by `name`; to several → `check / ambiguous`.
4. Near: one side's words are a proper subset of the other's (and the smaller side has ≥ 2 words), **or** same word count with exactly one differing pair, both words ≥ 5 letters, Levenshtein ≤ 2 → `check / near` with every such candidate.
5. Else `unknown`.

`findLeavers`: students that are neither a value of `resolvedPersonByRow` nor a candidate of a `check` row without a decision; then filtered — `all` keeps everyone; otherwise keep a student with a class in `classIds`, or with no class when `includeNoClass`. Sorted by `displayName`.

Implement a local Levenshtein (the one in `renderer/utils/fuzzyMatch.ts` cannot be imported from `shared/`).

- [ ] **Step 1: Write the failing tests** — one `it` per line, invented names only:
  - `nameKey('Zoé-Anne  DUPONT') === nameKey('dupont zoe anne')`
  - e-mail equal, different case and spaces → `matched` by `email`
  - person e-mail is a UID (no `@`), row e-mail absent, names equal in swapped order → `matched` by `name`
  - e-mail hits A, name key equals B → `check`, reason `conflict`, candidates `[A, B]`
  - two persons with the same name, no e-mail hit → `check`, reason `ambiguous`
  - row « Anna Keller », person « Anna Maria Keller » → `check`, reason `near`
  - row « Lukas Brunnerr », person « Lukas Brunner » → `near`; row « Lea Moser », person « Lia Moser » (3-letter words) → `unknown`
  - **empty name on both sides, no e-mail → `unknown`** (Review Focus 1)
  - **two rows matching the same student → both `matched`; `findLeavers` does not return that student** (Review Focus 2)
  - `findLeavers`: unmatched student in a selected class is returned; one outside is not; one with no class only with `includeNoClass`; `filter null → []`
  - **student who is the candidate of an undecided `check` row is not a leaver; after `{ personId: null }` it is; after confirmation it is not** (Review Focus 5)
- [ ] **Step 2:** `npx vitest run src/shared/person-match.test.ts` → FAIL (module missing)
- [ ] **Step 3:** Implement the module.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(verify): person matcher by e-mail or name, leaver list`.

---

### Task 2: Shared types and exported archive helpers

**Files:**
- Modify: `src/shared/archive-types.ts`, `src/main/services/room-archive.ts`, `src/main/services/room-archive.service.ts`

**Interfaces — Produces** (in `archive-types.ts`):

```ts
export interface PersonArchiveOutcome { success: boolean; steps: StepResult[]; remaining: string[]; error?: string; folderId?: string }
export interface PersonRestoreOutcome { success: boolean; steps: StepResult[]; remaining: string[]; error?: string }
export interface ArchivedPerson { folderId: string; profileId: string; inFolder: boolean; displayName: string; fromParentId: string; archivedAt: number }
export interface PersonArchivePlan {
  personId: string; displayName: string; personType: string;
  rooms: Array<{ roomId: string; title: string; role: string }>;
  lastSyncAt: number | null; syncStale: boolean;   // stale = null or older than 24 h
}
```

- [ ] **Step 1:** Add the types.
- [ ] **Step 2:** In `room-archive.ts` add `export` to `withRetry`, `readUntil`, `moveVerified`, `createOnce`, `failureMessage`. In `room-archive.service.ts` add `export` to `buildDeps`, `findArchiveRoot`, `setting`, `safeTags`, `toError`. No behaviour change.
- [ ] **Step 3:** `npx vitest run src/main/services/room-archive.test.ts` → PASS; `npm run build` → no type error.
- [ ] **Step 4:** Commit `refactor(archive): export helpers and person archive types`.

---

### Task 3: Person archive core

**Files:**
- Create: `src/main/services/person-archive.ts`, `src/main/services/person-archive.test.ts`

**Interfaces — Consumes:** `ArchiveDeps`, `HazuNode`, `withRetry`, `readUntil`, `moveVerified`, `createOnce`, `ARCHIVE_ROOT_TAG`, `ARCHIVE_ROOT_TITLE`, `ARCHIVE_ROOT_PRIVACY` from `room-archive.ts`; `parseClassTag` from `discrepancy.ts`; Task 2 types.

**Produces:**

```ts
export const PERSONS_FOLDER_TAG = 'hz-config-archive-persons';
export const PERSONS_FOLDER_TITLE = 'Personnes';
export const PERSON_FOLDER_TAG = 'hz-config-archive-person';
// record tags on the per-person folder:
//   hz-config-archive-person, hz-config-archive-profile-{profileId},
//   hz-config-archive-from-{parentId}, hz-config-archive-at-{ms}
export interface PersonRecord { profileId: string; fromParentId: string; archivedAt: number }
export function buildPersonRecordTags(r: PersonRecord): string[];
export function parsePersonRecordTags(tags: string[]): PersonRecord | null;   // null unless all four are present and valid
export function archivedPersonEntry(folder: HazuNode, children: HazuNode[]): ArchivedPerson | null;

export interface PersonArchiveDeps extends ArchiveDeps {
  /** S4 role write to '_'. success = confirmed gone (or confirmed by truth after a failed status). */
  removeRole(roomId: string, role: string): Promise<{ success: boolean; error?: string }>;
}
export interface PersonArchiveInput {
  person: { id: string; displayName: string };
  categoryIds: string[];                                   // live person categories
  adminId: string;
  assignments: Array<{ roomId: string; role: string; title: string }>;
  liveRooms: Array<{ roomId: string; classId: string; title: string }>;
  now: number;
}
export function runPersonArchive(input: PersonArchiveInput, deps: PersonArchiveDeps): Promise<PersonArchiveOutcome>;
export interface PersonRestoreInput { folderId: string; adminId: string; categoryIds: string[] }
export function runPersonRestore(input: PersonRestoreInput, deps: ArchiveDeps): Promise<PersonRestoreOutcome>;
```

`runPersonArchive` order (spec « Archive order »), one `StepResult` per step:
1. Read the profile. 404 → fail. If its parent is a folder carrying a complete record for this profile → already archived: success, steps `skipped`. Else its parent must be in `categoryIds`, otherwise fail « le profil n'est plus dans son dossier d'origine ».
2. Rooms = `assignments` ∪ (for each `hz-config-class-{classId}-{role}` tag on the profile whose `classId` is in `liveRooms` and whose room is not already listed: that room and role). `removeRole` for each, one after another.
3. Any not confirmed → return `success:false`, `remaining` = those room titles. **Nothing below runs.**
4. Re-read the profile; class tags of `liveRooms` still present → `deps.removeTags`, then `readUntil` they are gone; still there → `success:false`, `remaining` = the tags.
5. Find or create the Archive root (under `adminId`), « Personnes » (private), then the person folder: an existing child of « Personnes » whose record names this profile, else `createOnce` titled `displayName`, `unlisted`, with the record tags (`fromParentId` = the profile's current parent, `archivedAt` = `now`).
6. `moveVerified(profile, folderId)`. Success only when a final read shows the profile's parent is the folder.

`runPersonRestore` order (spec « Restore order »): folder read → its parent must be the « Personnes » folder of the Archive root under `adminId`, its record complete, and the profile its child (if the profile already sits under `fromParentId`, skip the move) → `fromParentId` must read non-null and be in `categoryIds`, else fail « dossier d'origine introuvable » → `moveVerified` back → list the folder; empty → `deps.remove`; not empty or move unconfirmed → keep the folder, `success:false`.

- [ ] **Step 1: Write the failing tests** with an in-memory fake tree for `ArchiveDeps` (see `room-archive.test.ts` for the pattern) and a scripted `removeRole`:
  - record tags round-trip; `parsePersonRecordTags` is null when one tag is missing
  - happy path: two assignments → two `removeRole` calls, folder created `unlisted` with four record tags under a `private` « Personnes », profile's parent is the folder, `success:true`
  - a tag-only room (class tag on the profile, room in `liveRooms`, not in `assignments`) gets a `removeRole` call; a tag whose class is not in `liveRooms` does not and is not removed
  - **one `removeRole` unconfirmed → `success:false`, `remaining` names that room, `move` and `create` never called**
  - leftover live-room class tag after the role writes → `removeTags` called with exactly that tag
  - **person with no assignment and no class tag → moved, `success:true`** (Review Focus 4)
  - **re-run on an archived person → `success:true`, no `create`, no `move`, no `removeRole`** (Review Focus 3)
  - re-run after a stop between folder creation and move → reuses the existing folder (one folder only)
  - move throws a transient failure but the tree shows it landed → `success:true`, `move` called once
  - profile not under a known category → fail, nothing written
  - restore: happy path removes the empty folder; origin gone → fail and folder kept; folder not under « Personnes » → fail; record incomplete → fail; profile already back → folder removed, `success:true`
- [ ] **Step 2:** `npx vitest run src/main/services/person-archive.test.ts` → FAIL
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(archive): person archive core`.

---

### Task 4: IO layer, IPC, preload

**Files:**
- Create: `src/main/services/person-archive.service.ts`
- Modify: `src/shared/ipc-channels.ts`, `src/main/ipc/index.ts`, `src/main/preload.ts`

**Interfaces — Consumes:** Task 3; `buildDeps`, `findArchiveRoot`, `setting`, `safeTags`, `toError` (Task 2); `reliableUpdateUserRole` from `role-write.service.ts`.

**Produces:**

```ts
export function planPersonArchive(personId: string): PersonArchivePlan;          // local only
export function listArchivedPersons(): Promise<ArchivedPerson[]>;                // live, newest first
export function archivePerson(personId: string): Promise<PersonArchiveOutcome>;  // never rejects
export function restorePerson(folderId: string): Promise<PersonRestoreOutcome>;  // never rejects
```

| Channel constant | value | preload method |
|---|---|---|
| `ARCHIVE_PERSON_PLAN` | `archive:person:plan` | `planPersonArchive(personId)` |
| `ARCHIVE_PERSON_LIST_ARCHIVED` | `archive:person:listArchived` | `listArchivedPersons()` |
| `ARCHIVE_PERSON_EXECUTE` | `archive:person:execute` | `archivePerson(personId)` |
| `ARCHIVE_PERSON_RESTORE_EXECUTE` | `archive:person:restoreExecute` | `restorePerson(folderId)` |

- [ ] **Step 1:** `planPersonArchive`: person row, its `person_room_assignments` joined to `rooms` for titles, `last_sync_at` from `settings`.
- [ ] **Step 2:** `archivePerson`: live person categories = children of `root_hazu_id` carrying a tag starting `hz-config-profile-`; `liveRooms` from `rooms` rows with a `class_id`; `removeRole = (roomId, role) => reliableUpdateUserRole(personId, roomId, role, '_')` mapped to `{ success, error }`. Wrap like `archiveRoom` / `archiveRoomUnsafe`: a thrown error becomes `success:false` with its message. Log one line `[person-archive] person=<id> success=… rooms=n/m remaining=[…]` — the id only, never a name or address.
- [ ] **Step 3:** Local reconcile, **only on full success**, in its own try/catch, one transaction: delete the person's rows from `person_room_assignments`, from every `formation_*` table that has a `person_id` column (read `schema.sql`), from `membership_issues` where `uid` or `email` equals the person's `persons.email` value, then the `persons` row.
- [ ] **Step 4:** `restorePerson` (no local change) and `listArchivedPersons` (Archive root → child tagged `PERSONS_FOLDER_TAG` → each child folder with its listing → `archivedPersonEntry`; no « Personnes » yet → `[]`).
- [ ] **Step 5:** Channels, handlers (plan and list rethrow after `console.error`, execute handlers return the outcome — copy the room archive handlers), preload methods and `Window` typings.
- [ ] **Step 6:** `npm run build` → no type error; `npm test` → all PASS.
- [ ] **Step 7:** Commit `feat(archive): person archive service and IPC`.

---

### Task 5: Task Queue and mode registration

**Files:**
- Modify: `src/shared/app-mode.ts`, `src/shared/app-mode.test.ts`, `src/renderer/contexts/TaskQueueContext.tsx`, `src/renderer/components/TaskQueuePanel.tsx`

**Interfaces — Produces:**

```ts
export interface ArchivePersonTask extends BaseTask { type: 'archivePerson'; personId: string; displayName: string; roomCount: number }
export interface RestorePersonTask extends BaseTask { type: 'restorePerson'; folderId: string; displayName: string }
// context methods, same shape as the room ones:
addArchivePersonTask(input: Omit<ArchivePersonTask, 'id' | 'status' | 'type'>): string
addRestorePersonTask(input: Omit<RestorePersonTask, 'id' | 'status' | 'type'>): string
```

- [ ] **Step 1: Failing test** in `app-mode.test.ts`: `archivePerson` and `restorePerson` are visible task types in `complete` and not in `cie`.
- [ ] **Step 2:** `npx vitest run src/shared/app-mode.test.ts` → FAIL
- [ ] **Step 3:** Add both to the `TaskType` union and `ALL_TASK_TYPES` in `app-mode.ts` (not the CIE list); to the union, the `Task` type and the processing loop in `TaskQueueContext.tsx` (error text = `outcome.error || outcome.remaining.join(', ') || 'Échec'`, as `archiveRoom`); labels in `TaskQueuePanel.tsx`: « Archiver {displayName} ({roomCount} salles) », « Restaurer {displayName} ».
- [ ] **Step 4:** Test → PASS; `npm run build` clean.
- [ ] **Step 5:** Commit `feat(archive): archivePerson / restorePerson tasks`.

---

### Task 6: Archive tab — « Personnes »

**Files:**
- Create: `src/renderer/components/archive/PersonArchiveConfirmModal.tsx`
- Modify: `src/renderer/pages/ArchivePage.tsx`, `src/renderer/components/archive/archive-logic.ts`, `archive-logic.test.ts`

**Interfaces — Produces:**

```ts
// archive-logic.ts
export function filterPersons<T extends { display_name: string; email: string | null; person_type: string }>(
  persons: T[], search: string, types: string[]): T[];        // empty search AND empty types → []  (never render the whole school)
// modal — one or many plans, used by Task 7 too
export function PersonArchiveConfirmModal(props: { plans: PersonArchivePlan[]; onConfirm: () => void; onCancel: () => void }): JSX.Element;
```

- [ ] **Step 1: Failing tests** for `filterPersons`: accent- and case-insensitive on name (use `normalizeName` from Task 1); type filter; empty search and no type → `[]`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement → PASS.
- [ ] **Step 4:** Page: a switch « Salles | Personnes » at the top; the rooms view unchanged. Personnes view: search box + type chips → result rows with « Archiver »; below, archived persons (`listArchivedPersons`, with loading and error states, date archived) with « Restaurer » (plain confirm, stating « les salles ne sont pas restaurées »).
- [ ] **Step 5:** Modal: for one plan — name, role, the rooms that will be left; for several — count of persons and total room removals. Always: the sentence that restore does not bring rooms back; when any plan has `syncStale`, a warning with the last sync date; when room removals > 20, « cela peut prendre longtemps ». Confirm enqueues one `archivePerson` task per plan; refetch both lists when the queue drains (as the rooms view does).
- [ ] **Step 6:** `npm test` PASS, `npm run build` clean.
- [ ] **Step 7:** Commit `feat(archive): Personnes section in the Archive tab`.

---

### Task 7: Verify — name matching, « à vérifier », leavers by class

**Files:**
- Create: `src/renderer/components/bulk-import/verify-logic.ts`, `verify-logic.test.ts`, `PersonCheckResults.tsx`
- Modify: `ColumnMappingDropdown.tsx`, `VerifyAssignmentsTab.tsx`, `VerificationResults.tsx`

**Interfaces — Consumes:** Task 1 module; `PersonArchiveConfirmModal` (Task 6); `planPersonArchive`, `addArchivePersonTask`; `useAppMode` for the mode.

**Produces:**

```ts
// ColumnMapping gains: 'verifyFirstName' | 'verifyLastName' | 'verifyFullName'  (labels « First Name », « Last Name », « Full Name », verify mode only)
// verify-logic.ts
export interface VerifyColumns { email: string | null; firstName: string | null; lastName: string | null; fullName: string | null; room: string | null }
export function canRunPersonCheck(c: VerifyColumns): boolean;   // email, or fullName, or firstName AND lastName
export function canRunAssignmentDiff(c: VerifyColumns): boolean; // canRunPersonCheck AND room
export function sheetPersons(rows: Record<string, string>[], c: VerifyColumns): SheetPerson[]; // rowIndex = index in rows; rows with no e-mail and no name dropped
```

- [ ] **Step 1: Failing tests** for the three functions (first name alone is not enough; full name alone is; blank rows dropped; `rowIndex` preserved).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement → PASS.
- [ ] **Step 4:** `VerifyAssignmentsTab`: the room column and room type become optional (`canVerify` = `canRunPersonCheck`). Run `matchRows` against **all** persons of the selected type. The assignment diff runs only when `canRunAssignmentDiff`, keyed by **person id** from `resolvedPersonByRow` instead of e-mail (rows `unknown` or undecided are left out of the diff, as unknown e-mails are today). « Unknown Persons » lists the `unknown` rows by e-mail or name.
- [ ] **Step 5:** `PersonCheckResults`: section « À vérifier (n) » — the row's name and e-mail, each candidate's Hazu name, « C'est la même personne » per candidate and « Aucune » ; decisions are state in the tab and re-derive everything (no re-read).
- [ ] **Step 6:** Section « Élèves dans Hazu, absents du fichier », only when the person type is `student`: a multi-select of school classes (rooms of type `class`) plus « sans classe » and an explicit « toutes les classes »; **nothing selected at the start → empty list and the hint « Choisissez une ou plusieurs classes »**. Header « n élèves absents du fichier sur m dans les classes choisies ». Rows: name, number of rooms, checkbox; « tout cocher ». `classIdsOf` is built from `getAllAssignments()` restricted to class rooms.
- [ ] **Step 7:** « Archiver la sélection » — rendered in complete mode only: `planPersonArchive` for each ticked student → `PersonArchiveConfirmModal` → one `addArchivePersonTask` each; when the queue drains, reload persons and assignments and recompute.
- [ ] **Step 8:** `npm test` PASS, `npm run build` clean.
- [ ] **Step 9:** Commit `feat(verify): match by name, à vérifier, leavers by class with archive`.

---

### Task 8: Acceptance and documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** On a scratch userData copy, with invented spreadsheet data in `output/`: archive the test student (in two test rooms) from the Archive tab → in Hazu the folder is `unlisted` under a `private` « Personnes », four record tags, the profile unchanged inside, absent from both role groups, class tags gone → the student has left Matrix and Missions without a sync → Restaurer → sync → back in the student folder, no rooms. Then Verify: a file missing that student, class filter on → listed as a leaver; a row with a misspelt name → « à vérifier », not a leaver.
- [ ] **Step 2:** `CLAUDE.md`: a « Person Archive » section after « Room Archive » (layout, order and why rooms come first, success rule, local reconcile, files, IPC, known consequences from the spec); update the Verify paragraph and the Bulk Import table, the project structure, the `TaskType` count (ten), and the testing steps (7d).
- [ ] **Step 3:** `python3 scripts/check-no-person-data.py --all` clean; `npm test` PASS.
- [ ] **Step 4:** Commit `docs: person archive and leaver detection`.
