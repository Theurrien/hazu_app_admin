# Level change — operator decisions — design addendum

Date: 2026-11-26. Status: ready for approval.
Extends [the level-change design](2026-11-26-level-change-design.md). Everything there still holds
unless this document says otherwise.

## Intent

The first live run (test profile, CUI AFP → CFC, 2026-11-26: 6 sections + colour, applied and
verified) showed that an older profile needs more than the level delta: it lacked two template
sections (« Boîte de guidance », « Learning FSRS »), carried one the template no longer has
(« Navigation »), and its own description was empty where the template holds the
`student_app.html` widget. The operator wants to decide these in the same preview, and to be able
to refuse the uncertain changes the tool proposes — without having to tick the clear-cut ones.

## What changes in the original design

Three original non-goals are lifted, as **opt-in actions** in the preview:
- copying sections found only in the template;
- deleting sections found only in the profile;
- adding the template's widget to the profile's own description.

Unchanged: tags not on the template are never touched; the level delta is still computed as before;
the colour is still written last; the live read still decides success; still one Task Queue task.

## Decisions (decided with Urs, 2026-11-26)

**Approach A — the decisions travel with the task.** The preview shows tick boxes; « Appliquer »
sends them with the task; the run re-plans live and applies only what was ticked. Rejected: separate
tasks per action (the colour could land before the copies; several previews per student) and a
general « sync profile with template » tool (much larger, reopens the tag rule).

**Only uncertain cases get a tick box.** Clear swaps (a source tag held → target tag) and
descriptions still equal to the old template are applied as today, with no box.

| Item | Uncertain because | Default |
|---|---|---|
| Tag added where the profile holds no tag of that family (e.g. the template's `hz-config-carnet-…` on a profile without any) | it points at the template's object, not one of the student's | ticked |
| Description « modifiée à la main » | the student's text would be replaced by the template's | unticked (« remplacer quand même ») |
| Copy a template-only section | adds content | ticked |
| Delete a profile-only section | irreversible, removes everything inside | unticked, confirmed separately with the number of items inside |
| Widget in the profile's description | only when the profile lacks it | ticked; empty description → template's description written; non-empty → template's description **appended**, existing text kept |

## Design

### Identity of a decision
A decision names its item by **section key** (title|icon|colour, as matching already does) plus,
for a tag, the tag itself; a deletion also carries the section id. Never by position. At execute the
run re-plans live and applies a decision only to an item the new plan still contains; a decision
with no matching item is ignored and reported (« décision sans objet — ignorée »). A deletion id must
still be a direct child of this profile and still profile-only (re-read before deleting).

### Plan additions
The plan marks uncertain items so the UI can render boxes:
- per section: which `addTags` are family-absent adds (uncertain) vs swaps (certain);
- `descriptionKept` sections carry the target description they could take;
- `templateOnly` and `profileOnly` carry the section key and id; for profile-only sections the plan
  carries a **descendant count** (bounded walk; « au moins N » when the walk is cut short or a read
  fails — never shown as smaller than it is);
- `widget`: whether the profile lacks the template's root description (normalised containment),
  and whether the profile's description is empty.

### Run order
1. Tag swaps and descriptions (as today, minus refused items, plus forced descriptions).
2. Copies — deep copy of each ticked template section into the profile: title, description, icon,
   colour, type, privacy, tags and the template's permission settings preserved; children
   recursively. Verified by re-listing: the section exists, and its subtree has as many items as the
   template's. A partial copy is removed again and fails the run (see the rulings below), so a
   re-run copies it afresh. Then the access check below.
3. Deletes — each ticked profile-only section, re-checked, then removed (Hazu removes its subtree).
   Verified by re-listing: gone.
4. Widget — the profile's description updated; verified by reading it back (the description
   contains `student_app.html`).
5. Colour last, only when 1–4 are all confirmed (as before).

Anything unconfirmed: `success:false`, `remaining` names it, the colour is not set. A re-run finishes
what is left (copies excepted, see 2).

### UI
In the preview, beside each uncertain item, a tick box with the default above. A separate block
« Actions supplémentaires » with the three actions. Ticking a deletion opens a confirmation naming
the section, the item count and « irréversible ». « Appliquer » sends the decisions; the Task Queue
label stays the same.

### Rulings after the builder check (my calls, 2026-11-26)
- **Copied tags and the widget are taken as they are.** A profile is itself created as a copy of
  its template, so a copied section carries what a new profile would carry. The top-level tags of
  « Boîte de guidance » and « Learning FSRS » hold no id pointer; the widget link is the
  template-wide `student_app.html` file.
- **A partial copy is removed, not left.** The section was created by this run and holds nothing of
  the student's, so on an incomplete subtree the run deletes its own fresh copy and fails, naming it.
  A re-run then copies it again. After a create that times out, the profile is re-listed and the
  section matched by key **before** any resend, never a blind resend.
- **Uncertain items with no decision are skipped and reported** (« non vu à l'aperçu — ignoré »),
  never applied at their default: nothing is written that the operator did not see.
- **A family-absent add keeps its box in a finishing run**, ticked by default. Unticking it is the
  operator's explicit choice. Tags without a trailing id that appear only on the target stay
  certain, as today.
- **The widget is detected by the widget itself**: a description containing `student_app.html`
  counts as having it (an older variant is left alone). Otherwise empty → template description
  written; non-empty → appended.
- **The three actions follow the template the operator picked**, like the rest of the plan.

### Measured: access on template-only sections (read-only, one CUI CFC student, 2026-11-26)
Compared the access list of the profile with three of its sections, roles only:
- profile: groups plus one user as reader (the student) and one owner;
- « Learning FSRS » (template tag `hz-invite-self-admin`) and « Mon bloc-notes »: a user entry as
  **admin** in addition — the invite tag became an explicit grant when the profile was created;
- « Boîte de guidance » (tag `hz-invite-self-editor`): only reader + owners — the editor grant is not
  visible there.
A plain copy creates no such grant.

### Decided (Urs, 2026-11-26): grant from the invite tag
A new node inherits the access list of its parent — groups and persons — so the student, already
reader on the profile, is on every copied node from the start (Urs, 2026-11-26). The copy keeps
**all** the template's tags as they are (incl. `hz-config-legend` on « Learning FSRS », and the
`hz-invite-self-*` / `hz-share-*` tags) and its role settings (`event.rolesSettings`, as the
Maintenance copy does with `preservePermissions`), so role-specific rights defined in the template
follow. What is left is to **check** the student's rights: for every copied node carrying
`hz-invite-self-{role}` (`reader`, `editor`, `admin`), read its ACL; if the student's role is lower
than that, raise it through `PUT /acl { userId, itemId, role }` (`sendApiRequestUpdateRole`, which
needs a checked variant). Never lowered.

**Groups follow the share tags** (Urs, 2026-11-26). On every copied node, after the copy:
- **role groups** — the distribution groups of the student's rooms, as the last sync knows them
  (`distribution_groups` with their role) — stay only where a `hz-share-{role}-{aclRole}` tag on that
  node names their role, and get exactly that `aclRole`; every other inherited role group is
  removed from the node;
- **owner / admin groups** (the 4–5 owner groups present on every section) are never touched — they
  are not role groups, and removing them could lock the administration out;
- **persons**: the only inherited ones are the student and the owners; the student gets the invite
  role above, nobody is removed.
Verified by reading the node's ACL back; any difference is named in `remaining` and withholds the
colour. Measured on an existing student: « Mon bloc-notes » already follows this rule (no share
tags → no reader groups), while « Boîte de guidance » and « Learning FSRS » kept the inherited
reader groups — sections added to profiles later. This addendum applies the rule only to sections
**this run copies**; existing sections are not corrected (out of scope). The student's account id is the
identity tag's UID, or — when the tag holds an e-mail — resolved through the profile's own ACL
(`description` → `authorId`), the same rule Missions uses. Verified by reading the node's ACL back:
an entry with that `authorId` and at least that role. Identity unresolved, or the grant not
confirmed → named in `remaining`, the colour withheld (the copy itself stays). The « Boîte de
guidance » measurement (editor tag, reader grant) is noted: the tag is taken as the source anyway,
by decision.

## Constraints
- Copies and deletes go through checked API calls that report their status (the app's current
  `sendApiRequestCreateChecked` lacks description, icon, colour and permission settings — extend or
  add one).
- Pure core with IO injected, as for the rest of the level change; the copy walk and the
  descendant count are testable without Hazu.
- No real person data in tracked files; logs carry ids only.

## Left to the builder
- Exact shape of the decisions object and the plan additions.
- Bounds of the copy recursion and of the descendant walk (the Maintenance tool uses depth 20 for
  copies, depth 6 / 500 nodes for counts).
- Layout and wording of the boxes and the confirmation.

## Testing
- Unit: refused tag add not written; forced description written; decision without object ignored and
  reported; copy order and subtree verification incl. a partial copy; delete re-check (wrong parent,
  no longer profile-only → skipped); widget empty / non-empty (appended, text kept) / already
  present; colour withheld when any step is unconfirmed.
- Acceptance (Urs), scratch userData copy, the same test profile: copy the two missing sections,
  delete « Navigation » (check the count first), add the widget; compare with the CFC v3 template.
