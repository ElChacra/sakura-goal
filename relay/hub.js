// Centro del relay: recibe eventos (conectores, panel, REST), deduplica, los guarda y los reparte a los overlays.
// El overlay sigue siendo quien convierte y reduce (state.js); el relay guarda el estado que el overlay le devuelve
// y le entrega al conectar un snapshot + los eventos que llegaron mientras estaba apagado (se aplican sin animar).
import { sanitize } from './normalize.js';

const LOG_MAX = 300, SEEN_MAX = 2000;
const hash = (s) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const TWITCH_KINDS = { bits: 'bitsFrom', sub: 'subsFrom', giftsub: 'subsFrom', follow: 'subsFrom', raid: 'subsFrom' };

// rules: { bitsFrom, subsFrom, donationsFrom[] } — 'any' desactiva el filtro. Evita contar bits/subs dos veces (plan §12 #15).
export function sourceAllowed(ev, rules) {
  if (ev.source === 'manual' || ev.source === 'test' || ev.source === 'chat') return true; // cargados a mano por ti o tus mods
  if (ev.kind === 'donation') return rules.donationsFrom.includes('any') || rules.donationsFrom.includes(ev.source);
  const key = TWITCH_KINDS[ev.kind];
  return !key || rules[key] === 'any' || rules[key] === ev.source;
}

export function createHub({ store, log, rules = { bitsFrom: 'any', subsFrom: 'any', donationsFrom: ['any'] } }) {
  const d = store.data, clients = new Set(), seen = new Set(d.seen), connectors = {};
  let idc = 0;

  function goal(id) {
    if (!d.goals[id]) { // un goal nuevo solo recibe pendientes desde ahora (salvo el primero de una instalación nueva)
      d.goals[id] = { state: null, since: Object.keys(d.goals).length ? Date.now() : d.createdAt - 1 };
      store.save();
    }
    return d.goals[id];
  }
  const send = (role, goalId, msg) => { for (const c of clients) if (c.role === role && (!goalId || c.goalId === goalId)) c.send(msg); };
  const counts = () => ({ overlays: [...clients].filter((c) => c.role === 'overlay').length, controls: [...clients].filter((c) => c.role === 'control').length });
  const relayInfo = () => ({ type: 'relay', connectors, ...counts() });

  function intake(input) {
    const ev = sanitize(input);
    if (!ev) return { ok: false, reason: 'invalid' };
    ev.id ??= ev.source === 'manual' ? `m:${Date.now().toString(36)}${(idc++).toString(36)}` : `h:${hash(`${ev.source}|${ev.kind}|${ev.name}|${ev.rawAmount}|${ev.ts}`)}`;
    if (seen.has(ev.id)) { log.debug('duplicado ignorado', ev.id); return { ok: false, reason: 'duplicate', id: ev.id }; }
    if (!sourceAllowed(ev, rules)) { log.debug(`${ev.kind} de ${ev.source} ignorado por bitsFrom/subsFrom/donationsFrom`); return { ok: false, reason: 'filtered', id: ev.id }; }
    seen.add(ev.id); d.seen.push(ev.id);
    if (d.seen.length > SEEN_MAX) d.seen.splice(0, d.seen.length - SEEN_MAX).forEach((x) => seen.delete(x));
    ev.rx = Date.now(); d.log.push(ev); if (d.log.length > LOG_MAX) d.log.splice(0, d.log.length - LOG_MAX);
    store.save();
    log.info(`${ev.isTest ? '[prueba] ' : ''}${ev.source} ${ev.kind} ${ev.rawAmount}${ev.rawCurrency ? ' ' + ev.rawCurrency : ''} de ${ev.name || '—'}`);
    send('overlay', ev.goalId, { type: 'event', ev });
    return { ok: true, id: ev.id };
  }

  function snapshot(goalId) {
    const g = goal(goalId), seenByOverlay = new Set(g.state?.seenIds || []);
    const pending = d.log.filter((e) => e.rx > g.since && (!e.goalId || e.goalId === goalId) && !seenByOverlay.has(e.id));
    return { type: 'snapshot', state: g.state, pending };
  }

  function onMessage(c, m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'hello') {
      c.role = m.role === 'control' ? 'control' : 'overlay'; c.goalId = String(m.goalId || 'main').slice(0, 40);
      if (c.role === 'overlay') c.send(snapshot(c.goalId));
      else send('overlay', c.goalId, { type: 'cmd', cmd: 'hello' }); // que el overlay mande su estado ya
      send('control', null, relayInfo());
      return;
    }
    if (!c.role) return;
    const g = c.role === 'overlay' ? goal(c.goalId) : null;
    if (g) switch (m.type) {
      case 'state': // gana el más reciente (varios overlays de la misma meta calculan lo mismo)
        if (m.state?.goalId === c.goalId && (m.state.savedAt || 0) >= (g.state?.savedAt || 0)) { g.state = m.state; store.save(); }
        return;
      case 'status': return send('control', c.goalId, { ...m, type: 'status' });
      case 'undone': { const ids = new Set(m.ids || []); d.log = d.log.filter((e) => !ids.has(e.id)); store.save(); return; } // no re-aplicar lo deshecho
      case 'reset': g.since = Date.now(); store.save(); return;
      default: return;
    }
    if (m.type === 'cmd') {
      if (m.cmd === 'event') return intake({ ...m.ev, source: 'manual', id: undefined, goalId: c.goalId });
      return send('overlay', c.goalId, { ...m, type: 'cmd' });
    }
  }

  return {
    intake, snapshot, onMessage, counts,
    attach(c) { clients.add(c); },
    detach(c) { clients.delete(c); send('control', null, relayInfo()); },
    command(goalId, cmd) { send('overlay', goalId, { ...cmd, type: 'cmd' }); },
    setConnector(name, status) { if (connectors[name] === status) return; connectors[name] = status; send('control', null, relayInfo()); },
    connectors,
  };
}
