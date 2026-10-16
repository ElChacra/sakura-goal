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
    expect(Object.fromEntries(authUrl.searchParams)).toMatchObject({ response_type: 'token', client_id: 'cliente-publico-123', redirect_uri: base, scope: 'bits:read channel:read:subscriptions moderator:read:followers' });
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

  it('privacidad: ningún token llegó jamás al servidor de la página (ni en la URL ni en el Referer)', () => {
    const leaked = requests.filter((r) => /tokfalso|token-falso|tokencaducado|eyJ\.token|access_token/.test(r));
    expect(leaked).toEqual([]);
    expect(requests.length).toBeGreaterThan(5);
  });
});
