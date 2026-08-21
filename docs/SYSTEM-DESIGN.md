# KnowIt — System Design

Living document. It describes what is built, not what is planned; the roadmap lives in the
plan file.

---

## The one idea

**Coverage completeness is the product.** Missing a story a finance professional needed is
the failure state — not showing them too many. Every architectural decision below follows
from that, and several of them look wrong until you apply it.

The second idea, which constrains the first: we publish **where a claim came from**, never
whether it is true. Claim type (`announced` / `reported` / `rumoured` / `speculated`) plus
a count of independent sources. There is deliberately no `is_confirmed` column anywhere,
and there must never be one — that is a truth score, and we do not publish truth scores.

---

## Stages

```
  ┌─────────────────── apps/worker ───────────────────┐
  │  schedule → fetch → canonicalise → dedup          │
  │           → extract → origin signals → INSERT     │   never touches an LLM
  └───────────────────────┬───────────────────────────┘
                          │ raw_documents
  ┌───────────────────────▼─── apps/web ──────────────┐
  │  /  coverage    /sources  registry   /documents   │
  └───────────────────────────────────────────────────┘
```

Phases 2+ add `apps/enricher` (embed → cluster → LLM → tag) as a **separate process**. It
has a different failure mode — paid API, rate limits, cost — and coupling it to the fetcher
would mean an LLM outage stops ingestion. That would be a coverage gap, which is the one
thing this product cannot have.

---

## Packages

| Path | Contains | Rule |
|---|---|---|
| `packages/core` | URL canonicalisation, timestamp parsing, wire detection, claim-type rules, image selection | **Pure.** No DB, no network. This is where silent bugs live, so it must be testable without infrastructure |
| `packages/db` | Drizzle schema, migrations, the source registry seed | Schema is the interface between both verticals |
| `packages/adapters` | One module per `fetch_type` behind one interface | Independent of `db` so they test against fixtures |
| `apps/worker` | Scheduler, pipeline, extractor, auditor, probe | |
| `apps/web` | Next.js dashboard | Server components, `force-dynamic` |

---

## Ingestion

### Scheduling

`sources.next_fetch_at` is the queue. No separate job table — at this volume that would be
machinery without a purpose.

```sql
SELECT ... WHERE next_fetch_at <= now() AND is_active AND source_kind = 'news'
FOR UPDATE SKIP LOCKED
```

with a five-minute lease, so a crashed worker releases its claim instead of stranding it.

Cadence follows the **publishing calendar, not velocity**: fast during IST business hours
for Finance, slow overnight; Tech inverts to US hours. MOSPI publishes on a fixed public
calendar, RBI on MPC dates — polling those at a constant rate is wasted requests during
the 20 hours a day nothing happens, and too slow during the hour something does.

### Politeness

Per-domain concurrency of 1, with exponential backoff on 429/503. Keyed on **domain, not
source** — several registry rows share a host (three Mint feeds, two CNBC feeds), and a
per-source limiter would let them stampede one publisher.

Politeness is a correctness feature here, not etiquette: a ban is a silent coverage hole.

### Fetch paths

**RSS / Atom** — `rss-parser` normalises RSS 2.0, RDF and Atom into one shape. Conditional
GET with stored `ETag` / `If-Modified-Since`; a 304 costs one round trip and no parsing.

**Scrape** — harvest links from the index page, filter by the source's
`index_link_pattern`. Without a pattern the adapter **refuses to run**. IRDAI's index
yields 122 links of which ~19 are documents; without the pattern the rest are ingested as
news and the auditor reports the entire navigation bar as missing coverage.

Patterns are written **backslash-free** (`[0-9]` not `\d`, `[.]` not `\.`). A `\d` inside a
TypeScript string literal collapses to a bare `d`, silently, and the pattern then matches
nothing.

**HN** — Algolia `search_by_date`. `source_role = 'discovery'`: it points at stories, it
does not report them. Forty HN comments is corroboration of zero. Discovery sources store
`origin_discovery_target_url` and never count toward the independent-source count.

**GitHub** — releases for tracked repos.

### Canonicalisation

One function, `canonicalizeUrl`, at one seam: the pipeline. Adapters return whatever the
publisher gave them and never canonicalise, so URL identity is decided in exactly one
place. It strips tracking params, unwraps Google AMP cache URLs, normalises host case and
trailing slash, and sorts query parameters so ordering cannot mint a second key.

`lowercase_url_path` is **opt-in per source**, for IIS/ASP.NET hosts. RBI links `/Scripts/`
from its index and `/scripts/` from its feed — the same press release, two documents,
and the audit read `0/70 held` when we held 10. It is not global because case-sensitive
publishers do serve distinct articles at paths differing only in case, and merging those
loses one.

### Extraction — order is load-bearing

1. **Collect origin signals from raw HTML.** Wire bylines, outbound links to registry
   primary domains, verbatim quote markers, image metadata.
2. Then extract text with Readability over linkedom.

That order is not stylistic. Those signals exist only in the raw markup and are destroyed
by extraction; the provenance layer two phases out depends on them, and retrofitting means
re-fetching every article we have ever seen. Readability also mutates the DOM it is given,
so signals and text are parsed from two separate documents.

Readability returns **nothing at all** — not a short result — for pages it cannot recognise
as an article, so there is a `plainTextFallback`. Without it a paywalled stub and a
regulator circular page are indistinguishable, and only one of those is a problem.

### Wire detection is per article, not per source

ET carries PTI. Business Standard carries Reuters. A PTI story running in both is
**corroboration of one, not two** — so detection reads the byline and body of each article
rather than a flag on the source.

Skipped entirely for regulators and exchanges: they publish first-party, syndication is
impossible, and scanning can only produce false positives. An RBI notification listing
proscribed organisations matched "ANI" on live data.

### Images

Collected in the same pre-extraction pass, from two tiers:

**Feed**, in preference order — `media:content` (largest by declared width) →
`media:thumbnail` → `<enclosure type="image/*">` → first `<img>` in `content:encoded`.
`rss-parser` drops all of these unless declared in `customFields`, which is why they
appeared absent for the whole of Phase 1.

**Page**, as fallback — `og:image` → `twitter:image` → `link[rel=image_src]` → the largest
declared inline `<img>`. This is what gives TechCrunch, HN and Bleeping Computer an image;
none ship one in the feed.

Validation is pure and unit-tested: absolutise protocol-relative and root-relative URLs,
reject data URIs, reject anything with an unencoded space, reject tracking pixels and
placeholders, reject known-tiny images. Unknown dimensions are **kept** — most feeds omit
them, and rejecting those would discard the majority of real images.

Images are **hotlinked, never re-hosted**. Re-hosting is a copyright posture change; the
consumer feed can proxy at render time when it needs to.

---

## Coverage audit

The number Phase 1 exists to produce. Everything else is plumbing that feeds it.

| Strategy | Sources | How |
|---|---|---|
| `index_diff` | RBI, SEBI, IRDAI, TRAI, CERT-In, MeitY, PIB | Scrape the publisher's own index, canonicalise with **the same function the fetcher uses**, diff |
| `calendar_expect` | MOSPI, RBI MPC | Alarm when a *due* release hasn't arrived — stronger, because it fires before the gap exists |
| `proxy_sample` | Tech | HN as approximate ground truth. Weak, and labelled weak |
| `none` | Outlets, mixed feeds | Nothing authoritative to diff against |

Not scoped to today, deliberately: an index item we never ingested is a miss whenever it
was published, and a date-scoped diff would quietly forgive older gaps.

`error` is a distinct status from `ok`. An auditor that reports no gaps because its scrape
broke is worse than no auditor.

---

## Schema

Five tables. No columns "just in case" — every one is written or read by shipped code.

- **`sources`** — the registry, and the scheduler, in one table. Adding a source is an
  INSERT. This is the moat.
- **`raw_documents`** — canonical `url` UNIQUE is the dedup key. Origin columns captured
  pre-extraction. `text_content` dropped after 7 days, `html_snapshot` after 48h — a
  copyright posture, automated on day one because retention that isn't automated on day
  one never gets automated.
- **`fetch_log`** — every attempt. Powers source health and the under-polling detector.
- **`coverage_audit`** — one row per source per day.
- **`source_errors`** — open problems, resolved automatically on the next success.

`pgvector` was enabled in the first migration even though clustering is Phase 3: enabling
it later is a migration against a populated database.

---

## Known constraints

**Seven publishers reject the bot User-Agent.** BSE, NSE, Business Standard, MoneyControl,
GoodReturns, YourStory, MeitY and PIB answer 403 to `KnowItBot/…` and 200 to a browser
string. The honest `Mozilla/5.0 (compatible; …)` convention is rejected too, so it is
binary: browser string or nothing.

`sources.user_agent` exists to override this per row. It is left unset, and those sources
are left **active and failing**, so the gap stays visible on the dashboard rather than
being quietly papered over. Setting it is a publisher-relations decision, not a technical
one, and it should be made deliberately per source.

**MOSPI is a single-page app.** Its served HTML contains three links, all font CDNs; the
press-release list is fetched client-side. It also fails TLS verification in Node
(`SELF_SIGNED_CERT_IN_CHAIN`) because Node ships its own CA bundle without the Indian
government intermediate — fixable with `NODE_EXTRA_CA_CERTS`. TLS verification is **not**
disabled: a silently spoofable regulator feed is worse than a missing one.

**SEBI's RSS is a mixed feed.** Of 30 items, 26 are enforcement orders and 2 are press
releases. Since SEBI publishes orders many times a day, press releases roll out of the
window within hours. Press releases are therefore scraped from their own listing page, and
the RSS feed is registered separately as `sebi-orders` with `audit_strategy: none`.

**RBI's feed window is 10 items against a 68-item index.** Backfill is not solved; only
items appearing in the feed window while we are polling are captured.
