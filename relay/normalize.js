// Payloads externos → evento crudo { id, source, kind, name, rawAmount, rawCurrency, message, ts, isTest, anon, tier }.
// El valor en unidades de la meta lo calcula el overlay (events.js/convert) con su config. Puro, sin red.
// VERIFICAR (plan §12 #3): con SAVE_PAYLOADS=1 el relay guarda los payloads reales en payloads.jsonl para ajustar esto.
const TIERS = { 1000: 'T1', 2000: 'T2', 3000: 'T3', prime: 'prime' };
const tier = (p) => TIERS[String(p ?? '1000').toLowerCase()] || 'T1';
const num = (x) => { const n = typeof x === 'number' ? x : parseFloat(String(x ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const str = (x, n = 200) => String(x ?? '').slice(0, n);
const time = (x) => { const t = typeof x === 'number' ? x : Date.parse(x); return Number.isFinite(t) ? t : Date.now(); };

// ---------- StreamElements (socket `event`) ----------
export function normalizeSE(e, { test = false } = {}) {
  const d = e?.data || {}, ts = time(e?.createdAt);
  const base = { id: e?._id ? `se:${e._id}` : undefined, source: 'streamelements', name: str(d.displayName || d.username || d.name, 30), message: str(d.message), ts, isTest: test || !!d.isTest, anon: false };
  switch (e?.type) {
    case 'tip': return [{ ...base, kind: 'donation', rawAmount: num(d.amount), rawCurrency: str(d.currency || 'USD', 10).toUpperCase() }];
    case 'cheer': return [{ ...base, kind: 'bits', rawAmount: num(d.amount), rawCurrency: 'BITS' }];
    case 'subscriber': { // regalo: cuenta 1 sub por receptor y se acredita a quien regala (`sender`)
      const t = tier(d.tier);
      return [{ ...base, kind: 'sub', rawAmount: 1, rawCurrency: 'SUB_' + t, tier: t, name: str(d.gifted && d.sender ? d.sender : base.name, 30) }];
    }
    case 'follow': return [{ ...base, kind: 'follow', rawAmount: 1, rawCurrency: 'COUNT' }];
    case 'raid': return [{ ...base, kind: 'raid', rawAmount: num(d.amount), rawCurrency: 'VIEWERS' }];
    default: return []; // communityGiftPurchase se ignora: cada sub regalada llega como `subscriber` y se contaría dos veces
  }
}

// SE `event:test` (botones "emular" del dashboard): { listener: 'tip-latest', event: { name, amount, message } }.
// Sin _id y suelen dispararse varias veces → id por contenido en ventanas de 5 s para deduplicar.
const SE_TEST = { 'tip-latest': 'tip', 'cheer-latest': 'cheer', 'subscriber-latest': 'subscriber', 'follower-latest': 'follow', 'raid-latest': 'raid' };
export function normalizeSETest(p, now = Date.now()) {
  const type = SE_TEST[p?.listener], ev = p?.event || {};
  if (!type) return [];
  return normalizeSE({ type, createdAt: now, data: { username: ev.name, amount: ev.amount, message: ev.message, currency: ev.currency, tier: ev.tier } }, { test: true })
    .map((r) => ({ ...r, id: `se-test:${type}:${r.name}:${r.rawAmount}:${Math.floor(now / 5000)}` }));
}

// ---------- Streamlabs (socket `event`): { type, for, message: [ ... ], event_id } ----------
export function normalizeSL(p) {
  const list = Array.isArray(p?.message) ? p.message : p?.message && typeof p.message === 'object' ? [p.message] : [];
  const out = [];
  list.forEach((m, i) => {
    const rawId = m._id ?? m.id ?? (p.event_id ? `${p.event_id}${list.length > 1 ? ':' + i : ''}` : undefined);
    const base = { id: rawId != null ? `sl:${rawId}` : undefined, source: 'streamlabs', name: str(m.from || m.display_name || m.name, 30), message: str(m.message), ts: time(m.created_at ? m.created_at * 1000 : undefined), isTest: !!m.isTest, anon: false };
    switch (p.type) {
      case 'donation': out.push({ ...base, kind: 'donation', rawAmount: num(m.amount), rawCurrency: str(m.currency || 'USD', 10).toUpperCase() }); break;
      case 'bits': out.push({ ...base, kind: 'bits', rawAmount: num(m.amount), rawCurrency: 'BITS' }); break;
      case 'subscription': case 'resub': {
        const t = tier(m.sub_plan), gifter = m.gifter_display_name || m.gifter;
        out.push({ ...base, kind: 'sub', rawAmount: 1, rawCurrency: 'SUB_' + t, tier: t, name: str(gifter || base.name, 30) }); break;
      }
      case 'follow': out.push({ ...base, kind: 'follow', rawAmount: 1, rawCurrency: 'COUNT' }); break;
      case 'raid': out.push({ ...base, kind: 'raid', rawAmount: num(m.raiders ?? m.amount), rawCurrency: 'VIEWERS' }); break;
      default: break; // subMysteryGift, host, superchat…: no suman (los regalos llegan como subscription individuales)
    }
  });
  return out;
}

// ---------- Twitch EventSub (notificación: subscription.type + event) ----------
// Regalos: se cuenta UNA vez el `channel.subscription.gift` (total, a nombre de quien regala) y se ignoran los
// `channel.subscribe` con is_gift=true que llegan por cada receptor. Las renovaciones llegan como `subscription.message`.
export function normalizeTwitch(type, e, messageId, ts = Date.now()) {
  if (!e) return [];
  const anon = !!e.is_anonymous, base = { id: messageId ? `tw:${messageId}` : undefined, source: 'twitch', name: anon ? '' : str(e.user_name || e.user_login, 30), anon, message: '', ts, isTest: false };
  switch (type) {
    case 'channel.cheer': return [{ ...base, kind: 'bits', rawAmount: num(e.bits), rawCurrency: 'BITS', message: str(e.message) }];
    case 'channel.subscribe': { if (e.is_gift) return []; const t = tier(e.tier); return [{ ...base, kind: 'sub', rawAmount: 1, rawCurrency: 'SUB_' + t, tier: t }]; }
    case 'channel.subscription.message': { const t = tier(e.tier); return [{ ...base, kind: 'sub', rawAmount: 1, rawCurrency: 'SUB_' + t, tier: t, message: str(e.message?.text) }]; }
    case 'channel.subscription.gift': { const t = tier(e.tier); return [{ ...base, kind: 'giftsub', rawAmount: Math.max(1, num(e.total)), rawCurrency: 'SUB_' + t, tier: t }]; }
    case 'channel.follow': return [{ ...base, kind: 'follow', rawAmount: 1, rawCurrency: 'COUNT' }];
    case 'channel.raid': return [{ ...base, kind: 'raid', rawAmount: num(e.viewers), rawCurrency: 'VIEWERS', name: str(e.from_broadcaster_user_name, 30) }];
    default: return [];
  }
}

// ---------- entrada genérica (panel, REST, Streamer.bot): valida y recorta todo ----------
const KINDS = ['donation', 'bits', 'sub', 'giftsub', 'follow', 'raid', 'adjust'];
export function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || !KINDS.includes(raw.kind)) return null;
  const amount = num(raw.rawAmount);
  if (Math.abs(amount) > 1e9) return null;
  const cur = /^[A-Z0-9_]{1,10}$/.test(String(raw.rawCurrency ?? '')) ? raw.rawCurrency : undefined;
  return {
    ...(raw.id != null && { id: str(raw.id, 120) }), source: str(raw.source || 'manual', 20), kind: raw.kind, name: str(raw.name, 30), rawAmount: amount,
    ...(cur && { rawCurrency: cur }), message: str(raw.message), ts: raw.ts != null ? time(raw.ts) : Date.now(), isTest: !!raw.isTest, anon: !!raw.anon,
    ...(['T1', 'T2', 'T3', 'prime'].includes(raw.tier) && { tier: raw.tier }), ...(raw.goalId && { goalId: str(raw.goalId, 40) }),
  };
}
