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
