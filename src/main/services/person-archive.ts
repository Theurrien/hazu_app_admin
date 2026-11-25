// Person archive — PURE CORE. All IO is injected through PersonArchiveDeps; this file imports no DB,
// axios, Electron or React. Spec: docs/specs/2026-11-25-person-archive-design.md (Part 1).
//
// Order matters more than anything here: every room membership is removed and confirmed FIRST; only
// when all of them are confirmed gone does anything get created or moved. The live read decides, not
// the status code, and a stopped run is finished by running it again.

import {
  ARCHIVE_ROOT_PRIVACY,
  ARCHIVE_ROOT_TAG,
  ARCHIVE_ROOT_TITLE,
  ApiFailure,
  ArchiveDeps,
  HazuNode,
  createOnce,
  failureMessage,
  moveVerified,
  readUntil,
  withRetry,
} from './room-archive';
import { parseClassTag } from './discrepancy';
import type {
  ArchivedPerson,
  PersonArchiveOutcome,
  PersonRestoreOutcome,
  StepResult,
} from '../../shared/archive-types';

export const PERSONS_FOLDER_TAG = 'hz-config-archive-persons';
export const PERSONS_FOLDER_TITLE = 'Personnes';
export const PERSONS_FOLDER_PRIVACY = 'private';
export const PERSON_FOLDER_TAG = 'hz-config-archive-person';
export const PERSON_FOLDER_PRIVACY = 'unlisted';

const PROFILE_PREFIX = 'hz-config-archive-profile-';
const FROM_PREFIX = 'hz-config-archive-from-';
const AT_PREFIX = 'hz-config-archive-at-';

export interface PersonRecord {
  profileId: string;
  fromParentId: string;
  archivedAt: number;
}

/** The four tags of a per-person folder: the person marker plus the three record tags. */
export function buildPersonRecordTags(r: PersonRecord): string[] {
  return [
    PERSON_FOLDER_TAG,
    `${PROFILE_PREFIX}${r.profileId}`,
    `${FROM_PREFIX}${r.fromParentId}`,
    `${AT_PREFIX}${r.archivedAt}`,
  ];
}

/** null unless all four tags are present and valid. */
export function parsePersonRecordTags(tags: string[]): PersonRecord | null {
  if (!tags.includes(PERSON_FOLDER_TAG)) return null;
  const find = (prefix: string): string | null => {
    const t = tags.find(x => x.startsWith(prefix) && x.length > prefix.length);
    return t ? t.slice(prefix.length) : null;
  };
  const profileId = find(PROFILE_PREFIX);
  const fromParentId = find(FROM_PREFIX);
  const at = find(AT_PREFIX);
  if (!profileId || !fromParentId || !at || !/^\d+$/.test(at)) return null;
  return { profileId, fromParentId, archivedAt: Number(at) };
}

/** The list row of one archived person; null when the folder's record is incomplete. */
export function archivedPersonEntry(folder: HazuNode, children: HazuNode[]): ArchivedPerson | null {
  const rec = parsePersonRecordTags(folder.tags);
  if (!rec) return null;
  return {
    folderId: folder.id,
    profileId: rec.profileId,
    inFolder: children.some(c => c.id === rec.profileId),
    displayName: folder.title,
    fromParentId: rec.fromParentId,
    archivedAt: rec.archivedAt,
  };
}

export interface PersonArchiveDeps extends ArchiveDeps {
  /** S4 role write to '_'. success = confirmed gone (or confirmed by truth after a failed status). */
  removeRole(roomId: string, role: string): Promise<{ success: boolean; error?: string }>;
}

export interface PersonArchiveInput {
  person: { id: string; displayName: string };
  /** Live person categories: the only parents a profile may be archived from / restored to. */
  categoryIds: string[];
  adminId: string;
  assignments: Array<{ roomId: string; role: string; title: string }>;
  liveRooms: Array<{ roomId: string; classId: string; title: string }>;
  now: number;
}

export interface PersonRestoreInput {
  folderId: string;
  adminId: string;
  categoryIds: string[];
}

const NOT_CONFIRMED = (id: string): ApiFailure => ({ networkOrTimeout: false, message: `non confirmé pour ${id}` });

/** Class tags on a profile that name one of the live rooms. */
function liveClassTags(tags: string[], liveClassIds: Set<string>): string[] {
  return tags.filter(t => {
    const p = parseClassTag(t);
    return !!p && liveClassIds.has(p.classId);
  });
}

/** The Archive root's « Personnes » folder under the admin Hazu, or null. Never creates. */
async function findPersonsFolder(deps: ArchiveDeps, adminId: string): Promise<HazuNode | null> {
  const adminChildren = await withRetry(deps, () => deps.list(adminId));
  const archive = adminChildren.find(c => c.tags.includes(ARCHIVE_ROOT_TAG));
  if (!archive) return null;
  const inArchive = await withRetry(deps, () => deps.list(archive.id));
  return inArchive.find(c => c.tags.includes(PERSONS_FOLDER_TAG)) ?? null;
}

export async function runPersonArchive(
  input: PersonArchiveInput,
  deps: PersonArchiveDeps,
): Promise<PersonArchiveOutcome> {
  const { person } = input;
  const steps: StepResult[] = [];
  let folderId: string | undefined;

  const fail = (step: string, detail: string, remaining: string[]): PersonArchiveOutcome => {
    steps.push({ step, status: 'failed', detail });
    return { success: false, steps, remaining, error: detail, folderId };
  };

  // 1. The profile: exists, and either already archived or still in a known category.
  let profile: HazuNode;
  try {
    const p = await withRetry(deps, () => deps.read(person.id));
    if (!p) return fail('profile-read', 'profil introuvable', [person.id]);
    profile = p;
    const parent = p.parentId ? await withRetry(deps, () => deps.read(p.parentId!)) : null;
    const rec = parent ? parsePersonRecordTags(parent.tags) : null;
    if (parent && rec && rec.profileId === person.id) {
      // Tags alone prove nothing: the folder must itself sit in « Personnes » of the Archive root.
      const persons = await findPersonsFolder(deps, input.adminId);
      if (persons && parent.parentId === persons.id) {
        folderId = parent.id;
        steps.push({ step: 'profile-read', status: 'skipped', detail: 'déjà archivé' });
        for (const s of ['rooms', 'tags', 'archive-folders', 'move']) steps.push({ step: s, status: 'skipped' });
        return { success: true, steps, remaining: [], folderId };
      }
    }
    if (!p.parentId || !input.categoryIds.includes(p.parentId)) {
      return fail('profile-read', "le profil n'est plus dans son dossier d'origine", [person.id]);
    }
    steps.push({ step: 'profile-read', status: 'done' });
  } catch (e) {
    return fail('profile-read', failureMessage(e), [person.id]);
  }
  const fromParentId = profile.parentId!;

  // 2. Every room: the assignments, plus rooms only the profile's class tags still name.
  const liveClassIds = new Set(input.liveRooms.map(r => r.classId));
  const rooms: Array<{ roomId: string; role: string; title: string }> = [...input.assignments];
  const listed = new Set(rooms.map(r => r.roomId));
  for (const tag of profile.tags) {
    const parsed = parseClassTag(tag);
    if (!parsed) continue;
    const live = input.liveRooms.find(r => r.classId === parsed.classId);
    if (!live || listed.has(live.roomId)) continue;
    listed.add(live.roomId);
    rooms.push({ roomId: live.roomId, role: parsed.role, title: live.title });
  }

  const unconfirmed: string[] = [];
  let lastError = '';
  for (const r of rooms) {
    try {
      const res = await deps.removeRole(r.roomId, r.role);
      if (!res.success) {
        unconfirmed.push(r.title);
        lastError = res.error || `retrait non confirmé : ${r.title}`;
      }
    } catch (e) {
      unconfirmed.push(r.title);
      lastError = failureMessage(e);
    }
  }

  // 3. Any unconfirmed removal stops everything: nothing is created, nothing is moved.
  if (unconfirmed.length) return fail('rooms', lastError, unconfirmed);
  steps.push({ step: 'rooms', status: rooms.length ? 'done' : 'skipped', detail: `${rooms.length}` });

  // 4. Leftover class tags of live rooms: the only thing ever removed from the profile itself.
  try {
    const live = await withRetry(deps, () => deps.read(person.id));
    if (!live) return fail('tags', 'profil introuvable', [person.id]);
    const leftover = liveClassTags(live.tags, liveClassIds);
    if (leftover.length === 0) {
      steps.push({ step: 'tags', status: 'skipped' });
    } else {
      let callError = '';
      try {
        await withRetry(deps, () => deps.removeTags(person.id, leftover));
      } catch (e) {
        callError = failureMessage(e); // a failed call may still have landed: the read decides
      }
      const gone = await readUntil(deps, person.id, n => !n || liveClassTags(n.tags, liveClassIds).length === 0);
      if (!gone) return fail('tags', callError || 'étiquette toujours présente après relecture', leftover);
      steps.push({ step: 'tags', status: 'done', detail: `${leftover.length}` });
    }
  } catch (e) {
    return fail('tags', failureMessage(e), []);
  }

  // 5. Archive root, « Personnes », the per-person folder (found by its record, else created).
  try {
    const adminChildren = await withRetry(deps, () => deps.list(input.adminId));
    const archiveId =
      adminChildren.find(c => c.tags.includes(ARCHIVE_ROOT_TAG))?.id ??
      (await createOnce(
        deps, input.adminId, ARCHIVE_ROOT_TITLE, [ARCHIVE_ROOT_TAG], ARCHIVE_ROOT_PRIVACY, ARCHIVE_ROOT_TAG,
      ));
    const inArchive = await withRetry(deps, () => deps.list(archiveId));
    const personsId =
      inArchive.find(c => c.tags.includes(PERSONS_FOLDER_TAG))?.id ??
      (await createOnce(
        deps, archiveId, PERSONS_FOLDER_TITLE, [PERSONS_FOLDER_TAG], PERSONS_FOLDER_PRIVACY, PERSONS_FOLDER_TAG,
      ));
    const inPersons = await withRetry(deps, () => deps.list(personsId));
    const existing = inPersons.find(c => parsePersonRecordTags(c.tags)?.profileId === person.id);
    if (existing) {
      folderId = existing.id;
    } else {
      folderId = await createOnce(
        deps,
        personsId,
        person.displayName || person.id,
        buildPersonRecordTags({ profileId: person.id, fromParentId, archivedAt: input.now }),
        PERSON_FOLDER_PRIVACY,
        `${PROFILE_PREFIX}${person.id}`,
      );
    }
    steps.push({ step: 'archive-folders', status: existing ? 'skipped' : 'done' });
  } catch (e) {
    return fail('archive-folders', failureMessage(e), [person.id]);
  }

  // 6. The move; success only when a final read shows the profile inside the folder.
  try {
    const fresh = (await withRetry(deps, () => deps.read(person.id))) ?? profile;
    const r = await moveVerified(deps, fresh, folderId);
    if (!(await readUntil(deps, person.id, n => n?.parentId === folderId))) throw NOT_CONFIRMED(person.id);
    steps.push({ step: 'move', status: r === 'moved' ? 'done' : 'skipped' });
  } catch (e) {
    return fail('move', failureMessage(e), [person.id]);
  }

  return { success: true, steps, remaining: [], folderId };
}

export async function runPersonRestore(
  input: PersonRestoreInput,
  deps: ArchiveDeps,
): Promise<PersonRestoreOutcome> {
  const { folderId } = input;
  const steps: StepResult[] = [];
  const stop = (step: string, detail: string, remaining: string[] = [folderId]): PersonRestoreOutcome => {
    steps.push({ step, status: 'failed', detail });
    return { success: false, steps, remaining, error: detail };
  };

  // 1. The folder: inside « Personnes » of the Archive root, record complete.
  let rec: PersonRecord;
  try {
    const folder = await withRetry(deps, () => deps.read(folderId));
    const persons = await findPersonsFolder(deps, input.adminId);
    if (!folder || !folder.tags.includes(PERSON_FOLDER_TAG) || !persons || folder.parentId !== persons.id) {
      return stop('folder-read', "dossier d'archive introuvable");
    }
    const parsed = parsePersonRecordTags(folder.tags);
    if (!parsed) return stop('folder-read', "dossier d'archive incomplet");
    rec = parsed;
    steps.push({ step: 'folder-read', status: 'done' });
  } catch (e) {
    return stop('folder-read', failureMessage(e));
  }

  // 2. The profile is the folder's child, or already back at its origin.
  let profile: HazuNode;
  try {
    const inside = await withRetry(deps, () => deps.list(folderId));
    const child = inside.find(c => c.id === rec.profileId);
    if (child) {
      profile = child;
    } else {
      const p = await withRetry(deps, () => deps.read(rec.profileId));
      if (!p || p.parentId !== rec.fromParentId) return stop('profile', 'profil introuvable', [rec.profileId]);
      profile = p;
    }
    steps.push({ step: 'profile', status: 'done' });
  } catch (e) {
    return stop('profile', failureMessage(e), [rec.profileId]);
  }

  // 3. The origin must still exist and be a known category: no guessing.
  try {
    const origin = await withRetry(deps, () => deps.read(rec.fromParentId));
    if (!origin || !input.categoryIds.includes(rec.fromParentId)) {
      return stop('origin', "dossier d'origine introuvable", [rec.fromParentId]);
    }
    steps.push({ step: 'origin', status: 'done' });
  } catch (e) {
    return stop('origin', failureMessage(e), [rec.fromParentId]);
  }

  // 4. Move back (skipped when already there), confirmed by a read.
  try {
    const r = await moveVerified(deps, profile, rec.fromParentId);
    if (!(await readUntil(deps, rec.profileId, n => n?.parentId === rec.fromParentId))) {
      throw NOT_CONFIRMED(rec.profileId);
    }
    steps.push({ step: 'move', status: r === 'moved' ? 'done' : 'skipped' });
  } catch (e) {
    return stop('move', failureMessage(e), [rec.profileId]);
  }

  // 5. Remove the folder only when a live listing shows it empty; the read-back decides.
  try {
    const left = await withRetry(deps, () => deps.list(folderId));
    if (left.length > 0) {
      return stop('folder-remove', `dossier non vide, laissé en place : ${left.map(c => c.id).join(', ')}`);
    }
    let callError = '';
    try {
      await withRetry(deps, () => deps.remove(folderId));
    } catch (e) {
      callError = failureMessage(e);
    }
    if (!(await readUntil(deps, folderId, n => !n))) {
      return stop('folder-remove', callError || `suppression non confirmée pour ${folderId}`);
    }
    steps.push({ step: 'folder-remove', status: 'done' });
  } catch (e) {
    return stop('folder-remove', failureMessage(e));
  }

  return { success: true, steps, remaining: [] };
}
