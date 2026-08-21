/**
 * Claim-type derivation.
 *
 * The product's highest-risk judgment is whether something is confirmed or merely rumoured —
 * both source documents rate getting it wrong as one of the few things that could kill the
 * product. So it lives here, in deterministic testable code driven by the source registry,
 * rather than in a model.
 *
 * A regulator publishing a circular is `announced` because the regulator published it. An
 * outlet story sourced to "people familiar with the matter" is `rumoured` because that is
 * what the article says about itself. Neither call requires us to adjudicate truth.
 */

import type { ClaimType, SourceRole, SourceType, Vertical } from './types.js';
import type { WireDetection } from './origin.js';

/**
 * Language marking a claim as anonymously sourced. Ubiquitous in Indian business press
 * reporting on deals, IPO pricing and funding rounds — exactly the stories where the
 * confirmed-vs-rumoured distinction carries the most weight for a reader.
 */
const ANONYMOUS_SOURCING =
  /\b(?:(?:according to|citing|quoting)\s+(?:unnamed\s+)?sources|sources?\s+(?:said|told|added|indicated|confirmed)|people\s+(?:familiar\s+with|aware\s+of|privy\s+to|close\s+to|in\s+the\s+know)|on\s+condition\s+of\s+anonymity|(?:did\s+not|didn't)\s+(?:wish|want)\s+to\s+be\s+(?:named|identified)|declined\s+to\s+be\s+(?:named|identified)|requested\s+anonymity|industry\s+sources)\b/i;

export interface ClaimTypeInput {
  vertical: Vertical;
  sourceType: SourceType;
  sourceRole: SourceRole;
  /** Article text. Only consulted for outlet and wire copy; primary sources don't need it. */
  text?: string | null;
}

export interface ClaimTypeDerivation {
  /** `null` when the source doesn't make claims of its own — discovery sources point, they don't assert. */
  claimType: ClaimType | null;
  /** Why this label was chosen. Shown in admin review so a human can check the call. */
  reason: string;
}

/**
 * Derive a claim type from the source registry and, for reported copy, the article's own
 * language about its sourcing.
 */
export function deriveClaimType(input: ClaimTypeInput): ClaimTypeDerivation {
  if (input.sourceRole === 'discovery') {
    return {
      claimType: null,
      reason: 'discovery source — points at claims made elsewhere, makes none of its own',
    };
  }

  switch (input.sourceType) {
    case 'regulator':
    case 'exchange':
    case 'industry_body':
      return {
        claimType: 'announced',
        reason: `${input.sourceType} is the primary publisher of this information`,
      };

    case 'company_blog':
    case 'code_release':
      return {
        claimType: 'announced',
        reason: 'first-party announcement by the subject of the story',
      };

    case 'analyst_blog':
      return {
        claimType: 'speculated',
        reason: 'analyst commentary — interpretation rather than an event',
      };

    case 'community':
      return {
        claimType: null,
        reason: 'community source — aggregates rather than reports',
      };

    case 'outlet':
    case 'wire': {
      if (input.text && ANONYMOUS_SOURCING.test(input.text)) {
        const matched = ANONYMOUS_SOURCING.exec(input.text)?.[0] ?? 'anonymous sourcing';
        return {
          claimType: 'rumoured',
          reason: `anonymously sourced: ${JSON.stringify(matched)}`,
        };
      }
      return {
        claimType: 'reported',
        reason: 'attributed reporting by a source of record',
      };
    }
  }
}

/**
 * Whether a document may count as an independent source of corroboration.
 *
 * Two rules keep the count honest, and both are easy to get wrong later if they aren't
 * written down as one predicate:
 *
 * 1. Discovery sources never corroborate. Forty Hacker News comments is corroboration of zero.
 * 2. Syndicated wire copy corroborates once, not once per outlet that republished it.
 *    Callers group by `wireDetection.agency` and keep a single member of each group.
 */
export function countsTowardCorroboration(
  sourceRole: SourceRole,
  wireDetection: WireDetection | null,
): { counts: boolean; reason: string } {
  if (sourceRole === 'discovery') {
    return { counts: false, reason: 'discovery source' };
  }
  if (wireDetection && (wireDetection.evidence === 'byline' || wireDetection.evidence === 'dateline')) {
    return {
      counts: false,
      reason: `syndicated ${wireDetection.agency} copy — counts once for the agency, not once per outlet`,
    };
  }
  return { counts: true, reason: 'independent source of record' };
}
