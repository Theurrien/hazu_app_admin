// Missions formation overview — the IO layer. Wires the pure cores (formation/read.ts,
// model.ts, aggregate.ts, rows.ts) to the real Hazu API, local SQLite and the clock.
//
// Sync (spec §7): one background run at a time; results are held in memory and written in ONE
// transaction when the run resolves. A run that rejects (reference data unreadable) touches no
// data. An apprentice whose read failed keeps its previous rows, marked stale.
//
// Queries: every `persons` student yields exactly one model or one `failed` entry — none vanish.

import { getDb, get, query, run } from '../database';
import { sendApiRequestListChecked, sendApiRequestGetAclInfoChecked } from './hazu-api/api';
import { isConfigured } from './hazu-api/config';
import { runFormationSync, type ReadDeps, type ProfileInput } from './formation/read';
import { buildStudentModel } from './formation/model';
import { aggregateOverview, aggregateFormation, splitByReadState, markStale, type StoredReadState } from './formation/aggregate';
import {
  studentToRows, studentFromRows, referenceToRows, referenceFromRows, keepFailedParts, type StudentRows,
  type StudentRow, type CopyRow, type AssessmentRow, type ReportRow, type RetiredRow, type CatalogueRow, type ReferenceRow,
} from './formation/rows';
import type {
  FormationDetail, FormationDetailFilters, FormationStudent, FormationSyncStatus, LevelCode, Reference, SchoolOverview,
  StudentContext, StudentModel, StudentRaw,
} from '../../shared/formation-types';

const CONCURRENCY = 8;

// ── Status row ──────────────────────────────────────────────────────────────

interface StatusRow { status: string; processed: number; total: number; failed: number; last_synced_at: number | null; last_error: string | null }

export function getFormationSyncStatus(): FormationSyncStatus {
  const r = get<StatusRow>('SELECT * FROM formation_sync_status WHERE id = 1');
  if (!r) return { status: 'idle', processed: 0, total: 0, failed: 0, lastSyncedAt: null, lastError: null };
  const status = r.status === 'syncing' || r.status === 'error' ? r.status : 'idle';
  return { status, processed: r.processed, total: r.total, failed: r.failed, lastSyncedAt: r.last_synced_at, lastError: r.last_error };
}

function setError(message: string): void {
  run("UPDATE formation_sync_status SET status = 'error', last_error = ? WHERE id = 1", [message]);
}

// ── Inputs from the main sync ───────────────────────────────────────────────

interface PersonRow { id: string; display_name: string; tags: string | null; icon: string | null; color: string | null }

function loadStudents(): PersonRow[] {
  return query<PersonRow>(
    "SELECT id, display_name, tags, icon, color FROM persons WHERE person_type = 'student' ORDER BY display_name",
  );
}

function parseTags(json: string | null): string[] {
  try {
    const t = JSON.parse(json || '[]');
    return Array.isArray(t) ? t.map(String) : [];
  } catch {
    return [];
  }
}

const setting = (key: string): string => get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])?.value ?? '';

/** Where the Professions/Levels config Hazus are looked for: the Entreprise category, then hz-config-admin. */
function configParentIds(): string[] {
  const rootId = setting('root_hazu_id');
  const category = rootId
    ? get<{ id: string }>("SELECT id FROM rooms WHERE room_type = 'enterprise' AND parent_id = ? LIMIT 1", [rootId])
    : undefined;
  return [category?.id, setting('admin_id')].filter((x): x is string => !!x);
}

// ── Sync ────────────────────────────────────────────────────────────────────

/** Starts a background run; returns the status at once. A run already going is returned unchanged. */
export function startFormationSync(): FormationSyncStatus {
  const current = getFormationSyncStatus();
  if (current.status === 'syncing') return current;

  // Spec §7.1: the main sync is a prerequisite (persons, rooms, settings).
  if (!isConfigured()) { setError('API non configurée'); return getFormationSyncStatus(); }
  const students = loadStudents();
  const parents = configParentIds();
  if (!students.length || !parents.length) {
    setError('Lancez d’abord la synchronisation principale (Dashboard).');
    return getFormationSyncStatus();
  }

  const profiles: ProfileInput[] = students.map(s => ({ personId: s.id, tags: parseTags(s.tags) }));
  run(
    "UPDATE formation_sync_status SET status = 'syncing', processed = 0, total = ?, failed = 0, last_error = NULL WHERE id = 1",
    [profiles.length],
  );
  void runInBackground(profiles, parents);
  return getFormationSyncStatus();
}

async function runInBackground(profiles: ProfileInput[], parents: string[]): Promise<void> {
  // Each list/ACL call is timed here, so the log line shows the real per-read latency.
  const timing = { calls: 0, ms: 0 };
  const timed = async <T>(call: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try { return await call(); } finally { timing.calls += 1; timing.ms += Date.now() - t0; }
  };
  const deps: ReadDeps = {
    list: id => timed(() => sendApiRequestListChecked(id)),
    acl: id => timed(() => sendApiRequestGetAclInfoChecked(id)),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  };
  try {
    const out = await runFormationSync(deps, {
      profiles,
      configParentIds: parents,
      concurrency: CONCURRENCY,
      onProgress: p => run('UPDATE formation_sync_status SET processed = ?, failed = ? WHERE id = 1', [p.processed, p.failed]),
    });
    const failed = out.results.filter(r => !r.ok).length;
    writeRun(out.reference, out.results, Date.now());
    const avgReadMs = timing.calls ? Math.round(timing.ms / timing.calls) : 0;
    console.log(
      `[formation-sync] students=${profiles.length} failed=${failed} reads=${out.reads} durationMs=${out.durationMs} avgReadMs=${avgReadMs}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[formation-sync] run failed, previous data kept:', message);
    setError(message);
  }
}

/** Writes one finished run in a single transaction. */
function writeRun(reference: Reference, results: StudentRaw[], syncedAt: number): void {
  const db = getDb();
  const ins = {
    student: db.prepare(`INSERT OR REPLACE INTO formation_student
      (person_id, read_ok, error, stale, profile_created, user_id_tag, self_uid, timeline_ok, timeline_found, mpe_found, mpc_found,
       suivi_company_found, suivi_cie_found, plan_start_ms, empty_listings, skipped_subtrees, failed_parts, synced_at)
      VALUES (@person_id, @read_ok, @error, @stale, @profile_created, @user_id_tag, @self_uid, @timeline_ok, @timeline_found, @mpe_found, @mpc_found,
       @suivi_company_found, @suivi_cie_found, @plan_start_ms, @empty_listings, @skipped_subtrees, @failed_parts, @synced_at)`),
    copy: db.prepare(`INSERT INTO formation_copy (person_id, ord, kind, copy_id, semester, mandate, level, profession, title, date_created)
      VALUES (@person_id, @ord, @kind, @copy_id, @semester, @mandate, @level, @profession, @title, @date_created)`),
    assessment: db.prepare(`INSERT INTO formation_assessment (person_id, ord, copy_id, author_id, author_name, points, feedback, date_ms)
      VALUES (@person_id, @ord, @copy_id, @author_id, @author_name, @points, @feedback, @date_ms)`),
    report: db.prepare(`INSERT INTO formation_report (person_id, ord, kind, report_id, semester, published, published_at, course_id, date_created)
      VALUES (@person_id, @ord, @kind, @report_id, @semester, @published, @published_at, @course_id, @date_created)`),
    retired: db.prepare('INSERT INTO formation_plan_retired (person_id, ord, slot_key) VALUES (@person_id, @ord, @slot_key)'),
    catalogue: db.prepare(`INSERT INTO formation_catalogue (ord, kind, profession, level, semester, mandate, title, slot_id)
      VALUES (@ord, @kind, @profession, @level, @semester, @mandate, @title, @slot_id)`),
    reference: db.prepare('INSERT INTO formation_reference (key, json) VALUES (@key, @json)'),
  };
  const childTables = ['formation_copy', 'formation_assessment', 'formation_report', 'formation_plan_retired'];
  const del = childTables.map(t => db.prepare(`DELETE FROM ${t} WHERE person_id = ?`));
  const previous = db.prepare('SELECT * FROM formation_student WHERE person_id = ?');
  const prevChildren = ['formation_copy', 'formation_assessment', 'formation_report', 'formation_plan_retired']
    .map(t => db.prepare(`SELECT * FROM ${t} WHERE person_id = ?`));
  const previousRows = (student: StudentRow): StudentRows => {
    const [copies, assessments, reports, retired] = prevChildren.map(s => s.all(student.person_id));
    return {
      student,
      copies: copies as CopyRow[],
      assessments: assessments as AssessmentRow[],
      reports: reports as ReportRow[],
      retired: retired as RetiredRow[],
    };
  };
  const markFailed = db.prepare('UPDATE formation_student SET stale = read_ok, error = ? WHERE person_id = ?');

  db.transaction(() => {
    db.prepare('DELETE FROM formation_catalogue').run();
    db.prepare('DELETE FROM formation_reference').run();
    const ref = referenceToRows(reference);
    for (const c of ref.catalogue) ins.catalogue.run(c);
    for (const r of ref.reference) ins.reference.run(r);

    for (const raw of results) {
      const before = previous.get(raw.personId) as StudentRow | undefined;
      if (!raw.ok && before) {
        // Read failed: keep the rows. stale = 1 only if they came from a successful read.
        markFailed.run(raw.error ?? 'lecture échouée', raw.personId);
        continue;
      }
      // Read ok but some parts lost: those parts keep their previous rows (read before deleting).
      const fresh = studentToRows(raw, syncedAt);
      const rows = raw.failedParts.length && before?.read_ok === 1 ? keepFailedParts(fresh, previousRows(before)) : fresh;
      for (const d of del) d.run(raw.personId);
      ins.student.run(rows.student);
      if (!raw.ok) continue; // never read OK: the student row alone records the failure
      for (const c of rows.copies) ins.copy.run(c);
      for (const a of rows.assessments) ins.assessment.run(a);
      for (const r of rows.reports) ins.report.run(r);
      for (const r of rows.retired) ins.retired.run(r);
    }

    db.prepare("UPDATE formation_sync_status SET status = 'idle', processed = ?, failed = ?, last_synced_at = ?, last_error = NULL WHERE id = 1")
      .run(results.length, results.filter(r => !r.ok).length, syncedAt);
  })();
}

// ── Queries ─────────────────────────────────────────────────────────────────

const groupBy = <T extends { person_id: string }>(rows: T[]): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    if (!m.has(r.person_id)) m.set(r.person_id, []);
    m.get(r.person_id)!.push(r);
  }
  return m;
};

interface Loaded {
  students: PersonRow[];
  models: StudentModel[];
  ctx: StudentContext[];
  failed: SchoolOverview['failed'];
  stale: SchoolOverview['stale'];
}

/** Rebuilds every stored apprentice's StudentRaw, models it with today's date, and builds the context. */
function loadAll(): Loaded {
  const students = loadStudents();
  const studentRows = query<StudentRow>('SELECT * FROM formation_student');
  const byId = new Map(studentRows.map(r => [r.person_id, r]));
  const states = new Map<string, StoredReadState>(
    studentRows.map(r => [r.person_id, { readOk: r.read_ok === 1, stale: r.stale === 1, error: r.error }]),
  );
  const split = splitByReadState(students.map(s => ({ personId: s.id, name: s.display_name })), states);

  const reference = referenceFromRows(
    query<CatalogueRow>('SELECT * FROM formation_catalogue'),
    query<ReferenceRow>('SELECT * FROM formation_reference'),
  );
  const copies = groupBy(query<CopyRow>('SELECT * FROM formation_copy'));
  const assessments = groupBy(query<AssessmentRow>('SELECT * FROM formation_assessment'));
  const reports = groupBy(query<ReportRow>('SELECT * FROM formation_report'));
  const retired = groupBy(query<RetiredRow>('SELECT * FROM formation_plan_retired'));
  const personOf = new Map(students.map(s => [s.id, s]));

  const today = Date.now();
  const models = split.read.map(id => {
    const raw = studentFromRows({
      student: byId.get(id)!,
      copies: copies.get(id) ?? [],
      assessments: assessments.get(id) ?? [],
      reports: reports.get(id) ?? [],
      retired: retired.get(id) ?? [],
    });
    const p = personOf.get(id)!;
    return buildStudentModel(raw, { icon: p.icon, color: p.color }, reference, today);
  });

  const companies = groupBy(query<{ person_id: string; id: string; title: string }>(`
    SELECT pra.person_id, r.id, r.title FROM person_room_assignments pra
    JOIN rooms r ON r.id = pra.room_id AND r.room_type = 'enterprise'
    ORDER BY r.title`));
  const classes = groupBy(query<{ person_id: string; id: string }>(`
    SELECT pra.person_id, r.id FROM person_room_assignments pra
    JOIN rooms r ON r.id = pra.room_id AND r.room_type = 'class'`));
  const ctx: StudentContext[] = students.map(s => ({
    personId: s.id,
    name: s.display_name,
    icon: s.icon,
    companies: (companies.get(s.id) ?? []).map(c => ({ id: c.id, title: c.title })),
    classIds: (classes.get(s.id) ?? []).map(c => c.id),
  }));

  return { students, models, ctx, failed: split.failed, stale: split.stale };
}

export function getFormationOverview(): SchoolOverview {
  const l = loadAll();
  const overview = aggregateOverview(l.models, l.ctx, l.failed, getFormationSyncStatus().lastSyncedAt, Date.now());
  return { ...overview, stale: l.stale };
}

export function getFormationDetail(
  key: string,
  level: LevelCode | 'both',
  filters: FormationDetailFilters,
): FormationDetail {
  const l = loadAll();
  const detail = aggregateFormation(l.models, l.ctx, key, level, filters ?? {}, Date.now());
  return markStale(detail, new Set(l.stale.map(s => s.personId)));
}

/** One apprentice's model, or null when it has no successful read stored. */
export function getFormationStudent(personId: string): FormationStudent | null {
  const l = loadAll();
  const m = l.models.find(x => x.personId === personId);
  if (!m) return null;
  const c = l.ctx.find(x => x.personId === personId)!;
  const row = get<{ skipped_subtrees: number }>('SELECT skipped_subtrees FROM formation_student WHERE person_id = ?', [personId]);
  return { ...m, name: c.name, companies: c.companies.map(co => co.title), skippedSubtrees: row?.skipped_subtrees ?? 0 };
}
