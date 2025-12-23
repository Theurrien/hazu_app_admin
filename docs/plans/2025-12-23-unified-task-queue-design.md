# Unified Task Queue Design

## Overview

Extend TaskQueueContext to support multiple task types (role updates, room creation, person creation) with success notifications and links to open created items in Hazu.

## Task Types & Data Model

```typescript
type TaskType = 'roleUpdate' | 'createRoom' | 'createPerson';

interface BaseTask {
  id: string;
  type: TaskType;
  status: 'queued' | 'processing' | 'success' | 'error';
  error?: string;
}

interface RoleUpdateTask extends BaseTask {
  type: 'roleUpdate';
  personName: string;
  personId: string;
  roomName: string;
  roomId: string;
  oldRole: string | null;
  newRole: string | null;
  onError?: () => void;
}

interface CreateRoomTask extends BaseTask {
  type: 'createRoom';
  roomName: string;
  roomId: string;
}

interface CreatePersonTask extends BaseTask {
  type: 'createPerson';
  personName: string;
  personId: string;
}

type Task = RoleUpdateTask | CreateRoomTask | CreatePersonTask;
```

## Context API

```typescript
interface TaskQueueContextType {
  tasks: Task[];

  // For role updates (queued, processed sequentially)
  addTask: (task: Omit<RoleUpdateTask, 'id' | 'status'>) => string;

  // For creation notifications (immediate, success only)
  addNotification: (notification:
    | { type: 'createRoom'; roomName: string; roomId: string }
    | { type: 'createPerson'; personName: string; personId: string }
  ) => string;

  dismissTask: (id: string) => void;
}
```

## Display Format

| Task Type | Display | Success Action |
|-----------|---------|----------------|
| roleUpdate | `John Doe → Class 24-27` | × dismiss only |
| createRoom | `+ Class 25-28` | "Open ↗" link + × dismiss |
| createPerson | `+ John Doe` | "Open ↗" link + × dismiss |

## Behavior

- **No auto-dismiss**: All items persist until manually closed
- **Queued processing**: Only roleUpdate tasks are queued and processed sequentially
- **Immediate notifications**: createRoom/createPerson are added directly as success
- **Errors for creations**: Stay in modal only, not shown in panel
- **Links**: Open `https://hazu.swiss/{id}` in new browser tab

## Panel Layout

```
┌─────────────────────────────────────────┐
│ Task Queue (3)                          │
├─────────────────────────────────────────┤
│ ✓ + Class 25-28           Open ↗    ×  │
│ ✓ + John Doe              Open ↗    ×  │
│ ✓ Alice Smith → Class 24              × │
└─────────────────────────────────────────┘
```

## Implementation Tasks

### 1. Update TaskQueueContext.tsx
- Change Task type to discriminated union
- Add `addNotification` function for immediate success notifications
- Remove auto-dismiss countdown logic (dismissAt, interval)
- Keep queue processing only for roleUpdate type

### 2. Update TaskQueuePanel.tsx
- Update TaskItem to handle all task types
- Add `getLabel()` helper for type-specific display text
- Add `getLink()` helper for creation success links
- Remove countdown timer display
- Ensure × dismiss button on all items

### 3. Update CreateRoomModal.tsx
- Import `useTaskQueue` hook
- Call `addNotification({ type: 'createRoom', roomName, roomId })` on success

### 4. Update CreatePersonModal.tsx
- Import `useTaskQueue` hook
- Call `addNotification({ type: 'createPerson', personName, personId })` on success

## Usage Examples

### In CreateRoomModal:
```typescript
const { addNotification } = useTaskQueue();

// After successful creation:
if (result.success && result.room) {
  addNotification({
    type: 'createRoom',
    roomName: roomName,
    roomId: result.room.id,
  });
  onRoomCreated(result.room);
  onClose();
}
```

### In CreatePersonModal:
```typescript
const { addNotification } = useTaskQueue();

// After successful creation:
if (result.success && result.person) {
  addNotification({
    type: 'createPerson',
    personName: `${firstName} ${lastName}`,
    personId: result.person.id,
  });
  onPersonCreated(result.person);
  onClose();
}
```
