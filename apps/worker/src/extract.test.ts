import { describe, expect, it } from 'vitest';
import { extractArticle } from './extract.js';

const PRIMARY_DOMAINS = ['sebi.gov.in', 'rbi.org.in', 'irdai.gov.in'];

const BODY = `
  <p>The Securities and Exchange Board of India on Monday tightened disclosure requirements
  for listed companies, mandating that material events be reported within twelve hours of
  a board decision rather than the twenty-four hours allowed under the previous framework.</p>
  <p>The regulator said the revised timeline would apply from the first of October and would
  cover all companies in the top thousand by market capitalisation. Smaller issuers will be
  brought under the framework in a second phase beginning next April.</p>
  <p>Market participants said the shorter window would require changes to internal reporting
  processes, particularly at companies whose boards meet outside market hours. Compliance
  officers at three large issuers said they expected to add staff to meet the deadline.</p>
  <p>The circular also revises the format in which companies must disclose related-party
  transactions, requiring a standardised table rather than free-form narrative disclosure.</p>
`;

/** An Economic Times-shaped page carrying PTI copy. */
const ET_ARTICLE = `<!doctype html><html><head><title>Sebi tightens disclosure norms</title></head>
<body><article>
  <h1>Sebi tightens disclosure norms for listed companies</h1>
  <div class="byline">PTI</div>
  ${BODY}
  <p>Read the full circular on the <a href="https://www.sebi.gov.in/legal/circulars/aug-2026/norms_1234.html">SEBI website</a>.</p>
</article></body></html>`;

/** Business Standard running the same wire story, attributed in the dateline instead. */
const BS_ARTICLE = `<!doctype html><html><head><title>Sebi tightens disclosure norms</title></head>
<body><article>
  <h1>Sebi tightens disclosure norms for listed companies</h1>
  <p>MUMBAI (PTI) — The Securities and Exchange Board of India on Monday tightened disclosure
  requirements for listed companies.</p>
  ${BODY}
</article></body></html>`;

/** Original reporting by a named staff journalist. */
const ORIGINAL_ARTICLE = `<!doctype html><html><head><title>Sebi tightens disclosure norms</title></head>
<body><article>
  <h1>Sebi tightens disclosure norms for listed companies</h1>
  <div class="author-name">Anjali Sharma</div>
  ${BODY}
</article></body></html>`;

describe('extractArticle', () => {
  it('extracts article text and title', () => {
    const result = extractArticle(ORIGINAL_ARTICLE, 'https://example.com/a', null, PRIMARY_DOMAINS);
    expect(result.status).toBe('ok');
    expect(result.textContent).toContain('Securities and Exchange Board of India');
    expect(result.title).toContain('Sebi tightens disclosure norms');
  });

  it('detects the same wire story across two outlets', () => {
    // The case the whole provenance layer rests on. The sources doc recommends ET and
    // Business Standard *because* they carry PTI and Reuters syndication, so this pair
    // must collapse to one independent source rather than counting as two.
    const inET = extractArticle(ET_ARTICLE, 'https://economictimes.indiatimes.com/a', null, PRIMARY_DOMAINS);
    const inBS = extractArticle(BS_ARTICLE, 'https://www.business-standard.com/a', null, PRIMARY_DOMAINS);

    expect(inET.originWireByline).toBe('PTI');
    expect(inBS.originWireByline).toBe('PTI');
    expect(inET.originWireEvidence).toBe('byline');
    expect(inBS.originWireEvidence).toBe('dateline');
  });

  it('uses the feed byline when the page hides attribution', () => {
    // Some publishers render the byline client-side; the feed still tells us.
    const result = extractArticle(
      ORIGINAL_ARTICLE.replace('<div class="author-name">Anjali Sharma</div>', ''),
      'https://example.com/a',
      'Reuters',
      PRIMARY_DOMAINS,
    );
    expect(result.originWireByline).toBe('Reuters');
  });

  it('leaves original reporting unflagged', () => {
    const result = extractArticle(ORIGINAL_ARTICLE, 'https://example.com/a', null, PRIMARY_DOMAINS);
    expect(result.originWireByline).toBeNull();
  });

  it('records outbound links to primary sources', () => {
    // This is what distinguishes "three outlets rewrote one circular" from
    // "three outlets reported independently".
    const result = extractArticle(ET_ARTICLE, 'https://economictimes.indiatimes.com/a', null, PRIMARY_DOMAINS);
    expect(result.originPrimaryLinks).toEqual(['sebi.gov.in']);
  });

  it('keeps only cross-domain links, resolving relative ones first', () => {
    // A relative href always resolves to the page's own host, so it can never be evidence
    // that a story traces elsewhere. Only the absolute link to the regulator counts.
    const html = `<article><p>${'text '.repeat(150)}</p>
      <a href="/markets/more-coverage">more from us</a>
      <a href="https://www.sebi.gov.in/legal/circulars/x.html">the circular</a></article>`;
    const result = extractArticle(html, 'https://economictimes.indiatimes.com/a', null, PRIMARY_DOMAINS);
    expect(result.originPrimaryLinks).toEqual(['sebi.gov.in']);
  });

  it('marks a paywalled stub as partial rather than failed', () => {
    // Wired is flagged partially paywalled in the registry — a short body is expected
    // there, and treating it as a failure would bury real extraction breakage.
    const html = '<article><h1>Headline</h1><p>Subscribe to continue reading.</p></article>';
    const result = extractArticle(html, 'https://www.wired.com/a', null, PRIMARY_DOMAINS);
    expect(result.status).toBe('partial');
    expect(result.textContent).toContain('Subscribe to continue reading');
    expect(result.error).toBeTruthy();
  });

  it('still yields text for a page that is not article-shaped', () => {
    // Regulator circular pages are frequently tables and link lists rather than articles.
    // Readability returns nothing at all for these, so without the page-text fallback
    // every IRDAI and MOSPI document would land with no text and look like breakage.
    const html = `<!doctype html><html><body>
      <nav>Home Contact</nav>
      <table><tr><td>Circular No. IRDAI/F&A/CIR/2026/118</td>
      <td>Revised solvency margin requirements for general insurers, effective 1 October 2026.</td></tr></table>
      <footer>Copyright</footer></body></html>`;
    const result = extractArticle(html, 'https://irdai.gov.in/x', null, PRIMARY_DOMAINS);

    expect(result.status).toBe('partial');
    expect(result.textContent).toContain('solvency margin');
    // Chrome is stripped so it can't pollute wire detection or, later, clustering.
    expect(result.textContent).not.toContain('Copyright');
  });

  it('reports failure rather than throwing on unusable markup', () => {
    const result = extractArticle('', 'https://example.com/a', null, PRIMARY_DOMAINS);
    expect(result.status).toBe('failed');
    expect(result.textContent).toBeNull();
  });

  it('detects a verbatim quoted passage', () => {
    const html = `<article><p>${'text '.repeat(150)}</p>
      <blockquote>${'The Board hereby directs all listed entities to comply. '.repeat(6)}</blockquote></article>`;
    const result = extractArticle(html, 'https://example.com/a', null, PRIMARY_DOMAINS);
    expect(result.originHasVerbatimQuote).toBe(true);
  });
});

describe('origin links exclude self-references', () => {
  it('does not treat a regulator linking to itself as origin evidence', () => {
    // Every RBI press release links back to rbi.org.in. Counting that would put a
    // primary-link marker on every document a regulator publishes, making the signal
    // useless exactly where it is supposed to discriminate.
    const html = `<article><p>${'text '.repeat(150)}</p>
      <a href="https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx">All press releases</a>
    </article>`;
    const result = extractArticle(
      html,
      'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
      null,
      PRIMARY_DOMAINS.concat('rbi.org.in'),
    );
    expect(result.originPrimaryLinks).toEqual([]);
  });

  it('excludes a self-link served from a different subdomain', () => {
    // The case that actually occurred: RBI press releases link their PDFs from
    // rbidocs.rbi.org.in. A hostname comparison misses this; a registry-domain one catches it.
    const html = `<article><p>${'text '.repeat(150)}</p>
      <a href="https://rbidocs.rbi.org.in/rdocs/PressRelease/PDFs/PR1234.PDF">Download PDF</a>
    </article>`;
    const result = extractArticle(
      html,
      'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1',
      null,
      PRIMARY_DOMAINS.concat('rbi.org.in'),
    );
    expect(result.originPrimaryLinks).toEqual([]);
  });

  it('still counts an outlet linking out to a regulator', () => {
    const html = `<article><p>${'text '.repeat(150)}</p>
      <a href="https://www.sebi.gov.in/legal/circulars/x.html">the circular</a></article>`;
    const result = extractArticle(html, 'https://economictimes.indiatimes.com/a', null, PRIMARY_DOMAINS);
    expect(result.originPrimaryLinks).toEqual(['sebi.gov.in']);
  });
});

describe('primary sources are never wire-scanned', () => {
  it('ignores an agency name appearing in a regulator notification', () => {
    // Observed live: an RBI notification implementing UAPA Section 51A matched "ANI" and
    // was flagged as syndicated. A regulator publishes first-party — it cannot be carrying
    // someone else's wire copy — so scanning it can only produce false positives.
    const html = `<article><p>The following entities are listed under the Schedule: ANI, and
      others. ${'Further directions follow. '.repeat(40)}</p></article>`;
    const asRegulator = extractArticle(html, 'https://www.rbi.org.in/x', null, [], true);
    const asOutlet = extractArticle(html, 'https://example.com/x', null, [], false);

    expect(asRegulator.originWireByline).toBeNull();
    expect(asOutlet.originWireByline).toBe('ANI');
  });
});
