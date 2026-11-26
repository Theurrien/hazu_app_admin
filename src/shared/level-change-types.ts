// Level change (CFC <-> AFP) — shared types. Spec: docs/specs/2026-11-26-level-change-design.md

export type Level = 'cfc' | 'afp';

export interface TemplateRef {
  id: string;
  title: string;
  icon: string | null;
  color: string | null;
}

export interface SectionChange {
  sectionId: string;
  title: string;
  /** to = value to write */
  description: { from: string; to: string } | null;
  /** hand-edited for this student, left alone */
  descriptionKept: boolean;
  addTags: string[];
  removeTags: string[];
}

export interface LevelChangePlan {
  profileId: string;
  fromLevel: Level;
  toLevel: Level;
  colorFrom: string;
  colorTo: string;
  colorChange: boolean;
  templates: Array<{ id: string; title: string; role: 'target' | 'source' | 'source-other' }>;
  /** only sections with a change or descriptionKept */
  sections: SectionChange[];
  /** section titles */
  profileOnly: string[];
  templateOnly: string[];
}

export interface LevelChangeOutcome {
  success: boolean;
  dryRun: boolean;
  plan: LevelChangePlan | null;
  /** section changes + colour confirmed by the read */
  applied: number;
  /** French, one line per unconfirmed change */
  remaining: string[];
  /** refusal / abort reason, nothing written */
  error?: string;
}

export interface LevelChangeStudent {
  id: string;
  displayName: string;
  icon: string | null;
  color: string | null;
  level: Level | null;
}

export interface LevelChangeCandidates {
  currentLevel: Level;
  toLevel: Level;
  templates: TemplateRef[];
  preselectedId: string | null;
}
