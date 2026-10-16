import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { normalizeSE, normalizeSETest, normalizeSL, sanitize } from '../relay/normalize.js';
import { createHub, sourceAllowed } from '../relay/hub.js';
import { createStore } from '../relay/store.js';
import { createRelay, originOk, sourceRules } from '../relay/server.js';
import { loadEnv } from '../relay/env.js';
import { mask, addSecret } from '../relay/log.js';
import { getConfig } from '../overlay/js/config.js';
import { convert } from '../overlay/js/events.js';
import { createState, applyEvent } from '../overlay/js/state.js';

const SE = JSON.parse(fs.readFileSync(new URL('./fixtures/streamelements.json', import.meta.url)));
const SL = JSON.parse(fs.readFileSync(new URL('./fixtures/streamlabs.json', import.meta.url)));
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sag-')), 'state.json');
const quietLog = { info() {}, warn() {}, error() {}, debug() {} };
const ANY = { bitsFrom: 'any', subsFrom: 'any', donationsFrom: ['any'] };

describe('normalize: StreamElements', () => {
  it('tip, cheer, sub (tier), regalo acreditado a quien regala, prime', () => {
    const [tip] = normalizeSE(SE.tip);
    expect(tip).toMatchObject({ id: 'se:6170a1b2c3d4e5f600000001', source: 'streamelements', kind: 'donation', name: 'Ana', rawAmount: 5, rawCurrency: 'USD', isTest: false });
    expect(tip.ts).toBe(Date.parse('2026-10-16T16:27:32.000Z'));
    expect(normalizeSE(SE.cheer)[0]).toMatchObject({ kind: 'bits', rawAmount: 250, name: 'Luis' });
    expect(normalizeSE(SE.sub)[0]).toMatchObject({ kind: 'sub', rawAmount: 1, tier: 'T2' }); // amount = meses, no cuenta
    expect(normalizeSE(SE.giftsub)[0]).toMatchObject({ kind: 'sub', name: 'Nico', tier: 'T1' });
    expect(normalizeSE(SE.prime)[0].tier).toBe('prime');
  });
  it('communityGiftPurchase y tipos desconocidos no suman (evita doble conteo de regalos)', () => {
    expect(normalizeSE(SE.communityGift)).toEqual([]);
    expect(normalizeSE({ type: 'host', data: {} })).toEqual([]);
    expect(normalizeSE(null)).toEqual([]);
  });
  it('event:test → isTest y mismo id dentro de 5 s (dedupe de repeticiones)', () => {
    const a = normalizeSETest(SE.test, 10_000), b = normalizeSETest(SE.test, 12_000), c = normalizeSETest(SE.test, 16_000);
    expect(a[0]).toMatchObject({ kind: 'donation', rawAmount: 7, isTest: true, name: 'Prueba' });
    expect(a[0].id).toBe(b[0].id); expect(c[0].id).not.toBe(a[0].id);
    expect(normalizeSETest({ listener: 'otra-cosa', event: {} })).toEqual([]);
  });
});

describe('normalize: Streamlabs', () => {
  it('donación de prueba del apéndice A', () => {
    const [d] = normalizeSL(SL.donation[1]);
    expect(d).toMatchObject({ id: 'sl:abc123', kind: 'donation', name: 'Ana', rawAmount: 5, rawCurrency: 'USD', message: 'Mensaje de prueba', isTest: true });
  });
  it('monto como texto y moneda en minúsculas', () => { expect(normalizeSL(SL.donationEUR[1])[0]).toMatchObject({ rawAmount: 12.5, rawCurrency: 'EUR' }); });
  it('bits, varias subs por mensaje (tier 3000 y Prime regalada)', () => {
    expect(normalizeSL(SL.bits[1])[0]).toMatchObject({ kind: 'bits', rawAmount: 100, name: 'Luis' });
    const subs = normalizeSL(SL.subs[1]);
    expect(subs.map((s) => [s.tier, s.name])).toEqual([['T3', 'Mei'], ['prime', 'Nico']]);
  });
  it('subMysteryGift no suma; sin _id se usa event_id + índice', () => {
    expect(normalizeSL(SL.mystery[1])).toEqual([]);
    expect(normalizeSL(SL.noIds[1]).map((e) => e.id)).toEqual(['sl:evt_multi:0', 'sl:evt_multi:1']);
  });
  it('de punta a punta: fixture → convert → reducer', () => {
    const cfg = getConfig('?target=500&countTestEvents=1');
    let s = createState(cfg);
    for (const raw of [...normalizeSL(SL.donation[1]), ...normalizeSL(SL.bits[1]), ...normalizeSE(SE.sub)]) s = applyEvent(s, convert(raw, cfg), cfg).state;
    expect(s.current).toBe(5 + 1 + 10); // $5 + 100 bits·0,01 + sub T2 (valor por defecto editable)
  });
});

describe('sanitize', () => {
  it('rechaza tipos desconocidos y montos absurdos; recorta textos', () => {
    expect(sanitize({ kind: 'hack', rawAmount: 1 })).toBeNull();
    expect(sanitize({ kind: 'donation', rawAmount: 1e12 })).toBeNull();
    const s = sanitize({ kind: 'donation', rawAmount: '5', name: 'x'.repeat(99), message: 'y'.repeat(999), rawCurrency: '<script>', tier: 'T9' });
    expect(s.rawAmount).toBe(5); expect(s.name.length).toBe(30); expect(s.message.length).toBe(200);
    expect(s.rawCurrency).toBeUndefined(); expect(s.tier).toBeUndefined();
  });
});

describe('hub', () => {
  const mkHub = (rules = ANY, file = tmp()) => { const store = createStore(file); return { hub: createHub({ store, log: quietLog, rules }), store, file }; };
  const client = () => { const c = { msgs: [], send: (m) => c.msgs.push(m) }; return c; };

  it('deduplica por id (reconexiones de sockets)', () => {
    const { hub } = mkHub(), o = client(); hub.attach(o); hub.onMessage(o, { type: 'hello', role: 'overlay', goalId: 'main' });
    const [ev] = normalizeSE(SE.tip);
    expect(hub.intake(ev).ok).toBe(true); expect(hub.intake(ev).reason).toBe('duplicate');
    expect(o.msgs.filter((m) => m.type === 'event').length).toBe(1);
  });
  it('bitsFrom/subsFrom: una sola fuente para bits y subs; manual siempre pasa', () => {
    const rules = { bitsFrom: 'streamelements', subsFrom: 'streamelements', donationsFrom: ['streamelements', 'streamlabs'] };
    expect(sourceAllowed({ source: 'streamlabs', kind: 'bits' }, rules)).toBe(false);
    expect(sourceAllowed({ source: 'streamelements', kind: 'bits' }, rules)).toBe(true);
    expect(sourceAllowed({ source: 'streamlabs', kind: 'donation' }, rules)).toBe(true);
    expect(sourceAllowed({ source: 'kofi', kind: 'donation' }, rules)).toBe(false);
    expect(sourceAllowed({ source: 'manual', kind: 'bits' }, rules)).toBe(true);
    const { hub } = mkHub(rules);
    expect(hub.intake(normalizeSL(SL.bits[1])[0]).reason).toBe('filtered');
  });
  it('sourceRules: por defecto el primer servicio configurado', () => {
    expect(sourceRules({ STREAMLABS_SOCKET_TOKEN: 'x' }).bitsFrom).toBe('streamlabs');
    expect(sourceRules({ STREAMLABS_SOCKET_TOKEN: 'x', STREAMELEMENTS_JWT: 'y' }).subsFrom).toBe('streamelements');
    expect(sourceRules({}).bitsFrom).toBe('any');
    expect(sourceRules({ BITS_FROM: 'Twitch' }).bitsFrom).toBe('twitch');
  });
  it('snapshot: entrega estado guardado + pendientes no vistos; reset y deshacer no se re-aplican', () => {
    const { hub } = mkHub(), o = client(); hub.attach(o);
    hub.onMessage(o, { type: 'hello', role: 'overlay', goalId: 'main' });
    expect(o.msgs[0]).toMatchObject({ type: 'snapshot', state: null, pending: [] });
    const a = hub.intake({ kind: 'donation', rawAmount: 5, source: 'manual' }).id, b = hub.intake({ kind: 'donation', rawAmount: 7, source: 'manual' }).id;
    hub.onMessage(o, { type: 'state', state: { goalId: 'main', current: 5, seenIds: [a], savedAt: 2 } });
    hub.onMessage(o, { type: 'state', state: { goalId: 'main', current: 0, seenIds: [], savedAt: 1 } }); // más viejo: se ignora
    expect(hub.snapshot('main')).toMatchObject({ state: { current: 5 } });
    expect(hub.snapshot('main').pending.map((e) => e.id)).toEqual([b]);
    hub.onMessage(o, { type: 'undone', ids: [b] }); expect(hub.snapshot('main').pending).toEqual([]);
    hub.intake({ kind: 'donation', rawAmount: 1, source: 'manual' });
    hub.onMessage(o, { type: 'reset' }); expect(hub.snapshot('main').pending).toEqual([]);
  });
  it('una meta nueva no absorbe aportes viejos de otra', () => {
    const { hub } = mkHub(), o = client(); hub.attach(o);
    hub.onMessage(o, { type: 'hello', role: 'overlay', goalId: 'main' });
    hub.intake({ kind: 'donation', rawAmount: 5, source: 'manual' });
    expect(hub.snapshot('main').pending.length).toBe(1);
    expect(hub.snapshot('otra').pending).toEqual([]);
  });
  it('comandos del panel van solo a overlays de su meta; eventos del panel pasan por intake', () => {
    const { hub } = mkHub(), o1 = client(), o2 = client(), ctl = client();
    [o1, o2, ctl].forEach((c) => hub.attach(c));
    hub.onMessage(o1, { type: 'hello', role: 'overlay', goalId: 'main' }); hub.onMessage(o2, { type: 'hello', role: 'overlay', goalId: 'b' });
    hub.onMessage(ctl, { type: 'hello', role: 'control', goalId: 'main' });
    hub.onMessage(ctl, { type: 'cmd', cmd: 'key', key: '4' });
    hub.onMessage(ctl, { type: 'cmd', cmd: 'event', ev: { kind: 'donation', rawAmount: 3, name: 'Ana', id: 'forjado' } });
    expect(o1.msgs.some((m) => m.type === 'cmd' && m.key === '4')).toBe(true);
    expect(o2.msgs.some((m) => m.type === 'cmd' && m.key === '4')).toBe(false);
    const ev = o1.msgs.find((m) => m.type === 'event').ev;
    expect(ev).toMatchObject({ source: 'manual', rawAmount: 3, goalId: 'main' }); expect(ev.id).not.toBe('forjado');
    hub.onMessage(o1, { type: 'status', current: 3 });
    expect(ctl.msgs.some((m) => m.type === 'status' && m.current === 3)).toBe(true);
  });
  it('el estado persiste en disco y sobrevive a un reinicio', () => {
    const { hub, store, file } = mkHub(), o = client(); hub.attach(o);
    hub.onMessage(o, { type: 'hello', role: 'overlay', goalId: 'main' });
    hub.onMessage(o, { type: 'state', state: { goalId: 'main', current: 42, seenIds: [], savedAt: 9 } });
    hub.intake({ id: 'se:x', kind: 'donation', rawAmount: 1, source: 'streamelements' });
    store.flush();
    const again = mkHub(ANY, file);
    expect(again.hub.snapshot('main').state.current).toBe(42);
    expect(again.hub.intake({ id: 'se:x', kind: 'donation', rawAmount: 1, source: 'streamelements' }).reason).toBe('duplicate');
  });
});

describe('utilidades', () => {
  it('store: archivo corrupto se aparta y se empieza de cero', () => {
    const f = tmp(); fs.writeFileSync(f, '{roto');
    const s = createStore(f); expect(s.data.goals).toEqual({});
    expect(fs.readdirSync(path.dirname(f)).some((n) => n.startsWith('state.json.bad-'))).toBe(true);
  });
  it('log: enmascara tokens registrados y de URL', () => {
    addSecret('supersecreto123');
    expect(mask('error con supersecreto123')).toBe('error con ***');
    expect(mask('wss://x/?token=abc.def&EIO=4')).toBe('wss://x/?token=***&EIO=4');
  });
  it('env: lee .env, ignora comentarios y respeta variables del sistema', () => {
    const f = tmp(); fs.writeFileSync(f, '# c\nPORT=4000\nSTREAMELEMENTS_JWT="abc"\nHOST=\n');
    expect(loadEnv(f, {})).toMatchObject({ PORT: '4000', STREAMELEMENTS_JWT: 'abc', HOST: '' });
    expect(loadEnv(f, { PORT: '5000' }).PORT).toBe('5000');
  });
  it('originOk: solo localhost', () => {
    expect(originOk(undefined)).toBe(true); expect(originOk('http://127.0.0.1:3000')).toBe(true); expect(originOk('http://localhost')).toBe(true);
    expect(originOk('https://evil.com')).toBe(false); expect(originOk('http://127.0.0.1.evil.com')).toBe(false);
  });
});

describe('relay de punta a punta (HTTP + WebSocket)', () => {
  let relay;
  afterEach(async () => { await relay?.close(); relay = null; });
  const open = (port, origin) => new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { origin } : {}); const msgs = [];
    ws.on('message', (b) => msgs.push(JSON.parse(b))); ws.on('open', () => res({ ws, msgs })); ws.on('error', rej);
  });
  const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };

  it('sirve el overlay, entrega snapshot, reparte eventos REST y bloquea orígenes ajenos', async () => {
    relay = createRelay({ port: 0, stateFile: tmp(), connectors: false, quiet: true });
    const port = await relay.start(), base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/overlay/`)).status).toBe(200);
    expect((await fetch(`${base}/overlay/js/sources/relay.js`)).headers.get('content-type')).toContain('javascript');
    expect((await fetch(`${base}/.env`)).status).toBe(404);
    expect((await fetch(`${base}/overlay/../package.json`)).status).toBe(404);

    const { ws, msgs } = await open(port, base);
    ws.send(JSON.stringify({ type: 'hello', role: 'overlay', goalId: 'main' }));
    await until(() => msgs.some((m) => m.type === 'snapshot'));

    const r = await fetch(`${base}/api/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'donation', rawAmount: 5, name: 'Ana' }) });
    expect((await r.json()).ok).toBe(true);
    await until(() => msgs.some((m) => m.type === 'event'));
    expect(msgs.find((m) => m.type === 'event').ev).toMatchObject({ kind: 'donation', rawAmount: 5, name: 'Ana', source: 'manual' });

    expect((await fetch(`${base}/api/event`, { method: 'POST', body: '{"kind":"nope"}' })).status).toBe(400);
    expect((await fetch(`${base}/api/event`, { method: 'POST', headers: { Origin: 'https://evil.com' }, body: '{}' })).status).toBe(403);
    await expect(open(port, 'https://evil.com')).rejects.toThrow();
    expect((await (await fetch(`${base}/api/health`)).json())).toMatchObject({ ok: true, overlays: 1 });
    ws.close();
  });

  it('si el puerto está ocupado prueba el siguiente', async () => {
    relay = createRelay({ port: 0, stateFile: tmp(), connectors: false, quiet: true });
    const p1 = await relay.start();
    const r2 = createRelay({ port: p1, stateFile: tmp(), connectors: false, quiet: true });
    const p2 = await r2.start(); expect(p2).toBe(p1 + 1); await r2.close();
  });
});
