# S7 — Dead-Tag Pruning: Design Spec

**Date:** 2026-08-12 · **Revised:** 2026-08-16 (collapsed from two stages to one — see [Revision](#revision-2026-08-16--why-this-collapsed-to-one-stage))
**Status:** Approved (brainstorming) — ready for an implementation plan
**Series:** Matrix group-truth rebuild — **S7**, after S1→S2→S3→S4→S6→S8 (S5 tag cleanup closed as noise; this spec reopens part of it on new evidence)

**Goal:** Delete the breadcrumb tags that point at rooms Hazu no longer has — and only those.

**Architecture:** One button on the Discrepancies page probes every unmatched class id against `GET /read`, and the confirmation modal reports what it found. Confirming enqueues one Task Queue task per person; each task re-probes its own ids before deleting, then verifies the deletion against a fresh profile read. Pure core with all IO injected, thin IO layer, mirroring S4 and S6.

**Tech stack:** Electron main (Node/CommonJS, `tsconfig.main.json`) + better-sqlite3 + axios, vitest.

**Depends on:** S2 (`computeDiscrepancies`, `parseClassTag`, the Discrepancies page), S3 (`buildClassTag`, the Task Queue heal pattern, `sendApiRequestAddTagsChecked` as precedent), S4 (`isRetryableError`, `backoffMs`, verify-against-truth), S6 (re-plan-before-destroy, the confirmation-modal pattern), S8 (which removed this spec's `alive` case at the source).

---

## Revision (2026-08-16) — why this collapsed to one stage

The original spec shipped as two plans. Stage A classified the unmatched class ids and cached the verdicts; Stage B pruned the ones confirmed dead, and was to be built only after Stage A ran against live data. The split existed for one reason: **nobody knew how many unmatched ids named live rooms.** Probing 6 of 46 had found one alive — a real CIE room the sync had never imported — and pruning blind would have destroyed legitimate data and buried a sync bug.

[S8](2026-08-12-s8-sync-depth-recursion-design.md) shipped on 2026-08-16 and fixed that sync bug. It walks the whole room tree, so the rooms that produced every `alive` verdict now import normally.

All 15 remaining ids were then probed. **Fifteen 404s. Zero alive, zero unreadable.** The question the two-stage split existed to answer is answered, so the staging goes, and with it the apparatus built to carry verdicts across the gap between two shipped stages: the `room_existence` table, the summary panel, the `existence` field on `Discrepancy`, and the annotation pass in `discrepancy.service.ts`.

**The safety rules do not go.** Only a 404 authorises a deletion; 401 must never arm a prune; every id is re-probed at the moment of deletion. The `alive` and `unreadable` verdicts stay in the code and stay tested, precisely because there is no live instance of either today — the depth cap S8 introduced means a room nested past level 4 would surface exactly this way, and that finding must not be silently pruned.

---

## The problem

A person's profile carries breadcrumb tags of the form `hz-config-class-<classId>-<role>`. S2's report calls a tag `orphan-tag` when it matches no group membership, and [discrepancy.ts:71](../../src/main/services/discrepancy.ts:71) emits a row noting *"tag references a class not in local rooms"* whenever the class id matches no local room at all.

That note is honest, and it is not the same claim as *"this room no longer exists."* The report is computed entirely offline. Nothing in the app has ever asked Hazu whether these rooms are still there.

### Measured census (live DB, 2026-08-16, after the first post-S8 sync)

| bucket | tags | people | notes |
|---|---|---|---|
| legit — tag matches a group membership | 1049 | — | |
| **A — class id names no local room** | **84** | **71** | **15 distinct class ids** |
| B — room exists locally, person not in the group | 214 | — | out of scope |
| unparseable | 3 | — | never yields a class id |
| total `hz-config-class-*` tags | 1350 | | |

**Bucket A is this spec's subject, and all of it is deletable.** Every one of the 15 ids returned 404:

| class id | tags | class id | tags |
|---|---|---|---|
| `zPvpnE0KVhQw0jNtde2M` | 52 | `TRMZhzy89idLAlLmfbZZ` | 2 |
| `5U10RLT12A2Nhmq8Rh0s` | 6 | `GgJcJMa6N8bvSPch6hxI` | 2 |
| `w76UTdjrHqt9g41fbuwY` | 4 | `rj2iHkfM49uLsyXcPu9I` | 1 |
| `fcXPwizRhyekvNpShx3d` | 4 | `lL8ci5WuZOko6VMDyBSe` | 1 |
| `0cr13kalhPFvxhZ0UCfN` | 3 | `c0s4RK5z2kadamwTwmMA` | 1 |
| `nm24qM7nmyXXNKU8nvvv` | 2 | `LLxsxnHC6LNTehQGjUPn` | 1 |
| `jcUPgahl0z96jSMFQybT` | 2 | `KSdCQkkvSebTyghGkO3B` | 1 |
| `haK5MeLoOSCGxVPXqzYp` | 2 | | |

One id carries 52 of the 84 tags. A complete sweep is 15 API reads.

These counts will drift as people and rooms change. Treat them as the shape of the problem, not as constants: the button and the modal report whatever is true at the time.

### The class id is the room's Hazu key

Verified across the live DB: `class_id = id` for every room that carries a class id (category folders carry none). The id inside a breadcrumb tag is therefore a readable Hazu item key, and `GET /read?id=<classId>` is a direct existence probe.

### The API answers; the public URL does not

Measured on 2026-08-12 against `europe-west6-hazu-ch.cloudfunctions.net/read`:

| id | status | body |
|---|---|---|
| `28t0o8FXAuJc6ZDSrwQJ` (live control) | **200** | full snapshot |
| `0dQJCWrIOAl56pT9aG5X` | **200** | full snapshot |
| `zPvpnE0KVhQw0jNtde2M` | **404** | `Item with id … not found!` |
| `thisIdDoesNotExist99` (fabricated) | **404** | `Item with id … not found!` |

The same four ids fetched as public web URLs (`https://hazu.swiss/<id>`) returned **HTTP 200 for every one**, including the fabricated id. Hazu's front end is a single-page app: the server returns the same ~21 KB shell for any path and resolves "not found" in the browser. The deleted room and the fabricated id came back byte-identical at 21045 bytes. **The public URL carries no existence signal and must never be used as the probe.**

`/read` is also authenticated, so it sees rooms the public web cannot — `0dQJCWrIOAl56pT9aG5X` is `privacy: "unlisted"`, and an unauthenticated probe that hid a *live* room would produce a false `deleted`, the one error direction this spec cannot afford. [`sendApiRequestRead`](../../src/main/services/hazu-api/api.ts:16) already exists and rethrows, so the classifier reads `error.response.status` directly.

### Why `alive` still needs code with no live instance

S8 imported the rooms behind every `alive` verdict, but it caps its walk at depth 4 and records what it skipped. A room nested deeper — or inside a subtree whose listing returns 401, as *Calendrier scolaire*'s entries do — would not import, and its breadcrumbs would land in bucket A looking exactly like a dead room's. **An `alive` result is therefore a sync-gap alarm, not a footnote.** The modal names it as a skip with its reason, and the prune never touches it.

This is also why an `alive` skip carries the room's **`parentId`** alongside its title. Both arrive free in the same snapshot, and the parent is what makes the gap diagnosable: last time, *"its parent is a folder called CIE 2024, which sits under the CIE category the app does sync"* located the bug in one line. A title alone says a room exists; the parent says where the walk lost it.

## Global constraints

- **Only an explicit 404 means `deleted`.** Every other failure — 5xx, network, timeout, 401, 403 — classifies as `unreadable`. An expired API key returns 401 for every id; were 401 to mean `deleted`, one credentials problem would arm the prune against every live tag in the set.
- **Only `deleted` may be pruned.** Never `alive`, never `unreadable`, never a bucket-B tag.
- **Re-probe immediately before deleting.** The plan authorises nothing. A fresh 404, taken inside the task that does the deleting, is the authorisation. Following S6, re-planning can only shrink a delete set, never grow it.
- **Retry only transient failures.** 5xx, network, timeout — never a 4xx, and never a 404.
- **One id's failure never aborts the sweep.** Per-id try/catch, as sync does per group.
- **The probe set is derived from the report, not re-derived.** A single pure helper defines "unmatched class id," so the probe and the page can never disagree about what needs checking.
- **Pure core with injected IO.** Orchestration is vitest-runnable without the native module or the network.
- **Writes go through the Task Queue.** No direct API calls from the renderer.
- **Tags only.** Nothing here touches groups, ACLs, or access. A tag pointing at a deleted room grants nothing in the first place.

### On Principle 2

[matrix-group-truth-rebuild-spec.md:16](../matrix-group-truth-rebuild-spec.md:16) states that the app *"never **auto**-removes tags,"* and its Non-goals ban *"**Auto**-removing tags or auto-changing group membership."* Both guard automatic removal.

This is not automatic. It runs on explicit human confirmation, only over ids Hazu itself returned 404 for, and only after a re-probe at the moment of deletion. That is consistent with the letter of both statements and with S6, whose destructive revoke was permitted on the same basis. **It is nonetheless a deliberate call, recorded here rather than left to be inferred.** Nothing in this spec authorises removing a tag on evidence weaker than a fresh 404.

## Scope

**In scope:** probing the distinct class ids behind bucket A, reporting the result, and deleting the tags whose ids re-confirm as `deleted`.

**Out of scope:**

- **Bucket B** — the 214 tags naming rooms that do exist. Whether a stale-but-valid breadcrumb should be removed is a different judgment on different evidence.
- **The 3 unparseable tags.** They never yield a class id, so there is nothing to probe.
- Auto-pruning during sync, or any prune not gated on a confirmation modal.
- Any change to group membership or ACLs.
- Reconciling `extractClassId` with `parseClassTag`, the standing Minor carried since S2.

---

## Design

### Flow

1. The page loads. `computeDiscrepancies` yields bucket-A rows; the button shows the count of distinct unmatched class ids.
2. Clicking it calls `tagPrune:plan`, which probes each id and returns the plan: the tags to delete, grouped by person, plus every skipped id with its reason.
3. The modal renders the plan.
4. Confirming enqueues **one `pruneDeadTags` task per person**.
5. Each task calls `tagPrune:execute`, which re-probes that person's ids, deletes the confirmed-dead tags in one call, verifies against a fresh profile read, and reconciles local state.
6. When the queue settles, the page refetches.

### Each task re-probes only its own ids

Re-probing the whole set inside every task would cost 15 reads × 71 people. Re-probing only the ids in a task's own payload costs about 84 reads in total, since a person holds tags for 1.2 dead rooms on average.

This keeps S6's re-plan-before-destroy at the finest available grain — a task that runs an hour after you confirmed still cannot delete a tag whose room came back — while preserving per-person retry in the queue. A task's re-plan can only shrink its delete set.

### Pure core — `src/main/services/tag-prune.ts` (new)

```ts
export type RoomVerdict = 'deleted' | 'alive' | 'unreadable';

export interface ReadOutcome {
  ok: boolean;
  status?: number;
  networkOrTimeout: boolean;
  snapshot?: { title?: string; parentId?: string };
}

// One distinct class id referenced by tags that map to no local room, with the weight behind it.
export interface UnmatchedClassId {
  classId: string;
  tagCount: number;
  personCount: number;
  // The tags to remove if this id proves dead, grouped by the person carrying them.
  holders: Array<{ personId: string; tags: string[] }>;
}

export interface SkippedId {
  classId: string;
  verdict: 'alive' | 'unreadable';
  reason: string;        // human-readable, shown in the modal
  title: string | null;      // present when alive
  parentId: string | null;   // present when alive — see below
  tagCount: number;
}

export interface PrunePlan {
  deletions: Array<{ personId: string; classIds: string[]; tags: string[] }>;
  skipped: SkippedId[];
  tagCount: number;
  personCount: number;
  roomCount: number;
}

// What a probe learned about one id. `title` and `parentId` are non-null only when alive.
export interface Verdict {
  verdict: RoomVerdict;
  title: string | null;
  parentId: string | null;
}

// Pure classification of one read. Only a 404 yields 'deleted'.
export function classifyReadResult(res: ReadOutcome): Verdict;

// Verdicts + the unmatched set -> what to delete, and what was skipped and why.
export function buildPrunePlan(ids: UnmatchedClassId[], verdicts: Map<string, Verdict>): PrunePlan;

// Probe, retrying transient failures. Never retries a 404.
export async function probeClassIds(
  ids: readonly string[],
  deps: ProbeDeps,
  config?: ProbeConfig,
): Promise<Map<string, Verdict>>;

// One person's removal: re-probe -> delete -> verify -> report.
export async function runTagPrune(
  target: { personId: string; classIds: string[]; tags: string[] },
  deps: TagPruneDeps,
  config?: TagPruneConfig,
): Promise<TagPruneOutcome>;
```

`ProbeDeps` injects `readItem(classId): Promise<ReadOutcome>` and `sleep`. `TagPruneDeps` adds `removeTags(personId, tags)`, `readPersonTags(personId)`, and `sleep`. `TagPruneOutcome` is `{ success, deleted, skipped, surviving, deleteOk, verifyRan, verified, attempts }`. `isRetryableError(status, networkOrTimeout)` and `backoffMs(attempt)` come from [role-write.ts:80](../../src/main/services/role-write.ts:80) — no third copy of that logic.

### Addition to `discrepancy.ts`

```ts
// Every distinct class id referenced by a breadcrumb tag that maps to no local room,
// with the tags and holders behind it. The single definition of "needs probing" — derived
// from the same DiscrepancyInput the report renders, so the probe set cannot drift from
// the page. Unparseable tags yield no class id and are excluded.
export function collectUnmatchedClassIds(input: DiscrepancyInput): UnmatchedClassId[];
```

This mirrors the non-drift discipline S3 established when `getTagHealPlan` reused `loadDiscrepancyInput` + `computeDiscrepancies`. `UnmatchedClassId` is declared in `tag-prune.ts`, and `discrepancy.ts` imports it — **the dependency runs one way only, and never back.** `Discrepancy` gains no new field.

Tag strings come from `input` as they were read, so what gets deleted is exactly what was parsed. S3's `buildClassTag` is available if a plan ever needs to reconstruct one, but reading the tag through is stronger than rebuilding it.

### Thin IO — `src/main/services/tag-prune.service.ts` (new)

- `planTagPrune(): Promise<PrunePlan>` — loads the discrepancy input, calls `collectUnmatchedClassIds`, probes over `sendApiRequestRead`, returns the plan. Throws only if the input will not load.
- `pruneDeadTags(personId, classIds, tags): Promise<{ success, error?, deletedTags, skippedClassIds }>` — runs the core with real deps, then reconciles local `persons.tags` in its own try/catch.

### `sendApiRequestRemoveTagsChecked`

[`sendApiRequestRemoveTags`](../../src/main/services/hazu-api/api.ts:222) exists, has **zero callers**, and swallows every error into a `console.error` before returning `void`. That is the third instance of this trap: S3 needed `sendApiRequestAddTagsChecked`, S6 needed `sendApiRequestRemoveUserChecked`. This needs the checked variant, classifying failure as `{ ok, status?, networkOrTimeout }` so `isRetryableError` can tell a doomed 4xx from a worth-retrying 5xx. The original stays for its nonexistent callers, consistent with prior practice.

### IPC

| Channel | Direction | Payload |
|---|---|---|
| `tagPrune:plan` | read-only against Hazu | `()` → `PrunePlan` |
| `tagPrune:execute` | write | `(personId, classIds, tags)` → `{ success, error?, deletedTags: string[], skippedClassIds: SkippedId[] }` |

`deletedTags` lists the tag strings this task actually removed and verified gone; `skippedClassIds` lists the ids its own re-probe declined to confirm, so a task that deletes nothing can say why.

### Renderer

- **`DiscrepanciesPage.tsx`** — a `Check & prune missing rooms (N)` button, disabled at `N === 0` and while probing. Clicking calls the plan channel and opens the modal.
- **`PruneTagsConfirmationModal.tsx`** (new) — names the tag, person, and room counts, lists the rooms with their tag counts, and states plainly that this is destructive and irreversible. Below that, every skipped id with its reason; an `alive` skip shows the room's title and `parentId`, since that pair is what turns "this one is still there" into a locatable sync gap. Modelled on `RevokeAccessConfirmationModal`. Confirming is possible with a non-empty skip list — a skip is information, not a blocker — but the confirm button is disabled when there is nothing to delete.
- **`TaskQueueContext.tsx`** — a `pruneDeadTags` task type joins `roleUpdate` / `createRoom` / `createPerson` / `healTag` / `revokeOrphanAccess`.
- **`TaskQueuePanel.tsx`** — a matching `getLabel()` case. The renderer build does not enforce switch exhaustiveness over the task union, so this is a hand check, per the standing S6 note.

No progress counter: 15 reads is roughly twenty seconds, and the polled-progress pattern the Dashboard sync uses is more machinery than the wait justifies.

## Error handling and edge cases

**The plan reports read failures; it does not throw on them.** This diverges from S6 deliberately. S6's `planOrphanRemoval` throws when an ACL cannot be read, because its plan enumerates what will be destroyed and an unreadable ACL means the modal might under-promise. Here the opposite holds: an unreadable id only ever *removes* work from the delete set, so one flaky read must not block pruning fourteen confirmed-dead rooms. The plan throws only if the discrepancy input will not load. **A reviewer comparing the two files should not "fix" this into S6's shape.**

| situation | behaviour |
|---|---|
| Zero unmatched ids | Button disabled. No reads. |
| Every read fails (bad key, offline) | All ids `unreadable`, plan empty, modal offers nothing. This is the 401/403 rule working. |
| Read throws with no response (DNS, socket) | `networkOrTimeout: true` → retried → `unreadable`. |
| Re-probe in a task returns 200 | That id is dropped and named in the result. |
| Re-probe in a task is unreadable | Dropped. Never delete on an unread. |
| Every id in a task drops | Task succeeds, having deleted nothing, and says so. Nothing went wrong. |
| DELETE 2xx, tag survives on re-read | **Failure.** The task shows an error and is retryable. |
| DELETE fails, tag is gone on re-read | **Success**, reconciled locally. Truth outranks the status code in both directions — the measured lesson from S4, where transport failures masked writes that had committed. |
| Verifying profile read fails | Cannot verify: fall back to the DELETE status code, as S4 does. |
| Local `persons.tags` reconcile fails | Isolated try/catch. A SQLite failure cannot flip a real API success. |
| Tag already absent at delete time | Idempotent; verification confirms absence. |
| Person deleted between plan and execute | That task errors. Others are unaffected. |
| Person holds dead tags for several rooms | One task, one DELETE, all their dead tags together. |

## Testing

Pure-core vitest suites with all IO injected, no native module — matching `role-write.test.ts`, `orphan-removal.test.ts`, `room-tree.test.ts`. Fixtures use invented ids and `@example.invalid` addresses, per the person-data rule in CLAUDE.md.

**`classifyReadResult`** — 404 → `deleted`; 200 → `alive` with the title extracted; 500 → `unreadable`; network/timeout → `unreadable`; **401 and 403 → `unreadable`, never `deleted`**; 200 with a malformed snapshot → `alive` with a null title. The 401 case is the one this whole design exists to get right.

**`collectUnmatchedClassIds`** — many tags collapse to distinct ids with correct tag and person counts; unparseable tags excluded; ids that do map to a local room excluded; a person holding several tags for one id counted once in `personCount` and once in `holders`.

**`buildPrunePlan`** — only `deleted` ids produce deletions; `alive` and `unreadable` become skips carrying their reason; deletions group by person; a person with tags for two dead rooms yields one entry listing both; counts match the entries.

**`probeClassIds`** — retries a 500 then succeeds; never retries a 404; one id throwing hard leaves the other verdicts intact.

**`runTagPrune`** — a re-probe returning `alive` drops that id and deletes nothing for it; `unreadable` likewise; verify-says-still-present → `success: false` naming the survivor; delete-failed-but-verify-says-gone → `success: true`; verify unreadable → falls back to the status code.

## File-by-file change list

| File | Change |
|---|---|
| `src/main/services/tag-prune.ts` | new — pure core |
| `src/main/services/tag-prune.test.ts` | new — unit tests |
| `src/main/services/tag-prune.service.ts` | new — thin IO |
| `src/main/services/discrepancy.ts` | export `collectUnmatchedClassIds` |
| `src/main/services/discrepancy.test.ts` | cases for the new helper |
| `src/main/services/hazu-api/api.ts` | new `sendApiRequestRemoveTagsChecked` |
| `src/shared/ipc-channels.ts` | two channels |
| `src/main/ipc/index.ts` | two handlers |
| `src/main/preload.ts` | expose both, with types |
| `src/renderer/contexts/TaskQueueContext.tsx` | `pruneDeadTags` task type |
| `src/renderer/components/TaskQueuePanel.tsx` | `getLabel()` case |
| `src/renderer/components/PruneTagsConfirmationModal.tsx` | new |
| `src/renderer/pages/DiscrepanciesPage.tsx` | button + modal wiring |

No schema change. No change to `discrepancy.service.ts`.

## Manual acceptance

One run, against live data.

1. Sync, open Discrepancies. The button reads `Check & prune missing rooms (15)`.
2. Click it. The modal shows **84 tags across 71 people in 15 rooms**, and **zero skips**.
3. **Break the API key and click again.** Every id must read `unreadable`, and the modal must offer **nothing** to delete. This is the test the whole design exists to pass.
4. Restore the key, confirm the prune, let the queue settle.
5. Spot-check one profile in Hazu: its dead tags are gone and every other tag is intact.
6. Re-sync. Bucket A drops from 84 to **0**; the 3 unparseable tags remain, being out of scope. **Bucket B is unchanged at 214.** No assignment, group membership, or ACL changed.
7. Click the button again: it reads `(0)` and is disabled.
