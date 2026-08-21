import { describe, expect, it, vi } from 'vitest';
import { harvestIndexLinks } from './scrape.js';
import { getAdapter, hasAdapter } from './index.js';
import { AdapterError } from './types.js';

const INDEX_FIXTURE = `<!doctype html>
<html><body>
  <nav>
    <a href="/">Home</a>
    <a href="/about">About</a>
    <a href="/contact-us">Contact</a>
  </nav>
  <main>
    <a href="/web/guest/press-release/circular-on-surety-insurance-bonds-2026">
      Circular on surety insurance bonds and revised solvency norms
    </a>
    <a href="press-release/exposure-draft-health-insurance">
      Exposure draft on health insurance product regulations
    </a>
    <a href="https://irdai.gov.in/documents/annual-report-2026">
      Annual report of the Authority for the year 2025-26
    </a>
    <a href="https://example.com/external">A link off to some other website entirely</a>
    <a href="#top">Back to top</a>
    <a href="mailto:press@irdai.gov.in">Email the press office</a>
    <a href="/assets/style.css">A stylesheet reference with a long descriptive label</a>
  </main>
</body></html>`;

const PAGE_URL = 'https://irdai.gov.in/web/guest/press-release';

describe('harvestIndexLinks', () => {
  it('collects article links and resolves relative hrefs', () => {
    const links = harvestIndexLinks(INDEX_FIXTURE, PAGE_URL);
    const urls = links.map((l) => l.url);

    expect(urls).toContain(
      'https://irdai.gov.in/web/guest/press-release/circular-on-surety-insurance-bonds-2026',
    );
    expect(urls).toContain('https://irdai.gov.in/web/guest/press-release/exposure-draft-health-insurance');
    expect(urls).toContain('https://irdai.gov.in/documents/annual-report-2026');
  });

  it('drops navigation, fragments, mail links, assets and off-site links', () => {
    const urls = harvestIndexLinks(INDEX_FIXTURE, PAGE_URL).map((l) => l.url);
    expect(urls.some((u) => u.includes('example.com'))).toBe(false);
    expect(urls.some((u) => u.includes('/about'))).toBe(false);
    expect(urls.some((u) => u.includes('contact'))).toBe(false);
    expect(urls.some((u) => u.endsWith('.css'))).toBe(false);
    expect(urls.some((u) => u.includes('#'))).toBe(false);
  });

  it('normalises whitespace in titles', () => {
    const link = harvestIndexLinks(INDEX_FIXTURE, PAGE_URL).find((l) =>
      l.url.includes('surety-insurance'),
    );
    expect(link?.title).toBe('Circular on surety insurance bonds and revised solvency norms');
  });

  it('deduplicates repeated links', () => {
    const html = `<a href="/a-circular-with-a-suitably-long-title">A circular with a suitably long title</a>
                  <a href="/a-circular-with-a-suitably-long-title">A circular with a suitably long title</a>`;
    expect(harvestIndexLinks(html, PAGE_URL)).toHaveLength(1);
  });

  it('returns nothing when the page has only chrome', () => {
    // The adapter turns this into a loud error — see below.
    const html = '<nav><a href="/">Home</a><a href="/about">About</a></nav>';
    expect(harvestIndexLinks(html, PAGE_URL)).toEqual([]);
  });
});

describe('adapter registry', () => {
  it('resolves every fetch type the registry actually uses', () => {
    for (const kind of ['rss', 'atom', 'scrape', 'hn', 'github_api'] as const) {
      expect(getAdapter(kind).kind).toBe(kind);
    }
  });

  it('refuses json_api so a data source cannot slip into the news pipeline', () => {
    expect(hasAdapter('json_api')).toBe(false);
    expect(() => getAdapter('json_api')).toThrow(AdapterError);
  });
});

describe('index_link_pattern', () => {
  const INDEX = `<a href="/document-detail?documentId=9719459">Circular on surety insurance bonds</a>
                 <a href="/about-consumer-affairs">About the Consumer Affairs Department</a>
                 <a href="/accounts-and-audit-functions">Accounts and Audit Functions of the Authority</a>
                 <a href="/document-detail?documentId=9719460">Exposure draft on health insurance</a>`;
  const PAGE = 'https://irdai.gov.in/press-releases';

  it('keeps only links matching the pattern', () => {
    // Without this, IRDAI's index put 122 links into raw_documents, most of them section
    // pages — junk ingested as news, which corrupts the coverage claim itself.
    const links = harvestIndexLinks(INDEX, PAGE, { pattern: /documentId=\d+/ });
    expect(links).toHaveLength(2);
    expect(links.every((l) => /documentId=\d+/.test(l.url))).toBe(true);
  });

  it('harvests everything when no pattern is given', () => {
    expect(harvestIndexLinks(INDEX, PAGE).length).toBeGreaterThan(2);
  });

  it('refuses to fetch a scrape source that has no pattern', async () => {
    // Refusing beats guessing: ingesting navigation as news is worse than ingesting nothing.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(INDEX, { status: 200 }))));
    await expect(
      getAdapter('scrape').fetch(
        { slug: 'irdai-press-releases', feedUrl: PAGE, fetchType: 'scrape' },
        {},
        { userAgent: 'test', timeoutMs: 5000 },
      ),
    ).rejects.toThrow(/no index_link_pattern/);
    vi.unstubAllGlobals();
  });

  it('fails loudly when the pattern matches nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(INDEX, { status: 200 }))));
    await expect(
      getAdapter('scrape').fetch(
        { slug: 'irdai-press-releases', feedUrl: PAGE, fetchType: 'scrape', indexLinkPattern: 'nope=\d+' },
        {},
        { userAgent: 'test', timeoutMs: 5000 },
      ),
    ).rejects.toThrow(/matched no links/);
    vi.unstubAllGlobals();
  });
});
