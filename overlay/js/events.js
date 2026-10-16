// Normalización y conversión de unidades (plan 4.4 / 4.5). Puro, sin DOM.
const GROUP = { donation: 'donations', bits: 'bits', sub: 'subs', giftsub: 'subs', follow: 'follows', raid: 'raids' };
const round2 = (n) => Math.round(n * 100) / 100;
const hash = (s) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const rate = (c, cfg) => cfg.rates[c] ?? (c === cfg.currency ? 1 : null);

export function cleanMessage(s, cfg) {
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
export function convert(raw, cfg) {
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
export function tierOf(value, target, cfg) {
  const x = cfg.tierMode === 'percent' ? (Math.abs(value) / target) * 100 : Math.abs(value);
  let r = 'small';
  for (const k of ['small', 'medium', 'large', 'mega']) if (x >= cfg.tiers[k]) r = k;
  return r;
}
