# Assignment Preview & Execution Feedback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an assignment preview table with duplicate detection and per-row control to the bulk import Assignment tab, and replace `alert()` feedback with the existing TaskQueue system.

**Architecture:** A new `AssignmentPreviewPanel` component renders between the matching panels and the execute button. It cross-references `person_room_assignments` from the local DB to flag duplicates. On execute, each assignment is added to the TaskQueue as a `roleUpdate` task instead of calling `executeAssignments` directly.

**Tech Stack:** React, TypeScript, Tailwind CSS, existing TaskQueue context, existing `electronAPI.getAllAssignments()` IPC

---

### Task 1: Create AssignmentPreviewPanel Component

**Files:**
- Create: `src/renderer/components/bulk-import/AssignmentPreviewPanel.tsx`

**Step 1: Create the component file**

```tsx
import React, { useState, useMemo } from 'react';

export interface PreviewAssignment {
  personId: string;
  personName: string;
  personEmail: string;
  roomId: string;
  roomName: string;
  role: string;
  existingRole: string | null; // null = new assignment, string = already has this role
}

interface AssignmentPreviewPanelProps {
  assignments: PreviewAssignment[];
  availableRoles: string[];
  excludedKeys: Set<string>; // Set of "personId:roomId" keys
  roleOverrides: Map<string, string>; // Map of "personId:roomId" -> overridden role
  onToggleExclude: (key: string) => void;
  onRoleChange: (key: string, newRole: string) => void;
  onToggleAll: (included: boolean) => void;
}

function makeKey(personId: string, roomId: string) {
  return `${personId}:${roomId}`;
}

export function AssignmentPreviewPanel({
  assignments,
  availableRoles,
  excludedKeys,
  roleOverrides,
  onToggleExclude,
  onRoleChange,
  onToggleAll,
}: AssignmentPreviewPanelProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const includedCount = assignments.filter(
    (a) => !excludedKeys.has(makeKey(a.personId, a.roomId))
  ).length;

  const newCount = assignments.filter((a) => !a.existingRole).length;
  const existingCount = assignments.length - newCount;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-b border-gray-200">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-800">Assignment Preview</h3>
        </div>
        <span className="text-sm text-gray-500">
          {includedCount} of {assignments.length} selected
          {existingCount > 0 && (
            <span className="ml-2 text-amber-600">
              ({existingCount} already assigned)
            </span>
          )}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-2 text-left w-10">
                <input
                  type="checkbox"
                  checked={includedCount === assignments.length}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Person
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Room
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Role
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {assignments.map((a) => {
              const key = makeKey(a.personId, a.roomId);
              const excluded = excludedKeys.has(key);
              const currentRole = roleOverrides.get(key) || a.role;
              const isEditing = editingKey === key;

              return (
                <tr
                  key={key}
                  className={excluded ? 'opacity-50 bg-gray-50' : ''}
                >
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={!excluded}
                      onChange={() => onToggleExclude(key)}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                  </td>
                  <td className="px-4 py-2 text-gray-900">{a.personName}</td>
                  <td className="px-4 py-2 text-gray-700">{a.roomName}</td>
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <select
                        value={currentRole}
                        onChange={(e) => {
                          onRoleChange(key, e.target.value);
                          setEditingKey(null);
                        }}
                        onBlur={() => setEditingKey(null)}
                        autoFocus
                        className="text-sm border border-gray-300 rounded px-2 py-1"
                      >
                        {availableRoles.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <button
                        onClick={() => setEditingKey(key)}
                        className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                        title="Click to change role"
                      >
                        {currentRole}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {a.existingRole ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                        Already: {a.existingRole}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                        New
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/renderer/components/bulk-import/AssignmentPreviewPanel.tsx
git commit -m "feat: add AssignmentPreviewPanel component"
```

---

### Task 2: Integrate Preview Panel into BulkImportPage

**Files:**
- Modify: `src/renderer/pages/BulkImportPage.tsx`

**Step 1: Add state and data loading for preview**

At the top of `BulkImportPage`, add imports and state:

```tsx
// Add import
import { AssignmentPreviewPanel, PreviewAssignment } from '../components/bulk-import/AssignmentPreviewPanel';

// Add state (inside the component, after other assignment state)
const [existingAssignments, setExistingAssignments] = useState<Array<{ person_id: string; room_id: string; role: string }>>([]);
const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());
const [roleOverrides, setRoleOverrides] = useState<Map<string, string>>(new Map());
```

Add a `useEffect` to load existing assignments when on the assignment tab:

```tsx
useEffect(() => {
  if (activeWorkflow === 'assignment') {
    window.electronAPI.getAllAssignments().then(setExistingAssignments);
  }
}, [activeWorkflow]);
```

**Step 2: Compute the preview assignments array**

Add a `useMemo` that builds `PreviewAssignment[]` from the matched data, cross-referencing `existingAssignments`:

```tsx
const previewAssignments = useMemo(() => {
  if (!fileData || !assignmentEmailColumn || !assignmentRoomColumn || !selectedAssignmentRole) return [];

  const result: PreviewAssignment[] = [];
  const seen = new Set<string>();

  fileData.rows.forEach((row) => {
    const email = row[assignmentEmailColumn]?.trim().toLowerCase();
    const roomValue = row[assignmentRoomColumn]?.trim();
    if (!email || !roomValue) return;

    const personId = getResolvedPersonId(email);
    const roomId = getResolvedRoomId(roomValue);
    if (!personId || !roomId) return;

    const key = `${personId}:${roomId}`;
    if (seen.has(key)) return;
    seen.add(key);

    const person = persons.find((p) => p.id === personId);
    const room = rooms.find((r) => r.id === roomId);
    if (!person) return;

    const existing = existingAssignments.find(
      (a) => a.person_id === personId && a.room_id === roomId
    );

    result.push({
      personId,
      personName: person.display_name,
      personEmail: person.email || email,
      roomId,
      roomName: room?.title || roomValue,
      role: selectedAssignmentRole,
      existingRole: existing?.role || null,
    });
  });

  return result;
}, [fileData, assignmentEmailColumn, assignmentRoomColumn, selectedAssignmentRole, persons, rooms, existingAssignments, getResolvedPersonId, getResolvedRoomId]);
```

**Step 3: Auto-exclude already-assigned rows**

Add a `useEffect` that sets `excludedKeys` for rows with existing roles whenever `previewAssignments` changes:

```tsx
useEffect(() => {
  const excluded = new Set<string>();
  previewAssignments.forEach((a) => {
    if (a.existingRole) {
      excluded.add(`${a.personId}:${a.roomId}`);
    }
  });
  setExcludedKeys(excluded);
  setRoleOverrides(new Map());
}, [previewAssignments]);
```

**Step 4: Add toggle/role handlers**

```tsx
const handleToggleExclude = useCallback((key: string) => {
  setExcludedKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    return next;
  });
}, []);

const handlePreviewRoleChange = useCallback((key: string, newRole: string) => {
  setRoleOverrides((prev) => {
    const next = new Map(prev);
    next.set(key, newRole);
    return next;
  });
}, []);

const handleToggleAll = useCallback((included: boolean) => {
  if (included) {
    setExcludedKeys(new Set());
  } else {
    setExcludedKeys(new Set(previewAssignments.map((a) => `${a.personId}:${a.roomId}`)));
  }
}, [previewAssignments]);
```

**Step 5: Render the preview panel**

In the assignment workflow JSX (after the Room Matching panel, before the closing `</>`), add:

```tsx
{/* Assignment Preview */}
{previewAssignments.length > 0 && (
  <div className="mt-6">
    <AssignmentPreviewPanel
      assignments={previewAssignments}
      availableRoles={['student', 'companymentor', 'schoolteacher', 'courseteacher', 'stateadvisor']}
      excludedKeys={excludedKeys}
      roleOverrides={roleOverrides}
      onToggleExclude={handleToggleExclude}
      onRoleChange={handlePreviewRoleChange}
      onToggleAll={handleToggleAll}
    />
  </div>
)}
```

**Step 6: Update the included count for the footer**

Replace `validAssignmentCount` usage in the footer with a new computed value:

```tsx
const selectedAssignmentCount = useMemo(() => {
  return previewAssignments.filter(
    (a) => !excludedKeys.has(`${a.personId}:${a.roomId}`)
  ).length;
}, [previewAssignments, excludedKeys]);
```

Update the footer to use `selectedAssignmentCount` instead of `validAssignmentCount`:

```tsx
{/* Footer - Assignment workflow */}
{activeWorkflow === 'assignment' && fileData && (
  <div className="border-t border-gray-200 px-6 py-4 flex items-center justify-between">
    <div className="text-sm text-gray-500">
      {selectedAssignmentCount > 0
        ? `${selectedAssignmentCount} assignment${selectedAssignmentCount !== 1 ? 's' : ''} ready`
        : 'Map columns and resolve matches to enable assignment'}
    </div>
    <button
      onClick={handleExecuteAssignments}
      disabled={selectedAssignmentCount === 0 || !selectedAssignmentRole}
      className={`px-6 py-2 rounded-lg transition-colors ${
        selectedAssignmentCount > 0 && selectedAssignmentRole
          ? 'bg-blue-600 text-white hover:bg-blue-700'
          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
      }`}
    >
      Assign {selectedAssignmentCount} Person{selectedAssignmentCount !== 1 ? 's' : ''} to Rooms
    </button>
  </div>
)}
```

**Step 7: Commit**

```bash
git add src/renderer/pages/BulkImportPage.tsx
git commit -m "feat: integrate assignment preview panel with duplicate detection"
```

---

### Task 3: Replace alert() with TaskQueue for Execution Feedback

**Files:**
- Modify: `src/renderer/pages/BulkImportPage.tsx`

**Step 1: Rewrite `handleExecuteAssignments` to use TaskQueue**

Replace the entire `handleExecuteAssignments` callback. Instead of calling `executeAssignments` in bulk, add one `roleUpdate` task per included assignment to the TaskQueue:

```tsx
const handleExecuteAssignments = useCallback(() => {
  if (!selectedAssignmentRole) return;

  const included = previewAssignments.filter(
    (a) => !excludedKeys.has(`${a.personId}:${a.roomId}`)
  );

  if (included.length === 0) return;

  for (const a of included) {
    const key = `${a.personId}:${a.roomId}`;
    const role = roleOverrides.get(key) || a.role;

    addRoleUpdateTask({
      personName: a.personName,
      personId: a.personId,
      roomName: a.roomName,
      roomId: a.roomId,
      oldRole: a.existingRole || '_',
      newRole: role,
    });
  }

  // Reset assignment state after queuing
  setAssignmentEmailColumn(null);
  setAssignmentRoomColumn(null);
  setAssignmentColumnMappings({});
  setPersonMatches(new Map());
  setPersonResolutions(new Map());
  setRoomMatches(new Map());
  setRoomResolutions(new Map());
  setSelectedAssignmentRole(null);
  setExcludedKeys(new Set());
  setRoleOverrides(new Map());
}, [
  selectedAssignmentRole,
  previewAssignments,
  excludedKeys,
  roleOverrides,
  addRoleUpdateTask,
]);
```

**Step 2: Update the `useTaskQueue` destructuring at the top of the component**

Change:
```tsx
const { addCreateRoomTask, addCreatePersonTask } = useTaskQueue();
```
To:
```tsx
const { addCreateRoomTask, addCreatePersonTask, addRoleUpdateTask } = useTaskQueue();
```

**Step 3: Update the TaskQueue `roleUpdate` handler label in TaskQueuePanel**

The existing `TaskQueuePanel.tsx` already renders `roleUpdate` tasks with `"{personName} → {roomName}"` label. This is sufficient — no changes needed to `TaskQueuePanel.tsx`.

**Step 4: Commit**

```bash
git add src/renderer/pages/BulkImportPage.tsx
git commit -m "feat: use TaskQueue for assignment execution feedback"
```

---

### Task 4: Test End-to-End

**Step 1: Build and run**

```bash
npm run build && npm start
```

**Step 2: Test the preview panel**

1. Go to Bulk Import → Assignment tab
2. Upload a file with email and room columns
3. Map columns and select a role
4. Verify the Assignment Preview table appears with person, room, role, status
5. Verify already-assigned rows show amber "Already: [role]" and are unchecked
6. Verify new rows show green "New" and are checked
7. Click a role to change it via dropdown
8. Uncheck/check rows and verify the footer count updates

**Step 3: Test execution with TaskQueue**

1. Click "Assign N Persons to Rooms"
2. Verify tasks appear in the TaskQueue panel (top-right)
3. Verify each task shows progress: queued → processing → success/error
4. Verify failed tasks show error and retry button

**Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: address issues from end-to-end testing"
```
