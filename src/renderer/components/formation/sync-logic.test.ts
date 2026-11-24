import { describe, it, expect } from 'vitest';
import type { FormationSyncStatus } from '../../../shared/formation-types';
import { shouldReload, formatRate } from './sync-logic';

const st = (o: Partial<FormationSyncStatus> = {}): FormationSyncStatus => ({
  status: 'idle', processed: 0, total: 0, failed: 0, lastSyncedAt: null, lastError: null, ...o,
});

describe('shouldReload', () => {
  it('idle with a newer lastSyncedAt than the loaded overview → reload', () => {
    expect(shouldReload(st({ lastSyncedAt: 2000 }), 1000)).toBe(true);
  });
  it('first data: loaded overview has no syncedAt yet → reload', () => {
    expect(shouldReload(st({ lastSyncedAt: 2000 }), null)).toBe(true);
  });
  it('same or older lastSyncedAt → no reload', () => {
    expect(shouldReload(st({ lastSyncedAt: 2000 }), 2000)).toBe(false);
    expect(shouldReload(st({ lastSyncedAt: 1000 }), 2000)).toBe(false);
  });
  it('never synced → no reload', () => {
    expect(shouldReload(st(), null)).toBe(false);
  });
  it('syncing or error → no reload, even with a newer lastSyncedAt', () => {
    expect(shouldReload(st({ status: 'syncing', lastSyncedAt: 2000 }), 1000)).toBe(false);
    expect(shouldReload(st({ status: 'error', lastSyncedAt: 2000 }), 1000)).toBe(false);
  });
});

describe('formatRate', () => {
  it('null → « — »', () => expect(formatRate(null)).toBe('—'));
  it('rounds to a whole percentage', () => {
    expect(formatRate(0.5)).toBe('50 %');
    expect(formatRate(0.136)).toBe('14 %');
  });
  it('exact 0 and 1 show 0 % and 100 %', () => {
    expect(formatRate(0)).toBe('0 %');
    expect(formatRate(1)).toBe('100 %');
  });
  it('below 1 never shows 100 %', () => expect(formatRate(0.996)).toBe('99 %'));
  it('above 0 never shows 0 %', () => expect(formatRate(0.004)).toBe('< 1 %'));
});
