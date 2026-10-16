// Reducer puro (sin DOM). applyEvent(state, ev, cfg) → { state, effects[] }
export const levelOf = (cur, target, cfg) => (cfg.onComplete === 'overflow' ? 1 + Math.floor(cur / target) : 1);
export function blocksOf(cur, target, cfg) {
  if (cur >= target) return cfg.blocks;
  const b = Math.floor((cur / target) * cfg.blocks);
  return cur > 0 && b === 0 ? 1 : b; // mínimo visual: 1 bloque
}
// Lo que se MUESTRA (cabecera, barra dorada, panel). En un múltiplo exacto de la meta la vuelta se ve completa:
// 500/500 → "100%" (no "LV2 0%"), 1000/500 → "LV2 100%" con la barra dorada llena. levelOf sigue contando vueltas para el reducer.
export function lapView(cur, target, cfg) {
  if (cfg.onComplete !== 'overflow' || cur < target) return { level: 1, pct: Math.min(100, Math.floor((cur / target) * 100)) };
  const r = cur % target;
  return r === 0 ? { level: cur / target, pct: 100 } : { level: 1 + Math.floor(cur / target), pct: Math.floor((r / target) * 100) };
}
export const goldOf = (cur, target, cfg) => { const v = lapView(cur, target, cfg); return v.level > 1 ? Math.floor((v.pct / 100) * cfg.blocks) : 0; };
export const percentOf = (cur, target, cfg) => lapView(cur, target, cfg).pct;
const round2 = (n) => Math.round(n * 100) / 100;

// resetEvery (plan §7): inicio del período actual en hora local (día, semana ISO desde el lunes, mes). 0 = sin período.
export function periodStart(mode, now = Date.now()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  if (mode === 'weekly') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else if (mode === 'monthly') d.setDate(1);
  else if (mode !== 'daily') return 0;
  return d.getTime();
}
export const periodKey = (mode, now) => (mode && mode !== 'none' ? `${mode}:${periodStart(mode, now)}` : undefined);

export function createState(cfg, saved, now = Date.now()) {
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

export function applyEvent(state, ev, cfg) {
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
export function nextGoal(state, cfg) {
  const i = (state.goalIndex || 0) + 1, g = cfg.goals?.[i];
  if (!g || state.current < state.target) return state;
  const current = round2(state.current - state.target);
  return { ...state, goalIndex: i, title: g.title, target: g.target, current, level: 1,
    milestonesFired: cfg.milestones.filter((m) => current >= (m / 100) * g.target), completedAt: current >= g.target ? state.completedAt : undefined };
}

// Deshacer el último aporte contado (revierte `applied`, hitos y meta)
export function undoLast(state, cfg) {
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
