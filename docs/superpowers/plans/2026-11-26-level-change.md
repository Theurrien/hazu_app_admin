# Outils tab — level change (CFC ↔ AFP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A complete-mode « Outils » tab whose first tool switches a student's profile between CFC
and AFP by applying only the difference between the two levels' v3 templates, verified by a live
read.

**Architecture:** Pure core `level-change.ts` (all IO injected, vitest-tested) holds template
choice, section matching, the tag swap and description rule, and the `runLevelChange`
orchestrator (dry run = plan). A thin `level-change.service.ts` wires the real Hazu calls, the
archive lock and the local reconcile. The renderer runs the plan through IPC and the change as one
`levelChange` Task Queue task.

**Tech Stack:** TypeScript, Electron (main), React + Tailwind (renderer), vitest, axios.

**Spec:** [docs/specs/2026-11-26-level-change-design.md](../../specs/2026-11-26-level-change-design.md)

## Global Constraints

- Level colours: CFC `#1A237E`, AFP `#9AD9EA` (compare case-insensitively, write upper-case).
- Student templates = children of the `template_id` setting tagged `hz-config-profile-student`.
- Target / source template = same icon as the profile, colour of the level; the one whose
  HTML-stripped title contains `v3` as a word (`/\bv3\b/i`). None or several → no preselection.
- Section match key: title (HTML stripped, `&nbsp;` → space, trimmed, lower-case) | icon | colour upper-case.
- A failed **or empty** listing of the profile or of any consulted template aborts before any write.
- Empty description is written as `<p><br></p>`.
- Profile colour is written **last**, only after every section change is verified.
- Transient (5xx / network / timeout) retries with `backoffMs`, 3 attempts; 4xx fails fast.
- Verify: up to 3 reads, 750 ms apart; a change counts when the read shows it.
- No sync during the task (`withArchiveLock`); local reconcile only on full success and not while a sync runs.
- Complete mode only: page `tools` and task `levelChange` are not in the CIE lists.
- UI copy in French. Logs carry profile ids only — never a name or an e-mail (CLAUDE.md hard rule).
- Develop and test against a **scratch userData copy** (`--user-data-dir`), never the real DB.

## Review Focus

1. Titles with `&nbsp;`, HTML or trailing spaces (« CIE - Suivi ») must still match their template section. → test in Task 1.
2. Hazu may rewrite a description's whitespace on save: verification must compare normalised text, or a good run reports failure. → test in Task 2.
3. The templates folder holds many non-student items and can echo itself: only tagged student templates may be candidates. → test in Task 1.
4. A second « v3 » for the same formation × level (or « v30 ») must not be silently picked. → test in Task 1.
5. A profile colour stored lower-case (`#1a237e`) is still CFC. → test in Task 1.

---

### Task 1: Pure planning core

**Files:**
- Create: `src/main/services/level-change.ts`
- Create: `src/shared/level-change-types.ts`
- Test: `src/main/services/level-change.test.ts`

**Interfaces:**
- Produces (in `src/shared/level-change-types.ts`):
  ```ts
  export type Level = 'cfc' | 'afp';
  export interface TemplateRef { id: string; title: string; icon: string | null; color: string | null }
  export interface SectionChange {
    sectionId: string; title: string;
    description: { from: string; to: string } | null;   // to = value to write
    descriptionKept: boolean;                             // hand-edited, left alone
    addTags: string[]; removeTags: string[];
  }
  export interface LevelChangePlan {
    profileId: string; fromLevel: Level; toLevel: Level;
    colorFrom: string; colorTo: string; colorChange: boolean;
    templates: Array<{ id: string; title: string; role: 'target' | 'source' | 'source-other' }>;
    sections: SectionChange[];        // only sections with a change or descriptionKept
    profileOnly: string[]; templateOnly: string[];   // section titles
  }
  ```
- Produces (in `src/main/services/level-change.ts`):
  ```ts
  export interface LcNode { id: string; parentId: string | null; title: string; description: string;
                            tags: string[]; icon: string | null; color: string | null }
  export const LEVEL_COLORS: Record<Level, string>;             // { cfc: '#1A237E', afp: '#9AD9EA' }
  export const STUDENT_TEMPLATE_TAG = 'hz-config-profile-student';
  export const EMPTY_DESCRIPTION = '<p><br></p>';
  export function otherLevel(l: Level): Level;
  export function levelOfColor(color: string | null): Level | null;
  export function studentTemplates(rootId: string, children: LcNode[]): LcNode[];
  export function templatesFor(templates: LcNode[], icon: string | null, level: Level): LcNode[];
  export function pickV3(candidates: LcNode[]): string | null;
  export function sectionKey(n: Pick<LcNode, 'title' | 'icon' | 'color'>): string;
  export function normDesc(html: string): string;
  export function tagFamily(tag: string): string | null;
  export function buildPlan(input: PlanInput): LevelChangePlan;
  export interface TemplateTree { ref: LcNode; children: LcNode[] }
  export interface PlanInput { profile: LcNode; profileChildren: LcNode[]; toLevel: Level;
                               target: TemplateTree; source: TemplateTree; sourceOthers: TemplateTree[] }
  ```

- [ ] **Step 1: Write the failing tests** in `level-change.test.ts` (fixtures: invent ids; no real data):
  - `levelOfColor`: `'#1A237E'`→`'cfc'`, `'#1a237e'`→`'cfc'`, `'#9AD9EA'`→`'afp'`, `'#C85E00'`→`null`, `null`→`null`.
  - `studentTemplates('root', [root echo, tagged template, untagged folder, room template tagged hz-config-room-class])` returns only the tagged template.
  - `pickV3`: `['M- Apprenti CUI CFC v3', 'M- Apprenti CUI CFC v2']` → the v3 id; `['A v3', 'B v3']` → `null`; `['A v30']` → `null`; `['A v2']` → `null`; `['<p>M - Apprenti·e RES CFC&nbsp;v3</p>']` → its id.
  - `sectionKey({title:'CIE - Suivi&nbsp;', icon:'fa-info', color:'#9ad9ea'})` equals `sectionKey({title:'<b>cie - suivi</b>', icon:'fa-info', color:'#9AD9EA'})`.
  - `normDesc('')`, `normDesc('<p><br></p>')`, `normDesc('  <p><br></p>\n')` all equal; `normDesc('<p>a  b</p>\n')` equals `normDesc('<p>a b</p>')`.
  - `tagFamily('hz-config-skills-enable-Y9sz6viZhHOvYKOEf9XX')` → `'hz-config-skills-enable-'`; `tagFamily('hz-config-suivi-cie')` → `null`.
  - `buildPlan` — skills swap: source section tags `[A, skills-S]`, target `[A, skills-T]`, profile `[A, skills-S, extra]` → `addTags [skills-T]`, `removeTags [skills-S]`; `extra` untouched.
  - `buildPlan` — per-student tag kept: source `[carnet-S]`, target `[carnet-T]`, profile `[carnet-P]` (all 20-char ids) → no section change.
  - `buildPlan` — unpaired: target adds `hz-config-x` (no family counterpart) → added; source-only `hz-config-y` the profile carries → removed.
  - `buildPlan` — other source version: profile carries `skills-OLD` found only on a `sourceOthers` section → removed, `skills-T` added.
  - `buildPlan` — description: source `<p>S</p>`, target `<p>T</p>`; profile `<p>S</p>` → `description {from:'<p>S</p>', to:'<p>T</p>'}`; profile `<p>mine</p>` → `description null, descriptionKept true`; profile `<p>T</p>` → no change; target `''` with profile = source → `to: '<p><br></p>'`.
  - `buildPlan` — source and target descriptions equal, profile hand-edited → no change, `descriptionKept false`.
  - `buildPlan` — already done (profile has target tags, no source tags, target description) → `sections: []`.
  - `buildPlan` — profile section with no target key → in `profileOnly`; target section missing in profile → in `templateOnly`; target section with no source counterpart → no change.
  - `buildPlan` — colour: profile `#1A237E`, toLevel `afp` → `colorChange true, colorTo '#9AD9EA'`; profile already `#9AD9EA` → `colorChange false`, `fromLevel 'cfc'`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/main/services/level-change.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the types and functions above.**
  - `stripTitle` = remove tags, `&nbsp;` → space, collapse whitespace, trim. Reuse `stripHtml` from `room-archive.ts` only if it does exactly this; otherwise local.
  - `normDesc` = trim, collapse runs of whitespace (incl. newlines) to one space, remove whitespace between `>` and `<`; `''` and `<p><br></p>` map to `EMPTY_DESCRIPTION`.
  - `tagFamily` = `/^(.*-)[A-Za-z0-9]{20}$/` → group 1, else `null`.
  - `fromLevel` in the plan = `otherLevel(toLevel)` (the source), also when the live colour already equals the target (finishing run). The caller refuses a colour that `levelOfColor` maps to `null`.
  - Tag swap per matched section (P = profile, T = target, S = source v3, SA = S plus `sourceOthers` sections with the same key):
    ```
    tgtDelta = T.tags − S.tags
    srcDeltaAll = (∪ SA.tags) − T.tags
    for t in tgtDelta:
      fam = tagFamily(t); counterparts = fam ? srcDeltaAll filtered by tagFamily == fam : []
      if counterparts nonempty:
        held = counterparts ∩ P.tags
        if held nonempty: add t (if P lacks it); remove held
        else: nothing                                   // e.g. per-student carnet
      else: add t if P lacks it
    for s in srcDeltaAll with no tgtDelta tag of the same family (or family null and not paired): remove if P carries it
    ```
  - Description rule as in the spec (§ « What changes on a matched section »); compare with `normDesc` against S and every `sourceOthers` section of the same key.
  - Section maps: first entry with an id wins per key (as in the Maintenance tool).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/main/services/level-change.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/level-change.ts src/main/services/level-change.test.ts src/shared/level-change-types.ts docs/specs/2026-11-26-level-change-design.md docs/superpowers/plans/2026-11-26-level-change.md
git commit -m "feat(level-change): pure planning core — template choice, section match, tag swap"
```

---

### Task 2: Orchestrator `runLevelChange`

**Files:**
- Modify: `src/main/services/level-change.ts`
- Modify: `src/main/services/room-archive.ts` (`withRetry` parameter type only)
- Modify: `src/shared/level-change-types.ts`
- Test: `src/main/services/level-change.test.ts`

**Interfaces:**
- Consumes: Task 1; `withRetry`, `failureMessage`, `ApiFailure` from `room-archive.ts`.
- Change `withRetry<T>(deps: ArchiveDeps, …)` to `withRetry<T>(deps: { sleep(ms: number): Promise<void> }, …)` — no behaviour change; room/person archive tests must stay green.
- Produces:
  ```ts
  // level-change-types.ts
  export interface LevelChangeOutcome {
    success: boolean; dryRun: boolean; plan: LevelChangePlan | null;
    applied: number;            // section changes + colour confirmed by the read
    remaining: string[];        // French, one line per unconfirmed change
    error?: string;             // refusal / abort reason, nothing written
  }
  // level-change.ts
  export interface LevelChangeDeps {
    read(id: string): Promise<LcNode | null>;          // null only on 404
    list(parentId: string): Promise<LcNode[]>;          // throws on failure; parent echo removed
    updateDescription(id: string, html: string): Promise<void>;
    updateColor(id: string, hex: string): Promise<void>;
    addTags(id: string, tags: string[]): Promise<void>;
    removeTags(id: string, tags: string[]): Promise<void>;
    sleep(ms: number): Promise<void>;
  }
  export interface LevelChangeInput { profileId: string; toLevel: Level; targetTemplateId: string;
                                      templateRootId: string; dryRun: boolean }
  export async function runLevelChange(input: LevelChangeInput, deps: LevelChangeDeps): Promise<LevelChangeOutcome>;
  ```

- [ ] **Step 1: Write the failing tests** with an in-memory fake deps (a map of nodes; writes mutate it; optional failure injection per call):
  - refuses, nothing written: profile 404 → `error: 'profil introuvable'`; colour `#C85E00` → `error` contains `'niveau'`; target id not a student template with the profile's icon and the target colour → `error` contains `'modèle'`; no single source v3 → `error` contains `'modèle source'`.
  - aborts before any write when `list` throws for the profile, the target, the source or a source-other; and when the profile's or a template's listing is empty → `success false`, write count 0.
  - `dryRun: true` returns the plan, write count 0, `success true`.
  - happy path: tags removed, tags added, descriptions written, then colour; the colour write happens after the last section write (record call order).
  - section write fails with 500 three times but the fake applied it → read shows it → `success true`.
  - section write 2xx but read never shows it → `success false`, colour **not** written, `remaining` names the section title.
  - read-back description differs from the written one only by whitespace → counted as applied.
  - re-run after success → plan has no sections, `colorChange false`, write count 0, `success true`.
  - finishing run: colour already target, one section still old → section changed, colour not rewritten, `success true`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/main/services/level-change.test.ts`
Expected: FAIL — `runLevelChange` not exported.

- [ ] **Step 3: Implement `runLevelChange`.** Order: read profile → `levelOfColor` → `list(templateRootId)` → `studentTemplates` → target (must be among `templatesFor(icon, toLevel)`), source = `pickV3(templatesFor(icon, otherLevel(toLevel)))`, sourceOthers = the rest of that level → list profile and every consulted template (empty = abort, `error: 'liste vide — rien n'a été écrit'`) → `buildPlan` → if dryRun return. Per section: `removeTags`, `addTags`, `updateDescription`, each in `withRetry`, failure caught and kept. Verify: up to 3 `list(profileId)` reads, 750 ms apart, until every section change shows (tags present / absent, `normDesc` equal). All shown → `updateColor` in `withRetry`, verify with up to 3 `read`s. `remaining` lines: `« {title} » : étiquettes non confirmées`, `« {title} » : description non confirmée`, `couleur du profil non confirmée`.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: PASS (room-archive and person-archive tests included).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/level-change.ts src/main/services/level-change.test.ts src/main/services/room-archive.ts src/shared/level-change-types.ts
git commit -m "feat(level-change): orchestrator with live verification, colour last"
```

---

### Task 3: IO layer, checked update, IPC

**Files:**
- Modify: `src/main/services/hazu-api/api.ts` (add `sendApiRequestUpdateChecked`)
- Create: `src/main/services/level-change.service.ts`
- Modify: `src/shared/ipc-channels.ts`, `src/main/preload.ts` (constants are duplicated there — add both), `src/main/ipc/index.ts`
- Modify: `src/shared/level-change-types.ts`

**Interfaces:**
- Consumes: Task 2; `setting`, `toError` from `room-archive.service.ts`; `normalizeRow` from `formation/parse.ts`; `withArchiveLock` from `archive-lock.ts`; `getSyncProgress` from `sync.service.ts`; `sendApiRequestReadChecked`, `sendApiRequestListChecked`, `sendApiRequestAddTagsChecked`, `sendApiRequestRemoveTagsChecked` (returns a result — throw an `ApiFailure` when `ok` is false).
- Produces:
  ```ts
  // api.ts — PUT /update?id=…, rethrows, timeout 60_000; body has only the given keys, color upper-cased
  export const sendApiRequestUpdateChecked: (id: string, body: { description?: string; color?: string }) => Promise<void>;
  // level-change-types.ts
  export interface LevelChangeStudent { id: string; displayName: string; icon: string | null; color: string | null; level: Level | null }
  export interface LevelChangeCandidates { currentLevel: Level; toLevel: Level; templates: TemplateRef[]; preselectedId: string | null }
  // level-change.service.ts
  export function listLevelChangeStudents(): LevelChangeStudent[];   // local persons, person_type='student', ORDER BY display_name
  export async function levelChangeCandidates(personId: string): Promise<LevelChangeCandidates>; // live read; throws Error in French
  export async function planLevelChange(personId: string, toLevel: Level, targetTemplateId: string): Promise<LevelChangeOutcome>;   // dryRun true
  export async function executeLevelChange(personId: string, toLevel: Level, targetTemplateId: string): Promise<LevelChangeOutcome>;
  // IPC (channel → preload method)
  LEVEL_CHANGE_STUDENTS: 'levelChange:students'       → getLevelChangeStudents()
  LEVEL_CHANGE_CANDIDATES: 'levelChange:candidates'   → getLevelChangeCandidates(personId)
  LEVEL_CHANGE_PLAN: 'levelChange:plan'               → planLevelChange(personId, toLevel, targetTemplateId)
  LEVEL_CHANGE_EXECUTE: 'levelChange:execute'         → executeLevelChange(personId, toLevel, targetTemplateId)
  ```

- [ ] **Step 1: Implement `sendApiRequestUpdateChecked`** beside the other `*Checked` calls, same headers as `sendApiRequestUpdate`.
- [ ] **Step 2: Implement the service.** Deps from the real calls (axios 404 on read → `null`; other errors → `ApiFailure` like `toFailure` in room-archive.service.ts — export it there rather than copy). `templateRootId` = `setting('template_id')`; empty → `Error('modèles introuvables — synchronisez d'abord')`. `executeLevelChange`: refuse with `error: 'synchronisation en cours — réessayez ensuite'` when `getSyncProgress().status === 'syncing'`; otherwise run inside `withArchiveLock`. On `success` and no sync running, `UPDATE persons SET color = ? WHERE id = ?` with the target colour, in its own try/catch. One log line: `[level-change] profile=… to=… success=… applied=… remaining=n`.
- [ ] **Step 3: Wire the four IPC handlers** (`PLAN`/`CANDIDATES`/`STUDENTS` rethrow so the page shows the error; `EXECUTE` returns the outcome) and the preload methods + `Window` types.
- [ ] **Step 4: Type-check and test**

Run: `npx tsc -p tsconfig.main.json --noEmit && npx vitest run`
Expected: no errors, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/hazu-api/api.ts src/main/services/level-change.service.ts src/main/services/room-archive.service.ts src/shared/ipc-channels.ts src/shared/level-change-types.ts src/main/preload.ts src/main/ipc/index.ts
git commit -m "feat(level-change): IO layer, checked update, IPC"
```

---

### Task 4: Mode registration and Task Queue task

**Files:**
- Modify: `src/shared/app-mode.ts`, `src/shared/app-mode.test.ts`
- Modify: `src/renderer/contexts/TaskQueueContext.tsx`, `src/renderer/components/TaskQueuePanel.tsx` (label only)

**Interfaces:**
- Produces: `PageId` gains `'tools'` (in `ALL_PAGES` before `'settings'`); `TaskType` gains `'levelChange'` (in `ALL_TASK_TYPES`, not in CIE lists). Queue method `addLevelChangeTask({ personId: string; displayName: string; toLevel: Level; targetTemplateId: string; onDone?: () => void })`.

- [ ] **Step 1: Update `app-mode.test.ts`** — complete pages list includes `'tools'` before `'settings'`; `visiblePages('cie')` unchanged; `allowedTaskTypes('complete')` contains `'levelChange'`, `allowedTaskTypes('cie')` does not.
- [ ] **Step 2: Run** `npx vitest run src/shared/app-mode.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the app-mode entries and the task, modelled on `archivePerson`: call `window.electronAPI.executeLevelChange`; `success false` → task error = `outcome.error ?? outcome.remaining.join(' · ')`. Panel label: `Changement de niveau — {displayName} → {CFC|AFP}`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -p tsconfig.json --noEmit` — Expected: PASS, no errors.
- [ ] **Step 5: Commit** `feat(level-change): register tools page and levelChange task (complete mode only)`.

---

### Task 5: « Outils » page and « Changement de niveau » section

**Files:**
- Create: `src/renderer/pages/ToolsPage.tsx`
- Create: `src/renderer/components/tools/LevelChangeSection.tsx`
- Create: `src/renderer/components/tools/level-change-logic.ts`, test `level-change-logic.test.ts`
- Modify: `src/renderer/App.tsx` (route `'tools'`), `src/renderer/components/layout/Sidebar.tsx` (nav « Outils », icon `faToolbox`)

**Interfaces:**
- Consumes: Task 3 preload methods, Task 4 `addLevelChangeTask`.
- Produces (pure, tested):
  ```ts
  export function searchStudents(all: LevelChangeStudent[], query: string): LevelChangeStudent[]; // < 2 chars → []; lower-case, accents stripped, every query word in the name
  export function eligibility(s: LevelChangeStudent): { ok: true; toLevel: Level } | { ok: false; reason: string }; // reason 'niveau ni CFC ni AFP'
  export function levelLabel(l: Level): 'CFC' | 'AFP';
  ```

- [ ] **Step 1: Write tests** for the three functions: `'ab'` matches « Abc Def » and « déf abc » (accent stripped); `'a'` → `[]`; CFC student → `{ ok: true, toLevel: 'afp' }`; colour `#C85E00` → `ok false`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/components/tools` — Expected: FAIL.
- [ ] **Step 3: Implement the logic, then the UI.** Page = one card « Changement de niveau » (Tailwind, like ArchivePage sections). Flow: search → pick (not-eligible greyed with reason) → `getLevelChangeCandidates` → show « {CFC} → {AFP} », template `<select>` (preselected `preselectedId`; empty option « choisir un modèle » when null) → « Aperçu » → `planLevelChange` → preview lists: templates consulted, per section the tags `+`/`−` and « description remplacée », « modifiée à la main — non changée » lines, sections only in the profile / only in the template, colour change (plus « couleur locale différente de Hazu » when `plan.colorFrom` ≠ the student's local colour, case-insensitive), and the fixed note « Les classes et rôles ne changent pas — déplacez l'élève dans Matrix. » → « Appliquer » (disabled until a preview with ≥ 1 change exists for the same student and template) → `addLevelChangeTask`, and when done reload the student list. A plan/candidates answer for a student no longer selected is discarded.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -p tsconfig.json --noEmit && npm run build` — Expected: PASS, build succeeds.
- [ ] **Step 5: Commit** `feat(level-change): Outils page with the level-change section`.

---

### Task 6: Documentation and acceptance

**Files:**
- Modify: `CLAUDE.md` — project-structure entries for the new files and pages; new section « Outils — level change » (what it changes, the tag swap and description rules, colour last, success rule, lock, non-goals: no class move, no copy/delete); add 7e to « Testing the App ».

- [ ] **Step 1: Write the CLAUDE.md section** (no names or ids of real persons).
- [ ] **Step 2: Run the guards** `python3 scripts/check-no-person-data.py --all` — Expected: no findings.
- [ ] **Step 3: Full verification** `npx vitest run && npm run build` — Expected: PASS.
- [ ] **Step 4: Commit** `docs: Outils tab and level change`.
- [ ] **Step 5: Hand over the acceptance run to Urs** (scratch userData copy): switch a test student CFC → AFP, preview, apply, compare the profile's sections with « M- Apprenti CUI AFP v3 » in Hazu (tags, three descriptions, own carnet tag intact, colour), check Missions shows AFP; switch back.
