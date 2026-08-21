/**
 * The registry, read-only.
 *
 * The source registry is the moat, so it needs to be legible to someone who is not
 * reading the seed files — including the `notes` field, which is where the reason a
 * source is deactivated or failing actually lives.
 */

import { getRegistry } from '../../lib/queries';

export const dynamic = 'force-dynamic';

export default async function SourcesPage() {
  const rows = await getRegistry();
  const verticals = ['finance', 'tech'] as const;

  return (
    <>
      <h1>Registry</h1>
      <p className="subtitle">
        {rows.length} sources. Adding one is an INSERT in <span className="mono">packages/db/src/seed</span>;
        this page is the read-only view of what is actually loaded.
      </p>

      {verticals.map((vertical) => {
        const scoped = rows.filter((row) => row.vertical === vertical);
        if (scoped.length === 0) return null;

        return (
          <section key={vertical}>
            <h2>
              {vertical === 'finance' ? 'Finance' : 'Tech'}
              <span className="hint">
                {scoped.filter((r) => r.is_active).length} active of {scoped.length}
              </span>
            </h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Kind</th>
                    <th>Type</th>
                    <th>Role</th>
                    <th>Fetch</th>
                    <th>Audit</th>
                    <th className="num">Weight</th>
                    <th>Feed</th>
                  </tr>
                </thead>
                <tbody>
                  {scoped.map((row) => (
                    <tr key={row.slug} style={row.is_active ? undefined : { opacity: 0.55 }}>
                      <td>
                        <strong>{row.name}</strong>{' '}
                        {!row.is_active && <span className="pill">inactive</span>}
                        <div className="mono" style={{ color: 'var(--text-dim)' }}>
                          {row.slug}
                        </div>
                        {row.topics.length > 0 && (
                          <div className="note">{row.topics.join(' · ')}</div>
                        )}
                        {/* Where the reason a source is off or failing actually lives. */}
                        {row.notes && (
                          <div className="note" style={{ maxWidth: '58ch' }}>
                            {row.notes}
                          </div>
                        )}
                      </td>
                      <td>
                        {row.source_kind === 'data' ? (
                          <span className="pill">data</span>
                        ) : (
                          <span className="pill ok">news</span>
                        )}
                      </td>
                      <td>{row.source_type}</td>
                      <td>
                        {/* Discovery sources point at claims; they never corroborate them. */}
                        {row.source_role === 'discovery' ? (
                          <span className="pill warn">discovery</span>
                        ) : (
                          'record'
                        )}
                      </td>
                      <td className="mono">{row.fetch_type}</td>
                      <td className="mono">{row.audit_strategy}</td>
                      <td className="num">{row.reliability_weight.toFixed(2)}</td>
                      <td className="mono" style={{ maxWidth: 280, wordBreak: 'break-all' }}>
                        <a href={row.feed_url} target="_blank" rel="noreferrer">
                          {row.feed_url}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
