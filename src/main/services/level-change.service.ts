// Level change (CFC <-> AFP) — IO LAYER. Wires the pure core (level-change.ts) to the Hazu API and
// local SQLite. No planning logic lives here. Spec: docs/specs/2026-11-26-level-change-design.md
// Logs carry the profile id only — never a name or an e-mail address.

import axios from 'axios';
import { getDb } from '../database';
import {
  sendApiRequestReadChecked,
  sendApiRequestListChecked,
  sendApiRequestAddTagsChecked,
  sendApiRequestRemoveTagsChecked,
  sendApiRequestUpdateChecked,
} from './hazu-api/api';
import { normalizeRow } from './formation/parse';
import { setting, toError, toFailure } from './room-archive.service';
import type { ApiFailure } from './room-archive';
import { getSyncProgress } from './sync.service';
import { withArchiveLock } from './archive-lock';
import {
  LEVEL_COLORS,
  LcNode,
  LevelChangeBaseDeps,
  LevelChangeDeps,
  isTemplateNode,
  stripTitle,
  TEMPLATE_REFUSAL,
  levelOfColor,
  otherLevel,
  pickV3,
  runLevelChange,
  studentTemplates,
  templatesFor,
} from './level-change';
import type {
  Level,
  LevelChangeCandidates,
  LevelChangeOutcome,
  LevelChangeStudent,
} from '../../shared/level-change-types';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function toLcNode(raw: unknown): LcNode | null {
  const row = normalizeRow(raw);
  return row
    ? {
        id: row.id,
        parentId: row.parentId,
        title: row.title,
        description: row.description,
        tags: row.tags,
        icon: row.icon,
        color: row.color,
      }
    : null;
}

function buildDeps(): LevelChangeBaseDeps {
  return {
    // null ONLY on a 404; anything else throws.
    read: async (id) => {
      try {
        return toLcNode(await sendApiRequestReadChecked(id));
      } catch (e) {
        if (axios.isAxiosError(e) && e.response?.status === 404) return null;
        throw toFailure(e);
      }
    },
    // The parent echo and rows normalizeRow rejects are dropped.
    list: async (parentId) => {
      try {
        const out: LcNode[] = [];
        for (const raw of await sendApiRequestListChecked(parentId)) {
          const n = toLcNode(raw);
          if (n && n.id !== parentId) out.push(n);
        }
        return out;
      } catch (e) {
        throw toFailure(e);
      }
    },
    updateDescription: async (id, html) => {
      try {
        await sendApiRequestUpdateChecked(id, { description: html });
      } catch (e) {
        throw toFailure(e);
      }
    },
    updateColor: async (id, hex) => {
      try {
        await sendApiRequestUpdateChecked(id, { color: hex });
      } catch (e) {
        throw toFailure(e);
      }
    },
    addTags: async (id, tags) => {
      try {
        await sendApiRequestAddTagsChecked(id, tags);
      } catch (e) {
        throw toFailure(e);
      }
    },
    removeTags: async (id, tags) => {
      // The checked call returns its failure instead of throwing.
      const r = await sendApiRequestRemoveTagsChecked(id, tags);
      if (!r.ok) {
        const failure: ApiFailure = {
          status: r.status,
          networkOrTimeout: r.networkOrTimeout,
          message: r.error ?? 'échec de la suppression des étiquettes',
        };
        throw failure;
      }
    },
    sleep,
  };
}

/** The target must be a synced student; a template or any other node is never touched. */
function isLocalStudent(personId: string): boolean {
  return !!getDb().prepare("SELECT id FROM persons WHERE id = ? AND person_type = 'student'").get(personId);
}

function refusal(dryRun: boolean, error: string): LevelChangeOutcome {
  return { success: false, dryRun, plan: null, applied: 0, remaining: [], ignored: [], error };
}

function templateRootId(): string {
  const id = setting('template_id');
  if (!id) throw new Error("modèles introuvables — synchronisez d'abord");
  return id;
}

// ---------------------------------------------------------------------------------------------
// Local read

export function listLevelChangeStudents(): LevelChangeStudent[] {
  const rows = getDb()
    .prepare(
      `SELECT id, display_name AS displayName, icon, color
         FROM persons WHERE person_type = 'student' ORDER BY display_name`,
    )
    .all() as Array<{ id: string; displayName: string; icon: string | null; color: string | null }>;
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    icon: r.icon || null,
    color: r.color || null,
    level: levelOfColor(r.color),
  }));
}

// TODO(Task 5): the real copy/ACL/remove calls. Until then every one of them refuses, so a run that
// reaches a copy or a delete fails it (the live read then decides: nothing confirmed, colour withheld).
// Today the service sends no decisions, so an execute is refused before any write anyway.
function pendingActionDeps(): Omit<LevelChangeDeps, keyof LevelChangeBaseDeps> {
  const refuse = async (): Promise<never> => {
    throw { networkOrTimeout: false, message: 'copie / suppression pas encore branchées' };
  };
  return { readFull: refuse, listFull: refuse, create: refuse, remove: refuse, acl: refuse, setRole: refuse, removeFromAcl: refuse };
}

// ---------------------------------------------------------------------------------------------
// Candidates (live)

export async function levelChangeCandidates(personId: string): Promise<LevelChangeCandidates> {
  try {
    if (!isLocalStudent(personId)) throw new Error('profil introuvable');
    const rootId = templateRootId();
    const deps = buildDeps();
    const profile = await deps.read(personId);
    if (!profile) throw new Error('profil introuvable');
    if (isTemplateNode(profile, rootId)) throw new Error(TEMPLATE_REFUSAL);
    const currentLevel = levelOfColor(profile.color);
    if (!currentLevel) throw new Error('niveau ni CFC ni AFP');
    const toLevel = otherLevel(currentLevel);
    const matches = templatesFor(studentTemplates(rootId, await deps.list(rootId)), profile.icon, toLevel);
    return {
      currentLevel,
      toLevel,
      templates: matches.map((t) => ({ id: t.id, title: stripTitle(t.title), icon: t.icon, color: t.color })),
      preselectedId: pickV3(matches),
    };
  } catch (e) {
    throw toError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Plan / execute

async function run(
  personId: string,
  toLevel: Level,
  targetTemplateId: string,
  dryRun: boolean,
): Promise<LevelChangeOutcome> {
  if (!isLocalStudent(personId)) return refusal(dryRun, 'profil introuvable');
  try {
    return await runLevelChange(
      // TODO(Task 5): role groups from distribution_groups, the resolved student id, the decisions
      { profileId: personId, toLevel, targetTemplateId, templateRootId: templateRootId(), dryRun, roleGroups: new Map(), studentId: null },
      { ...buildDeps(), ...pendingActionDeps() },
    );
  } catch (e) {
    return refusal(dryRun, toFailure(e).message);
  }
}

export async function planLevelChange(
  personId: string,
  toLevel: Level,
  targetTemplateId: string,
): Promise<LevelChangeOutcome> {
  return run(personId, toLevel, targetTemplateId, true);
}

export async function executeLevelChange(
  personId: string,
  toLevel: Level,
  targetTemplateId: string,
): Promise<LevelChangeOutcome> {
  if (!isLocalStudent(personId)) return refusal(false, 'profil introuvable');
  if (getSyncProgress().status === 'syncing') {
    return refusal(false, 'synchronisation en cours — réessayez ensuite');
  }
  const outcome = await withArchiveLock(() => run(personId, toLevel, targetTemplateId, false));

  // Local reconcile, in its own try/catch: a local failure cannot flip an API success.
  if (outcome.success && getSyncProgress().status !== 'syncing') {
    try {
      getDb().prepare('UPDATE persons SET color = ? WHERE id = ?').run(LEVEL_COLORS[toLevel], personId);
    } catch (e) {
      console.error(`[level-change] profile=${personId} local reconcile failed:`, toError(e).message);
    }
  }
  console.log(
    `[level-change] profile=${personId} to=${toLevel} success=${outcome.success} ` +
      `applied=${outcome.applied} remaining=${outcome.remaining.length}`,
  );
  return outcome;
}
