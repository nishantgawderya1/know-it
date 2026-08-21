/**
 * Verify registry endpoints against the live network — with no database.
 *
 * The registry was seeded from the sources doc, and a feed URL taken from a document is a
 * hypothesis until something fetches it. This runs the real adapters over the real network
 * so every endpoint is confirmed (or corrected) before Supabase exists, rather than
 * discovering a dead URL days into a coverage run.
 *
 *   npm run probe                       # every active news source
 *   npm run probe -- finance            # one vertical
 *   npm run probe -- sebi-press-releases  # one source
 */

import { allSources, type SeedSource } from '@knowit/db/seed';
import { AdapterError, getAdapter, type FetchContext } from '@knowit/adapters';
import { canonicalizeUrl, parsePublishedAt, selectLeadImage } from '@knowit/core';
import { DomainLimiter, hostOf } from './politeness.js';

const CONCURRENCY = 6;
const TIMEOUT_MS = 15_000;

const context: FetchContext = {
  userAgent: process.env.WORKER_USER_AGENT ?? 'KnowItBot/0.1 (+https://knowit.example/bot)',
  timeoutMs: TIMEOUT_MS,
  githubToken: process.env.GITHUB_TOKEN || undefined,
};

interface ProbeResult {
  source: SeedSource;
  ok: boolean;
  items: number;
  durationMs: number;
  sampleTitle: string | null;
  datedItems: number;
  /** Items yielding a usable lead image. A silent drop here is how images stop arriving. */
  imagedItems: number;
  /** Which feed element supplied them, so a changed feed shape is visible, not inferred. */
  imageSources: string[];
  error: string | null;
}

async function probe(source: SeedSource, limiter: DomainLimiter): Promise<ProbeResult> {
  const startedAt = Date.now();
  const base = {
    source,
    items: 0,
    sampleTitle: null,
    datedItems: 0,
    imagedItems: 0,
    imageSources: [] as string[],
  };

  try {
    const adapter = getAdapter(source.fetchType);
    const result = await limiter.run(hostOf(source.feedUrl), () =>
      adapter.fetch(
        {
          slug: source.slug,
          feedUrl: source.feedUrl,
          fetchType: source.fetchType,
          // Without this a `scrape` source refuses to run, and the probe would report a
          // correctly-configured scraper as broken.
          indexLinkPattern: source.indexLinkPattern,
        },
        {},
        source.userAgent ? { ...context, userAgent: source.userAgent } : context,
      ),
    );

    const now = new Date();
    // Count how many items carry a trustworthy date: a feed that parses but dates nothing
    // still costs us clustering accuracy two phases from now.
    const dated = result.items.filter(
      (item) => parsePublishedAt(item.publishedAtRaw, now).confidence === 'high',
    ).length;

    const usable = result.items.filter((item) => canonicalizeUrl(item.urlRaw) !== null).length;

    // Feed-level only: the probe never fetches article pages, so og:image is out of scope
    // here. This is the number that tells us whether a feed still ships images at all.
    const images = result.items
      .map((item) => selectLeadImage(item.imageCandidates ?? [], item.urlRaw))
      .filter((image): image is NonNullable<typeof image> => image !== null);

    return {
      ...base,
      ok: usable > 0,
      items: usable,
      datedItems: dated,
      imagedItems: images.length,
      imageSources: [...new Set(images.map((image) => image.source))],
      sampleTitle: result.items[0]?.title?.slice(0, 58) ?? null,
      durationMs: Date.now() - startedAt,
      error: usable === 0 ? 'fetched but produced no usable URLs' : null,
    };
  } catch (error: unknown) {
    const message =
      error instanceof AdapterError
        ? `${error.kind}${error.httpStatus ? ` ${error.httpStatus}` : ''}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    return { ...base, ok: false, durationMs: Date.now() - startedAt, error: message.slice(0, 160) };
  }
}

function selected(): SeedSource[] {
  const filter = process.argv[2]?.toLowerCase();
  const news = allSources.filter((s) => (s.sourceKind ?? 'news') === 'news' && s.isActive !== false);
  if (!filter) return news;
  if (filter === 'finance' || filter === 'tech') return news.filter((s) => s.vertical === filter);
  return allSources.filter((s) => s.slug === filter);
}

async function main(): Promise<void> {
  const sources = selected();
  if (sources.length === 0) {
    console.error('no sources matched — pass a vertical (finance|tech) or a slug');
    process.exit(1);
  }

  console.log(`probing ${sources.length} sources · ${TIMEOUT_MS / 1000}s timeout\n`);

  const limiter = new DomainLimiter({ minGapMs: 500 });
  const results: ProbeResult[] = [];

  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(batch.map((source) => probe(source, limiter)))));
  }

  for (const vertical of ['finance', 'tech'] as const) {
    const rows = results.filter((r) => r.source.vertical === vertical);
    if (rows.length === 0) continue;

    console.log(vertical.toUpperCase());
    for (const row of rows.sort((a, b) => Number(a.ok) - Number(b.ok))) {
      const flag = row.ok ? 'OK  ' : 'FAIL';
      const images =
        row.items > 0
          ? `${String(Math.round((row.imagedItems / row.items) * 100)).padStart(3)}% img`
          : '       ';
      const detail = row.ok
        ? `${String(row.items).padStart(4)} items ${String(row.datedItems).padStart(4)} dated ${images}  ` +
          `${row.imageSources.join(',').padEnd(22)} ${row.sampleTitle ?? ''}`
        : row.error;
      console.log(
        `  ${flag} ${row.source.slug.padEnd(24)} ${row.source.fetchType.padEnd(10)} ` +
          `${String(row.durationMs).padStart(6)}ms  ${detail}`,
      );
    }
    console.log('');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length} probed · ${results.length - failed.length} ok · ${failed.length} failed`);

  if (failed.length > 0) {
    console.log('\nEndpoints needing correction in the registry:');
    for (const row of failed) console.log(`  ${row.source.slug.padEnd(24)} ${row.error}`);
  }

  // Feeds that carry no image at all. Not an error — HN, NSE and BSE legitimately have
  // none — but the feed UI will fall back to a page fetch for these, so it is worth knowing
  // which ones before the cards look empty.
  const imageless = results.filter((r) => r.ok && r.items > 0 && r.imagedItems === 0);
  if (imageless.length > 0) {
    console.log('\nNo feed images (page-level og:image will be the only source):');
    for (const row of imageless) console.log(`  ${row.source.slug}`);
  }

  // Sources that parse but date nothing are a quieter problem worth surfacing now.
  const undated = results.filter((r) => r.ok && r.items > 0 && r.datedItems === 0);
  if (undated.length > 0) {
    console.log('\nFetched but no reliable timestamps (clustering will rely on fetch time):');
    for (const row of undated) console.log(`  ${row.source.slug}`);
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('probe failed:', error);
  process.exit(1);
});
