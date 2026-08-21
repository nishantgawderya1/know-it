/**
 * URL canonicalisation.
 *
 * The same article reaches us four ways: with tracking params from a feed, as an AMP
 * variant, via a Google AMP cache, and as the publisher's own canonical link. Dedup-by-URL
 * is worthless unless all four collapse to one key, so this function is the thing standing
 * between us and the same story appearing six times in a row.
 *
 * Pure and total: never throws, never touches the network. Redirect following and
 * <link rel="canonical"> resolution happen at fetch time; the resulting URL is passed
 * back through here.
 */

/** Query parameters that identify a campaign or referrer, never a resource. */
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'twclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'ref_url',
  'referrer',
  'source',
  'cmp',
  'ncid',
  'spm',
  'at_medium',
  'at_campaign',
  'at_custom1',
  'at_custom2',
  '__twitter_impression',
  '_ga',
  '_gl',
  'amp',
  'outputType',
  'feedType',
  'feedName',
]);

/** Prefixes covering whole families of tracking parameters. */
const TRACKING_PREFIXES = ['utm_', 'pk_', 'piwik_', 'matomo_'];

/** Subdomains that serve the same resource as the apex host. */
const STRIPPABLE_SUBDOMAINS = ['www.', 'amp.', 'm.'];

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAMS.has(lower)) return true;
  return TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Google's AMP cache rewrites `https://example.com/a` as
 * `https://example-com.cdn.ampproject.org/c/s/example.com/a`. Recover the original.
 * The `/c/` marker means "content"; a following `s/` means the origin was https.
 */
function unwrapAmpCache(url: URL): URL {
  if (!url.hostname.endsWith('.cdn.ampproject.org')) return url;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'c') return url;

  let rest = segments.slice(1);
  let scheme = 'http:';
  if (rest[0] === 's') {
    scheme = 'https:';
    rest = rest.slice(1);
  }
  if (rest.length === 0) return url;

  try {
    return new URL(`${scheme}//${rest.join('/')}${url.search}`);
  } catch {
    return url;
  }
}

/**
 * Strip an `amp` path segment when it is the publisher's AMP route rather than part of
 * the slug. Only the first or last segment qualifies, so `/company/amp-energy` is safe.
 */
function stripAmpPathSegment(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return '/';

  if (segments[segments.length - 1]?.toLowerCase() === 'amp') segments.pop();
  else if (segments[0]?.toLowerCase() === 'amp') segments.shift();

  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

export interface CanonicalizeOptions {
  /**
   * Keep `www.`/`m.`/`amp.` prefixes. Off by default: for news publishers these serve the
   * same resource, and collapsing them materially improves dedup.
   */
  keepSubdomainPrefix?: boolean;
  /**
   * Lowercase the path. OFF by default and deliberately opt-in per source.
   *
   * Paths are case-sensitive per RFC 3986, but IIS/ASP.NET sites are not: RBI serves the
   * same press release as both /Scripts/ and /scripts/, so its RSS and its index disagree
   * and the same document lands twice. Enabling this globally would be worse than the
   * problem — on a genuinely case-sensitive host it would merge two distinct articles and
   * lose one, and losing a document is the failure this product cannot absorb.
   */
  lowercasePath?: boolean;
}

/**
 * Reduce a URL to a stable identity key.
 *
 * Returns `null` for input that isn't a usable http(s) URL, so callers can log and skip
 * rather than crash a whole fetch cycle on one malformed feed item.
 */
export function canonicalizeUrl(
  input: string | null | undefined,
  options: CanonicalizeOptions = {},
): string | null {
  if (!input) return null;

  let raw = input.trim();
  if (raw.length === 0) return null;

  // Protocol-relative and bare-host forms both appear in real feeds.
  if (raw.startsWith('//')) raw = `https:${raw}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url = unwrapAmpCache(url);

  url.hostname = url.hostname.toLowerCase();
  url.protocol = url.protocol.toLowerCase();

  if (!options.keepSubdomainPrefix) {
    for (const prefix of STRIPPABLE_SUBDOMAINS) {
      if (url.hostname.startsWith(prefix)) {
        const stripped = url.hostname.slice(prefix.length);
        // Never strip down to a bare TLD — "m.co" must stay intact.
        if (stripped.includes('.')) url.hostname = stripped;
        break;
      }
    }
  }

  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }

  url.hash = '';

  // Drop tracking params, then sort what remains so param order can't create a second key.
  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (!isTrackingParam(key)) kept.push([key, value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = '';
  for (const [key, value] of kept) url.searchParams.append(key, value);

  url.pathname = stripAmpPathSegment(url.pathname);
  if (options.lowercasePath) url.pathname = url.pathname.toLowerCase();

  // Normalise the trailing slash, but keep it on the root path.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

/** Hostname of a URL after canonicalisation, or `null` if it isn't parseable. */
export function canonicalHost(input: string | null | undefined): string | null {
  const canonical = canonicalizeUrl(input);
  if (!canonical) return null;
  try {
    return new URL(canonical).hostname;
  } catch {
    return null;
  }
}

/**
 * True when `url` belongs to `domain` or any subdomain of it.
 * Used to decide whether an outbound link points at a primary source.
 */
export function isSameDomain(url: string | null | undefined, domain: string): boolean {
  const host = canonicalHost(url);
  if (!host) return false;
  const target = domain.toLowerCase().replace(/^www\./, '');
  return host === target || host.endsWith(`.${target}`);
}
