// Página pública de configuración. Todo ocurre en el navegador: no hay servidor propio.
(() => {
  const $ = (id) => document.getElementById(id);
  const SITE = window.SAG_SITE || {};
  const STORE = 'sag-config', SCOPES = 'bits:read channel:read:subscriptions moderator:read:followers';
  const FIELDS = ['title', 'target', 'currency', 'start', 'theme', 'scale', 'onComplete', 'resetEvery', 'goalIcon', 'petalIntervalSec', 'lang', 'subT1', 'goals', 'bitsRate', 'goalId'];
  const CHECKS = ['petalLanding', 'showPercentInBar', 'sound', 'showMessage'];
  const DEFAULTS = {}; for (const k of [...FIELDS, ...CHECKS]) DEFAULTS[k] = $(k).type === 'checkbox' ? $(k).checked : $(k).value;
  let tw = null; // { token, login, expiresAt }
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
  const store = (o) => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* modo privado */ } };

  // ---------- estado guardado ----------
  const saved = load();
  for (const k of FIELDS) if (saved.f?.[k] != null) $(k).value = saved.f[k];
  for (const k of CHECKS) if (saved.f?.[k] != null) $(k).checked = saved.f[k];
  if (saved.remember === false) $('remember').checked = false;
  if (saved.se) $('se').value = saved.se;
  if (saved.sl) $('sl').value = saved.sl;
  if (saved.tw && saved.tw.expiresAt > Date.now()) tw = saved.tw;

  function persist() {
    const f = {}; for (const k of FIELDS) f[k] = $(k).value; for (const k of CHECKS) f[k] = $(k).checked;
    const keep = $('remember').checked;
    store({ f, remember: keep, ...(keep && { se: $('se').value.trim(), sl: $('sl').value.trim(), tw }) });
  }

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
    const u = new URL('overlay.html', location.href), p = u.searchParams;
    for (const k of FIELDS) {
      const v = $(k).value.trim();
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

  const TESTS = [['2', 'Donación'], ['4', 'Donación grande'], ['b', 'Bits'], ['s', 'Sub'], ['x', 'Combo'], ['m', 'Hito'], ['c', 'Meta lograda'], ['w', 'Viento'], ['r', 'Reiniciar']];
  for (const [key, label] of TESTS) {
    const b = document.createElement('button'); b.textContent = label; b.className = key === 'r' ? 'ghost' : '';
    b.onclick = () => frame.contentWindow?.postMessage({ sag: 'cmd', cmd: { cmd: 'key', key } }, location.origin);
    $('tests').appendChild(b);
  }

  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('url').value); $('copy').textContent = '¡Copiada!'; }
    catch { $('url').select(); document.execCommand('copy'); $('copy').textContent = '¡Copiada!'; }
    setTimeout(() => ($('copy').textContent = 'Copiar URL'), 1600);
  };
  for (const k of [...FIELDS, ...CHECKS, 'se', 'sl', 'remember']) $(k).addEventListener('change', refresh);
  for (const k of ['title', 'target', 'se', 'sl']) $(k).addEventListener('input', refresh);

  twCallback().catch(() => false).then((shown) => { if (!shown && (!$('twGo').disabled || tw)) twUi(); refresh(); });
})();
