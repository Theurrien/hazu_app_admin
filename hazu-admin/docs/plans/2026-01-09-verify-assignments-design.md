# Verify Assignments Feature Design

## Overview

A new "Verify Assignments" tab in the Bulk Import page that compares person-room relationships from an imported Excel file against actual Hazu platform data. Shows discrepancies only.

## Use Case

Administrators need to audit whether persons (students, mentors, etc.) are correctly assigned to rooms (enterprises, classes, etc.). They import an Excel file representing the expected state and compare it against Hazu.

## User Workflow

1. Upload Excel file (shared with other bulk import tabs)
2. Select relationship to verify:
   - Person type (Student, Company Mentor, School Teacher, etc.)
   - Room type (Enterprise, Class, CIE, Canton)
3. Map Excel columns:
   - Email column (identifies persons)
   - Room name column (identifies rooms)
4. Choose matching mode for room names
5. Click "Verify"
6. View discrepancies in two lists

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  Relationship Selection                                 │
│  ┌─────────────────┐    ┌─────────────────┐            │
│  │ Person Type   ▼ │    │ Room Type     ▼ │            │
│  └─────────────────┘    └─────────────────┘            │
├─────────────────────────────────────────────────────────┤
│  Column Mapping                                         │
│  ┌─────────────────┐    ┌─────────────────┐            │
│  │ Email Column  ▼ │    │ Room Name Col ▼ │            │
│  └─────────────────┘    └─────────────────┘            │
├─────────────────────────────────────────────────────────┤
│  Matching Mode                                          │
│  ○ Strict    ○ Normal    ○ Loose                       │
├─────────────────────────────────────────────────────────┤
│  [ Verify Assignments ]                                 │
├─────────────────────────────────────────────────────────┤
│  Results                                                │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Missing in Hazu (3)                              ▼ ││
│  │  • john@email.com → Acme Corp                      ││
│  │  • jane@email.com → Beta Inc                       ││
│  ├─────────────────────────────────────────────────────┤│
│  │ Extra in Hazu (2)                                ▼ ││
│  │  • john@email.com → Old Company Ltd                ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

## Fuzzy Matching Modes

| Mode | Behavior | Use When |
|------|----------|----------|
| **Strict** | Exact match, case-insensitive, trimmed whitespace | Names are clean and consistent |
| **Normal** | Levenshtein distance ≤ 2, ignores case | Minor spelling variations expected |
| **Loose** | Token-based matching (e.g., "Acme" matches "Acme Corp AG") | Abbreviations, suffixes vary |

### Matching Algorithm

1. Normalize strings: lowercase, trim, collapse whitespace
2. For each Excel room name, score against all Hazu rooms of selected type
3. Pick best match if score exceeds threshold:
   - Normal: similarity ≥ 85%
   - Loose: similarity ≥ 60% OR all tokens from shorter string found in longer
4. No match found → mark as "unmatched"

## Data Flow

**When user clicks "Verify":**

1. Gather inputs from UI
2. Fetch from SQLite:
   - Persons of selected type (filtered by tag prefix)
   - Rooms of selected type (filtered by tag)
   - Existing assignments between these
3. Build comparison sets:
   - Excel set: (email, room name) pairs from spreadsheet
   - Hazu set: (email, room name) pairs from assignments
4. Apply fuzzy matching to map Excel room names → Hazu rooms
5. Compare sets:
   - Missing in Hazu = Excel pairs not in Hazu
   - Extra in Hazu = Hazu pairs not in Excel

### Result Structure

```typescript
interface VerificationResult {
  missingInHazu: Array<{
    email: string;
    roomName: string;
    personName?: string;
  }>;
  extraInHazu: Array<{
    email: string;
    roomName: string;
    personName?: string;
  }>;
  unmatchedRooms: string[];   // Excel room names with no Hazu match
  unknownPersons: string[];   // Emails not found in Hazu
}
```

## Implementation

### Files to Create

| File | Purpose |
|------|---------|
| `src/renderer/components/bulk-import/VerifyAssignmentsTab.tsx` | Main tab component |
| `src/renderer/components/bulk-import/VerificationResults.tsx` | Discrepancy lists display |
| `src/renderer/utils/fuzzyMatch.ts` | Matching functions |

### Files to Modify

| File | Change |
|------|--------|
| `src/renderer/pages/BulkImportPage.tsx` | Add new tab |
| `src/main/ipc/index.ts` | Add handler if needed: `getAssignmentsByType` |

### Reused Components

- `ColumnMappingDropdown.tsx` - Column selection
- File upload state from `BulkImportPage`
- Assignment queries from `PersonsPage` / `RoomsPage`

### No New Dependencies

Implement Levenshtein distance directly (~20 lines). Keeps bundle small.

## Edge Cases

| Case | Handling |
|------|----------|
| All assignments match | Show "All assignments match" message |
| No file loaded | Disable controls, prompt to upload |
| Unmatched room names | Show in separate "Unmatched Rooms" section |
| Unknown emails | Show in separate "Unknown Persons" section |
| Duplicate Excel rows | Deduplicate before comparison |

## Out of Scope

- Export results to file
- Fix discrepancies from this view
- Save verification presets
