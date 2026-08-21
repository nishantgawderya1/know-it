/**
 * Per-domain politeness.
 *
 * Politeness is a correctness feature here, not courtesy: publishers ban aggressive
 * crawlers, and a ban is a silent coverage hole — the source keeps "succeeding" with zero
 * new items and looks exactly like a quiet news day.
 *
 * Keyed on domain rather than source because several registry rows share a host: ET's
 * section feeds, MoneyControl's per-category feeds, and every article page we then fetch
 * from the same publisher.
 */

export interface PolitenessOptions {
  /** Minimum gap between two requests to the same host. */
  minGapMs?: number;
  maxBackoffMs?: number;
}

const DEFAULT_MIN_GAP_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 5 * 60_000;

interface DomainState {
  /** Serialises requests to this host. */
  chain: Promise<unknown>;
  nextAllowedAt: number;
  consecutiveThrottles: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export class DomainLimiter {
  private readonly domains = new Map<string, DomainState>();
  private readonly minGapMs: number;
  private readonly maxBackoffMs: number;

  constructor(options: PolitenessOptions = {}) {
    this.minGapMs = options.minGapMs ?? DEFAULT_MIN_GAP_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  }

  private state(domain: string): DomainState {
    let state = this.domains.get(domain);
    if (!state) {
      state = { chain: Promise.resolve(), nextAllowedAt: 0, consecutiveThrottles: 0 };
      this.domains.set(domain, state);
    }
    return state;
  }

  /** Run `task` with at most one in-flight request to `domain`, respecting any backoff. */
  async run<T>(domain: string, task: () => Promise<T>): Promise<T> {
    const state = this.state(domain);

    const result = state.chain.then(async () => {
      const waitMs = state.nextAllowedAt - Date.now();
      if (waitMs > 0) await sleep(waitMs);
      try {
        return await task();
      } finally {
        state.nextAllowedAt = Date.now() + this.minGapMs;
      }
    });

    // Keep the chain alive even when a task rejects, or one failure wedges the host.
    state.chain = result.catch(() => undefined);
    return result;
  }

  /**
   * Record a 429/503. Backoff doubles per consecutive throttle so a struggling publisher
   * gets left alone rather than hammered.
   */
  penalise(domain: string): number {
    const state = this.state(domain);
    state.consecutiveThrottles += 1;
    const backoff = Math.min(
      this.minGapMs * 2 ** state.consecutiveThrottles,
      this.maxBackoffMs,
    );
    state.nextAllowedAt = Math.max(state.nextAllowedAt, Date.now() + backoff);
    return backoff;
  }

  /** Clear backoff after a clean response. */
  reward(domain: string): void {
    this.state(domain).consecutiveThrottles = 0;
  }

  backoffMs(domain: string): number {
    return Math.max(0, this.state(domain).nextAllowedAt - Date.now());
  }
}
