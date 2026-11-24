import { describe, it, expect } from 'vitest';
import type { Reference, StudentRaw } from '../../../shared/formation-types';
import { studentToRows, studentFromRows, referenceToRows, referenceFromRows, keepFailedParts } from './rows';

// Invented fixture values only.
function fullRaw(): StudentRaw {
  return {
    personId: 'prof-001', ok: true, error: 'http 503', profileCreated: 1690000000000,
    userIdTag: 'kid@example.invalid', selfUid: 'uid-001', timelineOk: false,
    facts: [
      { copyId: 'copy-1', authorId: 'uid-009', authorName: 'Formateur', points: 3, feedback: 'bien', dateMs: 1700000000000 },
      { copyId: 'copy-2', authorId: null, authorName: '', points: 0, feedback: null, dateMs: 1700000000001 },
    ],
    mpe: { found: true, copies: [
      { kind: 'mpe', id: 'copy-2', semester: 2, mandate: '03', level: 'cfc', profession: 'cui', title: 'B', dateCreated: 2 },
      { kind: 'mpe', id: 'copy-1', semester: null, mandate: null, level: null, profession: null, title: 'A', dateCreated: 1 },
    ] },
    mpc: { found: false, copies: [] },
    reports: [
      { kind: 'company', id: 'rep-1', semester: 1, published: true, publishedAt: 1700000000002, courseId: null, dateCreated: 5 },
      { kind: 'cie', id: 'rep-2', semester: null, published: false, publishedAt: null, courseId: 'course-9', dateCreated: 6 },
    ],
    plan: { startMs: null, retiredSlots: ['cfc-3-12', 'cfc-1-01'] },
    failedParts: ['timeline', 'acl'],
    emptyListings: 2,
    skippedSubtrees: 3,
  };
}

describe('student rows', () => {
  it('round-trips a StudentRaw exactly, order included', () => {
    const raw = fullRaw();
    expect(studentFromRows(studentToRows(raw, 42))).toEqual(raw);
  });
  it('round-trips an unread profile', () => {
    const raw: StudentRaw = {
      personId: 'prof-002', ok: false, error: 'http 404', profileCreated: null, userIdTag: null, selfUid: null,
      timelineOk: false, facts: [], mpe: { found: false, copies: [] }, mpc: { found: true, copies: [] },
      reports: [], plan: { startMs: 1700000000000, retiredSlots: [] }, failedParts: [], emptyListings: 0, skippedSubtrees: 0,
    };
    expect(studentFromRows(studentToRows(raw, 42))).toEqual(raw);
  });
  it('stores booleans as 0/1 and the sync time, never stale on a fresh write', () => {
    const r = studentToRows(fullRaw(), 42);
    expect(r.student).toMatchObject({ read_ok: 1, stale: 0, timeline_ok: 0, mpe_found: 1, mpc_found: 0, synced_at: 42 });
    expect(r.reports.map(x => x.published)).toEqual([1, 0]);
  });
  it('reorders child rows by ord when restoring', () => {
    const r = studentToRows(fullRaw(), 42);
    r.copies.reverse();
    expect(studentFromRows(r).mpe.copies.map(c => c.id)).toEqual(['copy-2', 'copy-1']);
  });
});

describe('reference rows', () => {
  it('round-trips a Reference exactly', () => {
    const ref: Reference = {
      slots: [
        { kind: 'mpe', profession: 'cui', level: 'cfc', semester: 1, mandate: '01', title: 'Mandat', id: 'master-1' },
        { kind: 'mpc', profession: 'dhi', level: 'afp', semester: 2, mandate: '03', title: 'Cours', id: 'master-2' },
      ],
      professionsByIcon: { 'icon-cui': { title: 'Cuisine', order: 2 } },
      levelsByColor: { '#abcdef': 'CFC' },
      catalogueIcons: { 'icon-cui': 'cui' },
    };
    const r = referenceToRows(ref);
    expect(referenceFromRows(r.catalogue, r.reference)).toEqual(ref);
  });
  it('restores an empty reference when nothing is stored', () => {
    expect(referenceFromRows([], [])).toEqual({ slots: [], professionsByIcon: {}, levelsByColor: {}, catalogueIcons: {} });
  });
});

describe('keepFailedParts', () => {
  // The previous successful read, then a fresh read that is ok but lost some parts.
  const prev = (): StudentRaw => fullRaw();
  const fresh = (failedParts: StudentRaw['failedParts']): StudentRaw => ({
    ...fullRaw(), error: 'http 503', timelineOk: !failedParts.includes('timeline'), failedParts,
    facts: [], selfUid: null,
    mpe: { found: true, copies: failedParts.includes('mpe') ? [] : [{ kind: 'mpe', id: 'copy-new', semester: 1, mandate: '01', level: 'cfc', profession: 'cui', title: 'N', dateCreated: 9 }] },
    mpc: { found: true, copies: [] },
    reports: [{ kind: 'cie', id: 'rep-new', semester: 1, published: true, publishedAt: 1, courseId: 'course-1', dateCreated: 9 }],
    plan: { startMs: null, retiredSlots: [] },
  });
  const merged = (parts: StudentRaw['failedParts'], previous: StudentRaw | null = prev()) =>
    studentFromRows(keepFailedParts(studentToRows(fresh(parts), 50), previous ? studentToRows(previous, 40) : null));

  it('keeps the previous facts when the timeline failed, and the part stays flagged', () => {
    const m = merged(['timeline']);
    expect(m.facts).toEqual(prev().facts);
    expect(m.failedParts).toEqual(['timeline']);
    expect(m.timelineOk).toBe(false);
    expect(m.mpe.copies.map(c => c.id)).toEqual(['copy-new']); // a part read OK is replaced
  });
  it('keeps only the failed kind of copies', () => {
    const m = merged(['mpe']);
    expect(m.mpe.copies).toEqual(prev().mpe.copies);
    expect(m.mpc.copies).toEqual([]);
  });
  it('keeps company reports and the plan when the company Suivi failed, but takes fresh CIE reports', () => {
    const m = merged(['suivi-company']);
    expect(m.reports.map(r => r.id)).toEqual(['rep-1', 'rep-new']);
    expect(m.plan).toEqual(prev().plan);
  });
  it('keeps CIE reports when the CIE Suivi failed, taking nothing fresh for them', () => {
    const m = merged(['suivi-cie']);
    expect(m.reports.map(r => r.id)).toEqual(['rep-2']);
    expect(m.plan).toEqual({ startMs: null, retiredSlots: [] });
  });
  it('keeps the previous self uid when the ACL failed', () => {
    expect(merged(['acl']).selfUid).toBe('uid-001');
    expect(merged([]).selfUid).toBeNull();
  });
  it('writes the fresh read unchanged without previous rows, or when they came from a failed read', () => {
    const f = studentToRows(fresh(['timeline']), 50);
    expect(keepFailedParts(f, null)).toEqual(f);
    const failedPrev = studentToRows({ ...prev(), ok: false }, 40);
    expect(keepFailedParts(f, failedPrev)).toEqual(f);
  });
});
