# S6 — Orphan Access Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-row "Revoke access" action to the Discrepancies page that removes an orphan account's room access — from both the role group and the room item — and reports success only when an ACL read confirms the account is gone from both.

**Architecture:** Pure core (`orphan-removal.ts`, all IO injected, vitest-runnable without the native module) + thin IO service (`orphan-removal.service.ts`) + two IPC channels + a Task Queue task type + a confirmation modal. Mirrors the S4 role-write split.

**Tech Stack:** Electron main (Node/CommonJS, `tsconfig.main.json`), better-sqlite3, axios, React 19 + Tailwind, vitest.

**Spec:** `docs/specs/2026-08-11-s6-orphan-access-removal-design.md`

## Global Constraints

- **Never falsely report success.** Success requires an ACL read confirming absence from both the role group and the room item.
- **Truth outranks the status code in both directions.** A `DELETE` that returned 2xx but left the account present is a failure; a 5xx/timeout that truth says removed it is a success.
- **Partial removal is a failure.** Report failure and name the surviving grant.
- **Retry only transient failures** — 5xx, network, timeout. Never 4xx. Reuse `isRetryableError` and `backoffMs` from `role-write.ts`; do not reimplement them.
- **Pure-core + thin-IO.** Orchestration takes all IO as injected deps.
- **All writes go through the Task Queue.** The renderer never calls a write channel directly.
- **No real person data in any tracked file.** Test fixtures use `@example.invalid` (RFC 2606) and invented account ids. The pre-commit hook in `.githooks/pre-commit` enforces this.
- **Roles** are `student, companymentor, schoolteacher, courseteacher, stateadvisor, guardian`.
- Run tests with `npx vitest run <path>`. Typecheck the main process with `npx tsc -p tsconfig.main.json --noEmit`.

---

### Task 1: Pure core — types, `isAccountOnAcl`, `evaluateRemoval`

**Files:**
- Create: `src/main/services/orphan-removal.ts`
- Test: `src/main/services/orphan-removal.test.ts`

**Interfaces:**
- Consumes: `AclMember` from `./role-write` (re-exported shape: `{ authorId?, description?, isGroup? }`).
- Produces: `OrphanGrant`, `RemovalSnapshot`, `OrphanRemovalOutcome`, `OrphanRemovalDeps`, `isAccountOnAcl(members, accountId)`, `evaluateRemoval(snapshot)`.

**Why `isAccountOnAcl` exists:** `isIdentityInAcl` in `role-write.ts` skips entries where `isGroup` is true. A person's direct grant on a **room item** is recorded by Hazu with `isGroup: true`. Reusing `isIdentityInAcl` for room verification would report "absent" for access that is still live — the exact failure this feature prevents.

- [ ] **Step 1: Write the failing test**

Create `src/main/services/orphan-removal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isAccountOnAcl, evaluateRemoval } from './orphan-removal';

const member = (authorId: string, description: string, isGroup = false) => ({
  authorId, description, isGroup,
});

describe('isAccountOnAcl', () => {
  it('matches an isGroup=true room-item entry by account id', () => {
    // Hazu records a person's direct grant on a room item with isGroup=true.
    const acl = [member('AcctUid00000000000001', 'orphan@example.invalid', true)];
    expect(isAccountOnAcl(acl, 'AcctUid00000000000001')).toBe(true);
  });

  it('matches a plain isGroup=false group member by account id', () => {
    const acl = [member('AcctUid00000000000001', 'orphan@example.invalid', false)];
    expect(isAccountOnAcl(acl, 'AcctUid00000000000001')).toBe(true);
  });

  it('returns false when the account is absent', () => {
    const acl = [member('SomeoneElse000000001', 'other@example.invalid', true)];
    expect(isAccountOnAcl(acl, 'AcctUid00000000000001')).toBe(false);
  });

  it('returns false for a blank account id, even against a blank ACL entry', () => {
    expect(isAccountOnAcl([member('', 'x@example.invalid')], '')).toBe(false);
  });

  it('tolerates a null/empty member list', () => {
    expect(isAccountOnAcl([], 'AcctUid00000000000001')).toBe(false);
  });
});

describe('evaluateRemoval', () => {
  it('verifies when the account is gone from both', () => {
    expect(evaluateRemoval({ inGroup: false, onRoom: false })).toEqual({
      verified: true,
      surviving: [],
    });
  });

  it('fails and names the group when the group membership survives', () => {
    expect(evaluateRemoval({ inGroup: true, onRoom: false })).toEqual({
      verified: false,
      surviving: ['group'],
    });
  });

  it('fails and names the room item when the room grant survives', () => {
    expect(evaluateRemoval({ inGroup: false, onRoom: true })).toEqual({
      verified: false,
      surviving: ['roomItem'],
    });
  });

  it('fails and names both when nothing was removed', () => {
    expect(evaluateRemoval({ inGroup: true, onRoom: true })).toEqual({
      verified: false,
      surviving: ['group', 'roomItem'],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/services/orphan-removal.test.ts`
Expected: FAIL — `Failed to resolve import "./orphan-removal"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/main/services/orphan-removal.ts`:

```typescript
import { AclMember } from './role-write';

export type GrantKind = 'group' | 'roomItem';

// One place an orphan account's access lives. `itemId` is the role-group id for 'group'
// and the room id for 'roomItem'.
export interface OrphanGrant {
  kind: GrantKind;
  itemId: string;
  title: string;
  aclRole?: string; // room-item entries only: reader / editor
}

export interface RemovalSnapshot {
  inGroup: boolean;
  onRoom: boolean;
}

export interface RemovalVerdict {
  verified: boolean;
  surviving: GrantKind[];
}

// Does this ACL still carry a grant for `accountId`? Unlike isIdentityInAcl in role-write.ts,
// this does NOT skip isGroup entries: Hazu records a person's direct grant on a room item with
// isGroup=true, so skipping them would report absence for access that is still live. Matching is
// by account id only — an orphan has no profile, so there is no local email to match against.
export function isAccountOnAcl(members: AclMember[], accountId: string): boolean {
  const id = (accountId || '').trim().toLowerCase();
  if (!id) return false;
  for (const m of members || []) {
    if ((m.authorId || '').trim().toLowerCase() === id) return true;
  }
  return false;
}

// Access is revoked only when the account is absent from BOTH ACLs. Anything else names what
// survived, so a partial removal is never presented as done.
export function evaluateRemoval(snapshot: RemovalSnapshot): RemovalVerdict {
  const surviving: GrantKind[] = [];
  if (snapshot.inGroup) surviving.push('group');
  if (snapshot.onRoom) surviving.push('roomItem');
  return { verified: surviving.length === 0, surviving };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/services/orphan-removal.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/orphan-removal.ts src/main/services/orphan-removal.test.ts
git commit -m "feat(s6): orphan-removal core predicates and decision table

isAccountOnAcl deliberately does not skip isGroup entries: a person's direct
grant on a room item is recorded with isGroup=true, so the group-skipping
predicate in role-write.ts would report absence for live access."
```

---

### Task 2: Pure core — the `runOrphanRemoval` orchestrator

**Files:**
- Modify: `src/main/services/orphan-removal.ts`
- Test: `src/main/services/orphan-removal.test.ts`

**Interfaces:**
- Consumes: `isRetryableError`, `backoffMs` from `./role-write`; `evaluateRemoval`, `isAccountOnAcl` from Task 1.
- Produces: `runOrphanRemoval(intent, deps, cfg?): Promise<OrphanRemovalOutcome>`, `OrphanRemovalIntent`, `OrphanRemovalDeps`, `OrphanRemovalConfig`.

**Note on verification after a 4xx:** unlike `runReliableRoleWrite`, this always verifies when the ACLs are readable, including after a non-retryable `DELETE` failure. A 404 from `DELETE /acl` plausibly means "already absent", and the read answers the question that matters — is the access gone? — directly.

- [ ] **Step 1: Write the failing test**

First **extend the existing import** at the top of `src/main/services/orphan-removal.test.ts` (do not add a second import statement from the same module):

```typescript
import {
  isAccountOnAcl,
  evaluateRemoval,
  runOrphanRemoval,
  OrphanRemovalDeps,
  OrphanGrant,
} from './orphan-removal';
```

Then append to the same file:

```typescript
const GROUP_GRANT: OrphanGrant = { kind: 'group', itemId: 'grp0000000000000001', title: 'Class A Student' };
const ROOM_GRANT: OrphanGrant = { kind: 'roomItem', itemId: 'room000000000000001', title: 'Class A', aclRole: 'reader' };
const INTENT = {
  accountId: 'AcctUid00000000000001',
  groupId: 'grp0000000000000001',
  roomId: 'room000000000000001',
  grants: [GROUP_GRANT, ROOM_GRANT],
};
const NO_CFG = { maxDeleteAttempts: 3, maxVerifyReads: 2, verifyDelayMs: 0 };

// Builds deps whose ACL reads return a fixed presence answer.
function deps(over: Partial<OrphanRemovalDeps> = {}): OrphanRemovalDeps {
  return {
    deleteFromItem: async () => ({ ok: true, networkOrTimeout: false }),
    readGroupAcl: async () => [],
    readRoomAcl: async () => [],
    sleep: async () => {},
    ...over,
  };
}
const aclWith = (accountId: string) => [{ authorId: accountId, description: '', isGroup: true }];

describe('runOrphanRemoval', () => {
  it('succeeds when both deletes return ok and both ACLs confirm absence', async () => {
    const out = await runOrphanRemoval(INTENT, deps(), NO_CFG);
    expect(out.success).toBe(true);
    expect(out.verifyRan).toBe(true);
    expect(out.surviving).toEqual([]);
  });

  it('succeeds when the delete failed with a 500 but truth says the account is gone', async () => {
    const out = await runOrphanRemoval(
      INTENT,
      deps({ deleteFromItem: async () => ({ ok: false, status: 500, networkOrTimeout: false, error: 'boom' }) }),
      NO_CFG,
    );
    expect(out.success).toBe(true);
    expect(out.deleteOk).toBe(false);
    expect(out.verified).toBe(true);
  });

  it('fails when the deletes returned 2xx but the group membership survives', async () => {
    const out = await runOrphanRemoval(
      INTENT,
      deps({ readGroupAcl: async () => aclWith('AcctUid00000000000001') }),
      NO_CFG,
    );
    expect(out.success).toBe(false);
    expect(out.surviving).toEqual(['group']);
    expect(out.error).toContain('role group');
  });

  it('fails and names the room item when only the room grant survives', async () => {
    const out = await runOrphanRemoval(
      INTENT,
      deps({ readRoomAcl: async () => aclWith('AcctUid00000000000001') }),
      NO_CFG,
    );
    expect(out.success).toBe(false);
    expect(out.surviving).toEqual(['roomItem']);
    expect(out.error).toContain('room item');
  });

  it('retries a 500 up to maxDeleteAttempts per grant', async () => {
    let calls = 0;
    await runOrphanRemoval(
      INTENT,
      deps({
        deleteFromItem: async () => {
          calls += 1;
          return { ok: false, status: 500, networkOrTimeout: false, error: 'boom' };
        },
      }),
      NO_CFG,
    );
    expect(calls).toBe(6); // 3 attempts x 2 grants
  });

  it('does not retry a 4xx', async () => {
    let calls = 0;
    await runOrphanRemoval(
      INTENT,
      deps({
        deleteFromItem: async () => {
          calls += 1;
          return { ok: false, status: 404, networkOrTimeout: false, error: 'not found' };
        },
      }),
      NO_CFG,
    );
    expect(calls).toBe(2); // 1 attempt x 2 grants
  });

  it('still verifies after a 4xx, so an already-absent grant reports success', async () => {
    const out = await runOrphanRemoval(
      INTENT,
      deps({ deleteFromItem: async () => ({ ok: false, status: 404, networkOrTimeout: false, error: 'not found' }) }),
      NO_CFG,
    );
    expect(out.success).toBe(true);
    expect(out.verified).toBe(true);
  });

  it('falls back to the delete status when an ACL read throws', async () => {
    const out = await runOrphanRemoval(
      INTENT,
      deps({ readGroupAcl: async () => null }),
      NO_CFG,
    );
    expect(out.verifyRan).toBe(false);
    expect(out.success).toBe(true); // deletes returned ok, truth unreadable
  });

  it('fails when truth is unreadable and the deletes also failed', async () => {
    const out = await runOrphanRemoval(
      INTENT,
      deps({
        readGroupAcl: async () => null,
        deleteFromItem: async () => ({ ok: false, status: 500, networkOrTimeout: false, error: 'boom' }),
      }),
      NO_CFG,
    );
    expect(out.success).toBe(false);
    expect(out.verifyRan).toBe(false);
  });

  it('treats an empty grant list as success without calling delete', async () => {
    let calls = 0;
    const out = await runOrphanRemoval(
      { ...INTENT, grants: [] },
      deps({ deleteFromItem: async () => { calls += 1; return { ok: true, networkOrTimeout: false }; } }),
      NO_CFG,
    );
    expect(calls).toBe(0);
    expect(out.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/services/orphan-removal.test.ts`
Expected: FAIL — `runOrphanRemoval is not a function` / no export named `runOrphanRemoval`.

- [ ] **Step 3: Write the minimal implementation**

First **extend the existing import** at the top of `src/main/services/orphan-removal.ts` (one import statement per module):

```typescript
import { AclMember, isRetryableError, backoffMs } from './role-write';
```

Then append to the same file:

```typescript
export interface OrphanRemovalIntent {
  accountId: string;
  groupId: string;
  roomId: string;
  grants: OrphanGrant[];
}

export interface OrphanRemovalDeps {
  // One DELETE attempt against an item ACL; classifies its own failure for the retry predicate.
  deleteFromItem: (itemId: string) => Promise<{ ok: boolean; status?: number; networkOrTimeout: boolean; error?: string }>;
  // Read an ACL; null = could not read (HTTP error).
  readGroupAcl: () => Promise<AclMember[] | null>;
  readRoomAcl: () => Promise<AclMember[] | null>;
  sleep: (ms: number) => Promise<void>;
}

export interface OrphanRemovalConfig {
  maxDeleteAttempts?: number;
  maxVerifyReads?: number;
  verifyDelayMs?: number;
}

export interface OrphanRemovalOutcome {
  success: boolean;
  deleteOk: boolean;
  verifyRan: boolean;
  verified: boolean;
  surviving: GrantKind[];
  attempts: number;
  error?: string;
}

const DEFAULT_CFG = { maxDeleteAttempts: 3, maxVerifyReads: 3, verifyDelayMs: 750 };

const LABEL: Record<GrantKind, string> = {
  group: 'role group',
  roomItem: 'room item',
};

// Remove an orphan account's access, then confirm it against the ACLs. All IO injected.
export async function runOrphanRemoval(
  intent: OrphanRemovalIntent,
  deps: OrphanRemovalDeps,
  cfg: OrphanRemovalConfig = {},
): Promise<OrphanRemovalOutcome> {
  const { maxDeleteAttempts, maxVerifyReads, verifyDelayMs } = { ...DEFAULT_CFG, ...cfg };

  // 1. Delete each planned grant, retrying transient failures only.
  let attempts = 0;
  let deleteOk = true;
  let lastError: string | undefined;
  for (const grant of intent.grants) {
    let grantOk = false;
    for (let i = 0; i < maxDeleteAttempts; i++) {
      attempts += 1;
      const r = await deps.deleteFromItem(grant.itemId);
      if (r.ok) {
        grantOk = true;
        break;
      }
      lastError = r.error;
      if (!isRetryableError(r.status, r.networkOrTimeout) || i === maxDeleteAttempts - 1) break;
      await deps.sleep(backoffMs(i));
    }
    if (!grantOk) deleteOk = false;
  }

  // 2. Verify against both ACLs, re-reading through cache lag. Always attempt this, even after a
  //    non-retryable failure: a 404 plausibly means the grant was already absent, and the read
  //    answers the only question that matters — is the access gone?
  let snapshot: RemovalSnapshot | null = null;
  for (let i = 0; i < maxVerifyReads; i++) {
    const groupAcl = await deps.readGroupAcl();
    const roomAcl = await deps.readRoomAcl();
    if (groupAcl === null || roomAcl === null) break; // cannot verify
    snapshot = {
      inGroup: isAccountOnAcl(groupAcl, intent.accountId),
      onRoom: isAccountOnAcl(roomAcl, intent.accountId),
    };
    if (evaluateRemoval(snapshot).verified) break;
    if (i < maxVerifyReads - 1) await deps.sleep(verifyDelayMs);
  }

  // 3. Truth unreadable: fall back to the delete status codes.
  if (snapshot === null) {
    return {
      success: deleteOk,
      deleteOk,
      verifyRan: false,
      verified: false,
      surviving: [],
      attempts,
      error: deleteOk ? undefined : lastError,
    };
  }

  // 4. Truth decides, in both directions.
  const v = evaluateRemoval(snapshot);
  return {
    success: v.verified,
    deleteOk,
    verifyRan: true,
    verified: v.verified,
    surviving: v.surviving,
    attempts,
    error: v.verified
      ? undefined
      : `Access was not fully removed — still present on the ${v.surviving.map((k) => LABEL[k]).join(' and the ')}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/services/orphan-removal.test.ts`
Expected: PASS — 19 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/orphan-removal.ts src/main/services/orphan-removal.test.ts
git commit -m "feat(s6): runOrphanRemoval orchestrator with retry and verification

Truth outranks the delete status in both directions. Unlike the S4 role write,
verification still runs after a non-retryable failure: a 404 plausibly means
the grant was already absent, and the ACL read answers that directly."
```

---

### Task 3: Carry `groupId` through the discrepancy report

**Files:**
- Modify: `src/main/services/discrepancy.ts` (the `DiscrepancyInput.issues` element type, the `Discrepancy` interface, and the issue passthrough loop)
- Modify: `src/main/services/discrepancy.service.ts:37-46` (add `group_id` to the SELECT)
- Modify: `src/main/preload.ts` (the `getDiscrepancies` return type)
- Test: `src/main/services/discrepancy.test.ts`

**Interfaces:**
- Produces: `Discrepancy.groupId?: string` — the renderer uses it to identify which role group a row's access lives in, instead of a three-key lookup.

- [ ] **Step 1: Write the failing test**

Append to `src/main/services/discrepancy.test.ts`, inside the existing `describe('computeDiscrepancies', ...)` block:

```typescript
  it('carries groupId through from membership_issues onto unknown rows', () => {
    const res = computeDiscrepancies({
      rooms: [{ id: 'room1', title: 'Class A', classId: 'cls1' }],
      persons: [],
      assignments: [],
      issues: [{
        type: 'unknown',
        groupId: 'grp0000000000000001',
        roomId: 'room1',
        role: 'student',
        uid: 'AcctUid00000000000001',
        email: 'orphan@example.invalid',
        displayName: 'Orphan Example',
      }],
    });
    expect(res).toHaveLength(1);
    expect(res[0].groupId).toBe('grp0000000000000001');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/services/discrepancy.test.ts`
Expected: FAIL — `expected undefined to be 'grp0000000000000001'`.

- [ ] **Step 3: Update the pre-existing fixture that omits `groupId`**

`membership_issues.group_id` is `NOT NULL`, so `groupId` is required on the input type — which breaks the existing fixture at `src/main/services/discrepancy.test.ts:42-45`. Add the field to both entries:

```typescript
    const issues = [
      { type: 'unknown' as const, groupId: 'grpUnknown000000001', roomId: 'room1', role: 'student', uid: 'u9', email: 'student.two@example.invalid', displayName: 'Student Two' },
      { type: 'unresolved' as const, groupId: 'grpUnresolved000001', roomId: 'room1', role: 'student', uid: 'uidonly', email: null, displayName: 'uidonly' },
    ];
```

That test asserts with `toEqual`, which ignores the new `groupId` on the output objects, so its expectation block needs no change.

- [ ] **Step 4: Add `groupId` to the core**

In `src/main/services/discrepancy.ts`, add to the `Discrepancy` interface after `uid?: string;`:

```typescript
  groupId?: string;
```

In the same file, add to the `DiscrepancyInput.issues` element type after `uid: string;`:

```typescript
    groupId: string;
```

In the issue passthrough loop (the `for (const i of input.issues)` block), add `groupId` to the pushed object after `uid: i.uid,`:

```typescript
      groupId: i.groupId,
```

- [ ] **Step 5: Load it from SQLite**

In `src/main/services/discrepancy.service.ts`, replace the `issues` query and its type annotation:

```typescript
  const issues = db
    .prepare('SELECT type, group_id AS groupId, room_id AS roomId, role, uid, email, display_name AS displayName FROM membership_issues')
    .all() as Array<{
      type: 'unresolved' | 'unknown';
      groupId: string;
      roomId: string;
      role: string;
      uid: string;
      email: string | null;
      displayName: string | null;
    }>;
```

- [ ] **Step 6: Widen the preload type**

In `src/main/preload.ts`, in the `getDiscrepancies` return type, add after `uid?: string;`:

```typescript
        groupId?: string;
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run && npx tsc -p tsconfig.main.json --noEmit`
Expected: all tests PASS, no typecheck output.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/discrepancy.ts src/main/services/discrepancy.service.ts src/main/services/discrepancy.test.ts src/main/preload.ts
git commit -m "feat(s6): carry groupId onto discrepancy rows

The revoke action needs to know which role group a row's access lives in;
carrying the id beats re-deriving it from (uid, room, role)."
```

---

### Task 4: Thin IO service — plan and revoke

**Files:**
- Create: `src/main/services/orphan-removal.service.ts`

**Interfaces:**
- Consumes: `runOrphanRemoval`, `isAccountOnAcl`, `OrphanGrant` (Task 2); `sendApiRequestGetAclInfo`, `sendApiRequestRemoveUser` from `./hazu-api/api`; `getDb` from `../database`.
- Produces: `planOrphanRemoval(accountId, groupId, roomId): Promise<OrphanGrant[]>` and `revokeOrphanAccess(accountId, groupId, roomId): Promise<{ success: boolean; error?: string }>`.

**Note:** this layer has no unit test, matching `role-write.service.ts` — it needs the native module and live HTTP. All decision logic lives in the tested core; this file only wires IO.

- [ ] **Step 1: Write the service**

Create `src/main/services/orphan-removal.service.ts`:

```typescript
import { getDb } from '../database';
import { sendApiRequestGetAclInfo, sendApiRequestRemoveUser } from './hazu-api/api';
import { runOrphanRemoval, isAccountOnAcl, OrphanGrant, OrphanRemovalDeps } from './orphan-removal';
import { AclMember } from './role-write';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function titleFor(table: 'distribution_groups' | 'rooms', id: string): string {
  const row = getDb().prepare(`SELECT title FROM ${table} WHERE id = ?`).get(id) as { title: string } | undefined;
  return row?.title || id;
}

async function readAcl(itemId: string): Promise<AclMember[] | null> {
  try {
    const acl = await sendApiRequestGetAclInfo(itemId);
    return (acl?.data || []) as AclMember[];
  } catch {
    return null;
  }
}

// What would be removed. Reads live ACLs so the confirmation modal can never promise to remove
// a grant that is already gone.
export async function planOrphanRemoval(
  accountId: string,
  groupId: string,
  roomId: string,
): Promise<OrphanGrant[]> {
  const grants: OrphanGrant[] = [];

  const groupAcl = await readAcl(groupId);
  if (groupAcl && isAccountOnAcl(groupAcl, accountId)) {
    grants.push({ kind: 'group', itemId: groupId, title: titleFor('distribution_groups', groupId) });
  }

  const roomAcl = await readAcl(roomId);
  if (roomAcl) {
    const entry = roomAcl.find((m) => (m.authorId || '').trim().toLowerCase() === accountId.trim().toLowerCase());
    if (entry) {
      grants.push({
        kind: 'roomItem',
        itemId: roomId,
        title: titleFor('rooms', roomId),
        aclRole: (entry as { role?: string }).role,
      });
    }
  }

  return grants;
}

// Revoke an orphan account's access to a room, then confirm it against both ACLs.
export async function revokeOrphanAccess(
  accountId: string,
  groupId: string,
  roomId: string,
): Promise<{ success: boolean; error?: string }> {
  const grants = await planOrphanRemoval(accountId, groupId, roomId);

  const deps: OrphanRemovalDeps = {
    deleteFromItem: async (itemId: string) => {
      try {
        const res = await sendApiRequestRemoveUser(itemId, accountId);
        // sendApiRequestRemoveUser swallows its error and returns null on failure.
        if (res === null) return { ok: false, networkOrTimeout: true, error: `DELETE /acl failed for ${itemId}` };
        return { ok: true, networkOrTimeout: false };
      } catch (error: unknown) {
        return {
          ok: false,
          networkOrTimeout: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    readGroupAcl: () => readAcl(groupId),
    readRoomAcl: () => readAcl(roomId),
    sleep,
  };

  const outcome = await runOrphanRemoval({ accountId, groupId, roomId, grants }, deps);

  console.log(
    `[orphan-removal] account=${accountId} room=${roomId} group=${groupId}: ` +
    `success=${outcome.success} deleteOk=${outcome.deleteOk} verifyRan=${outcome.verifyRan} ` +
    `verified=${outcome.verified} surviving=[${outcome.surviving.join(',')}] attempts=${outcome.attempts}` +
    (outcome.error ? ` error=${outcome.error}` : ''),
  );

  // Reconcile local state from truth: the issue row only goes when the access is confirmed gone.
  // Its own try/catch so a SQLite failure cannot flip a real API success.
  if (outcome.success) {
    try {
      getDb()
        .prepare('DELETE FROM membership_issues WHERE uid = ? AND group_id = ? AND room_id = ?')
        .run(accountId, groupId, roomId);
    } catch (err) {
      console.error('[orphan-removal] local reconcile failed for', accountId, roomId, err);
    }
  }

  return { success: outcome.success, error: outcome.error };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/orphan-removal.service.ts
git commit -m "feat(s6): thin IO layer for orphan access removal"
```

---

### Task 5: IPC channels, handlers, and preload

**Files:**
- Modify: `src/shared/ipc-channels.ts` (add two constants next to `TAG_HEAL`)
- Modify: `src/main/preload.ts` (mirror both constants in its local `IPC_CHANNELS`, expose two methods, add two Window types)
- Modify: `src/main/ipc/index.ts` (import the service, add two handlers after the `TAG_HEAL` handler at line 156)

**Interfaces:**
- Consumes: `planOrphanRemoval`, `revokeOrphanAccess` (Task 4).
- Produces: `window.electronAPI.planOrphanRemoval(accountId, groupId, roomId)` and `window.electronAPI.revokeOrphanAccess(accountId, groupId, roomId)`.

**Note:** `src/main/preload.ts` keeps its own copy of the `IPC_CHANNELS` map. Both files must be edited or the channel resolves to `undefined`.

- [ ] **Step 1: Add the channel constants**

In `src/shared/ipc-channels.ts`, after the `TAG_HEAL: 'tagHeal:apply',` line:

```typescript
  ORPHAN_ACCESS_PLAN: 'orphanAccess:plan',
  ORPHAN_ACCESS_REVOKE: 'orphanAccess:revoke',
```

In `src/main/preload.ts`, after its `TAG_HEAL: 'tagHeal:apply',` line, add the identical two lines.

- [ ] **Step 2: Add the handlers**

In `src/main/ipc/index.ts`, add to the import that already pulls in the discrepancy/heal services:

```typescript
import { planOrphanRemoval, revokeOrphanAccess } from '../services/orphan-removal.service';
```

Then after the `TAG_HEAL` handler (which closes at line 156):

```typescript
  ipcMain.handle(
    IPC_CHANNELS.ORPHAN_ACCESS_PLAN,
    async (_event, accountId: string, groupId: string, roomId: string) => {
      try {
        return await planOrphanRemoval(accountId, groupId, roomId);
      } catch (error) {
        console.error('Orphan access plan error:', error);
        throw error;
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.ORPHAN_ACCESS_REVOKE,
    async (_event, accountId: string, groupId: string, roomId: string) => {
      try {
        return await revokeOrphanAccess(accountId, groupId, roomId);
      } catch (error) {
        console.error('Orphan access revoke error:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
```

- [ ] **Step 3: Expose them in preload**

In `src/main/preload.ts`, after the `healTag:` entry in the exposed object:

```typescript
  // Orphan access removal (S6)
  planOrphanRemoval: (accountId: string, groupId: string, roomId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ORPHAN_ACCESS_PLAN, accountId, groupId, roomId),
  revokeOrphanAccess: (accountId: string, groupId: string, roomId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ORPHAN_ACCESS_REVOKE, accountId, groupId, roomId),
```

And in the `Window` interface, after the `healTag:` type:

```typescript
      planOrphanRemoval: (accountId: string, groupId: string, roomId: string) => Promise<Array<{
        kind: 'group' | 'roomItem';
        itemId: string;
        title: string;
        aclRole?: string;
      }>>;
      revokeOrphanAccess: (accountId: string, groupId: string, roomId: string) => Promise<{ success: boolean; error?: string }>;
```

- [ ] **Step 4: Typecheck both projects**

Run: `npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.json --noEmit`
Expected: no output from either.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/ipc/index.ts src/main/preload.ts
git commit -m "feat(s6): IPC channels for orphan access plan and revoke"
```

---

### Task 6: Task Queue task type

**Files:**
- Modify: `src/renderer/contexts/TaskQueueContext.tsx`

**Interfaces:**
- Consumes: `window.electronAPI.revokeOrphanAccess` (Task 5).
- Produces: `addRevokeAccessTask({ accountId, groupId, roomId, roomName, displayName })` on the `useTaskQueue()` context, returning the task id.

- [ ] **Step 1: Add the task type**

In `src/renderer/contexts/TaskQueueContext.tsx`, extend the union on line 4:

```typescript
export type TaskType = 'roleUpdate' | 'createRoom' | 'createPerson' | 'healTag' | 'revokeOrphanAccess';
```

After the `HealTagTask` interface:

```typescript
export interface RevokeOrphanAccessTask extends BaseTask {
  type: 'revokeOrphanAccess';
  accountId: string;
  groupId: string;
  roomId: string;
  roomName: string;
  displayName: string | null;
}
```

Extend the `Task` union and add the input type:

```typescript
export type Task = RoleUpdateTask | CreateRoomTask | CreatePersonTask | HealTagTask | RevokeOrphanAccessTask;
```

```typescript
type AddRevokeAccessInput = Omit<RevokeOrphanAccessTask, 'id' | 'status' | 'type'>;
```

- [ ] **Step 2: Handle it in the queue processor**

In `processQueue`, after the `healTag` branch closes:

```typescript
      } else if (nextTask.type === 'revokeOrphanAccess') {
        const task = nextTask as RevokeOrphanAccessTask;
        const result = await window.electronAPI.revokeOrphanAccess(
          task.accountId,
          task.groupId,
          task.roomId,
        );

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

- [ ] **Step 3: Add the creator and expose it**

After `addHealTagTask`:

```typescript
  // Add revoke-orphan-access task (S6)
  const addRevokeAccessTask = useCallback((taskData: AddRevokeAccessInput) => {
    const id = `revoke-${Date.now()}-${++taskIdCounter.current}`;
    const task: RevokeOrphanAccessTask = { ...taskData, id, type: 'revokeOrphanAccess', status: 'queued' };
    setTasks((prev) => [...prev, task]);
    return id;
  }, []);
```

Add `addRevokeAccessTask: (task: AddRevokeAccessInput) => string;` to `TaskQueueContextType` after `addHealTagTask`, and `addRevokeAccessTask,` to the provider's `value` object.

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/contexts/TaskQueueContext.tsx
git commit -m "feat(s6): revokeOrphanAccess task type in the Task Queue"
```

---

### Task 7: Confirmation modal

**Files:**
- Create: `src/renderer/components/RevokeAccessConfirmationModal.tsx`

**Interfaces:**
- Produces: `RevokeAccessConfirmationModal` with props `{ isOpen, personLabel, roomTitle, grants, onConfirm, onClose }` where `grants: Array<{ kind: 'group' | 'roomItem'; title: string; aclRole?: string }>`.

**Note:** modelled on `HealConfirmationModal`, with the opposite warning. Heal is add-only; this removes access. Use red, not blue, for the confirm button.

- [ ] **Step 1: Write the component**

Create `src/renderer/components/RevokeAccessConfirmationModal.tsx`:

```tsx
import React from 'react';

interface Grant {
  kind: 'group' | 'roomItem';
  title: string;
  aclRole?: string;
}

interface RevokeAccessConfirmationModalProps {
  isOpen: boolean;
  personLabel: string;
  roomTitle: string;
  grants: Grant[];
  onConfirm: () => void;
  onClose: () => void;
}

const KIND_LABEL: Record<Grant['kind'], string> = {
  group: 'Role group',
  roomItem: 'Direct access on the room',
};

export function RevokeAccessConfirmationModal({
  isOpen,
  personLabel,
  roomTitle,
  grants,
  onConfirm,
  onClose,
}: RevokeAccessConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Revoke access?</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            This removes <strong>{personLabel}</strong>&apos;s access to <strong>{roomTitle}</strong>.
            This account has no profile in Hazu.
          </p>

          {grants.length === 0 ? (
            <p className="text-sm text-gray-500">
              No access found — it may already have been removed. Confirming will just clear the row.
            </p>
          ) : (
            <ul className="text-sm text-gray-700 border border-gray-200 rounded divide-y divide-gray-100">
              {grants.map((g, i) => (
                <li key={i} className="px-3 py-2">
                  <span className="text-gray-500">{KIND_LABEL[g.kind]}:</span> {g.title}
                  {g.aclRole ? <span className="text-gray-500"> ({g.aclRole})</span> : null}
                </li>
              ))}
            </ul>
          )}

          <p className="text-sm text-gray-500">
            The removal is verified against Hazu afterwards. If any part of it survives, the row stays
            and the task reports an error.
          </p>
        </div>

        <div className="flex justify-end gap-2 p-6 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700">
            Revoke access
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/RevokeAccessConfirmationModal.tsx
git commit -m "feat(s6): revoke-access confirmation modal"
```

---

### Task 8: Wire the button into the Discrepancies page

**Files:**
- Modify: `src/renderer/pages/DiscrepanciesPage.tsx`

**Interfaces:**
- Consumes: `addRevokeAccessTask` (Task 6), `RevokeAccessConfirmationModal` (Task 7), `window.electronAPI.planOrphanRemoval` (Task 5), `Discrepancy.groupId` (Task 3).

- [ ] **Step 1: Add imports, state, and the `groupId` field**

Add to the imports:

```tsx
import { RevokeAccessConfirmationModal } from '../components/RevokeAccessConfirmationModal';
```

Add `groupId?: string;` to the local `Discrepancy` interface after `uid?: string;`.

Pull `addRevokeAccessTask` from the hook:

```tsx
  const { tasks, addHealTagTask, addRevokeAccessTask } = useTaskQueue();
```

Add state after the `healPlan` state:

```tsx
  const [revokeTarget, setRevokeTarget] = useState<{
    row: Discrepancy;
    grants: Array<{ kind: 'group' | 'roomItem'; title: string; aclRole?: string }>;
  } | null>(null);
```

- [ ] **Step 2: Add the open and confirm handlers**

After `confirmHeal`:

```tsx
  const openRevoke = useCallback(async (row: Discrepancy) => {
    if (!row.uid || !row.groupId) return;
    try {
      const grants = await window.electronAPI.planOrphanRemoval(row.uid, row.groupId, row.roomId);
      if (mountedRef.current) setRevokeTarget({ row, grants });
    } catch (e) {
      if (mountedRef.current) setError(String((e as any)?.message || e));
    }
  }, []);

  const confirmRevoke = useCallback(() => {
    if (!revokeTarget) return;
    const { row } = revokeTarget;
    if (!row.uid || !row.groupId) return;
    const id = addRevokeAccessTask({
      accountId: row.uid,
      groupId: row.groupId,
      roomId: row.roomId,
      roomName: row.roomTitle || row.roomId,
      displayName: row.displayName ?? null,
    });
    enqueuedRef.current = new Set([id]);
    setRevokeTarget(null);
    setWatching(true);
  }, [revokeTarget, addRevokeAccessTask]);
```

The existing `watching` effect already refetches once every enqueued task settles, so no new effect is needed.

- [ ] **Step 3: Add the table column and button**

Add a header cell after the `Note` header:

```tsx
                <th className="px-3 py-2 font-medium"></th>
```

Add a body cell after the `Note` cell:

```tsx
                  <td className="px-3 py-2 text-right">
                    {d.type === 'unknown' && d.uid && d.groupId ? (
                      <button
                        onClick={() => openRevoke(d)}
                        disabled={watching}
                        className={`px-2 py-1 rounded text-xs whitespace-nowrap ${
                          watching
                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            : 'bg-red-600 text-white hover:bg-red-700'
                        }`}
                      >
                        Revoke access
                      </button>
                    ) : null}
                  </td>
```

- [ ] **Step 4: Render the modal**

After the existing `<HealConfirmationModal ... />`:

```tsx
      <RevokeAccessConfirmationModal
        isOpen={revokeTarget !== null}
        personLabel={revokeTarget?.row.displayName || revokeTarget?.row.email || revokeTarget?.row.uid || 'this account'}
        roomTitle={revokeTarget?.row.roomTitle || revokeTarget?.row.roomId || ''}
        grants={revokeTarget?.grants ?? []}
        onConfirm={confirmRevoke}
        onClose={() => setRevokeTarget(null)}
      />
```

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc -p tsconfig.json --noEmit && npm run build`
Expected: no typecheck output; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/pages/DiscrepanciesPage.tsx
git commit -m "feat(s6): per-row revoke access button on the Discrepancies page"
```

---

### Task 9: Full verification and manual acceptance

**Files:** none modified.

- [ ] **Step 1: Run the whole suite and both typechecks**

Run: `npx vitest run && npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.json --noEmit`
Expected: all tests pass (46 pre-existing + 20 new), no typecheck output.

- [ ] **Step 2: Run the person-data guard**

Run: `python3 scripts/check-no-person-data.py --all`
Expected: exit 0, no findings.

- [ ] **Step 3: Build and launch**

Run: `npm run build && npm start`
Expected: the app window opens.

- [ ] **Step 4: Manual acceptance**

1. Sync. Filter Discrepancies to **Unknown person** — expect 9 rows across 6 accounts.
2. Pick a row whose account also holds a direct room-item entry. Click **Revoke access**. Confirm the modal lists **two** grants — a role group and a direct room access.
3. Confirm. Watch the Task Queue panel; expect success.
4. Check the main-process console for one `[orphan-removal] … success=true verified=true surviving=[]` line.
5. Confirm the row disappeared and the Unknown count dropped by one.
6. Pick a row with only a group grant (one of the three canton-room rows). Confirm the modal lists **one** grant, and that it also clears.
7. Re-sync. Confirm the cleared rows do not return.

- [ ] **Step 5: Commit nothing; report results**

Report the Unknown count before and after, and paste the `[orphan-removal]` log lines.

---

## Self-review notes

- **Spec coverage:** every spec section maps to a task — pure core §Architecture → Tasks 1-2; `isAccountOnAcl` trap → Task 1; thin IO + reconcile → Task 4; IPC → Task 5; Task Queue → Task 6; modal → Task 7; page + refetch → Task 8; `groupId` passthrough → Task 3; manual acceptance → Task 9.
- **Deviation from the spec, deliberate:** the spec's decision table implies verification always runs when ACLs are readable. Task 2 makes that explicit and documents why it differs from `runReliableRoleWrite`, which short-circuits on 4xx.
- **Signature note:** `planOrphanRemoval` and `revokeOrphanAccess` take `(accountId, groupId, roomId)` and not `role`. The group id already identifies the role; the local reconcile deletes by `(uid, group_id, room_id)`.
