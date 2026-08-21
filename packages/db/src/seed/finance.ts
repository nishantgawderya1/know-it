/**
 * Finance (India) source registry — the shipping vertical.
 *
 * Taken from the KnowIt sources doc, with three changes made during seeding:
 *
 * 1. `source_kind: 'data'` on AMFI, NSE, RBI DBIE, Yahoo Finance and Alpha Vantage. Those
 *    return numbers, not articles — there is no text to extract, so the news pipeline
 *    cannot process them. They are registered and inactive until the Phase 3 enrichment
 *    layer exists.
 * 2. Regulators and exchanges carry `reliabilityWeight: 1.0`, as the doc instructs.
 * 3. Broad outlets are marked for section-feed resolution. `rssfeedsdefault.cms` is ET's
 *    site-wide feed and carries sport and lifestyle alongside markets.
 *
 * Endpoints are as supplied in the doc. The first full run verifies them — a wrong URL
 * surfaces as a loud fetch error against one row, and fixing it is an UPDATE.
 */

import { IST_BUSINESS, IST_EXTENDED, type SeedSource } from './types.js';

export const financeSources: SeedSource[] = [
  // ---------------------------------------------------------------------------
  // Primary sources. These are the anchor of the vertical: they are what a reader
  // cannot afford to miss, they are `announced` by definition, and they are the
  // origin-trace root that makes the independent-source count honest.
  // ---------------------------------------------------------------------------
  {
    slug: 'rbi-press-releases',
    name: 'RBI — Press Releases',
    vertical: 'finance',
    sourceType: 'regulator',
    fetchType: 'rss',
    feedUrl: 'https://www.rbi.org.in/pressreleases_rss.xml',
    indexUrl: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx',
    // Verified 2026-08-18: 70 of 86 links on the index carry prid=; the rest are navigation.
    indexLinkPattern: 'prid=[0-9]+',
    // ASP.NET host: the index links /Scripts/ while the RSS feed links /scripts/.
    lowercaseUrlPath: true,
    auditStrategy: 'index_diff',
    reliabilityWeight: 1.0,
    activeIntervalMin: 5,
    offIntervalMin: 60,
    topics: ['monetary-policy', 'inflation', 'banking', 'forex'],
    notes: 'Most reliable single source for India macro. MPC outcomes land on a known calendar.',
    ...IST_BUSINESS,
  },
  {
    slug: 'rbi-notifications',
    name: 'RBI — Notifications',
    vertical: 'finance',
    sourceType: 'regulator',
    fetchType: 'rss',
    feedUrl: 'https://www.rbi.org.in/notifications_rss.xml',
    indexUrl: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx',
    // Verified from ingested URLs: NotificationUser.aspx?Id=13668&Mode=0
    indexLinkPattern: 'NotificationUser[.]aspx[?].*Id=[0-9]+',
    // ASP.NET host: the index links /Scripts/ while the RSS feed links /scripts/.
    lowercaseUrlPath: true,
    auditStrategy: 'index_diff',
    reliabilityWeight: 1.0,
    activeIntervalMin: 10,
    offIntervalMin: 120,
    topics: ['banking', 'regulation', 'monetary-policy'],
    ...IST_BUSINESS,
  },
  {
    slug: 'rbi-speeches',
    name: 'RBI — Speeches',
    vertical: 'finance',
    sourceType: 'regulator',
    fetchType: 'rss',
    feedUrl: 'https://www.rbi.org.in/speeches_rss.xml',
    // Same IIS path-casing problem as the other RBI feeds: the index links /Scripts/ and
    // the feed links /scripts/, and without this the same speech is two documents.
    lowercaseUrlPath: true,
    // No stable index page for speeches, so nothing to diff against.
    auditStrategy: 'none',
    reliabilityWeight: 1.0,
    activeIntervalMin: 30,
    offIntervalMin: 240,
    topics: ['monetary-policy', 'banking', 'regulation'],
    notes:
      'VERIFIED 2026-08-21: 10 items. Governor and Deputy Governor speeches routinely move ' +
      'rate expectations before any press release exists, so this is a leading signal rather ' +
      'than a duplicate of pressreleases_rss.xml.',
    ...IST_BUSINESS,
  },
  {
    slug: 'sebi-press-releases',
    name: 'SEBI — Press Releases',
    vertical: 'finance',
    sourceType: 'regulator',
    // Scrape, not RSS. sebirss.xml is SEBI's *combined* latest feed: of 30 items, 26 were
    // enforcement orders and recovery proceedings and only 2 were press releases. SEBI
    // publishes orders many times a day, so press releases are pushed out of the feed
    // window within hours — a silent coverage gap on a regulator, which is the single
    // worst failure this registry can have. The listing page below is press-releases-only.
    fetchType: 'scrape',
    feedUrl:
      'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=6&ssid=23&smid=0',
    indexUrl:
      'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=6&ssid=23&smid=0',
    // Verified 2026-08-21: 25 links, all under /media-and-notifications/press-releases/.
    // Scoped to that path deliberately — a bare `_[0-9]+[.]html$` also matches the master
    // circulars and enforcement orders that SEBI links from its chrome on every page.
    indexLinkPattern: 'media-and-notifications/press-releases/.*_[0-9]+[.]html$',
    auditStrategy: 'index_diff',
    reliabilityWeight: 1.0,
    activeIntervalMin: 10,
    offIntervalMin: 120,
    topics: ['sebi', 'regulation', 'markets', 'ipo', 'mutual-funds'],
    notes:
      'High signal, very low noise. VERIFIED 2026-08-21: the old indexUrl (pressreleases.html) ' +
      '404s, which is why the auditor reported `error`. No parseable date on these pages — ' +
      'documents fall back to fetch time at low confidence, so time-decay clustering must ' +
      'not lean on published_at for this source.',
    ...IST_BUSINESS,
  },
  {
    slug: 'sebi-orders',
    name: 'SEBI — Orders & Enforcement',
    vertical: 'finance',
    sourceType: 'regulator',
    fetchType: 'rss',
    feedUrl: 'https://www.sebi.gov.in/sebirss.xml',
    // Unauditable on purpose: this is a mixed "latest across all sections" feed with no
    // corresponding index page, so there is nothing to diff it against. Press releases are
    // audited on their own row above.
    auditStrategy: 'none',
    reliabilityWeight: 1.0,
    activeIntervalMin: 20,
    offIntervalMin: 180,
    topics: ['sebi', 'regulation', 'enforcement'],
    notes:
      'VERIFIED 2026-08-21: 30 items — 13 recovery proceedings, 13 orders, 2 circulars, ' +
      '2 press releases. Enforcement actions against named entities are genuinely news, ' +
      'so this feed is kept; it simply cannot serve as the press-release source.',
    ...IST_BUSINESS,
  },
  {
    slug: 'irdai-press-releases',
    name: 'IRDAI — Press Releases',
    vertical: 'finance',
    sourceType: 'regulator',
    fetchType: 'scrape',
    feedUrl: 'https://irdai.gov.in/press-releases',
    indexUrl: 'https://irdai.gov.in/press-releases',
    // Verified 2026-08-18: the index yields 122 links, of which only ~38 are documents
    // (/document-detail?documentId=N). The rest are section pages like /about-consumer-affairs,
    // which the first run ingested as news before this pattern existed.
    indexLinkPattern: 'documentId=[0-9]+',
    auditStrategy: 'index_diff',
    reliabilityWeight: 1.0,
    activeIntervalMin: 60,
    offIntervalMin: 240,
    topics: ['insurance', 'regulation'],
    notes: 'No RSS — scraper required. Infrequent, so a slow poll is fine. URL verified 2026-08-18.',
    ...IST_BUSINESS,
  },
  {
    slug: 'mospi-releases',
    name: 'MOSPI — Data Releases',
    vertical: 'finance',
    sourceType: 'regulator',
    fetchType: 'scrape',
    feedUrl: 'https://www.mospi.gov.in/press-release',
    indexUrl: 'https://www.mospi.gov.in/press-release',
    // Publishes on a fixed public calendar, so we can alarm on a *due* release that
    // hasn't arrived rather than noticing the gap the next day.
    auditStrategy: 'calendar_expect',
    reliabilityWeight: 1.0,
    activeIntervalMin: 30,
    offIntervalMin: 240,
    topics: ['gdp', 'cpi', 'iip', 'inflation'],
    isActive: false,
    notes:
      'DEACTIVATED 2026-08-21 — not scrapeable as built. GDP, CPI and IIP land on a published ' +
      'schedule, so this is a source we want. Two separate blockers: (1) the page is a Vite ' +
      'single-page app (/assets/index-*.js) whose press-release list is fetched client-side, ' +
      'so the served HTML contains three links and all three are font CDNs — there is no index ' +
      'to diff and no pattern that would help; (2) SELF_SIGNED_CERT_IN_CHAIN in Node, because ' +
      'Node ships its own CA bundle and lacks the Indian government intermediate that the OS ' +
      'trust store has. Fix (2) with NODE_EXTRA_CA_CERTS; fix (1) by finding the JSON endpoint ' +
      'the bundle calls. Do NOT disable TLS verification: a silently spoofable regulator feed ' +
      'is worse than a missing one. Left inactive rather than active-and-failing because the ' +
      '"no index_link_pattern" error it produced was misleading about the real cause.',
    ...IST_BUSINESS,
  },
  {
    slug: 'finmin-releases',
    name: 'Ministry of Finance',
    vertical: 'finance',
    sourceType: 'regulator',
    fetchType: 'scrape',
    feedUrl: 'https://finmin.nic.in',
    indexUrl: 'https://finmin.nic.in',
    isActive: false,
    auditStrategy: 'index_diff',
    reliabilityWeight: 1.0,
    activeIntervalMin: 60,
    offIntervalMin: 240,
    topics: ['budget', 'schemes', 'fiscal-policy', 'fdi'],
    notes:
      'DEACTIVATED 2026-08-18: finmin.nic.in does not resolve — the domain in the sources doc ' +
      'is dead. Ministry of Finance releases are carried by PIB, so either point this row at ' +
      'the PIB finance-ministry listing or find the current ministry domain. High importance ' +
      'when it publishes, so this is a real coverage hole, not a nice-to-have.',
    ...IST_BUSINESS,
  },
  {
    slug: 'bse-announcements',
    name: 'BSE — Corporate Announcements',
    vertical: 'finance',
    sourceType: 'exchange',
    // XML feed rather than the HTML scrape: same data, no page-shape brittleness, and it
    // removes one of the four Finance scrapers flagged as the registry's most fragile part.
    fetchType: 'rss',
    feedUrl: 'https://beta.bseindia.com/data/xml/announcements.xml',
    // Unauditable: the feed IS the index, so diffing it against ourselves proves nothing.
    auditStrategy: 'none',
    reliabilityWeight: 1.0,
    activeIntervalMin: 15,
    offIntervalMin: 180,
    topics: ['corporate-filings', 'earnings', 'ipo'],
    notes:
      'VERIFIED 2026-08-21: 8,186 items on the beta XML endpoint — a full dump rather than a ' +
      'rolling window, so the first successful fetch will be very large. STILL BLOCKED: 403 to ' +
      'the bot User-Agent, 200 to a browser one; the `Mozilla/5.0 (compatible; ...)` convention ' +
      'is rejected too. Left active and failing so the gap stays visible. Set `userAgent` on ' +
      'this row to a browser string to ingest it — a publisher-relations decision, not a ' +
      'technical one.',
    ...IST_BUSINESS,
  },

  // ---------------------------------------------------------------------------
  // Outlets. Corroboration, not the primary signal.
  //
  // The doc recommends ET and Business Standard precisely because they carry PTI and
  // Reuters syndication — which is why wire detection runs per article. Two outlets
  // running the same wire story is corroboration of one.
  // ---------------------------------------------------------------------------
  {
    slug: 'economic-times',
    name: 'Economic Times',
    vertical: 'finance',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://economictimes.indiatimes.com/rssfeedsdefault.cms',
    reliabilityWeight: 0.7,
    activeIntervalMin: 10,
    offIntervalMin: 60,
    topics: ['markets', 'economy', 'policy', 'banking'],
    notes:
      'NEEDS SECTION FEEDS. This is the site-wide default and carries sport and lifestyle. ' +
      'Replace with markets/economy/policy section feeds before trusting volume figures. ' +
      'Carries PTI syndication — wire detection runs per article.',
    ...IST_EXTENDED,
  },
  {
    slug: 'livemint',
    name: 'Mint',
    vertical: 'finance',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.livemint.com/rss/news',
    reliabilityWeight: 0.75,
    activeIntervalMin: 10,
    offIntervalMin: 60,
    topics: ['economy', 'markets', 'personal-finance'],
    notes: 'Analysis layer on top of raw data events. Carries Reuters content.',
    ...IST_EXTENDED,
  },
  {
    slug: 'business-standard',
    name: 'Business Standard',
    vertical: 'finance',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.business-standard.com/rss/latest.rss',
    reliabilityWeight: 0.75,
    activeIntervalMin: 10,
    offIntervalMin: 60,
    topics: ['business', 'economy', 'policy'],
    notes:
      'Carries Reuters content — a free substitute for the paid wire, per the doc. ' +
      'VERIFIED 2026-08-18: returns 403 to the bot User-Agent and 200 to a browser one. The `Mozilla/5.0 (compatible; ...)` convention is rejected too. Left active and failing so the gap stays visible: set `userAgent` on this row to a browser string to ingest it. That is a publisher-relations decision, not a technical one.',
    ...IST_EXTENDED,
  },
  {
    slug: 'financial-express',
    name: 'Financial Express',
    vertical: 'finance',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.financialexpress.com/feed/',
    isActive: false,
    reliabilityWeight: 0.7,
    activeIntervalMin: 15,
    offIntervalMin: 90,
    topics: ['markets', 'economy', 'policy', 'banking'],
    notes:
      'DEACTIVATED 2026-08-18: /feed/ returns HTTP 410 Gone, and the section paths ' +
      '(/market/feed/, /economy/feed/) return HTML rather than RSS. Needs a working feed URL ' +
      'from the publisher before it can be re-enabled.',
    ...IST_EXTENDED,
  },
  {
    slug: 'moneycontrol',
    name: 'MoneyControl',
    vertical: 'finance',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.moneycontrol.com/rss/latestnews.xml',
    reliabilityWeight: 0.7,
    activeIntervalMin: 10,
    offIntervalMin: 60,
    topics: ['stocks', 'mutual-funds', 'ipo', 'personal-finance'],
    notes:
      'Best for retail-facing finance and IPO tracking. Per-category feeds exist ' +
      '(economy, mfnews, iponews) — prefer those over latestnews. ' +
      'VERIFIED 2026-08-18: returns 403 to the bot User-Agent and 200 to a browser one. The `Mozilla/5.0 (compatible; ...)` convention is rejected too. Left active and failing so the gap stays visible: set `userAgent` on this row to a browser string to ingest it. That is a publisher-relations decision, not a technical one.',
    ...IST_EXTENDED,
  },
  {
    slug: 'bq-prime',
    name: 'BQ Prime',
    vertical: 'finance',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.ndtvprofit.com/feeds',
    isActive: false,
    reliabilityWeight: 0.75,
    activeIntervalMin: 15,
    offIntervalMin: 90,
    topics: ['markets', 'economy', 'earnings'],
    notes:
      'DEACTIVATED 2026-08-18: BQ Prime has been rebranded NDTV Profit — bqprime.com/feeds ' +
      '301s to ndtvprofit.com/feeds, which returns 403 even to a browser User-Agent. ' +
      'Needs a supported feed path before re-enabling.',
    ...IST_EXTENDED,
  },
  {
    slug: 'cnbc-tv18-markets',
    name: 'CNBC TV18 — Markets',
    vertical: 'finance',
    sourceType: 'outlet',
    fetchType: 'rss',
    // REACTIVATED 2026-08-21: the path segment is `cne`, not `eng`. That single character
    // was the whole of the HTTP 400 that took this source offline.
    feedUrl: 'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml',
    reliabilityWeight: 0.7,
    activeIntervalMin: 10,
    offIntervalMin: 60,
    topics: ['markets', 'stocks', 'breaking'],
    notes:
      'VERIFIED 2026-08-21: 200 items, every one carrying a 1200x675 media:content image. ' +
      'The largest single feed in the Finance registry.',
    ...IST_EXTENDED,
  },
  {
    slug: 'cnbc-tv18-economy',
    name: 'CNBC TV18 — Economy',
    vertical: 'finance',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/economy.xml',
    reliabilityWeight: 0.7,
    activeIntervalMin: 15,
    offIntervalMin: 90,
    topics: ['economy', 'policy', 'macro'],
    notes: 'VERIFIED 2026-08-21: 200 items with media:content images.',
    ...IST_EXTENDED,
  },
  {
    slug: 'hindu-businessline',
    name: 'Hindu BusinessLine',
    vertical: 'finance',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.thehindubusinessline.com/feeder/default.rss',
    reliabilityWeight: 0.75,
    activeIntervalMin: 20,
    offIntervalMin: 120,
    topics: ['policy', 'agri-economy', 'business'],
    ...IST_EXTENDED,
  },
  {
    slug: 'goodreturns',
    name: 'GoodReturns',
    vertical: 'finance',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.goodreturns.in/rss/news-fb.xml',
    reliabilityWeight: 0.6,
    activeIntervalMin: 30,
    offIntervalMin: 180,
    topics: ['ipo', 'mutual-funds', 'gold', 'personal-finance'],
    notes: 'Niche. Useful for IPO grey market price and retail finance data. Feed URL corrected and verified 2026-08-18 (the doc URL 404s).',
    ...IST_EXTENDED,
  },

  // ---------------------------------------------------------------------------
  // Market-data APIs. Registered so the registry is complete, INACTIVE because they
  // return numbers rather than articles and cannot pass through the news pipeline.
  // A NAV figure is not a story until it moves. Revisit in Phase 3.
  // ---------------------------------------------------------------------------
  {
    slug: 'amfi-mfapi',
    name: 'AMFI — NAV / AUM (mfapi)',
    vertical: 'finance',
    sourceKind: 'data',
    sourceType: 'industry_body',
    fetchType: 'json_api',
    feedUrl: 'https://api.mfapi.in',
    auditStrategy: 'none',
    reliabilityWeight: 1.0,
    isActive: false,
    topics: ['mutual-funds', 'aum', 'nav', 'sip'],
    notes: 'Free REST, no key. Scheme-level NAV and history. Enrichment layer, not news.',
  },
  {
    slug: 'nse-india',
    name: 'NSE India — IPOs & Corporate Actions',
    vertical: 'finance',
    sourceKind: 'data',
    sourceType: 'exchange',
    fetchType: 'json_api',
    feedUrl: 'https://www.nseindia.com/api',
    auditStrategy: 'none',
    reliabilityWeight: 1.0,
    isActive: false,
    topics: ['ipo', 'corporate-actions', 'indices'],
    notes:
      'Unofficial API. Requires a browser-cookie handshake and blocks datacenter IPs, so it ' +
      'will likely fail from Fly. Superseded for news purposes by nse-corporate-actions ' +
      'below, which is a plain RSS feed; this row stays registered for the quote/index ' +
      'numbers it alone can provide, and stays inactive until Phase 3 needs them.',
  },
  {
    slug: 'rbi-dbie',
    name: 'RBI DBIE — Macro Time Series',
    vertical: 'finance',
    sourceKind: 'data',
    sourceType: 'regulator',
    fetchType: 'json_api',
    feedUrl: 'https://dbie.rbi.org.in',
    auditStrategy: 'none',
    reliabilityWeight: 1.0,
    isActive: false,
    topics: ['macro', 'gdp', 'inflation', 'forex'],
    notes: 'Structured historical macro data. Enrichment layer.',
  },
  {
    slug: 'yahoo-finance',
    name: 'Yahoo Finance — OHLCV',
    vertical: 'finance',
    sourceKind: 'data',
    sourceType: 'industry_body',
    fetchType: 'json_api',
    feedUrl: 'https://query1.finance.yahoo.com',
    auditStrategy: 'none',
    reliabilityWeight: 0.6,
    isActive: false,
    topics: ['stocks', 'forex', 'indices'],
    notes:
      'The doc specifies the yfinance Python library; this repo is all-TypeScript. Either ' +
      'call the underlying HTTP endpoint or accept a small Python service. Decide in Phase 3.',
  },
  {
    slug: 'alpha-vantage',
    name: 'Alpha Vantage — Forex & Equities',
    vertical: 'finance',
    sourceKind: 'data',
    sourceType: 'industry_body',
    fetchType: 'json_api',
    feedUrl: 'https://www.alphavantage.co/query',
    auditStrategy: 'none',
    reliabilityWeight: 0.6,
    isActive: false,
    topics: ['forex', 'stocks', 'macro'],
    notes: 'Free tier is 25 requests/day — not viable as a feed. Enrichment only.',
  },

  // ---------------------------------------------------------------------------
  // Added 2026-08-21 after live verification. Section feeds replace site-wide ones:
  // the site-wide feed is where sport and lifestyle enter a finance vertical, and no
  // amount of downstream filtering is as cheap as not fetching them.
  // ---------------------------------------------------------------------------
  {
    slug: 'nse-corporate-actions',
    name: 'NSE — Corporate Actions',
    vertical: 'finance',
    sourceType: 'exchange',
    fetchType: 'rss',
    // Plain RSS on the archives host — no cookie handshake, unlike www.nseindia.com/api.
    feedUrl: 'https://nsearchives.nseindia.com/content/RSS/Corporate_action.xml',
    auditStrategy: 'none',
    reliabilityWeight: 1.0,
    activeIntervalMin: 30,
    offIntervalMin: 240,
    topics: ['corporate-actions', 'dividends', 'splits'],
    notes:
      'VERIFIED 2026-08-21: 77 items. Like BSE, this host answers 403 to the bot ' +
      'User-Agent and 200 to a browser one — set `userAgent` here to ingest it.',
    ...IST_BUSINESS,
  },
  {
    slug: 'livemint-markets',
    name: 'Mint — Markets',
    vertical: 'finance',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.livemint.com/rss/markets',
    reliabilityWeight: 0.75,
    activeIntervalMin: 10,
    offIntervalMin: 60,
    topics: ['markets', 'stocks'],
    notes:
      'VERIFIED 2026-08-21: 35 items, all with media:content images. Carries Reuters, AFP, ' +
      'ANI, PTI and Bloomberg syndication — 15 of 35 on the sitewide feed were wire copy, ' +
      'so wire detection is load-bearing here.',
    ...IST_EXTENDED,
  },
  {
    slug: 'business-standard-markets',
    name: 'Business Standard — Markets',
    vertical: 'finance',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.business-standard.com/rss/markets-106.rss',
    reliabilityWeight: 0.75,
    activeIntervalMin: 10,
    offIntervalMin: 60,
    topics: ['markets', 'stocks'],
    notes:
      'VERIFIED 2026-08-21: 35 items with a mix of media:content and media:thumbnail. ' +
      '403 to the bot User-Agent — same browser-UA decision as BSE and NSE.',
    ...IST_EXTENDED,
  },
  {
    slug: 'hindu-businessline-markets',
    name: 'Hindu BusinessLine — Markets',
    vertical: 'finance',
    sourceType: 'outlet',
    fetchType: 'rss',
    feedUrl: 'https://www.thehindubusinessline.com/markets/feeder/default.rss',
    reliabilityWeight: 0.75,
    activeIntervalMin: 15,
    offIntervalMin: 90,
    topics: ['markets', 'commodities'],
    notes:
      'VERIFIED 2026-08-21: 60 items, 59 with media:content. Heavy wire syndication ' +
      '(14 of 60 on the sitewide feed).',
    ...IST_EXTENDED,
  },
];
