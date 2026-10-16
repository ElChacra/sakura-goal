// Base común para StreamElements y Streamlabs: socket.io v4 (verificado: ambos servidores aceptan EIO=4 por websocket),
// reconexión exponencial con jitter (1 s → 30 s) y opción SAVE_PAYLOADS para guardar payloads reales (plan §12 #3).
import fs from 'node:fs';
import { io } from 'socket.io-client';

export function startSocket({ name, url, setup, onConnect, handlers, hub, log, savePayloads }) {
  const status = (s) => hub.setConnector(name, s);
  const dump = (event, p) => { if (savePayloads) fs.appendFile(savePayloads, JSON.stringify({ at: new Date().toISOString(), source: name, event, payload: p }) + '\n', () => {}); };
  const s = io(url, { transports: ['websocket'], reconnectionDelay: 1000, reconnectionDelayMax: 30000, randomizationFactor: 0.5, timeout: 15000 });
  let retry = null;
  status('conectando');
  setup?.(s, status);
  let lastErr = '';
  s.on('connect', () => { lastErr = ''; onConnect(s, status); });
  s.on('connect_error', (e) => { // se avisa una vez por tipo de error; socket.io sigue reintentando con espera creciente
    const auth = /auth|token|unauthori/i.test(e.message);
    status(auth ? 'error: token rechazado' : 'reintentando');
    if (e.message !== lastErr) (auth ? log.error : log.warn)(`[${name}] ${auth ? 'token rechazado, revisa .env' : 'sin conexión, reintentando'}: ${e.message}`);
    lastErr = e.message;
  });
  s.on('disconnect', (reason) => {
    if (reason === 'io client disconnect') return; // lo cerramos nosotros (token rechazado o apagado): se conserva el estado mostrado
    status('desconectado'); log.warn(`[${name}] desconectado (${reason})`);
    if (reason === 'io server disconnect') { // el servidor nos echó (p. ej. token inválido): socket.io no reintenta solo
      status('error: el servidor cerró la conexión (¿token inválido?)');
      clearTimeout(retry); retry = setTimeout(() => s.connect(), 60000);
    }
  });
  for (const [event, normalize] of Object.entries(handlers)) {
    s.on(event, (p) => {
      dump(event, p);
      let list = [];
      try { list = normalize(p); } catch (e) { log.warn(`[${name}] payload no reconocido en '${event}': ${e.message}`); }
      if (!list.length) log.debug(`[${name}] '${event}' tipo ${p?.type ?? p?.listener ?? '?'} sin efecto en la meta`);
      for (const ev of list) hub.intake(ev);
    });
  }
  return { stop() { clearTimeout(retry); s.close(); } };
}
