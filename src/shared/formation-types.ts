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

/** Everything read for one apprentice. Failures after the profile listing are data, not throws. */
export interface StudentRaw {
  personId: string;
  ok: boolean; // false only when the profile listing itself failed
  error: string | null; // first failure message (profile listing, or a later part that failed)
  profileCreated: number | null;
  userIdTag: string | null;
  selfUid: string | null;
  timelineOk: boolean;
  facts: AssessmentFact[];
  mpe: { found: boolean; copies: Copy[] };
  mpc: { found: boolean; copies: Copy[] };
  reports: ReportFact[];
  plan: PlanFacts;
  failedParts: Array<'timeline' | 'mpe' | 'mpc' | 'suivi-company' | 'suivi-cie' | 'acl'>; // parts whose read failed after retries; `found` only means the folder was located
  emptyListings: number; // listings still empty after one re-read, during this apprentice's read
  skippedSubtrees: number; // nested mandate folders skipped on 401/403/404 (their copies are not counted)
}

/** School-wide reference data: the catalogue and the config Hazus. Colour keys are lower-cased. */
export interface Reference {
  slots: Slot[];
  professionsByIcon: Record<string, { title: string; order: number }>;
  levelsByColor: Record<string, string>;
  catalogueIcons: Record<string, string>; // profession folder icon -> profession code
}

/** State of one semester's company report in an apprentice's report line. */
export type ReportState = 'published' | 'draft' | 'missing' | 'optional' | 'future';

// ── Aggregates (spec §5–§6). Rates are ratios in 0..1, null when the denominator is 0. ──

/** Four-part status bar, in display order. Holds only slots whose status is known. */
export interface Bar { tiers: number; auto: number; encours: number; manquant: number; }
export interface Rates { importRate: number | null; evalRate: number | null; }
export interface LevelAgg extends Rates { level: LevelCode | 'other'; students: number; bar: Bar | null; }
/** One formation card. `key` is the profession icon. */
export interface FormationAgg { key: string; title: string; icon: string; order: number; students: number; levels: LevelAgg[]; }
export interface SchoolOverview extends Rates {
  students: number;
  reportsPublishedRate: number | null;
  formations: FormationAgg[];
  unclassified: Array<{ personId: string; name: string }>;
  failed: Array<{ personId: string; name: string; error: string }>;
  /** Read OK earlier, latest read failed: counted from the earlier rows (`error` = latest failure). */
  stale: Array<{ personId: string; name: string; error: string }>;
  syncedAt: number | null;
}
/** What the local DB knows about an apprentice. `icon` is the profession icon = the formation key. */
export interface StudentContext { personId: string; name: string; icon: string | null; companies: Array<{ id: string; title: string }>; classIds: string[]; }
/**
 * One catalogue mandate of the formation. `concerned` = apprentices expecting it; `imported` = of
 * those, with a copy; `assessable` = of the concerned, those whose evaluation is known (timeline and
 * identity read) — the denominator for `tiers`.
 */
export interface MandateRow { semester: number; mandate: string; title: string; concerned: number; imported: number; assessable: number; tiers: number; }
export interface CompanyRow extends Rates {
  id: string | null; // null = « sans entreprise »
  title: string;
  students: number;
  plan: 'oui' | 'partiel' | 'non' | null; // null = no apprentice's company Suivi could be read
  retired: number;
  reportsPublished: number;
  reportsDue: number;
}
export interface FormationDetail extends Rates {
  key: string;
  title: string;
  level: LevelCode | 'both';
  tableLevel: LevelCode;
  startEnteredShare: number | null;
  companiesWithoutTiers: { count: number; total: number };
  bySemester: Array<{ semester: number; students: number; bar: Bar }>;
  mpe: MandateRow[];
  mpc: MandateRow[];
  cieReports: { sent: number; draft: number };
  companies: CompanyRow[];
  reportsBySemester: Array<{ semester: number; published: number; draft: number; missing: number }>;
  /** `bar` is null when the apprentice's MPE statuses are unknown (see `flags`). */
  students: Array<{ personId: string; name: string; company: string; currentSemester: number; bar: Bar | null; latestReport: ReportState | null; flags: string[] }>;
}

/** The formation sync's status row. `failed` = apprentices whose read failed in the current/last run. */
export interface FormationSyncStatus {
  status: 'idle' | 'syncing' | 'error';
  processed: number;
  total: number;
  failed: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

/** Filters of the formation detail; class/company are local room ids. */
export interface FormationDetailFilters { classId?: string; companyId?: string; semester?: number }
