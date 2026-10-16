// REST del relay. Útil para el panel, Streamer.bot o curl:
//   GET  /api/health                 estado de conectores y clientes
//   GET  /api/state?goalId=main      último estado guardado de la meta
//   POST /api/event  {kind, rawAmount, name?, message?, rawCurrency?, tier?, goalId?, id?, isTest?}
//   POST /api/cmd    {goalId?, cmd: 'key'|'reset'|'undo'|'target'|'title'|'pause'|'sound', key?, value?}
const CMDS = ['key', 'reset', 'undo', 'target', 'title', 'pause', 'sound'];

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('demasiado grande'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); } });
    req.on('error', reject);
  });
}

async function handleTwitch(req, p, json, { twitch, redirectUri }) {
  if (!twitch) return json(404, { ok: false, reason: 'no existe' });
  if (req.method === 'GET' && p === '/api/twitch/status') return json(200, { ...twitch.status(), redirectUri: redirectUri() });
  if (req.method === 'GET' && p === '/api/twitch/authorize') {
    const u = twitch.authorizeUrl(redirectUri());
    return u ? json(200, { ok: true, url: u }) : json(400, { ok: false, reason: 'Falta TWITCH_CLIENT_ID en .env' });
  }
  if (req.method === 'POST' && p === '/api/twitch/token') {
    const b = await readJson(req);
    if (typeof b.access_token !== 'string' || !/^[a-z0-9]{10,64}$/i.test(b.access_token)) return json(400, { ok: false, reason: 'token con formato inválido' });
    const r = await twitch.acceptToken(b.access_token, String(b.state ?? ''));
    return json(r.ok ? 200 : 400, r);
  }
  if (req.method === 'POST' && p === '/api/twitch/logout') { twitch.logout(); return json(200, { ok: true }); }
  return json(404, { ok: false, reason: 'no existe' });
}

export async function handleApi(req, res, url, { hub, store, twitch, redirectUri = () => '' }) {
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const p = url.pathname;
  try {
    if (p.startsWith('/api/twitch/')) return await handleTwitch(req, p, json, { twitch, redirectUri });
    if (req.method === 'GET' && p === '/api/health') return json(200, { ok: true, connectors: hub.connectors, ...hub.counts() });
    if (req.method === 'GET' && p === '/api/state') return json(200, { state: store.data.goals[url.searchParams.get('goalId') || 'main']?.state ?? null });
    if (req.method === 'POST' && p === '/api/event') {
      const r = hub.intake({ source: 'manual', ...(await readJson(req)) });
      return json(r.ok ? 200 : r.reason === 'invalid' ? 400 : 200, r);
    }
    if (req.method === 'POST' && p === '/api/cmd') {
      const b = await readJson(req);
      if (!CMDS.includes(b.cmd)) return json(400, { ok: false, reason: 'cmd desconocido' });
      hub.command(b.goalId ? String(b.goalId) : null, { cmd: b.cmd, key: b.key, value: b.value });
      return json(200, { ok: true });
    }
    return json(404, { ok: false, reason: 'no existe' });
  } catch (e) {
    return json(e.status || 500, { ok: false, reason: e.message });
  }
}
