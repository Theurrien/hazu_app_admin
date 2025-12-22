# Matrix Dropdown Webhook Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform read-only matrix cells into interactive dropdowns that trigger Make.com webhooks to sync role changes.

**Architecture:** Sync extracts webhook config from Admin Hazu, dropdowns in MatrixGrid call IPC handler which POSTs to webhook, TaskQueue manages concurrent requests with visual feedback panel.

**Tech Stack:** Electron IPC, React Context, axios for HTTP, Tailwind CSS

---

## Task 1: Add Settings Schema

**Files:**
- Modify: `src/main/database/schema.sql`

**Step 1: Add new default settings**

Add these lines after the existing INSERT OR IGNORE statements (around line 145):

```sql
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('admin_id', ''),
    ('template_id', ''),
    ('webhook_url', '');
```

**Step 2: Verify schema loads**

Run: `npm run build && npm start`
Expected: App starts without database errors

**Step 3: Commit**

```bash
git add src/main/database/schema.sql
git commit -m "feat: add admin webhook settings to schema"
```

---

## Task 2: Add IPC Channel

**Files:**
- Modify: `src/shared/ipc-channels.ts`

**Step 1: Add webhook channel constant**

Add to the IPC_CHANNELS object:

```typescript
WEBHOOK_UPDATE_USER_ROLE: 'webhook:updateUserRole',
SETTINGS_GET_WEBHOOK_CONFIG: 'settings:getWebhookConfig',
```

**Step 2: Commit**

```bash
git add src/shared/ipc-channels.ts
git commit -m "feat: add webhook IPC channels"
```

---

## Task 3: Add Webhook Config Getter

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/preload.ts`

**Step 1: Add IPC handler for getting webhook config**

In `src/main/ipc/index.ts`, add after existing handlers:

```typescript
ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_WEBHOOK_CONFIG, async () => {
  try {
    const adminId = query(`SELECT value FROM settings WHERE key = 'admin_id'`)?.[0]?.value || '';
    const templateId = query(`SELECT value FROM settings WHERE key = 'template_id'`)?.[0]?.value || '';
    const webhookUrl = query(`SELECT value FROM settings WHERE key = 'webhook_url'`)?.[0]?.value || '';
    return { adminId, templateId, webhookUrl };
  } catch (error) {
    console.error('Get webhook config error:', error);
    throw error;
  }
});
```

**Step 2: Expose in preload**

In `src/main/preload.ts`, add to contextBridge.exposeInMainWorld:

```typescript
getWebhookConfig: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_WEBHOOK_CONFIG),
```

Add to ElectronAPI interface:

```typescript
getWebhookConfig: () => Promise<{ adminId: string; templateId: string; webhookUrl: string }>;
```

**Step 3: Verify it compiles**

Run: `npm run build`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add src/main/ipc/index.ts src/main/preload.ts
git commit -m "feat: add webhook config getter IPC"
```

---

## Task 4: Add Webhook Call Handler

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/preload.ts`

**Step 1: Add IPC handler for webhook call**

In `src/main/ipc/index.ts`, add:

```typescript
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
      // Get webhook config
      const webhookUrl = query(`SELECT value FROM settings WHERE key = 'webhook_url'`)?.[0]?.value;
      const templateId = query(`SELECT value FROM settings WHERE key = 'template_id'`)?.[0]?.value;

      if (!webhookUrl || !templateId) {
        return { success: false, error: 'Webhook not configured. Run sync first.' };
      }

      // Build payload
      const payload = {
        hazu: { env: '' },
        data: { action: 'update-user-roles' },
        dataForCloudFunction: {
          templateId,
          profileId: personId,
          userTypesInfo: [
            {
              classId: roomId,
              oldUserType: oldRole || '_',
              newUserType: newRole || '_',
            },
          ],
        },
      };

      // Call webhook
      const axios = require('axios');
      const response = await axios.post(webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      // Update local DB on success
      if (newRole && newRole !== '_') {
        query(
          `INSERT OR REPLACE INTO person_room_assignments (person_id, room_id, role, synced_at)
           VALUES (?, ?, ?, ?)`,
          [personId, roomId, newRole, Date.now()]
        );
      } else {
        query(
          `DELETE FROM person_room_assignments WHERE person_id = ? AND room_id = ?`,
          [personId, roomId]
        );
      }

      return { success: true };
    } catch (error: any) {
      console.error('Webhook error:', error);
      const message = error.response?.data?.message || error.message || 'Unknown error';
      return { success: false, error: message };
    }
  }
);
```

**Step 2: Expose in preload**

In `src/main/preload.ts`, add to contextBridge.exposeInMainWorld:

```typescript
updateUserRole: (
  personId: string,
  roomId: string,
  oldRole: string | null,
  newRole: string | null
) => ipcRenderer.invoke(IPC_CHANNELS.WEBHOOK_UPDATE_USER_ROLE, personId, roomId, oldRole, newRole),
```

Add to ElectronAPI interface:

```typescript
updateUserRole: (
  personId: string,
  roomId: string,
  oldRole: string | null,
  newRole: string | null
) => Promise<{ success: boolean; error?: string }>;
```

**Step 3: Verify it compiles**

Run: `npm run build`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add src/main/ipc/index.ts src/main/preload.ts
git commit -m "feat: add webhook call IPC handler"
```

---

## Task 5: Extract Admin Config During Sync

**Files:**
- Modify: `src/main/services/sync.service.ts`

**Step 1: Add helper function to parse admin form**

Add near the top of the file, after other helper functions:

```typescript
// Extract webhook config from admin item's form HTML
function extractWebhookConfig(html: string): { webhookUrl: string; templateId: string } | null {
  // Extract form action URL
  const actionMatch = html.match(/action="([^"]+)"/);
  const webhookUrl = actionMatch?.[1] || '';

  // Extract templateLink from hidden input
  const templateMatch = html.match(/name="hazu\[templateLink\]"\s+value="([^"]+)"/);
  const templateId = templateMatch?.[1] || '';

  if (!webhookUrl || !templateId) {
    return null;
  }

  return { webhookUrl, templateId };
}
```

**Step 2: Add admin config extraction to sync function**

In the `syncFromHazu` function, after fetching first-level children but before processing rooms, add:

```typescript
// Find and process Admin Hazu (hz-config-admin)
const adminHazu = firstLevelChildren.find((child: HazuEntity) =>
  child.snapshot.tags?.includes('hz-config-admin')
);

if (adminHazu) {
  console.log('[SYNC] Found Admin Hazu:', adminHazu.snapshot.key);

  // Save admin_id
  query(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('admin_id', ?, ?)`,
    [adminHazu.snapshot.key, Date.now()]);

  // Get children of admin Hazu to find the config item
  const adminChildren = await sendApiRequestList(adminHazu.snapshot.key);
  if (adminChildren) {
    for (const child of adminChildren) {
      const description = child.snapshot.description || '';
      const config = extractWebhookConfig(description);
      if (config) {
        console.log('[SYNC] Found webhook config:', config.webhookUrl);
        query(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('webhook_url', ?, ?)`,
          [config.webhookUrl, Date.now()]);
        query(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('template_id', ?, ?)`,
          [config.templateId, Date.now()]);
        break;
      }
    }
  }
} else {
  console.log('[SYNC] No Admin Hazu found (hz-config-admin tag)');
}
```

**Step 3: Verify it compiles**

Run: `npm run build`
Expected: No TypeScript errors

**Step 4: Test sync**

Run: `npm start`
1. Go to Dashboard
2. Click "Sync Now"
3. Check console for "[SYNC] Found Admin Hazu" and "[SYNC] Found webhook config"

**Step 5: Commit**

```bash
git add src/main/services/sync.service.ts
git commit -m "feat: extract webhook config from Admin Hazu during sync"
```

---

## Task 6: Create TaskQueue Context

**Files:**
- Create: `src/renderer/contexts/TaskQueueContext.tsx`

**Step 1: Create the context file**

```typescript
import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

export interface Task {
  id: string;
  personName: string;
  roomName: string;
  personId: string;
  roomId: string;
  oldRole: string | null;
  newRole: string | null;
  status: 'queued' | 'processing' | 'success' | 'error';
  error?: string;
  dismissAt?: number; // Timestamp when to auto-dismiss
}

interface TaskQueueContextType {
  tasks: Task[];
  addTask: (task: Omit<Task, 'id' | 'status'>) => string;
  dismissTask: (id: string) => void;
  dismissAllErrors: () => void;
}

const TaskQueueContext = createContext<TaskQueueContextType | null>(null);

export function useTaskQueue() {
  const context = useContext(TaskQueueContext);
  if (!context) {
    throw new Error('useTaskQueue must be used within TaskQueueProvider');
  }
  return context;
}

export function TaskQueueProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const processingRef = useRef(false);
  const taskIdCounter = useRef(0);

  // Process queue
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;

    const nextTask = tasks.find((t) => t.status === 'queued');
    if (!nextTask) return;

    processingRef.current = true;

    // Mark as processing
    setTasks((prev) =>
      prev.map((t) => (t.id === nextTask.id ? { ...t, status: 'processing' as const } : t))
    );

    try {
      const result = await window.electronAPI.updateUserRole(
        nextTask.personId,
        nextTask.roomId,
        nextTask.oldRole,
        nextTask.newRole
      );

      if (result.success) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === nextTask.id
              ? { ...t, status: 'success' as const, dismissAt: Date.now() + 5000 }
              : t
          )
        );
      } else {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === nextTask.id ? { ...t, status: 'error' as const, error: result.error } : t
          )
        );
      }
    } catch (error: any) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === nextTask.id
            ? { ...t, status: 'error' as const, error: error.message || 'Unknown error' }
            : t
        )
      );
    }

    processingRef.current = false;
  }, [tasks]);

  // Trigger processing when tasks change
  useEffect(() => {
    processQueue();
  }, [tasks, processQueue]);

  // Auto-dismiss successful tasks
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTasks((prev) => prev.filter((t) => !t.dismissAt || t.dismissAt > now));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const addTask = useCallback((taskData: Omit<Task, 'id' | 'status'>) => {
    const id = `task-${++taskIdCounter.current}`;
    const task: Task = { ...taskData, id, status: 'queued' };
    setTasks((prev) => [...prev, task]);
    return id;
  }, []);

  const dismissTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAllErrors = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status !== 'error'));
  }, []);

  return (
    <TaskQueueContext.Provider value={{ tasks, addTask, dismissTask, dismissAllErrors }}>
      {children}
    </TaskQueueContext.Provider>
  );
}
```

**Step 2: Verify it compiles**

Run: `npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add src/renderer/contexts/TaskQueueContext.tsx
git commit -m "feat: create TaskQueue context for managing webhook calls"
```

---

## Task 7: Create TaskQueue Panel

**Files:**
- Create: `src/renderer/components/TaskQueuePanel.tsx`

**Step 1: Create the panel component**

```typescript
import React from 'react';
import { useTaskQueue, Task } from '../contexts/TaskQueueContext';

function TaskItem({ task, onDismiss }: { task: Task; onDismiss: () => void }) {
  const getIcon = () => {
    switch (task.status) {
      case 'processing':
        return <span className="animate-spin">⏳</span>;
      case 'queued':
        return <span>🕐</span>;
      case 'success':
        return <span className="text-green-600">✓</span>;
      case 'error':
        return <span className="text-red-600">✗</span>;
    }
  };

  const getTimeLeft = () => {
    if (!task.dismissAt) return null;
    const seconds = Math.ceil((task.dismissAt - Date.now()) / 1000);
    return seconds > 0 ? `${seconds}s` : null;
  };

  return (
    <div
      className={`flex items-start gap-2 p-2 text-sm ${
        task.status === 'error' ? 'bg-red-50' : task.status === 'success' ? 'bg-green-50' : ''
      }`}
    >
      <span className="flex-shrink-0 w-5">{getIcon()}</span>
      <div className="flex-1 min-w-0">
        <div className="truncate">
          {task.personName} → {task.roomName}
        </div>
        {task.error && <div className="text-xs text-red-600 truncate">{task.error}</div>}
      </div>
      {task.status === 'success' && (
        <span className="text-xs text-gray-400 flex-shrink-0">{getTimeLeft()}</span>
      )}
      {task.status === 'error' && (
        <button
          onClick={onDismiss}
          className="text-gray-400 hover:text-gray-600 flex-shrink-0"
          title="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function TaskQueuePanel() {
  const { tasks, dismissTask } = useTaskQueue();

  if (tasks.length === 0) return null;

  const processing = tasks.filter((t) => t.status === 'processing');
  const queued = tasks.filter((t) => t.status === 'queued');
  const success = tasks.filter((t) => t.status === 'success');
  const errors = tasks.filter((t) => t.status === 'error');

  return (
    <div className="fixed top-4 right-4 w-72 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50">
      <div className="bg-gray-100 px-3 py-2 text-xs font-medium text-gray-600 border-b">
        Task Queue ({tasks.length})
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
        {processing.map((task) => (
          <TaskItem key={task.id} task={task} onDismiss={() => dismissTask(task.id)} />
        ))}
        {queued.map((task) => (
          <TaskItem key={task.id} task={task} onDismiss={() => dismissTask(task.id)} />
        ))}
        {success.map((task) => (
          <TaskItem key={task.id} task={task} onDismiss={() => dismissTask(task.id)} />
        ))}
        {errors.map((task) => (
          <TaskItem key={task.id} task={task} onDismiss={() => dismissTask(task.id)} />
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add src/renderer/components/TaskQueuePanel.tsx
git commit -m "feat: create TaskQueuePanel component"
```

---

## Task 8: Wire TaskQueue to App

**Files:**
- Modify: `src/renderer/App.tsx`

**Step 1: Import and wrap with provider**

Add imports at top:

```typescript
import { TaskQueueProvider } from './contexts/TaskQueueContext';
import { TaskQueuePanel } from './components/TaskQueuePanel';
```

**Step 2: Wrap the app content**

Wrap the entire return content with TaskQueueProvider and add TaskQueuePanel:

```typescript
return (
  <TaskQueueProvider>
    <div className="flex h-screen bg-gray-100">
      {/* existing Sidebar and main content */}
    </div>
    <TaskQueuePanel />
  </TaskQueueProvider>
);
```

**Step 3: Verify it compiles and renders**

Run: `npm run build && npm start`
Expected: App starts, no visible panel (since no tasks)

**Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: wire TaskQueueProvider and Panel to App"
```

---

## Task 9: Update MatrixGrid with Dropdowns

**Files:**
- Modify: `src/renderer/components/MatrixGrid.tsx`

**Step 1: Update props interface**

Replace the existing interface:

```typescript
interface MatrixGridProps {
  persons: Person[];
  rooms: Room[];
  getAssignment: (personId: string, roomId: string) => string | null;
  onRoleChange?: (
    personId: string,
    personName: string,
    roomId: string,
    roomName: string,
    oldRole: string | null,
    newRole: string | null
  ) => void;
}
```

**Step 2: Add role options constant**

Add after roleLabels:

```typescript
const roleOptions = [
  { value: '_', label: '-' },
  { value: 'student', label: 'Student' },
  { value: 'companymentor', label: 'Mentor' },
  { value: 'schoolteacher', label: 'Teacher' },
  { value: 'courseteacher', label: 'Course T.' },
  { value: 'stateadvisor', label: 'Advisor' },
  { value: 'guardian', label: 'Guardian' },
];
```

**Step 3: Update function signature**

Update the function to accept onRoleChange:

```typescript
export function MatrixGrid({ persons, rooms, getAssignment, onRoleChange }: MatrixGridProps) {
```

**Step 4: Replace cell content with dropdown**

Replace the cell rendering (the div with key `${person.id}-${room.id}`) with:

```typescript
<div
  key={`${person.id}-${room.id}`}
  className={`absolute border-r border-b border-gray-100 flex items-center justify-center ${
    role ? 'bg-blue-50' : 'bg-white'
  }`}
  style={{
    top: rowIndex * ROW_HEIGHT,
    left: colIndex * COL_WIDTH,
    width: COL_WIDTH,
    height: ROW_HEIGHT,
  }}
>
  <select
    value={role || '_'}
    onChange={(e) => {
      const newRole = e.target.value === '_' ? null : e.target.value;
      if (onRoleChange) {
        onRoleChange(
          person.id,
          person.display_name,
          room.id,
          stripHtml(room.title),
          role,
          newRole
        );
      }
    }}
    className="w-full h-full text-xs text-center bg-transparent border-0 cursor-pointer hover:bg-blue-100 focus:outline-none focus:ring-1 focus:ring-blue-300"
  >
    {roleOptions.map((opt) => (
      <option key={opt.value} value={opt.value}>
        {opt.label}
      </option>
    ))}
  </select>
</div>
```

**Step 5: Verify it compiles**

Run: `npm run build`
Expected: No TypeScript errors

**Step 6: Commit**

```bash
git add src/renderer/components/MatrixGrid.tsx
git commit -m "feat: convert MatrixGrid cells to role dropdowns"
```

---

## Task 10: Wire MatrixPage to TaskQueue

**Files:**
- Modify: `src/renderer/pages/MatrixPage.tsx`

**Step 1: Import useTaskQueue**

Add import:

```typescript
import { useTaskQueue } from '../contexts/TaskQueueContext';
```

**Step 2: Use the hook**

Inside the MatrixPage function, add:

```typescript
const { addTask } = useTaskQueue();
```

**Step 3: Create onRoleChange handler**

Add handler function:

```typescript
const handleRoleChange = useCallback(
  (
    personId: string,
    personName: string,
    roomId: string,
    roomName: string,
    oldRole: string | null,
    newRole: string | null
  ) => {
    // Update local state immediately for responsiveness
    if (newRole) {
      setAssignments((prev) => {
        const newMap = new Map(prev);
        newMap.set(`${personId}:${roomId}`, newRole);
        return newMap;
      });
    } else {
      setAssignments((prev) => {
        const newMap = new Map(prev);
        newMap.delete(`${personId}:${roomId}`);
        return newMap;
      });
    }

    // Add to task queue
    addTask({
      personName,
      roomName,
      personId,
      roomId,
      oldRole,
      newRole,
    });
  },
  [addTask]
);
```

**Step 4: Pass handler to MatrixGrid**

Update the MatrixGrid component usage:

```typescript
<MatrixGrid
  persons={filteredPersons}
  rooms={filteredRooms}
  getAssignment={getAssignment}
  onRoleChange={handleRoleChange}
/>
```

**Step 5: Add useCallback import if not present**

Make sure useCallback is imported from React.

**Step 6: Verify it compiles**

Run: `npm run build`
Expected: No TypeScript errors

**Step 7: Commit**

```bash
git add src/renderer/pages/MatrixPage.tsx
git commit -m "feat: wire MatrixPage to TaskQueue for role changes"
```

---

## Task 11: Handle Webhook Errors with Revert

**Files:**
- Modify: `src/renderer/contexts/TaskQueueContext.tsx`
- Modify: `src/renderer/pages/MatrixPage.tsx`

**Step 1: Add onError callback to Task interface**

In TaskQueueContext.tsx, update the Task interface:

```typescript
export interface Task {
  id: string;
  personName: string;
  roomName: string;
  personId: string;
  roomId: string;
  oldRole: string | null;
  newRole: string | null;
  status: 'queued' | 'processing' | 'success' | 'error';
  error?: string;
  dismissAt?: number;
  onError?: () => void; // Callback to revert UI
}
```

**Step 2: Call onError on failure**

In processQueue, after setting error status, call the callback:

```typescript
} else {
  setTasks((prev) =>
    prev.map((t) =>
      t.id === nextTask.id ? { ...t, status: 'error' as const, error: result.error } : t
    )
  );
  nextTask.onError?.();
}
```

And in the catch block:

```typescript
} catch (error: any) {
  setTasks((prev) =>
    prev.map((t) =>
      t.id === nextTask.id
        ? { ...t, status: 'error' as const, error: error.message || 'Unknown error' }
        : t
    )
  );
  nextTask.onError?.();
}
```

**Step 3: Update addTask signature**

```typescript
const addTask = useCallback((taskData: Omit<Task, 'id' | 'status'>) => {
```

**Step 4: Pass revert callback in MatrixPage**

Update handleRoleChange to pass onError:

```typescript
addTask({
  personName,
  roomName,
  personId,
  roomId,
  oldRole,
  newRole,
  onError: () => {
    // Revert to old role
    if (oldRole) {
      setAssignments((prev) => {
        const newMap = new Map(prev);
        newMap.set(`${personId}:${roomId}`, oldRole);
        return newMap;
      });
    } else {
      setAssignments((prev) => {
        const newMap = new Map(prev);
        newMap.delete(`${personId}:${roomId}`);
        return newMap;
      });
    }
  },
});
```

**Step 5: Verify it compiles**

Run: `npm run build`
Expected: No TypeScript errors

**Step 6: Commit**

```bash
git add src/renderer/contexts/TaskQueueContext.tsx src/renderer/pages/MatrixPage.tsx
git commit -m "feat: revert dropdown on webhook error"
```

---

## Task 12: Final Integration Test

**Step 1: Build and run**

Run: `npm run build && npm start`

**Step 2: Test sync extracts config**

1. Go to Settings, ensure API key and Root Hazu ID are set
2. Go to Dashboard, click "Sync Now"
3. Open DevTools console, look for:
   - "[SYNC] Found Admin Hazu: ..."
   - "[SYNC] Found webhook config: ..."

**Step 3: Test dropdown interaction**

1. Go to Matrix view
2. Change a dropdown from "-" to "Student"
3. Verify TaskQueuePanel appears in top-right
4. Verify task shows "processing" then "success" (or error)

**Step 4: Test error handling**

1. In Settings, temporarily clear the webhook_url setting in DB (or disconnect network)
2. Try changing a dropdown
3. Verify error appears in TaskQueuePanel
4. Verify dropdown reverts to previous value

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete matrix dropdown webhook integration"
```

---

## Summary

After completing all tasks:

- Matrix cells are interactive dropdowns
- Changing a role triggers Make.com webhook
- TaskQueuePanel shows progress/success/errors
- Errors auto-revert the dropdown
- Webhook config extracted from Admin Hazu during sync
