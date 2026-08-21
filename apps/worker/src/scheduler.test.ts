import { describe, expect, it } from 'vitest';
import type { Source } from '@knowit/db';
import { hourInTimeZone, isWithinActiveHours, nextFetchAt } from './scheduler.js';

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    slug: 'test',
    name: 'Test',
    vertical: 'finance',
    sourceKind: 'news',
    sourceType: 'regulator',
    sourceRole: 'record',
    feedUrl: 'https://example.com/feed',
    fetchType: 'rss',
    indexUrl: null,
    auditStrategy: 'none',
    activeHoursTz: 'Asia/Kolkata',
    activeStartHour: 9,
    activeEndHour: 19,
    activeIntervalMin: 5,
    offIntervalMin: 120,
    nextFetchAt: new Date(),
    lastFetchedAt: null,
    lastEtag: null,
    lastModified: null,
    feedWindowSize: null,
    reliabilityWeight: 1,
    isFullText: null,
    isActive: true,
    topics: [],
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Source;
}

describe('hourInTimeZone', () => {
  it('converts UTC into the source timezone', () => {
    // 06:00 UTC is 11:30 IST.
    expect(hourInTimeZone(new Date('2026-08-18T06:00:00Z'), 'Asia/Kolkata')).toBe(11);
    // 20:00 UTC is 01:30 IST the next day.
    expect(hourInTimeZone(new Date('2026-08-18T20:00:00Z'), 'Asia/Kolkata')).toBe(1);
  });

  it('falls back to UTC rather than throwing on a bad timezone', () => {
    // A typo in the registry must not stop the scheduler.
    expect(hourInTimeZone(new Date('2026-08-18T06:00:00Z'), 'Not/AZone')).toBe(6);
  });
});

describe('isWithinActiveHours', () => {
  const source = makeSource();

  it('recognises the IST business window', () => {
    expect(isWithinActiveHours(source, new Date('2026-08-18T06:00:00Z'))).toBe(true); // 11:30 IST
    expect(isWithinActiveHours(source, new Date('2026-08-18T20:00:00Z'))).toBe(false); // 01:30 IST
  });

  it('handles a window that wraps midnight', () => {
    const overnight = makeSource({ activeStartHour: 22, activeEndHour: 6 });
    expect(isWithinActiveHours(overnight, new Date('2026-08-18T20:00:00Z'))).toBe(true); // 01:30 IST
    expect(isWithinActiveHours(overnight, new Date('2026-08-18T06:00:00Z'))).toBe(false); // 11:30 IST
  });

  it('treats an empty window as always active', () => {
    const always = makeSource({ activeStartHour: 0, activeEndHour: 0 });
    expect(isWithinActiveHours(always, new Date('2026-08-18T20:00:00Z'))).toBe(true);
  });
});

describe('nextFetchAt', () => {
  it('polls fast in business hours and slowly outside them', () => {
    const source = makeSource();
    const inHours = new Date('2026-08-18T06:00:00Z');
    const outOfHours = new Date('2026-08-18T20:00:00Z');

    expect(nextFetchAt(source, inHours).getTime() - inHours.getTime()).toBe(5 * 60_000);
    expect(nextFetchAt(source, outOfHours).getTime() - outOfHours.getTime()).toBe(120 * 60_000);
  });
});
