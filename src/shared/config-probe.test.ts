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
