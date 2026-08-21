# KnowIt

Provenance-first news aggregation for domain professionals.

## What this is

Most news products solve *volume reduction* — showing you 30 of 2,000 stories. That's the right problem when the ratio is 60:1. A single professional niche produces maybe 12 genuinely new stories a day and the reader wants 8, so at 1.5:1 a sophisticated recommender is indistinguishable from reverse-chronological order.

KnowIt solves a different problem. For someone whose standing depends on being current in one field, **missing one story is the failure state**. That's a recall problem, not a precision problem, and it makes the product promise:

> You will not miss anything that mattered in your field today, and you will know where each claim came from.

Two consequences shape everything in this repo:

- **Coverage completeness is the metric**, not engagement. The question we measure is "what did we miss," and the number that matters is "what did you stop checking."
- **We never publish a truth score.** Automated factuality is unsolved, and a confident wrong score transfers a source's error onto us. We publish *provenance* — where a claim originated, how many genuinely independent outlets carry it, and whether it was announced, reported, rumoured, or speculated. The reader judges.

## Provenance model

Every story carries two things:

| Field | Values |
|---|---|
| `claim_type` | `announced` · `reported` · `rumoured` · `speculated` |
| independent source count | count of genuinely independent sources of record |

Claim type is derived **deterministically from the source registry**, not from a model. A SEBI circular is `announced` because SEBI published it; an outlet story attributed to "people familiar with the matter" is `rumoured`. This keeps the product's highest-risk judgment in code we can test and debug.

> **There is deliberately no `is_confirmed` boolean anywhere in this codebase.** A confirmed/unconfirmed badge is a truth score wearing a different hat. If you find yourself adding one, that's the bug.

Two rules make the independent count honest:

- **Wire syndication is detected per article, not per source.** Economic Times and Business Standard both republish PTI and Reuters copy. The same wire story in both is corroboration of *one*, not two — so we detect the wire byline on each article rather than flagging whole outlets.
- **Discovery sources never corroborate.** Hacker News points at stories; it doesn't independently confirm them. Forty HN comments is corroboration of zero. Discovery sources record the URL they point at and are excluded from the count.

## Verticals

**Finance (India)** ships first, alone. It was chosen because regulators — RBI, SEBI, IRDAI, MOSPI, Ministry of Finance — publish machine-readable feeds *and* index pages, which makes both provenance and coverage measurable rather than judgmental.

**Tech** runs in **shadow mode**: real fetching, real coverage measurement, no editorial review and no user-facing surface. It costs almost nothing and it tests whether the engine generalises across differently-shaped sources. It does not gate the phase.

## Repo layout

```
apps/web              Next.js 14 (App Router) — PWA shell + coverage dashboard
apps/worker           Scheduler, fetch adapters, extractor, coverage auditor
packages/core         Pure logic: URL canonicalisation, timestamps, origin signals,
                      claim-type rules. No DB, no network — unit-tested in isolation.
packages/adapters     One module per fetch type behind a common interface
packages/db           Drizzle schema, migrations, source registry seed
supabase/migrations   Generated SQL migrations
docs/                 SYSTEM-DESIGN.md — architecture and the reasoning behind it
                      TESTING.md      — the seven test levels, with commands
```

`packages/core` is deliberately pure. URL canonicalisation and timestamp parsing are where silent coverage bugs live, and they must be testable without infrastructure.

## Setup

Requires Node 20+ (developed on 24).

```bash
npm install
cp .env.example .env     # fill in DATABASE_URL and DIRECT_DATABASE_URL
npm run db:migrate       # apply schema
npm run db:seed          # load the source registry
```

Then:

```bash
npm run probe            # verify every registry endpoint live — no DB, no writes
npm run fetch:one -- rbi-press-releases   # one source, ignoring the schedule
npm run worker:once      # one scheduler tick — good for a first smoke test
npm run worker           # continuous
npm run audit            # coverage audit: diff publisher indexes against what we hold
npm run web              # dashboard at http://localhost:3000
npm test                 # unit + adapter contract tests
```

`npm run probe` is the one to run after any registry edit — it prints per-source HTTP
status, item counts, timestamp quality and image coverage without touching the database.
See `docs/TESTING.md`.

You need a Supabase project with the `pgvector` extension enabled. **Turn on database backups before any real data lands.**

## The source registry

The registry is data, not code. It lives in `packages/db/src/seed/` — one file per vertical — and every source is a row describing how to fetch it, how often, what kind of source it is, and how its coverage is audited.

Adding a source is an INSERT. Adding a *kind* of source is one module in `packages/adapters`.

Key columns:

| Column | Why it matters |
|---|---|
| `source_kind` | `news` \| `data`. Market-data APIs (AMFI, NSE, Alpha Vantage) return numbers, not articles — they can't go through the news pipeline and are inactive until the enrichment layer exists. |
| `source_type` | Drives claim type deterministically (`regulator` → `announced`). |
| `source_role` | `record` \| `discovery`. Discovery sources never count toward corroboration. |
| `audit_strategy` | How we check we didn't miss anything — see below. |
| `reliability_weight` | Regulators and exchanges are 1.0. |

Broad outlets are registered as **section feeds**, never site-wide defaults. `economictimes.indiatimes.com/rssfeedsdefault.cms` carries sport and lifestyle alongside markets; subscribing to sections is what keeps junk out of the pipeline without paying a model to reject it later.

## Coverage auditing

The engine measures its own completeness daily, per source:

- **`index_diff`** — regulators publish an index of everything they released. Scrape it, diff against what we hold. A gap is a P0 alarm.
- **`calendar_expect`** — MOSPI and RBI MPC publish on fixed public calendars, so we can alarm when a *due* release hasn't arrived rather than noticing afterwards.
- **`proxy_sample`** — Tech has no authority enumerating the day, so HN acts as weak proxy ground truth. Labelled as weaker in the dashboard, because it is.
- **`none`** — outlets, which nobody indexes.

An auditor that fails to parse must fail *loudly*. One reporting "no gaps" because its scrape broke is worse than no auditor at all.

## Current status

**Phase 1 — ingestion engine.** Built; accumulating the seven-day coverage record.

Built: source registry (56 sources), five fetch adapters, conditional GET, per-domain
politeness, content extraction with pre-extraction origin-signal capture, per-article wire
detection, lead-image extraction from feed and page, coverage auditing, retention, and the
coverage dashboard at `/`, `/sources` and `/documents`.

Deliberately not built yet: embeddings, clustering, any LLM call, entity extraction, the consumer feed, auth, digests.

**Exit criterion:** seven consecutive days with zero unexplained Finance coverage gaps. Not "the fetcher works" — that number is what unblocks clustering and editorial.
