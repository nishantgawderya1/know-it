import { AdapterError, type ConditionalState, type FetchContext } from './types.js';

export interface HttpResponse {
  status: number;
  body: string;
  etag: string | null;
  lastModified: string | null;
  /** True on 304 — the feed is unchanged and `body` is empty. Not a gap. */
  notModified: boolean;
}

/**
 * GET with conditional headers and a hard timeout.
 *
 * Conditional GET is the difference between ~11k parsed feeds a day and ~11k cheap 304s.
 * The timeout matters as much: without it one hanging publisher stalls a scheduler slot
 * indefinitely, and the source looks healthy while silently falling behind.
 */
export async function conditionalGet(
  url: string,
  conditional: ConditionalState,
  context: FetchContext,
  accept = 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
): Promise<HttpResponse> {
  const headers: Record<string, string> = {
    'user-agent': context.userAgent,
    accept,
    'accept-encoding': 'gzip, deflate',
  };
  if (conditional.etag) headers['if-none-match'] = conditional.etag;
  if (conditional.lastModified) headers['if-modified-since'] = conditional.lastModified;

  const timeout = AbortSignal.timeout(context.timeoutMs);
  const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, { headers, signal, redirect: 'follow' });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AdapterError(`request to ${url} failed: ${reason}`, 'network');
  }

  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');

  if (response.status === 304) {
    return { status: 304, body: '', etag, lastModified, notModified: true };
  }

  if (!response.ok) {
    throw new AdapterError(
      `${url} returned HTTP ${response.status} ${response.statusText}`,
      'http',
      response.status,
    );
  }

  const body = await response.text();
  if (body.trim().length === 0) {
    throw new AdapterError(`${url} returned an empty body`, 'empty-body', response.status);
  }

  return { status: response.status, body, etag, lastModified, notModified: false };
}
