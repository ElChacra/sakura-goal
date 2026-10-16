import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { getConfig } from '../overlay/js/config.js';
import { createState, applyEvent, nextGoal, lapView, goldOf, periodStart, periodKey } from '../overlay/js/state.js';
import { normalizeSEWidget, fieldsToSearch, SE_BUTTONS } from '../overlay/js/sources/se-widget.js';
import { parseIrc, roleOf, parseCommand, startTwitchChat } from '../relay/connectors/twitch-chat.js';
import { createHub, sourceAllowed } from '../relay/hub.js';
import { createStore } from '../relay/store.js';
import { bundle, buildSingle, buildSE, FIELDS } from '../scripts/build.js';
import { DEFAULTS } from '../overlay/js/config.js';

const quietLog = { info() {}, warn() {}, error() {}, debug() {} };
const until = async (fn, ms = 3000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };
const ev = (value, o = {}) => ({ id: 'e' + Math.random(), kind: 'donation', name: 'Ana', value, rawAmount: value, ts: 1, ...o });

describe('metas encadenadas (next-goal)', () => {
  const cfg = getConfig('?goals=NUEVO MICRO:100,CAMARA:300');
  it('config: lista TITULO:meta, implica next-goal y la primera manda', () => {
    expect(cfg.goals).toEqual([{ title: 'NUEVO MICRO', target: 100 }, { title: 'CAMARA', target: 300 }]);
    expect(cfg.onComplete).toBe('next-goal');
    expect(getConfig('?goals=A:1&onComplete=hold').onComplete).toBe('hold');
    expect(getConfig('?goals=sin-monto,B:0,C:5').goals).toEqual([{ title: 'C', target: 5 }]);
    const s = createState(cfg); expect([s.title, s.target, s.goalIndex]).toEqual(['NUEVO MICRO', 100, 0]);
  });
  it('al completar pasa a la siguiente con el sobrante y sus hitos ya cruzados', () => {
    let s = applyEvent(createState(cfg), ev(190), cfg).state;
    expect(s.level).toBe(1); // next-goal no hace "vueltas"
    s = nextGoal(s, cfg);
    expect(s).toMatchObject({ goalIndex: 1, title: 'CAMARA', target: 300, current: 90, milestonesFired: [25] });
  });
  it('en la última meta (o sin completar) no cambia nada', () => {
    const s = createState(cfg);
    expect(nextGoal(s, cfg)).toBe(s);
    const last = { ...s, goalIndex: 1, target: 300, current: 400 };
    expect(nextGoal(last, cfg)).toBe(last);
  });
  it('el estado guardado conserva en qué meta vas', () => {
    const saved = { ...createState(cfg), goalIndex: 1, title: 'CAMARA', target: 300, current: 42 };
    expect(createState(cfg, saved)).toMatchObject({ goalIndex: 1, title: 'CAMARA', target: 300, current: 42 });
  });
  it('overflow: en múltiplos exactos la vuelta se ve completa (no "LV2 0%")', () => {
    const c = getConfig('?target=500');
    expect(lapView(500, 500, c)).toEqual({ level: 1, pct: 100 });
    expect(lapView(1000, 500, c)).toEqual({ level: 2, pct: 100 });
    expect(goldOf(1000, 500, c)).toBe(52); expect(goldOf(500, 500, c)).toBe(0); expect(goldOf(1100, 500, c)).toBe(10);
    expect(lapView(1100, 500, c)).toEqual({ level: 3, pct: 20 });
    expect(lapView(1100, 500, getConfig('?onComplete=hold'))).toEqual({ level: 1, pct: 100 });
  });
  it('validación: tema y onComplete desconocidos vuelven al defecto', () => {
    expect(getConfig('?theme=neon').theme).toBe('sakura');
    expect(getConfig('?theme=sakura-night').theme).toBe('sakura-night');
    expect(getConfig('?onComplete=explotar').onComplete).toBe('overflow');
  });
});

describe('resetEvery y parámetros sueltos del plan (§5.5, §5.6, §7)', () => {
  const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime(); // hora local
  it('periodStart: día, semana desde el lunes y mes, en hora local', () => {
    expect(periodStart('daily', at(2026, 10, 16, 23))).toBe(at(2026, 10, 16, 0));
    expect(periodStart('weekly', at(2026, 10, 18))).toBe(at(2026, 10, 12, 0)); // domingo 18 → lunes 12
    expect(periodStart('weekly', at(2026, 10, 12, 0))).toBe(at(2026, 10, 12, 0));
    expect(periodStart('monthly', at(2026, 10, 31))).toBe(at(2026, 10, 1, 0));
    expect(periodStart('none', at(2026, 10, 16))).toBe(0);
    expect(periodKey('none')).toBeUndefined();
  });
  it('estado de un período anterior empieza de cero; sin clave previa se adopta la actual', () => {
    const c = getConfig('?resetEvery=daily&target=100');
    const ayer = { ...createState(c, null, at(2026, 10, 15)), current: 80, recent: [{ id: 'x' }] };
    expect(ayer.periodKey).toBe(periodKey('daily', at(2026, 10, 15)));
    expect(createState(c, ayer, at(2026, 10, 15, 22)).current).toBe(80); // mismo día
    expect(createState(c, ayer, at(2026, 10, 16, 0)).current).toBe(0); // medianoche: de cero
    const viejo = { ...ayer, periodKey: undefined }; // activó resetEvery hoy: no se borra lo que llevaba
    expect(createState(c, viejo, at(2026, 10, 16))).toMatchObject({ current: 80, periodKey: periodKey('daily', at(2026, 10, 16)) });
    expect(createState(getConfig('?target=100'), ayer, at(2026, 12, 1)).current).toBe(80); // sin resetEvery no caduca
  });
  it('validación de leftIcon, goalIcon, resetEvery y tickerMessages', () => {
    expect(getConfig('?leftIcon=gem').leftIcon).toBe('gem'); expect(getConfig('?leftIcon=<b>').leftIcon).toBe('heart');
    expect(getConfig('?goalIcon=nada').goalIcon).toBe('star'); expect(getConfig('?resetEvery=yearly').resetEvery).toBe('none');
    expect(getConfig('?tickerMessages=last,¡GRACIAS POR EL APOYO!,remaining').tickerMessages).toEqual(['last', '¡GRACIAS POR EL APOYO!', 'remaining']);
    expect(getConfig('?tickerMessages=' + 'x'.repeat(40)).tickerMessages[0].length).toBe(27);
    expect(getConfig('?tickerMessages=').tickerMessages).toEqual(['last', 'top', 'remaining']);
  });
});

describe('widget de StreamElements', () => {
  it('normaliza tip, cheer, sub, sub regalada y bomba de regalos (sin contar receptores)', () => {
    expect(normalizeSEWidget({ listener: 'tip-latest', event: { name: 'Ana', amount: '5', message: 'hola', _id: 'x' } })[0]).toMatchObject({ id: 'se:x', kind: 'donation', rawAmount: 5, name: 'Ana' });
    expect(normalizeSEWidget({ listener: 'cheer-latest', event: { name: 'Luis', amount: 300 } })[0]).toMatchObject({ kind: 'bits', rawAmount: 300 });
    expect(normalizeSEWidget({ listener: 'subscriber-latest', event: { name: 'Mei', amount: 7, tier: '2000' } })[0]).toMatchObject({ kind: 'sub', rawAmount: 1, tier: 'T2' });
    expect(normalizeSEWidget({ listener: 'subscriber-latest', event: { name: 'Rec', gifted: true, sender: 'Nico' } })[0].name).toBe('Nico');
    expect(normalizeSEWidget({ listener: 'subscriber-latest', event: { name: 'Nico', amount: 10, bulkGifted: true, sender: 'Nico', tier: '1000' } })[0]).toMatchObject({ kind: 'giftsub', rawAmount: 10 });
    expect(normalizeSEWidget({ listener: 'subscriber-latest', event: { name: 'r1', isCommunityGift: true, gifted: true } })).toEqual([]);
    expect(normalizeSEWidget({ listener: 'kvstore:update', event: {} })).toEqual([]);
  });
  it('fields → query string: booleanos a 1/0, moneda del canal por defecto, sin relay', () => {
    const q = new URLSearchParams(fieldsToSearch({ title: 'MI META', target: 300, petals: false, sound: true, currency: '', testGoal: '' }, 'EUR'));
    expect(Object.fromEntries(q)).toEqual({ title: 'MI META', target: '300', petals: '0', sound: '1', currency: 'EUR', source: 'manual' });
    const cfg = getConfig(fieldsToSearch({ title: 'X', petalIntervalSec: 6.5, goals: 'A:10,B:20' }, 'USD'));
    expect(cfg).toMatchObject({ title: 'X', petalIntervalSec: 6.5, source: 'manual', onComplete: 'next-goal' });
  });
  it('fields.json: toda opción (salvo botones) es un parámetro real de config.js y cada botón tiene acción', () => {
    for (const [k, f] of Object.entries(FIELDS)) {
      if (f.type === 'button') expect(SE_BUTTONS[k], k).toBeDefined();
      else expect(k in DEFAULTS, k).toBe(true);
    }
  });
});

describe('builds', () => {
  it('el bundle no deja import/export y escapa </script>', () => {
    const html = buildSingle();
    const js = html.match(/<script>\n([\s\S]*)<\/script>/)[1];
    expect(js).not.toMatch(/^\s*(import|export)\b/m);
    expect(js).not.toMatch(/<\/script/i);
    expect(() => new Function(js)).not.toThrow(); // sintaxis válida como script clásico
    expect(html).toContain('data:font/woff2;base64,');
    expect(html).not.toMatch(/<link rel="stylesheet"/);
  });
  it('SE: main queda diferido hasta onWidgetLoad', () => {
    const se = buildSE();
    expect(Object.keys(se).sort()).toEqual(['fields.json', 'widget.css', 'widget.html', 'widget.js']);
    expect(se["widget.js"]).toContain("globalThis.__SAG_START = __m[\"main.js\"]");
    expect(se['widget.html']).not.toMatch(/<script/);
    expect(() => new Function(se['widget.js'])).not.toThrow();
  });
  it('falla en voz alta ante un patrón de módulo que no sabe empaquetar', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sagb-')), f = path.join(d, 'x.js');
    fs.writeFileSync(f, "export default 1;\n");
    expect(() => bundle([{ file: f }])).toThrow(/no soportado/);
  });
});

describe('comandos de chat', () => {
  it('parseIrc: tags, prefijo, comando y texto', () => {
    const m = parseIrc('@badges=moderator/1,subscriber/12;display-name=Ana;id=abc-1;mod=1 :ana!ana@ana.tmi.twitch.tv PRIVMSG #canal :!meta add 5 Juan Pérez');
    expect(m).toMatchObject({ command: 'PRIVMSG', params: ['#canal'], trailing: '!meta add 5 Juan Pérez' });
    expect(m.tags['display-name']).toBe('Ana'); expect(roleOf(m.tags)).toBe('mod');
    expect(roleOf({ badges: 'broadcaster/1' })).toBe('broadcaster'); expect(roleOf({ badges: 'vip/1' })).toBe('vip'); expect(roleOf({ badges: '' })).toBe('viewer');
    expect(parseIrc('PING :tmi.twitch.tv')).toMatchObject({ command: 'PING', trailing: 'tmi.twitch.tv' });
  });
  it('parseCommand: comandos y permisos', () => {
    const mod = { role: 'mod', user: 'Ana' };
    expect(parseCommand('!meta add 5 Juan Pérez', mod)).toEqual({ event: { kind: 'donation', rawAmount: 5, name: 'Juan Pérez', message: '' } });
    expect(parseCommand('!META sumar 2,5', mod).event).toMatchObject({ rawAmount: 2.5, name: 'Ana' });
    expect(parseCommand('!meta quitar 3', mod)).toEqual({ event: { kind: 'adjust', rawAmount: -3, name: '' } });
    expect(parseCommand('!meta set 600', mod)).toEqual({ cmd: { cmd: 'target', value: 600 } });
    expect(parseCommand('!meta titulo NUEVA SILLA', mod)).toEqual({ cmd: { cmd: 'title', value: 'NUEVA SILLA' } });
    expect(parseCommand('!meta deshacer', mod)).toEqual({ cmd: { cmd: 'undo' } });
    expect(parseCommand('!meta reset', mod)).toEqual({ denied: true });
    expect(parseCommand('!meta reset', { role: 'broadcaster' })).toEqual({ cmd: { cmd: 'reset' } });
    expect(parseCommand('!meta add 5', { role: 'viewer' })).toEqual({ denied: true });
    expect(parseCommand('!meta add 5', { role: 'vip', allow: 'vips' }).event).toBeDefined();
    expect(parseCommand('!meta add 5', { role: 'mod', allow: 'broadcaster' })).toEqual({ denied: true });
    expect(parseCommand('!meta add -5', mod)).toBeNull(); expect(parseCommand('!meta add abc', mod)).toBeNull();
    expect(parseCommand('hola !meta add 5', mod)).toBeNull(); expect(parseCommand('!metas add 5', mod)).toBeNull();
    expect(parseCommand('!goal add 5', { ...mod, prefix: '!goal' }).event).toBeDefined();
  });
  it('los aportes del chat no los bloquea el filtro de fuentes', () => {
    expect(sourceAllowed({ source: 'chat', kind: 'donation' }, { bitsFrom: 'twitch', subsFrom: 'twitch', donationsFrom: ['kofi'] })).toBe(true);
  });

  let wss, chat;
  afterEach(() => { chat?.stop(); wss?.close(); });
  it('conexión anónima: CAP/NICK/JOIN, PONG, y solo los mods mueven la meta', async () => {
    wss = new WebSocketServer({ port: 0 }); await new Promise((r) => wss.once('listening', r));
    const recv = []; let sock;
    wss.on('connection', (ws) => { sock = ws; ws.on('message', (b) => recv.push(String(b))); });
    const store = createStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sagc-')), 's.json'));
    const hub = createHub({ store, log: quietLog }), cmds = [], events = [];
    const ov = { send: (m) => (m.type === 'cmd' ? cmds : m.type === 'event' ? events : []).push(m) };
    hub.attach(ov); hub.onMessage(ov, { type: 'hello', role: 'overlay', goalId: 'main' });
    chat = startTwitchChat({ channel: '#MiCanal', hub, log: quietLog, url: `ws://127.0.0.1:${wss.address().port}` });
    await until(() => recv.some((l) => l.startsWith('JOIN')));
    expect(recv).toContain('CAP REQ :twitch.tv/tags twitch.tv/commands'); expect(recv).toContain('JOIN #micanal');
    expect(recv.find((l) => l.startsWith('NICK'))).toMatch(/^NICK justinfan\d+$/);
    sock.send(':justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #micanal\r\nPING :tmi.twitch.tv\r\n');
    await until(() => recv.includes('PONG :tmi.twitch.tv'));
    await until(() => /^conectado/.test(hub.connectors.chat));
    const msg = (badges, text, id) => `@badges=${badges};display-name=Ana;id=${id} :ana!ana@ana.tmi.twitch.tv PRIVMSG #micanal :${text}\r\n`;
    sock.send(msg('', '!meta add 100', 'v1') + msg('moderator/1', '!meta add 5 Juan', 'm1') + msg('moderator/1', '!meta add 5 Juan', 'm1') + msg('broadcaster/1', '!meta set 900', 'b1'));
    await until(() => cmds.length === 1 && events.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(events.length).toBe(1); // el espectador no suma y el mensaje repetido (mismo id) tampoco
    expect(events[0].ev).toMatchObject({ source: 'chat', kind: 'donation', rawAmount: 5, name: 'Juan', id: 'chat:m1' });
    expect(cmds[0]).toMatchObject({ type: 'cmd', cmd: 'target', value: 900 });
  });
});
