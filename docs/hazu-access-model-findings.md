# Hazu Access Model & Sync Findings

> Investigation record (2026-07). Captures the shared understanding reached while
> debugging the Bulk-Assignment 500s and the Matrix reporting/updating bugs, so we
> don't have to re-derive it. Companion to
> [matrix-group-truth-rebuild-spec.md](matrix-group-truth-rebuild-spec.md).

## TL;DR

- **Sharing groups (a.k.a. distribution groups) are the source of truth for access.** A room
  grants access by referencing role-groups; a person has a role in a room **iff they are a
  member of that room's role-group**.
- **Profile tags are a derived breadcrumb**, not authoritative. Groups overrule tags.
- **The Matrix currently shows the tag layer, not the group layer** — that is the reporting bug.
- **Writes go through a non-atomic admin endpoint** (`update-user-roles`) that sets tag +
  group membership in separate steps and can fail mid-way — that is the updating bug (and the
  intermittent 500s).
- **Identity gap:** the ACL identifies people by **account UID**; the app keys `persons` by
  **profile-node id**. There is no stored mapping — the only bridge is **email**.

## 1. The access-control model (two layers)

| Layer | What it is | Where it lives | Authoritative? |
|-------|-----------|----------------|----------------|
| **Sharing / distribution group** | One Hazu entity per (room, role), e.g. "2025 CUI-C c Student". Its **ACL is its membership**. | Under the `hz-config-sharing` container (child of `admin_id`); referenced in each room's ACL | **Yes — grants access** |
| **Profile tag** | `hz-config-class-<roomId>-<role>` on the person's profile | The person profile's `tags` | No — a record that the invite happened |

**Groups overrule tags.** A tag with no matching group membership grants nothing.

### Tag families (two parsers, don't confuse them)
- `hz-config-class-<roomId>-<role>` — **profile breadcrumb**. Parsed by `parseAssignmentTag`
  ([sync.service.ts:381](../src/main/services/sync.service.ts#L381)), split on the **last** hyphen.
- `hz-share-<role>-<roomId>` — **group identity** (the group's own tag). Parsed by
  `parseShareTag` ([sync.service.ts:405](../src/main/services/sync.service.ts#L405)), split on the **first** hyphen.
- Both key on the **room id**. The `<roomId>` in the tag == the class room's own Hazu id.

### A group's members = its ACL
`list_children` on a group returns no member children — membership is only readable via
`getAclInfo(groupId)` (`GET /acl?id=<groupId>`). Same for a room: `getAclInfo(roomId)` returns
its ACL entries.

## 2. Identity model (critical, and non-obvious)

There are **two ids per person**:

| | Example (Student One) |
|---|---|
| **Profile-node id** (the Hazu entity; `persons.id`) | `3L0LitHlKovjiK5e3rSN` |
| **Account UID** (the auth user; ACL `authorId`) | `6Dxet6Tb9vTngFlr34V9FcLCVsZ2` |
| **Email** (the only bridge) | `student.one@example.invalid` |

- `persons` is keyed by **profile-node id**; the ACL is keyed by **account UID**. They are
  different strings and there is **no stored mapping**.
- The bridge is **email**: `persons.email` ↔ ACL entry `description`, backed on the profile by
  the `hz-config-userid-<email>` tag.
- Consequence: to connect group membership (UID) to a local person (profile id), you must
  **join on email**.

### ACL entry shape
`getAclInfo` returns `{ data: AclEntry[] }`; `AclEntry` =
`{ description, displayName, key, authorId, role, groupId, isGroup }`
([interfaces.ts:84](../src/main/services/hazu-api/interfaces.ts#L84)).
- `role` is the **permission** (owner/admin/reader), **not** the semantic role.
- The **semantic role** (student/teacher/…) comes from **which group** (`groupId`) the entry
  belongs to. A room ACL entry with `isGroup: true` + `groupId: <student group>` means "member
  via the student group".

## 3. How the app currently syncs (and why it's wrong)

`person_room_assignments` is what the **Matrix reads**. It is populated by **two** paths:

1. **Tag-derived** — `syncPersonRoomAssignments(personId, tags)`
   ([sync.service.ts:427](../src/main/services/sync.service.ts#L427)), called from the main
   person sync ([:359](../src/main/services/sync.service.ts#L359)) with the **profile id**. It
   parses each `hz-config-class-*` tag → room → writes an assignment. **This is what actually
   feeds the Matrix.**
2. **Room-ACL-derived** — `syncAssignments()`
   ([sync.service.ts:523](../src/main/services/sync.service.ts#L523)) reads each room's ACL but
   keeps only `!entry.isGroup` ([:527](../src/main/services/sync.service.ts#L527)). **Real
   students appear as `isGroup: true`** (they come via the student group), so this path **drops
   them all** and contributes almost nothing.

> **This is the reporting bug.** The truthful source (room/group ACL) is filtered out, so the
> Matrix ends up mirroring the **tag** layer — the one that isn't authoritative.

Other notes:
- Two conflicting `persons` insert paths — profile-id keyed ([:336](../src/main/services/sync.service.ts#L336))
  vs UID keyed ([:474](../src/main/services/sync.service.ts#L474)). Profile-id wins in practice.
- Groups are synced as **entities** into `distribution_groups`
  ([syncDistributionGroups, :660](../src/main/services/sync.service.ts#L660)) but their
  **membership is never read**.

### Writes
The Matrix cell edit and Bulk-Import Assignment both enqueue a `roleUpdate` task →
`WEBHOOK_UPDATE_USER_ROLE` ([ipc/index.ts:756](../src/main/ipc/index.ts#L756)) →
`POST /api-v2-admin/update-user-roles`. On an HTTP 200 it writes/deletes the local
`person_room_assignments` row ([:803](../src/main/ipc/index.ts#L803)). There is **no retry**.
The backend op is **multi-step and non-atomic** (tag + group membership) and can 500 mid-way.

## 4. The two bugs, explained

- **Reporting problem** — the Matrix shows the tag layer (§3), so it diverges from real group
  membership. Removing in the Matrix deletes the local tag-derived rows and looks "empty" even
  when the group still grants access.
- **Updating problem** — `update-user-roles` doesn't reliably propagate to the group. A removal
  can clear the local/tag view while the group membership (and thus access) remains.

## 5. Evidence

- **Enrollment 500 (Matthieu → CIE `4sKU7NZX3fXZsOMbmtGf`)** — deterministic per profile. The
  breadcrumb tag `hz-config-class-4sKU7N…-student` was written, but the group-add threw →
  **orphan tag**. Retries reproduce it; other students enroll fine, so it's profile-specific.
- **CUI-C c removal** — the student group `KC5ob7INtmW3uDvBJXqa` still grants access to **6**
  students after "removing all" via the Matrix. The Matrix looked empty because its tag-derived
  rows were deleted.
- **Room-vs-group disagreement** — the room's expanded ACL lists **6** students (incl.
  **Student Six**), but the student group's **own** ACL lists **5** reader-students (**no Student Six**).
  The two "truth" endpoints disagree by one — likely caching or a partially-applied change.
- **Unsynced member** — **Student Two** is in the student group's ACL but has **no local
  `persons` record** (an "unknown person").

## 6. API surface

| Endpoint | Use | Notes |
|----------|-----|-------|
| `POST /api-v2-admin/update-user-roles` | current assign/remove | profile-based; non-atomic; source of the 500s |
| `GET /api-v2-permissions/acl?id=` | list an item's ACL | the truthful read (rooms **and** groups) |
| `POST /api-v2-permissions/acl` | add user(s) to an item's ACL | granular, by-user — the clean write primitive |
| `DELETE /api-v2-permissions/acl` | remove user(s) from an item's ACL | granular, by-user |
| `PUT /api-v2-permissions/acl` | update user roles on an item | granular |
| `POST /api-v2-permissions/propagate` / `propagate-groups` | recurse ACL/group perms to children | for structure ops |
| `POST /api-v2-permissions/add-acl-by-token` | add authenticated user via invite token | how unregistered invitees get added |

## 7. Reference IDs — the CUI-C c case (env: swiss)

| Thing | Id |
|-------|----|
| Room "2025 CUI-C c" (class) | `LkxlSjtb0hnG4TpnvDDr` |
| Student group | `KC5ob7INtmW3uDvBJXqa` (tag `hz-share-student-LkxlSjtb0hnG4TpnvDDr`) |
| Schoolteacher group | `vOa9sGF9Lsf9GKJdviG6` |
| Companymentor group | `BY2CL452Jgioe1wbupSW` |
| Super User group (**ignore** — admins) | `LwII5jZn5RF98bMwIG9Y` |
| Students via room ACL (6) | Matthieu `3L0Lit…`/uid `6Dxet6…`, Artem `aLPUP…`, Student Six `7ybsah…`, Aurélien `RB8wfLk…`, lana `HPCOch…`, Tom (no local profile) |
| Student group direct members (5, no Student Six) | Matthieu, Artem, Aurélien, lana, Tom |

## 8. Still unknown (needs backend visibility)

- Why `update-user-roles` 500s for specific profiles (backend Cloud Logging via the response's
  `x-cloud-trace-context` names the failing line).
- The caching/consistency semantics behind the room-vs-group ACL disagreement (Student Six).
