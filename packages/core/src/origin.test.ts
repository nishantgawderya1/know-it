import { describe, expect, it } from 'vitest';
import {
  detectWireAgency,
  extractPrimaryLinks,
  hasVerbatimQuote,
  isStrongWireEvidence,
} from './origin.js';

describe('detectWireAgency', () => {
  it('reads an explicit byline element', () => {
    const result = detectWireAgency({ byline: 'PTI' });
    expect(result).toMatchObject({ agency: 'PTI', evidence: 'byline' });
  });

  it('reads a byline phrase in the opening text', () => {
    const result = detectWireAgency({ head: 'By Reuters | Published 20:30 IST' });
    expect(result).toMatchObject({ agency: 'Reuters', evidence: 'byline' });
  });

  it('reads the dateline convention', () => {
    const result = detectWireAgency({
      head: 'NEW DELHI (Reuters) — The central bank held rates steady on Monday.',
    });
    expect(result).toMatchObject({ agency: 'Reuters', evidence: 'dateline' });
  });

  it('resolves long-form agency names', () => {
    expect(detectWireAgency({ byline: 'Press Trust of India' })?.agency).toBe('PTI');
    expect(detectWireAgency({ byline: 'Agence France-Presse' })?.agency).toBe('AFP');
    expect(detectWireAgency({ byline: 'Indo-Asian News Service' })?.agency).toBe('IANS');
  });

  it('treats a body-only mention as weak evidence', () => {
    const result = detectWireAgency({
      head: 'Shares of the lender fell sharply in early trade on Monday morning.',
      body: 'Shares fell sharply. Reuters reported earlier that the deal had stalled.',
    });
    expect(result).toMatchObject({ agency: 'Reuters', evidence: 'mention' });
    expect(isStrongWireEvidence(result)).toBe(false);
  });

  it('returns null for original reporting', () => {
    expect(
      detectWireAgency({
        byline: 'Anjali Sharma',
        head: 'MUMBAI — The regulator issued a circular on Monday tightening disclosure norms.',
      }),
    ).toBeNull();
  });

  it('only accepts bare "AP" inside a byline element', () => {
    // "AP" is too short to match safely in running text.
    expect(detectWireAgency({ byline: 'AP' })?.agency).toBe('AP');
    expect(detectWireAgency({ head: 'The AP exam results were published today.' })).toBeNull();
  });

  it('collapses a syndicated story carried by two outlets', () => {
    // The load-bearing case. The sources doc recommends ET and Business Standard precisely
    // because they carry PTI and Reuters copy — so the same wire story in both is
    // corroboration of one, not two. A source-level flag cannot catch this: neither
    // outlet is a wire, they carry wire copy article by article.
    const inEconomicTimes = detectWireAgency({
      byline: 'PTI',
      head: 'NEW DELHI: The government approved the scheme on Monday.',
    });
    const inBusinessStandard = detectWireAgency({
      head: 'NEW DELHI (PTI) — The government approved the scheme on Monday.',
    });

    expect(inEconomicTimes?.agency).toBe('PTI');
    expect(inBusinessStandard?.agency).toBe('PTI');
    expect(isStrongWireEvidence(inEconomicTimes)).toBe(true);
    expect(isStrongWireEvidence(inBusinessStandard)).toBe(true);
  });
});

describe('extractPrimaryLinks', () => {
  const primaries = ['sebi.gov.in', 'rbi.org.in', 'irdai.gov.in'];

  it('finds links that trace back to a primary source', () => {
    const links = extractPrimaryLinks(
      [
        'https://www.sebi.gov.in/legal/circulars/aug-2026/disclosure-norms_1234.html',
        'https://example.com/unrelated',
        'https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=999',
      ],
      primaries,
    );
    expect(links).toEqual(['rbi.org.in', 'sebi.gov.in']);
  });

  it('deduplicates repeated links to the same primary', () => {
    const links = extractPrimaryLinks(
      ['https://sebi.gov.in/a', 'https://www.sebi.gov.in/b', 'https://cdn.sebi.gov.in/c'],
      primaries,
    );
    expect(links).toEqual(['sebi.gov.in']);
  });

  it('ignores empty and malformed hrefs', () => {
    expect(extractPrimaryLinks([null, undefined, '', 'not a url'], primaries)).toEqual([]);
  });
});

describe('hasVerbatimQuote', () => {
  it('detects a passage long enough to be a reproduced release', () => {
    expect(hasVerbatimQuote(['x'.repeat(250)])).toBe(true);
  });

  it('ignores short pull quotes', () => {
    expect(hasVerbatimQuote(['"We are pleased," the chairman said.'])).toBe(false);
    expect(hasVerbatimQuote([])).toBe(false);
  });
});
