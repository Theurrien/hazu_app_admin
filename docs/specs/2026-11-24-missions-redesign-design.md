# Missions tab redesign — school-wide formation overview

Status: **implemented** (2026-11-24, branch feat/missions-formation-overview; cross-checked against 5-Enterprise, see CLAUDE.md « Missions (formation overview) »). Companion: [the data inventory](2026-11-24-missions-data-inventory.md)
(where every piece of data lives on Hazu, and what a full read costs).

## 1. Intent

The Missions tab becomes a **dashboard of one school's apprentices, aggregated**, so the operator
can see how apprentices and their training companies actually work with the Hazu apps: how many
apprentices per formation and level, how many of the expected practical mandates (MPE / MPC) they
have imported, how many of those were assessed by someone else versus only self-assessed, and
where the semester reports stand. It is opened once or twice a term, to see where things are.

It replaces the current tab, which no longer works (the sync-status row never existed, CIE is never
counted, school objectives are counted as missions) and only ever parsed link text in the timeline.

## 2. Goals, non-goals, anti-goals

**Goals**
- Top level: every formation of the school side by side, each with its levels, apprentice counts,
  MPE import rate and MPE evaluation rate.
- Drill-down per formation: progress by semester of formation, each catalogue mandate (MPE and
  MPC), each training company, semester reports (company and CIE), the apprentice list, and one
  apprentice's detail.
- Numbers that **agree with the widgets** (5-Enterprise, 6 - CIE Teacher) for the same apprentice.
- One "Mettre à jour" action that reads the whole school with visible progress and never leaves
  the tab half-updated.

**Non-goals**
- No writes to Hazu of any kind. This tab is read-only.
- No per-viewer status (`moi`). The admin is never the assessor; "assessed by someone else" is one
  bucket.
- No student-app learning usage (topics read/mastered, Feynman) in this version.
- No time-series chart (assessments per month) in this version. The data is stored so it can be
  added later (every timeline item keeps its date).
- No incremental sync. Every update is a full read (approach A).

**Anti-goals** — it fails even if it "works" when:
- the app and a widget show different statuses for the same apprentice;
- an apprentice silently disappears from the counts (as the 10 non-AFP/CFC apprentices did in
  the old tab);
- a failed read is shown as "nothing imported" / "not evaluated";
- a failed update wipes the previous data.

## 3. Constraints

- **Person data rule (CLAUDE.md).** No real names, e-mails or profile ids in tracked files —
  tests and fixtures are invented at `@example.invalid`. Fixtures built from a captured real
  listing must be anonymised before they are committed (titles, authors, ids replaced).
- **House pattern:** a pure core with all IO injected (vitest, no native module) plus a thin
  `*.service.ts` IO layer, as S4/S6/S7/S8.
- **Parsing is ported, not reinvented.** Each rule below names the widget function it comes from.
  Port it as faithfully as TypeScript allows and keep a comment with its source (file + function).
- **Read rules from the widgets that apply to the REST API too:** a listing can come back empty
  transiently — an empty child list is never proof of absence; retry once and, if still empty
  where content is expected, mark the read as failed, not as zero. Normalise every row to
  `id = key || id`.
- The admin API key reads everything (full platform rights). Reads go through the existing
  `sendApiRequestList` / `sendApiRequestRead` client.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A — chosen** | Full read on every update, 8 apprentices in parallel, progress shown, local tables swapped only after a complete run | Always complete and correct (retags, publications, deletions, changed start dates). Costs the full read (~2,000–3,300 calls, a few minutes — unmeasured) |
| B | First full read, then re-list containers and skip known mandate folders | ~half the calls later; Hazu has no "changed since", so savings are modest and the skipped folders are exactly where retagging and deletion go unseen |
| C | Server-side n8n job building the summary on a schedule | Nothing to wait for; but a second store of data about minors and a second copy of the parsing rules |

**Chosen: A** (Urs, 2026-11-24). The tab is used rarely; a few visible minutes are acceptable and
it is the only option that cannot drift. B can be layered on later without redesign if the
measured duration is far above the estimate.

## 5. What the tab shows

### 5.1 Top level

```
Missions — <school>                     Données du 24.11.2026 · 264 lu·es, 2 en échec  [Mettre à jour]

[Apprenti·es 264] [MPE importés 71 %] [Évalués par un tiers 48 %] [Rapports publiés 62 %]

Legend: ■ évalué par un tiers  ■ auto-évalué seulement  ■ importé, en cours  ■ pas encore importé

┌ Cuisine           172 ┐ ┌ Hôtellerie-Intendance 56 ┐ ┌ Restauration       35 ┐
│ CFC 117  ▇▇▇▅▅▃▃░░░░  │ │ CFC 42  ▇▇▇▅▅▃▃░░░       │ │ CFC 27 ▇▇▇▇▅▃▃░░      │
│   Import 74 % Éval 51%│ │ ...                      │ │ ...                   │
│ AFP 52   ...          │ │ AFP 13  ...              │ │ AFP 3  ...            │
│ Autre niveau 3        │ │ Autre niveau 1           │ │ Autre niveau 5        │
└───────────────────────┘ └──────────────────────────┘ └───────────────────────┘
⚠ 1 apprenti·e à classer (formation non reconnue)
```

- One card per **formation**, all side by side (wrapping on narrow windows), clickable → drill-down.
- Per **level** line (AFP, CFC): count, a four-part bar, import rate, evaluation rate.
- **"Autre niveau"** (Urs, 2026-11-24): an apprentice whose level colour is neither AFP nor CFC is
  counted in the formation total and shown as "Autre niveau" with a count only — **no rates**, and
  excluded from every rate and from the headline rates.
- **"À classer"**: an apprentice whose profession icon maps to no formation; count only, listed in
  a small warning line that opens the list of those apprentices. Never dropped.
- Header: date of the data, how many apprentices were read, how many failed (clickable list).
- The four headline tiles cover AFP + CFC apprentices only (the denominators that have a catalogue).

### 5.2 Formation drill-down

In this order (mock-up shown in the conversation of 2026-11-24):

1. **Headline tiles** for the formation: import rate, evaluation rate, share of apprentices whose
   start date was entered by the mentor (the rest are estimated), number of companies with no
   assessment by someone else.
2. **Progress by semester of formation** — apprentices grouped by their *current* semester
   (S1…S6), one four-part bar per group, with the group size.
3. **Mandats Entreprise (MPE)** — one row per catalogue mandate of this formation: share of the
   concerned apprentices who imported it, share who had it assessed by someone else.
4. **Mandats CIE (MPC)** — same table for the CIE catalogue, plus the CIE reports line
   (sent / draft).
5. **Entreprises formatrices** — one row per company: apprentices, import rate, evaluation rate,
   Plan de formation present (yes/no), company reports published / due.
6. **Rapports de formation** — per semester: published / draft / missing.
7. **Apprentices** — name, company, current semester, MPE bar, latest report status. Filters:
   class, company, current semester. Click → apprentice detail.

A level switch (CFC / AFP / both) sits at the top of the drill-down; tables 3 and 4 always show one
level at a time, because catalogues differ per level.

### 5.3 Apprentice detail

A panel (not a new page): semester frieze from the start date (entered or "estimé"), each expected
MPE and MPC with its status, assessor name(s) and date, points, report status per semester, and an
"Ouvrir dans Hazu" link to the profile and to each mandate copy (`https://hazu.swiss/{id}`, as the
widgets do).

## 6. Definitions (the numbers)

All per apprentice first, then summed. Only AFP/CFC apprentices whose formation resolves enter a
rate.

- **Formation and level** — from the profile's `icon` (formation) and `color` (level), mapped
  through the school's **Professions** and **Levels** config Hazus (tags `hz-config-professions`
  / `hz-config-levels`; found in the enterprise room container, fallback the Admin subtree — the
  5-Enterprise discovery, `findConfigHazus`). Colour compare is case-insensitive (`normalizeHex`).
  Level code via `levelTitleToCode` (AFP / CFC, else "autre niveau").
- **Catalogue** — MPE and MPC masters under `MPE_CATALOGUE_ROOT` (`eIWK3uyTqf910NF6Cg0a`), per
  profession folder (code from the folder's `hz-config-template-mpe-{code}` tag, see `loadMandateCatalogue`),
  slots via `catalogueSlot` / `collectCatalogueSlots` (only `type:"hazu"`, the sibling kind
  excluded, archive folders skipped). Formation ↔ catalogue profession code via `resolveProgram`
  (icon match, fallback: the dominant `-profession-` facet among the apprentice's copies).
- **Start date** — `hz-plan-start-{ms}` from the newest `hz-plan-settings` item in Entreprise -
  Suivi (`parsePlanRecords`, newest wins). Absent → `guessStartDate` (earliest of S1 report /
  imported mandate / profile `dateCreated`, snapped to 1 August of that school year), flagged
  **estimé**.
- **Semesters** — AFP 4, CFC 6; semester *k* runs `addMonths(start, 6(k−1))` to
  `addMonths(start, 6k) − 1 day` (5-Enterprise plan model). **Current semester** = the one
  containing today; before the start → 0 (nothing expected); after the end → the last.
- **Expected to date** — catalogue slots of the apprentice's profession × level with semester ≤
  current semester. *My call:* mandates the mentor retired (`hz-plan-skip`, newest record, not
  cleared) are removed from "expected" and counted as "retirés" in the company table.
- **Copies** — `type:"hazu"` nodes tagged `hz-config-mpe` (resp. `-mpc`) found in Mandats
  Entreprise (resp. Mandats CIE) by `collectMandates` (one level at a time, max 4 levels, skip the
  planning overview by exact normalised title, skip `type:"item"`). A copy matches a slot by
  semester + mandate facets (+ level when present), as `buildProgress` does.
- **Status of an expected slot** — best wins over its matching copies (`STATUS_RANK` without `moi`):
  - *évalué par un tiers* — a timeline item links to the copy (`extractHazuLinks`) and its author
    (`authorId || user.key || user.id`) is not the apprentice;
  - *auto-évalué* — linked items exist, all authored by the apprentice;
  - *en cours* — copy exists, no linked item;
  - *pas encore importé* — no copy.
  **Apprentice identity for "self"** (*my call, after the builder check*): the account id (UID)
  a timeline author is compared with. `hz-config-userid-{x}` holds a UID on some profiles and an
  e-mail on others, and no local table stores a student's account id. Resolve it during the run:
  if the tag value is a UID, use it; if it is an e-mail, find the entry on the **profile's own ACL**
  whose `description` equals it and take its `authorId` (one extra ACL read per apprentice, the
  same both-ways match as `group-membership.ts`). **Unresolved → identity unknown**: the apprentice
  is excluded from the evaluation rates and flagged, never treated as "not self" — treating it as
  not-self would turn every self-assessment into "évalué par un tiers" and inflate the headline
  rate. (The widgets tolerate a miss because they always know the viewer; a school-wide aggregate
  cannot.)
- **Import rate** = (slots not "pas encore importé") / expected. **Evaluation rate** =
  "évalué par un tiers" / imported. Copies of slots *not yet* expected are shown as "en avance"
  in the apprentice detail, not in the rates.
- **Company reports** — `type:"hazu"` children of Entreprise - Suivi recognised by
  `isReportNode`, semester from `reportSemesterFromTags`, published = `hz-config-report-published`
  (date from `-published-at-{ms}`), staging copies excluded (`hz-config-report-staging`). For each
  **past** semester (ended before today): published / draft (exists, not published) / missing.
  The last semester's report is optional, as in the widget. Reports without a semester tag are
  counted as "sans semestre" and never placed. **Reports published** headline = published /
  (past semesters that need one).
- **CIE reports** — `rap_cie` copies in CIE - Suivi: sent = `hz-config-report-sent`, else draft.
- **Company** — the apprentice's enterprise room assignment(s) from the existing synced
  `person_room_assignments`. *My call:* an apprentice with two companies is counted in each
  company's row (a company's figures are about its own apprentices), but once in every
  formation/school total; an apprentice with none goes into a "sans entreprise" row.
- **Who is an apprentice** — every `persons` row with `person_type = 'student'` (264 at the
  2026-11-24 sync). Those without a skills-timeline pointer or a readable profile are still counted
  and flagged, never dropped.

## 7. Sync (approach A)

1. **Prerequisite:** the main sync has run (persons, rooms, assignments, ACL identities). If not,
   the button says so.
2. **Reference data**, once per run: Professions/Levels config, MPE catalogue, MPC catalogue. A
   failure here stops the run (no rates are computable) and keeps the previous data.
3. **Per apprentice**, 8 in parallel (reuse `DEFAULT_ACL_CONCURRENCY`-style pool), each read with
   the S4 transient retry (`isRetryableError` / `backoffMs`, 3 attempts):
   profile children → skills timeline (pointer tag first) → Mandats Entreprise descent →
   Mandats CIE descent → Entreprise - Suivi → CIE - Suivi.
   (The feedback archive is not read in this version: published status is on the master.)
4. **Staging and swap:** results go to staging tables; only when the run completes are they
   swapped into the live tables in one transaction. Apprentices whose read failed keep their
   previous rows, marked `stale` with the error, and appear in the header's "en échec" list.
   A run that fails as a whole leaves everything as it was.
5. **Progress:** a real status row (seeded on migration — the bug that broke the old tab) with
   processed / total / failed; the renderer polls it; the page reloads only on `idle` after a run
   it started.
6. **Measure first:** the first implementation step logs per-read and total durations against
   the live school, before the UI is built.

### Stored data (proposal — the builder may reshape)

Raw-ish facts, so the definitions in §6 are computed at query time and can change without a
re-sync: `formation_student` (person id, formation, level code, start ms, start source, current
semester, read status/error), `formation_copy` (person, kind MPE/MPC, copy id, semester, mandate,
level, title), `formation_assessment` (person, copy id, author id, is self, points, date),
`formation_report` (person, kind company/CIE, report id, semester, published, published at),
`formation_plan` (person, slot, retired), `formation_catalogue` (kind, profession, level, semester,
mandate, title), `formation_sync_status`. The old `mission_tracking` / `mission_sync_status`
tables and their IPC channels are removed.

## 8. Errors and edge cases

- An apprentice whose timeline cannot be read: statuses are **unknown**, the apprentice is excluded
  from evaluation rates (not counted as "en cours") and flagged.
- A study place not found by tag: title fallback (`mandats entreprise` / `mandats cie`); not found
  at all → that apprentice shows "espace introuvable" and is excluded from that rate.
- Empty listings retried once (§3); still empty where a container must have content → failed read.
- AFP↔CFC change: records whose slot level differs from the current level are ignored (widget rule).

## 9. Testing

- Pure core (vitest): every ported rule with invented fixtures, including the shape traps (rows
  with `key` and no `id`, the planning overview's `type:"item"` entries tagged `hz-config-mpe`,
  nested import folders, uppercase `CIE`, reports without a semester, `hz-plan-clear` tombstones).
- At least one fixture shaped from a real captured listing, anonymised before commit.
- A cross-check run: for three apprentices, compare the app's statuses with what 5-Enterprise shows
  live; they must match.

**Live reads during development** (*my call*): the builder may read the live school with the app's
own admin key and local DB, **read-only**. Measurements and raw captures go to `output/` or the
scratchpad, never to tracked files; a capture becomes a committed fixture only after names, e-mails,
ids and free text are replaced with invented values.

**App mode** (*my call*): the Missions page stays complete-mode only, as `app-mode.ts` has it now.

**Drill-down layout** (the mock-up itself is not in the repo):

```
Cuisine — CFC | AFP | les deux                       Classe ▾  Entreprise ▾  Semestre ▾
[Import 74 %] [Évalués par un tiers 51 %] [Début saisi 64 % (sinon estimé)] [Entreprises sans éval. 7/41]

Progression par semestre      S1 16 appr. ▇▇▇▇▇▅▃░   … S6 14 appr. ▇▇▅▃▃░░░░
Mandats Entreprise (MPE)      MPE 101 Réception…   importé ▇▇▇▇ 88 %   évalué ▇▇▇ 70 %
Mandats CIE (MPC)             same rows          + Rapports de CIE : 34 envoyés · 9 brouillons
Entreprises formatrices       Entreprise · Appr. · Import · Éval. tiers · Plan oui/non · Rapports 2/3
Rapports de formation         S1 ▇▇▇▇▇▅░ 78 % publiés  (publié / brouillon / manquant)
Apprenti·es                   Nom · Entreprise · Sem. · MPE ▇▅░ · Rapport [publié|brouillon|à faire]
```

Four-part bars always use the same order and colours: évalué par un tiers, auto-évalué seulement,
importé en cours, pas encore importé. Company rows with an evaluation rate under 20 % are shown in
the danger colour.

## 10. Left to the builder

Table and column names, the exact pool/timeout values, component structure, chart library (the
current tab's own components may be reused or replaced), filter UI details, and the copy text,
within the French vocabulary of the mock-ups.

## 11. Decided after the builder check

- **CIE evaluation rule** (Urs, 2026-11-24): **the 5-Enterprise CIE-tab rule** — the same link join
  as MPE (`buildAssessmentMap` on the same timeline, a non-self author = assessed). The MPC section
  is the MPE pipeline with `hz-config-mpc`. It must agree with 5-Enterprise's CIE tab, not with the
  CIE dashboard's code aggregation (`aggregateByCode` / `mandateStatusOf`). Accepted consequence:
  apprentices of courses assessed "en bloc" (`hz-config-cie-assess-bloc`), whose assessments link
  to the course rather than the mandate copy, show as not evaluated in the MPC section. The §9
  cross-check includes the CIE section, compared with 5-Enterprise's CIE tab.
