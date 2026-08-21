/**
 * Phase 1 schema — the ingestion engine only.
 *
 * Discipline from the blueprint: no columns "just in case." Every column here is written
 * or read by Phase 1 code. Clustering, entities, cards and users arrive with the phases
 * that need them.
 *
 * The enums mirror the types in @knowit/core. Change one, change both.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const verticalEnum = pgEnum('vertical', ['finance', 'tech']);

/** `data` sources return numbers, not articles — the news pipeline skips them. */
export const sourceKindEnum = pgEnum('source_kind', ['news', 'data']);

export const sourceTypeEnum = pgEnum('source_type', [
  'regulator',
  'exchange',
  'industry_body',
  'outlet',
  'wire',
  'analyst_blog',
  'company_blog',
  'code_release',
  'community',
]);

/** `discovery` sources point at claims; they never corroborate them. */
export const sourceRoleEnum = pgEnum('source_role', ['record', 'discovery']);

export const fetchTypeEnum = pgEnum('fetch_type', [
  'rss',
  'atom',
  'scrape',
  'hn',
  'github_api',
  'json_api',
]);

export const auditStrategyEnum = pgEnum('audit_strategy', [
  'index_diff',
  'calendar_expect',
  'proxy_sample',
  'none',
]);

export const timestampConfidenceEnum = pgEnum('timestamp_confidence', ['high', 'low', 'suspect']);

export const extractionStatusEnum = pgEnum('extraction_status', [
  'pending',
  'ok',
  'partial',
  'failed',
  'skipped',
]);

export const wireEvidenceEnum = pgEnum('wire_evidence', ['byline', 'dateline', 'mention']);

export const coverageStatusEnum = pgEnum('coverage_status', ['ok', 'gap', 'error']);

/**
 * Which element yielded a document's lead image. Recorded because a shift in this
 * distribution is how we detect that a publisher changed its feed shape — the failure
 * mode is silent, and images simply stop arriving.
 */
export const imageSourceEnum = pgEnum('image_source', [
  'media_content',
  'media_thumbnail',
  'enclosure',
  'content_img',
  'og',
  'twitter',
  'inline',
]);

/**
 * The source registry. This is the moat and the scheduler in one table: adding a source
 * is an INSERT, and `next_fetch_at` is what the worker claims work from.
 */
export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable human key, so seeding is idempotent and re-runnable. */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    vertical: verticalEnum('vertical').notNull(),

    sourceKind: sourceKindEnum('source_kind').notNull().default('news'),
    sourceType: sourceTypeEnum('source_type').notNull(),
    sourceRole: sourceRoleEnum('source_role').notNull().default('record'),

    feedUrl: text('feed_url').notNull(),
    fetchType: fetchTypeEnum('fetch_type').notNull(),
    /**
     * Per-source User-Agent override. Null means the honest default bot identity.
     *
     * Several Indian publishers sit behind WAF rules that reject any non-browser
     * User-Agent outright — including the `Mozilla/5.0 (compatible; ...)` convention.
     * Overriding it per source keeps that an explicit, auditable decision on one row 
     * rather than a silent global default to impersonating a browser.
     */
    userAgent: text('user_agent'),
    /** Publisher's own listing page, used by the index_diff auditor. */
    indexUrl: text('index_url'),
    /**
     * Regex matching this source's ARTICLE urls on its index page.
     *
     * Government portals mix a handful of article links into dozens of navigation links,
     * and generic link harvesting cannot tell them apart: IRDAI's index yielded 122 links
     * of which most were section pages like /about-consumer-affairs. Without this, a
     * `scrape` source ingests navigation as news and the auditor reports the whole nav bar
     * as missing coverage. Derive it by inspecting the index — see docs in the seed files.
     */
    indexLinkPattern: text('index_link_pattern'),
    /**
     * Treat this publisher's URL paths as case-insensitive when deduplicating.
     *
     * Enable for IIS/ASP.NET hosts. RBI serves /Scripts/ from its index and /scripts/ from
     * its RSS feed, so without this the same press release is two documents and the
     * coverage audit reports 0/70 held when we actually hold 10.
     */
    lowercaseUrlPath: boolean('lowercase_url_path').notNull().default(false),
    auditStrategy: auditStrategyEnum('audit_strategy').notNull().default('none'),

    /** Cadence follows the publishing calendar, not raw velocity. */
    activeHoursTz: text('active_hours_tz').notNull().default('Asia/Kolkata'),
    activeStartHour: integer('active_start_hour').notNull().default(0),
    activeEndHour: integer('active_end_hour').notNull().default(24),
    activeIntervalMin: integer('active_interval_min').notNull().default(15),
    offIntervalMin: integer('off_interval_min').notNull().default(120),

    nextFetchAt: timestamp('next_fetch_at', { withTimezone: true }).notNull().defaultNow(),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),

    /** Conditional GET state — a 304 costs one round trip and no parsing. */
    lastEtag: text('last_etag'),
    lastModified: text('last_modified'),

    /** Items the feed exposes. Drives the under-polling detector. */
    feedWindowSize: integer('feed_window_size'),

    reliabilityWeight: real('reliability_weight').notNull().default(0.7),
    /** Recorded at seed time — headline-only feeds need a full-page fetch to extract. */
    isFullText: boolean('is_full_text'),
    isActive: boolean('is_active').notNull().default(true),

    topics: text('topics').array().notNull().default(sql`'{}'::text[]`),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sources_slug_key').on(table.slug),
    // The scheduler's hot query: due, active, news-producing sources.
    index('sources_due_idx')
      .on(table.nextFetchAt)
      .where(sql`${table.isActive} AND ${table.sourceKind} = 'news'`),
    index('sources_vertical_idx').on(table.vertical),
  ],
);

/**
 * One row per fetched article.
 *
 * The `origin_*` columns are captured from raw HTML *before* extraction flattens it —
 * wire bylines and outbound primary links do not survive text extraction, and the
 * provenance layer two phases from now depends on them. Retrofitting means re-fetching.
 */
export const rawDocuments = pgTable(
  'raw_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    vertical: verticalEnum('vertical').notNull(),

    /** Canonicalised — the dedup key. See canonicalizeUrl in @knowit/core. */
    url: text('url').notNull(),
    /** Exactly what the feed gave us, kept for debugging canonicalisation. */
    urlRaw: text('url_raw').notNull(),

    title: text('title'),
    /** Extracted article text. Deleted after 7 days — copyright posture. */
    textContent: text('text_content'),
    /** Raw HTML, kept 48h for extraction debugging, then dropped. */
    htmlSnapshot: text('html_snapshot'),

    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    publishedAtConfidence: timestampConfidenceEnum('published_at_confidence').notNull(),
    publishedAtReason: text('published_at_reason'),

    extractionStatus: extractionStatusEnum('extraction_status').notNull().default('pending'),
    extractionError: text('extraction_error'),

    /** Registry primary domains this article links out to. */
    originPrimaryLinks: text('origin_primary_links').array().notNull().default(sql`'{}'::text[]`),
    /** Wire agency whose copy this is, detected per article — ET carries PTI, BS carries Reuters. */
    originWireByline: text('origin_wire_byline'),
    originWireEvidence: wireEvidenceEnum('origin_wire_evidence'),
    originHasVerbatimQuote: boolean('origin_has_verbatim_quote').notNull().default(false),
    /** For discovery sources: the URL the post points at. */
    originDiscoveryTargetUrl: text('origin_discovery_target_url'),

    /**
     * Lead image, hotlinked from the publisher. Not re-hosted: rehosting is a copyright
     * posture change, and the feed UI can proxy at render time when it needs to.
     */
    imageUrl: text('image_url'),
    imageSource: imageSourceEnum('image_source'),
    imageWidth: integer('image_width'),
    imageHeight: integer('image_height'),

    isProcessed: boolean('is_processed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('raw_documents_url_key').on(table.url),
    index('raw_documents_vertical_fetched_idx').on(table.vertical, table.fetchedAt),
    index('raw_documents_source_fetched_idx').on(table.sourceId, table.fetchedAt),
    index('raw_documents_unprocessed_idx')
      .on(table.fetchedAt)
      .where(sql`NOT ${table.isProcessed}`),
  ],
);

/** Every fetch attempt. Powers source health and the under-polling detector. */
export const fetchLog = pgTable(
  'fetch_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
    /** Null when the request failed before a response (DNS, timeout, connection reset). */
    httpStatus: integer('http_status'),
    itemsSeen: integer('items_seen').notNull().default(0),
    itemsNew: integer('items_new').notNull().default(0),
    /**
     * New items that carried a usable lead image. Makes image coverage a monitored
     * number rather than something noticed when the feed UI looks wrong.
     */
    itemsWithImage: integer('items_with_image').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    error: text('error'),
  },
  (table) => [index('fetch_log_source_time_idx').on(table.sourceId, table.attemptedAt)],
);

/**
 * Daily completeness check. This is the number Phase 1 exists to produce — coverage is
 * audited against the publisher's own index, not surveyed weekly from users.
 */
export const coverageAudit = pgTable(
  'coverage_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    vertical: verticalEnum('vertical').notNull(),
    auditDate: text('audit_date').notNull(),
    strategy: auditStrategyEnum('strategy').notNull(),
    expectedCount: integer('expected_count'),
    ingestedCount: integer('ingested_count'),
    missingUrls: text('missing_urls').array().notNull().default(sql`'{}'::text[]`),
    /**
     * `error` means the auditor itself failed. It is deliberately distinct from `ok`:
     * an auditor reporting "no gaps" because its scrape broke is worse than no auditor.
     */
    status: coverageStatusEnum('status').notNull(),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('coverage_audit_source_date_key').on(table.sourceId, table.auditDate),
    index('coverage_audit_date_idx').on(table.auditDate),
  ],
);

/** Open problems per source. A source silently returning nothing is the failure that matters. */
export const sourceErrors = pgTable(
  'source_errors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    errorType: text('error_type').notNull(),
    message: text('message'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    index('source_errors_open_idx')
      .on(table.sourceId, table.occurredAt)
      .where(sql`${table.resolvedAt} IS NULL`),
  ],
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type RawDocument = typeof rawDocuments.$inferSelect;
export type NewRawDocument = typeof rawDocuments.$inferInsert;
export type FetchLogRow = typeof fetchLog.$inferSelect;
export type NewFetchLogRow = typeof fetchLog.$inferInsert;
export type CoverageAuditRow = typeof coverageAudit.$inferSelect;
export type NewCoverageAuditRow = typeof coverageAudit.$inferInsert;
