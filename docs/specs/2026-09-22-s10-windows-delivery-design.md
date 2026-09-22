# S10 — Windows delivery (installer, first-run setup, auto-update)

**Status:** design
**Date:** 2026-09-22

## Problem

The CIE-mode build (S9) exists but has no delivery path. The course teacher it was built for
runs **Windows**, is not technically advanced, and cannot be walked through a clone, an
`npm install` and a native rebuild.

He also cannot configure the app once it is installed. CIE mode hides the Settings page, so there
is no surface on which to enter an API key or a Root Hazu ID.

Worse, the shipped build already dead-ends on this. When unconfigured, the Dashboard renders:

> *"API not configured. Please go to Settings to configure your API key and Root Hazu ID."*

In CIE mode that is advice the reader cannot follow. S10 removes the dead end rather than
routing around it.

The goal: he installs one file, pastes two strings he was sent, and works. No terminal, no
rebuild, no admin rights, no Settings page.

## What this is, and what it is not

**Each user gets their own API key, issued and revocable by the administrator.** That is the
reason the app asks rather than ships pre-configured: a key that was handed over can be turned
off without rebuilding or redistributing anything.

**Revocable is not the same as scoped.** A Hazu key carries full platform rights
([config.ts](../../src/main/services/hazu-api/config.ts)), so revocation is incident response
after the fact, not prevention. CIE mode remains what S9 said it is — a guardrail against
mis-clicks, not an access-control boundary — and nothing here should be described to anyone as
restricting their rights.

**No artifact ever carries a secret.** The installer is generic: the same file works for any user,
any key and any root. This is what makes publishing it, and auto-updating from that publication,
safe rather than carefully-safe. `Theurrien/hazu_app_admin` is a **public** repository (measured
2026-09-22), which both makes auto-update tokenless and makes this property load-bearing.

## Measured facts this design rests on

Measured 2026-09-22 on the development Mac, except where noted.

- **Electron 39.2.7 is ABI 140**, and `better-sqlite3` v12.5.0 publishes
  `better-sqlite3-v12.5.0-electron-v140-win32-x64.tar.gz`.
- **A Windows installer cross-builds from macOS, and was built.** `npx electron-builder --win --x64`
  logged `buildFromSource=false` and `finished moduleName=better-sqlite3 arch=x64` — it downloaded
  the prebuilt Windows binary rather than compiling it — and produced
  `release/Hazu Admin Setup 1.0.0.exe`, 107 MB,
  `PE32 executable (GUI) Intel 80386, Nullsoft Installer self-extracting archive`. Exit 0.
  **No CI runner, Windows machine or VM is required to produce the artifact.**
- **NSIS defaults are already the right ones.** One-click, per-user install into the user's
  AppData, no elevation and no UAC prompt — which is what makes this installable on a
  school-managed device without involving IT.
- **The application icon is set, and needs no configuration.** It was missing when this spec was
  first written (electron-builder logged `default Electron icon is used  reason=application icon
  is not set`). `build/icon.ico` now exists and electron-builder picks it up from that default
  path with **no `win.icon` key**: a rebuild logs the warning no longer, and both the 256 px PNG
  payload and the 32 px DIB pixels are present inside the built `Hazu Admin.exe`.
- **The NSIS defaults are confirmed by the build log**, not just by documentation:
  `oneClick=true perMachine=false`.
- **The database lives in `userData`** ([database/index.ts](../../src/main/database/index.ts)), so
  it survives reinstalls and upgrades untouched.
- **`setApiConfig` already writes exactly the rows a setup screen needs**
  ([ipc/index.ts](../../src/main/ipc/index.ts)) — it is what `SettingsPage` calls. The setup
  screen needs **no new IPC channel and no main-process change**.
- **Nothing validates a key.** `isConfigured()` only checks that two strings are non-empty, and
  there is no 401 handling anywhere in the codebase. A mistyped key currently produces an app that
  looks configured and fails on every call.
- **Measured 2026-08-17 (S7):** `GET /read` answers **404 for an unknown id regardless of the
  key**, **401 only for an id that exists**, and **500 for an empty key**. This is what makes a
  useful error taxonomy possible below.

## Design

Two parts: a first-run setup gate in the renderer, and packaging. No change to any write path, any
sync path, or any existing IPC channel.

### 1. One generic installer

No build-time configuration of any kind. The same artifact serves every user, and is safe to
publish, mirror, or hand over by any channel.

### 2. The first-run setup gate

Rendered when the app is unconfigured — `api_key` or `root_hazu_id` empty — **in either mode**,
before the normal shell. Two fields and a Connect button:

- **Access key** — the per-user API key the administrator issued.
- **Root Hazu ID** — sent alongside it.

Environment is not asked for; it already defaults to `swiss`.

On success the screen **offers to run the first sync immediately**, so "press Sync before you
start" stops being a separate instruction that can be skipped. He then lands in CIE mode, which
is the default.

### 3. Validation, and why the error messages matter

**Connect must verify against the live API before saving.** Saving first and failing later would
move the dead end rather than remove it: the app would look configured, every call would fail, and
the user has no Settings page to go back to.

The S7 measurements above give a real taxonomy instead of a shrug. Probe the entered Root Hazu ID
with the entered key:

| Response | What it means | What the user is told |
|---|---|---|
| 200 | both values good | connected |
| 401 | the root ID exists; the key was rejected | the access key is wrong or has been deactivated |
| 404 | the root ID was not found | the Root Hazu ID is wrong |
| 500 | the key is empty | the access key is missing |
| network error | unreachable | no connection — check the network and retry |

The 401/404 split is the valuable one, because it tells the user **which of the two fields** to
fix. Without it, "it didn't work" sends them to the phone.

Only a 200 writes anything. A failed probe leaves settings untouched.

### 4. Re-entry when a key is deactivated

Revocation is the point of this design, so the app has to survive it. A revoked key leaves the app
*configured* — both strings are still non-empty — while every call fails.

**Scoped deliberately: a failed sync offers a "Check connection" action that reopens the setup
gate**, pre-filled, with the same validation.

Sync is the operation the user actually runs, and it is the first thing that fails when a key is
turned off. Making every API call auth-aware is a materially larger change — there is no 401
handling anywhere today — and it is **not** in this spec. If it is ever wanted, it is its own
stage.

### 5. The setup gate is a deliberate hole in the CIE surface

S9's shape is subtraction only: CIE mode withholds the Settings page, and with it the ability to
change the API key. The setup gate hands that ability back.

This is intended, and it is the narrow exception that makes a revocable per-user key workable at
all — but it is recorded here so it is not discovered later and mistaken for a leak. It is bounded
by reachability:

- reachable when the app is unconfigured, or from a failed sync;
- **never** a browsable page, never in the navigation, never reachable while a working
  configuration is in place.

### 6. Installer configuration

In the `build` block of `package.json`:

- **Icon: nothing to configure.** `build/icon.ico` is electron-builder's default lookup path, so
  the icon ships without a `win.icon` key. Do not add one.

  The icon is two designs in one file, because one drawing cannot serve both ends of the range.
  At 128 and 256 px it is the full mark — frame intact — scaled to sit above an orange foot bar
  (18% of the tile, `#E57B4D`, the app's own `--hazu-school`). At 64 px and below the frame is
  **dropped** and the glyph enlarged: the frame's stroke is ~6 px in a 276 px source, which is
  0.36 px at 16 px — a grey smudge that takes the glyph's legibility down with it. Small entries
  are BMP/DIB, the large two PNG, which is the layout icon editors produce and the safest for
  NSIS.
- `artifactName` — explicit and versioned.
- `nsis` — the current defaults stated explicitly rather than inherited:
  `oneClick`, `perMachine: false`, `createDesktopShortcut`, `runAfterFinish`.

### 7. Auto-update

`electron-updater` with `provider: github`. The repository is public, so this needs **no token, no
server and no hosting**.

- Check on launch, download in the background, install on quit.
- Guarded by `app.isPackaged`, so it neither runs nor throws in development.
- Deltas come for free: electron-builder already emits a `.blockmap` beside the installer, so an
  update transfers far less than the full 107 MB.
- Windows signature verification is skipped because the app is unsigned and no `publisherName` is
  configured. **To be confirmed in the acceptance run below, not assumed.**

Because the updater fetches and launches the installer itself, rather than the file arriving
through a browser download, **SmartScreen does not reappear on any update after the first
install.**

### 8. Documents

- **A one-page sheet for the user** — the SmartScreen click (*More info → Run anyway*), the two
  strings to paste, and who to call.
- **A runbook for the maintainer** — issuing a key, bumping the version, building, publishing, and
  what to do when a key is deactivated.

## What this deliberately does not build

- **No baked credentials.** See *Superseded design* below.
- **No code signing.** An ordinary OV certificate does not clear SmartScreen — it requires a
  hardware token or cloud HSM, costs roughly CHF 250–450 a year, and still warns until the
  certificate accumulates download reputation. Only EV clears it immediately, at CHF 400–700 a
  year. For a handful of users that is real annual money for a warning that auto-update removes
  after the first install anyway.
- **No app-wide 401 handling.** Scoped to sync, per §4.
- **No change to any existing workflow, IPC channel or write path.**

## Testing

The validation taxonomy in §3 is the testable core: given each probe outcome, the gate must
produce the right message and must write settings **only** on 200. That is a pure mapping and
belongs in a unit test beside the existing pure modules, with the IO injected — the same
pure-core-plus-thin-IO split S1–S8 use.

### Mandatory Windows acceptance run

The auto-updater cannot be tested from macOS: the thing under test *is* the Windows install path.
An updater that fails silently on the user's machine is worse than none, because neither he nor
the maintainer would find out.

**The updater is not to be trusted until this has been run once, end to end, on a Windows machine:**

1. Install. Confirm no admin prompt, a desktop shortcut, and that the app launches itself.
2. Confirm the setup gate appears, in CIE mode, before the normal shell.
3. Enter a wrong key against a correct root ID; confirm the 401 message names the **key**.
4. Enter a wrong root ID; confirm the 404 message names the **root ID**.
5. Enter both correctly; confirm it connects, offers the first sync, and that sync completes.
6. Relaunch; confirm the gate does not reappear and the configuration persisted.
7. Have the administrator deactivate that key. Run a sync; confirm it fails and offers
   *Check connection*, and that entering a fresh key restores service.
8. Bump the version, build, publish. Relaunch and confirm the app detects, downloads and installs
   the update on quit, that the database and synced data survive, and that SmartScreen does not
   appear for the auto-applied update.

## Risks

- **A published build installs itself on every user's machine.** With auto-update there is no
  rollback; the only remedy is publishing a higher version. This is the accepted cost of the
  feature, and the reason the acceptance run above is mandatory rather than advisory.
- **The gate can be dismissed into a dead end if reachability is got wrong.** If it is shown while
  a working configuration exists, a CIE-mode user can overwrite a good key with a bad one and has
  no Settings page to undo it. §5's reachability rule is the mitigation and is not optional.
- **Revocation is not containment.** Between issuing a key and deactivating it, that key carries
  full platform rights. Deactivation limits the window; it does not scope what was possible inside
  it.
- **`admin_password` remains the repository default**, deliberately, per the S9 decision. S10 does
  not change it, so the padlock is a mis-click guard rather than a check.
- **A user who loses both strings is blocked until the administrator re-sends them.** That is the
  intended failure mode, and belongs in the runbook.

## Superseded design — do not re-derive it

An earlier draft of this spec (commit `4898cf7`) baked the API key and Root Hazu ID into the
installer at build time via a gitignored `.env`, an `extraResources` file and a seed-if-empty step
at database initialisation. It required two distinct builds — keyed and unkeyed — distinguished by
script, publish flag and filename, plus a guard script to stop a keyed artifact ever reaching a
public release.

**It was replaced because asking is both simpler and more capable.** Baking produces an artifact
that is itself a credential, cannot be published, cannot be revoked without rebuilding and
redistributing, and strands a user whose database is lost. Asking deletes all of that and adds one
screen.

Two traps documented in that draft are no longer reachable, because there is no seeder — but they
are real and still live in the code, so they are preserved here for whoever writes against
`settings` next:

- **`schema.sql` seeds `api_environment`; the IPC layer writes and reads `environment`.** The
  seeded row is dead. Code written against it would look correct and do nothing.
- **`root_hazu_id` is seeded as an empty string, so its row exists, while `api_key` is not seeded
  at all.** An `INSERT OR IGNORE` across both would write the key and silently skip the root ID.

If baking ever looks attractive again — for an offline install, say, or a large rollout — read
this section first. The reason it lost was revocability, not effort.
