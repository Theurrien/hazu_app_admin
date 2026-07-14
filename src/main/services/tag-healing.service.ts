import { getDb } from '../database';
import { computeDiscrepancies } from './discrepancy';
import { loadDiscrepancyInput, safeParseTags } from './discrepancy.service';
import { planTagHeals, HealPlan } from './tag-healing';
import { sendApiRequestAddTagsChecked } from './hazu-api/api';

// Reuses the S2 loader + computeDiscrepancies, then filters/maps to a heal plan.
// Because it consumes the exact same inputs as getDiscrepancies, the plan can never
// drift from what the Discrepancies report displays.
export function getTagHealPlan(): HealPlan {
  const input = loadDiscrepancyInput();
  const discrepancies = computeDiscrepancies(input);
  const roomIdToClassId = new Map<string, string>();
  for (const r of input.rooms) {
    if (r.classId) roomIdToClassId.set(r.id, r.classId);
  }
  return planTagHeals(discrepancies, roomIdToClassId);
}

// Adds `tag` to the person's Hazu profile (add-only). On a successful POST, patches
// local persons.tags (dedup) so the report clears before the next sync. A local-patch
// failure is non-fatal — the next Dashboard sync reconciles from Hazu (ground truth).
export async function healPersonTag(
  personId: string,
  tag: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await sendApiRequestAddTagsChecked(personId, [tag]);
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  try {
    const db = getDb();
    const row = db.prepare('SELECT tags FROM persons WHERE id = ?').get(personId) as
      | { tags: string | null }
      | undefined;
    const current = safeParseTags(row?.tags ?? null);
    if (!current.includes(tag)) {
      current.push(tag);
      db.prepare('UPDATE persons SET tags = ? WHERE id = ?').run(JSON.stringify(current), personId);
    }
  } catch (error) {
    console.error('[tag-healing] local tags patch failed for', personId, error);
  }

  return { success: true };
}
