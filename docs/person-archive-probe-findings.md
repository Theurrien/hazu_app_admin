# Person archive: live probe findings (2026-11-25)

Live probe on the maintainer's test student profile (a student in one real class, holding two class
tags, 13 children, 14 ACL entries). Scripts and raw output stay outside the repo. Spec:
[specs/2026-11-25-person-archive-design.md](specs/2026-11-25-person-archive-design.md), step 0.

## Check 1 — moving a profile into the Archive (done)

`Archive (existing, private) → « Personnes (probe) » (private) → folder (unlisted) → the profile`,
then back. Same `PUT /moveElement` as the room archive.

- **The id never changes**; the 13 children follow and keep their ids.
- **Tags, privacy and the ACL are unchanged** in the archive (all 14 entries, including the
  profile owner's and the role groups'). Only `parentId` and `link` differ.
- `link`: the last segment is kept, the prefix follows the new parent; moving back restores the
  original link exactly.
- A new folder under the Archive inherits ACL entries from its parent (6 on both probe folders);
  the profile's own entries are not merged with them.
- Created with `privacy: unlisted` / `private`, the folders read back with those values.
- After the move back every compared field equals the state before; both probe folders were removed.

**Not measured here:** what the account itself sees (can it open its profile, can it climb to
« Personnes »). The same private-parent / unlisted-folder pattern was measured for rooms (check 0.1
in [archive-move-probe-findings.md](archive-move-probe-findings.md)); for a profile it is checked
by the maintainer during the acceptance run.

## Check 2 — role removal (`update-user-roles` to `_`) (done)

The test profile was added as `student` to a test company room that has all five role groups, then
set back to `_`; group ACL, room ACL and profile tags were read before, between and after.

- **Add** (`_ → student`, 201, ~21 s): the account is in the student group; the room item carries
  one entry for it (`role: reader`, `isGroup: true`, `groupId` = the student group — the entry the
  group grants, the shape S6 calls the direct grant); the profile holds
  `hz-config-class-{room}-student`.
- **Remove** (`student → _`, 201, ~23 s): **all three are gone** on the first read 3 s later — the
  group membership, the room-item entry and the class tag.
- The profile ended exactly as it started (no entry, no tag for that room).

**Consequence:** the archive needs no separate removal of the room-item grant; S4's verified role
write covers it. Step 4 of the archive (leftover class tags) stays as a safety net for tags that
mirror no membership.

## Acceptance from the app (2026-11-25)

Built app on a scratch copy of the userData, the test student in one real class, driven by the
maintainer. All six steps passed.

- **Archive** (`success=true`, the one room removal `verified=true` on the first attempt): the
  per-person folder with the profile inside sits under « Personnes »; the student left the class's
  student group.
- **What the account sees** (checked by the maintainer, signed in as the test student): it still
  opens its own profile and cannot climb to « Personnes » or to anything else in the Archive.
- **Without a sync:** the student left Matrix and Missions and is listed under archived persons.
- **Restore, then sync:** the profile is back in the student folder with no rooms.
- The test student was archived again afterwards and left in the Archive on purpose.
- **Not exercised in this run:** the Verify steps (name matching, « à vérifier », leavers by
  class) — run separately on Windows, below.

## Verify on the Windows build (2026-11-25)

Version 1.0.9, installed by auto-update, driven by the maintainer in complete mode. The Verify
steps passed: with a name column mapped, the leaver list stays empty until a class is chosen and
then shows the student left out of the file; a slightly misspelt name lands in « À vérifier » and
not on the leaver list; « Archiver la sélection » opens its confirmation.
