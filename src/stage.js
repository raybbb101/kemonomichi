// ステージ生成（シードから全員が同じ地形を生成する）
import { BIOMES, BOSS_ORDER, RIDDLES, PILLAR_COLORS } from './data.js';

export const FLOOR = 0, WALL = 1, PIT = 2, WATER = 3, ROCK = 4;

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function biomeOf(n) { return BIOMES[Math.floor((n - 1) / 10) % BIOMES.length]; }
export function stageKind(n, rest) { return rest ? 'rest' : n % 10 === 0 ? 'boss' : 'battle'; }

export function generate(n, seed, rest = false) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const s = tryGenerate(n, seed + attempt * 7919, rest, attempt);
    if (s) return s;
  }
  return tryGenerate(n, seed, rest, 99, true);
}

function tryGenerate(n, seed, rest, attempt, plain = false) {
  const r = rng(seed * 2654435761 + n * 97);
  const kind = stageKind(n, rest);
  const biome = biomeOf(rest ? Math.max(1, n) : n);
  const W = kind === 'rest' ? 20 : kind === 'boss' ? 26 : 28, H = kind === 'rest' ? 14 : 18;
  const T = new Uint8Array(W * H), Ht = new Float32Array(W * H);
  const id = (x, y) => y * W + x;
  const cy = Math.floor(H / 2);

  // 外周の崖（段々になるように高さを付ける）
  const depth = (len, base) => { const d = []; let v = base; for (let i = 0; i < len; i++) { if (r() < 0.3) v = Math.max(1, Math.min(3, v + (r() < 0.5 ? -1 : 1))); d.push(v); } return d; };
  const top = depth(W, 2), bot = depth(W, 2), left = depth(H, 1), right = depth(H, 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dIn = Math.min(top[x] - y, bot[x] - (H - 1 - y), left[y] - x, right[y] - (W - 1 - x));
    if (y < top[x] || H - 1 - y < bot[x] || x < left[y] || W - 1 - x < right[y]) {
      T[id(x, y)] = WALL;
      const ring = Math.min(y < top[x] ? top[x] - y : 9, H - 1 - y < bot[x] ? bot[x] - (H - 1 - y) : 9, x < left[y] ? left[y] - x : 9, W - 1 - x < right[y] ? right[y] - (W - 1 - x) : 9);
      // 手前側の崖は低くして、キャラクターが隠れないようにする
      Ht[id(x, y)] = y > cy ? 1 : Math.min(4, ring + (r() < 0.25 ? 1 : 0)) + 0.0 * dIn;
    }
  }
  const setT = (x, y, t, h = 0) => { if (x >= 0 && y >= 0 && x < W && y < H) { T[id(x, y)] = t; Ht[id(x, y)] = h; } };
  const spawn = { x: 3.5, z: cy + 0.5 }, exit = { x: W - 3.5, z: cy + 0.5 };
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = 1; x <= 5; x++) setT(x, y, FLOOR);
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = W - 6; x <= W - 2; x++) setT(x, y, FLOOR);

  const reserved = new Set();
  const reserve = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) reserved.add(id(x, y)); };
  reserve(1, cy - 2, 6, cy + 2); reserve(W - 7, cy - 2, W - 2, cy + 2);

  const objects = [];
  let oid = 1;
  const add = (o) => { o.id = 'o' + oid++; objects.push(o); return o; };
  add({ kind: 'portal', x: exit.x, z: exit.z });

  const floorAt = (x, y) => x >= 0 && y >= 0 && x < W && y < H && T[id(x, y)] === FLOOR;
  const isInterior = (x, y) => floorAt(x, y) && !reserved.has(id(x, y));

  let gimmick = null, riddle = null, pillarOrder = null;
  if (kind === 'battle' && !plain) {
    // 謎・仕掛け
    if (n >= 3 && r() < 0.6) {
      const gk = ['plates', 'riddle', 'pillars'][Math.floor(r() * 3)];
      const gx = Math.floor(W / 2), gy = cy;
      for (let y = gy - 4; y <= gy + 4; y++) for (let x = gx - 5; x <= gx + 5; x++) if (T[id(x, y)] !== WALL || (y > 2 && y < H - 3)) setT(x, y, FLOOR);
      reserve(gx - 5, gy - 4, gx + 5, gy + 4);
      gimmick = gk;
      if (gk === 'plates') {
        add({ kind: 'plate', x: gx - 3.5, z: gy - 1.5 }); add({ kind: 'plate', x: gx + 3.5, z: gy + 2.5 });
        add({ kind: 'boulder', x: gx + 0.5, z: gy - 1.5 });
      } else if (gk === 'riddle') {
        riddle = RIDDLES[Math.floor(r() * RIDDLES.length)];
        const order = [0, 1, 2].sort(() => r() - 0.5);
        add({ kind: 'tablet', x: gx + 0.5, z: gy - 2.5 });
        order.forEach((ai, i) => add({ kind: 'altar', x: gx - 2.5 + i * 3, z: gy + 1.5, label: riddle.a[ai], correct: ai === 0 }));
      } else {
        pillarOrder = [0, 1, 2, 3].sort(() => r() - 0.5);
        [[-3, -2], [3, -2], [-3, 2], [3, 2]].forEach(([dx, dy], i) => add({ kind: 'pillar', x: gx + dx + 0.5, z: gy + dy + 0.5, color: i, col: PILLAR_COLORS[i] }));
        add({ kind: 'tablet', x: gx + 0.5, z: gy + 0.5, pillars: true });
      }
    }
    // 池
    if (biome.water || r() < 0.35) {
      const px = 6 + Math.floor(r() * (W - 12)), py = r() < 0.5 ? 4 + Math.floor(r() * 2) : H - 6 - Math.floor(r() * 2);
      const rx = 2 + r() * 1.5, ry = 1.6 + r();
      let placed = false;
      for (let y = Math.floor(py - ry); y <= py + ry; y++) for (let x = Math.floor(px - rx); x <= px + rx; x++) {
        const dx = (x - px) / rx, dy = (y - py) / ry;
        if (dx * dx + dy * dy <= 1 && isInterior(x, y)) { setT(x, y, WATER); placed = true; }
      }
      if (placed && T[id(px, py)] === WATER && rx > 2.4) add({ kind: 'chest', bonus: 'water', x: px + 0.5, z: py + 0.5 });
    }
    // 谷と小島
    if (r() < 0.35) {
      const px = 7 + Math.floor(r() * (W - 14)), py = r() < 0.5 ? 5 : H - 6;
      let ok = true;
      for (let y = py - 2; y <= py + 2; y++) for (let x = px - 3; x <= px + 3; x++) if (!isInterior(x, y)) ok = false;
      if (ok) {
        for (let y = py - 2; y <= py + 2; y++) for (let x = px - 3; x <= px + 3; x++) {
          const dx = (x - px) / 3.2, dy = (y - py) / 2.3;
          if (dx * dx + dy * dy <= 1) setT(x, y, PIT);
        }
        setT(px, py, FLOOR); setT(px + 1, py, FLOOR);
        add({ kind: 'chest', bonus: 'island', x: px + 1, z: py + 0.5 });
      }
    }
    // 岩
    const nRocks = 3 + Math.floor(r() * 5);
    for (let i = 0; i < nRocks; i++) {
      const x = 4 + Math.floor(r() * (W - 8)), y = 3 + Math.floor(r() * (H - 6));
      const len = 1 + Math.floor(r() * 3), horiz = r() < 0.5;
      for (let k = 0; k < len; k++) { const xx = x + (horiz ? k : 0), yy = y + (horiz ? 0 : k); if (isInterior(xx, yy)) setT(xx, yy, ROCK, 0.8 + r() * 0.5); }
    }
    // 得意技のおまけ
    const freeSpot = () => { for (let k = 0; k < 60; k++) { const x = 3 + Math.floor(r() * (W - 6)), y = 3 + Math.floor(r() * (H - 6)); if (isInterior(x, y) && isInterior(x + 1, y) && isInterior(x, y + 1) && isInterior(x - 1, y) && isInterior(x, y - 1)) { reserve(x - 1, y - 1, x + 1, y + 1); return { x: x + 0.5, z: y + 0.5 }; } } return null; };
    if (r() < 0.55) { const p = freeSpot(); if (p) add({ kind: 'dig', ...p }); }
    if (r() < 0.4) { const p = freeSpot(); if (p) add({ kind: 'fruittree', ...p }); }
    if (r() < 0.4) {
      for (let k = 0; k < 40; k++) {
        const x = 4 + Math.floor(r() * (W - 8));
        let y = 1; while (y < H - 1 && T[id(x, y)] === WALL) y++;
        if (floorAt(x, y) && T[id(x, y - 1)] === WALL && !reserved.has(id(x, y))) { add({ kind: 'hole', x: x + 0.5, z: y - 0.3 }); reserve(x, y, x, y); break; }
      }
    }
  } else if (kind === 'boss') {
    for (let i = 0; i < 4; i++) {
      const x = 6 + Math.floor(r() * (W - 12)), y = 4 + Math.floor(r() * (H - 8));
      if (isInterior(x, y) && Math.abs(y - cy) > 2) setT(x, y, ROCK, 1);
    }
  } else if (kind === 'rest') {
    add({ kind: 'merchant', x: W / 2, z: cy - 1.5 });
    add({ kind: 'campfire', x: W / 2 - 3, z: cy + 1.5 });
    if (n === 50) add({ kind: 'fusion', x: W / 2 + 3, z: cy + 1.5 });
  }

  // 到達可能チェック
  const walk = (t) => t === FLOOR;
  const seen = new Uint8Array(W * H); const q = [id(Math.floor(spawn.x), Math.floor(spawn.z))]; seen[q[0]] = 1;
  while (q.length) { const c = q.pop(); const x = c % W, y = (c / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const k = id(nx, ny); if (!seen[k] && walk(T[k])) { seen[k] = 1; q.push(k); } } }
  const reach = (o) => { const x = Math.floor(o.x), y = Math.floor(o.z); for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (seen[id(x + dx, y + dy)]) return true; return false; };
  for (const o of objects) if (o.bonus !== 'water' && o.bonus !== 'island' && !reach(o)) return null;
  if (!seen[id(Math.floor(exit.x), Math.floor(exit.z))]) return null;

  // 飾り
  const decor = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = T[id(x, y)];
    // 手前(画面下側)の崖には背の高い木を置かない（キャラクターが隠れないように）
    if (t === WALL && Ht[id(x, y)] >= 1 && y < cy && r() < 0.32) decor.push({ kind: biome.deco[0], x: x + 0.3 + r() * 0.4, z: y + 0.3 + r() * 0.4, y: Ht[id(x, y)], v: Math.floor(r() * 3) });
    else if (t === WALL && y >= cy && y < H - 2 && r() < 0.15) decor.push({ kind: biome.deco[2], x: x + r(), z: y + r(), y: Ht[id(x, y)], v: Math.floor(r() * 5) });
    else if (t === FLOOR && !reserved.has(id(x, y))) {
      const v = r();
      if (v < 0.05) decor.push({ kind: biome.deco[1], x: x + r(), z: y + r(), y: 0, v: Math.floor(r() * 5) });
      else if (v < 0.13) decor.push({ kind: biome.deco[2], x: x + r(), z: y + r(), y: 0, v: Math.floor(r() * 5) });
      else if (v < 0.4 && biome.deco[2] !== 'crystal') decor.push({ kind: 'tuft', x: x + r(), z: y + r(), y: 0, v: 0 });
    }
  }
  if (biome.deco.includes('torch')) for (let i = 0; i < 6; i++) { const x = 3 + Math.floor(r() * (W - 6)); let y = 1; while (y < H - 1 && T[id(x, y)] === WALL) y++; decor.push({ kind: 'torch', x: x + 0.5, z: y + 0.15, y: 0, v: 0, light: true }); }

  // ウェーブ構成
  const waves = [];
  if (kind === 'battle') {
    const nWaves = 2 + (n > 12 ? 1 : 0) + (n > 32 ? 1 : 0);
    for (let w = 0; w < nWaves; w++) {
      const size = Math.min(11, 3 + Math.floor(n * 0.22) + w);
      waves.push(Array.from({ length: size }, () => biome.enemies[Math.floor(r() * biome.enemies.length)]));
    }
  } else if (kind === 'boss') {
    waves.push([BOSS_ORDER[(n / 10 - 1) % BOSS_ORDER.length]]);
  }

  return { n, seed, kind, biome, W, H, T, Ht, spawn, exit, objects, decor, gimmick, riddle, pillarOrder, waves };
}

export function tileAt(stage, x, z) {
  const tx = Math.floor(x), ty = Math.floor(z);
  if (tx < 0 || ty < 0 || tx >= stage.W || ty >= stage.H) return WALL;
  return stage.T[ty * stage.W + tx];
}

// mode: { fly, swim, leap }
export function passable(stage, x, z, mode = {}) {
  const t = tileAt(stage, x, z);
  if (t === FLOOR) return true;
  if (t === PIT) return !!(mode.fly || mode.leap);
  if (t === WATER) return !!(mode.fly || mode.swim || mode.leap);
  return false;
}

export function freeAt(stage, x, z, r, mode) {
  return passable(stage, x - r, z - r, mode) && passable(stage, x + r, z - r, mode) && passable(stage, x - r, z + r, mode) && passable(stage, x + r, z + r, mode);
}

// 軸ごとに移動して壁に沿って滑る
export function moveCircle(stage, e, dx, dz, r, mode) {
  if (freeAt(stage, e.x + dx, e.z, r, mode)) e.x += dx;
  if (freeAt(stage, e.x, e.z + dz, r, mode)) e.z += dz;
}
