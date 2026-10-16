// Anfitrión de la versión web pública (dist/web/overlay.html). Sin servidor: el overlay se conecta solo a los servicios.
// Config en ?query (título, meta, tema…) y tokens en el #fragmento: el navegador NUNCA envía el # al servidor de la página.
// ?preview=1 (vista previa de la página de configuración): no guarda progreso y escucha comandos de prueba del padre.
import { startDirectSE, startDirectSL, startDirectTwitch, twitchSource } from '../sources/direct.js';
import { sourceAllowed } from '../../../relay/hub.js';

const secrets = new URLSearchParams(location.hash.slice(1)), q = new URLSearchParams(location.search);
const preview = q.get('preview') === '1', KEY = 'sag:' + (q.get('goalId') || 'main');
const tokens = { streamelements: secrets.get('se'), streamlabs: secrets.get('sl'), twitch: secrets.get('tw') };
const used = Object.keys(tokens).filter((k) => tokens[k]);
const rules = { bitsFrom: twitchSource(used), subsFrom: twitchSource(used), donationsFrom: ['any'] };
const connectors = {};
let onEvent = null, onCommand = null;

const report = () => { if (window.parent !== window) window.parent.postMessage({ sag: 'status', connectors }, location.origin); };
const status = (name) => (s) => { connectors[name] = s; report(); };
const deliver = (list) => { for (const ev of list) if (sourceAllowed(ev, rules)) onEvent?.(ev); };
// Si un token deja de valer, el ticker lo avisa (mejor eso que perder aportes en silencio durante un directo)
const NOTICE = { twitch: 'RECONECTA TWITCH', streamelements: 'REVISA STREAMELEMENTS', streamlabs: 'REVISA STREAMLABS' };

let saved = null;
if (!preview) try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* sin localStorage */ }
globalThis.__SAG_HOST = {
  search: location.search, saved,
  save: preview ? null : (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignorar */ } },
  onEvent: (cb) => { onEvent = cb; }, onCommand: (cb) => { onCommand = cb; },
  notice: () => { const bad = Object.entries(connectors).find(([, s]) => /token|permiso/.test(s)); return bad ? NOTICE[bad[0]] : ''; },
};
globalThis.__SAG_START();

window.addEventListener('message', (m) => { if (m.origin === location.origin && m.data?.sag === 'cmd') onCommand?.(m.data.cmd); });
if (window.parent !== window) setInterval(report, 2000);

if (tokens.streamelements) startDirectSE({ token: tokens.streamelements, io: globalThis.io, onEvents: deliver, status: status('streamelements') });
if (tokens.streamlabs) startDirectSL({ token: tokens.streamlabs, io: globalThis.io, onEvents: deliver, status: status('streamlabs') });
if (tokens.twitch) startDirectTwitch({ token: tokens.twitch, onEvents: deliver, status: status('twitch') });
report();
