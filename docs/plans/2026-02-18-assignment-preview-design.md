# Assignment Preview & Execution Feedback

## Problem

The bulk assignment flow sends all assignments without letting the user review them. No check for existing assignments, no way to exclude or adjust individual rows, and feedback is a basic `alert()`.

## Design

### Task 1: Assignment Preview Card

A new card appears after Person Matching and Room Matching in the Assignment tab. It contains a single flat table:

| Column | Content |
|--------|---------|
| Checkbox | Checked = included, unchecked = excluded |
| Person | Display name |
| Room | Room title |
| Role | Target role — click to edit via dropdown |
| Status | "New" (green) or "Already assigned as [role]" (amber) |

Behavior:
- Cross-references `person_room_assignments` in local DB to detect existing assignments
- Already-assigned rows are flagged amber and unchecked by default
- User can re-include them (checkbox) to update their role
- Clicking role text opens a dropdown with all available roles
- Header shows "X of Y assignments selected"
- Execute button count reflects only checked rows

### Task 2: Execution Feedback via TaskQueue

Replace `alert()` with the existing TaskQueue system:
- Each person added as a `roleUpdate` task in TaskQueue
- TaskQueue panel (top-right) shows per-person progress: queued → processing → success/error
- Failed tasks show error details and support retry

## Files to modify

- `src/renderer/pages/BulkImportPage.tsx` — add preview table, wire up TaskQueue
- `src/renderer/contexts/TaskQueueContext.tsx` — add bulk assignment task type if needed
- `src/renderer/components/TaskQueuePanel.tsx` — render assignment tasks
