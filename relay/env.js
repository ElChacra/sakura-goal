// Lector mínimo de .env (sin dependencias). Las variables del sistema no vacías tienen prioridad sobre el archivo.
import fs from 'node:fs';

export function loadEnv(file, base = process.env) {
  const out = {};
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* sin .env: se usan defaults */ }
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  for (const [k, v] of Object.entries(base)) if (v) out[k] = v;
  return out;
}
