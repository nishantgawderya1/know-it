import type { FetchType, ImageCandidate } from '@knowit/core';

/**
 * The minimum an adapter needs to know about a source. Deliberately not the database row —
 * adapters stay independent of @knowit/db so they can be tested against fixtures with no
 * database in the loop.
 */
export interface AdapterSource {
  slug: string;
  feedUrl: string;
  fetchType: FetchType;
  /** Regex selecting article URLs out of an index page. Required for `scrape` sources. */
  indexLinkPattern?: string | null;
}

/** Conditional-GET state carried between fetches. A 304 costs one round trip and no parsing. */
export interface ConditionalState {
  etag?: string | null;
  lastModified?: string | null;
}

export interface FetchContext {
  /** Sent on every request. Identifies us to publishers — keep it honest and reachable. */
  userAgent: string;
  timeoutMs: number;
  /** Raises the github_api adapter's ceiling from 60 to 5000 requests/hour. */
  githubToken?: string | undefined;
  signal?: AbortSignal | undefined;
}

/** One item as the feed presented it. Normalisation happens in the worker, not here. */
export interface FetchedItem {
  /** Exactly as supplied. The worker canonicalises; adapters never do. */
  urlRaw: string;
  title: string | null;
  /** Raw date string, parsed by @knowit/core so confidence is assessed in one place. */
  publishedAtRaw: string | null;
  /** Feed-supplied summary or content, used when a full-page fetch isn't warranted. */
  summary: string | null;
  /** Feed-supplied byline. The first and cheapest chance to detect syndicated wire copy. */
  author: string | null;
  /** For discovery sources: the URL this item points at, which is the actual story. */
  discoveryTargetUrl?: string | null;
  /**
   * Lead-image candidates the feed offered, in the adapter's preference order.
   * Resolution and validation happen in @knowit/core so one set of rules covers both
   * feed images and page metadata.
   */
  imageCandidates?: ImageCandidate[];
}

export interface FetchResult {
  httpStatus: number;
  /** True on a 304. `items` will be empty and the caller should not treat that as a gap. */
  notModified: boolean;
  items: FetchedItem[];
  etag?: string | null;
  lastModified?: string | null;
}

export interface FetchAdapter {
  readonly kind: FetchType;
  fetch(
    source: AdapterSource,
    conditional: ConditionalState,
    context: FetchContext,
  ): Promise<FetchResult>;
}

/**
 * Thrown when a fetch fails in a way the source registry should know about.
 *
 * Adapters must fail loudly. A source that silently returns zero items looks identical to
 * a quiet news day, and that is precisely the failure this product cannot tolerate.
 */
export class AdapterError extends Error {
  constructor(
    message: string,
    readonly kind: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}
