import { describe, expect, it } from 'vitest';
import { canonicalHost, canonicalizeUrl, isSameDomain } from './url.js';

describe('canonicalizeUrl', () => {
  it('collapses the four ways the same article reaches us', () => {
    // A feed link with tracking, the AMP route, the Google AMP cache copy, and the
    // publisher's own canonical link must all reduce to one key — otherwise the same
    // story appears four times in the feed.
    const expected = 'https://livemint.com/economy/rbi-holds-rates';
    const variants = [
      'https://www.livemint.com/economy/rbi-holds-rates?utm_source=rss&utm_medium=feed',
      'https://www.livemint.com/economy/rbi-holds-rates/amp',
      'https://www-livemint-com.cdn.ampproject.org/c/s/www.livemint.com/economy/rbi-holds-rates',
      'https://livemint.com/economy/rbi-holds-rates/',
    ];
    for (const variant of variants) {
      expect(canonicalizeUrl(variant), variant).toBe(expected);
    }
  });

  it('strips tracking parameters but keeps meaningful ones', () => {
    expect(
      canonicalizeUrl('https://moneycontrol.com/news?id=42&utm_campaign=x&fbclid=y&page=2'),
    ).toBe('https://moneycontrol.com/news?id=42&page=2');
  });

  it('sorts query parameters so ordering cannot create a second key', () => {
    const a = canonicalizeUrl('https://example.com/a?b=2&a=1');
    const b = canonicalizeUrl('https://example.com/a?a=1&b=2');
    expect(a).toBe(b);
  });

  it('normalises scheme, host case, default ports and fragments', () => {
    expect(canonicalizeUrl('HTTPS://WWW.Example.COM:443/Path#section')).toBe(
      'https://example.com/Path',
    );
  });

  it('keeps the root path slash', () => {
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('does not mistake a slug containing "amp" for an AMP route', () => {
    expect(canonicalizeUrl('https://example.com/company/amp-energy')).toBe(
      'https://example.com/company/amp-energy',
    );
  });

  it('never strips a subdomain down to a bare TLD', () => {
    expect(canonicalizeUrl('https://m.co/x')).toBe('https://m.co/x');
  });

  it('accepts protocol-relative and bare-host forms found in real feeds', () => {
    expect(canonicalizeUrl('//example.com/a')).toBe('https://example.com/a');
    expect(canonicalizeUrl('example.com/a')).toBe('https://example.com/a');
  });

  it('returns null rather than throwing on unusable input', () => {
    // One malformed item must not take down a whole fetch cycle.
    expect(canonicalizeUrl(null)).toBeNull();
    expect(canonicalizeUrl('')).toBeNull();
    expect(canonicalizeUrl('   ')).toBeNull();
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalizeUrl('mailto:a@b.com')).toBeNull();
    expect(canonicalizeUrl('http://')).toBeNull();
  });
});

describe('canonicalHost', () => {
  it('returns the normalised host', () => {
    expect(canonicalHost('https://www.sebi.gov.in/legal/circulars')).toBe('sebi.gov.in');
  });

  it('returns null for unusable input', () => {
    expect(canonicalHost('not a url at all !!')).toBeNull();
  });
});

describe('isSameDomain', () => {
  it('matches the apex and its subdomains', () => {
    expect(isSameDomain('https://www.sebi.gov.in/x', 'sebi.gov.in')).toBe(true);
    expect(isSameDomain('https://cdn.sebi.gov.in/x', 'sebi.gov.in')).toBe(true);
    expect(isSameDomain('https://sebi.gov.in', 'www.sebi.gov.in')).toBe(true);
  });

  it('does not match a lookalike suffix', () => {
    expect(isSameDomain('https://notsebi.gov.in/x', 'sebi.gov.in')).toBe(false);
    expect(isSameDomain('https://sebi.gov.in.evil.com/x', 'sebi.gov.in')).toBe(false);
  });
});

describe('lowercasePath', () => {
  it('collapses ASP.NET path casing when opted in', () => {
    // RBI's index links /Scripts/ and its RSS feed links /scripts/ — the same press
    // release. Without this the audit reported 0/70 held while we held 10.
    const a = canonicalizeUrl('https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63403', { lowercasePath: true });
    const b = canonicalizeUrl('https://rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=63403', { lowercasePath: true });
    expect(a).toBe(b);
  });

  it('is off by default, because merging distinct articles loses one', () => {
    const a = canonicalizeUrl('https://example.com/Story-A');
    const b = canonicalizeUrl('https://example.com/story-a');
    expect(a).not.toBe(b);
  });
});
