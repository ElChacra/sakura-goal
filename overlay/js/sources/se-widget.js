// Custom Widget de StreamElements (Fase 5): eventos `onEventReceived` → evento crudo, y fieldData → query string de config.
// VERIFICAR (plan §12 #3) con eventos reales: nombres de campos de regalos (bulkGifted / isCommunityGift / sender).
const KIND = { 'tip-latest': 'donation', 'cheer-latest': 'bits', 'subscriber-latest': 'sub', 'follower-latest': 'follow', 'raid-latest': 'raid' };
const TIERS = { 1000: 'T1', 2000: 'T2', 3000: 'T3', prime: 'prime' };
const str = (x, n) => String(x ?? '').slice(0, n);

export function normalizeSEWidget(detail, now = Date.now()) {
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
export function fieldsToSearch(fields = {}, channelCurrency) {
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
export const SE_BUTTONS = {
  testSmall: { cmd: 'key', key: '2' }, testMega: { cmd: 'key', key: '4' }, testBits: { cmd: 'key', key: 'b' }, testSub: { cmd: 'key', key: 's' },
  testMilestone: { cmd: 'key', key: 'm' }, testGoal: { cmd: 'key', key: 'c' }, undoLast: { cmd: 'undo' }, resetGoal: { cmd: 'reset' },
};
