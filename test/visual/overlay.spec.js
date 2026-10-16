// Tests visuales (plan §11.2) en un Chrome real: `npm run test:visual`.
// Usa el Chrome (o Edge) instalado; si no hay ninguno, se saltan con un aviso. Las capturas quedan en test/visual/capturas/
// para revisarlas a ojo (no se comparan píxel a píxel: las animaciones corren en tiempo real).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createRelay } from '../../relay/server.js';
import { decodePng } from './png.js';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), 'capturas');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser = null, relay, base;
for (const channel of ['chrome', 'msedge']) { try { browser = await chromium.launch({ channel }); break; } catch { /* probar el siguiente */ } }
if (!browser) console.warn('[visual] No se encontró Chrome ni Edge: tests visuales saltados');

describe.skipIf(!browser)('overlay en Chrome (plan §11.2)', () => {
  beforeAll(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sagv-'));
    relay = createRelay({ port: 0, stateFile: path.join(dir, 's.json'), twitchTokenFile: path.join(dir, 't.json'), connectors: false, quiet: true });
    base = `http://127.0.0.1:${await relay.start()}/overlay/`;
  });
  afterAll(async () => { await browser?.close(); await relay?.close(); });

  async function open(q, viewport = { width: 960, height: 270 }) {
    const ctx = await browser.newContext({ viewport }), page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(base + '?persist=0&seed=1&source=manual&' + q);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, close: () => ctx.close() };
  }
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png'), omitBackground: true });
  // todo rectángulo del widget debe caer en la rejilla de píxeles lógicos (múltiplos de u)
  const offGrid = (page, u) => page.evaluate((u) => {
    const bad = [], ok = (v) => Math.abs(v / u - Math.round(v / u)) < 0.01;
    for (const el of document.querySelectorAll('#widget, #widget *')) {
      const s = getComputedStyle(el); if (s.display === 'none' || el.tagName === 'SPAN') continue;
      const r = el.getBoundingClientRect();
      if (![r.left, r.top, r.width, r.height].every(ok)) bad.push(`${el.id || el.className || el.tagName} ${r.left},${r.top},${r.width}x${r.height}`);
    }
    return bad;
  }, u);

  it('canvas de 480·u × 135·u con image-rendering: pixelated (scale 1 y 2)', async () => {
    for (const [scale, w, h] of [[1, 960, 270], [2, 1920, 540]]) {
      const o = await open(`scale=${scale}`, { width: w, height: h });
      const c = await o.page.evaluate(() => ['back', 'front'].map((id) => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return [e.width, e.height, r.width, r.height, getComputedStyle(e).imageRendering]; }));
      expect(c).toEqual([[480, 135, w, h, 'pixelated'], [480, 135, w, h, 'pixelated']]);
      await o.close();
    }
  });

  it('ningún elemento queda en posición o tamaño fraccionario, en reposo ni a mitad de una donación mega', async () => {
    const o = await open('start=185&comboHoldMs=0');
    expect(await offGrid(o.page, 2)).toEqual([]);
    await o.page.keyboard.press('4');
    for (const ms of [150, 300, 600, 900, 1500]) { await sleep(ms - (ms > 150 ? 150 : 0)); expect(await offGrid(o.page, 2), `a los ${ms} ms`).toEqual([]); }
    await shot(o.page, '04-donacion-mega-mitad');
    expect(o.errors).toEqual([]);
    await o.close();
  });

  it('fondo transparente: alfa 0 fuera de la barra', async () => {
    const o = await open('petals=0&start=185');
    await sleep(300);
    const png = decodePng(await o.page.screenshot({ omitBackground: true }));
    expect([png.width, png.height]).toEqual([960, 270]);
    const rows = [176, 262]; // entre montos y banner, y bajo el banner (y lógica 88 y 131)
    for (const y of rows) for (let x = 0; x < 960; x += 4) expect(png.alpha(x, y), `x=${x} y=${y}`).toBe(0);
    expect(png.alpha(480, 84)).toBe(255); // dentro de la barra sí hay color
    expect(await o.page.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor])).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
    await o.close();
  });

  it('capturas de 0 %, 37 % y 100 %', async () => {
    for (const [start, name, pct] of [[0, '01-reposo-0', '0%'], [185, '02-reposo-37', '37%'], [500, '03-meta-100', '100%']]) {
      const o = await open(`start=${start}&title=NUEVO%20MICRO&onComplete=hold`);
      await sleep(400);
      expect(await o.page.textContent('#pct')).toBe(pct);
      await shot(o.page, name); await o.close();
    }
  });

  it('nombre con HTML se muestra como texto y el mensaje largo se recorta (vía relay)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 270 } }), page = await ctx.newPage();
    await page.goto(base + '?goalId=visual&seed=1&comboHoldMs=0&debug=1');
    await page.waitForFunction(() => document.querySelector('#dbg')?.textContent.includes('relay ok'));
    const name = '<img src=x onerror=alert(1)>', message = 'Este mensaje es larguísimo para comprobar que se recorta en el banner del overlay';
    await fetch(base.replace('/overlay/', '/api/event'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'donation', rawAmount: 5, name: name.slice(0, 30), message, goalId: 'visual' }) });
    await page.waitForFunction(() => document.querySelector('#bMsg').textContent.length >= 40, null, { timeout: 8000 });
    expect(await page.textContent('#bName')).toBe(name); // llega tal cual como texto: el overlay nunca lo interpreta como HTML
    expect(await page.evaluate(() => document.querySelectorAll('#widget img').length)).toBe(0);
    expect((await page.textContent('#bMsg')).length).toBe(40);
    await page.screenshot({ path: path.join(OUT, '05-banner-texto.png'), omitBackground: true });
    await ctx.close();
  });

  it('hito: banderín y banner de checkpoint', async () => {
    const o = await open('start=100&target=500&comboHoldMs=0');
    await o.page.keyboard.press('m');
    await o.page.waitForFunction(() => document.querySelector('#bName').textContent.includes('CHECKPOINT'), null, { timeout: 8000 });
    expect(await o.page.evaluate(() => [...document.querySelectorAll('.flag')].map((f) => f.dataset.m))).toEqual(['25']);
    await shot(o.page, '06-hito'); await o.close();
  });

  it('parámetros del §5.5/§5.6/§7: porcentaje en la barra, ícono izquierdo, ticker propio y tema', async () => {
    const o = await open('start=185&showPercentInBar=1&leftIcon=gem&tickerMessages=¡GRACIAS!&tickerEverySec=1&theme=sakura-night');
    await sleep(1500);
    expect(await o.page.textContent('#barPct')).toBe('37%');
    expect(await o.page.evaluate(() => getComputedStyle(document.getElementById('barPct')).display)).toBe('block');
    expect(await o.page.textContent('#ticker')).toBe('¡GRACIAS!');
    expect(await o.page.evaluate(() => document.documentElement.dataset.theme)).toBe('sakura-night');
    // el ícono izquierdo es la gema (verde menta), no el corazón rosa
    const px = await o.page.evaluate(() => { const c = document.getElementById('iconL').getContext('2d').getImageData(0, 0, 16, 16).data; const s = new Set(); for (let i = 0; i < c.length; i += 4) if (c[i + 3]) s.add(`${c[i]},${c[i + 1]},${c[i + 2]}`); return [...s]; });
    expect(px).toContain('140,242,210');
    expect(await offGrid(o.page, 2)).toEqual([]);
    await shot(o.page, '07-opciones'); await o.close();
  });

  it('resetEvery=daily: un estado guardado de otro día empieza de cero al cargar', async () => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 270 } }), page = await ctx.newPage();
    await page.goto(base + '?source=manual&goalId=diaria');
    await page.evaluate(() => localStorage.setItem('sag:diaria', JSON.stringify({ goalId: 'diaria', title: 'AYER', target: 100, current: 60, level: 1, milestonesFired: [25, 50], recent: [], totals: {}, seenIds: [], periodKey: 'daily:0', savedAt: 1 })));
    await page.goto(base + '?source=manual&goalId=diaria&resetEvery=daily&target=100');
    await sleep(400);
    expect(await page.textContent('#amounts')).toBe('$0 / $100');
    await page.goto(base + '?source=manual&goalId=diaria&target=100'); // sin resetEvery el guardado de otra sesión se respeta
    await page.evaluate(() => localStorage.setItem('sag:diaria', JSON.stringify({ goalId: 'diaria', title: 'AYER', target: 100, current: 60, level: 1, milestonesFired: [25, 50], recent: [], totals: {}, seenIds: [], periodKey: 'daily:0', savedAt: 1 })));
    await page.reload(); await sleep(400);
    expect(await page.textContent('#amounts')).toBe('$60 / $100');
    await ctx.close();
  });
});
