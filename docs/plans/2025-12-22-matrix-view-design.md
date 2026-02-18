# Matrix View Design

## Overview

Person × Room assignment matrix with role display, filtering, and smart sorting. Designed to handle thousands of persons with virtualized rendering.

## Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ PERSON FILTERS          │ ROOM FILTERS                              │
│ [Stud] [Teach] [Comp]   │ [School] [Canton] [Entr] [Comp]          │
│ [Course] [State] [Guar] │                                           │
│ ┌──────────────────┐    │ ┌──────────────────┐                      │
│ │ Search persons...│    │ │ Search rooms...  │                      │
│ └──────────────────┘    │ └──────────────────┘                      │
├─────────────────────────┼───────────────────────────────────────────┤
│                         │  2024     Entre-    CIE       Canton      │
│    Person Name          │  CUIa     prise     Course    Vaud    ... │
│    (180px)              │           ABC       Alpha                 │
├─────────────────────────┼─────────┬─────────┬─────────┬─────────┬───┤
│ Jean-Pierre Müller      │ Student │         │         │         │   │
├─────────────────────────┼─────────┼─────────┼─────────┼─────────┼───┤
│ Marie Dubois            │         │ Teacher │         │         │   │
├─────────────────────────┼─────────┼─────────┼─────────┼─────────┼───┤
│ Thomas Zimmermann       │         │         │ Company │         │   │
│                         │         │         │ mentor  │         │   │
└─────────────────────────┴─────────┴─────────┴─────────┴─────────┴───┘
```

- **Left panel**: Person type filter chips (6) + search box
- **Top panel**: Room type filter chips (4) + search box
- **Matrix body**: Virtualized, scrollable both directions
- **Sticky headers**: Person column and room row stay visible while scrolling

## Specifications

### Row Headers (Persons)
- Width: 180px fixed
- Single line, truncate with ellipsis
- Tooltip shows full name on hover

### Column Headers (Rooms)
- Width: 80-100px fixed
- Horizontal text, wraps to max 3 lines
- Truncate with ellipsis after 3 lines
- Tooltip shows full name on hover

### Cells
- Empty cells: blank (no content, no special styling)
- Assigned cells: full role text ("Student", "Teacher", "Companymentor", etc.)
- Read-only initially (dropdown editing added later)

## Filtering

### Type Filters
- Multi-select toggle chips
- Person types: Student, Teacher, Companymentor, Courseteacher, Stateadvisor, Guardian
- Room types: Class, Enterprise, Canton, CIE
- All ON by default
- Matrix shows intersection of selected types

### Search
- Independent search boxes for persons and rooms
- Filters respective axis to matching names
- Case-insensitive partial match

## Smart Sorting

### Person Search Active
1. Filter rows to matching person names
2. Reorder columns: topmost person's assigned rooms first
3. Remaining columns: category order (Class → Enterprise → Canton → CIE), then alphabetical

### Room Search Active
1. Filter columns to matching room names
2. Reorder rows: topmost room's assigned persons first
3. Remaining rows: category order (Student → Schoolteacher → ...), then alphabetical

### Default Order (No Search)
- Rows: by person type category, then alphabetical
- Columns: by room type category, then alphabetical

### Clear Search
- Reset to default sort order
- Filters remain as selected

## Data Flow

1. On page load: fetch all persons, rooms, assignments in parallel
2. Build in-memory lookup: `Map<"personId-roomId", role>`
3. Apply filters and sorting client-side (no re-fetch needed)

## Component Structure

```
MatrixPage.tsx
├── MatrixFilters.tsx
│   ├── PersonTypeFilters (6 chips)
│   ├── PersonSearch (input)
│   ├── RoomTypeFilters (4 chips)
│   └── RoomSearch (input)
├── MatrixGrid.tsx (virtualized)
│   ├── ColumnHeaders (sticky, virtualized horizontally)
│   ├── RowHeaders (sticky, virtualized vertically)
│   └── MatrixCells (virtualized both directions)
└── useMatrixData.ts (hook for data + filtering + sorting logic)
```

## New IPC Handler

```typescript
// New handler needed
getAllAssignments(): Promise<Array<{
  person_id: string;
  room_id: string;
  role: string;
}>>
```

## Performance

- Virtualized rendering (only visible rows/columns + buffer)
- Sticky first column and header row
- Client-side filtering/sorting after initial load
- Designed to handle 1000+ persons, 200+ rooms

## Future Enhancements

- Click cell to open dropdown menu for assigning/changing role
- Export matrix to CSV/Excel
- Bulk assignment operations
