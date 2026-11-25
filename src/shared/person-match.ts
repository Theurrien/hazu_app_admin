/**
 * Person matcher and leaver list — pure, no IO. Matches spreadsheet rows to Hazu
 * persons by e-mail, then by name, and lists students absent from the sheet.
 */

export interface SheetPerson {
  rowIndex: number;
  email?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
}
export interface HazuPerson {
  id: string;
  email: string | null;
  displayName: string;
}
export type RowMatch =
  | { kind: 'matched'; rowIndex: number; personId: string; by: 'email' | 'name' }
  | { kind: 'check'; rowIndex: number; candidateIds: string[]; reason: 'conflict' | 'ambiguous' | 'near' }
  | { kind: 'unknown'; rowIndex: number };
/** personId = the confirmed candidate; null = every candidate rejected. */
export interface CheckDecision {
  rowIndex: number;
  personId: string | null;
}
export type ClassFilter = { all: true } | { all: false; classIds: string[]; includeNoClass: boolean };

/** Lower case, accents stripped, [-'’.,] → space, spaces collapsed. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-'’.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(s: string): string[] {
  const n = normalizeName(s);
  return n === '' ? [] : n.split(' ');
}

/** Normalised words, sorted, joined by one space; '' when empty. */
export function nameKey(s: string): string {
  return words(s).sort().join(' ');
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Multiset difference a − b. */
function without(a: string[], b: string[]): string[] {
  const rest = [...b];
  const out: string[] = [];
  for (const w of a) {
    const i = rest.indexOf(w);
    if (i >= 0) rest.splice(i, 1);
    else out.push(w);
  }
  return out;
}

function isNear(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const onlyA = without(a, b);
  const onlyB = without(b, a);
  // proper subset, smaller side with at least two words
  if (onlyA.length === 0 && onlyB.length > 0 && a.length >= 2) return true;
  if (onlyB.length === 0 && onlyA.length > 0 && b.length >= 2) return true;
  // same word count, exactly one differing pair of long, close words
  if (a.length === b.length && onlyA.length === 1 && onlyB.length === 1) {
    const [x] = onlyA;
    const [y] = onlyB;
    return x.length >= 5 && y.length >= 5 && levenshtein(x, y) <= 2;
  }
  return false;
}

function rowName(r: SheetPerson): string {
  const full = (r.fullName ?? '').trim();
  if (full !== '') return full;
  return `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim();
}

function cleanEmail(e: string | null | undefined): string {
  const t = (e ?? '').trim().toLowerCase();
  return t.includes('@') ? t : '';
}

export function matchRows(rows: SheetPerson[], persons: HazuPerson[]): RowMatch[] {
  const info = persons.map((p) => ({
    id: p.id,
    email: cleanEmail(p.email),
    key: nameKey(p.displayName),
    words: words(p.displayName),
  }));

  return rows.map((row): RowMatch => {
    const rowIndex = row.rowIndex;
    const email = cleanEmail(row.email);
    const name = rowName(row);
    const key = nameKey(name);
    const rowWords = words(name);

    if (email !== '') {
      const hits = info.filter((p) => p.email === email);
      if (hits.length === 1) {
        const a = hits[0];
        const others = key === '' ? [] : info.filter((p) => p.id !== a.id && p.key === key);
        if (others.length > 0) {
          return {
            kind: 'check',
            rowIndex,
            candidateIds: [a.id, ...others.map((p) => p.id)],
            reason: 'conflict',
          };
        }
        // The e-mail is trusted only when the name agrees, is near, or is absent: a row for B
        // carrying A's e-mail (a copy-down error) must not silently match A and list B as leaver.
        if (key !== '' && key !== a.key && !isNear(rowWords, a.words)) {
          const near = info.filter((p) => p.id !== a.id && isNear(rowWords, p.words));
          return {
            kind: 'check',
            rowIndex,
            candidateIds: [a.id, ...near.map((p) => p.id)],
            reason: 'conflict',
          };
        }
        return { kind: 'matched', rowIndex, personId: a.id, by: 'email' };
      }
      if (hits.length > 1) {
        return { kind: 'check', rowIndex, candidateIds: hits.map((p) => p.id), reason: 'ambiguous' };
      }
    }

    if (key !== '') {
      const same = info.filter((p) => p.key === key);
      if (same.length === 1) return { kind: 'matched', rowIndex, personId: same[0].id, by: 'name' };
      if (same.length > 1) {
        return { kind: 'check', rowIndex, candidateIds: same.map((p) => p.id), reason: 'ambiguous' };
      }
      const near = info.filter((p) => isNear(rowWords, p.words));
      if (near.length > 0) {
        return { kind: 'check', rowIndex, candidateIds: near.map((p) => p.id), reason: 'near' };
      }
    }

    return { kind: 'unknown', rowIndex };
  });
}

/** Row → person after decisions: matched rows, plus confirmed check rows and unknown rows attached by hand. */
export function resolvedPersonByRow(
  matches: RowMatch[],
  decisions: CheckDecision[],
): Map<number, string> {
  const decided = new Map(decisions.map((d) => [d.rowIndex, d.personId]));
  const out = new Map<number, string>();
  for (const m of matches) {
    if (m.kind === 'matched') out.set(m.rowIndex, m.personId);
    else {
      // check rows: the confirmed candidate; unknown rows: a person attached by hand
      const id = decided.get(m.rowIndex);
      if (id) out.set(m.rowIndex, id);
    }
  }
  return out;
}

export function findLeavers(
  students: HazuPerson[],
  matches: RowMatch[],
  decisions: CheckDecision[],
  classIdsOf: Map<string, string[]>,
  filter: ClassFilter | null,
): HazuPerson[] {
  if (filter === null) return [];
  const present = new Set(resolvedPersonByRow(matches, decisions).values());
  const decided = new Set(decisions.map((d) => d.rowIndex));
  for (const m of matches) {
    if (m.kind === 'check' && !decided.has(m.rowIndex)) m.candidateIds.forEach((id) => present.add(id));
  }
  return students
    .filter((s) => !present.has(s.id))
    .filter((s) => {
      if (filter.all) return true;
      const classes = classIdsOf.get(s.id) ?? [];
      if (classes.length === 0) return filter.includeNoClass;
      return classes.some((c) => filter.classIds.includes(c));
    })
    .sort((x, y) => x.displayName.localeCompare(y.displayName));
}
