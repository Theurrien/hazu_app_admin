// School overview and formation detail for the Missions tab — pure, no IO, no DB, no Electron.
// Sums per-apprentice models (model.ts) into the numbers of spec §5–§6.
//
// A part that could not be read is unknown, never zero (spec §8):
//   - MPE (or MPC) space unreadable or not found → the apprentice is in no MPE (MPC) rate, bar or table;
//   - timeline unreadable or identity unknown    → counts in import rates, not in evaluation rates,
//                                                  and its statuses are painted in no bar;
//   - company Suivi unreadable                   → out of report counts and the start-date/plan figures;
//   - CIE Suivi unreadable                       → out of the CIE report counts.
// Each exclusion adds a short French flag to the apprentice's row. An apprentice whose profile could
// not be read at all (`readOk: false`) is listed in `failed` and counted nowhere else.

import type {
  Bar, CompanyRow, FormationAgg, FormationDetail, LevelAgg, LevelCode, MandateRow, Rates,
  ReportState, SchoolOverview, SlotResult, StudentContext, StudentModel,
} from '../../../shared/formation-types';

const NO_COMPANY = 'sans entreprise';
const UNREAD_PROFILE = 'profil illisible';

const emptyBar = (): Bar => ({ tiers: 0, auto: 0, encours: 0, manquant: 0 });
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);
const imported = (b: Bar) => b.tiers + b.auto + b.encours;

export function rates(bar: Bar): Rates {
  return { importRate: ratio(imported(bar), imported(bar) + bar.manquant), evalRate: ratio(bar.tiers, imported(bar)) };
}

// ── What is known about one apprentice ──────────────────────────────────────

interface Known { mpe: boolean; mpc: boolean; evaluation: boolean; suiviCompany: boolean; suiviCie: boolean; }

function knownOf(m: StudentModel): Known {
  const failed = (p: StudentModel['failedParts'][number]) => m.failedParts.includes(p);
  return {
    mpe: m.mpeFound && !failed('mpe'),
    mpc: m.mpcFound && !failed('mpc'),
    evaluation: m.timelineOk && !failed('timeline') && m.identityKnown,
    suiviCompany: !failed('suivi-company'),
    suiviCie: !failed('suivi-cie'),
  };
}

function flagsOf(m: StudentModel): string[] {
  const f: string[] = [];
  const failed = (p: StudentModel['failedParts'][number]) => m.failedParts.includes(p);
  if (failed('mpe')) f.push('mandats entreprise illisibles');
  else if (!m.mpeFound) f.push('mandats entreprise introuvables');
  if (failed('mpc')) f.push('mandats CIE illisibles');
  else if (!m.mpcFound) f.push('mandats CIE introuvables');
  if (failed('timeline') || !m.timelineOk) f.push('timeline illisible');
  if (failed('acl')) f.push('ACL illisible');
  else if (!m.identityKnown) f.push('identité inconnue');
  if (failed('suivi-company')) f.push('suivi entreprise illisible');
  if (failed('suivi-cie')) f.push('suivi CIE illisible');
  if (m.level === 'other') f.push('autre niveau');
  return f;
}

const isRated = (m: StudentModel): m is StudentModel & { level: LevelCode } => m.level !== 'other';

// ── Tally: a bar of known statuses + the import counts of apprentices whose evaluation is unknown ──

interface Tally { bar: Bar; unknownImported: number; unknownMissing: number; }
const emptyTally = (): Tally => ({ bar: emptyBar(), unknownImported: 0, unknownMissing: 0 });

function addSlots(t: Tally, slots: SlotResult[], evaluationKnown: boolean): void {
  for (const s of slots) {
    if (evaluationKnown) t.bar[s.status] += 1;
    else if (s.status === 'manquant') t.unknownMissing += 1;
    else t.unknownImported += 1;
  }
}

/** Adds an apprentice's MPE slots when they are known; AFP/CFC only. */
function addMpe(t: Tally, m: StudentModel): void {
  if (!isRated(m)) return;
  const k = knownOf(m);
  if (k.mpe) addSlots(t, m.mpe, k.evaluation);
}

function tallyRates(t: Tally): Rates {
  const imp = imported(t.bar) + t.unknownImported;
  return {
    importRate: ratio(imp, imp + t.bar.manquant + t.unknownMissing),
    evalRate: ratio(t.bar.tiers, imported(t.bar)),
  };
}

function tallyOf(models: StudentModel[]): Tally {
  const t = emptyTally();
  for (const m of models) addMpe(t, m);
  return t;
}

/** Published / draft / missing company reports of the apprentices whose company Suivi was read. */
function reportCounts(models: StudentModel[]): { published: number; draft: number; missing: number } {
  const c = { published: 0, draft: 0, missing: 0 };
  for (const m of models) {
    if (!isRated(m) || !knownOf(m).suiviCompany) continue;
    for (const r of m.reports) if (r.state === 'published' || r.state === 'draft' || r.state === 'missing') c[r.state] += 1;
  }
  return c;
}

// ── Context ─────────────────────────────────────────────────────────────────

function contextIndex(ctx: StudentContext[]): (m: StudentModel) => StudentContext {
  const byId = new Map(ctx.map(c => [c.personId, c]));
  return m => byId.get(m.personId) ?? { personId: m.personId, name: m.personId, icon: null, companies: [], classIds: [] };
}

/** The formation key of a read apprentice, or null when it is unclassified (« à classer »). */
function formationKey(m: StudentModel, c: StudentContext): string | null {
  return m.formationTitle !== null && c.icon ? c.icon : null;
}

// ── Overview ────────────────────────────────────────────────────────────────

const LEVEL_ORDER: Array<LevelCode | 'other'> = ['cfc', 'afp', 'other'];

export function aggregateOverview(
  models: StudentModel[],
  ctx: StudentContext[],
  failed: SchoolOverview['failed'],
  syncedAt: number | null,
): SchoolOverview {
  const ctxOf = contextIndex(ctx);

  const failedOut = [...failed];
  const listed = new Set(failed.map(f => f.personId));
  for (const m of models) {
    if (m.readOk || listed.has(m.personId)) continue;
    failedOut.push({ personId: m.personId, name: ctxOf(m).name, error: UNREAD_PROFILE });
    listed.add(m.personId);
  }

  const read = models.filter(m => m.readOk);
  const unclassified: SchoolOverview['unclassified'] = [];
  const byKey = new Map<string, StudentModel[]>();
  for (const m of read) {
    const c = ctxOf(m);
    const key = formationKey(m, c);
    if (key === null) { unclassified.push({ personId: m.personId, name: c.name }); continue; }
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(m);
  }

  const formations: FormationAgg[] = [...byKey.entries()].map(([key, ms]) => {
    const levels: LevelAgg[] = [];
    for (const level of LEVEL_ORDER) {
      const at = ms.filter(m => m.level === level);
      if (!at.length) continue;
      if (level === 'other') { levels.push({ level, students: at.length, bar: null, importRate: null, evalRate: null }); continue; }
      const t = tallyOf(at);
      levels.push({ level, students: at.length, bar: t.bar, ...tallyRates(t) });
    }
    // A formation with no MPE catalogue (no apprentice resolves to a catalogue profession) has no bars.
    const hasCatalogue = ms.some(m => m.profession !== null);
    return { key, title: ms[0].formationTitle!, icon: key, order: ms[0].formationOrder, students: ms.length, hasCatalogue, levels };
  }).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  const classified = [...byKey.values()].flat();
  const reps = reportCounts(classified);
  return {
    students: read.length,
    ...tallyRates(tallyOf(classified)),
    reportsPublishedRate: ratio(reps.published, reps.published + reps.draft + reps.missing),
    formations,
    unclassified,
    failed: failedOut,
    stale: [], // filled by the caller from the stored read state (splitByReadState)
    syncedAt,
  };
}

// ── Formation detail ────────────────────────────────────────────────────────

function mandateRows(models: StudentModel[], kind: 'mpe' | 'mpc'): MandateRow[] {
  const rows = new Map<string, MandateRow>();
  for (const m of models) {
    const k = knownOf(m);
    if (!k[kind]) continue;
    for (const s of m[kind]) {
      const id = `${s.slot.semester}|${s.slot.mandate}`;
      let r = rows.get(id);
      if (!r) {
        r = { semester: s.slot.semester, mandate: s.slot.mandate, title: s.slot.title, concerned: 0, imported: 0, assessable: 0, tiers: 0 };
        rows.set(id, r);
      }
      r.concerned += 1;
      if (s.status !== 'manquant') r.imported += 1;
      if (k.evaluation) {
        r.assessable += 1;
        if (s.status === 'tiers') r.tiers += 1;
      }
    }
  }
  return [...rows.values()].sort((a, b) => a.semester - b.semester || a.mandate.localeCompare(b.mandate));
}

function planOf(models: StudentModel[]): CompanyRow['plan'] {
  const known = models.filter(m => knownOf(m).suiviCompany);
  if (!known.length) return null; // no apprentice's Suivi read: the plan is unknown, not absent
  const n = known.filter(m => m.startSource === 'plan').length;
  return n === 0 ? 'non' : n === known.length ? 'oui' : 'partiel';
}

function studentBar(m: StudentModel): Bar | null {
  const k = knownOf(m);
  if (!isRated(m) || !k.mpe || !k.evaluation) return null;
  const b = emptyBar();
  for (const s of m.mpe) b[s.status] += 1;
  return b;
}

/** The newest semester already due (any state but future); null when none or the Suivi is unreadable. */
function latestReport(m: StudentModel): ReportState | null {
  if (!knownOf(m).suiviCompany) return null;
  const due = m.reports.filter(r => r.state !== 'future').sort((a, b) => b.semester - a.semester);
  return due.length ? due[0].state : null;
}

export function aggregateFormation(
  models: StudentModel[],
  ctx: StudentContext[],
  key: string,
  level: LevelCode | 'both',
  filters: { classId?: string; companyId?: string; semester?: number },
): FormationDetail {
  const ctxOf = contextIndex(ctx);
  const tableLevel: LevelCode = level === 'both' ? 'cfc' : level;

  const inFormation = models.filter(m => m.readOk && formationKey(m, ctxOf(m)) === key);
  const title = inFormation[0]?.formationTitle ?? key;
  const population = inFormation.filter(m => {
    const c = ctxOf(m);
    if (level !== 'both' && m.level !== level) return false;
    if (filters.classId !== undefined && !c.classIds.includes(filters.classId)) return false;
    if (filters.companyId !== undefined && !c.companies.some(co => co.id === filters.companyId)) return false;
    if (filters.semester !== undefined && m.currentSemester !== filters.semester) return false;
    return true;
  });
  const rated = population.filter(isRated);

  // Companies: an apprentice counts in each of its companies' rows; none → « sans entreprise ».
  const groups = new Map<string, { id: string | null; title: string; ms: StudentModel[] }>();
  for (const m of rated) {
    const cos = ctxOf(m).companies.filter((co, i, all) => all.findIndex(x => x.id === co.id) === i);
    const targets = cos.length ? cos : [{ id: null as string | null, title: NO_COMPANY }];
    for (const co of targets) {
      if (filters.companyId !== undefined && co.id !== filters.companyId) continue;
      const gk = co.id ?? '';
      if (!groups.has(gk)) groups.set(gk, { id: co.id, title: co.title, ms: [] });
      groups.get(gk)!.ms.push(m);
    }
  }
  const companyTallies: Array<{ row: CompanyRow; bar: Bar; allKnown: boolean }> = [...groups.values()].map(g => {
    const t = tallyOf(g.ms);
    const reps = reportCounts(g.ms);
    const row: CompanyRow = {
      id: g.id, title: g.title, students: g.ms.length, ...tallyRates(t), plan: planOf(g.ms),
      retired: g.ms.reduce((n, m) => n + m.retired.length, 0),
      reportsPublished: reps.published, reportsDue: reps.published + reps.draft + reps.missing,
    };
    const allKnown = g.ms.every(m => { const k = knownOf(m); return k.mpe && k.evaluation; });
    return { row, bar: t.bar, allKnown };
  }).sort((a, b) => (a.row.id === null ? 1 : 0) - (b.row.id === null ? 1 : 0) || a.row.title.localeCompare(b.row.title));
  // A company with no tiers but an apprentice whose MPE or evaluation is unknown may have tiers we
  // cannot see: it is left out of both the count and the total.
  const realCompanies = companyTallies.filter(c => c.row.id !== null && (c.bar.tiers > 0 || c.allKnown));

  const semesters = new Map<number, StudentModel[]>();
  for (const m of rated) {
    if (!semesters.has(m.currentSemester)) semesters.set(m.currentSemester, []);
    semesters.get(m.currentSemester)!.push(m);
  }

  const reportSems = new Map<number, { semester: number; published: number; draft: number; missing: number }>();
  for (const m of rated) {
    if (!knownOf(m).suiviCompany) continue;
    for (const r of m.reports) {
      if (!reportSems.has(r.semester)) reportSems.set(r.semester, { semester: r.semester, published: 0, draft: 0, missing: 0 });
      if (r.state === 'published' || r.state === 'draft' || r.state === 'missing') reportSems.get(r.semester)![r.state] += 1;
    }
  }

  const cieReports = { sent: 0, draft: 0 };
  for (const m of rated) {
    if (!knownOf(m).suiviCie) continue;
    cieReports.sent += m.cieReports.sent;
    cieReports.draft += m.cieReports.draft;
  }

  const startKnown = rated.filter(m => knownOf(m).suiviCompany);
  const atTableLevel = rated.filter(m => m.level === tableLevel);

  return {
    key,
    title,
    level,
    tableLevel,
    ...tallyRates(tallyOf(rated)),
    startEnteredShare: ratio(startKnown.filter(m => m.startSource === 'plan').length, startKnown.length),
    companiesWithoutTiers: { count: realCompanies.filter(c => c.bar.tiers === 0).length, total: realCompanies.length },
    bySemester: [...semesters.entries()].sort((a, b) => a[0] - b[0])
      .map(([semester, ms]) => ({ semester, students: ms.length, bar: tallyOf(ms).bar })),
    mpe: mandateRows(atTableLevel, 'mpe'),
    mpc: mandateRows(atTableLevel, 'mpc'),
    cieReports,
    companies: companyTallies.map(c => c.row),
    reportsBySemester: [...reportSems.values()].sort((a, b) => a.semester - b.semester),
    students: population.map(m => {
      const c = ctxOf(m);
      return {
        personId: m.personId,
        name: c.name,
        company: c.companies.length ? c.companies.map(co => co.title).join(', ') : NO_COMPANY,
        currentSemester: m.currentSemester,
        bar: studentBar(m),
        latestReport: latestReport(m),
        flags: flagsOf(m),
      };
    }).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ── Stored read state (the service's split before aggregating) ───────────────

/** Flag on an apprentice whose last read failed and whose figures come from an earlier read. */
export const STALE_FLAG = 'données anciennes';
/** Error of an apprentice the formation sync has not read yet (no stored row). */
export const NEVER_READ = 'pas encore lu';
const READ_FAILED = 'lecture échouée';

export interface StoredReadState { readOk: boolean; stale: boolean; error: string | null }

/**
 * Splits the school's apprentices by what is stored for them. Each lands in exactly one of
 * `read` (rows from a successful read exist — possibly an earlier one) or `failed` (no
 * successful read ever). `stale` lists the read ones whose latest read failed.
 */
export function splitByReadState(
  students: Array<{ personId: string; name: string }>,
  states: Map<string, StoredReadState>,
): { read: string[]; failed: SchoolOverview['failed']; stale: SchoolOverview['stale'] } {
  const read: string[] = [];
  const failed: SchoolOverview['failed'] = [];
  const stale: SchoolOverview['stale'] = [];
  for (const s of students) {
    const st = states.get(s.personId);
    if (!st) { failed.push({ ...s, error: NEVER_READ }); continue; }
    if (!st.readOk) { failed.push({ ...s, error: st.error ?? READ_FAILED }); continue; }
    read.push(s.personId);
    if (st.stale) stale.push({ ...s, error: st.error ?? READ_FAILED });
  }
  return { read, failed, stale };
}

/** Appends the stale flag to the rows of the given apprentices. */
export function markStale(detail: FormationDetail, staleIds: Set<string>): FormationDetail {
  return {
    ...detail,
    students: detail.students.map(s => (staleIds.has(s.personId) ? { ...s, flags: [...s.flags, STALE_FLAG] } : s)),
  };
}
