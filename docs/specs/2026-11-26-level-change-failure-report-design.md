# Level change — failure report and profile link — short design

Date: 2026-11-26. Status: approved (Urs, 2026-11-26).
Extends [the decisions addendum](2026-11-26-level-change-decisions-design.md).

## Intent
In the first live run with a problem (a role group at the wrong share role on a copied section), the
operator saw only the truncated red line in the Task Queue. The result report existed, but it is
rendered at the top of the section, under the student search, while the preview stays open below —
easy to miss. The operator wants the failure report as visible as the success report, and a way to
open the profile in Hazu straight from it.

## Design
- **Placement on failure:** the report is rendered right under « Aperçu / Appliquer » inside the
  student block, replacing « Échec — voir la file des tâches, puis refaire l'aperçu. ». Header in
  red: « Changement non terminé — {student} ». Content as today: « Reste à faire » (every line, in
  full), « Ignoré », « Notes ».
- **On success:** unchanged (the student block closes; the report stays where it is today).
- **Hint for the group-role case only:** under each « rôle du groupe … à ajuster à la main » line:
  « Réessayer ne corrige pas ceci : réglez le rôle dans Hazu, puis Réessayer pour écrire la couleur. »
- **« Ouvrir le profil dans Hazu »** button in both reports, opening the profile through the existing
  `openExternal` IPC with the environment-aware base URL the Task Queue already uses
  (swiss → `https://hazu.swiss`, io → `https://hazu.io`, dev → `https://dev.hazu.swiss`) + `/{profileId}`.
- The report stays until the next pick or preview, as today.

## Approaches
- **Move and extend the existing report (chosen):** the data is already there; only placement, header,
  hint and button change.
- A structured problem list from the core (kinds, retry-helps flags): rejected for now — larger, and
  the operator asked for this one case.
- Expanding the Task Queue line: rejected — the queue is shared by every workflow and stays a summary.

## Non-goals
No change to the run's messages, the Task Queue line, or the retry behaviour.

## Left to the builder
Exact layout of the button and the hint; whether the URL builder is shared with the Task Queue
(preferred, no third copy).
