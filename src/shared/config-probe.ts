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
