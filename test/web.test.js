// Versión web pública: conectores que corren en el navegador (aquí con el WebSocket nativo de Node y servidores simulados)
import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { startDirectSE, startDirectSL, startDirectTwitch, twitchSource } from '../overlay/js/sources/direct.js';
import { buildWeb } from '../scripts/build.js';
import { getConfig } from '../overlay/js/config.js';
import { convert } from '../overlay/js/events.js';
import { normalizeTwitch, sanitize } from '../relay/normalize.js';
import { SCOPES, topicsFor } from '../relay/twitch-topics.js';

const until = async (fn, ms = 3000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };
// socket.io simulado: registra lo que emite el conector y deja disparar eventos del "servidor"
function fakeIo() {
  const made = [];
  const io = (url, opts) => { const s = new EventEmitter(); s.url = url; s.opts = opts; s.sent = []; s.emit2 = s.emit.bind(s); s.emit = (n, d) => s.sent.push([n, d]); s.disconnect = s.close = () => (s.closed = true); made.push(s); return s; };
  return { io, made };
}

describe('conectores web: StreamElements y Streamlabs', () => {
  it('SE: autentica con el JWT, informa estado y entrega eventos normalizados', () => {
    const { io, made } = fakeIo(), st = [], evs = [];
    startDirectSE({ token: 'jwt123', io, onEvents: (l) => evs.push(...l), status: (s) => st.push(s) });
    const s = made[0];
    expect(s.url).toBe('https://realtime.streamelements.com'); expect(s.opts.transports).toEqual(['websocket']);
    s.emit2('connect'); expect(s.sent).toEqual([['authenticate', { method: 'jwt', token: 'jwt123' }]]);
    s.emit2('authenticated', {}); expect(st.at(-1)).toBe('conectado');
    s.emit2('event', { _id: 'a', type: 'tip', data: { username: 'Ana', amount: 5, currency: 'USD' } });
    s.emit2('event', { type: 'raro' }); s.emit2('event', null);
    expect(evs).toEqual([expect.objectContaining({ id: 'se:a', kind: 'donation', rawAmount: 5 })]);
    s.emit2('unauthorized', {}); expect(st.at(-1)).toBe('error: token rechazado'); expect(s.closed).toBe(true);
  });
  it('SL: token en la URL (escapado), eventos y token rechazado', () => {
    const { io, made } = fakeIo(), st = [], evs = [];
    startDirectSL({ token: 'a b&c', io, onEvents: (l) => evs.push(...l), status: (s) => st.push(s) });
    expect(made[0].url).toBe('https://sockets.streamlabs.com?token=a%20b%26c');
    made[0].emit2('event', { type: 'donation', message: [{ _id: 'd1', amount: 3, from: 'Jo' }] });
    expect(evs[0]).toMatchObject({ id: 'sl:d1', rawAmount: 3 });
    made[0].emit2('connect_error', new Error('Authentication error')); expect(st.at(-1)).toBe('error: token rechazado');
  });
  it('una sola fuente para bits/subs: Twitch > StreamElements > Streamlabs', () => {
    expect(twitchSource(['streamlabs', 'twitch'])).toBe('twitch');
    expect(twitchSource(['streamlabs', 'streamelements'])).toBe('streamelements');
    expect(twitchSource([])).toBe('any');
  });
});

describe('conector web: Twitch EventSub con el WebSocket nativo', () => {
  let wss, tw;
  afterEach(() => { tw?.stop(); wss?.close(); });
  it('valida, se suscribe con session_id, entrega notificaciones sin duplicar y reconecta tras un corte', async () => {
    wss = new WebSocketServer({ port: 0 }); await new Promise((r) => wss.once('listening', r));
    const conns = []; wss.on('connection', (ws) => conns.push(ws));
    const posts = [], st = [], evs = [];
    const fetchImpl = async (url, o = {}) => {
      if (url.includes('validate')) return { ok: true, status: 200, json: async () => ({ client_id: 'cid', login: 'ana', user_id: '7', scopes: ['bits:read'] }) };
      posts.push(JSON.parse(o.body)); return { ok: true, status: 202 };
    };
    tw = startDirectTwitch({ token: 'tok', onEvents: (l) => evs.push(...l), status: (s) => st.push(s), fetchImpl,
      urls: { ws: `ws://127.0.0.1:${wss.address().port}`, helix: 'http://helix', validate: 'http://validate' } });
    const msg = (type, payload, id = Math.random().toString(36)) => JSON.stringify({ metadata: { message_id: id, message_type: type, message_timestamp: new Date().toISOString() }, payload });
    await until(() => conns.length === 1);
    conns[0].send(msg('session_welcome', { session: { id: 'S1', keepalive_timeout_seconds: 10 } }));
    await until(() => st.at(-1) === 'conectado');
    expect(posts.map((p) => p.type)).toEqual(['channel.cheer', 'channel.raid']); // solo lo que permiten los scopes
    expect(posts[0].transport).toEqual({ method: 'websocket', session_id: 'S1' });
    const n = msg('notification', { subscription: { type: 'channel.cheer' }, event: { user_name: 'Ana', bits: 300 } }, 'dup');
    conns[0].send(n); conns[0].send(n);
    await until(() => evs.length === 1); await new Promise((r) => setTimeout(r, 50));
    expect(evs).toEqual([expect.objectContaining({ id: 'tw:dup', kind: 'bits', rawAmount: 300 })]);
    conns[0].close();
    await until(() => conns.length === 2, 4000);
    conns[1].send(msg('session_welcome', { session: { id: 'S2', keepalive_timeout_seconds: 10 } }));
    await until(() => posts.length === 4);
    expect(posts[3].transport.session_id).toBe('S2');
  });
  it('token caducado: lo informa y no conecta', async () => {
    const st = [];
    tw = startDirectTwitch({ token: 'x', onEvents() {}, status: (s) => st.push(s), fetchImpl: async () => ({ ok: false, status: 401 }), WS: class { constructor() { throw new Error('no debería conectar'); } } });
    await until(() => st.includes('error: token caducado'));
  });
});

describe('tipos de barra (goalType)', () => {
  const ev = (kind, rawAmount, o = {}) => ({ kind, rawAmount, rawCurrency: kind === 'donation' ? 'USD' : undefined, ...o });
  const val = (q, e) => convert(e, getConfig(q)).value;
  it('cada tipo suma solo lo suyo y en su unidad', () => {
    // seguidores: 1 por follow; dinero, bits y subs no suman
    expect([val('?goalType=follows', ev('follow', 1)), val('?goalType=follows', ev('donation', 50)), val('?goalType=follows', ev('bits', 500)), val('?goalType=follows', ev('sub', 1))]).toEqual([1, 0, 0, 0]);
    // subs: 1 por sub y N por N regaladas
    expect([val('?goalType=subs', ev('sub', 1, { tier: 'T3' })), val('?goalType=subs', ev('giftsub', 5)), val('?goalType=subs', ev('follow', 1))]).toEqual([1, 5, 0]);
    // bits: 1 a 1
    expect([val('?goalType=bits', ev('bits', 1500)), val('?goalType=bits', ev('donation', 10))]).toEqual([1500, 0]);
    // donaciones: solo dinero
    expect([val('?goalType=donations', ev('donation', 7)), val('?goalType=donations', ev('bits', 500)), val('?goalType=donations', ev('sub', 1))]).toEqual([7, 0, 0]);
    // todo junto (por defecto): todo convertido a dinero
    expect([val('', ev('donation', 7)), val('', ev('bits', 500)), val('', ev('sub', 1))]).toEqual([7, 5, 5]);
  });
  it('unit/count explícitos mandan; tipo desconocido = todo junto; seguidores sin "TOP" en el ticker', () => {
    expect(getConfig('?goalType=follows&count=follows,raids')).toMatchObject({ unit: 'count', count: ['follows', 'raids'] });
    expect(getConfig('?goalType=bits&unit=currency').unit).toBe('currency');
    expect(getConfig('?goalType=nada')).toMatchObject({ goalType: 'mix', unit: 'currency', count: ['donations', 'bits', 'subs'] });
    expect(getConfig('?goalType=follows').tickerMessages).toEqual(['last', 'remaining']);
    expect(getConfig('?goalType=subs').tickerMessages).toEqual(['last', 'top', 'remaining']);
  });
});

describe('canjes de puntos del canal', () => {
  const tw = normalizeTwitch('channel.channel_points_custom_reward_redemption.add',
    { user_name: 'Ana', user_input: '', reward: { id: 'r1', title: 'Hidratarse', cost: 500 } }, 'msg-1')[0];
  it('EventSub → evento "redemption" con coste, título de la recompensa y mensaje', () => {
    expect(tw).toMatchObject({ id: 'tw:msg-1', source: 'twitch', kind: 'redemption', rawAmount: 500, reward: 'Hidratarse', name: 'Ana', message: 'Hidratarse' });
    expect(sanitize({ ...tw }).reward).toBe('Hidratarse'); // pasa por el relay sin perder la recompensa
  });
  it('canjes cuenta 1 por canje; puntos suma el coste; el resto de barras no lo cuentan', () => {
    expect(convert(tw, getConfig('?goalType=redemptions')).value).toBe(1);
    expect(convert(tw, getConfig('?goalType=points')).value).toBe(500);
    for (const t of ['mix', 'donations', 'bits', 'subs', 'follows']) expect(convert(tw, getConfig('?goalType=' + t)).value, t).toBe(0);
    expect(convert({ kind: 'donation', rawAmount: 5 }, getConfig('?goalType=points')).value).toBe(0);
  });
  it('filtro por recompensa (sin distinguir mayúsculas)', () => {
    expect(convert(tw, getConfig('?goalType=redemptions&rewards=hidratarse, Cantar')).value).toBe(1);
    expect(convert(tw, getConfig('?goalType=redemptions&rewards=Cantar una canción')).value).toBe(0);
  });
  it('Twitch pide el permiso de canjes y se suscribe al evento solo si el token lo tiene', () => {
    expect(SCOPES).toContain('channel:read:redemptions');
    expect(topicsFor(['bits:read']).map((t) => t[0])).not.toContain('channel.channel_points_custom_reward_redemption.add');
    expect(topicsFor(['channel:read:redemptions']).map((t) => t[0])).toContain('channel.channel_points_custom_reward_redemption.add');
  });
});

describe('build web', () => {
  it('genera la página, el overlay autónomo (con socket.io dentro) y no deja import/export', () => {
    const w = buildWeb();
    expect(Object.keys(w).sort()).toEqual(['.nojekyll', 'app.js', 'index.html', 'licencias.txt', 'overlay.html', 'site-config.js']);
    expect(w['overlay.html']).toContain('Socket.IO v4.8.1'); expect(w['overlay.html']).toContain('data:font/woff2;base64,');
    expect(w['overlay.html']).toContain('<meta name="referrer" content="no-referrer">');
    const scripts = [...w['overlay.html'].matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBe(2);
    for (const js of scripts) expect(() => new Function(js)).not.toThrow();
    expect(scripts[1]).not.toMatch(/^\s*(import|export)\b/m);
  });
});
