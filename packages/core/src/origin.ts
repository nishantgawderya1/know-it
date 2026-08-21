/**
 * Origin-trace signals.
 *
 * The sources doc is explicit that Economic Times "carries PTI wire content" and that Mint
 * and Business Standard "carry Reuters content" — they are recommended precisely as free
 * substitutes for paid wires. So the same wire story appearing in ET *and* Business Standard
 * is corroboration of one, not two. A source-level `is_wire_agency` flag cannot catch this,
 * because ET is not a wire; it carries wire copy article by article.
 *
 * These signals exist only in the raw HTML and are destroyed by text extraction, so the
 * fetcher gathers them before extracting and passes the regions in here.
 *
 * Pure: no DOM, no network. The worker owns the parsing; this module owns the judgment.
 */

import { isSameDomain } from './url.js';
import { type WireAgency } from './types.js';

/** Alternate spellings that resolve to the same agency. Longest forms first — order matters. */
const AGENCY_PATTERNS: ReadonlyArray<readonly [WireAgency, RegExp]> = [
  ['PTI', /\b(?:Press Trust of India|PTI(?:-Bhasha)?)\b/i],
  ['ANI', /\b(?:Asian News International|ANI)\b/i],
  ['Reuters', /\b(?:Thomson Reuters|Reuters)\b/i],
  ['AFP', /\b(?:Agence France[-\s]?Presse|AFP)\b/i],
  ['IANS', /\b(?:Indo[-\s]?Asian News Service|IANS)\b/i],
  ['Bloomberg', /\bBloomberg\b/i],
  // "AP" alone is too short to match safely in running text; require the full name
  // or an unambiguous byline slot, which the byline scan below provides.
  ['AP', /\bAssociated Press\b/i],
];

/** Byline slots: "By PTI", "Source: Reuters", "With inputs from ANI". */
const BYLINE_LEAD = /\b(?:by|source|agency|inputs? from|with inputs from|courtesy)\s*[:\-–—]?\s*$/i;

/** Dateline convention: "NEW DELHI (Reuters) —". */
const DATELINE = /\(\s*(PTI|ANI|Reuters|AFP|IANS|Bloomberg|AP)\s*\)/i;

/** How many leading characters of article text count as the dateline region. */
const HEAD_REGION_CHARS = 400;

export type WireEvidence = 'byline' | 'dateline' | 'mention';

export interface WireDetection {
  agency: WireAgency;
  /** How the agency was identified. `byline` and `dateline` are strong; `mention` needs review. */
  evidence: WireEvidence;
  /** The matched text, so a human can check the call in the dashboard. */
  matched: string;
}

/** Text regions the fetcher pulls out of the markup before extraction flattens it. */
export interface OriginTextRegions {
  /** Text of a byline or author element, if the markup had one. */
  byline?: string | null;
  /** Leading portion of the article body, where datelines live. */
  head?: string | null;
  /** Full article text. Scanned last and only yields a weak `mention`. */
  body?: string | null;
}

function findAgency(text: string): { agency: WireAgency; matched: string } | null {
  for (const entry of AGENCY_PATTERNS) {
    const [agency, pattern] = entry;
    const match = pattern.exec(text);
    if (match) return { agency, matched: match[0] };
  }
  return null;
}

/**
 * Identify the wire agency a document's copy originated from, if any.
 *
 * Checked strongest-first so a real byline always wins over an incidental mention.
 * Returns `null` when nothing matches — which is the common and expected case for
 * original reporting and for anything published by a regulator.
 */
export function detectWireAgency(regions: OriginTextRegions): WireDetection | null {
  // 1. An explicit byline element is unambiguous.
  if (regions.byline) {
    const found = findAgency(regions.byline);
    if (found) return { ...found, evidence: 'byline' };
    // Bare "AP" is only safe inside a byline element.
    if (/^\s*AP\s*$/i.test(regions.byline)) {
      return { agency: 'AP', evidence: 'byline', matched: regions.byline.trim() };
    }
  }

  const head = (regions.head ?? regions.body ?? '').slice(0, HEAD_REGION_CHARS);

  if (head) {
    // 2. Dateline convention.
    const dateline = DATELINE.exec(head);
    if (dateline?.[1]) {
      const found = findAgency(dateline[1]);
      if (found) return { ...found, evidence: 'dateline' };
    }

    // 3. A byline phrase inline in the opening text.
    const found = findAgency(head);
    if (found) {
      const before = head.slice(0, head.toLowerCase().indexOf(found.matched.toLowerCase()));
      if (BYLINE_LEAD.test(before)) return { ...found, evidence: 'byline' };
      return { ...found, evidence: 'dateline' };
    }
  }

  // 4. Weakest signal: named anywhere in the body. Flags for review rather than deciding.
  if (regions.body) {
    const found = findAgency(regions.body);
    if (found) return { ...found, evidence: 'mention' };
  }

  return null;
}

/** Strong enough to collapse two outlets into one independent source without human review. */
export function isStrongWireEvidence(detection: WireDetection | null): boolean {
  return detection?.evidence === 'byline' || detection?.evidence === 'dateline';
}

/**
 * Outbound links pointing at a primary source (a regulator or exchange in the registry).
 *
 * An outlet story linking to `sebi.gov.in` traces to a primary release, which is what
 * lets the independent count distinguish "three outlets rewrote one circular" from
 * "three outlets reported independently".
 */
export function extractPrimaryLinks(
  hrefs: ReadonlyArray<string | null | undefined>,
  primaryDomains: ReadonlyArray<string>,
): string[] {
  const found = new Set<string>();
  for (const href of hrefs) {
    if (!href) continue;
    for (const domain of primaryDomains) {
      if (isSameDomain(href, domain)) {
        found.add(domain.toLowerCase().replace(/^www\./, ''));
        break;
      }
    }
  }
  return [...found].sort();
}

/** A quoted passage long enough to suggest the article reproduces a release rather than reporting on it. */
const VERBATIM_MIN_CHARS = 200;

export function hasVerbatimQuote(
  quotedPassages: ReadonlyArray<string | null | undefined>,
  minChars: number = VERBATIM_MIN_CHARS,
): boolean {
  return quotedPassages.some((passage) => (passage?.trim().length ?? 0) >= minChars);
}
