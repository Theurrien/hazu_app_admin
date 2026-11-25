import { describe, it, expect } from 'vitest';
import { archiveRunning, withArchiveLock } from './archive-lock';

describe('archive lock', () => {
  it('counts a running archive and releases it when it resolves', async () => {
    expect(archiveRunning()).toBe(false);
    let release!: () => void;
    const p = withArchiveLock(() => new Promise<string>((r) => { release = () => r('ok'); }));
    expect(archiveRunning()).toBe(true);
    release();
    expect(await p).toBe('ok');
    expect(archiveRunning()).toBe(false);
  });
  it('is taken synchronously, before the first await of the wrapped run', () => {
    let seen = false;
    const p = withArchiveLock(async () => { seen = archiveRunning(); });
    expect(seen).toBe(true);
    return p.then(() => expect(archiveRunning()).toBe(false));
  });
  it('releases on a rejection and counts overlapping runs', async () => {
    const a = withArchiveLock(() => new Promise<void>((r) => setTimeout(r, 2)));
    const b = withArchiveLock(async () => { throw new Error('boom'); });
    await expect(b).rejects.toThrow('boom');
    expect(archiveRunning()).toBe(true);
    await a;
    expect(archiveRunning()).toBe(false);
  });
});
