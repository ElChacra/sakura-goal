import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { parseKofiBody, normalizeKofi } from '../relay/connectors/kofi.js';
import { createTwitch, topicsFor, SCOPES } from '../relay/connectors/twitch-eventsub.js';
import { normalizeTwitch } from '../relay/normalize.js';
import { createHub } from '../relay/hub.js';
import { createStore } from '../relay/store.js';
import { createRelay, sourceRules } from '../relay/server.js';
import { getConfig } from '../overlay/js/config.js';
import { convert } from '../overlay/js/events.js';

const TW = JSON.parse(fs.readFileSync(new URL('./fixtures/twitch.json', import.meta.url)));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sag4-'));
const quietLog = { info() {}, warn() {}, error() {}, debug() {} };
const until = async (fn, ms = 3000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };
const KOFI = { verification_token: 'tok-kofi-123', message_id: 'b54fa6ec-07c9-44aa-be0e-b0f4095d9145', timestamp: '2026-10-16T16:27:32Z', type: 'Donation', is_public: true,
  from_name: 'Jo Ejemplo', message: '¡Mucho éxito!', amount: '3.00', currency: 'USD', is_subscription_payment: false, kofi_transaction_id: 'aaaaaaaa-1111-2222-3333-444444444444' };
const form = (o) => 'data=' + encodeURIComponent(JSON.stringify(o));

describe('Ko-fi', () => {
  it('parsea form-urlencoded con campo data, y JSON directo', () => {
    expect(parseKofiBody(form(KOFI), 'application/x-www-form-urlencoded').amount).toBe('3.00');
    expect(parseKofiBody(JSON.stringify(KOFI), 'application/json').type).toBe('Donation');
    expect(() => parseKofiBody('x=1', 'application/x-www-form-urlencoded')).toThrow();
  });
  it('normaliza: monto texto, dedupe por message_id, is_public=false oculta nombre y mensaje', () => {
    expect(normalizeKofi(KOFI)).toMatchObject({ id: 'kofi:' + KOFI.message_id, source: 'kofi', kind: 'donation', rawAmount: 3, rawCurrency: 'USD', name: 'Jo Ejemplo', anon: false, isTest: false });
    expect(normalizeKofi({ ...KOFI, is_public: false })).toMatchObject({ name: '', message: '', anon: true });
  });
  it('tipos: Subscription suma por defecto; Shop Order solo si está en KOFI_TYPES; monto 0 no suma', () => {
    expect(normalizeKofi({ ...KOFI, type: 'Subscription' })).not.toBeNull();
    expect(normalizeKofi({ ...KOFI, type: 'Shop Order' })).toBeNull();
    expect(normalizeKofi({ ...KOFI, type: 'Shop Order' }, ['shop order'])).not.toBeNull();
    expect(normalizeKofi({ ...KOFI, amount: '0' })).toBeNull();
  });
  it('el ejemplo del botón "Send test" de Ko-fi se marca como prueba', () => {
    expect(normalizeKofi({ ...KOFI, kofi_transaction_id: '00000000-1111-2222-3333-444444444444' }).isTest).toBe(true);
  });
});

describe('Twitch EventSub: normalización', () => {
  it('cheer (también anónimo), sub, resub con mensaje, regalo contado una vez por el total', () => {
    expect(normalizeTwitch('channel.cheer', TW.cheer, 'm1')[0]).toMatchObject({ id: 'tw:m1', source: 'twitch', kind: 'bits', rawAmount: 100, name: 'Ana', message: 'Cheer100 hola' });
    expect(normalizeTwitch('channel.cheer', TW.cheerAnon, 'm2')[0]).toMatchObject({ anon: true, name: '', rawAmount: 50 });
    expect(normalizeTwitch('channel.subscribe', TW.subscribe, 'm3')[0]).toMatchObject({ kind: 'sub', tier: 'T2', name: 'Mei' });
    expect(normalizeTwitch('channel.subscribe', TW.subscribeGifted, 'm4')).toEqual([]);
    expect(normalizeTwitch('channel.subscription.message', TW.resub, 'm5')[0]).toMatchObject({ kind: 'sub', message: '6 meses!', name: 'Luis' });
    expect(normalizeTwitch('channel.subscription.gift', TW.gift, 'm6')[0]).toMatchObject({ kind: 'giftsub', rawAmount: 5, name: 'Nico', tier: 'T1' });
    expect(normalizeTwitch('channel.subscription.gift', TW.giftAnon, 'm7')[0]).toMatchObject({ anon: true, tier: 'T3' });
    expect(normalizeTwitch('channel.follow', TW.follow, 'm8')[0]).toMatchObject({ kind: 'follow', name: 'Sakura' });
    expect(normalizeTwitch('channel.raid', TW.raid, 'm9')[0]).toMatchObject({ kind: 'raid', rawAmount: 42, name: 'Pixel' });
    expect(normalizeTwitch('channel.ban', {}, 'x')).toEqual([]);
  });
  it('5 subs regaladas valen 5 × subRates.T1 en la meta', () => {
    const cfg = getConfig('?target=500');
    expect(convert(normalizeTwitch('channel.subscription.gift', TW.gift, 'g')[0], cfg).value).toBe(25);
  });
  it('solo se suscribe a lo que permiten los scopes del token', () => {
    expect(topicsFor(SCOPES).length).toBe(6);
    expect(topicsFor(['bits:read']).map((t) => t[0])).toEqual(['channel.cheer', 'channel.raid']);
  });
  it('reglas: con Twitch conectado, bits y subs salen solo de Twitch', () => {
    expect(sourceRules({ STREAMELEMENTS_JWT: 'x' }, { twitch: true })).toMatchObject({ bitsFrom: 'twitch', subsFrom: 'twitch' });
    expect(sourceRules({ STREAMELEMENTS_JWT: 'x', BITS_FROM: 'streamelements' }, { twitch: true }).bitsFrom).toBe('streamelements');
  });
});

describe('Twitch EventSub: sesión WebSocket (servidor simulado)', () => {
  let wss, twitch;
  afterEach(() => { twitch?.stop(); wss?.close(); });

  function mockTwitch({ valid = true, scopes = SCOPES } = {}) {
    const posts = [];
    const fetchImpl = async (url, o = {}) => {
      if (url.includes('validate')) return valid ? { ok: true, status: 200, json: async () => ({ client_id: 'cid', login: 'streamer', user_id: '99', scopes, expires_in: 5e6 }) } : { ok: false, status: 401 };
      posts.push({ url, body: JSON.parse(o.body), headers: o.headers });
      return { ok: true, status: 202, text: async () => '' };
    };
    return { posts, fetchImpl };
  }
  async function setup(opts) {
    wss = new WebSocketServer({ port: 0 }); await new Promise((r) => wss.once('listening', r));
    const port = wss.address().port, conns = [];
    wss.on('connection', (ws, req) => { conns.push({ ws, url: req.url }); });
    const dir = tmpDir(), store = createStore(path.join(dir, 's.json')), hub = createHub({ store, log: quietLog });
    const m = mockTwitch(opts);
    twitch = createTwitch({ env: { TWITCH_ACCESS_TOKEN: 'abc123token', TWITCH_CLIENT_ID: 'cid' }, hub, log: quietLog, tokenFile: path.join(dir, 't.json'),
      urls: { ws: `ws://127.0.0.1:${port}/ws`, helix: 'http://helix', validate: 'http://validate', authorize: 'http://auth' }, fetchImpl: m.fetchImpl });
    const events = []; const orig = hub.intake; hub.intake = (e) => { const r = orig(e); if (r.ok) events.push(e); return r; };
    return { port, conns, hub, events, ...m, dir };
  }
  const msg = (type, payload, id = Math.random().toString(36)) => JSON.stringify({ metadata: { message_id: id, message_type: type, message_timestamp: new Date().toISOString() }, payload });
  const welcome = (sid) => msg('session_welcome', { session: { id: sid, keepalive_timeout_seconds: 10 } });

  it('welcome → suscripciones con session_id; notificación → intake; message_id repetido se ignora', async () => {
    const t = await setup();
    twitch.start();
    await until(() => t.conns.length === 1);
    t.conns[0].ws.send(welcome('S1'));
    await until(() => t.posts.length === 6);
    expect(t.posts[0].body).toMatchObject({ type: 'channel.cheer', condition: { broadcaster_user_id: '99' }, transport: { method: 'websocket', session_id: 'S1' } });
    expect(t.posts[0].headers).toMatchObject({ 'Client-Id': 'cid', Authorization: 'Bearer abc123token' });
    await until(() => /^conectado/.test(t.hub.connectors.twitch));
    const n = msg('notification', { subscription: { type: 'channel.cheer' }, event: TW.cheer }, 'dup-1');
    t.conns[0].ws.send(n); t.conns[0].ws.send(n);
    await until(() => t.events.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(t.events.length).toBe(1); expect(t.events[0]).toMatchObject({ kind: 'bits', rawAmount: 100, source: 'twitch' });
  });

  it('session_reconnect: migra a la URL nueva sin volver a suscribirse y cierra la vieja', async () => {
    const t = await setup();
    twitch.start();
    await until(() => t.conns.length === 1);
    t.conns[0].ws.send(welcome('S1'));
    await until(() => t.posts.length === 6);
    t.conns[0].ws.send(msg('session_reconnect', { session: { id: 'S1', reconnect_url: `ws://127.0.0.1:${t.port}/reconnect` } }));
    await until(() => t.conns.length === 2);
    expect(t.conns[1].url).toBe('/reconnect');
    t.conns[1].ws.send(welcome('S2'));
    await until(() => t.conns[0].ws.readyState === WebSocket.CLOSED);
    expect(t.posts.length).toBe(6);
    t.conns[1].ws.send(msg('notification', { subscription: { type: 'channel.subscription.gift' }, event: TW.gift }));
    await until(() => t.events.length === 1);
    expect(t.events[0]).toMatchObject({ kind: 'giftsub', rawAmount: 5 });
  });

  it('si Twitch corta la conexión, reconecta y vuelve a suscribirse', async () => {
    const t = await setup();
    twitch.start();
    await until(() => t.conns.length === 1);
    t.conns[0].ws.send(welcome('S1')); await until(() => t.posts.length === 6);
    t.conns[0].ws.close(4000);
    await until(() => t.conns.length === 2, 4000);
    t.conns[1].ws.send(welcome('S3')); await until(() => t.posts.length === 12);
    expect(t.posts[11].body.transport.session_id).toBe('S3');
  });

  it('token inválido: no conecta y lo informa', async () => {
    const t = await setup({ valid: false });
    await twitch.start();
    expect(t.hub.connectors.twitch).toMatch(/token inválido/);
    expect(t.conns.length).toBe(0);
  });

  it('OAuth: el state debe coincidir; con state correcto guarda el token', async () => {
    const t = await setup();
    expect((await twitch.acceptToken('nuevo123token', 'cualquiera')).ok).toBe(false);
    const url = new URL(twitch.authorizeUrl('http://localhost:3000/control/twitch.html'));
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(url.searchParams.get('scope')).toBe(SCOPES.join(' '));
    const r = await twitch.acceptToken('nuevo123token', url.searchParams.get('state'));
    expect(r).toMatchObject({ ok: true, login: 'streamer' });
    expect(JSON.parse(fs.readFileSync(path.join(t.dir, 't.json'), 'utf8')).access_token).toBe('nuevo123token');
    expect((await twitch.acceptToken('otro123token', url.searchParams.get('state'))).ok).toBe(false); // un state sirve una sola vez
    twitch.logout(); expect(fs.existsSync(path.join(t.dir, 't.json'))).toBe(false);
  });
});

describe('relay: webhook Ko-fi y túneles', () => {
  let relay;
  afterEach(async () => { await relay?.close(); relay = null; });
  const req = (port, p, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    r.on('error', reject); if (body) r.write(body); r.end();
  });

  it('puerto Ko-fi: valida token, suma una vez aunque Ko-fi reintente, y no expone nada más', async () => {
    const dir = tmpDir();
    relay = createRelay({ env: { KOFI_VERIFICATION_TOKEN: 'tok-kofi-123' }, port: 0, kofiPort: 0, stateFile: path.join(dir, 's.json'), twitchTokenFile: path.join(dir, 't.json'), connectors: false, quiet: true });
    const port = await relay.start(), kport = relay.kofiPort;
    expect(kport).toBeGreaterThan(0);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), got = [];
    ws.on('message', (b) => got.push(JSON.parse(b)));
    await new Promise((r) => ws.on('open', r)); ws.send(JSON.stringify({ type: 'hello', role: 'overlay', goalId: 'main' }));
    const H = { 'Content-Type': 'application/x-www-form-urlencoded' };
    expect((await req(kport, '/webhook/kofi', { method: 'POST', headers: H, body: form({ ...KOFI, verification_token: 'malo' }) })).status).toBe(401);
    expect((await req(kport, '/webhook/kofi', { method: 'POST', headers: H, body: form(KOFI) })).status).toBe(200);
    expect((await req(kport, '/webhook/kofi', { method: 'POST', headers: H, body: form(KOFI) })).status).toBe(200); // reintento
    await until(() => got.some((m) => m.type === 'event'));
    await new Promise((r) => setTimeout(r, 50));
    expect(got.filter((m) => m.type === 'event').length).toBe(1);
    expect(got.find((m) => m.type === 'event').ev).toMatchObject({ source: 'kofi', rawAmount: 3, name: 'Jo Ejemplo' });
    expect((await req(kport, '/overlay/')).status).toBe(404);
    expect((await req(kport, '/api/health')).status).toBe(404);
    ws.close();
  });

  it('puerto principal detrás de un túnel: solo /webhook/kofi responde; API, panel y WebSocket se bloquean', async () => {
    const dir = tmpDir();
    relay = createRelay({ env: { KOFI_VERIFICATION_TOKEN: 'tok-kofi-123' }, port: 0, kofiPort: null, stateFile: path.join(dir, 's.json'), twitchTokenFile: path.join(dir, 't.json'), connectors: false, quiet: true });
    const port = await relay.start(), P = { 'X-Forwarded-For': '203.0.113.7' };
    expect((await req(port, '/api/health', { headers: P })).status).toBe(403);
    expect((await req(port, '/control/', { headers: P })).status).toBe(403);
    expect((await req(port, '/api/health')).status).toBe(200);
    expect((await req(port, '/webhook/kofi', { method: 'POST', headers: { ...P, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(KOFI) })).status).toBe(200);
    await expect(new Promise((res, rej) => { const w = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { 'CF-Connecting-IP': '203.0.113.7' } }); w.on('open', res); w.on('error', rej); })).rejects.toThrow();
  });

  it('API de Twitch: estado y authorize sin Client ID', async () => {
    const dir = tmpDir();
    relay = createRelay({ env: {}, port: 0, stateFile: path.join(dir, 's.json'), twitchTokenFile: path.join(dir, 't.json'), connectors: false, quiet: true });
    const port = await relay.start();
    const st = JSON.parse((await req(port, '/api/twitch/status')).body);
    expect(st).toMatchObject({ configured: false, clientId: false, redirectUri: `http://localhost:${port}/control/twitch.html` });
    expect((await req(port, '/api/twitch/authorize')).status).toBe(400);
    expect((await req(port, '/api/twitch/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"access_token":"<x>"}' })).status).toBe(400);
  });
});
