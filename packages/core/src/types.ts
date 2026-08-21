/**
 * The shared vocabulary of the ingestion engine.
 *
 * These types are duplicated as Postgres enums in @knowit/db. If you change one,
 * change both — the migration is the source of truth for the database, this file
 * is the source of truth for the code.
 */

export type Vertical = 'finance' | 'tech';

/**
 * `news` sources produce articles that can be extracted, clustered and summarised.
 * `data` sources (AMFI NAV, NSE quotes, Alpha Vantage) produce numbers. They have no
 * text to extract and cannot pass through the news pipeline, so the fetcher skips
 * them until the Phase 3 enrichment layer exists.
 */
export type SourceKind = 'news' | 'data';

export type SourceType =
  | 'regulator'
  | 'exchange'
  | 'industry_body'
  | 'outlet'
  | 'wire'
  | 'analyst_blog'
  | 'company_blog'
  | 'code_release'
  | 'community';

/**
 * `record` sources make claims we can count toward corroboration.
 * `discovery` sources (Hacker News, aggregators) only point at claims made elsewhere.
 * Forty HN comments is corroboration of zero — discovery never counts.
 */
export type SourceRole = 'record' | 'discovery';

export type FetchType = 'rss' | 'atom' | 'scrape' | 'hn' | 'github_api' | 'json_api';

/**
 * How we verify we didn't miss anything from this source.
 * - index_diff:     the source publishes an index of everything it released; diff against it.
 * - calendar_expect: the source publishes on a fixed public calendar; alarm when a due item is absent.
 * - proxy_sample:   no authority enumerates the day; use a weaker proxy (HN) as approximate truth.
 * - none:           unauditable (most outlets).
 */
export type AuditStrategy = 'index_diff' | 'calendar_expect' | 'proxy_sample' | 'none';

/**
 * What kind of claim a story makes. Derived deterministically from the source registry,
 * never from a model.
 *
 * There is deliberately no `confirmed`/`unconfirmed` value. A confirmed badge is a truth
 * score, and we do not publish truth scores — we publish where a claim came from.
 */
export type ClaimType = 'announced' | 'reported' | 'rumoured' | 'speculated';

/**
 * How much we trust a document's publication timestamp.
 * - high:    parsed from an explicit timezone-qualified date
 * - low:     parsed without timezone, or fell back to fetch time
 * - suspect: implausible (far future, or far past relative to fetch — a re-promoted story)
 *
 * A wrong timestamp becomes a clustering bug two stages downstream, so we record
 * our confidence rather than silently pretending we know.
 */
export type TimestampConfidence = 'high' | 'low' | 'suspect';

/** Wire agencies whose copy is syndicated across Indian outlets. */
export const WIRE_AGENCIES = [
  'PTI',
  'ANI',
  'Reuters',
  'AFP',
  'IANS',
  'Bloomberg',
  'AP',
] as const;

export type WireAgency = (typeof WIRE_AGENCIES)[number];
