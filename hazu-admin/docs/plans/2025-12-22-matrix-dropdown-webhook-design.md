# Matrix Dropdown with Webhook Integration

## Overview

Transform the read-only Matrix view into an interactive grid where role changes trigger the Make.com `update-user-roles` webhook.

## Goals

1. Each matrix cell becomes a dropdown for role selection
2. Role changes trigger webhook to sync with Hazu backend
3. Task queue panel shows progress, success, and errors
4. Extract webhook config from Admin Hazu during sync

---

## Data Requirements

### New Settings (extracted during sync)

| Setting | Source | Description |
|---------|--------|-------------|
| `admin_id` | Hazu with tag `hz-config-admin` | Admin Hazu ID |
| `template_id` | Hidden field `hazu[templateLink]` in admin form | Template root ID |
| `webhook_url` | Form `action` attribute | Make.com webhook URL |

### Webhook Payload

```json
{
  "hazu": { "env": "" },
  "data": { "action": "update-user-roles" },
  "dataForCloudFunction": {
    "templateId": "TEMPLATE_ID",
    "profileId": "PERSON_HAZU_ID",
    "userTypesInfo": [{
      "classId": "ROOM_HAZU_ID",
      "oldUserType": "student",
      "newUserType": "schoolteacher"
    }]
  }
}
```

Note: `oldUserType` and `newUserType` use `"_"` for no role.

---

## Data Flow

### Sync: Config Extraction

```
Root Hazu
  └─ Find child with tag "hz-config-admin" → admin_id
       └─ Find item containing form → parse description HTML
            ├─ form action="..." → webhook_url
            └─ input name="hazu[templateLink]" value="..." → template_id
  └─ Store all three in settings table
```

### Runtime: Role Change

```
User changes dropdown (Student → Teacher)
       │
       ▼
MatrixGrid calls onRoleChange(personId, roomId, oldRole, newRole)
       │
       ▼
MatrixPage adds task to TaskQueue
       │
       ▼
TaskQueue processes sequentially:
  1. Show "processing" in panel
  2. Call window.electronAPI.updateUserRole(...)
  3. Main process POSTs to webhook
       │
       ├─ Success → Update local DB, show ✓ for 5s
       │
       └─ Error → Show ✗ persistent, revert dropdown
```

---

## UI Components

### MatrixGrid Cell (transformed)

```tsx
<select
  value={role || '_'}
  onChange={(e) => onRoleChange(personId, roomId, role, e.target.value)}
  disabled={isSaving}
  className={cellClassName}
>
  <option value="_">-</option>
  <option value="student">Student</option>
  <option value="companymentor">Mentor</option>
  <option value="schoolteacher">Teacher</option>
  <option value="courseteacher">Course T.</option>
  <option value="stateadvisor">Advisor</option>
  <option value="guardian">Guardian</option>
</select>
```

### Task Queue Panel

Position: Fixed top-right corner

```
┌─────────────────────────────────┐
│ ⏳ Updating Urs → Neuchâtel...  │  ← Processing
├─────────────────────────────────┤
│ 🕐 Lucas → Jura                 │  ← Queued
│ 🕐 Lidya → Vaud                 │
├─────────────────────────────────┤
│ ✓ Sahar → Fribourg         5s  │  ← Success (auto-dismiss)
├─────────────────────────────────┤
│ ✗ Marc → Berne             [x] │  ← Error (persistent)
│   "Network timeout"            │
└─────────────────────────────────┘
```

### Task States

| State | Icon | Auto-dismiss |
|-------|------|--------------|
| Processing | ⏳ spinner | No |
| Queued | 🕐 clock | No |
| Success | ✓ green | Yes, 5 seconds |
| Error | ✗ red | No, manual [x] |

---

## Error Handling

| Error | User Feedback | Recovery |
|-------|---------------|----------|
| Network unreachable | Error in panel | Revert dropdown |
| Timeout (>10s) | "Timeout" in panel | Revert dropdown |
| HTTP 4xx/5xx | Error message in panel | Revert dropdown |
| Missing config | "Webhook not configured. Run sync." | Block action |

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/renderer/contexts/TaskQueueContext.tsx` | Queue state + provider |
| `src/renderer/components/TaskQueuePanel.tsx` | Floating notification panel |

### Modified Files

| File | Changes |
|------|---------|
| `src/main/database/schema.sql` | Add settings defaults for admin_id, template_id, webhook_url |
| `src/main/services/sync.service.ts` | Extract admin config during sync |
| `src/shared/ipc-channels.ts` | Add `WEBHOOK_UPDATE_USER_ROLE` channel |
| `src/main/ipc/index.ts` | Add webhook call handler |
| `src/main/preload.ts` | Expose `updateUserRole` method + types |
| `src/renderer/components/MatrixGrid.tsx` | Convert cells to dropdowns, add onRoleChange prop |
| `src/renderer/pages/MatrixPage.tsx` | Wire up onRoleChange to TaskQueue |
| `src/renderer/App.tsx` | Wrap app with TaskQueueProvider |

---

## IPC Interface

### Channel

```typescript
// src/shared/ipc-channels.ts
WEBHOOK_UPDATE_USER_ROLE: 'webhook:updateUserRole',
```

### Handler

```typescript
// src/main/ipc/index.ts
ipcMain.handle(IPC_CHANNELS.WEBHOOK_UPDATE_USER_ROLE, async (
  _event,
  personId: string,
  roomId: string,
  oldRole: string | null,
  newRole: string | null
) => {
  // 1. Get webhook config from settings
  // 2. Build payload
  // 3. POST to webhook
  // 4. On success: update local DB
  // 5. Return { success: boolean, error?: string }
});
```

### Preload

```typescript
// src/main/preload.ts
updateUserRole: (
  personId: string,
  roomId: string,
  oldRole: string | null,
  newRole: string | null
) => Promise<{ success: boolean; error?: string }>,
```

---

## Implementation Order

1. **Settings extraction** - Modify sync to find Admin Hazu and parse config
2. **IPC handler** - Add webhook call in main process
3. **TaskQueueContext** - Create queue state management
4. **TaskQueuePanel** - Create notification UI
5. **MatrixGrid dropdowns** - Transform cells to selects
6. **Wire everything** - Connect MatrixPage to queue and IPC

---

## Testing Checklist

- [ ] Sync extracts admin_id, template_id, webhook_url correctly
- [ ] Dropdown shows current role selected
- [ ] Dropdown shows "-" for empty cells
- [ ] Changing role adds task to queue
- [ ] Task shows "processing" state
- [ ] Successful change updates local DB
- [ ] Successful change shows ✓ for 5s then disappears
- [ ] Failed change reverts dropdown
- [ ] Failed change shows ✗ persistently
- [ ] Multiple rapid changes queue properly
- [ ] Error dismiss button works
