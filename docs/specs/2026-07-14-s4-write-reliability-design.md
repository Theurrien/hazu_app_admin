# S4 — Write Reliability: Design Spec

**Date:** 2026-07-14
**Status:** Approved (brainstorming) — ready for implementation plan
**Series:** Matrix group-truth rebuild — **S4 of S1→S2→S3→S4→S5**

**Goal:** Make role assign/remove writes reliable and self-verifying — retry transient failures, confirm the change against group-ACL truth, and reconcile local state from that truth — so the app never again silently reports a success that didn't happen or leaves the Matrix out of sync with reality.

**Architecture:** Keep the designated `POST /api-v2-admin/update-user-roles` endpoint as the write (it encapsulates server-side propagation/invite/tag logic and takes `profileId`, which we already have). Wrap every call in a reusable **retry → verify-against-group-truth → reconcile-local** helper, split pure-core + thin-IO. Route the shared `WEBHOOK_UPDATE_USER_ROLE` handler (Matrix + Bulk Import) and person-creation's room-assignment loop through it.

**Tech stack:** Electron main (Node/CommonJS, `tsconfig.main.json`) + better-sqlite3 + axios, vitest.

**Depends on:** S1 (`distribution_groups` populated; `person_room_assignments` = group truth; `sendApiRequestGetAclInfo`). Background: `docs/hazu-access-model-findings.md`, `docs/matrix-group-truth-rebuild-spec.md`.

---

## Why harden, not bypass (the decisive decision)

The rebuild spec originally proposed *bypassing* `update-user-roles` onto the permissions API (`/api-v2-permissions/acl`), writing the role-group ACL directly. We rejected that for S4 on a safety basis:

- We have **no backend visibility** into what `update-user-roles` does beyond "group ACL + tag." The permissions API surface itself includes `POST /api-v2-permissions/propagate` / `propagate-groups` ("recurse ACL/group perms to **children**") and `POST /api-v2-permissions/add-acl-by-token` ("how **unregistered** invitees get added"). A room is not a leaf and many invitees have no account yet.
- If `update-user-roles` performs propagation-to-children and/or the not-yet-registered invite flow, and our hand-rolled group-ACL write does not, we would grant **partial/broken access** (access to the room node but not its content, or a silent no-op for accountless people) — the opposite of S4's goal.

So the reliability problem is not "the endpoint is wrong" — it's that we call it **fire-and-forget with no retry and no verification**, so transient 500s and partial applies silently corrupt state. S4 fixes exactly that, without taking on the risk of reimplementing access semantics we don't fully understand.

Bypassing to the permissions API is explicitly **out of scope** and deferred (may be revisited only after empirical backend investigation).

## Global constraints

- **Keep the designated endpoint.** S4 writes via `POST /api-v2-admin/update-user-roles` (unchanged payload). It does NOT write ACLs, groups, or tags directly.
- **Never falsely report success.** Success is reported only when the write returned 2xx **and** either group-ACL truth confirms the intended end state or truth could not be read (see success rule). A 2xx that truth *contradicts* is a failure.
- **Reconcile from truth, not intent.** After a 2xx, local `person_room_assignments` is written to match what the group ACL actually shows — so even a partial/failed write leaves local state accurate.
- **Retry only transient failures.** Retry on 5xx / network / timeout; never on 4xx (deterministic).
- **Verify by email, like S1.** Membership is checked by matching the person's `persons.email` (lowercased) against the role-group ACL entries — the same identity bridge S1 uses. No account-UID storage is introduced.
- **Pure-core + thin-IO.** The retry/verify orchestration is pure (all IO injected) and vitest-runnable without the better-sqlite3 native module.
- **Semantic roles.** Roles are `student, companymentor, schoolteacher, courseteacher, stateadvisor, guardian`; "none" is represented as `'_'` / `null` (as `update-user-roles` already uses).

---

## Scope

**In scope — route these write paths through the hardened helper:**
- `WEBHOOK_UPDATE_USER_ROLE` handler ([ipc/index.ts:788](../../src/main/ipc/index.ts)) — the shared `roleUpdate` path used by **Matrix cell edits** and **Bulk-Import Assignment**.
- **Person-creation** Step-2 room-assignment loop ([ipc/index.ts:1052](../../src/main/ipc/index.ts)) — currently a fire-and-forget `update-user-roles` per room with a log-only catch; reuse the same helper (failures stay non-fatal, but now retried + verified + reconciled).

**Out of scope:**
- `ASSIGNMENTS_EXECUTE` — dead (no renderer caller); left as-is.
- Bypassing to `/api-v2-permissions/acl` (see above).
- Making the backend op atomic, or fixing the deterministic per-profile 500s (needs backend visibility).
- S5 (tag cleanup: orphan-tag pruning, unknown/unresolved coverage).

---

## The hardened write (algorithm)

`reliableUpdateUserRole(personId, roomId, oldRole, newRole)`:

1. **Gather** (thin-IO): `templateId` = `admin_id` from settings; `email` = `persons.email` for `personId`; the role-group ids for `(roomId, newRole)` and `(roomId, oldRole)` from `distribution_groups` (`SELECT id FROM distribution_groups WHERE room_id=? AND role=?`).
2. **Write with retry**: POST `update-user-roles` with the existing payload
   `{ templateId, profileId: personId, userTypesInfo: [{ classId: roomId, oldUserType: oldRole||'_', newUserType: newRole||'_' }] }`.
   On a retryable error (5xx / network / timeout) sleep `backoffMs(attempt)` and retry, up to `MAX_WRITE_ATTEMPTS`. A 4xx stops immediately (deterministic).
3. **Verify with re-reads** (only if the write reached 2xx): read the relevant role-group ACL(s) via `sendApiRequestGetAclInfo(groupId)` and check `email` membership → a `GroupMembershipSnapshot { inNewGroup, inOldGroup }`. Because the findings flagged write→ACL cache lag, re-read up to `MAX_VERIFY_READS` times, `VERIFY_DELAY_MS` apart, stopping as soon as the snapshot verifies.
4. **Decide** via `evaluateVerification(intent, snapshot)` → `{ verified, reconciledRole, partial }` (table below).
5. **Reconcile local** (only when the write reached 2xx): write `person_room_assignments` to `reconciledRole` — `INSERT OR REPLACE` when it's a real role, `DELETE` when `null`.

### `evaluateVerification` decision table

`isReal(r)` = `r != null && r !== '_' && r !== ''`. `reconciledRole` = the role group truth actually shows: `inNewGroup ? newRole : inOldGroup ? oldRole : null`.

| Op | newRole | oldRole | inNewGroup | inOldGroup | verified | reconciledRole | partial |
|----|---------|---------|:----------:|:----------:|:--------:|----------------|:-------:|
| assign | real | none | true  | — | ✓ | newRole | no |
| assign | real | none | false | — | ✗ | null    | no |
| remove | none | real | — | false | ✓ | null    | no |
| remove | none | real | — | true  | ✗ | oldRole | no |
| change | real | real | true  | false | ✓ | newRole | no |
| change | real | real | true  | true  | ✗ | newRole | **yes** (add landed, remove didn't) |
| change | real | real | false | true  | ✗ | oldRole | no (clean no-op) |
| change | real | real | false | false | ✗ | null    | **yes** (remove landed, add didn't) |

### Success rule

```
success = postOk && !(verifyRan && !verified)
```
- `postOk && verifyRan && verified` → **success** (confirmed).
- `postOk && verifyRan && !verified` → **failure** (2xx but truth contradicts; reconcile to actual).
- `postOk && !verifyRan` (group not synced locally, or all verify reads errored) → **success**, `verified:false` (trust the 2xx; reconcile optimistically to intent).
- `!postOk` (write never reached 2xx) → **failure**; **no reconcile** (write failed ⇒ truth unchanged), error returned; the renderer's `roleUpdate` `onError` reverts the optimistic cell.

---

## Architecture & interfaces

### Pure core — `src/main/services/role-write.ts` (new)

No DB/HTTP imports; all IO injected — vitest-runnable without native modules.

```ts
export interface RoleWriteIntent { oldRole: string | null; newRole: string | null; }
export interface GroupMembershipSnapshot { inNewGroup: boolean; inOldGroup: boolean; }
export interface VerifyResult { verified: boolean; reconciledRole: string | null; partial: boolean; }

export interface RoleWriteOutcome {
  success: boolean;
  postOk: boolean;
  verifyRan: boolean;
  verified: boolean;
  reconciledRole: string | null; // meaningful when postOk; caller reconciles local iff postOk
  partial: boolean;
  attempts: number;
  error?: string;
}

export function isRetryableError(status: number | undefined, networkOrTimeout: boolean): boolean;
export function backoffMs(attempt: number): number; // 500 * 2^attempt: 500, 1000, 2000, …
export function evaluateVerification(intent: RoleWriteIntent, snapshot: GroupMembershipSnapshot): VerifyResult;

// Orchestrates retry + verify with ALL IO injected — the unit-tested heart of S4.
export async function runReliableRoleWrite(
  intent: RoleWriteIntent,
  deps: {
    // one POST attempt; classifies its own failure for the retry predicate
    postUpdateRoles: () => Promise<{ ok: boolean; status?: number; networkOrTimeout: boolean; error?: string }>;
    // read current group truth; null = could not read (missing local group / ACL read error)
    readMembership: () => Promise<GroupMembershipSnapshot | null>;
    sleep: (ms: number) => Promise<void>;
  },
  cfg?: { maxWriteAttempts?: number; maxVerifyReads?: number; verifyDelayMs?: number },
): Promise<RoleWriteOutcome>;
```

Defaults: `maxWriteAttempts = 3`, `backoffMs` = 500·2ⁿ, `maxVerifyReads = 3`, `verifyDelayMs = 750`.

### Thin IO — `src/main/services/role-write.service.ts` (new)

```ts
export interface RoleWriteResult { success: boolean; verified: boolean; reconciledRole: string | null; attempts: number; error?: string; }

// Gathers templateId/email/group-ids, builds the real deps (axios POST, getAclInfo-based
// membership read, real sleep), runs runReliableRoleWrite, then reconciles local
// person_room_assignments from the outcome (only when postOk).
export async function reliableUpdateUserRole(
  personId: string, roomId: string, oldRole: string | null, newRole: string | null,
): Promise<RoleWriteResult>;
```

- `postUpdateRoles`: `axios.post(.../api-v2-admin/update-user-roles, payload, { headers, timeout: 120000 })`; on catch, classify `networkOrTimeout` (no `error.response`, or `ECONNABORTED`) and capture `error.response?.status`.
- `readMembership`: look up the group ids; for a real `newRole`/`oldRole`, `sendApiRequestGetAclInfo(groupId)` and test whether any entry's `description` (email) equals `email` (lowercased, ignoring `isGroup` entries). Returns `null` if a needed group id is absent locally or the read throws (→ `verifyRan=false`).
- **Reconcile:** iff `outcome.postOk`, `INSERT OR REPLACE INTO person_room_assignments (person_id, room_id, role, synced_at)` when `reconciledRole` is real, else `DELETE`.

### Handler + person-creation (modify `src/main/ipc/index.ts`)

- `WEBHOOK_UPDATE_USER_ROLE` shrinks to: call `reliableUpdateUserRole(personId, roomId, oldRole, newRole)`; return `{ success, error }`. The handler no longer does its own optimistic DB write (the service reconciles). The Task-Queue `roleUpdate` contract (`{ success, error? }`) is unchanged, so the renderer (optimistic + `onError` revert) needs no change.
- Person-creation Step-2 loop: replace the inline `axios.post(update-user-roles)` + optimistic `INSERT` with `await reliableUpdateUserRole(profileId, roomId, '_', params.role)` per room; keep the existing non-fatal semantics (log on `!success`, person already created).

No `api.ts` change required — `sendApiRequestGetAclInfo` already exists; the POST stays inside the service's injected closure.

---

## Error handling & edge cases

- **Transient vs deterministic:** 5xx / network / timeout retried with backoff; 4xx fails fast.
- **Cache lag:** verify re-reads (`MAX_VERIFY_READS` × `VERIFY_DELAY_MS`) absorb the write→ACL propagation delay the findings documented; we stop early once verified.
- **Group not synced locally:** `readMembership` returns `null` → `verifyRan=false` → trust the 2xx (`success:true, verified:false`), reconcile optimistically. Not a failure (incomplete local cache shouldn't block a legitimate write).
- **Partial change (in both groups / in neither):** `verified=false`, `partial=true`, `success=false`; local reconciled to what truth shows (new role for add-landed, `null` for remove-landed-add-didn't). Surfaced via the error message; visible on the next Matrix refetch/sync.
- **Write failure (no 2xx):** no reconcile; error returned; renderer reverts the optimistic cell. Next sync repairs any drift.
- **Deterministic backend 500 (e.g. Matthieu→CIE):** retries won't help, but verify ensures we report the failure honestly instead of a false success + orphan tag.

## Testing

**`src/main/services/role-write.test.ts` (new, vitest — the pure core):**
- `isRetryableError`: 500/502/503 → true; 400/401/403/404 → false; `networkOrTimeout` → true (any/undefined status).
- `backoffMs`: 0→500, 1→1000, 2→2000.
- `evaluateVerification`: every row of the decision table (assign in/out, remove in/out, all four change combos), asserting `verified`, `reconciledRole`, `partial`.
- `runReliableRoleWrite` with injected deps + no-op `sleep`:
  - retryable-then-success: `postUpdateRoles` returns 503 twice then ok; `attempts === 3`, verified snapshot → `success`.
  - non-retryable: 400 → one attempt, `success:false`, no verify.
  - 2xx but truth contradicts (verify shows not-in-new after all reads) → `success:false`, `verified:false`.
  - could-not-verify (`readMembership` → null) → `success:true`, `verifyRan:false`, `reconciledRole` = intent.
  - verify re-read: first read not-yet-consistent, second verified → stops early, `success`.

Service + handler are thin IO — build-verified (`npm run build:electron`) + manual acceptance, per the S2/S3 precedent.

## File-by-file change list

**Create**
- `src/main/services/role-write.ts` — pure core (predicates, `evaluateVerification`, `runReliableRoleWrite`, types).
- `src/main/services/role-write.test.ts` — vitest for the pure core.
- `src/main/services/role-write.service.ts` — `reliableUpdateUserRole` (gather + real deps + reconcile).

**Modify**
- `src/main/ipc/index.ts` — `WEBHOOK_UPDATE_USER_ROLE` → thin caller; person-creation Step-2 loop → `reliableUpdateUserRole`.

## Manual acceptance

1. `npm run build` clean.
2. Matrix cell edit (assign a role) → succeeds; the cell sticks; a fresh Matrix load still shows it (reconciled from truth).
3. Simulate flakiness if possible (or observe logs): a transient 5xx is retried; a persistent failure reports an error (cell reverts) rather than a false success.
4. Bulk-Import Assignment batch → the Task Queue reflects real per-row success/failure; verified rows persist.
5. Create a person with rooms → room assignments are retried/verified; a failed one is logged, person still created.
6. Spot-check: after an assign, the person appears in the room's role-group ACL (the verify target) — no orphan-tag-only state.

## Out of scope / future

- **S5** — fix the other tag problems: orphan-tag pruning (needs tag removes), unknown-person coverage (pull unsynced profiles), unresolved (uid-only entries).
- **Permissions-API bypass** — only after empirical investigation of `update-user-roles`' server-side propagation/invite behavior.
- **Lowering the 120s per-request timeout** — kept as-is to match current behavior.
