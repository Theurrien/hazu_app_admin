# Level change — failure report and profile link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the failed run's report under « Aperçu / Appliquer », with a hint for the group-role case and an « Ouvrir le profil dans Hazu » button in both reports.

**Architecture:** Pure display decisions in `level-change-logic.ts` (tested); one shared, environment-aware URL builder used by the Task Queue and the Outils report; `LevelChangeSection.tsx` renders the report in two places depending on success.

**Tech Stack:** React + Tailwind, vitest.

**Spec:** [docs/specs/2026-11-26-level-change-failure-report-design.md](../../specs/2026-11-26-level-change-failure-report-design.md)

## Global Constraints
- Failure header: « Changement non terminé — {student} »; replaces « Échec — voir la file des tâches, puis refaire l'aperçu. ».
- Hint (group-role lines only): « Réessayer ne corrige pas ceci : réglez le rôle dans Hazu, puis Réessayer pour écrire la couleur. »
- Button: « Ouvrir le profil dans Hazu »; base URL swiss → `https://hazu.swiss`, io → `https://hazu.io`, dev → `https://dev.hazu.swiss`, then `/{profileId}`.
- Renderer tsc stays at 9 pre-existing errors. No person data in files.

## Review Focus
1. A failure without an outcome (the call threw): the header still reads « Changement non terminé », with the error text, and the button still works. → test in Task 1.
2. A report for student A while student B is selected: the failure report belongs to A — render it under the student block only when the selected student is A, else at the top as today. → covered in Task 1 step 3.

---

### Task 1: Failure report placement, hint, profile button

**Files:**
- Modify: `src/renderer/components/tools/level-change-logic.ts`, `level-change-logic.test.ts`, `LevelChangeSection.tsx`, `src/renderer/components/TaskQueuePanel.tsx`
- Create: `src/renderer/utils/hazu-url.ts` (+ `hazu-url.test.ts`)

**Interfaces:**
- `hazuItemUrl(env: string | undefined, id: string): string` in `hazu-url.ts`.
- `LevelChangeResultView` gains `personId: string`; `resultView(outcome, personId, failure?)`; failure headline « Changement non terminé » (+ « — {error} » when present).
- `GROUP_ROLE_HINT` (the exact hint) and `hintFor(line: string): string | null` → the hint when the line starts with « rôle du groupe » and contains « à ajuster à la main », else null.

- [ ] **Step 1: Failing tests** — `hazuItemUrl('swiss','X')` → `https://hazu.swiss/X`, `('io','X')` → `https://hazu.io/X`, `('dev','X')` → `https://dev.hazu.swiss/X`, `(undefined,'X')` → swiss; `resultView(null,'P','boom').headline` → `Changement non terminé — boom`, `.personId` → `P`; failed outcome headline starts with `Changement non terminé`; `hintFor('rôle du groupe companymentor à ajuster à la main sur « X »')` → `GROUP_ROLE_HINT`; `hintFor('« X » : copie non confirmée')` → null.
- [ ] **Step 2: Run** `npx vitest run src/renderer` — FAIL.
- [ ] **Step 3: Implement.** TaskQueuePanel `handleOpen` uses `hazuItemUrl`. `LevelChangeResult` shows the hint under matching lines and the button (`getApiConfig()` → `openExternal(hazuItemUrl(env, personId))`). In `LevelChangeSection`: on failure, render the report under the buttons when `result.personId === selected?.id` (replacing the « Échec — voir… » line), else at the top as today; success unchanged.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -p tsconfig.json --noEmit 2>&1 | grep -c "error TS"` (9) `&& npm run build` — PASS.
- [ ] **Step 5: Commit** `feat(level-change): failure report under Appliquer, group-role hint, open profile in Hazu`.
