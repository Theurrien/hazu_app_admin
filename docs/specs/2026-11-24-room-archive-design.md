# Room archive — design

Status: **implemented, 2026-11-24.** The privacy decision (Archive `private`, room folder `unlisted`; access never changed) is in §5.
Evidence: [the move/access probe](../archive-move-probe-findings.md) (live, 2026-11-24).

## 1. Why

The school's Hazu keeps every class, CIE course, company and canton room ever created, with its
five role groups and a breadcrumb tag on every member's profile. Old rooms stay in every list: the
category folders in Hazu, the app's sync, Matrix and Missions, and the widgets (5-Enterprise finds
an apprentice's classes from `hz-config-class-{id}-student`, the CIE dashboard a teacher's courses
from `-courseteacher`). The archive takes a room out of all of these **without destroying
anything**, so it can be restored exactly.

## 2. Goals, non-goals, anti-goals

**Goals**
- Archive one room (class, CIE course, company, canton) from a new **Archive** tab.
- After archiving, the room no longer shows in its category, in the app (sync, Matrix, Missions,
  Discrepancies) or in the widgets.
- Restore an archived room to where it was, with its groups and tags.
- Room, groups and archive record are kept together in one place.

**Non-goals**
- **Access is not changed.** Groups stay attached, direct grants stay, members keep access to the
  room and can still open it by id. That is acceptable (decided 2026-11-24): the room is only
  hidden from lists, not locked.
- Persons are not archived, deleted or changed beyond the tag removal.
- Bulk archiving (a whole school year at once). One room per action; a batch can come later.
- The CIE year-folder archive (`CIE 2024`, `CIE 2025`): those courses are outside sync (S8), so
  the tab cannot list them. Their tags remain unmatched ids on the Discrepancies page, as today.

**Anti-goals** — it is a failure, even if it "works", if:
- anything is deleted that a restore needs (groups, the room, its children, the record of where it
  came from);
- a role group's membership changes as a side effect (see the rejected nesting, §4);
- a half-finished archive is reported as done, or cannot be finished by running it again.

## 3. What the probe established

- `PUT /moveElement {id, targetHazuId, loginId}` keeps the **id**; children follow; tags stay; the
  link keeps its last segment (slug or id) and takes the new parent's prefix; moving back restores
  the link exactly. `loginId` = `settings.user_id`.
- **A move changes no ACL.** Access is stored per Hazu, not recomputed from the parent.
- A moved group keeps granting access; membership changes still reach the rooms it is attached to.

## 4. Approaches

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | **Move room + groups into one folder per room inside a hidden archive Hazu; remove profile tags** | Categories and sharing container hold only live rooms; one place per archived room | **Chosen** |
| B | Archive in place: mark the room `archived`, sync skips it | No move; but categories in Hazu stay as cluttered as today | Rejected — misses the goal of fewer listed Hazus |
| C | Groups nested **inside** the class | One place, like A | Rejected — anything inside the class receives the class's access when someone propagates it (Hazu's "apply to sub-Hazus", a propagate call). A group's ACL *is* its membership, so students could land in the teacher group |
| D | Also remove members' access | Locked archive | Dropped — the user does not need it, and it needs propagate calls on every child |

## 5. Layout in Hazu

```
admin Hazu (hz-config-admin)
├── sharing container (hz-config-sharing)       ← live role groups only
└── Archive                                      tag hz-config-archive, privacy private
    └── {room title}                             one folder per archived room, privacy unlisted
        │   tags: hz-config-archive-room
        │         hz-config-archive-class-{classId}
        │         hz-config-archive-from-{originalParentId}
        │         hz-config-archive-type-{class|cie|enterprise|state}
        │         hz-config-archive-at-{ms}
        ├── {the room}                           same id, children, tags, ACL
        └── Groupes de partage                   tag hz-config-archive-groups, privacy private
            └── the room's role groups           same ids, ACLs (membership) unchanged
```

- The **Archive Hazu** is found among the admin Hazu's children by `hz-config-archive`, and created
  on the first archive if missing. It is **private** and the per-room folder **unlisted** (check 0.1, §8,
  done 2026-11-24): a member can no longer reach the room from any list, only from their own
  favourites, and cannot climb from the room to other archived rooms. The room's own privacy is
  left as it was.
- The per-room folder is created **inside the Archive**, so it takes the admin-only access, never
  the room's. Nothing of the room's sharing reaches the groups.
- The record lives in the folder's tags, so the archive is self-describing: no local table is
  needed, and another machine running the app sees the same archive.

## 6. Archive one room

Preconditions: complete mode; a sync has run (rooms, groups, persons' tags come from it); the room
is a synced room whose parent is a category (`parent_id = root_hazu_id`'s child), not already in
the archive; **the room has a `class_id`**. Groups, tags and the folder are all found by it, so a
room without one (one per type in the 2026-11-24 data) is listed with « identifiant de classe
manquant » and no Archive action, until a sync or room completion fills it. *(Builder's call.)*

Steps, in this order. **Every step checks the live state first and skips what is already done**, so
a stopped run is finished by starting it again.

1. **Read live**: the room (exists, current parent), its role groups (children of the sharing
   container whose `hz-share-{role}-{classId}` matches — read live, not only from
   `distribution_groups`), and the profiles holding any `hz-config-class-{classId}-{role}` tag.
2. **Ensure the Archive Hazu**, then **the per-room folder** (found by
   `hz-config-archive-class-{classId}`; created with the record tags if missing), then
   **Groupes de partage** inside it. The record is written **before anything moves**.
3. **Move each role group** into Groupes de partage (skip if already there).
4. **Move the room** into the folder (skip if already there).
5. **Remove the tags** `hz-config-class-{classId}-{role}` from every holder, through the checked
   tag-removal call, verified by re-reading the profile (the S7 rule: the read decides, not the
   status code). Holders come from local `persons.tags`; a stale holder that no longer has the tag
   is a no-op.
6. **Update local SQLite** in one transaction: delete the room's `rooms` row and its
   `person_room_assignments`, set the groups' `distribution_groups.room_id` to NULL, patch the
   holders' `persons.tags`, drop its `membership_issues`. Matrix and Missions update without a
   re-sync; the next sync agrees because the room is no longer under a category.

Moves come before the tags on purpose: a run that stops after the moves leaves an archived room
whose tags still show in some widgets — finished by re-running. The reverse order would leave a
live room missing from widgets.

## 7. Restore one room

The Archive tab lists archived rooms **live** from the Archive Hazu (its children with
`hz-config-archive-room`), reading type, origin and date from the tags.

1. **Read live**: the folder, the room in it, the groups in Groupes de partage, the origin parent.
   If the origin parent no longer exists (404), stop with that message — no guessing a category.
2. **Move the room** back to the origin parent (skip if already there).
3. **Move the groups** back to the sharing container (skip if already there).
4. **Add the tags back** for every current member of each group: read each group's ACL, resolve
   members to profiles as the sync does (e-mail or account UID, super-users excluded), add
   `hz-config-class-{classId}-{role}` (S3 add-only heal). Members with no local profile are listed,
   not guessed. A profile that held the tag without being a group member (an orphan tag) does not
   get it back: groups are the truth, the tag only mirrors them, so the archive records no holder
   list. *(Builder's call.)*
5. **Remove the then-empty folders** (Groupes de partage, then the per-room folder) — only after a
   live listing shows them empty. A non-empty folder is left and reported.
6. Ask for a sync (or reconcile the room locally) so Matrix shows it again.

## 8. Checks before building (live, with the maintainer)

Check 0.1 is the **first task of the plan and gates the rest**: its answer fixes how the Archive
Hazu is created (which privacy value or tag), so nothing that creates the Archive Hazu is written
before it. *(Builder's call.)*

- **0.1 Unlisted.** Create the Archive Hazu, move « Cui Test 2 » (`wP5g2WTRCgpW54KQpLAJ`) into a
  per-room folder in it, and look from the maintainer's test teacher account: does the class still
  appear on that account's Hazu home / "shared with me" lists? Which Hazu setting (privacy value,
  `hz-config-hide-from-shared` as the groups carry, or the parent's access alone) keeps it off?
  Move it back after. If Hazu's own lists cannot be kept clean, the archive still meets its other
  goals and the design stands; the finding is recorded.
- **0.2 Category predicate.** Confirm the moved room disappears from the next sync and the restored
  one reappears with the same `class_id` and assignments.

## 9. The Archive tab

- New page `archive`, **complete mode only** (like Missions); added in `app-mode.ts`, not at call
  sites.
- Two lists: **Live rooms** (from local `rooms`, filter buttons Classe / CIE / Entreprise / Canton
  plus search, showing member count and parent) with an **Archiver** action; **Archivées** (live
  from Hazu, same filters) with **Restaurer**.
- Archive and Restore each open a confirmation modal that states what will happen with counts
  (groups to move, profiles losing / regaining the tag) and, for a company or canton room with
  members, that their dashboards will no longer list it.
- No extra gate beyond the padlock and the confirmation modal: nothing is deleted and every step
  is reversible. *(Builder's call.)*
- Each action is **one Task Queue task** (`archiveRoom` / `restoreRoom`), so it shows progress,
  errors and retry like every other write.

## 10. Code shape (house pattern)

- `room-archive.ts` — pure core, IO injected (`read`, `list`, `create`, `move`, `removeTags`,
  `addTags`, `acl`, `sleep`): the per-step skip decisions, `runArchive`, `runRestore`, retry with
  `isRetryableError` / `backoffMs`, verify-by-read after each write. Tests beside it.
- `room-archive.service.ts` — the IO layer: real calls, settings (`user_id`, `admin_id`,
  `sharing_container_id`), local reconcile in its own try/catch.
- `api.ts` — `sendApiRequestMoveChecked` (`PUT /moveElement`, 60 s timeout, rethrows).
- IPC `ARCHIVE_LIST`, `ARCHIVE_PLAN`, `ARCHIVE_EXECUTE`, `ARCHIVE_RESTORE_PLAN`,
  `ARCHIVE_RESTORE_EXECUTE`; types in `shared/`.
- CLAUDE.md section describing the layout, the order and the success rule.

## 11. Success rule

The live state decides, not the status codes (as S4/S6/S7). An archive is **done** when a live read
shows the room and every role group inside the folder, and no holder profile still carries the
tag. A restore is done when the room is back under its origin parent, the groups are back in the
sharing container, and every resolved member has the tag. Anything short of that is reported as
partial, naming what is left, and re-running continues from there.

## 12. Known consequences

- **Groups leave the sharing container.** No widget in the Hazu Artifacts repo reads the sharing
  container or the `hz-share-*` group tags (searched 2026-11-24); the app's sync stops seeing
  them, as intended. An archived room receives no role writes, and a restore puts the groups back
  before any are needed. An n8n/Make flow outside both repos that lists the container would no
  longer see archived groups — the intended effect.
- **The access-removal recipe** in the probe findings is not used (approach D).
- A stored **path** link to an archived room breaks while it is archived; links by id keep working.
- Archiving a **company** whose apprentices are still in training removes its tag from their
  profiles, so 5-Enterprise no longer finds their enterprise. The modal warns; the app does not
  block it.
- Persons whose only rooms are archived stay as they are (non-goal); they show in Persons and
  Matrix with no live room.

## 13. Left to the builder

The French UI copy, the exact modal layout, how the Archive tab's live list is cached during a
session, and how restore step 6 reconciles locally (re-sync prompt vs. local insert).
