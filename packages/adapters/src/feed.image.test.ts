/**
 * Image extraction against recorded feeds.
 *
 * Two of these fixtures are real responses from the live registry (CNBC TV18 and
 * Business Standard) rather than hand-written XML, because the bug this suite exists to
 * prevent was caused by exactly the gap between the two: rss-parser silently drops
 * elements it wasn't configured for, so a hand-written fixture that "looks right" can
 * pass while every real feed returns nothing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectLeadImage } from '@knowit/core';
import { rssAdapter } from './feed.js';
import type { AdapterSource, FetchContext, FetchedItem } from './types.js';

const context: FetchContext = { userAgent: 'KnowItBot/test', timeoutMs: 5000 };

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');
}

function stubFetch(body: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))),
  );
}

async function itemsFrom(name: string, slug: string): Promise<FetchedItem[]> {
  stubFetch(fixture(name));
  const source: AdapterSource = { slug, feedUrl: `https://${slug}.example/feed`, fetchType: 'rss' };
  const result = await rssAdapter.fetch(source, {}, context);
  return result.items;
}

/** What the pipeline will actually store — the adapter only proposes candidates. */
function leadImage(item: FetchedItem): string | null {
  return selectLeadImage(item.imageCandidates ?? [], item.urlRaw)?.url ?? null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('media:content (CNBC TV18, real response)', () => {
  it('extracts the image and its declared dimensions', async () => {
    const items = await itemsFrom('media-content.xml', 'cnbc-tv18');
    expect(items.length).toBeGreaterThan(0);

    const candidate = items[0]!.imageCandidates?.[0];
    expect(candidate?.source).toBe('media_content');
    expect(candidate?.url).toMatch(/^https:\/\/images\.cnbctv18\.com\/.*\.jpg$/);
    // Dimensions are what let us reject thumbnails later; losing them is a silent regression.
    expect(candidate?.width).toBe('1200');
    expect(candidate?.height).toBe('675');
  });

  it('yields a usable lead image for every item in the feed', async () => {
    const items = await itemsFrom('media-content.xml', 'cnbc-tv18');
    expect(items.every((item) => leadImage(item) !== null)).toBe(true);
  });
});

describe('media:thumbnail (Business Standard, real response)', () => {
  it('falls back to the thumbnail element when there is no media:content', async () => {
    const items = await itemsFrom('media-thumbnail.xml', 'business-standard');
    const withImage = items.filter((item) => leadImage(item) !== null);
    expect(withImage.length).toBeGreaterThan(0);
    expect(leadImage(withImage[0]!)).toMatch(/^https:\/\/bsmedia\.business-standard\.com\//);
  });
});

describe('enclosure and content:encoded', () => {
  it('reads an RSS 2.0 image enclosure', async () => {
    const items = await itemsFrom('enclosure-and-inline.xml', 'fixture');
    const item = items.find((i) => i.title?.startsWith('Enclosure carries'))!;
    expect(leadImage(item)).toBe('https://cdn.fixture.example/photos/a.jpg');
  });

  it('skips the tracking pixel and takes the real image from content:encoded', async () => {
    const items = await itemsFrom('enclosure-and-inline.xml', 'fixture');
    const item = items.find((i) => i.title?.includes('content:encoded'))!;
    expect(leadImage(item)).toBe('https://cdn.fixture.example/photos/b.jpg');
  });

  it('does not mistake a podcast enclosure for a photograph', async () => {
    const items = await itemsFrom('enclosure-and-inline.xml', 'fixture');
    const item = items.find((i) => i.title?.includes('podcast'))!;
    expect(leadImage(item)).toBeNull();
  });

  it('returns null rather than inventing an image when the item has none', async () => {
    const items = await itemsFrom('enclosure-and-inline.xml', 'fixture');
    const item = items.find((i) => i.title === 'No image anywhere')!;
    expect(item.imageCandidates).toEqual([]);
    expect(leadImage(item)).toBeNull();
  });
});
