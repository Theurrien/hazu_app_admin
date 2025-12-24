# Bulk Assignment Workflow Design

**Status:** In Progress - API investigation needed
**Date:** 2024-12-24

## Overview

Add existing users to existing rooms/classes via Excel import.

## Confirmed Requirements

### Input
- Excel file with email column (required) to identify users
- Optional grouping column for different assignments per group

### Data Sources
- Synced room categories and rooms (existing SQLite data)
- User profiles fetched by email to get Hazu IDs

### Column Mapping
- Mode: `"assignment"` for DataPreviewTable
- Options: "Email" and "Grouping"
- Email column shows warning icon when emails not found (hover shows row numbers)

### UI Structure

**Without grouping:**
- Single panel: role selector + room selection

**With grouping:**
- One panel per unique grouping value
- Each panel has its own role selector + room selection

**Room Selection (two-panel layout):**
```
┌─────────────────────┬──────────────────────────────┐
│ Categories          │ Rooms                        │
│ ☑ Math Classes      │ [Search rooms...]            │
│ ☑ Science Classes   │ ☑ Math 101                   │
│ ☐ Art Classes       │ ☑ Math 102                   │
│                     │ ☑ Physics 101                │
└─────────────────────┴──────────────────────────────┘
```
- Left panel: checkboxes filter which categories' rooms appear
- Right panel: searchable list of rooms from selected categories

### Role Assignment
- Follows grouping pattern
- Without grouping: one global role for all users
- With grouping: each group gets its own role

### Validation
- Already-assigned users: show warning but skip (no duplicates)
- Unknown emails: warning indicator, not blocking

### Execution
- TaskQueue integration (like Person workflow)
- Task type: `addClassAssignment`

## API Investigation (BLOCKED)

### Current APIs

**`sendApiRequestAddGroup(hazuId, groupIdentifier)`**
- Endpoint: `POST /api-v2-hazus/{hazuId}/groups`
- Adds a group/user TO a Hazu entity
- Single operation, not batch
- Direction: "give this user access to this room"

**`sendApiRequestCreateUser(..., classId[], ...)`**
- Endpoint: `POST /api-v2-admin/add-user`
- Takes `classId: string[]` array for NEW users
- Can assign multiple classes at creation time

### What We Need
An endpoint to add multiple classes to an EXISTING user profile:
```
POST /api-v2-hazus/{userProfileId}/classes
Body: { classIds: ["room1", "room2", "room3"], role: "student" }
```

Or we need to call `sendApiRequestAddGroup(roomId, userId)` for each room individually.

### Google Sheets / n8n
There's an existing n8n webhook (`https://n8n.hazu.swiss/webhook/edu-sheet-extension`) used from Google Sheets, but the payload structure is unclear. Need to check the n8n workflow to understand what it expects.

## Next Steps

1. **Investigate n8n workflow** - Check what payload the `edu-sheet-extension` webhook expects
2. **Check Hazu API docs** - Is there a batch endpoint for adding classes to existing users?
3. **Fallback option** - Use multiple `sendApiRequestAddGroup` calls (one per user-room combination)

## Components to Create (once API is resolved)

1. `ColumnMappingDropdown` - Add `mode="assignment"` with Email/Grouping options
2. `CategoryRoomSelector` - Two-panel room selection component
3. `AssignmentPanel` - Role selector + CategoryRoomSelector per group
4. Integration in `BulkImportPage` - Assignment workflow tab
5. TaskQueue task type - `addClassAssignment`
