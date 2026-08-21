/**
 * A single scheduler tick, then exit.
 *
 * This is the first-run smoke test: seed the registry, run this, and confirm rows land in
 * raw_documents with populated text and origin columns. Also the fastest way to check one
 * source after fixing its feed URL.
 *
 *   npm run worker:once                    # whatever is due
 *   npm run worker:once -- sebi-press-releases   # force one source, ignoring its schedule
 */

import { eq } from 'drizzle-orm';
import { getDb, sources } from '@knowit/db';
import { DomainLimiter } from './politeness.js';
import { processSource } from './pipeline.js';
import { formatOutcome, loadPrimaryDomains, runTick } from './tick.js';

async function main(): Promise<void> {
  const db = getDb();
  const limiter = new DomainLimiter();
  const primaryDomains = await loadPrimaryDomains(db);
  const slug = process.argv[2];

  if (slug) {
    const [source] = await db.select().from(sources).where(eq(sources.slug, slug)).limit(1);
    if (!source) {
      console.error(`no source with slug "${slug}"`);
      process.exit(1);
    }
    const outcome = await processSource(db, source, limiter, primaryDomains);
    console.log(formatOutcome(outcome));
    process.exit(outcome.error ? 1 : 0);
  }

  const { claimed, outcomes } = await runTick(db, limiter, primaryDomains);
  if (claimed === 0) {
    console.log('nothing due — pass a slug to force one source');
    process.exit(0);
  }

  const created = outcomes.reduce((sum, o) => sum + o.itemsNew, 0);
  const failed = outcomes.filter((o) => o.error).length;
  console.log(`${claimed} sources · ${created} new documents · ${failed} failed`);
  for (const outcome of outcomes) console.log(formatOutcome(outcome));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('run failed:', error);
  process.exit(1);
});
