// Cliente WebSocket del relay con reconexión exponencial (0,5 s → 10 s). Si el relay no está, el overlay sigue
// funcionando con su último estado (localStorage) y reintenta en silencio.
// on: { link(up), <tipo de mensaje>(data)… } · hello: objeto o función que lo devuelve (se reenvía en cada reconexión)
export function relayUrlFor(cfg, loc = location) {
  if (cfg.relayUrl) return cfg.relayUrl;
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

export function connectRelay(url, hello, on) {
  let ws = null, delay = 500, timer = null, up = false;
  function open() {
    try { ws = new WebSocket(url); } catch { return retry(); }
    ws.onopen = () => { delay = 500; up = true; send(typeof hello === 'function' ? hello() : hello); on.link?.(true); };
    ws.onmessage = (m) => { let d; try { d = JSON.parse(m.data); } catch { return; } if (d.type !== 'link') on[d.type]?.(d); };
    ws.onclose = () => { if (up) on.link?.(false); up = false; retry(); };
    ws.onerror = () => {}; // el cierre ya programa el reintento
  }
  function retry() { clearTimeout(timer); timer = setTimeout(open, delay); delay = Math.min(delay * 2, 10000); }
  function send(o) { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); }
  open();
  return { send, get up() { return up; } };
}
