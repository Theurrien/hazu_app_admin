# S10 — Windows delivery (installer, baked configuration, auto-update)

**Status:** design
**Date:** 2026-09-22

## Problem

The CIE-mode build (S9) exists but has no delivery path. The course teacher it was built for
runs **Windows**, is not technically advanced, and cannot be walked through a clone, an
`npm install` and a native rebuild.

He also cannot configure the app himself: CIE mode hides the Settings page, so there is no
surface on which to enter an API key or a Root Hazu ID. Whatever we ship has to arrive already
configured.

The goal: he double-clicks one file and works. No terminal, no key, no settings, no admin rights.

## What this is, and what it is not

**The provisioning installer is a credential.** It carries the platform API key, which
authenticates every call and carries full platform rights ([config.ts](../../src/main/services/hazu-api/config.ts)).
A key sitting in one machine's SQLite is bounded by that machine. A key inside a 107 MB file is
bounded by wherever that file travels — mailboxes, backups, cloud sync, a USB stick in a drawer.

This was raised and accepted deliberately, as the S9 trade-offs were. It is recorded here so the
handling rules below read as consequences rather than caution.

**`Theurrien/hazu_app_admin` is a public repository** (measured 2026-09-22). This is what makes
auto-update free and tokenless, and it is also what makes one rule absolute:

> A keyed build must never be attached to a GitHub release, or committed, or referenced from
> anything public. This repository already rewrote its entire history once, in December 2025, for
> exactly this class of mistake.

The design below makes that rule structural rather than a matter of remembering it.

## Measured facts this design rests on

All measured on 2026-09-22, on the Mac this is developed on.

- **Electron 39.2.7 is ABI 140.** `better-sqlite3` v12.5.0 publishes
  `better-sqlite3-v12.5.0-electron-v140-win32-x64.tar.gz`.
- **A Windows installer cross-builds from macOS, and was built.** `npx electron-builder --win --x64`
  logged `buildFromSource=false` and `finished moduleName=better-sqlite3 arch=x64` — it downloaded
  the prebuilt Windows binary rather than compiling — then produced
  `release/Hazu Admin Setup 1.0.0.exe`, 107 MB,
  `PE32 executable (GUI) Intel 80386, Nullsoft Installer self-extracting archive`. Exit 0.
  **No CI runner, no Windows machine and no VM is required to produce the artifact.**
- **NSIS defaults are already the right ones.** One-click, per-user install into the user's
  AppData, no elevation and no UAC prompt — which is what makes this installable on a
  school-managed device without involving IT.
- **No application icon is set.** electron-builder logged
  `default Electron icon is used  reason=application icon is not set`, so the app currently ships
  the generic Electron atom.
- **The database lives in `userData`** ([database/index.ts](../../src/main/database/index.ts)), so
  it survives reinstalls and upgrades untouched.

## The settings-key trap

`schema.sql` seeds a row named **`api_environment`**. Nothing reads it.

`API_SET_CONFIG` writes **`environment`**, and `API_GET_CONFIG` reads **`environment`**
([ipc/index.ts](../../src/main/ipc/index.ts)). The seeded `api_environment` row is dead.

A configuration seeder that wrote `api_environment` would look correct in the database, pass
review, and do nothing at all. **Seed `environment`.** This spec does not fix the dead row —
that is unrelated cleanup — it only records the trap so the seeder is not written against it.

## Design

The whole feature is build-and-packaging plus one insert-if-empty at startup. No IPC channel, no
page, no workflow, and no change to any write path.

### 1. Build-time configuration

`.env` at the repo root — **already gitignored**, under the existing comment
*"Environment files (contain API keys!)"* — holds two values:

```
HAZU_API_KEY=...
HAZU_ROOT_HAZU_ID=...
```

`dotenv` is already a dependency. At package time a script reads `.env` and writes a small JSON
file into `build-resources/`, which electron-builder ships as an `extraResources` entry. The
directory is tracked (via `.gitkeep`); its contents are gitignored.

A release build simply leaves the directory empty, so the artifact carries nothing.

### 2. Seeding, once, if empty

At database initialisation, **if the bundled file exists and the effective `api_key` is missing
or empty**, write `api_key`, `root_hazu_id` and `environment`.

**Do not use `INSERT OR IGNORE`.** The two settings are asymmetric: `schema.sql` seeds
`root_hazu_id` as an **empty string**, so that row already exists, while `api_key` is not seeded
at all and is absent. `INSERT OR IGNORE` would therefore write the key and silently skip the root
ID — a seeder that looks correct, passes review, and leaves the app half-configured.

The condition is evaluated once, on `api_key`, and the writes are `INSERT OR REPLACE`:

```
if bundled file exists and (api_key row absent or its value is ''):
    INSERT OR REPLACE api_key, root_hazu_id, environment
```

Seed-if-empty, never overwrite. Three consequences, all wanted:

- Re-running the installer cannot clobber a value corrected later in the app.
- The existing `API_GET_CONFIG` → `setApiConfig` path picks the values up with no change at all.
  The renderer's normal startup call is what loads them into memory.
- An **unkeyed** update build finds no file, does nothing, and leaves a configured machine alone.

### 3. Installer configuration

In the `build` block of `package.json`:

- `win.icon` — an `.ico`, so the app is identifiable in the Start menu and taskbar rather than
  appearing as a stranger's generic Electron app.
- `artifactName` — explicit and versioned, so the file he receives is unambiguous.
- `nsis` — the current defaults stated explicitly rather than inherited:
  `oneClick`, `perMachine: false`, `createDesktopShortcut`, `runAfterFinish`.

### 4. Two builds, which cannot be confused

|  | Provisioning | Release |
|---|---|---|
| Script | `npm run dist:win:provision` | `npm run dist:win:release` |
| `build-resources/` | holds the config JSON | empty |
| Publish flag | `--publish never`, hardcoded in the script | `--publish always` |
| Artifact name | `Hazu-Admin-<version>-PROVISION.exe` | `Hazu-Admin-Setup-<version>.exe` |
| Destination | password-protected transfer, once per machine | GitHub Releases |

The two differ by filename, so a keyed artifact is visually obvious in a folder and cannot be
picked up by mistake.

### 5. The publish guard

`electron-builder` publishes automatically under some conditions, including when a `GH_TOKEN` is
present in the environment. A keyed build produced under those conditions would become a public
release asset. The release script therefore runs a guard before publishing:

**`scripts/check-artifact-no-secrets.js`**

1. **Primary check — absence.** Assert the bundled config file is not present in
   `release/win-unpacked/resources/`. This needs no knowledge of the secret.
2. **Secondary check — value.** If `.env` exists, grep the unpacked resources tree for the key's
   value.

Exit non-zero on either. Same philosophy as the existing
[check-no-person-data.py](../../scripts/check-no-person-data.py): if the guard fires, fix the
build — do not weaken the guard.

> **Check the unpacked tree, not the `.exe`.** The installer is a compressed NSIS archive, so
> grepping the `.exe` for a secret can pass while the secret is present — a guard that gives false
> assurance is worse than no guard. `release/win-unpacked/resources/` holds the files uncompressed.

### 6. Auto-update

`electron-updater` with `provider: github`. The repository is public, so this needs **no token,
no server and no hosting of your own**.

- Check on launch, download in the background, install on quit.
- Guarded by `app.isPackaged`, so it does not run — or throw — in development.
- Deltas come for free: electron-builder already emits the `.blockmap` alongside the installer,
  so an update transfers far less than the full 107 MB.
- Windows signature verification is skipped because the app is unsigned and no `publisherName`
  is configured. **To be confirmed in the acceptance run below, not assumed.**

**Updates do not carry the key, and do not need to.** The seeder only fires into an empty
`api_key`. After the first install it never fires again. This is what allows every published
artifact to be unkeyed, which is what makes publishing safe at all.

A second benefit falls out of it: because the updater fetches and launches the installer itself,
rather than the file arriving through a browser download, **SmartScreen does not reappear on any
update after the first install**.

### 7. Documents

- **A one-page sheet for him** — the SmartScreen click (*More info → Run anyway*), what the first
  launch looks like, press Sync before starting, and who to call.
- **A runbook for the maintainer** — bump the version, which script to run for which purpose, how
  to hand over the provisioning build, how to publish a release.

## What this deliberately does not build

- **No code signing.** An ordinary OV certificate does not clear SmartScreen — it requires a
  hardware token or cloud HSM, costs roughly CHF 250–450 a year, and still warns until the
  certificate accumulates download reputation. Only EV clears it immediately, at CHF 400–700 a
  year. For one or two users that is real annual money for a warning that, after the first
  install, auto-update removes anyway.
- **No first-run setup wizard.** The teacher never configures anything; the build does.
- **No change to any existing workflow, IPC channel or write path.** S10 is packaging plus one
  insert.

## Testing

Unit-testable parts are thin by nature. The guard script gets tests — given a resources tree with
and without the bundled file, it must exit non-zero exactly when the file or the key value is
present, including the compressed-`.exe` false-pass case as a regression test.

### Mandatory Windows acceptance run

The auto-updater cannot be tested from macOS: the thing under test *is* the Windows install path.
An updater that fails silently on his machine is worse than none, because neither he nor the
maintainer would find out.

**The updater is not to be trusted until this has been run once, end to end, on a Windows machine:**

1. Build the provisioning installer; confirm the guard passes for a release build and **fails**
   for the keyed one.
2. Install on Windows. Confirm: no admin prompt, desktop shortcut, app launches itself.
3. Confirm the app starts already configured — CIE mode, padlock closed, three tabs — and that
   Sync completes.
4. Confirm `%APPDATA%`-side database creation and that the key landed in `settings`.
5. Bump the version, build the **unkeyed** release, publish it.
6. Relaunch the installed app. Confirm it detects, downloads and installs the update on quit, and
   that the database, settings and synced data all survive.
7. Confirm SmartScreen does not appear for the auto-applied update.

## Risks

- **A published build installs itself on his machine.** With Tier-2 auto-update there is no
  rollback; the only remedy is publishing a higher version. This is the accepted cost of the
  feature and the reason the acceptance run above is mandatory rather than advisory.
- **Accidental publication of a keyed artifact** is the severe failure mode. Mitigated
  structurally — separate scripts, a hardcoded `--publish never`, distinct filenames, and the
  guard — but the guard is the only mechanical stop, so it must not be bypassed.
- **A lost or reset database cannot be recovered by an update.** An unkeyed build finds no bundled
  file and seeds nothing, leaving the app unconfigured with Settings hidden. Recovery is re-sending
  the provisioning build. This is intended, and belongs in the runbook.
- **A wrong or rotated key strands him.** Settings is unreachable in CIE mode, so the only route
  back is padlock → admin password → Settings. Either he holds that password — which undoes the
  S9 guardrail — or the maintainer does it over a screen-share. The latter is the intent.
- **`admin_password` remains the repository default**, deliberately, per the S9 decision. S10 does
  not change it, so the padlock is a mis-click guard rather than a check.
- **The keyed artifact sits in `release/` on the development machine.** Gitignored, but it is a
  credential-bearing file on disk and should be deleted once handed over.
