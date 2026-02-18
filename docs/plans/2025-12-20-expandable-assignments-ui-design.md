# Expandable Assignments UI

## Overview

Added expandable rows to RoomsPage and PersonsPage that show assignments grouped by category when clicked.

## User Flow

1. User is on Rooms or Persons page
2. Clicks a row → row expands to show assignments below
3. Assignments are grouped by category (room_type or person_type) with counts
4. Click again → row collapses

## Components

### AssignmentsList.tsx

Two components for displaying grouped assignments:

- `PersonAssignmentsList` - Shows a person's room assignments grouped by room type (School Classes, Enterprises, etc.)
- `RoomAssignmentsList` - Shows a room's person assignments grouped by person type (Students, School Teachers, etc.)

Both handle loading and empty states.

### RoomsPage.tsx

- Changed from card grid to expandable card list
- Click card → fetches assignments via `getAssignmentsForRoom()`
- Displays grouped persons in expanded section
- Shows expand/collapse indicator (▶/▼)

### PersonsPage.tsx

- Added expand/collapse to table rows
- Click row → fetches assignments via `getAssignmentsForPerson()`
- Displays grouped rooms in expanded section
- Added column for expand indicator

## Data Flow

1. Page loads list of rooms/persons (existing functionality)
2. On click, fetch assignments via IPC (handlers already existed)
3. Group results by category in component
4. Render grouped list with counts

## Display Format

**For a person's expanded view:**
```
School Classes - 2
  • 2024CUIa
  • 2024ECGa

Enterprises - 1
  • Company XYZ
```

**For a room's expanded view:**
```
Students - 15
  • John Doe
  • Jane Smith

School Teachers - 2
  • Mr. Brown
  • Ms. Green
```

## Files Changed

- `src/renderer/components/AssignmentsList.tsx` (new)
- `src/renderer/pages/RoomsPage.tsx` (modified)
- `src/renderer/pages/PersonsPage.tsx` (modified)

## Future Enhancements

- Clickable items to navigate to related room/person
- Matrix view for bulk assignment management
