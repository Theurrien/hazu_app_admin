// Pure parsing for the Missions formation overview — no IO, no DB, no Electron.
// Rules are ported from the enterprise dashboard widget
// (34 - Hazu Artifacts/5-Enterprise/enterprise_dashboard.html).

import type { Row, AssessmentFact } from '../../../shared/formation-types';

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
