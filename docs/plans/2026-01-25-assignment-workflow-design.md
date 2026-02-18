# Assignment Workflow Design

**Status:** Ready for implementation
**Date:** 2026-01-25

## Overview

Add the Assignment workflow to the Bulk Import page. This workflow allows assigning existing users to existing rooms via Excel upload, with matching resolution for ambiguous cases.

## Prerequisites

- Distribution Groups synced (Part 1 - completed)
- User Types synced (Part 1 - completed)

## User Flow

1. Upload Excel file (shared uploader)
2. Map Email column → auto-match to persons in DB
3. Map Room column → auto-match unique values to rooms
4. Select Role (single for entire batch)
5. Resolve unmatched persons (optional)
6. Resolve unmatched rooms (optional)
7. Execute → assign matched person+room pairs

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  Data Preview Table                                     │
│  ┌─────────┬─────────┬─────────┐                        │
│  │ Email ▼ │ Room ▼  │ Name    │  ← Column dropdowns    │
│  ├─────────┼─────────┼─────────┤                        │
│  │ a@x.com │ Class A │ John    │                        │
│  │ b@x.com │ Class B │ Jane    │                        │
│  └─────────┴─────────┴─────────┘                        │
├─────────────────────────────────────────────────────────┤
│  Role Selector                                          │
│  [ Student ▼ ]                                          │
├─────────────────────────────────────────────────────────┤
│  Person Matching                                        │
│  ✓ 45 matched  ⚠ 3 unmatched                           │
│  ┌──────────────────────────────────────┐               │
│  │ unknown@x.com  → [ Search person ▼ ] │               │
│  │ bad@email.com  → [ Search person ▼ ] │               │
│  └──────────────────────────────────────┘               │
├─────────────────────────────────────────────────────────┤
│  Room Matching                                          │
│  ✓ 8 matched  ⚠ 2 unmatched                            │
│  ┌──────────────────────────────────────┐               │
│  │ "Class A"    → [Class A (Class) ▼  ] │  ← auto-match │
│  │ "Unknown"    → [ Select room ▼     ] │  ← needs pick │
│  └──────────────────────────────────────┘               │
├─────────────────────────────────────────────────────────┤
│  Footer: [ Assign 45 persons to rooms ]                 │
└─────────────────────────────────────────────────────────┘
```

## Matching Logic

### Person Matching (by email)

```typescript
// For each row in Excel:
const email = row[emailColumn].trim().toLowerCase();
const person = persons.find(p => p.email?.toLowerCase() === email);

if (person) {
  // ✓ Matched - store person.id
} else {
  // ⚠ Unmatched - show in resolution list
}
```

- Exact match on email (case-insensitive)
- Matched persons are "consumed" - excluded from manual search dropdown
- Unmatched rows show the email value + searchable dropdown of remaining persons

### Room Matching (by unique values)

```typescript
// Extract unique room values from Excel
const uniqueRoomValues = [...new Set(rows.map(r => r[roomColumn].trim()))];

// For each unique value:
for (const value of uniqueRoomValues) {
  const match = rooms.find(r =>
    r.title.toLowerCase() === value.toLowerCase()
  );

  if (match) {
    // ✓ Auto-matched - propose this room, user can override
  } else {
    // ⚠ No match - user must select or row is skipped
  }
}
```

- Case-insensitive exact match on room title
- Even matched rooms show the selector (user can override)
- Grouped by room type, searchable within group

### Skipped Rows

Rows are skipped when:
- Email not matched AND not manually resolved
- Room value not matched AND not manually selected

## API Integration

### Data Sources

| Field | Source |
|-------|--------|
| `sourceId` | `settings.root_hazu_id` (Root ID) |
| `adminId` | `settings.admin_id` (Admin Hazu ID) |
| `targetId` | `persons.id` (matched person's ID) |
| `userEmail` | `persons.email` (from DB) |
| `firstName` | `persons.first_name` (from DB) |
| `lastName` | `persons.last_name` (from DB) |
| `classIds[].classId` | `distribution_groups.id` (looked up by room+role) |
| `classIds[].userType` | Selected role (e.g., "student") |

### Distribution Group Lookup

```typescript
// For each valid assignment (person + room + role):
const distGroup = db.prepare(`
  SELECT id FROM distribution_groups
  WHERE room_id = ? AND role = ?
`).get(roomId, selectedRole);
```

### Aggregation

Same email with multiple rooms gets aggregated into one API user object:

```json
{
  "users": [
    {
      "sourceId": "<root_hazu_id>",
      "adminId": "<admin_id>",
      "targetId": "<person.id>",
      "userEmail": "john@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "classIds": [
        { "classId": "<dist-group-classA>", "userType": "student" },
        { "classId": "<dist-group-classB>", "userType": "student" }
      ]
    }
  ]
}
```

### API Endpoint

```
POST /api-v2-admin/add-users
```

## Component Structure

### New Components

```
src/renderer/components/bulk-import/
├── AssignmentRoleSelector.tsx    # Role dropdown (from user_types)
├── PersonMatchingPanel.tsx       # Person resolution section
├── RoomMatchingPanel.tsx         # Room resolution section
└── GroupedRoomSelector.tsx       # Grouped + searchable room picker
```

### Component Details

**AssignmentRoleSelector**
- Fetches roles from `user_types` table via IPC
- Simple dropdown: Student, Companymentor, Schoolteacher, etc.

**PersonMatchingPanel**
- Props: `rows`, `emailColumn`, `persons`, `personMatches`, `onResolutionChange`
- Shows: "✓ 45 matched · ⚠ 3 unmatched"
- Lists unmatched emails with search dropdown
- Dropdown excludes already-matched persons

**RoomMatchingPanel**
- Props: `uniqueRoomValues`, `rooms`, `roomMatches`, `onResolutionChange`
- Shows each unique value with room selector
- Pre-selects exact matches
- User can override any selection

**GroupedRoomSelector**
- Props: `rooms`, `value`, `onChange`
- Groups: Class, Company, CIE, Canton
- Searchable within each group

## State Management

### New State in BulkImportPage

```typescript
// Assignment workflow state
const [emailColumn, setEmailColumn] = useState<string | null>(null);
const [roomColumn, setRoomColumn] = useState<string | null>(null);
const [selectedAssignmentRole, setSelectedAssignmentRole] = useState<string | null>(null);

// Matching results (computed from columns)
const [personMatches, setPersonMatches] = useState<Map<string, string | null>>(new Map());
// Key: email from Excel, Value: person.id or null if unmatched

const [roomMatches, setRoomMatches] = useState<Map<string, string | null>>(new Map());
// Key: unique room value from Excel, Value: room.id or null if unmatched

// Manual resolutions (user overrides)
const [personResolutions, setPersonResolutions] = useState<Map<string, string>>(new Map());
// Key: email, Value: manually selected person.id

const [roomResolutions, setRoomResolutions] = useState<Map<string, string>>(new Map());
// Key: room value, Value: manually selected room.id
```

### Computed Values

```typescript
// Final resolved mappings (auto-match + manual resolution)
const resolvedPersons = useMemo(() => {
  const result = new Map(personMatches);
  personResolutions.forEach((personId, email) => {
    result.set(email, personId);
  });
  return result;
}, [personMatches, personResolutions]);

// Valid assignment count
const validAssignmentCount = useMemo(() => {
  return fileData.rows.filter(row => {
    const email = row[emailColumn];
    const roomValue = row[roomColumn];
    return resolvedPersons.get(email) && resolvedRooms.get(roomValue);
  }).length;
}, [fileData, resolvedPersons, resolvedRooms]);
```

## IPC Additions

### New Handlers

```typescript
// Get user types (roles)
ipcMain.handle('getUserTypes', async () => {
  return query('SELECT id, name, title FROM user_types ORDER BY title');
});

// Get distribution group for room+role
ipcMain.handle('getDistributionGroup', async (_event, roomId: string, role: string) => {
  return get(
    'SELECT id FROM distribution_groups WHERE room_id = ? AND role = ?',
    [roomId, role]
  );
});

// Execute assignments
ipcMain.handle('executeAssignments', async (_event, payload: AssignmentPayload) => {
  // Build API request, call POST /api-v2-admin/add-users
  // Return success/failure counts
});
```

## Files to Modify

### New Files
- `src/renderer/components/bulk-import/AssignmentRoleSelector.tsx`
- `src/renderer/components/bulk-import/PersonMatchingPanel.tsx`
- `src/renderer/components/bulk-import/RoomMatchingPanel.tsx`
- `src/renderer/components/bulk-import/GroupedRoomSelector.tsx`

### Modified Files
- `src/renderer/pages/BulkImportPage.tsx` - Add assignment workflow
- `src/main/ipc/index.ts` - Add IPC handlers
- `src/main/preload.ts` - Expose new methods
- `src/shared/types.ts` - Add interfaces

## Testing

After implementation:
1. Upload Excel with email and room columns
2. Verify auto-matching works (case-insensitive)
3. Test manual resolution for unmatched items
4. Test role selection from user_types
5. Execute and verify API call structure
6. Verify aggregation for same-person multiple-rooms
