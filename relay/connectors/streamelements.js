// StreamElements realtime: autenticación con JWT (Dashboard → Account → Channels → Show secrets).
import { startSocket } from './socketio.js';
import { normalizeSE, normalizeSETest } from '../normalize.js';

export function startStreamElements({ token, hub, log, savePayloads }) {
  return startSocket({
    name: 'streamelements', url: 'https://realtime.streamelements.com', hub, log, savePayloads,
    setup(s, status) {
      s.on('authenticated', (d) => { status('conectado'); log.info(`[streamelements] conectado${d?.channelId ? ' (canal ' + d.channelId + ')' : ''}`); });
      s.on('unauthorized', (e) => { status('error: JWT rechazado'); log.error(`[streamelements] JWT rechazado: ${e?.message ?? ''}. Revisa STREAMELEMENTS_JWT en .env`); s.disconnect(); });
    },
    onConnect(s, status) { status('autenticando'); s.emit('authenticate', { method: 'jwt', token }); },
    handlers: { event: (p) => normalizeSE(p), 'event:test': (p) => normalizeSETest(p) },
  });
}
