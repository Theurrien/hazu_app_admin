import { describe, it, expect } from 'vitest';
import { hazuItemUrl } from './hazu-url';

describe('hazuItemUrl', () => {
  it('builds the item link for each environment', () => {
    expect(hazuItemUrl('swiss', 'X')).toBe('https://hazu.swiss/X');
    expect(hazuItemUrl('io', 'X')).toBe('https://hazu.io/X');
    expect(hazuItemUrl('dev', 'X')).toBe('https://dev.hazu.swiss/X');
    expect(hazuItemUrl(undefined, 'X')).toBe('https://hazu.swiss/X');
  });
});
