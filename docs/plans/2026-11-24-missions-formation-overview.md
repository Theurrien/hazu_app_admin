# Missions — school formation overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken Missions tab with a school-wide, read-only overview of every
apprentice's MPE/MPC mandates and semester reports, computed with the same rules as the
5-Enterprise widget.

**Architecture:** Pure cores under `src/main/services/formation/` (parsing, per-student model,
aggregation, read orchestration — all IO injected, vitest) plus one thin IO service that reads the
school 8 apprentices at a time and stores raw facts in SQLite in one transaction. The renderer asks
the main process for computed models over new IPC channels; nothing is computed in React.

**Tech Stack:** Electron, TypeScript, better-sqlite3, axios (existing Hazu client), React +
Tailwind, vitest.

**Spec:** [docs/specs/2026-11-24-missions-redesign-design.md](../specs/2026-11-24-missions-redesign-design.md)
(read §6 before any task — it holds every definition). Background:
[docs/specs/2026-11-24-missions-data-inventory.md](../specs/2026-11-24-missions-data-inventory.md).

**Widget source** (rules are ported from here; cite the function in a comment above each port):
`/Users/urs/Desktop/1 - AI Stuff/34 - Hazu Artifacts/5-Enterprise/enterprise_dashboard.html`.

## Global Constraints

- **No real person data in tracked files** (CLAUDE.md hard rule). Fixtures use invented names,
  `@example.invalid` e-mails and invented ids like `prof-001`, `copy-101`. Write identity tags in
  fixtures and docs with a placeholder (`hz-config-userid-{value}`); the guard rejects anything else.
  If a guard fires, fix the data.
- **Read-only.** No task calls any Hazu write endpoint.
- Live reads during development are allowed with the app's own admin key, read-only; measurements
  and captures go to `output/` (gitignored) only.
- French UI copy as in the spec: « évalué par un tiers », « auto-évalué seulement »,
  « importé, en cours », « pas encore importé », « autre niveau », « à classer », « estimé »,
  « Mettre à jour ».
- Bar order and colours, everywhere: tiers `#1baf7a`, auto `#eda100`, encours `#2a78d6`,
  manquant `#d3d1c7`.
- Semesters: AFP = 4, CFC = 6. Concurrency 8. Retry 3 attempts with `backoffMs` from
  `role-write.ts`, transient = 5xx / network / timeout (`isRetryableError`).
- `MPE_CATALOGUE_ROOT = 'eIWK3uyTqf910NF6Cg0a'`.
- The page keeps nav id `missions` and label « Missions »; it stays complete-mode only (no
  `app-mode.ts` change).
- Run `npm test` and `npx tsc -p tsconfig.main.json --noEmit` (main) / `npx tsc --noEmit`
  (renderer) green before every commit.

## Review Focus

1. **The REST listing includes the parent itself as the first row** (seen live on 2026-11-24). A
   timeline read that keeps it counts the timeline as an item; a study-place read keeps descending
   into itself. Expect every listing to drop the row whose id is the parent id → test in Task 1.
2. **Rows shaped `{snapshot:{key…}}`, `{id, data:{…}}` and bare** all occur. Expect `id` resolved
   from `key || id` and fields from whichever envelope → test in Task 1.
3. **An identity tag `hz-config-userid-{value}` whose value is an e-mail.** Expect the ACL lookup
   by `description`, and an unresolved identity to exclude the apprentice from evaluation rates,
   never to count every self-assessment as « tiers » → tests in Tasks 3 and 5.
4. **Update clicked twice, or the app closed mid-run.** Expect the second click to return the
   running status, and the previous data intact after an interrupted run (one transaction at the
   end) → verification in Task 6.
5. **A level colour in a different case (`#9ad9ea`) or an apprentice whose icon maps to no
   formation.** Expect case-insensitive level mapping and the apprentice counted in « à classer »,
   never dropped → tests in Tasks 4 and 5.

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/formation-types.ts` | Every type shared by main and renderer (rows, facts, models, aggregates, IPC payloads) |
| `src/main/services/formation/parse.ts` | Row normalisation and every ported parsing rule (timeline, catalogue, copies, Suivi) |
| `src/main/services/formation/read.ts` | Pure read orchestration: reference data, one apprentice's reads, the pooled run |
| `src/main/services/formation/model.ts` | Per-apprentice model: start date, semesters, expected slots, statuses, reports |
| `src/main/services/formation/aggregate.ts` | School overview and formation detail from per-apprentice models |
| `src/main/services/formation/*.test.ts` | Tests beside each core |
| `src/main/services/formation-sync.service.ts` | IO: real deps, DB writes in one transaction, status row, queries for IPC |
| `src/main/services/hazu-api/api.ts` | Add `sendApiRequestListChecked` (throws, unlike `sendApiRequestList`) |
| `src/main/database/index.ts`, `schema.sql` | New tables, drop the mission tables |
| `src/shared/ipc-channels.ts`, `src/main/preload.ts`, `src/main/ipc/index.ts` | Replace `MISSION_*` channels with `FORMATION_*` |
| `src/renderer/pages/FormationPage.tsx` | Replaces `MissionAnalysisPage.tsx` |
| `src/renderer/components/formation/*` | Replaces `components/mission-analysis/*` |

---

### Task 1: Row normalisation and timeline parsing

**Files:**
- Create: `src/shared/formation-types.ts`, `src/main/services/formation/parse.ts`
- Test: `src/main/services/formation/parse.test.ts`

**Interfaces:**
- Produces (in `formation-types.ts`):
  ```ts
  export interface Row { id: string; parentId: string | null; type: string; title: string;
    description: string; tags: string[]; icon: string | null; color: string | null;
    dateCreated: number; authorId: string | null; authorName: string | null; order: number | null; }
  export interface AssessmentFact { copyId: string; authorId: string | null; authorName: string;
    points: number; feedback: string | null; dateMs: number; }
  ```
- Produces (in `parse.ts`):
  `normalizeRow(raw: unknown): Row | null`,
  `childrenOf(parentId: string, raw: unknown[]): Row[]` (normalises, drops nulls and the row whose id is `parentId`),
  `stripHtml(s: string): string`, `normalizeTitle(s: string): string`,
  `facetFrom(tags: string[], prefix: string): string | null`,
  `extractHazuLinks(html: string): string[]`, `parsePoints(text: string): number`,
  `parseFeedback(text: string): string | null`,
  `timelineFacts(rows: Row[]): AssessmentFact[]`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('normalizeRow', () => {
  it('reads the snapshot envelope', () => expect(normalizeRow({ snapshot: { key: 'a1', type: 'item', title: '<p>T</p>', tags: ['x'], dateCreated: 5 } })).toMatchObject({ id: 'a1', type: 'item', tags: ['x'], dateCreated: 5 }));
  it('reads the {id,data} envelope', () => expect(normalizeRow({ id: 'a2', data: { type: 'hazu', title: 'T' } })?.id).toBe('a2'));
  it('reads a bare row with key and no id', () => expect(normalizeRow({ key: 'a3', type: 'item' })?.id).toBe('a3'));
  it('resolves the author from authorId, then user.key, then user.id', () => {
    expect(normalizeRow({ key: 'k', user: { key: 'u1', displayName: 'Mentor Exemple' } })).toMatchObject({ authorId: 'u1', authorName: 'Mentor Exemple' });
  });
  it('returns null without any id', () => expect(normalizeRow({ type: 'item' })).toBeNull());
});
describe('childrenOf', () => {
  it('drops the parent row the API returns first', () => {
    expect(childrenOf('p', [{ key: 'p', type: 'hazu' }, { key: 'c', type: 'item' }]).map(r => r.id)).toEqual(['c']);
  });
});
describe('timeline parsing', () => {
  it('extracts unique hazu.swiss ids', () => expect(extractHazuLinks('<a href="https://hazu.swiss/AbC1">x</a> hazu.swiss/AbC1 hazu.swiss/Z9')).toEqual(['AbC1', 'Z9']));
  it('parses decimal points with a comma', () => expect(parsePoints('<p>1,5 Points – bien</p>')).toBe(1.5));
  it('returns 0 for unparseable points', () => expect(parsePoints('aucun')).toBe(0));
  it('parses a trailing feedback', () => expect(parseFeedback('<p>2 Points</p><p><strong>Feedback</strong> : soigné</p>')).toBe('soigné'));
  it('emits one fact per (item, link) and ignores hazu rows', () => {
    const rows = [
      { id: 't1', parentId: 'tl', type: 'item', title: '', description: '2 Points <a href="https://hazu.swiss/c1">MPE 101</a> hazu.swiss/c2', tags: ['entreprise'], icon: null, color: null, dateCreated: 10, authorId: 'u1', authorName: 'A', order: null },
      { id: 'h1', parentId: 'tl', type: 'hazu', title: '', description: 'hazu.swiss/c3', tags: [], icon: null, color: null, dateCreated: 11, authorId: 'u1', authorName: 'A', order: null },
    ];
    expect(timelineFacts(rows).map(f => f.copyId)).toEqual(['c1', 'c2']);
    expect(timelineFacts(rows)[0]).toMatchObject({ points: 2, authorId: 'u1', dateMs: 10 });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/main/services/formation/parse.test.ts` — expected FAIL (module not found).
- [ ] **Step 3: Implement the types and functions.** Port `extractHazuLinks`, `parsePoints`,
  `parseFeedback`, `parseTimelineItem`'s author resolution, `normalizeTitle` (NFD, strip combining
  marks, lowercase, collapse whitespace) and `facetFrom` from the widget, with source comments.
  `dateMs` = `dateCreated`. `normalizeRow` reads fields from `raw.snapshot ?? raw.data ?? raw`
  and the id from `key || id` (envelope first, then the outer object).
- [ ] **Step 4: Run** the same command — expected PASS.
- [ ] **Step 5: Commit** `feat(formation): row normalisation and timeline parsing`.

---

### Task 2: Catalogue, mandate copies and Suivi parsing

**Files:**
- Modify: `src/shared/formation-types.ts`, `src/main/services/formation/parse.ts`
- Test: `src/main/services/formation/parse.test.ts`

**Interfaces:**
- Consumes: `Row`, `facetFrom`, `normalizeTitle` (Task 1).
- Produces (types):
  ```ts
  export type MandateKind = 'mpe' | 'mpc';
  export type LevelCode = 'afp' | 'cfc';
  export interface Slot { kind: MandateKind; profession: string; level: LevelCode; semester: number; mandate: string; title: string; id: string; }
  export interface Copy { kind: MandateKind; id: string; semester: number | null; mandate: string | null; level: LevelCode | null; profession: string | null; title: string; dateCreated: number; }
  export interface ReportFact { kind: 'company' | 'cie'; id: string; semester: number | null; published: boolean; publishedAt: number | null; courseId: string | null; dateCreated: number; }
  export interface PlanFacts { startMs: number | null; retiredSlots: string[]; } // slot key "cfc-3-12"
  ```
- Produces (functions):
  `professionCodeOf(folder: Row): string | null` (tag `hz-config-template-mpe-{code}`),
  `isArchiveFolder(row: Row): boolean`,
  `catalogueSlot(row: Row, kind: MandateKind, profession: string): Slot | null`,
  `splitStudyChildren(rows: Row[], kind: MandateKind): { copies: Copy[]; descend: string[] }`,
  `slotKey(level: LevelCode, semester: number, mandate: string): string`,
  `companyReports(rows: Row[]): ReportFact[]`, `cieReports(rows: Row[]): ReportFact[]`,
  `planFacts(rows: Row[]): PlanFacts`,
  `findChild(rows: Row[], tag: string | null, titleFallback: string): Row | null`.

- [ ] **Step 1: Write the failing tests** (rows built with a local `row(partial)` helper):
  - `catalogueSlot` returns a slot for `type:'hazu'` with `hz-config-mpe`, `-semester-2`,
    `-mandate-03`, `-level-cfc` → `{ semester: 2, mandate: '03', level: 'cfc' }`; returns `null`
    for a `type:'item'`, for a row also tagged `hz-config-mpc` when kind is `mpe`, and for a row
    with no level facet.
  - `splitStudyChildren` on [tagged hazu copy, untagged hazu folder `f1`, `type:'item'` tagged
    `hz-config-mpe`, hazu titled « Mandats pratiques - Aperçu et planification »] →
    copies `[copy]`, descend `['f1']` (the item and the overview are skipped).
  - `isArchiveFolder` is true for title « Archive » only.
  - `companyReports`: a hazu tagged `hz-config-report-company`, `-semester-3`,
    `hz-config-report-published`, `hz-config-report-published-at-1700000000000` →
    `{ semester: 3, published: true, publishedAt: 1700000000000 }`; a row tagged
    `hz-config-report-staging` is excluded; one without a semester tag yields `semester: null`.
  - `cieReports`: a hazu tagged `rap_cie`, `hz-config-cie-report-crs1`, `hz-config-report-sent`
    → `{ kind: 'cie', courseId: 'crs1', published: true }`.
  - `planFacts`: settings items with `hz-plan-start-100` (dateCreated 1) and `hz-plan-start-200`
    (dateCreated 2) → `startMs: 200`; slot `cfc-3-12` with a skip record (dateCreated 5) then a
    `hz-plan-clear` record (dateCreated 6) → not retired; slot `cfc-1-01` with only a skip → retired.
  - `findChild` prefers the tag, falls back to the normalised title (« Mandats Entreprise » matches
    `'mandats entreprise'`), returns `null` otherwise.
- [ ] **Step 2: Run** `npx vitest run src/main/services/formation/parse.test.ts` — expected FAIL.
- [ ] **Step 3: Implement**, porting `catalogueSlot`, `collectMandates`' per-level split
  (`isPlanningOverview`, `OVERVIEW_TITLE`), `isReportNode`, `reportSemesterFromTags`,
  `latestPublishedAt`, `isArchiveFolder` and `parsePlanRecords` (newest `dateCreated` wins per
  identity, `hz-plan-clear` exact = absent, a clear on settings ignored). Report recognition is
  `isReportNode` as in the widget (tag or title), minus staging copies.
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat(formation): catalogue, copy and Suivi parsing`.

---

### Task 3: Read orchestration (pure)

**Files:**
- Create: `src/main/services/formation/read.ts`
- Test: `src/main/services/formation/read.test.ts`

**Interfaces:**
- Consumes: Task 1–2 parsers; `isRetryableError`, `backoffMs` from `../role-write`.
- Produces:
  ```ts
  export interface ReadDeps {
    list(parentId: string): Promise<unknown[]>;          // throws on failure; err.response.status set for HTTP
    acl(id: string): Promise<{ data: AclEntry[] }>;
    sleep(ms: number): Promise<void>;
  }
  export interface AclEntry { authorId?: string; description?: string; isGroup?: boolean; }
  export interface ProfileInput { personId: string; tags: string[]; }
  export interface StudentRaw {
    personId: string; ok: boolean; error: string | null;
    profileCreated: number | null; userIdTag: string | null; selfUid: string | null;
    timelineOk: boolean; facts: AssessmentFact[];
    mpe: { found: boolean; copies: Copy[] }; mpc: { found: boolean; copies: Copy[] };
    reports: ReportFact[]; plan: PlanFacts; emptyListings: number;
  }
  export interface Reference { slots: Slot[]; professionsByIcon: Record<string, { title: string; order: number }>;
    levelsByColor: Record<string, string>; catalogueIcons: Record<string, string>; } // colour keys lower-cased; icon → profession code
  export const MPE_CATALOGUE_ROOT = 'eIWK3uyTqf910NF6Cg0a';
  export function listWithRetry(deps: ReadDeps, id: string, counters?: { emptyRetries: number }): Promise<Row[]>;
  export function readReference(deps: ReadDeps, configParentIds: string[]): Promise<Reference>;
  export function readStudent(deps: ReadDeps, p: ProfileInput): Promise<StudentRaw>;
  export function runPool<T, R>(items: T[], concurrency: number, fn: (t: T) => Promise<R>, onDone?: (n: number) => void): Promise<R[]>;
  export function resolveSelfUid(userIdTag: string | null, acl: AclEntry[]): string | null;
  ```

- [ ] **Step 1: Write the failing tests** with an in-memory fake `list` built from a map
  `parentId → rows` (each listing includes the parent row first, as the live API does):
  - `listWithRetry` retries a 503 twice then succeeds (3 calls, `sleep` called with `backoffMs(0)`,
    `backoffMs(1)`); a 404 throws at once; an empty listing is re-read once, and a second empty is
    accepted as empty with `emptyRetries` incremented.
  - `readStudent` on a full fake profile (timeline via the pointer tag
    `hz-config-skills-timeline-tl1`, study places by title fallback, an import folder one level deep,
    Entreprise - Suivi with a report and a plan start, CIE - Suivi with one `rap_cie`) returns
    `ok: true`, the facts, both copy sets (including the nested copy), the report facts and
    `plan.startMs`.
  - `readStudent` with no pointer tag finds the timeline as the child tagged `hz-config-skills`.
  - `readStudent` when the profile listing throws returns `ok: false` and the error message; when
    only the timeline listing throws returns `ok: true, timelineOk: false, facts: []`.
  - Descent stops at depth 3 (four levels) and logs one warning.
  - `resolveSelfUid('uid123', [])` → `'uid123'`;
    `resolveSelfUid('kid@example.invalid', [{ authorId: 'u9', description: 'Kid@Example.invalid' }])`
    → `'u9'` (case-insensitive); an e-mail with no matching entry → `null`; `isGroup` entries skipped;
    `null` → `null`.
  - `readReference` collects slots for two profession folders (codes `cui`, `dhi`), both kinds,
    skipping « Archive » folders; reads the Professions/Levels config from the first parent id
    that has a child tagged `hz-config-professions` / `hz-config-levels` (their children: title =
    profession/level name, `icon` / `color` = key, `order` field); throws if the catalogue root
    listing fails.
  - `runPool` with concurrency 2 never has more than 2 calls in flight and returns results in input order.
- [ ] **Step 2: Run** `npx vitest run src/main/services/formation/read.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.** `readStudent` order: profile children (the parent row gives
  `profileCreated`) → timeline → Mandats Entreprise (`hz-config-study-company` /
  `mandats entreprise`) descent → Mandats CIE (`hz-config-study-cie` / `mandats cie`) descent →
  Entreprise - Suivi (`hz-config-suivi-company` / `entreprise - suivi`) → CIE - Suivi (title
  `cie - suivi`) → the profile's own ACL, read only when the identity tag's value contains `@`.
  `userIdTag` = the `{value}` part of the profile's `hz-config-userid-{value}` tag. A failure after
  the profile listing is recorded on that part (`timelineOk: false`, `found: false`), not on the
  whole apprentice.
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat(formation): pure read orchestration`.

---

### Task 4: Per-apprentice model

**Files:**
- Create: `src/main/services/formation/model.ts`
- Test: `src/main/services/formation/model.test.ts`

**Interfaces:**
- Consumes: `StudentRaw`, `Reference`, `Slot`, `Copy` (Tasks 2–3).
- Produces:
  ```ts
  export type SlotStatus = 'tiers' | 'auto' | 'encours' | 'manquant';
  export interface SlotResult { slot: Slot; status: SlotStatus; copyIds: string[];
    assessments: Array<{ authorName: string; isSelf: boolean; points: number; dateMs: number; feedback: string | null }>; }
  export type ReportState = 'published' | 'draft' | 'missing' | 'optional' | 'future';
  export interface StudentModel {
    personId: string; formationTitle: string | null; formationOrder: number; profession: string | null;
    level: LevelCode | 'other'; startMs: number; startSource: 'plan' | 'report' | 'mandate' | 'profile' | 'default';
    semesterCount: number; currentSemester: number; semesters: Array<{ n: number; startMs: number; endMs: number }>;
    mpe: SlotResult[]; mpc: SlotResult[]; ahead: Copy[]; retired: string[];
    reports: Array<{ semester: number; state: ReportState; reportId: string | null; publishedAt: number | null }>;
    untaggedReports: number; cieReports: { sent: number; draft: number };
    identityKnown: boolean; timelineOk: boolean; readOk: boolean; mpeFound: boolean; mpcFound: boolean;
  }
  export function levelCode(title: string | null): LevelCode | null;
  export function schoolYearAug1(ms: number): number;
  export function addMonths(ms: number, n: number): number;
  export function guessStartDate(src: { report?: number; mandates?: number[]; profile?: number }, todayMs: number): { startMs: number; source: 'report' | 'mandate' | 'profile' | 'default' };
  export function currentSemester(startMs: number, count: number, todayMs: number): number;
  export function buildStudentModel(raw: StudentRaw, person: { icon: string | null; color: string | null }, ref: Reference, todayMs: number): StudentModel;
  ```

- [ ] **Step 1: Write the failing tests** (fixed `TODAY = new Date(2026, 10, 24).getTime()`):
  - `levelCode('AFP')` → `'afp'`, `levelCode(' cfc ')` → `'cfc'`, `levelCode('Attestation')` → `null`.
  - `guessStartDate({ mandates: [new Date(2025, 1, 3).getTime()] }, TODAY)` → start
    `new Date(2024, 7, 1).getTime()` (local midnight 1 August of that school year; port
    `schoolYearAug1`), source `'mandate'`; `guessStartDate({}, TODAY)` → 1 Aug 2026, `'default'`.
  - `currentSemester(start = 1 Aug 2024, 6, TODAY)` → 5; before the start → 0; after the end → 6.
  - CFC apprentice in semester 2, catalogue with slots S1·01, S1·02, S2·01, S3·01:
    expected = the three S1–S2 slots; S1·01 copy with a non-self fact → `tiers`; S1·02 copy whose
    only facts are self-authored → `auto`; S2·01 copy, no fact → `encours`; S3·01 copy imported
    early → in `ahead`, not in `mpe`; no S1·02 copy at all → `manquant` (separate case).
  - A slot retired by the plan (`retiredSlots: ['cfc-1-02']`) is absent from `mpe` and listed in `retired`.
  - Best wins: two copies matching one slot, one `encours`, one `tiers` → `tiers`.
  - Identity unknown (`selfUid: null`) → `identityKnown: false`; statuses are still computed with
    every author non-self (Task 5 keeps such apprentices out of evaluation rates).
  - Reports, CFC in semester 4: S1 published, S2 draft, S3 none → `published`, `draft`, `missing`;
    S4 `future`; the last semester (S6) is `optional` once ended. A report with `semester: null`
    counts in `untaggedReports`.
  - Colour `#9ad9ea` maps through `levelsByColor` (`'#9ad9ea' → 'AFP'`) to AFP whatever its case
    on the profile; an unmapped colour → `level: 'other'` with empty `mpe`/`mpc`; an unmapped icon
    → `formationTitle: null`.
  - The plan start wins over every guess (`startSource: 'plan'`).
  - Profession code by icon through `catalogueIcons`; fallback the most frequent `profession`
    facet among the copies (port `resolveProgram`).
- [ ] **Step 2: Run** `npx vitest run src/main/services/formation/model.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.** Semester k spans `addMonths(start, 6(k−1))` to
  `addMonths(start, 6k) − 1 day` (port the widget's `addMonths`). A copy matches a slot when its
  semester and mandate facets equal the slot's and its level is null or equal. Copies whose level
  differs from the apprentice's level are ignored (widget level guard). Guess sources: earliest S1
  company report `dateCreated`, every copy `dateCreated`, `profileCreated`.
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat(formation): per-apprentice model`.

---

### Task 5: Aggregation

**Files:**
- Create: `src/main/services/formation/aggregate.ts`
- Modify: `src/shared/formation-types.ts`
- Test: `src/main/services/formation/aggregate.test.ts`

**Interfaces:**
- Consumes: `StudentModel` (Task 4).
- Produces:
  ```ts
  export interface Bar { tiers: number; auto: number; encours: number; manquant: number; }
  export interface Rates { importRate: number | null; evalRate: number | null; }
  export interface LevelAgg extends Rates { level: LevelCode | 'other'; students: number; bar: Bar | null; }
  export interface FormationAgg { key: string; title: string; icon: string; order: number; students: number; levels: LevelAgg[]; }
  export interface SchoolOverview extends Rates { students: number; reportsPublishedRate: number | null;
    formations: FormationAgg[]; unclassified: Array<{ personId: string; name: string }>;
    failed: Array<{ personId: string; name: string; error: string }>; syncedAt: number | null; }
  export interface StudentContext { personId: string; name: string; icon: string | null; companies: Array<{ id: string; title: string }>; classIds: string[]; }
  export interface MandateRow { semester: number; mandate: string; title: string; concerned: number; imported: number; tiers: number; }
  export interface CompanyRow extends Rates { id: string | null; title: string; students: number; plan: 'oui' | 'partiel' | 'non'; retired: number; reportsPublished: number; reportsDue: number; }
  export interface FormationDetail extends Rates { key: string; title: string; level: LevelCode | 'both'; tableLevel: LevelCode;
    startEnteredShare: number | null; companiesWithoutTiers: { count: number; total: number };
    bySemester: Array<{ semester: number; students: number; bar: Bar }>;
    mpe: MandateRow[]; mpc: MandateRow[]; cieReports: { sent: number; draft: number };
    companies: CompanyRow[]; reportsBySemester: Array<{ semester: number; published: number; draft: number; missing: number }>;
    students: Array<{ personId: string; name: string; company: string; currentSemester: number; bar: Bar; latestReport: ReportState | null; flags: string[] }>; }
  export function rates(bar: Bar): Rates;
  export function aggregateOverview(models: StudentModel[], ctx: StudentContext[], failed: SchoolOverview['failed'], syncedAt: number | null): SchoolOverview;
  export function aggregateFormation(models: StudentModel[], ctx: StudentContext[], key: string, level: LevelCode | 'both', filters: { classId?: string; companyId?: string; semester?: number }): FormationDetail;
  ```
  The formation `key` is the profession icon.

- [ ] **Step 1: Write the failing tests** with hand-built `StudentModel`s:
  - `rates({tiers:2,auto:1,encours:1,manquant:4})` → `importRate 0.5`, `evalRate 0.5`;
    an all-zero bar → both `null`.
  - Overview: two Cuisine CFC, one Cuisine AFP, one Cuisine `other`, one with
    `formationTitle: null` → one Cuisine card with `students: 4`; CFC/AFP levels with bars and
    rates; `other` with `bar: null` and `null` rates; `unclassified` holds the last one; headline
    rates over AFP+CFC only.
  - An apprentice with `identityKnown: false` counts in the import rate but not in the evaluation
    rate; one with `timelineOk: false` likewise; one with `readOk: false` is in `failed` and in no rate;
    one with `mpeFound: false` (« espace introuvable », spec §8) is in no MPE rate and is flagged.
  - `reportsPublishedRate` = published / (published + draft + missing).
  - Formation detail: an apprentice with two companies appears in both company rows and once in
    `students`; one with none in a row titled « sans entreprise »; `plan` is `oui` when every
    apprentice of the company has `startSource: 'plan'`, `partiel` when some, `non` when none;
    `companiesWithoutTiers` counts company rows whose bar has `tiers: 0`.
  - `mpe` rows: `concerned` = apprentices whose expected set holds the slot; sorted by semester
    then mandate; `level: 'both'` gives `tableLevel: 'cfc'`.
  - `level: 'cfc'` keeps only CFC apprentices; `companyId` and `semester` filters narrow
    `students` and every table.
  - Formation cards sorted by the config `order`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/formation/aggregate.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** `feat(formation): school and formation aggregates`.

---

### Task 6: Storage, sync service, IPC — and remove the old mission sync

**Files:**
- Modify: `src/main/services/hazu-api/api.ts`, `src/main/database/schema.sql`,
  `src/main/database/index.ts`, `src/shared/ipc-channels.ts`, `src/main/preload.ts`,
  `src/main/ipc/index.ts`, `src/shared/types.ts`
- Create: `src/main/services/formation-sync.service.ts`
- Delete: `src/main/services/mission-sync.service.ts`
- Test: `src/main/services/formation/read.test.ts` (run-level tests for `runFormationSync`)

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces:
  - `sendApiRequestListChecked(parentId: string): Promise<unknown[]>` — same request as
    `sendApiRequestList`, but rethrows (the axios error keeps `response.status`).
  - In `read.ts`: `runFormationSync(deps: ReadDeps, args: { profiles: ProfileInput[]; configParentIds: string[]; concurrency: number; onProgress(p: { processed: number; failed: number }): void }): Promise<{ reference: Reference; results: StudentRaw[]; durationMs: number; reads: number }>`
    — rejects when `readReference` throws.
  - `FormationSyncStatus = { status: 'idle' | 'syncing' | 'error'; processed: number; total: number; failed: number; lastSyncedAt: number | null; lastError: string | null }` in `formation-types.ts`.
  - IPC channels (replacing all five `MISSION_*`):
    `FORMATION_SYNC_START: 'formation:sync:start'` → `FormationSyncStatus`,
    `FORMATION_SYNC_STATUS: 'formation:sync:status'` → `FormationSyncStatus`,
    `FORMATION_OVERVIEW: 'formation:overview'` → `SchoolOverview`,
    `FORMATION_DETAIL: 'formation:detail'` `(key: string, level: LevelCode | 'both', filters)` → `FormationDetail`,
    `FORMATION_STUDENT: 'formation:student'` `(personId: string)` → `StudentModel & { name: string; companies: string[] }`.
  - Preload methods: `formationSyncStart`, `formationSyncStatus`, `getFormationOverview`,
    `getFormationDetail`, `getFormationStudent` (+ the `Window` types).

- [ ] **Step 1: Write the failing tests for `runFormationSync`**: progress reported after each
  apprentice (`processed` reaches `profiles.length`); an apprentice whose every read throws still
  yields a result with `ok: false` and the run completes; a catalogue-root failure rejects the run.
- [ ] **Step 2: Run** `npx vitest run src/main/services/formation/read.test.ts` — expected FAIL.
- [ ] **Step 3: Implement `runFormationSync`; run — expected PASS.**
- [ ] **Step 4: Storage.** In `schema.sql` and a migration in `index.ts`: drop `mission_tracking`
  and `mission_sync_status`; create `formation_student` (person_id PK, read_ok, error, stale,
  profile_created, user_id_tag, self_uid, timeline_ok, mpe_found, mpc_found, plan_start_ms,
  empty_listings, synced_at), `formation_copy` (person_id, kind, copy_id, semester, mandate, level,
  profession, title, date_created), `formation_assessment` (person_id, copy_id, author_id,
  author_name, points, feedback, date_ms), `formation_report` (person_id, kind, report_id,
  semester, published, published_at, course_id, date_created), `formation_plan_retired`
  (person_id, slot_key), `formation_catalogue` (kind, profession, level, semester, mandate,
  title, slot_id), `formation_reference` (key PK, json — professions, levels, catalogue icons) and
  `formation_sync_status` (id = 1 CHECK), **seeded with `INSERT OR IGNORE … (1, 'idle')` in both
  the schema and the migration** — the old tab broke because this row was missing. Index every
  per-person table on `person_id`.
- [ ] **Step 5: `formation-sync.service.ts`.** `startFormationSync(): FormationSyncStatus`
  returns the current status unchanged when already `syncing`; otherwise sets `syncing` with
  `total`, runs in the background, and when the run resolves writes everything in **one**
  `db.transaction`: replace the catalogue and reference; for each `ok` apprentice delete and
  re-insert its rows; for each failed apprentice keep its rows and set `stale = 1, error = …`.
  On a rejected run set `status = 'error', lastError` and touch no data. On app start, a status
  row left at `syncing` (app closed mid-run) is reset to `idle`. Profiles = `persons` where
  `person_type = 'student'`. `configParentIds` = the `rooms` row with `room_type = 'entreprise'`
  and `parent_id = root_hazu_id`, then `admin_id`. Log one line:
  `[formation-sync] students=… failed=… reads=… durationMs=… avgReadMs=…`.
  The three read channels rebuild `StudentRaw` from the tables, run `buildStudentModel` with
  `Date.now()`, and call the aggregates. `StudentContext.name` = `display_name`; companies from
  `person_room_assignments` joined to `rooms.room_type = 'entreprise'`; classes from
  `room_type = 'class'`.
- [ ] **Step 6: IPC + preload + types.** Replace the five `MISSION_*` channels in
  `ipc-channels.ts` and the duplicate list in `preload.ts`; remove `MissionSyncStatus` and the
  mission request types from `types.ts`; delete `mission-sync.service.ts`.
- [ ] **Step 7: Verify.** `npm test` and both `tsc` commands green; `npm run build && npm start`;
  in DevTools run `await window.electronAPI.formationSyncStart()` twice — the second returns the
  same `syncing` status — then poll `formationSyncStatus()` until `idle`. Expected:
  `processed === total`, a `[formation-sync]` line in the main console, and
  `getFormationOverview()` returning 3 formations and 264 apprentices. Quit the app mid-run once,
  restart: the status is `idle` and the previous data is intact. Record the duration line in
  `output/formation-sync-timing.txt`.
- [ ] **Step 8: Commit** `feat(formation): sync, storage and IPC; remove mission sync`.

---

### Task 7: Top-level page

**Files:**
- Create: `src/renderer/pages/FormationPage.tsx`, `src/renderer/components/formation/StackedBar.tsx`,
  `src/renderer/components/formation/FormationCard.tsx`, `src/renderer/components/formation/SyncHeader.tsx`
- Modify: `src/renderer/App.tsx` (the `missions` case renders `FormationPage`)
- Delete: `src/renderer/pages/MissionAnalysisPage.tsx`, `src/renderer/components/mission-analysis/`

**Interfaces:**
- Consumes: preload methods from Task 6; `Bar`, `SchoolOverview`, `FormationSyncStatus`.
- Produces: `<StackedBar bar={Bar} height?={number} />` (reused by Task 8);
  `FormationPage` state `selected: { key: string; level: LevelCode | 'both' } | null`.

- [ ] **Step 1: Build `SyncHeader`**: data date, « n lu·es, m en échec » (clicking « en échec »
  lists the failed apprentices with their error), and « Mettre à jour », which calls
  `formationSyncStart`, polls `formationSyncStatus` every second while `syncing`, shows
  « processed / total », and reloads the overview only when the status returns to `idle` after a
  run it started. An `error` status shows `lastError` and keeps the old data on screen.
- [ ] **Step 2: Build the four headline tiles, the legend, one `FormationCard` per formation**
  (CFC and AFP lines with `StackedBar` and « Import n % · Éval. n % »; « autre niveau » with a
  count only) and the « à classer » warning line, as in the spec §5.1 sketch. Cards wrap on narrow
  windows. Before the first sync: « Aucune donnée — lancez Mettre à jour » with the button.
- [ ] **Step 3: Verify** in the running app: three cards with the synced counts (Cuisine 172,
  Hôtellerie-Intendance 56, Restauration 35 at the 2026-11-24 sync), « autre niveau » lines
  without rates, one « à classer ». Both `tsc` green.
- [ ] **Step 4: Commit** `feat(formation): top-level overview page`.

---

### Task 8: Formation drill-down and apprentice panel

**Files:**
- Create: `src/renderer/components/formation/FormationDetailView.tsx`,
  `src/renderer/components/formation/MandateTable.tsx`,
  `src/renderer/components/formation/ApprenticePanel.tsx`
- Modify: `src/renderer/pages/FormationPage.tsx`

**Interfaces:**
- Consumes: `getFormationDetail`, `getFormationStudent`, `StackedBar`, `FormationDetail`, `StudentModel`.

- [ ] **Step 1: Build `FormationDetailView`** in the spec §5.2 order: level switch
  (CFC / AFP / les deux; with « les deux » the mandate tables show `tableLevel` and say so),
  filters (classe, entreprise, semestre), tiles, progress by semester, `MandateTable` for MPE then
  MPC (+ « Rapports de CIE : n envoyés · m brouillons »), companies table (evaluation rate under
  20 % in the danger colour), reports by semester, apprentice list. « Retour » goes back to the
  overview.
- [ ] **Step 2: Build `ApprenticePanel`** (side panel): semester frieze with dates and an
  « estimé » marker when `startSource !== 'plan'`; each expected MPE and MPC with status, assessor
  names, points and dates; « en avance » copies; retired mandates; reports per semester; flags
  (identity unknown, timeline unreadable, stale); « Ouvrir dans Hazu » links
  (`https://hazu.swiss/{id}`) for the profile and each copy, opened through the app's existing
  external-link handling.
- [ ] **Step 3: Verify** in the running app: open Cuisine → CFC; every section renders; switching
  level and filters updates every table; an apprentice opens in the panel and its links open in the
  browser. Both `tsc` green.
- [ ] **Step 4: Commit** `feat(formation): formation drill-down and apprentice panel`.

---

### Task 9: Cross-check against 5-Enterprise and document

**Files:**
- Modify: `CLAUDE.md` (replace the « Mission Analysis » section and the mission tables/files in
  the structure and schema lists), `docs/specs/2026-11-24-missions-redesign-design.md` (status line)
- Create (gitignored): `output/formation-crosscheck.md`

- [ ] **Step 1: Cross-check.** For three apprentices chosen by Urs (one per formation), compare
  the app's panel with the live 5-Enterprise synthesis page: every MPE slot status, every MPC
  status (5-Enterprise CIE tab), the start date and the report state per semester. Write the
  comparison to `output/formation-crosscheck.md` only. Any difference is a bug in the port: fix it
  with a test in the owning task's test file before continuing.
- [ ] **Step 2: Update CLAUDE.md**: a « Missions (formation overview) » section with the files,
  the read flow, the one-transaction write, the rules ported from 5-Enterprise (the CIE rule is
  5-Enterprise's, not the CIE dashboard's), the identity rule, and the measured duration from
  `output/formation-sync-timing.txt`. Remove `mission_tracking` / `mission_sync_status` and the
  mission components from the lists. Testing step 7 becomes « Missions → Mettre à jour → open a
  formation → open an apprentice ». Set the spec's status line to « implemented ».
- [ ] **Step 3: Run** `python3 scripts/check-no-person-data.py --all` — expected clean; `npm test` green.
- [ ] **Step 4: Commit** `docs: Missions formation overview`.
