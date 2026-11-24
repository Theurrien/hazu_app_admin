# Room archive: move/access probe findings (2026-11-24)

Live probe on throwaway Hazus in the admin Hazu, plus one move round-trip of the test class
`wP5g2WTRCgpW54KQpLAJ` (« Cui Test 2 », École professionnelle, no sharing groups). The only
non-admin account used was the maintainer's own test teacher account. All probe Hazus were deleted
afterwards; the test class was restored exactly (parent, link, tags, ACL, children identical).

## Move — `PUT https://{endpoint}/moveElement`
Body `{ id, targetHazuId, loginId }`, header `x-api-key`. `loginId` = the API account's UID
(`settings.user_id`). Answer `200 {"isSuccess":true}`.

- **The id never changes.** Class ids, `hz-config-class-{id}` and `hz-share-{role}-{id}` stay valid.
- Children move with the room and keep their ids; tags are kept.
- `link` is rewritten: the last segment (a custom slug such as `m_classe`, or the id) is kept,
  the prefix follows the new parent. Moving back restores the original link exactly.
- **A move changes no ACL.** Access is stored per Hazu; it is not recomputed from the new parent
  (the class kept its 8 entries in the admin Hazu, while its category lists 388). So moving alone
  removes nobody's access.
- Works on groups too.

## Groups
- Room ACL entries carry `groupId` = the group that granted them; a group's own ACL is its membership.
- A member joining a group appears on every room the group is attached to, with the role they have
  in the group — **also after the group was moved** out of its original container.
- `DELETE /api-v2-hazus/{roomId}/groups {groupIdentifier}` (201) detaches the group from the room
  itself **only**; the group's entries stay on the room's children.
- `POST /propagatePermissionsApi {creatorId, currentLang, link, isRemove:true, onlyPublic:false,
  userIdOrEmail: groupId, type:'group'}` (200) then removes them from the children.
- Restore: `POST /api-v2-hazus/{roomId}/groups` (201) re-attaches on the room only; the same
  propagate call with `isRemove:false` brings the children back.
- `POST /api-v2-permissions/propagate-groups` answered 400 to `{itemId}` and `{id}` — unused.

## Direct (per-person) grants
- Add: `POST /api-v2-permissions/acl {itemId, loginId, role}` — accounts only; an unknown e-mail
  answers `status: not_found`.
- **Remove with propagate first:** `propagatePermissionsApi` with `type:'user'`, `isRemove:true`
  while the person is still on the room removes them from the room **and** its children in one call.
  `DELETE /acl {itemId, userId}` first removes the room entry only, and the propagate afterwards
  answers 404, leaving the children untouched.

## Consequences for the archive design

**Superseded 2026-11-24:** the archive changes no access (see
[the archive design](specs/2026-11-24-room-archive-design.md), approach D). The steps below are
kept only as the recipe should access removal ever be wanted.

1. Archive = detach + propagate-remove each role group, propagate-remove each direct grant (record
   them first), remove the profile tags, move groups and room into the archive.
2. Restore = move back, re-attach + propagate each group, re-add + propagate the recorded direct
   grants, re-add tags for current group members (S3 heal logic).
3. Any stored path link to an archived class breaks while it is archived; id links do not.
4. Super-user and other admin entries stay on the room; the archive Hazu sits in the admin Hazu.

## Hiding the archive (check 0.1, 2026-11-24)

Test class moved into `Archive (test) → per-room folder`, inside the admin Hazu, viewed from the
maintainer's test teacher account (which keeps access to the class).
- With **Archive `privacy: private`** and **per-room folder `privacy: unlisted`** (set by the
  maintainer): the class is reachable only from the account's own Hazu favourites, from no other
  list, and the account cannot climb to other archived rooms.
- The class's own privacy was already `unlisted` (24 of 32 classes, 5 of 15 CIE courses; the rest
  and all companies and cantons are `private`) and is left unchanged by the archive.
- No hide tag is needed. The class was moved back and matched its saved state exactly; the test
  folders were deleted.

## Acceptance from the app (2026-11-24)

Built app on a scratch copy of the userData, test class « Cui Test 2 » (no role groups), driven by
the maintainer.
- **Archive** (`success=true`): Archive Hazu created (`private`, `hz-config-archive`, under the
  admin Hazu) → per-room folder « Cui Test 2 » (`unlisted`, the five record tags, HTML-free title)
  → the class and « Groupes de partage » (`private`, empty). The class's ACL, tags and children
  were unchanged; its local `rooms` row was removed; the one profile holding its class tag lost it.
- **Restore** (`success=true`): the class is back under École professionnelle with the original
  link, tags, ACL and children; both folders were removed (the Archive Hazu stays, empty).
- **Expected loss:** the profile's `hz-config-class-{id}-student` tag was not re-added — the class
  has no student group, so the tag mirrored no membership (orphan tag); restore re-adds tags only
  from group members (design §7).
- Not exercised live: groups moving (the class has none — covered by unit tests) and an
  interrupted run (covered by unit tests).
