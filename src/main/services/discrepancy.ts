import { UnmatchedClassId } from './tag-prune';

export type DiscrepancyType = 'orphan-tag' | 'missing-tag' | 'unresolved' | 'unknown';

export interface Discrepancy {
  type: DiscrepancyType;
  roomId: string;
  roomTitle: string | null;
  role: string;
  personId?: string;
  email?: string | null;
  uid?: string;
  groupId?: string;
  displayName?: string | null;
  note?: string;
}

export interface DiscrepancyInput {
  rooms: Array<{ id: string; title: string; classId: string | null }>;
  persons: Array<{ id: string; displayName: string; email: string | null; tags: string[] }>;
  assignments: Array<{ personId: string; roomId: string; role: string }>;
  issues: Array<{
    type: 'unresolved' | 'unknown';
    roomId: string;
    role: string;
    uid: string;
    groupId: string;
    email: string | null;
    displayName: string | null;
  }>;
}

// Semantic roles that can appear in a hz-config-class-<classId>-<role> breadcrumb tag.
const VALID_ROLES = ['student', 'companymentor', 'schoolteacher', 'courseteacher', 'stateadvisor', 'guardian'];

// Parse a breadcrumb tag hz-config-class-<classId>-<role> by splitting on the LAST hyphen,
// mirroring parseAssignmentTag in sync.service.ts, which syncPersonRoomAssignments still calls.
export function parseClassTag(tag: string): { classId: string; role: string } | null {
  const prefix = 'hz-config-class-';
  if (!tag.startsWith(prefix)) return null;
  const remainder = tag.substring(prefix.length);
  const lastHyphen = remainder.lastIndexOf('-');
  if (lastHyphen === -1) return null;
  const classId = remainder.substring(0, lastHyphen);
  const role = remainder.substring(lastHyphen + 1);
  if (!classId || !VALID_ROLES.includes(role)) return null;
  return { classId, role };
}

const key = (personId: string, roomId: string, role: string) => JSON.stringify([personId, roomId, role]);

export function computeDiscrepancies(input: DiscrepancyInput): Discrepancy[] {
  const classIdToRoomId = new Map<string, string>();
  const roomIdToTitle = new Map<string, string>();
  for (const r of input.rooms) {
    roomIdToTitle.set(r.id, r.title);
    if (r.classId) classIdToRoomId.set(r.classId, r.id);
  }

  const personsById = new Map<string, { id: string; displayName: string; email: string | null }>();
  for (const p of input.persons) personsById.set(p.id, p);

  const out: Discrepancy[] = [];
  const tagKeys = new Set<string>();

  // Tag-derived (person, room, role) triples; unmapped class ids are reported, not dropped.
  for (const p of input.persons) {
    for (const tag of p.tags) {
      const parsed = parseClassTag(tag);
      if (!parsed) continue;
      const roomId = classIdToRoomId.get(parsed.classId);
      if (!roomId) {
        out.push({
          type: 'orphan-tag',
          roomId: parsed.classId,
          roomTitle: null,
          role: parsed.role,
          personId: p.id,
          email: p.email,
          displayName: p.displayName,
          note: 'tag references a class not in local rooms',
        });
        continue;
      }
      tagKeys.add(key(p.id, roomId, parsed.role));
    }
  }

  const asgKeys = new Set<string>();
  for (const a of input.assignments) asgKeys.add(key(a.personId, a.roomId, a.role));

  // orphan-tag and missing-tag share the same person/room/role projection; they
  // differ only in the type and which key-set drives them.
  const emit = (type: DiscrepancyType, k: string): Discrepancy => {
    const [personId, roomId, role] = JSON.parse(k) as [string, string, string];
    const p = personsById.get(personId);
    return {
      type,
      roomId,
      roomTitle: roomIdToTitle.get(roomId) ?? null,
      role,
      personId,
      email: p?.email ?? null,
      displayName: p?.displayName ?? null,
    };
  };

  // orphan-tag: has the breadcrumb but is NOT a group member (tag not in assignments)
  for (const k of tagKeys) {
    if (!asgKeys.has(k)) out.push(emit('orphan-tag', k));
  }

  // missing-tag: IS a group member but lacks the breadcrumb (assignment not in tags) — healable in S3
  for (const k of asgKeys) {
    if (!tagKeys.has(k)) out.push(emit('missing-tag', k));
  }

  // unresolved / unknown: already computed by S1 — carried through from membership_issues
  for (const i of input.issues) {
    out.push({
      type: i.type,
      roomId: i.roomId,
      roomTitle: roomIdToTitle.get(i.roomId) ?? null,
      role: i.role,
      uid: i.uid,
      groupId: i.groupId,
      email: i.email,
      displayName: i.displayName,
    });
  }

  // Stable ordering: deterministic tests + predictable UI.
  const typeOrder: Record<DiscrepancyType, number> = {
    'orphan-tag': 0,
    'missing-tag': 1,
    unresolved: 2,
    unknown: 3,
  };
  out.sort(
    (a, b) =>
      typeOrder[a.type] - typeOrder[b.type] ||
      (a.roomTitle || a.roomId).localeCompare(b.roomTitle || b.roomId) ||
      a.role.localeCompare(b.role) ||
      (a.displayName || a.email || a.personId || a.uid || '').localeCompare(
        b.displayName || b.email || b.personId || b.uid || '',
      ),
  );

  return out;
}

/**
 * Every distinct class id referenced by a breadcrumb tag that maps to no local room, with the
 * tags and the people carrying them.
 *
 * This is the SINGLE definition of "needs probing" (S7). It reads the same DiscrepancyInput the
 * report renders and applies the same rule computeDiscrepancies uses for its orphan-tag bucket
 * A, so the probe set can never drift from what the page shows. Tags parseClassTag rejects yield
 * no class id and are excluded here exactly as they are excluded there.
 *
 * Holders carry the raw tag strings as read, never strings rebuilt from the parse, so what a
 * prune deletes is provably what was parsed.
 */
export function collectUnmatchedClassIds(input: DiscrepancyInput): UnmatchedClassId[] {
  const knownClassIds = new Set<string>();
  for (const r of input.rooms) if (r.classId) knownClassIds.add(r.classId);

  // classId -> personId -> that person's tags for it
  const byClassId = new Map<string, Map<string, string[]>>();
  for (const p of input.persons) {
    for (const tag of p.tags) {
      const parsed = parseClassTag(tag);
      if (!parsed) continue;
      if (knownClassIds.has(parsed.classId)) continue;

      let holders = byClassId.get(parsed.classId);
      if (!holders) {
        holders = new Map<string, string[]>();
        byClassId.set(parsed.classId, holders);
      }
      const existing = holders.get(p.id);
      if (existing) existing.push(tag);
      else holders.set(p.id, [tag]);
    }
  }

  const out: UnmatchedClassId[] = [];
  for (const [classId, holderMap] of byClassId) {
    const holders = [...holderMap].map(([personId, tags]) => ({ personId, tags }));
    out.push({
      classId,
      tagCount: holders.reduce((n, h) => n + h.tags.length, 0),
      personCount: holders.length,
      holders,
    });
  }

  // Heaviest first: the modal reads better when the id carrying most of the weight leads.
  out.sort((a, b) => b.tagCount - a.tagCount || a.classId.localeCompare(b.classId));
  return out;
}
