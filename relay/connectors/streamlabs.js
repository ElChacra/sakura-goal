// Streamlabs Socket API: token en la URL (Dashboard → Settings → API Settings → API Tokens → Socket API Token).
import { startSocket } from './socketio.js';
import { normalizeSL } from '../normalize.js';

export function startStreamlabs({ token, hub, log, savePayloads }) {
  return startSocket({
    name: 'streamlabs', url: `https://sockets.streamlabs.com?token=${encodeURIComponent(token)}`, hub, log, savePayloads,
    onConnect(s, status) { status('conectado'); log.info('[streamlabs] conectado'); },
    handlers: { event: (p) => normalizeSL(p) },
  });
}
