import { describe, expect, it } from 'vitest';
import { describeError } from './describe-error';

const KEY = 'sk_test_0123456789abcdefghijklmnop';

function axiosLike(over: Record<string, unknown> = {}) {
  return {
    isAxiosError: true,
    message: 'timeout of 60000ms exceeded',
    code: 'ECONNABORTED',
    config: {
      method: 'get',
      url: 'https://example.invalid/read?id=abc',
      headers: { 'x-api-key': KEY, token: KEY },
    },
    ...over,
  };
}

describe('describeError', () => {
  it('never includes the request headers of an axios error without a response', () => {
    const out = describeError(axiosLike());
    expect(out).not.toContain(KEY);
    expect(out).toContain('no response');
    expect(out).toContain('ECONNABORTED');
    expect(out).toContain('GET https://example.invalid/read');
    expect(out).not.toContain('id=abc');
  });

  it('summarises an HTTP error with status and the server message', () => {
    const out = describeError(
      axiosLike({ code: 'ERR_BAD_REQUEST', response: { status: 404, data: { message: 'Not found' } } }),
    );
    expect(out).toContain('HTTP 404');
    expect(out).toContain('Not found');
    expect(out).not.toContain(KEY);
  });

  it('keeps a plain Error message and stringifies anything else', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError({ message: 'plain', networkOrTimeout: false })).toBe('plain');
    expect(describeError('text')).toBe('text');
    expect(describeError(undefined)).toBe('undefined');
  });
});
