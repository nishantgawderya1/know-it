/**
 * Raw feed preview.
 *
 * NOT the consumer feed. This renders `raw_documents` directly, so it shows the pipeline's
 * input rather than its output: no clustering (the same wire story appears once per outlet
 * that ran it), no summarisation (the text is the publisher's own opening lines), no
 * ranking. Those are Phase 2 and 3.
 *
 * It exists because "did the fetcher work" is much easier to answer looking at content than
 * at table rows — a wrong lead image, a truncated paywall stub or a section feed quietly
 * serving lifestyle copy are all obvious here and invisible in a row count.
 */

import Link from 'next/link';
import { deriveClaimType } from '@knowit/core';
import { getFeed, type FeedRow } from '../../lib/queries';

export const dynamic = 'force-dynamic';

function claimPill(row: FeedRow) {
  const { claimType } = deriveClaimType({
    vertical: row.vertical,
    sourceType: row.source_type as Parameters<typeof deriveClaimType>[0]['sourceType'],
    sourceRole: row.source_role as Parameters<typeof deriveClaimType>[0]['sourceRole'],
    text: row.snippet,
  });

  if (claimType === null) return <span className="pill">points at a claim</span>;

  // Deliberately not a truth score. `announced` means a primary source published it, not
  // that it is correct; `rumoured` means the article says it is anonymously sourced.
  const tone =
    claimType === 'announced' ? 'pill ok' : claimType === 'rumoured' ? 'pill warn' : 'pill';
  return <span className={tone}>{claimType}</span>;
}

function when(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const { v } = await searchParams;
  const vertical = v === 'finance' || v === 'tech' ? v : null;
  const rows = await getFeed(vertical, 60);

  return (
    <>
      <h1>Feed preview</h1>
      <p className="subtitle">
        Raw ingested documents, newest first — the pipeline&rsquo;s input, not the product.
        Nothing here is clustered or summarised yet, so a syndicated story appears once per
        outlet that ran it. That collapse is Phase 2.
      </p>

      <div className="filters">
        <Link className={vertical === null ? 'chip on' : 'chip'} href="/feed">
          All
        </Link>
        <Link className={vertical === 'finance' ? 'chip on' : 'chip'} href="/feed?v=finance">
          Finance
        </Link>
        <Link className={vertical === 'tech' ? 'chip on' : 'chip'} href="/feed?v=tech">
          Tech · shadow
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          Nothing ingested yet. Run <code>npm run worker:once</code>.
        </div>
      ) : (
        <div className="feed">
          {rows.map((row) => (
            <article className="story" key={row.id}>
              {row.image_url ? (
                /* Hotlinked, never re-hosted — re-hosting is a copyright posture change. */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img className="thumb" src={row.image_url} alt="" loading="lazy" />
              ) : (
                <div className="thumb thumb-empty">no image</div>
              )}

              <div className="body">
                <div className="meta">
                  <strong>{row.source_name}</strong>
                  {claimPill(row)}
                  {row.origin_wire_byline && (
                    <span className="pill warn">via {row.origin_wire_byline}</span>
                  )}
                  {row.vertical === 'tech' && <span className="pill shadow">shadow</span>}
                  <span className="when">
                    {when(row.published_at)}
                    {/* A low-confidence date is a clustering bug two phases from now. */}
                    {row.published_at_confidence !== 'high' && ' · approx'}
                  </span>
                </div>

                <h3>
                  <a href={row.url} target="_blank" rel="noreferrer">
                    {row.title ?? '(no title)'}
                  </a>
                </h3>

                {row.snippet && <p className="snippet">{row.snippet.slice(0, 260)}…</p>}

                {row.origin_primary_links.length > 0 && (
                  <div className="note">traces to {row.origin_primary_links.join(', ')}</div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
