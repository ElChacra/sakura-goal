// Relay local (Fase 3): sirve overlay/ y control/, WebSocket /ws para overlays y panel, REST /api/*,
// conectores StreamElements y Streamlabs. Escucha solo en 127.0.0.1 por defecto.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadEnv } from './env.js';
import { createLog, addSecret } from './log.js';
import { createStore } from './store.js';
import { createHub } from './hub.js';
import { handleApi } from './routes.js';
import { startStreamElements } from './connectors/streamelements.js';
import { startStreamlabs } from './connectors/streamlabs.js';
import { handleKofi, KOFI_TYPES_DEFAULT } from './connectors/kofi.js';
import { createTwitch } from './connectors/twitch-eventsub.js';
import { startTwitchChat } from './connectors/twitch-chat.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png' };
const STATIC = ['overlay', 'control'].map((d) => path.join(ROOT, d));

// Peticiones que llegan por un túnel/proxy (cloudflared, ngrok…) traen estas cabeceras: en el puerto principal solo se
// les permite el webhook de Ko-fi; panel, API y WebSocket nunca quedan expuestos a internet aunque el túnel apunte aquí.
const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'cf-connecting-ip', 'x-real-ip', 'ngrok-trace-id'];
export const viaProxy = (req) => PROXY_HEADERS.some((h) => h in req.headers);

// Solo páginas servidas desde localhost pueden hablar con el relay (evita que una web cualquiera abierta en tu navegador sume aportes).
// Sin Origin (OBS, curl, Streamer.bot) se permite: el relay ya solo escucha en 127.0.0.1.
export const originOk = (o) => !o || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o);

function serveStatic(req, res, pathname) {
  let file = path.resolve(ROOT, '.' + pathname);
  if (!STATIC.some((d) => file === d || file.startsWith(d + path.sep))) { res.writeHead(404); return res.end('404'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const list = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

// Una sola fuente para bits/subs: Twitch EventSub (si hay token) > StreamElements > Streamlabs. BITS_FROM/SUBS_FROM mandan si están.
export function sourceRules(env, { twitch: hasTwitch = !!env.TWITCH_ACCESS_TOKEN } = {}) {
  const twitch = hasTwitch ? 'twitch' : env.STREAMELEMENTS_JWT ? 'streamelements' : env.STREAMLABS_SOCKET_TOKEN ? 'streamlabs' : 'any';
  return {
    bitsFrom: (env.BITS_FROM || twitch).toLowerCase(), subsFrom: (env.SUBS_FROM || twitch).toLowerCase(),
    donationsFrom: env.DONATIONS_FROM ? list(env.DONATIONS_FROM) : ['streamelements', 'streamlabs', 'kofi'],
  };
}

export function createRelay({ env = {}, port = 3000, host = '127.0.0.1', stateFile = path.join(ROOT, 'state.json'), twitchTokenFile = path.join(ROOT, 'twitch-token.json'),
  kofiPort = env.KOFI_VERIFICATION_TOKEN ? Number(env.KOFI_PORT) || 3001 : null, connectors = true, quiet = false } = {}) {
  const log = createLog({ debug: env.DEBUG === '1', quiet });
  [env.STREAMLABS_SOCKET_TOKEN, env.STREAMELEMENTS_JWT, env.KOFI_VERIFICATION_TOKEN, env.TWITCH_ACCESS_TOKEN].forEach(addSecret);
  const store = createStore(stateFile, { log });
  const rules = sourceRules(env);
  const hub = createHub({ store, log, rules });
  const savePayloads = env.SAVE_PAYLOADS === '1' ? path.join(ROOT, 'payloads.jsonl') : null;
  const twitch = createTwitch({ env, hub, log, tokenFile: twitchTokenFile, savePayloads, onConfigured: (on) => Object.assign(rules, sourceRules(env, { twitch: on })) });
  const kofiTypes = env.KOFI_TYPES ? list(env.KOFI_TYPES) : KOFI_TYPES_DEFAULT;
  const kofi = (req, res) => handleKofi(req, res, { hub, token: env.KOFI_VERIFICATION_TOKEN, types: kofiTypes, log });
  let actualPort = port;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), origin = req.headers.origin;
    if (url.pathname === '/webhook/kofi') return kofi(req, res);
    if (viaProxy(req)) { res.writeHead(403); return res.end('solo /webhook/kofi es accesible desde fuera'); }
    if (url.pathname.startsWith('/api/')) {
      if (!originOk(origin)) { res.writeHead(403); return res.end('origen no permitido'); }
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
      return handleApi(req, res, url, { hub, store, twitch, redirectUri: () => `http://localhost:${actualPort}/control/twitch.html` });
    }
    if (url.pathname === '/') { res.writeHead(302, { Location: '/overlay/' }); return res.end(); }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); } // sin 404 en la consola de OBS
    let p; try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
    serveStatic(req, res, p);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws' || !originOk(req.headers.origin) || viaProxy(req)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const c = { role: null, goalId: 'main', send: (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); } };
      ws.isAlive = true; ws.on('pong', () => (ws.isAlive = true));
      hub.attach(c);
      ws.on('message', (buf) => { let m; try { m = JSON.parse(buf); } catch { return; } hub.onMessage(c, m); });
      ws.on('close', () => hub.detach(c));
      ws.on('error', () => {});
    });
  });
  const beat = setInterval(() => wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 30000);

  // Puerto solo-webhook para el túnel de Ko-fi: cualquier otra ruta da 404.
  const kofiServer = kofiPort != null ? http.createServer((req, res) => {
    if (new URL(req.url, 'http://x').pathname === '/webhook/kofi') return kofi(req, res);
    res.writeHead(404); res.end('404');
  }) : null;

  const running = [];
  function startConnectors() {
    if (env.STREAMELEMENTS_JWT) running.push(startStreamElements({ token: env.STREAMELEMENTS_JWT, hub, log, savePayloads })); else hub.setConnector('streamelements', 'no configurado');
    if (env.STREAMLABS_SOCKET_TOKEN) running.push(startStreamlabs({ token: env.STREAMLABS_SOCKET_TOKEN, hub, log, savePayloads })); else hub.setConnector('streamlabs', 'no configurado');
    hub.setConnector('kofi', env.KOFI_VERIFICATION_TOKEN ? 'esperando webhook' : 'no configurado');
    if (twitch.configured) Object.assign(rules, sourceRules(env, { twitch: true }));
    running.push(twitch); twitch.start();
    const channel = chatChannel();
    if (env.CHAT_COMMANDS === '1' && channel) running.push(startTwitchChat({ channel, hub, log, prefix: env.CHAT_PREFIX || '!meta', allow: (env.CHAT_ALLOW || 'mods').toLowerCase() }));
    else hub.setConnector('chat', env.CHAT_COMMANDS === '1' ? 'error: falta TWITCH_CHANNEL' : 'desactivado');
  }

  // Canal para los comandos: TWITCH_CHANNEL o, si conectaste Twitch desde el panel, tu propio canal
  function chatChannel() {
    if (env.TWITCH_CHANNEL) return env.TWITCH_CHANNEL;
    try { return JSON.parse(fs.readFileSync(twitchTokenFile, 'utf8')).login || ''; } catch { return ''; }
  }

  function listen(p, tries = 0) {
    return new Promise((resolve, reject) => {
      const onErr = (e) => {
        server.off('listening', onOk);
        if (e.code === 'EADDRINUSE' && tries < 10) { log.warn(`Puerto ${p} ocupado, probando ${p + 1}…`); resolve(listen(p + 1, tries + 1)); } else reject(e);
      };
      const onOk = () => { server.off('error', onErr); resolve(server.address().port); };
      server.once('error', onErr); server.once('listening', onOk);
      server.listen(p, host);
    });
  }

  return {
    hub, store, server, log, rules, twitch,
    get kofiPort() { return kofiServer?.address()?.port ?? null; },
    async start() {
      actualPort = await listen(port);
      if (kofiServer) await new Promise((resolve) => {
        kofiServer.once('error', (e) => { log.error(`No se pudo abrir el puerto de Ko-fi ${kofiPort}: ${e.message}. Cambia KOFI_PORT en .env`); resolve(); });
        kofiServer.listen(kofiPort, host, resolve);
      });
      if (connectors) startConnectors();
      return actualPort;
    },
    async close() {
      clearInterval(beat); running.forEach((r) => r.stop());
      wss.clients.forEach((ws) => ws.terminate());
      if (kofiServer?.listening) await new Promise((r) => kofiServer.close(r));
      await new Promise((r) => server.close(r));
      store.flush();
    },
  };
}

// ---------- ejecución directa: `node relay/server.js` ----------
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const env = loadEnv(path.join(ROOT, '.env'));
  const host = env.HOST || '127.0.0.1';
  const relay = createRelay({ env, port: Number(env.PORT) || 3000, host });
  relay.start().then((port) => {
    const base = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
    const st = (k) => (env[k] ? 'activado' : 'no configurado (ver .env)');
    console.log(`\n🌸 Sakura Arcade Goal · relay listo\n` +
      `   Overlay para OBS : ${base}/overlay/\n` +
      `   Panel de control : ${base}/control/\n` +
      `   StreamElements   : ${st('STREAMELEMENTS_JWT')}\n` +
      `   Streamlabs       : ${st('STREAMLABS_SOCKET_TOKEN')}\n` +
      `   Twitch EventSub  : ${relay.twitch.configured ? 'activado' : 'no configurado (panel → Conectar Twitch)'}\n` +
      `   Comandos de chat : ${env.CHAT_COMMANDS === '1' ? `${env.CHAT_PREFIX || '!meta'} (${env.CHAT_ALLOW || 'mods'})` : 'desactivados (CHAT_COMMANDS=1 en .env)'}
` +
      `   Ko-fi webhook    : ${relay.kofiPort ? `http://${host}:${relay.kofiPort}/webhook/kofi (expónlo con un túnel HTTPS, ver README)` : 'no configurado (ver .env)'}\n` +
      `   Bits desde: ${relay.rules.bitsFrom} · Subs desde: ${relay.rules.subsFrom}\n` +
      `   Deja esta ventana abierta mientras transmites. Ctrl+C para cerrar.\n`);
  }).catch((e) => { console.error('No se pudo iniciar el relay:', e.message); process.exit(1); });
  const stop = () => relay.close().finally(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
