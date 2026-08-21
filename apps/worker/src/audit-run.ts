/**
 * Run the coverage audit once and report.
 *
 * Intended as a daily job. Exits non-zero when any Finance source shows a gap or an
 * auditor error, so it can gate the Phase 1 exit criterion — seven consecutive days with
 * zero unexplained Finance coverage gaps — rather than relying on someone reading a page.
 */

import { getDb } from '@knowit/db';
import { runCoverageAudit } from './audit.js';

async function main(): Promise<void> {
  const outcomes = await runCoverageAudit(getDb());

  if (outcomes.length === 0) {
    console.log('no auditable sources — check that the registry is seeded');
    process.exit(0);
  }

  for (const outcome of outcomes) {
    const counts =
      outcome.expected === null ? '' : ` ${outcome.ingested}/${outcome.expected} held`;
    console.log(`  ${outcome.status.toUpperCase().padEnd(5)} ${outcome.slug.padEnd(28)}${counts}`);
    if (outcome.detail) console.log(`        ${outcome.detail}`);
    for (const url of outcome.missing.slice(0, 10)) console.log(`        MISSING ${url}`);
  }

  const gaps = outcomes.filter((o) => o.status === 'gap');
  const errors = outcomes.filter((o) => o.status === 'error');
  console.log(
    `\n${outcomes.length} audited · ${gaps.length} with gaps · ${errors.length} auditor failures`,
  );

  // An auditor that failed is treated as seriously as a gap: we do not know our coverage,
  // and "we do not know" must never be reported as "we are fine".
  process.exit(gaps.length + errors.length > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('audit failed:', error);
  process.exit(1);
});
