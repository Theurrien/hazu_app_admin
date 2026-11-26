# Level change — operator decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator tick uncertain changes and three extra actions (copy template-only
sections with correct access, delete profile-only sections, add the widget) in the level-change
preview, applied in one verified run.

**Architecture:** Extends the existing pure core `src/main/services/level-change.ts` with a
decisions input and new run steps, split into focused pure modules (`level-change-copy.ts` for the
copy walk and access alignment, `level-change-extra.ts` for deletes and the widget), each with IO
injected and vitest tests. The service resolves the student's account id and the role-group map,
and wires new checked API calls. The renderer adds tick boxes, an « Actions supplémentaires » block
and a delete confirmation, and sends the decisions with the task.

**Tech Stack:** TypeScript, Electron (main), React + Tailwind, vitest, axios.

**Spec:** [docs/specs/2026-11-26-level-change-decisions-design.md](../../specs/2026-11-26-level-change-decisions-design.md)
(extends [docs/specs/2026-11-26-level-change-design.md](../../specs/2026-11-26-level-change-design.md))

## Global Constraints

- Only uncertain items get a box: family-absent tag adds (default ticked), « modifiée à la main »
  descriptions (default unticked, « remplacer quand même »). Clear swaps and template-equal
  descriptions apply without a box, as today.
- Actions: copy template-only sections (default ticked); delete profile-only sections (default
  unticked, separate confirmation with the descendant count and « irréversible »); widget (default
  ticked when needed).
- Decisions are **positive lists** keyed by section key (title|icon|colour as `sectionKey`) plus tag
  / section id — never by position. At execute the run re-plans live; an uncertain item not in the
  decisions is skipped and reported « non vu à l'aperçu — ignoré »; a decision with no matching item
  is reported « décision sans objet — ignorée ».
- Run order: tag swaps + descriptions → copies (+ access alignment) → deletes → widget → colour last,
  only when every earlier step is confirmed. Anything unconfirmed → `success:false`, named in
  `remaining`, colour not written.
- Copy: all fields kept (type, title, description, icon, colour, privacy, **all tags as they are**,
  incl. `hz-config-legend`, and `event.rolesSettings`); children recursively (max depth 20, cycle
  guard). Verified: section present by key and subtree item count equal to the template's. A
  partial copy is removed again by the run and fails it. After a create that times out, re-list and
  match by key/title before any resend.
- Access on every copied node (inherited from the profile): for `hz-invite-self-{role}`, raise the
  student to that role if lower (never lower). Role groups (`groupId` in `distribution_groups`) stay
  only where `hz-share-{role}-{aclRole}` names their role, set to exactly `aclRole`; other role
  groups removed. Owner/admin groups (no `distribution_groups` match) and persons other than the
  student never touched. Verified by re-reading the node's ACL.
- Role order: `reader` < `editor` < `admin` < `owner`.
- ACL principal for set-role / remove: the entry's `authorId` (as S6 removes group-held room-item
  grants); the read-back decides success.
- Delete: re-read, must still be a direct child of the profile and still profile-only; Hazu removes
  the subtree. Verified: gone from the listing. Descendant count: bounded walk (depth 6, 500 nodes),
  « au moins N » when cut short, `null` when the section's own listing fails — never shown smaller.
- Widget: present when the profile description contains `student_app.html` (then nothing). Else empty
  description → template root description written; non-empty → template root description appended.
  Verified: read-back contains `student_app.html`.
- The three actions follow the template the operator picked.
- Transient (5xx / network / timeout) retries via `withRetry`; 4xx fails fast. Verify reads: up to 3,
  750 ms apart.
- No real person data in tracked files; logs carry profile ids only. Do not start Electron against the
  real DB (tests and build only).
- Renderer `tsc -p tsconfig.json` has 9 pre-existing errors (RoomsPage, SettingsPage, fuzzyMatch): the
  count must stay 9.

## Review Focus

1. A profile that changed between preview and Appliquer (a section renamed, a new template section)
   must not receive a decision meant for something else, nor an unseen copy. → tests in Task 1 and 4.
2. A copy whose create timed out but landed must not produce a duplicate section. → test in Task 2.
3. A role group present with the right role must not be removed and re-added (no needless writes). →
   test in Task 2.
4. The student's identity unresolved (identity tag holds an e-mail not on the profile ACL) → grants
   reported unconfirmed, colour withheld, copies kept. → test in Task 4.
5. A profile-only section that holds the student's work: the count shown must never be smaller than
   the truth (failed sub-listing → « au moins N » / unknown). → test in Task 3.

---

### Task 1: Decisions model, plan additions, decided tag and description changes

**Files:**
- Modify: `src/shared/level-change-types.ts`, `src/main/services/level-change.ts`
- Create: `src/shared/level-change-decisions.ts`, test `src/shared/level-change-decisions.test.ts`
- Test: `src/main/services/level-change.test.ts`

**Interfaces:**
- Produces (types):
  ```ts
  export interface LevelChangeDecisions {
    acceptedTagAdds: Array<{ sectionKey: string; tag: string }>;
    forcedDescriptions: string[];                       // section keys
    copySections: string[];                             // template section keys
    deleteSections: Array<{ sectionKey: string; sectionId: string }>;
    addWidget: boolean;
  }
  // SectionChange gains:  sectionKey: string; uncertainTags: string[]  (⊆ addTags, family-absent adds);
  //                       keptTargetDescription: string | null         (value to write if forced)
  // LevelChangePlan gains:
  //   templateOnlyItems: Array<{ sectionKey: string; title: string; templateSectionId: string }>;
  //   profileOnlyItems: Array<{ sectionKey: string; title: string; sectionId: string;
  //                             descendants: number | null; descendantsExact: boolean }>;
  //   widget: { needed: boolean; profileEmpty: boolean };
  // LevelChangeOutcome gains: ignored: string[]   (unseen items + decisions without object)
  ```
  `profileOnly` / `templateOnly` string arrays stay. `descendants` is filled by Task 3 (Task 1
  sets `null`, `descendantsExact: false`).
- Produces (`src/shared/level-change-decisions.ts`, pure):
  `defaultDecisions(plan: LevelChangePlan): LevelChangeDecisions` — all uncertain tags accepted, no
  forced description, every template-only section copied, no delete, `addWidget = plan.widget.needed`.
  `isWidgetPresent(description: string): boolean` — contains `student_app.html`.
- Produces (core): `runLevelChange(input, deps)` gains `input.decisions?: LevelChangeDecisions`
  (required when `dryRun` is false; dry run ignores it). Export `sectionKey` already exists.

- [ ] **Step 1: Write failing tests** — `defaultDecisions` on a plan with 2 uncertain tags, 1 kept
  description, 2 template-only, 1 profile-only, widget needed → exactly the defaults above;
  `isWidgetPresent` true/false. Core: dry-run plan marks a family-absent add in `uncertainTags` and a
  swap not; kept section carries `keptTargetDescription`; `templateOnlyItems`/`profileOnlyItems` carry
  keys and ids; `widget.needed` false when the profile description contains `student_app.html`,
  `profileEmpty` true on `''`/`<p><br></p>`. Execute: an uncertain add not in `acceptedTagAdds` is
  not written and appears in `ignored` (« non vu à l'aperçu — ignoré »); an accepted one is written;
  a `forcedDescriptions` key writes `keptTargetDescription`; a decision naming a key the live plan
  lacks lands in `ignored` (« décision sans objet — ignorée »); clear swaps still applied with empty
  decisions; `dryRun: false` without `decisions` → refusal `error`, zero writes.
- [ ] **Step 2: Run** `npx vitest run src/shared/level-change-decisions.test.ts src/main/services/level-change.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the types, `level-change-decisions.ts`, the plan additions in `buildPlan`
  (`widget` from `input.target.ref.description` vs `input.profile.description`), and the decision
  filter in `runLevelChange` before the section writes (verification only checks what was written).
- [ ] **Step 4: Run** the same tests, then `npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(level-change): decisions model, uncertain items, decided tags and descriptions`
  (include the spec addendum and this plan).

---

### Task 2: Copy walk and access alignment (pure)

**Files:**
- Create: `src/main/services/level-change-copy.ts`, test `src/main/services/level-change-copy.test.ts`

**Interfaces:**
- Consumes: `withRetry`, `ApiFailure` (room-archive.ts); `sectionKey`, `stripTitle` (level-change.ts).
- Produces:
  ```ts
  export interface CopyNode { id: string; parentId: string | null; type: string; title: string;
    description: string; icon: string | null; color: string | null; privacy: string | null;
    tags: string[]; rolesSettings: unknown | null }
  export interface AclRow { authorId: string; groupId: string | null; isGroup: boolean; role: string }
  export interface CopyDeps {
    readFull(id: string): Promise<CopyNode | null>;
    listFull(parentId: string): Promise<CopyNode[]>;            // parent echo removed; throws on failure
    create(parentId: string, from: CopyNode): Promise<string>;  // new id; throws ApiFailure
    remove(id: string): Promise<void>;
    acl(id: string): Promise<AclRow[]>;
    setRole(itemId: string, principalId: string, role: string): Promise<void>;
    removeFromAcl(itemId: string, principalId: string): Promise<void>;
    sleep(ms: number): Promise<void>;
  }
  export const ROLE_RANK: Record<string, number>;   // reader 1, editor 2, admin 3, owner 4
  export function inviteRole(tags: string[]): string | null;              // hz-invite-self-{role}
  export function shareRoles(tags: string[]): Map<string, string>;        // hz-share-{role}-{aclRole}: role → aclRole
  export interface AclFix { raiseStudent: string | null; setGroups: Array<{ principalId: string; role: string }>;
                            removeGroups: string[] }
  export function planAclFix(rows: AclRow[], tags: string[], roleGroups: Map<string, string>,
                             studentId: string | null): AclFix;
  export function aclMatches(rows: AclRow[], tags: string[], roleGroups: Map<string, string>,
                             studentId: string | null): boolean;
  export interface CopyResult { ok: boolean; newId: string | null; problems: string[] }
  export async function copySection(templateSectionId: string, profileId: string, deps: CopyDeps,
    roleGroups: Map<string, string>, studentId: string | null): Promise<CopyResult>;
  ```
  `roleGroups`: distribution-group id → role (`schoolteacher`, `companymentor`, …). A row is a role
  group when `isGroup && groupId && roleGroups.has(groupId)`; `principalId` = `authorId`.

- [ ] **Step 1: Write failing tests:**
  - `inviteRole(['hz-invite-self-admin'])` → `'admin'`; none → `null`. `shareRoles(['hz-share-companymentor-editor','hz-share-schoolteacher-reader'])` → `{companymentor:'editor', schoolteacher:'reader'}`.
  - `planAclFix`: student reader + tag invite admin → `raiseStudent 'admin'`; student admin + invite reader → `null` (never lower); studentId null + invite tag → `raiseStudent null` and `aclMatches` false; role group schoolteacher reader with no share tag → in `removeGroups`; role group companymentor reader with `hz-share-companymentor-editor` → in `setGroups` as editor; same group already editor → no write; owner group (groupId not in map) → untouched; another person → untouched.
  - `copySection`: copies a 2-level subtree with every field (tags incl. `hz-config-legend`, `rolesSettings`) to the right parents; verifies subtree count; applies `planAclFix` on every copied node and re-reads ACL; returns `ok`.
  - A child create failing (4xx) → the run removes the fresh top-level copy, `ok false`, problem « copie incomplète — supprimée, à refaire ».
  - A top-level create throwing a timeout but landing → the profile is re-listed, the section found by title+icon+colour, no second create (assert create called once).
  - ACL fix not confirmed after 3 reads → `ok false`, problem names the node title; copy kept.
- [ ] **Step 2: Run** `npx vitest run src/main/services/level-change-copy.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Copy order: create the node, then its children depth-first (max depth 20,
  visited set); after the whole subtree exists, count it against the template's; then the ACL pass
  top-down. Every deps call through `withRetry`.
- [ ] **Step 4: Run** the test file, then `npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(level-change): copy walk with access alignment`.

---

### Task 3: Deletes and widget (pure)

**Files:**
- Create: `src/main/services/level-change-extra.ts`, test `src/main/services/level-change-extra.test.ts`

**Interfaces:**
- Consumes: `withRetry`; `LcNode`, `sectionKey` (level-change.ts); `isWidgetPresent` (shared decisions).
- Produces:
  ```ts
  export async function countDescendants(id: string, list: (id: string) => Promise<LcNode[]>,
    budget: { remaining: number }): Promise<{ total: number | null; exact: boolean }>;   // depth 6, shared budget 500
  export async function deleteSection(profileId: string, item: { sectionKey: string; sectionId: string },
    targetKeys: Set<string>,
    deps: Pick<LevelChangeDeps, 'read' | 'list' | 'sleep'> & { remove(id: string): Promise<void> },
  ): Promise<{ ok: boolean; problem: string | null }>;
  export function widgetDescription(profileDesc: string, templateRootDesc: string): string;  // empty → template; else profile + template
  ```
- [ ] **Step 1: Write failing tests:** `countDescendants` exact on a 3-level tree; a failing sub-listing →
  `exact false`, total ≥ counted; own listing failing → `total null`; budget exhausted → `exact false`.
  `deleteSection`: removes and verifies gone; node whose parent is not the profile → not removed,
  problem; node whose key is now in `targetKeys` (no longer profile-only) → not removed; remove 500 but
  gone on re-list → `ok`. `widgetDescription('', T)` → `T`; `('<p>x</p>', T)` → `'<p>x</p>' + T`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/level-change-extra.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, then `npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(level-change): delete with re-check and descendant count, widget text`.

---

### Task 4: Run order in the orchestrator

**Files:**
- Modify: `src/main/services/level-change.ts`, `src/main/services/level-change.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- `LevelChangeDeps` becomes `LevelChangeDeps & CopyDeps & { remove(id: string): Promise<void> }`
  (one deps object; `read`/`list` stay as they are). `LevelChangeInput` gains
  `roleGroups: Map<string, string>` and `studentId: string | null`.
- Dry run fills `profileOnlyItems[].descendants` via `countDescendants` (one shared budget).

- [ ] **Step 1: Write failing tests** (extend the existing fake world with a template-only section with a
  child, a profile-only section, an empty profile description and ACL rows): full run with
  `defaultDecisions` + one delete → call order sections → creates → acl writes → remove → description
  update → colour; a failed copy → colour not written, `remaining` names it; a failed delete → same;
  studentId null with an invite-tagged copied node → grant unconfirmed, colour withheld, copy kept;
  a template-only section that appeared after the preview (not in `copySections`) → not copied, in
  `ignored`; a delete decision for a section that is no longer profile-only → skipped, in `ignored`;
  re-run after success → zero writes, `success true`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/level-change.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the steps after the section writes, each confirmed before the next; colour
  last as today.
- [ ] **Step 4: Run** `npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(level-change): run copies, access, deletes and widget before the colour`.

---

### Task 5: IO layer and IPC

**Files:**
- Modify: `src/main/services/hazu-api/api.ts`, `src/main/services/level-change.service.ts`,
  `src/main/ipc/index.ts`, `src/main/preload.ts`, `src/renderer/contexts/TaskQueueContext.tsx`

**Interfaces:**
- Produces (api.ts, all rethrow, timeout 60_000): `sendApiRequestCreateFullChecked(options: { parentId,
  type, title, description, icon, color, privacy, tags, authorId, displayName, rolesSettings? }): Promise<string>`
  (returns the new id from `key | snapshot.key | id | data.key`); `sendApiRequestSetAclRoleChecked(userId,
  itemId, role)` (PUT /acl); removal reuses `sendApiRequestRemoveUserChecked(itemId, userId)` (throw an
  `ApiFailure` when `ok` is false). Reading the raw node for `rolesSettings` / `privacy`: from
  `sendApiRequestReadChecked` / `sendApiRequestListChecked` raw rows (`snapshot.event.rolesSettings`,
  `snapshot.privacy`).
- Service: `roleGroupMap(): Map<string,string>` from `SELECT id, role FROM distribution_groups`;
  `resolveStudentId(personId, profileAcl): string | null` — identity tag (`persons.email`) used as is
  when it has no `@`, else the profile ACL entry whose `description` equals it (case-insensitive) →
  its `authorId`; `authorId`/`displayName` for creates from settings `user_id` / `user_display_name`.
- IPC/preload: `executeLevelChange(personId, toLevel, targetTemplateId, decisions: LevelChangeDecisions)`;
  the Task Queue task carries `decisions`. Plan unchanged.
- [ ] **Step 1: Implement** the API calls, deps, resolution and wiring.
- [ ] **Step 2: Run** `npx tsc -p tsconfig.main.json --noEmit && npx vitest run` — Expected: clean, PASS.
- [ ] **Step 3: Commit** `feat(level-change): checked create/ACL calls, student id, decisions over IPC`.

---

### Task 6: Preview with decisions

**Files:**
- Modify: `src/renderer/components/tools/LevelChangeSection.tsx`, `src/renderer/components/tools/level-change-logic.ts` (+ test)
- Create: `src/renderer/components/tools/DeleteSectionsConfirmModal.tsx`

**Interfaces:**
- Consumes: `defaultDecisions`, `LevelChangeDecisions` (shared).
- Produces (pure, tested): `hasApplicableChange(plan, decisions)` — true when a certain change exists,
  or any accepted uncertain tag, forced description, copy, delete, or widget; `toggle…` helpers if
  useful.
- [ ] **Step 1: Tests** for `hasApplicableChange` with decisions (only a kept description unticked → false;
  ticked → true; only a copy → true).
- [ ] **Step 2: Run** `npx vitest run src/renderer/components/tools` — Expected: FAIL.
- [ ] **Step 3: Implement.** A box beside each `uncertainTags` tag (label « ajouter (pas de tag de ce
  type sur le profil) ») and each kept description (« remplacer quand même »); block « Actions
  supplémentaires »: « Copier les sections manquantes » (one box per template-only section), « Supprimer
  les sections seulement dans le profil » (one box per section, with « {n} éléments » / « au moins {n} » /
  « contenu inconnu »), « Ajouter le widget à la description du profil » (shown only when needed).
  Ticking a delete opens the modal: section titles, counts, « irréversible — tout le contenu est
  supprimé », Confirmer / Annuler (Annuler unticks). Decisions reset to `defaultDecisions` on every new
  preview; « Appliquer » sends them.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -p tsconfig.json --noEmit && npm run build` — Expected: PASS, 9 renderer errors, build OK.
- [ ] **Step 5: Commit** `feat(level-change): decisions in the preview, delete confirmation`.

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md` (« Outils — level change »: decisions, actions, run order, access rule, limits;
  step 7e: the acceptance below)

- [ ] **Step 1: Write** the section updates (no person data).
- [ ] **Step 2: Run** `python3 scripts/check-no-person-data.py --all && npx vitest run && npm run build` — Expected: clean.
- [ ] **Step 3: Commit** `docs: level-change decisions`.
- [ ] **Step 4: Hand over the acceptance run** (scratch userData copy, the same test profile, now CFC):
  preview → copy « Boîte de guidance » and « Learning FSRS », delete « Navigation » (check the count
  first), add the widget → Appliquer → compare with the CFC v3 template; read the copied sections' ACL:
  student admin on « Learning FSRS », role groups only as the share tags say, owner groups intact.
