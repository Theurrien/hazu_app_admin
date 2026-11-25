// Types shared by the room-archive core, its IO layer and the renderer.

export type ArchiveRoomType = 'class' | 'cie' | 'enterprise' | 'state';

export interface StepResult {
  step: string;
  status: 'done' | 'skipped' | 'failed';
  detail?: string;
}

export interface ArchiveOutcome {
  success: boolean;
  steps: StepResult[];
  /** What is left to do (ids / person ids / messages) when success is false. */
  remaining: string[];
  error?: string;
  /** The per-room folder, once known. */
  folderId?: string;
  /** Tags actually confirmed removed, per person (for local reconcile). */
  removedTags: Array<{ personId: string; tags: string[] }>;
}

/** One row of the Archive tab, read live from a per-room folder and its children. */
export interface ArchivedRoom {
  folderId: string;
  /** null when the room is not (or no longer) inside the folder. */
  roomId: string | null;
  title: string;
  classId: string;
  roomType: ArchiveRoomType;
  fromParentId: string;
  archivedAt: number;
}

export interface RestoreOutcome {
  success: boolean;
  steps: StepResult[];
  remaining: string[];
  error?: string;
  /** Tags actually added this run, per person (for local reconcile). */
  addedTags: Array<{ personId: string; tags: string[] }>;
  /** Group members that could not be resolved to a profile; listed, not guessed. */
  unresolvedMembers: number;
  roomId?: string;
}

/** A room the Archive tab may archive; blocked ones are listed with the reason. */
export interface ArchivableRoom {
  id: string;
  title: string;
  roomType: ArchiveRoomType;
  classId: string | null;
  parentId: string;
  memberCount: number;
  blockedReason: string | null;
}

/** Local counts for the confirmation modal; live counts come at execution. */
export interface ArchivePlan {
  roomId: string;
  title: string;
  roomType: ArchiveRoomType;
  classId: string;
  groupCount: number;
  holderCount: number;
  memberCount: number;
  /** Enterprise or state room with members: dashboards reading it will lose it. */
  warnsDashboards: boolean;
}

export interface RestorePlan {
  folderId: string;
  title: string;
  fromParentTitle: string | null;
  fromParentExists: boolean;
  groupCount: number;
}

export interface PersonArchiveOutcome { success: boolean; steps: StepResult[]; remaining: string[]; error?: string; folderId?: string }
export interface PersonRestoreOutcome { success: boolean; steps: StepResult[]; remaining: string[]; error?: string }
export interface ArchivedPerson { folderId: string; profileId: string; inFolder: boolean; displayName: string; fromParentId: string; archivedAt: number }
export interface PersonArchivePlan {
  personId: string; displayName: string; personType: string;
  rooms: Array<{ roomId: string; title: string; role: string }>;
  lastSyncAt: number | null; syncStale: boolean;   // stale = null or older than 24 h
}
