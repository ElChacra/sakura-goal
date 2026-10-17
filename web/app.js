// Página pública de configuración. Todo ocurre en el navegador: no hay servidor propio.
// Varias barras guardadas ("Tus barras"): cada una con su tipo (qué mide), sus ajustes y su goalId → progreso propio en OBS.
(() => {
  const $ = (id) => document.getElementById(id);
  const SITE = window.SAG_SITE || {};
  const STORE = 'sag-config', SCOPES = 'bits:read channel:read:subscriptions moderator:read:followers';
  const FIELDS = ['title', 'target', 'currency', 'start', 'theme', 'scale', 'onComplete', 'resetEvery', 'goalIcon', 'petalIntervalSec', 'lang', 'subT1', 'goals', 'bitsRate'];
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
  };
  let tw = null; // { token, login, expiresAt }
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
  const store = (o) => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* modo privado */ } };
  const newId = () => 'b' + Math.random().toString(36).slice(2, 7);
  // Progreso en OBS por barra y por tipo; "main" + "Todo junto" conserva el progreso de quien ya usaba la página antes
  const goalIdOf = (bar) => (bar.type === 'mix' ? bar.id : `${bar.id}-${bar.type}`);

  // ---------- estado guardado (y migración del formato de una sola barra) ----------
  const saved = load();
  let bars = Array.isArray(saved.bars) && saved.bars.length ? saved.bars : [{ id: String(saved.f?.goalId || 'main').replace(/[^\w-]/g, '').slice(0, 30) || 'main', type: 'mix', f: saved.f || {} }];
  let cur = bars.find((b) => b.id === saved.cur) || bars[0];
  if (saved.remember === false) $('remember').checked = false;
  if (saved.se) $('se').value = saved.se;
  if (saved.sl) $('sl').value = saved.sl;
  if (saved.tw && saved.tw.expiresAt > Date.now()) tw = saved.tw;

  const readForm = () => { const f = {}; for (const k of FIELDS) f[k] = $(k).value; for (const k of CHECKS) f[k] = $(k).checked; return f; };
  function fillForm(bar) {
    const T = TYPES[bar.type];
    for (const k of FIELDS) $(k).value = bar.f[k] ?? (k === 'title' ? T.title : k === 'target' ? T.target : DEFAULTS[k]);
    for (const k of CHECKS) $(k).checked = bar.f[k] ?? DEFAULTS[k];
  }
  function persist() {
    cur.f = readForm();
    const keep = $('remember').checked;
    store({ bars, cur: cur.id, remember: keep, ...(keep && { se: $('se').value.trim(), sl: $('sl').value.trim(), tw }) });
  }

  // ---------- "Tus barras" y "¿Qué mide esta barra?" ----------
  function renderBars() {
    const box = $('bars'); box.textContent = '';
    for (const b of bars) {
      const el = document.createElement('button');
      el.className = 'chip' + (b === cur ? ' on' : ''); el.type = 'button';
      el.textContent = `${TYPES[b.type].icon} ${String(b.f.title || TYPES[b.type].title).slice(0, 18)}`; // textContent: el título lo escribe el usuario
      el.title = TYPES[b.type].label;
      el.onclick = () => { if (b === cur) return; persist(); cur = b; fillForm(cur); renderAll(); };
      box.appendChild(el);
    }
    $('delBar').disabled = bars.length < 2;
  }
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
    $('typeHint').textContent = T.hint;
    $('targetLabel').textContent = `Meta (${T.unit})`;
    $('wCurrency').hidden = !T.money; $('wSubT1').hidden = cur.type !== 'mix'; $('wBitsRate').hidden = cur.type !== 'mix';
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
    const used = new Set(bars.map((b) => b.type)), type = ['follows', 'donations', 'bits', 'subs', 'mix'].find((t) => !used.has(t)) || 'donations';
    const { title, target, start, goals, ...look } = cur.f; // se copian tema, tamaño, etc.; meta y título empiezan de cero
    cur = { id: newId(), type, f: look }; bars.push(cur); fillForm(cur); renderAll();
  };
  $('dupBar').onclick = () => { persist(); cur = { id: newId(), type: cur.type, f: { ...cur.f, title: String(cur.f.title).slice(0, 21) + ' 2' } }; bars.push(cur); fillForm(cur); renderAll(); };
  $('delBar').onclick = () => {
    if (bars.length < 2 || !confirm(`¿Borrar la barra «${cur.f.title || TYPES[cur.type].title}»? Su URL dejará de estar aquí (el progreso guardado en OBS no se borra).`)) return;
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
  $('twOut').onclick = () => { tw = null; persist(); twUi(); refresh(); };
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
    tw = { token: h.get('access_token'), login: v.login, expiresAt: Date.now() + (v.expires_in || 0) * 1000 };
    persist();
    return false;
  }

  // ---------- URL para OBS ----------
  function overlayUrl({ preview = false, load = 0 } = {}) {
    const u = new URL('overlay.html', location.href), p = u.searchParams, T = TYPES[cur.type];
    if (cur.type !== 'mix') p.set('goalType', cur.type);
    const gid = goalIdOf(cur); if (gid !== 'main') p.set('goalId', gid);
    for (const k of FIELDS) {
      const v = $(k).value.trim();
      if ((k === 'subT1' || k === 'bitsRate') && cur.type !== 'mix') continue; // solo se usan al convertir todo a dinero
      if (k === 'currency' && !T.money) continue;
      if (k === 'subT1') { if (v !== DEFAULTS.subT1) { const n = Number(v) || 0; p.set('subRates', JSON.stringify({ T1: n, T2: n * 2, T3: n * 5, prime: n })); } continue; }
      if (v !== '' && v !== DEFAULTS[k]) p.set(k, v);
    }
    if (!p.has('title')) p.set('title', $('title').value);
    if (!p.has('target')) p.set('target', $('target').value);
    for (const k of CHECKS) if ($(k).checked !== DEFAULTS[k]) p.set(k, $(k).checked ? '1' : '0');
    if (preview) { p.set('preview', '1'); p.set('comboHoldMs', '0'); if (load) p.set('load', String(load)); } // load: fuerza recarga aunque solo cambie el #token
    const secret = new URLSearchParams();
    if (tw) secret.set('tw', tw.token);
    if ($('se').value.trim()) secret.set('se', $('se').value.trim());
    if ($('sl').value.trim()) secret.set('sl', $('sl').value.trim());
    u.hash = secret.toString();
    return u.href;
  }

  // ---------- vista previa ----------
  const frame = $('frame'), pv = $('pv');
  function fit() {
    const sc = Number($('scale').value) || 1, w = 960 * sc, h = 270 * sc, k = Math.min(1, pv.clientWidth / w);
    frame.style.width = w + 'px'; frame.style.height = h + 'px'; frame.style.transform = `scale(${k})`; pv.style.height = Math.ceil(h * k) + 'px';
    $('w').textContent = w; $('h').textContent = h;
  }
  new ResizeObserver(fit).observe(pv);
  let timer = null, shownUrl = '', loads = 0;
  function refresh() {
    persist(); fit(); $('url').value = overlayUrl();
    const next = overlayUrl({ preview: true });
    if (next === shownUrl) return; // nada cambió (p. ej. el campo solo perdió el foco): no cortar la animación de prueba
    clearTimeout(timer); timer = setTimeout(() => { shownUrl = next; frame.src = overlayUrl({ preview: true, load: ++loads }); }, 500);
  }
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
  const tgt = () => Math.max(1, Number($('target').value) || 100), r2 = (n) => Math.max(0.01, Math.round(n * 100) / 100);
  const money = (pct) => ({ kind: 'donation', rawAmount: r2(tgt() * pct) });
  const bits = (pct) => ({ kind: 'bits', rawAmount: Math.max(1, Math.round(cur.type === 'bits' ? tgt() * pct : (tgt() * pct) / (Number($('bitsRate').value) || 0.01))) });
  const times = (n, e) => Array.from({ length: n }, () => ({ ...e }));
  const KEYS = { milestone: ['Hito', () => send({ cmd: 'key', key: 'm' })], goal: ['Meta lograda', () => send({ cmd: 'key', key: 'c' })], wind: ['Viento', () => send({ cmd: 'key', key: 'w' })], reset: ['Reiniciar', () => send({ cmd: 'key', key: 'r' })] };
  const TESTS = {
    mix: [['Donación', () => events(money(0.03))], ['Donación grande', () => events(money(0.12))], ['Bits', () => events(bits(0.03))], ['Sub', () => events({ kind: 'sub', rawAmount: 1, tier: 'T1' })], ['5 subs regaladas', () => events({ kind: 'giftsub', rawAmount: 5, tier: 'T1' })], ['Combo', () => events(...times(5, money(0.01)))]],
    donations: [['Donación', () => events(money(0.03))], ['Donación grande', () => events(money(0.12))], ['Combo', () => events(...times(5, money(0.01)))]],
    bits: [['Bits', () => events(bits(0.03))], ['Muchos bits', () => events(bits(0.12))], ['Combo', () => events(...times(5, bits(0.01)))]],
    subs: [['Sub', () => events({ kind: 'sub', rawAmount: 1, tier: 'T1' })], ['Sub T3', () => events({ kind: 'sub', rawAmount: 1, tier: 'T3' })], ['5 subs regaladas', () => events({ kind: 'giftsub', rawAmount: 5, tier: 'T1' })]],
    follows: [['Seguidor', () => events({ kind: 'follow', rawAmount: 1 })], ['5 seguidores', () => events(...times(5, { kind: 'follow', rawAmount: 1 }))]],
  };
  function renderTests() {
    const box = $('tests'); box.textContent = '';
    for (const [label, fn] of [...TESTS[cur.type], KEYS.milestone, KEYS.goal, KEYS.wind, KEYS.reset]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = label === 'Reiniciar' ? 'ghost' : ''; b.onclick = fn;
      box.appendChild(b);
    }
  }

  function renderAll() { renderBars(); renderTypes(); renderTests(); refresh(); }

  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('url').value); $('copy').textContent = '¡Copiada!'; }
    catch { $('url').select(); document.execCommand('copy'); $('copy').textContent = '¡Copiada!'; }
    setTimeout(() => ($('copy').textContent = 'Copiar URL'), 1600);
  };
  for (const k of [...FIELDS, ...CHECKS, 'se', 'sl', 'remember']) $(k).addEventListener('change', refresh);
  for (const k of ['target', 'se', 'sl']) $(k).addEventListener('input', refresh);
  $('title').addEventListener('input', () => { refresh(); renderBars(); }); // el nombre de la barra es su título

  fillForm(cur);
  twCallback().catch(() => false).then((shown) => { if (!shown && (!$('twGo').disabled || tw)) twUi(); renderAll(); });
})();
