# Bulk Import Feature - Room Creation

## Overview

A new "Bulk Import" page for uploading Excel/CSV files and creating rooms in batch. The page presents an interactive single-view interface where users map columns, configure rooms, and monitor creation progress.

## Supported Formats

- Excel: `.xlsx`, `.xls`
- CSV: `.csv`

Uses `xlsx` npm package for parsing in the main process.

## User Flow

### 1. Upload File

- Drag-and-drop zone + "Browse" button
- Checkbox: "☑ First row contains column headers" (checked by default)
- If unchecked, columns labeled "Column A, Column B, Column C..."
- Shows file name after upload with option to replace

### 2. Select Room Type

- Checkboxes: Class / Enterprise / State / CIE (single selection)
- Selection triggers template fetch for that room type

### 3. Map Name Column

- Data preview table shows all columns and first ~100 rows
- User clicks a column header to designate it as the "Name" source
- Circled ① appears on selected column header
- Unique values are extracted from that column

### 4. Configure Variables

- Unique values appear as tabs (e.g., `ACUIA | ZCUIA | ...`)
- Each tab represents a room to potentially create
- Per-tab configuration:
  - **Current name**: Value from data (read-only display)
  - **New Name**: Input field to rename (optional, defaults to original)
  - **Template**: Dropdown to select template
- Green ✓ checkmark appears next to tab name when template is selected
- Tabs without template = skipped during creation

### 5. Create Rooms

- Start button shows count: "Create 2 rooms"
- Disabled until at least one room has a template assigned
- Calls existing `createRoom` webhook for each configured room
- Continues through all rooms even if some fail

### 6. Results (Evolving List)

- Each room appears as a row in real-time (like TaskQueue pattern):
  - ⏳ "Creating ACUIA..." (in progress)
  - ✓ "ACUIA created" [Open link] (success)
  - ✗ "ZCUIA failed: error message" [Retry] (error)
- New rows stack below as processing continues
- User can click "Open" links immediately
- "Start Over" button to reset after completion

## Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Room Creation]  [Person]  [Assignment]    ← Workflow tabs │
├─────────────────────────────────────────────────────────────┤
│  ☐ Class  ☐ Enterprise  ☐ State  ☐ CIE     ← Room type     │
├─────────────────────────────────────────────────────────────┤
│  Needed variables:                                          │
│  ① Name                                                     │
│                                                             │
│  [ACUIA ✓] [ZCUIA] [...]                   ← Variable tabs │
│  ┌─────────────────────────────────┐                       │
│  │ Current: ACUIA                  │                       │
│  │ New Name: [_______________]     │                       │
│  │ Template: [▼ Choose       ]     │                       │
│  └─────────────────────────────────┘                       │
├─────────────────────────────────────────────────────────────┤
│  ☑ First row contains headers              [↑ Upload]      │
│  ┌────┬────┬────────┬───────┬──────┬─────┐                 │
│  │ ID │Date│ Class① │ First │ Last │ ... │  ← Data preview │
│  ├────┼────┼────────┼───────┼──────┼─────┤                 │
│  │  1 │ .. │ ACUIA  │  ...  │  ... │     │                 │
│  │  2 │ .. │ ACUIA  │  ...  │  ... │     │                 │
│  │  3 │ .. │ ZCUIA  │  ...  │  ... │     │                 │
│  └────┴────┴────────┴───────┴──────┴─────┘                 │
├─────────────────────────────────────────────────────────────┤
│                              [Create 2 rooms]  ← Start btn  │
├─────────────────────────────────────────────────────────────┤
│  ✓ ACUIA created                    [Open]  ← Results list │
│  ⏳ Creating ZCUIA...                                       │
└─────────────────────────────────────────────────────────────┘
```

## Component Architecture

```
src/renderer/
├── pages/
│   └── BulkImportPage.tsx           # Main page with workflow tabs
├── components/
│   └── bulk-import/
│       ├── FileUploader.tsx         # Drag-drop + browse + headers checkbox
│       ├── DataPreviewTable.tsx     # Parsed data, clickable column headers
│       ├── RoomTypeSelector.tsx     # Class/Enterprise/State/CIE selection
│       ├── VariableTabs.tsx         # Unique values as tabs with ✓ indicators
│       ├── RoomConfigurator.tsx     # Name input + template dropdown
│       └── BulkImportProgress.tsx   # Evolving results list

src/main/
├── ipc/
│   └── index.ts                     # Add PARSE_FILE handler
```

## IPC Channels

### New Channel

- `PARSE_FILE` - Receives file path, returns `{ headers: string[], rows: object[] }`

### Existing Channels (reused)

- `FETCH_TEMPLATES` - Get templates for room type
- `WEBHOOK_CREATE_ROOM` - Create individual room

## Page State

```typescript
interface BulkImportState {
  // Workflow selection
  activeWorkflow: 'room' | 'person' | 'assignment';

  // File data
  fileData: { headers: string[]; rows: Record<string, string>[]; fileName: string } | null;
  hasHeaders: boolean;

  // Room configuration
  roomType: 'class' | 'enterprise' | 'state' | 'cie' | null;
  mappedColumn: string | null;
  uniqueValues: string[];
  roomConfigs: Map<string, { newName: string; templateId: string | null }>;

  // Processing
  isProcessing: boolean;
  results: Array<{
    name: string;
    status: 'pending' | 'success' | 'error';
    link?: string;
    error?: string;
  }>;
}
```

## Dependencies

Add to package.json:
```json
{
  "xlsx": "^0.18.5"
}
```

## Error Handling

- Empty file → "File is empty" error message
- Invalid format → "Unsupported file format" error
- No column mapped → Start button disabled
- No templates selected → Start button disabled, shows "0 rooms"
- Webhook failure → Row shows error, continues to next room
- All failed → Summary shows all errors, option to retry

## Future Extensions

- **Person Creation**: Same flow, different required fields (FirstName, LastName, Email)
- **Person-Room Assignment**: Map person identifier + room identifier columns
- Both workflows reuse the same file upload and column mapping infrastructure
