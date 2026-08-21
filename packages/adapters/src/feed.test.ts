import { afterEach, describe, expect, it, vi } from 'vitest';
import { atomAdapter, rssAdapter } from './feed.js';
import { AdapterError, type AdapterSource, type FetchContext } from './types.js';

const context: FetchContext = { userAgent: 'KnowItBot/test', timeoutMs: 5000 };
const source: AdapterSource = {
  slug: 'sebi-press-releases',
  feedUrl: 'https://www.sebi.gov.in/sebirss.xml',
  fetchType: 'rss',
};

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>SEBI Press Releases</title>
    <item>
      <title>SEBI issues circular on disclosure norms</title>
      <link>https://www.sebi.gov.in/legal/circulars/aug-2026/norms_1234.html?utm_source=rss</link>
      <pubDate>Mon, 17 Aug 2026 15:30:00 +0530</pubDate>
      <description>The Board has decided to amend disclosure requirements.</description>
      <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">PTI</dc:creator>
    </item>
    <item>
      <title>Item with a non-URL guid and no link</title>
      <guid isPermaLink="false">sebi-internal-9912</guid>
      <pubDate>Mon, 17 Aug 2026 11:00:00 +0530</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>The Register</title>
  <entry>
    <title>Chipmaker posts record quarter</title>
    <link href="https://www.theregister.com/2026/08/17/chips/"/>
    <updated>2026-08-17T09:15:00Z</updated>
    <author><name>A Reporter</name></author>
    <summary>Revenue climbed on datacentre demand.</summary>
  </entry>
</feed>`;

function stubFetch(response: Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(response)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rssAdapter', () => {
  it('parses items and preserves the raw URL for the worker to canonicalise', () => {
    stubFetch(new Response(RSS_FIXTURE, { status: 200, headers: { etag: 'W/"abc"' } }));

    return rssAdapter.fetch(source, {}, context).then((result) => {
      expect(result.notModified).toBe(false);
      expect(result.etag).toBe('W/"abc"');
      expect(result.items).toHaveLength(1);

      const item = result.items[0]!;
      // Adapters never canonicalise — that happens once, in the worker.
      expect(item.urlRaw).toContain('utm_source=rss');
      expect(item.title).toBe('SEBI issues circular on disclosure norms');
      expect(item.publishedAtRaw).toBeTruthy();
      // The feed byline is the cheapest chance to catch syndicated wire copy.
      expect(item.author).toBe('PTI');
    });
  });

  it('skips items whose guid is not a URL rather than inventing one', async () => {
    stubFetch(new Response(RSS_FIXTURE, { status: 200 }));
    const result = await rssAdapter.fetch(source, {}, context);
    expect(result.items.map((i) => i.title)).not.toContain('Item with a non-URL guid and no link');
  });

  it('reports 304 as unchanged, not as an empty feed', async () => {
    stubFetch(new Response(null, { status: 304, headers: { etag: 'W/"abc"' } }));
    const result = await rssAdapter.fetch(source, { etag: 'W/"abc"' }, context);
    expect(result.notModified).toBe(true);
    expect(result.httpStatus).toBe(304);
    expect(result.items).toEqual([]);
  });

  it('sends conditional headers when it has them', async () => {
    const spy = vi.fn((_url: string | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(RSS_FIXTURE, { status: 200 })),
    );
    vi.stubGlobal('fetch', spy);

    await rssAdapter.fetch(source, { etag: 'W/"abc"', lastModified: 'Mon, 17 Aug 2026 15:30:00 GMT' }, context);

    const init = spy.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers['if-none-match']).toBe('W/"abc"');
    expect(headers['if-modified-since']).toBe('Mon, 17 Aug 2026 15:30:00 GMT');
  });

  it('fails loudly when a publisher swaps the feed for an HTML page', async () => {
    // Silence here would be indistinguishable from a quiet news day — which is exactly
    // the failure this product cannot tolerate.
    stubFetch(new Response('<html><body>Page moved</body></html>', { status: 200 }));
    await expect(rssAdapter.fetch(source, {}, context)).rejects.toThrow(AdapterError);
  });

  it('fails loudly on an HTTP error', async () => {
    stubFetch(new Response('nope', { status: 503, statusText: 'Service Unavailable' }));
    await expect(rssAdapter.fetch(source, {}, context)).rejects.toThrow(/503/);
  });

  it('fails loudly on an empty body', async () => {
    stubFetch(new Response('   ', { status: 200 }));
    await expect(rssAdapter.fetch(source, {}, context)).rejects.toThrow(/empty body/i);
  });
});

describe('atomAdapter', () => {
  it('parses Atom entries through the same item shape', async () => {
    stubFetch(new Response(ATOM_FIXTURE, { status: 200 }));
    const result = await atomAdapter.fetch(
      { slug: 'the-register', feedUrl: 'https://www.theregister.com/headlines.atom', fetchType: 'atom' },
      {},
      context,
    );

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.urlRaw).toBe('https://www.theregister.com/2026/08/17/chips/');
    expect(item.title).toBe('Chipmaker posts record quarter');
    expect(item.publishedAtRaw).toBeTruthy();
  });
});
