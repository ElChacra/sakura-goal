// Sprites como mapas de píxeles (plan 5.6). '.' = transparente.
export const SPRITES = {
  petalA: ['MM.MM', 'MLMMM', 'MMMMD', '.MMD.', '..D..'],
  petalB: ['MM.MM', 'MMMLM', 'DMMMM', '.DMM.', '..D..'],
  petalC: ['.M.', 'LMD', 'MMD', '.MD', '.D.'],
  flower: ['..MM.MM..', '.MLLMLLM.', 'MLLLLLLLM', 'MLLYYYLLM', '.MLYBYLM.', 'MLLYYYLLM', 'MLLLLLLLM', '.MLLMLLM.', '..MM.MM..'],
  bud: ['.M.', 'MYM', '.M.'],
  half: ['.MMM.', 'MLLLM', 'MLYLM', 'MLLLM', '.MMM.'],
  heart: ['.PP.PP.', 'PLPPPPP', 'PPPPPPD', '.PPPPD.', '..PPD..', '...D...'],
  star: ['...Y...', '...Y...', 'YYYYYYY', '.YYYYY.', '..YYY..', '.YY.YY.', 'YY...YY'],
  flag: ['KPPP..', 'KPPPP.', 'KPPP..', 'K.....', 'K.....', 'K.....', 'K.....', 'K.....'],
  gift: ['.P.W.P.', '..PWP..', 'MMMWMMM', 'MLMWMLM', 'MMMWMMM', 'MLMWMLM', 'DDDWDDD'],
  trophy: ['YYYYYYY', 'YYWYYYY', '.YYYYY.', '.YYYYY.', '..YYY..', '...Y...', '.YYYYY.'],
  gem: ['..GGG..', '.GWGGV.', 'GWGGGGV', '.GGGGV.', '..GGV..', '...V...'],
  coinA: ['.YYY.', 'YWYYO', 'YWYYO', 'YYYYO', '.OOO.'], // moneda de frente / de canto: gira alternando A-B
  coinB: ['.Y.', 'YWO', 'YWO', 'YYO', '.O.'],
  orb: ['.VVVV.', 'VWVVVV', 'VV..VV', 'VV..VB', 'VVVVBB', '.VBBB.'], // canjes de puntos del canal
  spark1: ['.W.', 'WYW', '.W.'],
  spark2: ['..W..', '..W..', 'WWYWW', '..W..', '..W..'],
};

// Pre-render: cada sprite se dibuja UNA vez a un canvas offscreen (1 px = 1 px lógico).
// hex(ch) devuelve el color de un carácter; remap(ch) permite variantes (bloqueado, oscuro…).
export function buildSprites(hex, remap = (c) => c) {
  const out = {};
  for (const [name, rows] of Object.entries(SPRITES)) {
    const c = document.createElement('canvas');
    c.width = Math.max(...rows.map((r) => r.length)); c.height = rows.length;
    const x = c.getContext('2d');
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] !== '.') { x.fillStyle = hex(remap(r[i])); x.fillRect(i, j, 1, 1); } });
    out[name] = c;
  }
  return out;
}
