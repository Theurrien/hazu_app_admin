# Outils tab — level change (CFC ↔ AFP) — design

Date: 2026-11-26. Status: ready for approval.

## Intent

Apprentices sometimes start in CFC and switch to AFP, or the other way round. Today this is
done with the Formation Change tool in the separate Hazu-App-Maintenance project
(`workflows/formation-change.ts`): the operator pastes a profile id and a template id, the tool
compares the profile's children with the template's and syncs them.

The Admin App already knows everything that tool asks for: the student list, each student's
formation and level (profile icon and colour), and where the templates live. The level change
moves into the app so it needs no ids typed in, runs through the Task Queue, and is held to the
app's rule that **a live read decides success, not the status code**.

It is the first tool of a new **« Outils »** tab meant to collect small but important helper
functions; others from the Maintenance project will be added there one at a time, when needed.

## Goals

- Pick a student from the synced list; the app proposes the target level and the target template.
- Preview exactly what will change (dry run), then apply it as one Task Queue task.
- After the change, Missions, Matrix and Persons show the new level without a re-sync.

## Non-goals

- Changing the **formation** (CUI ↔ RES ↔ DHI). Only the level changes; the icon stays.
- Moving the student between **classes** (e.g. CUI-C → CUI-A) or changing any room role. That
  stays in Matrix, by hand. The tool's result says so.
- Deleting anything. Sections found only on the profile are listed, never removed. The
  Maintenance delete step does not come over.
- Syncing the profile's own description or title (identical across levels in v3 — checked below).
- Students whose colour is neither CFC nor AFP (`#C85E00`, `#22B14C`, …): listed as not
  eligible, no action.

## Anti-goals (a failure even if it "works")

- Losing a tag a section carries for that student only (the Maintenance tool removes **all** tags
  of a changed section and re-adds the template's).
- Reporting success when a write did not land, or failure when it did.
- Ever writing the wrong level's template onto a profile because a template could not be read.

## What a level change is (measured 2026-11-26, read-only)

Templates are the children of the `template_id` setting tagged `hz-config-profile-student`.
Formation = icon (`fa-carrot` CUI, `fa-glass` RES, `fa-industry` DHI), level = colour
(`#1A237E` CFC, `#9AD9EA` AFP) — the same maps Missions reads (`professionsByIcon`,
`levelsByColor`). Each formation × level has **several** templates: a `v3` one plus an older
`v2` / `v2.0` / unversioned one.

Comparing « M- Apprenti CUI CFC v3 » with « M- Apprenti CUI AFP v3 »:

- 14 children each; all 14 match on title + icon + colour. Nothing to copy, nothing left over.
- 6 children differ in tags only by level-specific pointers (`hz-config-skills-enable-{id}`,
  `hz-config-carnet-{id}`): Le suivi de ma formation, Mandats CIE, Mandats école, CIE - Suivi,
  Mandats entreprise, Mon bloc-notes.
- 3 of those also differ in description: Mandats entreprise, Mandats CIE, Mandats école.
- The template roots differ **only in colour**; tags, description, icon identical.

So a v3 → v3 level change = swap those tags, replace those descriptions, set the profile colour.

Three real CUI CFC profiles compared with « M- Apprenti CUI CFC v3 » (read-only, 2026-11-26):

- Two match it section for section. Their `hz-config-skills-enable-*` tags equal the template's
  exactly: those pointers are per level, shared by every student.
- Their « Mon bloc-notes » carries a `hz-config-carnet-{id}` that is **different for every
  student** and not the template's: that pointer is per student (like the timeline pointer).
- Profiles carry extra tags the template lacks (`hz-config-suivi-cie` on CIE - Suivi,
  `hz-share-courseteacher-reader` on Retour d'évaluations…), and lack some it has
  (`hz-invite-self-admin` on Learning FSRS).
- The third profile (older layout) has 3 sections the template lacks, lacks 2 it has, and has
  hand-edited descriptions (Dossier de formation holds 2.7 k of the student's own text; Mandats
  école differs from the template).

Consequence: the change must apply **only the difference between the two levels' templates**,
never "make the profile equal the target template".

## Approaches considered

- **A — Port the logic into the app, adapted (chosen).** Pure core + thin IO layer, one Task
  Queue task, verified by re-reading. Tags are swapped against the old level's templates so
  student-specific tags survive. Chosen because it meets the app's success rule and the tag
  anti-goal.
- **B — Call the Maintenance server over HTTP.** Needs that server running, bypasses the Task
  Queue and the verification. Dropped.
- **C — Port the Maintenance code as is.** Quickest, but its replace-all-tags step loses
  student-specific tags and it trusts the status code. Dropped.

## Decided

### Template choice
- Target template = the student template whose icon equals the student's icon and whose colour is
  the other level's. **Always the `v3` one, preselected** in a dropdown that lists every matching
  template (title shown), so an operator can see and, deliberately, change it.
- "v3" = the template whose (HTML-stripped) title contains `v3` as a word. If none or more than
  one match, nothing is preselected and the operator must choose.

### Matching sections
- Direct children only, matched on **title (case-insensitive, HTML and `&nbsp;` stripped) + icon
  + colour**, as in the Maintenance tool. Colour is part of the key.
- The parent echo (`/readChildren` returning the parent) is filtered; an id-less entry is
  reported, never acted on. A failed or empty listing of the profile or of a template aborts the
  run before any write (an empty list is never proof of absence).
- Duplicate keys on the template side: first entry with an id wins (as in Maintenance).

### Source template
- The **source** = the current level's template of the same formation, `v3` (chosen by the same
  rule as the target). The other versions of the current level are read too, for the removal set.
- Every one of these templates must be listed successfully, or the run aborts before any write.
  The preview names the templates consulted.

### What changes on a matched section — the level delta only
Normalised comparison everywhere = HTML whitespace collapsed, trimmed, empty and `<p><br></p>`
equal. The same normaliser is used to verify.
- **Description**: changed only when the source and target sections' descriptions differ. Then
  it is replaced **only if the profile's equals the source's** (or another version of the
  current level). Otherwise it was edited for this student: listed as « modifiée à la main —
  non changée » and left alone. An empty target is written as `<p><br></p>`.
- **Tags — update, don't rebuild** (decided by Urs, 2026-11-26: a tag that is not on the template
  is never touched; a template tag whose id differs between the levels is updated):
  - A tag's *family* is the tag without its trailing id (`hz-config-skills-enable-{id}` →
    `hz-config-skills-enable-`). The level delta of a section is the set of source tags missing
    from the target, and target tags missing from the source.
  - **Swap**: a delta tag of the source (on any current-level template version) that the
    profile carries is removed and replaced by the target's tag of the same family. If the
    profile does not carry the source's tag, that family is left alone: nothing is added.
    This is what keeps the per-student `hz-config-carnet-{id}` intact. The template carries a
    different carnet id, so the student's own one is not "on the template" and is never touched,
    and the target's carnet id is never added beside it.
  - A target delta tag with no family counterpart in the source is added. A source delta tag
    with no counterpart in the target is removed if the profile carries it.
  - Every other tag on the section stays, student-specific and extra tags included.

### The profile itself
- Colour set to the target level's colour, **last**, after every section change is confirmed.
  The colour is the level marker the app reads; setting it last means a stopped run leaves the
  old level showing, and re-running finishes the job (every step reads live first and skips what
  is already done).
- Title, description, tags, icon untouched.

### Sections on one side only
- Listed in the preview, untouched — on both sides. Missing sections on an older profile are a
  template-version upgrade, not a level change. (No copy step: this also removes the
  partial-copy case that re-running could not repair. My call, 2026-11-26.)

### Current level, live
- Plan and execute read the profile **live**. Its live colour decides the current level; if it
  differs from local `persons.color`, the preview says so and uses the live value.
- If the live colour is already the target level (a stopped earlier run), it is a finishing run:
  the source stays the other level, every step skips what is already done.
- A live colour neither CFC nor AFP refuses, nothing written.

### Success rule
- After the writes, re-read the profile and its children (up to 3 reads, 750 ms apart, for cache
  lag). Success when every planned description and tag change and the colour show in that read
  (normalised compare). Anything short is `success:false` with `remaining` naming what is left. A
  write whose status failed but whose change shows in the read counts as done.
- Transient errors (5xx, network, timeout) retry with `backoffMs`; 4xx fails fast.

### No sync during a level change
- The task holds the counter in `archive-lock.ts`, like the archive tasks, so a sync cannot start
  while it runs; the local reconcile is skipped when a sync is running.

### Local reconcile
- On full success, in its own try/catch: update `persons.color` for the student, so Missions,
  Matrix and Persons show the new level without a sync. Nothing else locally.

### UI — « Outils » tab
- New page `ToolsPage.tsx`, nav « Outils », **complete mode only** (registered in `app-mode.ts`).
  One section for now, « Changement de niveau », built so further tools can be added as sections.
- Student search over synced students (name, two letters minimum), showing formation and current
  level from icon + colour. Not-eligible students shown greyed with the reason.
- Target level shown (the other one), template dropdown (v3 preselected).
- « Aperçu » runs the plan (read-only) and shows: the templates consulted, sections to update
  (description / tags added / tags removed), descriptions left because hand-edited, template-only
  and profile-only sections, the colour change, and a reminder that classes and roles are not
  changed — move the student in Matrix.
- « Appliquer » enqueues one `levelChange` Task Queue task (in `ALL_TASK_TYPES`, not the CIE list).

### Files (following the app's pure-core / thin-service split)
- `src/main/services/level-change.ts` — pure core, IO injected (`read`, `list`, `update`,
  `addTags`, `removeTags`, `sleep`): template selection, matching, tag diff, plan,
  `runLevelChange`. Tests beside it.
- `src/main/services/level-change.service.ts` — real calls, settings, plan + execute, reconcile.
- `src/shared/level-change-types.ts` — plan/outcome types.
- IPC `LEVEL_CHANGE_CANDIDATES` (templates for a student), `LEVEL_CHANGE_PLAN`,
  `LEVEL_CHANGE_EXECUTE`; preload; `TaskQueueContext` task type.
- CLAUDE.md: a « Outils — level change » section.

## Left to the builder

- `sendApiRequestUpdate` swallows errors; add a checked update (like the other `*Checked`
  calls) for descriptions and colour, or verify the colour write some other way — builder's call.
- Exact layout and wording of the preview.

## Testing

- Unit tests for the pure core: template choice (v3 / none / several), matching incl. echo and
  id-less entries, the tag diff (student-specific tag kept), abort on failed/empty listing,
  colour-last ordering, re-run skips done steps, success rule both directions.
- Acceptance (Urs), against a **scratch userData copy**: switch a test student CFC → AFP, compare
  the profile's sections with the AFP v3 template in Hazu, check Missions shows AFP; switch back.
