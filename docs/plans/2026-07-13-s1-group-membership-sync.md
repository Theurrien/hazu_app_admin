# S1 — Group-Membership Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `person_room_assignments` (the Matrix source) from **group ACL membership** instead of profile tags, so the Matrix shows group truth.

**Architecture:** A pure module computes assignments + issues from role-groups and their ACLs (unit-tested); a thin sync step in `sync.service.ts` does the DB I/O and calls it during `runFullSync`, eagerly fetching every synced group's ACL. The old tag-derived assignment path is retired.

**Tech Stack:** Electron main (Node/CommonJS, TypeScript via `tsconfig.main.json`), better-sqlite3, axios. Tests via **vitest** (added in Task 1).

## Global Constraints

- Source of truth = group ACL membership; tags are never an assignment source (see [../hazu-access-model-findings.md](../hazu-access-model-findings.md)).
- Resolve ACL member (account UID) → local person **by email** (case-insensitive). Never silently drop: unresolved (no email) and unknown (email, no local person) go to `membership_issues`.
- Filter out system accounts (`description` ending `@hazu.io`). The Super User admin group is already excluded (it has no `hz-share-<role>-…` tag, so it isn't in `distribution_groups`).
  - Known limitation: `@hazu.io` catches `support@` / `genius@` but **not** the org's own system account (*Système Hazu* = `admin@example.invalid`), which surfaces as an `unknown` issue — benign noise, curated in S2. It is **not** in `persons`, so it never becomes an assignment.
  - Do **not** filter by ACL permission `role` (e.g. exclude `owner`): real **teachers are `owner`** of their teacher groups, so that would drop legitimate members. The email→`persons` join is the correct filter.
- The semantic role and room come from `distribution_groups.role` / `distribution_groups.room_id` — do **not** re-parse tags.
- Eager fetch: one `getAclInfo` per role-group per full sync, sequential (matches existing sync style).
- Golden fixture = class **CUI-C c** (`LkxlSjtb0hnG4TpnvDDr`), student group `KC5ob7INtmW3uDvBJXqa`.

> **Decision to confirm:** this plan adds **vitest** (dev-only) so the pure logic is real-TDD. If you'd rather not add a test framework, say so and I'll convert Task 2's unit tests into a runnable `node` check script instead.

---

## File Structure

- `vitest.config.ts` *(create)* — test runner config (node env, main-process scope).
- `package.json` *(modify)* — add `vitest` devDep + `test` scripts.
- `src/main/services/group-membership.ts` *(create)* — pure logic: types, `resolvePerson`, `isSystemAccount`, `computeGroupAssignments`.
- `src/main/services/group-membership.test.ts` *(create)* — vitest unit tests.
- `src/main/database/schema.sql` *(modify)* — `membership_issues` table.
- `src/main/database/index.ts` *(modify)* — migration + clear-on-sync for `membership_issues`.
- `src/main/services/sync.service.ts` *(modify)* — add `syncGroupMemberships()`, wire into `runFullSync`, remove the tag-path assignment call.

---

### Task 1: Add vitest test harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/main/services/smoke.test.ts` (temporary)

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`
Expected: `vitest` appears in `devDependencies`.

- [ ] **Step 2: Add test scripts to `package.json`**

Add to the `scripts` block:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create a smoke test**

`src/main/services/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: 1 passing test.

- [ ] **Step 6: Delete the smoke test and commit**

```bash
rm src/main/services/smoke.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add vitest harness

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Pure group-membership logic (`group-membership.ts`)

**Files:**
- Create: `src/main/services/group-membership.ts`
- Test: `src/main/services/group-membership.test.ts`

**Interfaces produced:**
- `resolvePerson(member: AclMember, byEmail: Map<string,string>): { personId: string } | { issue: 'unresolved' | 'unknown' }`
- `isSystemAccount(email: string | null | undefined): boolean`
- `computeGroupAssignments(groups: RoleGroup[], getAcl: (id: string) => Promise<{ data: AclMember[] }>, byEmail: Map<string,string>): Promise<ComputeResult>`
- Types: `AclMember`, `RoleGroup`, `GroupAssignment`, `MembershipIssue`, `ComputeResult` (below).

- [ ] **Step 1: Write the failing test**

`src/main/services/group-membership.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolvePerson, isSystemAccount, computeGroupAssignments } from './group-membership';

const student = (authorId: string, description: string) => ({
  authorId, description, displayName: description, isGroup: false, role: 'reader',
});

describe('isSystemAccount', () => {
  it('flags @hazu.io, not real emails', () => {
    expect(isSystemAccount('support@hazu.io')).toBe(true);
    expect(isSystemAccount('student.one@example.invalid')).toBe(false);
    expect(isSystemAccount(null)).toBe(false);
  });
});

describe('resolvePerson', () => {
  const byEmail = new Map([['student.one@example.invalid', '3L0LitHlKovjiK5e3rSN']]);
  it('matches on email (case-insensitive)', () => {
    expect(resolvePerson(student('6Dxet6', 'Student.One@example.invalid'), byEmail)).toEqual({ personId: '3L0LitHlKovjiK5e3rSN' });
  });
  it('uid-only entry is unresolved', () => {
    expect(resolvePerson(student('K3Zgx', 'K3ZgxABxOtcXIzIcRXFzMsYuMh42'), byEmail)).toEqual({ issue: 'unresolved' });
  });
  it('email with no local person is unknown', () => {
    expect(resolvePerson(student('Qfv', 'student.two@example.invalid'), byEmail)).toEqual({ issue: 'unknown' });
  });
});

describe('computeGroupAssignments (CUI-C c fixture)', () => {
  it('resolves members, filters system accounts, records issues', async () => {
    const groups = [{ groupId: 'KC5ob7INtmW3uDvBJXqa', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student' }];
    const acl = {
      data: [
        student('6Dxet6', 'student.one@example.invalid'), // -> assigned
        student('Qfv', 'student.two@example.invalid'),            // -> unknown
        student('K3Zgx', 'K3ZgxABxOtcXIzIcRXFzMsYuMh42'), // -> unresolved (uid-only)
        student('RqoW', 'support@hazu.io'),             // -> filtered
      ],
    };
    const byEmail = new Map([['student.one@example.invalid', '3L0LitHlKovjiK5e3rSN']]);
    const res = await computeGroupAssignments(groups, async () => acl, byEmail);
    expect(res.assignments).toEqual([{ personId: '3L0LitHlKovjiK5e3rSN', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student' }]);
    expect(res.issues).toEqual([
      { type: 'unknown', groupId: 'KC5ob7INtmW3uDvBJXqa', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student', uid: 'Qfv', email: 'student.two@example.invalid', displayName: 'student.two@example.invalid' },
      { type: 'unresolved', groupId: 'KC5ob7INtmW3uDvBJXqa', roomId: 'LkxlSjtb0hnG4TpnvDDr', role: 'student', uid: 'K3Zgx', email: null, displayName: 'K3ZgxABxOtcXIzIcRXFzMsYuMh42' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/services/group-membership.test.ts`
Expected: FAIL — `Cannot find module './group-membership'`.

- [ ] **Step 3: Write the implementation**

`src/main/services/group-membership.ts`:

```ts
export interface AclMember {
  authorId: string;
  description: string;
  displayName: string;
  isGroup: boolean;
  role: string;
}

export interface RoleGroup {
  groupId: string; // distribution_groups.id (the group entity)
  roomId: string;  // distribution_groups.room_id
  role: string;    // distribution_groups.role (semantic: student/schoolteacher/...)
}

export interface GroupAssignment {
  personId: string;
  roomId: string;
  role: string;
}

export interface MembershipIssue {
  type: 'unresolved' | 'unknown';
  groupId: string;
  roomId: string;
  role: string;
  uid: string;
  email: string | null;
  displayName: string;
}

export interface ComputeResult {
  assignments: GroupAssignment[];
  issues: MembershipIssue[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isSystemAccount(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith('@hazu.io');
}

export function resolvePerson(
  member: AclMember,
  byEmail: Map<string, string>,
): { personId: string } | { issue: 'unresolved' | 'unknown' } {
  const email = (member.description || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { issue: 'unresolved' };
  const personId = byEmail.get(email);
  if (!personId) return { issue: 'unknown' };
  return { personId };
}

export async function computeGroupAssignments(
  groups: RoleGroup[],
  getAcl: (id: string) => Promise<{ data: AclMember[] }>,
  byEmail: Map<string, string>,
): Promise<ComputeResult> {
  const assignments: GroupAssignment[] = [];
  const issues: MembershipIssue[] = [];

  for (const g of groups) {
    const acl = await getAcl(g.groupId);
    for (const m of acl?.data || []) {
      if (m.isGroup) continue; // nested group refs are not members
      const rawEmail = (m.description || '').trim();
      if (isSystemAccount(rawEmail)) continue;
      const r = resolvePerson(m, byEmail);
      if ('personId' in r) {
        assignments.push({ personId: r.personId, roomId: g.roomId, role: g.role });
      } else {
        issues.push({
          type: r.issue,
          groupId: g.groupId,
          roomId: g.roomId,
          role: g.role,
          uid: m.authorId,
          email: EMAIL_RE.test(rawEmail.toLowerCase()) ? rawEmail : null,
          displayName: m.displayName || '',
        });
      }
    }
  }

  return { assignments, issues };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/services/group-membership.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/group-membership.ts src/main/services/group-membership.test.ts
git commit -m "feat: pure group-membership resolver (email join + issues)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `membership_issues` table + migration

**Files:**
- Modify: `src/main/database/schema.sql`
- Modify: `src/main/database/index.ts`

- [ ] **Step 1: Add the table to `schema.sql`** (near `distribution_groups`)

```sql
CREATE TABLE IF NOT EXISTS membership_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,          -- 'unresolved' | 'unknown'
    group_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    role TEXT NOT NULL,
    uid TEXT NOT NULL,
    email TEXT,
    display_name TEXT,
    synced_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_membership_issues_room ON membership_issues(room_id);
```

- [ ] **Step 2: Add a migration in `index.ts`** (follow the existing `distribution_groups` migration pattern at [index.ts:86](../../src/main/database/index.ts#L86))

```ts
// Migration: Add membership_issues table
try {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='membership_issues'").all();
  if (t.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS membership_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL, group_id TEXT NOT NULL, room_id TEXT NOT NULL,
        role TEXT NOT NULL, uid TEXT NOT NULL, email TEXT, display_name TEXT,
        synced_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_membership_issues_room ON membership_issues(room_id);
    `);
    console.log('Migration: Added membership_issues table');
  }
} catch (error) {
  console.error('Migration error (membership_issues):', error);
}
```

- [ ] **Step 3: Verify the app still boots**

Run: `npm run build:electron`
Expected: compiles with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/database/schema.sql src/main/database/index.ts
git commit -m "feat: membership_issues table for unresolved/unknown group members

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `syncGroupMemberships()` + wire into sync; retire the tag path

**Files:**
- Modify: `src/main/services/sync.service.ts`

**Interfaces consumed:** `computeGroupAssignments`, `RoleGroup` (Task 2); `sendApiRequestGetAclInfo` (already imported at [sync.service.ts:8](../../src/main/services/sync.service.ts#L8)).

- [ ] **Step 1: Add the import** at the top of `sync.service.ts`

```ts
import { computeGroupAssignments, RoleGroup } from "./group-membership";
```

- [ ] **Step 2: Add `syncGroupMemberships()`** (place after `syncDistributionGroups`)

```ts
async function syncGroupMemberships(): Promise<void> {
  const db = getDb();

  const groups = db
    .prepare("SELECT id AS groupId, room_id AS roomId, role FROM distribution_groups WHERE room_id IS NOT NULL")
    .all() as RoleGroup[];

  const persons = db
    .prepare("SELECT id, lower(email) AS email FROM persons WHERE email IS NOT NULL AND email <> ''")
    .all() as Array<{ id: string; email: string }>;
  const byEmail = new Map<string, string>();
  for (const p of persons) byEmail.set(p.email, p.id);

  syncProgress.message = `Reading membership of ${groups.length} groups...`;
  const { assignments, issues } = await computeGroupAssignments(
    groups,
    sendApiRequestGetAclInfo,
    byEmail,
  );

  const now = Date.now();
  const insA = db.prepare(
    "INSERT OR REPLACE INTO person_room_assignments (person_id, room_id, role, synced_at) VALUES (?, ?, ?, ?)",
  );
  for (const a of assignments) insA.run(a.personId, a.roomId, a.role, now);

  const insI = db.prepare(
    "INSERT INTO membership_issues (type, group_id, room_id, role, uid, email, display_name, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const i of issues) insI.run(i.type, i.groupId, i.roomId, i.role, i.uid, i.email, i.displayName, now);

  syncProgress.assignmentsProcessed = assignments.length;
  console.log(`[SYNC] Group memberships: ${assignments.length} assignments, ${issues.length} issues`);
}
```

- [ ] **Step 3: Wire it into `runFullSync`** — after `await syncDistributionGroups();` ([sync.service.ts:773](../../src/main/services/sync.service.ts#L773)) add:

```ts
    // Step 5: Assignments from group ACL membership (source of truth)
    await syncGroupMemberships();
```

- [ ] **Step 4: Retire the tag-derived assignment source.** In `syncPersonsFromContainers` remove the call `syncPersonRoomAssignments(personSnapshot.key, personTags);` ([sync.service.ts:359](../../src/main/services/sync.service.ts#L359)). Leave the `persons` insert intact (tags are still stored in `persons` for S2).

- [ ] **Step 5: Clear `membership_issues` at sync start.** In `clearOldData()` (near the `DELETE FROM distribution_groups` at [sync.service.ts:84](../../src/main/services/sync.service.ts#L84)) add:

```ts
  db.exec("DELETE FROM membership_issues");
```

- [ ] **Step 6: Build**

Run: `npm run build:electron`
Expected: compiles clean. (If `syncPersonRoomAssignments` / `syncAssignments` are now unused, either delete them or leave them — do not leave a dangling call.)

- [ ] **Step 7: Commit**

```bash
git add src/main/services/sync.service.ts
git commit -m "feat: derive assignments from group ACL membership, retire tag path

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Acceptance — verify against the CUI-C c fixture

**Files:** none (verification only).

- [ ] **Step 1: Build and run a real sync**

Run: `npm run build && npm start`, then in the app: Dashboard → Sync Now (wait for completion).

- [ ] **Step 2: Check the class's assignments came from the group** (not tags)

```bash
sqlite3 "$HOME/Library/Application Support/hazu-admin/hazu-admin.db" -line \
"SELECT p.display_name, pra.role FROM person_room_assignments pra JOIN persons p ON p.id=pra.person_id WHERE pra.room_id='LkxlSjtb0hnG4TpnvDDr' ORDER BY pra.role, p.display_name;"
```
Expected: the student **group's own** members that resolve by email — **Student One, Student Three, Student Four, Student Five** as `student` (4 rows). **Student Six is expected to be ABSENT**: he appears in the *room's* expanded ACL but is **not** in the student group's own membership — that's a room-vs-group discrepancy for S2, not an S1 assignment. Tom is expected in issues, not here.

- [ ] **Step 3: Check the issues were recorded**

```bash
sqlite3 "$HOME/Library/Application Support/hazu-admin/hazu-admin.db" -line \
"SELECT type, role, email, display_name FROM membership_issues WHERE room_id='LkxlSjtb0hnG4TpnvDDr';"
```
Expected: **Student Two → `unknown`** (in the group, no local profile), plus benign infra/cross-domain noise as `unknown` (*Système Hazu* `admin@example.invalid`, *External Admin* `@partner-domain.invalid`) and any uid-only entries as `unresolved`. None of these produce assignments (they aren't in `persons`); S2's report curates the noise.

- [ ] **Step 4: Confirm the Matrix reflects it** — open the Matrix tab, find the `2025 CUI-C c` column, confirm it shows the resolved students (group truth), not the old tag-derived set.

- [ ] **Step 5: Commit any doc note if needed** (no code). Otherwise S1 is done.

---

## Self-Review

- **Spec coverage (S1 section of the spec):** ✅ group-membership sync (`syncGroupMemberships`, Task 4); ✅ `resolvePerson`/email join + filters (Task 2); ✅ unresolved/unknown recorded not dropped (`membership_issues`, Tasks 3–4); ✅ retire tag/`!isGroup` source (Task 4 — note `syncAssignments` was already uncalled); ✅ eager per-group fetch (Task 4). Throttling left sequential (Global Constraints); revisit only if sync is too slow.
- **Placeholder scan:** none — every code/test/command step is concrete.
- **Type consistency:** `RoleGroup`/`AclMember`/`GroupAssignment`/`MembershipIssue` defined in Task 2 and consumed unchanged in Task 4; DB column names match the schema in Task 3; `getAcl` signature matches `sendApiRequestGetAclInfo`'s `Promise<{ data: AclMember[] }>`.
- **Not in S1 (correct):** discrepancy report UI (S2), tag healing (S3), write reliability (S4).

## Execution Handoff

Plan complete and saved to `docs/plans/2026-07-13-s1-group-membership-sync.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task and review between tasks.
2. **Inline Execution** — I execute the tasks in this session with checkpoints for your review.

Which approach? (And confirm the vitest addition, or ask for the runnable-script variant.)
