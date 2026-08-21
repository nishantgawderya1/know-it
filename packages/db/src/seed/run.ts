/**
 * Load the source registry.
 *
 * Idempotent and re-runnable: rows are upserted on `slug`, and scheduler state
 * (`next_fetch_at`, `last_etag`, `last_fetched_at`, `feed_window_size`) is deliberately
 * left alone. Re-seeding after editing a feed URL must not reset polling or throw away
 * the conditional-GET state and start refetching everything.
 */

import { sql } from 'drizzle-orm';
import { createDb } from '../client.js';
import { sources, type NewSource } from '../schema.js';
import { financeSources } from './finance.js';
import { techSources } from './tech.js';
import type { SeedSource } from './types.js';

function toInsert(source: SeedSource): NewSource {
  return {
    slug: source.slug,
    name: source.name,
    vertical: source.vertical,
    sourceKind: source.sourceKind ?? 'news',
    sourceType: source.sourceType,
    sourceRole: source.sourceRole ?? 'record',
    feedUrl: source.feedUrl,
    fetchType: source.fetchType,
    userAgent: source.userAgent ?? null,
    indexUrl: source.indexUrl ?? null,
    indexLinkPattern: source.indexLinkPattern ?? null,
    lowercaseUrlPath: source.lowercaseUrlPath ?? false,
    auditStrategy: source.auditStrategy ?? 'none',
    activeHoursTz: source.activeHoursTz ?? 'Asia/Kolkata',
    activeStartHour: source.activeStartHour ?? 0,
    activeEndHour: source.activeEndHour ?? 24,
    activeIntervalMin: source.activeIntervalMin ?? 15,
    offIntervalMin: source.offIntervalMin ?? 120,
    reliabilityWeight: source.reliabilityWeight ?? 0.7,
    isFullText: source.isFullText ?? null,
    isActive: source.isActive ?? true,
    topics: source.topics ?? [],
    notes: source.notes ?? null,
  };
}

/** A duplicate slug here is far easier to read than a unique-constraint violation. */
function assertUniqueSlugs(all: SeedSource[]): void {
  const seen = new Map<string, string>();
  for (const source of all) {
    const existing = seen.get(source.slug);
    if (existing) {
      throw new Error(`duplicate slug "${source.slug}" (${existing} and ${source.name})`);
    }
    seen.set(source.slug, source.name);
  }
}

function summarise(all: SeedSource[]): string {
  const lines: string[] = [];
  for (const vertical of ['finance', 'tech'] as const) {
    const rows = all.filter((s) => s.vertical === vertical);
    const news = rows.filter((s) => (s.sourceKind ?? 'news') === 'news');
    const active = news.filter((s) => s.isActive !== false);
    const audited = news.filter((s) => s.auditStrategy && s.auditStrategy !== 'none');
    const scrapers = news.filter((s) => s.fetchType === 'scrape');
    lines.push(
      `  ${vertical.padEnd(8)} ${String(rows.length).padStart(2)} rows · ` +
        `${news.length} news (${active.length} active) · ` +
        `${rows.length - news.length} data · ` +
        `${audited.length} audited · ${scrapers.length} scrapers`,
    );
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const all = [...financeSources, ...techSources];
  assertUniqueSlugs(all);

  const db = createDb({ max: 1 });
  const rows = all.map(toInsert);

  await db
    .insert(sources)
    .values(rows)
    .onConflictDoUpdate({
      target: sources.slug,
      set: {
        name: sql`excluded.name`,
        vertical: sql`excluded.vertical`,
        sourceKind: sql`excluded.source_kind`,
        sourceType: sql`excluded.source_type`,
        sourceRole: sql`excluded.source_role`,
        feedUrl: sql`excluded.feed_url`,
        fetchType: sql`excluded.fetch_type`,
        userAgent: sql`excluded.user_agent`,
        indexUrl: sql`excluded.index_url`,
        indexLinkPattern: sql`excluded.index_link_pattern`,
        lowercaseUrlPath: sql`excluded.lowercase_url_path`,
        auditStrategy: sql`excluded.audit_strategy`,
        activeHoursTz: sql`excluded.active_hours_tz`,
        activeStartHour: sql`excluded.active_start_hour`,
        activeEndHour: sql`excluded.active_end_hour`,
        activeIntervalMin: sql`excluded.active_interval_min`,
        offIntervalMin: sql`excluded.off_interval_min`,
        reliabilityWeight: sql`excluded.reliability_weight`,
        isFullText: sql`excluded.is_full_text`,
        isActive: sql`excluded.is_active`,
        topics: sql`excluded.topics`,
        notes: sql`excluded.notes`,
        updatedAt: sql`now()`,
        // next_fetch_at, last_etag, last_modified, last_fetched_at and feed_window_size
        // are runtime state, not configuration. Re-seeding must not disturb them.
      },
    });

  console.log(`seeded ${rows.length} sources\n${summarise(all)}`);

  const needsSectionFeeds = all.filter((s) => s.notes?.includes('NEEDS SECTION FEEDS'));
  if (needsSectionFeeds.length > 0) {
    console.log(
      `\n${needsSectionFeeds.length} source(s) still on site-wide feeds — resolve to section feeds ` +
        `before trusting volume figures:\n` +
        needsSectionFeeds.map((s) => `  - ${s.name} (${s.slug})`).join('\n'),
    );
  }

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('seed failed:', error);
  process.exit(1);
});
