/**
 * RSS and Atom.
 *
 * Covers roughly thirty of the forty registry sources. rss-parser normalises RSS 2.0,
 * RSS 1.0/RDF and Atom into one item shape, which matters because feeds in the wild are
 * inconsistent in exactly the ways that quietly lose articles.
 */

import Parser from 'rss-parser';
import { firstImageInHtml, type ImageCandidate } from '@knowit/core';
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

/**
 * rss-parser drops any element it was not told about, which is why images looked absent
 * for the whole of Phase 1: roughly 70% of the registry ships a lead image in one of
 * these four elements and none of them are parsed by default.
 */
const parser = new Parser({
  // Feeds occasionally carry megabytes of embedded content; cap what we accept.
  maxRedirects: 5,
  customFields: {
    item: [
      // keepArray matters: publishers ship several media:content entries per item at
      // different sizes, and the default keeps only the last — usually the thumbnail.
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['content:encoded', 'contentEncoded'],
    ],
  },
});

/** A `media:*` element as rss-parser hands it over: attributes live under `$`. */
interface MediaElement {
  $?: {
    url?: string;
    medium?: string;
    type?: string;
    width?: string;
    height?: string;
  };
}

function mediaCandidates(
  elements: MediaElement[] | MediaElement | undefined,
  source: 'media_content' | 'media_thumbnail',
): ImageCandidate[] {
  const list = Array.isArray(elements) ? elements : elements ? [elements] : [];
  const candidates: ImageCandidate[] = [];

  for (const element of list) {
    const attributes = element?.$;
    if (!attributes?.url) continue;
    // media:content also carries video and audio. Only an explicit non-image type is
    // disqualifying — plenty of feeds omit both `medium` and `type` on real images.
    if (attributes.medium && attributes.medium !== 'image') continue;
    if (attributes.type && !attributes.type.startsWith('image/')) continue;

    candidates.push({
      url: attributes.url,
      source,
      width: attributes.width ?? null,
      height: attributes.height ?? null,
    });
  }

  return candidates;
}

/**
 * Lead-image candidates in preference order.
 *
 * media:content first because it is the only element that reliably carries dimensions,
 * then the thumbnail, then the RSS 2.0 enclosure, and finally an <img> scraped out of
 * the rendered content — which is the last resort because publishers put author avatars
 * and section banners there alongside the actual photograph.
 */
function imageCandidatesFor(item: ParsedItem): ImageCandidate[] {
  const candidates: ImageCandidate[] = [
    ...mediaCandidates(item.mediaContent, 'media_content'),
    ...mediaCandidates(item.mediaThumbnail, 'media_thumbnail'),
  ];

  if (item.enclosure?.url && (item.enclosure.type ?? 'image/').startsWith('image/')) {
    candidates.push({ url: item.enclosure.url, source: 'enclosure' });
  }

  const inline = firstImageInHtml(item.contentEncoded ?? item.content);
  if (inline) candidates.push({ url: inline, source: 'content_img' });

  return candidates;
}

type ParsedItem = {
  link?: string | undefined;
  guid?: string | undefined;
  title?: string | undefined;
  pubDate?: string | undefined;
  isoDate?: string | undefined;
  creator?: string | undefined;
  author?: string | undefined;
  content?: string | undefined;
  contentSnippet?: string | undefined;
  summary?: string | undefined;
  contentEncoded?: string | undefined;
  mediaContent?: MediaElement[] | MediaElement | undefined;
  mediaThumbnail?: MediaElement[] | MediaElement | undefined;
  enclosure?: { url?: string; type?: string } | undefined;
};

function firstString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Some Atom feeds put the URL in `guid` and leave `link` empty, or vice versa. */
function itemUrl(item: ParsedItem): string | null {
  const link = firstString(item.link);
  if (link) return link;
  const guid = firstString(item.guid);
  // A guid is only a URL when it looks like one — many feeds use opaque identifiers.
  if (guid && /^https?:\/\//i.test(guid)) return guid;
  return null;
}

function toFetchedItem(item: ParsedItem): FetchedItem | null {
  const urlRaw = itemUrl(item);
  if (!urlRaw) return null;

  return {
    urlRaw,
    title: firstString(item.title),
    // Prefer isoDate: rss-parser has already normalised it and it keeps the offset.
    publishedAtRaw: firstString(item.isoDate, item.pubDate),
    summary: firstString(item.contentSnippet, item.summary, item.content),
    author: firstString(item.creator, item.author),
    imageCandidates: imageCandidatesFor(item),
  };
}

async function fetchFeed(
  source: AdapterSource,
  conditional: ConditionalState,
  context: FetchContext,
): Promise<FetchResult> {
  const response = await conditionalGet(source.feedUrl, conditional, context);

  if (response.notModified) {
    return {
      httpStatus: 304,
      notModified: true,
      items: [],
      etag: response.etag,
      lastModified: response.lastModified,
    };
  }

  let parsed: { items?: ParsedItem[] };
  try {
    parsed = (await parser.parseString(response.body)) as { items?: ParsedItem[] };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    // A publisher swapping RSS for an HTML page shows up here. It must be an error, not
    // an empty result — silence is indistinguishable from a quiet news day.
    throw new AdapterError(
      `${source.slug}: response was not a parseable feed (${reason})`,
      'parse',
      response.status,
    );
  }

  const rawItems = parsed.items ?? [];
  const items = rawItems.map(toFetchedItem).filter((item): item is FetchedItem => item !== null);

  if (rawItems.length > 0 && items.length === 0) {
    throw new AdapterError(
      `${source.slug}: feed had ${rawItems.length} items but none carried a usable URL`,
      'no-urls',
      response.status,
    );
  }

  return {
    httpStatus: response.status,
    notModified: false,
    items,
    etag: response.etag,
    lastModified: response.lastModified,
  };
}

export const rssAdapter: FetchAdapter = {
  kind: 'rss',
  fetch: fetchFeed,
};

/** Atom parses identically through rss-parser; the registry keeps them distinct for clarity. */
export const atomAdapter: FetchAdapter = {
  kind: 'atom',
  fetch: fetchFeed,
};
