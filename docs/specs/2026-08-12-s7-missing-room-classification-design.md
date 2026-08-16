# S7 — Missing-Room Classification and Dead-Tag Pruning: Design Spec

**Date:** 2026-08-12
**Status:** Approved (brainstorming) — ready for implementation plans
**Series:** Matrix group-truth rebuild — **S7**, after S1→S2→S3→S4→S6 (S5 tag cleanup closed as noise; this spec reopens part of it on new evidence)

**Goal:** Answer, per class id, whether the room a breadcrumb tag points at still exists in Hazu — and then delete only the tags proven to point at nothing.

**Architecture:** An on-demand probe from the Discrepancies page resolves every unmatched class id against `GET /read`, caches a verdict per id, and renders a summary panel. A second, separately-shipped stage removes tags for ids re-confirmed `deleted` at the moment of deletion. Pure-core + thin-IO, mirroring S4 and S6.

**Tech stack:** Electron main (Node/CommonJS, `tsconfig.main.json`) + better-sqlite3 + axios, vitest.

**Depends on:** S2 (Discrepancies page, `computeDiscrepancies`, `parseClassTag`), S3 (`buildClassTag`, the Task Queue heal pattern, `sendApiRequestAddTagsChecked` as precedent), S4 (`isRetryableError`, `backoffMs`, verify-against-truth), S6 (re-plan-before-destroy, the confirmation-modal pattern).

**Ships as two plans, one spec.** Stage A (classification) is built and accepted first. Stage B (pruning) is built only after Stage A has been run against live data and the real split is known. Both are designed here so Stage A is shaped to feed Stage B rather than reworked for it.

> **Sequencing — [S8](2026-08-12-s8-sync-depth-recursion-design.md) shipped first, merged to `main` on 2026-08-16.** S8 makes `syncRooms` walk past level 2, so the 31 rooms that were hidden in CIE year sub-folders now import as real rooms. That shrinks this spec's subject at the source, and **every census figure below is a pre-S8 measurement**: the probe set should fall from 46 class ids to 36, and bucket A from 373 tags to 277. Those two numbers are projections, not counts — no sync has run since S8 merged. The design holds either way, because the classification rules, the storage model, and the deleted-only prune rule never depended on the counts. Re-measure before quoting one.

---

## The problem

A person's profile carries breadcrumb tags of the form `hz-config-class-<classId>-<role>`. S2's report calls a tag `orphan-tag` when it does not correspond to a group membership, and [discrepancy.ts:71](../../src/main/services/discrepancy.ts:71) emits one such row with the note *"tag references a class not in local rooms"* whenever the class id matches no local room at all.

That note is honest, and it is not the same claim as *"this room no longer exists."* The report is computed entirely offline. Nothing in the app has ever asked Hazu whether these rooms are still there.

### Measured census (live DB, 2026-08-12)

Recomputed after the `authorId` sync fix shipped in S6:

| bucket | tags | people | notes |
|---|---|---|---|
| legit — tag matches a group membership | 754 | — | |
| **A — class id is not a local room** | **373** | 158 | **46 distinct class ids** |
| B — room exists locally, person not in the group | 130 | 90 | across 61 rooms |
| unparseable | 4 | — | never yields a class id |
| total `hz-config-class-*` tags | 1261 | | |

Bucket B fell from 366 to 130 — exactly the 236 memberships the `authorId` fix recovered. `membership_issues` is now 0 rows, so S6's revocations settled cleanly.

**Bucket A is this spec's subject.** All 373 tags reduce to only 46 distinct class ids, so a complete sweep is 46 API reads.

### The class id is the room's Hazu key

Verified across the live DB: `class_id = id` for **all 123** rooms that carry a class id (the other 4 rooms are category folders, which have none). The id inside a breadcrumb tag is therefore a readable Hazu item key, and `GET /read?id=<classId>` is a direct existence probe.

### The API answers; the public URL does not

Measured on 2026-08-12 against `europe-west6-hazu-ch.cloudfunctions.net/read`:

| id | status | body |
|---|---|---|
| `28t0o8FXAuJc6ZDSrwQJ` (live control) | **200** | full snapshot |
| `0dQJCWrIOAl56pT9aG5X` | **200** | full snapshot |
| `zPvpnE0KVhQw0jNtde2M` | **404** | `Item with id … not found!` |
| `thisIdDoesNotExist99` (fabricated) | **404** | `Item with id … not found!` |

The same four ids fetched as public web URLs (`https://hazu.swiss/<id>`) returned **HTTP 200 for every one**, including the fabricated id. Hazu's front end is a single-page app: the server returns the same ~21 KB shell for any path and resolves "not found" in the browser. The deleted room and the fabricated id came back byte-identical at 21045 bytes. **The public URL carries no existence signal and must not be used as the probe.**

Three further reasons `/read` is the right door: it is authenticated, so it can see rooms the public web cannot — `0dQJCWrIOAl56pT9aG5X` is `privacy: "unlisted"`, and an unauthenticated probe that hid a *live* room would produce a false `deleted`, the one error direction this spec cannot afford; it returns the title and parent id needed for the summary panel in the same call; and `sendApiRequestRead` already exists and rethrows, so the classifier reads `error.response.status` directly.

### "Not a local room" is two different facts

Probing 6 of the 46 ids found 5 genuinely deleted and **1 alive**:

`0dQJCWrIOAl56pT9aG5X` carries **13 tags** and is a real CIE room, `hz-config-room-cie`, titled *2024 CUI-C Cours 1 - Groupe 1*. Its `parentId` is `SiqG2Kp4dteCMCxhV30e`, a folder titled *CIE 2024*, whose own `parentId` is `PizjouVefdez5HrWlvsp` — the CIE category the app **does** sync.

[`syncRooms`](../../src/main/services/sync.service.ts:111) walks exactly two levels: root → children tagged `hz-config-room-*` → rooms. Hazu has since grown a third level of year sub-folders, and everything inside one is invisible to the app. Locally there are 6 CIE rooms, all 2026.

So a slice of bucket A are not orphans at all — they are correct breadcrumbs for live rooms the sync never imported. **Pruning bucket A blind would destroy legitimate data and bury a sync bug.** Distinguishing the two is the entire justification for this feature.

## Global constraints

- **Only an explicit 404 means deleted.** Every other failure — 5xx, network, timeout, 401, 403 — classifies as `unreadable`. An expired API key returns 401 for all 46 ids; if 401 mapped to `deleted`, one credentials problem would arm the prune against 373 live tags.
- **Only the `deleted` verdict may be pruned.** Never `alive`, never `unreadable`, never a bucket-B tag.
- **Re-probe immediately before deleting.** A cached verdict authorises nothing. A fresh 404, taken at delete time, is the authorisation. Following S6, re-planning can only shrink the delete set, never grow it.
- **Retry only transient failures.** 5xx, network, timeout — never a 4xx, and never a 404.
- **A fresh probe overwrites the previous verdict, including with `unreadable`.** If a read fails today, we do not know today; a stale confident verdict under a fresh timestamp would be a lie. Re-probing costs 46 reads.
- **One id's failure never aborts the sweep.** Per-id try/catch, as sync does per group.
- **The probe set is derived from the report, not re-derived.** A single pure helper defines "unmatched class id," so the probe and the page can never disagree about what needs checking.
- **Pure-core + thin-IO.** Orchestration is pure and vitest-runnable without the native module.
- **Stage B writes go through the Task Queue.** No direct calls from the renderer.
- **Tags only.** Nothing in this spec touches groups, ACLs, or access. A tag pointing at a deleted room grants nothing in the first place.

### On Principle 2

[matrix-group-truth-rebuild-spec.md:16](../matrix-group-truth-rebuild-spec.md:16) states that the app *"never **auto**-removes tags,"* and its Non-goals ban *"**Auto**-removing tags or auto-changing group membership."* Both guard automatic removal.

Stage B is not automatic. It runs only on explicit human confirmation, only over ids Hazu itself returned 404 for, and only after a re-probe at the moment of deletion. That is consistent with the letter of both statements and with the precedent set by S6, whose destructive revoke was permitted on the same basis of per-action confirmation. **It is nonetheless a deliberate call, recorded here rather than left to be inferred.** Nothing in this spec authorises removing a tag on any evidence weaker than a fresh 404.

## Scope

**In scope — Stage A:** classifying the distinct class ids behind bucket A, caching the verdicts, and reporting them.

**In scope — Stage B:** removing tags whose class id re-confirms as `deleted`.

**Out of scope:**

- **Fixing the sync depth gap.** This spec measures it; it does not fix it. Making `syncRooms` recurse past level 2 is separate work and likely the higher-value follow-up, since it would make those rooms and their assignments real rather than merely explained.
- **Bucket B** — the 130 tags naming rooms that do exist. Whether a stale-but-valid breadcrumb should be removed is a different judgment on different evidence.
- Auto-pruning during sync, or any prune not gated on a confirmation modal.
- The 4 unparseable tags. They never yield a class id.
- Any change to group membership or ACLs.

---

## Stage A — Classification

### Algorithm

1. **Collect.** Load the same `DiscrepancyInput` the report uses, and reduce bucket A to its distinct class ids with per-id tag count, person count, and the roles involved.
2. **Probe.** For each id, `GET /read?id=<classId>`. Retry transient failures with exponential backoff; never retry a 404.
3. **Classify and persist.** Write each verdict as it lands, so an interrupted sweep keeps what it learned.
4. **Report.** Return a `{ checked, deleted, alive, unreadable }` tally; the page re-reads cached verdicts and renders them.

### Classification table

| read outcome | verdict | also captured |
|---|---|---|
| `404` | `deleted` | — |
| `200` | `alive` | `title`, `parentId`, `parentIsKnown` |
| `5xx` / network / timeout, after retries | `unreadable` | — |
| any other `4xx` (401, 403, …) | `unreadable` | — |

`parentIsKnown` is a boolean: is `parentId` an id already present in local `rooms`? It costs no extra read — the parent id is in the snapshot — and it is what makes *"CIE 2024 sits under your synced CIE category"* legible at a glance. No ancestry walk; no subtree rules in code.

### Pure core — `src/main/services/room-existence.ts` (new)

```ts
export type RoomVerdict = 'deleted' | 'alive' | 'unreadable';

export interface ReadOutcome {
  ok: boolean;
  status?: number;
  networkOrTimeout: boolean;
  snapshot?: { title?: string; parentId?: string };
}

export interface RoomExistenceRecord {
  classId: string;
  verdict: RoomVerdict;
  title: string | null;
  parentId: string | null;
  parentIsKnown: boolean;
  checkedAt: number;
}

export interface UnmatchedClassId {
  classId: string;
  tagCount: number;
  personCount: number;
  roles: string[];
}

// The summary-panel row: a verdict plus the weight behind the id.
export interface RoomExistenceRow extends RoomExistenceRecord, UnmatchedClassId {}

// Pure classification of one read. Only a 404 yields 'deleted'.
export function classifyReadResult(
  res: ReadOutcome,
  knownRoomIds: ReadonlySet<string>,
): Omit<RoomExistenceRecord, 'classId' | 'checkedAt'>;

// Probe every id, retrying transient failures. Emits each record via deps.persist as it lands.
export async function runExistenceProbe(
  ids: UnmatchedClassId[],
  deps: ExistenceProbeDeps,
  config?: ExistenceProbeConfig,
): Promise<ExistenceProbeSummary>;
```

`ExistenceProbeDeps` injects `readItem(classId): Promise<ReadOutcome>`, `persist(record)`, `now()`, and `sleep`. `ExistenceProbeConfig` carries `maxReadAttempts` (default 3). `ExistenceProbeSummary` is `{ checked, deleted, alive, unreadable }`. Reused verbatim from [role-write.ts:80](../../src/main/services/role-write.ts:80): `isRetryableError(status, networkOrTimeout)` and `backoffMs(attempt)` — no third copy of that logic.

**Import direction is one-way: `discrepancy.ts` imports from `room-existence.ts`, never the reverse.** `UnmatchedClassId` therefore lives in `room-existence.ts` alongside the other existence types, even though it is produced from a `DiscrepancyInput`. Both files stay pure; neither imports SQLite or axios.

### Additions to `discrepancy.ts`

```ts
// Every distinct class id referenced by a breadcrumb tag that maps to no local room,
// with the weight behind it. The single definition of "needs probing" — derived from the
// same DiscrepancyInput the report renders, so the probe set cannot drift from the page.
export function collectUnmatchedClassIds(input: DiscrepancyInput): UnmatchedClassId[];

// Attach cached verdicts to bucket-A rows; every other row passes through untouched.
export function annotateExistence(
  rows: Discrepancy[],
  verdicts: Map<string, RoomExistenceRecord>,
): Discrepancy[];
```

`collectUnmatchedClassIds` mirrors the non-drift discipline S3 established when `getTagHealPlan` reused `loadDiscrepancyInput` + `computeDiscrepancies`.

`Discrepancy` also gains one optional field, exactly as it gained optional `groupId` in S6:

```ts
existence?: {
  verdict: RoomVerdict;
  title: string | null;
  parentId: string | null;
  parentIsKnown: boolean;
  checkedAt: number;
};
```

Annotation happens in main, not the renderer. **A row is bucket A iff `type === 'orphan-tag'` and `verdicts` has an entry keyed by its `roomId`** — because for bucket-A rows alone, `roomId` holds a *class* id rather than a room id ([discrepancy.ts:74](../../src/main/services/discrepancy.ts:74)). The two id spaces cannot collide: `room_existence` is keyed only by *unmatched* class ids, and every other row's `roomId` names a room that is by definition present locally. Deliberately **not** discriminated on `roomTitle === null`, which happens to hold today but is an incidental invariant rather than a stated one. Keeping this subtlety inside a tested pure function is the point; the renderer should not have to know it.

### Thin IO — `src/main/services/room-existence.service.ts` (new)

- `probeMissingRooms(): Promise<ExistenceProbeSummary>` — loads the discrepancy input, calls `collectUnmatchedClassIds`, builds real deps over `sendApiRequestRead`, runs the core, upserting each record.
- `getRoomExistence(): Promise<RoomExistenceRow[]>` — cached verdicts joined to the *current* unmatched set, so an id that has stopped being unmatched simply is not shown. Stale rows are left in the table; at this scale they are harmless, and they preserve the fact that the id was once checked.

### Schema — `room_existence`

```sql
CREATE TABLE IF NOT EXISTS room_existence (
    class_id        TEXT PRIMARY KEY,
    verdict         TEXT NOT NULL,       -- deleted | alive | unreadable
    title           TEXT,
    parent_id       TEXT,
    parent_is_known INTEGER NOT NULL DEFAULT 0,
    checked_at      INTEGER NOT NULL
);
```

`schema.sql` already re-runs on every startup, so this needs no migration machinery.

### IPC

| Channel | Direction | Payload |
|---|---|---|
| `roomExistence:probe` | write (local cache only) | `()` → `{ checked, deleted, alive, unreadable }` |
| `roomExistence:get` | read-only | `()` → `RoomExistenceRow[]` |

### Renderer

- **`DiscrepanciesPage.tsx`** — a `Check missing rooms (N)` button, disabled while running with a `Checking rooms…` label. A **Missing rooms** summary panel above the table: one row per class id with verdict, title, parent, `parentIsKnown`, tag count, person count, and an "as of" timestamp. The 373 detail rows pick up their verdict in the Note column and a real title in place of the bare id where one was learned.
- No Task Queue involvement. This is a single read sweep whose only writes are local; the queue exists for sequential API *writes*.
- No progress counter. 46 reads is roughly twenty seconds, and the polled-progress pattern the Dashboard sync uses is more machinery than the wait justifies.

### Error handling & edge cases — Stage A

- **Zero unmatched ids** — button disabled, panel shows an empty state. No reads.
- **Every read fails (bad key, offline)** — all 46 record `unreadable`. Nothing is ever marked `deleted`, so Stage B has nothing to act on. This is the designed behaviour of the 401/403 rule.
- **A read throws with no response** (DNS, socket) — `networkOrTimeout: true` → retried → `unreadable`.
- **Sweep interrupted mid-run** — records already written stand; the rest keep their prior verdict, or none.
- **An id becomes matched between runs** (tag healed, room synced, sync depth fixed) — dropped from the displayed set; its row stays in the table.
- **A room returns 200 with an empty or malformed snapshot** — still `alive`; `title`/`parentId` fall back to null. Alive with unknown detail is correct and safe: it is not `deleted`.

---

## Stage B — Pruning

Built only after Stage A has run against live data.

### Algorithm

1. **Plan.** Read `room_existence` for rows reading `deleted`, and resolve the affected `(personId, classId, role)` triples from the same `DiscrepancyInput`.
2. **Re-probe.** For each class id in the plan, `GET /read` again. A fresh 404 authorises deletion. A `200` or an `unreadable` drops that id from the set and is reported. Per S6, this can only shrink the set.
3. **Delete.** One Task Queue task per person, batching that person's dead tags into a single `DELETE /api-v2-items/{personId}/tags`, via a new `sendApiRequestRemoveTagsChecked`. Retry transient failures only.
4. **Verify.** Re-read the profile and confirm the tags are gone. Truth outranks the status code in both directions, as in S4 and S6.
5. **Reconcile.** On a confirmed removal, update local `persons.tags`, in its own try/catch so a SQLite failure cannot flip a real API success.

Tag strings are rebuilt with S3's `buildClassTag`, which round-trips through `parseClassTag` — so the string deleted is provably the string that was parsed.

### `sendApiRequestRemoveTagsChecked`

[`sendApiRequestRemoveTags`](../../src/main/services/hazu-api/api.ts:222) already exists, has **zero callers**, and swallows every error into a `console.error` before returning `void`. That is the third instance of this trap: S3 needed `sendApiRequestAddTagsChecked`, S6 needed `sendApiRequestRemoveUserChecked`. Stage B needs the checked variant, classifying its failure as `{ ok, status?, networkOrTimeout }` so `isRetryableError` can tell a doomed 4xx from a worth-retrying 5xx. The original is left in place for its (nonexistent) callers, consistent with prior practice.

### Renderer — Stage B

A `Prune dead tags (N)` button on the Missing rooms panel, enabled only when at least one id reads `deleted`, and a confirmation modal naming the tag count, the person count, the room count, and stating plainly that this is destructive and irreversible. Modelled on `RevokeAccessConfirmationModal`. A new `pruneDeadTags` Task Queue type joins `roleUpdate` / `createRoom` / `createPerson` / `healTag` / `revokeOrphanAccess` — and, per the S6 follow-up note, `TaskQueuePanel.getLabel()` must gain a matching case, since the renderer build does not enforce switch exhaustiveness over the task union.

### Error handling & edge cases — Stage B

- **Re-probe returns 200** — that id is skipped and named in the result. The cached verdict is corrected.
- **Re-probe unreadable** — skipped. Never delete on an unread.
- **DELETE 2xx but the tag survives on re-read** — failure, task retryable.
- **DELETE 500 but the tag is gone on re-read** — success, reconciled locally.
- **Person has dead tags for several deleted rooms** — one task, one DELETE, all their dead tags together.
- **A tag string no longer present at delete time** — idempotent; verification confirms absence.

---

## Testing

Pure-core vitest suites with all IO injected, no native module — matching `role-write.test.ts`, `orphan-removal.test.ts`, `discrepancy.test.ts`. Fixtures use invented ids and `@example.invalid` addresses, per the person-data rule in CLAUDE.md. Tests follow the code: `classifyReadResult` and `runExistenceProbe` in `room-existence.test.ts`, `collectUnmatchedClassIds` and `annotateExistence` in the existing `discrepancy.test.ts`.

**`classifyReadResult`** — 404 → `deleted`; 200 → `alive` with title and parentId extracted; `parentIsKnown` true when the parent is in the known-room set and false otherwise; 500 → `unreadable`; network/timeout → `unreadable`; **401 and 403 → `unreadable`, not `deleted`**; 200 with a malformed snapshot → `alive` with null detail.

**`collectUnmatchedClassIds`** — many tags collapse to distinct ids with correct tag and person counts; unparseable tags ignored; ids that do map to a local room excluded; a person holding several tags for one id counted once in `personCount`.

**`annotateExistence`** — annotates bucket-A rows only; leaves `missing-tag`, `unresolved`, and `unknown` rows untouched; a row with no cached verdict gains no `existence` field.

**`runExistenceProbe`** — retries a 500 then succeeds; never retries a 404; one id throwing hard leaves the other ids' verdicts intact; each record is persisted as it lands rather than at the end; the returned tally matches the records emitted.

**Stage B core** — only `deleted` ids produce removals; a re-probe returning `alive` or `unreadable` drops that id and reports it; verify-says-still-present → `success: false`; delete-failed-but-verify-says-gone → `success: true`; tag strings round-trip through `parseClassTag`.

## File-by-file change list

### Stage A

| File | Change |
|---|---|
| `src/main/services/room-existence.ts` | new — pure core |
| `src/main/services/room-existence.test.ts` | new — unit tests |
| `src/main/services/room-existence.service.ts` | new — thin IO |
| `src/main/services/discrepancy.ts` | export `collectUnmatchedClassIds` and `annotateExistence`; optional `existence` field on `Discrepancy` |
| `src/main/services/discrepancy.test.ts` | cases for both new helpers |
| `src/main/services/discrepancy.service.ts` | load cached verdicts and annotate rows |
| `src/main/database/schema.sql` | `room_existence` table |
| `src/shared/ipc-channels.ts` | two channels |
| `src/main/ipc/index.ts` | two handlers |
| `src/main/preload.ts` | expose both, with types |
| `src/renderer/pages/DiscrepanciesPage.tsx` | button, Missing rooms panel, enriched Note column |

### Stage B

| File | Change |
|---|---|
| `src/main/services/tag-prune.ts` | new — pure core |
| `src/main/services/tag-prune.test.ts` | new — unit tests |
| `src/main/services/tag-prune.service.ts` | new — thin IO |
| `src/main/services/hazu-api/api.ts` | new `sendApiRequestRemoveTagsChecked` |
| `src/shared/ipc-channels.ts` / `src/main/ipc/index.ts` / `src/main/preload.ts` | plan + execute channels |
| `src/renderer/contexts/TaskQueueContext.tsx` | `pruneDeadTags` task type |
| `src/renderer/components/TaskQueuePanel.tsx` | `getLabel()` case for the new type |
| `src/renderer/components/PruneTagsConfirmationModal.tsx` | new |
| `src/renderer/pages/DiscrepanciesPage.tsx` | prune button + modal wiring |

## Manual acceptance

### Stage A

1. Sync, open Discrepancies, press **Check missing rooms**. Expect 46 ids checked.
2. `zPvpnE0KVhQw0jNtde2M` reads `deleted`, with 52 tags counted against it.
3. `0dQJCWrIOAl56pT9aG5X` reads `alive`, titled *2024 CUI-C Cours 1 - Groupe 1*, parent `SiqG2Kp4dteCMCxhV30e`, `parentIsKnown` false — with the CIE category one level above it, demonstrating the sync depth gap.
4. Detail rows for both ids show the verdict in their Note column; the alive one shows its real title.
5. Temporarily break the API key and re-probe: **every** id must read `unreadable` and **none** `deleted`.
6. Confirm no tag, group, or ACL was written — Stage A is read-only against Hazu.

### Stage B

1. With Stage A's verdicts in place, press **Prune dead tags**. The modal names the tag, person, and room counts.
2. Confirm. Tasks settle; spot-check one profile in Hazu and confirm the dead tags are gone and every other tag is intact.
3. Re-sync. Bucket A's tag count drops by exactly the number pruned; **bucket B is unchanged**; no assignment or group membership changed.
4. Confirm a tag for an `alive` id — such as `0dQJCWrIOAl56pT9aG5X`'s 13 — was **not** removed.
