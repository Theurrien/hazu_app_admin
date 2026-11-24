// Pure parsing for the Missions formation overview — no IO, no DB, no Electron.
// Rules are ported from the enterprise dashboard widget
// (34 - Hazu Artifacts/5-Enterprise/enterprise_dashboard.html).

import type { Row, AssessmentFact, MandateKind, LevelCode, Slot, Copy, ReportFact, PlanFacts } from '../../../shared/formation-types';

type Obj = Record<string, any>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * Normalise one raw API row. Fields come from `raw.snapshot ?? raw.data ?? raw`;
 * the id from `key || id`, envelope first, then the outer object.
 */
export function normalizeRow(raw: unknown): Row | null {
  if (!isObj(raw)) return null;
  const env: Obj = isObj(raw.snapshot) ? raw.snapshot : isObj(raw.data) ? raw.data : raw;
  const id = env.key || env.id || raw.key || raw.id;
  if (!id) return null;

  const user: Obj | null = isObj(env.user) ? env.user : isObj(raw.user) ? raw.user : null;
  const authorId = env.authorId || raw.authorId || (user && (user.key || user.id)) || null;

  return {
    id: String(id),
    parentId: env.parentId ? String(env.parentId) : raw.parentId ? String(raw.parentId) : null,
    type: str(env.type),
    title: str(env.title),
    description: str(env.description),
    tags: Array.isArray(env.tags) ? env.tags.map(String) : [],
    icon: env.icon ? String(env.icon) : null,
    color: env.color ? String(env.color) : null,
    dateCreated: Number(env.dateCreated) || 0,
    authorId: authorId ? String(authorId) : null,
    authorName: user && user.displayName ? String(user.displayName) : null,
    order: typeof env.order === 'number' ? env.order : null,
  };
}

/** Normalise a listing and drop nulls plus the parent row the API returns first. */
export function childrenOf(parentId: string, raw: unknown[]): Row[] {
  const out: Row[] = [];
  for (const r of raw ?? []) {
    const row = normalizeRow(r);
    if (row && row.id !== parentId) out.push(row);
  }
  return out;
}

// Source: enterprise_dashboard.html — stripHtmlTags
export function stripHtml(s: string): string {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// Source: enterprise_dashboard.html — normalizeTitle
export function normalizeTitle(s: string): string {
  return stripHtml(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Source: enterprise_dashboard.html — facetFrom
export function facetFrom(tags: string[], prefix: string): string | null {
  const t = (tags || []).find(x => x.startsWith(prefix));
  return t ? t.substring(prefix.length) : null;
}

// Source: enterprise_dashboard.html — pickIdTag
// The first tag with `prefix` whose value is a bare id: non-empty, no '-'. A composite such as
// `hz-config-skills-timeline-{id}-enable-{id}` is skipped; only composites → null.
export function pickIdTag(tags: string[], prefix: string): string | null {
  const t = (tags || []).find(x => {
    if (!x.startsWith(prefix)) return false;
    const value = x.slice(prefix.length);
    return value.length > 0 && value.indexOf('-') === -1;
  });
  return t ? t.slice(prefix.length) : null;
}

// Source: enterprise_dashboard.html — extractHazuLinks
// Every distinct hazu.swiss/{id} in a description (href or bare text), order-stable.
export function extractHazuLinks(html: string): string[] {
  const ids: string[] = [];
  const re = /hazu\.swiss\/([A-Za-z0-9]+)/g;
  const text = String(html || '');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (ids.indexOf(m[1]) === -1) ids.push(m[1]);
  }
  return ids;
}

// Source: enterprise_dashboard.html — parsePoints
// "N Point(s)" → number; unparseable → 0.
export function parsePoints(text: string): number {
  const m = stripHtml(text).match(/(\d+(?:[.,]\d+)?)\s*Points?/i);
  return m ? parseFloat(m[1].replace(',', '.')) || 0 : 0;
}

// Source: enterprise_dashboard.html — parseFeedback
// Trailing "Feedback : …" note, or null.
export function parseFeedback(text: string): string | null {
  const m = stripHtml(text).match(/Feedback\s*:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

// Source: enterprise_dashboard.html — parseTimelineItem (author resolution + 'Inconnu' fallback)
// One fact per (timeline item, linked MPE copy). Rows of type 'hazu' are folders, not entries.
export function timelineFacts(rows: Row[]): AssessmentFact[] {
  const facts: AssessmentFact[] = [];
  for (const row of rows) {
    if (row.type === 'hazu') continue;
    const points = parsePoints(row.description);
    const feedback = parseFeedback(row.description);
    for (const copyId of extractHazuLinks(row.description)) {
      facts.push({
        copyId,
        authorId: row.authorId,
        authorName: row.authorName || 'Inconnu',
        points,
        feedback,
        dateMs: row.dateCreated,
      });
    }
  }
  return facts;
}

const markerOf = (kind: MandateKind): string => (kind === 'mpe' ? 'hz-config-mpe' : 'hz-config-mpc');
const OVERVIEW_TITLE = 'mandats pratiques - apercu et planification';
const REPORT_COMPANY_TAG = 'hz-config-report-company';
const REPORT_TITLE = 'rapport de formation';
const REPORT_STAGING_TAG = 'hz-config-report-staging';
const REPORT_PUBLISHED_TAG = 'hz-config-report-published';
const REPORT_SEMESTER_PREFIX = 'hz-config-report-semester-';
const REPORT_PUBLISHED_AT_PREFIX = 'hz-config-report-published-at-';
const CIE_REPORT_TAG = 'rap_cie';
const CIE_REPORT_SENT_TAG = 'hz-config-report-sent';
const CIE_REPORT_COURSE_PREFIX = 'hz-config-cie-report-';

const toLevel = (v: string | null): LevelCode | null => (v === 'afp' || v === 'cfc' ? v : null);
const toNum = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The profession code of a profession folder: tag `hz-config-template-mpe-{code}`. */
export function professionCodeOf(folder: Row): string | null {
  return facetFrom(folder.tags, 'hz-config-template-mpe-');
}

// Source: enterprise_dashboard.html — isArchiveFolder
export function isArchiveFolder(row: Row): boolean {
  return normalizeTitle(row.title) === 'archive';
}

// Source: enterprise_dashboard.html — catalogueSlot
// A master in the catalogue, or null when it is not a real master of `kind`
// (not a hazu, wrong marker, the sibling kind's marker, or a missing/invalid facet).
export function catalogueSlot(row: Row, kind: MandateKind, profession: string): Slot | null {
  if (row.type !== 'hazu') return null;
  const marker = markerOf(kind);
  const other = markerOf(kind === 'mpe' ? 'mpc' : 'mpe');
  if (!row.tags.includes(marker) || row.tags.includes(other)) return null;
  const level = toLevel(facetFrom(row.tags, marker + '-level-'));
  const semester = toNum(facetFrom(row.tags, marker + '-semester-'));
  const mandate = facetFrom(row.tags, marker + '-mandate-');
  if (!level || semester === null || !mandate) return null;
  return { kind, profession, level, semester, mandate, title: stripHtml(row.title) || 'Mandat', id: row.id };
}

// Source: enterprise_dashboard.html — collectMandates (the per-level split) + toMandate
// Tagged hazu → a copy; untagged hazu → descend; items and the planning overview are skipped.
export function splitStudyChildren(rows: Row[], kind: MandateKind): { copies: Copy[]; descend: string[] } {
  const marker = markerOf(kind);
  const copies: Copy[] = [];
  const descend: string[] = [];
  for (const r of rows) {
    if (r.type !== 'hazu') continue;
    if (normalizeTitle(r.title) === OVERVIEW_TITLE) continue;
    // A room filed in a study place (e.g. a whole CIE course) holds course content, never copies.
    if (r.tags.some(t => t.startsWith('hz-config-room-'))) continue;
    if (r.tags.includes(marker)) {
      copies.push({
        kind,
        id: r.id,
        semester: toNum(facetFrom(r.tags, marker + '-semester-')),
        mandate: facetFrom(r.tags, marker + '-mandate-'),
        level: toLevel(facetFrom(r.tags, marker + '-level-')),
        profession: facetFrom(r.tags, marker + '-profession-'),
        title: stripHtml(r.title) || 'Mandat',
        dateCreated: r.dateCreated,
      });
    } else {
      descend.push(r.id);
    }
  }
  return { copies, descend };
}

export function slotKey(level: LevelCode, semester: number, mandate: string): string {
  return `${level}-${semester}-${mandate}`;
}

// Source: enterprise_dashboard.html — reportSemesterFromTags
function reportSemester(tags: string[]): number | null {
  const t = tags.find(x => x.startsWith(REPORT_SEMESTER_PREFIX));
  if (!t) return null;
  const n = Number(t.slice(REPORT_SEMESTER_PREFIX.length));
  return Number.isFinite(n) ? n : null;
}

// Source: enterprise_dashboard.html — latestPublishedAt (0 → null here)
function latestPublishedAt(tags: string[]): number | null {
  let best = 0;
  for (const t of tags) {
    if (t.startsWith(REPORT_PUBLISHED_AT_PREFIX)) {
      const n = Number(t.slice(REPORT_PUBLISHED_AT_PREFIX.length));
      if (Number.isFinite(n) && n > best) best = n;
    }
  }
  return best > 0 ? best : null;
}

// Source: enterprise_dashboard.html — isReportNode
// A company report: a hazu with the identity tag, or (legacy) the report title; never a staging copy.
function isCompanyReport(n: Row): boolean {
  if (n.type !== 'hazu') return false;
  if (n.tags.includes(REPORT_STAGING_TAG)) return false;
  if (n.tags.includes(REPORT_COMPANY_TAG)) return true;
  return normalizeTitle(n.title) === REPORT_TITLE;
}

export function companyReports(rows: Row[]): ReportFact[] {
  return rows.filter(isCompanyReport).map(r => ({
    kind: 'company' as const,
    id: r.id,
    semester: reportSemester(r.tags),
    published: r.tags.includes(REPORT_PUBLISHED_TAG),
    publishedAt: latestPublishedAt(r.tags),
    courseId: null,
    dateCreated: r.dateCreated,
  }));
}

// Source: cie_dashboard.html — rap_cie report copies, tag hz-config-cie-report-{courseId}, sent = hz-config-report-sent
export function cieReports(rows: Row[]): ReportFact[] {
  return rows
    .filter(r => r.tags.includes(CIE_REPORT_TAG))
    .map(r => ({
      kind: 'cie' as const,
      id: r.id,
      semester: null,
      published: r.tags.includes(CIE_REPORT_SENT_TAG),
      publishedAt: null,
      courseId: facetFrom(r.tags, CIE_REPORT_COURSE_PREFIX),
      dateCreated: r.dateCreated,
    }));
}

const PLAN_PREFIX = 'hz-plan-';
const PLAN_START_RE = /^hz-plan-start-(\d+)$/;
const PLAN_SLOT_RE = /^hz-plan-slot-(afp|cfc)-(\d+)-([A-Za-z0-9]+)$/;

function tagMatch(tags: string[], re: RegExp): RegExpExecArray | null {
  for (const t of tags) {
    const m = re.exec(t);
    if (m) return m;
  }
  return null;
}

// Source: enterprise_dashboard.html — parsePlanRecords
// The newest record per identity wins; hz-plan-clear on a mandate slot removes it
// (a clear on the settings record is ignored). A slot whose winner is a skip is retired.
export function planFacts(rows: Row[]): PlanFacts {
  let settings: { startMs: number; dateCreated: number } | null = null;
  const slots: Record<string, { skipped: boolean; cleared: boolean; dateCreated: number }> = {};
  for (const n of rows) {
    if (n.type !== 'item' || !n.tags.some(t => t.startsWith(PLAN_PREFIX))) continue;
    const tags = n.tags;
    if (tags.includes('hz-plan-settings')) {
      const m = tagMatch(tags, PLAN_START_RE);
      if (m && (!settings || n.dateCreated > settings.dateCreated)) {
        settings = { startMs: Number(m[1]), dateCreated: n.dateCreated };
      }
      continue;
    }
    if (!tags.includes('hz-plan-entry') || !tags.includes('hz-plan-kind-mandate')) continue;
    const s = tagMatch(tags, PLAN_SLOT_RE);
    if (!s) continue;
    const key = `${s[1]}-${s[2]}-${s[3]}`;
    const cleared = tags.includes('hz-plan-clear');
    const skipped = !cleared && tags.includes('hz-plan-skip');
    const hasDue = tags.some(t => /^hz-plan-due-\d+$/.test(t));
    if (!cleared && !skipped && !hasDue) continue;
    if (!slots[key] || n.dateCreated > slots[key].dateCreated) {
      slots[key] = { skipped, cleared, dateCreated: n.dateCreated };
    }
  }
  return {
    startMs: settings ? settings.startMs : null,
    retiredSlots: Object.keys(slots).filter(k => slots[k].skipped),
  };
}

/** A child by tag, falling back to its normalised title. */
export function findChild(rows: Row[], tag: string | null, titleFallback: string): Row | null {
  if (tag) {
    const byTag = rows.find(r => r.tags.includes(tag));
    if (byTag) return byTag;
  }
  const want = normalizeTitle(titleFallback);
  return rows.find(r => normalizeTitle(r.title) === want) ?? null;
}
