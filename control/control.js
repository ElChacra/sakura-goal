import { connectRelay } from '../overlay/js/sources/relay.js';
const $ = (id) => document.getElementById(id);
let bc, relay = null, last = null, lastSeen = 0, paused = false, sound = false;
// Dos caminos al overlay: el relay (WebSocket, funciona entre OBS y cualquier navegador) o BroadcastChannel (mismo navegador).
// Los comandos van por UNO solo para no ejecutarse dos veces: relay si está conectado.
function connect() {
  bc?.close(); bc = new BroadcastChannel('sag-' + $('goalId').value);
  bc.onmessage = (m) => { if (m.data?.cmd === 'status') onStatus(m.data); }; bc.postMessage({ cmd: 'hello' });
  relay?.send({ type: 'hello', role: 'control', goalId: $('goalId').value });
}
const send = (o) => (relay?.up ? relay.send({ type: 'cmd', ...o }) : bc.postMessage(o));
const CONN = { conectado: 'on', 'no configurado': 'off' };
let info = { connectors: {} };
function onRelay(r = info) { // lista de conexiones (textContent siempre)
  info = r; const ul = $('conn'); ul.textContent = '';
  const rows = { relay: relay?.up ? `conectado · ${r.overlays ?? 0} overlay(s)` : 'sin conexión (se usa BroadcastChannel)', ...(relay?.up ? r.connectors : {}) };
  for (const [k, v] of Object.entries(rows)) {
    const li = document.createElement('li'); li.className = k === 'relay' ? (relay?.up ? 'on' : 'off') : CONN[v] ?? 'warn'; li.textContent = `${k}: ${v}`; ul.appendChild(li);
  }
}
if (/^https?:$/.test(location.protocol)) {
  relay = connectRelay(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`, () => ({ type: 'hello', role: 'control', goalId: $('goalId').value }), {
    link: () => onRelay(), relay: onRelay, status: onStatus,
  });
}
const fmt = (n) => (last?.unit === 'currency' ? '$' : '') + (Math.round(n * 100) / 100).toLocaleString(last?.locale || 'es');
function onStatus(s) {
  last = s; lastSeen = Date.now(); paused = s.paused; sound = s.sound;
  $('stTitle').textContent = s.title; $('stNums').textContent = `${fmt(s.current)} / ${fmt(s.target)} · ${s.pct}% · nivel ${s.level}`;
  const ul = $('stRecent'); ul.textContent = '';
  for (const e of s.recent) { const li = document.createElement('li'); li.textContent = `${e.name} ${e.label}`; ul.appendChild(li); } // textContent: nunca innerHTML
  $('pause').textContent = paused ? '▶ Reanudar cola' : '⏸ Pausar cola'; $('sound').textContent = sound ? '🔊 Sonido activo' : '🔇 Sonido';
  if (document.activeElement !== $('target')) $('target').value = s.target;
  if (document.activeElement !== $('title')) $('title').value = s.title;
  refreshUrl();
}
setInterval(() => $('dot').classList.toggle('on', Date.now() - lastSeen < 5000), 1000);
$('goalId').onchange = connect;

const ev = (o) => send({ cmd: 'event', ev: { source: 'manual', rawCurrency: last?.currency, ...o } });
document.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => ev({ kind: $('kind').value, rawAmount: $('kind').value === 'sub' ? 1 : Number(b.dataset.q), name: $('nm').value || 'Control', message: $('msg').value })));
$('send').onclick = () => ev({ kind: $('kind').value, rawAmount: $('kind').value === 'sub' ? 1 : Number($('amt').value) || 0, name: $('nm').value, message: $('msg').value });
$('adj').onclick = () => ev({ kind: 'adjust', rawAmount: Number($('amt').value) || 0, name: '' });
const TESTS = [['1', 'Donación 1%'], ['2', '3%'], ['3', '7%'], ['4', '12%'], ['b', 'Bits'], ['s', 'Sub'], ['p', 'Pétalos'], ['w', 'Ráfaga'], ['f', 'Flor'], ['m', 'Hito'], ['c', 'Meta lograda'], ['n', 'Banner'], ['x', 'Combo'], ['t', 'Tormenta']];
for (const [k, label] of TESTS) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => send({ cmd: 'key', key: k }); $('tests').appendChild(b); }
$('setT').onclick = () => send({ cmd: 'target', value: $('target').value }); $('setN').onclick = () => send({ cmd: 'title', value: $('title').value });
$('undo').onclick = () => send({ cmd: 'undo' }); $('pause').onclick = () => send({ cmd: 'pause', value: !paused }); $('sound').onclick = () => send({ cmd: 'sound', value: !sound });
$('reset').onclick = () => confirm('¿Reiniciar la meta a su valor inicial?') && send({ cmd: 'reset' });

function overlayUrl() {
  const u = new URL('../overlay/', location.href), q = u.searchParams;
  q.set('goalId', $('goalId').value); if (last) { q.set('target', last.target); q.set('title', last.title); }
  if ($('scale').value !== '1') q.set('scale', $('scale').value); if ($('pi').value !== '4') q.set('petalIntervalSec', $('pi').value);
  return u.href;
}
function refreshUrl() { $('url').textContent = overlayUrl(); }
$('copy').onclick = async () => { try { await navigator.clipboard.writeText(overlayUrl()); $('copy').textContent = '¡Copiada!'; } catch { $('url').textContent = overlayUrl(); } setTimeout(() => ($('copy').textContent = 'Copiar URL del overlay'), 1500); };
['scale', 'pi'].forEach((id) => ($(id).oninput = refreshUrl));
connect(); refreshUrl();
