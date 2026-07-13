# Matrix Group-Truth Rebuild — Spec

> Design spec. Companion to [hazu-access-model-findings.md](hazu-access-model-findings.md),
> which establishes the model this spec builds on. Granular per-task execution plans
> (superpowers:writing-plans format) are produced **per subsystem** when each is greenlit for build.

## Goal

Make the Matrix (and the app's assignment data) reflect **group/ACL truth** instead of the
profile-tag breadcrumb, surface every place tags and groups disagree, and heal the tags
one-way toward the truth — without ever silently changing access.

## Principles (non-negotiable)

1. **Groups are truth.** Assignments derive from group ACL membership, never from tags.
2. **Tags are a one-way, add-only mirror.** The app may *add* a missing breadcrumb to a
   confirmed group member; it never auto-removes tags and never auto-changes group membership.
3. **No silent drops.** Anything that can't be resolved (member with no email, member with no
   local profile, tag with no membership) is reported as a discrepancy, not discarded.
4. **The healer never touches access.** It writes tags only.
5. **Fix reads before writes.** Re-basing reads on group truth makes the Matrix self-verifying;
   write-reliability is a scoped follow-up (S4).

## Canonical source (decided)

Per the "groups are truth" rule, **`getAclInfo(group)` — a role-group's own membership — is
canonical.** The room's expanded ACL is a convenience/cross-check; room-vs-group differences
(e.g. Student Six) are **reported as discrepancies**, not reconciled silently.

## Target data model

- `person_room_assignments` (Matrix source) = **projection of group ACL membership**:
  one row per `(personId = profile id, roomId, semanticRole)` where the person is a member of
  the room's `<role>` group.
- Profile **tags** keep being synced (already in `persons.raw_data` / `persons.tags`) purely as
  the **comparison set** for discrepancy detection.
- New persisted discrepancy state (small table or computed-on-demand) — see S2.

## Identity resolution (shared by all subsystems)

Group ACL members are keyed by **account UID + email**; local `persons` are keyed by **profile
id + email**. Resolution rule:

```
resolvePerson(aclEntry):
  1. if aclEntry.description looks like an email → match persons.email (case-insensitive) → personId
  2. else (uid-only entry) → UNRESOLVED (record as discrepancy, do not drop)
  3. email present but no local person → UNKNOWN (record as discrepancy: "in group, not synced")
```

System accounts (`@hazu.io`: Support/Genius/Système Hazu) and the **Super User** admin group
(`LwII5jZn5RF98bMwIG9Y`) are filtered out everywhere.

---

## Subsystems

Each is independently buildable and testable, in order. S1–S3 are the core; S4 is the
write-reliability follow-up.

### S1 — Group-membership sync (the truth source)

**Responsibility:** populate `person_room_assignments` from group ACL membership; retire the
tag-derived and `!isGroup` paths as the *source of truth*.

**Files**
- Modify `src/main/services/sync.service.ts`
  - Add `syncGroupMemberships()`: for each row in `distribution_groups` (already synced), call
    `getAclInfo(group.id)` → members; `resolvePerson` each; write
    `person_room_assignments(personId, group.room_id, group.role)`.
  - Retire `syncPersonRoomAssignments` ([:427](../src/main/services/sync.service.ts#L427)) and
    the `!isGroup` room-ACL path ([:523](../src/main/services/sync.service.ts#L523)) as truth
    sources (keep tag *reading* only for S2's comparison set).
- Add `src/main/services/hazu-api/resolve.ts` — `resolvePerson(entry, personsByEmail)` and the
  system-account/Super-User filter.
- Possibly `src/main/database/schema.sql` — a `membership_unresolved` table (uid, email,
  group_id, room_id, role, reason) for UNRESOLVED/UNKNOWN members surfaced during sync.

**Interfaces produced**
- `syncGroupMemberships(): Promise<{ written: number; unresolved: number; unknown: number }>`
- `resolvePerson(entry: AclEntry, byEmail: Map<string,string>): { personId: string } | { reason: 'unresolved' | 'unknown' }`

**Cost / throttling:** one `getAclInfo` per group ≈ (rooms × roles). Reuse the existing sync
progress reporting; throttle concurrency. Consider a per-room on-demand mode later.

**Done when:** after a sync, the Matrix for `LkxlSjtb0hnG4TpnvDDr` shows the real student-group
members (not the tag view), and unresolved/unknown members are recorded.

### S2 — Discrepancy detection + report (read-only)

**Responsibility:** compute and present, per `(room, role)`, where tags and group truth diverge.

**Discrepancy types**
- **orphan-tag** — profile has `hz-config-class-<roomId>-<role>` but is **not** in the group.
- **missing-tag** — in the group but **lacks** the tag. *(healable — S3)*
- **unresolvable** — group ACL entry with no email (can't map to a person).
- **unknown** — resolvable email but **no local `persons`** record (e.g. Tom).
- **room-vs-group** — appears in a room's expanded ACL via a group but not in that group's own
  ACL (e.g. Student Six).

**Files**
- Add `src/main/services/discrepancy.service.ts` — pure comparison over group truth (S1 output)
  vs the tag set (from `persons`), returning typed discrepancies.
- Add IPC `DISCREPANCIES_GET` (channel + handler + preload).
- Add `src/renderer/pages/DiscrepanciesPage.tsx` (or a tab) + a list/table component; nav entry.

**Interfaces produced**
- `computeDiscrepancies(opts?: { roomId?; role? }): Promise<Discrepancy[]>`
- `Discrepancy = { type; roomId; roomTitle; role; personId?; email?; uid?; note }`

**Done when:** the report lists, for CUI-C c, the orphan/missing/unknown/room-vs-group cases we
found by hand (Matthieu-type orphan, Tom unknown, Student Six room-vs-group).

### S3 — Tag healing (add-only)

**Responsibility:** for **missing-tag** discrepancies, add the breadcrumb to the profile.

**Rules:** add-only; visible/logged; separate phase from sync; never touches group membership.

**Files**
- Add `src/main/services/heal.service.ts` — `healMissingTags(discrepancies)`: for each
  missing-tag, add `hz-config-class-<roomId>-<role>` to the person profile (idempotent) via the
  tag-add API; return a log of what changed.
- Add IPC `TAGS_HEAL` (channel + handler + preload).
- Renderer: a "Heal" action on the discrepancy report (report + one-click apply first;
  auto-on-sync only once trusted).

**Interfaces produced**
- `healMissingTags(items: Discrepancy[]): Promise<{ healed: Array<{personId; roomId; role}>; failed: Array<{...; error}> }>`

**Done when:** a missing-tag row can be healed, is logged, re-running the report shows it gone,
and access is provably unchanged.

### S4 — Write reliability (follow-up)

**Responsibility:** make assign/remove actually and verifiably change group membership.

**Approach:** move off `update-user-roles` onto the permissions API operating **directly on the
role-group's ACL** by user:
- assign → `POST /api-v2-permissions/acl` on the group (add the user)
- remove → `DELETE /api-v2-permissions/acl` on the group
Add **retry-with-backoff** on 5xx/network and **post-write verification** (re-read the group ACL
and confirm the change) before reporting success. Route Matrix cell edits + Bulk-Import
Assignment through this.

**Files**
- Add `src/main/services/hazu-api/permissions.ts` (the `/api-v2-permissions/acl` client).
- Modify the role-update IPC handler ([ipc/index.ts:756](../src/main/ipc/index.ts#L756)) and
  the Task Queue `roleUpdate` path.

**Open:** whether the group-ACL write needs the account UID (yes) and where we source it (the
group ACL read gives UID; new members come via `add-acl-by-token`).

---

## Phasing

`S1 → S2 → S3 → S4`. Each ships independently: S1 makes the Matrix truthful; S2 makes drift
visible; S3 repairs the cheap/safe half of the drift; S4 makes writes reliable.

## Testing strategy

- **Unit:** `resolvePerson` (email match / uid-only / unknown), `parseAssignmentTag` /
  `parseShareTag`, the system-account filter, and `computeDiscrepancies` — table-driven with
  fixtures.
- **Fixture acceptance:** the **CUI-C c** case is the golden fixture. Expected group-truth =
  {Matthieu, Artem, Aurélien, lana, Tom}; expected discrepancies = Tom (unknown), Student Six
  (room-vs-group), any orphan tags. Assert S1/S2 reproduce it.
- **Healing:** verify add-only + idempotent + access-unchanged (group ACL identical before/after).
- **Manual/e2e:** run a real sync, open the Matrix on CUI-C c, confirm it matches the group ACL.

## Non-goals

- Fixing the Hazu backend's non-atomic `update-user-roles` (we route around it in S4).
- Changing Hazu's data model (groups vs tags vs uids) — we consume it as-is.
- Auto-removing tags or auto-changing group membership.

## Open decisions

1. **Throttling** for the N group-ACL calls per sync — global concurrency cap vs per-room
   on-demand loading of the Matrix.
2. **Discrepancy report UX** — dedicated page vs a panel on the Matrix; grouping and filters.
3. **Heal trigger** — start with report + one-click apply; revisit auto-on-sync once trusted.
4. **Unknown persons** (Tom) — auto-pull their profile into `persons`, or just flag?

## Next step

Greenlight **S1** and I'll produce its granular, test-first execution plan
(superpowers:writing-plans format) and build it.
