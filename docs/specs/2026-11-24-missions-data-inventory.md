# Missions tab — data inventory (pre-design)

Status: **inventory only — nothing decided yet.** This lists what the platform holds about each
apprentice's formation, where it lives, how the widgets already read it, and what it would cost
the admin app to read it for a whole school. The redesign of the Missions tab is decided from this.

Sources: the widget code and docs in the Hazu Artifacts repo (`5-Enterprise`, `6 - CIE Teacher`,
`7-Student`, `docs/hazu-tag-system.md`, `docs/operations/student-profile-provisioning.md`), plus a
read-only probe of one live skills timeline on 2026-11-24.

## 1. Why the current tab fails

- `mission_sync_status` has **no row** (the table definition in `database/index.ts` creates it
  without the `id = 1` seed). Every status update is a no-op, so the button reads "idle" at once,
  the page reloads data the sync has just deleted, and "last synced" is never set.
- Place tag `CIE` is uppercase on the timeline; the sync only accepts `cie`. CIE is never counted.
- It treats any link text as a mission name, so school objectives and recipes appear as missions.
- It parses the timeline only. It never sees the mandate copies, the catalogue, or the reports.

The timeline itself is intact (the probe read 718 items going back to 2024, all with a
`hazu.swiss/{id}` link). The data is there; the reading is wrong.

## 2. Per-apprentice sources

Every apprentice profile (`hz-config-profile-student`) has the same children, from the v3
template. The admin API key can read all of them.

| # | Source (child of the profile) | How to find it | What it contains | What it tells us |
|---|---|---|---|---|
| A | **Le suivi de ma formation** (skills timeline) | pointer tag `hz-config-skills-timeline-{id}` on the profile (263 of 264 students in the local DB carry it), else child tagged `hz-config-skills` | `type:"item"` entries. Each has: a place tag (`entreprise` / `ecole` / `CIE`), curriculum objective codes (`a1.1`, `d1.3`, …), "N Points" in the text, a `hazu.swiss/{id}` link to the mandate copy assessed, an optional "Feedback : …", an **author** (`user.key`) and `dateCreated` | Who assessed what, when, how well. **Self vs. other** is author = apprentice or not. Also the student app's learning traces (`hz-learning-read/understood/completed/mastered-*`, `hz-learning-feynman*`) |
| B | **Mandats Entreprise** (MPE study place) | tag `hz-config-study-company`, else title "mandats entreprise" (the template lacks the tag, so the title fallback is needed) | the apprentice's **imported mandate copies**: `type:"hazu"` tagged `hz-config-mpe` + `-semester-{N}` + `-mandate-{NN}` (+ `-profession-`, `-level-` when known). May be nested in an import folder (up to 4 levels) | Which mandates were started, per semester. Joined with A by copy id → assessed / self-assessed / in progress |
| C | **Mandats CIE** (MPC study place) | tag `hz-config-study-cie`, else title "mandats cie" | same shape with `hz-config-mpc-*` | CIE mandates started and assessed |
| D | **Entreprise - Suivi** | `hz-config-suivi-company`, else title (present on 498 of 498 profiles in the 2026-10-06 fleet scan) | (1) **Rapports de formation**: `type:"hazu"` tagged `hz-config-report-company` + `hz-config-report-semester-{N}`; once published, `hz-config-report-published` + `-published-at-{ms}`. (2) **Plan de formation** items (`hz-plan-*`): training **start date** `hz-plan-start-{ms}`, planned due dates per mandate, interview dates per semester, mandates marked "not done in our company" (`hz-plan-skip`). (3) Mentor **observations** (plain items) | Report status per semester (missing / draft / published, with date). Formation start and the mentor's planning. Mentor activity |
| E | **CIE - Suivi** | title "cie - suivi" + `hz-share-courseteacher-admin` | **Rapports de CIE** (`rap_cie`, `hz-config-cie-report-{courseId}`, `hz-config-report-sent` once sent) and CIE observations (`hz-config-cie-obs-{courseId}`) | CIE report status per course; course-teacher activity |
| F | **Retour d'évaluations et des rapports de formations** (feedback archive) | `hz-config-feedback-timeline` | the **published** copies of company and CIE reports, read-only | Cross-check: what the apprentice actually received |
| G | Section-7 appraisal copy (inside B) | `hz-config-report-appraisal-{reportId}`; `hz-config-appraisal-ready-{ms}` when the apprentice is done | the apprentice's self-appraisal for a report | Whether apprentices take part in their own report |

Not useful here: Mandats École (empty today), École - Suivi (unused), Dossier de formation (no app
reads it), the carnet / FSRS / guidance inbox (learning tools, not formation progress).

## 3. Shared reference data (read once per sync)

| Source | Where | Gives |
|---|---|---|
| MPE / MPC **master catalogue** | template space `eIWK3uyTqf910NF6Cg0a`, the same tags as the copies | the mandates **expected** per profession × level × semester → "missing" and coverage percentages |
| **Curriculum reference** | n8n webhook `curriculum-reference` (`{curriculum, degree}`) | every objective code with its place (école / CIE / entreprise) → objective coverage per place |
| CIE courses | the rooms table (`cie` rooms), tag `hz-cie-{prof}-{level}-{N}`, mode `hz-config-cie-assess-mandat\|bloc` | which course covers which MPC mandates |
| Persons, rooms, assignments | already in local SQLite (main sync) | profession/level (icon + colour), class, **company** (enterprise room), mentor → group by school class, company, profession |

## 4. What could be shown for a whole school

Grouped by the questions you raised. Everything here can be derived from sections 2 and 3.

**Formation progress**
- Per apprentice: current semester (from the start date), MPE mandates expected / imported /
  assessed by someone else / only self-assessed / missing, for the semester and overall.
- Rolled up by profession × level, by class, by company.
- Evolution over time: assessments per month (every timeline item is dated), progress curve by
  semester of formation.

**How companies work with the apps**
- Per company: share of their mandates assessed by the mentor vs. only self-assessed; time from
  import to first assessment; whether a Plan de formation exists (start date set, mandates planned,
  interviews fixed); number of observations; companies with no mentor activity.

**Self-assessment vs. assessed by someone else**
- The same status model as 5-Enterprise (`moi` / `tiers` / `auto` / `en cours` / `manquant`),
  without `moi` (the admin is never the viewer) — so *assessed*, *self-assessed*, *in progress*, *missing*.

**Reports (formation and CIE)**
- Rapports de formation: per apprentice × semester, missing / draft / published (with date);
  late reports = past semesters without a published report.
- Rapports de CIE: per course × apprentice, draft / sent.
- Section-7 self-appraisals requested / filled.

**Start date and evolution**
- Start date is reliable only where the mentor saved it in the Plan de formation
  (`hz-plan-start-*`). Otherwise the widget's guess applies (earliest S1 report / imported mandate /
  profile creation → 1 Aug of that school year) and should be shown as a guess.

**Student app usage (optional)**
- Topics read / understood / completed / mastered, Feynman sessions — per apprentice, per class.

## 5. Limits to know about

- **No "modified" timestamp.** List rows carry `dateCreated` and `timelineDate`, nothing that says
  when an item was last changed. Additions can be detected; changes (a report getting its
  `published` tag, a mandate retagged) cannot, except by reading the container again.
- **Legacy reports without a semester tag** cannot be placed in a semester; count them separately.
- **Study places without their identity tag** need the title fallback (the template lacks the tags).
- **The planning overview inside old study places** ("Mandats pratiques - Aperçu et planification")
  holds `type:"item"` references tagged `hz-config-mpe`. Only `type:"hazu"` nodes are real copies.
- **Self vs. other** compares the item's author with the apprentice's account id. The admin DB has
  it in `hz-config-userid-*` / the ACL; a few profiles hold a UID in `persons.email` (known quirk).
- **Parsing must stay identical to the widgets'** (`extractHazuLinks`, `parsePoints`,
  `parseFeedback`, the status rules), or the app and the dashboards will disagree about a student.

## 6. Cost of a full read, and an update-only sync

Per apprentice, roughly: profile children (1) + timeline (1, can be large: 718 items ≈ 1 MB in the
probe) + Mandats Entreprise (1–4) + Mandats CIE (1–4) + Entreprise - Suivi (1) + CIE - Suivi (1)
+ feedback archive (1) ≈ **8–13 reads**. For ~254 apprentices: **about 2,000–3,300 reads**.
At 8 parallel reads (as the group-ACL sync does) that is an estimated few minutes — **not measured
yet**; the large timelines are the unknown.

An update-only sync is possible, with one caveat:
- **Store everything locally** after the first full read (timeline items, mandate copies, reports,
  plan items), keyed by Hazu id.
- **Later syncs** still list each container (the listing is the cost; there is no "changes since"
  call), but skip what is known: no re-descent into known mandate folders, no re-parsing of
  known timeline items, and the profile's child ids are cached so the first read is skipped.
  That roughly halves the reads per apprentice.
- **Tags that change on existing items** (report published / sent, plan records) are picked up
  because those containers are re-listed anyway; only deep mandate folders would be stale, and a
  "full re-read" button covers that.
- Deletions are rare but real (a mentor deletes a draft); a re-listed container shows them.

Since the tab is used once or twice a term, a slower but complete sync with visible progress may
be preferable to an incremental one. That is a decision for the design.
