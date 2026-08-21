/**
 * Coverage auditing.
 *
 * This is the number Phase 1 exists to produce. Everything else is plumbing that feeds it.
 *
 * Regulators publish an index of everything they released; we diff ours against theirs.
 * That turns "coverage completeness" from a weekly survey question into a monitored value,
 * and turns each miss into a named registry gap instead of a vague complaint.
 *
 * A failed audit MUST record `error`, never `ok`. An auditor that reports "no gaps"
 * because its scrape broke is worse than no auditor at all — it manufactures confidence.
 */

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { canonicalizeUrl } from '@knowit/core';
import { conditionalGet, harvestIndexLinks } from '@knowit/adapters';
import { coverageAudit, rawDocuments, sources, type Database, type Source } from '@knowit/db';
import { config } from './config.js';
import { DomainLimiter, hostOf } from './politeness.js';

export interface AuditOutcome {
  slug: string;
  strategy: string;
  status: 'ok' | 'gap' | 'error';
  expected: number | null;
  ingested: number | null;
  missing: string[];
  detail: string | null;
}

/** UTC date key. Audits are daily and the worker runs in UTC. */
function auditDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function whichAreIngested(db: Database, urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const rows = await db
    .select({ url: rawDocuments.url })
    .from(rawDocuments)
    .where(inArray(rawDocuments.url, urls));
  return new Set(rows.map((row) => row.url));
}

/**
 * Diff the publisher's own index against what we hold.
 *
 * Deliberately not scoped to today: an item on the index that we never ingested is a miss
 * whenever it was published, and a date-scoped diff would quietly forgive older gaps.
 */
async function auditByIndexDiff(
  db: Database,
  source: Source,
  limiter: DomainLimiter,
): Promise<AuditOutcome> {
  const indexUrl = source.indexUrl ?? source.feedUrl;

  const response = await limiter.run(hostOf(indexUrl), () =>
    conditionalGet(
      indexUrl,
      {},
      { userAgent: source.userAgent ?? config.userAgent, timeoutMs: config.requestTimeoutMs },
      'text/html,application/xhtml+xml',
    ),
  );

  // Refuse rather than manufacture a number. Without an article pattern the harvest
  // returns navigation, and every nav link becomes a fabricated "missing" URL — an auditor
  // that cries wolf gets ignored, which costs us the real miss later.
  if (!source.indexLinkPattern) {
    throw new Error(
      'no index_link_pattern configured — cannot separate article links from site ' +
        'navigation, and a diff without that distinction would report false gaps',
    );
  }

  // The fetcher and the auditor must agree on what the index contains, or the audit
  // reports phantom gaps. Same function, same pattern, deliberately.
  const harvested = harvestIndexLinks(response.body, indexUrl, {
    pattern: new RegExp(source.indexLinkPattern),
  });
  if (harvested.length === 0) {
    throw new Error(
      `index matched no links against /${source.indexLinkPattern}/ — layout or URL scheme changed`,
    );
  }

  const expected = [
    ...new Set(
      harvested
        .map((link) => canonicalizeUrl(link.url, { lowercasePath: source.lowercaseUrlPath }))
        .filter((url): url is string => url !== null),
    ),
  ];

  const ingested = await whichAreIngested(db, expected);
  const missing = expected.filter((url) => !ingested.has(url));

  return {
    slug: source.slug,
    strategy: source.auditStrategy,
    status: missing.length === 0 ? 'ok' : 'gap',
    expected: expected.length,
    ingested: ingested.size,
    missing: missing.slice(0, 50),
    detail:
      source.auditStrategy === 'calendar_expect'
        ? 'index diff only — the publication calendar is not yet wired up, so a late release is not detected until it appears on the index'
        : null,
  };
}

/**
 * Weak audit for Tech: no authority enumerates "all tech news today", so Hacker News acts
 * as approximate ground truth. Anything HN surfaced that we do not hold is a candidate gap
 * for human triage — not an alarm, and labelled as weaker wherever it is shown.
 */
async function auditByProxySample(db: Database, source: Source): Promise<AuditOutcome> {
  const targets = await db
    .select({ target: rawDocuments.originDiscoveryTargetUrl })
    .from(rawDocuments)
    .where(
      and(
        eq(rawDocuments.sourceId, source.id),
        isNotNull(rawDocuments.originDiscoveryTargetUrl),
        sql`${rawDocuments.fetchedAt} > now() - interval '24 hours'`,
      ),
    );

  const expected = [
    ...new Set(
      targets
        .map((row) => canonicalizeUrl(row.target))
        .filter((url): url is string => url !== null),
    ),
  ];

  if (expected.length === 0) {
    return {
      slug: source.slug,
      strategy: source.auditStrategy,
      status: 'ok',
      expected: 0,
      ingested: 0,
      missing: [],
      detail: 'no discovery targets in the last 24h — nothing to compare against',
    };
  }

  const ingested = await whichAreIngested(db, expected);
  const missing = expected.filter((url) => !ingested.has(url));

  return {
    slug: source.slug,
    strategy: source.auditStrategy,
    status: missing.length === 0 ? 'ok' : 'gap',
    expected: expected.length,
    ingested: ingested.size,
    missing: missing.slice(0, 50),
    detail:
      'proxy sample — HN is not an authoritative index, so these are candidates for triage rather than confirmed misses',
  };
}

export async function auditSource(
  db: Database,
  source: Source,
  limiter: DomainLimiter,
): Promise<AuditOutcome> {
  try {
    if (source.auditStrategy === 'proxy_sample') return await auditByProxySample(db, source);
    return await auditByIndexDiff(db, source, limiter);
  } catch (error: unknown) {
    // Never let a broken auditor look like a clean bill of health.
    return {
      slug: source.slug,
      strategy: source.auditStrategy,
      status: 'error',
      expected: null,
      ingested: null,
      missing: [],
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runCoverageAudit(db: Database): Promise<AuditOutcome[]> {
  const auditable = await db
    .select()
    .from(sources)
    .where(and(eq(sources.isActive, true), sql`${sources.auditStrategy} <> 'none'`));

  const limiter = new DomainLimiter();
  const date = auditDate();
  const outcomes: AuditOutcome[] = [];

  for (const source of auditable) {
    const outcome = await auditSource(db, source, limiter);
    outcomes.push(outcome);

    await db
      .insert(coverageAudit)
      .values({
        sourceId: source.id,
        vertical: source.vertical,
        auditDate: date,
        strategy: source.auditStrategy,
        expectedCount: outcome.expected,
        ingestedCount: outcome.ingested,
        missingUrls: outcome.missing,
        status: outcome.status,
        detail: outcome.detail,
      })
      .onConflictDoUpdate({
        target: [coverageAudit.sourceId, coverageAudit.auditDate],
        set: {
          expectedCount: outcome.expected,
          ingestedCount: outcome.ingested,
          missingUrls: outcome.missing,
          status: outcome.status,
          detail: outcome.detail,
          strategy: source.auditStrategy,
        },
      });
  }

  return outcomes;
}
