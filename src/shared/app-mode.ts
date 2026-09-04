/**
 * App Mode (S9)
 *
 * CIE mode reduces the app to the surface a course teacher needs: the Dashboard
 * (the only sync trigger), the Matrix, and Bulk Import — scoped to CIE rooms and
 * to students and course teachers.
 *
 * This is a guardrail for a trusted colleague, NOT an access boundary. The app has
 * no per-user authorization: one API key from Settings authenticates every call and
 * carries full platform rights. Hiding a page changes what someone does by accident,
 * not what they can do.
 *
 * Pure by design — no IO, no React, no imports but types — so every mode decision is
 * unit-testable in one place. Add a new page, workflow, or role here, not at the call
 * sites, or the two modes will drift.
 */

import type { PersonType, RoomType } from './types';

export type AppMode = 'cie' | 'complete';

export type PageId =
  | 'dashboard'
  | 'rooms'
  | 'persons'
  | 'matrix'
  | 'import'
  | 'missions'
  | 'discrepancies'
  | 'settings';

export type BulkImportWorkflow = 'room' | 'person' | 'assignment' | 'verify';

export const APP_MODE_SETTING_KEY = 'app_mode';

export const DEFAULT_APP_MODE: AppMode = 'cie';

const ALL_PAGES: readonly PageId[] = [
  'dashboard',
  'rooms',
  'persons',
  'matrix',
  'import',
  'missions',
  'discrepancies',
  'settings',
];

// The Dashboard stays: Matrix and Bulk Import render entirely from local SQLite,
// and the Dashboard's Sync button is the app's only trigger for refreshing it.
const CIE_PAGES: readonly PageId[] = ['dashboard', 'matrix', 'import'];

const ALL_WORKFLOWS: readonly BulkImportWorkflow[] = ['room', 'person', 'assignment', 'verify'];
const CIE_WORKFLOWS: readonly BulkImportWorkflow[] = ['room', 'assignment'];

const ALL_PERSON_TYPES: readonly PersonType[] = [
  'student',
  'schoolteacher',
  'courseteacher',
  'companymentor',
  'stateadvisor',
  'guardian',
];
const CIE_PERSON_TYPES: readonly PersonType[] = ['student', 'courseteacher'];

const ALL_ROOM_TYPES: readonly RoomType[] = ['class', 'enterprise', 'state', 'cie'];
const CIE_ROOM_TYPES: readonly RoomType[] = ['cie'];

// Mirrors TaskQueueContext.tsx's `TaskType` union. Declared locally rather than
// imported so this module stays free of runtime imports — importing a type-only
// export would be fine, but the six string literals are also the module's only
// use for it, so spelling them out here keeps the dependency at zero.
export type TaskType =
  | 'roleUpdate'
  | 'createRoom'
  | 'createPerson'
  | 'healTag'
  | 'revokeOrphanAccess'
  | 'pruneDeadTags';

const ALL_TASK_TYPES: readonly TaskType[] = [
  'roleUpdate',
  'createRoom',
  'createPerson',
  'healTag',
  'revokeOrphanAccess',
  'pruneDeadTags',
];
// The two task types CIE mode can itself produce: Matrix cell edits (roleUpdate)
// and Bulk Import Room Creation (createRoom). Everything else — createPerson and
// the Discrepancies-only writes healTag/revokeOrphanAccess/pruneDeadTags (the
// latter two destructive) — comes only from pages CIE mode does not show, but a
// task an admin left errored in the panel before locking must stay hidden, not
// deleted.
const CIE_TASK_TYPES: readonly TaskType[] = ['roleUpdate', 'createRoom'];

/**
 * Anything that is not exactly "complete" is CIE mode, so a missing, empty, or
 * corrupted setting fails closed rather than opening the full surface.
 */
export function parseAppMode(raw: string | null | undefined): AppMode {
  return raw === 'complete' ? 'complete' : DEFAULT_APP_MODE;
}

export function isRestricted(mode: AppMode): boolean {
  return mode === 'cie';
}

export function visiblePages(mode: AppMode): PageId[] {
  return [...(mode === 'complete' ? ALL_PAGES : CIE_PAGES)];
}

export function isPageVisible(mode: AppMode, page: PageId): boolean {
  return (mode === 'complete' ? ALL_PAGES : CIE_PAGES).includes(page);
}

/** Where to send someone whose current page just became invisible. */
export function fallbackPage(_mode: AppMode): PageId {
  return 'dashboard';
}

export function visibleWorkflows(mode: AppMode): BulkImportWorkflow[] {
  return [...(mode === 'complete' ? ALL_WORKFLOWS : CIE_WORKFLOWS)];
}

export function isWorkflowVisible(mode: AppMode, workflow: BulkImportWorkflow): boolean {
  return (mode === 'complete' ? ALL_WORKFLOWS : CIE_WORKFLOWS).includes(workflow);
}

export function allowedPersonTypes(mode: AppMode): PersonType[] {
  return [...(mode === 'complete' ? ALL_PERSON_TYPES : CIE_PERSON_TYPES)];
}

export function allowedRoomTypes(mode: AppMode): RoomType[] {
  return [...(mode === 'complete' ? ALL_ROOM_TYPES : CIE_ROOM_TYPES)];
}

export function allowedTaskTypes(mode: AppMode): TaskType[] {
  return [...(mode === 'complete' ? ALL_TASK_TYPES : CIE_TASK_TYPES)];
}
