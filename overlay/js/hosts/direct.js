// Anfitrión de la versión web pública (dist/web/overlay.html). Sin servidor: el overlay se conecta solo a los servicios.
// Config en ?query (título, meta, tema…) y tokens en el #fragmento: el navegador NUNCA envía el # al servidor de la página.
// Tres modos:
//   normal   una barra.
//   rotador  ?bar=<query>&bar=<query>…  varias barras en una fuente: se turnan cada rotateSec y, si llega un aporte para una
//            que no se ve, salta a ella. Abre las conexiones UNA vez (Twitch limita las sesiones) y reparte los eventos.
//   hija     ?child=1  (dentro del rotador) sin conexiones; recibe eventos del rotador y pide paso antes de animar.
// ?preview=1 (vista previa de la página de configuración): no guarda progreso y escucha comandos de prueba del padre.
import { startDirectSE, startDirectSL, startDirectTwitch, twitchSource } from '../sources/direct.js';
import { sourceAllowed } from '../../../relay/hub.js';

const secrets = new URLSearchParams(location.hash.slice(1)), q = new URLSearchParams(location.search);
const preview = q.get('preview') === '1', child = q.get('child') === '1', bars = q.getAll('bar');
const fromParent = (m) => m.source === window.parent && m.origin === location.origin && m.data && typeof m.data === 'object';
const toParent = (msg) => { if (window.parent !== window) window.parent.postMessage(msg, location.origin); };
// Si un token deja de valer, el ticker lo avisa (mejor eso que perder aportes en silencio durante un directo)
const NOTICE = { twitch: 'RECONECTA TWITCH', streamelements: 'REVISA STREAMELEMENTS', streamlabs: 'REVISA STREAMLABS' };

// Conectores (modo normal y rotador). deliver(lista) recibe los eventos ya filtrados (una sola fuente para bits/subs).
function connect(deliver, onStatus) {
  const tokens = { streamelements: secrets.get('se'), streamlabs: secrets.get('sl'), twitch: secrets.get('tw') };
  const used = Object.keys(tokens).filter((k) => tokens[k]);
  const rules = { bitsFrom: twitchSource(used), subsFrom: twitchSource(used), donationsFrom: ['any'] };
  const connectors = {};
  const status = (name) => (s) => { connectors[name] = s; onStatus(connectors); };
  const pass = (list) => deliver(list.filter((ev) => sourceAllowed(ev, rules)));
  if (tokens.streamelements) startDirectSE({ token: tokens.streamelements, io: globalThis.io, onEvents: pass, status: status('streamelements') });
  if (tokens.streamlabs) startDirectSL({ token: tokens.streamlabs, io: globalThis.io, onEvents: pass, status: status('streamlabs') });
  if (tokens.twitch) startDirectTwitch({ token: tokens.twitch, onEvents: pass, status: status('twitch') });
  return connectors;
}
const noticeOf = (connectors) => { const bad = Object.entries(connectors).find(([, s]) => /token|permiso/.test(s)); return bad ? NOTICE[bad[0]] : ''; };
const report = (connectors) => toParent({ sag: 'status', connectors });

if (bars.length >= 2 && !child) startRotator();
else startSingle();

// ---------- una barra (normal o hija) ----------
function startSingle() {
  const KEY = 'sag:' + (q.get('goalId') || 'main');
  let onEvent = null, onCommand = null, connectors = {}, parentNotice = '';
  let saved = null;
  if (!preview) try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* sin localStorage */ }
  const host = {
    search: location.search, saved,
    save: preview ? null : (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignorar */ } },
    onEvent: (cb) => { onEvent = cb; }, onCommand: (cb) => { onCommand = cb; },
    notice: () => (child ? parentNotice : noticeOf(connectors)),
  };
  if (child) { // protocolo con el rotador
    let visible = false, last = '';
    const waiting = [];
    const tell = (type) => { if (type !== last || type === 'focus') { last = type; toParent({ sag: type }); } };
    Object.assign(host, {
      visible: () => visible,
      focus: () => tell('focus'),
      whenVisible: (fn) => waiting.push(fn), // el aporte espera a que la transición termine y esta barra se vea
      busy: () => tell('busy'), idle: () => tell('idle'),
    });
    window.addEventListener('message', (m) => {
      if (!fromParent(m)) return;
      const d = m.data;
      if (d.sag === 'events') for (const ev of d.list || []) onEvent?.(ev);
      else if (d.sag === 'cmd') onCommand?.(d.cmd);
      else if (d.sag === 'notice') parentNotice = String(d.text || '');
      else if (d.sag === 'visible') { visible = !!d.on; if (visible) waiting.splice(0).forEach((fn) => fn()); }
    });
  }
  globalThis.__SAG_HOST = host;
  globalThis.__SAG_START();
  if (child) { toParent({ sag: 'ready' }); return; }
  window.addEventListener('message', (m) => { if (fromParent(m) && m.data.sag === 'cmd') onCommand?.(m.data.cmd); });
  if (window.parent !== window) setInterval(() => report(connectors), 2000);
  connectors = connect((list) => list.forEach((ev) => onEvent?.(ev)), (c) => report(c));
  report(connectors);
}

// ---------- rotador ----------
function startRotator() {
  document.getElementById('widget')?.remove(); document.getElementById('dbg')?.remove();
  const scale = Math.min(4, Math.max(1, Math.round(Number(q.get('scale')) || 1))), u = 2 * scale, W = 480 * u, H = 135 * u;
  const sec = Math.min(600, Math.max(5, Number(q.get('rotateSec')) || 15)) * 1000;
  const box = document.createElement('div');
  box.style.cssText = `position:relative;width:${W}px;height:${H}px;overflow:hidden`;
  document.body.appendChild(box);
  const frames = bars.map((qs, i) => {
    const p = new URLSearchParams(qs);
    for (const k of ['bar', 'child', 'rotateSec', 'preview', 'load']) p.delete(k);
    p.set('child', '1'); p.set('scale', String(scale)); // todas las barras del mismo tamaño
    if (preview) { p.set('preview', '1'); p.set('comboHoldMs', '0'); }
    const f = document.createElement('iframe');
    f.src = 'overlay.html?' + p; f.title = `barra ${i + 1}`; f.setAttribute('scrolling', 'no');
    f.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;border:0;background:transparent;transform:translateY(${i ? H : 0}px)`;
    box.appendChild(f);
    return f;
  });
  const send = (i, msg) => frames[i]?.contentWindow?.postMessage(msg, location.origin);
  const all = (msg) => frames.forEach((_, i) => send(i, msg));
  let active = 0, busy = false, moving = false, lastSwitch = Date.now(), grace = 0, notice = '';
  const queue = []; // barras que pidieron paso, en orden
  const showFlags = () => frames.forEach((_, i) => send(i, { sag: 'visible', on: i === active }));

  // Transición por pasos (8-bit): la barra actual sube y sale, la siguiente entra desde abajo. 7 pasos × 50 ms, en píxeles enteros.
  function go(next) {
    if (next === active || moving) return;
    moving = true;
    const cur = frames[active], nxt = frames[next], STEPS = 7;
    send(active, { sag: 'visible', on: false });
    for (let k = 1; k <= STEPS; k++) setTimeout(() => {
      const off = Math.round((135 * k) / STEPS) * u;
      cur.style.transform = `translateY(${-off}px)`; nxt.style.transform = `translateY(${H - off}px)`;
      if (k === STEPS) {
        cur.style.transform = `translateY(${H}px)`; // queda esperando abajo para su próximo turno
        active = next; moving = false; busy = false; lastSwitch = Date.now(); grace = Date.now() + 1500; // margen para que empiece su animación
        showFlags();
      }
    }, k * 50);
  }
  setInterval(() => {
    if (moving || busy || Date.now() < grace) return;
    while (queue.length && queue[0] === active) queue.shift();
    if (queue.length) return go(queue.shift());
    if (Date.now() - lastSwitch >= sec) go((active + 1) % frames.length);
  }, 200);

  window.addEventListener('message', (m) => {
    if (m.origin !== location.origin || !m.data) return;
    const i = frames.findIndex((f) => f.contentWindow === m.source);
    if (i >= 0) {
      const t = m.data.sag;
      if (t === 'ready') { send(i, { sag: 'visible', on: i === active }); if (notice) send(i, { sag: 'notice', text: notice }); }
      else if (t === 'focus') { if (i !== active && !queue.includes(i)) queue.push(i); }
      else if (t === 'busy' && i === active) busy = true;
      else if (t === 'idle' && i === active) { if (busy) lastSwitch = Date.now(); busy = false; } // tras celebrar, la barra se queda su turno completo
      return;
    }
    if (fromParent(m) && m.data.sag === 'cmd') { // botones de prueba de la página: eventos a todas (cada una decide), teclas a la visible
      const c = m.data.cmd;
      if (c?.cmd === 'events' || c?.cmd === 'event') all({ sag: 'events', list: c.list || [c.ev] });
      else send(active, { sag: 'cmd', cmd: c });
    }
  });

  let connectors = {};
  connectors = connect((list) => { if (list.length) all({ sag: 'events', list }); }, (c) => {
    report(c);
    const n = noticeOf(c); if (n !== notice) { notice = n; all({ sag: 'notice', text: notice }); }
  });
  if (window.parent !== window) setInterval(() => report(connectors), 2000);
  report(connectors);
}
