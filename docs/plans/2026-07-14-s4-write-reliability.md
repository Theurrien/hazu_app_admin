# S4 Write Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make role assign/remove writes reliable and self-verifying — retry transient failures, confirm the change against role-group ACL truth, and reconcile local state from that truth — so the app never falsely reports success.

**Architecture:** Keep the designated `POST /api-v2-admin/update-user-roles` endpoint as the write. Wrap it in a reusable **retry → verify-against-group-truth → reconcile-local** helper, split pure-core (`role-write.ts`, all IO injected, unit-tested) + thin-IO (`role-write.service.ts`). Route the shared `WEBHOOK_UPDATE_USER_ROLE` handler (Matrix + Bulk Import) and person-creation's room-assignment loop through it.

**Tech Stack:** Electron main (Node/CommonJS, `tsconfig.main.json`) + better-sqlite3 + axios, vitest.

**Spec:** `docs/specs/2026-07-14-s4-write-reliability-design.md`

## Global Constraints

Every task's requirements implicitly include these:

- **Keep the designated endpoint.** Write via `POST /api-v2-admin/update-user-roles` with the existing payload. Do NOT write ACLs, groups, or tags directly. Do NOT bypass to `/api-v2-permissions/acl`.
- **Never falsely report success.** `success = postOk && !(verifyRan && !verified)`. A 2xx that truth *contradicts* is a failure; a 2xx we *cannot verify* trusts the 2xx.
- **Reconcile from truth, not intent.** After a 2xx, write local `person_room_assignments` to match what the group ACL actually shows. On a non-2xx (write never succeeded), do NOT reconcile.
- **Retry only transient failures.** 5xx / network / timeout retried with backoff; 4xx fails fast.
- **Verify by email, like S1.** Match the person's `persons.email` (lowercased) against role-group ACL entries (skip `isGroup` entries). No account-UID storage introduced.
- **Pure-core + thin-IO.** `role-write.ts` has no DB/HTTP imports (all IO injected) and runs under vitest without the better-sqlite3 native module.
- **Semantic roles.** `student, companymentor, schoolteacher, courseteacher, stateadvisor, guardian`; "none" is `'_'` / `null`.
- **Defaults (verbatim):** `maxWriteAttempts = 3`, `backoffMs(n) = 500 * 2^n`, `maxVerifyReads = 3`, `verifyDelayMs = 750`.

**Commands:**
- Focused test: `npx vitest run src/main/services/role-write.test.ts`
- All tests: `npm test`
- Main typecheck: `npm run build:electron`
- Full build: `npm run build`

---

## File Structure

**Create**
- `src/main/services/role-write.ts` — pure core: `isRetryableError`, `backoffMs`, `evaluateVerification`, `runReliableRoleWrite` (injected deps), and all types. Zero DB/HTTP imports.
- `src/main/services/role-write.test.ts` — vitest for the pure core.
- `src/main/services/role-write.service.ts` — `reliableUpdateUserRole` (gather templateId/email/group-ids, build real deps, run the orchestrator, reconcile local DB).

**Modify**
- `src/main/ipc/index.ts` — import the service; shrink `WEBHOOK_UPDATE_USER_ROLE` to a thin caller; route person-creation Step-2 through the helper.

---

### Task 1: Pure orchestrator core (`role-write.ts` + tests)

**Files:**
- Create: `src/main/services/role-write.ts`
- Test: `src/main/services/role-write.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces (used by Task 2):
  ```ts
  export interface RoleWriteIntent { oldRole: string | null; newRole: string | null; }
  export interface GroupMembershipSnapshot { inNewGroup: boolean; inOldGroup: boolean; }
  export interface VerifyResult { verified: boolean; reconciledRole: string | null; partial: boolean; }
  export interface RoleWriteOutcome {
    success: boolean; postOk: boolean; verifyRan: boolean; verified: boolean;
    reconciledRole: string | null; partial: boolean; attempts: number; error?: string;
  }
  export interface RoleWriteDeps {
    postUpdateRoles: () => Promise<{ ok: boolean; status?: number; networkOrTimeout: boolean; error?: string }>;
    readMembership: () => Promise<GroupMembershipSnapshot | null>;
    sleep: (ms: number) => Promise<void>;
  }
  export interface RoleWriteConfig { maxWriteAttempts?: number; maxVerifyReads?: number; verifyDelayMs?: number; }
  export function isRetryableError(status: number | undefined, networkOrTimeout: boolean): boolean;
  export function backoffMs(attempt: number): number;
  export function evaluateVerification(intent: RoleWriteIntent, snapshot: GroupMembershipSnapshot): VerifyResult;
  export function runReliableRoleWrite(intent: RoleWriteIntent, deps: RoleWriteDeps, cfg?: RoleWriteConfig): Promise<RoleWriteOutcome>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/main/services/role-write.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  isRetryableError,
  backoffMs,
  evaluateVerification,
  runReliableRoleWrite,
  RoleWriteDeps,
  GroupMembershipSnapshot,
} from './role-write';

const noSleep = async () => {};

describe('isRetryableError', () => {
  it('retries 5xx and network/timeout, not 4xx', () => {
    expect(isRetryableError(500, false)).toBe(true);
    expect(isRetryableError(503, false)).toBe(true);
    expect(isRetryableError(400, false)).toBe(false);
    expect(isRetryableError(404, false)).toBe(false);
    expect(isRetryableError(undefined, true)).toBe(true);
    expect(isRetryableError(undefined, false)).toBe(false);
  });
});

describe('backoffMs', () => {
  it('grows exponentially from 500ms', () => {
    expect(backoffMs(0)).toBe(500);
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
  });
});

describe('evaluateVerification', () => {
  it('assign: verified iff in the new-role group', () => {
    expect(evaluateVerification({ oldRole: '_', newRole: 'student' }, { inNewGroup: true, inOldGroup: false }))
      .toEqual({ verified: true, reconciledRole: 'student', partial: false });
    expect(evaluateVerification({ oldRole: '_', newRole: 'student' }, { inNewGroup: false, inOldGroup: false }))
      .toEqual({ verified: false, reconciledRole: null, partial: false });
  });

  it('remove: verified iff absent from the old-role group', () => {
    expect(evaluateVerification({ oldRole: 'student', newRole: '_' }, { inNewGroup: false, inOldGroup: false }))
      .toEqual({ verified: true, reconciledRole: null, partial: false });
    expect(evaluateVerification({ oldRole: 'student', newRole: '_' }, { inNewGroup: false, inOldGroup: true }))
      .toEqual({ verified: false, reconciledRole: 'student', partial: false });
  });

  it('change: verified iff in new and not in old; flags partial when half-applied', () => {
    const intent = { oldRole: 'student', newRole: 'companymentor' };
    expect(evaluateVerification(intent, { inNewGroup: true, inOldGroup: false }))
      .toEqual({ verified: true, reconciledRole: 'companymentor', partial: false });
    expect(evaluateVerification(intent, { inNewGroup: true, inOldGroup: true }))
      .toEqual({ verified: false, reconciledRole: 'companymentor', partial: true });
    expect(evaluateVerification(intent, { inNewGroup: false, inOldGroup: true }))
      .toEqual({ verified: false, reconciledRole: 'student', partial: false });
    expect(evaluateVerification(intent, { inNewGroup: false, inOldGroup: false }))
      .toEqual({ verified: false, reconciledRole: null, partial: true });
  });
});

describe('runReliableRoleWrite', () => {
  const assign = { oldRole: '_', newRole: 'student' };
  const okMembership = async (): Promise<GroupMembershipSnapshot> => ({ inNewGroup: true, inOldGroup: false });

  it('retries a transient 5xx then succeeds, and verifies', async () => {
    let calls = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => {
        calls += 1;
        if (calls < 3) return { ok: false, status: 503, networkOrTimeout: false, error: 'boom' };
        return { ok: true, networkOrTimeout: false };
      },
      readMembership: okMembership,
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(out.attempts).toBe(3);
    expect(out).toMatchObject({ success: true, postOk: true, verifyRan: true, verified: true, reconciledRole: 'student' });
  });

  it('does not retry a 4xx', async () => {
    let calls = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => { calls += 1; return { ok: false, status: 400, networkOrTimeout: false, error: 'bad' }; },
      readMembership: okMembership,
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(calls).toBe(1);
    expect(out).toMatchObject({ success: false, postOk: false, verifyRan: false, error: 'bad' });
  });

  it('fails when the write is 2xx but truth never confirms', async () => {
    let reads = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => ({ ok: true, networkOrTimeout: false }),
      readMembership: async () => { reads += 1; return { inNewGroup: false, inOldGroup: false }; },
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(reads).toBe(3);
    expect(out).toMatchObject({ success: false, postOk: true, verifyRan: true, verified: false, reconciledRole: null });
  });

  it('trusts the 2xx when truth cannot be read (verifyRan false)', async () => {
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => ({ ok: true, networkOrTimeout: false }),
      readMembership: async () => null,
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(out).toMatchObject({ success: true, postOk: true, verifyRan: false, verified: false, reconciledRole: 'student' });
  });

  it('stops verifying as soon as truth confirms (cache lag)', async () => {
    let reads = 0;
    const deps: RoleWriteDeps = {
      postUpdateRoles: async () => ({ ok: true, networkOrTimeout: false }),
      readMembership: async () => { reads += 1; return { inNewGroup: reads >= 2, inOldGroup: false }; },
      sleep: noSleep,
    };
    const out = await runReliableRoleWrite(assign, deps);
    expect(reads).toBe(2);
    expect(out).toMatchObject({ success: true, verified: true, reconciledRole: 'student' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/services/role-write.test.ts`
Expected: FAIL — `Cannot find module './role-write'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/services/role-write.ts`:

```ts
export interface RoleWriteIntent {
  oldRole: string | null;
  newRole: string | null;
}

export interface GroupMembershipSnapshot {
  inNewGroup: boolean;
  inOldGroup: boolean;
}

export interface VerifyResult {
  verified: boolean;
  reconciledRole: string | null;
  partial: boolean;
}

export interface RoleWriteOutcome {
  success: boolean;
  postOk: boolean;
  verifyRan: boolean;
  verified: boolean;
  reconciledRole: string | null;
  partial: boolean;
  attempts: number;
  error?: string;
}

export interface RoleWriteDeps {
  // One POST attempt; classifies its own failure for the retry predicate.
  postUpdateRoles: () => Promise<{ ok: boolean; status?: number; networkOrTimeout: boolean; error?: string }>;
  // Read current group truth; null = could not read (missing local group / ACL read error).
  readMembership: () => Promise<GroupMembershipSnapshot | null>;
  sleep: (ms: number) => Promise<void>;
}

export interface RoleWriteConfig {
  maxWriteAttempts?: number;
  maxVerifyReads?: number;
  verifyDelayMs?: number;
}

const DEFAULT_CFG = { maxWriteAttempts: 3, maxVerifyReads: 3, verifyDelayMs: 750 };

function isRealRole(role: string | null): boolean {
  return role != null && role !== '_' && role !== '';
}

// Retry only transient failures: any 5xx, or a network/timeout error. Never a 4xx (deterministic).
export function isRetryableError(status: number | undefined, networkOrTimeout: boolean): boolean {
  if (networkOrTimeout) return true;
  if (status === undefined) return false;
  return status >= 500 && status <= 599;
}

// Exponential backoff for 0-indexed attempt: 500, 1000, 2000, ...
export function backoffMs(attempt: number): number {
  return 500 * Math.pow(2, attempt);
}

// Decide verification + the role local state should be reconciled to, from group truth.
export function evaluateVerification(intent: RoleWriteIntent, snapshot: GroupMembershipSnapshot): VerifyResult {
  const wantNew = isRealRole(intent.newRole);
  const wantOldGone = isRealRole(intent.oldRole) && intent.oldRole !== intent.newRole;
  const { inNewGroup, inOldGroup } = snapshot;

  const newOk = wantNew ? inNewGroup : true;
  const oldOk = wantOldGone ? !inOldGroup : true;
  const verified = newOk && oldOk;

  const reconciledRole =
    inNewGroup && wantNew
      ? intent.newRole
      : inOldGroup && isRealRole(intent.oldRole)
        ? intent.oldRole
        : null;

  const isChange = wantNew && wantOldGone;
  const partial = isChange && !verified && (inNewGroup || !inOldGroup);

  return { verified, reconciledRole, partial };
}

// Orchestrate retry + verify with all IO injected. The unit-tested heart of S4.
export async function runReliableRoleWrite(
  intent: RoleWriteIntent,
  deps: RoleWriteDeps,
  cfg: RoleWriteConfig = {},
): Promise<RoleWriteOutcome> {
  const { maxWriteAttempts, maxVerifyReads, verifyDelayMs } = { ...DEFAULT_CFG, ...cfg };

  // 1. Write with retry on transient failures only.
  let attempts = 0;
  let postOk = false;
  let lastError: string | undefined;
  while (attempts < maxWriteAttempts) {
    attempts += 1;
    const r = await deps.postUpdateRoles();
    if (r.ok) {
      postOk = true;
      break;
    }
    lastError = r.error;
    if (!isRetryableError(r.status, r.networkOrTimeout) || attempts >= maxWriteAttempts) break;
    await deps.sleep(backoffMs(attempts - 1));
  }

  if (!postOk) {
    return { success: false, postOk: false, verifyRan: false, verified: false, reconciledRole: null, partial: false, attempts, error: lastError };
  }

  // 2. Verify against group truth, re-reading through cache lag.
  let snapshot: GroupMembershipSnapshot | null = null;
  let verifyRan = false;
  for (let i = 0; i < maxVerifyReads; i++) {
    const s = await deps.readMembership();
    if (s === null) break; // cannot verify (missing group / read error)
    snapshot = s;
    verifyRan = true;
    if (evaluateVerification(intent, s).verified) break;
    if (i < maxVerifyReads - 1) await deps.sleep(verifyDelayMs);
  }

  // 3. Could not verify -> trust the 2xx; reconcile optimistically to intent.
  if (!verifyRan || snapshot === null) {
    const optimistic = isRealRole(intent.newRole) ? intent.newRole : null;
    return { success: true, postOk: true, verifyRan: false, verified: false, reconciledRole: optimistic, partial: false, attempts };
  }

  // 4. Decide from truth.
  const v = evaluateVerification(intent, snapshot);
  return {
    success: v.verified, // == postOk && !(verifyRan && !verified) when verifyRan
    postOk: true,
    verifyRan: true,
    verified: v.verified,
    reconciledRole: v.reconciledRole,
    partial: v.partial,
    attempts,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/services/role-write.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS. Existing `role-write`, `tag-healing`, `discrepancy`, and `group-membership` tests all green. (A pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning for `postcss.config.js` may print — not a failure, out of scope.)

- [ ] **Step 6: Commit**

```bash
git add src/main/services/role-write.ts src/main/services/role-write.test.ts
git commit -m "feat(s4): pure retry+verify orchestrator core (role-write.ts)"
```

---

### Task 2: Thin service + wire both write paths

**Files:**
- Create: `src/main/services/role-write.service.ts`
- Modify: `src/main/ipc/index.ts`

**Interfaces:**
- Consumes (from Task 1): `runReliableRoleWrite`, `RoleWriteDeps`, `GroupMembershipSnapshot` from `./role-write`.
- Consumes (existing): `getDb` from `../database`; `getApiEndpoint`, `getApiKey` from `./hazu-api/config`; `sendApiRequestGetAclInfo` from `./hazu-api/api` (returns `{ data: Array<{ authorId; description; displayName; isGroup; role }> }`).
- Produces (used by the handlers):
  ```ts
  export interface RoleWriteResult { success: boolean; verified: boolean; reconciledRole: string | null; attempts: number; error?: string; }
  export function reliableUpdateUserRole(personId: string, roomId: string, oldRole: string | null, newRole: string | null): Promise<RoleWriteResult>;
  ```
- No unit tests: DB/HTTP-bound glue, verified by `npm run build:electron`, per the S2/S3 precedent (the risky orchestration logic is already unit-tested in Task 1). The end-to-end path is exercised in Task 3.

- [ ] **Step 1: Create the service**

Create `src/main/services/role-write.service.ts`:

```ts
import axios from 'axios';
import { getDb } from '../database';
import { getApiEndpoint, getApiKey } from './hazu-api/config';
import { sendApiRequestGetAclInfo } from './hazu-api/api';
import { runReliableRoleWrite, RoleWriteDeps, GroupMembershipSnapshot } from './role-write';

export interface RoleWriteResult {
  success: boolean;
  verified: boolean;
  reconciledRole: string | null;
  attempts: number;
  error?: string;
}

function isRealRole(role: string | null): boolean {
  return role != null && role !== '_' && role !== '';
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Reliable role write: retry the designated update-user-roles endpoint, verify against the
// role-group ACL (by email, like S1), and reconcile local person_room_assignments from truth.
export async function reliableUpdateUserRole(
  personId: string,
  roomId: string,
  oldRole: string | null,
  newRole: string | null,
): Promise<RoleWriteResult> {
  const db = getDb();

  const adminRow = db.prepare("SELECT value FROM settings WHERE key = 'admin_id'").get() as { value: string } | undefined;
  const templateId = adminRow?.value;
  if (!templateId) {
    return { success: false, verified: false, reconciledRole: null, attempts: 0, error: 'Admin ID not found. Please run sync first.' };
  }

  const personRow = db.prepare('SELECT email FROM persons WHERE id = ?').get(personId) as { email: string | null } | undefined;
  const email = (personRow?.email || '').trim().toLowerCase();

  const groupIdFor = (role: string | null): string | null => {
    if (!isRealRole(role)) return null;
    const row = db.prepare('SELECT id FROM distribution_groups WHERE room_id = ? AND role = ?').get(roomId, role) as { id: string } | undefined;
    return row?.id ?? null;
  };
  const newGroupId = groupIdFor(newRole);
  const oldGroupId = groupIdFor(oldRole);

  const token = getApiKey();
  const headers = token.length <= 20 ? { token } : { 'x-api-key': token };
  const payload = {
    templateId,
    profileId: personId,
    userTypesInfo: [{ classId: roomId, oldUserType: oldRole || '_', newUserType: newRole || '_' }],
  };

  const isMember = async (groupId: string | null): Promise<boolean> => {
    if (!groupId || !email) return false;
    const acl = await sendApiRequestGetAclInfo(groupId);
    for (const m of acl?.data || []) {
      if (m.isGroup) continue;
      if ((m.description || '').trim().toLowerCase() === email) return true;
    }
    return false;
  };

  const deps: RoleWriteDeps = {
    postUpdateRoles: async () => {
      try {
        await axios.post(`https://${getApiEndpoint()}/api-v2-admin/update-user-roles`, payload, { headers, timeout: 120000 });
        return { ok: true, networkOrTimeout: false };
      } catch (error: unknown) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const networkOrTimeout = !error.response || error.code === 'ECONNABORTED';
          return { ok: false, status, networkOrTimeout, error: error.response?.data?.message || error.message };
        }
        return { ok: false, networkOrTimeout: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    readMembership: async (): Promise<GroupMembershipSnapshot | null> => {
      // Cannot verify if a group we need isn't synced locally.
      if (isRealRole(newRole) && !newGroupId) return null;
      if (isRealRole(oldRole) && oldRole !== newRole && !oldGroupId) return null;
      try {
        const inNewGroup = await isMember(newGroupId);
        const inOldGroup = await isMember(oldGroupId);
        return { inNewGroup, inOldGroup };
      } catch {
        return null; // ACL read failure -> cannot verify
      }
    },
    sleep,
  };

  const outcome = await runReliableRoleWrite({ oldRole, newRole }, deps);

  // Reconcile local person_room_assignments from truth, only when the write reached 2xx.
  if (outcome.postOk) {
    if (isRealRole(outcome.reconciledRole)) {
      db.prepare(
        'INSERT OR REPLACE INTO person_room_assignments (person_id, room_id, role, synced_at) VALUES (?, ?, ?, ?)',
      ).run(personId, roomId, outcome.reconciledRole, Date.now());
    } else {
      db.prepare('DELETE FROM person_room_assignments WHERE person_id = ? AND room_id = ?').run(personId, roomId);
    }
  }

  return {
    success: outcome.success,
    verified: outcome.verified,
    reconciledRole: outcome.reconciledRole,
    attempts: outcome.attempts,
    error: outcome.error,
  };
}
```

- [ ] **Step 2: Import the service in the IPC module**

In `src/main/ipc/index.ts`, add after the tag-healing service import (line 10, `import { getTagHealPlan, healPersonTag } from '../services/tag-healing.service';`):

```ts
import { reliableUpdateUserRole } from '../services/role-write.service';
```

- [ ] **Step 3: Replace the `WEBHOOK_UPDATE_USER_ROLE` handler**

In `src/main/ipc/index.ts`, replace the entire handler block (currently lines 788-855 — from `ipcMain.handle(` through its closing `);`) with:

```ts
  ipcMain.handle(
    IPC_CHANNELS.WEBHOOK_UPDATE_USER_ROLE,
    async (
      _event,
      personId: string,
      roomId: string,
      oldRole: string | null,
      newRole: string | null
    ) => {
      try {
        // S4: retry + verify against role-group truth + reconcile local from truth.
        // Returns success:false when the write can't be confirmed (no more false successes).
        const result = await reliableUpdateUserRole(personId, roomId, oldRole, newRole);
        return { success: result.success, error: result.error };
      } catch (error) {
        console.error('Update user role error:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
```

(The local `person_room_assignments` write the old handler did is now done inside `reliableUpdateUserRole` — reconciled from truth. The Task-Queue contract `{ success, error? }` is unchanged, so the renderer needs no edit; a 2xx that truth contradicts now correctly returns `success:false` and the Matrix cell reverts.)

- [ ] **Step 4: Route person-creation Step-2 through the helper**

In `src/main/ipc/index.ts`, replace the person-creation Step-2 loop (currently lines 1052-1073 — the `// Step 2: Assign rooms via update-user-roles` comment through the loop's closing `}`) with:

```ts
        // Step 2: Assign rooms via the hardened write (retry + verify + reconcile local).
        for (const roomId of params.roomIds) {
          const assignResult = await reliableUpdateUserRole(profileId, roomId, '_', params.role);
          if (!assignResult.success) {
            console.error('[CREATE_PERSON] Room assignment failed for', roomId, assignResult.error);
          }
        }
```

(Removes the inline `rolePayload` + `axios.post` + `run(INSERT ...)`; the local assignment write now happens inside the helper. Room-assignment failures stay non-fatal — the person is already created. `adminId` / `headers` / `getApiEndpoint` remain used by Step 1 above, so no unused-variable errors.)

- [ ] **Step 5: Typecheck the main process**

Run: `npm run build:electron`
Expected: exits 0, no TypeScript errors. (Verifies the service, the injected-deps wiring against Task 1's types, and both handler edits compile.)

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS (unchanged from Task 1 — no renderer/test files touched here).

- [ ] **Step 7: Commit**

```bash
git add src/main/services/role-write.service.ts src/main/ipc/index.ts
git commit -m "feat(s4): reliable role-write service; route Matrix/Bulk-Import + person-creation through it"
```

---

### Task 3: Manual acceptance (user-run)

Not an implementer task — run by the human after Tasks 1-2 are merged/built.

- [ ] **Step 1: Build and start**

```bash
npm run build && npm start
```

- [ ] **Step 2: Matrix assign verifies and persists**

Matrix tab → change a cell to a role. It succeeds, the cell sticks, and a fresh Matrix load still shows it (reconciled from group truth, not just optimism).

- [ ] **Step 3: Failure no longer reports false success**

Observe the console/logs during edits: a transient 5xx is retried (up to 3 attempts); a write that never confirms against the group ACL returns an error and the cell **reverts** (instead of the old silent "success" + orphan-tag). If you can reproduce a deterministic failure (e.g. the known Matthieu→CIE case), confirm it now reports an error rather than a false success.

- [ ] **Step 4: Bulk-Import Assignment**

Bulk Import → Assignment → run a batch. The Task Queue reflects real per-row success/failure; verified rows persist after a reload.

- [ ] **Step 5: Person creation with rooms**

Create a person with one or more rooms. Assignments are retried/verified; a failed one is logged (non-fatal) and the person is still created.

---

## Notes for the executor

- **Do not bypass to `/api-v2-permissions/acl`** and do not add direct ACL/group/tag writes — S4 only hardens the existing `update-user-roles` call.
- **`role-write.ts` stays pure** — no `axios`, no `getDb`, no `Date.now()`; all IO and the clock arrive through injected deps (that's what makes it unit-testable without the native module).
- **Reconcile only on `postOk`.** A write that never reached 2xx must not touch local `person_room_assignments` (truth is unchanged; the renderer reverts the optimistic cell).
- **Behavior change is intentional:** the handler now returns `success:false` when a 2xx can't be verified against truth. This is the whole point (no more false successes); the renderer's existing `onError` revert handles it.
- **`docs/` is gitignored** — commit this plan/spec with `git add -f`. Implementer commits (source) are unaffected.
```
