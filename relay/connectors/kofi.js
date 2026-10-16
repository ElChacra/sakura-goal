// Ko-fi webhook (Fase 4). Ko-fi hace POST application/x-www-form-urlencoded con un campo `data` = JSON.
// Se valida verification_token, se respeta is_public y se deduplica por message_id (Ko-fi reintenta si no recibe 200).
// Ko-fi exige una URL pública HTTPS: el túnel debe apuntar al puerto KOFI_PORT, que SOLO atiende este webhook.
import crypto from 'node:crypto';

const str = (x, n = 200) => String(x ?? '').slice(0, n);
export const KOFI_TYPES_DEFAULT = ['donation', 'subscription'];
// El botón "Send test" de Ko-fi manda este id de transacción ficticio (VERIFICAR, plan §12): se trata como evento de prueba.
const TEST_TX = /^0{8}-1111-2222-3333-4{12}$/;

// Cuerpo crudo → objeto Ko-fi. Acepta también JSON directo (útil para probar con curl).
export function parseKofiBody(raw, contentType = '') {
  const text = String(raw ?? '');
  if (/json/i.test(contentType)) return JSON.parse(text);
  const data = new URLSearchParams(text).get('data');
  if (data == null) throw new Error('falta el campo data');
  return JSON.parse(data);
}

const same = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Objeto Ko-fi → evento crudo (o null si el tipo no cuenta). `types`: lista en minúsculas (Donation, Subscription, Shop Order, Commission).
export function normalizeKofi(k, types = KOFI_TYPES_DEFAULT) {
  const type = str(k?.type, 30).toLowerCase();
  if (!types.includes(type)) return null;
  const amount = parseFloat(k.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const pub = k.is_public !== false && k.is_public !== 'false';
  return {
    id: `kofi:${str(k.message_id || k.kofi_transaction_id, 100)}`, source: 'kofi', kind: 'donation', rawAmount: amount,
    rawCurrency: str(k.currency || 'USD', 10).toUpperCase(), name: pub ? str(k.from_name, 30) : '', anon: !pub,
    message: pub ? str(k.message) : '', ts: Date.parse(k.timestamp) || Date.now(), isTest: TEST_TX.test(String(k.kofi_transaction_id ?? '')),
  };
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function handleKofi(req, res, { hub, token, types = KOFI_TYPES_DEFAULT, log }) {
  const reply = (code, text) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); };
  if (req.method !== 'POST') return reply(405, 'solo POST');
  if (!token) return reply(503, 'KOFI_VERIFICATION_TOKEN no configurado');
  let k;
  try { k = parseKofiBody(await readBody(req), req.headers['content-type']); } catch (e) { log.warn(`[kofi] cuerpo inválido: ${e.message}`); return reply(400, 'cuerpo inválido'); }
  if (!same(k?.verification_token, token)) { log.warn('[kofi] verification_token incorrecto: petición rechazada'); hub.setConnector('kofi', 'error: token de verificación no coincide'); return reply(401, 'token inválido'); }
  hub.setConnector('kofi', 'conectado');
  const ev = normalizeKofi(k, types);
  if (!ev) { log.info(`[kofi] ${k.type ?? '?'} recibido (no suma: tipo no incluido en KOFI_TYPES)`); return reply(200, 'ok'); }
  hub.intake(ev); // duplicados (reintentos de Ko-fi) los descarta el hub; igual se responde 200 para que deje de reintentar
  return reply(200, 'ok');
}
