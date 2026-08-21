/**
 * Tech source registry — shadow mode.
 *
 * Fetched and coverage-measured, but never reviewed, summarised or surfaced to users until
 * Finance clears its exit criterion. Shadow mode costs almost nothing (no LLM calls in
 * Phase 1) and tests whether the engine generalises across differently-shaped sources,
 * which is exactly what the founding brief asks a second beta vertical to do.
 *
 * Taken from the KnowIt sources doc. Two changes made during seeding:
 *
 * 1. Hacker News and Product Hunt are `sourceRole: 'discovery'`. They point at stories
 *    rather than reporting them, so they must never count toward corroboration —
 *    forty HN comments is corroboration of zero.
 * 2. Four Indian tech-policy regulators are ADDED at the end. They are not in the doc.
 *    Without them Tech has no `index_diff` audit target at all and is limited to weak
 *    proxy sampling, so the coverage thesis can't be tested here the way it can in Finance.
 *    Medianama covers this beat well but is an outlet, not a primary source.
 */

import { IST_EXTENDED, US_WEIGHTED, type SeedSource } from './types.js';

export const techSources: SeedSource[] = [
  // --- Global tech outlets ---
  {
    slug: 'techcrunch',
    name: 'TechCrunch',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://techcrunch.com/feed/',
    reliabilityWeight: 0.7,
    activeIntervalMin: 15,
    offIntervalMin: 60,
    topics: ['funding', 'startups', 'big-tech', 'product-launch'],
    notes: 'High volume — filter by category tag to reduce noise, per the doc.',
    ...US_WEIGHTED,
  },
  {
    slug: 'the-verge',
    name: 'The Verge',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.theverge.com/rss/index.xml',
    reliabilityWeight: 0.7,
    activeIntervalMin: 15,
    offIntervalMin: 60,
    topics: ['consumer-tech', 'big-tech', 'policy', 'hardware'],
    ...US_WEIGHTED,
  },
  {
    slug: 'ars-technica',
    name: 'Ars Technica',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://feeds.arstechnica.com/arstechnica/index',
    reliabilityWeight: 0.85,
    activeIntervalMin: 20,
    offIntervalMin: 90,
    topics: ['deep-tech', 'security', 'science', 'policy'],
    notes: 'Highest signal-to-noise in tech journalism, per the doc.',
    ...US_WEIGHTED,
  },
  {
    slug: 'wired',
    name: 'Wired',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.wired.com/feed/rss',
    reliabilityWeight: 0.7,
    isFullText: false,
    activeIntervalMin: 30,
    offIntervalMin: 120,
    topics: ['tech', 'culture', 'regulation'],
    notes:
      'Partially paywalled — expect truncated extraction. Mark as partial rather than ' +
      'treating a short body as a failure.',
    ...US_WEIGHTED,
  },
  {
    slug: 'mit-technology-review',
    name: 'MIT Technology Review',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.technologyreview.com/feed/',
    reliabilityWeight: 0.8,
    activeIntervalMin: 60,
    offIntervalMin: 240,
    topics: ['ai', 'emerging-tech', 'semiconductors'],
    ...US_WEIGHTED,
  },
  {
    slug: 'the-register',
    name: 'The Register',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'atom',
    feedUrl: 'https://www.theregister.com/headlines.atom',
    reliabilityWeight: 0.7,
    activeIntervalMin: 20,
    offIntervalMin: 90,
    topics: ['enterprise', 'security', 'developer-tools'],
    ...US_WEIGHTED,
  },
  {
    slug: 'venturebeat',
    name: 'VentureBeat',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://venturebeat.com/feed/',
    reliabilityWeight: 0.7,
    activeIntervalMin: 20,
    offIntervalMin: 90,
    topics: ['funding', 'enterprise', 'ai'],
    ...US_WEIGHTED,
  },
  {
    slug: 'infoq',
    name: 'InfoQ',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://feed.infoq.com/',
    reliabilityWeight: 0.75,
    activeIntervalMin: 60,
    offIntervalMin: 240,
    topics: ['architecture', 'developer-practices'],
    ...US_WEIGHTED,
  },
  {
    slug: 'ieee-spectrum',
    name: 'IEEE Spectrum',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://spectrum.ieee.org/feeds/feed.rss',
    reliabilityWeight: 0.8,
    activeIntervalMin: 60,
    offIntervalMin: 240,
    topics: ['semiconductors', 'hardware'],
    ...US_WEIGHTED,
  },
  {
    slug: 'toms-hardware',
    name: "Tom's Hardware",
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.tomshardware.com/feeds/all',
    reliabilityWeight: 0.65,
    activeIntervalMin: 30,
    offIntervalMin: 120,
    topics: ['hardware', 'semiconductors', 'gpu', 'cpu'],
    ...US_WEIGHTED,
  },

  // --- Security ---
  {
    slug: 'bleeping-computer',
    name: 'Bleeping Computer',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.bleepingcomputer.com/feed/',
    reliabilityWeight: 0.75,
    activeIntervalMin: 20,
    offIntervalMin: 90,
    topics: ['security', 'malware', 'cve'],
    ...US_WEIGHTED,
  },
  {
    slug: 'krebs-on-security',
    name: 'Krebs on Security',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://krebsonsecurity.com/feed/',
    reliabilityWeight: 0.85,
    activeIntervalMin: 120,
    offIntervalMin: 360,
    topics: ['security', 'investigative'],
    notes: 'Low volume, very high signal. Investigative security only.',
    ...US_WEIGHTED,
  },

  // --- Platform / vendor ecosystems ---
  {
    slug: 'android-authority',
    name: 'Android Authority',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.androidauthority.com/feed/',
    reliabilityWeight: 0.65,
    activeIntervalMin: 30,
    offIntervalMin: 120,
    topics: ['android', 'google'],
    ...US_WEIGHTED,
  },
  {
    slug: '9to5google',
    name: '9to5Google',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://9to5google.com/feed/',
    reliabilityWeight: 0.65,
    activeIntervalMin: 30,
    offIntervalMin: 120,
    topics: ['google', 'pixel', 'android'],
    ...US_WEIGHTED,
  },
  {
    slug: '9to5mac',
    name: '9to5Mac',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://9to5mac.com/feed/',
    reliabilityWeight: 0.65,
    activeIntervalMin: 30,
    offIntervalMin: 120,
    topics: ['apple', 'ios', 'macos'],
    ...US_WEIGHTED,
  },

  // --- Indian startup ecosystem ---
  {
    slug: 'inc42',
    name: 'Inc42',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://inc42.com/feed/',
    reliabilityWeight: 0.75,
    activeIntervalMin: 20,
    offIntervalMin: 90,
    topics: ['indian-startups', 'funding', 'ecosystem'],
    notes: 'Best Indian startup coverage overall.',
    ...IST_EXTENDED,
  },
  {
    slug: 'yourstory',
    name: 'YourStory',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://yourstory.com/feed/',
    reliabilityWeight: 0.65,
    activeIntervalMin: 30,
    offIntervalMin: 120,
    topics: ['indian-startups', 'founders'],
    notes: 'More narrative than numbers. Complements Inc42.',
    ...IST_EXTENDED,
  },
  {
    slug: 'entrackr',
    name: 'Entrackr',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://entrackr.com/rss',
    reliabilityWeight: 0.8,
    activeIntervalMin: 30,
    offIntervalMin: 120,
    topics: ['indian-startups', 'funding', 'financials', 'mca'],
    notes:
      'Best source for actual revenue and loss figures of Indian startups. Feed path corrected ' +
      'and verified 2026-08-18 — /feed/ returns 404, /rss returns 200.',
    ...IST_EXTENDED,
  },
  {
    slug: 'medianama',
    name: 'Medianama',
    vertical: 'tech',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.medianama.com/feed/',
    reliabilityWeight: 0.8,
    activeIntervalMin: 30,
    offIntervalMin: 120,
    topics: ['indian-tech-policy', 'dpdp', 'upi', 'telecom'],
    notes: 'Only serious outlet covering Indian digital regulation. Mandatory for this vertical.',
    ...IST_EXTENDED,
  },

  // --- First-party and code releases ---
  {
    slug: 'github-blog',
    name: 'GitHub Blog',
    vertical: 'tech',
    sourceType: 'company_blog',
    fetchType: 'rss',
    feedUrl: 'https://github.blog/feed/',
    reliabilityWeight: 0.9,
    activeIntervalMin: 60,
    offIntervalMin: 240,
    topics: ['github', 'open-source', 'developer-tools'],
    notes: 'Official. Low volume, very high signal.',
    ...US_WEIGHTED,
  },
  {
    slug: 'github-releases',
    name: 'GitHub — Tracked Repo Releases',
    vertical: 'tech',
    sourceType: 'code_release',
    fetchType: 'github_api',
    feedUrl: 'https://api.github.com',
    reliabilityWeight: 0.9,
    activeIntervalMin: 60,
    offIntervalMin: 240,
    topics: ['open-source', 'releases'],
    notes:
      'Tracked repos are configured in the adapter, not here. 60 req/hr unauthenticated, ' +
      '5000/hr with GITHUB_TOKEN — size the tracked list against that limit.',
    ...US_WEIGHTED,
  },
  {
    slug: 'github-trending',
    name: 'GitHub Trending',
    vertical: 'tech',
    sourceType: 'code_release',
    sourceRole: 'discovery',
    fetchType: 'scrape',
    feedUrl: 'https://github.com/trending',
    // Repo links only — github.com/<owner>/<repo> with nothing after it.
    indexLinkPattern: '^https://github[.]com/[^/]+/[^/]+$',
    reliabilityWeight: 0.6,
    activeIntervalMin: 240,
    offIntervalMin: 720,
    topics: ['open-source', 'trending'],
    notes: 'No official API. The only Tech scraper. Discovery — surfaces repos, reports nothing.',
    ...US_WEIGHTED,
  },

  // --- Discovery ---
  {
    slug: 'hacker-news',
    name: 'Hacker News',
    vertical: 'tech',
    sourceType: 'community',
    sourceRole: 'discovery',
    fetchType: 'hn',
    feedUrl: 'https://hacker-news.firebaseio.com/v0',
    // No authority enumerates "all tech news today", so HN is the closest thing to
    // ground truth we have for this vertical. Weaker than index_diff, and labelled so.
    auditStrategy: 'proxy_sample',
    reliabilityWeight: 0.5,
    activeIntervalMin: 15,
    offIntervalMin: 60,
    topics: ['dev-community', 'startups', 'breaking'],
    notes:
      'Firebase API for front page and newest; Algolia (hn.algolia.com/api/v1) for keyword ' +
      'and date filtering. Free, no key. Points at stories — never counts as corroboration.',
    ...US_WEIGHTED,
  },
  {
    slug: 'product-hunt',
    name: 'Product Hunt',
    vertical: 'tech',
    sourceType: 'community',
    sourceRole: 'discovery',
    fetchType: 'rss',
    feedUrl: 'https://www.producthunt.com/feed',
    reliabilityWeight: 0.55,
    activeIntervalMin: 120,
    offIntervalMin: 360,
    topics: ['product-launch', 'saas', 'developer-tools'],
    notes: 'RSS needs no key; the GraphQL API does. Start with RSS.',
    ...US_WEIGHTED,
  },

  // ---------------------------------------------------------------------------
  // ADDED — not in the sources doc.
  //
  // Indian tech-policy regulators. These give Tech the same primary-source anchor that
  // makes Finance auditable: they publish index pages, so index_diff works here where it
  // cannot for consumer tech. Without them this vertical has no strong coverage check.
  // Remove these rows if you'd rather keep strictly to the doc.
  // ---------------------------------------------------------------------------
  {
    slug: 'meity-releases',
    name: 'MeitY — Press Releases',
    vertical: 'tech',
    sourceType: 'regulator',
    fetchType: 'scrape',
    feedUrl: 'https://www.meity.gov.in/documents/press-release',
    indexUrl: 'https://www.meity.gov.in/documents/press-release',
    auditStrategy: 'index_diff',
    reliabilityWeight: 1.0,
    activeIntervalMin: 60,
    offIntervalMin: 240,
    topics: ['indian-tech-policy', 'dpdp', 'it-rules'],
    ...IST_EXTENDED,
  },
  {
    slug: 'trai-releases',
    name: 'TRAI — Press Releases',
    vertical: 'tech',
    sourceType: 'regulator',
    fetchType: 'scrape',
    feedUrl: 'https://www.trai.gov.in/notifications/press-release',
    indexUrl: 'https://www.trai.gov.in/notifications/press-release',
    // Verified 2026-08-18: releases are PDFs named PR_No<n>of<year>.pdf (30 of 65 links).
    indexLinkPattern: '/PR_No[0-9]+of[0-9]+',
    auditStrategy: 'index_diff',
    reliabilityWeight: 1.0,
    activeIntervalMin: 60,
    offIntervalMin: 240,
    topics: ['telecom', 'indian-tech-policy'],
    ...IST_EXTENDED,
  },
  {
    slug: 'cert-in-advisories',
    name: 'CERT-In — Advisories',
    vertical: 'tech',
    sourceType: 'regulator',
    fetchType: 'scrape',
    // cert-in.org.in is a frameset whose outer document is 447 bytes of <frame> tags and
    // carries no links at all. The real page is the inner servlet below.
    feedUrl: 'https://www.cert-in.org.in/s2cMainServlet?pageid=PUBWEL01',
    indexUrl: 'https://www.cert-in.org.in/s2cMainServlet?pageid=PUBWEL01',
    // Advisories are ?pageid=PUBADV01&CACODE=CICA-YYYY-NNNN. Everything else on the page is
    // a section link (ANTIVRSVIEW, GUIDLNVIEW01, ...), so keying on CACODE is what separates
    // advisories from the site's own navigation.
    indexLinkPattern: 'CACODE=CICA-[0-9]+-[0-9]+',
    auditStrategy: 'index_diff',
    reliabilityWeight: 1.0,
    activeIntervalMin: 120,
    offIntervalMin: 360,
    topics: ['security', 'cve', 'indian-tech-policy'],
    notes:
      'VERIFIED 2026-08-21: the servlet page carries recent advisory links. PUBADVLIST, the ' +
      'apparent "all advisories" page, returns a form rather than a list — it needs a POST ' +
      'with a year, so the homepage is the only usable index for now. That caps us at the ' +
      'recent window; an older advisory published during an outage would not be recovered.',
    ...IST_EXTENDED,
  },
  {
    slug: 'pib-releases',
    name: 'PIB — Press Releases',
    vertical: 'tech',
    sourceType: 'regulator',
    fetchType: 'scrape',
    feedUrl: 'https://www.pib.gov.in/allRel.aspx',
    indexUrl: 'https://www.pib.gov.in/allRel.aspx',
    auditStrategy: 'index_diff',
    reliabilityWeight: 1.0,
    activeIntervalMin: 60,
    offIntervalMin: 240,
    topics: ['indian-tech-policy', 'government'],
    notes: 'Covers all ministries — filter to MeitY/telecom releases at extraction time.',
    ...IST_EXTENDED,
  },
];
