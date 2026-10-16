// Logs con enmascarado de secretos: ningún token llega a la consola aunque aparezca dentro de un error o URL.
const secrets = new Set();
export const addSecret = (s) => { if (s && String(s).length >= 6) secrets.add(String(s)); };
export function mask(v) {
  let s = typeof v === 'string' ? v : v instanceof Error ? v.message : JSON.stringify(v);
  for (const x of secrets) s = s.split(x).join('***');
  return s.replace(/([?&](token|access_token|jwt)=)[^&\s"]+/gi, '$1***');
}
const stamp = () => new Date().toTimeString().slice(0, 8);
export function createLog({ debug = false, quiet = false } = {}) {
  const out = (fn, tag) => (...a) => { if (!quiet) fn(stamp(), tag, ...a.map(mask)); };
  return { info: out(console.log, ''), warn: out(console.warn, '⚠'), error: out(console.error, '✖'), debug: debug ? out(console.log, '·') : () => {} };
}
