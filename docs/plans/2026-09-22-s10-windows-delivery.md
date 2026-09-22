# S10 — Windows Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the CIE-mode app to a non-technical Windows user as one generic installer that carries no secret, asks for a revocable per-user API key on first run, and updates itself.

**Architecture:** A pure probe module decides whether a candidate key + Root Hazu ID pair works and which field is wrong; a thin service gives it real HTTP; one new read-only IPC channel exposes it. A renderer gate renders before the shell whenever the app is unconfigured, validates before saving, and offers the first sync. Packaging adds NSIS options, a publish target and `electron-updater`.

**Tech Stack:** Electron 39 (ABI 140), React 19, TypeScript 5.9, Tailwind 4, Vite 7, vitest 4, better-sqlite3 12, axios, electron-builder 26, electron-updater.

**Spec:** [docs/specs/2026-09-22-s10-windows-delivery-design.md](../specs/2026-09-22-s10-windows-delivery-design.md)

## Global Constraints

- **Never put real person data in tracked files.** No addresses, names or Hazu profile IDs — not in source, tests, docs, fixtures or commit messages. Use `@example.invalid`. Guards: `.githooks/pre-commit` and a PreToolUse hook, both via `scripts/check-no-person-data.py`. If a guard fires, fix the data — do not weaken the guard.
- **Never commit an API key or a Root Hazu ID.** No artifact produced by this plan may contain either. This repository is **public**.
- **Never describe CIE mode as restricting anyone's rights.** One Hazu key carries full platform rights. Revocable is not scoped.
- **Do not print the default `admin_password` value** in docs or commit messages.
- **Baselines before you start** — a run that matches these is healthy, not broken:
  - `npx vitest run` → **187 passed (8 files)**
  - `npx tsc -p tsconfig.main.json --noEmit` → **0 errors**
  - `npx tsc -p tsconfig.json --noEmit` → **9 pre-existing errors** (SettingsPage 7, RoomsPage 1, fuzzyMatch 1). Do **not** "fix" them; they are out of scope. Your changes must not raise this count.
  - `python3 scripts/check-no-person-data.py --all` → exit 0
- **Do not modify** `src/main/services/role-write*.ts`, `orphan-removal*.ts`, `tag-prune*.ts`, `sync.service.ts`, or any existing IPC handler other than adding the one new handler in Task 2.

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/config-probe.ts` | **New. Pure.** Probe outcome taxonomy, message/field mapping, orchestrator with IO injected. Lives in `shared/` (not `main/services/`) because the renderer needs the types — same reason `app-mode.ts` lives there. |
| `src/shared/config-probe.test.ts` | **New.** Unit tests for the above. No network, no native module. |
| `src/main/services/config-probe.service.ts` | **New. Thin IO.** Supplies axios + endpoint resolution to the pure core. |
| `src/main/services/hazu-api/api.ts` | Modify: export `buildAuthHeaders(token)` so the probe applies the same header rule instead of restating it. |
| `src/shared/ipc-channels.ts` | Modify: add `API_VALIDATE_CONFIG`. |
| `src/main/ipc/index.ts` | Modify: register the read-only validate handler. |
| `src/main/preload.ts` | Modify: expose `validateApiConfig` + Window type. |
| `src/renderer/components/SetupGate.tsx` | **New.** The two-field gate: validate, save, offer first sync. |
| `src/renderer/App.tsx` | Modify: render the gate when unconfigured or when re-entry is requested. |
| `src/renderer/pages/Dashboard.tsx` | Modify: replace the dead-end banner; offer re-entry after a failed sync. |
| `src/main/index.ts` | Modify: macOS-only title bar styling; initialise the updater. |
| `package.json` | Modify: nsis options, artifactName, publish target, dist/release scripts, `electron-updater` dependency. |
| `docs/handover/first-start.md` | **New.** One page for the end user. |
| `docs/handover/runbook.md` | **New.** Maintainer procedure. |
| `CLAUDE.md`, `README.md` | Modify: S10 sections. |

---

### Task 1: Pure probe core

**Files:**
- Create: `src/shared/config-probe.ts`
- Test: `src/shared/config-probe.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ProbeOutcome`, `ReadOutcome`, `ProbeResult`, `ProbeDeps`, `classifyProbeResult(read: ReadOutcome): ProbeOutcome`, `buildProbeResult(outcome: ProbeOutcome, status?: number): ProbeResult`, `runConfigProbe(deps: ProbeDeps, input: ProbeInput): Promise<ProbeResult>`, `ProbeInput`.

**Why the status mapping is what it is.** Measured 2026-08-17 against this API (recorded in CLAUDE.md, S7): `GET /read` answers **404 for an unknown id regardless of the key**, **401 only for an id that exists**, and **500 for an empty key**. That is what makes the 401/404 split meaningful: 401 proves the root ID resolved, so the key is the bad field. Do not "simplify" 401 and 404 into one error.

- [ ] **Step 1: Write the failing test**

Create `src/shared/config-probe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  classifyProbeResult,
  buildProbeResult,
  runConfigProbe,
  type ReadOutcome,
  type ProbeInput,
} from './config-probe';

const GOOD: ProbeInput = {
  apiKey: 'test-key-value',
  environment: 'swiss',
  rootHazuId: 'testRootId',
};

function depsReturning(read: ReadOutcome) {
  const calls: ProbeInput[] = [];
  return {
    calls,
    deps: {
      read: async (input: ProbeInput) => {
        calls.push(input);
        return read;
      },
    },
  };
}

describe('classifyProbeResult', () => {
  it('maps a success to ok', () => {
    expect(classifyProbeResult({ kind: 'success' })).toBe('ok');
  });

  it('maps 401 to key-rejected, because a 401 proves the root id resolved', () => {
    expect(classifyProbeResult({ kind: 'status', status: 401 })).toBe('key-rejected');
  });

  it('maps 403 to key-rejected', () => {
    expect(classifyProbeResult({ kind: 'status', status: 403 })).toBe('key-rejected');
  });

  it('maps 404 to root-not-found', () => {
    expect(classifyProbeResult({ kind: 'status', status: 404 })).toBe('root-not-found');
  });

  it('maps 500 to key-missing', () => {
    expect(classifyProbeResult({ kind: 'status', status: 500 })).toBe('key-missing');
  });

  it('maps a network failure to unreachable', () => {
    expect(classifyProbeResult({ kind: 'network' })).toBe('unreachable');
  });

  it('maps an unrecognised status to unknown', () => {
    expect(classifyProbeResult({ kind: 'status', status: 418 })).toBe('unknown');
  });
});

describe('buildProbeResult', () => {
  it('marks only ok as ok', () => {
    expect(buildProbeResult('ok').ok).toBe(true);
    expect(buildProbeResult('key-rejected').ok).toBe(false);
    expect(buildProbeResult('root-not-found').ok).toBe(false);
    expect(buildProbeResult('unreachable').ok).toBe(false);
  });

  it('points at the key when the key was refused', () => {
    expect(buildProbeResult('key-rejected').field).toBe('apiKey');
    expect(buildProbeResult('key-missing').field).toBe('apiKey');
  });

  it('points at the root id when the root id was not found', () => {
    expect(buildProbeResult('root-not-found').field).toBe('rootHazuId');
  });

  it('points at no field when neither can be blamed', () => {
    expect(buildProbeResult('unreachable').field).toBeNull();
    expect(buildProbeResult('unknown', 418).field).toBeNull();
  });

  it('includes the status in the unknown message so a report is actionable', () => {
    expect(buildProbeResult('unknown', 418).message).toContain('418');
  });

  it('never returns an empty message', () => {
    for (const outcome of ['ok', 'key-rejected', 'root-not-found', 'key-missing', 'unreachable', 'unknown'] as const) {
      expect(buildProbeResult(outcome, 500).message.length).toBeGreaterThan(0);
    }
  });
});

describe('runConfigProbe', () => {
  it('returns ok when the read succeeds', async () => {
    const { deps } = depsReturning({ kind: 'success' });
    const result = await runConfigProbe(deps, GOOD);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('ok');
  });

  it('blames the key on a 401', async () => {
    const { deps } = depsReturning({ kind: 'status', status: 401 });
    const result = await runConfigProbe(deps, GOOD);
    expect(result.outcome).toBe('key-rejected');
    expect(result.field).toBe('apiKey');
  });

  it('blames the root id on a 404', async () => {
    const { deps } = depsReturning({ kind: 'status', status: 404 });
    const result = await runConfigProbe(deps, GOOD);
    expect(result.outcome).toBe('root-not-found');
    expect(result.field).toBe('rootHazuId');
  });

  it('answers an empty key locally, without a round trip', async () => {
    const { deps, calls } = depsReturning({ kind: 'success' });
    const result = await runConfigProbe(deps, { ...GOOD, apiKey: '   ' });
    expect(result.outcome).toBe('key-missing');
    expect(calls).toHaveLength(0);
  });

  it('answers an empty root id locally, without a round trip', async () => {
    const { deps, calls } = depsReturning({ kind: 'success' });
    const result = await runConfigProbe(deps, { ...GOOD, rootHazuId: '' });
    expect(result.outcome).toBe('root-not-found');
    expect(calls).toHaveLength(0);
  });

  it('trims both fields before probing, so a pasted value with whitespace still works', async () => {
    const { deps, calls } = depsReturning({ kind: 'success' });
    await runConfigProbe(deps, { apiKey: '  k  ', environment: 'swiss', rootHazuId: '  r\n' });
    expect(calls[0].apiKey).toBe('k');
    expect(calls[0].rootHazuId).toBe('r');
  });

  it('treats a thrown reader as unreachable rather than crashing the gate', async () => {
    const deps = {
      read: async () => {
        throw new Error('boom');
      },
    };
    const result = await runConfigProbe(deps, GOOD);
    expect(result.outcome).toBe('unreachable');
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/config-probe.test.ts`
Expected: FAIL — `Failed to resolve import "./config-probe"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/config-probe.ts`:

```ts
/**
 * S10 — configuration probe (pure core).
 *
 * Decides whether a candidate API key + Root Hazu ID pair works, and — when it does not —
 * which of the two fields the user should correct. All IO is injected, so this runs under
 * vitest with no network and no native module.
 *
 * Lives in `shared/` rather than `main/services/` because the renderer renders these
 * outcomes; same reason app-mode.ts lives here.
 */

export type ProbeOutcome =
  | 'ok'
  | 'key-rejected'
  | 'root-not-found'
  | 'key-missing'
  | 'unreachable'
  | 'unknown';

/** What the injected reader reports. Deliberately not an HTTP library type. */
export type ReadOutcome =
  | { kind: 'success' }
  | { kind: 'status'; status: number }
  | { kind: 'network' };

export interface ProbeInput {
  apiKey: string;
  environment: string;
  rootHazuId: string;
}

export interface ProbeResult {
  outcome: ProbeOutcome;
  ok: boolean;
  /** Plain language, for a reader with no Settings page to go to. */
  message: string;
  /** Which field to highlight, when one can be blamed. */
  field: 'apiKey' | 'rootHazuId' | null;
  status?: number;
}

export interface ProbeDeps {
  read: (input: ProbeInput) => Promise<ReadOutcome>;
}

/**
 * Measured 2026-08-17 against this API (CLAUDE.md, S7): `GET /read` answers 404 for an
 * unknown id *regardless of the key*, 401 only for an id that exists, and 500 for an empty
 * key. So a 401 proves the root id resolved, which is what lets us blame the key rather
 * than shrug. Do not collapse 401 and 404 into one error.
 */
export function classifyProbeResult(read: ReadOutcome): ProbeOutcome {
  if (read.kind === 'success') return 'ok';
  if (read.kind === 'network') return 'unreachable';

  switch (read.status) {
    case 401:
    // 403 is not in the measured set; treating it as a credential problem is the
    // reading that sends the user to the right field if it ever appears.
    case 403:
      return 'key-rejected';
    case 404:
      return 'root-not-found';
    case 500:
      return 'key-missing';
    default:
      return 'unknown';
  }
}

function messageFor(outcome: ProbeOutcome, status?: number): string {
  switch (outcome) {
    case 'ok':
      return 'Connected.';
    case 'key-rejected':
      return 'The access key was refused. Check it for typing mistakes — or ask your administrator whether it is still active.';
    case 'root-not-found':
      return 'That Root Hazu ID was not found. Check it for typing mistakes.';
    case 'key-missing':
      return 'No access key was sent. Paste the key you were given.';
    case 'unreachable':
      return 'Could not reach Hazu. Check the internet connection and try again.';
    case 'unknown':
      return `Hazu answered unexpectedly (status ${status ?? 'unknown'}). Try again, and tell your administrator if it keeps happening.`;
  }
}

function fieldFor(outcome: ProbeOutcome): 'apiKey' | 'rootHazuId' | null {
  switch (outcome) {
    case 'key-rejected':
    case 'key-missing':
      return 'apiKey';
    case 'root-not-found':
      return 'rootHazuId';
    default:
      return null;
  }
}

export function buildProbeResult(outcome: ProbeOutcome, status?: number): ProbeResult {
  return {
    outcome,
    ok: outcome === 'ok',
    message: messageFor(outcome, status),
    field: fieldFor(outcome),
    ...(status === undefined ? {} : { status }),
  };
}

export async function runConfigProbe(deps: ProbeDeps, input: ProbeInput): Promise<ProbeResult> {
  const apiKey = input.apiKey.trim();
  const rootHazuId = input.rootHazuId.trim();

  // Answer an empty field locally. The server says the same thing, but only after a round
  // trip — and on an offline machine, only after a timeout.
  if (!apiKey) return buildProbeResult('key-missing');
  if (!rootHazuId) return buildProbeResult('root-not-found');

  let read: ReadOutcome;
  try {
    read = await deps.read({ apiKey, environment: input.environment, rootHazuId });
  } catch {
    // A reader that throws tells us nothing about the credentials, only that the attempt
    // failed. Never let it escape: the gate is the user's only screen.
    return buildProbeResult('unreachable');
  }

  const outcome = classifyProbeResult(read);
  return buildProbeResult(outcome, read.kind === 'status' ? read.status : undefined);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/config-probe.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 5: Run the full suite and the typechecks**

Run: `npx vitest run && npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.json --noEmit | grep -c "error TS"`
Expected: **207 passed (9 files)**, main clean, renderer still **9**.

- [ ] **Step 6: Commit**

```bash
git add src/shared/config-probe.ts src/shared/config-probe.test.ts
git commit -m "feat(s10): add the pure configuration probe core

Decides whether a candidate key and Root Hazu ID work, and which of the
two is wrong when they do not. The 401/404 split is the point: measured
2026-08-17, GET /read answers 404 for an unknown id regardless of the
key and 401 only for an id that exists, so a 401 proves the root id
resolved and the key is to blame.

Empty fields are answered locally rather than by a round trip that would
hang on an offline machine, and a reader that throws is reported as
unreachable instead of escaping — the gate is the user's only screen."
```

---

### Task 2: Probe IO service, IPC channel and preload

**Files:**
- Create: `src/main/services/config-probe.service.ts`
- Modify: `src/main/services/hazu-api/api.ts:9-12`
- Modify: `src/shared/ipc-channels.ts:34-36`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/preload.ts:104-108` and its `Window` interface

**Interfaces:**
- Consumes: `runConfigProbe`, `ProbeResult`, `ProbeInput`, `ReadOutcome` from Task 1.
- Produces: `buildAuthHeaders(token: string): Record<string, string>` exported from `api.ts`; `validateApiConfig(input: ProbeInput): Promise<ProbeResult>`; IPC channel `API_VALIDATE_CONFIG = 'api:validateConfig'`; `window.electronAPI.validateApiConfig(config)`.

**This handler is read-only.** It must never call `setApiConfig`, never write `settings`, and never touch the in-memory config. A failed probe has to leave a previously working configuration exactly as it was.

- [ ] **Step 1: Export the auth-header rule instead of restating it**

In `src/main/services/hazu-api/api.ts`, replace lines 9–12:

```ts
function getAuthHeaders(): Record<string, string> {
  const token = getApiKey();
  return token.length <= 20 ? { token } : { "x-api-key": token };
}
```

with:

```ts
/**
 * Hazu accepts two header shapes and picks by key length. Exported so the S10 config probe
 * applies the identical rule to a candidate key — restating it would let the probe reject
 * valid keys of whichever kind it got wrong.
 */
export function buildAuthHeaders(token: string): Record<string, string> {
  return token.length <= 20 ? { token } : { "x-api-key": token };
}

function getAuthHeaders(): Record<string, string> {
  return buildAuthHeaders(getApiKey());
}
```

- [ ] **Step 2: Write the probe service**

Create `src/main/services/config-probe.service.ts`:

```ts
/**
 * S10 — configuration probe (thin IO layer).
 *
 * Gives the pure core real HTTP. Read-only by construction: it takes its credentials as
 * arguments and never writes settings or the in-memory API config, so a failed probe
 * cannot damage a configuration that was already working.
 */

import axios from 'axios';
import { API_ENDPOINTS } from './hazu-api/config';
import { buildAuthHeaders } from './hazu-api/api';
import {
  runConfigProbe,
  type ProbeInput,
  type ProbeResult,
  type ReadOutcome,
} from '../../shared/config-probe';

/** Long enough for a slow school connection, short enough that the gate does not look hung. */
const PROBE_TIMEOUT_MS = 15_000;

function resolveEndpoint(environment: string): string {
  return (API_ENDPOINTS as Record<string, string>)[environment] ?? API_ENDPOINTS.swiss;
}

export async function validateApiConfig(input: ProbeInput): Promise<ProbeResult> {
  return runConfigProbe(
    {
      read: async ({ apiKey, environment, rootHazuId }): Promise<ReadOutcome> => {
        try {
          await axios.get(`https://${resolveEndpoint(environment)}/read`, {
            headers: buildAuthHeaders(apiKey),
            params: { id: rootHazuId },
            timeout: PROBE_TIMEOUT_MS,
          });
          return { kind: 'success' };
        } catch (error) {
          const status = (error as { response?: { status?: unknown } })?.response?.status;
          if (typeof status === 'number') return { kind: 'status', status };
          // No response at all: DNS, timeout, refused, offline.
          return { kind: 'network' };
        }
      },
    },
    input
  );
}
```

- [ ] **Step 3: Add the channel**

In `src/shared/ipc-channels.ts`, alongside the other `API_*` entries:

```ts
  API_VALIDATE_CONFIG: 'api:validateConfig',
```

- [ ] **Step 4: Register the handler**

In `src/main/ipc/index.ts`, add the import at the top alongside the other service imports:

```ts
import { validateApiConfig } from '../services/config-probe.service';
```

and register the handler immediately after the existing `API_IS_CONFIGURED` handler:

```ts
  // Read-only. Never writes settings and never touches the in-memory config, so a failed
  // probe leaves a working configuration untouched.
  ipcMain.handle(
    IPC_CHANNELS.API_VALIDATE_CONFIG,
    async (_event, config: { apiKey: string; environment: string; rootHazuId: string }) => {
      return validateApiConfig(config);
    }
  );
```

- [ ] **Step 5: Expose it in preload**

In `src/main/preload.ts`, in the `// API Config` block after `isApiConfigured`:

```ts
  validateApiConfig: (config: { apiKey: string; environment: string; rootHazuId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.API_VALIDATE_CONFIG, config),
```

and in the `Window` interface, next to the existing `isApiConfigured` declaration:

```ts
      validateApiConfig: (config: {
        apiKey: string;
        environment: string;
        rootHazuId: string;
      }) => Promise<import('../shared/config-probe').ProbeResult>;
```

- [ ] **Step 6: Verify**

Run: `npx vitest run && npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.json --noEmit | grep -c "error TS"`
Expected: **207 passed**, main clean, renderer **9**.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/config-probe.service.ts src/main/services/hazu-api/api.ts src/shared/ipc-channels.ts src/main/ipc/index.ts src/main/preload.ts
git commit -m "feat(s10): add the read-only validate-config IPC channel

sendApiRequestRead takes only an id and reads the key from module-level
currentConfig, so probing a candidate key through it would mean saving
the candidate first — and a failed probe would then have overwritten a
working configuration with the bad values. The probe takes credentials
as arguments and writes nothing.

buildAuthHeaders is extracted rather than restated: Hazu picks between a
'token' and an 'x-api-key' header by key length, and a probe that got
that rule wrong would reject valid keys of one kind."
```

---

### Task 3: The setup gate

**Files:**
- Create: `src/renderer/components/SetupGate.tsx`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `window.electronAPI.validateApiConfig`, `setApiConfig`, `getApiConfig`, `runSync` (all existing); `ProbeResult` from Task 1.
- Produces: `SetupGate` default export with props `{ initialApiKey?: string; initialRootHazuId?: string; onConfigured: () => void }`; `AppShell` gains internal state only.

**Reachability rule (spec §5).** The gate is the one place a CIE-mode user can change the API key. It must render **only** when the app is unconfigured, or when re-entry was explicitly requested after a failure. It is never a nav item and never reachable while a working configuration is in place.

- [ ] **Step 1: Write the gate**

Create `src/renderer/components/SetupGate.tsx`:

```tsx
import React, { useState } from 'react';
import type { ProbeResult } from '../../shared/config-probe';

interface SetupGateProps {
  initialApiKey?: string;
  initialRootHazuId?: string;
  /** Called once the configuration is saved and the user is done here. */
  onConfigured: () => void;
}

export function SetupGate({ initialApiKey = '', initialRootHazuId = '', onConfigured }: SetupGateProps) {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [rootHazuId, setRootHazuId] = useState(initialRootHazuId);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const handleConnect = async () => {
    setBusy(true);
    setResult(null);
    try {
      const probe = await window.electronAPI.validateApiConfig({
        apiKey,
        environment: 'swiss',
        rootHazuId,
      });
      setResult(probe);
      // Only a confirmed 200 writes anything.
      if (!probe.ok) return;

      await window.electronAPI.setApiConfig({
        apiKey: apiKey.trim(),
        environment: 'swiss',
        rootHazuId: rootHazuId.trim(),
      });
      setSaved(true);
    } catch (error) {
      setResult({
        outcome: 'unknown',
        ok: false,
        message:
          'Something went wrong saving the settings. Try again, and tell your administrator if it keeps happening.',
        field: null,
      });
      console.error('[setup-gate] connect failed:', error);
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await window.electronAPI.runSync();
    } catch (error) {
      console.error('[setup-gate] first sync failed:', error);
    } finally {
      setSyncing(false);
      onConfigured();
    }
  };

  const borderFor = (field: 'apiKey' | 'rootHazuId') =>
    result && !result.ok && result.field === field ? '#dc2626' : 'var(--hazu-border, #d1d5db)';

  return (
    <div
      className="h-screen flex items-center justify-center p-6"
      style={{ backgroundColor: 'var(--hazu-bg-subtle)' }}
    >
      <div className="bg-white rounded-lg shadow max-w-lg w-full p-8">
        <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--hazu-text)' }}>
          Connect to Hazu
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          Paste the two values you were sent. They are stored on this computer only.
        </p>

        {!saved && (
          <>
            <label className="block text-sm font-medium mb-1" htmlFor="setup-key">
              Access key
            </label>
            <input
              id="setup-key"
              type="password"
              className="w-full mb-4 px-3 py-2 border rounded"
              style={{ borderColor: borderFor('apiKey') }}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />

            <label className="block text-sm font-medium mb-1" htmlFor="setup-root">
              Root Hazu ID
            </label>
            <input
              id="setup-root"
              type="text"
              className="w-full mb-6 px-3 py-2 border rounded"
              style={{ borderColor: borderFor('rootHazuId') }}
              value={rootHazuId}
              onChange={(e) => setRootHazuId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />

            <button
              type="button"
              className="w-full py-2 rounded text-white font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--hazu-school, #E57B4D)' }}
              onClick={handleConnect}
              disabled={busy}
            >
              {busy ? 'Checking…' : 'Connect'}
            </button>
          </>
        )}

        {result && !result.ok && (
          <div className="mt-4 p-3 rounded bg-red-50 text-red-800 text-sm">{result.message}</div>
        )}

        {saved && (
          <>
            <div className="p-3 rounded bg-green-50 text-green-800 text-sm mb-6">
              Connected. Now load the data from Hazu — this takes a few minutes.
            </div>
            <button
              type="button"
              className="w-full py-2 rounded text-white font-medium disabled:opacity-50 mb-3"
              style={{ backgroundColor: 'var(--hazu-school, #E57B4D)' }}
              onClick={handleSyncNow}
              disabled={syncing}
            >
              {syncing ? 'Loading data…' : 'Load data now'}
            </button>
            <button
              type="button"
              className="w-full py-2 rounded border text-sm disabled:opacity-50"
              onClick={onConfigured}
              disabled={syncing}
            >
              Skip for now
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default SetupGate;
```

- [ ] **Step 2: Wire it into the shell**

In `src/renderer/App.tsx`, add the import beside the other component imports:

```tsx
import SetupGate from './components/SetupGate';
```

Inside `AppShell`, add state and the config check immediately after the existing `currentPage` state:

```tsx
  // null = still reading. The gate renders only when unconfigured — never as a browsable
  // page (spec §5). Task 4 adds the second, explicitly-requested entry point.
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [initialConfig, setInitialConfig] = useState({ apiKey: '', rootHazuId: '' });

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .getApiConfig()
      .then((config) => {
        if (cancelled) return;
        setInitialConfig({ apiKey: config.apiKey ?? '', rootHazuId: config.rootHazuId ?? '' });
        setConfigured(!!(config.apiKey && config.rootHazuId));
      })
      .catch((error) => {
        // Show the gate rather than an empty shell: it is the only actionable screen.
        console.error('[app] failed to read the API config:', error);
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
```

Then, immediately before the existing `return (` of `AppShell`, add:

```tsx
  if (configured === null) {
    return (
      <div
        className="h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--hazu-bg-subtle)' }}
      >
        <div className="text-gray-500">Starting…</div>
      </div>
    );
  }

  if (!configured) {
    return (
      <SetupGate
        initialApiKey={initialConfig.apiKey}
        initialRootHazuId={initialConfig.rootHazuId}
        onConfigured={() => setConfigured(true)}
      />
    );
  }
```

Leave `renderPage()` alone in this task. Task 4 adds the re-entry path.

- [ ] **Step 3: Verify**

Run: `npx vitest run && npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.json --noEmit | grep -c "error TS"`
Expected: **207 passed**, main clean, renderer **9**.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/SetupGate.tsx src/renderer/App.tsx
git commit -m "feat(s10): ask for the key on first run

Renders before the shell whenever the app is unconfigured, validates the
pair against the live API, and only a confirmed 200 saves anything — a
bad probe leaves any previous configuration untouched.

Highlights the field the probe blamed, so a wrong key and a wrong root id
do not produce the same unhelpful message. Offers the first sync on the
spot rather than leaving 'press Sync' as a separate instruction.

Reachable only when unconfigured or when re-entry was requested; never a
nav item, per spec section 5."
```

---

### Task 4: Re-entry after a failed sync

**Files:**
- Modify: `src/renderer/pages/Dashboard.tsx:28` (signature), `:143-147` (the banner), and the sync-result block
- Modify: `src/renderer/App.tsx` (the `forceSetup` state and the `renderPage()` wiring)

**Interfaces:**
- Consumes: `SetupGate` and the `configured` state from Task 3.
- Produces: `Dashboard` now accepts `{ onRequestSetup?: () => void }`.

Both halves land together so the tree typechecks at every commit: the prop and its only
caller are one change.

**Why this is scoped to sync.** A revoked key leaves the app *configured* — both strings are non-empty — while every call fails. There is no 401 handling anywhere in the codebase, and adding it to every call is a materially larger change that is **not** in this plan. Sync is the operation the user actually runs and the first thing that fails when a key is turned off.

- [ ] **Step 1: Accept the prop**

In `src/renderer/pages/Dashboard.tsx`, change:

```tsx
function Dashboard() {
```

to:

```tsx
interface DashboardProps {
  /** Reopens the setup gate. Absent when the Dashboard is rendered without re-entry. */
  onRequestSetup?: () => void;
}

function Dashboard({ onRequestSetup }: DashboardProps) {
```

- [ ] **Step 2: Replace the dead-end banner**

Replace:

```tsx
        {!isConfigured && (
          <div className="mb-4 p-4 bg-yellow-50 text-yellow-800 rounded-lg">
            API not configured. Please go to Settings to configure your API key and Root Hazu ID.
          </div>
        )}
```

with:

```tsx
        {/* The old copy sent the reader to Settings, which CIE mode hides — a dead end. */}
        {!isConfigured && (
          <div className="mb-4 p-4 bg-yellow-50 text-yellow-800 rounded-lg flex items-center justify-between gap-4">
            <span>Not connected to Hazu yet.</span>
            {onRequestSetup && (
              <button
                type="button"
                className="px-3 py-1 rounded bg-yellow-200 text-yellow-900 text-sm font-medium whitespace-nowrap"
                onClick={onRequestSetup}
              >
                Connect
              </button>
            )}
          </div>
        )}
```

- [ ] **Step 3: Offer re-entry when a sync fails**

Inside the `{syncResult && (` block, add this as the **last child** — after the
`{syncResult.errors.length > 0 && (…)}` list and immediately before that block's closing
`</div>`. It must come last: placing it right after the message paragraph would push the
"Synced N rooms…" summary and the error list below the button.

```tsx
            {syncResult.status === 'error' && onRequestSetup && (
              <button
                type="button"
                className="mt-3 px-3 py-1 rounded bg-white border text-sm font-medium"
                onClick={onRequestSetup}
              >
                Check connection
              </button>
            )}
```

- [ ] **Step 4: Add the re-entry path in the shell**

In `src/renderer/App.tsx`, add the state beside `configured`:

```tsx
  const [forceSetup, setForceSetup] = useState(false);
```

Change the gate condition from `if (!configured) {` to:

```tsx
  if (!configured || forceSetup) {
```

and its callback from `onConfigured={() => setConfigured(true)}` to:

```tsx
        onConfigured={() => {
          setConfigured(true);
          setForceSetup(false);
        }}
```

Then in `renderPage()`, replace **both** `return <Dashboard />;` occurrences with:

```tsx
      return <Dashboard onRequestSetup={() => setForceSetup(true)} />;
```

> Both matter: one is the page-visibility guard, one is the `'dashboard'` case. The
> `default:` case can stay as `<Dashboard />`.

- [ ] **Step 5: Verify**

Run: `npx vitest run && npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.json --noEmit | grep -c "error TS"`
Expected: **207 passed**, main clean, renderer **9**.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/pages/Dashboard.tsx src/renderer/App.tsx
git commit -m "fix(s10): give the Dashboard a way out instead of a dead end

When unconfigured the Dashboard told the reader to go to Settings, which
CIE mode hides — advice that cannot be followed on the machine it was
written for. It now opens the setup gate directly.

A failed sync offers the same route, which is what makes a revoked key
recoverable: the app stays 'configured' because both strings are still
non-empty, so nothing else would notice. Scoped to sync deliberately —
there is no 401 handling anywhere in the codebase, and adding it to
every call is a larger change than this stage."
```

---

### Task 5: Windows window chrome

**Files:**
- Modify: `src/main/index.ts:23-24`

**Interfaces:** none.

`titleBarStyle: 'hiddenInset'` is a macOS style. It is set unconditionally, and **no custom window controls exist anywhere in the renderer** — `grep -rn "app-region" src/renderer/` finds only drag regions in `Header.tsx`, `Sidebar.tsx` and `global.css`. On Windows a non-default `titleBarStyle` hides the title bar, which would leave a non-technical user with no close, minimise or maximise button. Making the style macOS-only is correct regardless: Windows then gets its standard title bar, which is what a Windows user expects.

- [ ] **Step 1: Make the styling platform-conditional**

In `src/main/index.ts`, replace:

```ts
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
```

with:

```ts
    // macOS only. Both options exist to inset the traffic lights; on Windows a non-default
    // titleBarStyle hides the title bar, and this app draws no window controls of its own —
    // the user would get a window with no close, minimise or maximise button.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 15, y: 15 } }
      : {}),
```

- [ ] **Step 2: Verify the Mac behaviour is unchanged**

Run: `npm run build && npm start`
Expected: the window opens exactly as before on macOS — inset traffic lights, draggable header. Quit the app when confirmed.

- [ ] **Step 3: Verify the typechecks**

Run: `npx tsc -p tsconfig.main.json --noEmit && npx vitest run`
Expected: main clean, **207 passed**.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "fix(s10): keep the inset title bar on macOS only

titleBarStyle 'hiddenInset' is a macOS style and was set for every
platform. On Windows a non-default titleBarStyle hides the title bar, and
this app draws no window controls of its own — only drag regions — so the
window would have opened with no close, minimise or maximise button.

Unverified on Windows from a Mac, but conditioning it on darwin is right
either way: Windows gets its standard title bar. Confirm in the Windows
acceptance run."
```

---

### Task 6: Packaging

**Files:**
- Modify: `package.json` (the `build` block and `scripts`)

**Interfaces:**
- Produces: `npm run dist:win` (never publishes) and `npm run release:win` (publishes).

No `win.icon` key. `build/icon.ico` is electron-builder's default lookup path and is already picked up — verified 2026-09-22, all 7 images present in the packaged exe. **Do not add one.**

- [ ] **Step 1: Extend the build block**

In `package.json`, replace the `"win"` entry and add the siblings shown, so the `build` block reads:

```json
  "build": {
    "appId": "com.hazu.admin",
    "productName": "Hazu Admin",
    "artifactName": "Hazu-Admin-Setup-${version}.${ext}",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "package.json"
    ],
    "publish": [
      {
        "provider": "github",
        "owner": "Theurrien",
        "repo": "hazu_app_admin"
      }
    ],
    "mac": {
      "category": "public.app-category.productivity",
      "target": "dmg"
    },
    "win": {
      "target": "nsis"
    },
    "nsis": {
      "oneClick": true,
      "perMachine": false,
      "createDesktopShortcut": true,
      "runAfterFinish": true
    }
  },
```

- [ ] **Step 2: Add the two build scripts**

In `"scripts"`, after `"dist"`:

```json
    "dist:win": "npm run build && electron-builder --win --x64 --publish never",
    "release:win": "npm run build && electron-builder --win --x64 --publish always",
```

- [ ] **Step 3: Build and confirm the artifact name**

Run: `rm -rf release && npm run dist:win`
Expected: exit 0, and `ls release/*.exe` shows `Hazu-Admin-Setup-1.0.0.exe`. The log must **not** contain `default Electron icon is used`.

- [ ] **Step 4: Confirm nothing published**

Run: `ls release/`
Expected: the `.exe`, its `.blockmap`, `latest.yml`, `builder-debug.yml` and `win-unpacked/`. `--publish never` means no release was created; confirm with `gh release list` → no new entry.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "build(s10): name the artifact, state the NSIS options, add a publish target

artifactName so the file a user receives is unambiguous and versioned,
and the NSIS defaults written down rather than inherited: one-click,
per-user, no elevation — which is what makes this installable on a
school-managed machine without involving IT.

Two scripts, because the distinction matters: dist:win hardcodes
--publish never for local builds, release:win publishes. No win.icon key
— build/icon.ico is electron-builder's default lookup path and is already
picked up."
```

---

### Task 7: Auto-update

**Files:**
- Modify: `package.json` (dependency)
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: the `publish` block from Task 6.
- Produces: `initAutoUpdater()` called from `app.whenReady()`.

The repository is public, so `provider: github` needs no token. **Nothing published may ever contain a key** — that is what makes publishing safe, and it holds automatically here because no build embeds one.

- [ ] **Step 1: Add the dependency**

Run: `npm install electron-updater`
Expected: added to `dependencies`. It must be a runtime dependency, not a devDependency — it ships inside the app.

- [ ] **Step 2: Wire the updater**

In `src/main/index.ts`, add to the imports:

```ts
import { autoUpdater } from 'electron-updater';
```

Add this function immediately after `createWindow()`:

```ts
function initAutoUpdater(): void {
  // Never in development: there is no packaged app to replace, and the check throws.
  if (!app.isPackaged) return;

  autoUpdater.on('error', (error) => {
    // Never surfaced to the user: a failed update check is not their problem, and this
    // app's user has no way to act on it. It must also never crash the app.
    console.error('[updater] check failed:', error);
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded, installs on quit:', info.version);
  });

  void autoUpdater.checkForUpdatesAndNotify();
}
```

and call it at the end of the `app.whenReady()` callback, after `createWindow();`:

```ts
  // After the window, so a slow or failing check never delays startup.
  initAutoUpdater();
```

- [ ] **Step 3: Verify it is inert in development**

Run: `npm run build && npm start`
Expected: the app starts normally and the console shows **no** `[updater]` lines, because `app.isPackaged` is false. Quit the app.

- [ ] **Step 4: Verify the packaged build carries the feed**

Run: `rm -rf release && npm run dist:win && cat release/latest.yml`
Expected: exit 0, and `latest.yml` names `Hazu-Admin-Setup-1.0.0.exe` with a version and sha512.

- [ ] **Step 5: Confirm no secret is in the artifact**

Run: `grep -ric "api[-_]key\|x-api-key" release/win-unpacked/resources/ | head`
Expected: matches only inside bundled application code (the header name is a string literal in `api.ts`). There must be **no** file containing an actual key value. This is a sanity check, not a guard — no build step embeds a key, so there is nothing to find.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/index.ts
git commit -m "feat(s10): update the app from GitHub releases

The repository is public, so provider: github needs no token and no
server. Checks after the window is created, so a slow or failing check
never delays startup, and is inert unless app.isPackaged — in development
the check has nothing to replace and throws.

Errors are logged, never surfaced: this app's user has no way to act on a
failed update check, and it must not crash the app.

Publishing is safe here because no build embeds a credential. The updater
also removes the SmartScreen prompt from every update after the first
install, since it fetches and launches the installer itself rather than
the file arriving through a browser.

NOT TRUSTED until the Windows acceptance run in the spec has been done
end to end — the thing under test is the Windows install path, which
cannot be exercised from macOS."
```

---

### Task 8: Handover documents

**Files:**
- Create: `docs/handover/first-start.md`
- Create: `docs/handover/runbook.md`
- Modify: `CLAUDE.md` (new S10 section after the CIE Mode section)
- Modify: `README.md`

**Interfaces:** none.

Neither document may contain a real API key, a real Root Hazu ID, any person's data, or the default `admin_password` value.

- [ ] **Step 1: Write the end-user sheet**

Create `docs/handover/first-start.md`:

```markdown
# Hazu Admin — first start

## 1. Install

Double-click **Hazu-Admin-Setup-<version>.exe**.

Windows may show a blue box saying *"Windows protected your PC"*. This is expected — it
appears for any program that has not been bought a certificate. Click **More info**, then
**Run anyway**.

The app installs for your user only. It does not ask for an administrator password.

## 2. Connect

On first start the app asks for two values. You will have been sent both.

| Field | What it is |
|---|---|
| **Access key** | Your personal key. Do not share it. |
| **Root Hazu ID** | Identifies the school's data. |

Paste each one and click **Connect**.

If a value is wrong, the app says which of the two to fix.

## 3. Load the data

After connecting, click **Load data now**. This takes a few minutes and only needs doing
once — afterwards, use **Sync** on the Dashboard whenever you want fresh data.

## Everyday use

- **Bulk Import** — upload your spreadsheet, create the courses, then assign the students.
- **Matrix** — check and change who is in which course.

## If something stops working

If a sync fails, click **Check connection** and re-enter your key. If it still fails, your
key may have been deactivated — contact your administrator.

Updates install themselves. You do not need to download anything again.
```

- [ ] **Step 2: Write the maintainer runbook**

Create `docs/handover/runbook.md`:

```markdown
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

## Before trusting auto-update

Run the Windows acceptance run in
[the S10 spec](../specs/2026-09-22-s10-windows-delivery-design.md) once, end to end. It
cannot be exercised from macOS.

## If someone loses their database

Nothing special: reinstalling and re-entering the two values restores them. Their local data
reloads on the next sync.
```

- [ ] **Step 3: Document it in CLAUDE.md**

Append a new `## Windows Delivery (S10)` section immediately after the `## CIE Mode (S9)` section, covering: the generic installer carrying no secret; the first-run gate and its reachability rule; the probe's 401/404 split and why it exists; the read-only validate channel and why `sendApiRequestRead` could not be reused; the macOS-only title bar; auto-update from GitHub releases; and that the updater is untrusted until the Windows acceptance run. Link `docs/handover/runbook.md`.

- [ ] **Step 4: Update the README**

Add a short **Installing (Windows)** section pointing at `docs/handover/first-start.md`, and a **Releasing** section pointing at `docs/handover/runbook.md`.

- [ ] **Step 5: Run the guard and the full gates**

Run: `python3 scripts/check-no-person-data.py --all && npx vitest run && npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.json --noEmit | grep -c "error TS"`
Expected: guard exit 0, **207 passed**, main clean, renderer **9**.

- [ ] **Step 6: Commit**

```bash
git add docs/handover CLAUDE.md README.md
git commit -m "docs(s10): write the handover sheet and the delivery runbook

One page for the person receiving the app — the SmartScreen click, the
two values, loading the data, and what to do when a sync fails — and a
runbook for issuing a key, revoking one, and shipping a version.

The runbook says plainly what revocation does and does not do: it closes
the window, it does not narrow it. A key carries full platform rights for
as long as it is active."
```

---

## After the plan

The code is done, but the feature is not proven. **Run the Windows acceptance run from the spec before handing the app to anyone**, in particular:

- the 401 and 404 messages naming the right field (steps 3–4),
- the window having a close button (Task 5, unverifiable from macOS),
- deactivating a key and recovering from it (step 7),
- one real self-update (step 8).
