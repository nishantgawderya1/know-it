# Testing KnowIt

Seven levels, cheapest first. Each catches a failure the level below it cannot.

The thing to understand before any of it: **this product's failure mode is silence.** A
source that returns zero items looks exactly like a quiet news day, a broken auditor looks
exactly like clean coverage, and a feed that stopped shipping images looks fine in every
row count. Most of what follows exists to convert a silence into a number.

---

## 1 · Unit — no network, no database

```bash
npm test                      # everything
npx vitest run packages/core  # one package
npx vitest --watch            # while editing
```

**121 tests across 11 files.** Covers URL canonicalisation, timestamp parsing and
confidence, wire-agency detection, claim-type rules, image selection and validation,
politeness backoff, and scheduler arithmetic.

These are pure functions on purpose. Canonicalisation and timestamp parsing are where
silent coverage bugs live, and they must be testable without infrastructure.

## 2 · Contract — recorded fixtures, still no network

Adapters are tested against saved responses in `packages/adapters/src/__fixtures__/`:

| Fixture | Source | Why it exists |
|---|---|---|
| `media-content.xml` | CNBC TV18, real response | `media:content` with declared dimensions |
| `media-thumbnail.xml` | Business Standard, real response | falls back to `media:thumbnail` |
| `enclosure-and-inline.xml` | hand-written | RSS 2.0 enclosure, `content:encoded`, a tracking pixel that must be rejected, a podcast enclosure that must not be mistaken for a photo, and an item with no image at all |

Two of the three are **real captured responses, not hand-written XML**, and that matters:
`rss-parser` silently drops any element it wasn't configured for, so a hand-written fixture
that "looks right" passes while every live feed returns nothing. That is exactly how images
went missing for the whole of Phase 1.

To refresh a fixture, `curl` the feed, keep the header plus two `<item>` blocks, close the
tags. Keep them small — they are read by humans.

## 3 · Live probe — real network, writes nothing

```bash
npm run probe            # every active news source
npm run probe -- finance # one vertical
npm run probe -- sebi-press-releases
```

**Run this after every registry edit.** It runs the real adapters over the real network
with no database in the loop, and prints per source: HTTP result, item count, how many
items carry a trustworthy date, **image coverage %**, and which feed element supplied the
images.

Then three lists that are the actual point of the command:

- **Endpoints needing correction** — a dead or moved URL, with the error.
- **No feed images** — not an error (HN, NSE, BSE and the regulators legitimately have
  none) but these depend entirely on the page-level `og:image` fallback.
- **Fetched but no reliable timestamps** — quieter, and it becomes a clustering bug two
  phases later.

Exit code is non-zero when any source failed, so it works in CI as a canary.

## 4 · Integration — one real cycle against Supabase

```bash
npm run worker:once             # whatever the scheduler says is due
npm run fetch:one -- <slug>     # exactly one source, ignoring the schedule
```

`fetch:one` is the one to reach for while iterating. `worker:once` claims whatever is due,
which is useless for "did my change to this source work?" — the answer arrives twenty
minutes later buried in an unrelated batch.

Both print `N new / N seen · N img` per source. Then read `/documents` in the dashboard and
look at the rows: extraction status, character counts, detected wire bylines, and the
thumbnails with their source element labelled underneath.

## 5 · Coverage audit — the number Phase 1 exists to produce

```bash
npm run audit
```

Diffs the publisher's own index against what we hold, per source. Three outcomes, and the
distinction between the last two is the entire design:

- `ok` — the index lists nothing we don't hold.
- `gap` — a named list of URLs we are missing. **P0 for a regulator.**
- `error` — *the auditor itself failed.* Deliberately not `ok`. An auditor reporting "no
  gaps" because its scrape broke is worse than no auditor, because it manufactures
  confidence.

An `index_diff` source without an `index_link_pattern` refuses to audit rather than
guessing. Generic link harvesting returns navigation, and every nav link becomes a
fabricated "missing" URL — an auditor that cries wolf gets ignored, which costs the real
miss later.

A gap is not automatically a bug. A newly-added source will show a large gap because the
index lists history and the feed window doesn't: SEBI reads `3/25` on day one and closes
as it runs. What must never happen is a gap on a source that has been running.

## 6 · Under-polling detector

Surfaced on `/` as the `under-polled` health pill. If one fetch ever returned a full feed
window of entirely new items, the feed rolled over between polls and we cannot know what
fell off the end.

Live example worth internalising: **RBI's RSS feed carries 10 items; its index lists 68.**
If RBI publishes 11 press releases between two polls, one is lost permanently. This is why
cadence follows the publishing calendar rather than raw velocity, and why the index diff
exists at all.

## 7 · Manual — the things automation cannot assert

- **PWA install** on a physical iPhone and a physical Android. Not devtools emulation.
- **Ground-truth grade**: the first five days of automated Finance ingest against the
  week-0 manual aggregation list. Every miss becomes a named registry gap.

---

## Testing images specifically

1. `npm test` — the fixture suite covers all five element shapes plus the rejection cases.
2. `npm run probe` — read the `% img` column and the element histogram. **A source that
   drops to 0% has changed its feed shape**; that is the signal to look for, not the
   absolute number.
3. `npm run fetch:one -- <slug>` then `/documents` — see the actual thumbnails.
4. `/` — the `Image` column is a 7-day per-source percentage, and the strip has a 24h
   total.

Current state: **100% of documents ingested since the media work carry a lead image.**
Feed-level coverage is roughly 70% of sources; the page-level `og:image` fallback closes
the rest, which is why sources like Bleeping Computer show 0% at feed level and 100% in
the database.

Image URLs are **hotlinked, never re-hosted** — re-hosting is a copyright posture change.
Widths are stored only when the publisher declares them, so a null width is correct data
rather than a bug; most feeds omit dimensions entirely.

---

## Before you commit

```bash
npm run typecheck && npm test && npm run probe
```

Typecheck and tests must be clean. The probe may report known failures — see the
`notes` field on the affected registry row, which is where the reason lives.
