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

## Check 2 — role removal (`update-user-roles` to `_`)

Pending. The test class has no role groups, so it cannot show whether the call removes the group
membership, the class tag and the direct room grant together.

## Check 3 — the next sync after a move back

Covered by the acceptance run (archive → restore → sync on a scratch copy).
