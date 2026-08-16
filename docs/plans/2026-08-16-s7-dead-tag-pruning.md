# S7 — Dead-Tag Pruning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the breadcrumb tags that point at rooms Hazu no longer has — and only those.

**Architecture:** One button on the Discrepancies page probes every unmatched class id against `GET /read`; the confirmation modal reports what it found. Confirming enqueues one Task Queue task per person, and each task re-probes its own ids before deleting, then verifies against a fresh profile read. Pure core with all IO injected + thin IO layer, mirroring S4 and S6.

**Tech Stack:** TypeScript (Node/CommonJS via `tsconfig.main.json`), React 19, better-sqlite3, axios, vitest 4.

**Spec:** [docs/specs/2026-08-12-s7-missing-room-classification-design.md](../specs/2026-08-12-s7-missing-room-classification-design.md)

## Global Constraints

Copied from the spec. Every task's requirements implicitly include this section.

- **Only an explicit 404 means `deleted`.** Every other failure — 5xx, network, timeout, 401, 403 — classifies as `unreadable`. An expired API key returns 401 for every id; were 401 to mean `deleted`, one credentials problem would arm the prune against every live tag in the set.
- **Only `deleted` may be pruned.** Never `alive`, never `unreadable`, never a bucket-B tag.
- **Re-probe immediately before deleting.** The plan authorises nothing. A fresh 404, taken inside the task that does the deleting, is the authorisation. Re-planning can only shrink a delete set, never grow it.
- **Retry only transient failures.** 5xx, network, timeout — never a 4xx, and never a 404.
- **One id's failure never aborts the sweep.** Per-id handling, as sync does per group.
- **The probe set is derived from the report, not re-derived.** A single pure helper defines "unmatched class id," so the probe and the page can never disagree about what needs checking.
- **Pure core with injected IO.** `tag-prune.ts` imports nothing from the DB, HTTP, or Electron; it is vitest-runnable without the native module.
- **Writes go through the Task Queue.** No direct API calls from the renderer.
- **Tags only.** Nothing here touches groups, ACLs, or access.
- **Truth outranks the status code in both directions.** A DELETE returning 2xx while the tag survives is a failure; a DELETE that fails while the tag is gone is a success.
- Person-data rule (CLAUDE.md): fixtures use invented ids and `@example.invalid` addresses. No real names, addresses, or Hazu profile ids anywhere — source, tests, docs, or commit messages.

### Verification baselines (measured 2026-08-16, before any change)

| check | command | baseline |
|---|---|---|
| tests | `npm test` | **111 passed, 6 files** |
| main typecheck | `npx tsc -p tsconfig.main.json --noEmit` | **0 errors** |
| renderer typecheck | `npx tsc -p tsconfig.json --noEmit 2>&1 \| grep -c "error TS"` | **9 pre-existing errors** — do not "fix" these; the count must not rise |
| person-data guard | `python3 scripts/check-no-person-data.py --all` | **exit 0** |

## File Structure

| File | Responsibility |
|---|---|
| `src/main/services/tag-prune.ts` (new) | Pure core. Read classification, plan building, the probe loop, and the per-person removal orchestrator. No DB, no HTTP, no Electron. |
| `src/main/services/tag-prune.test.ts` (new) | Unit tests over injected fakes. |
| `src/main/services/tag-prune.service.ts` (new) | Thin IO. `planTagPrune()` and `pruneDeadTags()`. |
| `src/main/services/discrepancy.ts` (modify) | Gains `collectUnmatchedClassIds` — the single definition of "needs probing". |
| `src/main/services/discrepancy.test.ts` (modify) | Cases for the new helper. |
| `src/main/services/hazu-api/api.ts` (modify) | Gains `sendApiRequestRemoveTagsChecked`. |
| `src/shared/ipc-channels.ts` (modify) | Two channels. |
| `src/main/ipc/index.ts` (modify) | Two handlers. |
| `src/main/preload.ts` (modify) | Its own copy of the two channel constants, two methods, two type entries. |
| `src/renderer/contexts/TaskQueueContext.tsx` (modify) | `pruneDeadTags` task type. |
| `src/renderer/components/TaskQueuePanel.tsx` (modify) | `getLabel()` case. |
| `src/renderer/components/PruneTagsConfirmationModal.tsx` (new) | Confirmation modal. |
| `src/renderer/pages/DiscrepanciesPage.tsx` (modify) | Button, modal wiring, per-flow settle tracking. |

No schema change. No change to `discrepancy.service.ts`.

## Documented deviations from the spec

Three, all deliberate. A reviewer should treat these as approved, not as findings.

**1. Deletions carry `items: Array<{ classId, tags }>`, not parallel `classIds` and `tags` arrays.** The spec sketches `{ personId, classIds, tags }` and an IPC signature of `(personId, classIds, tags)`. That loses the mapping from class id to tag — and the task's re-probe needs it, because when one id comes back `alive` the task must drop *that id's* tags while still deleting the others'. Two parallel arrays cannot express that. `items` can. The IPC signature becomes `(personId, items)`.

**2. `sendApiRequestRemoveTagsChecked` uses `"x-api-key": getApiKey()` directly, not `getAuthHeaders()`.** `sendApiRequestRemoveUserChecked` uses `getAuthHeaders()`, but both existing *tag* endpoints — `sendApiRequestAddTags` and `sendApiRequestRemoveTags` — use the literal `x-api-key` header, and `sendApiRequestAddTagsChecked` (proven in S3 against live data) does too. Matching the tag-endpoint precedent is the safer choice; `getAuthHeaders()` switches to a `token` header for keys of 20 characters or fewer, and no tag endpoint has ever been exercised that way.

**3. `sendApiRequestRead`'s response is `{ snapshot: { … } }`.** Verified live on 2026-08-16 against `0dQJCWrIOAl56pT9aG5X`: the top level has exactly one key, `snapshot`, which carries `title`, `parentId`, and `tags` among others. The function has **zero callers in the codebase**, so this shape is documented nowhere else — do not assume a flat body.

---

### Task 1: Pure core — read classification and plan building

**Files:**
- Create: `src/main/services/tag-prune.ts`
- Test: `src/main/services/tag-prune.test.ts`

**Interfaces:**
- Consumes: nothing. This task has no imports at all.
- Produces, for Tasks 2, 3, 4 and 7:
  - `type RoomVerdict = 'deleted' | 'alive' | 'unreadable'`
  - `interface ReadOutcome { ok: boolean; status?: number; networkOrTimeout: boolean; snapshot?: { title?: string; parentId?: string } }`
  - `interface Verdict { verdict: RoomVerdict; title: string | null; parentId: string | null }`
  - `interface UnmatchedClassId { classId: string; tagCount: number; personCount: number; holders: Array<{ personId: string; tags: string[] }> }`
  - `interface SkippedId { classId: string; verdict: 'alive' | 'unreadable'; reason: string; title: string | null; parentId: string | null; tagCount: number }`
  - `interface PruneItem { classId: string; tags: string[] }`
  - `interface PruneDeletion { personId: string; items: PruneItem[] }`
  - `interface PrunePlan { deletions: PruneDeletion[]; skipped: SkippedId[]; tagCount: number; personCount: number; roomCount: number }`
  - `const SKIP_REASON: Record<'alive' | 'unreadable', string>`
  - `function classifyReadResult(res: ReadOutcome): Verdict`
  - `function buildPrunePlan(ids: UnmatchedClassId[], verdicts: Map<string, Verdict>): PrunePlan`

**Context:** This is the decision layer, and the 401 case is the one the whole feature exists to get right. An expired API key makes every read fail with 401; if that classified as `deleted`, confirming the modal would delete every tag in the set. Only a literal 404 may ever produce `deleted`.

A second rule matters as much and is easy to miss: **an id with no verdict in the map is treated as `unreadable`, not skipped silently and not deleted.** A missing verdict means the probe never answered for it, which is exactly the situation the `unreadable` verdict describes.

- [ ] **Step 1: Write the failing tests**

Create `src/main/services/tag-prune.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  classifyReadResult,
  buildPrunePlan,
  UnmatchedClassId,
  Verdict,
} from './tag-prune';

const alive = (title: string | null = null, parentId: string | null = null): Verdict => ({
  verdict: 'alive',
  title,
  parentId,
});
const deleted = (): Verdict => ({ verdict: 'deleted', title: null, parentId: null });
const unreadable = (): Verdict => ({ verdict: 'unreadable', title: null, parentId: null });

const unmatched = (
  classId: string,
  holders: Array<{ personId: string; tags: string[] }>,
): UnmatchedClassId => ({
  classId,
  tagCount: holders.reduce((n, h) => n + h.tags.length, 0),
  personCount: holders.length,
  holders,
});

describe('classifyReadResult', () => {
  it('classifies an explicit 404 as deleted', () => {
    expect(classifyReadResult({ ok: false, status: 404, networkOrTimeout: false })).toEqual({
      verdict: 'deleted',
      title: null,
      parentId: null,
    });
  });

  it('classifies a 200 as alive, keeping the title and parent id', () => {
    expect(
      classifyReadResult({
        ok: true,
        networkOrTimeout: false,
        snapshot: { title: 'Some Room', parentId: 'Parent00000000000001' },
      }),
    ).toEqual({ verdict: 'alive', title: 'Some Room', parentId: 'Parent00000000000001' });
  });

  it('classifies a 200 with no usable snapshot as alive with null detail', () => {
    expect(classifyReadResult({ ok: true, networkOrTimeout: false })).toEqual({
      verdict: 'alive',
      title: null,
      parentId: null,
    });
  });

  it('classifies a 500 as unreadable', () => {
    expect(classifyReadResult({ ok: false, status: 500, networkOrTimeout: false }).verdict).toBe(
      'unreadable',
    );
  });

  it('classifies a network or timeout failure as unreadable', () => {
    expect(classifyReadResult({ ok: false, networkOrTimeout: true }).verdict).toBe('unreadable');
  });

  // The reason this whole feature is gated on a 404 and nothing else: an expired key
  // returns 401 for EVERY id, and a 401 that meant "deleted" would arm the prune
  // against every live tag in the set.
  it('classifies a 401 as unreadable, never deleted', () => {
    expect(classifyReadResult({ ok: false, status: 401, networkOrTimeout: false }).verdict).toBe(
      'unreadable',
    );
  });

  it('classifies a 403 as unreadable, never deleted', () => {
    expect(classifyReadResult({ ok: false, status: 403, networkOrTimeout: false }).verdict).toBe(
      'unreadable',
    );
  });
});

describe('buildPrunePlan', () => {
  const ID_A = 'Dead0000000000000001';
  const ID_B = 'Dead0000000000000002';
  const ID_LIVE = 'Live0000000000000001';
  const P1 = 'Person00000000000001';
  const P2 = 'Person00000000000002';
  const tagFor = (id: string, role = 'student') => `hz-config-class-${id}-${role}`;

  it('produces deletions only for ids the verdicts call deleted', () => {
    const plan = buildPrunePlan(
      [
        unmatched(ID_A, [{ personId: P1, tags: [tagFor(ID_A)] }]),
        unmatched(ID_LIVE, [{ personId: P2, tags: [tagFor(ID_LIVE)] }]),
      ],
      new Map([
        [ID_A, deleted()],
        [ID_LIVE, alive('A Live Room', 'Parent00000000000001')],
      ]),
    );
    expect(plan.deletions).toEqual([{ personId: P1, items: [{ classId: ID_A, tags: [tagFor(ID_A)] }] }]);
    expect(plan.skipped.map((s) => s.classId)).toEqual([ID_LIVE]);
  });

  it('reports an alive skip with its reason, title and parent id', () => {
    const plan = buildPrunePlan(
      [unmatched(ID_LIVE, [{ personId: P1, tags: [tagFor(ID_LIVE)] }])],
      new Map([[ID_LIVE, alive('A Live Room', 'Parent00000000000001')]]),
    );
    expect(plan.skipped).toEqual([
      {
        classId: ID_LIVE,
        verdict: 'alive',
        reason: expect.stringContaining('still exists'),
        title: 'A Live Room',
        parentId: 'Parent00000000000001',
        tagCount: 1,
      },
    ]);
  });

  it('reports an unreadable skip', () => {
    const plan = buildPrunePlan(
      [unmatched(ID_A, [{ personId: P1, tags: [tagFor(ID_A)] }])],
      new Map([[ID_A, unreadable()]]),
    );
    expect(plan.deletions).toEqual([]);
    expect(plan.skipped[0].verdict).toBe('unreadable');
  });

  // A verdict that never arrived is not a licence to delete.
  it('treats an id with no verdict at all as unreadable', () => {
    const plan = buildPrunePlan([unmatched(ID_A, [{ personId: P1, tags: [tagFor(ID_A)] }])], new Map());
    expect(plan.deletions).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ classId: ID_A, verdict: 'unreadable' });
  });

  it('groups one person holding tags for two dead rooms into a single deletion', () => {
    const plan = buildPrunePlan(
      [
        unmatched(ID_A, [{ personId: P1, tags: [tagFor(ID_A)] }]),
        unmatched(ID_B, [{ personId: P1, tags: [tagFor(ID_B, 'guardian')] }]),
      ],
      new Map([
        [ID_A, deleted()],
        [ID_B, deleted()],
      ]),
    );
    expect(plan.deletions).toHaveLength(1);
    expect(plan.deletions[0]).toEqual({
      personId: P1,
      items: [
        { classId: ID_A, tags: [tagFor(ID_A)] },
        { classId: ID_B, tags: [tagFor(ID_B, 'guardian')] },
      ],
    });
  });

  it('keeps two people holding tags for the same dead room in separate deletions', () => {
    const plan = buildPrunePlan(
      [
        unmatched(ID_A, [
          { personId: P1, tags: [tagFor(ID_A)] },
          { personId: P2, tags: [tagFor(ID_A, 'guardian')] },
        ]),
      ],
      new Map([[ID_A, deleted()]]),
    );
    expect(plan.deletions.map((d) => d.personId)).toEqual([P1, P2]);
  });

  it('counts tags, people and rooms across the whole plan', () => {
    const plan = buildPrunePlan(
      [
        unmatched(ID_A, [
          { personId: P1, tags: [tagFor(ID_A), tagFor(ID_A, 'guardian')] },
          { personId: P2, tags: [tagFor(ID_A)] },
        ]),
        unmatched(ID_B, [{ personId: P1, tags: [tagFor(ID_B)] }]),
        unmatched(ID_LIVE, [{ personId: P2, tags: [tagFor(ID_LIVE)] }]),
      ],
      new Map([
        [ID_A, deleted()],
        [ID_B, deleted()],
        [ID_LIVE, alive()],
      ]),
    );
    expect(plan.tagCount).toBe(4);   // 2 + 1 for ID_A, 1 for ID_B; the live one is not counted
    expect(plan.personCount).toBe(2);
    expect(plan.roomCount).toBe(2);
  });

  it('returns an empty plan for no unmatched ids', () => {
    expect(buildPrunePlan([], new Map())).toEqual({
      deletions: [],
      skipped: [],
      tagCount: 0,
      personCount: 0,
      roomCount: 0,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/services/tag-prune.test.ts`

Expected: FAIL — `Failed to resolve import "./tag-prune"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/services/tag-prune.ts`:

```typescript
/**
 * Dead-tag pruning: pure core.
 *
 * No DB, no HTTP, no Electron — every side effect is injected, so the whole decision layer runs
 * under vitest without the native module or the network. tag-prune.service.ts supplies the real IO.
 *
 * The rule this file exists to enforce: only an explicit 404 authorises deleting a tag.
 */

export type RoomVerdict = 'deleted' | 'alive' | 'unreadable';

// The result of one GET /read attempt, with its failure already classified so the retry
// predicate can tell a doomed 4xx from a worth-retrying 5xx.
export interface ReadOutcome {
  ok: boolean;
  status?: number;
  networkOrTimeout: boolean;
  snapshot?: { title?: string; parentId?: string };
}

// What a probe learned about one class id. `title` and `parentId` are non-null only when alive.
export interface Verdict {
  verdict: RoomVerdict;
  title: string | null;
  parentId: string | null;
}

// One distinct class id referenced by breadcrumb tags that map to no local room, with the
// tags and the people carrying them.
export interface UnmatchedClassId {
  classId: string;
  tagCount: number;
  personCount: number;
  holders: Array<{ personId: string; tags: string[] }>;
}

// An id the prune declined to act on, and why. Shown in the confirmation modal.
export interface SkippedId {
  classId: string;
  verdict: 'alive' | 'unreadable';
  reason: string;
  title: string | null;
  parentId: string | null;
  tagCount: number;
}

// The tags to remove for one class id. Kept grouped by id rather than flattened, because a
// task's re-probe must be able to drop one id's tags while still deleting the rest.
export interface PruneItem {
  classId: string;
  tags: string[];
}

export interface PruneDeletion {
  personId: string;
  items: PruneItem[];
}

export interface PrunePlan {
  deletions: PruneDeletion[];
  skipped: SkippedId[];
  tagCount: number;
  personCount: number;
  roomCount: number;
}

export const SKIP_REASON: Record<'alive' | 'unreadable', string> = {
  alive:
    'the room still exists in Hazu — these breadcrumbs are correct, and the sync did not import it',
  unreadable:
    'Hazu did not answer for this id — only an explicit 404 authorises a deletion',
};

// Classify one read. ONLY a literal 404 yields 'deleted'. Everything else that is not a success
// is 'unreadable', including 401 and 403: an expired key fails every read, and treating that as
// "deleted" would arm the prune against every live tag in the set.
export function classifyReadResult(res: ReadOutcome): Verdict {
  if (res.ok) {
    return {
      verdict: 'alive',
      title: res.snapshot?.title ?? null,
      parentId: res.snapshot?.parentId ?? null,
    };
  }
  if (res.status === 404) return { verdict: 'deleted', title: null, parentId: null };
  return { verdict: 'unreadable', title: null, parentId: null };
}

// Turn verdicts + the unmatched set into what to delete, grouped by person, and what was
// skipped and why. An id with no verdict is treated as unreadable — a verdict that never
// arrived is not a licence to delete.
export function buildPrunePlan(
  ids: UnmatchedClassId[],
  verdicts: Map<string, Verdict>,
): PrunePlan {
  const byPerson = new Map<string, PruneDeletion>();
  const skipped: SkippedId[] = [];
  const deadIds = new Set<string>();
  let tagCount = 0;

  for (const id of ids) {
    const v = verdicts.get(id.classId);
    const verdict: RoomVerdict = v?.verdict ?? 'unreadable';

    if (verdict !== 'deleted') {
      skipped.push({
        classId: id.classId,
        verdict,
        reason: SKIP_REASON[verdict],
        title: v?.title ?? null,
        parentId: v?.parentId ?? null,
        tagCount: id.tagCount,
      });
      continue;
    }

    deadIds.add(id.classId);
    for (const holder of id.holders) {
      let entry = byPerson.get(holder.personId);
      if (!entry) {
        entry = { personId: holder.personId, items: [] };
        byPerson.set(holder.personId, entry);
      }
      entry.items.push({ classId: id.classId, tags: holder.tags });
      tagCount += holder.tags.length;
    }
  }

  const deletions = [...byPerson.values()];
  return {
    deletions,
    skipped,
    tagCount,
    personCount: deletions.length,
    roomCount: deadIds.size,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/services/tag-prune.test.ts`

Expected: PASS — 15 tests, output pristine (no warnings).

- [ ] **Step 5: Run the full suite and the main typecheck**

Run: `npm test`
Expected: **126 passed** (111 baseline + 15 new), 7 files.

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: no output (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/services/tag-prune.ts src/main/services/tag-prune.test.ts
git commit -m "feat(s7): pure read classification and prune-plan building"
```

---

### Task 2: Pure core — the probe loop and the per-person removal orchestrator

**Files:**
- Modify: `src/main/services/tag-prune.ts` (append)
- Test: `src/main/services/tag-prune.test.ts` (append)

**Interfaces:**
- Consumes, from Task 1: `ReadOutcome`, `Verdict`, `RoomVerdict`, `SkippedId`, `PruneItem`, `PruneDeletion`, `SKIP_REASON`, `classifyReadResult`. From `./role-write`: `isRetryableError(status: number | undefined, networkOrTimeout: boolean): boolean` and `backoffMs(attempt: number): number` (0-indexed; 500, 1000, 2000…).
- Produces, for Task 4:
  - `interface ProbeDeps { readItem: (classId: string) => Promise<ReadOutcome>; sleep: (ms: number) => Promise<void> }`
  - `interface ProbeConfig { maxReadAttempts?: number }`
  - `function probeClassIds(ids: readonly string[], deps: ProbeDeps, cfg?: ProbeConfig): Promise<Map<string, Verdict>>`
  - `interface TagPruneDeps { probe: (classId: string) => Promise<ReadOutcome>; removeTags: (personId: string, tags: string[]) => Promise<{ ok: boolean; status?: number; networkOrTimeout: boolean; error?: string }>; readPersonTags: (personId: string) => Promise<string[] | null>; sleep: (ms: number) => Promise<void> }`
  - `interface TagPruneConfig { maxReadAttempts?: number; maxDeleteAttempts?: number; maxVerifyReads?: number; verifyDelayMs?: number }`
  - `interface TagPruneOutcome { success: boolean; deletedTags: string[]; skippedClassIds: SkippedId[]; surviving: string[]; deleteOk: boolean; verifyRan: boolean; verified: boolean; attempts: number; error?: string }`
  - `function runTagPrune(target: PruneDeletion, deps: TagPruneDeps, cfg?: TagPruneConfig): Promise<TagPruneOutcome>`

**Context:** `runTagPrune` handles one person. Its shape mirrors [`runOrphanRemoval`](../../src/main/services/orphan-removal.ts:94) closely enough to read as the same idiom, with one step added at the front: **the re-probe**.

Three behaviours are easy to get wrong and each has a dedicated test:

1. **A 404 is never retried.** `isRetryableError(404, false)` is already false, so the loop must break on it rather than sleeping and trying again — otherwise every dead room costs three reads instead of one.
2. **Verification runs even after a failed delete.** A 5xx or a timeout says nothing about whether the write committed; this is the measured lesson from S4, where two profiles returned HTTP 500 on all four attempts while the member actually landed. Only the re-read answers the question.
3. **A task whose ids all drop is a success, not a failure.** Nothing went wrong — the re-probe simply declined to confirm. Returning an error there would train the operator to ignore red rows.

`probeClassIds` is sequential on purpose. Fifteen reads take roughly twenty seconds, and a parallel sweep against an API this feature is about to delete against buys little.

- [ ] **Step 1: Write the failing tests**

First **extend the existing import** at the top of `src/main/services/tag-prune.test.ts` — do not add a second import statement from the same module — so it reads:

```typescript
import {
  classifyReadResult,
  buildPrunePlan,
  probeClassIds,
  runTagPrune,
  PruneDeletion,
  ReadOutcome,
  TagPruneDeps,
  UnmatchedClassId,
  Verdict,
} from './tag-prune';
```

Then append to the same file:

```typescript
// --- Task 2 fixtures -------------------------------------------------------

const ok = (title?: string, parentId?: string): ReadOutcome => ({
  ok: true,
  networkOrTimeout: false,
  snapshot: { title, parentId },
});
const notFound = (): ReadOutcome => ({ ok: false, status: 404, networkOrTimeout: false });
const serverError = (): ReadOutcome => ({ ok: false, status: 500, networkOrTimeout: false });

// Scripted reads: each id maps to a queue of outcomes, consumed one per attempt. The last
// entry repeats once the queue runs dry, so a "always 500" id needs only one entry.
function scriptedReader(script: Record<string, ReadOutcome[]>) {
  const calls: string[] = [];
  const cursors: Record<string, number> = {};
  return {
    calls,
    readItem: async (id: string): Promise<ReadOutcome> => {
      calls.push(id);
      const queue = script[id];
      if (!queue || queue.length === 0) return notFound();
      const i = Math.min(cursors[id] ?? 0, queue.length - 1);
      cursors[id] = (cursors[id] ?? 0) + 1;
      return queue[i];
    },
  };
}

const noSleep = async () => {};

describe('probeClassIds', () => {
  it('retries a 500 and takes the later success', async () => {
    const r = scriptedReader({ A0000000000000000001: [serverError(), ok('Recovered Room')] });
    const out = await probeClassIds(['A0000000000000000001'], { readItem: r.readItem, sleep: noSleep });
    expect(out.get('A0000000000000000001')).toEqual({
      verdict: 'alive',
      title: 'Recovered Room',
      parentId: null,
    });
    expect(r.calls).toEqual(['A0000000000000000001', 'A0000000000000000001']);
  });

  it('never retries a 404 — one read per dead id', async () => {
    const r = scriptedReader({ A0000000000000000001: [notFound()] });
    const out = await probeClassIds(['A0000000000000000001'], { readItem: r.readItem, sleep: noSleep });
    expect(out.get('A0000000000000000001')?.verdict).toBe('deleted');
    expect(r.calls).toEqual(['A0000000000000000001']);
  });

  it('gives up after maxReadAttempts on a persistent 500', async () => {
    const r = scriptedReader({ A0000000000000000001: [serverError()] });
    const out = await probeClassIds(
      ['A0000000000000000001'],
      { readItem: r.readItem, sleep: noSleep },
      { maxReadAttempts: 3 },
    );
    expect(out.get('A0000000000000000001')?.verdict).toBe('unreadable');
    expect(r.calls).toHaveLength(3);
  });

  it('records a hard throw as unreadable and keeps probing the other ids', async () => {
    const calls: string[] = [];
    const readItem = async (id: string): Promise<ReadOutcome> => {
      calls.push(id);
      if (id === 'Boom0000000000000001') throw new Error('socket hang up');
      return notFound();
    };
    const out = await probeClassIds(
      ['Boom0000000000000001', 'B0000000000000000001'],
      { readItem, sleep: noSleep },
      { maxReadAttempts: 1 },
    );
    expect(out.get('Boom0000000000000001')?.verdict).toBe('unreadable');
    expect(out.get('B0000000000000000001')?.verdict).toBe('deleted');
    expect(calls).toContain('B0000000000000000001');
  });

  it('returns one verdict per id', async () => {
    const r = scriptedReader({});
    const out = await probeClassIds(['A0000000000000000001', 'B0000000000000000001'], {
      readItem: r.readItem,
      sleep: noSleep,
    });
    expect([...out.keys()]).toEqual(['A0000000000000000001', 'B0000000000000000001']);
  });
});

describe('runTagPrune', () => {
  const PERSON = 'Person00000000000001';
  const DEAD = 'Dead0000000000000001';
  const LIVE = 'Live0000000000000001';
  const DEAD_TAG = `hz-config-class-${DEAD}-student`;
  const LIVE_TAG = `hz-config-class-${LIVE}-student`;

  const target = (items: PruneDeletion['items']): PruneDeletion => ({ personId: PERSON, items });

  // Builds deps whose probe is scripted per id, whose delete reports a fixed outcome, and
  // whose profile re-read returns a fixed tag list (or null for "cannot verify").
  function deps(opts: {
    reads?: Record<string, ReadOutcome[]>;
    remove?: { ok: boolean; status?: number; networkOrTimeout?: boolean; error?: string };
    after?: string[] | null;
  }): TagPruneDeps & { removed: string[][] } {
    const r = scriptedReader(opts.reads ?? {});
    const removed: string[][] = [];
    return {
      removed,
      probe: r.readItem,
      removeTags: async (_personId, tags) => {
        removed.push(tags);
        const o = opts.remove ?? { ok: true };
        return { ok: o.ok, status: o.status, networkOrTimeout: o.networkOrTimeout ?? false, error: o.error };
      },
      readPersonTags: async () => (opts.after === undefined ? [] : opts.after),
      sleep: noSleep,
    };
  }

  it('deletes the tags of an id the re-probe confirms dead', async () => {
    const d = deps({ reads: { [DEAD]: [notFound()] }, after: [] });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d);
    expect(out.success).toBe(true);
    expect(out.deletedTags).toEqual([DEAD_TAG]);
    expect(d.removed).toEqual([[DEAD_TAG]]);
  });

  // The re-probe is the authorisation, not the plan. An id that came back alive since the
  // modal was shown must lose its tags from the delete set.
  it('drops an id whose re-probe returns alive, and still deletes the others', async () => {
    const d = deps({
      reads: { [DEAD]: [notFound()], [LIVE]: [ok('Back From The Dead', 'Parent00000000000001')] },
      after: [],
    });
    const out = await runTagPrune(
      target([
        { classId: DEAD, tags: [DEAD_TAG] },
        { classId: LIVE, tags: [LIVE_TAG] },
      ]),
      d,
    );
    expect(d.removed).toEqual([[DEAD_TAG]]);
    expect(out.deletedTags).toEqual([DEAD_TAG]);
    expect(out.skippedClassIds).toEqual([
      {
        classId: LIVE,
        verdict: 'alive',
        reason: expect.stringContaining('still exists'),
        title: 'Back From The Dead',
        parentId: 'Parent00000000000001',
        tagCount: 1,
      },
    ]);
  });

  it('drops an id whose re-probe is unreadable', async () => {
    const d = deps({ reads: { [DEAD]: [serverError()] }, after: [] });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d, {
      maxReadAttempts: 1,
    });
    expect(d.removed).toEqual([]);
    expect(out.skippedClassIds[0].verdict).toBe('unreadable');
  });

  // Nothing went wrong — the re-probe simply declined to confirm. An error here would train
  // the operator to ignore red rows.
  it('succeeds without deleting when every id drops', async () => {
    const d = deps({ reads: { [LIVE]: [ok('Still Here')] }, after: [] });
    const out = await runTagPrune(target([{ classId: LIVE, tags: [LIVE_TAG] }]), d);
    expect(out.success).toBe(true);
    expect(out.deletedTags).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('sends one DELETE carrying every confirmed tag for the person', async () => {
    const OTHER = 'Dead0000000000000002';
    const OTHER_TAG = `hz-config-class-${OTHER}-guardian`;
    const d = deps({ reads: { [DEAD]: [notFound()], [OTHER]: [notFound()] }, after: [] });
    await runTagPrune(
      target([
        { classId: DEAD, tags: [DEAD_TAG] },
        { classId: OTHER, tags: [OTHER_TAG] },
      ]),
      d,
    );
    expect(d.removed).toEqual([[DEAD_TAG, OTHER_TAG]]);
  });

  it('fails when the DELETE returns 2xx but the tag survives on re-read', async () => {
    const d = deps({ reads: { [DEAD]: [notFound()] }, after: [DEAD_TAG] });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d, {
      maxVerifyReads: 2,
    });
    expect(out.success).toBe(false);
    expect(out.deleteOk).toBe(true);
    expect(out.surviving).toEqual([DEAD_TAG]);
    expect(out.error).toContain(DEAD_TAG);
  });

  // Measured in S4: a transport failure carries no information about whether the write
  // committed. Only the re-read does.
  it('succeeds when the DELETE fails but the tag is gone on re-read', async () => {
    const d = deps({
      reads: { [DEAD]: [notFound()] },
      remove: { ok: false, status: 500, error: 'boom' },
      after: [],
    });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d);
    expect(out.success).toBe(true);
    expect(out.deleteOk).toBe(false);
    expect(out.verified).toBe(true);
    expect(out.deletedTags).toEqual([DEAD_TAG]);
  });

  it('falls back to the DELETE status when the profile re-read fails', async () => {
    const d = deps({ reads: { [DEAD]: [notFound()] }, after: null });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d);
    expect(out.verifyRan).toBe(false);
    expect(out.success).toBe(true);   // the DELETE returned 2xx
  });

  it('reports failure when the DELETE fails and the profile re-read fails too', async () => {
    const d = deps({
      reads: { [DEAD]: [notFound()] },
      remove: { ok: false, status: 500, error: 'boom' },
      after: null,
    });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d);
    expect(out.success).toBe(false);
    expect(out.error).toBe('boom');
  });

  it('retries a transient DELETE failure and stops at maxDeleteAttempts', async () => {
    const d = deps({
      reads: { [DEAD]: [notFound()] },
      remove: { ok: false, status: 503, error: 'unavailable' },
      after: [DEAD_TAG],
    });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d, {
      maxDeleteAttempts: 3,
      maxVerifyReads: 1,
    });
    expect(out.attempts).toBe(3);
    expect(out.success).toBe(false);
  });

  it('does not retry a 4xx DELETE', async () => {
    const d = deps({
      reads: { [DEAD]: [notFound()] },
      remove: { ok: false, status: 400, error: 'bad request' },
      after: [DEAD_TAG],
    });
    const out = await runTagPrune(target([{ classId: DEAD, tags: [DEAD_TAG] }]), d, {
      maxDeleteAttempts: 3,
      maxVerifyReads: 1,
    });
    expect(out.attempts).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/services/tag-prune.test.ts`

Expected: FAIL — `probeClassIds is not a function` (or an import/type error naming `probeClassIds`).

- [ ] **Step 3: Write the implementation**

First add this import to the **top** of `src/main/services/tag-prune.ts`, directly under the file's opening doc comment. Task 1 left the file with no imports at all; put this one with the other top-of-file declarations rather than partway down, where it would read as an accident:

```typescript
import { isRetryableError, backoffMs } from './role-write';
```

Then append the rest to the end of the same file:

```typescript
export interface ProbeDeps {
  // One GET /read attempt, with its failure already classified.
  readItem: (classId: string) => Promise<ReadOutcome>;
  sleep: (ms: number) => Promise<void>;
}

export interface ProbeConfig {
  maxReadAttempts?: number;
}

const DEFAULT_PROBE_CFG = { maxReadAttempts: 3 };

/**
 * Probe every id, retrying transient failures only. Sequential on purpose: the sweep is small,
 * and hammering an API we are about to delete against buys nothing.
 *
 * One id's failure never aborts the sweep — a reader that throws instead of classifying is
 * still just an unread, and the remaining ids are probed regardless.
 */
export async function probeClassIds(
  ids: readonly string[],
  deps: ProbeDeps,
  cfg: ProbeConfig = {},
): Promise<Map<string, Verdict>> {
  const { maxReadAttempts } = { ...DEFAULT_PROBE_CFG, ...cfg };
  const out = new Map<string, Verdict>();

  for (const classId of ids) {
    let verdict: Verdict = { verdict: 'unreadable', title: null, parentId: null };

    for (let i = 0; i < maxReadAttempts; i++) {
      let res: ReadOutcome;
      try {
        res = await deps.readItem(classId);
      } catch {
        res = { ok: false, networkOrTimeout: true };
      }
      verdict = classifyReadResult(res);

      // A 404 is deterministic: isRetryableError says no, so this breaks on the first read.
      if (res.ok || !isRetryableError(res.status, res.networkOrTimeout)) break;
      if (i < maxReadAttempts - 1) await deps.sleep(backoffMs(i));
    }

    out.set(classId, verdict);
  }

  return out;
}

export interface TagPruneDeps {
  probe: (classId: string) => Promise<ReadOutcome>;
  // One DELETE attempt; classifies its own failure for the retry predicate.
  removeTags: (
    personId: string,
    tags: string[],
  ) => Promise<{ ok: boolean; status?: number; networkOrTimeout: boolean; error?: string }>;
  // The profile's current tags, or null if they could not be read.
  readPersonTags: (personId: string) => Promise<string[] | null>;
  sleep: (ms: number) => Promise<void>;
}

export interface TagPruneConfig {
  maxReadAttempts?: number;
  maxDeleteAttempts?: number;
  maxVerifyReads?: number;
  verifyDelayMs?: number;
}

export interface TagPruneOutcome {
  success: boolean;
  deletedTags: string[];
  skippedClassIds: SkippedId[];
  surviving: string[];
  deleteOk: boolean;
  verifyRan: boolean;
  verified: boolean;
  attempts: number;
  error?: string;
}

const DEFAULT_PRUNE_CFG = {
  maxReadAttempts: 3,
  maxDeleteAttempts: 3,
  maxVerifyReads: 3,
  verifyDelayMs: 750,
};

/**
 * Remove one person's dead breadcrumb tags, then confirm it against a fresh profile read.
 * All IO injected.
 *
 * Step 1 is the authorisation: the plan the operator confirmed does not license anything, so
 * this re-probes the ids in its OWN payload. That can only ever shrink the delete set.
 */
export async function runTagPrune(
  target: PruneDeletion,
  deps: TagPruneDeps,
  cfg: TagPruneConfig = {},
): Promise<TagPruneOutcome> {
  const c = { ...DEFAULT_PRUNE_CFG, ...cfg };

  // 1. Re-probe this task's own ids. Only a fresh 404 authorises a deletion.
  const verdicts = await probeClassIds(
    target.items.map((i) => i.classId),
    { readItem: deps.probe, sleep: deps.sleep },
    { maxReadAttempts: c.maxReadAttempts },
  );

  const confirmed: PruneItem[] = [];
  const skippedClassIds: SkippedId[] = [];
  for (const item of target.items) {
    const v = verdicts.get(item.classId);
    const verdict: RoomVerdict = v?.verdict ?? 'unreadable';
    if (verdict === 'deleted') {
      confirmed.push(item);
      continue;
    }
    skippedClassIds.push({
      classId: item.classId,
      verdict,
      reason: SKIP_REASON[verdict],
      title: v?.title ?? null,
      parentId: v?.parentId ?? null,
      tagCount: item.tags.length,
    });
  }

  const tags = confirmed.flatMap((i) => i.tags);
  if (tags.length === 0) {
    // Nothing re-confirmed. Not a failure: nothing went wrong, and nothing was deleted.
    return {
      success: true,
      deletedTags: [],
      skippedClassIds,
      surviving: [],
      deleteOk: true,
      verifyRan: false,
      verified: false,
      attempts: 0,
    };
  }

  // 2. One DELETE for all of this person's confirmed-dead tags, retrying transient failures.
  let attempts = 0;
  let deleteOk = false;
  let lastError: string | undefined;
  for (let i = 0; i < c.maxDeleteAttempts; i++) {
    attempts += 1;
    const r = await deps.removeTags(target.personId, tags);
    if (r.ok) {
      deleteOk = true;
      break;
    }
    lastError = r.error;
    if (!isRetryableError(r.status, r.networkOrTimeout) || i === c.maxDeleteAttempts - 1) break;
    await deps.sleep(backoffMs(i));
  }

  // 3. Verify against a fresh profile read, re-reading through cache lag. This runs even after
  //    a failed delete: measured in S4, a transport failure carries no information about
  //    whether the write committed — only the read does.
  let surviving: string[] | null = null;
  for (let i = 0; i < c.maxVerifyReads; i++) {
    const current = await deps.readPersonTags(target.personId);
    if (current === null) break; // cannot verify
    const present = new Set(current);
    surviving = tags.filter((t) => present.has(t));
    if (surviving.length === 0) break;
    if (i < c.maxVerifyReads - 1) await deps.sleep(c.verifyDelayMs);
  }

  // 4. Truth unreadable: fall back to the delete status code.
  if (surviving === null) {
    return {
      success: deleteOk,
      deletedTags: deleteOk ? tags : [],
      skippedClassIds,
      surviving: [],
      deleteOk,
      verifyRan: false,
      verified: false,
      attempts,
      error: deleteOk ? undefined : lastError,
    };
  }

  // 5. Truth decides, in both directions.
  const stillThere = surviving;
  const verified = stillThere.length === 0;
  return {
    success: verified,
    deletedTags: tags.filter((t) => !stillThere.includes(t)),
    skippedClassIds,
    surviving: stillThere,
    deleteOk,
    verifyRan: true,
    verified,
    attempts,
    error: verified
      ? undefined
      : `${stillThere.length} tag(s) still present after the delete: ${stillThere.join(', ')}`,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/services/tag-prune.test.ts`

Expected: PASS — 31 tests (15 from Task 1 + 16 new), output pristine.

- [ ] **Step 5: Run the full suite and the main typecheck**

Run: `npm test`
Expected: **142 passed** (111 baseline + 31 in `tag-prune.test.ts`), 7 files.

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/tag-prune.ts src/main/services/tag-prune.test.ts
git commit -m "feat(s7): probe loop and per-person prune orchestrator with re-probe, retry and verify"
```

---

### Task 3: `collectUnmatchedClassIds` in `discrepancy.ts`

**Files:**
- Modify: `src/main/services/discrepancy.ts`
- Test: `src/main/services/discrepancy.test.ts` (append)

**Interfaces:**
- Consumes, from Task 1: `UnmatchedClassId`. From this file, already present: `DiscrepancyInput`, `parseClassTag`.
- Produces, for Task 4: `function collectUnmatchedClassIds(input: DiscrepancyInput): UnmatchedClassId[]`

**Context:** This is the single definition of "needs probing." It reads the same `DiscrepancyInput` the report renders, so the probe set can never drift from what the page shows — the same non-drift discipline S3 established when `getTagHealPlan` reused `loadDiscrepancyInput` + `computeDiscrepancies`.

It must mirror `computeDiscrepancies`'s bucket-A rule exactly: [discrepancy.ts:69-70](../../src/main/services/discrepancy.ts:69) emits an `orphan-tag` row when `parseClassTag` succeeds but the class id maps to no local room. Tags `parseClassTag` rejects — a missing role, an unknown role, an empty class id — never yield a class id and are excluded here too, exactly as they are excluded from the report.

**Import direction runs one way only.** `discrepancy.ts` imports `UnmatchedClassId` from `./tag-prune`; `tag-prune.ts` must never import from `discrepancy.ts`. Both stay pure.

Holders carry the **raw tag strings as read**, not strings rebuilt from the parse. What gets deleted is then provably what was parsed.

- [ ] **Step 1: Write the failing tests**

First **replace** the existing import line at the top of `src/main/services/discrepancy.test.ts` — currently `import { parseClassTag, computeDiscrepancies } from './discrepancy';` — with:

```typescript
import { parseClassTag, computeDiscrepancies, collectUnmatchedClassIds, DiscrepancyInput } from './discrepancy';
```

Do not add a second import statement from the same module. Then append to the same file:

```typescript
describe('collectUnmatchedClassIds', () => {
  const DEAD_A = 'Dead0000000000000001';
  const DEAD_B = 'Dead0000000000000002';
  const LIVE = 'Live0000000000000001';
  const P1 = 'Person00000000000001';
  const P2 = 'Person00000000000002';
  const tag = (classId: string, role = 'student') => `hz-config-class-${classId}-${role}`;

  const person = (id: string, tags: string[]) => ({
    id,
    displayName: `Test Person ${id}`,
    email: `${id}@example.invalid`,
    tags,
  });

  const input = (
    persons: Array<{ id: string; displayName: string; email: string | null; tags: string[] }>,
    rooms: Array<{ id: string; title: string; classId: string | null }> = [],
  ): DiscrepancyInput => ({ rooms, persons, assignments: [], issues: [] });

  it('collects a distinct id with its tag and person counts', () => {
    const out = collectUnmatchedClassIds(
      input([person(P1, [tag(DEAD_A)]), person(P2, [tag(DEAD_A, 'guardian')])]),
    );
    expect(out).toEqual([
      {
        classId: DEAD_A,
        tagCount: 2,
        personCount: 2,
        holders: [
          { personId: P1, tags: [tag(DEAD_A)] },
          { personId: P2, tags: [tag(DEAD_A, 'guardian')] },
        ],
      },
    ]);
  });

  it('excludes a class id that maps to a local room', () => {
    const out = collectUnmatchedClassIds(
      input([person(P1, [tag(LIVE), tag(DEAD_A)])], [
        { id: LIVE, title: 'A Real Room', classId: LIVE },
      ]),
    );
    expect(out.map((u) => u.classId)).toEqual([DEAD_A]);
  });

  it('excludes tags parseClassTag rejects, so they are never probed', () => {
    const out = collectUnmatchedClassIds(
      input([
        person(P1, [
          'hz-config-class--student',        // empty class id
          `hz-config-class-${DEAD_A}`,       // no role
          `hz-config-class-${DEAD_A}-pilot`, // unknown role
          'hz-share-student-somethingelse',  // not a class tag at all
        ]),
      ]),
    );
    expect(out).toEqual([]);
  });

  it('counts a person holding several tags for one id once, with both tags', () => {
    const out = collectUnmatchedClassIds(
      input([person(P1, [tag(DEAD_A), tag(DEAD_A, 'guardian')])]),
    );
    expect(out[0].personCount).toBe(1);
    expect(out[0].tagCount).toBe(2);
    expect(out[0].holders).toEqual([
      { personId: P1, tags: [tag(DEAD_A), tag(DEAD_A, 'guardian')] },
    ]);
  });

  it('carries the raw tag strings through unchanged', () => {
    const raw = tag(DEAD_A, 'companymentor');
    const out = collectUnmatchedClassIds(input([person(P1, [raw])]));
    expect(out[0].holders[0].tags[0]).toBe(raw);
  });

  it('orders the heaviest id first', () => {
    const out = collectUnmatchedClassIds(
      input([
        person(P1, [tag(DEAD_B)]),
        person(P2, [tag(DEAD_A), tag(DEAD_A, 'guardian')]),
      ]),
    );
    expect(out.map((u) => u.classId)).toEqual([DEAD_A, DEAD_B]);
  });

  it('returns nothing when there are no persons', () => {
    expect(collectUnmatchedClassIds(input([]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/services/discrepancy.test.ts`

Expected: FAIL — `collectUnmatchedClassIds is not a function` (or an import error naming it).

- [ ] **Step 3: Write the implementation**

In `src/main/services/discrepancy.ts`, add this import at the very top of the file:

```typescript
import { UnmatchedClassId } from './tag-prune';
```

Then append to the end of the same file:

```typescript
/**
 * Every distinct class id referenced by a breadcrumb tag that maps to no local room, with the
 * tags and the people carrying them.
 *
 * This is the SINGLE definition of "needs probing" (S7). It reads the same DiscrepancyInput the
 * report renders and applies the same rule computeDiscrepancies uses for its orphan-tag bucket
 * A, so the probe set can never drift from what the page shows. Tags parseClassTag rejects yield
 * no class id and are excluded here exactly as they are excluded there.
 *
 * Holders carry the raw tag strings as read, never strings rebuilt from the parse, so what a
 * prune deletes is provably what was parsed.
 */
export function collectUnmatchedClassIds(input: DiscrepancyInput): UnmatchedClassId[] {
  const knownClassIds = new Set<string>();
  for (const r of input.rooms) if (r.classId) knownClassIds.add(r.classId);

  // classId -> personId -> that person's tags for it
  const byClassId = new Map<string, Map<string, string[]>>();
  for (const p of input.persons) {
    for (const tag of p.tags) {
      const parsed = parseClassTag(tag);
      if (!parsed) continue;
      if (knownClassIds.has(parsed.classId)) continue;

      let holders = byClassId.get(parsed.classId);
      if (!holders) {
        holders = new Map<string, string[]>();
        byClassId.set(parsed.classId, holders);
      }
      const existing = holders.get(p.id);
      if (existing) existing.push(tag);
      else holders.set(p.id, [tag]);
    }
  }

  const out: UnmatchedClassId[] = [];
  for (const [classId, holderMap] of byClassId) {
    const holders = [...holderMap].map(([personId, tags]) => ({ personId, tags }));
    out.push({
      classId,
      tagCount: holders.reduce((n, h) => n + h.tags.length, 0),
      personCount: holders.length,
      holders,
    });
  }

  // Heaviest first: the modal reads better when the id carrying most of the weight leads.
  out.sort((a, b) => b.tagCount - a.tagCount || a.classId.localeCompare(b.classId));
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/services/discrepancy.test.ts`

Expected: PASS — every pre-existing test in the file still passing, plus 7 new.

- [ ] **Step 5: Run the full suite and the main typecheck**

Run: `npm test`
Expected: **149 passed** (142 after Task 2 + 7 new), 7 files.

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/discrepancy.ts src/main/services/discrepancy.test.ts
git commit -m "feat(s7): collectUnmatchedClassIds — one definition of what needs probing"
```

---

### Task 4: Checked tag-removal API call and the thin IO layer

**Files:**
- Modify: `src/main/services/hazu-api/api.ts` — add `RemoveTagsResult` and `sendApiRequestRemoveTagsChecked` immediately after the existing `sendApiRequestRemoveTags`
- Create: `src/main/services/tag-prune.service.ts`

**Interfaces:**
- Consumes: `collectUnmatchedClassIds` (Task 3); `buildPrunePlan`, `probeClassIds`, `runTagPrune`, `PruneItem`, `PrunePlan`, `ReadOutcome`, `SkippedId`, `TagPruneDeps` (Tasks 1-2); `loadDiscrepancyInput` and `safeParseTags` from `./discrepancy.service`; `sendApiRequestRead` from `./hazu-api/api`; `getDb` from `../database`.
- Produces, for Task 5:
  - `function planTagPrune(): Promise<PrunePlan>`
  - `function pruneDeadTags(personId: string, items: PruneItem[]): Promise<{ success: boolean; error?: string; deletedTags: string[]; skippedClassIds: SkippedId[] }>`

**Context:** This is the only task that touches IO, and it has **no unit test** — it needs the native SQLite module and a live API. Its gate is the typecheck, the unchanged suite, and a successful build. That is the same arrangement `orphan-removal.service.ts` shipped under.

Three details the code depends on, all verified rather than assumed:

- **`sendApiRequestRead` returns `{ snapshot: { … } }`.** Confirmed live on 2026-08-16: the top level has exactly one key. The snapshot carries `title`, `parentId`, and `tags`. The function has zero other callers, so nothing else in the codebase documents this.
- **`sendApiRequestRead` rethrows** ([api.ts:16](../../src/main/services/hazu-api/api.ts:16)), so the classification into `{ ok, status, networkOrTimeout }` happens here, in the same shape [`sendApiRequestRemoveUserChecked`](../../src/main/services/hazu-api/api.ts:394) uses.
- **The tag endpoints authenticate with a literal `x-api-key` header**, not `getAuthHeaders()`. See deviation 2 in the header of this plan.

- [ ] **Step 1: Add the checked tag-removal call**

In `src/main/services/hazu-api/api.ts`, immediately **after** the existing `sendApiRequestRemoveTags` function, add:

```typescript
export interface RemoveTagsResult {
  ok: boolean;
  status?: number;
  networkOrTimeout: boolean;
  error?: string;
}

// Checked variant of sendApiRequestRemoveTags: the same DELETE, but it classifies its own
// failure (real HTTP status vs. network/timeout) instead of swallowing it, so a caller's retry
// predicate can tell a doomed 4xx from a worth-retrying 5xx. The original swallow-and-void
// sendApiRequestRemoveTags is left unchanged, matching how AddTagsChecked (S3) and
// RemoveUserChecked (S6) were introduced.
//
// Authenticates with the literal x-api-key header rather than getAuthHeaders(), matching every
// other tag endpoint in this file — getAuthHeaders() switches to a `token` header for short
// keys, and no tag endpoint has ever been exercised that way.
export const sendApiRequestRemoveTagsChecked = async (
  itemId: string,
  tags: string[]
): Promise<RemoveTagsResult> => {
  try {
    await axios({
      method: "DELETE",
      url: `https://${getApiEndpoint()}/api-v2-items/${itemId}/tags`,
      headers: {
        "x-api-key": getApiKey(),
        "Content-Type": "application/json",
      },
      data: { tags },
    });
    return { ok: true, networkOrTimeout: false };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const networkOrTimeout =
        !error.response || error.code === "ECONNABORTED" || error.code === "ETIMEDOUT";
      console.error(
        "Error removing tags from item:", itemId,
        "status=", status, "code=", error.code,
        (error.response?.data as any) ?? error.message,
      );
      return {
        ok: false,
        status,
        networkOrTimeout,
        error: (error.response?.data as any)?.message || error.message,
      };
    }
    console.error("Unexpected error removing tags from item:", itemId, error);
    return {
      ok: false,
      networkOrTimeout: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
```

- [ ] **Step 2: Create the thin IO layer**

Create `src/main/services/tag-prune.service.ts`:

```typescript
import axios from 'axios';
import { getDb } from '../database';
import { sendApiRequestRead, sendApiRequestRemoveTagsChecked } from './hazu-api/api';
import { collectUnmatchedClassIds } from './discrepancy';
import { loadDiscrepancyInput, safeParseTags } from './discrepancy.service';
import {
  buildPrunePlan,
  probeClassIds,
  runTagPrune,
  PruneItem,
  PrunePlan,
  ReadOutcome,
  SkippedId,
  TagPruneDeps,
} from './tag-prune';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Read one item, classifying the failure so the pure core's retry predicate can work.
// sendApiRequestRead rethrows, so the classification happens here. The response body is
// { snapshot: { ... } } — verified live; the function has no other caller in the codebase.
async function readItem(classId: string): Promise<ReadOutcome> {
  try {
    const data = await sendApiRequestRead(classId);
    const snapshot = data?.snapshot ?? {};
    return {
      ok: true,
      networkOrTimeout: false,
      snapshot: { title: snapshot.title, parentId: snapshot.parentId },
    };
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      return {
        ok: false,
        status: error.response?.status,
        networkOrTimeout:
          !error.response || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT',
      };
    }
    return { ok: false, networkOrTimeout: false };
  }
}

// A profile's tags as Hazu currently has them, or null if they could not be read. null means
// "cannot verify" and is never treated as "the tags are gone".
async function readPersonTags(personId: string): Promise<string[] | null> {
  try {
    const data = await sendApiRequestRead(personId);
    const tags = data?.snapshot?.tags;
    return Array.isArray(tags) ? tags.filter((t: unknown): t is string => typeof t === 'string') : [];
  } catch {
    return null;
  }
}

/**
 * What would be pruned. Probes every unmatched class id live, so the confirmation modal reports
 * the state of Hazu now rather than a cached guess.
 *
 * Unlike S6's planOrphanRemoval, this does NOT throw when a read fails. That is deliberate: S6's
 * plan enumerates what will be destroyed, so an unreadable ACL means the modal might
 * under-promise. Here an unreadable id only ever REMOVES work from the delete set, so one flaky
 * read must not block pruning every other confirmed-dead room. It is reported as a skip instead.
 * Only a failure to load the discrepancy input propagates.
 */
export async function planTagPrune(): Promise<PrunePlan> {
  const ids = collectUnmatchedClassIds(loadDiscrepancyInput());
  const verdicts = await probeClassIds(ids.map((i) => i.classId), { readItem, sleep });
  const plan = buildPrunePlan(ids, verdicts);

  console.log(
    `[tag-prune] plan: ${ids.length} id(s) probed — ${plan.tagCount} tag(s) across ` +
    `${plan.personCount} person(s) in ${plan.roomCount} room(s) to delete, ` +
    `${plan.skipped.length} skipped`,
  );

  return plan;
}

/**
 * Delete one person's dead breadcrumb tags, then confirm it against a fresh profile read.
 * The core re-probes this person's own class ids first — the plan the operator confirmed
 * authorises nothing.
 */
export async function pruneDeadTags(
  personId: string,
  items: PruneItem[],
): Promise<{ success: boolean; error?: string; deletedTags: string[]; skippedClassIds: SkippedId[] }> {
  const deps: TagPruneDeps = {
    probe: readItem,
    removeTags: (id, tags) => sendApiRequestRemoveTagsChecked(id, tags),
    readPersonTags,
    sleep,
  };

  const outcome = await runTagPrune({ personId, items }, deps);

  console.log(
    `[tag-prune] person=${personId}: success=${outcome.success} ` +
    `deleted=${outcome.deletedTags.length} skipped=${outcome.skippedClassIds.length} ` +
    `deleteOk=${outcome.deleteOk} verifyRan=${outcome.verifyRan} verified=${outcome.verified} ` +
    `surviving=[${outcome.surviving.join(',')}] attempts=${outcome.attempts}` +
    (outcome.error ? ` error=${outcome.error}` : ''),
  );

  // Reconcile local persons.tags from truth — only the tags confirmed gone are dropped.
  // Its own try/catch so a SQLite failure cannot flip a real API success.
  if (outcome.deletedTags.length > 0) {
    try {
      const db = getDb();
      const row = db.prepare('SELECT tags FROM persons WHERE id = ?').get(personId) as
        | { tags: string | null }
        | undefined;
      if (row) {
        const gone = new Set(outcome.deletedTags);
        const kept = safeParseTags(row.tags).filter((t) => !gone.has(t));
        db.prepare('UPDATE persons SET tags = ? WHERE id = ?').run(JSON.stringify(kept), personId);
      }
    } catch (err) {
      console.error('[tag-prune] local reconcile failed for', personId, err);
    }
  }

  return {
    success: outcome.success,
    error: outcome.error,
    deletedTags: outcome.deletedTags,
    skippedClassIds: outcome.skippedClassIds,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: no output (0 errors).

- [ ] **Step 4: Confirm the suite is untouched**

Run: `npm test`
Expected: **149 passed**, 7 files — this task adds no tests and must break none.

- [ ] **Step 5: Verify the invariants that have no unit test**

```bash
grep -c "getAuthHeaders" src/main/services/hazu-api/api.ts
```
Note the number. Then confirm `sendApiRequestRemoveTagsChecked` is **not** among its callers:

```bash
grep -n "sendApiRequestRemoveTagsChecked" -A 12 src/main/services/hazu-api/api.ts | grep -n "x-api-key\|getAuthHeaders"
```
Expected: an `x-api-key` hit, and **no** `getAuthHeaders` hit.

```bash
grep -n "from './discrepancy'" src/main/services/tag-prune.ts
```
Expected: **no output.** The pure core must never import the report module — the dependency runs one way only.

```bash
grep -rn "sendApiRequestRemoveTags\b" src/ | grep -v "RemoveTagsChecked"
```
Expected: only the original definition in `api.ts`. The swallowing original stays and gains no callers.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/hazu-api/api.ts src/main/services/tag-prune.service.ts
git commit -m "feat(s7): checked tag-removal call and the thin IO layer for pruning"
```

---

### Task 5: IPC channels, handlers, and preload

**Files:**
- Modify: `src/shared/ipc-channels.ts` — add two constants after `ORPHAN_ACCESS_REVOKE`
- Modify: `src/main/ipc/index.ts` — add two handlers after the `ORPHAN_ACCESS_REVOKE` handler, and extend the import from `../services/tag-prune.service`
- Modify: `src/main/preload.ts` — add the same two constants to **its own copy** of `IPC_CHANNELS`, two methods, and two `Window` type entries

**Interfaces:**
- Consumes, from Task 4: `planTagPrune()`, `pruneDeadTags(personId, items)`.
- Produces, for Tasks 6 and 8: `window.electronAPI.planTagPrune()` and `window.electronAPI.pruneDeadTags(personId, items)`.

**Context:** `preload.ts` keeps its **own duplicate copy** of the `IPC_CHANNELS` object (around line 40) — it does not import from `src/shared/ipc-channels.ts`. Both files need the new constants, with identical string values, or the invoke silently targets a channel nobody handles.

The two handlers differ in their error contract, and the difference is load-bearing. **Plan rethrows**, so the page can surface a real failure in its action-error banner rather than opening a modal over an empty plan. **Execute catches and returns `{ success: false, error }`**, because it runs inside a Task Queue task that renders the error on the task row. Both match the S6 handlers exactly ([ipc/index.ts:159](../../src/main/ipc/index.ts:159) and [:171](../../src/main/ipc/index.ts:171)).

- [ ] **Step 1: Add the shared channel constants**

In `src/shared/ipc-channels.ts`, immediately after the line `ORPHAN_ACCESS_REVOKE: 'orphanAccess:revoke',`, add:

```typescript
  // Dead-tag pruning (S7)
  TAG_PRUNE_PLAN: 'tagPrune:plan',
  TAG_PRUNE_EXECUTE: 'tagPrune:execute',
```

- [ ] **Step 2: Add the handlers**

In `src/main/ipc/index.ts`, add to the existing imports:

```typescript
import { planTagPrune, pruneDeadTags } from '../services/tag-prune.service';
import { PruneItem } from '../services/tag-prune';
```

Then immediately **after** the closing `);` of the `IPC_CHANNELS.ORPHAN_ACCESS_REVOKE` handler, add:

```typescript
  // Plan rethrows: a failure to build the plan must reach the page's error banner rather
  // than opening a confirmation modal over an empty plan.
  ipcMain.handle(IPC_CHANNELS.TAG_PRUNE_PLAN, async () => {
    try {
      return await planTagPrune();
    } catch (error) {
      console.error('Tag prune plan error:', error);
      throw error;
    }
  });

  // Execute returns its failure: this runs inside a Task Queue task, which renders the
  // error on the task row and offers a retry.
  ipcMain.handle(
    IPC_CHANNELS.TAG_PRUNE_EXECUTE,
    async (_event, personId: string, items: PruneItem[]) => {
      try {
        return await pruneDeadTags(personId, items);
      } catch (error) {
        console.error('Tag prune execute error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          deletedTags: [],
          skippedClassIds: [],
        };
      }
    },
  );
```

- [ ] **Step 3: Add the preload constants, methods, and types**

In `src/main/preload.ts`:

**(a)** In its own `IPC_CHANNELS` object, immediately after `ORPHAN_ACCESS_REVOKE: 'orphanAccess:revoke',`, add:

```typescript
  TAG_PRUNE_PLAN: 'tagPrune:plan',
  TAG_PRUNE_EXECUTE: 'tagPrune:execute',
```

**(b)** In the `contextBridge.exposeInMainWorld('electronAPI', { … })` object, immediately after the `revokeOrphanAccess` method, add:

```typescript
  // Dead-tag pruning (S7)
  planTagPrune: () =>
    ipcRenderer.invoke(IPC_CHANNELS.TAG_PRUNE_PLAN),
  pruneDeadTags: (personId: string, items: Array<{ classId: string; tags: string[] }>) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAG_PRUNE_EXECUTE, personId, items),
```

**(c)** In the `Window` interface, immediately after the `revokeOrphanAccess` type entry, add:

```typescript
      planTagPrune: () => Promise<{
        deletions: Array<{ personId: string; items: Array<{ classId: string; tags: string[] }> }>;
        skipped: Array<{
          classId: string;
          verdict: 'alive' | 'unreadable';
          reason: string;
          title: string | null;
          parentId: string | null;
          tagCount: number;
        }>;
        tagCount: number;
        personCount: number;
        roomCount: number;
      }>;
      pruneDeadTags: (
        personId: string,
        items: Array<{ classId: string; tags: string[] }>,
      ) => Promise<{
        success: boolean;
        error?: string;
        deletedTags: string[];
        skippedClassIds: Array<{
          classId: string;
          verdict: 'alive' | 'unreadable';
          reason: string;
          title: string | null;
          parentId: string | null;
          tagCount: number;
        }>;
      }>;
```

- [ ] **Step 4: Typecheck both projects**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: no output.

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep -c "error TS"`
Expected: **9** — the pre-existing renderer baseline. Not 0, and not more than 9.

- [ ] **Step 5: Verify the two channel copies agree**

```bash
grep -n "tagPrune:" src/shared/ipc-channels.ts src/main/preload.ts
```
Expected: **four** lines — two in each file, with identical string values. A mismatch here fails silently at runtime.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`
Expected: **149 passed**, 7 files.

```bash
git add src/shared/ipc-channels.ts src/main/ipc/index.ts src/main/preload.ts
git commit -m "feat(s7): IPC channels for the prune plan and execution"
```

---

### Task 6: `pruneDeadTags` Task Queue type

**Files:**
- Modify: `src/renderer/contexts/TaskQueueContext.tsx`
- Modify: `src/renderer/components/TaskQueuePanel.tsx`

**Interfaces:**
- Consumes, from Task 5: `window.electronAPI.pruneDeadTags(personId, items)`.
- Produces, for Task 8: `addPruneTagsTask(task: { personId: string; items: Array<{ classId: string; tags: string[] }>; displayName: string | null; tagCount: number }): string` on the `useTaskQueue()` context.

**Context:** This mirrors the `revokeOrphanAccess` type added in S6 exactly. Five edits in `TaskQueueContext.tsx` and one in `TaskQueuePanel.tsx`.

**The `getLabel()` case is not optional and the compiler will not catch it.** `getLabel` switches over `task.type` with no `default` and no exhaustiveness assertion, so a missing case returns `undefined` and the task row renders blank. This is the standing follow-up recorded after S6; adding a sixth task type is exactly when it bites.

- [ ] **Step 1: Extend the task union**

In `src/renderer/contexts/TaskQueueContext.tsx`:

**(a)** Extend `TaskType`:

```typescript
export type TaskType = 'roleUpdate' | 'createRoom' | 'createPerson' | 'healTag' | 'revokeOrphanAccess' | 'pruneDeadTags';
```

**(b)** After the `RevokeOrphanAccessTask` interface, add:

```typescript
export interface PruneDeadTagsTask extends BaseTask {
  type: 'pruneDeadTags';
  personId: string;
  items: Array<{ classId: string; tags: string[] }>;
  displayName: string | null;
  tagCount: number;
}
```

**(c)** Extend the `Task` union:

```typescript
export type Task = RoleUpdateTask | CreateRoomTask | CreatePersonTask | HealTagTask | RevokeOrphanAccessTask | PruneDeadTagsTask;
```

**(d)** After `type AddRevokeAccessInput = …`, add:

```typescript
type AddPruneTagsInput = Omit<PruneDeadTagsTask, 'id' | 'status' | 'type'>;
```

**(e)** In `interface TaskQueueContextType`, after `addRevokeAccessTask`, add:

```typescript
  addPruneTagsTask: (task: AddPruneTagsInput) => string;
```

- [ ] **Step 2: Handle the task in the queue processor**

In `processQueue`, immediately after the `else if (nextTask.type === 'revokeOrphanAccess') { … }` block, add:

```typescript
      } else if (nextTask.type === 'pruneDeadTags') {
        const task = nextTask as PruneDeadTagsTask;
        const result = await window.electronAPI.pruneDeadTags(task.personId, task.items);

        if (result.success) {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'success' as const } : t))
          );
        } else {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'error' as const, error: result.error } : t))
          );
        }
```

- [ ] **Step 3: Add the enqueue function and expose it**

After the `addRevokeAccessTask` definition, add:

```typescript
  // Add prune-dead-tags task (S7)
  const addPruneTagsTask = useCallback((taskData: AddPruneTagsInput) => {
    const id = `prune-${Date.now()}-${++taskIdCounter.current}`;
    const task: PruneDeadTagsTask = { ...taskData, id, type: 'pruneDeadTags', status: 'queued' };
    setTasks((prev) => [...prev, task]);
    return id;
  }, []);
```

Then add `addPruneTagsTask,` to the provider's `value={{ … }}` object, immediately after `addRevokeAccessTask,`.

- [ ] **Step 4: Add the panel label**

In `src/renderer/components/TaskQueuePanel.tsx`, inside `getLabel`'s switch, immediately after the `case 'revokeOrphanAccess':` return, add:

```typescript
      case 'pruneDeadTags':
        return `Prune ${task.tagCount} tag(s): ${task.displayName || task.personId}`;
```

- [ ] **Step 5: Typecheck and verify the label case exists**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep -c "error TS"`
Expected: **9** — unchanged.

```bash
grep -c "pruneDeadTags" src/renderer/components/TaskQueuePanel.tsx
```
Expected: **1** or more. Zero means the task row would render blank, and no compiler error would have told you.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`
Expected: **149 passed**, 7 files.

```bash
git add src/renderer/contexts/TaskQueueContext.tsx src/renderer/components/TaskQueuePanel.tsx
git commit -m "feat(s7): pruneDeadTags task type in the Task Queue"
```

---

### Task 7: The confirmation modal

**Files:**
- Create: `src/renderer/components/PruneTagsConfirmationModal.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime — the props are declared locally so the component stays presentational.
- Produces, for Task 8:
  ```typescript
  export function PruneTagsConfirmationModal(props: {
    isOpen: boolean;
    tagCount: number;
    personCount: number;
    roomCount: number;
    rooms: Array<{ classId: string; tagCount: number }>;
    skipped: Array<{
      classId: string;
      verdict: 'alive' | 'unreadable';
      reason: string;
      title: string | null;
      parentId: string | null;
      tagCount: number;
    }>;
    onConfirm: () => void;
    onClose: () => void;
  }): JSX.Element | null;
  ```

**Context:** Model this on [RevokeAccessConfirmationModal.tsx](../../src/renderer/components/RevokeAccessConfirmationModal.tsx) — same overlay classes, same header layout, same close button including its `aria-label="Close"` and SVG path, same footer button styling. Keeping them visually identical is the point; this is the app's second destructive-confirmation dialog and it should not look like a different app.

Purely presentational: no state, no effects, no API calls. It renders what it is handed.

Two behaviours worth stating because they are easy to get backwards:

- **A non-empty skip list does not block confirming.** A skip is information — an `alive` id means a room the sync missed, which the operator should see but which has no bearing on deleting the *other* rooms' dead tags.
- **The confirm button IS disabled at `tagCount === 0`.** With nothing to delete, confirming would enqueue nothing and read as a no-op. (This differs from `RevokeAccessConfirmationModal`, where confirming with zero grants still usefully clears the row.)

- [ ] **Step 1: Write the component**

Create `src/renderer/components/PruneTagsConfirmationModal.tsx`:

```tsx
import React from 'react';

interface SkippedId {
  classId: string;
  verdict: 'alive' | 'unreadable';
  reason: string;
  title: string | null;
  parentId: string | null;
  tagCount: number;
}

interface PruneTagsConfirmationModalProps {
  isOpen: boolean;
  tagCount: number;
  personCount: number;
  roomCount: number;
  rooms: Array<{ classId: string; tagCount: number }>;
  skipped: SkippedId[];
  onConfirm: () => void;
  onClose: () => void;
}

const VERDICT_LABEL: Record<SkippedId['verdict'], string> = {
  alive: 'Still exists',
  unreadable: 'Could not read',
};

export function PruneTagsConfirmationModal({
  isOpen,
  tagCount,
  personCount,
  roomCount,
  rooms,
  skipped,
  onConfirm,
  onClose,
}: PruneTagsConfirmationModalProps) {
  if (!isOpen) return null;

  const nothingToDelete = tagCount === 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Delete tags for missing rooms?</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {nothingToDelete ? (
            <p className="text-sm text-gray-700">
              Nothing to delete. No unmatched class id came back as deleted from Hazu.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-700 leading-relaxed">
                This permanently deletes <strong>{tagCount}</strong> breadcrumb tag
                {tagCount === 1 ? '' : 's'} from <strong>{personCount}</strong> profile
                {personCount === 1 ? '' : 's'}, across <strong>{roomCount}</strong> room
                {roomCount === 1 ? '' : 's'} that Hazu returned <strong>404</strong> for.
                This cannot be undone.
              </p>

              <ul className="text-sm text-gray-700 border border-gray-200 rounded divide-y divide-gray-100">
                {rooms.map((r) => (
                  <li key={r.classId} className="px-3 py-2 flex justify-between gap-3">
                    <span className="font-mono text-xs text-gray-600 truncate">{r.classId}</span>
                    <span className="text-gray-500 whitespace-nowrap">
                      {r.tagCount} tag{r.tagCount === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="text-sm text-gray-500">
                Each id is checked against Hazu again at the moment of deletion. Anything that
                answers differently by then is left alone, and every removal is verified against
                the profile afterwards.
              </p>
            </>
          )}

          {skipped.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-900">
                Skipped ({skipped.length})
              </h3>
              <ul className="text-sm border border-amber-200 bg-amber-50 rounded divide-y divide-amber-100">
                {skipped.map((s) => (
                  <li key={s.classId} className="px-3 py-2 space-y-0.5">
                    <div className="flex justify-between gap-3">
                      <span className="font-mono text-xs text-gray-700 truncate">
                        {s.title || s.classId}
                      </span>
                      <span className="text-amber-800 whitespace-nowrap">
                        {VERDICT_LABEL[s.verdict]}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600">{s.reason}</div>
                    {s.parentId && (
                      <div className="text-xs text-gray-500">
                        Parent: <span className="font-mono">{s.parentId}</span> — the sync did not
                        import this room.
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-6 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={nothingToDelete}
            className={`px-4 py-2 text-sm rounded ${
              nothingToDelete
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-red-600 text-white hover:bg-red-700'
            }`}
          >
            Delete {tagCount} tag{tagCount === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep -c "error TS"`
Expected: **9** — unchanged.

- [ ] **Step 3: Confirm it is a named export, matching its siblings**

```bash
grep -n "^export function PruneTagsConfirmationModal" src/renderer/components/PruneTagsConfirmationModal.tsx
```
Expected: one hit. Task 8 imports it by name, as `DiscrepanciesPage` already does for `HealConfirmationModal` and `RevokeAccessConfirmationModal`.

- [ ] **Step 4: Run the suite and commit**

Run: `npm test`
Expected: **149 passed**, 7 files.

```bash
git add src/renderer/components/PruneTagsConfirmationModal.tsx
git commit -m "feat(s7): confirmation modal for dead-tag pruning"
```

---

### Task 8: Wire the button into the Discrepancies page

**Files:**
- Modify: `src/renderer/pages/DiscrepanciesPage.tsx`

**Interfaces:**
- Consumes: `window.electronAPI.planTagPrune()` (Task 5), `addPruneTagsTask` from `useTaskQueue()` (Task 6), `PruneTagsConfirmationModal` (Task 7).
- Produces: nothing. This is the last task.

**Context:** The page already runs two flows through one shared settle-tracker. This task adds a third, and **fixes that tracker as part of the change** — see below.

The button counts **distinct unmatched class ids**, which the page does not currently know: it has `Discrepancy` rows, and bucket-A rows carry the class id in `roomId` ([discrepancy.ts:74](../../src/main/services/discrepancy.ts:74) — for bucket-A rows alone, `roomId` holds a *class* id rather than a room id). Deriving the count from the rows keeps the button honest without a second IPC call. Bucket-A rows are exactly the `orphan-tag` rows whose `note` is set — `computeDiscrepancies` attaches that note only there ([discrepancy.ts:79](../../src/main/services/discrepancy.ts:79)).

**In-scope repair: per-flow settle tracking.** `enqueuedRef` is a single `Set` shared by every flow, and `confirmRevoke` **overwrites** it (`enqueuedRef.current = new Set([id])`), discarding any heal ids still in flight. The S6 review flagged this and left it open as a human decision; adding a third writer makes it strictly worse, and the fix is small. Replace the single `Set` with a **union** so each flow adds its ids without clobbering the others, and `watching` clears only when *everything* enqueued has settled. This is a deliberate repair of code this task is already modifying, not scope creep — but a reviewer should see it named.

- [ ] **Step 1: Add the imports and state**

In `src/renderer/pages/DiscrepanciesPage.tsx`:

**(a)** Add to the imports at the top:

```typescript
import { PruneTagsConfirmationModal } from '../components/PruneTagsConfirmationModal';
```

**(b)** Add the plan types, after the existing `HealPlan` interface:

```typescript
interface PruneSkippedId {
  classId: string;
  verdict: 'alive' | 'unreadable';
  reason: string;
  title: string | null;
  parentId: string | null;
  tagCount: number;
}

interface PrunePlan {
  deletions: Array<{ personId: string; items: Array<{ classId: string; tags: string[] }> }>;
  skipped: PruneSkippedId[];
  tagCount: number;
  personCount: number;
  roomCount: number;
}
```

**(c)** Pull `addPruneTagsTask` from the context:

```typescript
  const { tasks, addHealTagTask, addRevokeAccessTask, addPruneTagsTask } = useTaskQueue();
```

**(d)** Add state, next to `healPlan` and `revokeTarget`:

```typescript
  const [prunePlan, setPrunePlan] = useState<PrunePlan | null>(null);
  const [probing, setProbing] = useState(false);
```

- [ ] **Step 2: Fix the shared settle-tracker so flows stop clobbering each other**

**Order matters here.** `confirmHeal` and `confirmRevoke` will list `watchIds` in their `useCallback` dependency arrays, and those arrays are evaluated during render — so `watchIds` must be **declared above both of them** in source order or it hits the temporal dead zone and throws on first render.

So first, insert `watchIds` immediately **above** the existing `confirmHeal`:

```typescript
  // Track enqueued ids as a UNION across flows. Previously each flow overwrote a single Set,
  // so confirming one flow while another was still in flight discarded the other's ids: the
  // settle effect stopped watching them, refetched early, and left the page stale until the
  // next batch. Three flows now share this tracker, so it has to accumulate.
  const watchIds = useCallback((ids: Set<string>) => {
    if (ids.size === 0) return;
    const merged = new Set(enqueuedRef.current);
    for (const id of ids) merged.add(id);
    enqueuedRef.current = merged;
    setWatching(true);
  }, []);
```

Then replace the body of `confirmHeal`:

```typescript
  const confirmHeal = useCallback(() => {
    if (!healPlan) return;
    const ids = new Set<string>();
    for (const it of healPlan.items) {
      const id = addHealTagTask({ personId: it.personId, tag: it.tag, displayName: it.displayName });
      ids.add(id);
    }
    watchIds(ids);
    setHealPlan(null);
  }, [healPlan, addHealTagTask, watchIds]);
```

Replace the tail of `confirmRevoke` (the two lines `enqueuedRef.current = new Set([id]);` and `setWatching(true);`) with:

```typescript
    watchIds(new Set([id]));
```

so the callback ends:

```typescript
    watchIds(new Set([id]));
    setRevokeTarget(null);
  }, [revokeTarget, addRevokeAccessTask, watchIds]);
```

Leave the settle effect itself unchanged — it already clears `enqueuedRef.current` back to an empty Set once nothing it is watching is in flight, which is the correct behaviour for a union too.

- [ ] **Step 3: Add the plan and confirm handlers**

After `confirmRevoke`, add:

```typescript
  const openPrune = useCallback(async () => {
    setActionError(null);
    setProbing(true);
    try {
      const plan = await window.electronAPI.planTagPrune();
      if (mountedRef.current) setPrunePlan(plan as PrunePlan);
    } catch (e) {
      if (mountedRef.current) setActionError(String((e as any)?.message || e));
    } finally {
      if (mountedRef.current) setProbing(false);
    }
  }, []);

  const confirmPrune = useCallback(() => {
    if (!prunePlan) return;
    const ids = new Set<string>();
    for (const d of prunePlan.deletions) {
      const person = (items ?? []).find((r) => r.personId === d.personId);
      const id = addPruneTagsTask({
        personId: d.personId,
        items: d.items,
        displayName: person?.displayName ?? null,
        tagCount: d.items.reduce((n, i) => n + i.tags.length, 0),
      });
      ids.add(id);
    }
    watchIds(ids);
    setPrunePlan(null);
  }, [prunePlan, items, addPruneTagsTask, watchIds]);
```

- [ ] **Step 4: Add the button and derive its count**

Add this `useMemo` next to the existing `counts` memo:

```typescript
  // Distinct class ids behind bucket-A orphan tags. For those rows alone, `roomId` holds a
  // CLASS id rather than a room id, and computeDiscrepancies attaches a note only to them.
  const unmatchedClassIdCount = useMemo(() => {
    const ids = new Set<string>();
    for (const d of items || []) {
      if (d.type === 'orphan-tag' && d.note) ids.add(d.roomId);
    }
    return ids.size;
  }, [items]);
```

Then, in the header, replace the single heal button with both buttons wrapped in a flex row. Note one deliberate copy change: the heal button's busy label goes from `Healing…` to `Working…`, because `watching` is now shared by three flows and would otherwise claim a prune batch was healing.

```tsx
        <div className="flex gap-2">
          <button
            onClick={openHeal}
            disabled={missingCount === 0 || watching || probing}
            className={`px-3 py-1.5 rounded text-sm whitespace-nowrap ${
              missingCount === 0 || watching || probing
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {watching ? 'Working…' : `Heal all missing-tags (${missingCount})`}
          </button>
          <button
            onClick={openPrune}
            disabled={unmatchedClassIdCount === 0 || watching || probing}
            className={`px-3 py-1.5 rounded text-sm whitespace-nowrap ${
              unmatchedClassIdCount === 0 || watching || probing
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-red-600 text-white hover:bg-red-700'
            }`}
          >
            {probing ? 'Checking rooms…' : `Check & prune missing rooms (${unmatchedClassIdCount})`}
          </button>
        </div>
```

- [ ] **Step 5: Render the modal**

After the `<RevokeAccessConfirmationModal … />` element, add:

```tsx
      <PruneTagsConfirmationModal
        isOpen={prunePlan !== null}
        tagCount={prunePlan?.tagCount ?? 0}
        personCount={prunePlan?.personCount ?? 0}
        roomCount={prunePlan?.roomCount ?? 0}
        rooms={
          prunePlan
            ? [
                ...prunePlan.deletions
                  .flatMap((d) => d.items)
                  .reduce((m, i) => m.set(i.classId, (m.get(i.classId) ?? 0) + i.tags.length), new Map<string, number>()),
              ].map(([classId, tagCount]) => ({ classId, tagCount }))
            : []
        }
        skipped={prunePlan?.skipped ?? []}
        onConfirm={confirmPrune}
        onClose={() => setPrunePlan(null)}
      />
```

- [ ] **Step 6: Typecheck and verify the wiring invariants**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep -c "error TS"`
Expected: **9** — unchanged.

```bash
grep -n "enqueuedRef.current = " src/renderer/pages/DiscrepanciesPage.tsx
```
Expected: **two** hits — the assignment inside `watchIds`, and the reset to an empty Set inside the settle effect. Any assignment inside `confirmHeal` or `confirmRevoke` means the clobber survived.

```bash
grep -c "window.electronAPI.pruneDeadTags" src/renderer/pages/DiscrepanciesPage.tsx
```
Expected: **0**. Every write goes through the Task Queue; the page must never call the execute channel directly.

- [ ] **Step 7: Full verification**

Run: `npm test`
Expected: **149 passed**, 7 files.

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: no output.

Run: `npm run build`
Expected: completes with no errors.

Run: `python3 scripts/check-no-person-data.py --all`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/pages/DiscrepanciesPage.tsx
git commit -m "feat(s7): check & prune missing rooms button on the Discrepancies page

Adds the third write flow to the page, and fixes the settle-tracker it shares
with the other two. enqueuedRef was a single Set that each flow overwrote, so
confirming one while another was in flight discarded the other's ids: the
effect stopped watching them, refetched early, and left the page stale until
the next batch. It now accumulates a union across flows.

The button counts distinct unmatched class ids, derived from the rows already
on the page rather than a second IPC call — for bucket-A rows alone, roomId
holds a class id rather than a room id."
```

---

## Manual acceptance (user-run, after Task 8)

One run, against live data. Counts measured 2026-08-16; re-check them against the page, since people and rooms change.

1. Sync, open Discrepancies. The button reads `Check & prune missing rooms (15)`.
2. Click it. The modal shows **84 tags across 71 people in 15 rooms**, and **zero skips**. One id should account for 52 of the tags.
3. **Break the API key in Settings and click again.** Every id must be skipped as `Could not read`, the delete count must be **0**, and the confirm button must be disabled. This is the test the whole design exists to pass — if anything is offered for deletion here, stop and do not confirm.
4. Restore the key, click again, confirm the prune. Watch the Task Queue: 71 tasks, each labelled `Prune N tag(s): …`.
5. Once they settle, spot-check one profile in Hazu: its dead tags are gone and every other tag is intact.
6. Re-sync. Bucket A drops from 84 to **0**; 3 unparseable tags remain, being out of scope. **Bucket B is unchanged at 214.** No assignment, group membership, or ACL changed.
7. Click the button again: it reads `(0)` and is disabled.

Read-only queries for steps 1, 6 and 7:

```bash
sqlite3 -readonly ~/Library/Application\ Support/hazu-admin/hazu-admin.db "SELECT COUNT(*) FROM person_room_assignments; SELECT COUNT(*) FROM rooms;"
```
