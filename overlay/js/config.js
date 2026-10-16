// Un solo objeto config: defaults + override por query string (?petalIntervalSec=6)
export const DEFAULTS = {
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

export function getConfig(search = location.search) {
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
