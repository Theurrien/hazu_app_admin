# Bulk Person Creation Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable bulk creation of persons from Excel files with role assignment, template mapping, and room assignments via grouping columns.

**Architecture:** Extend existing BulkImportPage with Person workflow tab. Reuse existing TaskQueue infrastructure with `addCreatePersonTask` for individual person creation. Column mapping via dropdown on table headers.

**Tech Stack:** React, TypeScript, existing Electron IPC, TaskQueueContext

---

## Design Decisions

### Role Selection
- One role applies to all persons in the batch
- Radio button group (Student, Company Mentor, School Teacher, Course Teacher, State Advisor, Guardian)

### Template Selection
- **Default (toggle OFF):** Single template dropdown for all persons
- **Toggle ON:** Map a column (e.g., "Profession"), assign template per unique value
- Rows without template assignment are skipped

### Column Mapping
- Click column header → dropdown with mapping options
- Required: First Name, Last Name, Email
- Optional: Grouping 1, Grouping 2, Template Group (when toggle ON)
- Options already used are disabled in other columns

### Validation
- Real-time validation on mapped columns
- Warning icon on column header when issues exist
- Hover tooltip shows row numbers with problems
- Invalid rows skipped during creation

### Room Assignment
- Unique values from Grouping 1 + Grouping 2 form combined list
- Each value gets: room type dropdown + searchable checkbox list of rooms
- No room selection = person created without room assignments (valid)

### File Persistence
- Lift fileData state so it persists across Room/Person/Assignment workflow tabs

### TaskQueue Integration
- Reuse existing `addCreatePersonTask` for individual person tasks
- Each valid row becomes one task in queue
- Granular progress visibility, individual retry on failure

---

## UI Layout

### Top Section: Role & Template
```
Role: ○ Student ● Company Mentor ○ School Teacher ...

Template: [Default template ▼]

☐ Different templates per group
```

When toggle ON:
```
☑ Different templates per group

[Informatik ✓] [Kaufmann ✓] [Elektronik] [Polymech ✓]

Template for "Elektronik": [Select template... ▼]
```

### Middle Section: Data Table with Column Mapping

Column header dropdown on click:
```
┌─────────────────────────┐
│ ○ First Name            │
│ ○ Last Name             │
│ ○ Email                 │
│ ───────────────         │
│ ○ Grouping 1            │
│ ○ Grouping 2            │
│ ───────────────         │
│ ○ Template Group        │  ← only if toggle ON
│ ───────────────         │
│ ✕ Clear                 │
└─────────────────────────┘
```

After mapping, column header shows badge: `Vorname [First Name]`

Validation warning: `Email ⚠️` with hover showing "Invalid in rows: 5, 12, 23"

### Room Assignment Panel
```
┌──────────────────────────────────────────────────────────┐
│ Room Assignments (4 of 7 configured)                     │
├─────────────────┬────────────────────────────────────────┤
│ CFC-1 ✓        │  Room Type: [class ▼]                  │
│ CFC-2 ✓        │                                        │
│ CFC-3          │  🔍 Search rooms...                    │
│ ─────────      │  ┌────────────────────────────────┐   │
│ Acme Corp ✓    │  │ ☑ Informatik 2024              │   │
│ Beta AG        │  │ ☐ Kaufmann 2024                │   │
│ Gamma GmbH ✓   │  │ ☑ Elektronik 2024              │   │
│                │  └────────────────────────────────┘   │
│                │  Selected: 2 rooms                     │
└─────────────────┴────────────────────────────────────────┘
```

### Footer
```
☐ Send invitation emails

Ready: 45 persons │ Skipped: 3 (invalid email)
                                    [Add 45 Persons to Queue]
```

---

## Component Structure

### Modified Components
- `BulkImportPage.tsx` - Add person workflow, lift fileData state
- `DataPreviewTable.tsx` - Add column header dropdown with mapping options

### New Components
- `PersonRoleSelector.tsx` - Role radio button group
- `TemplateSelector.tsx` - Template dropdown with optional grouping toggle
- `TemplateGroupTabs.tsx` - Tabs for template-per-value selection
- `ColumnMappingDropdown.tsx` - Dropdown for column header
- `RoomAssignmentPanel.tsx` - Combined grouping values with room selection
- `GroupingValueTabs.tsx` - Left-side tabs for grouping values (reuse VariableTabs pattern)
- `RoomSelector.tsx` - Room type dropdown + searchable checkbox list

---

## Data Flow

1. User uploads file → fileData stored (persists across tabs)
2. User selects role → triggers template fetch
3. User maps columns via header dropdowns → validation runs
4. User configures room assignments per grouping value
5. User clicks "Add to Queue":
   - For each valid row:
     - Get firstName, lastName, email from mapped columns
     - Get template (global or from templateGroup mapping)
     - Get roomIds from grouping value(s) room assignments
     - Call `addCreatePersonTask({ sourceId, targetId, firstName, lastName, userEmail, role, roomIds, invitationMail })`
6. TaskQueue processes sequentially, shows progress

---

## State Structure

```typescript
// Person workflow state
interface PersonWorkflowState {
  // Role & Template
  selectedRole: string | null;
  selectedTemplateId: string | null;
  useTemplateGrouping: boolean;
  templateGroupColumn: string | null;
  templatesByGroup: Map<string, string>; // groupValue → templateId

  // Column mappings
  columnMappings: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    grouping1: string | null;
    grouping2: string | null;
    templateGroup: string | null;
  };

  // Validation
  validationErrors: Map<string, number[]>; // column → row numbers

  // Room assignments
  selectedGroupingValue: string | null;
  roomAssignments: Map<string, {
    roomType: RoomType | null;
    roomIds: string[];
  }>;

  // Options
  sendInvitationEmail: boolean;
}
```

---

## Validation Logic

```typescript
function validateRow(row: Record<string, string>, mappings: ColumnMappings): ValidationResult {
  const errors: string[] = [];

  // FirstName
  const firstName = row[mappings.firstName]?.trim();
  if (!firstName) errors.push('firstName');

  // LastName
  const lastName = row[mappings.lastName]?.trim();
  if (!lastName) errors.push('lastName');

  // Email
  const email = row[mappings.email]?.trim();
  if (!email || !isValidEmail(email)) errors.push('email');

  return { valid: errors.length === 0, errors };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
```

---

## API Integration

Uses existing `createPerson` IPC handler which calls `WEBHOOK_CREATE_PERSON`:

```typescript
// From CreatePersonTask params
{
  sourceId: templateId,
  targetId: profileCategoryId, // determined by role
  firstName: string,
  lastName: string,
  userEmail: string,
  role: string,
  roomIds: string[],
  invitationMail: boolean
}
```

Profile categories fetched via `fetchProfileCategories()` to get targetId for each role.
