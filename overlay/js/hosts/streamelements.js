// Anfitrión para el Custom Widget de StreamElements (solo se usa en dist/streamelements-widget/widget.js).
// Espera a `onWidgetLoad` (trae los fields y la moneda del canal), carga el estado de SE_API.store y arranca main.js.
import { normalizeSEWidget, fieldsToSearch, SE_BUTTONS } from '../sources/se-widget.js';

let onEvent = null, onCommand = null, timer = null;
const slim = (s) => ({ ...s, seenIds: s.seenIds.slice(-100) }); // el store de SE es pequeño: se guarda lo justo

window.addEventListener('onWidgetLoad', async (obj) => {
  const fields = obj.detail?.fieldData || {};
  const key = 'sag' + String(fields.goalId || 'main').replace(/[^a-z0-9]/gi, '');
  let saved = null;
  try { saved = await SE_API.store.get(key); } catch { /* sin store: se empieza de cero */ }
  globalThis.__SAG_HOST = {
    search: fieldsToSearch(fields, obj.detail?.currency?.code), saved,
    save(s) { clearTimeout(timer); timer = setTimeout(() => { try { SE_API.store.set(key, slim(s)); } catch { /* ignorar */ } }, 500); },
    onEvent: (cb) => { onEvent = cb; }, onCommand: (cb) => { onCommand = cb; },
  };
  globalThis.__SAG_START();
});

window.addEventListener('onEventReceived', (obj) => {
  const d = obj.detail;
  if (!d) return;
  if (d.listener === 'widget-button') { const c = SE_BUTTONS[d.field]; if (c) onCommand?.(c); return; }
  for (const raw of normalizeSEWidget(d)) onEvent?.(raw);
});
