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

1. **Plan.** Read the group ACL and the room ACL live. Emit one grant per place the account actually appears. If either ACL cannot be read, throw rather than return a silently incomplete grant list — an unreadable ACL is not an absent grant, and the confirmation modal must never under-promise what will be removed.
2. **Execute.** Re-plan internally from the confirmed `(accountId, groupId, roomId)` rather than trusting the grant list the renderer already confirmed — the IPC call carries only those three ids, and re-planning can only shrink the delete set, never grow it. If either ACL is unreadable at this point, short-circuit to `success:false` before attempting any delete — the same "unreadable is not absent" reasoning as planning. Otherwise, `DELETE /acl` per grant via `sendApiRequestRemoveUserChecked(itemId, accountId)`, where `itemId` is the group id or the room id. Retry transient failures with exponential backoff.
3. **Settle and verify.** Re-read both ACLs, retrying to ride out cache lag. Decide per the table below. Verification runs even after a non-retryable 4xx from the delete — a deliberate divergence from S4's `runReliableRoleWrite`, which short-circuits on a 4xx instead. A 404 from `DELETE /acl` plausibly means "already absent," and the read answers that directly rather than guessing from the status code.
4. **Reconcile local.** On success, delete the matching `membership_issues` row. On failure, leave local state untouched.

### Verification decision table

Both ACLs are re-read and checked unconditionally, regardless of what the plan found — verification
does not skip the room check just because a row's plan was group-only. The `—` in the rows below
means "not part of the plan, and so expected already absent," not "not checked": if a grant
resurfaces on an ACL the plan didn't touch, it still fails the row and names the survivor.

| Grant plan | Group ACL after | Room ACL after | Result |
|---|---|---|---|
| group only | absent | absent (unplanned) | success |
| group only | present | — | failure: still in role group |
| group + room | absent | absent | success |
| group + room | absent | present | failure: still on room item |
| group + room | present | absent | failure: still in role group |
| group + room | present | present | failure: nothing removed |
| any | read error | — | cannot verify: fall back to the `DELETE` status codes |

Status codes never override a successful read, in either direction.

### The `isGroup` trap

`isIdentityInAcl` in [role-write.ts](../../src/main/services/role-write.ts) skips entries where `isGroup` is true. The orphans' room-item grants are recorded with **`isGroup=true`**, so reusing that predicate for room verification would report "absent" for an entry that is still present — turning a failed revocation into a reported success, the exact failure mode this spec exists to prevent.

The core therefore needs a second predicate, used for both room-item and role-group checks:

```ts
// Find the ACL entry granting `accountId` access, if any. Unlike isIdentityInAcl in
// role-write.ts, this does NOT skip isGroup entries: Hazu records a person's direct grant on a
// room item with isGroup=true, so skipping them would report absence for access that is still
// live. Matching is by account id only — an orphan has no profile, so there is no local email to
// match against.
export function findAccountOnAcl(members: AclMember[], accountId: string): AclMember | undefined

// Does this ACL still carry a grant for `accountId`? Thin boolean wrapper over findAccountOnAcl
// so planning (which needs the entry, e.g. to read aclRole) and verification (which only needs
// yes/no) can never silently disagree about who counts as "on the ACL".
export function isAccountOnAcl(members: AclMember[], accountId: string): boolean
```

Planning calls `findAccountOnAcl` directly, so it can read `aclRole` off the matched entry for the
confirmation modal; verification calls `isAccountOnAcl`. Routing both through the same lookup means
the two can never drift on who counts as "on the ACL." This edge gets a dedicated test.

## Architecture & interfaces

### Pure core — `src/main/services/orphan-removal.ts` (new)

```ts
export type GrantKind = 'group' | 'roomItem';

export interface OrphanGrant {
  kind: GrantKind;
  itemId: string;        // group id, or room id
  title: string;         // for the modal
  aclRole?: string;      // room-item entries only: reader / editor
}

export interface OrphanRemovalIntent {
  accountId: string;     // the ACL authorId — an orphan has no profile id
  groupId: string;
  roomId: string;
  grants: OrphanGrant[];
}

export interface RemovalSnapshot {
  inGroup: boolean;
  onRoom: boolean;
}

export interface RemovalVerdict {
  verified: boolean;
  surviving: GrantKind[];
}

export interface OrphanRemovalOutcome {
  success: boolean;
  deleteOk: boolean;
  verifyRan: boolean;
  verified: boolean;
  surviving: GrantKind[];
  attempts: number;
  error?: string;        // names the surviving grant(s)
}

export function findAccountOnAcl(members: AclMember[], accountId: string): AclMember | undefined;
export function isAccountOnAcl(members: AclMember[], accountId: string): boolean;
export function evaluateRemoval(snapshot: RemovalSnapshot): RemovalVerdict;
export async function runOrphanRemoval(
  intent: OrphanRemovalIntent,
  deps: OrphanRemovalDeps,
  config?: OrphanRemovalConfig,
): Promise<OrphanRemovalOutcome>;
```

`evaluateRemoval` takes only the ACL snapshot — the grant plan (`OrphanRemovalIntent`) has already
done its job by the time verification runs; what matters now is what truth says, not what was
originally planned. `deps` injects the delete call, the two ACL reads, and `sleep`. Reused from
role-write.ts: `isRetryableError`, `backoffMs`.

### Thin IO — `src/main/services/orphan-removal.service.ts` (new)

- `planOrphanRemoval(accountId, groupId, roomId): Promise<OrphanGrant[]>` — reads both ACLs live and
  returns the grants found. Throws if either ACL cannot be read, rather than returning a plan that
  silently under-counts a grant.
- `revokeOrphanAccess(accountId, groupId, roomId): Promise<{ success: boolean; error?: string }>` —
  re-plans internally (see the removal algorithm above), builds the real deps, runs the core,
  reconciles `membership_issues` in its own try/catch, and logs one line:
  `[orphan-removal] account=… room=… group=…: success=… deleteOk=… verifyRan=… verified=… surviving=[…] attempts=…`

### IPC

| Channel | Direction | Payload |
|---|---|---|
| `orphanAccess:plan` | read-only | `(accountId, groupId, roomId)` → `OrphanGrant[]` |
| `orphanAccess:revoke` | write | `(accountId, groupId, roomId)` → `{ success, error? }` |

Added to `src/shared/ipc-channels.ts`, handled in `src/main/ipc/index.ts`, exposed in `src/main/preload.ts` with types.

### Renderer

- `DiscrepanciesPage.tsx` — a `Revoke access` button on `unknown` rows only (gated on the row
  carrying both `uid` and `groupId`). On click, call the plan channel and open the modal. After a
  task succeeds, `refetch()`.
- `RevokeAccessConfirmationModal.tsx` (new) — names the person, the room, and every grant to be
  removed, and states plainly that this removes access. Modelled on `HealConfirmationModal`, with
  the opposite warning: heal is add-only, this is destructive.
- `TaskQueueContext.tsx` — new `revokeOrphanAccess` task type and `addRevokeAccessTask`, alongside
  `roleUpdate` / `createRoom` / `createPerson` / `healTag`.
- `discrepancy.ts` / `discrepancy.service.ts` — carry `groupId` through from `membership_issues`
  into the `Discrepancy` shape, so the renderer identifies a row by its group rather than by a
  three-key lookup.

## Error handling & edge cases

- **Grant already absent at plan time** — omitted from the plan. A plan with no grants short-circuits to success and clears the local row.
- **Both DELETEs fail, truth says still present** — failure, row stays, task retryable from the queue.
- **DELETE 500, truth says gone** — success. Local row cleared.
- **ACL read throws during verification** — cannot verify; fall back to status codes and say so in the log.
- **Local delete fails after a verified removal** — the API result stands as success; the stale row clears on the next sync.
- **Two rows for the same account and room** (different roles) — the room-item grant is shared. Removing it twice is idempotent; an already-absent entry verifies as gone.
- **Account is a super-user** — cannot occur. S1 excludes super-user members before recording issues.

## Testing

Pure-core (`orphan-removal.test.ts`), no native module. Planning lives in the thin IO layer
(`orphan-removal.service.ts`, needs SQLite) and so isn't covered here; the pure core's coverage is
`findAccountOnAcl` / `isAccountOnAcl` / `evaluateRemoval` / `runOrphanRemoval`:

- **`findAccountOnAcl` / `isAccountOnAcl` match an `isGroup=true` room entry** that `isIdentityInAcl` would miss, and a plain `isGroup=false` group member; both return undefined/false for an absent or blank account id, and tolerate a null/empty member list.
- `evaluateRemoval` — verified when gone from both; fails and names the group when group membership survives; fails and names the room item when the room grant survives; fails and names both when nothing was removed.
- `runOrphanRemoval` — succeeds when both deletes return ok and both ACLs confirm absence; succeeds when a delete fails with a 500 but truth says the account is gone; fails when deletes returned 2xx but the group membership survives; fails and names the room item when only the room grant survives; retries a 500 up to `maxDeleteAttempts` per grant; does not retry a 4xx; still verifies after a 4xx, so an already-absent grant reports success (the S4 divergence above); falls back to the delete status when an ACL read throws, or when truth is unreadable and the deletes also failed; treats an empty grant list as success without calling delete.

## File-by-file change list

| File | Change |
|---|---|
| `src/main/services/orphan-removal.ts` | new — pure core |
| `src/main/services/orphan-removal.test.ts` | new — unit tests |
| `src/main/services/orphan-removal.service.ts` | new — thin IO |
| `src/main/services/discrepancy.ts` / `discrepancy.service.ts` | carry `groupId` through |
| `src/main/services/hazu-api/api.ts` | new `sendApiRequestRemoveUserChecked` (classified failure, for the retry predicate) |
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
