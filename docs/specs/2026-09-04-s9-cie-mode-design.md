# S9 — CIE Mode (light version for a course teacher)

**Status:** design
**Date:** 2026-09-04

## Problem

A course teacher needs to create his own CIE courses and assign students to them. He is not
technically advanced and should not be handed the full eight-tab admin surface, where a
mis-click can rename a canton, delete a class, or revoke somebody's access.

He runs the app on his own machine with the admin API key and `admin_id` already configured.

## What this is, and what it is not

**This is a simplification for a trusted colleague. It is not an access-control boundary.**

The app has no per-user authorization. One API key from Settings authenticates every call
([config.ts](../../src/main/services/hazu-api/config.ts), [api.ts](../../src/main/services/hazu-api/api.ts)),
and that key carries full platform rights. It lives in local SQLite on his machine, reachable
through the DB file or DevTools. Hiding tabs changes what he can do *by accident*, not what he
can do *at all*.

This was raised and accepted deliberately. Nothing in this design should be described to anyone
as restricting his rights.

Two consequences worth writing down:

- Narrowing his `root_hazu_id` to the CIE subtree would **not** contain him and would break the
  app: rooms and persons are walked from different branches of the same root
  (`syncRooms` vs. `syncPersonsFromContainers` in
  [sync.service.ts](../../src/main/services/sync.service.ts)). Point him at the CIE folder and he
  gets courses with no students.
- His install mirrors the whole platform locally, every canton included. That is what sync does.

## Where new CIE courses land — and why flat is correct

Both room-creation paths resolve the destination as
`room_type === type && parent_id === rootHazuId`
([CreateRoomModal.tsx](../../src/renderer/components/CreateRoomModal.tsx),
[BulkImportPage.tsx](../../src/renderer/pages/BulkImportPage.tsx)) — that is, directly under the
top-level category folder, the "Cours interentreprises" Hazu.

**That is the right place, and CIE mode keeps it.** New courses always land flat in the CIE
category. Filing them into a year folder is deliberate housekeeping done at the end of the school
year, not something the creation path should anticipate.

So this design adds **no destination picker**. Room Creation in CIE mode locks the room type to
`cie` and otherwise uses the existing `findTargetId` unchanged.

### Do not "fix" the flat drop

The live tree invites a wrong conclusion, so it is worth recording what it means. Measured on
2026-09-04, the 65 `cie`-typed rows are: the category itself, 54 rooms inside two **year
sub-folders** under it (34 and 20), and 10 rooms sitting flat in the category. A reader who finds
this year's courses flat while 2024's and 2025's sit tidily in folders will read it as a bug in
`findTargetId` and be tempted to route creation into a year folder.

It is not a bug. It is the year in progress. The year folders are filled at the end of the year,
by hand, and a creation path that wrote into them would be writing into the archive.

(For anyone who does later build tooling for that housekeeping: the year folders are the containers
S8 walks through but never persists — only categories and rooms are written to `rooms` — so they
cannot be enumerated from local SQLite and must be listed live through the API.)

## Design

### Mode flag

A new `app_mode` setting, `'cie' | 'complete'`, defaulting to `'cie'`. `settings` is a key/value
table, so there is no schema change.

The derivation — which nav items, roles, and room types a mode allows — goes in a pure
`src/shared/app-mode.ts` with unit tests, following the pure-core convention the write paths use.
It imports nothing but types:

```ts
visibleNavItems(mode): NavId[]
allowedRoles(mode): PersonType[]
allowedRoomTypes(mode): RoomType[]
```

A thin `AppModeContext` in the renderer holds `mode`, `unlock(password)`, `lock()`, mirroring the
existing `TaskQueueContext`.

**Lockout guard:** if `admin_password` is unset in settings, the lock toggles freely. Without this,
a fresh install defaults to `cie` with no way out.

**Page guard:** switching to `cie` while on a now-hidden page redirects to the Dashboard, which is
visible in both modes. `App.tsx` holds `currentPage` in plain state with no route guard today, so
this must be added explicitly.

### Header — the lock

The lock sits beside the existing "Connected" pill in
[Header.tsx](../../src/renderer/components/layout/Header.tsx), which is visible on every page. It
is a subtle `faLock` / `faLockOpen`. Locked, a click prompts for the admin password. Unlocked, a
click re-locks immediately with no prompt. The mode persists across restarts.

Nothing else is added to the header.

### The Dashboard stays visible

CIE mode shows three nav items: Dashboard, Matrix, Bulk Import.

Keeping the Dashboard is a deliberate choice against a smaller nav. Matrix and Bulk Import render
entirely from local SQLite, and the Dashboard's Sync button is the only trigger in the app — hide
it and his data starts empty and never picks up centrally-added students. The alternative was a
Sync button in the header, but that means **adding** a control to compensate for a restriction,
which is the wrong shape for this work: every other change here is subtraction.

The page is safe to expose. It reads the API config, reads sync status, and runs sync
([Dashboard.tsx](../../src/renderer/pages/Dashboard.tsx)) — one button, nothing destructive.

### Matrix in CIE mode

Columns locked to CIE rooms, rows to students and course teachers. `useMatrixData` already treats
an empty filter set as "show all", so CIE mode seeds and freezes the sets rather than adding a new
filtering path.

`roleOptions` in [MatrixGrid.tsx](../../src/renderer/components/MatrixGrid.tsx) is a module-level
constant listing all seven roles; in CIE mode it must be narrowed to `-`, Student, Course Teacher,
so a dropdown cannot mint a state advisor.

The type chips in `MatrixFilters` are hidden; both search boxes stay. The hover affordances for
room rename, room delete, and person delete are hidden — assignments stay writable, structure does
not.

Writes are unchanged: the same Task Queue and the same S4 verify-against-truth path.

### Bulk Import in CIE mode

Two of the four workflow tabs: **Room Creation** and **Assignment**.

Room Creation locks the room type to `cie`. Nothing else about it changes — no destination picker,
no new IPC channel; `findTargetId` already resolves the CIE category, which is where courses belong.

Assignment restricts the role selector to student and course teacher, and restricts room matching
to CIE rooms.

### Out of scope

Missions, Discrepancies, the Persons and Rooms browse pages, Person creation, the Verify tab, and
every delete and rename path. Settings is hidden — his API key is configured before the machine is
handed over.

**No workflow gains a capability.** Every change to Matrix and Bulk Import is subtraction: fewer
tabs, frozen filters, shorter dropdowns, hidden hover actions. The write paths, the Task Queue, the
IPC layer, and the main process are untouched. The only genuinely new code is the mode mechanism
itself — the setting, the context, the lock, and the page guard.

## Testing

`app-mode.ts` is pure and unit-tested: each mode yields the expected nav items, roles, and room
types, and `complete` is a superset of `cie`.

The rest is renderer wiring, whose gate is the typecheck, the unchanged suite, and a manual
acceptance run: lock the app, confirm three nav items, sync from the Dashboard, create a CIE course
and confirm it lands in the CIE category, assign a student through the Matrix and through a
spreadsheet, then unlock with the password and confirm the full surface returns.

## Risks

- **The lock is cosmetic against a determined user.** Accepted, per the framing above.
- **`roleOptions` and `navItems` are module-level constants with no exhaustiveness check.** A role
  or page added later will not automatically be considered for either mode. `app-mode.ts` centralises
  the decision so there is one place to look.
- **A future maintainer may mistake the flat drop for a bug** and route creation into a year
  folder, writing new courses into the archive. The section above exists to prevent that.
