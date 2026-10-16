// state.json con escritura atómica (.tmp + rename) y debounce de 200 ms (plan 4.6).
import fs from 'node:fs';

export function createStore(file, { debounceMs = 200, log } = {}) {
  let data = { version: 1, createdAt: Date.now(), goals: {}, log: [], seen: [] };
  try {
    data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    if (e.code !== 'ENOENT') { // archivo corrupto: se aparta para no perderlo y se empieza de cero
      const bad = `${file}.bad-${Date.now()}`;
      try { fs.renameSync(file, bad); } catch { /* ignorar */ }
      log?.warn(`state.json ilegible, guardado como ${bad}`);
    }
  }
  let timer = null;
  function flush() {
    clearTimeout(timer); timer = null;
    const json = JSON.stringify(data), tmp = file + '.tmp';
    try { fs.writeFileSync(tmp, json); fs.renameSync(tmp, file); } catch (e) {
      try { fs.writeFileSync(file, json); } catch (e2) { log?.error('No se pudo guardar el estado:', e2.message); } // Windows: rename bloqueado por antivirus
    }
  }
  return { data, file, save() { if (!timer) timer = setTimeout(flush, debounceMs); }, flush };
}
