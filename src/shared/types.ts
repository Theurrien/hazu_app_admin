// Room types based on Hazu tag mapping
export type RoomType = 'state' | 'class' | 'enterprise' | 'cie';

// Person types based on Hazu tag mapping
export type PersonType =
  | 'student'
  | 'companymentor'
  | 'schoolteacher'
  | 'courseteacher'
  | 'stateadvisor'
  | 'guardian';

// Permission roles
export type Role = 'reader' | 'editor' | 'admin';

// Room entity
export interface Room {
  id: string;
  title: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  room_type: RoomType;
  parent_id: string | null;
  tags: string[];
  raw_data: string | null;
  synced_at: number;
  created_at?: number;
  updated_at?: number;
}

// Person entity
export interface Person {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  person_type: PersonType;
  role: Role | null;
  tags: string[];
  raw_data: string | null;
  synced_at: number;
  created_at?: number;
  updated_at?: number;
}

// Assignment (person-to-room relationship)
export interface Assignment {
  id: number;
  person_id: string;
  room_id: string;
  role: Role;
  synced_at: number | null;
  created_at?: number;
  updated_at?: number;
}

// Change log entry for n8n sync
export type ChangeAction = 'create' | 'update' | 'delete' | 'assign' | 'unassign';
export type ChangeStatus = 'pending' | 'synced' | 'failed';

export interface ChangeLogEntry {
  id: number;
  entity_type: 'person' | 'room' | 'assignment';
  entity_id: string;
  action: ChangeAction;
  old_data: string | null;
  new_data: string | null;
  status: ChangeStatus;
  error_message: string | null;
  created_at: number;
  synced_at: number | null;
}

// Sync status
export interface SyncStatus {
  lastSyncAt: number | null;
  roomCount: number;
  personCount: number;
  assignmentCount: number;
  pendingChanges: number;
  isRunning: boolean;
}

// Sync result
export interface SyncResult {
  success: boolean;
  roomsProcessed: number;
  personsProcessed: number;
  assignmentsProcessed: number;
  errors: string[];
  duration: number;
}

// Tag mapping for identifying room/person types
export interface TagMapping {
  tag: string;
  category: 'room_type' | 'person_role';
  semantic_value: string;
  description: string | null;
}

// Hazu API response types (from parent project)
export interface HazuSnapshot {
  key: string;
  title: string;
  description?: string;
  color?: string;
  icon?: string;
  type: 'hazu' | 'item';
  parentId?: string;
  tags?: string[];
  dateCreated?: number;
  [key: string]: any;
}

export interface HazuEntity {
  snapshot: HazuSnapshot;
}

// Template entity
export interface Template {
  id: string;
  title: string;
  roomType: 'class' | 'cie' | 'enterprise' | 'state';
  icon?: string;
  color?: string;
}
