import type { Database } from '@knowit/db';
import { config } from './config.js';
import { loadPrimaryDomains, processSource, type ProcessOutcome } from './pipeline.js';
import { DomainLimiter } from './politeness.js';
import { claimDueSources } from './scheduler.js';

export interface TickResult {
  claimed: number;
  outcomes: ProcessOutcome[];
}

/**
 * One scheduler pass: claim what's due, fetch it, and report.
 *
 * Sources run concurrently — the DomainLimiter, not this loop, is what keeps us polite,
 * because politeness is a per-host property and several registry rows share a host.
 */
export async function runTick(
  db: Database,
  limiter: DomainLimiter,
  primaryDomains: string[],
): Promise<TickResult> {
  const due = await claimDueSources(db, config.batchSize);
  if (due.length === 0) return { claimed: 0, outcomes: [] };

  const settled = await Promise.allSettled(
    due.map((source) => processSource(db, source, limiter, primaryDomains)),
  );

  const outcomes: ProcessOutcome[] = settled.map((result, index) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          slug: due[index]?.slug ?? 'unknown',
          httpStatus: null,
          notModified: false,
          itemsSeen: 0,
          itemsNew: 0,
          itemsWithImage: 0,
          durationMs: 0,
          error: String(result.reason),
        },
  );

  return { claimed: due.length, outcomes };
}

export function formatOutcome(outcome: ProcessOutcome): string {
  const status = outcome.error
    ? `FAILED ${outcome.error}`
    : outcome.notModified
      ? '304 unchanged'
      : `${outcome.itemsNew} new / ${outcome.itemsSeen} seen` +
        (outcome.itemsNew > 0 ? ` · ${outcome.itemsWithImage} img` : '');
  return `  ${outcome.slug.padEnd(28)} ${String(outcome.durationMs).padStart(6)}ms  ${status}`;
}

export { loadPrimaryDomains };
