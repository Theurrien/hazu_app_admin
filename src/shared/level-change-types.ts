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
  /** title|icon|colour — the identity of a decision, never a position */
  sectionKey: string;
  title: string;
  /** to = value to write */
  description: { from: string; to: string } | null;
  /** hand-edited for this student, left alone */
  descriptionKept: boolean;
  addTags: string[];
  removeTags: string[];
  /** subset of addTags: family-absent adds (the profile holds no tag of that family); swaps are certain */
  uncertainTags: string[];
  /** description to write if the operator forces it (set when descriptionKept) */
  keptTargetDescription: string | null;
}

export interface TemplateOnlyItem { sectionKey: string; title: string; templateSectionId: string }
export interface ProfileOnlyItem {
  sectionKey: string;
  title: string;
  sectionId: string;
  /** items inside; null until counted */
  descendants: number | null;
  /** false = "at least N" (walk cut short or a read failed) */
  descendantsExact: boolean;
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
  /** section titles present in profile and target but not in the source v3 — not changed */
  noSourceCounterpart: string[];
  templateOnlyItems: TemplateOnlyItem[];
  profileOnlyItems: ProfileOnlyItem[];
  /** needed: the template carries the widget and the profile does not; profileEmpty: its description is empty */
  widget: { needed: boolean; profileEmpty: boolean };
  /** preview only, when copies are proposed: the student's account is on the profile's access list.
   *  false → the copies' access cannot be set (no detach, no grant); absent → not checked. */
  studentFound?: boolean;
}

export interface LevelChangeOutcome {
  success: boolean;
  dryRun: boolean;
  plan: LevelChangePlan | null;
  /** section changes + colour confirmed by the read */
  applied: number;
  /** French, one line per unconfirmed change */
  remaining: string[];
  /** items skipped on purpose: not seen in the preview, or decisions with no matching item */
  ignored: string[];
  /** informational lines from confirmed steps (e.g. a duplicate copy removed); never a failure */
  notes?: string[];
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
