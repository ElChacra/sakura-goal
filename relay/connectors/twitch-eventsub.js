// Twitch EventSub por WebSocket (Fase 4). PubSub fue dado de baja el 14-abr-2025: no usarlo.
// Flujo: validar token (da user_id, client_id y scopes) → conectar → session_welcome → crear suscripciones por Helix
// en ≤ 10 s → notificaciones. Maneja keepalive, session_reconnect, revocation y reconexión exponencial.
// El token es de USUARIO (el streamer). Se puede poner en .env o conseguir con el botón del panel (/control/twitch.html).
import fs from 'node:fs';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { normalizeTwitch } from '../normalize.js';
import { addSecret } from '../log.js';

import { SCOPES, topicsFor } from '../twitch-topics.js';
export { SCOPES, topicsFor };

const URLS = { ws: 'wss://eventsub.wss.twitch.tv/ws', helix: 'https://api.twitch.tv/helix', validate: 'https://id.twitch.tv/oauth2/validate', authorize: 'https://id.twitch.tv/oauth2/authorize' };

export function createTwitch({ env, hub, log, tokenFile, savePayloads, urls = URLS, fetchImpl = fetch, onConfigured = () => {} }) {
  const status = (s) => hub.setConnector('twitch', s);
  let token = env.TWITCH_ACCESS_TOKEN || readTokenFile(), info = null, ws = null, stopped = true, delay = 1000;
  let retryT = null, keepT = null, validateT = null, pendingState = null;
  const seenMsg = new Set();
  addSecret(token);

  function readTokenFile() { try { return JSON.parse(fs.readFileSync(tokenFile, 'utf8')).access_token || ''; } catch { return ''; } }

  async function validate(t = token) {
    const r = await fetchImpl(urls.validate, { headers: { Authorization: `OAuth ${t}` } });
    if (r.status === 401) return null;
    if (!r.ok) throw new Error(`validate HTTP ${r.status}`);
    return r.json(); // { client_id, login, user_id, scopes, expires_in }
  }

  async function subscribe(sessionId) {
    const topics = topicsFor(info.scopes || []);
    const missing = SCOPES.filter((s) => !(info.scopes || []).includes(s));
    if (missing.length) log.warn(`[twitch] al token le faltan scopes: ${missing.join(', ')} (esos eventos no se escucharán)`);
    let ok = 0;
    for (const [type, version, , cond] of topics) {
      const r = await fetchImpl(`${urls.helix}/eventsub/subscriptions`, {
        method: 'POST', headers: { 'Client-Id': info.client_id, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, version, condition: cond(info.user_id), transport: { method: 'websocket', session_id: sessionId } }),
      }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
      if (r.ok || r.status === 409) ok++; else log.warn(`[twitch] no se pudo suscribir a ${type}: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
    }
    status(ok ? `conectado (${info.login}, ${ok} eventos)` : 'error: sin suscripciones');
    log.info(`[twitch] escuchando ${ok}/${topics.length} tipos de evento de ${info.login}`);
  }

  function armKeepalive(sec) { clearTimeout(keepT); keepT = setTimeout(() => { log.warn('[twitch] sin keepalive, reconectando'); ws?.terminate(); }, (sec + 5) * 1000); }

  function connect(url = urls.ws, replacing = null) {
    const sock = new WebSocket(url); let keepSec = 10;
    if (!replacing) ws = sock;
    sock.on('message', (buf) => {
      let m; try { m = JSON.parse(buf); } catch { return; }
      const md = m.metadata || {}, p = m.payload || {};
      if (md.message_id) { if (seenMsg.has(md.message_id)) return; seenMsg.add(md.message_id); if (seenMsg.size > 500) seenMsg.delete(seenMsg.values().next().value); }
      if (sock === ws || md.message_type === 'session_welcome') armKeepalive(keepSec);
      switch (md.message_type) {
        case 'session_welcome':
          keepSec = p.session?.keepalive_timeout_seconds || 10; armKeepalive(keepSec); delay = 1000;
          if (replacing) { ws = sock; replacing.removeAllListeners('close'); replacing.close(); log.info('[twitch] sesión migrada'); } // las suscripciones se conservan
          else subscribe(p.session.id).catch((e) => log.warn('[twitch] error al suscribir:', e.message));
          break;
        case 'session_reconnect': connect(p.session?.reconnect_url, sock); break;
        case 'notification': {
          if (savePayloads) fs.appendFile(savePayloads, JSON.stringify({ at: new Date().toISOString(), source: 'twitch', event: p.subscription?.type, payload: p }) + '\n', () => {});
          const list = normalizeTwitch(p.subscription?.type, p.event, md.message_id, Date.parse(md.message_timestamp) || Date.now());
          for (const ev of list) hub.intake(ev);
          break;
        }
        case 'revocation': log.warn(`[twitch] Twitch revocó ${p.subscription?.type}: ${p.subscription?.status}`); if (p.subscription?.status === 'authorization_revoked') status('error: permiso revocado, vuelve a conectar'); break;
        default: break;
      }
    });
    sock.on('close', (code) => {
      if (sock !== ws) return;
      clearTimeout(keepT);
      if (stopped) return;
      status('reintentando'); log.warn(`[twitch] desconectado (código ${code}), reintento en ${Math.round(delay / 1000)} s`);
      clearTimeout(retryT); retryT = setTimeout(() => connect(), delay * (0.75 + Math.random() * 0.5)); delay = Math.min(delay * 2, 30000);
    });
    sock.on('error', (e) => log.debug('[twitch] error de socket:', e.message));
  }

  async function start() {
    stop(); stopped = false;
    if (!token) { status('no configurado'); return; }
    status('validando token');
    try { info = await validate(); } catch (e) { status('reintentando'); log.warn('[twitch] no se pudo validar el token:', e.message); retryT = setTimeout(start, 30000); return; }
    if (!info) { status('error: token inválido o caducado'); log.error('[twitch] token inválido o caducado: vuelve a conectar Twitch desde el panel'); stopped = true; return; }
    if (info.expires_in && info.expires_in < 7 * 86400) log.warn(`[twitch] el token caduca en ${Math.round(info.expires_in / 86400)} día(s): renuévalo desde el panel`);
    onConfigured(true);
    connect();
    validateT = setInterval(async () => { // Twitch pide validar los tokens cada hora
      const v = await validate().catch(() => undefined);
      if (v === null) { status('error: token inválido o caducado'); log.error('[twitch] el token dejó de ser válido'); stop(); }
    }, 3600 * 1000);
  }

  function stop() { stopped = true; clearTimeout(retryT); clearTimeout(keepT); clearInterval(validateT); if (ws) { const w = ws; ws = null; w.removeAllListeners('close'); w.close(); } }

  return {
    start, stop,
    get configured() { return !!token; },
    status: () => ({ configured: !!token, clientId: !!env.TWITCH_CLIENT_ID, login: info?.login ?? null, scopes: info?.scopes ?? [], expiresIn: info?.expires_in ?? null, state: hub.connectors.twitch }),
    // OAuth "implicit grant": el navegador vuelve a /control/twitch.html con el token en el #fragmento (nunca pasa por internet hacia el relay)
    authorizeUrl(redirectUri) {
      if (!env.TWITCH_CLIENT_ID) return null;
      pendingState = { value: crypto.randomBytes(16).toString('hex'), at: Date.now() };
      const q = new URLSearchParams({ response_type: 'token', client_id: env.TWITCH_CLIENT_ID, redirect_uri: redirectUri, scope: SCOPES.join(' '), state: pendingState.value, force_verify: 'true' });
      return `${urls.authorize}?${q}`;
    },
    async acceptToken(t, state) {
      if (!pendingState || state !== pendingState.value || Date.now() - pendingState.at > 10 * 60 * 1000) return { ok: false, reason: 'state inválido o caducado: vuelve a pulsar Conectar' };
      pendingState = null;
      const v = await validate(t).catch(() => null);
      if (!v) return { ok: false, reason: 'Twitch no aceptó el token' };
      token = t; addSecret(t);
      fs.writeFileSync(tokenFile, JSON.stringify({ access_token: t, login: v.login, saved_at: new Date().toISOString() }));
      await start();
      return { ok: true, login: v.login, scopes: v.scopes, expiresIn: v.expires_in };
    },
    logout() { stop(); token = ''; info = null; try { fs.unlinkSync(tokenFile); } catch { /* no existía */ } onConfigured(false); status('no configurado'); },
  };
}
