function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  /** Sources claimed per scheduler tick. */
  batchSize: intFromEnv('WORKER_BATCH_SIZE', 10),
  tickMs: intFromEnv('WORKER_TICK_MS', 30_000),
  /**
   * Identifies us to publishers. A reachable contact URL is what turns "unknown bot" into
   * "someone we can email" if we ever poll too hard — and a ban is a silent coverage hole.
   */
  userAgent: process.env.WORKER_USER_AGENT ?? 'KnowItBot/0.1 (+https://knowit.example/bot)',
  /** Per-request ceiling. Without it, one hanging publisher stalls a scheduler slot forever. */
  requestTimeoutMs: intFromEnv('WORKER_REQUEST_TIMEOUT_MS', 20_000),
  githubToken: process.env.GITHUB_TOKEN || undefined,

  /** Retention, applied by the worker rather than left to a human to remember. */
  articleTextRetentionDays: intFromEnv('RETENTION_TEXT_DAYS', 7),
  htmlSnapshotRetentionHours: intFromEnv('RETENTION_HTML_HOURS', 48),

  /** How many article pages we fetch per feed poll, so one busy feed can't monopolise a tick. */
  maxArticleFetchesPerSource: intFromEnv('WORKER_MAX_ARTICLE_FETCHES', 25),
} as const;
