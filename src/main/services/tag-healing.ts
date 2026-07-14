import { Discrepancy, parseClassTag } from './discrepancy';

export interface HealPlanItem {
  personId: string;
  roomId: string;
  roomTitle: string | null;
  role: string;
  tag: string; // hz-config-class-<classId>-<role>
  displayName: string | null;
  email: string | null;
}

export interface HealSkip {
  personId: string;
  roomId: string;
  role: string;
  reason: string;
}

export interface HealPlan {
  items: HealPlanItem[];
  skipped: HealSkip[];
}

// Build hz-config-class-<classId>-<role>. Returns null when classId/role are empty
// or when the result does not parse back to the same (classId, role) via parseClassTag
// — which also rejects any role outside the valid breadcrumb set (parseClassTag validates it).
export function buildClassTag(classId: string, role: string): string | null {
  if (!classId || !role) return null;
  const tag = `hz-config-class-${classId}-${role}`;
  const parsed = parseClassTag(tag);
  if (!parsed || parsed.classId !== classId || parsed.role !== role) return null;
  return tag;
}

// Filter `discrepancies` to type 'missing-tag' and map each to a HealPlanItem.
// A missing-tag whose room is absent from `roomIdToClassId`, or whose tag fails to
// build, is dropped into `skipped` (never written). The 'missing-tag' filter guarantees
// the plan matches exactly what the S2 report shows as healable.
export function planTagHeals(
  discrepancies: Discrepancy[],
  roomIdToClassId: Map<string, string>,
): HealPlan {
  const items: HealPlanItem[] = [];
  const skipped: HealSkip[] = [];

  for (const d of discrepancies) {
    if (d.type !== 'missing-tag') continue;
    const personId = d.personId ?? '';
    const classId = roomIdToClassId.get(d.roomId);
    if (!classId) {
      skipped.push({ personId, roomId: d.roomId, role: d.role, reason: 'no class_id for room' });
      continue;
    }
    const tag = buildClassTag(classId, d.role);
    if (!tag) {
      skipped.push({ personId, roomId: d.roomId, role: d.role, reason: 'tag failed to build/round-trip' });
      continue;
    }
    items.push({
      personId,
      roomId: d.roomId,
      roomTitle: d.roomTitle,
      role: d.role,
      tag,
      displayName: d.displayName ?? null,
      email: d.email ?? null,
    });
  }

  return { items, skipped };
}
