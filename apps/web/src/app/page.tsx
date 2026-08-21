/**
 * The coverage dashboard.
 *
 * Phase 1 exists to answer one question with data — can free sources give us complete
 * coverage? — so this is the first screen, not a consumer feed. Everything here is either
 * a number that answers it or a signal that the number is not trustworthy yet.
 */

import {
  getLatestCoverage,
  getSourceHealth,
  getTotals,
  isStale,
  isUnderPolled,
  type SourceHealth,
} from '../lib/queries';

// Coverage is a live operational number; a cached one is a misleading one.
export const dynamic = 'force-dynamic';

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function healthPill(source: SourceHealth) {
  if (!source.is_active) return <span className="pill">inactive</span>;
  if (source.open_errors > 0) return <span className="pill bad">failing</span>;
  if (isStale(source)) return <span className="pill warn">stale</span>;
  if (isUnderPolled(source)) return <span className="pill warn">under-polled</span>;
  if (!source.last_fetched_at) return <span className="pill">pending</span>;
  return <span className="pill ok">ok</span>;
}

function SourceTable({ rows }: { rows: SourceHealth[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Type</th>
            <th>Fetch</th>
            <th>Health</th>
            <th className="num">24h</th>
            <th className="num">Total</th>
            <th className="num">Image</th>
            <th>Last fetch</th>
            <th>Last error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((source) => (
            <tr key={source.id}>
              <td>
                <strong>{source.name}</strong>
                <div className="mono" style={{ color: 'var(--text-dim)' }}>
                  {source.slug}
                </div>
              </td>
              <td>{source.source_type}</td>
              <td className="mono">{source.fetch_type}</td>
              <td>{healthPill(source)}</td>
              <td className="num">{source.docs_24h}</td>
              <td className="num">{source.docs_total}</td>
              {/* A source that silently stops shipping images looks healthy everywhere else. */}
              <td className="num">
                {source.image_pct_7d === null ? '—' : `${source.image_pct_7d}%`}
              </td>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>
                {ago(source.last_fetched_at)}
              </td>
              <td className="mono" style={{ color: 'var(--bad)', maxWidth: 320 }}>
                {source.last_error?.slice(0, 140) ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function CoveragePage() {
  const [totals, health, coverage] = await Promise.all([
    getTotals(),
    getSourceHealth(),
    getLatestCoverage(),
  ]);

  const finance = health.filter((s) => s.vertical === 'finance');
  const tech = health.filter((s) => s.vertical === 'tech');

  // `error` is deliberately not folded into `gap`: an auditor that broke is a different
  // problem from a source that missed something, and conflating them hides both.
  const gaps = coverage.filter((row) => row.status === 'gap');
  const auditErrors = coverage.filter((row) => row.status === 'error');

  const imagePct =
    totals.docs_24h > 0 ? Math.round((totals.with_image_24h / totals.docs_24h) * 100) : null;

  return (
    <>
      <h1>Coverage</h1>
      <p className="subtitle">
        Phase 1 ships when Finance runs seven consecutive days with zero unexplained coverage
        gaps. Tech runs in shadow mode — measured, never surfaced, and it does not gate.
      </p>

      <div className="cards">
        <div className="card">
          <div className="value">{totals.sources_active}</div>
          <div className="label">active sources · {totals.sources_data} data</div>
        </div>
        <div className="card">
          <div className="value">{totals.docs_24h}</div>
          <div className="label">documents · 24h</div>
        </div>
        <div className="card">
          <div className="value">{totals.docs_total}</div>
          <div className="label">documents · total</div>
        </div>
        <div className="card">
          <div className="value">{imagePct === null ? '—' : `${imagePct}%`}</div>
          <div className="label">with lead image · 24h</div>
        </div>
        <div className="card">
          <div className="value">{totals.wire_flagged_24h}</div>
          <div className="label">wire-flagged · 24h</div>
        </div>
        <div className={totals.open_errors > 0 ? 'card alert' : 'card'}>
          <div className="value">{totals.open_errors}</div>
          <div className="label">open source errors</div>
        </div>
      </div>

      <h2>
        Coverage gaps
        <span className="hint">the publisher&rsquo;s own index lists it and we do not hold it</span>
      </h2>
      {gaps.length === 0 ? (
        <div className="empty">
          No gaps recorded. If no audit has run yet this is silence, not a clean bill of health —
          run <code>npm run audit</code>.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Date</th>
                <th>Strategy</th>
                <th className="num">Expected</th>
                <th className="num">Held</th>
                <th>Missing</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((row) => (
                <tr key={row.slug}>
                  <td>
                    <strong>{row.name}</strong>{' '}
                    {row.vertical === 'tech' && <span className="pill shadow">shadow</span>}
                  </td>
                  <td className="mono">{row.audit_date}</td>
                  <td className="mono">{row.strategy}</td>
                  <td className="num">{row.expected_count ?? '—'}</td>
                  <td className="num">{row.ingested_count ?? '—'}</td>
                  <td>
                    <ul className="missing-list">
                      {row.missing_urls.slice(0, 5).map((url) => (
                        <li key={url}>{url}</li>
                      ))}
                    </ul>
                    {row.missing_urls.length > 5 && (
                      <div className="note">+{row.missing_urls.length - 5} more</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {auditErrors.length > 0 && (
        <>
          <h2>
            Auditors that failed
            <span className="hint">
              these prove nothing either way — an auditor reporting no gaps because its scrape
              broke is worse than no auditor
            </span>
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Date</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {auditErrors.map((row) => (
                  <tr key={row.slug}>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td className="mono">{row.audit_date}</td>
                    <td className="mono" style={{ color: 'var(--bad)' }}>
                      {row.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>
        Finance <span className="hint">the shipping vertical</span>
      </h2>
      <SourceTable rows={finance} />

      <h2>
        Tech <span className="hint">shadow mode — measured, not surfaced</span>
      </h2>
      <SourceTable rows={tech} />
    </>
  );
}
