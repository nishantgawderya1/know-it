/**
 * Recent documents, with extraction and origin signals visible.
 *
 * This page exists so extraction quality and wire detection are eyeballable rather than
 * assumed. Both are silent failure modes: a paywalled stub and a clean article look
 * identical in a row count, and a missed PTI byline only shows up two phases later as
 * three "independent" sources that were one.
 */

import { getRecentDocuments, type DocumentRow } from '../../lib/queries';

export const dynamic = 'force-dynamic';

function extractionPill(row: DocumentRow) {
  const map: Record<string, string> = {
    ok: 'pill ok',
    partial: 'pill warn',
    failed: 'pill bad',
    skipped: 'pill',
    pending: 'pill',
  };
  return <span className={map[row.extraction_status] ?? 'pill'}>{row.extraction_status}</span>;
}

function confidencePill(row: DocumentRow) {
  if (row.published_at_confidence === 'high') return null;
  const tone = row.published_at_confidence === 'suspect' ? 'pill bad' : 'pill warn';
  return <span className={tone}>{row.published_at_confidence} date</span>;
}

export default async function DocumentsPage() {
  const rows = await getRecentDocuments(120);
  const withImage = rows.filter((row) => row.image_url !== null).length;
  const wire = rows.filter((row) => row.origin_wire_byline !== null).length;

  return (
    <>
      <h1>Documents</h1>
      <p className="subtitle">
        The {rows.length} most recent documents. {withImage} carry a lead image and {wire} were
        detected as wire copy — two outlets running the same wire story is corroboration of one,
        which is why detection happens per article rather than per source.
      </p>

      {rows.length === 0 ? (
        <div className="empty">
          Nothing ingested yet. Run <code>npm run worker:once</code>.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Image</th>
                <th>Document</th>
                <th>Source</th>
                <th>Extraction</th>
                <th className="num">Chars</th>
                <th>Origin signals</th>
                <th>Fetched</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.image_url ? (
                      // Hotlinked deliberately: re-hosting is a copyright posture change,
                      // and this is an internal ops page, not the consumer feed.
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={row.image_url}
                        alt=""
                        loading="lazy"
                        width={96}
                        height={54}
                        style={{
                          width: 96,
                          height: 54,
                          objectFit: 'cover',
                          borderRadius: 4,
                          border: '1px solid var(--border)',
                          background: 'var(--bg-raised)',
                        }}
                      />
                    ) : (
                      <span className="pill">none</span>
                    )}
                    {row.image_source && (
                      <div className="note mono">
                        {row.image_source}
                        {row.image_width ? ` ${row.image_width}px` : ''}
                      </div>
                    )}
                  </td>
                  <td style={{ maxWidth: 380 }}>
                    <a href={row.url} target="_blank" rel="noreferrer">
                      {row.title ?? '(no title)'}
                    </a>
                    <div className="note mono" style={{ wordBreak: 'break-all' }}>
                      {row.url}
                    </div>
                  </td>
                  <td>
                    {row.source_name}
                    {row.vertical === 'tech' && (
                      <>
                        {' '}
                        <span className="pill shadow">shadow</span>
                      </>
                    )}
                  </td>
                  <td>
                    {extractionPill(row)} {confidencePill(row)}
                  </td>
                  <td className="num">{row.text_length ?? 0}</td>
                  <td style={{ maxWidth: 260 }}>
                    {row.origin_wire_byline && (
                      <div>
                        <span className="pill warn">
                          {row.origin_wire_byline} · {row.origin_wire_evidence}
                        </span>
                      </div>
                    )}
                    {row.origin_primary_links.length > 0 && (
                      <div className="note">
                        links to {row.origin_primary_links.join(', ')}
                      </div>
                    )}
                    {row.origin_discovery_target_url && (
                      <div className="note mono" style={{ wordBreak: 'break-all' }}>
                        points at {row.origin_discovery_target_url}
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>
                    {new Date(row.fetched_at).toISOString().slice(5, 16).replace('T', ' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
