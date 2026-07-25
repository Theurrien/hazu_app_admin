/**
 * retest-38.ts — re-test the 38 previously-failing profiles, strictly one at a time.
 * -----------------------------------------------------------------------------
 * Purpose: Hazu support attributes the ADD failures to concurrent load and suggests
 * calling sequentially with per-call retries. Our original sweep ALREADY did exactly
 * that. This script re-runs those 38 profiles under the same strictly-sequential
 * regime and adds the two instruments that discriminate the competing explanations:
 *
 *   1. PER-REQUEST TIMING. Load pressure produces SLOW failures. A 500 returned in
 *      200 ms is a logic error, not congestion.
 *   2. INTERLEAVED CONTROLS. Previously-OK profiles mixed into the same run. If the
 *      38 fail while controls pass, the cause is profile-specific. If everything
 *      fails, the API is simply unwell right now and the run is inconclusive.
 *
 * SAFE: only ever touches membership in the throwaway TEST class below. Every profile
 * is added then immediately removed, and any residue is cleaned up at the end.
 *
 * Run, from the repo root:  npx tsx scripts/retest-38.ts
 * Reads the prior sweep's results from output/ and writes its own there too (gitignored).
 * Resumable: re-running skips ids already in the .jsonl log. Delete it to start fresh.
 * -----------------------------------------------------------------------------
 */
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================== CONFIG =======================================
const DB_PATH = `${homedir()}/Library/Application Support/hazu-admin/hazu-admin.db`;
const ENDPOINT = 'europe-west6-hazu-ch.cloudfunctions.net';
const TEST_CLASS = 'LZupasD1no6UKbgPmzTg';           // "HEFP Caro" (throwaway)
const TEST_STUDENT_GROUP = 'Q52GwymKjDL3xZjFrLeZ';   // its student group (verification)
const ADMIN_ID = 'AoVzUriXYpOlIcbKCu5T';             // templateId
const ROLE = 'student';

const N_CONTROLS = 8;          // previously-OK profiles interleaved as controls
const DELAY_BETWEEN_MS = 1000; // pause between profiles
const SETTLE_MS = 1200;        // wait after a write before reading group truth
const MAX_ATTEMPTS = 4;        // per write, incl. first try
const BACKOFF_BASE_MS = 1000;  // 1s, 2s, 4s between retries
const SLOW_MS = 5000;          // a response slower than this counts as "slow" (load-ish)

// Results carry real person data, so they go to the repo's gitignored output/ — never next to
// this script, which is tracked. fileURLToPath (not URL.pathname) so a repo path containing
// spaces resolves correctly.
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'output');
fs.mkdirSync(OUT_DIR, { recursive: true });
const PRIOR = path.join(OUT_DIR, 'broken-profiles.results.jsonl');
const JSONL = path.join(OUT_DIR, 'retest-38.results.jsonl');
const REPORT = path.join(OUT_DIR, 'retest-38.report.md');
// =============================================================================

const C = process.stdout.isTTY ? {
  r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', blu: '\x1b[34m',
  mag: '\x1b[35m', cyn: '\x1b[36m', gry: '\x1b[90m',
} : new Proxy({} as any, { get: () => '' });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`);
const dur = (s: number) => `${Math.floor(s / 60)}m${String(Math.floor(s % 60)).padStart(2, '0')}s`;

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

interface Subject { id: string; email: string; name: string; cohort: string; prev: string; isControl: boolean; }
interface Attempt { status: number; elapsed: number; }

const addBody = (id: string) => ({ templateId: ADMIN_ID, profileId: id, userTypesInfo: [{ classId: TEST_CLASS, oldUserType: '_', newUserType: ROLE }] });
const removeBody = (id: string) => ({ templateId: ADMIN_ID, profileId: id, userTypesInfo: [{ classId: TEST_CLASS, oldUserType: ROLE, newUserType: '_' }] });

async function postOnce(body: object): Promise<Attempt> {
  const t0 = Date.now();
  try {
    const res = await fetch(ROLES_URL, {
      method: 'POST', headers: { ...HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
    });
    return { status: res.status, elapsed: Date.now() - t0 };
  } catch {
    return { status: 0, elapsed: Date.now() - t0 }; // no response: timeout / reset
  }
}

/** Retries ONLY transient failures (no-response or 5xx), each as an isolated single call. */
async function callWithRetry(body: object, label: string): Promise<{ ok: boolean; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    const a = await postOnce(body);
    attempts.push(a);
    const ok = a.status >= 200 && a.status < 300;
    const tag = ok ? `${C.grn}${a.status}${C.r}` : `${C.red}${a.status || 'no-response'}${C.r}`;
    const slow = a.elapsed >= SLOW_MS ? ` ${C.yel}SLOW${C.r}` : '';
    console.log(`      ${C.gry}${label}${C.r} try ${n}/${MAX_ATTEMPTS} → ${tag} in ${ms(a.elapsed)}${slow}`);
    if (ok) return { ok: true, attempts };
    const transient = a.status === 0 || a.status >= 500;
    if (!transient || n === MAX_ATTEMPTS) return { ok: false, attempts };
    await sleep(BACKOFF_BASE_MS * 2 ** (n - 1));
  }
  return { ok: false, attempts };
}

async function memberSet(): Promise<Set<string>> {
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
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
      if (n === MAX_ATTEMPTS) throw new Error('ACL read failed after retries');
      await sleep(BACKOFF_BASE_MS * n);
    }
  }
  return new Set();
}
const isIn = (s: Set<string>, id: string) => s.has((id || '').trim().toLowerCase());

function buildSubjects(): Subject[] {
  const prior = fs.readFileSync(PRIOR, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const meta: Record<string, any> = {};
  for (const p of sqlite<any[]>('SELECT id,email,first_name,last_name,icon,color FROM persons')) meta[p.id] = p;
  const cohort = (p: any) => (p?.icon === 'fa-carrot' && p?.color === '#1A237E') ? 'CUI-C'
    : p?.icon === 'fa-carrot' ? 'CUI-A' : p?.icon === 'fa-industry' ? 'DHI' : p?.icon === 'fa-glass' ? 'RES' : '—';

  const mk = (r: any, isControl: boolean): Subject => ({
    id: r.id, email: r.email, name: r.name,
    cohort: cohort(meta[r.id]), prev: r.category, isControl,
  });

  const failed = prior.filter((r) => r.category === 'ADD_FAIL_500' || r.category === 'ADD_FAIL_NETWORK').map((r) => mk(r, false));
  // Controls: previously-OK profiles, half from the failing cohort, half from elsewhere.
  const ok = prior.filter((r) => r.category === 'OK').map((r) => mk(r, true));
  const sameCohort = ok.filter((s) => s.cohort === 'CUI-C');
  const otherCohort = ok.filter((s) => s.cohort !== 'CUI-C');
  const pick = (arr: Subject[], n: number) => arr.filter((_, i) => i % Math.max(1, Math.floor(arr.length / n)) === 0).slice(0, n);
  const controls = [...pick(sameCohort, Math.ceil(N_CONTROLS / 2)), ...pick(otherCohort, Math.floor(N_CONTROLS / 2))];

  // Interleave controls evenly through the run so they sample the same conditions.
  const out: Subject[] = [];
  const every = Math.max(1, Math.floor(failed.length / (controls.length + 1)));
  let ci = 0;
  failed.forEach((f, i) => {
    out.push(f);
    if ((i + 1) % every === 0 && ci < controls.length) out.push(controls[ci++]);
  });
  while (ci < controls.length) out.push(controls[ci++]);
  return out;
}

function bar(done: number, total: number, width = 28) {
  const filled = Math.round((done / total) * width);
  return `${C.cyn}${'█'.repeat(filled)}${C.gry}${'░'.repeat(width - filled)}${C.r}`;
}

async function main() {
  const subjects = buildSubjects();
  const done = new Set<string>();
  if (fs.existsSync(JSONL)) for (const l of fs.readFileSync(JSONL, 'utf8').split('\n')) if (l.trim()) try { done.add(JSON.parse(l).id); } catch {}
  const todo = subjects.filter((s) => !done.has(s.id));
  const nFail = subjects.filter((s) => !s.isControl).length;
  const nCtl = subjects.filter((s) => s.isControl).length;

  const W = 74;
  const box = (text: string) => `${C.b}${C.blu}║${C.r} ${C.b}${text}${C.r}${' '.repeat(Math.max(0, W - 2 - text.length))}${C.b}${C.blu}║${C.r}`;
  console.log(`\n${C.b}${C.blu}╔${'═'.repeat(W)}╗${C.r}`);
  console.log(box('HAZU RETEST — are the 38 failures reproducible one at a time?'));
  console.log(box('(their workaround is what our original sweep already did)'));
  console.log(`${C.b}${C.blu}╚${'═'.repeat(W)}╝${C.r}`);
  console.log(`  ${C.gry}Subjects   ${C.r}${nFail} previously-failing  +  ${nCtl} previously-OK controls (interleaved)`);
  console.log(`  ${C.gry}Mode       ${C.r}${C.b}strictly sequential${C.r} — exactly one in-flight request at any moment`);
  console.log(`  ${C.gry}Retries    ${C.r}up to ${MAX_ATTEMPTS} isolated single calls per write, ${BACKOFF_BASE_MS / 1000}/2/4s backoff`);
  console.log(`  ${C.gry}Test class ${C.r}${TEST_CLASS}`);
  console.log(`  ${C.gry}Instrument ${C.r}per-request latency (>${SLOW_MS / 1000}s flagged ${C.yel}SLOW${C.r}) — load produces slow failures, logic errors are fast`);
  if (done.size) console.log(`  ${C.gry}Resuming   ${C.r}${done.size} already done, ${todo.length} to go`);
  console.log();

  if (process.env.DRY === '1') {
    console.log(`${C.b}${C.yel}DRY RUN${C.r} — showing the plan only, no API calls will be made.\n`);
    subjects.forEach((s, i) => {
      const kind = s.isControl ? `${C.mag}CONTROL${C.r}       ` : `${C.yel}retest${C.r} ${C.gry}(was ${s.prev.replace('ADD_FAIL_', '')})${C.r}`;
      console.log(`  ${String(i + 1).padStart(2)}. ${pad(s.name, 32)} ${C.gry}${pad(s.cohort, 6)}${C.r} ${kind}`);
    });
    const est = subjects.length * (DELAY_BETWEEN_MS + 2 * SETTLE_MS + 4000) / 1000;
    console.log(`\n  ${subjects.length} profiles · estimated ${dur(est)} if all succeed (longer for failures that retry)\n`);
    return;
  }

  const t0 = Date.now();
  let pass = 0, fail = 0, ctlPass = 0, ctlFail = 0, n = done.size;

  for (const s of todo) {
    n++;
    const elapsedTotal = (Date.now() - t0) / 1000;
    const rate = n > done.size ? elapsedTotal / (n - done.size) : 0;
    const eta = rate ? dur(rate * (subjects.length - n)) : '—';
    const kind = s.isControl ? `${C.mag}CONTROL${C.r}` : `${C.yel}retest${C.r} ${C.gry}(was ${s.prev.replace('ADD_FAIL_', '')})${C.r}`;

    console.log(`${C.b}[${String(n).padStart(2)}/${subjects.length}]${C.r} ${bar(n, subjects.length)} ${C.gry}ETA ${eta}${C.r}`);
    console.log(`   ${C.b}${pad(s.name, 30)}${C.r} ${C.gry}${pad(s.cohort, 6)}${C.r} ${kind}`);

    const add = await callWithRetry(addBody(s.id), 'ADD   ');
    await sleep(SETTLE_MS);
    const inAfterAdd = isIn(await memberSet(), s.email);

    let rem: { ok: boolean; attempts: Attempt[] } | null = null;
    let inAfterRem: boolean | null = null;
    if (add.ok || inAfterAdd) {
      rem = await callWithRetry(removeBody(s.id), 'REMOVE');
      await sleep(SETTLE_MS);
      inAfterRem = isIn(await memberSet(), s.email);
    }

    const landed = inAfterAdd;
    const ok = landed && inAfterRem === false;
    const addMs = add.attempts.map((a) => a.elapsed);
    const worst = Math.max(...addMs);
    if (ok) { s.isControl ? ctlPass++ : pass++; } else { s.isControl ? ctlFail++ : fail++; }

    const verdict = ok
      ? `${C.grn}✓ PASS${C.r} — added and removed, confirmed in group truth`
      : `${C.red}✗ FAIL${C.r} — ${!landed ? 'never landed in the group' : 'could not be removed'}`;
    const diag = ok ? '' : (worst < SLOW_MS
      ? `   ${C.gry}↳ failed FAST (worst ${ms(worst)}) → not consistent with load pressure${C.r}`
      : `   ${C.gry}↳ failed SLOW (worst ${ms(worst)}) → consistent with load pressure${C.r}`);
    console.log(`   ${verdict}`);
    if (diag) console.log(diag);
    console.log(`   ${C.gry}running: ${C.grn}${pass} pass${C.gry} / ${C.red}${fail} fail${C.gry} of ${nFail} retests   ·   controls ${C.grn}${ctlPass}✓${C.gry} ${C.red}${ctlFail}✗${C.r}\n`);

    fs.appendFileSync(JSONL, JSON.stringify({
      id: s.id, email: s.email, name: s.name, cohort: s.cohort, prev: s.prev, isControl: s.isControl,
      addAttempts: add.attempts, addOk: add.ok, inAfterAdd,
      removeAttempts: rem?.attempts ?? null, removeOk: rem?.ok ?? null, inAfterRem,
      pass: ok,
    }) + '\n');
    await sleep(DELAY_BETWEEN_MS);
  }

  // ---------------------------- analysis ----------------------------
  const all = fs.readFileSync(JSONL, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const retests = all.filter((r) => !r.isControl), ctls = all.filter((r) => r.isControl);
  const rPass = retests.filter((r) => r.pass).length, cPass = ctls.filter((r) => r.pass).length;
  const lat = (rows: any[]) => rows.flatMap((r) => r.addAttempts.map((a: Attempt) => a.elapsed)).sort((a, b) => a - b);
  const med = (a: number[]) => (a.length ? a[Math.floor(a.length / 2)] : 0);
  const p95 = (a: number[]) => (a.length ? a[Math.floor(a.length * 0.95)] : 0);
  const okLat = lat(all.filter((r) => r.pass)), failLat = lat(all.filter((r) => !r.pass));

  const allRetestsPass = rPass === retests.length;
  const controlsHealthy = cPass === ctls.length;
  const verdict = allRetestsPass
    ? 'LOAD THEORY SUPPORTED — every previously-failing profile now succeeds sequentially.'
    : !controlsHealthy
      ? 'INCONCLUSIVE — controls also failed, so the API is unhealthy right now. Re-run later.'
      : 'LOAD THEORY CONTRADICTED — controls all pass while the same profiles fail, sequentially, with per-call retries.';

  const line = '─'.repeat(76);
  console.log(`\n${C.b}${line}\n  RESULT${C.r}\n${line}`);
  console.log(`  Retested (previously failing) : ${C.grn}${rPass} pass${C.r} / ${C.red}${retests.length - rPass} fail${C.r}  of ${retests.length}`);
  console.log(`  Controls (previously OK)      : ${C.grn}${cPass} pass${C.r} / ${C.red}${ctls.length - cPass} fail${C.r}  of ${ctls.length}`);
  console.log(`\n  ${C.b}Latency${C.r} — the load discriminator`);
  console.log(`    successful calls : median ${ms(med(okLat))}   p95 ${ms(p95(okLat))}`);
  console.log(`    failed calls     : median ${ms(med(failLat))}   p95 ${ms(p95(failLat))}`);
  console.log(`    ${C.gry}Load pressure makes failures SLOW. Fast failures point at a logic error.${C.r}`);
  console.log(`\n  ${C.b}${allRetestsPass ? C.grn : controlsHealthy ? C.red : C.yel}${verdict}${C.r}`);

  if (!allRetestsPass) {
    const still = retests.filter((r) => !r.pass);
    console.log(`\n  ${C.b}Still failing (${still.length}):${C.r}`);
    for (const r of still) console.log(`    ${pad(r.name, 32)} ${pad(r.cohort, 6)} ${C.gry}${r.addAttempts.map((a: Attempt) => `${a.status}/${ms(a.elapsed)}`).join('  ')}${C.r}`);
  }

  // residue check
  const left = await memberSet();
  const stuck = all.filter((r) => isIn(left, r.email));
  console.log(`\n  Residue in test class: ${stuck.length === 0 ? `${C.grn}none${C.r}` : `${C.red}${stuck.length}${C.r}`}`);

  const md = [
    `# Retest of previously-failing profiles — strictly sequential`, ``,
    `Run against test class \`${TEST_CLASS}\`, one request in flight at a time,`,
    `up to ${MAX_ATTEMPTS} isolated retries per write with ${BACKOFF_BASE_MS / 1000}/2/4s backoff.`, ``,
    `| Group | Pass | Fail |`, `|---|---|---|`,
    `| Previously failing | ${rPass} | ${retests.length - rPass} |`,
    `| Controls (previously OK) | ${cPass} | ${ctls.length - cPass} |`, ``,
    `**Latency** — successful calls: median ${ms(med(okLat))}, p95 ${ms(p95(okLat))}. `,
    `Failed calls: median ${ms(med(failLat))}, p95 ${ms(p95(failLat))}.`, ``,
    `**${verdict}**`, ``,
    ...(allRetestsPass ? [] : [`## Still failing`, ``, `| Name | Cohort | Attempts (status/latency) |`, `|---|---|---|`,
      ...retests.filter((r) => !r.pass).map((r) => `| ${r.name} | ${r.cohort} | ${r.addAttempts.map((a: Attempt) => `${a.status} / ${ms(a.elapsed)}`).join('<br>')} |`)]),
  ].join('\n');
  fs.writeFileSync(REPORT, md);
  console.log(`\n  Written:\n    ${REPORT}\n    ${JSONL}\n`);
}

main().catch((e) => { console.error(`\n${C.red}FATAL${C.r}`, e); process.exit(1); });
