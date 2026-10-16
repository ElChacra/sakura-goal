// Versión web pública: el propio overlay (navegador de OBS) se conecta a StreamElements, Streamlabs y Twitch, sin relay.
// Las dependencias (io de socket.io, WebSocket, fetch) se inyectan para poder probarlo en Node con servidores simulados.
import { normalizeSE, normalizeSETest, normalizeSL, normalizeTwitch } from '../../../relay/normalize.js';
import { topicsFor } from '../../../relay/twitch-topics.js';

const ioOpts = { transports: ['websocket'], reconnectionDelay: 1000, reconnectionDelayMax: 30000, randomizationFactor: 0.5, timeout: 15000 };
const safe = (fn) => (p) => { try { return fn(p); } catch { return []; } };

// status(s): 'conectando' | 'conectado' | 'reintentando' | 'error: …' — se muestra en la página de configuración
export function startDirectSE({ token, io, onEvents, status }) {
  const s = io('https://realtime.streamelements.com', ioOpts);
  status('conectando');
  s.on('connect', () => s.emit('authenticate', { method: 'jwt', token }));
  s.on('authenticated', () => status('conectado'));
  s.on('unauthorized', () => { status('error: token rechazado'); s.disconnect(); });
  s.on('connect_error', () => status('reintentando'));
  s.on('event', (p) => onEvents(safe(normalizeSE)(p)));
  s.on('event:test', (p) => onEvents(safe(normalizeSETest)(p)));
  return { stop: () => s.close() };
}

export function startDirectSL({ token, io, onEvents, status }) {
  const s = io(`https://sockets.streamlabs.com?token=${encodeURIComponent(token)}`, ioOpts);
  status('conectando');
  s.on('connect', () => status('conectado'));
  s.on('connect_error', (e) => status(/auth|token/i.test(e?.message) ? 'error: token rechazado' : 'reintentando'));
  s.on('disconnect', (r) => { if (r === 'io server disconnect') { status('error: token rechazado'); } });
  s.on('event', (p) => onEvents(safe(normalizeSL)(p)));
  return { stop: () => s.close() };
}

const TW = { ws: 'wss://eventsub.wss.twitch.tv/ws', helix: 'https://api.twitch.tv/helix', validate: 'https://id.twitch.tv/oauth2/validate' };

// Twitch EventSub por WebSocket: validar token → welcome → suscripciones (≤ 10 s) → notificaciones; keepalive y reconexión.
export function startDirectTwitch({ token, onEvents, status, WS = globalThis.WebSocket, fetchImpl = globalThis.fetch, urls = TW, setT = setTimeout, clearT = clearTimeout }) {
  let info = null, ws = null, stopped = false, delay = 1000, retryT = null, keepT = null;
  const seen = new Set();
  async function subscribe(sessionId) {
    let ok = 0;
    const topics = topicsFor(info.scopes || []);
    for (const [type, version, , cond] of topics) {
      const r = await fetchImpl(`${urls.helix}/eventsub/subscriptions`, { method: 'POST', headers: { 'Client-Id': info.client_id, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, version, condition: cond(info.user_id), transport: { method: 'websocket', session_id: sessionId } }) }).catch(() => null);
      if (r && (r.ok || r.status === 409)) ok++;
    }
    status(ok ? 'conectado' : 'error: no se pudo suscribir');
  }
  const arm = (sec) => { clearT(keepT); keepT = setT(() => ws?.close(), (sec + 5) * 1000); };
  function connect(url = urls.ws, replacing = null) {
    const sock = new WS(url); let keep = 10;
    if (!replacing) ws = sock;
    sock.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch { return; }
      const md = d.metadata || {}, p = d.payload || {};
      if (md.message_id) { if (seen.has(md.message_id)) return; seen.add(md.message_id); if (seen.size > 500) seen.delete(seen.values().next().value); }
      if (sock === ws) arm(keep);
      if (md.message_type === 'session_welcome') {
        keep = p.session?.keepalive_timeout_seconds || 10; delay = 1000;
        if (replacing) { ws = sock; replacing.onclose = null; replacing.close(); } else subscribe(p.session.id);
        arm(keep);
      } else if (md.message_type === 'session_reconnect') connect(p.session?.reconnect_url, sock);
      else if (md.message_type === 'notification') onEvents(normalizeTwitch(p.subscription?.type, p.event, md.message_id, Date.parse(md.message_timestamp) || Date.now()));
      else if (md.message_type === 'revocation' && p.subscription?.status === 'authorization_revoked') status('error: permiso revocado');
    };
    sock.onclose = () => {
      if (sock !== ws || stopped) return;
      clearT(keepT); status('reintentando');
      clearT(retryT); retryT = setT(() => connect(), delay * (0.75 + Math.random() * 0.5)); delay = Math.min(delay * 2, 30000);
    };
  }
  async function begin() {
    if (stopped) return;
    status('conectando');
    const r = await fetchImpl(urls.validate, { headers: { Authorization: `OAuth ${token}` } }).catch(() => null);
    if (!r) { status('reintentando'); retryT = setT(begin, 30000); return; } // sin internet todavía (OBS arrancó antes que la red)
    if (r.status === 401) { status('error: token caducado'); return; }
    info = await r.json();
    if (!stopped) connect();
  }
  begin();
  return { stop() { stopped = true; clearT(retryT); clearT(keepT); if (ws) { ws.onclose = null; ws.close(); } } };
}

// Una sola fuente para bits/subs aunque se conecten varias (evita contarlos dos veces): Twitch > StreamElements > Streamlabs
export function twitchSource(connected) { return ['twitch', 'streamelements', 'streamlabs'].find((s) => connected.includes(s)) || 'any'; }
