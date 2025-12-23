# Create Person Profile Feature Design

## Overview

Add person profile creation functionality to the Hazu Admin desktop app via n8n/Make.com webhook, following the same pattern as room creation.

## Data Flow

### Sources

1. **Roles (Profile Categories)** - First-level children of `root_hazu_id` with `hz-config-profile-*` tags
   - These folders determine available roles AND serve as `targetId` for the webhook
   - Examples: `hz-config-profile-student`, `hz-config-profile-companymentor`

2. **Templates** - Children of `template_id` Hazu, filtered by selected role's tag
   - Provides `sourceId` for the webhook
   - Auto-select if only one template exists for a role

3. **Rooms** - Local SQLite `rooms` table, grouped by `room_type`
   - Categories: class, enterprise, cie, state

### Webhook Payload

```javascript
{
  data: {
    action: 'add-user',
    invitationMail: boolean
  },
  hazu: {
    env: ''
  },
  dataForCloudFunction: {
    sourceId: selectedTemplateId,      // Template to copy from
    targetId: profileCategoryId,       // hz-config-profile-* folder ID
    adminId: adminHazuId,              // From settings
    firstName: string,
    lastName: string,
    userEmail: string,
    classIds: [                        // Room assignments (optional)
      { classId: roomId, userType: selectedRole }
    ]
  }
}
```

## UI Structure

### Modal Layout

```
┌─────────────────────────────────────────────────────┐
│  Create New Person                              [X] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  MANDATORY SECTION                                  │
│  ─────────────────                                  │
│  [FirstName*   ] [LastName*    ] [E-Mail*        ]  │
│                                                     │
│  Role:*                                             │
│  ○ Student  ○ Company Mentor  ○ School Teacher      │
│  ○ Course Teacher  ○ State Advisor  ○ Guardian      │
│                                                     │
│  Template:* [Dropdown filtered by role          ▼]  │
│             (auto-selects if single option)         │
│                                                     │
│  ☐ Send invitation email                            │
│                                                     │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  OPTIONAL ROOM ASSIGNMENT                           │
│  ────────────────────────                           │
│  ▶ Classes (2)           ← count badge if selected  │
│  ▶ Enterprises                                      │
│  ▶ CIE (empty)           ← show if no rooms         │
│  ▶ Cantons                                          │
│                                                     │
├─────────────────────────────────────────────────────┤
│                           [Cancel]  [Create Person] │
└─────────────────────────────────────────────────────┘
```

### Expanded Room Category

```
▼ Classes (2)
  ┌─────────────────────────────────────┐
  │ 🔍 Search classes...                │
  └─────────────────────────────────────┘
  ☑ Class 24-27 NE
  ☑ Class 24-27 JU
  ☐ Class 23-26 NE
  ☐ Class 23-26 JU
```

**Behavior:**
- Click category header to expand/collapse
- Search filters room list in real-time (client-side)
- Multiple rooms selectable across multiple categories
- Selections persist when collapsing/expanding
- Count badge shows selected count when collapsed

## Implementation Tasks

### Backend (Main Process)

1. **Add IPC channels** (`src/shared/ipc-channels.ts`):
   - `PROFILE_CATEGORIES_FETCH` - Get roles from root Hazu
   - `PROFILE_TEMPLATES_FETCH` - Get templates filtered by role
   - `WEBHOOK_CREATE_PERSON` - Send add-user webhook

2. **Add IPC handlers** (`src/main/ipc/index.ts`):
   - `PROFILE_CATEGORIES_FETCH`: Fetch first-level children of `root_hazu_id`, filter by `hz-config-profile-*` tags
   - `PROFILE_TEMPLATES_FETCH`: Fetch children of `template_id`, filter by role tag
   - `WEBHOOK_CREATE_PERSON`: Build and send payload, 100s timeout

3. **Update preload bridge** (`src/main/preload.ts`):
   - Expose `fetchProfileCategories()`, `fetchProfileTemplates(role)`, `createPerson(...)`

### Frontend (Renderer)

4. **Create `CreatePersonModal.tsx`**:
   - Form state for all fields
   - Fetch profile categories on modal open
   - Role selection triggers template fetch
   - Auto-select template if single option
   - Loading/error states for fetches
   - Form validation (all mandatory fields)
   - Submit handler with TaskQueue integration

5. **Create `RoomCategorySelector.tsx`** sub-component:
   - Props: rooms grouped by type, selectedRoomIds, onChange
   - Expand/collapse state per category
   - Search input per expanded category
   - Checkbox list with filtering
   - Count badge display

6. **Wire to `PersonsPage.tsx`**:
   - Add "+ New Person" button next to filters
   - Modal open/close state
   - `onPersonCreated` callback to refresh list

## Error Handling

### Loading States
- Modal open → spinner while fetching profile categories
- Role selected → spinner in template dropdown
- Submit → spinner on Create button, form disabled

### Validation
- FirstName: required, non-empty
- LastName: required, non-empty
- Email: required, valid format
- Role: required selection
- Template: required (auto-selected counts)

### Error Messages
- API not configured: "Please configure API settings first"
- No profile categories: "No profile types configured. Run sync first."
- No templates for role: "No templates available for [role]"
- Webhook failure: Show in TaskQueuePanel with error details

### Edge Cases
- Single template for role → auto-select, show as disabled dropdown or text
- No rooms in category → show "(empty)" label
- Modal stays open during submission (cannot close)
- Webhook completes even if modal closed afterward
- TaskQueuePanel shows progress/success/failure notifications

## Success Flow

1. User fills form, clicks "Create Person"
2. Button shows spinner, form disabled
3. Task added to TaskQueuePanel (processing state)
4. Webhook fires with 100s timeout
5. On success:
   - TaskQueuePanel shows success (auto-dismiss after delay)
   - Modal closes
   - New person added to PersonsPage list
6. On failure:
   - TaskQueuePanel shows error (manual dismiss)
   - Modal stays open for retry
