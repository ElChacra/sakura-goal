import { describe, it, expect } from 'vitest';
import { getConfig } from '../overlay/js/config.js';
import { createState, applyEvent, undoLast, levelOf, blocksOf, percentOf } from '../overlay/js/state.js';
import { convert, tierOf } from '../overlay/js/events.js';
import { Combiner, splitEvent, merge } from '../overlay/js/director.js';

const cfg = (q = '') => getConfig(q);
const ev = (value, o = {}) => ({ id: 'e' + Math.random(), kind: 'donation', name: 'Ana', value, rawAmount: value, rawCurrency: 'USD', ts: 1, ...o });
const run = (s, e, c) => applyEvent(s, e, c);

describe('reducer', () => {
  const c = cfg('?target=500');
  it('suma y resta', () => {
    let s = createState(c);
    s = run(s, ev(20), c).state; expect(s.current).toBe(20);
    s = run(s, ev(-5), c).state; expect(s.current).toBe(15);
    s = run(s, ev(-100), c).state; expect(s.current).toBe(0);
  });
  it('no duplica por id', () => {
    let s = createState(c); const e = ev(10, { id: 'x' });
    s = run(s, e, c).state; const r = run(s, e, c);
    expect(r.state.current).toBe(10); expect(r.effects).toEqual([]);
  });
  it('isTest: no suma salvo countTestEvents; ignoreTestEvents lo descarta', () => {
    const s = createState(c), t = ev(50, { isTest: true });
    const r = run(s, t, c); expect(r.state.current).toBe(0); expect(r.effects[0].counted).toBe(false);
    expect(run(s, ev(50, { isTest: true }), cfg('?countTestEvents=1')).state.current).toBe(50);
    expect(run(s, ev(50, { isTest: true }), cfg('?ignoreTestEvents=1')).effects).toEqual([]);
  });
  it('hitos: una sola vez y un evento grande cruza 2 hitos en orden', () => {
    let s = createState(c);
    let r = run(s, ev(300), c); // 0 → 300 (60 %): cruza 25 y 50
    expect(r.effects.filter((e) => e.type === 'milestone').map((e) => e.percent)).toEqual([25, 50]);
    r = run(r.state, ev(10), c); expect(r.effects.some((e) => e.type === 'milestone')).toBe(false);
  });
  it('meta: complete una sola vez y levelUp en vueltas siguientes', () => {
    let r = run(createState(c), ev(500), c);
    expect(r.effects.filter((e) => e.type === 'complete').length).toBe(1);
    r = run(r.state, ev(500), c); expect(r.effects.map((e) => e.type)).toContain('levelUp'); expect(r.effects.map((e) => e.type)).not.toContain('complete');
  });
  it('overflow: 1100/500 → nivel 3, ≈10 bloques (20 %)', () => {
    expect(levelOf(1100, 500, c)).toBe(3);
    expect(percentOf(1100, 500, c)).toBe(20);
    expect(Math.floor(((1100 % 500) / 500) * c.blocks)).toBe(10);
  });
  it('hold: 1100/500 → nivel 1 y barra al 100 %', () => {
    const h = cfg('?onComplete=hold');
    expect(levelOf(1100, 500, h)).toBe(1); expect(blocksOf(1100, 500, h)).toBe(52); expect(percentOf(1100, 500, h)).toBe(100);
  });
  it('mínimo visual: 1 bloque si current > 0', () => { expect(blocksOf(1, 500, c)).toBe(1); expect(blocksOf(0, 500, c)).toBe(0); });
  it('deshacer revierte monto, hitos y meta', () => {
    let s = run(createState(c), ev(500), c).state;
    s = undoLast(s, c); expect(s.current).toBe(0); expect(s.milestonesFired).toEqual([]); expect(s.completedAt).toBeUndefined();
  });
});

describe('conversión y tiers', () => {
  const c = cfg('?target=500');
  it('USD, otras monedas por tabla, bits, subs', () => {
    expect(convert({ kind: 'donation', rawAmount: 5, rawCurrency: 'USD' }, c).value).toBe(5);
    const clp = cfg('?rates={"USD":1,"CLP":0.001}'); expect(convert({ kind: 'donation', rawAmount: 5000, rawCurrency: 'CLP' }, clp).value).toBe(5);
    expect(convert({ kind: 'bits', rawAmount: 500 }, c).value).toBe(5);
    expect(convert({ kind: 'sub', rawAmount: 1, tier: 'T2' }, c)).toMatchObject({ value: 10, tier: 'T2' });
    expect(convert({ kind: 'donation', rawAmount: 3, rawCurrency: 'XXX' }, c).value).toBe(0); // sin tasa → no suma
    expect(convert({ kind: 'donation', rawAmount: 3 }, c)).toMatchObject({ value: 3, rawCurrency: 'USD' }); // sin moneda → la de la meta
  });
  it('unit=count y unit=bits; count excluye tipos', () => {
    expect(convert({ kind: 'sub', rawAmount: 1 }, cfg('?unit=count')).value).toBe(1);
    expect(convert({ kind: 'bits', rawAmount: 100 }, cfg('?unit=bits')).value).toBe(100);
    expect(convert({ kind: 'follow', rawAmount: 1 }, cfg('?unit=count')).value).toBe(0);
  });
  it('mensaje: truncado y blockedWords', () => {
    expect(convert({ kind: 'donation', rawAmount: 1, message: 'x'.repeat(99) }, c).message.length).toBe(40);
    expect(convert({ kind: 'donation', rawAmount: 1, message: 'eres feo' }, cfg('?blockedWords=feo')).message).toBe('*');
  });
  it('tiers: 5→small, 15→medium, 60→mega', () => {
    expect(tierOf(5, 500, c)).toBe('small'); expect(tierOf(15, 500, c)).toBe('medium'); expect(tierOf(30, 500, c)).toBe('large'); expect(tierOf(60, 500, c)).toBe('mega');
  });
});

describe('director', () => {
  it('5 eventos en < 1.5 s → un solo combo', () => {
    const cb = new Combiner({ windowMs: 1500, holdMs: 400 }), out = [];
    for (let i = 0; i < 5; i++) { cb.add(ev(5, { id: 'c' + i }), i * 250); out.push(cb.poll(i * 250)); }
    expect(out.every((x) => x === null)).toBe(true);
    const m = cb.poll(1000 + 400); expect(m.combo).toBe(5); expect(m.value).toBe(25); expect(m.ids.length).toBe(5);
  });
  it('un evento suelto sale sin combo', () => {
    const cb = new Combiner(); cb.add(ev(5), 0); expect(cb.poll(100)).toBeNull(); expect(cb.poll(500).combo).toBeUndefined();
  });
  it('splitEvent parte en hitos y la suma se conserva', () => {
    const c = cfg('?target=500'), s = createState(c), segs = splitEvent(s, ev(300, { id: 'big' }), c); // cruza 125 y 250
    expect(segs.length).toBe(3); expect(segs.map((x) => x.value)).toEqual([125, 125, 50]);
    expect(segs.reduce((a, x) => a + x.value, 0)).toBe(300); expect(segs.map((x) => x.quiet)).toEqual([false, true, true]);
    expect(segs[0].id).toBe('big');
  });
  it('los tramos de un evento partido cuentan como UN aporte en recientes y deshacer lo revierte entero', () => {
    const c = cfg('?target=500'); let s = createState(c);
    for (const sg of splitEvent(s, ev(300, { id: 'big' }), c)) s = applyEvent(s, sg, c).state;
    expect(s.current).toBe(300); expect(s.recent.length).toBe(1); expect(s.recent[0].applied).toBe(300);
    s = undoLast(s, c); expect(s.current).toBe(0); expect(s.seenIds).toEqual([]); expect(s.milestonesFired).toEqual([]);
  });
  it('splitEvent: evento que termina justo en la meta no se parte; en 2.ª vuelta nunca', () => {
    const c = cfg('?target=500'); let s = createState(c);
    expect(splitEvent({ ...s, current: 400, milestonesFired: [25, 50, 75] }, ev(100), c).length).toBe(1);
    expect(splitEvent({ ...s, current: 600 }, ev(300), c).length).toBe(1);
  });
});
