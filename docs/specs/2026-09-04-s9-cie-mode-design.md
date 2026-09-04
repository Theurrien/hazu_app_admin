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

## Where new CIE courses must land

Both room-creation paths resolve the destination as
`room_type === type && parent_id === rootHazuId`
([CreateRoomModal.tsx](../../src/renderer/components/CreateRoomModal.tsx),
[BulkImportPage.tsx](../../src/renderer/pages/BulkImportPage.tsx)) — that is, directly under the
top-level category folder.

That is the wrong place for CIE. Measured against the live tree on 2026-09-04, the 65 `cie`-typed
rows are: the "Cours interentreprises" category itself, 54 rooms inside two **year sub-folders**
under it (34 and 20), and 10 rooms sitting flat in the category. Seven of those ten are this
year's — the current code has already put 2026 in a different place from 2024 and 2025.

The year folders are exactly the containers S8 walks through but never persists: only categories
and rooms are written to `rooms`, so **the destination picker cannot be built from local SQLite.**
It must list the category's children live through the API.

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

**Page guard:** switching to `cie` while on a now-hidden page redirects to Matrix. `App.tsx` holds
`currentPage` in plain state with no route guard today, so this must be added explicitly.

### Header — lock and sync

Both sit beside the existing "Connected" pill in
[Header.tsx](../../src/renderer/components/layout/Header.tsx), which is visible on every page.

The lock is a subtle `faLock` / `faLockOpen`. Locked, a click prompts for the admin password.
Unlocked, a click re-locks immediately with no prompt. The mode persists across restarts.

The Sync button reuses the existing `runSync` IPC and progress polling. **It is required, not a
convenience:** Matrix and Bulk Import both render entirely from local SQLite, and the Dashboard —
the only sync trigger today — is hidden in CIE mode. Without it his data starts empty and never
refreshes as students are added centrally.

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

Room Creation locks the room type to `cie` and gains a **destination picker**. This needs a new
IPC channel modelled on `TEMPLATES_FETCH`: derive the CIE category from `root_hazu_id` exactly as
`findTargetId` does, list its children live, and return the containers — that is, the children that
are not themselves class-tagged rooms.

The picker offers those containers **and the category itself**, since ten existing rooms sit
directly in the category and that must stay expressible. It defaults to the container whose title
sorts highest, which puts the most recent year first under the observed `YYYY …` naming; if the
list is empty it defaults to the category.

Assignment restricts the role selector to student and course teacher, and restricts room matching
to CIE rooms.

Creating a new year folder is out of scope. He works in an existing one; you add 2027 yourself.

### Out of scope

Missions, Discrepancies, the Persons and Rooms browse pages, Person creation, the Verify tab, and
every delete and rename path. Settings is hidden in CIE mode — his API key is configured before
the machine is handed over.

## Testing

`app-mode.ts` is pure and unit-tested: each mode yields the expected nav items, roles, and room
types, and `complete` is a superset of `cie`.

The rest is renderer wiring, whose gate is the typecheck, the unchanged suite, and a manual
acceptance run: lock the app, confirm two nav items, create a CIE course into a chosen year folder,
assign a student through the Matrix and through a spreadsheet, then unlock with the password and
confirm the full surface returns.

## Risks

- **The lock is cosmetic against a determined user.** Accepted, per the framing above.
- **`roleOptions` and `navItems` are module-level constants with no exhaustiveness check.** A role
  or page added later will not automatically be considered for either mode. `app-mode.ts` centralises
  the decision so there is one place to look.
- **The destination picker depends on a live API call.** If it fails, room creation must block with
  a clear error rather than silently falling back to the flat category drop — that fallback is the
  bug this design exists to fix.
