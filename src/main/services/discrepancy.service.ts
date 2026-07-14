import { getDb } from '../database';
import { computeDiscrepancies, Discrepancy } from './discrepancy';

function safeParseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function getDiscrepancies(): Discrepancy[] {
  const db = getDb();

  const rooms = db
    .prepare('SELECT id, title, class_id AS classId FROM rooms')
    .all() as Array<{ id: string; title: string; classId: string | null }>;

  const personRows = db
    .prepare('SELECT id, display_name AS displayName, email, tags FROM persons')
    .all() as Array<{ id: string; displayName: string; email: string | null; tags: string | null }>;
  const persons = personRows.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    email: p.email,
    tags: safeParseTags(p.tags),
  }));

  const assignments = db
    .prepare('SELECT person_id AS personId, room_id AS roomId, role FROM person_room_assignments')
    .all() as Array<{ personId: string; roomId: string; role: string }>;

  const issues = db
    .prepare('SELECT type, room_id AS roomId, role, uid, email, display_name AS displayName FROM membership_issues')
    .all() as Array<{
      type: 'unresolved' | 'unknown';
      roomId: string;
      role: string;
      uid: string;
      email: string | null;
      displayName: string | null;
    }>;

  return computeDiscrepancies({ rooms, persons, assignments, issues });
}
