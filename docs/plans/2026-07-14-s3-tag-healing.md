# S3 Add-Only Tag Healing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Heal all missing-tags" batch action to the Discrepancies tab that adds the missing `hz-config-class-<classId>-<role>` breadcrumb tag to each group member who lacks it — add-only, through the existing Task Queue.

**Architecture:** A pure planning core (`tag-healing.ts`) that reuses S2's `computeDiscrepancies` and reconstructs the tag from `rooms.class_id`; a thin service (`tag-healing.service.ts`) that loads the same DB inputs, POSTs the tag via a reliability-checked API variant, and patches local `persons.tags` on success; two IPC channels; a new `healTag` Task Queue type; and one batch button + confirm modal on the existing Discrepancies page.

**Tech Stack:** Electron main (Node/CommonJS, `tsconfig.main.json`) + React renderer (Vite) + better-sqlite3, typed IPC, vitest.

**Spec:** `docs/specs/2026-07-14-s3-tag-healing-design.md`

## Global Constraints

Every task's requirements implicitly include these:

- **Add-only.** S3 may only **add** profile tags. No S3 code path calls any tag-remove, group, or ACL write, or alters access.
- **Missing-tag only.** S3 acts exclusively on `type === 'missing-tag'` discrepancies. `orphan-tag`, `unresolved`, `unknown` stay reported-only and untouched.
- **No drift between report and action.** The heal set is derived by reusing S2's `computeDiscrepancies` on the same DB inputs — never re-implemented.
- **Reuse existing infrastructure.** Writes go through the existing `TaskQueueContext`; the surface is the existing `DiscrepanciesPage`. No new sync, no new DB table, no schema change.
- **Pure-core + thin-IO.** `tag-healing.ts` has no DB/HTTP imports and runs under vitest without the better-sqlite3 native module (it may import the pure sibling `discrepancy.ts`).
- **Tag format (verbatim):** `hz-config-class-<classId>-<role>`, where `<classId>` is `rooms.class_id` and `<role>` ∈ `student`, `companymentor`, `schoolteacher`, `courseteacher`, `stateadvisor`, `guardian` (the same vocabulary stored in `person_room_assignments.role` — **not** the ACL `reader/editor`).
- **Reliability model:** one `POST /api-v2-items/{personId}/tags` per heal; non-2xx throws → task `error` (retryable); on 2xx, patch local `persons.tags` (dedup); the next Dashboard sync is ground truth. No per-write verify-read.
- **Do not modify** the existing `sendApiRequestAddTags` (its callers rely on its swallow-and-void behavior). Add a new checked variant.

**Commands:**
- Focused test: `npx vitest run src/main/services/tag-healing.test.ts`
- All tests: `npm test`
- Main typecheck: `npm run build:electron`
- Full build (renderer + main): `npm run build`

---

## File Structure

**Create**
- `src/main/services/tag-healing.ts` — pure core: `buildClassTag`, `planTagHeals`, and the `HealPlan`/`HealPlanItem`/`HealSkip` types. Zero DB/HTTP imports.
- `src/main/services/tag-healing.test.ts` — vitest for the pure core.
- `src/main/services/tag-healing.service.ts` — `getTagHealPlan()` (reuses the S2 loader + `computeDiscrepancies`) and `healPersonTag(personId, tag)` (checked POST + local tags patch).
- `src/renderer/components/HealConfirmationModal.tsx` — small presentational confirm modal.

**Modify**
- `src/main/services/hazu-api/api.ts` — add `sendApiRequestAddTagsChecked` (throws on non-2xx).
- `src/main/services/discrepancy.service.ts` — extract `loadDiscrepancyInput()` and export `safeParseTags` (behavior-preserving refactor so `getTagHealPlan` can reuse them).
- `src/shared/ipc-channels.ts` — add `TAG_HEAL_PLAN_GET`, `TAG_HEAL`.
- `src/main/ipc/index.ts` — import the service + register the two handlers.
- `src/main/preload.ts` — inline `IPC_CHANNELS` copy + `getTagHealPlan`/`healTag` methods + `Window` interface types.
- `src/renderer/contexts/TaskQueueContext.tsx` — `'healTag'` task type, processor branch, `addHealTagTask`.
- `src/renderer/components/TaskQueuePanel.tsx` — `getLabel` case for `healTag`.
- `src/renderer/pages/DiscrepanciesPage.tsx` — "Heal all missing-tags (N)" button, confirm modal, refetch-when-queue-settles.

---

### Task 1: Pure planning core (`tag-healing.ts` + tests)

**Files:**
- Create: `src/main/services/tag-healing.ts`
- Test: `src/main/services/tag-healing.test.ts`

**Interfaces:**
- Consumes (from existing `src/main/services/discrepancy.ts`, unchanged): `parseClassTag(tag: string): { classId: string; role: string } | null` and the type `Discrepancy` (fields used: `type`, `roomId`, `roomTitle`, `role`, `personId?`, `email?`, `displayName?`).
- Produces (used by Task 2):
  ```ts
  export interface HealPlanItem {
    personId: string; roomId: string; roomTitle: string | null; role: string;
    tag: string; displayName: string | null; email: string | null;
  }
  export interface HealSkip { personId: string; roomId: string; role: string; reason: string; }
  export interface HealPlan { items: HealPlanItem[]; skipped: HealSkip[]; }
  export function buildClassTag(classId: string, role: string): string | null;
  export function planTagHeals(discrepancies: Discrepancy[], roomIdToClassId: Map<string, string>): HealPlan;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/main/services/tag-healing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildClassTag, planTagHeals } from './tag-healing';
import { Discrepancy } from './discrepancy';

describe('buildClassTag', () => {
  it('builds the breadcrumb for a valid classId + role', () => {
    expect(buildClassTag('abc123', 'student')).toBe('hz-config-class-abc123-student');
    expect(buildClassTag('XY9', 'schoolteacher')).toBe('hz-config-class-XY9-schoolteacher');
  });

  it('accepts a hyphenated classId that still round-trips (last-hyphen parse)', () => {
    // parseClassTag splits on the LAST hyphen, so the role (which has no hyphen)
    // is always recovered and the full classId round-trips.
    expect(buildClassTag('ab-cd', 'student')).toBe('hz-config-class-ab-cd-student');
  });

  it('returns null for empty classId or role', () => {
    expect(buildClassTag('', 'student')).toBeNull();
    expect(buildClassTag('abc123', '')).toBeNull();
  });

  it('returns null for a role outside the valid set', () => {
    expect(buildClassTag('abc123', 'bogus')).toBeNull();
    expect(buildClassTag('abc123', 'reader')).toBeNull(); // ACL role, not a breadcrumb role
  });
});

describe('planTagHeals', () => {
  const roomIdToClassId = new Map<string, string>([
    ['room1', 'CLS1'],
    ['room2', 'CLS2'],
  ]);

  const discrepancies: Discrepancy[] = [
    { type: 'missing-tag', roomId: 'room1', roomTitle: 'Room One', role: 'student', personId: 'p1', email: 'a@example.invalid', displayName: 'Alice' },
    { type: 'orphan-tag', roomId: 'room1', roomTitle: 'Room One', role: 'student', personId: 'p2', email: 'b@example.invalid', displayName: 'Bob' },
    { type: 'missing-tag', roomId: 'roomX', roomTitle: null, role: 'schoolteacher', personId: 'p3', email: null, displayName: 'Carol' },
    { type: 'unknown', roomId: 'room2', roomTitle: 'Room Two', role: 'student', uid: 'u1', email: 'c@example.invalid', displayName: 'Dan' },
    { type: 'unresolved', roomId: 'room2', roomTitle: 'Room Two', role: 'student', uid: 'u2', email: null, displayName: 'uid-only' },
  ];

  it('plans only missing-tag rows, with correct tags and carried fields', () => {
    const plan = planTagHeals(discrepancies, roomIdToClassId);
    expect(plan.items).toEqual([
      { personId: 'p1', roomId: 'room1', roomTitle: 'Room One', role: 'student', tag: 'hz-config-class-CLS1-student', displayName: 'Alice', email: 'a@example.invalid' },
    ]);
  });

  it('skips a missing-tag whose room has no class_id', () => {
    const plan = planTagHeals(discrepancies, roomIdToClassId);
    expect(plan.skipped).toEqual([
      { personId: 'p3', roomId: 'roomX', role: 'schoolteacher', reason: 'no class_id for room' },
    ]);
  });

  it('ignores orphan-tag / unknown / unresolved entirely', () => {
    const plan = planTagHeals(discrepancies, roomIdToClassId);
    const touchedPersons = [...plan.items, ...plan.skipped].map((x) => x.personId).sort();
    expect(touchedPersons).toEqual(['p1', 'p3']); // p2 (orphan) never considered
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/services/tag-healing.test.ts`
Expected: FAIL — `Cannot find module './tag-healing'` (or `buildClassTag is not a function`).

- [ ] **Step 3: Write the implementation**

Create `src/main/services/tag-healing.ts`:

```ts
import { Discrepancy, parseClassTag } from './discrepancy';

export interface HealPlanItem {
  personId: string;
  roomId: string;
  roomTitle: string | null;
  role: string;
  tag: string; // hz-config-class-<classId>-<role>
  displayName: string | null;
  email: string | null;
}

export interface HealSkip {
  personId: string;
  roomId: string;
  role: string;
  reason: string;
}

export interface HealPlan {
  items: HealPlanItem[];
  skipped: HealSkip[];
}

// Build hz-config-class-<classId>-<role>. Returns null when classId/role are empty
// or when the result does not parse back to the same (classId, role) via parseClassTag
// — which also rejects any role outside the valid breadcrumb set (parseClassTag validates it).
export function buildClassTag(classId: string, role: string): string | null {
  if (!classId || !role) return null;
  const tag = `hz-config-class-${classId}-${role}`;
  const parsed = parseClassTag(tag);
  if (!parsed || parsed.classId !== classId || parsed.role !== role) return null;
  return tag;
}

// Filter `discrepancies` to type 'missing-tag' and map each to a HealPlanItem.
// A missing-tag whose room is absent from `roomIdToClassId`, or whose tag fails to
// build, is dropped into `skipped` (never written). The 'missing-tag' filter guarantees
// the plan matches exactly what the S2 report shows as healable.
export function planTagHeals(
  discrepancies: Discrepancy[],
  roomIdToClassId: Map<string, string>,
): HealPlan {
  const items: HealPlanItem[] = [];
  const skipped: HealSkip[] = [];

  for (const d of discrepancies) {
    if (d.type !== 'missing-tag') continue;
    const personId = d.personId ?? '';
    const classId = roomIdToClassId.get(d.roomId);
    if (!classId) {
      skipped.push({ personId, roomId: d.roomId, role: d.role, reason: 'no class_id for room' });
      continue;
    }
    const tag = buildClassTag(classId, d.role);
    if (!tag) {
      skipped.push({ personId, roomId: d.roomId, role: d.role, reason: 'tag failed to build/round-trip' });
      continue;
    }
    items.push({
      personId,
      roomId: d.roomId,
      roomTitle: d.roomTitle,
      role: d.role,
      tag,
      displayName: d.displayName ?? null,
      email: d.email ?? null,
    });
  }

  return { items, skipped };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/services/tag-healing.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS. Existing `discrepancy.test.ts` and `group-membership.test.ts` still green. (A pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning about `postcss.config.js` may print — it is not a failure and is out of scope.)

- [ ] **Step 6: Commit**

```bash
git add src/main/services/tag-healing.ts src/main/services/tag-healing.test.ts
git commit -m "feat(s3): pure tag-healing core (buildClassTag, planTagHeals)"
```

---

### Task 2: Main-process integration (checked API variant + service + IPC)

**Files:**
- Modify: `src/main/services/hazu-api/api.ts`
- Modify: `src/main/services/discrepancy.service.ts`
- Create: `src/main/services/tag-healing.service.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/preload.ts`

**Interfaces:**
- Consumes (from Task 1): `planTagHeals`, `HealPlan` from `./tag-healing`.
- Produces (used by Task 3, on `window.electronAPI`):
  ```ts
  getTagHealPlan: () => Promise<HealPlan>; // { items: HealPlanItem[]; skipped: HealSkip[] }
  healTag: (personId: string, tag: string) => Promise<{ success: boolean; error?: string }>;
  ```
- No unit tests: these are DB/HTTP-bound glue, verified by the main typecheck (`npm run build:electron`), per the S2 precedent (S2 Task 2 was integration-only). The end-to-end path is exercised in Task 4 manual acceptance.

- [ ] **Step 1: Add the checked add-tags API variant**

In `src/main/services/hazu-api/api.ts`, immediately after `sendApiRequestAddTags` (it ends around line 204, before `sendApiRequestRemoveTags`), add:

```ts
// Checked variant of sendApiRequestAddTags: same POST, but it does NOT swallow errors —
// a non-2xx rejects so callers (tag healing) can detect failure. The original
// swallow-and-void sendApiRequestAddTags is left unchanged for its existing callers.
export const sendApiRequestAddTagsChecked = async (itemId: string, tags: string[]): Promise<void> => {
  await axios.post(
    `https://${getApiEndpoint()}/api-v2-items/${itemId}/tags`,
    { tags },
    {
      headers: {
        "x-api-key": getApiKey(),
        "Content-Type": "application/json",
      },
    }
  );
};
```

(`axios` rejects on non-2xx by default, so no explicit status check is needed. `getApiEndpoint` and `getApiKey` are already imported at the top of this file.)

- [ ] **Step 2: Refactor `discrepancy.service.ts` to expose a reusable loader**

Replace the entire contents of `src/main/services/discrepancy.service.ts` with (behavior-preserving — `getDiscrepancies` returns exactly what it did; we only extract the DB reads into `loadDiscrepancyInput` and export `safeParseTags`):

```ts
import { getDb } from '../database';
import { computeDiscrepancies, Discrepancy, DiscrepancyInput } from './discrepancy';

export function safeParseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

// Loads the four tables the discrepancy computation needs. Shared by getDiscrepancies
// (the S2 report) and getTagHealPlan (S3) so the two can never diverge.
export function loadDiscrepancyInput(): DiscrepancyInput {
  const db = getDb();

  const rooms = db
    .prepare('SELECT id, title, class_id AS classId FROM rooms')
    .all() as Array<{ id: string; title: string; classId: string | null }>;

  const personRows = db
    .prepare('SELECT id, display_name AS displayName, email, tags FROM persons')
    .all() as Array<{ id: string; displayName: string; email: string | null; tags: string | null }>;
  const persons = personRows.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    email: p.email,
    tags: safeParseTags(p.tags),
  }));

  const assignments = db
    .prepare('SELECT person_id AS personId, room_id AS roomId, role FROM person_room_assignments')
    .all() as Array<{ personId: string; roomId: string; role: string }>;

  const issues = db
    .prepare('SELECT type, room_id AS roomId, role, uid, email, display_name AS displayName FROM membership_issues')
    .all() as Array<{
      type: 'unresolved' | 'unknown';
      roomId: string;
      role: string;
      uid: string;
      email: string | null;
      displayName: string | null;
    }>;

  return { rooms, persons, assignments, issues };
}

export function getDiscrepancies(): Discrepancy[] {
  return computeDiscrepancies(loadDiscrepancyInput());
}
```

- [ ] **Step 3: Create the tag-healing service**

Create `src/main/services/tag-healing.service.ts`:

```ts
import { getDb } from '../database';
import { computeDiscrepancies } from './discrepancy';
import { loadDiscrepancyInput, safeParseTags } from './discrepancy.service';
import { planTagHeals, HealPlan } from './tag-healing';
import { sendApiRequestAddTagsChecked } from './hazu-api/api';

// Reuses the S2 loader + computeDiscrepancies, then filters/maps to a heal plan.
// Because it consumes the exact same inputs as getDiscrepancies, the plan can never
// drift from what the Discrepancies report displays.
export function getTagHealPlan(): HealPlan {
  const input = loadDiscrepancyInput();
  const discrepancies = computeDiscrepancies(input);
  const roomIdToClassId = new Map<string, string>();
  for (const r of input.rooms) {
    if (r.classId) roomIdToClassId.set(r.id, r.classId);
  }
  return planTagHeals(discrepancies, roomIdToClassId);
}

// Adds `tag` to the person's Hazu profile (add-only). On a successful POST, patches
// local persons.tags (dedup) so the report clears before the next sync. A local-patch
// failure is non-fatal — the next Dashboard sync reconciles from Hazu (ground truth).
export async function healPersonTag(
  personId: string,
  tag: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await sendApiRequestAddTagsChecked(personId, [tag]);
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  try {
    const db = getDb();
    const row = db.prepare('SELECT tags FROM persons WHERE id = ?').get(personId) as
      | { tags: string | null }
      | undefined;
    const current = safeParseTags(row?.tags ?? null);
    if (!current.includes(tag)) {
      current.push(tag);
      db.prepare('UPDATE persons SET tags = ? WHERE id = ?').run(JSON.stringify(current), personId);
    }
  } catch (error) {
    console.error('[tag-healing] local tags patch failed for', personId, error);
  }

  return { success: true };
}
```

- [ ] **Step 4: Add the IPC channel constants**

In `src/shared/ipc-channels.ts`, after the `DISCREPANCIES_GET: 'discrepancies:get',` line (line 58), add:

```ts
  // Tag healing (S3)
  TAG_HEAL_PLAN_GET: 'tagHeal:plan',
  TAG_HEAL: 'tagHeal:apply',
```

- [ ] **Step 5: Register the IPC handlers**

In `src/main/ipc/index.ts`, add to the imports (after line 9, `import { getDiscrepancies } from '../services/discrepancy.service';`):

```ts
import { getTagHealPlan, healPersonTag } from '../services/tag-healing.service';
```

Then, immediately after the `DISCREPANCIES_GET` handler block (it closes at line 136 with `});`), add:

```ts
  ipcMain.handle(IPC_CHANNELS.TAG_HEAL_PLAN_GET, async () => {
    try {
      return getTagHealPlan();
    } catch (error) {
      console.error('Get tag heal plan error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.TAG_HEAL, async (_event, personId: string, tag: string) => {
    try {
      return await healPersonTag(personId, tag);
    } catch (error) {
      console.error('Tag heal error:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
```

- [ ] **Step 6: Expose the channels + methods + types in preload**

In `src/main/preload.ts`:

(a) In the inline `IPC_CHANNELS` object, after `DISCREPANCIES_GET: 'discrepancies:get',` (line 48), add:

```ts
  TAG_HEAL_PLAN_GET: 'tagHeal:plan',
  TAG_HEAL: 'tagHeal:apply',
```

(b) In the `exposeInMainWorld('electronAPI', { ... })` object, after the `getDiscrepancies` method (lines 142-144), add:

```ts
  // Tag healing (S3)
  getTagHealPlan: () =>
    ipcRenderer.invoke(IPC_CHANNELS.TAG_HEAL_PLAN_GET),
  healTag: (personId: string, tag: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAG_HEAL, personId, tag),
```

(c) In the `Window['electronAPI']` interface, after the `getDiscrepancies` type (it ends at line 286 with `}>>;`), add:

```ts
      getTagHealPlan: () => Promise<{
        items: Array<{
          personId: string; roomId: string; roomTitle: string | null; role: string;
          tag: string; displayName: string | null; email: string | null;
        }>;
        skipped: Array<{ personId: string; roomId: string; role: string; reason: string }>;
      }>;
      healTag: (personId: string, tag: string) => Promise<{ success: boolean; error?: string }>;
```

- [ ] **Step 7: Typecheck the main process**

Run: `npm run build:electron`
Expected: exits 0, no TypeScript errors. (Verifies `tag-healing.ts`, `tag-healing.service.ts`, the `api.ts` variant, `discrepancy.service.ts` refactor, the IPC handlers, and the preload types all compile together.)

- [ ] **Step 8: Commit**

```bash
git add src/main/services/hazu-api/api.ts src/main/services/discrepancy.service.ts src/main/services/tag-healing.service.ts src/shared/ipc-channels.ts src/main/ipc/index.ts src/main/preload.ts
git commit -m "feat(s3): tag-healing service + checked add-tags API + IPC"
```

---

### Task 3: Renderer — heal task type + button + confirm modal

**Files:**
- Modify: `src/renderer/contexts/TaskQueueContext.tsx`
- Modify: `src/renderer/components/TaskQueuePanel.tsx`
- Create: `src/renderer/components/HealConfirmationModal.tsx`
- Modify: `src/renderer/pages/DiscrepanciesPage.tsx`

**Interfaces:**
- Consumes (from Task 2): `window.electronAPI.getTagHealPlan()` and `window.electronAPI.healTag(personId, tag)`.
- Produces: the user-visible batch heal flow. `DiscrepanciesPage` is already routed inside `<TaskQueueProvider>` in `App.tsx` (line 44), so `useTaskQueue()` is available to it.
- No unit tests: renderer UI wiring, verified by the full build (`npm run build`), per the S2 precedent (S2 Task 3 was build-verified — this is what surfaced the stale `Page` union type error).

- [ ] **Step 1: Add the `healTag` task type + processor + enqueue method**

In `src/renderer/contexts/TaskQueueContext.tsx`:

(a) Extend the union (line 4):

```ts
export type TaskType = 'roleUpdate' | 'createRoom' | 'createPerson' | 'healTag';
```

(b) After the `CreatePersonTask` interface (ends line 50), add:

```ts
export interface HealTagTask extends BaseTask {
  type: 'healTag';
  personId: string;
  tag: string;
  displayName: string | null;
}
```

(c) Extend the `Task` union (line 52):

```ts
export type Task = RoleUpdateTask | CreateRoomTask | CreatePersonTask | HealTagTask;
```

(d) After the `AddCreatePersonInput` type (line 57), add:

```ts
type AddHealTagInput = Omit<HealTagTask, 'id' | 'status' | 'type'>;
```

(e) In the `TaskQueueContextType` interface, after `addCreatePersonTask` (line 69), add:

```ts
  addHealTagTask: (task: AddHealTagInput) => string;
```

(f) In `processQueue`, after the `createPerson` branch closes (the `}` at line 166, before the `catch`), add a new branch:

```ts
      } else if (nextTask.type === 'healTag') {
        const task = nextTask as HealTagTask;
        const result = await window.electronAPI.healTag(task.personId, task.tag);

        if (result.success) {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'success' as const } : t))
          );
        } else {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'error' as const, error: result.error } : t))
          );
        }
      }
```

(g) After `addCreatePersonTask` (ends line 207), add the enqueue method:

```ts
  // Add heal-tag task (S3)
  const addHealTagTask = useCallback((taskData: AddHealTagInput) => {
    const id = `heal-${Date.now()}-${++taskIdCounter.current}`;
    const task: HealTagTask = { ...taskData, id, type: 'healTag', status: 'queued' };
    setTasks((prev) => [...prev, task]);
    return id;
  }, []);
```

(h) In the provider `value` object, after `addCreatePersonTask,` (line 264), add:

```ts
        addHealTagTask,
```

- [ ] **Step 2: Add the panel label case**

In `src/renderer/components/TaskQueuePanel.tsx`, the `getLabel` switch (lines 25-34) covers every `task.type` and has no `default`. Add a `case` for the new type (after the `createPerson` case, line 33):

```ts
      case 'healTag':
        return `Tag: ${task.displayName || task.personId}`;
```

- [ ] **Step 3: Create the confirm modal**

Create `src/renderer/components/HealConfirmationModal.tsx`:

```tsx
import React from 'react';

interface HealConfirmationModalProps {
  isOpen: boolean;
  tagCount: number;
  skippedCount: number;
  onConfirm: () => void;
  onClose: () => void;
}

export function HealConfirmationModal({
  isOpen,
  tagCount,
  skippedCount,
  onConfirm,
  onClose,
}: HealConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Heal missing tags?</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            Add <strong>{tagCount}</strong> breadcrumb tag{tagCount === 1 ? '' : 's'} to matching profiles.
            This is <strong>add-only</strong> — no tags are removed and access is unchanged.
            {skippedCount > 0 && (
              <> {skippedCount} row{skippedCount === 1 ? '' : 's'} skipped (missing class id).</>
            )}
          </p>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={tagCount === 0}
              className={`px-6 py-2 rounded-lg text-white ${
                tagCount === 0 ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              Heal {tagCount} tag{tagCount === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the button + modal + settle-watcher into the page**

Replace the entire contents of `src/renderer/pages/DiscrepanciesPage.tsx` with:

```tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTaskQueue } from '../contexts/TaskQueueContext';
import { HealConfirmationModal } from '../components/HealConfirmationModal';

type DiscrepancyType = 'orphan-tag' | 'missing-tag' | 'unresolved' | 'unknown';

interface Discrepancy {
  type: DiscrepancyType;
  roomId: string;
  roomTitle: string | null;
  role: string;
  personId?: string;
  email?: string | null;
  uid?: string;
  displayName?: string | null;
  note?: string;
}

interface HealPlanItem {
  personId: string;
  roomId: string;
  roomTitle: string | null;
  role: string;
  tag: string;
  displayName: string | null;
  email: string | null;
}

interface HealPlan {
  items: HealPlanItem[];
  skipped: Array<{ personId: string; roomId: string; role: string; reason: string }>;
}

const TYPE_LABELS: Record<DiscrepancyType, string> = {
  'orphan-tag': 'Orphan tag',
  'missing-tag': 'Missing tag',
  unresolved: 'Unresolved',
  unknown: 'Unknown person',
};

const TYPE_DESCRIPTIONS: Record<DiscrepancyType, string> = {
  'orphan-tag': 'Has the profile tag but is NOT a group member (the tag grants nothing).',
  'missing-tag': 'Is a group member but the profile lacks the breadcrumb tag (healable in S3).',
  unresolved: 'Group member whose ACL entry has no email — cannot be mapped to a person.',
  unknown: 'Group member with an email but no local profile (not synced).',
};

const ORDER: DiscrepancyType[] = ['orphan-tag', 'missing-tag', 'unresolved', 'unknown'];

function DiscrepanciesPage() {
  const { tasks, addHealTagTask } = useTaskQueue();
  const [items, setItems] = useState<Discrepancy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | DiscrepancyType>('all');
  const [search, setSearch] = useState('');
  const [healPlan, setHealPlan] = useState<HealPlan | null>(null);
  const [watching, setWatching] = useState(false);
  const enqueuedRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(() => {
    window.electronAPI
      .getDiscrepancies()
      .then((rows) => {
        if (mountedRef.current) setItems(rows as Discrepancy[]);
      })
      .catch((e) => {
        if (mountedRef.current) setError(String(e?.message || e));
      });
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const counts = useMemo(() => {
    const c: Record<DiscrepancyType, number> = { 'orphan-tag': 0, 'missing-tag': 0, unresolved: 0, unknown: 0 };
    for (const d of items || []) c[d.type] += 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items || []).filter((d) => {
      if (typeFilter !== 'all' && d.type !== typeFilter) return false;
      if (!q) return true;
      return [d.roomTitle, d.roomId, d.role, d.email, d.displayName, d.uid, d.personId]
        .some((v) => (v || '').toString().toLowerCase().includes(q));
    });
  }, [items, typeFilter, search]);

  const openHeal = useCallback(async () => {
    try {
      const plan = await window.electronAPI.getTagHealPlan();
      setHealPlan(plan);
    } catch (e) {
      setError(String((e as any)?.message || e));
    }
  }, []);

  const confirmHeal = useCallback(() => {
    if (!healPlan) return;
    const ids = new Set<string>();
    for (const it of healPlan.items) {
      const id = addHealTagTask({ personId: it.personId, tag: it.tag, displayName: it.displayName });
      ids.add(id);
    }
    enqueuedRef.current = ids;
    setHealPlan(null);
    setWatching(ids.size > 0);
  }, [healPlan, addHealTagTask]);

  // When every enqueued heal task has settled (success/error), refetch so counts drop.
  useEffect(() => {
    if (!watching) return;
    const ids = enqueuedRef.current;
    const tracked = tasks.filter((t) => ids.has(t.id));
    if (tracked.length === ids.size && tracked.every((t) => t.status === 'success' || t.status === 'error')) {
      refetch();
      setWatching(false);
      enqueuedRef.current = new Set();
    }
  }, [tasks, watching, refetch]);

  if (error) return <div className="text-red-600">Failed to load discrepancies: {error}</div>;
  if (!items) return <div className="text-gray-500">Loading discrepancies…</div>;

  const missingCount = counts['missing-tag'];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Discrepancies</h2>
          <p className="text-sm text-gray-500">
            Where profile tags and group-ACL truth disagree. Read-only — computed from the last sync.
          </p>
        </div>
        <button
          onClick={openHeal}
          disabled={missingCount === 0 || watching}
          className={`px-3 py-1.5 rounded text-sm whitespace-nowrap ${
            missingCount === 0 || watching
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {watching ? 'Healing…' : `Heal all missing-tags (${missingCount})`}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setTypeFilter('all')}
          className={`px-3 py-1.5 rounded text-sm ${typeFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
        >
          All ({items.length})
        </button>
        {ORDER.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            title={TYPE_DESCRIPTIONS[t]}
            className={`px-3 py-1.5 rounded text-sm ${typeFilter === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            {TYPE_LABELS[t]} ({counts[t]})
          </button>
        ))}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search room, person, email, role…"
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
      />

      {filtered.length === 0 ? (
        <div className="text-gray-500 text-sm">No discrepancies match.</div>
      ) : (
        <div className="overflow-auto border border-gray-200 rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Room</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Email / UID</th>
                <th className="px-3 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-3 py-2 whitespace-nowrap">{TYPE_LABELS[d.type]}</td>
                  <td className="px-3 py-2">{d.roomTitle || d.roomId}</td>
                  <td className="px-3 py-2">{d.role}</td>
                  <td className="px-3 py-2">{d.displayName || d.personId || '—'}</td>
                  <td className="px-3 py-2">{d.email || d.uid || '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{d.note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <HealConfirmationModal
        isOpen={healPlan !== null}
        tagCount={healPlan?.items.length ?? 0}
        skippedCount={healPlan?.skipped.length ?? 0}
        onConfirm={confirmHeal}
        onClose={() => setHealPlan(null)}
      />
    </div>
  );
}

export default DiscrepanciesPage;
```

- [ ] **Step 5: Full build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors (renderer + main). Verifies the new `Task` union member is handled everywhere (`TaskQueuePanel.getLabel`), the modal + page typecheck, and `window.electronAPI.getTagHealPlan/healTag` resolve against the preload types from Task 2.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/contexts/TaskQueueContext.tsx src/renderer/components/TaskQueuePanel.tsx src/renderer/components/HealConfirmationModal.tsx src/renderer/pages/DiscrepanciesPage.tsx
git commit -m "feat(s3): Heal all missing-tags button, confirm modal, healTag queue task"
```

---

### Task 4: Manual acceptance (user-run)

Not an implementer task — this is run by the human after Tasks 1-3 are merged/built. Verifies the end-to-end path the unit tests can't reach.

- [ ] **Step 1: Build and start**

```bash
npm run build && npm start
```

- [ ] **Step 2: Confirm the button + count**

Open the **Discrepancies** tab. A **"Heal all missing-tags (N)"** button appears top-right, where N equals the "Missing tag" filter count. With N = 0 the button is disabled.

- [ ] **Step 3: Run a batch heal**

Click the button → the confirm modal shows the tag count (and any skipped count) → confirm. The Task Queue panel (top-right) fills with `Tag: <name>` tasks running one at a time to ✓. Any failure shows ✗ with a **Retry** action.

- [ ] **Step 4: Verify the count drops**

When the queue settles, the Discrepancies **Missing tag** count drops toward 0 (healed rows removed via the local `persons.tags` patch + auto-refetch).

- [ ] **Step 5: Ground-truth check**

Run **Dashboard → Sync**, reopen **Discrepancies**. The healed missing-tags stay gone (Hazu now returns the tags). Confirm **Orphan tag**, **Unresolved**, and **Unknown person** counts are unchanged (S3 is add-only and missing-tag-only).

---

## Notes for the executor

- **Add-only discipline:** no S3 code path may call `sendApiRequestRemoveTags`, any `groups`/`acl` write, or delete a tag. If a task seems to need one, stop and escalate.
- **Don't touch `sendApiRequestAddTags`** (the swallowing version) — its existing callers depend on the current behavior. S3 uses the new `sendApiRequestAddTagsChecked`.
- **`discrepancy.service.ts` refactor is behavior-preserving:** `getDiscrepancies()` must return exactly what it did before; only the DB reads move into `loadDiscrepancyInput()`. If `discrepancy.test.ts` or the S2 report behavior changes, that's a defect.
- **Known standing Minor (not introduced here):** keep S1 `extractClassId` (first-hyphen truncation) and `parseClassTag` (last-hyphen split) in lockstep. Harmless today — all live `class_id` values are alphanumeric — so reconstructed tags are exact. See the spec's "class_id-with-hyphens assumption".
- **`docs/` is gitignored** — when committing this plan or the spec, use `git add -f`. Implementer commits (source code) are unaffected.
```
