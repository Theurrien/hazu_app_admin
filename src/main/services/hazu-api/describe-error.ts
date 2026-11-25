/**
 * A one-line, log-safe summary of an error.
 *
 * An axios error carries its request `config`, and the config carries the headers — including
 * `x-api-key` / `token`. Passing the error object itself to console.error writes the key into
 * the main-process log. This happens most easily on a network error or timeout: axios then sets
 * no `response`, so the "is it an HTTP error?" branches fall through to a generic
 * `console.error(..., error)`. Log `describeError(error)` instead; it never reads `config.headers`.
 */
export function describeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as {
      isAxiosError?: boolean;
      config?: { method?: string; url?: string };
      response?: { status?: number; data?: unknown };
      code?: string;
      message?: string;
    };
    if (e.isAxiosError || e.config) {
      const method = (e.config?.method || '').toUpperCase();
      const url = (e.config?.url || '').split('?')[0];
      const status = e.response?.status;
      const data = e.response?.data as { message?: unknown; error?: unknown } | string | undefined;
      const detail =
        typeof data === 'string'
          ? data
          : data && typeof data === 'object'
            ? String(data.message ?? data.error ?? '')
            : '';
      return [
        status !== undefined ? `HTTP ${status}` : 'no response',
        e.code,
        method && url ? `${method} ${url}` : url || undefined,
        '—',
        (detail || e.message || 'request failed').slice(0, 300),
      ]
        .filter(Boolean)
        .join(' ');
    }
    if (error instanceof Error) return error.message;
    if (typeof e.message === 'string') return e.message;
  }
  return String(error);
}
