# Delete & Rename Feature Design

## Overview

Add delete functionality for rooms and persons, and rename functionality for rooms. Actions appear in matrix headers (hover) and detail panels (always visible).

## UI Components

### DeleteConfirmationModal

- Reusable for rooms and persons
- Red-tinted warning dialog
- Header: "Delete [Room/Person]?"
- Warning text: "This action cannot be undone. [Name] will be permanently deleted."
- Buttons: "Cancel" (gray), "Delete" (red)
- Shows loading state while webhook executes
- Displays error message on failure

### RenameRoomModal

- Simple input dialog
- Header: "Rename Room"
- Pre-filled input with current room title
- Buttons: "Cancel", "Save"
- Validates non-empty input
- Shows loading/error states

### Icons

| Icon | Color | Size (Matrix) | Size (Panels) |
|------|-------|---------------|---------------|
| Trash (delete) | Red | 14px | 16px |
| Pencil (rename) | Gray | 14px | 16px |

### Placement

| Location | Delete | Rename | Visibility |
|----------|--------|--------|------------|
| Matrix room headers | ✓ | ✓ | Hover |
| Matrix person rows | ✓ | — | Hover |
| RoomCard (RoomsPage) | ✓ | ✓ | Always, far right |
| PersonRow (PersonsPage) | ✓ | — | Always, far right |

## Backend & IPC

### New IPC Channels

```typescript
WEBHOOK_DELETE_ROOM: 'webhook:deleteRoom'
WEBHOOK_DELETE_PERSON: 'webhook:deletePerson'
WEBHOOK_RENAME_ROOM: 'webhook:renameRoom'
```

### Preload Bridge Methods

```typescript
deleteRoom(roomId: string): Promise<{ success: boolean; error?: string }>
deletePerson(personId: string): Promise<{ success: boolean; error?: string }>
renameRoom(roomId: string, newTitle: string): Promise<{ success: boolean; error?: string }>
```

### Webhook Payloads

**Delete Room**
```json
{
  "hazu": { "env": "" },
  "data": { "action": "remove-group" },
  "dataForCloudFunction": {
    "templateId": "<from settings>",
    "groupId": "<roomId>"
  }
}
```

**Delete Person**
```json
{
  "hazu": { "env": "" },
  "data": { "action": "remove-user" },
  "dataForCloudFunction": {
    "templateId": "<from settings>",
    "profileId": "<personId>"
  }
}
```

**Rename Room**
```json
{
  "hazu": { "env": "" },
  "data": { "action": "rename-group" },
  "dataForCloudFunction": {
    "templateId": "<from settings>",
    "groupId": "<roomId>",
    "newName": "<newTitle>"
  }
}
```

### Database Operations (on webhook success only)

- Delete room: `DELETE FROM rooms WHERE id = ?` (cascades to assignments)
- Delete person: `DELETE FROM persons WHERE id = ?` (cascades to assignments)
- Rename room: `UPDATE rooms SET title = ? WHERE id = ?`

## Component Integration

### Data Flow

```
User clicks delete/rename icon
  → Modal opens with entity name
  → User confirms (or enters new name)
  → Modal calls window.electronAPI method
  → Webhook executes
  → On success:
    - Local DB updated
    - Modal calls onSuccess callback
    - Parent component refetches data
  → On error:
    - Modal displays error message
    - Entity remains unchanged
```

### MatrixGrid Props (new)

```typescript
onDeleteRoom?: (roomId: string) => void;
onDeletePerson?: (personId: string) => void;
onRenameRoom?: (roomId: string, newTitle: string) => void;
```

### State Management

- No task queue needed (single immediate operations)
- Callback pattern: modal → onSuccess → parent refetch

## Files to Create

| File | Purpose |
|------|---------|
| `src/renderer/components/DeleteConfirmationModal.tsx` | Reusable delete warning |
| `src/renderer/components/RenameRoomModal.tsx` | Room rename dialog |

## Files to Modify

| File | Changes |
|------|---------|
| `src/shared/ipc-channels.ts` | Add 3 new channels |
| `src/main/preload.ts` | Add 3 bridge methods + types |
| `src/main/ipc/index.ts` | Add 3 webhook handlers |
| `src/renderer/components/MatrixGrid.tsx` | Hover icons, new props, modal triggers |
| `src/renderer/pages/RoomsPage.tsx` | Icons in RoomCard, wire modals |
| `src/renderer/pages/PersonsPage.tsx` | Icon in PersonRow, wire modal |

## Implementation Order

1. Add IPC channels and preload bridge methods
2. Add webhook handlers in main process
3. Create DeleteConfirmationModal component
4. Create RenameRoomModal component
5. Integrate into RoomsPage (RoomCard)
6. Integrate into PersonsPage (PersonRow)
7. Integrate into MatrixGrid (hover actions)
