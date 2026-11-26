# Bulk Import → Contrôle: saved correspondences and the student × class × company × canton check

Date: 2026-11-26. Status: draft, awaiting the maintainer's approval.

## Intent

The school's xlsx (one row per student) is the reference; Hazu is meant to be a copy of it. Today it
is hard to see which relations in Hazu are wrong, and which students have left. Verify compares one
room column of one room type, fuzzy-matches the room names again on every run, and forgets every
decision when the file changes.

**Contrôle** is a new Bulk Import workflow, beside Verify (Verify stays as it is). It:

1. links every value of the file to its Hazu counterpart, **per category** (students, classes,
   companies, cantons), and **saves** those links, so next time only new names need a decision;
2. checks, for each student row, the student against every room on that row — class, company,
   canton — and lists what is missing in Hazu and what Hazu has in excess;
3. lets the operator tick rows and fix them through the Task Queue.

**Success:** on the second import of the year, the operator resolves only the names that changed,
and gets a list of wrong relations that can be fixed in a few clicks, without opening Matrix.

### Goals
- Saved correspondences per category, editable and deletable.
- A per-pair check (student × class, student × company, student × canton) from one row per student.
- Fixes (add / remove a student role) as `roleUpdate` tasks through S4.
- The leaver list (Hazu students absent from the file) in the same place.

### Non-goals
- No CIE column (the file has none).
- No room-to-room check (« this class belongs to canton X »): Hazu stores no link between rooms;
  only student memberships are checked.
- No creation of rooms or persons. A file value with no Hazu room is « ignored », not created.
- No change to Verify, Assignment, Matrix.
- Roles other than `student` are neither checked nor fixed.

### Anti-goals (a failure even if it works)
- A **removal proposed on a guess**: a student taken out of a room because a file value was
  unresolved, a cell was empty, or a fuzzy match was never confirmed.
- A saved link silently pointing at a room that no longer exists.
- Real names or addresses in tracked files (tests use `@example.invalid` and invented names).

## Constraints
- Complete mode only (like Verify): `'controle'` in `ALL_WORKFLOWS` of
  [app-mode.ts](../../src/shared/app-mode.ts), not in `CIE_WORKFLOWS`.
- Renders from local SQLite (sync first); same prerequisites as Verify.
- Every write is a `roleUpdate` task → `reliableUpdateUserRole` (S4), success decided by group truth.
- Measured locally on 2026-11-26 (213 students): 81 students are in 2+ classes, 19 in 2+ companies,
  every student with a canton is in exactly one. A second class or company is therefore often
  legitimate — see « En trop » below.
- Pure cores with injected IO, tests beside them, as in the rest of the app.

## Approaches considered
- **A. Extend Verify** — one place, leavers beside wrong relations; Verify grows a lot.
- **B. A new Contrôle tab beside Verify** — **chosen by the maintainer.** Verify stays as is; the new
  tab reuses the person matcher and the leaver list rather than copying them.
- **C. A separate correspondences page, Verify reads it** — clean bulk editing, but each import
  becomes a back-and-forth between two places.

## The design

### Columns (step 1)
The shared Bulk Import upload feeds the tab. The operator maps, with the existing column dropdown
(new mapping keys `ctlFirstName`, `ctlLastName`, `ctlFullName`, `ctlEmail`, `ctlClass`,
`ctlCompany`, `ctlCanton`):
- identity: e-mail and/or (first + last name or full name) — at least one, as Verify;
- rooms: class, company, canton — **at least one**.

My call: a column mapped twice, or no room column, disables « Continuer » with the reason.

### Correspondences (step 2)
Four panels, one per category, each with a counter « n à résoudre ». « Contrôler » is enabled when
every counter is 0 (an « ignoré » value counts as resolved).

**Rooms (classes, companies, cantons).** Every distinct trimmed non-empty cell value of the column.
Candidates: local `rooms` of the matching `room_type` (`class`, `enterprise`, `state`). Per value, in
this order:
1. a saved link → used (« enregistré »), unless its Hazu room is no longer in local `rooms` →
   « lien périmé », to be resolved again;
2. an exact match (case-insensitive, trimmed, accents kept) on exactly one room title → used
   (« exact »), **not saved** (it follows a rename on its own);
3. otherwise unresolved, with the best fuzzy suggestion (`findBestMatch`, normal mode) preselected
   in a searchable dropdown of that type's rooms, plus « Ignorer (pas dans Hazu) ».
Confirming a choice **saves** it. « Ignorer » saves the value with no Hazu id.

**Students.** `matchRows` from [person-match.ts](../../src/shared/person-match.ts) against local
students. Saved links come first: a row whose key (below) has a saved link takes that person and
skips the matcher. Matched rows are used, not saved. « À vérifier » and unknown rows are resolved
in the panel (pick a candidate, search any student, or « Ignorer ») and the decision is saved.

**Keys.** A saved link is keyed by `(category, file_key)`.
- rooms: the value lowercased and trimmed;
- students: `email:` + lowercased e-mail when the row has one, else `name:` + `nameKey(first last)`
  (or of the full name). Lookup tries the e-mail key, then the name key, so a student whose e-mail
  column was filled in later is still found.

**Editing.** A « Correspondances enregistrées » drawer (button in the step header) lists saved links
per category: file value → Hazu title, date; « Modifier » reopens the dropdown, « Supprimer »
removes the link. My call: the drawer shows all saved links, not only those of the current file.

### Storage
New table, local SQLite only, never written to Hazu:
```sql
CREATE TABLE IF NOT EXISTS file_correspondence (
  category   TEXT NOT NULL CHECK (category IN ('student','class','enterprise','state')),
  file_key   TEXT NOT NULL,
  file_label TEXT NOT NULL,   -- the value as last written in the file, for display
  hazu_id    TEXT,            -- NULL = ignored on purpose
  decided_at INTEGER NOT NULL,
  PRIMARY KEY (category, file_key)
);
```
IPC: `CORRESPONDENCE_LIST`, `CORRESPONDENCE_SAVE` (upsert, one or many), `CORRESPONDENCE_DELETE`.
Added to schema.sql and as a migration in database/index.ts. The archive reconcile and sync never
touch it; a link to a person or room that disappears simply turns « périmé ».

### The check (step 3)
For each row whose student is resolved (not ignored), for each category whose column is mapped:
- **cell empty** → that category is not checked for this row (nothing missing, nothing in excess);
- **value ignored** → « non vérifiable » for the pair, and **no excess is proposed** for that
  category (the right room is unknown, so no other room can be called wrong);
- **value resolved to room R** →
  - student holds role `student` in R → **OK**;
  - not → **Manquant dans Hazu** (fix: add as student to R);
  - every other room of the same type where the student holds `student` → **En trop**
    (fix: remove).

Group truth of the last sync (`person_room_assignments`) is the Hazu side. Role other than
`student` in R (e.g. a student profile as mentor): reported « autre rôle », not fixed.

A row whose student is ignored or unresolved is not checked. Two rows resolving to the same student:
both are checked, and the student is flagged « deux lignes du fichier » (my call; excess is computed
against the union of both rows' rooms).

**Leavers.** The Verify leaver list, reused as is (`findLeavers`, the class filter that starts empty,
« Archiver la sélection » → `archivePerson`), shown as the last section. Only rows with a name column
feed it, as in Verify.

### Results UI
```
┌ Contrôle ─────────────────────────────────────────────────────────────┐
│ ① Colonnes ✓   ② Correspondances ✓   ③ Résultats        [Correspondances enregistrées]
├───────────────────────────────────────────────────────────────────────┤
│ 198 élèves contrôlés · 571 relations OK · 14 manquantes · 9 en trop · 3 non vérifiables
│ [Classe] [Entreprise] [Canton]  [Manquant] [En trop] [Non vérifiable]  🔍 élève…
├───┬──────────────────┬──────────┬───────────────────┬──────────────────┤
│ ☐ │ Élève            │ Type     │ Fichier           │ Hazu             │
├───┼──────────────────┼──────────┼───────────────────┼──────────────────┤
│ ☐ │ Exemple Alice    │ Entrepr. │ Hôtel du Lac      │ — absent         │ Manquant → ajouter
│ ☐ │ Exemple Alice    │ Entrepr. │ —                 │ Restaurant Gare  │ En trop → retirer
│ ☐ │ Exemple Bruno    │ Classe   │ CUI 2A            │ — absent         │ Manquant → ajouter
│   │ Exemple Chloé    │ Canton   │ (ignoré) Vaud-old │ ?                │ Non vérifiable
├───┴──────────────────┴──────────┴───────────────────┴──────────────────┤
│ 3 sélectionnés : 2 ajouts, 1 retrait      [Cocher les manquants] [Corriger la sélection]
└───────────────────────────────────────────────────────────────────────┘
▸ Élèves dans Hazu, absents du fichier (class filter, archive) — as in Verify
```
- One line per **pair that needs attention**; OK pairs are only counted (a toggle « afficher les OK »
  lists them). Lines grouped by student, sorted by name. Filters by type and status, free search.
- Nothing is ticked by default. « Cocher les manquants » ticks every visible « Manquant » line; there
  is no « tick all removals » shortcut (my call: removals are picked one by one).
- « Corriger la sélection » opens one confirmation: number of additions and removals, the removal
  lines listed by name, a warning when a removal is a company (« 5-Enterprise ne trouvera plus
  l'entreprise de l'élève »), and S4's slowness (~22 s per write). Confirm enqueues one
  `roleUpdate` per line: add = `oldRole '_' → 'student'`, remove = `'student' → '_'`.
- While its task is queued or running a line shows the task's state and its box is locked. When the
  queue drains, persons and assignments are reloaded and the check recomputed (correspondences are
  kept); a line that is now OK disappears, a failed one stays with « échec — voir la file ».
- **Changing the file** resets mappings, results and ticks — not the saved correspondences.

### Files (builder may adjust names)
- `src/shared/correspondence.ts` — pure: keys, `resolveRoomValues`, `resolveStudents` (saved link →
  matcher), stale detection. Tests beside it.
- `src/shared/cross-check.ts` — pure: pairs and statuses, excess rules, fix list. Tests beside it.
- `src/main/services/correspondence.service.ts` — the table's IO; IPC in ipc/index.ts, preload.
- `src/renderer/components/bulk-import/controle/` — `ControleTab.tsx`, `CorrespondencePanel.tsx`,
  `SavedCorrespondencesDrawer.tsx`, `ControleResults.tsx`, `FixConfirmModal.tsx`,
  `controle-logic.ts` (+ test). The leaver section reuses `PersonCheckResults`' leaver part (extract
  it into its own component if needed, without changing Verify's behaviour).
- `app-mode.ts`: workflow `'controle'`, complete mode only; BulkImportPage: the tab, label
  « Contrôle ».
- CLAUDE.md: a « Contrôle » subsection under Bulk Import.

## Calls settled after the builder check (my calls, maintainer to check)
- **Sync state.** The archive's `syncState` decides: a sync running, failed, quit, or with
  `sync_skipped_groups > 0` **blocks step 3** (« synchronisation incomplète — synchronisez
  d'abord »), because group truth would be partial and produce false « Manquant » / « En trop ».
  Older than 24 h only warns, above the results.
- **Stale student links.** A saved student link whose person is no longer a local student is
  « lien périmé », unresolved, exactly as for rooms — never treated as ignored (that would hide a
  leaver).
- **Key collisions.** A saved link is applied only when it does not contradict the row: if the
  row's e-mail exactly hits **another** person, the row goes to « à vérifier » with the saved
  person and the e-mail's person as candidates. When two rows of the file share a `name:` key and
  have no e-mail, the saved name link is not applied to them and their decisions are not saved
  (the key cannot tell them apart).
- **Duplicate titles.** Exact matching counts only rooms of the column's type. Two rooms of that
  type with the same title → unresolved; the dropdown shows both with their parent folder so the
  operator can tell them apart. A saved link holds the room id, so it cannot drift to the twin.
- **Categories.** Links are per category; the same text in the class and company columns is two
  independent links.

## Left to the builder
Component split, exact French wording of minor labels, whether the drawer is a side panel or a
modal, the pagination/virtualisation of the results list (a few hundred lines expected).

## Decided by the maintainer (2026-11-26)
- **En trop is proposed for every category, unticked.** A student may legitimately be in several
  classes; the operator decides line by line. A student has exactly **one company** and **one
  canton**: for those two, the « En trop » line also carries « Hazu : n entreprises » / « n cantons »
  when the student holds more than one.
- **CIE rooms are not classes.** They are `room_type = 'cie'`, never candidates for the class column
  and never checked (the 2+ classes count above is `class` rooms only).
- **One value per cell.** A separator (`/`, `;`) is part of the name.
