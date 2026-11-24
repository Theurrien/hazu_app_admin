// Per-apprentice model for the Missions formation overview — pure, no IO, no DB, no Electron.
// Turns one StudentRaw + the school Reference into the numbers of spec §6.
// Rules are ported from the enterprise dashboard widget
// (34 - Hazu Artifacts/5-Enterprise/enterprise_dashboard.html).

import type {
  Copy, LevelCode, MandateKind, ReportFact, ReportState, Slot, SlotResult, SlotStatus, StudentModel, StudentRaw, Reference,
} from '../../../shared/formation-types';
import { slotKey } from './parse';

export type { SlotStatus, SlotResult, StudentModel, FormationStudent, ReportState } from '../../../shared/formation-types';

/** Sort key for an apprentice whose formation does not resolve: after every configured one. */
const UNKNOWN_FORMATION_ORDER = Number.MAX_SAFE_INTEGER;

// Source: enterprise_dashboard.html — levelTitleToCode
export function levelCode(title: string | null): LevelCode | null {
  const t = String(title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (t === 'afp') return 'afp';
  if (t === 'cfc') return 'cfc';
  return null;
}

// Source: enterprise_dashboard.html — dayStart (local midnight)
export function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Source: enterprise_dashboard.html — addDays
function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

// Source: enterprise_dashboard.html — addMonths (clamps the day to the target month's length)
export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last)).getTime();
}

// Source: enterprise_dashboard.html — schoolYearAug1
// 1 August of the school year containing ms (Aug–Dec → that year, Jan–Jul → the year before).
export function schoolYearAug1(ms: number): number {
  const d = new Date(ms);
  const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(y, 7, 1).getTime();
}

// Source: enterprise_dashboard.html — guessStartDate
// The earliest known trace of the apprenticeship → 1 August of its school year. 0/missing values are ignored.
export function guessStartDate(
  src: { report?: number; mandates?: number[]; profile?: number },
  todayMs: number,
): { startMs: number; source: 'report' | 'mandate' | 'profile' | 'default' } {
  const c: Array<{ ms: number; source: 'report' | 'mandate' | 'profile' }> = [];
  if (src.report && src.report > 0) c.push({ ms: src.report, source: 'report' });
  for (const ms of src.mandates ?? []) if (ms > 0) c.push({ ms, source: 'mandate' });
  if (src.profile && src.profile > 0) c.push({ ms: src.profile, source: 'profile' });
  if (!c.length) return { startMs: schoolYearAug1(todayMs), source: 'default' };
  c.sort((a, b) => a.ms - b.ms);
  return { startMs: schoolYearAug1(c[0].ms), source: c[0].source };
}

// Source: enterprise_dashboard.html — semesterCount
function semesterCountOf(level: LevelCode | 'other'): number {
  return level === 'afp' ? 4 : level === 'cfc' ? 6 : 0;
}

// Source: enterprise_dashboard.html — semesterBounds
// Semester k runs addMonths(start, 6(k−1)) to addMonths(start, 6k) − 1 day.
function semesterBounds(startMs: number, count: number): Array<{ n: number; startMs: number; endMs: number }> {
  const out: Array<{ n: number; startMs: number; endMs: number }> = [];
  for (let n = 1; n <= count; n++) {
    out.push({ n, startMs: addMonths(startMs, 6 * (n - 1)), endMs: addDays(addMonths(startMs, 6 * n), -1) });
  }
  return out;
}

/** The semester containing today; before the start → 0 (nothing expected); after the end → the last. */
export function currentSemester(startMs: number, count: number, todayMs: number): number {
  if (count <= 0) return 0;
  const today = dayStart(todayMs);
  const bounds = semesterBounds(dayStart(startMs), count);
  if (today < bounds[0].startMs) return 0;
  for (const b of bounds) if (today >= b.startMs && today <= b.endMs) return b.n;
  return count;
}

// Source: enterprise_dashboard.html — slotKeyOf (validation only)
// A retired plan key "level-semester-mandate", split into its parts; null when any part is unusable.
function parseRetiredKey(key: string): { level: string; semester: number; mandate: string } | null {
  const parts = String(key).split('-');
  if (parts.length !== 3) return null;
  const [l, s, m] = parts;
  if (!/^(afp|cfc)$/.test(l) || !/^\d+$/.test(s) || !/^[A-Za-z0-9]+$/.test(m)) return null;
  return { level: l, semester: Number(s), mandate: m };
}

// Source: enterprise_dashboard.html — STATUS_RANK (without 'moi': a school-wide view has no viewer)
const STATUS_RANK: Record<SlotStatus, number> = { manquant: 0, encours: 1, auto: 2, tiers: 3 };

// Source: enterprise_dashboard.html — resolveProgram (profession code only)
// By profile icon → catalogue folder code; fallback the most frequent profession facet among the
// copies, kept only when the catalogue has that profession.
function resolveProfession(icon: string | null, copies: Copy[], ref: Reference): string | null {
  if (icon && ref.catalogueIcons[icon]) return ref.catalogueIcons[icon];
  const counts: Record<string, number> = {};
  for (const c of copies) if (c.profession) counts[c.profession] = (counts[c.profession] || 0) + 1;
  let best: string | null = null;
  let bestN = 0;
  for (const k of Object.keys(counts)) if (counts[k] > bestN) { bestN = counts[k]; best = k; }
  return best && ref.slots.some(s => s.profession === best) ? best : null;
}

function bySemesterThenMandate(a: Slot, b: Slot): number {
  return a.semester - b.semester || String(a.mandate).localeCompare(String(b.mandate));
}


// Source: enterprise_dashboard.html — buildAssessmentMap + mandateStatus (no 'moi')
// No linked fact → encours; every linked fact self-authored → auto; else tiers.
function copyStatus(facts: StudentRaw['facts'], selfUid: string | null): SlotStatus {
  if (!facts.length) return 'encours';
  return facts.every(f => selfUid !== null && f.authorId === selfUid) ? 'auto' : 'tiers';
}

// Source: enterprise_dashboard.html — buildProgress (+ the plan's retired slots, spec §6)
// Expected = catalogue slots of this kind × profession × level with semester ≤ current, minus the
// retired ones. A copy of another level is ignored (a copy with no level matches); a copy matches a
// slot by semester + mandate; the best status wins over a slot's copies. Copies matching a slot not
// yet expected go to `ahead`.
function evaluateKind(
  kind: MandateKind,
  level: LevelCode,
  copies: Copy[],
  facts: StudentRaw['facts'],
  selfUid: string | null,
  catalogue: Slot[],
  current: number,
  isRetired: (s: Slot) => boolean,
): { results: SlotResult[]; ahead: Copy[]; retired: string[] } {
  const slots = catalogue.filter(s => s.kind === kind).sort(bySemesterThenMandate);
  const usable = copies.filter(c => c.kind === kind && (c.level === null || c.level === level));
  const matches = (c: Copy, s: Slot) => c.semester === s.semester && c.mandate === s.mandate;

  const results: SlotResult[] = [];
  const retired: string[] = [];
  const ahead: Copy[] = [];
  for (const s of slots) {
    if (s.semester > current) {
      for (const c of usable) if (matches(c, s) && !ahead.includes(c)) ahead.push(c);
      continue;
    }
    if (isRetired(s)) { retired.push(slotKey(s.level, s.semester, s.mandate)); continue; }
    const hits = usable.filter(c => matches(c, s));
    let status: SlotStatus = 'manquant';
    const assessments: SlotResult['assessments'] = [];
    for (const c of hits) {
      const linked = facts.filter(f => f.copyId === c.id);
      const st = copyStatus(linked, selfUid);
      if (STATUS_RANK[st] > STATUS_RANK[status]) status = st;
      for (const f of linked) {
        assessments.push({
          authorName: f.authorName, isSelf: selfUid !== null && f.authorId === selfUid,
          points: f.points, dateMs: f.dateMs, feedback: f.feedback,
        });
      }
    }
    assessments.sort((a, b) => a.dateMs - b.dateMs);
    results.push({ slot: s, status, copyIds: hits.map(c => c.id), assessments });
  }
  return { results, ahead, retired };
}

// Source: enterprise_dashboard.html — buildReportProgress (semester line; last semester optional)
// A semester with a published report → published (newest); a report but none published → draft;
// none → missing once the semester has ended, optional for the last one, future otherwise.
function reportLine(
  reports: ReportFact[],
  semesters: Array<{ n: number; startMs: number; endMs: number }>,
  todayMs: number,
): StudentModel['reports'] {
  const today = dayStart(todayMs);
  const count = semesters.length;
  return semesters.map(sem => {
    const reps = reports.filter(r => r.semester === sem.n);
    const published = reps.filter(r => r.published);
    if (published.length) {
      const at = (r: ReportFact) => r.publishedAt || r.dateCreated || 0;
      const pick = published.slice().sort((a, b) => at(b) - at(a))[0];
      return { semester: sem.n, state: 'published' as const, reportId: pick.id, publishedAt: at(pick) || null };
    }
    if (reps.length) {
      const pick = reps.slice().sort((a, b) => (b.dateCreated || 0) - (a.dateCreated || 0))[0];
      return { semester: sem.n, state: 'draft' as const, reportId: pick.id, publishedAt: null };
    }
    const ended = sem.endMs < today;
    const state: ReportState = !ended ? 'future' : sem.n === count ? 'optional' : 'missing';
    return { semester: sem.n, state, reportId: null, publishedAt: null };
  });
}

const isTaggedSemester = (n: number | null) => n !== null && Number.isInteger(n) && n >= 1;

export function buildStudentModel(
  raw: StudentRaw,
  person: { icon: string | null; color: string | null },
  ref: Reference,
  todayMs: number,
): StudentModel {
  const formation = person.icon ? ref.professionsByIcon[person.icon] ?? null : null;
  const levelTitle = person.color ? ref.levelsByColor[person.color.toLowerCase()] ?? null : null;
  const level: LevelCode | 'other' = levelCode(levelTitle) ?? 'other';
  const allCopies = [...raw.mpe.copies, ...raw.mpc.copies];
  const profession = resolveProfession(person.icon, allCopies, ref);

  const company = raw.reports.filter(r => r.kind === 'company');
  const cie = raw.reports.filter(r => r.kind === 'cie');

  // Source: enterprise_dashboard.html — planGuessSources (earliest S1 report, every MPE copy, the profile)
  let startMs: number;
  let startSource: StudentModel['startSource'];
  if (raw.plan.startMs !== null && raw.plan.startMs > 0) {
    startMs = dayStart(raw.plan.startMs);
    startSource = 'plan';
  } else {
    const s1 = company.filter(r => r.semester === 1).map(r => r.dateCreated || 0).filter(x => x > 0);
    const g = guessStartDate({
      report: s1.length ? Math.min(...s1) : 0,
      mandates: raw.mpe.copies.map(c => c.dateCreated || 0),
      profile: raw.profileCreated || 0,
    }, todayMs);
    startMs = g.startMs;
    startSource = g.source;
  }

  const semesterCount = semesterCountOf(level);
  const semesters = semesterBounds(startMs, semesterCount);
  const current = currentSemester(startMs, semesterCount, todayMs);

  let mpe: SlotResult[] = [];
  let mpc: SlotResult[] = [];
  let ahead: Copy[] = [];
  let retired: string[] = [];
  if (level !== 'other' && profession) {
    const catalogue = ref.slots.filter(s => s.profession === profession && s.level === level);
    // Retired plan keys are compared part by part — never as a string built from the numeric semester.
    const retiredParts = raw.plan.retiredSlots.map(parseRetiredKey).filter((x): x is NonNullable<typeof x> => !!x);
    const isRetired = (s: Slot) => retiredParts.some(r => r.level === s.level && r.semester === s.semester && r.mandate === s.mandate);
    const e = evaluateKind('mpe', level, raw.mpe.copies, raw.facts, raw.selfUid, catalogue, current, isRetired);
    // The plan is the company's: it retires MPE slots only.
    const c = evaluateKind('mpc', level, raw.mpc.copies, raw.facts, raw.selfUid, catalogue, current, () => false);
    mpe = e.results;
    mpc = c.results;
    ahead = [...e.ahead, ...c.ahead];
    retired = e.retired;
  }

  return {
    personId: raw.personId,
    formationTitle: formation ? formation.title : null,
    formationOrder: formation ? formation.order : UNKNOWN_FORMATION_ORDER,
    profession,
    level,
    startMs,
    startSource,
    semesterCount,
    currentSemester: current,
    semesters,
    mpe,
    mpc,
    ahead,
    retired,
    reports: level === 'other' ? [] : reportLine(company, semesters, todayMs),
    untaggedReports: company.filter(r => !isTaggedSemester(r.semester)).length,
    cieReports: { sent: cie.filter(r => r.published).length, draft: cie.filter(r => !r.published).length },
    identityKnown: raw.selfUid !== null && !raw.failedParts.includes('acl'),
    timelineOk: raw.timelineOk,
    timelineFound: raw.timelineFound,
    readOk: raw.ok,
    mpeFound: raw.mpe.found,
    mpcFound: raw.mpc.found,
    suiviCompanyFound: raw.suiviCompanyFound,
    suiviCieFound: raw.suiviCieFound,
    failedParts: [...raw.failedParts],
  };
}
