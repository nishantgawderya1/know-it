# Runbook

Operating the fetcher. Written for the person on call at 2am, so it leads with what to do
rather than how it works — the reasoning lives in `SYSTEM-DESIGN.md`.

---

## Deploy

### Worker → GitHub Actions (current)

The fetcher runs as a scheduled workflow rather than an always-on daemon, because Fly
requires a payment method and Actions is free and unlimited on a public repo.

- `.github/workflows/fetch.yml` — every 15 minutes, runs `worker:once`
- `.github/workflows/audit.yml` — daily at 02:30 UTC (08:00 IST), runs the coverage audit

**Setup is one secret.** Repo → Settings → Secrets and variables → Actions → New secret:

```
Name:  DATABASE_URL
Value: postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Then Actions → Fetch → *Run workflow* to confirm it works without waiting for the cron.

**Two limitations to hold in mind:**

1. GitHub delays scheduled workflows under load, sometimes 15–30 minutes. Under-polling is
   exactly what Phase 1 measures, so an `under-polled` pill on the dashboard may be a
   hosting artefact rather than a registry gap. Check the actual run times in the Actions
   tab before recording it as a coverage failure.
2. Scheduled workflows are **disabled automatically after 60 days without repo activity**.
   A commit resets the clock; silence stops the fetcher without an alarm.

Neither applies to the Fly setup below, which stays committed and ready.

### Worker → Fly.io (available, not in use)

```bash
fly auth login
fly launch --no-deploy --copy-config      # reads fly.toml; creates the app

fly secrets set \
  DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
  GITHUB_TOKEN="<token>"

fly deploy
fly logs
```

**Use the pooler URL, not the direct host.** `db.<ref>.supabase.co` is IPv6-only — it
publishes an AAAA record and no A record. That works from a laptop and fails with
`ENOTFOUND` in a container. It is the single most likely reason a deploy that passed every
local test comes up dead.

`DIRECT_DATABASE_URL` is deliberately **not** a Fly secret. Migrations run from a developer
machine, and the worker has no business holding a credential that can run DDL.

Verify the image locally before deploying — it takes a minute and catches the environment
problems that Fly logs describe badly:

```bash
docker build -f apps/worker/Dockerfile -t knowit-worker .
docker run --rm --env-file .env -e WORKER_BATCH_SIZE=2 knowit-worker
```

A healthy first minute looks like:

```
worker up · batch=2 · tick=30000ms · 13 primary domains
tick · 2 sources · 50 new documents · 1 failed
retention · cleared text on 0 rows, html on 119
audit 2026-08-21 · 9 sources · 6 with gaps · 2 auditor failures
```

### Web → Vercel

Root directory `apps/web`, environment variable `DATABASE_URL` (the same pooler URL), and
**deployment protection on** — there is no auth in Phase 1 and the dashboard exposes the
whole registry.

### Migrations

Never from the worker. From a developer machine:

```bash
npm run db:generate    # after editing packages/db/src/schema.ts
npm run db:migrate     # applies via DIRECT_DATABASE_URL
npm run db:seed        # idempotent; preserves next_fetch_at, etags, fetch history
```

---

## The alarms

### A regulator shows a coverage gap

`GAP  rbi-press-releases  10/68 held` in the daily audit line, or a row on `/`.

1. Read the named missing URLs — the audit prints them, and a gap you cannot name is not
   actionable.
2. **Is this a new source?** A source added yesterday will show a large gap, because the
   index lists history while the feed window does not. SEBI read 3/25 on day one. That is
   expected and closes as it runs.
3. **Did the URL scheme change?** If the missing URLs look structurally different from the
   ones we hold, the publisher changed their paths. Fix `index_link_pattern`, or
   `lowercase_url_path` if the only difference is case.
4. **Is the feed window too small?** RBI ships 10 items against a 68-item index. If it
   publishes 11 between polls, one is lost permanently. Lower `active_interval_min`.

### An auditor failed

`ERROR meity-releases  ... HTTP 403`. This proves *nothing about coverage either way* —
it is the auditor that broke, not necessarily the source. Never read it as clean.

Common causes: the index page moved (fix `index_url`), the layout changed so
`index_link_pattern` matches nothing, or the publisher blocks the bot User-Agent.

### A source is failing

Check `/` for the `failing` pill and the last error, then reproduce in isolation:

```bash
npm run fetch:one -- <slug>     # one source, ignoring the schedule
npm run probe -- <slug>         # no database, no writes
```

| Error | Meaning | Fix |
|---|---|---|
| `http 403` | Publisher blocks the bot UA | A deferred decision — see below |
| `http 404` | Feed moved | Find the new URL, edit the seed, re-seed |
| `parse` | Feed replaced by an HTML page | Rediscover the endpoint |
| `no-pattern` | `scrape` source without `index_link_pattern` | Add one, or the source ingests navigation as news |
| `SELF_SIGNED_CERT_IN_CHAIN` | Node's CA bundle lacks the intermediate | `NODE_EXTRA_CA_CERTS` — **never** disable TLS verification on a regulator |
| `ENOTFOUND` on the DB host | Using the direct URL from a container | Switch to the pooler |

### A source goes quiet without erroring

The worst failure mode, because nothing alarms. Watch the `stale` pill on `/` (no fetch in
2× its interval) and the `under-polled` pill (a full feed window came back entirely new,
so items rolled off the end unseen).

---

## Deferred decisions

**Six Finance sources are dark by choice.** MoneyControl, Business Standard (both the
site-wide and markets feeds), BSE, GoodReturns and NSE reject any non-browser User-Agent —
403, or a hanging connection in NSE's case — including the honest
`Mozilla/5.0 (compatible; KnowItBot…)` convention. `sources.user_agent` overrides it per
row and is deliberately left unset.

They are left **active and failing** so the gap stays visible rather than being papered
over. Do not set a browser UA without an explicit decision — it is a publisher-relations
posture, not a bug.

Phase 1 therefore ships at **13 of 19 Finance sources**, and the seven-day coverage number
must be read with that caveat attached: it is measured against roughly two thirds of the
intended registry, so it understates real-world difficulty.

Three Tech sources are dark for the same reason (MeitY, PIB, YourStory). Tech is shadow
mode and does not gate, so this is recorded rather than acted on.

**MOSPI is deactivated.** Its press-release list is fetched client-side by a Vite bundle,
so the served HTML has three links and all three are font CDNs. Reactivating it needs the
JSON endpoint the bundle calls, plus `NODE_EXTRA_CA_CERTS`.

---

## Routine maintenance

| When | Do |
|---|---|
| After any registry edit | `npm run probe` — verifies every endpoint, writes nothing |
| After changing a canonicalisation rule | `npm run dedupe:legacy` — removes rows stored under the old rule |
| Weekly | Read `/` — stale, under-polled, and image-% columns |
| On a schema change | `db:generate` → review the SQL → `db:migrate` |

`dedupe:legacy` compares the **path only**. An earlier version compared the whole URL,
decided every correctly-canonicalised RBI notification looked stale, and deleted ten of
them — query parameters are case-sensitive to the server and are left alone on purpose.

---

## Phase 1 exit criterion

Seven consecutive days with zero unexplained Finance coverage gaps. Not "the fetcher
works" — that number is what unblocks clustering.

*Unexplained* is the operative word: a gap with a named cause and a fix is progress. A gap
nobody can account for is the thing that must reach zero.
