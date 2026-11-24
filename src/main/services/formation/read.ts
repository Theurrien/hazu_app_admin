// Read orchestration for the Missions formation overview — pure: no DB, HTTP or Electron.
// All IO (list, acl, sleep) is injected, so the rules run under vitest without a native module.
// Ported from the enterprise dashboard widget (34 - Hazu Artifacts/5-Enterprise/enterprise_dashboard.html).

import type { Row, AssessmentFact, Copy, ReportFact, PlanFacts, Slot, StudentRaw, Reference } from '../../../shared/formation-types';
import { isRetryableError, backoffMs } from '../role-write';
import {
  childrenOf, findChild, normalizeTitle, stripHtml, facetFrom, timelineFacts, professionCodeOf,
  isArchiveFolder, catalogueSlot, splitStudyChildren, companyReports, cieReports, planFacts,
} from './parse';

export type { StudentRaw, Reference } from '../../../shared/formation-types';

export interface AclEntry { authorId?: string; description?: string; isGroup?: boolean }

export interface ReadDeps {
  list(parentId: string): Promise<unknown[]>; // throws on failure; err.response.status set for HTTP
  acl(id: string): Promise<{ data: AclEntry[] }>;
  sleep(ms: number): Promise<void>;
}

export interface ProfileInput { personId: string; tags: string[] }

/** Counts for one read. `reads` counts every deps.list / deps.acl call (including retries). */
export interface ReadCounters { emptyRetries?: number; reads?: number }

// Source: enterprise_dashboard.html — MPE_CATALOGUE_ROOT
export const MPE_CATALOGUE_ROOT = 'eIWK3uyTqf910NF6Cg0a';

const MAX_ATTEMPTS = 3;
const MAX_DEPTH = 3; // four levels, depths 0-3
const CATALOGUE_CONCURRENCY = 5;
const NETWORK_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN']);

// Transient = HTTP 5xx, or an error with no response that looks like network/timeout.
function isTransient(err: unknown): boolean {
  const e = err as { response?: { status?: number }; code?: string; request?: unknown } | null;
  const status = e?.response?.status;
  const network = status === undefined && !!(e && ((e.code && NETWORK_CODES.has(e.code)) || e.request));
  return isRetryableError(status, network);
}

const bump = (c: ReadCounters | undefined, k: 'reads' | 'emptyRetries') => { if (c) c[k] = (c[k] ?? 0) + 1; };
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function withRetry<T>(deps: ReadDeps, counters: ReadCounters | undefined, call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    bump(counters, 'reads');
    try {
      return await call();
    } catch (err) {
      if (attempt + 1 >= MAX_ATTEMPTS || !isTransient(err)) throw err;
      await deps.sleep(backoffMs(attempt));
    }
  }
}

/** Raw listing with transient retry; an empty result is re-read once. */
async function listRaw(deps: ReadDeps, id: string, counters?: ReadCounters): Promise<unknown[]> {
  let raw = await withRetry(deps, counters, () => deps.list(id));
  if (childrenOf(id, raw).length === 0) {
    raw = await withRetry(deps, counters, () => deps.list(id));
    if (childrenOf(id, raw).length === 0) bump(counters, 'emptyRetries');
  }
  return raw;
}

/** Normalised children of `id`. Retries 5xx/network with backoff; a 4xx throws at once. */
export async function listWithRetry(deps: ReadDeps, id: string, counters?: ReadCounters): Promise<Row[]> {
  return childrenOf(id, await listRaw(deps, id, counters));
}

// Source: enterprise_dashboard.html — collectCatalogueSlots
// One traversal collects both kinds; archive folders are skipped; a failing listing propagates.
async function collectCatalogueSlots(deps: ReadDeps, id: string, profession: string, depth: number, counters?: ReadCounters): Promise<Slot[]> {
  if (depth > MAX_DEPTH) {
    console.warn('[catalogue] depth cap (4 levels) under', id, '- deeper not collected');
    return [];
  }
  const kids = await listWithRetry(deps, id, counters); // a failure stops the run: no rates without a full catalogue
  const here: Slot[] = [];
  const descend: string[] = [];
  for (const k of kids) {
    if (k.type !== 'hazu' || isArchiveFolder(k)) continue;
    const slot = catalogueSlot(k, 'mpe', profession) ?? catalogueSlot(k, 'mpc', profession);
    if (slot) here.push(slot);
    else descend.push(k.id);
  }
  const nested = await Promise.all(descend.map(c => collectCatalogueSlots(deps, c, profession, depth + 1, counters)));
  return here.concat(...nested);
}

// Source: enterprise_dashboard.html — findConfigHazus / loadProfessionMap / loadLevelMap
// Each config Hazu is taken from the first parent that has a child carrying its tag; an unreadable parent rejects.
async function readConfigChildren(deps: ReadDeps, parents: string[], tag: string, counters?: ReadCounters): Promise<Row[]> {
  for (const parent of parents) {
    const kids = await listWithRetry(deps, parent, counters); // unreadable parent rejects: no fall-through
    const cfg = kids.find(k => k.tags.includes(tag));
    if (cfg) return listWithRetry(deps, cfg.id, counters);
  }
  return [];
}

/** The catalogue slots plus the professions/levels config. Throws when the catalogue root cannot be listed. */
export async function readReference(deps: ReadDeps, configParentIds: string[], counters?: ReadCounters): Promise<Reference> {
  // Source: enterprise_dashboard.html — loadMandateCatalogue
  const folders = (await listWithRetry(deps, MPE_CATALOGUE_ROOT, counters))
    .filter(f => f.type === 'hazu' && !isArchiveFolder(f))
    .map(f => ({ folder: f, code: professionCodeOf(f) }))
    .filter((x): x is { folder: Row; code: string } => !!x.code);

  const slotsByFolder = await runPool(folders, CATALOGUE_CONCURRENCY, x => collectCatalogueSlots(deps, x.folder.id, x.code, 0, counters));

  const catalogueIcons: Record<string, string> = {};
  for (const { folder, code } of folders) if (folder.icon) catalogueIcons[folder.icon] = code;

  const professionsByIcon: Record<string, { title: string; order: number }> = {};
  (await readConfigChildren(deps, configParentIds, 'hz-config-professions', counters)).forEach((it, idx) => {
    if (it.icon) professionsByIcon[it.icon] = { title: stripHtml(it.title), order: it.order ?? idx };
  });
  const levelsByColor: Record<string, string> = {};
  for (const it of await readConfigChildren(deps, configParentIds, 'hz-config-levels', counters)) {
    if (it.color) levelsByColor[it.color.toLowerCase()] = stripHtml(it.title);
  }

  return { slots: ([] as Slot[]).concat(...slotsByFolder), professionsByIcon, levelsByColor, catalogueIcons };
}

/** Run `fn` over `items`, `concurrency` at a time; results keep input order. `onDone(n)` gets the finished count. */
export async function runPool<T, R>(items: T[], concurrency: number, fn: (t: T) => Promise<R>, onDone?: (n: number) => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      onDone?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, Math.floor(concurrency) || 1), items.length) }, worker));
  return out;
}

/**
 * The apprentice's own account id. A tag value without "@" already is one; an e-mail is
 * matched (case-insensitive) against the profile ACL's `description`, skipping group entries.
 */
export function resolveSelfUid(userIdTag: string | null, acl: AclEntry[]): string | null {
  if (!userIdTag) return null;
  if (!userIdTag.includes('@')) return userIdTag;
  const want = userIdTag.toLowerCase();
  const hit = acl.find(e => !e.isGroup && (e.description ?? '').toLowerCase() === want);
  return hit?.authorId ?? null;
}

// Source: enterprise_dashboard.html — collectMandates
// Bounded descent (4 levels); a tagged hazu is a copy, an untagged one is descended. Throws on a failed listing.
async function collectCopies(deps: ReadDeps, id: string, kind: 'mpe' | 'mpc', depth: number, counters: ReadCounters): Promise<Copy[]> {
  if (depth > MAX_DEPTH) {
    console.warn('[formation] mandate descent hit depth cap (4 levels) under', id, '- deeper mandates not collected');
    return [];
  }
  const { copies, descend } = splitStudyChildren(await listWithRetry(deps, id, counters), kind);
  const nested = await Promise.all(descend.map(c => collectCopies(deps, c, kind, depth + 1, counters)));
  return copies.concat(...nested);
}

const USERID_PREFIX = 'hz-config-userid-';
const TIMELINE_PREFIX = 'hz-config-skills-timeline-';

/** Read one apprentice. Never throws: failures become data (ok:false only if the profile listing fails). */
export async function readStudent(deps: ReadDeps, p: ProfileInput, reads?: { reads?: number }): Promise<StudentRaw> {
  const counters: ReadCounters & { emptyRetries: number } = { emptyRetries: 0, reads: 0 };
  const userIdTag = facetFrom(p.tags, USERID_PREFIX);
  const out: StudentRaw = {
    personId: p.personId, ok: true, error: null, profileCreated: null, userIdTag, selfUid: null,
    timelineOk: true, facts: [], mpe: { found: false, copies: [] }, mpc: { found: false, copies: [] },
    reports: [], plan: { startMs: null, retiredSlots: [] } as PlanFacts, emptyListings: 0, failedParts: [],
  };
  const fail = (e: unknown, part?: StudentRaw['failedParts'][number]) => {
    if (!out.error) out.error = message(e);
    if (part) out.failedParts.push(part);
  };

  try {
    let kids: Row[];
    try {
      const raw = await listRaw(deps, p.personId, counters);
      kids = childrenOf(p.personId, raw);
      out.profileCreated = profileCreatedOf(p.personId, raw);
    } catch (e) {
      out.ok = false;
      out.timelineOk = false;
      fail(e);
      return out;
    }

    // Timeline: the pointer tag first, else the child tagged hz-config-skills.
    try {
      const timelineId = facetFrom(p.tags, TIMELINE_PREFIX) ?? kids.find(k => k.tags.includes('hz-config-skills'))?.id ?? null;
      out.facts = timelineId ? timelineFacts(await listWithRetry(deps, timelineId, counters)) : [];
    } catch (e) {
      out.timelineOk = false;
      out.facts = [];
      fail(e, 'timeline');
    }

    const mandates = async (tag: string, title: string, kind: 'mpe' | 'mpc') => {
      const place = findChild(kids, tag, title);
      if (!place) return;
      try {
        const copies = await collectCopies(deps, place.id, kind, 0, counters);
        out[kind] = { found: true, copies };
      } catch (e) {
        out[kind] = { found: true, copies: [] };
        fail(e, kind);
      }
    };
    await mandates('hz-config-study-company', 'mandats entreprise', 'mpe');
    await mandates('hz-config-study-cie', 'mandats cie', 'mpc');

    // Entreprise - Suivi: company reports and the plan records.
    const suiviCo = findChild(kids, 'hz-config-suivi-company', 'entreprise - suivi');
    if (suiviCo) {
      try {
        const rows = await listWithRetry(deps, suiviCo.id, counters);
        out.reports = out.reports.concat(companyReports(rows));
        out.plan = planFacts(rows);
      } catch (e) {
        fail(e, 'suivi-company');
      }
    }
    // CIE - Suivi: rap_cie report copies.
    const suiviCie = kids.find(k => normalizeTitle(k.title) === 'cie - suivi') ?? null;
    if (suiviCie) {
      try {
        out.reports = out.reports.concat(cieReports(await listWithRetry(deps, suiviCie.id, counters)));
      } catch (e) {
        fail(e, 'suivi-cie');
      }
    }

    // The profile's own ACL, only when the identity tag holds an e-mail.
    if (userIdTag && userIdTag.includes('@')) {
      try {
        const acl = await withRetry(deps, counters, () => deps.acl(p.personId));
        out.selfUid = resolveSelfUid(userIdTag, acl.data ?? []);
      } catch (e) {
        fail(e, 'acl');
      }
    } else {
      out.selfUid = resolveSelfUid(userIdTag, []);
    }
    return out;
  } finally {
    out.emptyListings = counters.emptyRetries;
    if (reads) reads.reads = (reads.reads ?? 0) + (counters.reads ?? 0);
  }
}

// The listing's first row is the parent profile; its dateCreated is the profile's creation time.
function profileCreatedOf(profileId: string, raw: unknown[]): number | null {
  const parent = raw.map(r => (r && typeof r === 'object' ? (r as any) : null)).find(r => {
    const env = r && (r.snapshot ?? r.data ?? r);
    return env && String(env.key || env.id || r.key || r.id) === profileId;
  });
  if (!parent) return null;
  const env = parent.snapshot ?? parent.data ?? parent;
  return Number(env.dateCreated) || null;
}

export interface FormationSyncArgs {
  profiles: ProfileInput[];
  configParentIds: string[];
  concurrency: number;
  onProgress(p: { processed: number; failed: number }): void;
}

/**
 * One whole formation sync: the reference data first, then every apprentice, `concurrency` at a
 * time. Rejects when the reference read fails (no rates are computable without it, spec §7.2);
 * an apprentice's failure never rejects — it is a result with `ok: false`. `reads` counts every
 * list/ACL call of the run, reference included.
 */
export async function runFormationSync(
  deps: ReadDeps,
  args: FormationSyncArgs,
): Promise<{ reference: Reference; results: StudentRaw[]; durationMs: number; reads: number }> {
  const t0 = Date.now();
  const counters: ReadCounters = { reads: 0 };
  const reference = await readReference(deps, args.configParentIds, counters);
  let failed = 0;
  const results = await runPool(
    args.profiles,
    args.concurrency,
    async p => {
      const r = await readStudent(deps, p, counters);
      if (!r.ok) failed += 1;
      return r;
    },
    processed => args.onProgress({ processed, failed }),
  );
  return { reference, results, durationMs: Date.now() - t0, reads: counters.reads ?? 0 };
}
