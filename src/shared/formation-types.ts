// Shared types for the Missions formation overview. No IO.

/** One Hazu item, normalised from any of the API's row envelopes. */
export interface Row {
  id: string;
  parentId: string | null;
  type: string;
  title: string;
  description: string;
  tags: string[];
  icon: string | null;
  color: string | null;
  dateCreated: number;
  authorId: string | null;
  authorName: string | null;
  order: number | null;
}

/** One assessment of one MPE copy, parsed from a timeline item. */
export interface AssessmentFact {
  copyId: string;
  authorId: string | null;
  authorName: string;
  points: number;
  feedback: string | null;
  dateMs: number;
}

export type MandateKind = 'mpe' | 'mpc';
export type LevelCode = 'afp' | 'cfc';

/** One master mandate in the catalogue. `id` is the master's row id. */
export interface Slot {
  kind: MandateKind;
  profession: string;
  level: LevelCode;
  semester: number;
  mandate: string;
  title: string;
  id: string;
}

/** One mandate copy found in a student's study place. Facets are null when absent. */
export interface Copy {
  kind: MandateKind;
  id: string;
  semester: number | null;
  mandate: string | null;
  level: LevelCode | null;
  profession: string | null;
  title: string;
  dateCreated: number;
}

/** One semester report found in a student's Suivi. */
export interface ReportFact {
  kind: 'company' | 'cie';
  id: string;
  semester: number | null;
  published: boolean;
  publishedAt: number | null;
  courseId: string | null;
  dateCreated: number;
}

/** What the Suivi's plan records say: the plan start and the slots retired from the plan. */
export interface PlanFacts {
  startMs: number | null;
  retiredSlots: string[]; // slot key "cfc-3-12"
}
