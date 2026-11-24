import { describe, it, expect } from 'vitest';
import type { Reference, StudentRaw } from '../../../shared/formation-types';
import { studentToRows, studentFromRows, referenceToRows, referenceFromRows } from './rows';

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
      reports: [], plan: { startMs: 1700000000000, retiredSlots: [] }, failedParts: [], emptyListings: 0,
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
