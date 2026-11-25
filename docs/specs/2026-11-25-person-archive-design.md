# Person archive and leaver detection — design

Date: 2026-11-25. Status: draft, awaiting approval.

## Intent

Students leave the school. Today their profile stays in the student folder and they stay in every
room they were in, so they keep showing up in Matrix, Missions and the room widgets. Urs wants to

1. **archive a person**: take them out of every room and move the profile into the Archive Hazu,
   without deleting anything;
2. **find the leavers**: read his Excel list of current students in Bulk Import → Verify, see which
   Hazu students are no longer on it, and archive them from there.

The room archive ([2026-11-24-room-archive-design.md](2026-11-24-room-archive-design.md)) is the
model; this extends it.

## Goals

- Archive any person (all six types) from the Archive tab; archive students in a batch from Verify.
- After an archive the person is in no live role group, holds no class tag of a live room, and the
  profile sits in the Archive.
- Restore puts the profile back in the folder it came from. **Rooms are not restored** — Urs
  re-assigns them by hand in Matrix (decided 2026-11-25).
- Verify matches a spreadsheet row to a Hazu profile by e-mail **or** by name, and lists the Hazu
  students no row matched.

## Non-goals

- The Hazu account is not deleted or disabled. The person can still sign in and open their own
  profile; they just see no room.
- Memberships in the groups of **archived rooms** are left alone (those groups sit in the Archive
  and are not synced).
- No leaver list for other roles than students. Other roles are matched if they are in the file,
  never listed as leavers.
- The Assignment tab's person matching stays exact-e-mail. The new matcher is written so that tab
  can adopt it later.
- No automatic archiving. Every archive is ticked and confirmed by Urs.

## Anti-goals

- **A current student archived because the match failed.** A name typed differently must end up in
  « à vérifier », not on the leaver list. When in doubt the matcher says "to check".
- **An archived profile still sitting in live groups.** Hence rooms first, move last.
- **A reported success that did not happen.** As everywhere in this app, the live read decides.

## Constraints found in the code

- `persons.email` is the value of the `hz-config-userid-*` tag: an e-mail on some profiles, an
  account UID on others. E-mail matching can therefore never be the only key — this is the real
  reason name matching is needed.
- The name is one string: the profile title. `first_name` / `last_name` are that title split at the
  first space and are not reliable. Compare against `display_name` only.
- The sync wipes `persons` and re-reads the person categories under root, so an archived profile
  leaves the app on the next sync by itself, and archived persons must be listed **live** from the
  Archive, as archived rooms are.
- Removing a student who is in many classes is the slow Hazu call (server work can outlast the
  120 s client timeout; see S4). A batch of leavers is slow by nature.
- Person data rule: no real name, address or id in any tracked file. Fixtures at `@example.invalid`.

## Approaches

**Taking the person out of rooms**

- *A — the role endpoint, once per room* (`reliableUpdateUserRole(person, room, oldRole, '_')`, S4).
  The supported path; clears the class tag as well; already retried, verified against the group ACL
  and reconciled locally. Slow for a student in many rooms. **Chosen.**
- *B — delete the person from each group's ACL directly* (the S6 call). Fast, but leaves the class
  tags and any direct grant on the room item, and bypasses the endpoint Hazu told us to use.
  Rejected.

**Where the record lives**

- *A — one folder « Personnes » in the Archive Hazu, record tags on the profile itself.* Fewest
  calls, but the profile gets foreign tags and sits directly in a shared folder. Rejected.
- *B — one `unlisted` folder per person inside a `private` « Personnes », record tags on the
  folder* (the room layout). **Chosen by Urs, 2026-11-25**: private parent + unlisted folder is what
  keeps the user from climbing out of their own profile, as measured for rooms (check 0.1 of the
  room archive). The profile itself is not modified at all.
- *C — a local table of archived persons.* Another machine would not see the archive. Rejected.

**Matching**

- *A — a pure matcher in `src/shared/`, three outcomes (matched / to check / none).* **Chosen.**
- *B — reuse `fuzzyMatch.ts` similarity scores with a threshold.* A percentage cannot tell a typo
  from two different short names; the anti-goal above needs an explicit "to check". Rejected, though
  the Levenshtein helper may be reused.

Urs left the how to the builder; these are the builder's calls, he has seen them.

## Part 1 — person archive

### Layout in Hazu

```
admin Hazu (hz-config-admin)
└── Archive                      existing, hz-config-archive, private
    ├── {room folders…}          existing
    └── Personnes                tag hz-config-archive-persons, privacy private, created on first use
        └── {person's name}      one folder per person, privacy unlisted
            │   tags: hz-config-archive-person, hz-config-archive-profile-{profileId},
            │         hz-config-archive-from-{originalParentId}, hz-config-archive-at-{ms}
            └── {the profile}    same id, children, tags, ACL, privacy — untouched
```

### Step 0 — live checks before any product code

On a test profile, with a scratch userData copy (CLAUDE.md, « Development runs use a scratch
userData copy »). Write the results to `docs/person-archive-probe-findings.md`, structurally, no
identifiers.

1. Moving a profile under a private folder in the admin Hazu: id, children, tags and ACL unchanged?
   Can the account still open its own profile? From it, can it climb to « Personnes » or see
   another archived person? (It must not.)
2. `update-user-roles` to `_`: does it remove the group membership, the class tag **and** the direct
   grant on the room item? If the direct grant survives, the archive adds the S6 removal for it.
3. Moving the profile back: does the next sync pick it up as before?

Any answer that contradicts this design comes back to Urs before building on.

### Archive order

Every step reads live state first and skips what is done, so a stopped run is finished by starting
it again.

1. Read the profile live; it must sit under a live person category (a child of root tagged
   `hz-config-profile-*`). Otherwise stop.
2. Rooms to leave = the person's rows in `person_room_assignments` (group truth of the last sync)
   **plus** every live local room named by a `hz-config-class-{id}-{role}` tag on the profile as
   just read (a membership the last sync missed usually still shows as a tag). For each:
   `reliableUpdateUserRole(personId, roomId, role, '_')`. Reading all ~835 group ACLs live per
   person is too slow; instead the confirmation modal shows the date of the last sync and warns
   when it is older than 24 h (builder's call).
3. **If any room is not confirmed removed, stop here**: profile not moved, `success:false`,
   `remaining` names the rooms.
4. Remove leftover `hz-config-class-{id}-{role}` tags that map to a **live local room**, through
   `sendApiRequestRemoveTagsChecked` (the call S7 and the room archive use), verified by re-reading
   the profile. These are tags the role call left behind; without this the widgets would still
   list the room. Tags of archived or unknown rooms are left.
5. Archive Hazu → « Personnes » (find or create) → the person's folder (find by record tags, or
   create with them) — the record is written before anything moves.
6. Move the profile into its folder (the room archive's verified move: read before resend, read after a failure).

### Restore order

1. Read the folder live: it must sit in « Personnes », carry a complete record and contain the
   profile (containment check).
2. The recorded origin must still exist and be a live person category. Otherwise stop — never guess
   a category.
3. Move the profile back; remove the folder, only after a live listing shows it empty. If the
   move is not confirmed the folder is kept — its tags are the only record of the origin.
4. Nothing else. The person returns to the app on the next sync, with no rooms.

### Success rule

Archive is done when a live read shows the profile inside its folder under « Personnes », and
every room removal was confirmed by S4. Restore, when the profile is back under its origin and the
folder is gone. Anything less is `success:false` with `remaining`.

### Local reconcile (own try/catch, full success only)

Delete the `persons` row, its `person_room_assignments` and `membership_issues` rows, and the
student's `formation_*` rows, so Matrix, Discrepancies and Missions update without a sync. Restore
changes nothing locally.

### Surface

- **Archive tab**: a second section « Personnes » — search live persons, « Archiver »; a list of
  archived persons (read live) with « Restaurer ». Confirmation modal: name, role, the rooms that
  will be left, and the sentence that restore does not bring rooms back.
- Each action is one Task Queue task: `archivePerson`, `restorePerson`. Complete mode only — add
  both to `ALL_TASK_TYPES` in `app-mode.ts`, not to the CIE list.
- IPC: `ARCHIVE_PERSON_LIST_ARCHIVED`, `ARCHIVE_PERSON_PLAN`, `ARCHIVE_PERSON_EXECUTE`,
  `ARCHIVE_PERSON_RESTORE_EXECUTE`.
- Files: `person-archive.ts` (pure core, IO injected, tests beside it),
  `person-archive.service.ts` (thin IO), types in `shared/archive-types.ts`. The retry / verified-move
  helpers in `room-archive.ts` are shared, not copied.

## Part 2 — leavers in Verify

### The matcher (`src/shared/person-match.ts`, pure, tested)

Input: spreadsheet rows (`email?`, `firstName?`, `lastName?`, or a single `fullName?` column —
all three name mappings are offered; the name key is built from whichever are mapped) and Hazu persons (`id`, `email`,
`display_name`). Normalise: lower case, accents stripped, hyphens / apostrophes / punctuation to
spaces, whitespace collapsed. A **name key** is the sorted set of words of « first name + last
name » on one side and of the title on the other, so order does not matter.

Per row, first rule that applies:

| Case | Result |
|---|---|
| E-mail equals a person's e-mail, name agrees or is absent | **matched** |
| No e-mail hit; name key equals exactly one person's | **matched** |
| E-mail hits one person, name key hits another | **to check** (both shown) |
| Name key equals several persons' | **to check** |
| Near name: one side's words all contained in the other (middle names, double names), or exactly one word differs by a small edit distance | **to check**, with the candidate |
| Nothing | **unknown** (in the file, not in Hazu — the existing « Unknown Persons » list) |

« To check » rows are confirmed or rejected by hand. **Leavers** = Hazu students claimed by no
matched or confirmed row **and** not the candidate of an undecided « to check » row. Rejecting a
candidate releases that student onto the leaver list.

### Surface

- Two new column mappings in Verify: first name and last name. The room column becomes optional:
  with it, the existing assignment diff runs (now through the matcher instead of exact e-mail);
  without it, only the person check runs. At least one of e-mail or (first + last name) is required.
- New result sections: « À vérifier » (confirm / reject) and « Élèves dans Hazu, absents du
  fichier » — shown only when the person type is Student. Each leaver row: name, rooms count,
  checkbox. « Archiver la sélection » opens one confirmation (how many students, how many room
  removals in total, that it is slow) and enqueues one `archivePerson` task per student.
- The archive button exists in complete mode only.
- **Scope** — see « Class filter » below.
- **Duration.** Tasks run one after another, as everything in the Task Queue; each can be retried
  on its own and a stopped batch is resumed by re-running Verify. No parallel role writes: the slow
  server job is exactly what S4 avoids re-triggering. The confirmation states the number of room
  removals so the wait is no surprise.

### Known consequences

- Archiving a mentor, teacher, advisor or guardian only removes their room access and moves the
  profile. What they wrote (assessments, reports) stays where it is and keeps counting in Missions.
- `formation_*` cleanup applies to students only.

### Class filter (Urs, 2026-11-25: the file is sometimes partial)

Above the leaver list, a multi-select of **school classes** (rooms of type `class`, from the last
sync) plus « sans classe ». The leaver list shows only students who are a member of a selected
class. Nothing is selected at the start, and **the list and the archive button stay empty until at
least one class (or « toutes les classes », an explicit choice) is picked** — a partial file can
then never propose the whole school by default (builder's call). The header always reads
« n élèves absents du fichier sur m dans les classes choisies ». Matching itself still runs against
every Hazu student, so a row is never « unknown » just because its student is outside the filter.

## Left to the builder

- Edit-distance threshold for « near » (start at ≤ 2, and only on words of 5+ letters; tune on the
  real list, in `output/`).
- Exact UI wording and layout, following the existing Archive and Verify components.
- Whether the archived-persons list is paged.

## Testing

Unit tests for the matcher (each table row, plus accents, hyphens, swapped order, two students with
the same name) and for the archive core (stops when a room is unconfirmed; re-run after a stop;
containment and origin checks on restore; move status vs. live read). Acceptance, on a scratch
userData copy: archive one test student in two rooms → check Hazu → restore → sync → student is
back, no rooms.
