/**
 * Fetch exactly one source, by slug, ignoring the schedule.
 *
 * `worker:once` claims whatever the scheduler says is due, which makes it useless for
 * "did my change to this one source work?" — the answer arrives twenty minutes later
 * buried in a batch of unrelated feeds. This runs one row, now, and prints what landed.
 *
 *   npm run fetch:one -- cnbc-tv18-markets
 */

import { eq } from 'drizzle-orm';
import { createDb, sources } from '@knowit/db';
import { DomainLimiter } from './politeness.js';
import { loadPrimaryDomains, processSource } from './pipeline.js';

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('usage: npm run fetch:one -- <slug>');
    process.exit(1);
  }

  const db = createDb({ max: 2 });
  const [source] = await db.select().from(sources).where(eq(sources.slug, slug)).limit(1);
  if (!source) {
    console.error(`no source with slug "${slug}"`);
    process.exit(1);
  }

  const outcome = await processSource(db, source, new DomainLimiter(), await loadPrimaryDomains(db));

  console.log(
    outcome.error
      ? `${slug}: FAILED ${outcome.error}`
      : `${slug}: ${outcome.itemsNew} new / ${outcome.itemsSeen} seen · ` +
        `${outcome.itemsWithImage} with image · ${outcome.durationMs}ms`,
  );
  process.exit(outcome.error ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('fetch-one failed:', error);
  process.exit(1);
});
