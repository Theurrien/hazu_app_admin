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
  sendApiRequestCreateFullChecked,
  sendApiRequestRemoveChecked,
  sendApiRequestGetAclInfoChecked,
  sendApiRequestSetAclRoleChecked,
  sendApiRequestDetachGroupChecked,
  sendApiRequestListStrictChecked,
} from './hazu-api/api';
import { normalizeRow } from './formation/parse';
import { aclEntries, copiesRefusal, studentIdFromAcl, studentLookup, toAclRows, toCopyNode } from './level-change-wire';
import type { CopyNode } from './level-change-copy';
import type { LevelChangeDecisions } from '../../shared/level-change-decisions';
import { setting, toError, toFailure, wrap } from './room-archive.service';
import { withRetry, type ApiFailure } from './room-archive';
import { getSyncProgress } from './sync.service';
import { withArchiveLock } from './archive-lock';
import {
  LEVEL_COLORS,
  LcNode,
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
  StudentUnknown,
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

/** A null-only-on-404 read through `map`. */
async function readMapped<T>(id: string, map: (raw: unknown) => T | null): Promise<T | null> {
  try {
    return map(await sendApiRequestReadChecked(id));
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) return null;
    throw toFailure(e);
  }
}

/**
 * A listing through `map`; the parent echo and rows the mapper rejects are dropped. `strict`: an
 * unexpected response shape throws instead of reading as empty (the copy walk and its checks).
 */
async function listMapped<T extends { id: string }>(
  parentId: string, map: (raw: unknown) => T | null, strict = false,
): Promise<T[]> {
  const out: T[] = [];
  const listCall = strict ? sendApiRequestListStrictChecked : sendApiRequestListChecked;
  for (const raw of await wrap(() => listCall(parentId))) {
    const n = map(raw);
    if (n && n.id !== parentId) out.push(n);
  }
  return out;
}

/** Never a PUT / DELETE /acl without a principal: a non-retryable failure instead. */
function requirePrincipal(principalId: string): void {
  if (!principalId || !principalId.trim()) {
    const failure: ApiFailure = { networkOrTimeout: false, message: 'principal ACL vide — refusé' };
    throw failure;
  }
}

function buildDeps(): LevelChangeDeps {
  // Creates are authored by the app's admin account (as the room archive's creates are).
  const authorId = setting('user_id');
  const displayName = setting('user_display_name');
  return {
    read: (id) => readMapped(id, toLcNode),
    list: (parentId) => listMapped(parentId, toLcNode),
    updateDescription: (id, html) => wrap(() => sendApiRequestUpdateChecked(id, { description: html })),
    updateColor: (id, hex) => wrap(() => sendApiRequestUpdateChecked(id, { color: hex })),
    addTags: (id, tags) => wrap(() => sendApiRequestAddTagsChecked(id, tags)),
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
    // Copy walk: full nodes (type, privacy, event.rolesSettings kept).
    readFull: (id) => readMapped(id, toCopyNode),
    listFull: (parentId) => listMapped(parentId, toCopyNode, true),
    create: async (parentId: string, from: CopyNode) => {
      if (!authorId) {
        const failure: ApiFailure = { networkOrTimeout: false, message: "compte administrateur inconnu — synchronisez d'abord" };
        throw failure;
      }
      return wrap(() =>
        sendApiRequestCreateFullChecked({
          parentId,
          type: from.type,
          title: from.title,
          description: from.description,
          icon: from.icon,
          color: from.color,
          privacy: from.privacy,
          tags: from.tags,
          authorId,
          displayName,
          rolesSettings: from.rolesSettings,
        }),
      );
    },
    remove: (id) => wrap(() => sendApiRequestRemoveChecked(id)),
    acl: async (id) => toAclRows(await wrap(() => sendApiRequestGetAclInfoChecked(id))),
    setRole: async (itemId, principalId, role) => {
      requirePrincipal(principalId);
      await wrap(() => sendApiRequestSetAclRoleChecked(principalId, itemId, role));
    },
    // R12: a role group is detached from the item by its groupId, never removed member by member.
    detachGroup: async (itemId, groupId) => {
      requirePrincipal(groupId);
      await wrap(() => sendApiRequestDetachGroupChecked(itemId, groupId));
    },
    sleep,
  };
}

/** Role-group id → role, from the last sync. */
export function roleGroupMap(): Map<string, string> {
  const rows = getDb().prepare('SELECT id, role FROM distribution_groups').all() as Array<{ id: string; role: string }>;
  return new Map(rows.map((r) => [r.id, r.role]));
}

/** The identity tag value (`hz-config-userid-*`) stored as persons.email; a UID on some profiles, an e-mail on others. */
function identityTag(personId: string): string | null {
  const row = getDb().prepare('SELECT email FROM persons WHERE id = ?').get(personId) as { email: string | null } | undefined;
  const v = (row?.email ?? '').trim();
  return v || null;
}

/** The student's account id: a UID as is, an e-mail via the profile ACL (studentIdFromAcl, no isGroup filter). */
export function resolveStudentId(personId: string, profileAcl: unknown[]): string | null {
  return studentIdFromAcl(identityTag(personId), profileAcl);
}

/** Reads the profile ACL only when the identity tag holds an e-mail. Unknown → null with the reason. */
async function liveStudent(personId: string): Promise<{ id: string | null; reason: StudentUnknown | null }> {
  const tag = identityTag(personId);
  if (!tag || !tag.includes('@')) return studentLookup(tag, []);
  try {
    const resp = await withRetry({ sleep }, () => wrap(() => sendApiRequestGetAclInfoChecked(personId)));
    return studentLookup(tag, aclEntries(resp));
  } catch (e) {
    console.warn(`[level-change] profile=${personId} profile ACL unreadable, student id unresolved:`, toFailure(e).message);
    return { id: null, reason: 'unreadable' };
  }
}

/** The target must be a synced student; a template or any other node is never touched. */
function isLocalStudent(personId: string): boolean {
  return !!getDb().prepare("SELECT id FROM persons WHERE id = ? AND person_type = 'student'").get(personId);
}

/** The decisions arrive over IPC: a malformed object is refused before anything is read. */
function isDecisions(d: unknown): d is LevelChangeDecisions {
  const o = d as Partial<LevelChangeDecisions> | null;
  return !!o && Array.isArray(o.acceptedTagAdds) && Array.isArray(o.forcedDescriptions) &&
    Array.isArray(o.copySections) && Array.isArray(o.deleteSections) && typeof o.addWidget === 'boolean';
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
  decisions?: LevelChangeDecisions,
): Promise<LevelChangeOutcome> {
  if (!isLocalStudent(personId)) return refusal(dryRun, 'profil introuvable');
  try {
    // The student id matters only to copies (invite grants): resolved on an execute that asks for one.
    const student = !dryRun && decisions && decisions.copySections.length > 0
      ? await liveStudent(personId)
      : { id: null, reason: null };
    const studentId = student.id;
    return await runLevelChange(
      {
        profileId: personId, toLevel, targetTemplateId, templateRootId: templateRootId(), dryRun,
        decisions, roleGroups: roleGroupMap(), studentId, studentUnknown: student.reason,
      },
      buildDeps(),
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
  const outcome = await run(personId, toLevel, targetTemplateId, true);
  // copies proposed: tell the preview whether their access can be set (the student must be found)
  if (outcome.plan && outcome.plan.templateOnlyItems.length > 0) {
    const student = await liveStudent(personId);
    outcome.plan.studentFound = student.id !== null;
    if (student.reason) outcome.plan.studentUnknown = student.reason;
  }
  return outcome;
}

export async function executeLevelChange(
  personId: string,
  toLevel: Level,
  targetTemplateId: string,
  decisions: LevelChangeDecisions,
): Promise<LevelChangeOutcome> {
  if (!isDecisions(decisions)) return refusal(false, "décisions manquantes — rien n'a été écrit");
  if (!isLocalStudent(personId)) return refusal(false, 'profil introuvable');
  // Ruling R11: copies align access by the synced role groups; none known → refused before any write.
  const noGroups = copiesRefusal(decisions.copySections, roleGroupMap().size);
  if (noGroups) return refusal(false, noGroups);
  if (getSyncProgress().status === 'syncing') {
    return refusal(false, 'synchronisation en cours — réessayez ensuite');
  }
  const outcome = await withArchiveLock(() => run(personId, toLevel, targetTemplateId, false, decisions));

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
      `applied=${outcome.applied} remaining=${outcome.remaining.length} ignored=${outcome.ignored.length} ` +
      `copies=${decisions.copySections.length} deletes=${decisions.deleteSections.length} widget=${decisions.addWidget}`,
  );
  return outcome;
}
