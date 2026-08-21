/**
 * Hacker News, via the Algolia API.
 *
 * Algolia returns fifty full stories in one request where the Firebase API needs one call
 * per item, and it supports keyword and date filtering — which is what a niche vertical
 * actually needs. Free, no key.
 *
 * HN is a `discovery` source. The document we store is the HN permalink; the story it
 * points at is recorded separately as `discoveryTargetUrl` and never counts toward
 * corroboration. Forty comments is corroboration of zero.
 */

import { conditionalGet } from './http.js';
import {
  AdapterError,
  type AdapterSource,
  type ConditionalState,
  type FetchAdapter,
  type FetchContext,
  type FetchResult,
  type FetchedItem,
} from './types.js';

const ALGOLIA_ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date';
const HITS_PER_PAGE = 50;

interface AlgoliaHit {
  objectID?: string;
  title?: string | null;
  url?: string | null;
  author?: string | null;
  created_at?: string | null;
  story_text?: string | null;
}

function hnPermalink(objectID: string): string {
  return `https://news.ycombinator.com/item?id=${objectID}`;
}

export const hnAdapter: FetchAdapter = {
  kind: 'hn',

  async fetch(
    _source: AdapterSource,
    _conditional: ConditionalState,
    context: FetchContext,
  ): Promise<FetchResult> {
    const url = `${ALGOLIA_ENDPOINT}?tags=story&hitsPerPage=${HITS_PER_PAGE}`;
    // Algolia has no useful conditional-GET support, so we always fetch.
    const response = await conditionalGet(url, {}, context, 'application/json');

    let payload: { hits?: AlgoliaHit[] };
    try {
      payload = JSON.parse(response.body) as { hits?: AlgoliaHit[] };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AdapterError(`hacker-news: response was not JSON (${reason})`, 'parse');
    }

    if (!Array.isArray(payload.hits)) {
      throw new AdapterError('hacker-news: response had no hits array', 'schema');
    }

    const items: FetchedItem[] = [];
    for (const hit of payload.hits) {
      if (!hit.objectID) continue;
      items.push({
        // The document is the HN post itself, not the article it links to.
        urlRaw: hnPermalink(hit.objectID),
        title: hit.title?.trim() ?? null,
        publishedAtRaw: hit.created_at ?? null,
        summary: hit.story_text?.trim() ?? null,
        author: hit.author ?? null,
        // Null for Ask HN and other self-posts, which point at nothing.
        discoveryTargetUrl: hit.url ?? null,
      });
    }

    return { httpStatus: response.status, notModified: false, items };
  },
};
