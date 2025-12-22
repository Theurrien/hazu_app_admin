# Create Room Feature Design

## Overview

Add room creation functionality to RoomsPage via n8n/Make.com webhook. Users can create new rooms (class, cie, enterprise, state) by selecting a type, choosing a template, and entering a name.

## Goals

1. Add [+] button to RoomsPage that opens a creation modal
2. Fetch templates on-demand from Hazu API (not stored locally)
3. Call `create-group` webhook to create the room
4. Update local database with returned room snapshot

---

## UI Flow

**RoomsPage with + button:**

```
┌─────────────────────────────────────────────────────────┐
│ Rooms                                            [+]    │
├─────────────────────────────────────────────────────────┤
│ [Filter: All Types ▼] [Search...]                       │
├─────────────────────────────────────────────────────────┤
│ 📚 Class A          │ 🏢 Company X       │ 🏛️ Canton Y  │
└─────────────────────────────────────────────────────────┘
```

**CreateRoomModal:**

```
┌─────────────────────────────────────────┐
│ Create New Room                    [×]  │
├─────────────────────────────────────────┤
│ Room Type                               │
│ ┌─────────────────────────────────────┐ │
│ │ ○ Class                             │ │
│ │ ○ CIE                               │ │
│ │ ○ Enterprise                        │ │
│ │ ○ State                             │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Template              (shows after type)│
│ ┌─────────────────────────────────────┐ │
│ │ Select template...             ▼    │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Room Name                               │
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│              [Cancel]  [Create Room]    │
└─────────────────────────────────────────┘
```

**Flow:**
1. Click [+] → Modal opens, fetches templates from Hazu API
2. User selects type → Template dropdown filters to `hz-config-room-{type}` templates
3. Parent location auto-determined (first-level room with matching tag)
4. User selects template + enters name
5. Submit → webhook call → success → insert room locally → refresh list

---

## Data Flow

### On Modal Open

```
Modal opens
    │
    ▼
Fetch templates from Hazu API
    │ GET children of templateLink (stored in settings as root_hazu_id)
    │
    ▼
Filter by hz-config-room-* tags
    │
    ▼
Group by type:
    ├─ hz-config-room-class → Class templates
    ├─ hz-config-room-cie → CIE templates
    ├─ hz-config-room-entreprise → Enterprise templates
    └─ hz-config-room-state → State templates
```

### On Submit

```
User clicks "Create Room"
    │
    ▼
Determine parent location
    │ Query local DB: first-level room with hz-config-room-{type} tag
    │
    ▼
Build payload:
{
  data: { action: 'create-group' },
  hazu: { env: '' },
  dataForCloudFunction: {
    sourceId: selectedTemplate.id,
    templateId: settings.root_hazu_id,
    targetId: parentLocation.id,
    title: userEnteredName
  }
}
    │
    ▼
POST to webhook_url (already in settings)
    │
    ├─ Success → Insert room from response snapshot
    │            Close modal, refresh list, show toast
    │
    └─ Error → Show error in modal, allow retry
```

---

## Webhook Payload

```json
{
  "data": { "action": "create-group" },
  "hazu": { "env": "" },
  "dataForCloudFunction": {
    "sourceId": "template-id",
    "templateId": "root-hazu-id",
    "targetId": "parent-location-id",
    "title": "Room Name"
  }
}
```

**Response (on success):**

```json
{
  "profileSnapshot": {
    "snapshot": {
      "key": "new-room-id",
      "title": "Room Name",
      "parentId": "parent-location-id",
      "tags": ["hz-config-room-class", ...],
      ...
    }
  }
}
```

---

## Implementation

### New IPC Channels

```typescript
// src/shared/ipc-channels.ts
TEMPLATES_FETCH: 'templates:fetch',
WEBHOOK_CREATE_ROOM: 'webhook:createRoom',
```

### New/Modified Files

| File | Changes |
|------|---------|
| `src/shared/ipc-channels.ts` | Add 2 new channels |
| `src/main/ipc/index.ts` | Add handlers for fetch templates + create room |
| `src/main/preload.ts` | Expose `fetchTemplates()` and `createRoom()` |
| `src/renderer/pages/RoomsPage.tsx` | Add [+] button, modal trigger |
| `src/renderer/components/CreateRoomModal.tsx` | **New** - modal component |

### TypeScript Interfaces

```typescript
interface Template {
  id: string;
  title: string;
  roomType: 'class' | 'cie' | 'enterprise' | 'state';
  icon?: string;
  color?: string;
}

interface CreateRoomModalState {
  isOpen: boolean;
  isLoading: boolean;           // fetching templates
  isSubmitting: boolean;        // calling webhook
  templates: Template[];
  selectedType: RoomType | null;
  selectedTemplateId: string | null;
  roomName: string;
  error: string | null;
}
```

### IPC Handlers

**Fetch Templates:**

```typescript
ipcMain.handle(IPC_CHANNELS.TEMPLATES_FETCH, async () => {
  // 1. Get templateLink from settings (root_hazu_id)
  // 2. Call Hazu API: list children of templateLink
  // 3. Filter by hz-config-room-* tags
  // 4. Map to Template interface with roomType extracted from tag
  // 5. Return Template[]
});
```

**Create Room:**

```typescript
ipcMain.handle(IPC_CHANNELS.WEBHOOK_CREATE_ROOM, async (
  _event,
  templateId: string,
  targetId: string,
  title: string
) => {
  // 1. Get webhook_url and root_hazu_id from settings
  // 2. Build payload with action: 'create-group'
  // 3. POST to webhook (100s timeout)
  // 4. On success: insert room into local DB from response
  // 5. Return { success: boolean, room?: Room, error?: string }
});
```

---

## Error Handling

| Scenario | UI Feedback | Behavior |
|----------|-------------|----------|
| Template fetch fails | "Failed to load templates" | Retry button |
| No templates for type | "No templates available" | Disable Create |
| Webhook not configured | "Run sync first" | Block modal open |
| Webhook fails | Error message | Keep modal open |
| Webhook timeout | "Request timed out" | Allow retry |
| Empty room name | Validation error | Disable Create |

---

## Loading States

- **Modal opens:** Spinner while fetching templates
- **Submit:** "Creating..." with disabled button and spinner
- **Success:** Close modal, show success toast
- **Error:** Show error message in modal

---

## Notes

- Templates are fetched on-demand, not stored locally (there aren't many)
- One parent location per room type (auto-determined)
- Uses same webhook URL and 100s timeout as update-user-roles
- Uses inline loading in modal (not TaskQueue - single action)
- Room snapshot from webhook response is inserted into local `rooms` table
