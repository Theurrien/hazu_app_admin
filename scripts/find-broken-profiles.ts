/**
 * find-broken-profiles.ts
 * -----------------------------------------------------------------------------
 * Identify student profiles that Hazu's update-user-roles endpoint fails to
 * add and/or remove, by round-tripping each ONE AT A TIME against a throwaway
 * TEST class. Gentle pacing + retry-with-backoff so we don't trip rate limits
 * (the mass-parallel version got throttled -> false "status 0" failures).
 *
 * SAFE: only ever touches membership in the TEST class below — never a real
 * class. Each student is added then immediately removed, so at most one test
 * membership exists at a time, and it self-cleans residue from earlier runs.
 *
 * Run (Node 18+ required for global fetch), from the repo root:
 *     npx tsx scripts/find-broken-profiles.ts
 *
 * Resumable: re-running continues where it left off (skips ids already in the
 * .jsonl log). Results are written to output/ (gitignored); delete the .jsonl
 * there to start fresh.
 * -----------------------------------------------------------------------------
 */
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================== CONFIG (tweak here) ==========================
const DB_PATH = `${homedir()}/Library/Application Support/hazu-admin/hazu-admin.db`;
const ENDPOINT = 'europe-west6-hazu-ch.cloudfunctions.net';
const TEST_CLASS = 'LZupasD1no6UKbgPmzTg';           // "HEFP Caro" (throwaway)
const TEST_STUDENT_GROUP = 'Q52GwymKjDL3xZjFrLeZ';   // its student group (for verification)
const ADMIN_ID = 'AoVzUriXYpOlIcbKCu5T';             // templateId
const ROLE = 'student';

const DELAY_BETWEEN_MS = 1000; // pause between students
const SETTLE_MS = 1200;        // wait after a write before reading group truth (cache lag)
const MAX_ATTEMPTS = 4;        // per write, incl. first try
const BACKOFF_BASE_MS = 1000;  // 1s, 2s, 4s ... between retries

// Results carry real person data, so they go to the repo's gitignored output/ — never next to
// this script, which is tracked. fileURLToPath (not URL.pathname) so a repo path containing
// spaces resolves correctly.
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'output');
fs.mkdirSync(OUT_DIR, { recursive: true });
const JSONL = path.join(OUT_DIR, 'broken-profiles.results.jsonl');
const REPORT_JSON = path.join(OUT_DIR, 'broken-profiles.report.json');
const REPORT_TXT = path.join(OUT_DIR, 'broken-profiles.report.txt');
// ============================================================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sqlite<T = any>(query: string, json = true): T {
  const args = json ? ['-readonly', '-json', DB_PATH, query] : ['-readonly', DB_PATH, query];
  const out = execFileSync('sqlite3', args, { encoding: 'utf8' }).trim();
  return (json ? (out ? JSON.parse(out) : []) : out) as T;
}

const API_KEY = (process.env.HAZU_KEY || sqlite<string>("SELECT value FROM settings WHERE key='api_key'", false)).trim();
if (!API_KEY) throw new Error('No API key (set HAZU_KEY or ensure the app DB has one).');
const HEADERS: Record<string, string> = API_KEY.length <= 20 ? { token: API_KEY } : { 'x-api-key': API_KEY };
const ROLES_URL = `https://${ENDPOINT}/api-v2-admin/update-user-roles`;
const ACL_URL = `https://${ENDPOINT}/acl?id=${TEST_STUDENT_GROUP}`;

interface Student { id: string; email: string; first_name: string; last_name: string; }

const addBody = (id: string) => ({ templateId: ADMIN_ID, profileId: id, userTypesInfo: [{ classId: TEST_CLASS, oldUserType: '_', newUserType: ROLE }] });
const removeBody = (id: string) => ({ templateId: ADMIN_ID, profileId: id, userTypesInfo: [{ classId: TEST_CLASS, oldUserType: ROLE, newUserType: '_' }] });

async function postOnce(body: object): Promise<{ status: number; ok: boolean }> {
  try {
    const res = await fetch(ROLES_URL, { method: 'POST', headers: { ...HEADERS, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    return { status: res.status, ok: res.ok };
  } catch {
    return { status: 0, ok: false }; // network / timeout / no response
  }
}
// Retry only transient failures (network=0 or 5xx); a 4xx fails fast.
async function callWithRetry(body: object): Promise<{ status: number; ok: boolean; attempts: number }> {
  let status = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await postOnce(body);
    if (r.ok) return { status: r.status, ok: true, attempts: attempt };
    status = r.status;
    const transient = r.status === 0 || r.status >= 500;
    if (!transient || attempt === MAX_ATTEMPTS) return { status, ok: false, attempts: attempt };
    await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
  }
  return { status, ok: false, attempts: MAX_ATTEMPTS };
}
async function memberSet(): Promise<Set<string>> {
  // Retry the read too — we don't want a transient ACL read to poison verification.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(ACL_URL, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      const data: any = await res.json();
      const set = new Set<string>();
      for (const m of data?.data ?? []) {
        if (m.isGroup) continue;
        if (m.authorId) set.add(String(m.authorId).trim().toLowerCase());
        if (m.description) set.add(String(m.description).trim().toLowerCase());
      }
      return set;
    } catch {
      if (attempt === MAX_ATTEMPTS) throw new Error('ACL read failed after retries');
      await sleep(BACKOFF_BASE_MS * attempt);
    }
  }
  return new Set();
}
const isIn = (set: Set<string>, email: string) => set.has((email || '').trim().toLowerCase());

function classify(r: any): string {
  if (!r.inAfterAdd) {
    if (r.addOk) return 'ADD_UNCONFIRMED';          // 2xx but not in group (silent no-op)
    if (r.addStatus >= 500) return 'ADD_FAIL_500';  // server errored
    if (r.addStatus === 0) return 'ADD_FAIL_NETWORK';
    return `ADD_FAIL_${r.addStatus}`;               // 4xx etc.
  }
  if (!r.inAfterRem) return 'OK';                   // added and removed cleanly
  if (r.removeOk) return 'REMOVE_UNCONFIRMED';      // 2xx but still in group
  if ((r.removeStatus ?? 0) >= 500) return 'REMOVE_FAIL_500';
  if (r.removeStatus === 0) return 'REMOVE_FAIL_NETWORK';
  return `REMOVE_FAIL_${r.removeStatus}`;
}

async function main() {
  const students = sqlite<Student[]>("SELECT id, email, first_name, last_name FROM persons WHERE tags LIKE '%hz-config-profile-student%' ORDER BY last_name, first_name");
  const done = new Set<string>();
  if (fs.existsSync(JSONL)) for (const line of fs.readFileSync(JSONL, 'utf8').split('\n')) { if (line.trim()) try { done.add(JSON.parse(line).id); } catch {} }
  const todo = students.filter((s) => !done.has(s.id));
  console.log(`Students: ${students.length}  | already done: ${done.size}  | to process: ${todo.length}`);
  console.log(`Test class: ${TEST_CLASS}   Pacing: ${DELAY_BETWEEN_MS}ms gap, up to ${MAX_ATTEMPTS} tries/write\n`);

  let n = done.size;
  for (const s of todo) {
    n++;
    const name = `${s.first_name} ${s.last_name}`.trim();
    const add = await callWithRetry(addBody(s.id));
    await sleep(SETTLE_MS);
    const inAfterAdd = isIn(await memberSet(), s.email);

    let removeAttempted = false, removeStatus: number | null = null, removeOk: boolean | null = null, removeAttempts: number | null = null, inAfterRem: boolean | null = null;
    if (add.ok || inAfterAdd) { // it's in the class (fresh add or leftover residue) -> take it back out
      removeAttempted = true;
      const rem = await callWithRetry(removeBody(s.id));
      removeStatus = rem.status; removeOk = rem.ok; removeAttempts = rem.attempts;
      await sleep(SETTLE_MS);
      inAfterRem = isIn(await memberSet(), s.email);
    }
    const rec: any = { id: s.id, email: s.email, name, addStatus: add.status, addOk: add.ok, addAttempts: add.attempts, inAfterAdd, removeAttempted, removeStatus, removeOk, removeAttempts, inAfterRem };
    rec.category = classify(rec);
    fs.appendFileSync(JSONL, JSON.stringify(rec) + '\n');
    const flag = rec.category === 'OK' ? 'ok' : `>>> ${rec.category}`;
    console.log(`[${n}/${students.length}] ${name.padEnd(34).slice(0, 34)} add=${add.status}(x${add.attempts}) rem=${removeStatus ?? '-'} ${flag}`);
    await sleep(DELAY_BETWEEN_MS);
  }

  // ---- Build the categorized report from the full JSONL ----
  const all: any[] = fs.readFileSync(JSONL, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const by = (c: string) => all.filter((r) => r.category === c).map((r) => ({ id: r.id, email: r.email, name: r.name, addStatus: r.addStatus, removeStatus: r.removeStatus }));
  const report = {
    generatedFor: 'Hazu support — profiles failing update-user-roles',
    testClass: TEST_CLASS, tested: all.length,
    addFail500: by('ADD_FAIL_500'),
    addUnconfirmed: by('ADD_UNCONFIRMED'),
    addFailNetwork: by('ADD_FAIL_NETWORK'),      // transient — consider re-running these
    removeFail500: by('REMOVE_FAIL_500'),
    removeUnconfirmed: by('REMOVE_UNCONFIRMED'),
    removeFailNetwork: by('REMOVE_FAIL_NETWORK'), // transient
    okCount: all.filter((r) => r.category === 'OK').length,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));

  const stillIn = [...(await memberSet())];
  const section = (title: string, rows: any[]) => rows.length ? `\n${title} (${rows.length}):\n` + rows.map((r) => `  ${r.id}  ${r.email}  (${r.name})`).join('\n') + '\n' : `\n${title}: none\n`;
  const txt =
    `Profiles failing Hazu update-user-roles — test class ${TEST_CLASS}\n` +
    `Tested ${all.length} student profiles. Clean (add+remove OK): ${report.okCount}.\n` +
    section('ADD fails with HTTP 500 (server error)', report.addFail500) +
    section('ADD returns 2xx but the student is NOT in the group (silent no-op)', report.addUnconfirmed) +
    section('REMOVE fails with HTTP 500 (server error)', report.removeFail500) +
    section('REMOVE returns 2xx but student still in group (silent no-op)', report.removeUnconfirmed) +
    section('ADD no-response after retries (likely transient — re-run to confirm)', report.addFailNetwork) +
    section('REMOVE no-response after retries (likely transient — re-run)', report.removeFailNetwork) +
    `\nStudents still in the test class at end (residue / uncleaned): ${stillIn.length}\n`;
  fs.writeFileSync(REPORT_TXT, txt);

  console.log('\n==================== SUMMARY ====================');
  console.log(`Tested: ${all.length}   Clean: ${report.okCount}`);
  console.log(`ADD  fail-500: ${report.addFail500.length}   unconfirmed(2xx): ${report.addUnconfirmed.length}   no-response: ${report.addFailNetwork.length}`);
  console.log(`REMOVE fail-500: ${report.removeFail500.length}   unconfirmed(2xx): ${report.removeUnconfirmed.length}   no-response: ${report.removeFailNetwork.length}`);
  console.log(`Still in test class at end: ${stillIn.length}`);
  console.log(`\nReports:\n  ${REPORT_TXT}\n  ${REPORT_JSON}\n  ${JSONL} (raw, per-student)`);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
