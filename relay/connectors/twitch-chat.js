// Comandos de chat (Fase 5): `!meta add 5`, `!meta set 600`… solo para moderadores y el streamer.
// Lectura ANÓNIMA del chat de Twitch por IRC-WebSocket (usuario justinfan*): no necesita token ni escribe en el chat.
// Las insignias (badges) llegan en las tags IRC que pone Twitch: un espectador no puede hacerse pasar por moderador.
import WebSocket from 'ws';

// "@badges=moderator/1;display-name=Ana;id=abc :ana!ana@ana.tmi.twitch.tv PRIVMSG #canal :!meta add 5" → objeto
export function parseIrc(line) {
  let rest = line, tags = {};
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    for (const kv of rest.slice(1, sp).split(';')) { const i = kv.indexOf('='); tags[kv.slice(0, i)] = kv.slice(i + 1); }
    rest = rest.slice(sp + 1);
  }
  let prefix = '';
  if (rest.startsWith(':')) { const sp = rest.indexOf(' '); prefix = rest.slice(1, sp); rest = rest.slice(sp + 1); }
  const ti = rest.indexOf(' :'), trailing = ti >= 0 ? rest.slice(ti + 2) : null;
  const [command, ...params] = (ti >= 0 ? rest.slice(0, ti) : rest).split(' ').filter(Boolean);
  return { tags, prefix, command, params, trailing };
}

export function roleOf(tags) {
  const badges = String(tags.badges || '').split(',').map((b) => b.split('/')[0]);
  if (badges.includes('broadcaster')) return 'broadcaster';
  if (badges.includes('moderator') || tags.mod === '1') return 'mod';
  if (badges.includes('vip') || tags.vip === '1') return 'vip';
  return 'viewer';
}
const RANK = { viewer: 0, vip: 1, mod: 2, broadcaster: 3 };
const ALLOW = { broadcaster: 3, mods: 2, vips: 1 };

// Texto del chat → comando para el hub, o null. Montos con coma o punto ("2,5").
const n = (x) => { const v = Number(String(x ?? '').replace(',', '.')); return Number.isFinite(v) ? v : NaN; };
export function parseCommand(text, { prefix = '!meta', role = 'viewer', allow = 'mods', user = '' } = {}) {
  const words = String(text || '').trim().split(/\s+/);
  if (words[0]?.toLowerCase() !== prefix.toLowerCase()) return null;
  if (RANK[role] < (ALLOW[allow] ?? 2)) return { denied: true };
  const [sub = '', a, ...more] = words.slice(1), op = sub.toLowerCase(), rest = [a, ...more].filter(Boolean).join(' ');
  switch (op) {
    case 'add': case 'sumar': case '+': {
      const v = n(a); if (!(v > 0)) return null;
      return { event: { kind: 'donation', rawAmount: v, name: more.join(' ').slice(0, 30) || user, message: '' } };
    }
    case 'quitar': case 'remove': case 'restar': case '-': { const v = n(a); return v > 0 ? { event: { kind: 'adjust', rawAmount: -v, name: '' } } : null; }
    case 'set': case 'meta': case 'objetivo': { const v = n(a); return v > 0 ? { cmd: { cmd: 'target', value: v } } : null; }
    case 'titulo': case 'título': case 'title': return rest ? { cmd: { cmd: 'title', value: rest.slice(0, 24) } } : null;
    case 'deshacer': case 'undo': return { cmd: { cmd: 'undo' } };
    case 'celebrar': return { cmd: { cmd: 'key', key: 'c' } };
    case 'reset': case 'reiniciar': return role === 'broadcaster' ? { cmd: { cmd: 'reset' } } : { denied: true }; // solo el streamer
    default: return null;
  }
}

export function startTwitchChat({ channel, hub, log, prefix = '!meta', allow = 'mods', url = 'wss://irc-ws.chat.twitch.tv:443' }) {
  const chan = String(channel).toLowerCase().replace(/^#/, '');
  const status = (s) => hub.setConnector('chat', s);
  let ws = null, stopped = false, delay = 1000, retryT = null;
  function open() {
    ws = new WebSocket(url);
    ws.on('open', () => {
      delay = 1000;
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE'); ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`); ws.send(`JOIN #${chan}`);
    });
    ws.on('message', (buf) => {
      for (const line of String(buf).split('\r\n').filter(Boolean)) {
        const m = parseIrc(line);
        if (m.command === 'PING') { ws.send(`PONG :${m.trailing ?? 'tmi.twitch.tv'}`); continue; }
        if (m.command === 'JOIN') { status(`conectado (#${chan}, ${prefix})`); log.info(`[chat] escuchando ${prefix} en #${chan}`); continue; }
        if (m.command === 'RECONNECT') { ws.terminate(); continue; }
        if (m.command !== 'PRIVMSG') continue;
        const role = roleOf(m.tags), user = m.tags['display-name'] || m.prefix.split('!')[0];
        const r = parseCommand(m.trailing, { prefix, role, allow, user });
        if (!r) continue;
        if (r.denied) { log.debug(`[chat] ${user} (${role}) no puede usar ${prefix}`); continue; }
        log.info(`[chat] ${user}: ${m.trailing}`);
        if (r.event) hub.intake({ ...r.event, source: 'chat', id: m.tags.id ? `chat:${m.tags.id}` : undefined });
        if (r.cmd) hub.command(null, r.cmd);
      }
    });
    ws.on('close', () => {
      if (stopped) return;
      status('reintentando'); clearTimeout(retryT); retryT = setTimeout(open, delay); delay = Math.min(delay * 2, 30000);
    });
    ws.on('error', (e) => log.debug('[chat] error de socket:', e.message));
  }
  status('conectando'); open();
  return { stop() { stopped = true; clearTimeout(retryT); ws?.close(); } };
}
