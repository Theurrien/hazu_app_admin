# S2 — Discrepancy Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only "Discrepancies" report that surfaces, per (room, role), where profile tags and group-ACL truth disagree — so drift is visible before S3 heals it.

**Architecture:** A pure module (`discrepancy.ts`) computes typed discrepancies from plain in-memory data (unit-tested, no DB). A thin service (`discrepancy.service.ts`) loads that data from local SQLite and calls the pure function. One IPC channel exposes it; a dedicated sidebar tab renders it. Mirrors S1's pure-core + thin-IO split.

**Tech Stack:** Electron main (Node/CommonJS via `tsconfig.main.json`), better-sqlite3, React 18 + Vite renderer, Tailwind, vitest (added in S1).

## Global Constraints

- **Group truth vs. tag breadcrumb.** `person_room_assignments` (populated from group ACL membership by S1) is the truth; a person's `hz-config-class-<classId>-<role>` profile tag is a breadcrumb. A discrepancy is a divergence between them. See [../hazu-access-model-findings.md](../hazu-access-model-findings.md).
- **Read-only.** S2 computes and displays only. It writes nothing — no tags, no membership, no new DB table. (Healing missing tags is S3.)
- **Tag→room mapping (exact):** parse `hz-config-class-<classId>-<role>` by splitting on the **LAST** hyphen (mirroring the retired `parseAssignmentTag`/`syncPersonRoomAssignments` at [sync.service.ts:380](../../src/main/services/sync.service.ts#L380)); the `<role>` must be one of `student, companymentor, schoolteacher, courseteacher, stateadvisor, guardian`; map `<classId>` → room via **`rooms.class_id`** (NOT `rooms.id`).
- **Reuse S1's issues.** `unresolved` and `unknown` discrepancies are **not** recomputed — they are read from the `membership_issues` table that S1's sync already populates (`type` column = `'unresolved' | 'unknown'`).
- **No silent drops.** A breadcrumb tag whose `<classId>` matches no local room is still reported (as `orphan-tag`, with a `note`), never discarded.
- **Scope = exactly four types:** `orphan-tag`, `missing-tag`, `unresolved`, `unknown`. **`room-vs-group` is OUT of S2** (it needs each room's expanded ACL, which S1 does not store) — deferred to a follow-up.
- **Discrepancy shape:** `{ type, roomId, roomTitle, role, personId?, email?, uid?, displayName?, note? }`.
- **Pure module imports no DB.** `discrepancy.ts` must not import `../database` (keeps vitest runnable without the better-sqlite3 native module — same rule that kept `group-membership.ts` testable).
- **UI:** a dedicated **"Discrepancies"** sidebar tab. The renderer's `Page` union is duplicated in **both** `App.tsx` and `Sidebar.tsx` — both must be edited.

---

## File Structure

- `src/main/services/discrepancy.ts` *(create)* — pure logic: types, `parseClassTag`, `computeDiscrepancies`.
- `src/main/services/discrepancy.test.ts` *(create)* — vitest unit tests.
- `src/main/services/discrepancy.service.ts` *(create)* — `getDiscrepancies()`: loads DB rows, calls the pure function.
- `src/shared/ipc-channels.ts` *(modify)* — add `DISCREPANCIES_GET`.
- `src/main/preload.ts` *(modify)* — inline channel copy + `getDiscrepancies` method + `Window` type.
- `src/main/ipc/index.ts` *(modify)* — register the handler.
- `src/renderer/pages/DiscrepanciesPage.tsx` *(create)* — the report UI.
- `src/renderer/App.tsx` *(modify)* — `Page` union + import + switch case.
- `src/renderer/components/layout/Sidebar.tsx` *(modify)* — `Page` union + nav item + icon import.

---

### Task 1: Pure discrepancy logic (`discrepancy.ts`)

**Files:**
- Create: `src/main/services/discrepancy.ts`
- Test: `src/main/services/discrepancy.test.ts`

**Interfaces produced (consumed by Task 2):**
- `parseClassTag(tag: string): { classId: string; role: string } | null`
- `computeDiscrepancies(input: DiscrepancyInput): Discrepancy[]`
- Types: `DiscrepancyType`, `Discrepancy`, `DiscrepancyInput`.

- [ ] **Step 1: Write the failing test**

`src/main/services/discrepancy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseClassTag, computeDiscrepancies } from './discrepancy';

describe('parseClassTag', () => {
  it('splits on the LAST hyphen and validates the role', () => {
    expect(parseClassTag('hz-config-class-LkxlSjtb0hnG4TpnvDDr-student')).toEqual({
      classId: 'LkxlSjtb0hnG4TpnvDDr',
      role: 'student',
    });
    expect(parseClassTag('hz-config-class-abc-notarole')).toBeNull(); // unknown role
    expect(parseClassTag('hz-share-student-abc')).toBeNull();         // wrong prefix
    expect(parseClassTag('hz-config-class-nohyphen')).toBeNull();     // no role segment
  });
});

describe('computeDiscrepancies', () => {
  const rooms = [
    { id: 'room1', title: 'CUI-C c', classId: 'class1' },
    { id: 'room2', title: 'CIE X', classId: 'class2' },
  ];

  it('flags orphan-tag + missing-tag, carries unresolved/unknown, ignores consistent rows', () => {
    const persons = [
      // consistent: tag AND assignment for (room1, student) -> NO discrepancy
      { id: 'pA', displayName: 'Alice', email: 'alice@example.invalid', tags: ['hz-config-class-class1-student'] },
      // orphan-tag: tag for (room2, student) but no assignment
      { id: 'pB', displayName: 'Bob', email: 'bob@example.invalid', tags: ['hz-config-class-class2-student'] },
      // missing-tag: assigned (room1, schoolteacher) below but no tag
      { id: 'pC', displayName: 'Carol', email: 'carol@example.invalid', tags: [] },
    ];
    const assignments = [
      { personId: 'pA', roomId: 'room1', role: 'student' },
      { personId: 'pC', roomId: 'room1', role: 'schoolteacher' },
    ];
    const issues = [
      { type: 'unknown' as const, roomId: 'room1', role: 'student', uid: 'u9', email: 'student.two@example.invalid', displayName: 'Student Two' },
      { type: 'unresolved' as const, roomId: 'room1', role: 'student', uid: 'uidonly', email: null, displayName: 'uidonly' },
    ];
    const res = computeDiscrepancies({ rooms, persons, assignments, issues });
    expect(res).toEqual([
      { type: 'orphan-tag', roomId: 'room2', roomTitle: 'CIE X', role: 'student', personId: 'pB', email: 'bob@example.invalid', displayName: 'Bob' },
      { type: 'missing-tag', roomId: 'room1', roomTitle: 'CUI-C c', role: 'schoolteacher', personId: 'pC', email: 'carol@example.invalid', displayName: 'Carol' },
      { type: 'unresolved', roomId: 'room1', roomTitle: 'CUI-C c', role: 'student', uid: 'uidonly', email: null, displayName: 'uidonly' },
      { type: 'unknown', roomId: 'room1', roomTitle: 'CUI-C c', role: 'student', uid: 'u9', email: 'student.two@example.invalid', displayName: 'Student Two' },
    ]);
  });

  it('reports a tag whose class is absent from local rooms as orphan-tag (no silent drop)', () => {
    const persons = [{ id: 'pX', displayName: 'Xavier', email: 'xavier@example.invalid', tags: ['hz-config-class-ghostclass-student'] }];
    const res = computeDiscrepancies({ rooms, persons, assignments: [], issues: [] });
    expect(res).toEqual([
      { type: 'orphan-tag', roomId: 'ghostclass', roomTitle: null, role: 'student', personId: 'pX', email: 'xavier@example.invalid', displayName: 'Xavier', note: 'tag references a class not in local rooms' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/services/discrepancy.test.ts`
Expected: FAIL — `Cannot find module './discrepancy'`.

- [ ] **Step 3: Write the implementation**

`src/main/services/discrepancy.ts`:

```ts
export type DiscrepancyType = 'orphan-tag' | 'missing-tag' | 'unresolved' | 'unknown';

export interface Discrepancy {
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

export interface DiscrepancyInput {
  rooms: Array<{ id: string; title: string; classId: string | null }>;
  persons: Array<{ id: string; displayName: string; email: string | null; tags: string[] }>;
  assignments: Array<{ personId: string; roomId: string; role: string }>;
  issues: Array<{
    type: 'unresolved' | 'unknown';
    roomId: string;
    role: string;
    uid: string;
    email: string | null;
    displayName: string | null;
  }>;
}

// Semantic roles that can appear in a hz-config-class-<classId>-<role> breadcrumb tag.
const VALID_ROLES = ['student', 'companymentor', 'schoolteacher', 'courseteacher', 'stateadvisor', 'guardian'];

// Parse a breadcrumb tag hz-config-class-<classId>-<role> by splitting on the LAST hyphen,
// mirroring the retired parseAssignmentTag in sync.service.ts.
export function parseClassTag(tag: string): { classId: string; role: string } | null {
  const prefix = 'hz-config-class-';
  if (!tag.startsWith(prefix)) return null;
  const remainder = tag.substring(prefix.length);
  const lastHyphen = remainder.lastIndexOf('-');
  if (lastHyphen === -1) return null;
  const classId = remainder.substring(0, lastHyphen);
  const role = remainder.substring(lastHyphen + 1);
  if (!classId || !VALID_ROLES.includes(role)) return null;
  return { classId, role };
}

const key = (personId: string, roomId: string, role: string) => JSON.stringify([personId, roomId, role]);

export function computeDiscrepancies(input: DiscrepancyInput): Discrepancy[] {
  const classIdToRoomId = new Map<string, string>();
  const roomIdToTitle = new Map<string, string>();
  for (const r of input.rooms) {
    roomIdToTitle.set(r.id, r.title);
    if (r.classId) classIdToRoomId.set(r.classId, r.id);
  }

  const personsById = new Map<string, { id: string; displayName: string; email: string | null }>();
  for (const p of input.persons) personsById.set(p.id, p);

  const out: Discrepancy[] = [];
  const tagKeys = new Set<string>();

  // Tag-derived (person, room, role) triples; unmapped class ids are reported, not dropped.
  for (const p of input.persons) {
    for (const tag of p.tags) {
      const parsed = parseClassTag(tag);
      if (!parsed) continue;
      const roomId = classIdToRoomId.get(parsed.classId);
      if (!roomId) {
        out.push({
          type: 'orphan-tag',
          roomId: parsed.classId,
          roomTitle: null,
          role: parsed.role,
          personId: p.id,
          email: p.email,
          displayName: p.displayName,
          note: 'tag references a class not in local rooms',
        });
        continue;
      }
      tagKeys.add(key(p.id, roomId, parsed.role));
    }
  }

  const asgKeys = new Set<string>();
  for (const a of input.assignments) asgKeys.add(key(a.personId, a.roomId, a.role));

  // orphan-tag: has the breadcrumb but is NOT a group member (tag not in assignments)
  for (const k of tagKeys) {
    if (asgKeys.has(k)) continue;
    const [personId, roomId, role] = JSON.parse(k) as [string, string, string];
    const p = personsById.get(personId);
    out.push({
      type: 'orphan-tag',
      roomId,
      roomTitle: roomIdToTitle.get(roomId) ?? null,
      role,
      personId,
      email: p?.email ?? null,
      displayName: p?.displayName ?? null,
    });
  }

  // missing-tag: IS a group member but lacks the breadcrumb (assignment not in tags) — healable in S3
  for (const k of asgKeys) {
    if (tagKeys.has(k)) continue;
    const [personId, roomId, role] = JSON.parse(k) as [string, string, string];
    const p = personsById.get(personId);
    out.push({
      type: 'missing-tag',
      roomId,
      roomTitle: roomIdToTitle.get(roomId) ?? null,
      role,
      personId,
      email: p?.email ?? null,
      displayName: p?.displayName ?? null,
    });
  }

  // unresolved / unknown: already computed by S1 — carried through from membership_issues
  for (const i of input.issues) {
    out.push({
      type: i.type,
      roomId: i.roomId,
      roomTitle: roomIdToTitle.get(i.roomId) ?? null,
      role: i.role,
      uid: i.uid,
      email: i.email,
      displayName: i.displayName,
    });
  }

  // Stable ordering: deterministic tests + predictable UI.
  const typeOrder: Record<DiscrepancyType, number> = {
    'orphan-tag': 0,
    'missing-tag': 1,
    unresolved: 2,
    unknown: 3,
  };
  out.sort(
    (a, b) =>
      typeOrder[a.type] - typeOrder[b.type] ||
      (a.roomTitle || a.roomId).localeCompare(b.roomTitle || b.roomId) ||
      a.role.localeCompare(b.role) ||
      (a.displayName || a.email || a.personId || a.uid || '').localeCompare(
        b.displayName || b.email || b.personId || b.uid || '',
      ),
  );

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/services/discrepancy.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/discrepancy.ts src/main/services/discrepancy.test.ts
git commit -m "feat: pure discrepancy resolver (tags vs group truth + S1 issues)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: DB loader (`discrepancy.service.ts`) + IPC wiring

**Files:**
- Create: `src/main/services/discrepancy.service.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/main/ipc/index.ts`

**Interfaces consumed:** `computeDiscrepancies`, `Discrepancy` (Task 1).
**Interfaces produced:** `getDiscrepancies(): Discrepancy[]`; IPC channel `DISCREPANCIES_GET`; `window.electronAPI.getDiscrepancies()`.

- [ ] **Step 1: Create the loader** `src/main/services/discrepancy.service.ts`

```ts
import { getDb } from '../database';
import { computeDiscrepancies, Discrepancy } from './discrepancy';

function safeParseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function getDiscrepancies(): Discrepancy[] {
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

  return computeDiscrepancies({ rooms, persons, assignments, issues });
}
```

- [ ] **Step 2: Add the channel** to `src/shared/ipc-channels.ts` — inside the `IPC_CHANNELS` object (e.g. after the `DISTRIBUTION_GROUPS_GET` / `ASSIGNMENTS_EXECUTE` block):

```ts
  // Discrepancies (S2 report)
  DISCREPANCIES_GET: 'discrepancies:get',
```

- [ ] **Step 3: Register the handler** in `src/main/ipc/index.ts`. Add the import at the top (near the other service imports at [ipc/index.ts:6](../../src/main/ipc/index.ts#L6)):

```ts
import { getDiscrepancies } from '../services/discrepancy.service';
```

Then add a handler alongside the other read handlers (e.g. after the `ASSIGNMENTS_GET_ALL` handler at [ipc/index.ts:113](../../src/main/ipc/index.ts#L113)):

```ts
  ipcMain.handle(IPC_CHANNELS.DISCREPANCIES_GET, async () => {
    try {
      return getDiscrepancies();
    } catch (error) {
      console.error('Get discrepancies error:', error);
      throw error;
    }
  });
```

- [ ] **Step 4: Expose it in preload** `src/main/preload.ts`. Add the channel to the **inline** `IPC_CHANNELS` copy (the object at [preload.ts:4](../../src/main/preload.ts#L4)):

```ts
  DISCREPANCIES_GET: 'discrepancies:get',
```

Add the method inside `exposeInMainWorld('electronAPI', { ... })` (e.g. after `getUserTypes`):

```ts
  // Discrepancies (S2 report)
  getDiscrepancies: () =>
    ipcRenderer.invoke(IPC_CHANNELS.DISCREPANCIES_GET),
```

Add the type to the `Window['electronAPI']` interface (e.g. after `getUserTypes`'s type):

```ts
      getDiscrepancies: () => Promise<Array<{
        type: 'orphan-tag' | 'missing-tag' | 'unresolved' | 'unknown';
        roomId: string;
        roomTitle: string | null;
        role: string;
        personId?: string;
        email?: string | null;
        uid?: string;
        displayName?: string | null;
        note?: string;
      }>>;
```

- [ ] **Step 5: Build (main process)**

Run: `npm run build:electron`
Expected: compiles with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/discrepancy.service.ts src/shared/ipc-channels.ts src/main/ipc/index.ts src/main/preload.ts
git commit -m "feat: getDiscrepancies loader + DISCREPANCIES_GET IPC

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Discrepancies page + sidebar nav

**Files:**
- Create: `src/renderer/pages/DiscrepanciesPage.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/layout/Sidebar.tsx`

**Interfaces consumed:** `window.electronAPI.getDiscrepancies()` (Task 2).

- [ ] **Step 1: Create the page** `src/renderer/pages/DiscrepanciesPage.tsx`

```tsx
import React, { useEffect, useMemo, useState } from 'react';

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
  const [items, setItems] = useState<Discrepancy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | DiscrepancyType>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    window.electronAPI
      .getDiscrepancies()
      .then((rows) => {
        if (alive) setItems(rows as Discrepancy[]);
      })
      .catch((e) => {
        if (alive) setError(String(e?.message || e));
      });
    return () => {
      alive = false;
    };
  }, []);

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

  if (error) return <div className="text-red-600">Failed to load discrepancies: {error}</div>;
  if (!items) return <div className="text-gray-500">Loading discrepancies…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Discrepancies</h2>
        <p className="text-sm text-gray-500">
          Where profile tags and group-ACL truth disagree. Read-only — computed from the last sync.
        </p>
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
    </div>
  );
}

export default DiscrepanciesPage;
```

- [ ] **Step 2: Wire the route** in `src/renderer/App.tsx`:
  1. Add the import (near the other page imports at the top):
     ```tsx
     import DiscrepanciesPage from './pages/DiscrepanciesPage';
     ```
  2. Add `'discrepancies'` to the `Page` union type:
     ```tsx
     type Page = 'dashboard' | 'rooms' | 'persons' | 'matrix' | 'import' | 'missions' | 'discrepancies' | 'settings';
     ```
  3. Add a case in `renderPage()`'s switch (before `settings`):
     ```tsx
       case 'discrepancies':
         return <DiscrepanciesPage />;
     ```

- [ ] **Step 3: Add the nav item** in `src/renderer/components/layout/Sidebar.tsx`:
  1. Import an icon — add `faTriangleExclamation` to the existing `@fortawesome/free-solid-svg-icons` import:
     ```tsx
     import {
       faChartLine,
       faBuilding,
       faUsers,
       faTableCells,
       faFileImport,
       faBullseye,
       faTriangleExclamation,
       faCog,
       IconDefinition,
     } from '@fortawesome/free-solid-svg-icons';
     ```
  2. Add `'discrepancies'` to this file's `Page` union type (it is duplicated here):
     ```tsx
     type Page = 'dashboard' | 'rooms' | 'persons' | 'matrix' | 'import' | 'missions' | 'discrepancies' | 'settings';
     ```
  3. Add a nav item to `navItems` (after `missions`, before `settings`):
     ```tsx
       { id: 'discrepancies', label: 'Discrepancies', icon: faTriangleExclamation },
     ```

- [ ] **Step 4: Build (full — renderer + main)**

Run: `npm run build`
Expected: compiles with no TypeScript errors. (If `npm run build` is not a full typecheck in this repo, also run `npm run build:electron`; both must be clean.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/DiscrepanciesPage.tsx src/renderer/App.tsx src/renderer/components/layout/Sidebar.tsx
git commit -m "feat: Discrepancies report tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Manual acceptance (user-run)

**Files:** none (verification only). This step needs the live app + a prior sync; it is not subagent-executable.

- [ ] **Step 1: Build & run**

Run: `npm run build && npm start`. Ensure a sync has been run at least once (Dashboard → Sync Now) so `person_room_assignments` and `membership_issues` are populated.

- [ ] **Step 2: Open the Discrepancies tab** — confirm it loads, shows per-type counts, and the type filter + search work.

- [ ] **Step 3: Spot-check against known cases**
  - **Unknown:** filter to *Unknown person* — **Student Two** (`student.two@example.invalid`) should appear for a CUI-C c room, alongside the benign infra accounts (Système Hazu, `@partner-domain.invalid`).
  - **Orphan / missing tags:** scan those two types for a room you know. Sanity-check a couple against the `sqlite3` data:
    ```bash
    sqlite3 "$HOME/Library/Application Support/hazu-admin/hazu-admin.db" -line \
    "SELECT type, role, room_id, email, display_name FROM membership_issues WHERE room_id='LkxlSjtb0hnG4TpnvDDr';"
    ```

- [ ] **Step 4: Confirm read-only** — the report changed nothing (no new rows written, no tags altered). It should recompute identically on reload without a re-sync.

---

## Self-Review

- **Spec coverage (S2 section of the spec):** ✅ orphan-tag + missing-tag computed from tags-vs-group-truth (Task 1); ✅ unresolved + unknown carried from `membership_issues` (Task 1/2); ✅ `computeDiscrepancies(opts?)` present (opts omitted — full-set compute is cheap and the UI filters; add roomId/role filtering only if needed later — YAGNI); ✅ IPC `DISCREPANCIES_GET` (Task 2); ✅ dedicated page + nav (Task 3). **Deviations (intentional):** `room-vs-group` deferred (needs room-expanded ACL, out of S1's stored data — confirmed with the user); compute is on-demand (no persisted discrepancy table — read-only, always fresh, no migration); loader lives in `discrepancy.service.ts` with the pure compute in `discrepancy.ts` (keeps the tested module DB-free).
- **Placeholder scan:** none — every code/test/command step is concrete.
- **Type consistency:** `Discrepancy`/`DiscrepancyInput` defined in Task 1 and consumed unchanged by `getDiscrepancies` (Task 2); the preload `Window` type and the page's local `Discrepancy` type mirror the same shape; DB column aliases (`class_id AS classId`, `display_name AS displayName`, `person_id AS personId`, `room_id AS roomId`) match the pure module's field names.
- **Not in S2 (correct):** tag healing (S3), write reliability (S4), room-vs-group detection (deferred follow-up).

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. (Same flow as S1.)
2. **Inline Execution** — execute the tasks in this session with checkpoints.

Which approach?
