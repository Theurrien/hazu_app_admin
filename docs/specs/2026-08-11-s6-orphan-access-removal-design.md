# S6 — Orphan Access Removal: Design Spec

**Date:** 2026-08-11
**Status:** Approved (brainstorming) — ready for implementation plan
**Series:** Matrix group-truth rebuild — **S6**, after S1→S2→S3→S4 (S5 tag cleanup closed as noise)

**Goal:** Let an administrator revoke, from the Discrepancies page, the room access held by an account that has no profile Hazu — and never report that revocation as done unless the account is genuinely gone from every place its access lives.

**Architecture:** A per-row `Revoke access` button on `unknown` discrepancies. Plan the removal by reading live ACLs, confirm it in a modal, run it through the Task Queue, execute it as `DELETE /acl` per grant, then verify against the same ACLs before claiming success. Pure-core + thin-IO, mirroring S4.

**Tech stack:** Electron main (Node/CommonJS, `tsconfig.main.json`) + better-sqlite3 + axios, vitest.

**Depends on:** S1 (`membership_issues` populated), S2 (Discrepancies page), S4 (`isRetryableError`, `backoffMs`, and the verify-against-truth discipline this reuses). Background: `docs/hazu-access-model-findings.md`.

---

## The problem

An orphan is an account that holds room access but has no profile Hazu under any `hz-config-profile-*` container. Sync cannot map it to a person, so S1 records it in `membership_issues` as `unknown` and the Discrepancies page reports it. Today the page can only report; resolving means leaving the app.

A measured census on 2026-08-11, after the sync matcher fix (`fix(sync): resolve group members by authorId when the tag holds a UID`), found **6 such accounts holding 9 room grants** — 4 students and 2 company mentors. No profile exists for any of them under either identity form, tagged or untagged.

### Access lives in two places, not one

The decisive finding. For each of the 9 grants:

| | in the role group | direct entry on the room item |
|---|---|---|
| 6 grants | yes | **yes** (`isGroup=true`; five `reader`, one `editor`) |
| 3 grants | yes | no |

Removing only the role-group membership would leave two thirds of these grants live while the discrepancy row disappears. The report would go quiet and the access would survive. **A removal that touches only groups is therefore wrong**, even though groups are the source of truth for *reporting*.

## Global constraints

- **Remove both grants.** A row's revocation removes the role-group membership and, when present, the direct room-item ACL entry.
- **Never falsely report success.** Success requires verification that the account is absent from both ACLs. A `DELETE` that returned 2xx but left the account present is a failure.
- **A transport failure that truth contradicts is a success.** Measured against this platform, a 500 may commit and a 200 may not. Only the ACL decides.
- **Partial removal is a failure.** If one grant goes and the other survives, report failure and name the survivor. Never present a half-revoked account as resolved.
- **Retry only transient failures.** 5xx, network, timeout — never 4xx.
- **Pure-core + thin-IO.** Orchestration is pure and vitest-runnable without the native module.
- **All writes go through the Task Queue.** No direct calls from the renderer.
- **Read before promising.** The plan reads live ACLs, so the modal never offers to remove a grant that is already gone.

## Scope

**In scope:** revoking access for `unknown` discrepancy rows, one row at a time.

**Out of scope:**

- Creating the missing profiles instead of revoking. The decision on record is that accounts without a profile do not need room access.
- `orphan-tag` rows — the S5 cleanup, deliberately closed as noise.
- `missing-tag` rows — S3 heals those by adding a tag.
- Any bulk "revoke all" control.
- Role groups not linked to a room. Those never reach `membership_issues`.

## The removal (algorithm)

1. **Plan.** Read `membership_issues` for the row's `group_id`. Read the room ACL live. Emit one grant per place the account actually appears.
2. **Execute.** `DELETE /acl` per grant via `sendApiRequestRemoveUser(itemId, userId)`, where `itemId` is the group id or the room id and `userId` is the account UID. Retry transient failures with exponential backoff.
3. **Settle and verify.** Re-read both ACLs, retrying to ride out cache lag. Decide per the table below.
4. **Reconcile local.** On success, delete the matching `membership_issues` row. On failure, leave local state untouched.

### Verification decision table

| Grant plan | Group ACL after | Room ACL after | Result |
|---|---|---|---|
| group only | absent | — | success |
| group only | present | — | failure: still in role group |
| group + room | absent | absent | success |
| group + room | absent | present | failure: still on room item |
| group + room | present | absent | failure: still in role group |
| group + room | present | present | failure: nothing removed |
| any | read error | — | cannot verify: fall back to the `DELETE` status codes |

Status codes never override a successful read, in either direction.

### The `isGroup` trap

`isIdentityInAcl` in [role-write.ts](../../src/main/services/role-write.ts) skips entries where `isGroup` is true. The orphans' room-item grants are recorded with **`isGroup=true`**, so reusing that predicate for room verification would report "absent" for an entry that is still present — turning a failed revocation into a reported success, the exact failure mode this spec exists to prevent.

The core therefore needs a second predicate, used only for room-item checks:

```ts
// Matches an account on an item ACL by account id, regardless of isGroup. Hazu records a
// person's direct grant on a room item as isGroup=true, so the group-skipping predicate in
// role-write.ts cannot be reused here.
export function isAccountOnAcl(members: AclMember[], accountId: string): boolean
```

This edge gets a dedicated test.

## Architecture & interfaces

### Pure core — `src/main/services/orphan-removal.ts` (new)

```ts
export interface OrphanGrant {
  kind: 'group' | 'roomItem';
  itemId: string;        // group id, or room id
  title: string;         // for the modal
  aclRole?: string;      // room-item entries only: reader / editor
}

export interface OrphanRemovalIntent {
  accountId: string;     // the ACL authorId — an orphan has no profile id
  roomId: string;
  role: string;
  grants: OrphanGrant[];
}

export interface OrphanRemovalOutcome {
  success: boolean;
  verifyRan: boolean;
  removed: OrphanGrant[];
  surviving: OrphanGrant[];
  attempts: number;
  error?: string;        // names the surviving grant(s)
}

export function isAccountOnAcl(members: AclMember[], accountId: string): boolean;
export function evaluateRemoval(intent, snapshot): { verified: boolean; surviving: OrphanGrant[] };
export async function runOrphanRemoval(intent, deps, config): Promise<OrphanRemovalOutcome>;
```

`deps` injects the delete call, the two ACL reads, and `sleep`. Reused from role-write.ts: `isRetryableError`, `backoffMs`.

### Thin IO — `src/main/services/orphan-removal.service.ts` (new)

- `planOrphanRemoval(accountId, roomId, role)` — group id from SQLite, room ACL live, returns `OrphanGrant[]`.
- `revokeOrphanAccess(accountId, roomId, role)` — builds real deps, runs the core, reconciles `membership_issues` in its own try/catch, logs one line:
  `[orphan-removal] account=… room=… success=… verifyRan=… groupGone=… roomGone=… attempts=…`

### IPC

| Channel | Direction | Payload |
|---|---|---|
| `orphanAccess:plan` | read-only | `(accountId, roomId, role)` → `OrphanGrant[]` |
| `orphanAccess:revoke` | write | `(accountId, roomId, role)` → `{ success, error? }` |

Added to `src/shared/ipc-channels.ts`, handled in `src/main/ipc/index.ts`, exposed in `src/main/preload.ts` with types.

### Renderer

- `DiscrepanciesPage.tsx` — a `Revoke access` button on `unknown` rows only. On click, call the plan channel and open the modal. After a task succeeds, `refetch()`.
- `RevokeAccessConfirmationModal.tsx` (new) — names the person, the room, and every grant to be removed, and states plainly that this removes access. Modelled on `HealConfirmationModal`, with the opposite warning: heal is add-only, this is destructive.
- `TaskQueueContext.tsx` — new `revokeOrphanAccess` task type and `addRevokeAccessTask`, alongside `roleUpdate` / `createRoom` / `createPerson` / `healTag`.
- `discrepancy.ts` — carry `groupId` through from `membership_issues` into the `Discrepancy` shape, so the renderer identifies a row by its group rather than by a three-key lookup.

## Error handling & edge cases

- **Grant already absent at plan time** — omitted from the plan. A plan with no grants short-circuits to success and clears the local row.
- **Both DELETEs fail, truth says still present** — failure, row stays, task retryable from the queue.
- **DELETE 500, truth says gone** — success. Local row cleared.
- **ACL read throws during verification** — cannot verify; fall back to status codes and say so in the log.
- **Local delete fails after a verified removal** — the API result stands as success; the stale row clears on the next sync.
- **Two rows for the same account and room** (different roles) — the room-item grant is shared. Removing it twice is idempotent; an already-absent entry verifies as gone.
- **Account is a super-user** — cannot occur. S1 excludes super-user members before recording issues.

## Testing

Pure-core (`orphan-removal.test.ts`), no native module:

- plan with both grants; plan with group only; empty plan
- both gone → success
- group gone, room entry survives → failure naming the room item
- room entry gone, group survives → failure naming the group
- `DELETE` 500 but truth says gone → success
- `DELETE` 200 but truth says present → failure
- verification read throws → falls back to status codes
- retries 5xx, does not retry 4xx
- **`isAccountOnAcl` matches an `isGroup=true` room entry** that `isIdentityInAcl` would miss

## File-by-file change list

| File | Change |
|---|---|
| `src/main/services/orphan-removal.ts` | new — pure core |
| `src/main/services/orphan-removal.test.ts` | new — unit tests |
| `src/main/services/orphan-removal.service.ts` | new — thin IO |
| `src/main/services/discrepancy.ts` | carry `groupId` through |
| `src/shared/ipc-channels.ts` | two channels |
| `src/main/ipc/index.ts` | two handlers |
| `src/main/preload.ts` | expose both, with types |
| `src/renderer/pages/DiscrepanciesPage.tsx` | button, modal wiring, refetch |
| `src/renderer/components/RevokeAccessConfirmationModal.tsx` | new |
| `src/renderer/contexts/TaskQueueContext.tsx` | `revokeOrphanAccess` task type |

## Manual acceptance

1. Sync. Filter Discrepancies to `Unknown person` — expect 9 rows across 6 accounts.
2. Revoke a row whose account also holds a direct room-item entry. Confirm the modal lists **two** grants.
3. After the task succeeds, confirm via a read-only ACL check that the account is absent from both the role group and the room item.
4. Re-sync. Confirm the row does not return.
5. Revoke a row whose account holds only a group grant. Confirm the modal lists one grant and the row clears.
