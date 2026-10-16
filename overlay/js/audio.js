// Chiptune con WebAudio (ondas cuadradas, sin archivos). Se activa con ?sound=1 o desde /control/.
const SEQ = {
  coin: [[988, 70, 0], [1319, 250, 0.07]],
  arp4: [[523, 80, 0], [659, 80, 0.08], [784, 80, 0.16], [1047, 80, 0.24]],
  checkpoint: [[523, 90, 0], [784, 90, 0.09], [1047, 90, 0.18]],
  crystal: [[1319, 50, 0], [1568, 50, 0.05], [1976, 50, 0.1], [2637, 120, 0.15]], // bits
  powerup: [[392, 60, 0], [523, 60, 0.06], [659, 60, 0.12], [784, 60, 0.18], [1047, 160, 0.24]], // subs
  pop: [[1568, 40, 0], [2093, 60, 0.04]], // cada caja de regalo que se abre
  fanfare: [[523, 100, 0], [659, 100, 0.1], [784, 100, 0.2], [1047, 100, 0.3], [784, 100, 0.45], [1047, 100, 0.55], [1319, 600, 0.65]],
};
export function createAudio(cfg) {
  let ctx = null, enabled = !!cfg.sound;
  const get = () => {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {}); // fuera de OBS el navegador exige un gesto del usuario
    return ctx;
  };
  function beep(c, freq, ms, when) {
    const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + when;
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(cfg.volume, t0); g.gain.setValueAtTime(0.0001, t0 + ms / 1000);
    o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + ms / 1000 + 0.02);
  }
  return {
    get enabled() { return enabled; },
    setEnabled(v) { enabled = !!v; if (enabled) get(); },
    unlock() { if (enabled) get(); },
    play(name) { const c = enabled && get(); if (c && SEQ[name]) SEQ[name].forEach(([f, ms, w]) => beep(c, f, ms, w)); },
  };
}
