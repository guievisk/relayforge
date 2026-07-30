// Dashboard de operacao servido em GET /admin.
// HTML single-file: React + Babel via CDN. Chama a Admin API com X-Admin-Token.
// Exportado como string pra sobreviver ao build Docker (nao depende de copiar .html).
export const dashboardHtml = `<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RelayForge — Dead-letter Console</title>
  <script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
  <script crossorigin src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js"></script>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #0b0e14; color: #e6e6e6; }
    header { padding: 20px 28px; border-bottom: 1px solid #1e2430; display: flex; align-items: center; justify-content: space-between; }
    header h1 { font-size: 18px; margin: 0; font-weight: 600; }
    header .badge { font-size: 12px; color: #8a94a6; }
    main { padding: 24px 28px; max-width: 1100px; margin: 0 auto; }
    .token-bar { display: flex; gap: 10px; margin-bottom: 20px; }
    .token-bar input { flex: 1; padding: 10px 12px; background: #141924; border: 1px solid #232b3a; border-radius: 8px; color: #e6e6e6; font-family: ui-monospace, monospace; font-size: 13px; }
    button { padding: 9px 14px; border: 1px solid #2a3446; background: #1a2130; color: #e6e6e6; border-radius: 8px; cursor: pointer; font-size: 13px; }
    button:hover { background: #222c3d; }
    button.primary { background: #2563eb; border-color: #2563eb; }
    button.primary:hover { background: #1d4fd7; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 11px 12px; border-bottom: 1px solid #1a2130; font-size: 13px; }
    th { color: #8a94a6; font-weight: 500; }
    tr.clickable:hover { background: #10151f; cursor: pointer; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; background: #3a1620; color: #f87171; border: 1px solid #5a1f2b; }
    .muted { color: #8a94a6; }
    .empty { text-align: center; padding: 60px; color: #8a94a6; }
    .drawer { position: fixed; top: 0; right: 0; width: 520px; max-width: 92vw; height: 100vh; background: #0e1119; border-left: 1px solid #1e2430; padding: 24px; overflow-y: auto; box-shadow: -20px 0 40px rgba(0,0,0,.4); }
    .drawer h2 { font-size: 15px; margin: 0 0 4px; }
    .drawer .close { position: absolute; top: 18px; right: 20px; }
    .kv { font-size: 13px; margin: 12px 0; }
    .kv .k { color: #8a94a6; }
    pre { background: #141924; border: 1px solid #232b3a; border-radius: 8px; padding: 12px; overflow-x: auto; font-size: 12px; color: #cbd5e1; }
    .attempt { border: 1px solid #1a2130; border-radius: 8px; padding: 10px 12px; margin: 8px 0; font-size: 12px; }
    .err { color: #f87171; margin: 12px 0; }
    .ok { color: #34d399; margin: 12px 0; }
    .pagination { display: flex; gap: 10px; align-items: center; margin-top: 16px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react">
    const { useState, useEffect, useCallback } = React;

    function api(path, token, opts) {
      opts = opts || {};
      return fetch(path, {
        method: opts.method || 'GET',
        headers: { 'X-Admin-Token': token },
      }).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
        return body;
      });
    }

    function App() {
      const [token, setToken] = useState('');
      const [authed, setAuthed] = useState(false);
      const [items, setItems] = useState([]);
      const [total, setTotal] = useState(0);
      const [offset, setOffset] = useState(0);
      const [limit] = useState(20);
      const [error, setError] = useState('');
      const [loading, setLoading] = useState(false);
      const [selected, setSelected] = useState(null);
      const [flash, setFlash] = useState('');

      const load = useCallback((tk, off) => {
        setLoading(true); setError('');
        api('/admin/dead-letters?limit=' + limit + '&offset=' + off, tk)
          .then((data) => { setItems(data.items); setTotal(data.total); setAuthed(true); })
          .catch((e) => { setError(e.message); setAuthed(false); })
          .finally(() => setLoading(false));
      }, [limit]);

      function connect() { setOffset(0); load(token, 0); }

      function openDetail(id) {
        api('/admin/dead-letters/' + id, token)
          .then(setSelected)
          .catch((e) => setError(e.message));
      }

      function replay(id) {
        api('/admin/dead-letters/' + id + '/replay', token, { method: 'POST' })
          .then(() => {
            setFlash('Delivery ' + id.slice(0, 8) + ' recolocada na fila.');
            setSelected(null);
            load(token, offset);
            setTimeout(() => setFlash(''), 4000);
          })
          .catch((e) => setError(e.message));
      }

      function changePage(delta) {
        const next = Math.max(0, offset + delta * limit);
        setOffset(next); load(token, next);
      }

      return (
        <div>
          <header>
            <h1>RelayForge — Dead-letter Console</h1>
            <span className="badge">{authed ? (total + ' dead-letters') : 'not connected'}</span>
          </header>
          <main>
            {!authed && (
              <div className="token-bar">
                <input
                  type="password"
                  placeholder="X-Admin-Token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') connect(); }}
                />
                <button className="primary" onClick={connect} disabled={!token || loading}>
                  {loading ? '...' : 'Connect'}
                </button>
              </div>
            )}

            {error && <div className="err">Erro: {error}</div>}
            {flash && <div className="ok">{flash}</div>}

            {authed && (
              <div>
                {items.length === 0 ? (
                  <div className="empty">Nenhuma dead-letter. Tudo entregue.</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Event type</th>
                        <th>Destination</th>
                        <th>Attempts</th>
                        <th>Created</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((d) => (
                        <tr key={d.id} className="clickable" onClick={() => openDetail(d.id)}>
                          <td>{d.event.type} <span className="pill">DEAD</span></td>
                          <td className="muted">{d.destination.url}</td>
                          <td>{d.attemptCount}</td>
                          <td className="muted">{new Date(d.createdAt).toLocaleString()}</td>
                          <td>
                            <button onClick={(e) => { e.stopPropagation(); replay(d.id); }}>Replay</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <div className="pagination">
                  <button onClick={() => changePage(-1)} disabled={offset === 0}>Prev</button>
                  <span className="muted">{offset + 1}-{Math.min(offset + limit, total)} de {total}</span>
                  <button onClick={() => changePage(1)} disabled={offset + limit >= total}>Next</button>
                </div>
              </div>
            )}
          </main>

          {selected && (
            <div className="drawer">
              <button className="close" onClick={() => setSelected(null)}>Fechar</button>
              <h2>{selected.event.type}</h2>
              <div className="kv"><span className="k">Delivery ID:</span> {selected.id}</div>
              <div className="kv"><span className="k">Destination:</span> {selected.destination.url}</div>
              <div className="kv"><span className="k">Attempts:</span> {selected.attemptCount}</div>
              <div className="kv"><span className="k">Payload:</span></div>
              <pre>{JSON.stringify(selected.event.payload, null, 2)}</pre>
              <div className="kv"><span className="k">Tentativas ({selected.attempts.length}):</span></div>
              {selected.attempts.map((a) => (
                <div className="attempt" key={a.id}>
                  #{a.attemptNumber} · status {a.httpStatus === null ? 'timeout/err' : a.httpStatus}
                  {a.errorCode ? (' · ' + a.errorCode) : ''} · {a.durationMs}ms
                  {a.responseExcerpt ? (<pre>{a.responseExcerpt}</pre>) : null}
                </div>
              ))}
              <button className="primary" style={{ marginTop: 16 }} onClick={() => replay(selected.id)}>
                Replay this delivery
              </button>
            </div>
          )}
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>`
