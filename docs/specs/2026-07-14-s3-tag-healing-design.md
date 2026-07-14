# S3 — Add-Only Tag Healing: Design Spec

**Date:** 2026-07-14
**Status:** Approved (brainstorming) — ready for implementation plan
**Series:** Matrix group-truth rebuild — **S3 of S1→S2→S3→S4**

**Goal:** Let an operator heal the **missing-tag** discrepancies surfaced by S2 — where a person is a group member of a room but lacks the corresponding `hz-config-class-<classId>-<role>` breadcrumb tag — by **adding** the missing tag to their Hazu profile. Add-only: never remove a tag, never change a group/ACL, never change access.

**Architecture:** A pure planning core + a thin service that reuses S2's discrepancy computation, a reliability-checked add-tags API variant, two IPC channels, and a single batch button on the existing S2 Discrepancies tab that drives writes through the existing sequential Task Queue.

**Tech stack:** Electron main (Node/CommonJS) + React renderer + better-sqlite3, typed IPC, vitest.

---

## Where S3 sits in the series

- **S1 (done):** `person_room_assignments` derives from group-ACL membership (`syncGroupMemberships` + pure `group-membership.ts`), joined ACL↔persons by email. Groups are truth.
- **S2 (done):** Read-only Discrepancies tab reports where tags and group-truth disagree — 4 types: `orphan-tag`, `missing-tag`, `unresolved`, `unknown` (pure `discrepancy.ts` + `discrepancy.service.ts` + `DISCREPANCIES_GET` IPC + `DiscrepanciesPage.tsx`). Super-user group members are excluded at S1 sync time.
- **S3 (this spec):** Heal `missing-tag` add-only.
- **S4 (future):** Write reliability for the **role/ACL** writes via `/api-v2-permissions/acl` (a different endpoint; out of scope here).

Background model: `docs/hazu-access-model-findings.md`, `docs/matrix-group-truth-rebuild-spec.md`.

## Global constraints

- **Add-only.** S3 may only **add** profile tags. It must never call any tag-remove, group, or ACL write. No code path in S3 removes a tag or alters access.
- **Missing-tag only.** S3 acts exclusively on `type === 'missing-tag'` discrepancies. `orphan-tag`, `unresolved`, and `unknown` are untouched and remain reported-only.
- **No drift between report and action.** The heal set is derived by reusing S2's `computeDiscrepancies` and filtering — never by an independent re-implementation.
- **Reuse existing infrastructure.** Writes go through the existing Task Queue (`TaskQueueContext`); the tab is the existing S2 `DiscrepanciesPage`. No new sync, no new DB table.
- **Pure-core + thin-IO.** The planning logic is a pure module with no DB/HTTP imports, runnable under vitest without the better-sqlite3 native module — matching `group-membership.ts` and `discrepancy.ts`.

---

## Scope

### In scope

Heal every `missing-tag` discrepancy: person P is a member of room R's `<role>` distribution group (so a `person_room_assignments` row exists) but P's profile lacks the breadcrumb `hz-config-class-<R.class_id>-<role>`. Heal = **add** that tag to P's Hazu profile.

### Explicitly out of scope (reported-only, unchanged)

- **`orphan-tag`** (has the tag but is *not* a group member): fixing these would mean *removing* a tag — forbidden by the add-only rule. Group-truth already overrules the stale tag. Left reported.
- **`unresolved` / `unknown`**: these are group members we could not match to a local person (uid-only ACL entries, or emails absent from local `persons`). That is a **person-sync coverage gap**, not a tag problem — no tag can heal a person we do not have. Left reported for S4/coverage work.

---

## The heal mechanic

### Tag construction

For a `missing-tag` on (personId, roomId, role): the tag is

```
hz-config-class-<classId>-<role>
```

where `<classId>` is `rooms.class_id` for `roomId`, and `<role>` is the discrepancy's semantic role (one of `student`, `companymentor`, `schoolteacher`, `courseteacher`, `stateadvisor`, `guardian` — the same vocabulary stored in `person_room_assignments.role`; **not** the ACL `reader/editor`).

Every `missing-tag` room necessarily has a non-null `class_id`: S1 only produced the assignment by mapping the group's class id to a room via `rooms.class_id`, so the reverse lookup always resolves.

### Self-consistency (why the written tag always clears the discrepancy)

S2 reads a person's tag back with `parseClassTag` (split on the **last** hyphen) and maps `classId → roomId` via `rooms.class_id`. We construct the tag from that same `rooms.class_id`. So a healed tag, once present on the profile, parses back to the same `(classId, role)`, maps to the same `roomId`, and the `missing-tag` clears — by construction, within our own system.

### The class_id-with-hyphens assumption (documented, not a live risk)

S1's `extractClassId` truncates a room's class id at the first `-`/`_`; S2's `parseClassTag` splits a person tag on the last `-`. If a real class id ever contained a hyphen, `rooms.class_id` would be a truncated form and the reconstructed tag would not match the platform's canonical breadcrumb. **Today this cannot happen:** all live `class_id` values are 20-character alphanumeric (no hyphens/underscores), so construction is exact. Because S1, S2, and S3 all truncate identically, a healed tag remains internally self-consistent even in the hypothetical hyphen case (the discrepancy still clears and stays cleared). This is the standing "keep `extractClassId` and `parseClassTag` in lockstep" Minor, carried from S2 — not introduced here.

### Defensive validation

`buildClassTag(classId, role)` returns `null` (→ the item is skipped and counted, never written) when `classId` is empty, `role` is empty or not a valid role, or the constructed string fails to parse back to the same `(classId, role)` via `parseClassTag`. This guards the write path against a malformed construction; it is not expected to fire on live data.

---

## Reliability model (decided)

- **One API call per heal.** `POST /api-v2-items/{personId}/tags` with `{ tags: [tag] }`.
- **Trust the response.** The checked API variant throws on non-2xx; `healPersonTag` converts that to `{ success: false, error }`, and the Task Queue marks that item `error` — individually retryable in the panel. No per-write verify-read.
- **Local patch on success.** On 2xx, the main process appends the tag to that person's local `persons.tags` (read → append → dedup → `JSON.stringify`), so the report count drops without a full re-sync.
- **Next sync = ground truth.** The Dashboard sync does `INSERT OR REPLACE INTO persons (..., tags, ...)` by `id` from Hazu's snapshot ([sync.service.ts:338](../../src/main/services/sync.service.ts)). So a heal that returned 2xx but silently did not persist re-surfaces as a `missing-tag` on the next sync — the report self-corrects. This is why no per-write verify is needed.

The existing `sendApiRequestAddTags` swallows errors and returns `void`; it is **left untouched** for its current callers. S3 adds a checked variant that throws on non-2xx.

---

## Architecture & interfaces

### Pure core — `src/main/services/tag-healing.ts` (new)

No DB/HTTP imports. May type-import and call pure siblings from `discrepancy.ts` (`Discrepancy`, `parseClassTag`) — DRY, still native-module-free.

```ts
import { Discrepancy, parseClassTag } from './discrepancy';

export interface HealPlanItem {
  personId: string;
  roomId: string;
  roomTitle: string | null;
  role: string;
  tag: string;                 // hz-config-class-<classId>-<role>
  displayName: string | null;
  email: string | null;
}

export interface HealSkip {
  personId: string;
  roomId: string;
  role: string;
  reason: string;              // e.g. 'no class_id for room', 'tag failed round-trip'
}

export interface HealPlan {
  items: HealPlanItem[];
  skipped: HealSkip[];
}

// Returns null on invalid input or a tag that does not parse back to (classId, role).
export function buildClassTag(classId: string, role: string): string | null;

// Filters `discrepancies` to type 'missing-tag' and maps each to a HealPlanItem,
// dropping (into `skipped`) any whose room has no class_id or whose tag fails to build.
export function planTagHeals(
  discrepancies: Discrepancy[],
  roomIdToClassId: Map<string, string>,
): HealPlan;
```

### Thin service — `src/main/services/tag-healing.service.ts` (new)

```ts
// Reuses S2's loader + computeDiscrepancies, builds roomIdToClassId from `rooms`,
// filters to missing-tag via planTagHeals. Guarantees the plan matches the report.
export function getTagHealPlan(): HealPlan;

// Adds `tag` to the person's Hazu profile (checked POST). On success, appends the tag
// to local persons.tags (dedup) and returns { success: true }. On failure returns
// { success: false, error }. Never removes tags; never writes ACL/groups.
export async function healPersonTag(
  personId: string,
  tag: string,
): Promise<{ success: boolean; error?: string }>;
```

`getTagHealPlan` reuses the exact `rooms/persons/assignments/membership_issues` reads from `discrepancy.service.ts` (extract a shared loader, or call `computeDiscrepancies` on the same inputs) and builds `roomIdToClassId` from the same `rooms` rows.

### API — `src/main/services/hazu-api/api.ts` (modify)

Add a reliability-checked variant next to `sendApiRequestAddTags`:

```ts
// Same endpoint as sendApiRequestAddTags, but throws on non-2xx so callers can
// detect failure (the existing swallow-and-void version is unchanged).
export async function sendApiRequestAddTagsChecked(
  itemId: string,
  tags: string[],
): Promise<void>;   // resolves on 2xx, throws otherwise
```

### IPC — 2 new channels (the 5 standard wiring spots)

| Channel constant | Value | Handler | Preload method |
|---|---|---|---|
| `TAG_HEAL_PLAN_GET` | `tagHeal:plan` | `getTagHealPlan()` | `getTagHealPlan(): Promise<HealPlan>` |
| `TAG_HEAL` | `tagHeal:apply` | `healPersonTag(personId, tag)` | `healTag(personId, tag): Promise<{success; error?}>` |

Wire each in: `src/shared/ipc-channels.ts`, `src/main/ipc/index.ts`, `src/main/preload.ts` (**both** the inline `IPC_CHANNELS` copy **and** the runtime method **and** the `Window` interface type).

### Renderer

- **`TaskQueueContext.tsx` (modify):** add task type `'healTag'`.

  ```ts
  type HealTagTask = {
    type: 'healTag';
    id: string;
    status: TaskStatus;
    personId: string;
    tag: string;
    displayName: string | null;   // for the panel label
    onError?: () => void;
  };
  ```

  The processor calls `window.electronAPI.healTag(personId, tag)`; a thrown/`{success:false}` result marks the task `error` (retryable, like `roleUpdate`). Add an `enqueueHealTag(...)` method mirroring the existing `enqueue*` methods.

- **`DiscrepanciesPage.tsx` (modify):** add a **"Heal all missing-tags (N)"** button (N = count of missing-tag rows; disabled when N = 0). Click flow:
  1. `getTagHealPlan()` → `{ items, skipped }`.
  2. Open a **confirm modal**: "Add `items.length` breadcrumb tags (add-only — access is unchanged)." If `skipped.length > 0`, note "(`skipped.length` skipped — missing class id)". A person with multiple missing tags yields multiple items, so the count is tags, not persons.
  3. On confirm, `enqueueHealTag` one task per `items[]`.
  4. Track the enqueued heal task ids; once all have settled (`success`/`error`), `refetch()` the discrepancies so the count drops. If `TaskQueueContext` does not already expose queue state the page can observe, the plan adds a minimal settled/idle signal.

- **Confirm modal:** a small presentational modal (follow the `DeleteConfirmationModal` pattern) or a reused confirm component. No new heavy UI.

---

## Data flow (one click)

```
"Heal all missing-tags (N)"
  → getTagHealPlan()                       (main: reuse computeDiscrepancies, filter missing-tag, build tags)
  → confirm modal (count + add-only notice)
  → enqueueHealTag × items                 (renderer: one task per plan item)
  → Task Queue runs sequentially:
       healTag(personId, tag)
         → sendApiRequestAddTagsChecked     (POST /api-v2-items/{id}/tags)
         → 2xx: append tag to local persons.tags (dedup)      → task success
         → non-2xx: throw                                     → task error (retry in panel)
  → queue idle → DiscrepanciesPage.refetch() → count drops
  → (later) Dashboard sync re-reads real tags = ground truth
```

## Error handling & edge cases

- **Per-item failure:** one heal failing does not stop the batch; the queue processes items sequentially and marks only the failed one `error` (retryable). Already-healed items keep their local patch.
- **Room without class_id:** cannot build a tag → dropped into `skipped` with a reason, surfaced in the confirm modal count, never written. (Not expected for missing-tag rooms; defensive.)
- **Tag fails round-trip:** `buildClassTag` returns `null` → `skipped`. Defensive; not expected on live data.
- **Person already has the tag (local patch dedup):** appending is idempotent — `persons.tags` is deduped before write, so re-running heal or a race cannot create duplicates locally. Hazu's tag endpoint is additive; a redundant add is harmless.
- **Person flagged missing but has a malformed variant tag on Hazu:** add-only + platform-side handling; we add the canonical form. Harmless (no removal).

## Testing

**`src/main/services/tag-healing.test.ts` (new, vitest — pure core only, matching S2):**

- `buildClassTag`: happy path (`'abc123', 'student'` → `'hz-config-class-abc123-student'`); returns `null` for empty classId, empty role, and a non-valid role; round-trips (parses back to the same inputs).
- `planTagHeals`:
  - filters to `missing-tag` only (ignores `orphan-tag` / `unresolved` / `unknown` in the same input);
  - builds the correct tag string per item and carries `personId/roomId/roomTitle/role/displayName/email`;
  - a missing-tag whose `roomId` is absent from `roomIdToClassId` → goes to `skipped`, not `items`;
  - dedup/ordering as needed for a deterministic assertion.

Service (`getTagHealPlan`, `healPersonTag`) and IPC/renderer are thin transcription and DB/HTTP-bound — untested at unit level, per the S2 precedent. Manual acceptance verifies the end-to-end path.

## File-by-file change list

**Create**
- `src/main/services/tag-healing.ts` — pure core (`buildClassTag`, `planTagHeals`, types).
- `src/main/services/tag-healing.test.ts` — vitest for the pure core.
- `src/main/services/tag-healing.service.ts` — `getTagHealPlan`, `healPersonTag`.
- Confirm modal component (or reuse an existing confirm pattern) if none is reusable.

**Modify**
- `src/main/services/hazu-api/api.ts` — add `sendApiRequestAddTagsChecked`.
- `src/shared/ipc-channels.ts` — add `TAG_HEAL_PLAN_GET`, `TAG_HEAL`.
- `src/main/ipc/index.ts` — add both handlers.
- `src/main/preload.ts` — inline `IPC_CHANNELS` copy + `getTagHealPlan`/`healTag` methods + `Window` types.
- `src/renderer/contexts/TaskQueueContext.tsx` — `'healTag'` task type + processor branch + `enqueueHealTag`.
- `src/renderer/pages/DiscrepanciesPage.tsx` — "Heal all missing-tags (N)" button, confirm modal, refetch-on-idle.

## Manual acceptance

1. `npm run build` clean.
2. Discrepancies tab shows a "Heal all missing-tags (N)" button with the correct N.
3. Click → confirm modal shows the count → confirm → Task Queue panel fills with `healTag` tasks running sequentially to success.
4. Missing-tag count drops to (near) 0; any failures are individually retryable.
5. Run Dashboard sync → reopen Discrepancies → healed missing-tags stay gone (ground-truth confirmation).
6. Verify no `orphan-tag` / `unknown` / `unresolved` counts changed (add-only, missing-tag-only).

## Out of scope / future

- **Orphan-tag pruning** (removing stale breadcrumbs) — would violate add-only; a separate, remove-capable feature with its own per-item confirmation if ever wanted.
- **Person-sync coverage** for `unknown`/`unresolved` — the real fix for those counts; separate work.
- **S4 role/ACL write reliability** via `/api-v2-permissions/acl` — a different endpoint and concern.
