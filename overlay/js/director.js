// Lógica pura del director: combos y partición de eventos en hitos/meta (plan 6.6)
const round2 = (n) => Math.round(n * 100) / 100;

export function merge(evs) {
  if (evs.length === 1) return evs[0];
  const n = evs.length, last = evs[n - 1], names = new Set(evs.map((e) => e.name)), kinds = new Set(evs.map((e) => e.kind));
  return { ...last, id: evs[0].id + '+' + (n - 1), ids: evs.flatMap((e) => e.ids || [e.id]), value: round2(evs.reduce((a, e) => a + e.value, 0)),
    rawAmount: round2(evs.reduce((a, e) => a + e.rawAmount, 0)), kind: kinds.size === 1 ? last.kind : 'donation', combo: n, mixed: names.size > 1,
    name: names.size === 1 ? last.name : '', isTest: evs.every((e) => e.isTest) };
}

// Junta eventos que llegan juntos. Se libera tras `holdMs` de silencio o al cumplir `windowMs` desde el primero.
export class Combiner {
  constructor({ windowMs = 1500, holdMs = 400 } = {}) { this.windowMs = windowMs; this.holdMs = holdMs; this.items = []; this.first = 0; this.last = 0; }
  add(ev, now) { if (!this.items.length) this.first = now; this.items.push(ev); this.last = now; }
  poll(now) {
    if (!this.items.length || (now - this.last < this.holdMs && now - this.first < this.windowMs)) return null;
    const out = merge(this.items); this.items = []; return out;
  }
}

// Un evento que cruza hitos/meta se parte: llena hasta el hito, celebra y continúa. Solo el primer tramo muestra banner.
export function splitEvent(state, ev, cfg) {
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
