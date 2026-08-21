/**
 * Article extraction and origin-signal capture.
 *
 * ORDER IS LOAD-BEARING. Origin signals — wire bylines, outbound links to primary sources,
 * verbatim quoted passages — exist only in the raw markup and are destroyed by text
 * extraction. The provenance layer two phases from now depends on them, and retrofitting
 * would mean re-fetching every article we have ever seen. So signals come first, always.
 *
 * Readability additionally mutates the DOM it is given, so the document it consumes is
 * parsed separately from the one we harvest signals out of.
 */

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import {
  isSameDomain,
  detectWireAgency,
  extractPrimaryLinks,
  hasVerbatimQuote,
  parseDimension,
  type ImageCandidate,
  type WireEvidence,
} from '@knowit/core';

/** Below this, extraction produced something but not a usable article — paywalls land here. */
const PARTIAL_TEXT_THRESHOLD = 500;

/** Bylines are short. A long match means we grabbed a section, not an attribution. */
const MAX_BYLINE_CHARS = 200;

const BYLINE_SELECTORS = [
  'meta[name="author"]',
  '[rel~="author"]',
  '[itemprop="author"]',
  '[class*="byline" i]',
  '[class*="author" i]',
  '[data-testid*="byline" i]',
];

/**
 * Page metadata that carries a lead image, in preference order. og:image is what the
 * publisher chose to represent the article everywhere else it is shared, which makes it
 * a better card image than anything we could pick out of the body ourselves.
 */
const IMAGE_META_SELECTORS: ReadonlyArray<[selector: string, source: ImageCandidate['source']]> = [
  ['meta[property="og:image"]', 'og'],
  ['meta[property="og:image:url"]', 'og'],
  ['meta[name="twitter:image"]', 'twitter'],
  ['meta[name="twitter:image:src"]', 'twitter'],
  ['link[rel="image_src"]', 'inline'],
];

/** Below this an inline <img> is an avatar, an icon or a section badge, not the article photo. */
const MIN_INLINE_IMAGE_WIDTH = 400;

export type ExtractionStatus = 'ok' | 'partial' | 'failed';

export interface ExtractionResult {
  status: ExtractionStatus;
  title: string | null;
  textContent: string | null;
  originPrimaryLinks: string[];
  originWireByline: string | null;
  originWireEvidence: WireEvidence | null;
  originHasVerbatimQuote: boolean;
  /**
   * Page-level image candidates, for the pipeline to weigh against whatever the feed
   * offered. Collected here rather than in the pipeline because, like the origin
   * signals, they live in the raw markup that extraction is about to discard.
   */
  imageCandidates: ImageCandidate[];
  error: string | null;
}

interface RawSignals {
  byline: string | null;
  hrefs: string[];
  quotes: string[];
  images: ImageCandidate[];
}

function collectSignals(html: string, pageUrl: string): RawSignals {
  const { document } = parseHTML(html);

  const bylineParts: string[] = [];
  for (const selector of BYLINE_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      const text =
        element.getAttribute('content') ?? (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text && text.length <= MAX_BYLINE_CHARS) bylineParts.push(text);
      if (bylineParts.length >= 4) break;
    }
    if (bylineParts.length >= 4) break;
  }

  const hrefs: string[] = [];
  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    if (!href) continue;
    try {
      hrefs.push(new URL(href, pageUrl).toString());
    } catch {
      // A malformed href on one link must not lose the rest of the page's signals.
    }
  }

  const quotes: string[] = [];
  for (const quote of document.querySelectorAll('blockquote')) {
    const text = (quote.textContent ?? '').trim();
    if (text) quotes.push(text);
  }

  const images: ImageCandidate[] = [];
  for (const [selector, source] of IMAGE_META_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      const url = element.getAttribute('content') ?? element.getAttribute('href');
      if (url) images.push({ url, source });
    }
  }

  // Body images last, and only when the markup declares them big enough to be the
  // subject of the article. An undeclared width is treated as too small on purpose:
  // this tier exists as a last resort, and a wrong lead image is worse than none.
  for (const img of document.querySelectorAll('img[src], img[data-src]')) {
    const width = parseDimension(img.getAttribute('width'));
    if (width === null || width < MIN_INLINE_IMAGE_WIDTH) continue;
    const url = img.getAttribute('data-src') ?? img.getAttribute('src');
    if (!url) continue;
    images.push({
      url,
      source: 'inline',
      width,
      height: parseDimension(img.getAttribute('height')),
    });
    if (images.length >= 12) break;
  }

  return {
    byline: bylineParts.length > 0 ? [...new Set(bylineParts)].join(' · ') : null,
    hrefs,
    quotes,
    images,
  };
}

function readArticle(html: string): { title: string | null; text: string | null } {
  try {
    // A second, throwaway parse: Readability rewrites the document it is handed.
    const { document } = parseHTML(html);
    const parsed = new Readability(document as unknown as Document).parse();
    const text = parsed?.textContent?.replace(/\s+\n/g, '\n').trim() ?? null;
    return { title: parsed?.title?.trim() || null, text: text && text.length > 0 ? text : null };
  } catch {
    return { title: null, text: null };
  }
}

/**
 * Whatever visible text the page has, with chrome stripped.
 *
 * Readability returns *nothing* — not a short result — for pages it can't recognise as an
 * article. Without this fallback two very different situations would look identical: a
 * paywalled stub, and a regulator circular page that simply isn't article-shaped. Both are
 * common in this registry, and only one of them is a problem.
 */
function plainTextFallback(html: string): string | null {
  try {
    const { document } = parseHTML(html);
    for (const element of document.querySelectorAll('script, style, nav, header, footer, aside')) {
      element.remove();
    }
    // Take the first root that actually carries text, not merely the first that exists:
    // given a bare fragment, linkedom produces an empty <body> and puts the content under
    // documentElement, so a plain `body ?? documentElement` picks the empty one.
    for (const root of [document.body, document.documentElement]) {
      const text = (root?.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text.length > 0) return text;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract an article and its origin signals.
 *
 * @param feedAuthor byline the feed already gave us — the cheapest wire signal available,
 *                   and sometimes the only one when a page hides attribution in script tags.
 * @param primaryDomains regulator and exchange hosts from the registry; an outbound link to
 *                   one of these is what proves a story traces to a primary release.
 * @param isPrimarySource true for regulators and exchanges. They publish first-party, so
 *                   syndication is impossible and wire scanning can only produce false
 *                   positives — an RBI notification listing proscribed organisations
 *                   matched "ANI" on live data.
 */
export function extractArticle(
  html: string,
  pageUrl: string,
  feedAuthor: string | null,
  primaryDomains: ReadonlyArray<string>,
  isPrimarySource = false,
): ExtractionResult {
  let signals: RawSignals;
  try {
    signals = collectSignals(html, pageUrl);
  } catch (error: unknown) {
    return {
      status: 'failed',
      title: null,
      textContent: null,
      originPrimaryLinks: [],
      originWireByline: null,
      originWireEvidence: null,
      originHasVerbatimQuote: false,
      imageCandidates: [],
      error: `signal collection failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const { title, text: articleText } = readArticle(html);

  // Readability first; page text as a fallback so an unstructured page still yields
  // something to detect a byline in and something for clustering to use later.
  const usedFallback = articleText === null;
  const text = articleText ?? plainTextFallback(html);

  const byline = [feedAuthor, signals.byline].filter(Boolean).join(' · ') || null;
  const wire = isPrimarySource
    ? null
    : detectWireAgency({ byline, head: text?.slice(0, 400) ?? null, body: text });

  const status: ExtractionStatus =
    text === null
      ? 'failed'
      : usedFallback || text.length < PARTIAL_TEXT_THRESHOLD
        ? 'partial'
        : 'ok';

  return {
    status,
    title,
    textContent: text,
    // Exclude the primary source this page already *is*. The signal we want is "an outlet
    // pointed at a regulator"; a regulator citing itself is trivially true and would mark
    // every document it publishes. Comparing registry domains rather than hostnames matters:
    // RBI serves its PDFs from rbidocs.rbi.org.in, a different host but the same source.
    originPrimaryLinks: extractPrimaryLinks(signals.hrefs, primaryDomains).filter(
      (domain) => !isSameDomain(pageUrl, domain),
    ),
    originWireByline: wire?.agency ?? null,
    originWireEvidence: wire?.evidence ?? null,
    originHasVerbatimQuote: hasVerbatimQuote(signals.quotes),
    imageCandidates: signals.images,
    error:
      status === 'failed'
        ? 'page yielded no readable text at all'
        : status === 'partial'
          ? usedFallback
            ? `page was not article-shaped; fell back to page text (${text?.length ?? 0} chars)`
            : `article text was only ${text?.length ?? 0} chars — possible paywall or truncation`
          : null,
  };
}
