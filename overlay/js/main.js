import { getConfig } from './config.js';
import { buildSprites } from './sprites.js';
import { makeT } from './i18n.js';
import { createState, applyEvent, undoLast, nextGoal, levelOf, lapView, blocksOf, goldOf, percentOf, periodKey, periodStart } from './state.js';
import { tierOf, convert } from './events.js';
import { Combiner, merge, splitEvent } from './director.js';
import { createAudio } from './audio.js';
import { connectRelay, relayUrlFor } from './sources/relay.js';

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
const NAMES = ['Ana', 'Luis', 'Mei', 'Sakura', 'Pixel', 'Nico'], MSGS = ['¡Mucho éxito!', 'Gracias por el stream', '<script>alert(1)</script>', 'Este es un mensaje larguísimo para probar el recorte del banner'];
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
