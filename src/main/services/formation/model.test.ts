import { describe, it, expect } from 'vitest';
import type { AssessmentFact, Copy, ReportFact, Slot, StudentRaw, Reference } from '../../../shared/formation-types';
import {
  levelCode, schoolYearAug1, addMonths, guessStartDate, currentSemester, buildStudentModel,
} from './model';

const TODAY = new Date(2026, 10, 24).getTime();
const d = (y: number, m: number, day: number) => new Date(y, m, day).getTime();

const SELF = 'uid-self-001';
const MENTOR = 'uid-mentor-001';

const slot = (semester: number, mandate: string, o: Partial<Slot> = {}): Slot => ({
  kind: 'mpe', profession: 'cui', level: 'cfc', semester, mandate,
  title: `Mandat S${semester}·${mandate}`, id: `master-${o.kind ?? 'mpe'}-${o.level ?? 'cfc'}-${semester}-${mandate}`, ...o,
});
const copy = (id: string, semester: number | null, mandate: string | null, o: Partial<Copy> = {}): Copy => ({
  kind: 'mpe', id, semester, mandate, level: 'cfc', profession: 'cui', title: id, dateCreated: d(2026, 2, 1), ...o,
});
const fact = (copyId: string, authorId: string | null, o: Partial<AssessmentFact> = {}): AssessmentFact => ({
  copyId, authorId, authorName: authorId === SELF ? 'Apprenti Test' : 'Formateur Test',
  points: 2, feedback: null, dateMs: d(2026, 3, 1), ...o,
});
const report = (id: string, semester: number | null, o: Partial<ReportFact> = {}): ReportFact => ({
  kind: 'company', id, semester, published: false, publishedAt: null, courseId: null, dateCreated: d(2025, 5, 1), ...o,
});

const REF: Reference = {
  slots: [slot(1, '01'), slot(1, '02'), slot(2, '01'), slot(3, '01'),
    slot(1, '01', { level: 'afp' }), slot(1, '01', { kind: 'mpc' })],
  professionsByIcon: { 'icon-cui': { title: 'Cuisinier', order: 2 } },
  levelsByColor: { '#9ad9ea': 'AFP', '#f0b400': 'CFC' },
  catalogueIcons: { 'icon-cui': 'cui', 'icon-res': 'res' },
};
const CFC = { icon: 'icon-cui', color: '#f0b400' };

function raw(o: Partial<StudentRaw> = {}): StudentRaw {
  return {
    personId: 'prof-001', ok: true, error: null, profileCreated: d(2025, 0, 10),
    userIdTag: 'hz-config-userid-{value}', selfUid: SELF, timelineOk: true, timelineFound: true, facts: [],
    suiviCompanyFound: true, suiviCieFound: true,
    mpe: { found: true, copies: [] }, mpc: { found: true, copies: [] },
    reports: [], plan: { startMs: null, retiredSlots: [] }, failedParts: [], emptyListings: 0, skippedSubtrees: 0,
    ...o,
  };
}
// CFC apprentice in semester 2 on TODAY: S1 = Feb–Jul 2026, S2 = Aug 2026–Jan 2027.
const S2_PLAN = { startMs: d(2026, 1, 1), retiredSlots: [] as string[] };

describe('levelCode', () => {
  it('maps AFP/CFC case- and space-insensitively, else null', () => {
    expect(levelCode('AFP')).toBe('afp');
    expect(levelCode(' cfc ')).toBe('cfc');
    expect(levelCode('Attestation')).toBeNull();
    expect(levelCode(null)).toBeNull();
  });
});

describe('dates', () => {
  it('schoolYearAug1 snaps to 1 August of the school year', () => {
    expect(schoolYearAug1(d(2025, 1, 3))).toBe(d(2024, 7, 1));
    expect(schoolYearAug1(d(2025, 7, 1))).toBe(d(2025, 7, 1));
  });
  it('addMonths clamps to the end of a short month', () => {
    expect(addMonths(d(2026, 0, 31), 1)).toBe(d(2026, 1, 28));
    expect(addMonths(d(2026, 7, 1), 6)).toBe(d(2027, 1, 1));
  });
  it('guessStartDate takes the earliest trace, snapped to 1 August', () => {
    expect(guessStartDate({ mandates: [d(2025, 1, 3)] }, TODAY)).toEqual({ startMs: d(2024, 7, 1), source: 'mandate' });
    expect(guessStartDate({}, TODAY)).toEqual({ startMs: d(2026, 7, 1), source: 'default' });
    expect(guessStartDate({ report: d(2025, 9, 1), mandates: [0, d(2025, 10, 1)], profile: d(2024, 8, 1) }, TODAY))
      .toEqual({ startMs: d(2024, 7, 1), source: 'profile' });
  });
  it('currentSemester: containing today; 0 before the start; the last after the end', () => {
    expect(currentSemester(d(2024, 7, 1), 6, TODAY)).toBe(5);
    expect(currentSemester(d(2027, 7, 1), 6, TODAY)).toBe(0);
    expect(currentSemester(d(2020, 7, 1), 6, TODAY)).toBe(6);
  });
});

describe('buildStudentModel — mandate statuses', () => {
  const copies = [copy('copy-101', 1, '01'), copy('copy-102', 1, '02'), copy('copy-103', 2, '01'), copy('copy-104', 3, '01')];
  const facts = [fact('copy-101', SELF), fact('copy-101', MENTOR), fact('copy-102', SELF)];

  it('classifies expected slots and keeps early imports in ahead', () => {
    const m = buildStudentModel(raw({ plan: S2_PLAN, facts, mpe: { found: true, copies } }), CFC, REF, TODAY);
    expect(m.level).toBe('cfc');
    expect(m.semesterCount).toBe(6);
    expect(m.currentSemester).toBe(2);
    expect(m.mpe.map(r => [r.slot.semester, r.slot.mandate, r.status])).toEqual([
      [1, '01', 'tiers'], [1, '02', 'auto'], [2, '01', 'encours'],
    ]);
    expect(m.mpe[0].copyIds).toEqual(['copy-101']);
    expect(m.mpe[0].assessments.map(a => a.isSelf).sort()).toEqual([false, true]);
    expect(m.ahead.map(c => c.id)).toEqual(['copy-104']);
    expect(m.mpe.some(r => r.copyIds.includes('copy-104'))).toBe(false);
  });

  it('a slot with no copy is manquant', () => {
    const m = buildStudentModel(raw({ plan: S2_PLAN, mpe: { found: true, copies: [copy('copy-101', 1, '01')] } }), CFC, REF, TODAY);
    expect(m.mpe.find(r => r.slot.mandate === '02' && r.slot.semester === 1)!.status).toBe('manquant');
    expect(m.mpe.find(r => r.slot.mandate === '02')!.copyIds).toEqual([]);
  });

  it('a slot retired by the plan leaves mpe and is listed in retired; a malformed key is ignored', () => {
    const plan = { startMs: S2_PLAN.startMs, retiredSlots: ['cfc-1-02', 'cfc-x-01', 'afp-1-01'] };
    const m = buildStudentModel(raw({ plan }), CFC, REF, TODAY);
    expect(m.mpe.map(r => `${r.slot.semester}-${r.slot.mandate}`)).toEqual(['1-01', '2-01']);
    expect(m.retired).toEqual(['cfc-1-02']);
  });

  it('best wins over two copies of one slot', () => {
    const two = [copy('copy-201', 1, '01'), copy('copy-202', 1, '01')];
    const m = buildStudentModel(raw({ plan: S2_PLAN, mpe: { found: true, copies: two }, facts: [fact('copy-202', MENTOR)] }), CFC, REF, TODAY);
    expect(m.mpe[0].status).toBe('tiers');
    expect(m.mpe[0].copyIds).toEqual(['copy-201', 'copy-202']);
  });

  it('copies of another level are ignored; copies without a level match', () => {
    const cs = [copy('copy-301', 1, '01', { level: 'afp' }), copy('copy-302', 1, '02', { level: null })];
    const m = buildStudentModel(raw({ plan: S2_PLAN, mpe: { found: true, copies: cs } }), CFC, REF, TODAY);
    expect(m.mpe[0].status).toBe('manquant');
    expect(m.mpe[1].status).toBe('encours');
  });

  it('MPC copies match MPC slots', () => {
    const m = buildStudentModel(raw({ plan: S2_PLAN, mpc: { found: true, copies: [copy('copy-401', 1, '01', { kind: 'mpc' })] } }), CFC, REF, TODAY);
    expect(m.mpc.map(r => [r.slot.kind, r.status])).toEqual([['mpc', 'encours']]);
  });

  it('identity unknown: flagged, every author treated as non-self', () => {
    const m = buildStudentModel(raw({ selfUid: null, plan: S2_PLAN, facts, mpe: { found: true, copies } }), CFC, REF, TODAY);
    expect(m.identityKnown).toBe(false);
    expect(m.mpe[1].status).toBe('tiers');
    expect(m.mpe[1].assessments.every(a => !a.isSelf)).toBe(true);
  });

  it('a failed ACL read makes the identity unknown; failedParts is copied', () => {
    const m = buildStudentModel(raw({ failedParts: ['acl', 'mpc'] }), CFC, REF, TODAY);
    expect(m.identityKnown).toBe(false);
    expect(m.failedParts).toEqual(['acl', 'mpc']);
  });
});

describe('buildStudentModel — reports', () => {
  it('past semesters published/draft/missing, current future, untagged counted', () => {
    // CFC in semester 4: start 1 Feb 2025.
    const reports = [
      report('rep-1', 1, { published: true, publishedAt: d(2025, 6, 1) }),
      report('rep-2', 2),
      report('rep-x', null),
      { ...report('rep-c1', null, { published: true }), kind: 'cie' as const },
      { ...report('rep-c2', null), kind: 'cie' as const },
    ];
    const m = buildStudentModel(raw({ plan: { startMs: d(2025, 1, 1), retiredSlots: [] }, reports }), CFC, REF, TODAY);
    expect(m.currentSemester).toBe(4);
    expect(m.reports.map(r => r.state)).toEqual(['published', 'draft', 'missing', 'future', 'future', 'future']);
    expect(m.reports[0]).toMatchObject({ semester: 1, reportId: 'rep-1', publishedAt: d(2025, 6, 1) });
    expect(m.reports[2].reportId).toBeNull();
    expect(m.untaggedReports).toBe(1);
    expect(m.cieReports).toEqual({ sent: 1, draft: 1 });
  });

  it('the last semester is optional once ended', () => {
    const m = buildStudentModel(raw({ plan: { startMs: d(2023, 7, 1), retiredSlots: [] } }), CFC, REF, TODAY);
    expect(m.currentSemester).toBe(6);
    expect(m.reports.map(r => r.state)).toEqual(['missing', 'missing', 'missing', 'missing', 'missing', 'optional']);
  });
});

describe('buildStudentModel — formation, level, start', () => {
  it('maps the colour through levelsByColor whatever its case', () => {
    const m = buildStudentModel(raw(), { icon: 'icon-cui', color: '#9AD9EA' }, REF, TODAY);
    expect(m.level).toBe('afp');
    expect(m.semesterCount).toBe(4);
    expect(m.formationTitle).toBe('Cuisinier');
    expect(m.formationOrder).toBe(2);
  });

  it('an unmapped colour is other with no mandates; an unmapped icon has no title', () => {
    const m = buildStudentModel(raw({ mpe: { found: true, copies: [copy('copy-101', 1, '01')] } }),
      { icon: 'icon-unknown', color: '#123456' }, REF, TODAY);
    expect(m.level).toBe('other');
    expect(m.mpe).toEqual([]);
    expect(m.mpc).toEqual([]);
    expect(m.reports).toEqual([]);
    expect(m.formationTitle).toBeNull();
  });

  it('the plan start wins over every guess', () => {
    const m = buildStudentModel(raw({ plan: S2_PLAN, reports: [report('rep-1', 1, { dateCreated: d(2024, 9, 1) })] }), CFC, REF, TODAY);
    expect(m.startSource).toBe('plan');
    expect(m.startMs).toBe(d(2026, 1, 1));
    expect(m.semesters[1]).toEqual({ n: 2, startMs: d(2026, 7, 1), endMs: d(2027, 0, 31) });
  });

  it('without a plan the start is guessed from the S1 report, copies and profile', () => {
    const m = buildStudentModel(raw({
      reports: [report('rep-1', 1, { dateCreated: d(2024, 9, 1) }), report('rep-2', 2, { dateCreated: d(2023, 9, 1) })],
    }), CFC, REF, TODAY);
    expect(m.startSource).toBe('report');
    expect(m.startMs).toBe(d(2024, 7, 1));
  });

  it('a failed Suivi read falls back to the guess', () => {
    const m = buildStudentModel(raw({ failedParts: ['suivi-company'] }), CFC, REF, TODAY);
    expect(m.startSource).toBe('profile');
    expect(m.startMs).toBe(d(2024, 7, 1));
  });

  it('profession by icon, else the most frequent copy profession in the catalogue', () => {
    expect(buildStudentModel(raw(), CFC, REF, TODAY).profession).toBe('cui');
    const cs = [copy('c1', 1, '01', { profession: 'res' }), copy('c2', 1, '02', { profession: 'cui' }), copy('c3', 2, '01', { profession: 'cui' })];
    const m = buildStudentModel(raw({ mpe: { found: true, copies: cs } }), { icon: null, color: '#f0b400' }, REF, TODAY);
    expect(m.profession).toBe('cui');
    const none = buildStudentModel(raw({ mpe: { found: true, copies: [copy('c1', 1, '01', { profession: 'zzz' })] } }),
      { icon: null, color: '#f0b400' }, REF, TODAY);
    expect(none.profession).toBeNull();
    expect(none.mpe).toEqual([]);
  });

  it('carries the found bits of the timeline and both Suivis', () => {
    const m = buildStudentModel(raw({ timelineFound: false, suiviCompanyFound: false, suiviCieFound: true }), CFC, REF, TODAY);
    expect(m).toMatchObject({ timelineFound: false, suiviCompanyFound: false, suiviCieFound: true });
  });

  it('copies flags from the raw read', () => {
    const m = buildStudentModel(raw({ ok: false, timelineOk: false, mpc: { found: false, copies: [] } }), CFC, REF, TODAY);
    expect(m).toMatchObject({ personId: 'prof-001', readOk: false, timelineOk: false, mpeFound: true, mpcFound: false, identityKnown: true });
  });
});
