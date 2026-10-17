// Página pública de configuración. Todo ocurre en el navegador: no hay servidor propio.
// Varias barras guardadas ("Tus barras"): cada una con su tipo (qué mide), sus ajustes y su goalId → progreso propio en OBS.
// Rotación: varias barras en una sola fuente de OBS que se turnan (overlay.html?bar=…&bar=…).
(() => {
  const $ = (id) => document.getElementById(id);
  const SITE = window.SAG_SITE || {};
  const STORE = 'sag-config', SCOPES = 'bits:read channel:read:subscriptions moderator:read:followers channel:read:redemptions';
  const FIELDS = ['title', 'target', 'currency', 'start', 'theme', 'scale', 'onComplete', 'resetEvery', 'goalIcon', 'petalIntervalSec', 'lang', 'subT1', 'goals', 'bitsRate', 'rewards'];
  const CHECKS = ['petalLanding', 'showPercentInBar', 'sound', 'showMessage'];
  const DEFAULTS = {}; for (const k of [...FIELDS, ...CHECKS]) DEFAULTS[k] = $(k).type === 'checkbox' ? $(k).checked : $(k).value;
  // Qué mide cada tipo de barra (el overlay lo traduce con ?goalType=) y sus valores iniciales
  const TYPES = {
    mix: { icon: '🌸', label: 'Todo junto', desc: 'Donaciones + bits + subs', title: 'NUEVO MICRO', target: '500', unit: 'en dinero', money: true,
      hint: 'Suma donaciones, bits y subs convertidos a dinero (ajusta cuánto vale una sub y un bit).' },
    donations: { icon: '💰', label: 'Donaciones', desc: 'Solo dinero', title: 'DONACIONES', target: '500', unit: 'en dinero', money: true,
      hint: 'Solo cuenta donaciones de StreamElements y Streamlabs. Los bits y subs no suman.' },
    bits: { icon: '💎', label: 'Bits', desc: 'Cheers de Twitch', title: 'META DE BITS', target: '10000', unit: 'en bits',
      hint: 'Cuenta bits. Necesita Twitch, StreamElements o Streamlabs conectado.' },
    subs: { icon: '⭐', label: 'Subs', desc: 'Nuevas, renovadas y regaladas', title: 'META DE SUBS', target: '50', unit: 'en subs',
      hint: 'Cada sub cuenta 1 (5 subs regaladas = 5). Necesita Twitch, StreamElements o Streamlabs conectado.' },
    follows: { icon: '💜', label: 'Seguidores', desc: 'Follows nuevos', title: 'SEGUIDORES', target: '100', unit: 'en seguidores',
      hint: 'Cuenta follows nuevos. Lo más fiable es conectar Twitch (StreamElements y Streamlabs también avisan de follows).' },
    redemptions: { icon: '🎟️', label: 'Canjes', desc: 'Canjes de puntos del canal', title: 'CANJES', target: '50', unit: 'en canjes', points: true,
      hint: 'Cada canje de recompensa con puntos del canal cuenta 1. Solo Twitch.' },
    points: { icon: '🪙', label: 'Puntos', desc: 'Puntos del canal gastados', title: 'PUNTOS DEL CANAL', target: '100000', unit: 'en puntos', points: true,
      hint: 'Suma los puntos del canal que gasta tu comunidad en recompensas. Solo Twitch.' },
  };
  let tw = null; // { token, login, expiresAt, scopes }
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
  const store = (o) => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* modo privado */ } };
  const newId = () => 'b' + Math.random().toString(36).slice(2, 7);
  // Progreso en OBS por barra y por tipo; "main" + "Todo junto" conserva el progreso de quien ya usaba la página antes
  const goalIdOf = (bar) => (bar.type === 'mix' ? bar.id : `${bar.id}-${bar.type}`);

  // ---------- estado guardado (y migración del formato de una sola barra) ----------
  const saved = load();
  let bars = Array.isArray(saved.bars) && saved.bars.length ? saved.bars : [{ id: String(saved.f?.goalId || 'main').replace(/[^\w-]/g, '').slice(0, 30) || 'main', type: 'mix', f: saved.f || {} }];
  bars = bars.filter((b) => TYPES[b.type]);
  if (!bars.length) bars = [{ id: 'main', type: 'mix', f: {} }];
  let cur = bars.find((b) => b.id === saved.cur) || bars[0];
  let rot = { ids: [], sec: '15', ...(saved.rot || {}) }, pvMode = saved.pvMode === 'rot' ? 'rot' : 'bar';
  if (saved.remember === false) $('remember').checked = false;
  if (saved.se) $('se').value = saved.se;
  if (saved.sl) $('sl').value = saved.sl;
  if (saved.tw && saved.tw.expiresAt > Date.now()) tw = saved.tw;
  $('rotSec').value = rot.sec;

  const valueOf = (bar, k) => { const v = bar.f[k]; return v ?? (k === 'title' ? TYPES[bar.type].title : k === 'target' ? TYPES[bar.type].target : DEFAULTS[k]); };
  const readForm = () => { const f = {}; for (const k of FIELDS) f[k] = $(k).value; for (const k of CHECKS) f[k] = $(k).checked; return f; };
  function fillForm(bar) { for (const k of FIELDS) $(k).value = valueOf(bar, k); for (const k of CHECKS) $(k).checked = valueOf(bar, k); }
  const rotBars = () => bars.filter((b) => rot.ids.includes(b.id));
  function persist() {
    cur.f = readForm();
    rot.ids = rot.ids.filter((id) => bars.some((b) => b.id === id)); rot.sec = $('rotSec').value;
    const keep = $('remember').checked;
    store({ bars, cur: cur.id, rot, pvMode, remember: keep, ...(keep && { se: $('se').value.trim(), sl: $('sl').value.trim(), tw }) });
  }

  // ---------- "Tus barras", "¿Qué mide esta barra?" y rotación ----------
  const chipText = (b) => `${TYPES[b.type].icon} ${String(valueOf(b, 'title')).slice(0, 18)}`; // textContent: el título lo escribe el usuario
  function renderBars() {
    const box = $('bars'); box.textContent = '';
    for (const b of bars) {
      const el = document.createElement('button');
      el.className = 'chip' + (b === cur ? ' on' : ''); el.type = 'button'; el.textContent = chipText(b); el.title = TYPES[b.type].label;
      el.onclick = () => { if (b === cur) return; persist(); cur = b; fillForm(cur); renderAll(); };
      box.appendChild(el);
    }
    $('delBar').disabled = bars.length < 2;
    const rb = $('rotBars'); rb.textContent = '';
    for (const b of bars) {
      const l = document.createElement('label'); l.className = 'check chip' + (rot.ids.includes(b.id) ? ' on' : '');
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = rot.ids.includes(b.id); c.dataset.id = b.id;
      c.onchange = () => { rot.ids = c.checked ? [...rot.ids, b.id] : rot.ids.filter((x) => x !== b.id); if (rotBars().length < 2 && pvMode === 'rot') pvMode = 'bar'; renderAll(); };
      l.append(c, document.createTextNode(' ' + chipText(b)));
      rb.appendChild(l);
    }
  }
  const hasPointsScope = () => !!tw && (tw.scopes || []).includes('channel:read:redemptions');
  function renderTypes() {
    const box = $('types'); box.textContent = '';
    for (const [key, T] of Object.entries(TYPES)) {
      const el = document.createElement('button'); el.type = 'button';
      el.className = 'type' + (cur.type === key ? ' on' : ''); el.dataset.type = key;
      const b = document.createElement('b'); b.textContent = `${T.icon} ${T.label}`;
      const s = document.createElement('span'); s.textContent = T.desc;
      el.append(b, s);
      el.onclick = () => setType(key);
      box.appendChild(el);
    }
    const T = TYPES[cur.type];
    let hint = T.hint;
    if (T.points && !tw) hint += ' ⚠ Conecta Twitch arriba.';
    else if (T.points && !hasPointsScope()) hint += ' ⚠ Vuelve a conectar Twitch (Desconectar → Conectar) para dar permiso de leer los canjes.';
    $('typeHint').textContent = hint;
    $('targetLabel').textContent = `Meta (${T.unit})`;
    $('wCurrency').hidden = !T.money; $('wSubT1').hidden = cur.type !== 'mix'; $('wBitsRate').hidden = cur.type !== 'mix'; $('wRewards').hidden = !T.points;
  }
  function setType(key) {
    if (key === cur.type) return;
    const old = TYPES[cur.type], T = TYPES[key];
    if ($('title').value === old.title) $('title').value = T.title; // si no lo había cambiado, se adapta al nuevo tipo
    if ($('target').value === old.target) $('target').value = T.target;
    cur.type = key; renderAll();
  }
  $('newBar').onclick = () => {
    persist();
    const used = new Set(bars.map((b) => b.type)), type = ['follows', 'donations', 'subs', 'bits', 'redemptions', 'points', 'mix'].find((t) => !used.has(t)) || 'donations';
    const { title, target, start, goals, rewards, ...look } = cur.f; // se copian tema, tamaño, etc.; meta y título empiezan de cero
    cur = { id: newId(), type, f: look }; bars.push(cur); fillForm(cur); renderAll();
  };
  $('dupBar').onclick = () => { persist(); cur = { id: newId(), type: cur.type, f: { ...cur.f, title: String(cur.f.title).slice(0, 21) + ' 2' } }; bars.push(cur); fillForm(cur); renderAll(); };
  $('delBar').onclick = () => {
    if (bars.length < 2 || !confirm(`¿Borrar la barra «${valueOf(cur, 'title')}»? Su URL dejará de estar aquí (el progreso guardado en OBS no se borra).`)) return;
    rot.ids = rot.ids.filter((id) => id !== cur.id);
    bars = bars.filter((b) => b !== cur); cur = bars[0]; fillForm(cur); renderAll();
  };

  // ---------- Twitch: OAuth "implicit grant" (el token vuelve en el # y no pasa por ningún servidor) ----------
  const redirect = location.origin + location.pathname.replace(/index\.html$/, ''); // debe coincidir EXACTO con la registrada en Twitch
  function twUi(msg, bad) {
    $('twGo').hidden = !!tw; $('twOut').hidden = !tw; $('cTw').classList.toggle('on', !!tw);
    const st = $('twSt'); st.className = 'st ' + (bad ? 'bad' : tw ? 'ok' : '');
    st.textContent = msg ?? (tw ? `Conectado como ${tw.login} · renueva en ${Math.max(0, Math.round((tw.expiresAt - Date.now()) / 86400000))} días` : '');
  }
  if (!SITE.twitchClientId) { $('twGo').disabled = true; twUi('Esta copia de la página no tiene Twitch configurado (falta el Client ID en site-config.js).', true); }
  $('twGo').onclick = () => {
    const state = crypto.getRandomValues(new Uint32Array(4)).join('-');
    sessionStorage.setItem('sag-tw-state', state); persist();
    location.href = 'https://id.twitch.tv/oauth2/authorize?' + new URLSearchParams({ response_type: 'token', client_id: SITE.twitchClientId, redirect_uri: redirect, scope: SCOPES, state, force_verify: 'true' });
  };
  $('twOut').onclick = () => { tw = null; persist(); twUi(); renderAll(); };
  async function twCallback() {
    const h = new URLSearchParams(location.hash.slice(1)), q = new URLSearchParams(location.search);
    if (!h.get('access_token') && !q.get('error')) return false; // devuelve true si ya mostró un mensaje
    history.replaceState(null, '', location.pathname); // el token no queda en la barra ni en el historial
    const fail = (msg) => { twUi(msg, true); return true; };
    if (q.get('error')) return fail('Twitch no dio permiso: ' + (q.get('error_description') || q.get('error')));
    if (h.get('state') !== sessionStorage.getItem('sag-tw-state')) return fail('La conexión no es válida (state). Vuelve a pulsar Conectar.');
    sessionStorage.removeItem('sag-tw-state');
    const r = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: 'OAuth ' + h.get('access_token') } }).catch(() => null);
    if (!r || !r.ok) return fail('Twitch no aceptó la conexión. Inténtalo de nuevo.');
    const v = await r.json();
    tw = { token: h.get('access_token'), login: v.login, expiresAt: Date.now() + (v.expires_in || 0) * 1000, scopes: v.scopes || [] };
    persist();
    return false;
  }

  // ---------- URLs para OBS ----------
  function queryFor(bar) { // configuración de una barra como query string (sin tokens)
    const p = new URLSearchParams(), T = TYPES[bar.type];
    if (bar.type !== 'mix') p.set('goalType', bar.type);
    const gid = goalIdOf(bar); if (gid !== 'main') p.set('goalId', gid);
    for (const k of FIELDS) {
      const v = String(valueOf(bar, k)).trim();
      if ((k === 'subT1' || k === 'bitsRate') && bar.type !== 'mix') continue; // solo se usan al convertir todo a dinero
      if ((k === 'currency' && !T.money) || (k === 'rewards' && !T.points)) continue;
      if (k === 'subT1') { if (v !== DEFAULTS.subT1) { const n = Number(v) || 0; p.set('subRates', JSON.stringify({ T1: n, T2: n * 2, T3: n * 5, prime: n })); } continue; }
      if (v !== '' && v !== DEFAULTS[k]) p.set(k, v);
    }
    if (!p.has('title')) p.set('title', valueOf(bar, 'title'));
    if (!p.has('target')) p.set('target', valueOf(bar, 'target'));
    for (const k of CHECKS) if (valueOf(bar, k) !== DEFAULTS[k]) p.set(k, valueOf(bar, k) ? '1' : '0');
    return p;
  }
  const secretHash = () => {
    const s = new URLSearchParams();
    if (tw) s.set('tw', tw.token);
    if ($('se').value.trim()) s.set('se', $('se').value.trim());
    if ($('sl').value.trim()) s.set('sl', $('sl').value.trim());
    return s.toString();
  };
  const rotScale = () => String(valueOf(rotBars()[0] || cur, 'scale'));
  function overlayUrl({ mode = 'bar', preview = false, load = 0 } = {}) {
    const u = new URL('overlay.html', location.href);
    let p;
    if (mode === 'rot') { // la rotación lleva cada barra completa en un ?bar=; todas toman el tamaño de la primera
      p = new URLSearchParams();
      p.set('rotateSec', String(Math.min(600, Math.max(5, Number($('rotSec').value) || 15))));
      if (rotScale() !== '1') p.set('scale', rotScale());
      for (const b of rotBars()) p.append('bar', queryFor(b).toString());
    } else p = queryFor(cur);
    if (preview) { p.set('preview', '1'); p.set('comboHoldMs', '0'); if (load) p.set('load', String(load)); } // load: fuerza recarga aunque solo cambie el #token
    u.search = p.toString(); u.hash = secretHash();
    return u.href;
  }

  // ---------- vista previa ----------
  const frame = $('frame'), pv = $('pv');
  function fit() {
    const sc = Number(pvMode === 'rot' ? rotScale() : $('scale').value) || 1, w = 960 * sc, h = 270 * sc, k = Math.min(1, pv.clientWidth / w);
    frame.style.width = w + 'px'; frame.style.height = h + 'px'; frame.style.transform = `scale(${k})`; pv.style.height = Math.ceil(h * k) + 'px';
    const os = Number($('scale').value) || 1; $('w').textContent = 960 * os; $('h').textContent = 270 * os;
  }
  new ResizeObserver(fit).observe(pv);
  let timer = null, shownUrl = '', loads = 0;
  function refresh() {
    persist(); fit();
    $('url').value = overlayUrl();
    const canRot = rotBars().length >= 2;
    $('rotUrlBox').hidden = !canRot; if (canRot) $('rotUrl').value = overlayUrl({ mode: 'rot' });
    $('pvRot').disabled = !canRot;
    for (const b of $('pvMode').children) b.classList.toggle('on', b.dataset.m === pvMode);
    const next = overlayUrl({ mode: pvMode, preview: true });
    if (next === shownUrl) return; // nada cambió (p. ej. el campo solo perdió el foco): no cortar la animación de prueba
    clearTimeout(timer); timer = setTimeout(() => { shownUrl = next; frame.src = overlayUrl({ mode: pvMode, preview: true, load: ++loads }); }, 500);
  }
  for (const b of $('pvMode').children) b.onclick = () => { if (b.disabled) return; pvMode = b.dataset.m; renderTests(); refresh(); };
  const STATUS = { streamelements: 'seSt', streamlabs: 'slSt', twitch: 'twSt' }, CARD = { streamelements: 'cSe', streamlabs: 'cSl', twitch: 'cTw' };
  window.addEventListener('message', (m) => {
    if (m.origin !== location.origin || m.source !== frame.contentWindow || m.data?.sag !== 'status') return;
    for (const [k, s] of Object.entries(m.data.connectors || {})) {
      const el = $(STATUS[k]); if (!el) continue;
      const ok = /^conectado/.test(s), bad = /^error/.test(s);
      $(CARD[k]).classList.toggle('on', ok);
      if (k === 'twitch' && ok) { twUi(); continue; }
      el.className = 'st ' + (ok ? 'ok' : bad ? 'bad' : '');
      el.textContent = ok ? '✔ Conectado' : bad ? '✖ ' + s.replace(/^error: /, '').replace(/^./, (c) => c.toUpperCase()) + '. Revisa que lo copiaste completo.' : '… ' + s;
    }
  });
  for (const id of ['se', 'sl']) $(id).addEventListener('input', () => { if (!$(id).value.trim()) { $(id + 'St').textContent = ''; $(CARD[id === 'se' ? 'streamelements' : 'streamlabs']).classList.remove('on'); } });

  // ---------- botones de prueba según el tipo: eventos "reales" que pasan por la misma conversión que en directo ----------
  const NAMES = ['Ana', 'Luis', 'Mei', 'Sakura', 'Pixel', 'Nico'], pick = (a) => a[Math.floor(Math.random() * a.length)];
  const send = (cmd) => frame.contentWindow?.postMessage({ sag: 'cmd', cmd }, location.origin);
  const events = (...list) => send({ cmd: 'events', list: list.map((e) => ({ name: pick(NAMES), message: '¡Gracias por el stream!', ...e })) });
  const r2 = (n) => Math.max(0.01, Math.round(n * 100) / 100), times = (n, e) => Array.from({ length: n }, () => ({ ...e }));
  function testsFor(bar) {
    const tgt = Math.max(1, Number(valueOf(bar, 'target')) || 100), money = (pct) => ({ kind: 'donation', rawAmount: r2(tgt * pct) });
    const bits = (pct) => ({ kind: 'bits', rawAmount: Math.max(1, Math.round(bar.type === 'bits' ? tgt * pct : (tgt * pct) / (Number(valueOf(bar, 'bitsRate')) || 0.01))) });
    const reward = String(valueOf(bar, 'rewards')).split(',')[0].trim() || 'Hidratarse'; // si filtra recompensas, la prueba usa una que cuenta
    const redeem = (cost) => ({ kind: 'redemption', rawAmount: cost, reward, message: reward });
    return {
      mix: [['Donación', () => events(money(0.03))], ['Donación grande', () => events(money(0.12))], ['Bits', () => events(bits(0.03))], ['Sub', () => events({ kind: 'sub', rawAmount: 1, tier: 'T1' })], ['5 subs regaladas', () => events({ kind: 'giftsub', rawAmount: 5, tier: 'T1' })], ['Combo', () => events(...times(5, money(0.01)))]],
      donations: [['Donación', () => events(money(0.03))], ['Donación grande', () => events(money(0.12))], ['Combo', () => events(...times(5, money(0.01)))]],
      bits: [['Bits', () => events(bits(0.03))], ['Muchos bits', () => events(bits(0.12))], ['Combo', () => events(...times(5, bits(0.01)))]],
      subs: [['Sub', () => events({ kind: 'sub', rawAmount: 1, tier: 'T1' })], ['Sub T3', () => events({ kind: 'sub', rawAmount: 1, tier: 'T3' })], ['5 subs regaladas', () => events({ kind: 'giftsub', rawAmount: 5, tier: 'T1' })]],
      follows: [['Seguidor', () => events({ kind: 'follow', rawAmount: 1 })], ['5 seguidores', () => events(...times(5, { kind: 'follow', rawAmount: 1 }))]],
      redemptions: [['Canje', () => events(redeem(500))], ['5 canjes', () => events(...times(5, redeem(500)))]],
      points: [['Canje de 500', () => events(redeem(500))], ['Canje de 5000', () => events(redeem(Math.max(5000, Math.round(tgt * 0.12))))]],
    }[bar.type];
  }
  const KEYS = [['Hito', 'm'], ['Meta lograda', 'c'], ['Viento', 'w'], ['Reiniciar', 'r']];
  const currentTests = () => [...(pvMode === 'rot' // en la rotación: las pruebas de cada barra (cada una solo cuenta lo suyo)
    ? [...new Map(rotBars().flatMap((b) => testsFor(b))).entries()] : testsFor(cur)), ...KEYS.map(([l, key]) => [l, () => send({ cmd: 'key', key })])];
  function renderTests() {
    const box = $('tests'); box.textContent = '';
    for (const [label] of currentTests()) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = label === 'Reiniciar' ? 'ghost' : '';
      b.onclick = () => { persist(); currentTests().find(([l]) => l === label)?.[1](); }; // se calcula al pulsar: usa la meta actual
      box.appendChild(b);
    }
  }

  function renderAll() { persist(); renderBars(); renderTypes(); renderTests(); refresh(); }

  const copier = (btn, input) => async () => {
    try { await navigator.clipboard.writeText($(input).value); $(btn).textContent = '¡Copiada!'; }
    catch { $(input).select(); document.execCommand('copy'); $(btn).textContent = '¡Copiada!'; }
    setTimeout(() => ($(btn).textContent = 'Copiar URL'), 1600);
  };
  $('copy').onclick = copier('copy', 'url'); $('copyRot').onclick = copier('copyRot', 'rotUrl');
  for (const k of [...FIELDS, ...CHECKS, 'se', 'sl', 'remember', 'rotSec']) $(k).addEventListener('change', refresh);
  for (const k of ['target', 'se', 'sl']) $(k).addEventListener('input', refresh);
  $('title').addEventListener('input', () => { refresh(); renderBars(); }); // el nombre de la barra es su título

  fillForm(cur);
  twCallback().catch(() => false).then((shown) => { if (!shown && (!$('twGo').disabled || tw)) twUi(); renderAll(); });
})();
