import { describe, expect, it } from 'vitest';
import { isTimestampReliable, parsePublishedAt } from './time.js';

const FETCHED_AT = new Date('2026-08-18T00:00:00Z');

describe('parsePublishedAt', () => {
  it('trusts an RFC822 date carrying an explicit offset', () => {
    const result = parsePublishedAt('Mon, 17 Aug 2026 20:30:00 +0530', FETCHED_AT);
    expect(result.confidence).toBe('high');
    expect(result.publishedAt.toISOString()).toBe('2026-08-17T15:00:00.000Z');
  });

  it('trusts an ISO8601 date in UTC', () => {
    const result = parsePublishedAt('2026-08-17T22:15:00Z', FETCHED_AT);
    expect(result.confidence).toBe('high');
  });

  it('trusts a named timezone', () => {
    expect(parsePublishedAt('Mon, 17 Aug 2026 20:30:00 GMT', FETCHED_AT).confidence).toBe('high');
  });

  it('downgrades a date with no timezone', () => {
    // Parsed in the worker's local zone, which for an Indian source can be 5.5h out.
    // We take the value but refuse to call it reliable.
    const result = parsePublishedAt('2026-08-17 20:30:00', FETCHED_AT);
    expect(result.confidence).toBe('low');
    expect(result.reason).toMatch(/no timezone/i);
  });

  it('falls back to fetch time when the feed omits a date', () => {
    for (const missing of [null, undefined, '', '   ']) {
      const result = parsePublishedAt(missing, FETCHED_AT);
      expect(result.publishedAt).toEqual(FETCHED_AT);
      expect(result.confidence).toBe('low');
    }
  });

  it('falls back to fetch time on an unparseable date', () => {
    const result = parsePublishedAt('not a date', FETCHED_AT);
    expect(result.publishedAt).toEqual(FETCHED_AT);
    expect(result.confidence).toBe('low');
    expect(result.reason).toMatch(/unparseable/i);
  });

  it('flags a date far in the future', () => {
    const result = parsePublishedAt('2026-08-18T10:00:00Z', FETCHED_AT);
    expect(result.confidence).toBe('suspect');
    expect(result.reason).toMatch(/future/i);
  });

  it('tolerates small forward drift from clock skew', () => {
    const result = parsePublishedAt('2026-08-18T01:00:00Z', FETCHED_AT);
    expect(result.confidence).toBe('high');
  });

  it('flags a re-promoted story', () => {
    // An article about the March RBI decision must not be treated as today's news —
    // if it were, it would join today's cluster two stages downstream.
    const result = parsePublishedAt('2026-01-05T09:00:00Z', FETCHED_AT);
    expect(result.confidence).toBe('suspect');
    expect(result.reason).toMatch(/re-promoted/i);
  });
});

describe('isTimestampReliable', () => {
  it('admits only high confidence', () => {
    expect(isTimestampReliable('high')).toBe(true);
    expect(isTimestampReliable('low')).toBe(false);
    expect(isTimestampReliable('suspect')).toBe(false);
  });
});
