import { describe, it, expect } from 'vitest';
import { computeAnchoredPosition } from './anchoredPosition';

const anchor = (top: number, height = 36) => ({ top, bottom: top + height, left: 100, width: 240 });

describe('computeAnchoredPosition', () => {
  it('opens below at the preferred height when it fits', () => {
    expect(computeAnchoredPosition(anchor(100), 900, 320)).toEqual({
      top: 140,
      left: 100,
      width: 240,
      maxHeight: 320,
    });
  });

  it('flips above when the bottom is cramped and the top has more room', () => {
    const pos = computeAnchoredPosition(anchor(700), 800, 320);
    expect(pos.top).toBeUndefined();
    expect(pos.bottom).toBe(800 - 700 + 4);
    expect(pos.maxHeight).toBe(320);
  });

  it('caps the height to the available room instead of running off screen', () => {
    const pos = computeAnchoredPosition(anchor(300), 600, 400);
    // 600 - 336 - 12 = 252 below, 300 - 12 = 288 above → above, capped at 288.
    expect(pos.bottom).toBeDefined();
    expect(pos.maxHeight).toBe(288);
  });

  it('stays below when both sides are equally short', () => {
    const pos = computeAnchoredPosition({ top: 194, bottom: 206, left: 0, width: 10 }, 400, 320);
    expect(pos.top).toBe(210);
    expect(pos.maxHeight).toBe(182);
  });
});
