# S10 — delivery runbook

## Give someone access

1. Issue them their own Hazu API key.
2. Send the key and the Root Hazu ID, plus [first-start.md](first-start.md).
3. Send them the installer link, or point them at the latest GitHub release.

The installer contains no key. The same file works for everyone.

## Revoke access

Deactivate that person's key in Hazu. Their next sync fails and offers **Check connection**.

Note what this does and does not do: it closes the window, it does not narrow it. A Hazu
key carries full platform rights for as long as it is active.

## Ship a new version

1. Bump `version` in `package.json`.
2. `npm run release:win`
3. Confirm the release on GitHub carries the `.exe`, its `.blockmap` and `latest.yml`.

Installed apps pick it up on their next launch and install it on quit.

**Use `npm run dist:win` for a local build** — it hardcodes `--publish never`.

## A Mac build for Windows breaks `npm run dev` afterwards

Running `npm run dist:win` (or `release:win`) on a Mac leaves the development environment
unable to start. `electron-builder` runs `@electron/rebuild` for the Windows target and
replaces `node_modules/better-sqlite3/build/Release/better_sqlite3.node` **in place** with
the Windows binary. The next `npm run dev` or `npm start` then dies with
`dlopen(...better_sqlite3.node): tried: ... (slice is not valid mach-o file)` — and because
the failure happens inside `initDatabase()` during `app.whenReady()`, the window never opens
at all, so it looks like the app itself is broken rather than the native module.

The fix is one command: `npm run rebuild` (runs `electron-rebuild`), which restores the
macOS binary. Run it right after any Windows build, before you next `npm run dev`.

## Before trusting auto-update

Run the Windows acceptance run in
[the S10 spec](../specs/2026-09-22-s10-windows-delivery-design.md) once, end to end. It
cannot be exercised from macOS.

## If someone loses their database

Nothing special: reinstalling and re-entering the two values restores them. Their local data
reloads on the next sync.
