import type { FetchType } from '@knowit/core';
import { atomAdapter, rssAdapter } from './feed.js';
import { githubAdapter } from './github.js';
import { hnAdapter } from './hn.js';
import { scrapeAdapter } from './scrape.js';
import { AdapterError, type FetchAdapter } from './types.js';

export * from './types.js';
export { harvestIndexLinks, type HarvestedLink } from './scrape.js';
export { trackedRepos } from './github.js';
export { conditionalGet, type HttpResponse } from './http.js';

const ADAPTERS: Partial<Record<FetchType, FetchAdapter>> = {
  rss: rssAdapter,
  atom: atomAdapter,
  scrape: scrapeAdapter,
  hn: hnAdapter,
  github_api: githubAdapter,
  // json_api is intentionally absent: every json_api source in the registry is
  // source_kind='data' and inactive, so the scheduler never asks for one. Registering a
  // stub here would let a data source slip into the news pipeline unnoticed.
};

export function getAdapter(fetchType: FetchType): FetchAdapter {
  const adapter = ADAPTERS[fetchType];
  if (!adapter) {
    throw new AdapterError(
      `no adapter registered for fetch_type "${fetchType}"`,
      'unsupported-fetch-type',
    );
  }
  return adapter;
}

export function hasAdapter(fetchType: FetchType): boolean {
  return ADAPTERS[fetchType] !== undefined;
}
