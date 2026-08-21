/**
 * Fetch → canonicalise → dedup → extract → insert.
 *
 * Everything a source produces passes through here exactly once, which is why
 * canonicalisation lives at this seam: adapters return whatever the publisher gave them,
 * and this is the single place a URL becomes an identity.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { canonicalizeUrl, parsePublishedAt, selectLeadImage } from '@knowit/core';
import {
  AdapterError,
  conditionalGet,
  getAdapter,
  type FetchContext,
  type FetchedItem,
} from '@knowit/adapters';
import {
  fetchLog,
  rawDocuments,
  sourceErrors,
  type Database,
  type NewRawDocument,
  type Source,
} from '@knowit/db';
import { config } from './config.js';
import { extractArticle } from './extract.js';
import { DomainLimiter, hostOf } from './politeness.js';
import { rescheduleSource } from './scheduler.js';

export interface ProcessOutcome {
  slug: string;
  httpStatus: number | null;
  notModified: boolean;
  itemsSeen: number;
  itemsNew: number;
  itemsWithImage: number;
  durationMs: number;
  error: string | null;
}

const THROTTLE_STATUSES = new Set([429, 503]);

function fetchContext(source?: Source): FetchContext {
  return {
    // A source may override the bot identity — see sources.user_agent.
    userAgent: source?.userAgent ?? config.userAgent,
    timeoutMs: config.requestTimeoutMs,
    githubToken: config.githubToken,
  };
}

/** Canonicalise, drop unusable URLs, and collapse duplicates inside a single feed pull. */
function normaliseItems(
  items: FetchedItem[],
  lowercasePath: boolean,
): Array<FetchedItem & { url: string }> {
  const byUrl = new Map<string, FetchedItem & { url: string }>();
  for (const item of items) {
    const url = canonicalizeUrl(item.urlRaw, { lowercasePath });
    // One malformed link must not cost us the rest of the feed.
    if (!url || byUrl.has(url)) continue;
    byUrl.set(url, { ...item, url });
  }
  return [...byUrl.values()];
}

async function findExistingUrls(db: Database, urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const rows = await db
    .select({ url: rawDocuments.url })
    .from(rawDocuments)
    .where(inArray(rawDocuments.url, urls));
  return new Set(rows.map((row) => row.url));
}

/** Fetch and extract one article page. Failure downgrades the row; it never fails the source. */
async function buildDocument(
  source: Source,
  item: FetchedItem & { url: string },
  limiter: DomainLimiter,
  primaryDomains: string[],
  shouldFetchPage: boolean,
): Promise<NewRawDocument> {
  const now = new Date();
  const published = parsePublishedAt(item.publishedAtRaw, now);

  // Resolved against the article URL, not the feed URL: publishers ship root-relative
  // image paths, and resolving those against the feed gives a plausible-looking 404.
  const feedImage = selectLeadImage(item.imageCandidates ?? [], item.url);

  const base: NewRawDocument = {
    sourceId: source.id,
    vertical: source.vertical,
    url: item.url,
    urlRaw: item.urlRaw,
    title: item.title,
    textContent: item.summary,
    fetchedAt: now,
    publishedAt: published.publishedAt,
    publishedAtConfidence: published.confidence,
    publishedAtReason: published.reason,
    extractionStatus: 'skipped',
    originWireByline: null,
    originWireEvidence: null,
    originDiscoveryTargetUrl: item.discoveryTargetUrl
      ? canonicalizeUrl(item.discoveryTargetUrl)
      : null,
    imageUrl: feedImage?.url ?? null,
    imageSource: feedImage?.source ?? null,
    imageWidth: feedImage?.width ?? null,
    imageHeight: feedImage?.height ?? null,
  };

  if (!shouldFetchPage) return base;

  try {
    const html = await limiter.run(hostOf(item.url), () =>
      conditionalGet(item.url, {}, fetchContext(source), 'text/html,application/xhtml+xml'),
    );

    const extracted = extractArticle(
      html.body,
      item.url,
      item.author,
      primaryDomains,
      source.sourceType === 'regulator' || source.sourceType === 'exchange',
    );

    // Feed candidates first: a publisher's media:content is chosen per article, whereas
    // og:image is sometimes a section-wide default. The page is the fallback, which is
    // what gives TechCrunch and Hacker News an image at all — neither ships one in the feed.
    const image =
      selectLeadImage(
        [...(item.imageCandidates ?? []), ...extracted.imageCandidates],
        item.url,
      ) ?? null;

    return {
      ...base,
      // The feed's title is the publisher's own headline for THIS item. Readability's
      // falls back to <title>, which on many sites is a page-wide template — RBI returns
      // "Press Releases | Official Website of Reserve Bank of India" for every article.
      // Only fall back to the extracted title when the feed gave us none (scrape sources).
      title: item.title ?? extracted.title,
      textContent: extracted.textContent ?? item.summary,
      htmlSnapshot: html.body.slice(0, 500_000),
      extractionStatus: extracted.status,
      extractionError: extracted.error,
      originPrimaryLinks: extracted.originPrimaryLinks,
      originWireByline: extracted.originWireByline,
      originWireEvidence: extracted.originWireEvidence,
      originHasVerbatimQuote: extracted.originHasVerbatimQuote,
      imageUrl: image?.url ?? null,
      imageSource: image?.source ?? null,
      imageWidth: image?.width ?? null,
      imageHeight: image?.height ?? null,
    };
  } catch (error: unknown) {
    // We keep the row: knowing the article exists is the coverage claim. Its text can be
    // backfilled; its absence from the record cannot.
    return {
      ...base,
      extractionStatus: 'failed',
      extractionError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function recordError(db: Database, source: Source, type: string, message: string) {
  await db.insert(sourceErrors).values({ sourceId: source.id, errorType: type, message });
}

async function resolveOpenErrors(db: Database, source: Source) {
  await db
    .update(sourceErrors)
    .set({ resolvedAt: new Date() })
    .where(and(eq(sourceErrors.sourceId, source.id), isNull(sourceErrors.resolvedAt)));
}

export async function processSource(
  db: Database,
  source: Source,
  limiter: DomainLimiter,
  primaryDomains: string[],
): Promise<ProcessOutcome> {
  const startedAt = Date.now();
  const feedDomain = hostOf(source.feedUrl);
  const outcome: ProcessOutcome = {
    slug: source.slug,
    httpStatus: null,
    notModified: false,
    itemsSeen: 0,
    itemsNew: 0,
    itemsWithImage: 0,
    durationMs: 0,
    error: null,
  };

  try {
    const adapter = getAdapter(source.fetchType);
    const result = await limiter.run(feedDomain, () =>
      adapter.fetch(
        {
          slug: source.slug,
          feedUrl: source.feedUrl,
          fetchType: source.fetchType,
          indexLinkPattern: source.indexLinkPattern,
        },
        { etag: source.lastEtag, lastModified: source.lastModified },
        fetchContext(source),
      ),
    );

    limiter.reward(feedDomain);
    outcome.httpStatus = result.httpStatus;
    outcome.notModified = result.notModified;
    outcome.itemsSeen = result.items.length;

    if (!result.notModified) {
      const items = normaliseItems(result.items, source.lowercaseUrlPath);
      const existing = await findExistingUrls(
        db,
        items.map((item) => item.url),
      );
      const fresh = items.filter((item) => !existing.has(item.url));

      // Article pages are fetched only for sources of record, and only up to a cap so one
      // busy feed cannot monopolise a tick. Discovery sources point at stories rather than
      // reporting them, so there is nothing of theirs to extract.
      const fetchPageFor = new Set(
        source.sourceRole === 'record'
          ? fresh.slice(0, config.maxArticleFetchesPerSource).map((item) => item.url)
          : [],
      );

      const documents: NewRawDocument[] = [];
      for (const item of fresh) {
        documents.push(
          await buildDocument(source, item, limiter, primaryDomains, fetchPageFor.has(item.url)),
        );
      }

      if (documents.length > 0) {
        // onConflictDoNothing guards the race where two workers claim overlapping feeds.
        const inserted = await db
          .insert(rawDocuments)
          .values(documents)
          .onConflictDoNothing({ target: rawDocuments.url })
          .returning({ id: rawDocuments.id });
        outcome.itemsNew = inserted.length;
        outcome.itemsWithImage = documents.filter((doc) => doc.imageUrl !== null).length;
      }
    }

    await rescheduleSource(db, source, {
      etag: result.etag ?? source.lastEtag,
      lastModified: result.lastModified ?? source.lastModified,
      // Feed window size drives the under-polling detector; only meaningful on a real pull.
      ...(result.notModified ? {} : { feedWindowSize: result.items.length }),
    });
    await resolveOpenErrors(db, source);
  } catch (error: unknown) {
    const status = error instanceof AdapterError ? error.httpStatus : undefined;
    outcome.httpStatus = status ?? null;
    outcome.error = error instanceof Error ? error.message : String(error);

    let extraDelayMs = 0;
    if (status && THROTTLE_STATUSES.has(status)) {
      extraDelayMs = limiter.penalise(feedDomain);
    }

    await recordError(
      db,
      source,
      error instanceof AdapterError ? error.kind : 'unknown',
      outcome.error,
    );
    await rescheduleSource(db, source, { extraDelayMs });
  }

  outcome.durationMs = Date.now() - startedAt;

  await db.insert(fetchLog).values({
    sourceId: source.id,
    httpStatus: outcome.httpStatus,
    itemsSeen: outcome.itemsSeen,
    itemsNew: outcome.itemsNew,
    itemsWithImage: outcome.itemsWithImage,
    durationMs: outcome.durationMs,
    error: outcome.error,
  });

  return outcome;
}

/**
 * Regulator and exchange hosts. An outbound link to one of these is what lets the
 * provenance layer tell "three outlets rewrote one circular" from "three outlets
 * reported independently".
 */
export async function loadPrimaryDomains(db: Database): Promise<string[]> {
  const rows = await db.execute<{ host: string }>(
    sql`SELECT DISTINCT regexp_replace(
          regexp_replace(coalesce(index_url, feed_url), '^https?://', ''),
          '^www\\.', ''
        ) AS host
        FROM sources
        WHERE source_type IN ('regulator', 'exchange')`,
  );

  const domains = new Set<string>();
  for (const row of rows) {
    const host = row.host?.split('/')[0];
    if (host) domains.add(host.toLowerCase());
  }
  return [...domains];
}
