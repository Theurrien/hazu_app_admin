// Table rows for the formation overview's stored data — pure, no DB, no Electron.
// A StudentRaw (and the Reference) is stored as raw-ish facts (spec §7) and rebuilt exactly, so the
// definitions in model.ts / aggregate.ts run at query time and can change without a re-sync.
// Property names are the column names: the service binds these objects as named parameters.
// Booleans are 0/1 (SQLite has none); `ord` keeps each list's original order.

import type { AssessmentFact, Copy, LevelCode, MandateKind, Reference, ReportFact, Slot, StudentRaw } from '../../../shared/formation-types';

export interface StudentRow {
  person_id: string;
  read_ok: number;
  error: string | null;
  stale: number;
  profile_created: number | null;
  user_id_tag: string | null;
  self_uid: string | null;
  timeline_ok: number;
  mpe_found: number;
  mpc_found: number;
  plan_start_ms: number | null;
  empty_listings: number;
  failed_parts: string; // JSON array
  synced_at: number;
}
export interface CopyRow {
  person_id: string; ord: number; kind: MandateKind; copy_id: string; semester: number | null; mandate: string | null;
  level: LevelCode | null; profession: string | null; title: string; date_created: number;
}
export interface AssessmentRow {
  person_id: string; ord: number; copy_id: string; author_id: string | null; author_name: string;
  points: number; feedback: string | null; date_ms: number;
}
export interface ReportRow {
  person_id: string; ord: number; kind: 'company' | 'cie'; report_id: string; semester: number | null;
  published: number; published_at: number | null; course_id: string | null; date_created: number;
}
export interface RetiredRow { person_id: string; ord: number; slot_key: string }
export interface StudentRows {
  student: StudentRow;
  copies: CopyRow[];
  assessments: AssessmentRow[];
  reports: ReportRow[];
  retired: RetiredRow[];
}

export interface CatalogueRow {
  ord: number; kind: MandateKind; profession: string; level: LevelCode; semester: number; mandate: string; title: string; slot_id: string;
}
export interface ReferenceRow { key: string; json: string }

const bit = (b: boolean): number => (b ? 1 : 0);
const byOrd = <T extends { ord: number }>(rows: T[]): T[] => [...rows].sort((a, b) => a.ord - b.ord);

export function studentToRows(raw: StudentRaw, syncedAt: number): StudentRows {
  const person_id = raw.personId;
  const copy = (c: Copy, ord: number): CopyRow => ({
    person_id, ord, kind: c.kind, copy_id: c.id, semester: c.semester, mandate: c.mandate,
    level: c.level, profession: c.profession, title: c.title, date_created: c.dateCreated,
  });
  return {
    student: {
      person_id, read_ok: bit(raw.ok), error: raw.error, stale: 0, profile_created: raw.profileCreated,
      user_id_tag: raw.userIdTag, self_uid: raw.selfUid, timeline_ok: bit(raw.timelineOk),
      mpe_found: bit(raw.mpe.found), mpc_found: bit(raw.mpc.found), plan_start_ms: raw.plan.startMs,
      empty_listings: raw.emptyListings, failed_parts: JSON.stringify(raw.failedParts), synced_at: syncedAt,
    },
    copies: [...raw.mpe.copies.map(copy), ...raw.mpc.copies.map(copy)],
    assessments: raw.facts.map((f, ord) => ({
      person_id, ord, copy_id: f.copyId, author_id: f.authorId, author_name: f.authorName,
      points: f.points, feedback: f.feedback, date_ms: f.dateMs,
    })),
    reports: raw.reports.map((r, ord) => ({
      person_id, ord, kind: r.kind, report_id: r.id, semester: r.semester, published: bit(r.published),
      published_at: r.publishedAt, course_id: r.courseId, date_created: r.dateCreated,
    })),
    retired: raw.plan.retiredSlots.map((slot_key, ord) => ({ person_id, ord, slot_key })),
  };
}

export function studentFromRows(r: StudentRows): StudentRaw {
  const s = r.student;
  const copies = (kind: MandateKind): Copy[] => byOrd(r.copies.filter(c => c.kind === kind)).map(c => ({
    kind: c.kind, id: c.copy_id, semester: c.semester, mandate: c.mandate, level: c.level,
    profession: c.profession, title: c.title, dateCreated: c.date_created,
  }));
  const facts: AssessmentFact[] = byOrd(r.assessments).map(a => ({
    copyId: a.copy_id, authorId: a.author_id, authorName: a.author_name, points: a.points, feedback: a.feedback, dateMs: a.date_ms,
  }));
  const reports: ReportFact[] = byOrd(r.reports).map(x => ({
    kind: x.kind, id: x.report_id, semester: x.semester, published: x.published === 1,
    publishedAt: x.published_at, courseId: x.course_id, dateCreated: x.date_created,
  }));
  return {
    personId: s.person_id,
    ok: s.read_ok === 1,
    error: s.error,
    profileCreated: s.profile_created,
    userIdTag: s.user_id_tag,
    selfUid: s.self_uid,
    timelineOk: s.timeline_ok === 1,
    facts,
    mpe: { found: s.mpe_found === 1, copies: copies('mpe') },
    mpc: { found: s.mpc_found === 1, copies: copies('mpc') },
    reports,
    plan: { startMs: s.plan_start_ms, retiredSlots: byOrd(r.retired).map(x => x.slot_key) },
    failedParts: JSON.parse(s.failed_parts || '[]'),
    emptyListings: s.empty_listings,
  };
}

const REF_KEYS = ['professionsByIcon', 'levelsByColor', 'catalogueIcons'] as const;

export function referenceToRows(ref: Reference): { catalogue: CatalogueRow[]; reference: ReferenceRow[] } {
  return {
    catalogue: ref.slots.map((s, ord) => ({
      ord, kind: s.kind, profession: s.profession, level: s.level, semester: s.semester, mandate: s.mandate, title: s.title, slot_id: s.id,
    })),
    reference: REF_KEYS.map(key => ({ key, json: JSON.stringify(ref[key]) })),
  };
}

export function referenceFromRows(catalogue: CatalogueRow[], reference: ReferenceRow[]): Reference {
  const json = (key: (typeof REF_KEYS)[number]) => {
    const r = reference.find(x => x.key === key);
    return r ? JSON.parse(r.json) : {};
  };
  const slots: Slot[] = byOrd(catalogue).map(c => ({
    kind: c.kind, profession: c.profession, level: c.level, semester: c.semester, mandate: c.mandate, title: c.title, id: c.slot_id,
  }));
  return { slots, professionsByIcon: json('professionsByIcon'), levelsByColor: json('levelsByColor'), catalogueIcons: json('catalogueIcons') };
}
