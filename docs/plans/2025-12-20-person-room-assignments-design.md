# Person-Room Assignments with Roles

## Overview

Implement proper parsing of person-to-room assignments from Hazu tags, extracting both the room reference and the person's role in that room.

## Tag Structure

Persons have tags in the format:
```
hz-config-class-{CLASS_ID}-{ROLE}
```

Where:
- `CLASS_ID` is an alphanumeric string (no hyphens) that matches a room's `class_id`
- `ROLE` is the person's role in that room (student, companymentor, schoolteacher, courseteacher, stateadvisor, guardian)

Example:
- `hz-config-class-kzlJ3rVjLImfvVnvTDhm-student`
- Class ID: `kzlJ3rVjLImfvVnvTDhm`
- Role: `student`

## Implementation

### 1. Schema Changes

Removed CHECK constraint from `person_room_assignments.role` column for flexibility. Changed default from `reader` to `student`.

### 2. Migration

Added migration to recreate `person_room_assignments` table with new schema. Detects old schema by checking if default value is `'reader'`.

### 3. Tag Parsing

New `parseAssignmentTag()` function:
1. Checks if tag starts with `hz-config-class-`
2. Removes prefix, leaving `{CLASS_ID}-{ROLE}`
3. Splits on last hyphen (class IDs are alphanumeric, no hyphens)
4. Validates role against known person types
5. Returns `{ classId, role }` or `null`

### 4. Assignment Sync

Updated `syncPersonRoomAssignments()`:
1. Parses each tag with `parseAssignmentTag()`
2. Looks up room by `classId`
3. Creates assignment with extracted role

## Valid Roles

- `student`
- `companymentor`
- `schoolteacher`
- `courseteacher`
- `stateadvisor`
- `guardian`

## Files Changed

- `src/main/database/schema.sql` - Removed CHECK constraint, updated tag_mappings
- `src/main/database/index.ts` - Added migration to recreate table
- `src/main/services/sync.service.ts` - Added `parseAssignmentTag()`, updated `syncPersonRoomAssignments()`
