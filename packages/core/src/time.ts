/**
 * Publication timestamp parsing.
 *
 * Feeds lie about time in three distinct ways: they omit the timezone, they refresh
 * `pubDate` when an old story is re-promoted, and occasionally they emit dates in the
 * future. Each one becomes a clustering bug two stages downstream — an article about the
 * March RBI decision must not join today's cluster — so we resolve a timestamp here and
 * record how much we trust it rather than pretending we know.
 */

import type { TimestampConfidence } from './types.js';

/** Clock skew and single-timezone-misparse tolerance before a date is "in the future". */
const FUTURE_TOLERANCE_MS = 2 * 60 * 60 * 1000;

/** Older than this relative to fetch time and it's a re-promoted story, not news. */
const STALE_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * An explicit offset (`Z`, `+05:30`) or a named zone at the end of the string. RFC822
 * dates sometimes carry a parenthesised zone name after the offset, so allow that too.
 */
const EXPLICIT_TIMEZONE =
  /(?:Z|[+-]\d{2}:?\d{2}|\b(?:GMT|UTC|UT|IST|EST|EDT|CST|CDT|MST|MDT|PST|PDT|BST|CET|CEST)\b)\s*(?:\([^)]*\))?\s*$/i;

export interface ParsedTimestamp {
  /** Always populated — falls back to fetch time so callers never handle null. */
  publishedAt: Date;
  confidence: TimestampConfidence;
  /** Why this confidence was assigned. Surfaced on the dashboard when triaging a source. */
  reason: string;
}

function hasExplicitTimezone(raw: string): boolean {
  return EXPLICIT_TIMEZONE.test(raw.trim());
}

/**
 * Resolve a feed's publication date against the time we fetched it.
 *
 * A timestamp without a timezone is parsed in the worker's local zone, which for Indian
 * sources can be 5.5 hours out. We accept the value and mark it `low` rather than guessing
 * a zone — downstream time-decay tolerates hours of error as long as it knows to.
 */
export function parsePublishedAt(
  raw: string | null | undefined,
  fetchedAt: Date,
): ParsedTimestamp {
  if (!raw || raw.trim().length === 0) {
    return {
      publishedAt: fetchedAt,
      confidence: 'low',
      reason: 'no published date in feed; using fetch time',
    };
  }

  const trimmed = raw.trim();
  const parsedMs = Date.parse(trimmed);

  if (Number.isNaN(parsedMs)) {
    return {
      publishedAt: fetchedAt,
      confidence: 'low',
      reason: `unparseable date ${JSON.stringify(trimmed)}; using fetch time`,
    };
  }

  const publishedAt = new Date(parsedMs);
  const drift = parsedMs - fetchedAt.getTime();

  if (drift > FUTURE_TOLERANCE_MS) {
    return {
      publishedAt,
      confidence: 'suspect',
      reason: `published date is ${Math.round(drift / 3_600_000)}h in the future`,
    };
  }

  if (-drift > STALE_THRESHOLD_MS) {
    return {
      publishedAt,
      confidence: 'suspect',
      reason: `published date is ${Math.round(-drift / 86_400_000)}d old; likely a re-promoted story`,
    };
  }

  if (!hasExplicitTimezone(trimmed)) {
    return {
      publishedAt,
      confidence: 'low',
      reason: 'no timezone in published date; parsed in worker local time',
    };
  }

  return { publishedAt, confidence: 'high', reason: 'explicit timezone' };
}

/** Whether a timestamp is trustworthy enough to drive clustering decisions. */
export function isTimestampReliable(confidence: TimestampConfidence): boolean {
  return confidence === 'high';
}
