import { describe, expect, it } from 'vitest';
import { countsTowardCorroboration, deriveClaimType } from './claim-type.js';
import type { WireDetection } from './origin.js';

const base = { vertical: 'finance', sourceRole: 'record' } as const;

describe('deriveClaimType', () => {
  it('labels primary publishers as announced', () => {
    for (const sourceType of ['regulator', 'exchange', 'industry_body'] as const) {
      expect(deriveClaimType({ ...base, sourceType }).claimType).toBe('announced');
    }
  });

  it('labels first-party tech announcements as announced', () => {
    for (const sourceType of ['company_blog', 'code_release'] as const) {
      expect(deriveClaimType({ vertical: 'tech', sourceRole: 'record', sourceType }).claimType).toBe(
        'announced',
      );
    }
  });

  it('labels analyst commentary as speculated', () => {
    expect(deriveClaimType({ ...base, sourceType: 'analyst_blog' }).claimType).toBe('speculated');
  });

  it('labels attributed outlet reporting as reported', () => {
    const result = deriveClaimType({
      ...base,
      sourceType: 'outlet',
      text: 'SEBI chairman Madhabi Puri Buch said the framework would take effect in October.',
    });
    expect(result.claimType).toBe('reported');
  });

  it('downgrades anonymously sourced reporting to rumoured', () => {
    // The distinction that matters most to the reader: an IPO price band "people familiar
    // with the matter" mention is not the same as the merchant bank confirming it.
    const phrasings = [
      'The IPO could be priced at ₹450 a share, people familiar with the matter said.',
      'Sources said the deal may be announced next week.',
      'According to sources, the fund is in advanced talks.',
      'The executive spoke on condition of anonymity.',
      'Two people aware of the development confirmed the plan.',
      'Industry sources indicated a revision was likely.',
      'A banker who declined to be identified said talks were ongoing.',
    ];
    for (const text of phrasings) {
      const result = deriveClaimType({ ...base, sourceType: 'outlet', text });
      expect(result.claimType, text).toBe('rumoured');
    }
  });

  it('does not consult article text for primary sources', () => {
    // A SEBI circular that happens to contain the word "sources" is still an announcement.
    const result = deriveClaimType({
      ...base,
      sourceType: 'regulator',
      text: 'Sources said this circular supersedes the earlier one.',
    });
    expect(result.claimType).toBe('announced');
  });

  it('returns null for sources that make no claims of their own', () => {
    expect(
      deriveClaimType({ vertical: 'tech', sourceType: 'outlet', sourceRole: 'discovery' }).claimType,
    ).toBeNull();
    expect(
      deriveClaimType({ vertical: 'tech', sourceType: 'community', sourceRole: 'record' }).claimType,
    ).toBeNull();
  });

  it('always explains its reasoning', () => {
    const result = deriveClaimType({ ...base, sourceType: 'regulator' });
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe('countsTowardCorroboration', () => {
  const byline: WireDetection = { agency: 'PTI', evidence: 'byline', matched: 'PTI' };
  const dateline: WireDetection = { agency: 'Reuters', evidence: 'dateline', matched: 'Reuters' };
  const mention: WireDetection = { agency: 'Reuters', evidence: 'mention', matched: 'Reuters' };

  it('counts independent reporting', () => {
    expect(countsTowardCorroboration('record', null).counts).toBe(true);
  });

  it('never counts a discovery source', () => {
    // Forty Hacker News comments is corroboration of zero.
    expect(countsTowardCorroboration('discovery', null).counts).toBe(false);
  });

  it('does not count syndicated wire copy', () => {
    expect(countsTowardCorroboration('record', byline).counts).toBe(false);
    expect(countsTowardCorroboration('record', dateline).counts).toBe(false);
  });

  it('still counts an article that merely mentions a wire', () => {
    // "Reuters reported earlier" is not the same as running Reuters copy — it needs a
    // human look, not automatic exclusion.
    expect(countsTowardCorroboration('record', mention).counts).toBe(true);
  });
});
