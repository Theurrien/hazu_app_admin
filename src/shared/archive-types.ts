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
