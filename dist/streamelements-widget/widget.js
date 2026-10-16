/* Sakura Arcade Goal — build generado por scripts/build.js; edita overlay/js, no este archivo */
(() => {
'use strict';
const __m = {};
__m["config.js"] = (() => {
// Un solo objeto config: defaults + override por query string (?petalIntervalSec=6)
const DEFAULTS = {
  goalId: 'main', title: 'META', target: 500, start: 0, unit: 'currency', currency: 'USD', locale: 'es', lang: 'es',
  theme: 'sakura', scale: 1, blocks: 52, retroFps: 60,
  petals: 1, petalIntervalSec: 4, petalBurst: '1-2', petalMax: 24, petalLanding: 0,
  windEverySec: 30, shineEverySec: 6, sparkleEverySec: 2.5, idleFlowerEverySec: 20, tickerEverySec: 8,
  tickerMessages: ['last', 'top', 'remaining'], // last | top | remaining | cualquier texto propio (máx. 27 caracteres)
  showPercentInBar: 0, leftIcon: 'heart',
  tierMode: 'percent', tiers: { small: 0, medium: 2, large: 5, mega: 10 },
  bannerHoldMs: 3500, showMessage: 1, maxMessageChars: 40, blockedWords: [], anonymousIfPrivate: 1,
  milestones: [25, 50, 75], onComplete: 'overflow', completeDurationMs: 8000, goalIcon: 'star',
  goals: [], resetEvery: 'none', // none | daily | weekly (desde el lunes) | monthly, en hora local
  // metas encadenadas: ?goals=NUEVO MICRO:500,CAMARA:1000 (implica onComplete=next-goal)
  // Conversión de unidades (4.5). Valores de subRates y rates: AJUSTAR por el streamer, no son una verdad.
  count: ['donations', 'bits', 'subs'], bitsRate: 0.01, rates: { USD: 1 }, subRates: { T1: 5, T2: 10, T3: 25, prime: 5 },
  ignoreTestEvents: 0, countTestEvents: 0, comboWindowMs: 1500, comboHoldMs: 400, queueMax: 10,
  sound: 0, volume: 0.15, persist: 1,
  // source: auto = relay si la página se sirve por http(s) (npm start); manual = solo teclado/panel en el mismo navegador
  source: 'auto', relayUrl: '', debug: 0, seed: null, reducedMotion: null,
};

function coerce(def, raw) {
  if (Array.isArray(def)) return raw === '' ? [] : raw.split(',').map((s) => (typeof def[0] === 'number' ? Number(s) : s.trim()));
  if (typeof def === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : def; }
  if (def && typeof def === 'object') { try { return { ...def, ...JSON.parse(raw) }; } catch { return def; } }
  return raw;
}

function getConfig(search = location.search) {
  const q = new URLSearchParams(search), cfg = { ...DEFAULTS, _set: new Set(q.keys()) };
  for (const [k, v] of q) {
    if (!(k in DEFAULTS)) continue;
    cfg[k] = DEFAULTS[k] === null ? Number(v) : coerce(DEFAULTS[k], v);
  }
  if (q.has('reducedMotion')) cfg.reducedMotion = q.get('reducedMotion') === '1';
  // Validaciones
  cfg.scale = Math.min(4, Math.max(1, Math.round(cfg.scale))); // solo enteros: píxeles siempre cuadrados
  cfg.blocks = Math.min(52, Math.max(4, Math.round(cfg.blocks)));
  cfg.target = cfg.target > 0 ? cfg.target : DEFAULTS.target;
  cfg.retroFps = [15, 30, 60].includes(cfg.retroFps) ? cfg.retroFps : 60;
  cfg.title = String(cfg.title).slice(0, 24);
  const m = String(cfg.petalBurst).match(/^(\d+)(?:-(\d+))?$/); // "1-2" → [1,2]
  cfg.petalBurst = m ? [Number(m[1]), Number(m[2] ?? m[1])] : [1, 2];
  cfg.blockedWords = cfg.blockedWords.map((w) => w.toLowerCase()).filter(Boolean);
  cfg.goals = cfg.goals.map((s) => { const i = s.lastIndexOf(':'), target = Number(s.slice(i + 1)); return i > 0 && target > 0 ? { title: s.slice(0, i).trim().slice(0, 24), target } : null; }).filter(Boolean);
  if (cfg.goals.length && !q.has('onComplete')) cfg.onComplete = 'next-goal';
  if (!['hold', 'overflow', 'next-goal', 'reset'].includes(cfg.onComplete)) cfg.onComplete = 'overflow';
  if (!['sakura', 'bubblegum', 'strawberry', 'sakura-night'].includes(cfg.theme)) cfg.theme = 'sakura';
  if (!['none', 'daily', 'weekly', 'monthly'].includes(cfg.resetEvery)) cfg.resetEvery = 'none';
  const ICONS = ['heart', 'star', 'gift', 'trophy', 'gem', 'flower'];
  if (!ICONS.includes(cfg.leftIcon)) cfg.leftIcon = 'heart';
  if (!ICONS.includes(cfg.goalIcon)) cfg.goalIcon = 'star';
  cfg.tickerMessages = cfg.tickerMessages.map((m) => String(m).trim().slice(0, 27)).filter(Boolean);
  if (!cfg.tickerMessages.length) cfg.tickerMessages = [...DEFAULTS.tickerMessages];
  return cfg;
}

return { DEFAULTS, getConfig };
})();

__m["sprites.js"] = (() => {
// Sprites como mapas de píxeles (plan 5.6). '.' = transparente.
const SPRITES = {
  petalA: ['MM.MM', 'MLMMM', 'MMMMD', '.MMD.', '..D..'],
  petalB: ['MM.MM', 'MMMLM', 'DMMMM', '.DMM.', '..D..'],
  petalC: ['.M.', 'LMD', 'MMD', '.MD', '.D.'],
  flower: ['..MM.MM..', '.MLLMLLM.', 'MLLLLLLLM', 'MLLYYYLLM', '.MLYBYLM.', 'MLLYYYLLM', 'MLLLLLLLM', '.MLLMLLM.', '..MM.MM..'],
  bud: ['.M.', 'MYM', '.M.'],
  half: ['.MMM.', 'MLLLM', 'MLYLM', 'MLLLM', '.MMM.'],
  heart: ['.PP.PP.', 'PLPPPPP', 'PPPPPPD', '.PPPPD.', '..PPD..', '...D...'],
  star: ['...Y...', '...Y...', 'YYYYYYY', '.YYYYY.', '..YYY..', '.YY.YY.', 'YY...YY'],
  flag: ['KPPP..', 'KPPPP.', 'KPPP..', 'K.....', 'K.....', 'K.....', 'K.....', 'K.....'],
  gift: ['.P.W.P.', '..PWP..', 'MMMWMMM', 'MLMWMLM', 'MMMWMMM', 'MLMWMLM', 'DDDWDDD'],
  trophy: ['YYYYYYY', 'YYWYYYY', '.YYYYY.', '.YYYYY.', '..YYY..', '...Y...', '.YYYYY.'],
  gem: ['..GGG..', '.GWGGV.', 'GWGGGGV', '.GGGGV.', '..GGV..', '...V...'],
  spark1: ['.W.', 'WYW', '.W.'],
  spark2: ['..W..', '..W..', 'WWYWW', '..W..', '..W..'],
};

// Pre-render: cada sprite se dibuja UNA vez a un canvas offscreen (1 px = 1 px lógico).
// hex(ch) devuelve el color de un carácter; remap(ch) permite variantes (bloqueado, oscuro…).
function buildSprites(hex, remap = (c) => c) {
  const out = {};
  for (const [name, rows] of Object.entries(SPRITES)) {
    const c = document.createElement('canvas');
    c.width = Math.max(...rows.map((r) => r.length)); c.height = rows.length;
    const x = c.getContext('2d');
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] !== '.') { x.fillStyle = hex(remap(r[i])); x.fillRect(i, j, 1, 1); } });
    out[name] = c;
  }
  return out;
}

return { SPRITES, buildSprites };
})();

__m["i18n.js"] = (() => {
const D = {
  es: { goal: '¡META LOGRADA!', checkpoint: '¡CHECKPOINT {p}%!', last: 'ÚLTIMO', top: 'TOP', remaining: 'FALTAN', anon: 'ANÓNIMO', level: '¡NIVEL {n}!', bits: 'BITS', sub: 'SUB', contrib: '+{n} APORTES', combo: '¡X{n} COMBO!', mixed: '{n} DONANTES', next: '¡NUEVA META!' },
  en: { goal: 'GOAL REACHED!', checkpoint: 'CHECKPOINT {p}%!', last: 'LATEST', top: 'TOP', remaining: 'LEFT', anon: 'ANONYMOUS', level: 'LEVEL {n}!', bits: 'BITS', sub: 'SUB', contrib: '+{n} GIFTS', combo: 'X{n} COMBO!', mixed: '{n} DONORS', next: 'NEW GOAL!' },
};
const makeT = (lang) => (k, v = {}) => (D[lang] || D.es)[k].replace(/\{(\w+)\}/g, (_, n) => v[n]);

return { makeT };
})();

__m["state.js"] = (() => {
// Reducer puro (sin DOM). applyEvent(state, ev, cfg) → { state, effects[] }
const levelOf = (cur, target, cfg) => (cfg.onComplete === 'overflow' ? 1 + Math.floor(cur / target) : 1);
function blocksOf(cur, target, cfg) {
  if (cur >= target) return cfg.blocks;
  const b = Math.floor((cur / target) * cfg.blocks);
  return cur > 0 && b === 0 ? 1 : b; // mínimo visual: 1 bloque
}
// Lo que se MUESTRA (cabecera, barra dorada, panel). En un múltiplo exacto de la meta la vuelta se ve completa:
// 500/500 → "100%" (no "LV2 0%"), 1000/500 → "LV2 100%" con la barra dorada llena. levelOf sigue contando vueltas para el reducer.
function lapView(cur, target, cfg) {
  if (cfg.onComplete !== 'overflow' || cur < target) return { level: 1, pct: Math.min(100, Math.floor((cur / target) * 100)) };
  const r = cur % target;
  return r === 0 ? { level: cur / target, pct: 100 } : { level: 1 + Math.floor(cur / target), pct: Math.floor((r / target) * 100) };
}
const goldOf = (cur, target, cfg) => { const v = lapView(cur, target, cfg); return v.level > 1 ? Math.floor((v.pct / 100) * cfg.blocks) : 0; };
const percentOf = (cur, target, cfg) => lapView(cur, target, cfg).pct;
const round2 = (n) => Math.round(n * 100) / 100;

// resetEvery (plan §7): inicio del período actual en hora local (día, semana ISO desde el lunes, mes). 0 = sin período.
function periodStart(mode, now = Date.now()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  if (mode === 'weekly') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else if (mode === 'monthly') d.setDate(1);
  else if (mode !== 'daily') return 0;
  return d.getTime();
}
const periodKey = (mode, now) => (mode && mode !== 'none' ? `${mode}:${periodStart(mode, now)}` : undefined);

function createState(cfg, saved, now = Date.now()) {
  const pk = periodKey(cfg.resetEvery, now);
  if (saved?.periodKey && pk && saved.periodKey !== pk) saved = null; // período nuevo: la meta empieza de cero (sin clave previa se adopta la actual)
  const g0 = cfg.goals?.[0]; // metas encadenadas: la primera de la lista manda sobre target/title
  const keepTarget = saved && (g0 || !cfg._set?.has('target'));
  const target = keepTarget ? saved.target : g0 ? g0.target : cfg.target;
  const base = {
    goalId: cfg.goalId, title: g0 ? g0.title : cfg.title, goalIndex: 0, target, current: cfg.start, level: 1,
    milestonesFired: cfg.milestones.filter((m) => cfg.start >= (m / 100) * target), completedAt: cfg.start >= target ? 0 : undefined,
    recent: [], totals: {}, topDonor: undefined, seenIds: [], updatedAt: 0,
  };
  const s = saved && saved.goalId === cfg.goalId ? { ...base, ...saved, target } : base;
  if (cfg._set?.has('title') && !g0) s.title = cfg.title;
  s.periodKey = pk;
  s.level = levelOf(s.current, s.target, cfg);
  return s;
}

function applyEvent(state, ev, cfg) {
  const ids = ev.ids || [ev.id];
  if (ids.some((i) => state.seenIds.includes(i))) return { state, effects: [] }; // dedupe
  const seen = [...state.seenIds, ...ids].slice(-500);
  if (ev.isTest) {
    if (cfg.ignoreTestEvents) return { state, effects: [] };
    if (!cfg.countTestEvents) return { state: { ...state, seenIds: seen }, effects: [{ type: 'donation', ev, counted: false, before: state.current, after: state.current }] };
  }
  if (!ev.value) return { state: { ...state, seenIds: seen }, effects: [] };

  const before = state.current, after = Math.max(0, round2(before + ev.value)), target = state.target;
  const lap = (v) => levelOf(v, target, cfg);
  const adjust = ev.kind === 'adjust';
  const effects = [{ type: adjust ? 'silentUpdate' : 'donation', ev, before, after }];
  if (!adjust && ev.value > 0) {
    for (const m of cfg.milestones) { // solo 1.ª vuelta
      const mark = (m / 100) * target;
      if (before < mark && after >= mark && !state.milestonesFired.includes(m)) effects.push({ type: 'milestone', percent: m });
    }
    if (before < target && after >= target) effects.push({ type: 'complete' });
    else if (before >= target && lap(after) > lap(before)) effects.push({ type: 'levelUp', level: lap(after) });
  }
  const totals = { ...state.totals };
  let topDonor = state.topDonor;
  if (!adjust && ev.name) {
    totals[ev.name] = round2((totals[ev.name] || 0) + ev.value);
    if (!topDonor || totals[ev.name] > topDonor.total) topDonor = { name: ev.name, total: totals[ev.name] };
  }
  // Los tramos 2..n de un evento partido en hitos (splitEvent) se funden con el primero: un solo aporte en "recientes" y en deshacer
  const [head, ...rest] = state.recent, applied = round2(after - before);
  const cont = ev.part?.[0] > 1 && head && String(ev.id).split('#')[0] === head.id;
  const recent = adjust ? state.recent : cont ? [{ ...head, applied: round2(head.applied + applied), ids: [...(head.ids || [head.id]), ...ids] }, ...rest]
    : [{ ...ev, applied }, ...state.recent].slice(0, 20);
  const next = {
    ...state, current: after, level: lap(after), totals, topDonor, recent,
    milestonesFired: [...state.milestonesFired, ...effects.filter((e) => e.type === 'milestone').map((e) => e.percent)],
    completedAt: after >= target ? (state.completedAt ?? ev.ts ?? 0) : undefined,
    seenIds: seen, updatedAt: ev.ts ?? state.updatedAt,
  };
  return { state: next, effects };
}

// onComplete=next-goal: pasa a la siguiente meta de cfg.goals con el sobrante. Devuelve el mismo objeto si no hay más.
function nextGoal(state, cfg) {
  const i = (state.goalIndex || 0) + 1, g = cfg.goals?.[i];
  if (!g || state.current < state.target) return state;
  const current = round2(state.current - state.target);
  return { ...state, goalIndex: i, title: g.title, target: g.target, current, level: 1,
    milestonesFired: cfg.milestones.filter((m) => current >= (m / 100) * g.target), completedAt: current >= g.target ? state.completedAt : undefined };
}

// Deshacer el último aporte contado (revierte `applied`, hitos y meta)
function undoLast(state, cfg) {
  const [last, ...rest] = state.recent;
  if (!last) return state;
  const current = Math.max(0, round2(state.current - last.applied));
  const ids = last.ids || [last.id], totals = { ...state.totals };
  if (last.name && totals[last.name] != null) totals[last.name] = Math.max(0, round2(totals[last.name] - last.applied));
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  return { ...state, current, level: levelOf(current, state.target, cfg), recent: rest, totals, topDonor: top && top[1] > 0 ? { name: top[0], total: top[1] } : undefined,
    seenIds: state.seenIds.filter((i) => !ids.includes(i)), milestonesFired: state.milestonesFired.filter((m) => current >= (m / 100) * state.target),
    completedAt: current >= state.target ? state.completedAt : undefined };
}

return { levelOf, blocksOf, lapView, goldOf, percentOf, periodStart, periodKey, createState, applyEvent, nextGoal, undoLast };
})();

__m["events.js"] = (() => {
// Normalización y conversión de unidades (plan 4.4 / 4.5). Puro, sin DOM.
const GROUP = { donation: 'donations', bits: 'bits', sub: 'subs', giftsub: 'subs', follow: 'follows', raid: 'raids' };
const round2 = (n) => Math.round(n * 100) / 100;
const hash = (s) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const rate = (c, cfg) => cfg.rates[c] ?? (c === cfg.currency ? 1 : null);

function cleanMessage(s, cfg) {
  s = String(s ?? '').slice(0, cfg.maxMessageChars);
  return cfg.blockedWords.some((w) => s.toLowerCase().includes(w)) ? '*' : s; // '*' porque la fuente no trae ♥
}
function inCurrency(raw, cfg) {
  switch (raw.kind) {
    case 'donation': { const r = rate(raw.rawCurrency, cfg); return r == null ? 0 : raw.rawAmount * r; }
    case 'bits': return raw.rawAmount * cfg.bitsRate;
    case 'sub': case 'giftsub': return (cfg.subRates[raw.tier || 'T1'] ?? 0) * (raw.kind === 'giftsub' ? raw.rawAmount || 1 : 1);
    default: return 0;
  }
}
// raw: { id?, source, kind, name, rawAmount, rawCurrency, message?, ts?, isTest?, anon?, tier? } → GoalEvent
function convert(raw, cfg) {
  const ts = raw.ts ?? Date.now(), amount = Number(raw.rawAmount) || 0;
  raw = { ...raw, rawCurrency: raw.rawCurrency || cfg.currency }; // sin moneda (REST, Streamer.bot) = la de la meta
  let value = 0;
  if (raw.kind === 'adjust') value = amount;
  else if (cfg.count.includes(GROUP[raw.kind])) {
    if (cfg.unit === 'count') value = raw.kind === 'giftsub' ? amount || 1 : 1;
    else if (cfg.unit === 'bits') value = raw.kind === 'bits' ? amount : inCurrency(raw, cfg) / cfg.bitsRate;
    else value = inCurrency({ ...raw, rawAmount: amount }, cfg);
  }
  return { id: raw.id ?? hash(`${raw.source}|${raw.name}|${amount}|${ts}`), source: raw.source ?? 'manual', kind: raw.kind, name: raw.name || '',
    rawAmount: amount, rawCurrency: raw.rawCurrency, value: round2(value), message: cleanMessage(raw.message, cfg),
    ts, isTest: !!raw.isTest, anon: !!raw.anon };
}
// small < 2 %, medium 2–5 %, large 5–10 %, mega ≥ 10 % (tierMode=percent) o umbrales absolutos
function tierOf(value, target, cfg) {
  const x = cfg.tierMode === 'percent' ? (Math.abs(value) / target) * 100 : Math.abs(value);
  let r = 'small';
  for (const k of ['small', 'medium', 'large', 'mega']) if (x >= cfg.tiers[k]) r = k;
  return r;
}

return { cleanMessage, convert, tierOf };
})();

__m["director.js"] = (() => {
// Lógica pura del director: combos y partición de eventos en hitos/meta (plan 6.6)
const round2 = (n) => Math.round(n * 100) / 100;

function merge(evs) {
  if (evs.length === 1) return evs[0];
  const n = evs.length, last = evs[n - 1], names = new Set(evs.map((e) => e.name)), kinds = new Set(evs.map((e) => e.kind));
  return { ...last, id: evs[0].id + '+' + (n - 1), ids: evs.flatMap((e) => e.ids || [e.id]), value: round2(evs.reduce((a, e) => a + e.value, 0)),
    rawAmount: round2(evs.reduce((a, e) => a + e.rawAmount, 0)), kind: kinds.size === 1 ? last.kind : 'donation', combo: n, mixed: names.size > 1,
    name: names.size === 1 ? last.name : '', isTest: evs.every((e) => e.isTest) };
}

// Junta eventos que llegan juntos. Se libera tras `holdMs` de silencio o al cumplir `windowMs` desde el primero.
class Combiner {
  constructor({ windowMs = 1500, holdMs = 400 } = {}) { this.windowMs = windowMs; this.holdMs = holdMs; this.items = []; this.first = 0; this.last = 0; }
  add(ev, now) { if (!this.items.length) this.first = now; this.items.push(ev); this.last = now; }
  poll(now) {
    if (!this.items.length || (now - this.last < this.holdMs && now - this.first < this.windowMs)) return null;
    const out = merge(this.items); this.items = []; return out;
  }
}

// Un evento que cruza hitos/meta se parte: llena hasta el hito, celebra y continúa. Solo el primer tramo muestra banner.
function splitEvent(state, ev, cfg) {
  const before = state.current, after = before + ev.value, target = state.target;
  if (ev.value <= 0 || ev.kind === 'adjust' || before >= target) return [ev];
  const marks = [...cfg.milestones.filter((m) => !state.milestonesFired.includes(m)).map((m) => (m / 100) * target), target]
    .filter((x, i, a) => x > before && x < after && a.indexOf(x) === i).sort((a, b) => a - b);
  if (!marks.length) return [ev];
  const cuts = [before, ...marks, after];
  let acc = 0;
  return cuts.slice(1).map((c, i) => {
    const value = i === marks.length ? round2(ev.value - acc) : round2(c - cuts[i]);
    acc += value;
    return { ...ev, value, id: i ? `${ev.id}#${i}` : ev.id, ids: i ? [`${ev.id}#${i}`] : ev.ids || [ev.id], quiet: i > 0, tierValue: ev.value, part: [i + 1, cuts.length - 1] };
  });
}

return { merge, Combiner, splitEvent };
})();

__m["audio.js"] = (() => {
// Chiptune con WebAudio (ondas cuadradas, sin archivos). Se activa con ?sound=1 o desde /control/.
const SEQ = {
  coin: [[988, 70, 0], [1319, 250, 0.07]],
  arp4: [[523, 80, 0], [659, 80, 0.08], [784, 80, 0.16], [1047, 80, 0.24]],
  checkpoint: [[523, 90, 0], [784, 90, 0.09], [1047, 90, 0.18]],
  fanfare: [[523, 100, 0], [659, 100, 0.1], [784, 100, 0.2], [1047, 100, 0.3], [784, 100, 0.45], [1047, 100, 0.55], [1319, 600, 0.65]],
};
function createAudio(cfg) {
  let ctx = null, enabled = !!cfg.sound;
  const get = () => {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {}); // fuera de OBS el navegador exige un gesto del usuario
    return ctx;
  };
  function beep(c, freq, ms, when) {
    const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + when;
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(cfg.volume, t0); g.gain.setValueAtTime(0.0001, t0 + ms / 1000);
    o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + ms / 1000 + 0.02);
  }
  return {
    get enabled() { return enabled; },
    setEnabled(v) { enabled = !!v; if (enabled) get(); },
    unlock() { if (enabled) get(); },
    play(name) { const c = enabled && get(); if (c && SEQ[name]) SEQ[name].forEach(([f, ms, w]) => beep(c, f, ms, w)); },
  };
}

return { createAudio };
})();

__m["sources/relay.js"] = (() => {
// Cliente WebSocket del relay con reconexión exponencial (0,5 s → 10 s). Si el relay no está, el overlay sigue
// funcionando con su último estado (localStorage) y reintenta en silencio.
// on: { link(up), <tipo de mensaje>(data)… } · hello: objeto o función que lo devuelve (se reenvía en cada reconexión)
function relayUrlFor(cfg, loc = location) {
  if (cfg.relayUrl) return cfg.relayUrl;
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

function connectRelay(url, hello, on) {
  let ws = null, delay = 500, timer = null, up = false;
  function open() {
    try { ws = new WebSocket(url); } catch { return retry(); }
    ws.onopen = () => { delay = 500; up = true; send(typeof hello === 'function' ? hello() : hello); on.link?.(true); };
    ws.onmessage = (m) => { let d; try { d = JSON.parse(m.data); } catch { return; } if (d.type !== 'link') on[d.type]?.(d); };
    ws.onclose = () => { if (up) on.link?.(false); up = false; retry(); };
    ws.onerror = () => {}; // el cierre ya programa el reintento
  }
  function retry() { clearTimeout(timer); timer = setTimeout(open, delay); delay = Math.min(delay * 2, 10000); }
  function send(o) { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); }
  open();
  return { send, get up() { return up; } };
}

return { relayUrlFor, connectRelay };
})();

__m["main.js"] = function () {
const { getConfig } = __m["config.js"];
const { buildSprites } = __m["sprites.js"];
const { makeT } = __m["i18n.js"];
const { createState, applyEvent, undoLast, nextGoal, levelOf, lapView, blocksOf, goldOf, percentOf, periodKey, periodStart } = __m["state.js"];
const { tierOf, convert } = __m["events.js"];
const { Combiner, merge, splitEvent } = __m["director.js"];
const { createAudio } = __m["audio.js"];
const { connectRelay, relayUrlFor } = __m["sources/relay.js"];

// Anfitrión opcional (build de StreamElements): aporta config, estado guardado, persistencia y eventos en vez de URL/localStorage/relay
const HOST = globalThis.__SAG_HOST || null;
const cfg = getConfig(HOST?.search ?? location.search), t = makeT(cfg.lang), $ = (id) => document.getElementById(id);
const root = document.documentElement;
root.style.setProperty('--u', 2 * cfg.scale + 'px');
root.dataset.theme = cfg.theme;
const cs = getComputedStyle(root), V = (n) => cs.getPropertyValue('--' + n).trim();
const CH = { K: 'ink', L: 'pink-200', D: 'pink-700', W: 'pink-100', P: 'pink-500', Y: 'gold-400', M: 'pink-400', G: 'mint-300', B: 'plum-600', V: 'lav-300' };
const hex = (c) => V(CH[c]);
const DARK = (c) => ({ L: 'M', M: 'D', D: 'B', W: 'L', P: 'D', Y: 'D' }[c] || c); // capa trasera, más oscura
const SP = buildSprites(hex), SPLOCK = buildSprites(hex, () => 'B'), SPDARK = buildSprites(hex, DARK);
// Variantes de color por tema (plan 5.6/5.7): se cambia el mapa de paleta, no los sprites. sakura-night: pétalos lavanda.
const THEME_PETALS = { 'sakura-night': { M: 'V', L: 'W', D: 'B' } }[cfg.theme];
if (THEME_PETALS) {
  const tp = (c) => THEME_PETALS[c] || c, a = buildSprites(hex, tp), b = buildSprites(hex, (c) => DARK(tp(c)));
  for (const n of ['petalA', 'petalB', 'petalC']) { SP[n] = a[n]; SPDARK[n] = b[n]; }
}
const reduced = cfg.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
const PETAL_MAX = reduced ? Math.floor(cfg.petalMax / 2) : cfg.petalMax;

// ---------- utilidades ----------
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }
const rng = mulberry32(cfg.seed ?? Math.random() * 2 ** 32);
const rr = (a, b) => a + rng() * (b - a), pick = (a) => a[Math.floor(rng() * a.length)];
const nf = (n) => { // símbolo delante ("$185") con Intl; sin decimales si el número es entero
  const d = Number.isInteger(n) ? 0 : 2, o = { style: 'currency', currency: cfg.currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: d, maximumFractionDigits: d };
  const sym = new Intl.NumberFormat(cfg.locale, o).formatToParts(n).find((x) => x.type === 'currency')?.value ?? '';
  return (n < 0 ? '-' : '') + sym + new Intl.NumberFormat(cfg.locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(Math.abs(n)); };
const fmt = cfg.unit === 'currency' ? nf : (n) => String(Math.round(n));

// Línea de tiempo con reloj de simulación (determinista)
let clock = 0; const tl = [];
const at = (ms, fn) => tl.push({ t: clock + ms, fn });
function runTl() { for (let i = 0; i < tl.length;) { if (tl[i].t <= clock) tl.splice(i, 1)[0].fn(); else i++; } }
function typeInto(el, text, ms) { // typewriter (textContent siempre)
  const tok = (el._tok = (el._tok || 0) + 1); el.textContent = '';
  [...text].forEach((_, i) => at(i * ms, () => { if (el._tok === tok) el.textContent = text.slice(0, i + 1); }));
}

// ---------- estado: reducer puro (state.js) + persistencia ----------
const KEY = 'sag:' + cfg.goalId, audio = createAudio(cfg);
let saved = HOST ? HOST.saved ?? null : null;
if (!HOST && cfg.persist) try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* sin localStorage */ }
let S = createState(cfg, saved); // al cargar: snapshot silencioso (se dibuja sin animar ni re-celebrar hitos)
const blocksFor = (v) => blocksOf(v, S.target, cfg), goldFor = (v) => goldOf(v, S.target, cfg);
let celebrating = false, unlocked = S.current >= S.target, paused = false;
let shown = blocksFor(S.current), shown2 = goldFor(S.current), shownAmt = S.current;
let relay = null; // conexión al relay (Fase 3): fuente de verdad persistente cuando está disponible
function save() {
  S.savedAt = Date.now();
  if (HOST) HOST.save?.(S);
  else if (cfg.persist) try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignorar */ }
  relay?.send({ type: 'state', state: S }); status();
}

// ---------- DOM: pintado ----------
const els = Object.fromEntries(['widget', 'title', 'pct', 'barPct', 'fill', 'fill2', 'tip', 'shine', 'amounts', 'ticker', 'big', 'float', 'banner', 'bName', 'bAmt', 'bMsg', 'bHeart', 'frame', 'mid', 'iconL', 'iconR', 'back', 'front', 'dbg'].map((k) => [k, $(k)]));
els.title.textContent = S.title;
els.widget.classList.toggle('pct-in-bar', !!cfg.showPercentInBar);
function paint() {
  els.fill.style.setProperty('--blocks', shown); els.fill2.style.setProperty('--blocks', shown2);
  const tb = shown2 > 0 ? shown2 : shown;
  els.tip.style.display = tb > 0 ? 'block' : 'none';
  els.tip.style.left = `calc(${2 + (tb - 1) * 8} * var(--u))`; els.tip.classList.toggle('gold', shown2 > 0);
  const v = celebrating ? { level: 1, pct: 100 } : lapView(S.current, S.target, cfg);
  els.pct.textContent = (v.level > 1 ? `LV${v.level} ` : '') + v.pct + '%';
  if (cfg.showPercentInBar) els.barPct.textContent = v.pct + '%';
  els.amounts.textContent = `${fmt(shownAmt)} / ${fmt(S.target)}`;
}
const tipX = () => 32 + (shown2 > 0 ? shown2 : shown) * 8, tipY = 42;

// ---------- canvas: partículas ----------
const bx = els.back.getContext('2d'), fx = els.front.getContext('2d'); bx.imageSmoothingEnabled = fx.imageSmoothingEnabled = false;
const P = [];
const mk = (o) => { if (P.length > 400) return null; const p = { x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, sprite: null, fps: 6, life: 0, maxLife: Infinity, layer: 'front', amp: 0, freq: 0, phase: 0, blink: false, rect: null, amb: false, ...o }; P.push(p); return p; };
function petal(speed = 1, x) {
  const back = rng() < 0.5, k = back ? 0.7 : 1;
  mk({ amb: true, layer: back ? 'back' : 'front', x: x ?? 480 * (0.3 + rng() * 0.8), y: -6, vx: -rr(6, 14) * speed * k, vy: rr(10, 18) * k,
    amp: rr(3, 8), freq: rr(0.6, 1.2), phase: rr(0, 6.28), sprite: ['petalA', 'petalC', 'petalB', 'petalC'], fps: 6 });
}
const ambCount = () => P.reduce((n, p) => n + (p.amb ? 1 : 0), 0);
function burst(n, hearts, kind, x = tipX(), y = tipY) { // explosión radial hacia arriba con gravedad
  const extra = kind === 'bits' ? 'gem' : kind === 'sub' ? 'star' : 'heart';
  for (let i = 0; i < n + hearts; i++) {
    const a = rr(-150, -30) * Math.PI / 180, s = rr(30, 70), h = i >= n;
    mk({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, ay: 90, maxLife: rr(0.8, 1.4), blink: true, sprite: h ? [extra] : ['petalA', 'petalC', 'petalB', 'petalC'] });
  }
}
function ring(x, y, n = 16) { for (let i = 0; i < n; i++) { const a = i / n * 6.2832; mk({ x, y, vx: Math.cos(a) * 45, vy: Math.sin(a) * 45, maxLife: 1, blink: true, sprite: ['petalA', 'petalC', 'petalB', 'petalC'] }); } }
let landings = 0; // contador para ?debug=1
const LAND_Y = 21; // centro de un pétalo posado sobre el borde superior del marco (y=24)
function land(p) { // A10 (petalLanding): se posa 1,5 s, resbala por el marco y cae
  p.x += Math.sin(p.life * p.freq * 6.2832 + p.phase) * p.amp; p.amp = 0; p.y = LAND_Y; p.vx = p.vy = 0; p.fps = 0; p.landed = true; landings++;
  at(1500, () => { p.vx = -rr(10, 18); at(rr(300, 700), () => { p.ay = 60; }); });
}
function updateParticles(dt) {
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]; p.life += dt;
    if (p.life >= p.maxLife || p.y > 141 || p.x < -12 || p.x > 560) { P.splice(i, 1); continue; }
    const py = p.y;
    p.vx += p.ax * dt; p.vy += p.ay * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (cfg.petalLanding && p.amb && !p.landed && p.layer === 'front' && py < LAND_Y && p.y >= LAND_Y) {
      const x = p.x + Math.sin(p.life * p.freq * 6.2832 + p.phase) * p.amp;
      if (x > 28 && x < 452 && rng() < 0.25) land(p); else p.landed = true; // solo se decide una vez por pétalo
    }
  }
}
function drawParticles() {
  bx.clearRect(0, 0, 480, 135); fx.clearRect(0, 0, 480, 135);
  for (const p of P) {
    if (p.blink && p.maxLife - p.life < 0.3 && Math.floor(p.life * 20) % 2) continue;
    const c = p.layer === 'back' ? bx : fx, ox = p.amp ? Math.sin(p.life * p.freq * 6.2832 + p.phase) * p.amp : 0;
    if (p.rect) { c.fillStyle = p.rect[2]; c.fillRect(Math.round(p.x + ox), Math.round(p.y), p.rect[0], p.rect[1]); continue; }
    const s = (p.layer === 'back' ? SPDARK : SP)[p.sprite[Math.floor(p.life * p.fps) % p.sprite.length]];
    c.drawImage(s, Math.round(p.x + ox - (s.width >> 1)), Math.round(p.y - (s.height >> 1)));
  }
}

// ---------- iconos ----------
let iconKey = '';
function drawIcons() {
  const br = Math.floor(clock / 500) % 2, key = `${br}${unlocked}`; if (key === iconKey) return; iconKey = key;
  for (const [cv, name, set] of [[els.iconL, cfg.leftIcon, SP], [els.iconR, cfg.goalIcon, unlocked ? SP : SPLOCK]]) {
    const c = cv.getContext('2d'), s = set[name]; c.clearRect(0, 0, 16, 16);
    c.drawImage(s, (16 - s.width) >> 1, ((16 - s.height) >> 1) + br);
  }
}
function drawFlag(m) {
  const cv = document.createElement('canvas'); cv.width = 6; cv.height = 8; cv.className = 'px flag'; cv.dataset.m = m;
  cv.style.cssText = `--x:${32 + Math.round(m / 100 * cfg.blocks) * 8};--y:16;--w:6;--h:8`; cv.getContext('2d').drawImage(SP.flag, 0, 0); els.widget.appendChild(cv);
}
S.milestonesFired.forEach(drawFlag);

// ---------- piezas de animación ----------
const TIERS = { small: { flash: 2, shake: 0, n: 6, h: 0, hold: 2500 }, medium: { flash: 4, shake: 4, n: 14, h: 2, hold: 3500 }, large: { flash: 6, shake: 8, n: 28, h: 5, hold: 4500 }, mega: { flash: 8, shake: 12, n: 60, h: 10, hold: 6000 } };
function flash(n, gold) { for (let i = 0; i < n; i++) at(i * 60, () => { els.mid.classList.toggle(gold ? 'gflash' : 'flash', i % 2 === 0); if (i === n - 1) els.mid.classList.remove('flash', 'gflash'); }); }
function shake(n) { if (reduced) return; for (let i = 0; i <= n; i++) at(i * 50, () => { els.frame.style.transform = i === n ? '' : `translateX(calc(${i % 2 ? -1 : 1} * var(--u)))`; }); }
function floater(text, gold, blinkIt) {
  const f = els.float; f.textContent = text; f.style.color = V(gold ? 'gold-400' : 'pink-100'); f.style.display = 'block';
  f.style.left = `calc(${Math.min(tipX() - 8, 360)} * var(--u))`;
  for (let i = 0; i <= 12; i++) at(i * 40, () => { f.style.top = `calc(${24 - i} * var(--u))`; });
  for (let i = 0; i < 6; i++) at(500 + i * 70, () => { f.style.visibility = i % 2 ? 'visible' : 'hidden'; }); if (!blinkIt) at(500, () => { f.style.visibility = 'visible'; });
  at(900, () => { f.style.display = 'none'; f.style.visibility = 'visible'; });
}
function stepBar(get, set, goal, sparkly, done) { // llena/vacía bloque a bloque (máx. 1200 ms)
  const diff = Math.abs(goal - get()); if (!diff) return done();
  const inc = Math.max(diff > 30 ? 2 : 1, Math.ceil(diff * 30 / 1200)), dir = Math.sign(goal - get());
  (function tick() {
    const nv = dir > 0 ? Math.min(goal, get() + inc) : Math.max(goal, get() - inc); set(nv); paint();
    if (sparkly && dir > 0 && rng() < 0.25) mk({ x: 32 + nv * 8 - 4, y: 36 + rr(0, 12), sprite: ['spark1', 'spark2', 'spark1'], fps: 10, maxLife: 0.3 });
    if (nv === goal) done(); else at(30, tick);
  })();
}
function roll(to, ms) {
  const from = shownAmt, steps = Math.max(1, Math.min(30, Math.round(ms / 40)));
  for (let i = 1; i <= steps; i++) at(i * 40, () => { shownAmt = Math.round((from + (to - from) * i / steps) * 100) / 100; paint(); });
}
function showBanner({ name, label, msg }, hold, done) {
  els.bName.textContent = name; els.bAmt.textContent = label; els.bMsg.textContent = '';
  els.bHeart.getContext('2d').drawImage(SP.heart, 0, 0);
  const off = (i) => `translateX(calc(${Math.round(456 * (1 - i / 8)) - 0} * var(--u)))`;
  for (let i = 1; i <= 8; i++) at(i * 30, () => { els.banner.style.transform = off(i); });
  if (msg) at(260, () => typeInto(els.bMsg, msg, 30));
  const out = 8 * 30 + hold;
  for (let i = 1; i <= 8; i++) at(out + i * 30, () => { els.banner.style.transform = off(8 - i); });
  at(out + 8 * 30 + 20, () => { els.banner.style.transform = ''; done && done(); });
}

// ---------- cola, combos y secuencias ----------
const Q = []; let busy = false;
const enqueue = (job, front) => { front ? Q.unshift(job) : Q.push(job); pump(); };
function pump() { if (busy || paused || !Q.length) return; busy = true; Q.shift()(() => { busy = false; pump(); }); }
const combiner = new Combiner({ windowMs: cfg.comboWindowMs, holdMs: cfg.comboHoldMs });
let idc = 0;
const nameOf = (e) => (e.summary ? t('mixed', { n: e.summary }) : e.mixed ? t('mixed', { n: e.combo }) : (e.anon && cfg.anonymousIfPrivate) || !e.name ? t('anon') : e.name);
const labelOf = (e) => (e.summary ? t('contrib', { n: e.summary }) : e.kind === 'bits' ? `+${e.rawAmount} ${t('bits')}` : e.kind === 'giftsub' ? `+${e.rawAmount} ${t('sub')}` : e.kind === 'sub' ? '+' + t('sub') : '+' + fmt(e.tierValue ?? e.value));
function submit(raw) { // entrada de eventos crudos (panel de control, conectores futuros): se normalizan y pasan por el combinador
  const ev = convert({ source: 'manual', id: 'm' + Date.now().toString(36) + idc++, ...raw }, cfg);
  if (!S.seenIds.includes(ev.id)) combiner.add(ev, clock);
}
function dispatch(ev) { // evento (o combo) listo → cola FIFO; si la cola se llena, los pequeños se resumen en "+N APORTES"
  const job = (d) => runDonationJob(ev, d); job.ev = ev; enqueue(job);
  const queued = Q.filter((j) => j.ev), small = queued.filter((j) => tierOf(j.ev.value, S.target, cfg) === 'small');
  if (queued.length > cfg.queueMax && small.length > 1) {
    small.forEach((j) => Q.splice(Q.indexOf(j), 1));
    const m = { ...merge(small.map((j) => j.ev)), summary: small.length, combo: undefined }, j2 = (d) => runDonationJob(m, d); j2.ev = m; Q.push(j2);
  }
}
function runDonationJob(ev, done) { // un evento que cruza hitos/meta se parte: llena, celebra, continúa
  const segs = splitEvent(S, ev, cfg);
  if (segs.length > 1) Q.unshift(...segs.slice(1).map((sg) => (d) => runDonation(sg, d)));
  runDonation(segs[0], done);
}
function moveBars(after, sparkly) {
  if (goldFor(after) < shown2) { shown2 = 0; paint(); }
  stepBar(() => shown, (v) => (shown = v), blocksFor(after), sparkly, () => stepBar(() => shown2, (v) => (shown2 = v), goldFor(after), sparkly, () => {}));
  roll(after, 1200);
}
function runDonation(ev, done) {
  const r = applyEvent(S, ev, cfg);
  if (!r.effects.length) return done(); // duplicado o ignorado
  S = r.state; save();
  if (els.ticker.textContent.startsWith(t('remaining'))) at(1300, () => typeInto(els.ticker, remainingText(), 30)); // "FALTAN" al día tras llenar la barra
  const { before, after } = r.effects[0], tier = tierOf(ev.tierValue ?? ev.value, S.target, cfg), T = TIERS[tier], gold = tier === 'large' || tier === 'mega', quiet = !!ev.quiet;
  if (r.effects[0].type === 'silentUpdate' || ev.value < 0) { moveBars(after, false); at(1300, done); return; } // ajustes y reembolsos: sin celebración
  flash(T.flash, tier === 'mega'); shake(T.shake);
  if (!quiet) { audio.play(tier === 'mega' ? 'fanfare' : tier === 'large' ? 'arp4' : 'coin'); at(60, () => floater(labelOf(ev), gold, tier === 'mega')); }
  at(80, () => moveBars(after, tier !== 'small'));
  at(200, () => { burst(Math.min(T.n, reduced ? T.n >> 1 : T.n), T.h, ev.kind); if (tier === 'large') mk({ x: tipX(), y: 34, sprite: ['flower'], fps: 0, maxLife: 1.2 }); });
  if (tier === 'mega' && !quiet) for (let i = 0; i < 30; i++) at(200 + i * 100, () => { for (let k = 0; k < 4; k++) petal(2.5, rr(0, 560)); });
  if (quiet) at(1400, finish);
  else at(250, () => showBanner({ name: nameOf(ev), label: labelOf(ev) + (ev.combo ? ' ' + t('combo', { n: ev.combo }) : ''), msg: cfg.showMessage ? ev.message : '' }, T.hold, finish));
  function finish() {
    nx.ticker = 0; // el ticker ('FALTAN…') se reescribe en cuanto la cola quede libre
    const jobs = r.effects.slice(1).map((e) => (e.type === 'milestone' ? (d) => runMilestone(e.percent, d) : e.type === 'complete' ? runComplete : e.type === 'levelUp' ? (d) => runLevelUp(e.level, d) : null)).filter(Boolean);
    Q.unshift(...jobs); done();
  }
}
function runMilestone(m, done) {
  audio.play('checkpoint'); drawFlag(m); flash(6); ring(32 + Math.round(m / 100 * cfg.blocks) * 8 + 2, 20);
  showBanner({ name: t('checkpoint', { p: m }), label: '', msg: '' }, 2500 - 240, done);
}
function runLevelUp(n, done) { audio.play('fanfare'); flash(8, true); ring(tipX(), tipY, 24); showBanner({ name: t('level', { n }), label: '', msg: '' }, 2000, done); }
function runComplete(done) {
  const dur = cfg.completeDurationMs; celebrating = true; paint(); audio.play('fanfare'); els.widget.classList.add('celebrating');
  for (let i = 0; i < 8; i++) at(i * 150, () => els.fill.classList.toggle('gold'));
  for (let i = 0; i < Math.floor(cfg.blocks * 8 / 9); i++) { const s = 1200 + i * 40; at(s, () => mk({ x: 36 + i * 9, y: tipY, sprite: ['flower'], fps: 0, maxLife: (dur - s) / 1000 })); }
  at(600, () => { unlocked = true; iconKey = ''; });
  // texto grande con onda por letra
  const big = els.big; big.textContent = ''; big.style.display = 'block';
  [...t('goal')].forEach((ch) => { const s = document.createElement('span'); s.textContent = ch === ' ' ? '\u00a0' : ch; big.appendChild(s); });
  const cols = ['pink-500', 'gold-400', 'pink-100'], wave = [0, 1, 2, 1, 0, 0], spans = [...big.children]; let on = true;
  at(600, function w() { if (!on) return; spans.forEach((s, i) => { const k = Math.floor(clock / 80) + i; s.style.top = `calc(${-wave[k % 6] * (reduced ? 0 : 1)} * var(--u))`; s.style.color = V(cols[Math.floor(clock / 120 + i) % 3]); }); at(40, w); });
  for (let i = 0; i < Math.floor((dur - 500) / 400); i++) at(i * 400, () => { for (let k = 0; k < 6; k++) { const sz = pick([[2, 2], [1, 3]]); mk({ x: rr(0, 480), y: -3, vy: rr(25, 50), amp: rr(2, 5), freq: rr(1.5, 2.5), phase: rr(0, 6), rect: [...sz, V(pick(['pink-200', 'pink-400', 'gold-400', 'pink-100', 'mint-300']))], maxLife: 8 }); } });
  at(dur, () => {
    on = false; celebrating = false; paint(); big.style.display = 'none'; els.widget.classList.remove('celebrating'); els.fill.classList.remove('gold');
    if (cfg.onComplete === 'reset') at(10000 - 0, () => reset());
    if (cfg.onComplete === 'next-goal') { const n = nextGoal(S, cfg); if (n !== S) { S = n; save(); Q.unshift(runNextGoal); } }
    done();
  });
}
function runNextGoal(done) { // metas encadenadas (?goals=MICRO:500,CAMARA:1000): el sobrante pasa a la siguiente
  snap(); audio.play('arp4'); flash(4); ring(tipX(), tipY);
  showBanner({ name: t('next'), label: `${S.goalIndex + 1}/${cfg.goals.length}`, msg: S.title }, 2500, () => { if (S.current >= S.target) Q.unshift(runComplete); done(); });
}

// ---------- ambientales ----------
const nx = { petal: 500, wind: cfg.windEverySec * 1000, shine: 1500, sparkle: cfg.sparkleEverySec * 1000, flower: cfg.idleFlowerEverySec * 1000, ticker: 0 };
let windUntil = 0, shineB = -1, shineAt = 0, tickIdx = 0;
function wind() { windUntil = clock + 3000; for (let i = 0, n = Math.round(rr(6, 10)); i < n; i++) petal(2); }
function idleFlower() {
  const p = mk({ x: tipX(), y: tipY - 10, sprite: ['bud'], fps: 0 }); if (!p) return;
  at(200, () => (p.sprite = ['half'])); at(400, () => (p.sprite = ['flower']));
  at(1900, () => { P.splice(P.indexOf(p), 1); for (let i = 0; i < 3; i++) mk({ x: p.x + rr(-3, 3), y: p.y, vx: rr(-8, 8), vy: rr(6, 14), amp: 3, freq: 1, sprite: ['petalA', 'petalC', 'petalB', 'petalC'], fps: 6, maxLife: 3 }); });
}
const remainingText = () => `${t('remaining')} ${fmt(Math.max(0, S.target - S.current))}`;
const TICKER = { last: () => S.recent[0] && `${t('last')}: ${nameOf(S.recent[0])} ${labelOf(S.recent[0])}`, top: () => S.topDonor && `${t('top')}: ${S.topDonor.name} ${fmt(S.topDonor.total)}`, remaining: remainingText };
function tickerText() { // tickerMessages: claves conocidas o textos propios del streamer (textContent siempre)
  const list = [...cfg.tickerMessages.map((m) => TICKER[m] || (() => m)), () => HOST?.notice?.()]; // aviso del anfitrión (p. ej. token caducado)
  for (let i = 0; i < list.length; i++) { const s = list[(tickIdx++) % list.length](); if (s) return s; }
  return '';
}
function ambient() {
  if (document.hidden) return;
  if (cfg.petals && clock >= nx.petal) { const [a, b] = cfg.petalBurst, n = a + Math.floor(rng() * (b - a + 1)); for (let i = 0; i < n && ambCount() < PETAL_MAX; i++) petal(clock < windUntil ? 2 : 1); nx.petal = clock + cfg.petalIntervalSec * 1000 * (0.7 + rng() * 0.6); }
  if (cfg.petals && clock >= nx.wind) { wind(); nx.wind = clock + cfg.windEverySec * 1000; }
  if (clock >= nx.shine) { shineB = 0; shineAt = clock; nx.shine = clock + cfg.shineEverySec * 1000; }
  if (shineB >= 0 && clock >= shineAt) {
    els.shine.style.display = 'block'; els.shine.style.left = `calc(${(shineB - 2) * 8} * var(--u))`; shineB++; shineAt = clock + 30;
    if (shineB > Math.max(shown, shown2) + 2) { shineB = -1; els.shine.style.display = 'none'; }
  }
  if (clock >= nx.sparkle) { const n = Math.max(shown, 1); mk({ x: 32 + Math.floor(rng() * n) * 8 + 3, y: 34 + Math.floor(rr(0, 16)), sprite: ['spark1', 'spark2', 'spark1'], fps: 10, maxLife: 0.3 }); nx.sparkle = clock + cfg.sparkleEverySec * 1000; }
  if (clock >= nx.flower && !busy) { idleFlower(); nx.flower = clock + cfg.idleFlowerEverySec * 1000; }
  if (clock >= nx.ticker && !busy) { typeInto(els.ticker, tickerText(), 30); nx.ticker = clock + cfg.tickerEverySec * 1000; }
}

// ---------- modo manual, control remoto y atajos ----------
const NAMES = ['Ana', 'Luis', 'Mei', 'Sakura', 'Pixel', 'Nico'], MSGS = ['¡Mucho éxito!', 'Gracias por el stream', '<script>alert(1)<\/script>', 'Este es un mensaje larguísimo para probar el recorte del banner'];
const money = (pct) => Math.round(S.target * pct) / 100;
function submitValue(value, o = {}) { combiner.add({ id: 'm' + Date.now().toString(36) + idc++, source: 'manual', kind: 'donation', name: pick(NAMES), rawAmount: value, rawCurrency: cfg.currency, value, message: pick(MSGS), ts: Date.now(), isTest: false, anon: false, ...o }, clock); }
function test(kind, pct = 3) { const v = money(pct); submitValue(v, { kind, rawAmount: kind === 'bits' ? Math.round(v / cfg.bitsRate) : kind === 'sub' ? 1 : v }); }
function clearJobs() {
  Q.length = 0; tl.length = 0; P.length = 0; busy = false; combiner.items = []; celebrating = false; shineB = -1;
  els.big.style.display = els.float.style.display = els.shine.style.display = 'none'; els.widget.classList.remove('celebrating');
  els.banner.style.transform = els.frame.style.transform = ''; els.fill.classList.remove('gold'); els.mid.classList.remove('flash', 'gflash');
}
function snap() { // repinta el estado actual sin animar (reset, deshacer, cambio de meta)
  shown = blocksFor(S.current); shown2 = goldFor(S.current); shownAmt = S.current; unlocked = S.current >= S.target; iconKey = '';
  els.widget.querySelectorAll('.flag').forEach((f) => f.remove()); S.milestonesFired.forEach(drawFlag);
  els.title.textContent = S.title; els.ticker.textContent = remainingText(); paint();
}
function reset() { clearJobs(); S = createState(cfg); relay?.send({ type: 'reset' }); save(); snap(); }
function undo() {
  const last = S.recent[0]; clearJobs(); S = undoLast(S, cfg);
  if (last) relay?.send({ type: 'undone', ids: last.ids || [last.id] }); // el relay no lo volverá a entregar como pendiente
  save(); snap();
}
function setTarget(v) { if (v > 0) { S = { ...S, target: v, level: levelOf(S.current, v, cfg), milestonesFired: S.milestonesFired.filter((m) => S.current >= m / 100 * v) }; clearJobs(); save(); snap(); } }
function setTitle(v) { S = { ...S, title: String(v).slice(0, 24) }; els.title.textContent = S.title; save(); }
function nextMilestone() { const m = cfg.milestones.find((x) => !S.milestonesFired.includes(x)); if (m === undefined) return complete(); submitValue(Math.max(0.01, Math.ceil(m / 100 * S.target - S.current + 0.01 * S.target)), { message: '' }); }
function complete() { submitValue(Math.max(0.01, S.target - S.current), { message: '¡META!' }); }
const ACT = { 1: ['1 %', () => test('donation', 1)], 2: ['3 %', () => test('donation', 3)], 3: ['7 %', () => test('donation', 7)], 4: ['12 %', () => test('donation', 12)],
  b: ['bits', () => test('bits', 3)], s: ['sub', () => test('sub', 3)], p: ['pétalos', () => { for (let i = 0; i < 6; i++) petal(); }], w: ['viento', wind], f: ['flor', idleFlower],
  t: ['tormenta', () => { for (let i = 0; i < 30; i++) at(i * 100, () => { for (let k = 0; k < 4; k++) petal(2.5, rr(0, 560)); }); }],
  n: ['banner', () => enqueue((d) => showBanner({ name: pick(NAMES), label: '+' + fmt(5), msg: pick(MSGS).slice(0, cfg.maxMessageChars) }, 2500, d))],
  x: ['combo', () => { for (let i = 0; i < 5; i++) test('donation', 1); }], m: ['hito', nextMilestone], c: ['meta', complete], z: ['deshacer', undo], r: ['reiniciar', reset] };
addEventListener('keydown', (e) => { audio.unlock(); const a = ACT[e.key.toLowerCase()]; if (a && !e.ctrlKey && !e.metaKey) a[1](); });
addEventListener('pointerdown', () => audio.unlock());
// Panel de control (/control/): BroadcastChannel entre páginas del mismo navegador. VERIFICAR que OBS (dock vs. browser source) comparta canal.
let bc = null; try { bc = new BroadcastChannel('sag-' + cfg.goalId); bc.onmessage = (m) => handle(m.data || {}); } catch { /* sin canal */ }
function handle(d) {
  switch (d.cmd) {
    case 'event': return submit(d.ev || {});
    case 'key': return ACT[d.key]?.[1]();
    case 'reset': return reset();
    case 'undo': return undo();
    case 'target': return setTarget(Number(d.value));
    case 'title': return setTitle(d.value);
    case 'pause': paused = !!d.value; return pump();
    case 'sound': audio.setEnabled(d.value); return audio.play('coin');
    case 'hello': return status();
  }
}
function status() {
  const st = { current: S.current, target: S.target, pct: percentOf(S.current, S.target, cfg), level: lapView(S.current, S.target, cfg).level, title: S.title, paused, sound: audio.enabled, unit: cfg.unit, currency: cfg.currency, locale: cfg.locale, relay: !!relay?.up, recent: S.recent.slice(0, 5).map((e) => ({ name: nameOf(e), label: labelOf(e) })) };
  bc?.postMessage({ cmd: 'status', ...st }); relay?.send({ type: 'status', ...st });
}
setInterval(status, 2000);
// resetEvery: al cambiar de día/semana/mes la meta vuelve a cero (se espera a que no haya animaciones en curso)
if (cfg.resetEvery !== 'none') setInterval(() => { if (!busy && !celebrating && periodKey(cfg.resetEvery) !== S.periodKey) reset(); }, 30000);

// Relay (npm start): snapshot al conectar + eventos en vivo + comandos del panel.
const inFlight = () => new Set([...combiner.items, ...Q.map((j) => j.ev).filter(Boolean)].flatMap((e) => e.ids || [e.id]));
function onSnapshot({ state, pending = [] }) {
  let changed = false;
  if (state && state.goalId === cfg.goalId && (state.savedAt || 0) > (S.savedAt || 0)) { clearJobs(); S = createState(cfg, state); changed = true; }
  if (state?.periodKey && S.periodKey && state.periodKey !== S.periodKey) relay.send({ type: 'reset' }); // el relay guardaba un período viejo
  else if (S.savedAt) relay.send({ type: 'state', state: S }); // el relay está vacío o atrasado: se le sube el estado local
  const busyIds = inFlight();
  for (const raw of pending) { // llegaron con el overlay apagado → se suman sin animar ni re-celebrar
    if (S.seenIds.includes(raw.id) || busyIds.has(raw.id) || raw.ts < periodStart(cfg.resetEvery)) continue; // de un período anterior: no cuenta
    const r = applyEvent(S, convert(raw, cfg), cfg);
    if (r.effects.length) { S = r.state; changed = true; }
  }
  if (changed) { save(); snap(); }
}
HOST?.onEvent?.((raw) => submit(raw)); HOST?.onCommand?.((d) => handle(d));
if (!HOST && (cfg.source === 'relay' || (cfg.source === 'auto' && /^https?:$/.test(location.protocol)))) {
  relay = connectRelay(relayUrlFor(cfg), { type: 'hello', role: 'overlay', goalId: cfg.goalId }, {
    snapshot: onSnapshot,
    event: (d) => { if (!inFlight().has(d.ev?.id)) submit(d.ev || {}); },
    cmd: (d) => handle(d),
    link: () => status(),
  });
}
if (cfg.debug) for (const [k, [label, fn]] of Object.entries(ACT)) { const b = document.createElement('button'); b.textContent = `${k}: ${label}`; b.onclick = fn; els.dbg.appendChild(b); }
const dbgTxt = document.createElement('div'); if (cfg.debug) els.dbg.prepend(dbgTxt);

// ---------- bucle de tiempo fijo ----------
const STEP = 1000 / 60, FRAME = 1000 / cfg.retroFps; let acc = 0, last = performance.now(), sinceDraw = 0, frames = 0, fpsT = last, fps = 0;
function frame(now) {
  const d = Math.min(now - last, 100); last = now; acc += d; sinceDraw += d;
  while (acc >= STEP) { clock += STEP; runTl(); const cm = combiner.poll(clock); if (cm) dispatch(cm); ambient(); updateParticles(STEP / 1000); acc -= STEP; }
  if (sinceDraw >= FRAME - 1) { sinceDraw = 0; drawParticles(); drawIcons(); frames++; }
  if (cfg.debug && now - fpsT >= 1000) { fps = frames; frames = 0; fpsT = now; dbgTxt.textContent = `fps ${fps} · ${S.current}/${S.target} · part ${P.length} · cola ${Q.length} · relay ${relay ? (relay.up ? 'ok' : '…') : 'off'} · posados ${landings}`; }
  requestAnimationFrame(frame);
}
paint(); els.ticker.textContent = remainingText();
requestAnimationFrame(frame);

};
globalThis.__SAG_START = __m["main.js"];

__m["sources/se-widget.js"] = (() => {
// Custom Widget de StreamElements (Fase 5): eventos `onEventReceived` → evento crudo, y fieldData → query string de config.
// VERIFICAR (plan §12 #3) con eventos reales: nombres de campos de regalos (bulkGifted / isCommunityGift / sender).
const KIND = { 'tip-latest': 'donation', 'cheer-latest': 'bits', 'subscriber-latest': 'sub', 'follower-latest': 'follow', 'raid-latest': 'raid' };
const TIERS = { 1000: 'T1', 2000: 'T2', 3000: 'T3', prime: 'prime' };
const str = (x, n) => String(x ?? '').slice(0, n);

function normalizeSEWidget(detail, now = Date.now()) {
  const kind = KIND[detail?.listener], e = detail?.event || {};
  if (!kind) return [];
  const id = e._id || e.activityId;
  const base = { id: id ? `se:${id}` : undefined, source: 'streamelements', name: str(e.displayName || e.name, 30), message: str(e.message, 200), ts: now, isTest: !!e.isTest, anon: false };
  const amount = Number(e.amount) || 0;
  switch (kind) {
    case 'donation': return [{ ...base, kind, rawAmount: amount, ...(e.currency && { rawCurrency: str(e.currency, 10).toUpperCase() }) }];
    case 'bits': return [{ ...base, kind, rawAmount: amount, rawCurrency: 'BITS' }];
    case 'sub': {
      if (e.isCommunityGift) return []; // cada receptor de una "bomba" de regalos: ya se contó en el evento bulkGifted
      const tier = TIERS[String(e.tier ?? '1000').toLowerCase()] || 'T1';
      if (e.bulkGifted) return [{ ...base, kind: 'giftsub', rawAmount: Math.max(1, amount), rawCurrency: 'SUB_' + tier, tier, name: str(e.sender || e.name, 30) }];
      return [{ ...base, kind, rawAmount: 1, rawCurrency: 'SUB_' + tier, tier, name: str(e.gifted && e.sender ? e.sender : base.name, 30) }]; // amount = meses: no cuenta
    }
    case 'follow': return [{ ...base, kind, rawAmount: 1, rawCurrency: 'COUNT' }];
    case 'raid': return [{ ...base, kind, rawAmount: amount, rawCurrency: 'VIEWERS' }];
    default: return [];
  }
}

// fieldData del widget → "?title=…&target=…" (los checkbox llegan como booleanos). La moneda del canal de SE se usa si no se eligió otra.
function fieldsToSearch(fields = {}, channelCurrency) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined || v === '' || typeof v === 'object') continue;
    q.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  if (!q.get('currency') && channelCurrency) q.set('currency', channelCurrency);
  q.set('source', 'manual'); // dentro de SE no hay relay
  return '?' + q.toString();
}

// Botones del editor de SE (fields de tipo "button") → comandos del overlay
const SE_BUTTONS = {
  testSmall: { cmd: 'key', key: '2' }, testMega: { cmd: 'key', key: '4' }, testBits: { cmd: 'key', key: 'b' }, testSub: { cmd: 'key', key: 's' },
  testMilestone: { cmd: 'key', key: 'm' }, testGoal: { cmd: 'key', key: 'c' }, undoLast: { cmd: 'undo' }, resetGoal: { cmd: 'reset' },
};

return { normalizeSEWidget, fieldsToSearch, SE_BUTTONS };
})();

__m["hosts/streamelements.js"] = (() => {
// Anfitrión para el Custom Widget de StreamElements (solo se usa en dist/streamelements-widget/widget.js).
// Espera a `onWidgetLoad` (trae los fields y la moneda del canal), carga el estado de SE_API.store y arranca main.js.
const { normalizeSEWidget, fieldsToSearch, SE_BUTTONS } = __m["sources/se-widget.js"];

let onEvent = null, onCommand = null, timer = null;
const slim = (s) => ({ ...s, seenIds: s.seenIds.slice(-100) }); // el store de SE es pequeño: se guarda lo justo

window.addEventListener('onWidgetLoad', async (obj) => {
  const fields = obj.detail?.fieldData || {};
  const key = 'sag' + String(fields.goalId || 'main').replace(/[^a-z0-9]/gi, '');
  let saved = null;
  try { saved = await SE_API.store.get(key); } catch { /* sin store: se empieza de cero */ }
  globalThis.__SAG_HOST = {
    search: fieldsToSearch(fields, obj.detail?.currency?.code), saved,
    save(s) { clearTimeout(timer); timer = setTimeout(() => { try { SE_API.store.set(key, slim(s)); } catch { /* ignorar */ } }, 500); },
    onEvent: (cb) => { onEvent = cb; }, onCommand: (cb) => { onCommand = cb; },
  };
  globalThis.__SAG_START();
});

window.addEventListener('onEventReceived', (obj) => {
  const d = obj.detail;
  if (!d) return;
  if (d.listener === 'widget-button') { const c = SE_BUTTONS[d.field]; if (c) onCommand?.(c); return; }
  for (const raw of normalizeSEWidget(d)) onEvent?.(raw);
});

return {  };
})();

})();
