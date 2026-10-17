// Versión web pública (dist/web) en Chrome real, servida por HTTP como en GitHub Pages. `npm run build` antes.
// Las pruebas que hablan con Twitch / StreamElements / Streamlabs reales (con tokens falsos) se saltan sin internet.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/web');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser = null;
for (const channel of ['chrome', 'msedge']) { try { browser = await chromium.launch({ channel }); break; } catch { /* siguiente */ } }
const online = await fetch('https://id.twitch.tv/oauth2/validate', { signal: AbortSignal.timeout(5000) }).then(() => true, () => false);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

describe.skipIf(!browser || !fs.existsSync(WEB))('página pública (dist/web) en Chrome', () => {
  let server, base, clientId = '';
  const requests = []; // todo lo que pide el navegador al "GitHub Pages" de prueba
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests.push(req.url + ' ' + (req.headers.referer || ''));
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
      if (p === '/site-config.js') { res.writeHead(200, { 'Content-Type': MIME['.js'] }); return res.end(`window.SAG_SITE = { twitchClientId: ${JSON.stringify(clientId)} };`); }
      fs.readFile(path.join(WEB, p), (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
    });
    await new Promise((r) => server.listen(0, 'localhost', r));
    base = `http://localhost:${server.address().port}/`;
  });
  afterAll(async () => { await browser?.close(); server?.close(); });
  async function open(url, viewport = { width: 1100, height: 900 }) {
    const ctx = await browser.newContext({ viewport }), page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    return { page, ctx, errors };
  }
  const inFrame = (page) => page.frameLocator('#frame');

  it('configurar → vista previa en vivo → botones de prueba → URL para OBS', async () => {
    const { page, ctx, errors } = await open(base);
    await expect.poll(() => inFrame(page).locator('#title').textContent(), { timeout: 8000 }).toBe('NUEVO MICRO');
    await page.fill('#title', 'MI SILLA GAMER'); await page.fill('#target', '200'); await page.selectOption('#theme', 'sakura-night'); await page.selectOption('#scale', '2');
    await expect.poll(() => inFrame(page).locator('#title').textContent(), { timeout: 8000 }).toBe('MI SILLA GAMER');
    await sleep(1500); // la vista previa se recarga 0,5 s después del último cambio
    expect(await page.textContent('#w')).toBe('1920'); expect(await page.textContent('#h')).toBe('540');
    const url = new URL(await page.inputValue('#url'));
    expect(url.pathname).toBe('/overlay.html');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ title: 'MI SILLA GAMER', target: '200', theme: 'sakura-night', scale: '2' });
    expect(url.searchParams.has('preview')).toBe(false); expect(url.hash).toBe('');
    await page.getByRole('button', { name: 'Donación grande' }).click();
    await expect.poll(() => inFrame(page).locator('#amounts').textContent(), { timeout: 10000 }).toBe('$24 / $200');
    await page.screenshot({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), 'capturas', 'web-configurador.png'), fullPage: true });
    // la configuración se recuerda al volver
    await page.reload(); expect(await page.inputValue('#title')).toBe('MI SILLA GAMER');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('sin Client ID configurado, el botón de Twitch se desactiva con una explicación', async () => {
    const { page, ctx } = await open(base);
    expect(await page.isDisabled('#twGo')).toBe(true);
    expect(await page.textContent('#twSt')).toMatch(/Client ID/);
    await ctx.close();
  });

  it('Twitch OAuth: autoriza con los permisos justos, valida el state y guarda la conexión', async () => {
    clientId = 'cliente-publico-123';
    const { page, ctx } = await open(base);
    let authUrl = null;
    await page.route('https://id.twitch.tv/oauth2/authorize**', (r) => { authUrl = new URL(r.request().url()); r.fulfill({ status: 200, body: 'twitch' }); });
    await page.click('#twGo'); await expect.poll(() => authUrl, { timeout: 5000 }).not.toBeNull();
    expect(Object.fromEntries(authUrl.searchParams)).toMatchObject({ response_type: 'token', client_id: 'cliente-publico-123', redirect_uri: base, scope: 'bits:read channel:read:subscriptions moderator:read:followers channel:read:redemptions' });
    const state = authUrl.searchParams.get('state');
    await page.route('https://id.twitch.tv/oauth2/validate', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ login: 'anastreams', user_id: '9', client_id: 'cliente-publico-123', scopes: [], expires_in: 5184000 }) }));
    await page.goto(base + '#access_token=tokfalso123&state=forjado'); // state que no es el nuestro: se rechaza
    await expect.poll(() => page.textContent('#twSt')).toMatch(/no es válida/);
    await page.goto(base + `#access_token=tokfalso123&state=${state}`);
    await page.click('#twGo').catch(() => {}); // sessionStorage ya se consumió arriba: rehacemos el flujo completo
    await expect.poll(() => authUrl.searchParams.get('state') !== state, { timeout: 5000 }).toBe(true);
    await page.goto(base + `#access_token=tokfalso123&state=${authUrl.searchParams.get('state')}`);
    await expect.poll(() => page.textContent('#twSt'), { timeout: 5000 }).toMatch(/Conectado como anastreams · renueva en 60 días/);
    expect(page.url()).toBe(base); // el token se quitó de la barra de direcciones
    expect(new URL(await page.inputValue('#url')).hash).toBe('#tw=tokfalso123');
    clientId = '';
    await ctx.close();
  });

  it.skipIf(!online)('tokens falsos contra los servicios REALES: cada tarjeta dice qué falla (y CORS de Twitch funciona)', async () => {
    const { page, ctx } = await open(base);
    await expect.poll(() => inFrame(page).locator('#title').textContent(), { timeout: 8000 }).toBe('NUEVO MICRO'); // pegar el token DESPUÉS de cargar la vista previa (solo cambia el #)
    await page.fill('#se', 'eyJ.token.falso'); await page.fill('#sl', 'token-falso-streamlabs');
    await expect.poll(() => page.textContent('#seSt'), { timeout: 20000 }).toMatch(/Token rechazado/);
    await expect.poll(() => page.textContent('#slSt'), { timeout: 20000 }).toMatch(/Token rechazado/);
    // desde el origen de la página, la API de Twitch responde con CORS (si no, fetch lanzaría y no veríamos el 401)
    const st = await page.evaluate(async () => [
      (await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: 'OAuth tokenfalso' } })).status,
      (await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', { method: 'POST', headers: { 'Client-Id': 'x', Authorization: 'Bearer tokenfalso', 'Content-Type': 'application/json' }, body: '{}' })).status,
    ]);
    expect(st).toEqual([401, 401]);
    await ctx.close();
  });

  it.skipIf(!online)('overlay en OBS: token de Twitch caducado → el ticker avisa "RECONECTA TWITCH"', async () => {
    const { page, ctx, errors } = await open(base + 'overlay.html?tickerEverySec=1&tickerMessages=remaining#tw=tokencaducado', { width: 960, height: 270 });
    await expect.poll(() => page.textContent('#ticker'), { timeout: 15000 }).toBe('RECONECTA TWITCH');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('overlay en OBS: guarda el progreso entre recargas; la vista previa no lo toca', async () => {
    const { page, ctx } = await open(base + 'overlay.html?target=100&comboHoldMs=0', { width: 960, height: 270 });
    await sleep(500); await page.keyboard.press('4'); await sleep(7000);
    expect(await page.textContent('#amounts')).toBe('$12 / $100');
    await page.reload(); await sleep(600);
    expect(await page.textContent('#amounts')).toBe('$12 / $100');
    await page.goto(base + 'overlay.html?target=100&preview=1'); await sleep(600);
    expect(await page.textContent('#amounts')).toBe('$0 / $100');
    await ctx.close();
  });

  it('tipos de barra y "Tus barras": cambiar tipo, crear, alternar, recargar', async () => {
    const { page, ctx, errors } = await open(base);
    const url = async () => new URL(await page.inputValue('#url'));
    const chips = () => page.$$eval('#bars .chip', (els) => els.map((e) => (e.classList.contains('on') ? '*' : '') + e.textContent));
    await expect.poll(() => inFrame(page).locator('#title').textContent(), { timeout: 8000 }).toBe('NUEVO MICRO');
    expect((await url()).searchParams.has('goalId')).toBe(false); // "Todo junto" de siempre: conserva el progreso que ya tenía (goalId main)
    // a "Seguidores": título y meta se adaptan, la moneda se oculta y los botones de prueba cambian
    await page.click('#types [data-type="follows"]');
    expect([await page.inputValue('#title'), await page.inputValue('#target'), await page.isHidden('#wCurrency')]).toEqual(['SEGUIDORES', '100', true]);
    expect(Object.fromEntries((await url()).searchParams)).toMatchObject({ goalType: 'follows', goalId: 'main-follows', title: 'SEGUIDORES', target: '100' });
    expect((await url()).searchParams.has('currency')).toBe(false);
    expect(await page.$$eval('#tests button', (b) => b.map((x) => x.textContent))).toEqual(['Seguidor', '5 seguidores', 'Hito', 'Meta lograda', 'Viento', 'Reiniciar']);
    await expect.poll(() => inFrame(page).locator('#title').textContent(), { timeout: 8000 }).toBe('SEGUIDORES');
    await page.getByRole('button', { name: 'Seguidor', exact: true }).click();
    await expect.poll(() => inFrame(page).locator('#amounts').textContent(), { timeout: 8000 }).toBe('1 / 100');
    await sleep(3500);
    await page.getByRole('button', { name: '5 seguidores' }).click();
    await expect.poll(() => inFrame(page).locator('#amounts').textContent(), { timeout: 8000 }).toBe('6 / 100');
    expect(await inFrame(page).locator('#bAmt').textContent()).toMatch(/FOLLOW/);
    // nueva barra: toma el primer tipo libre (Donaciones), con su propio goalId
    await page.click('#newBar');
    expect(await chips()).toEqual(['💜 SEGUIDORES', '*💰 DONACIONES']);
    const u2 = await url();
    expect(u2.searchParams.get('goalType')).toBe('donations'); expect(u2.searchParams.get('goalId')).toMatch(/^b[a-z0-9]+-donations$/);
    await page.fill('#title', 'PC NUEVA'); await page.fill('#target', '800');
    await page.click('#types [data-type="bits"]'); // título y meta ya personalizados: no se pisan
    expect([await page.inputValue('#title'), await page.inputValue('#target'), (await url()).searchParams.get('goalType')]).toEqual(['PC NUEVA', '800', 'bits']);
    // volver a la primera: recupera sus ajustes
    await page.click('#bars .chip >> nth=0');
    expect([await page.inputValue('#title'), (await url()).searchParams.get('goalId')]).toEqual(['SEGUIDORES', 'main-follows']);
    // todo queda guardado al recargar
    await page.reload();
    expect(await chips()).toEqual(['*💜 SEGUIDORES', '💎 PC NUEVA']);
    page.on('dialog', (d) => d.accept());
    await page.click('#bars .chip >> nth=1'); await page.click('#delBar');
    expect(await chips()).toEqual(['*💜 SEGUIDORES']);
    expect(await page.isDisabled('#delBar')).toBe(true);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('migración: la configuración de antes (una sola barra) se convierte en "Todo junto" sin perder su progreso', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } }), page = await ctx.newPage();
    await page.goto(base);
    await page.evaluate(() => localStorage.setItem('sag-config', JSON.stringify({ f: { title: 'MI VIEJA META', target: '300', goalId: 'main', theme: 'strawberry' }, remember: true })));
    await page.reload();
    expect(await page.$$eval('#bars .chip', (e) => e.map((x) => x.textContent))).toEqual(['🌸 MI VIEJA META']);
    const u = new URL(await page.inputValue('#url'));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ title: 'MI VIEJA META', target: '300', theme: 'strawberry' });
    expect(u.searchParams.has('goalId') || u.searchParams.has('goalType')).toBe(false); // misma URL que antes → mismo progreso en OBS
    await ctx.close();
  });

  it('en OBS cada barra guarda su progreso por separado', async () => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 270 } }), page = await ctx.newPage();
    const f = base + 'overlay.html?goalType=follows&goalId=x-follows&target=100&comboHoldMs=0', d = base + 'overlay.html?goalType=donations&goalId=x-donations&target=500&comboHoldMs=0';
    await page.goto(f); await sleep(500); await page.keyboard.press('2'); await sleep(4000);
    expect(await page.textContent('#amounts')).toBe('3 / 100');
    await page.goto(d); await sleep(600);
    expect(await page.textContent('#amounts')).toBe('$0 / $500'); // otra barra: empieza en 0
    await page.keyboard.press('2'); await sleep(4000);
    await page.goto(f); await sleep(600);
    expect(await page.textContent('#amounts')).toBe('3 / 100'); // la de seguidores sigue donde estaba
    await page.goto(d); await sleep(600);
    expect(await page.textContent('#amounts')).toBe('$15 / $500');
    await ctx.close();
  });

  it('rotación: dos barras en una fuente; un sub salta a la de subs con transición y la celebra; luego rota sola', async () => {
    const { page, ctx, errors } = await open(base);
    await page.click('#types [data-type="follows"]');
    await page.click('#newBar'); await page.click('#types [data-type="subs"]');
    expect(await page.isHidden('#rotUrlBox')).toBe(true);
    await page.locator('#rotBars input').nth(0).check(); await page.locator('#rotBars input').nth(1).check(); // la lista se repinta al marcar
    await page.fill('#rotSec', '5'); await page.press('#rotSec', 'Tab');
    expect(await page.isHidden('#rotUrlBox')).toBe(false);
    const ru = new URL(await page.inputValue('#rotUrl'));
    expect(ru.searchParams.get('rotateSec')).toBe('5');
    expect(ru.searchParams.getAll('bar').map((b) => new URLSearchParams(b).get('goalType'))).toEqual(['follows', 'subs']);
    await page.click('#pvRot');
    expect(await page.$$eval('#tests button', (b) => b.map((x) => x.textContent))).toEqual(['Seguidor', '5 seguidores', 'Sub', 'Sub T3', '5 subs regaladas', 'Hito', 'Meta lograda', 'Viento', 'Reiniciar']);
    // la vista previa es el rotador con dos barras hijas
    const kids = async () => page.frames().filter((f) => f.url().includes('child=1'));
    await expect.poll(async () => (await kids()).length, { timeout: 10000 }).toBe(2);
    const shown = () => page.frame({ url: /preview=1.*load=/ }).evaluate(() => [...document.querySelectorAll('iframe')].findIndex((f) => f.style.transform === 'translateY(0px)'));
    const kid = async (type) => (await kids()).find((f) => f.url().includes('goalType=' + type));
    await expect.poll(async () => (await kid('subs'))?.evaluate(() => !!document.querySelector('#title')?.textContent), { timeout: 8000 }).toBe(true);
    expect(await shown()).toBe(0); // empieza en seguidores
    await page.getByRole('button', { name: 'Sub', exact: true }).click();
    await expect.poll(shown, { timeout: 3000 }).toBe(1); // salta a subs
    await expect.poll(async () => (await kid('subs')).textContent('#amounts'), { timeout: 8000 }).toBe('1 / 50');
    expect(await (await kid('follows')).textContent('#amounts')).toBe('0 / 100'); // a seguidores no le suma
    expect(await (await kid('subs')).textContent('#bAmt')).toMatch(/SUB/);
    await sleep(1500); expect(await shown()).toBe(1); // no cambia en plena celebración
    await expect.poll(shown, { timeout: 15000 }).toBe(0); // terminada la celebración y su turno, rota sola
    await page.getByRole('button', { name: '5 subs regaladas' }).click();
    await expect.poll(shown, { timeout: 3000 }).toBe(1);
    await expect.poll(async () => (await kid('subs')).textContent('#amounts'), { timeout: 10000 }).toBe('6 / 50');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('canjes de puntos: tipo propio, filtro de recompensas y aviso si falta conectar Twitch', async () => {
    const { page, ctx } = await open(base);
    await page.click('#types [data-type="redemptions"]');
    expect([await page.inputValue('#title'), await page.inputValue('#target'), await page.isVisible('#wRewards')]).toEqual(['CANJES', '50', true]);
    expect(await page.textContent('#typeHint')).toMatch(/Conecta Twitch/);
    await page.fill('#rewards', 'Hidratarse'); await page.press('#rewards', 'Tab');
    const u = new URL(await page.inputValue('#url'));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ goalType: 'redemptions', rewards: 'Hidratarse', title: 'CANJES' });
    await expect.poll(() => inFrame(page).locator('#title').textContent(), { timeout: 8000 }).toBe('CANJES');
    await page.getByRole('button', { name: '5 canjes' }).click();
    await expect.poll(() => inFrame(page).locator('#amounts').textContent(), { timeout: 8000 }).toBe('5 / 50');
    expect(await inFrame(page).locator('#bName').textContent()).toBe('5 CANJES');
    await page.click('#types [data-type="points"]');
    expect(await page.inputValue('#target')).toBe('100000');
    expect(await page.isVisible('#wRewards')).toBe(true);
    await ctx.close();
  });

  it('privacidad: ningún token llegó jamás al servidor de la página (ni en la URL ni en el Referer)', () => {
    const leaked = requests.filter((r) => /tokfalso|token-falso|tokencaducado|eyJ\.token|access_token/.test(r));
    expect(leaked).toEqual([]);
    expect(requests.length).toBeGreaterThan(5);
  });
});
