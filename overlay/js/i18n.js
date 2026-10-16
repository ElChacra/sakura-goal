const D = {
  es: { goal: '¡META LOGRADA!', checkpoint: '¡CHECKPOINT {p}%!', last: 'ÚLTIMO', top: 'TOP', remaining: 'FALTAN', anon: 'ANÓNIMO', level: '¡NIVEL {n}!', bits: 'BITS', sub: 'SUB', contrib: '+{n} APORTES', combo: '¡X{n} COMBO!', mixed: '{n} DONANTES', next: '¡NUEVA META!' },
  en: { goal: 'GOAL REACHED!', checkpoint: 'CHECKPOINT {p}%!', last: 'LATEST', top: 'TOP', remaining: 'LEFT', anon: 'ANONYMOUS', level: 'LEVEL {n}!', bits: 'BITS', sub: 'SUB', contrib: '+{n} GIFTS', combo: 'X{n} COMBO!', mixed: '{n} DONORS', next: 'NEW GOAL!' },
};
export const makeT = (lang) => (k, v = {}) => (D[lang] || D.es)[k].replace(/\{(\w+)\}/g, (_, n) => v[n]);
