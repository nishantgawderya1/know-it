/**
 * One-off: remove documents whose URL predates a canonicalisation change.
 *
 * When `lowercase_url_path` was added for RBI, the rows already stored kept their original
 * mixed-case URLs. Postgres sees those as distinct from the lowercased form, so the same
 * press release now exists twice — and a duplicate document is not a cosmetic problem:
 * the provenance layer counts documents to decide how many independent sources reported a
 * claim, and two rows for one RBI release would inflate that count.
 *
 * Keeps the row whose URL matches what the current canonicaliser produces.
 */

import { sql } from 'drizzle-orm';
import { createDb } from '@knowit/db';

async function main(): Promise<void> {
  const db = createDb({ max: 1 });

  const stale = await db.execute<{ url: string; slug: string }>(sql`
    SELECT d.url, s.slug
    FROM raw_documents d
    JOIN sources s ON s.id = d.source_id
    WHERE s.lowercase_url_path
      AND d.url <> lower(d.url)`);

  if (stale.length === 0) {
    console.log('no pre-canonicalisation rows found — nothing to do');
    process.exit(0);
  }

  console.log(`${stale.length} rows stored before lowercase_url_path was enabled:`);
  for (const row of stale.slice(0, 5)) console.log(`  ${row.slug}  ${row.url}`);
  if (stale.length > 5) console.log(`  ... and ${stale.length - 5} more`);

  const deleted = await db.execute<{ id: string }>(sql`
    DELETE FROM raw_documents d
    USING sources s
    WHERE s.id = d.source_id
      AND s.lowercase_url_path
      AND d.url <> lower(d.url)
    RETURNING d.id`);

  console.log(`\ndeleted ${deleted.length} duplicate rows`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('cleanup failed:', error);
  process.exit(1);
});
