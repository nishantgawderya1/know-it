/**
 * Generic index-page scraping.
 *
 * Covers the sources with no feed: IRDAI, BSE, MOSPI, Ministry of Finance, and the Indian
 * tech-policy regulators. These are the most brittle rows in the registry and three of
 * them are regulators — the sources whose misses matter most.
 *
 * Every scrape source must declare `index_link_pattern`. Generic link harvesting cannot
 * tell an article from a nav item on a government portal — IRDAI's index yields 122 links
 * of which ~38 are documents — so without a pattern this adapter refuses to run rather
 * than fill raw_documents with section pages.
 *
 * `harvestIndexLinks` is exported because the coverage auditor runs the *same* extraction
 * with the *same* pattern over the *same* page. If fetch and audit disagreed about what
 * the index contains, the audit would report phantom gaps.
 */

import { parseHTML } from 'linkedom';
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

/** Nav and chrome links are short; circular and announcement titles are not. */
const MIN_TITLE_CHARS = 25;
const MAX_ITEMS = 200;

/** Paths that are never article content on a government or exchange site. */
const CHROME_PATTERNS = [
  /\/(?:login|signin|register|about|contact|privacy|terms|disclaimer|sitemap|search|feedback|help|faq)(?:\/|$|\.)/i,
  /\.(?:css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|zip)(?:$|\?)/i,
];

export interface HarvestedLink {
  url: string;
  title: string;
}

export interface HarvestOptions {
  minTitleChars?: number;
  maxItems?: number;
  /**
   * Keep only URLs matching this pattern. Without it, harvesting returns navigation
   * alongside articles — which is safe for discovering candidates but ruinous as an
   * ingestion or audit input.
   */
  pattern?: RegExp | undefined;
}

function sameSite(candidate: URL, page: URL): boolean {
  const strip = (host: string) => host.toLowerCase().replace(/^www\./, '');
  const a = strip(candidate.hostname);
  const b = strip(page.hostname);
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Pull candidate article links out of an index page.
 *
 * Pure apart from the HTML parse, so the auditor can call it on a fetched page without
 * going through the adapter.
 */
export function harvestIndexLinks(
  html: string,
  pageUrl: string,
  options: HarvestOptions = {},
): HarvestedLink[] {
  const minTitleChars = options.minTitleChars ?? MIN_TITLE_CHARS;
  const maxItems = options.maxItems ?? MAX_ITEMS;

  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    throw new AdapterError(`invalid index URL: ${pageUrl}`, 'config');
  }

  const { document } = parseHTML(html);
  const anchors = [...document.querySelectorAll('a[href]')];

  const seen = new Set<string>();
  const links: HarvestedLink[] = [];

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href');
    if (!href) continue;

    const trimmed = href.trim();
    if (
      trimmed.length === 0 ||
      trimmed.startsWith('#') ||
      /^(?:mailto|javascript|tel|data):/i.test(trimmed)
    ) {
      continue;
    }

    let resolved: URL;
    try {
      resolved = new URL(trimmed, page);
    } catch {
      continue;
    }

    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
    if (!sameSite(resolved, page)) continue;
    if (CHROME_PATTERNS.some((pattern) => pattern.test(resolved.pathname))) continue;

    const title = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (title.length < minTitleChars) continue;

    const key = resolved.toString();
    if (options.pattern && !options.pattern.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);

    links.push({ url: key, title });
    if (links.length >= maxItems) break;
  }

  return links;
}

export const scrapeAdapter: FetchAdapter = {
  kind: 'scrape',

  async fetch(
    source: AdapterSource,
    conditional: ConditionalState,
    context: FetchContext,
  ): Promise<FetchResult> {
    const response = await conditionalGet(
      source.feedUrl,
      conditional,
      context,
      'text/html,application/xhtml+xml',
    );

    if (response.notModified) {
      return {
        httpStatus: 304,
        notModified: true,
        items: [],
        etag: response.etag,
        lastModified: response.lastModified,
      };
    }

    // Refuse rather than guess. A scrape source with no article pattern would ingest the
    // site's navigation as news, and junk in raw_documents corrupts the coverage claim
    // this whole phase exists to produce.
    if (!source.indexLinkPattern) {
      throw new AdapterError(
        `${source.slug}: no index_link_pattern configured — refusing to ingest, because ` +
          `generic link harvesting cannot distinguish articles from site navigation`,
        'no-pattern',
        response.status,
      );
    }

    const links = harvestIndexLinks(response.body, source.feedUrl, {
      pattern: new RegExp(source.indexLinkPattern),
    });

    // A regulator index that yields nothing has almost certainly changed shape. Failing
    // loudly here is the whole point: an auditor reporting "no gaps" because its scrape
    // broke is worse than no auditor at all.
    if (links.length === 0) {
      throw new AdapterError(
        `${source.slug}: index matched no links against /${source.indexLinkPattern}/ — ` +
          `the page layout or the URL scheme has probably changed`,
        'layout',
        response.status,
      );
    }

    const items: FetchedItem[] = links.map((link) => ({
      urlRaw: link.url,
      title: link.title,
      // Index pages rarely put a parseable date on the anchor. The worker falls back to
      // fetch time with low confidence rather than inventing one.
      publishedAtRaw: null,
      summary: null,
      author: null,
    }));

    return {
      httpStatus: response.status,
      notModified: false,
      items,
      etag: response.etag,
      lastModified: response.lastModified,
    };
  },
};
