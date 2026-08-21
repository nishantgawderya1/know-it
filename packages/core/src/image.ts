/**
 * Lead-image selection and validation.
 *
 * Images arrive from two places — the feed (media:content, media:thumbnail, enclosure,
 * an <img> inside content:encoded) and the article page (og:image and friends). Both
 * hand us URLs that are frequently unusable: tracking pixels, 1x1 spacers, data URIs,
 * relative paths, and placeholder assets served when the real image is missing.
 *
 * This module is pure so the rules are testable without a network or a DOM. It decides
 * *which* URL to keep, never fetches one — verifying an image is real would mean an
 * extra request per article, and a broken image is a cosmetic bug while a slow fetch
 * is a coverage bug.
 */

/**
 * Where a lead image came from. Recorded per document because a sudden shift in this
 * distribution is how we notice a publisher changed its feed shape.
 */
export type ImageSource =
  | 'media_content'
  | 'media_thumbnail'
  | 'enclosure'
  | 'content_img'
  | 'og'
  | 'twitter'
  | 'inline';

export interface ImageCandidate {
  url: string;
  source: ImageSource;
  /**
   * Dimensions arrive as strings from feeds (`width="1200"`) and as numbers from code.
   * Both are accepted here and normalised by `parseDimension`, so callers never have to
   * remember which shape their source hands back.
   */
  width?: number | string | null;
  height?: number | string | null;
}

export interface ResolvedImage {
  url: string;
  source: ImageSource;
  width: number | null;
  height: number | null;
}

/**
 * Anything at or below this in either dimension is a tracking pixel or a spacer, not a
 * lead image. Feeds do ship 1x1 <img> tags inside content:encoded for analytics.
 */
const MIN_USABLE_DIMENSION = 3;

/** Below this, an image is a favicon, an avatar or a bullet — never a card image. */
const MIN_LEAD_IMAGE_WIDTH = 200;

/**
 * URL shapes that are never a lead image. Deliberately narrow: over-matching here
 * silently drops real photography, and a missing image is invisible in a way a wrong
 * image is not.
 */
const JUNK_URL_PATTERNS = [
  /\/(?:pixel|spacer|blank|beacon|dot)\.(?:gif|png)(?:$|\?)/i,
  /\b1x1\b/i,
  /\/track(?:ing)?\?/i,
  /\bplaceholder\b/i,
  /\bdefault[-_]?(?:image|thumb|avatar)\b/i,
  /\bsprite\b/i,
  /\/logo[-_.]/i,
];

const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|gif|avif)(?:$|\?|#)/i;

/** Parse a width/height that may arrive as a number, a numeric string, or "640px". */
export function parseDimension(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)/.exec(value);
  if (!match?.[1]) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

/**
 * Absolutise and sanity-check one image URL.
 *
 * `baseUrl` is the page or feed item URL: feeds routinely ship protocol-relative
 * (`//img.cdn/x.jpg`) and root-relative (`/img/x.jpg`) sources, and dropping those
 * would cost us images on entire publishers rather than on individual articles.
 */
export function normaliseImageUrl(raw: string | null | undefined, baseUrl: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Inlined images are usually spacers, and storing base64 in a text column is a
  // storage bug waiting to happen.
  if (/^data:/i.test(trimmed)) return null;

  // No real image URL carries an unencoded space. Without this, `new URL` happily
  // resolves free text ("Photo unavailable") against the page as a relative path and
  // hands back a confident-looking URL for something that was never a link.
  if (/\s/.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed, baseUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname.length === 0) return null;

  url.hash = '';
  return url.toString();
}

/** True when this URL is a known non-image asset shape. */
export function isJunkImageUrl(url: string): boolean {
  return JUNK_URL_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * Choose the lead image from everything a feed item and its page offered.
 *
 * Candidates are supplied in the caller's preference order (feed media first, page
 * metadata last) and that order is respected — but a *larger* candidate of the same
 * preference tier wins, because publishers commonly ship both a thumbnail and a
 * full-size image under media:content and only the latter survives a card layout.
 */
export function selectLeadImage(
  candidates: ReadonlyArray<ImageCandidate>,
  baseUrl: string,
): ResolvedImage | null {
  const usable: ResolvedImage[] = [];

  for (const candidate of candidates) {
    const url = normaliseImageUrl(candidate.url, baseUrl);
    if (!url || isJunkImageUrl(url)) continue;

    const width = parseDimension(candidate.width);
    const height = parseDimension(candidate.height);

    // Known-tiny is a pixel. Unknown size is kept: most feeds omit dimensions entirely
    // and rejecting those would discard the majority of real images.
    if (width !== null && width < MIN_USABLE_DIMENSION) continue;
    if (height !== null && height < MIN_USABLE_DIMENSION) continue;
    if (width !== null && width < MIN_LEAD_IMAGE_WIDTH) continue;

    usable.push({ url, source: candidate.source, width, height });
  }

  if (usable.length === 0) return null;

  // Preference tier is the candidate order; within the first tier present, prefer the
  // widest known image. `find` keeps the first tier, then we scan only that tier.
  const bestSource = usable[0]!.source;
  const sameTier = usable.filter((image) => image.source === bestSource);

  return sameTier.reduce((best, image) =>
    (image.width ?? 0) > (best.width ?? 0) ? image : best,
  );
}

/**
 * Pull the first plausible <img src> out of an HTML fragment.
 *
 * Used on `content:encoded`, which is a fragment rather than a document — running a
 * full DOM parse per feed item to read one attribute is not worth the cost, and the
 * fragment is publisher-generated markup rather than arbitrary input.
 */
export function firstImageInHtml(html: string | null | undefined): string | null {
  if (typeof html !== 'string' || html.length === 0) return null;

  const imgTag = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = imgTag.exec(html)) !== null) {
    const tag = match[0];
    // Lazy-loaded images put a spacer in src and the real URL in data-src.
    const src =
      /\bdata-src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ??
      /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ??
      null;
    if (!src) continue;
    if (/^data:/i.test(src)) continue;
    if (isJunkImageUrl(src)) continue;
    if (!IMAGE_EXTENSION.test(src) && !/\/(?:image|photo|media|img)s?\//i.test(src)) continue;
    return src;
  }

  return null;
}
