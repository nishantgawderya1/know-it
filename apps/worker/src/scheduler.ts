/**
 * Claiming and rescheduling.
 *
 * Work is claimed with FOR UPDATE SKIP LOCKED straight off the `sources` table — at forty
 * sources a separate job table would be ceremony. Claiming also pushes `next_fetch_at`
 * forward by a short lease, so a worker that crashes mid-fetch releases the source after
 * the lease rather than parking it forever.
 */

import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { sources, type Database, type Source } from '@knowit/db';

/** How long a claimed source stays claimed if the worker dies before rescheduling it. */
const LEASE_MINUTES = 5;

/** Hour of day (0–23) at `instant` in `timeZone`. */
export function hourInTimeZone(instant: Date, timeZone: string): number {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      hour12: false,
    }).format(instant);
    const hour = Number.parseInt(formatted, 10);
    // Some implementations render midnight as "24".
    return Number.isFinite(hour) ? hour % 24 : instant.getUTCHours();
  } catch {
    // An invalid tz in the registry must not stop the scheduler.
    return instant.getUTCHours();
  }
}

export function isWithinActiveHours(source: Source, instant: Date): boolean {
  const hour = hourInTimeZone(instant, source.activeHoursTz);
  const { activeStartHour: start, activeEndHour: end } = source;
  if (start === end) return true;
  // A window that wraps midnight (e.g. 22 → 6) is still one contiguous active period.
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Cadence follows the publishing calendar rather than raw velocity: regulators publish
 * during business hours, so polling them every five minutes overnight buys nothing.
 */
export function nextFetchAt(source: Source, from: Date = new Date()): Date {
  const minutes = isWithinActiveHours(source, from)
    ? source.activeIntervalMin
    : source.offIntervalMin;
  return new Date(from.getTime() + minutes * 60_000);
}

/**
 * Atomically take up to `limit` due sources.
 *
 * `source_kind = 'news'` is part of the predicate, not an afterthought: the data sources
 * (AMFI, NSE, Alpha Vantage) return numbers and have no adapter, so they must never be
 * handed to the news pipeline.
 */
export async function claimDueSources(db: Database, limit: number): Promise<Source[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(sources)
      .where(
        and(
          eq(sources.isActive, true),
          eq(sources.sourceKind, 'news'),
          lte(sources.nextFetchAt, new Date()),
        ),
      )
      .orderBy(asc(sources.nextFetchAt))
      .limit(limit)
      .for('update', { skipLocked: true });

    if (due.length === 0) return [];

    await tx
      .update(sources)
      .set({ nextFetchAt: new Date(Date.now() + LEASE_MINUTES * 60_000) })
      .where(
        inArray(
          sources.id,
          due.map((source) => source.id),
        ),
      );

    return due;
  });
}

export interface RescheduleInput {
  feedWindowSize?: number | undefined;
  etag?: string | null | undefined;
  lastModified?: string | null | undefined;
  /** Delay the next fetch — used when a host has told us to back off. */
  extraDelayMs?: number;
}

export async function rescheduleSource(
  db: Database,
  source: Source,
  input: RescheduleInput = {},
): Promise<void> {
  const base = nextFetchAt(source);
  const next = input.extraDelayMs
    ? new Date(Math.max(base.getTime(), Date.now() + input.extraDelayMs))
    : base;

  await db
    .update(sources)
    .set({
      nextFetchAt: next,
      lastFetchedAt: new Date(),
      ...(input.etag !== undefined ? { lastEtag: input.etag } : {}),
      ...(input.lastModified !== undefined ? { lastModified: input.lastModified } : {}),
      ...(input.feedWindowSize !== undefined ? { feedWindowSize: input.feedWindowSize } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(sources.id, source.id));
}
