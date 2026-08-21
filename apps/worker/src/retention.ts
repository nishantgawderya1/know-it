/**
 * Retention.
 *
 * Automated on day one, deliberately: retention that depends on someone remembering never
 * happens. Note these NULL the heavy columns rather than deleting rows — the row itself is
 * the coverage record, and coverage is the thing this whole phase exists to measure.
 * Dropping it to save disk would destroy the evidence and keep the cost.
 */

import { and, isNotNull, lt, sql } from 'drizzle-orm';
import { rawDocuments, type Database } from '@knowit/db';
import { config } from './config.js';

export interface RetentionResult {
  textCleared: number;
  htmlCleared: number;
}

export async function applyRetention(db: Database): Promise<RetentionResult> {
  const textCutoff = new Date(Date.now() - config.articleTextRetentionDays * 86_400_000);
  const htmlCutoff = new Date(Date.now() - config.htmlSnapshotRetentionHours * 3_600_000);

  // Article text: copyright posture. We publish original summaries and link out; holding
  // publishers' text indefinitely is the exposure the Inshorts model exists to avoid.
  const text = await db
    .update(rawDocuments)
    .set({ textContent: null })
    .where(and(lt(rawDocuments.fetchedAt, textCutoff), isNotNull(rawDocuments.textContent)))
    .returning({ id: rawDocuments.id });

  // Raw HTML is kept only long enough to debug an extraction failure.
  const html = await db
    .update(rawDocuments)
    .set({ htmlSnapshot: null })
    .where(and(lt(rawDocuments.fetchedAt, htmlCutoff), isNotNull(rawDocuments.htmlSnapshot)))
    .returning({ id: rawDocuments.id });

  return { textCleared: text.length, htmlCleared: html.length };
}

/** Rows whose heavy columns are still populated past their window — should be zero. */
export async function retentionDebt(db: Database): Promise<number> {
  const rows = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count
        FROM raw_documents
        WHERE (text_content IS NOT NULL AND fetched_at < now() - ${sql.raw(`interval '${config.articleTextRetentionDays} days'`)})
           OR (html_snapshot IS NOT NULL AND fetched_at < now() - ${sql.raw(`interval '${config.htmlSnapshotRetentionHours} hours'`)})`,
  );
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}
