import { describe, it, expect } from 'vitest';
import type { Slot, StudentContext } from '../../../shared/formation-types';
import type { SlotResult, SlotStatus, StudentModel } from './model';
import { rates, aggregateOverview, aggregateFormation, splitByReadState, markStale, STALE_FLAG, NEVER_READ } from './aggregate';

// ── Fixtures (invented) ──────────────────────────────────────────────────────

const CUI = 'icon-cui';
const RES = 'icon-res';

const slot = (semester: number, mandate: string, o: Partial<Slot> = {}): Slot => ({
  kind: 'mpe', profession: 'cui', level: 'cfc', semester, mandate,
  title: `Mandat S${semester}·${mandate}`, id: `master-${semester}-${mandate}`, ...o,
});
const res = (status: SlotStatus, semester = 1, mandate = '01', o: Partial<Slot> = {}): SlotResult => ({
  slot: slot(semester, mandate, o), status, copyIds: status === 'manquant' ? [] : [`copy-${semester}-${mandate}`], assessments: [],
});

let seq = 0;
function model(o: Partial<StudentModel> = {}): StudentModel {
  seq += 1;
  return {
    personId: `prof-${String(seq).padStart(3, '0')}`,
    formationTitle: 'Cuisine', formationOrder: 1, profession: 'cui', level: 'cfc',
    startMs: 0, startSource: 'plan', semesterCount: 6, currentSemester: 2, semesters: [],
    mpe: [], mpc: [], ahead: [], retired: [], reports: [], untaggedReports: 0,
    cieReports: { sent: 0, draft: 0 },
    identityKnown: true, timelineOk: true, readOk: true, mpeFound: true, mpcFound: true, failedParts: [],
    ...o,
  };
}
const ctxOf = (m: StudentModel, o: Partial<StudentContext> = {}): StudentContext => ({
  personId: m.personId, name: `Apprenti ${m.personId}`, icon: m.formationTitle === null ? 'icon-unknown' : CUI,
  companies: [], classIds: [], ...o,
});
const ctxAll = (ms: StudentModel[]) => ms.map(m => ctxOf(m));

// Two expected slots: one tiers, one manquant → import 0.5, eval 1.
const HALF = [res('tiers', 1, '01'), res('manquant', 1, '02')];

describe('rates', () => {
  it('import = imported / expected, eval = tiers / imported', () => {
    expect(rates({ tiers: 2, auto: 1, encours: 1, manquant: 4 })).toEqual({ importRate: 0.5, evalRate: 0.5 });
  });
  it('an empty bar has no rates', () => {
    expect(rates({ tiers: 0, auto: 0, encours: 0, manquant: 0 })).toEqual({ importRate: null, evalRate: null });
  });
});

describe('aggregateOverview', () => {
  it('builds one card per formation with level lines; other level and unclassified have no rates', () => {
    const cfc1 = model({ mpe: [res('tiers', 1, '01'), res('auto', 1, '02')] });
    const cfc2 = model({ mpe: [res('encours', 1, '01'), res('manquant', 1, '02')] });
    const afp = model({ level: 'afp', semesterCount: 4, mpe: [res('manquant', 1, '01', { level: 'afp' })] });
    const other = model({ level: 'other', semesterCount: 0, currentSemester: 0 });
    const lost = model({ formationTitle: null, formationOrder: Number.MAX_SAFE_INTEGER });
    const ms = [cfc1, cfc2, afp, other, lost];
    const o = aggregateOverview(ms, ctxAll(ms), [], 1234);

    expect(o.students).toBe(5);
    expect(o.syncedAt).toBe(1234);
    expect(o.formations).toHaveLength(1);
    const card = o.formations[0];
    expect(card).toMatchObject({ key: CUI, icon: CUI, title: 'Cuisine', order: 1, students: 4 });
    expect(card.levels.map(l => l.level)).toEqual(['cfc', 'afp', 'other']);
    const [lc, la, lo] = card.levels;
    expect(lc).toMatchObject({ students: 2, bar: { tiers: 1, auto: 1, encours: 1, manquant: 1 }, importRate: 0.75, evalRate: 1 / 3 });
    expect(la).toMatchObject({ students: 1, bar: { tiers: 0, auto: 0, encours: 0, manquant: 1 }, importRate: 0, evalRate: null });
    expect(lo).toEqual({ level: 'other', students: 1, bar: null, importRate: null, evalRate: null });
    expect(o.unclassified).toEqual([{ personId: lost.personId, name: `Apprenti ${lost.personId}` }]);
    // Headline over AFP + CFC: 3 imported of 5 expected; 1 tiers of 3 imported.
    expect(o.importRate).toBeCloseTo(3 / 5);
    expect(o.evalRate).toBeCloseTo(1 / 3);
  });

  it('an unclassified apprentice with slots enters no rate', () => {
    const a = model({ mpe: HALF });
    const lost = model({ formationTitle: null, mpe: [res('manquant'), res('manquant', 1, '02')] });
    const o = aggregateOverview([a, lost], ctxAll([a, lost]), [], null);
    expect(o.importRate).toBe(0.5);
  });

  it('sorts formation cards by the config order', () => {
    const r = model({ formationTitle: 'Restauration', formationOrder: 3 });
    const h = model({ formationTitle: 'Hôtellerie-Intendance', formationOrder: 2 });
    const c = model({ formationTitle: 'Cuisine', formationOrder: 1 });
    const ms = [r, h, c];
    const ctx = [ctxOf(r, { icon: RES }), ctxOf(h, { icon: 'icon-hi' }), ctxOf(c)];
    expect(aggregateOverview(ms, ctx, [], null).formations.map(f => f.title))
      .toEqual(['Cuisine', 'Hôtellerie-Intendance', 'Restauration']);
  });

  it('identity unknown: counts in the import rate, not in the evaluation rate', () => {
    const a = model({ mpe: HALF });
    const b = model({ identityKnown: false, mpe: [res('tiers', 1, '01'), res('tiers', 1, '02')] });
    const o = aggregateOverview([a, b], ctxAll([a, b]), [], null);
    expect(o.importRate).toBe(3 / 4);
    expect(o.evalRate).toBe(1);
    // The bar shows known statuses only.
    expect(o.formations[0].levels[0].bar).toEqual({ tiers: 1, auto: 0, encours: 0, manquant: 1 });
    expect(o.formations[0].levels[0]).toMatchObject({ importRate: 0.75, evalRate: 1 });
  });

  it('timeline unreadable (timelineOk false or failed part): import yes, evaluation no', () => {
    const a = model({ mpe: HALF });
    const b = model({ timelineOk: false, mpe: [res('encours', 1, '01'), res('encours', 1, '02')] });
    const c = model({ failedParts: ['timeline'], mpe: [res('encours', 1, '01'), res('manquant', 1, '02')] });
    const o = aggregateOverview([a, b, c], ctxAll([a, b, c]), [], null);
    expect(o.importRate).toBe(4 / 6);
    expect(o.evalRate).toBe(1);
  });

  it('readOk false: in failed (with the context name), in no count and no rate', () => {
    const a = model({ mpe: HALF });
    const bad = model({ readOk: false, mpe: [res('manquant'), res('manquant', 1, '02')] });
    const o = aggregateOverview([a, bad], ctxAll([a, bad]), [], null);
    expect(o.failed).toEqual([{ personId: bad.personId, name: `Apprenti ${bad.personId}`, error: 'profil illisible' }]);
    expect(o.students).toBe(1);
    expect(o.formations[0].students).toBe(1);
    expect(o.formations[0].levels[0].students).toBe(1);
    expect(o.importRate).toBe(0.5);
  });

  it('merges the given failed list with unread models, once per person', () => {
    const bad = model({ readOk: false });
    const stale = model({ mpe: HALF });
    const given = [
      { personId: bad.personId, name: 'x', error: 'timeout' },
      { personId: stale.personId, name: `Apprenti ${stale.personId}`, error: 'HTTP 500' },
    ];
    const o = aggregateOverview([bad, stale], ctxAll([bad, stale]), given, null);
    expect(o.failed).toEqual(given);
    expect(o.students).toBe(1); // the stale one still has data and is counted
  });

  it('MPE space not found, or MPE read failed: in no MPE rate or bar', () => {
    const a = model({ mpe: HALF });
    const nf = model({ mpeFound: false, mpe: [res('manquant'), res('manquant', 1, '02')] });
    const fl = model({ failedParts: ['mpe'], mpe: [res('manquant'), res('manquant', 1, '02')] });
    const o = aggregateOverview([a, nf, fl], ctxAll([a, nf, fl]), [], null);
    expect(o.importRate).toBe(0.5);
    expect(o.formations[0].levels[0].bar).toEqual({ tiers: 1, auto: 0, encours: 0, manquant: 1 });
    expect(o.formations[0].levels[0].students).toBe(3); // still counted as apprentices
  });

  it('reportsPublishedRate = published / (published + draft + missing), suivi failures excluded', () => {
    const rep = (states: Array<'published' | 'draft' | 'missing' | 'optional' | 'future'>) =>
      states.map((state, i) => ({ semester: i + 1, state, reportId: null, publishedAt: null }));
    const a = model({ reports: rep(['published', 'draft', 'missing', 'optional']) });
    const b = model({ reports: rep(['published', 'future']) });
    const c = model({ failedParts: ['suivi-company'], reports: rep(['missing', 'missing']) });
    const lost = model({ formationTitle: null, reports: rep(['missing']) });
    const ms = [a, b, c, lost];
    expect(aggregateOverview(ms, ctxAll(ms), [], null).reportsPublishedRate).toBe(2 / 4);
    expect(aggregateOverview([], [], [], null)).toMatchObject({ reportsPublishedRate: null, importRate: null, evalRate: null, students: 0 });
  });
});

describe('aggregateFormation', () => {
  const A = { id: 'room-ent-001', title: 'Entreprise Alpha' };
  const B = { id: 'room-ent-002', title: 'Entreprise Beta' };

  it('company rows: a two-company apprentice in both rows and once in students; none → « sans entreprise »', () => {
    const two = model({ mpe: HALF, startSource: 'plan', retired: ['cfc-1-03'] });
    const alpha = model({ mpe: [res('auto'), res('auto', 1, '02')], startSource: 'report' });
    const none = model({ mpe: HALF, startSource: 'default' });
    const ms = [two, alpha, none];
    const ctx = [ctxOf(two, { companies: [A, B] }), ctxOf(alpha, { companies: [A] }), ctxOf(none)];
    const f = aggregateFormation(ms, ctx, CUI, 'both', {});

    expect(f.students).toHaveLength(3);
    expect(f.students.find(s => s.personId === two.personId)!.company).toBe('Entreprise Alpha, Entreprise Beta');
    expect(f.students.find(s => s.personId === none.personId)!.company).toBe('sans entreprise');
    const rows = Object.fromEntries(f.companies.map(c => [c.title, c]));
    expect(f.companies.map(c => c.title)).toEqual(['Entreprise Alpha', 'Entreprise Beta', 'sans entreprise']);
    expect(rows['Entreprise Alpha']).toMatchObject({ id: A.id, students: 2, plan: 'partiel', retired: 1, importRate: 3 / 4, evalRate: 1 / 3 });
    expect(rows['Entreprise Beta']).toMatchObject({ id: B.id, students: 1, plan: 'oui', retired: 1 });
    expect(rows['sans entreprise']).toMatchObject({ id: null, students: 1, plan: 'non' });
    // Formation-wide: each apprentice once.
    expect(f.importRate).toBe(4 / 6);
    expect(f.startEnteredShare).toBeCloseTo(1 / 3);
    expect(f.companiesWithoutTiers).toEqual({ count: 0, total: 2 });
  });

  it('companiesWithoutTiers counts real companies whose bar has no tiers', () => {
    const a = model({ mpe: HALF });
    const b = model({ mpe: [res('auto'), res('encours', 1, '02')] });
    const c = model({ mpe: [res('manquant')] });
    const ctx = [ctxOf(a, { companies: [A] }), ctxOf(b, { companies: [B] }), ctxOf(c)];
    expect(aggregateFormation([a, b, c], ctx, CUI, 'both', {}).companiesWithoutTiers).toEqual({ count: 1, total: 2 });
  });

  it('plan is null when no apprentice of the company has a readable company Suivi', () => {
    const a = model({ failedParts: ['suivi-company'], startSource: 'default' });
    const f = aggregateFormation([a], [ctxOf(a, { companies: [A] })], CUI, 'cfc', {});
    expect(f.companies[0].plan).toBeNull();
  });

  it('companiesWithoutTiers leaves out a no-tiers company with an unknown apprentice; tiers > 0 stays in the total', () => {
    const evalUnknown = model({ identityKnown: false, mpe: [res('tiers')] });
    const mpeUnknown = model({ mpeFound: false });
    const knownNoTiers = model({ mpe: [res('auto')] });
    const withTiers = model({ mpe: [res('tiers')] });
    const alsoUnknown = model({ timelineOk: false, mpe: [res('encours')] });
    const C = { id: 'room-ent-003', title: 'Entreprise Gamma' };
    const D = { id: 'room-ent-004', title: 'Entreprise Delta' };
    const ms = [evalUnknown, mpeUnknown, knownNoTiers, withTiers, alsoUnknown];
    const ctx = [ctxOf(evalUnknown, { companies: [A] }), ctxOf(mpeUnknown, { companies: [B] }),
      ctxOf(knownNoTiers, { companies: [C] }), ctxOf(withTiers, { companies: [D] }), ctxOf(alsoUnknown, { companies: [D] })];
    // A (eval unknown, no tiers) and B (MPE unknown) are out; C counts; D has tiers → in the total only.
    expect(aggregateFormation(ms, ctx, CUI, 'cfc', {}).companiesWithoutTiers).toEqual({ count: 1, total: 2 });
  });

  it('the same company listed twice for an apprentice is counted once', () => {
    const a = model({ mpe: HALF });
    const f = aggregateFormation([a], [ctxOf(a, { companies: [A, A] })], CUI, 'cfc', {});
    expect(f.companies).toHaveLength(1);
    expect(f.companies[0]).toMatchObject({ id: A.id, students: 1, importRate: 0.5 });
  });

  it('company reports: published and due per company', () => {
    const a = model({ reports: [
      { semester: 1, state: 'published', reportId: 'rep-1', publishedAt: 1 },
      { semester: 2, state: 'draft', reportId: 'rep-2', publishedAt: null },
      { semester: 3, state: 'future', reportId: null, publishedAt: null },
    ] });
    const f = aggregateFormation([a], [ctxOf(a, { companies: [A] })], CUI, 'both', {});
    expect(f.companies[0]).toMatchObject({ reportsPublished: 1, reportsDue: 2 });
    expect(f.reportsBySemester).toEqual([
      { semester: 1, published: 1, draft: 0, missing: 0 },
      { semester: 2, published: 0, draft: 1, missing: 0 },
      { semester: 3, published: 0, draft: 0, missing: 0 },
    ]);
    expect(f.students[0].latestReport).toBe('draft');
  });

  it('mpe rows: concerned = expected set, sorted by semester then mandate; both → table level cfc', () => {
    const a = model({ mpe: [res('tiers', 2, '01'), res('auto', 1, '02'), res('encours', 1, '01')] });
    const b = model({ mpe: [res('manquant', 1, '01')] }); // 1-02 retired for b: absent from its expected set
    const afp = model({ level: 'afp', mpe: [res('tiers', 1, '01', { level: 'afp', title: 'AFP mandat' })] });
    const ms = [a, b, afp];
    const f = aggregateFormation(ms, ctxAll(ms), CUI, 'both', {});
    expect(f.tableLevel).toBe('cfc');
    expect(f.mpe).toEqual([
      { semester: 1, mandate: '01', title: 'Mandat S1·01', concerned: 2, imported: 1, assessable: 2, tiers: 0 },
      { semester: 1, mandate: '02', title: 'Mandat S1·02', concerned: 1, imported: 1, assessable: 1, tiers: 0 },
      { semester: 2, mandate: '01', title: 'Mandat S2·01', concerned: 1, imported: 1, assessable: 1, tiers: 1 },
    ]);
    expect(aggregateFormation(ms, ctxAll(ms), CUI, 'afp', {}).mpe)
      .toEqual([{ semester: 1, mandate: '01', title: 'AFP mandat', concerned: 1, imported: 1, assessable: 1, tiers: 1 }]);
  });

  it('mpc rows and CIE reports; an unreadable MPC or CIE Suivi is left out and flagged', () => {
    const mpc = (status: SlotStatus) => res(status, 1, '01', { kind: 'mpc', title: 'CIE mandat' });
    const a = model({ mpc: [mpc('tiers')], cieReports: { sent: 1, draft: 1 } });
    const nf = model({ mpcFound: false, mpc: [mpc('manquant')], cieReports: { sent: 2, draft: 0 } });
    const fl = model({ failedParts: ['mpc', 'suivi-cie'], mpc: [mpc('manquant')], cieReports: { sent: 5, draft: 5 } });
    const ms = [a, nf, fl];
    const f = aggregateFormation(ms, ctxAll(ms), CUI, 'cfc', {});
    expect(f.mpc).toEqual([{ semester: 1, mandate: '01', title: 'CIE mandat', concerned: 1, imported: 1, assessable: 1, tiers: 1 }]);
    expect(f.cieReports).toEqual({ sent: 3, draft: 1 });
    const flags = Object.fromEntries(f.students.map(s => [s.personId, s.flags]));
    expect(flags[nf.personId]).toEqual(['mandats CIE introuvables']);
    expect(flags[fl.personId]).toEqual(['mandats CIE illisibles', 'suivi CIE illisible']);
  });

  it('eval-unknown apprentices: in concerned/imported, not in assessable/tiers, bar null, flagged', () => {
    const a = model({ identityKnown: false, mpe: [res('tiers', 1, '01')] });
    const b = model({ failedParts: ['timeline'], mpe: [res('encours', 1, '01')] });
    const f = aggregateFormation([a, b], ctxAll([a, b]), CUI, 'cfc', {});
    expect(f.mpe).toEqual([{ semester: 1, mandate: '01', title: 'Mandat S1·01', concerned: 2, imported: 2, assessable: 0, tiers: 0 }]);
    expect(f.importRate).toBe(1);
    expect(f.evalRate).toBeNull();
    expect(f.students.map(s => s.bar)).toEqual([null, null]);
    expect(f.students.map(s => s.flags)).toEqual([['identité inconnue'], ['timeline illisible']]);
  });

  it('a failed ACL read is flagged « ACL illisible », not « identité inconnue »', () => {
    const a = model({ identityKnown: false, failedParts: ['acl'] });
    const b = model({ identityKnown: false });
    const f = aggregateFormation([a, b], ctxAll([a, b]), CUI, 'cfc', {});
    expect(f.students.map(s => s.flags)).toEqual([['ACL illisible'], ['identité inconnue']]);
  });

  it('MPE unknown and company Suivi unreadable: out of the MPE tables, report counts and plan column', () => {
    const ok = model({ mpe: HALF, startSource: 'plan', reports: [{ semester: 1, state: 'published', reportId: 'r', publishedAt: 1 }] });
    const nf = model({ mpeFound: false, mpe: [res('manquant')] });
    const fl = model({ failedParts: ['mpe', 'suivi-company'], startSource: 'default',
      mpe: [res('manquant')], reports: [{ semester: 1, state: 'missing', reportId: null, publishedAt: null }] });
    const ms = [ok, nf, fl];
    const f = aggregateFormation(ms, ms.map(m => ctxOf(m, { companies: [A] })), CUI, 'cfc', {});
    expect(f.mpe.map(r => r.concerned)).toEqual([1, 1]);
    expect(f.importRate).toBe(0.5);
    expect(f.bySemester).toEqual([{ semester: 2, students: 3, bar: { tiers: 1, auto: 0, encours: 0, manquant: 1 } }]);
    expect(f.reportsBySemester).toEqual([{ semester: 1, published: 1, draft: 0, missing: 0 }]);
    // nf has startSource 'plan' (fixture default); fl's Suivi is unreadable, so its 'default' is unknown.
    expect(f.companies[0]).toMatchObject({ students: 3, plan: 'oui', reportsPublished: 1, reportsDue: 1 });
    const s = Object.fromEntries(f.students.map(x => [x.personId, x]));
    expect(s[nf.personId]).toMatchObject({ bar: null, flags: ['mandats entreprise introuvables'] });
    expect(s[fl.personId]).toMatchObject({ bar: null, latestReport: null, flags: ['mandats entreprise illisibles', 'suivi entreprise illisible'] });
  });

  it('level cfc keeps only CFC apprentices; unread and other-formation models are left out', () => {
    const c = model();
    const a = model({ level: 'afp' });
    const o = model({ level: 'other' });
    const bad = model({ readOk: false });
    const res2 = model({ formationTitle: 'Restauration' });
    const ms = [c, a, o, bad, res2];
    const ctx = [...ctxAll([c, a, o, bad]), ctxOf(res2, { icon: RES })];
    expect(aggregateFormation(ms, ctx, CUI, 'cfc', {}).students.map(s => s.personId)).toEqual([c.personId]);
    const both = aggregateFormation(ms, ctx, CUI, 'both', {});
    expect(both).toMatchObject({ key: CUI, title: 'Cuisine', level: 'both' });
    expect(both.students.map(s => s.personId).sort()).toEqual([c.personId, a.personId, o.personId].sort());
    expect(both.students.find(s => s.personId === o.personId)!.flags).toEqual(['autre niveau']);
  });

  it('companyId, classId and semester filters narrow students and every table', () => {
    const s1 = model({ currentSemester: 1, mpe: [res('tiers', 1, '01')], reports: [{ semester: 1, state: 'draft', reportId: 'r1', publishedAt: null }] });
    const s2 = model({ currentSemester: 2, mpe: [res('manquant', 1, '01'), res('manquant', 2, '01')], cieReports: { sent: 1, draft: 0 } });
    const s3 = model({ currentSemester: 2, mpe: [res('auto', 1, '01')] });
    const ms = [s1, s2, s3];
    const ctx = [ctxOf(s1, { companies: [A], classIds: ['room-cls-001'] }), ctxOf(s2, { companies: [A, B] }), ctxOf(s3, { companies: [B], classIds: ['room-cls-001'] })];

    const byCo = aggregateFormation(ms, ctx, CUI, 'cfc', { companyId: A.id });
    expect(byCo.students.map(s => s.personId)).toEqual([s1.personId, s2.personId]);
    expect(byCo.companies.map(c => c.id)).toEqual([A.id]);
    expect(byCo.mpe.map(r => r.concerned)).toEqual([2, 1]);
    expect(byCo.cieReports).toEqual({ sent: 1, draft: 0 });

    const byClass = aggregateFormation(ms, ctx, CUI, 'cfc', { classId: 'room-cls-001' });
    expect(byClass.students.map(s => s.personId)).toEqual([s1.personId, s3.personId]);

    const bySem = aggregateFormation(ms, ctx, CUI, 'cfc', { semester: 2 });
    expect(bySem.students.map(s => s.personId)).toEqual([s2.personId, s3.personId]);
    expect(bySem.bySemester.map(g => g.semester)).toEqual([2]);
    expect(bySem.mpe.map(r => [r.semester, r.concerned])).toEqual([[1, 2], [2, 1]]);
    expect(bySem.reportsBySemester).toEqual([]);
    expect(bySem.companies.map(c => c.title)).toEqual(['Entreprise Alpha', 'Entreprise Beta']);
  });

  it('bySemester groups by current semester, sorted', () => {
    const a = model({ currentSemester: 3, mpe: [res('tiers')] });
    const b = model({ currentSemester: 1, mpe: [res('manquant')] });
    const c = model({ currentSemester: 3, mpe: [res('encours')] });
    const f = aggregateFormation([a, b, c], ctxAll([a, b, c]), CUI, 'cfc', {});
    expect(f.bySemester).toEqual([
      { semester: 1, students: 1, bar: { tiers: 0, auto: 0, encours: 0, manquant: 1 } },
      { semester: 3, students: 2, bar: { tiers: 1, auto: 0, encours: 1, manquant: 0 } },
    ]);
  });

  it('an unknown key gives an empty detail', () => {
    const f = aggregateFormation([model()], ctxAll([model()]), 'icon-none', 'afp', {});
    expect(f).toMatchObject({ key: 'icon-none', title: 'icon-none', tableLevel: 'afp', students: [], companies: [],
      importRate: null, evalRate: null, startEnteredShare: null, companiesWithoutTiers: { count: 0, total: 0 } });
  });
});

describe('splitByReadState', () => {
  const people = [
    { personId: 'prof-101', name: 'Apprenti A' },
    { personId: 'prof-102', name: 'Apprenti B' },
    { personId: 'prof-103', name: 'Apprenti C' },
    { personId: 'prof-104', name: 'Apprenti D' },
  ];
  const states = new Map([
    ['prof-101', { readOk: true, stale: false, error: null }],
    ['prof-102', { readOk: true, stale: true, error: 'http 503' }],
    ['prof-103', { readOk: false, stale: false, error: 'http 404' }],
  ]);
  it('puts every apprentice in exactly one of read or failed; stale ones are read and listed as stale', () => {
    const s = splitByReadState(people, states);
    expect(s.read).toEqual(['prof-101', 'prof-102']);
    expect(s.stale).toEqual([{ personId: 'prof-102', name: 'Apprenti B', error: 'http 503' }]);
    expect(s.failed).toEqual([
      { personId: 'prof-103', name: 'Apprenti C', error: 'http 404' },
      { personId: 'prof-104', name: 'Apprenti D', error: NEVER_READ },
    ]);
    expect(s.read.length + s.failed.length).toBe(people.length);
  });
});

describe('markStale', () => {
  it('appends the stale flag to the stale apprentices only, without mutating the input', () => {
    const a = model();
    const b = model();
    const f = aggregateFormation([a, b], ctxAll([a, b]), CUI, 'both', {});
    const out = markStale(f, new Set([b.personId]));
    expect(out.students.find(s => s.personId === b.personId)!.flags).toContain(STALE_FLAG);
    expect(out.students.find(s => s.personId === a.personId)!.flags).not.toContain(STALE_FLAG);
    expect(f.students.every(s => !s.flags.includes(STALE_FLAG))).toBe(true);
  });
});
