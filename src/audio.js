// 効果音とBGMをその場で合成する（音声ファイル不要）
let ctx = null, master = null, bgmGain = null, bgmTimer = null;

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination);
  bgmGain = ctx.createGain(); bgmGain.gain.value = 0.16; bgmGain.connect(master);
}

function tone(freq, dur, { type = 'square', vol = 0.3, slide = 0, delay = 0, out = master } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.2, delay = 0, hp = 800) {
  if (!ctx) return;
  const t = ctx.currentTime + delay, len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = hp; s.buffer = buf; g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(master); s.start(t);
}

const SFX = {
  swing: () => noise(0.08, 0.12, 0, 2500),
  hit: () => { tone(180, 0.08, { type: 'square', vol: 0.15, slide: -80 }); noise(0.05, 0.1); },
  crit: () => { tone(520, 0.1, { type: 'square', vol: 0.12, slide: 300 }); noise(0.07, 0.15); },
  hurt: () => tone(220, 0.18, { type: 'sawtooth', vol: 0.15, slide: -120 }),
  skill: () => { tone(440, 0.12, { type: 'triangle', vol: 0.2, slide: 220 }); },
  ult: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, { type: 'square', vol: 0.12, delay: i * 0.06 })); },
  dodge: () => noise(0.12, 0.08, 0, 1200),
  coin: () => { tone(988, 0.07, { type: 'square', vol: 0.08 }); tone(1319, 0.12, { type: 'square', vol: 0.08, delay: 0.06 }); },
  level: () => { [523, 659, 784, 1046, 1319].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.2, delay: i * 0.07 })); },
  chest: () => { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.2, { type: 'triangle', vol: 0.2, delay: i * 0.08 })); },
  ding: () => tone(1046, 0.4, { type: 'sine', vol: 0.3 }),
  buzz: () => tone(110, 0.35, { type: 'sawtooth', vol: 0.15 }),
  solve: () => { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.2, delay: i * 0.09 })); },
  portal: () => { tone(300, 0.6, { type: 'sine', vol: 0.25, slide: 600 }); },
  kill: () => { tone(300, 0.1, { type: 'square', vol: 0.08, slide: -200 }); noise(0.1, 0.08); },
  boss: () => { tone(110, 0.8, { type: 'sawtooth', vol: 0.2, slide: -40 }); tone(165, 0.8, { type: 'sawtooth', vol: 0.12, slide: -60 }); },
  buy: () => { tone(784, 0.08, { type: 'square', vol: 0.1 }); tone(1046, 0.15, { type: 'square', vol: 0.1, delay: 0.07 }); },
  fusion: () => { [262, 330, 392, 523, 659, 784, 1046, 1319].forEach((f, i) => tone(f, 0.5, { type: 'triangle', vol: 0.18, delay: i * 0.1 })); },
  select: () => tone(660, 0.06, { type: 'square', vol: 0.08 }),
};
export function sfx(name) { try { SFX[name]?.(); } catch { /* 音が鳴らなくても続行 */ } }

// ゆったりしたペンタトニックのBGM（地域ごとに音階を変える）
const SCALES = [[0, 2, 4, 7, 9], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10], [0, 2, 5, 7, 9], [0, 2, 4, 7, 11], [0, 3, 5, 6, 10]];
export function playBgm(biomeIdx = 0, boss = false) {
  if (!ctx) return;
  stopBgm();
  const scale = SCALES[biomeIdx % SCALES.length], root = boss ? 45 : [57, 60, 50, 55, 62, 52][biomeIdx % 6];
  const step = boss ? 0.16 : 0.26;
  let i = 0;
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  bgmTimer = setInterval(() => {
    const bar = Math.floor(i / 16), pos = i % 16;
    const chord = [0, 3, 4, 2][bar % 4];
    if (pos % 4 === 0) tone(midi(root - 12 + scale[chord % 5]), step * 3.6, { type: 'triangle', vol: 0.5, out: bgmGain });
    if (Math.random() < (boss ? 0.75 : 0.55)) { const n = scale[(chord + Math.floor(Math.random() * 5)) % 5] + 12 * (Math.random() < 0.3 ? 1 : 0); tone(midi(root + n), step * 1.8, { type: boss ? 'square' : 'sine', vol: boss ? 0.18 : 0.35, out: bgmGain }); }
    if (boss && pos % 2 === 0) noise(0.04, 0.05, 0, 4000);
    i++;
  }, step * 1000);
}
export function stopBgm() { if (bgmTimer) clearInterval(bgmTimer); bgmTimer = null; }
export function setMuted(m) { if (master) master.gain.value = m ? 0 : 0.35; }
