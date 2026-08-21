/**
 * The fetcher daemon.
 *
 * Runs continuously on Fly: claim due sources, fetch, extract, insert, repeat. Retention
 * runs on the same loop rather than as a separate cron so there is one process to deploy
 * and one place to look when something stops happening.
 */

import { getDb } from '@knowit/db';
import { config } from './config.js';
import { DomainLimiter } from './politeness.js';
import { applyRetention } from './retention.js';
import { formatOutcome, loadPrimaryDomains, runTick } from './tick.js';

const RETENTION_INTERVAL_MS = 60 * 60_000;

let shuttingDown = false;

function stamp(): string {
  return new Date().toISOString();
}

async function main(): Promise<void> {
  const db = getDb();
  const limiter = new DomainLimiter();

  let primaryDomains = await loadPrimaryDomains(db);
  console.log(
    `[${stamp()}] worker up · batch=${config.batchSize} · tick=${config.tickMs}ms · ` +
      `${primaryDomains.length} primary domains`,
  );

  let lastRetentionAt = 0;
  let lastDomainRefreshAt = Date.now();

  while (!shuttingDown) {
    const startedAt = Date.now();

    try {
      const { claimed, outcomes } = await runTick(db, limiter, primaryDomains);

      if (claimed > 0) {
        const failed = outcomes.filter((o) => o.error).length;
        const created = outcomes.reduce((sum, o) => sum + o.itemsNew, 0);
        console.log(
          `[${stamp()}] tick · ${claimed} sources · ${created} new documents` +
            (failed > 0 ? ` · ${failed} failed` : ''),
        );
        for (const outcome of outcomes) console.log(formatOutcome(outcome));
      }

      if (Date.now() - lastRetentionAt > RETENTION_INTERVAL_MS) {
        const result = await applyRetention(db);
        lastRetentionAt = Date.now();
        if (result.textCleared > 0 || result.htmlCleared > 0) {
          console.log(
            `[${stamp()}] retention · cleared text on ${result.textCleared} rows, ` +
              `html on ${result.htmlCleared}`,
          );
        }
      }

      // The registry changes when a source is added; pick that up without a restart.
      if (Date.now() - lastDomainRefreshAt > RETENTION_INTERVAL_MS) {
        primaryDomains = await loadPrimaryDomains(db);
        lastDomainRefreshAt = Date.now();
      }
    } catch (error: unknown) {
      // A tick failure must never kill the daemon — a stopped fetcher is a total coverage
      // outage, which is the one failure this product cannot absorb.
      console.error(`[${stamp()}] tick failed:`, error);
    }

    const elapsed = Date.now() - startedAt;
    const wait = Math.max(0, config.tickMs - elapsed);
    if (wait > 0 && !shuttingDown) {
      await new Promise<void>((resolve) => setTimeout(resolve, wait));
    }
  }

  console.log(`[${stamp()}] worker stopped`);
  process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1);
    console.log(`[${stamp()}] ${signal} received — finishing current tick`);
    shuttingDown = true;
  });
}

main().catch((error: unknown) => {
  console.error('worker failed to start:', error);
  process.exit(1);
});
