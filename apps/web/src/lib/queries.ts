import { sql } from 'drizzle-orm';
import { getDb } from '@knowit/db';

/*
 * These row shapes are declared as `type` rather than `interface` on purpose: Drizzle's
 * `execute<T>` constrains T to Record<string, unknown>, and only a type alias carries the
 * implicit index signature that satisfies it.
 */

export type SourceHealth = {
  id: string;
  slug: string;
  name: string;
  vertical: 'finance' | 'tech';
  source_type: string;
  source_role: string;
  fetch_type: string;
  audit_strategy: string;
  is_active: boolean;
  last_fetched_at: string | null;
  next_fetch_at: string | null;
  active_interval_min: number;
  feed_window_size: number | null;
  docs_24h: number;
  docs_total: number;
  /** Share of the last 7 days' documents carrying a lead image, 0-100, null if none. */
  image_pct_7d: number | null;
  peak_new: number | null;
  open_errors: number;
  last_error: string | null;
  notes: string | null;
}

/**
 * Per-source ingestion health.
 *
 * `peak_new` vs `feed_window_size` is the under-polling signal: if a single fetch ever
 * returned a full window of entirely new items, the feed rolled over between polls and we
 * cannot know what fell off the end. That is the most common cause of a silent miss, and
 * unlike most coverage questions it is mechanically checkable.
 */
export async function getSourceHealth(): Promise<SourceHealth[]> {
  const rows = await getDb().execute<SourceHealth>(sql`
    SELECT s.id, s.slug, s.name, s.vertical, s.source_type, s.source_role, s.fetch_type,
           s.audit_strategy, s.is_active, s.last_fetched_at, s.next_fetch_at,
           s.active_interval_min, s.feed_window_size, s.notes,
           (SELECT count(*)::int FROM raw_documents d
              WHERE d.source_id = s.id AND d.fetched_at > now() - interval '24 hours') AS docs_24h,
           (SELECT count(*)::int FROM raw_documents d WHERE d.source_id = s.id) AS docs_total,
           (SELECT round(100.0 * count(*) FILTER (WHERE d.image_url IS NOT NULL)
                          / nullif(count(*), 0))::int
              FROM raw_documents d
              WHERE d.source_id = s.id AND d.fetched_at > now() - interval '7 days') AS image_pct_7d,
           (SELECT max(f.items_new) FROM fetch_log f
              WHERE f.source_id = s.id AND f.attempted_at > now() - interval '7 days') AS peak_new,
           (SELECT count(*)::int FROM source_errors e
              WHERE e.source_id = s.id AND e.resolved_at IS NULL) AS open_errors,
           (SELECT f.error FROM fetch_log f
              WHERE f.source_id = s.id AND f.error IS NOT NULL
              ORDER BY f.attempted_at DESC LIMIT 1) AS last_error
    FROM sources s
    WHERE s.source_kind = 'news'
    ORDER BY s.vertical, s.name
  `);
  return [...rows];
}

export type CoverageRow = {
  slug: string;
  name: string;
  vertical: 'finance' | 'tech';
  audit_date: string;
  strategy: string;
  status: 'ok' | 'gap' | 'error';
  expected_count: number | null;
  ingested_count: number | null;
  missing_urls: string[];
  detail: string | null;
}

/** The most recent audit for each source. */
export async function getLatestCoverage(): Promise<CoverageRow[]> {
  const rows = await getDb().execute<CoverageRow>(sql`
    SELECT DISTINCT ON (c.source_id)
           s.slug, s.name, s.vertical, c.audit_date, c.strategy, c.status,
           c.expected_count, c.ingested_count, c.missing_urls, c.detail
    FROM coverage_audit c
    JOIN sources s ON s.id = c.source_id
    ORDER BY c.source_id, c.audit_date DESC
  `);
  return [...rows];
}

export type Totals = {
  sources_news: number;
  sources_data: number;
  sources_active: number;
  docs_total: number;
  docs_24h: number;
  wire_flagged_24h: number;
  with_image_24h: number;
  open_errors: number;
}

export async function getTotals(): Promise<Totals> {
  const rows = await getDb().execute<Totals>(sql`
    SELECT
      (SELECT count(*)::int FROM sources WHERE source_kind = 'news') AS sources_news,
      (SELECT count(*)::int FROM sources WHERE source_kind = 'data') AS sources_data,
      (SELECT count(*)::int FROM sources WHERE source_kind = 'news' AND is_active) AS sources_active,
      (SELECT count(*)::int FROM raw_documents) AS docs_total,
      (SELECT count(*)::int FROM raw_documents WHERE fetched_at > now() - interval '24 hours') AS docs_24h,
      (SELECT count(*)::int FROM raw_documents
         WHERE fetched_at > now() - interval '24 hours'
           AND origin_wire_byline IS NOT NULL) AS wire_flagged_24h,
      (SELECT count(*)::int FROM raw_documents
         WHERE fetched_at > now() - interval '24 hours'
           AND image_url IS NOT NULL) AS with_image_24h,
      (SELECT count(*)::int FROM source_errors WHERE resolved_at IS NULL) AS open_errors
  `);
  return (
    rows[0] ?? {
      sources_news: 0,
      sources_data: 0,
      sources_active: 0,
      docs_total: 0,
      docs_24h: 0,
      wire_flagged_24h: 0,
      with_image_24h: 0,
      open_errors: 0,
    }
  );
}

export type DocumentRow = {
  id: string;
  url: string;
  title: string | null;
  vertical: 'finance' | 'tech';
  source_name: string;
  fetched_at: string;
  published_at: string;
  published_at_confidence: 'high' | 'low' | 'suspect';
  extraction_status: string;
  text_length: number | null;
  origin_wire_byline: string | null;
  origin_wire_evidence: string | null;
  origin_primary_links: string[];
  origin_discovery_target_url: string | null;
  image_url: string | null;
  image_source: string | null;
  image_width: number | null;
}

export async function getRecentDocuments(limit = 100): Promise<DocumentRow[]> {
  const rows = await getDb().execute<DocumentRow>(sql`
    SELECT d.id, d.url, d.title, d.vertical, s.name AS source_name,
           d.fetched_at, d.published_at, d.published_at_confidence,
           d.extraction_status, length(d.text_content) AS text_length,
           d.origin_wire_byline, d.origin_wire_evidence, d.origin_primary_links,
           d.origin_discovery_target_url,
           d.image_url, d.image_source, d.image_width
    FROM raw_documents d
    JOIN sources s ON s.id = d.source_id
    ORDER BY d.fetched_at DESC
    LIMIT ${limit}
  `);
  return [...rows];
}

export type RegistryRow = {
  slug: string;
  name: string;
  vertical: string;
  source_kind: string;
  source_type: string;
  source_role: string;
  fetch_type: string;
  audit_strategy: string;
  reliability_weight: number;
  is_active: boolean;
  feed_url: string;
  topics: string[];
  notes: string | null;
}

export async function getRegistry(): Promise<RegistryRow[]> {
  const rows = await getDb().execute<RegistryRow>(sql`
    SELECT slug, name, vertical, source_kind, source_type, source_role, fetch_type,
           audit_strategy, reliability_weight, is_active, feed_url, topics, notes
    FROM sources
    ORDER BY vertical, source_kind, name
  `);
  return [...rows];
}

/** True when a full feed window came back entirely new — we may have missed older items. */
export function isUnderPolled(source: SourceHealth): boolean {
  if (source.feed_window_size === null || source.peak_new === null) return false;
  return source.feed_window_size > 0 && source.peak_new >= source.feed_window_size;
}

/** A source is stale once it has missed two consecutive scheduled fetches. */
export function isStale(source: SourceHealth): boolean {
  if (!source.is_active || !source.last_fetched_at) return false;
  const ageMs = Date.now() - new Date(source.last_fetched_at).getTime();
  return ageMs > source.active_interval_min * 60_000 * 2;
}

export type FeedRow = {
  id: string;
  url: string;
  title: string | null;
  vertical: 'finance' | 'tech';
  source_name: string;
  source_type: string;
  source_role: string;
  reliability_weight: number;
  published_at: string;
  published_at_confidence: 'high' | 'low' | 'suspect';
  image_url: string | null;
  snippet: string | null;
  origin_wire_byline: string | null;
  origin_primary_links: string[];
  topics: string[];
};

/**
 * Raw ingested documents as cards.
 *
 * This is a preview of the pipeline's *input*, not the product: there is no clustering, so
 * the same wire story appears once per outlet that ran it, and no summarisation, so the
 * body text is the publisher's own opening lines. Both arrive in Phase 2. It exists so the
 * fetcher's output is inspectable as content rather than as table rows.
 */
export async function getFeed(vertical: 'finance' | 'tech' | null, limit = 60): Promise<FeedRow[]> {
  const rows = await getDb().execute<FeedRow>(sql`
    SELECT d.id, d.url, d.title, d.vertical, s.name AS source_name, s.source_type,
           s.source_role, s.reliability_weight, d.published_at, d.published_at_confidence,
           d.image_url, d.origin_wire_byline, d.origin_primary_links, s.topics,
           left(regexp_replace(coalesce(d.text_content, ''), '\s+', ' ', 'g'), 400) AS snippet
    FROM raw_documents d
    JOIN sources s ON s.id = d.source_id
    WHERE (${vertical}::text IS NULL OR d.vertical = ${vertical}::text::vertical)
    ORDER BY d.published_at DESC, d.fetched_at DESC
    LIMIT ${limit}
  `);
  return [...rows];
}
