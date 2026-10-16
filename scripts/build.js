// Builds de la Fase 5 (sin dependencias):
//   dist/overlay.single.html        todo en un archivo (CSS, JS y fuente en base64): funciona abriéndolo con file:// en OBS
//   dist/streamelements-widget/     pestañas HTML / CSS / JS / Fields para un Custom Widget de StreamElements
// Empaquetador mínimo: cada módulo de overlay/js se envuelve en una función y sus `import { a, b as c } from './x.js'`
// pasan a leer de un registro. Solo admite los patrones que usa este proyecto; si encuentra otro, falla en voz alta.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OV = path.join(ROOT, 'overlay'), JS = path.join(OV, 'js'), DIST = path.join(ROOT, 'dist');
const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?[ \t]*$/gm;
const EXPORT = /^export\s+(function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;
const id = (file) => path.relative(JS, file).split(path.sep).join('/');

function order(entries) { // orden topológico de dependencias
  const out = [], seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return; seen.add(file);
    for (const [, , spec] of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) visit(path.resolve(path.dirname(file), spec));
    out.push(file);
  };
  entries.forEach(visit);
  return out;
}

function wrap(file, deferred) {
  const exports = [];
  let src = fs.readFileSync(file, 'utf8')
    .replace(IMPORT, (_, names, spec) => `const { ${names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': ')).join(', ')} } = __m[${JSON.stringify(id(path.resolve(path.dirname(file), spec)))}];`)
    .replace(EXPORT, (_, kw, name) => { exports.push(name); return `${kw} ${name}`; });
  if (/^\s*(import|export)\b/m.test(src) || /\bimport\s*\(|import\.meta/.test(src)) throw new Error(`build: patrón de módulo no soportado en ${id(file)}`);
  const key = JSON.stringify(id(file));
  // diferido: se registra y se publica como __SAG_START en el acto, antes de que corra el anfitrión que lo arranca
  return deferred ? `__m[${key}] = function () {\n${src}\n};\nglobalThis.__SAG_START = __m[${key}];\n` : `__m[${key}] = (() => {\n${src}\nreturn { ${exports.join(', ')} };\n})();\n`;
}

// entries: [{ file, deferred }]. Un módulo "deferred" (main.js en SE y en la web) no se ejecuta hasta llamar a globalThis.__SAG_START().
// Debe ir antes que su anfitrión en `entries` (el orden de dependencias lo respeta).
export function bundle(entries) {
  const deferred = new Set(entries.filter((e) => e.deferred).map((e) => e.file));
  const files = order(entries.map((e) => e.file));
  const body = files.map((f) => wrap(f, deferred.has(f))).join('\n');
  return `/* Sakura Arcade Goal — build generado por scripts/build.js; edita overlay/js, no este archivo */\n(() => {\n'use strict';\nconst __m = {};\n${body}\n})();\n`;
}

function css() {
  const font = fs.readFileSync(path.join(OV, 'assets/fonts/PressStart2P-Regular.woff2')).toString('base64');
  return ['tokens.css', 'bar.css', 'anim.css'].map((f) => fs.readFileSync(path.join(OV, 'css', f), 'utf8')).join('\n')
    .replace("url('../assets/fonts/PressStart2P-Regular.woff2')", `url(data:font/woff2;base64,${font})`);
}
const LICENSE = '<!-- Fuente: Press Start 2P (c) CodeMan38, SIL Open Font License 1.1 (overlay/assets/fonts/OFL-LICENSE.txt) -->';
const scriptSafe = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const readIndex = () => fs.readFileSync(path.join(OV, 'index.html'), 'utf8').replace(/\r\n/g, '\n'); // tolera CRLF (editores de Windows)

// index.html con CSS, fuente y JS dentro. `js` sustituye al <script type="module"> del original.
function inlineOverlay(js) {
  const html = readIndex();
  const links = html.match(/^\s*<link rel="stylesheet"[^>]*>\s*$/gm);
  if (links?.length !== 3 || !html.includes('<script type="module" src="js/main.js"></script>')) throw new Error('build: index.html cambió de forma inesperada');
  return html.replace(links.join('\n'), `${LICENSE}\n<style>\n${css()}\n</style>`)
    .replace('<script type="module" src="js/main.js"></script>', () => js);
}

export function buildSingle() {
  return inlineOverlay(`<script>\n${scriptSafe(bundle([{ file: path.join(JS, 'main.js') }]))}</script>`);
}

// Versión web pública (dist/web/): página de configuración + overlay que se conecta solo a Twitch / StreamElements / Streamlabs.
// socket.io (MIT) va dentro del overlay para no depender de ningún CDN.
const WEB = path.join(ROOT, 'web');
export function buildWeb() {
  const io = fs.readFileSync(path.join(ROOT, 'node_modules/socket.io-client/dist/socket.io.min.js'), 'utf8');
  const js = scriptSafe(bundle([{ file: path.join(JS, 'main.js'), deferred: true }, { file: path.join(JS, 'hosts/direct.js') }]));
  const overlay = inlineOverlay(`<script>\n${scriptSafe(io)}\n</script>\n<script>\n${js}</script>`)
    .replace('<meta name="viewport"', '<meta name="referrer" content="no-referrer">\n<meta name="viewport"'); // el #token jamás sale en un Referer
  const licencias = ['Sakura Arcade Goal — licencias de terceros', '',
    '== Press Start 2P (fuente) ==', fs.readFileSync(path.join(OV, 'assets/fonts/OFL-LICENSE.txt'), 'utf8'), '',
    '== Socket.IO client 4.8.1 ==', 'MIT License — (c) 2014-2024 Guillermo Rauch. https://github.com/socketio/socket.io/blob/main/LICENSE'].join('\n');
  return {
    'index.html': fs.readFileSync(path.join(WEB, 'index.html'), 'utf8'), 'app.js': fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'),
    'site-config.js': fs.readFileSync(path.join(WEB, 'site-config.js'), 'utf8'), 'overlay.html': overlay, 'licencias.txt': licencias, '.nojekyll': '',
  };
}

// Fields del widget de SE: mismos nombres que los parámetros de config.js (sección 7 del plan)
const G = { meta: 'Meta', look: 'Aspecto', anim: 'Animaciones', calc: 'Conversión', test: 'Pruebas' };
export const FIELDS = {
  title: { type: 'text', label: 'Título (máx. 24)', value: 'META', group: G.meta },
  target: { type: 'number', label: 'Meta', value: 500, min: 1, group: G.meta },
  goals: { type: 'text', label: 'Metas encadenadas (TITULO:500,OTRA:1000) — vacío = una sola', value: '', group: G.meta },
  onComplete: { type: 'dropdown', label: 'Al llegar al 100 %', value: 'overflow', options: { overflow: 'Seguir contando (nivel 2, barra dorada)', hold: 'Quedarse llena', 'next-goal': 'Pasar a la siguiente meta', reset: 'Reiniciar tras 10 s' }, group: G.meta },
  unit: { type: 'dropdown', label: 'Qué mide la barra', value: 'currency', options: { currency: 'Dinero', bits: 'Bits', count: 'Cantidad (subs/follows)' }, group: G.meta },
  currency: { type: 'text', label: 'Moneda (vacío = la del canal)', value: '', group: G.meta },
  milestones: { type: 'text', label: 'Hitos en %', value: '25,50,75', group: G.meta },
  goalId: { type: 'text', label: 'ID de la meta (cámbialo para tener varias barras)', value: 'main', group: G.meta },
  resetEvery: { type: 'dropdown', label: 'Reiniciar la meta automáticamente', value: 'none', options: { none: 'Nunca', daily: 'Cada día', weekly: 'Cada semana (lunes)', monthly: 'Cada mes' }, group: G.meta },
  tickerMessages: { type: 'text', label: 'Mensajes que rotan (last, top, remaining o textos tuyos, separados por comas)', value: 'last,top,remaining', group: G.look },
  showPercentInBar: { type: 'checkbox', label: 'Porcentaje dentro de la barra', value: false, group: G.look },
  leftIcon: { type: 'dropdown', label: 'Ícono izquierdo', value: 'heart', options: { heart: 'Corazón', star: 'Estrella', gift: 'Regalo', trophy: 'Trofeo', gem: 'Gema', flower: 'Flor' }, group: G.look },
  theme: { type: 'dropdown', label: 'Tema', value: 'sakura', options: { sakura: 'Sakura', bubblegum: 'Bubblegum', strawberry: 'Strawberry', 'sakura-night': 'Sakura Night' }, group: G.look },
  scale: { type: 'dropdown', label: 'Escala (tamaño del widget)', value: '1', options: { 1: '1 → 960×270', 2: '2 → 1920×540', 3: '3 → 2880×810', 4: '4 → 3840×1080' }, group: G.look },
  goalIcon: { type: 'dropdown', label: 'Ícono de la meta', value: 'star', options: { star: 'Estrella', gift: 'Regalo', trophy: 'Trofeo', heart: 'Corazón' }, group: G.look },
  lang: { type: 'dropdown', label: 'Idioma', value: 'es', options: { es: 'Español', en: 'English' }, group: G.look },
  retroFps: { type: 'dropdown', label: 'FPS de dibujo', value: '60', options: { 60: '60', 30: '30 (más retro, menos CPU)', 15: '15' }, group: G.look },
  petals: { type: 'checkbox', label: 'Pétalos cayendo', value: true, group: G.anim },
  petalIntervalSec: { type: 'slider', label: 'Cada cuántos segundos caen pétalos', value: 4, min: 1, max: 30, step: 0.5, group: G.anim },
  petalLanding: { type: 'checkbox', label: 'Pétalos que se posan en la barra', value: false, group: G.anim },
  showMessage: { type: 'checkbox', label: 'Mostrar mensaje del donante', value: true, group: G.anim },
  sound: { type: 'checkbox', label: 'Sonido chiptune', value: false, group: G.anim },
  volume: { type: 'slider', label: 'Volumen', value: 0.15, min: 0, max: 1, step: 0.05, group: G.anim },
  bitsRate: { type: 'number', label: 'Valor de 1 bit en tu moneda', value: 0.01, step: 0.001, group: G.calc },
  subRates: { type: 'text', label: 'Valor por sub (JSON)', value: '{"T1":5,"T2":10,"T3":25,"prime":5}', group: G.calc },
  countTestEvents: { type: 'checkbox', label: 'Sumar los eventos de prueba (emular)', value: false, group: G.calc },
  testSmall: { type: 'button', label: 'Probar donación', value: '', group: G.test },
  testMega: { type: 'button', label: 'Probar donación MEGA', value: '', group: G.test },
  testBits: { type: 'button', label: 'Probar bits', value: '', group: G.test },
  testSub: { type: 'button', label: 'Probar sub', value: '', group: G.test },
  testMilestone: { type: 'button', label: 'Probar hito', value: '', group: G.test },
  testGoal: { type: 'button', label: 'Probar meta lograda', value: '', group: G.test },
  undoLast: { type: 'button', label: 'Deshacer último aporte', value: '', group: G.test },
  resetGoal: { type: 'button', label: 'Reiniciar meta a 0', value: '', group: G.test },
};

export function buildSE() {
  const html = readIndex();
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/\s*<script[^>]*><\/script>\s*/, '\n').trim();
  // SE puede insertar la pestaña JS en línea dentro de <script>: se escapan los "</script" del código (p. ej. la cadena de prueba de inyección)
  const js = scriptSafe(bundle([{ file: path.join(JS, 'main.js'), deferred: true }, { file: path.join(JS, 'hosts/streamelements.js') }]));
  return { 'widget.html': `${LICENSE}\n${body}\n`, 'widget.css': css(), 'widget.js': js, 'fields.json': JSON.stringify(FIELDS, null, 2) + '\n' };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  fs.mkdirSync(path.join(DIST, 'streamelements-widget'), { recursive: true });
  const single = buildSingle();
  fs.writeFileSync(path.join(DIST, 'overlay.single.html'), single);
  for (const [name, text] of Object.entries(buildSE())) fs.writeFileSync(path.join(DIST, 'streamelements-widget', name), text);
  fs.copyFileSync(path.join(OV, 'assets/fonts/OFL-LICENSE.txt'), path.join(DIST, 'OFL-LICENSE.txt'));
  const web = path.join(DIST, 'web');
  fs.mkdirSync(path.join(web, 'fonts'), { recursive: true });
  for (const [name, text] of Object.entries(buildWeb())) fs.writeFileSync(path.join(web, name), text);
  fs.copyFileSync(path.join(OV, 'assets/fonts/PressStart2P-Regular.woff2'), path.join(web, 'fonts/PressStart2P-Regular.woff2'));
  const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
  console.log(`dist/overlay.single.html (${kb(single)})\ndist/streamelements-widget/ (widget.html, widget.css, widget.js, fields.json)
dist/web/ (página pública: súbela a GitHub Pages)`);
}
