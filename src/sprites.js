// ドット絵スプライトの生成。
// 図形(楕円・三角・線)を低解像度のバッファに描き、自動で陰影と縁取りを付けてドット絵にする。
// 融合種は「ベース動物の体」+「相方の特徴パーツ(耳・羽・角・鋏…)」を合成して作る。

import { ANIMALS } from './data.js';

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const mix = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
const mul = (a, k) => toHex(hex(a).map((v) => v * k));

class Pix {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Array(w * h).fill(null); this.ox = 0; this.oy = 0; }
  set(x, y, c) { x = Math.floor(x + this.ox); y = Math.floor(y + this.oy); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = c; }
  get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.d[y * this.w + x] : null; }
  px(x, y, c) { this.set(x, y, c); }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  ell(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++)
      for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
  }
  tri(x1, y1, x2, y2, x3, y3, c) {
    const minX = Math.floor(Math.min(x1, x2, x3)), maxX = Math.ceil(Math.max(x1, x2, x3));
    const minY = Math.floor(Math.min(y1, y2, y3)), maxY = Math.ceil(Math.max(y1, y2, y3));
    const s = (ax, ay, bx, by, px, py) => (px - bx) * (ay - by) - (ax - bx) * (py - by);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const d1 = s(px, py, x1, y1, x2, y2), d2 = s(px, py, x2, y2, x3, y3), d3 = s(px, py, x3, y3, x1, y1);
      const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) this.set(x, y, c);
    }
  }
  line(x1, y1, x2, y2, c, w = 1) {
    const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2 + 1;
    for (let i = 0; i <= n; i++) {
      const x = x1 + (x2 - x1) * (i / n), y = y1 + (y2 - y1) * (i / n);
      if (w <= 1) this.set(x, y, c); else this.rect(Math.round(x - w / 2), Math.round(y - w / 2), w, w, c);
    }
  }
  at(dx, dy, fn) { const ox = this.ox, oy = this.oy; this.ox += dx; this.oy += dy; fn(); this.ox = ox; this.oy = oy; }
  // 陰影 + 縁取り → canvas
  bake({ shade = true, outline = true, outlineCol = null } = {}) {
    const { w, h } = this;
    const out = this.d.slice();
    if (shade) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = this.d[y * w + x]; if (!c) continue;
      const below = this.get(x, y + 1), above = this.get(x, y - 1);
      if (!below || (below !== c && y > 0 && this.get(x, y + 2) === null)) out[y * w + x] = mul(c, 0.78);
      else if (!above) out[y * w + x] = mix(c, '#ffffff', 0.18);
    }
    const fin = out.slice();
    if (outline) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (out[y * w + x]) continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => (x + a >= 0 && x + a < w && y + b >= 0 && y + b < h ? out[(y + b) * w + x + a] : null)).find(Boolean);
      if (n) fin[y * w + x] = outlineCol || mix(mul(n, 0.28), '#1a1020', 0.4);
    }
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(w, h);
    fin.forEach((c, i) => { if (!c) return; const [r, g, b] = hex(c); img.data.set([r, g, b, 255], i * 4); });
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}

// ---- 動物 (24x24・右向き・地面 y=22) ----
const DEF = {
  dog: {
    pal: { a: '#e09447', b: '#f6e7cf', c: '#b8692c', e: '#1b1410', n: '#2a1a14', k: '#f0a090' },
    A: { head: [17.5, 10], rear: [5, 13], top: [11, 12] },
    body(g, p) {
      g.line(6, 14, 4, 10, p.a, 2); g.ell(4.5, 9, 1.7, 1.7, p.b);
      g.rect(7, 17, 2, 5, p.c); g.rect(13, 17, 2, 5, p.c);
      g.ell(11, 15, 6.2, 3.8, p.a); g.ell(11.5, 17.2, 4, 1.6, p.b);
      g.rect(9, 18, 2, 4, p.a); g.rect(15, 18, 2, 4, p.a); g.rect(9, 21, 2, 1, p.b); g.rect(15, 21, 2, 1, p.b);
      g.ell(17.5, 10.5, 3.9, 3.6, p.a); g.ell(20.2, 12.2, 2.4, 1.7, p.b);
      g.tri(14.2, 3.5, 17.2, 7.5, 14, 8.6, p.a); g.tri(18.6, 3.5, 20.8, 8.2, 17.4, 7.4, p.a);
      g.px(15, 6, p.c); g.px(19, 6, p.c);
      g.px(18, 9, p.e); g.px(18, 10, p.e); g.px(22, 11, p.n); g.px(20, 13, p.n); g.px(16, 12, p.k);
    },
    part: {
      front(g, p, A) { const [x, y] = A.head; g.tri(x - 3.3, y - 6.5, x - 0.3, y - 2.5, x - 3.5, y - 1.4, p.a); g.tri(x + 1.1, y - 6.5, x + 3.3, y - 1.8, x - 0.1, y - 2.6, p.a); g.px(x - 2.5, y - 4, p.c); g.px(x + 1.5, y - 4, p.c); },
      back(g, p, A) { const [x, y] = A.rear; g.line(x + 1, y + 1, x - 1, y - 3, p.a, 2); g.ell(x - 0.5, y - 4, 1.7, 1.7, p.b); },
    },
  },
  cat: {
    pal: { a: '#7d84a0', b: '#d4d6e0', c: '#5a6078', e: '#f6d44a', n: '#1b1420', k: '#f0a0b0' },
    A: { head: [17, 11.5], rear: [5, 15], top: [11, 13] },
    body(g, p) {
      g.line(5, 16, 3, 11, p.a, 2); g.line(3, 11, 4, 6, p.a, 2); g.px(4, 5, p.c);
      g.rect(7, 18, 2, 4, p.c); g.rect(13, 18, 2, 4, p.c);
      g.ell(11, 16, 6, 3.3, p.a); g.ell(11.5, 17.8, 4, 1.3, p.b);
      g.px(9, 13, p.c); g.px(11, 13, p.c); g.px(13, 13, p.c); g.px(9, 14, p.c); g.px(11, 14, p.c);
      g.rect(9, 18, 2, 4, p.a); g.rect(15, 18, 2, 4, p.a); g.rect(9, 21, 2, 1, p.b); g.rect(15, 21, 2, 1, p.b);
      g.ell(17, 11.5, 3.8, 3.4, p.a); g.ell(19.3, 13, 2, 1.4, p.b);
      g.tri(13.6, 9.5, 14.8, 5, 17, 8.4, p.a); g.tri(17.6, 8.4, 19.8, 5, 20.8, 9.8, p.a); g.px(15, 7, p.k); g.px(19, 7, p.k);
      g.px(18, 11, p.e); g.px(18, 10, p.e); g.px(19, 11, p.n); g.px(21, 12, p.k);
    },
    part: {
      front(g, p, A) { const [x, y] = A.head; g.tri(x - 3.4, y - 2, x - 2.2, y - 6.5, x, y - 3.1, p.a); g.tri(x + 0.6, y - 3.1, x + 2.8, y - 6.5, x + 3.8, y - 1.7, p.a); g.px(x - 2, y - 4.5, p.k); g.px(x + 2, y - 4.5, p.k); },
      back(g, p, A) { const [x, y] = A.rear; g.line(x, y + 1, x - 2, y - 4, p.a, 2); g.line(x - 2, y - 4, x - 1, y - 9, p.a, 2); },
    },
  },
  rabbit: {
    pal: { a: '#f2ece2', b: '#ffffff', c: '#d8cfc2', e: '#d03a5a', n: '#f19ab0', k: '#f6b6c6' },
    A: { head: [15.5, 11.5], rear: [5, 15], top: [10, 13] },
    body(g, p) {
      g.ell(5, 15, 1.9, 1.9, p.b);
      g.ell(10, 16.5, 5.2, 4.6, p.a); g.ell(12.5, 21, 3.4, 1.3, p.c);
      g.ell(15.5, 19.5, 1.2, 2, p.a);
      g.ell(15.5, 12, 3.6, 3.4, p.a);
      g.ell(14, 5.5, 1.3, 4.6, p.a); g.ell(17.2, 6, 1.3, 4.2, p.a); g.rect(14, 3, 1, 5, p.k); g.rect(17, 4, 1, 4, p.k);
      g.px(17, 11, p.e); g.px(19, 12, p.n); g.px(16, 13, p.k);
    },
    part: {
      front(g, p, A) { const [x, y] = A.head; g.ell(x - 1.5, y - 7, 1.3, 4.6, p.a); g.ell(x + 1.7, y - 6.5, 1.3, 4.2, p.a); g.rect(x - 1.5, y - 9.5, 1, 5, p.k); g.rect(x + 1.5, y - 8.5, 1, 4, p.k); },
      back(g, p, A) { const [x, y] = A.rear; g.ell(x, y, 1.9, 1.9, p.b); },
    },
  },
  snake: {
    pal: { a: '#5fae5a', b: '#d6e8a0', c: '#3f8a44', e: '#ffd84a', n: '#e0405a', k: '#2f6a34' },
    A: { head: [17, 9.5], rear: [4, 19], top: [10, 15] },
    body(g, p) {
      g.ell(11, 19.5, 7.6, 2.6, p.a); g.ell(9, 16.6, 4.6, 2.1, p.c);
      g.ell(14.6, 14, 1.9, 4.6, p.a); g.ell(17, 9.5, 3.4, 2.4, p.a); g.ell(18.5, 10.6, 1.8, 0.9, p.b);
      for (let i = 5; i < 18; i += 3) g.px(i, 19, p.k); for (let i = 6; i < 13; i += 3) g.px(i, 16, p.b);
      g.px(14, 12, p.k); g.px(15, 15, p.k);
      g.px(18, 8, p.e); g.px(19, 8, p.e); g.line(20.5, 10.5, 22, 10.5, p.n); g.px(23, 10, p.n); g.px(23, 11, p.n);
    },
    part: {
      back(g, p, A) { const [x, y] = A.rear; g.ell(x - 0.5, y + 1, 3.6, 1.6, p.a); g.ell(x - 3, y - 1, 1.4, 2, p.a); g.px(x - 1, y + 1, p.k); g.px(x + 1, y + 1, p.k); },
    },
  },
  crab: {
    pal: { a: '#e2553e', b: '#f7b08a', c: '#b93a2a', e: '#ffffff', n: '#111111', k: '#ff8a6a' },
    A: { head: [12, 12], rear: [5, 16], top: [12, 13] },
    body(g, p) {
      g.line(6.5, 18, 3, 21.5, p.c, 1); g.line(8, 19, 6, 22, p.c, 1); g.line(16, 19, 18, 22, p.c, 1); g.line(17.5, 18, 21, 21.5, p.c, 1);
      g.line(6, 15, 4, 12.5, p.a, 2); g.line(18, 15, 20, 12.5, p.a, 2);
      g.ell(4, 10.5, 2.9, 2.6, p.a); g.ell(20, 10.5, 2.9, 2.6, p.a); g.px(3, 8, null); g.rect(2, 8, 2, 1, null); g.rect(20, 8, 2, 1, null);
      g.ell(12, 16, 7, 4, p.a); g.ell(12, 17.6, 4.5, 1.6, p.b);
      g.rect(9, 9, 1, 4, p.c); g.rect(14, 9, 1, 4, p.c);
      g.ell(9.5, 8.6, 1.4, 1.4, p.e); g.ell(14.5, 8.6, 1.4, 1.4, p.e); g.px(9, 8, p.n); g.px(14, 8, p.n);
      g.px(11, 15, p.c); g.px(12, 15, p.c);
    },
    part: {
      front(g, p, A) { const [x, y] = A.head; g.line(x - 1, y + 5, x + 2, y + 3, p.a, 2); g.ell(x + 3.5, y + 1.5, 2.8, 2.5, p.a); g.rect(x + 3, y - 1.2, 2, 1, null); },
    },
  },
  monkey: {
    pal: { a: '#9a6440', b: '#ecc79c', c: '#74462a', e: '#1a1410', n: '#c08060', k: '#f0a080' },
    A: { head: [14, 8.5], rear: [7, 17], top: [11, 12] },
    body(g, p) {
      g.line(7, 18, 4, 17, p.a, 2); g.line(4, 17, 3, 12, p.a, 2); g.ell(4.5, 11, 1.6, 1.6, p.a); g.px(5, 11, null);
      g.rect(8, 19, 2, 3, p.c); g.rect(12, 19, 2, 3, p.a);
      g.ell(11, 15.5, 4.2, 4.5, p.a); g.ell(12, 16, 2.4, 3.2, p.b);
      g.line(14, 13, 17, 16, p.a, 2); g.ell(17.5, 16.5, 1, 1, p.b);
      g.ell(14, 8.6, 4.1, 3.9, p.a); g.ell(10.2, 8.6, 1.6, 1.7, p.b); g.ell(15.3, 9.6, 2.9, 2.7, p.b);
      g.px(15, 8, p.e); g.px(17, 8, p.e); g.px(16, 11, p.n); g.px(17, 11, p.n);
    },
    part: {
      back(g, p, A) { const [x, y] = A.rear; g.line(x, y + 1, x - 3, y, p.a, 2); g.line(x - 3, y, x - 4, y - 5, p.a, 2); g.ell(x - 2.5, y - 6, 1.6, 1.6, p.a); g.px(x - 2, y - 6, null); },
    },
  },
  butterfly: {
    pal: { a: '#6fb8f5', b: '#a77bdc', c: '#2f5f9a', e: '#ffffff', n: '#2b2238', k: '#ffd36b' },
    A: { head: [12, 7], rear: [12, 18], top: [12, 11] },
    body(g, p) {
      g.ell(7, 9, 5.2, 5.2, p.a); g.ell(8, 16.5, 4, 3.6, p.b); g.ell(6.5, 8.5, 2.2, 2.2, p.c); g.px(5, 7, p.e); g.px(8, 16, p.k); g.px(4, 11, p.k);
      g.ell(16.5, 9, 4.2, 4.6, mix(p.a, '#ffffff', 0.15)); g.ell(16, 15.5, 3, 3, mix(p.b, '#ffffff', 0.15)); g.ell(17, 9, 1.6, 1.6, p.c);
      g.rect(11, 8, 2, 12, p.n); g.ell(12, 7, 1.7, 1.7, p.n); g.px(13, 6, p.e);
      g.line(12, 5, 10, 1.5, p.n); g.line(13, 5, 15, 1.5, p.n); g.px(10, 1, p.k); g.px(15, 1, p.k);
    },
    part: {
      back(g, p, A) { const [x, y] = A.top; g.ell(x - 3, y - 5, 4.6, 4.6, p.a); g.ell(x - 3.5, y + 0.5, 3.2, 2.8, p.b); g.ell(x - 3.5, y - 5.5, 1.8, 1.8, p.c); g.px(x - 5, y - 7, p.e); },
    },
  },
  beetle: {
    pal: { a: '#5a3f8a', b: '#9a7ad0', c: '#2c2040', e: '#ffd84a', n: '#3a2a5e', k: '#c8a8ff' },
    A: { head: [17.5, 15.5], rear: [4, 15], top: [10.5, 12] },
    body(g, p) {
      g.line(8, 19, 6, 22, p.c); g.line(11, 19.5, 11, 22, p.c); g.line(14, 19, 16, 22, p.c);
      g.ell(10.5, 15.5, 7.2, 4.6, p.a); g.ell(8.5, 13.4, 3.2, 1.2, p.k); g.line(4, 16.5, 17, 16.5, p.n);
      g.ell(17.5, 16, 2.9, 2.6, p.n); g.line(18.5, 14, 21, 9, p.c, 2); g.line(21, 9, 22, 5.5, p.c); g.line(21.5, 8.5, 23, 7.5, p.c);
      g.line(15, 12, 17, 9.5, p.c); g.px(19, 15, p.e);
    },
    part: {
      front(g, p, A) { const [x, y] = A.head; g.line(x + 0.5, y - 2, x + 3, y - 6.5, p.c, 2); g.line(x + 3, y - 6.5, x + 4, y - 9.5, p.c); g.line(x + 3.5, y - 7, x + 5, y - 8, p.c); },
    },
  },
};

// ---- 敵 ----
const ENEMY_DEF = {
  mouse(g) { g.line(7, 18, 2, 15, '#d9a0a8'); g.ell(11, 17.5, 5, 3.4, '#8d8a8f'); g.ell(16, 16.5, 3, 2.6, '#8d8a8f'); g.ell(14.5, 13.4, 1.8, 1.8, '#a6a2a8'); g.px(14, 13, '#e8a0b0'); g.px(19, 17, '#f08aa0'); g.px(17, 16, '#ff3040'); g.rect(9, 20, 2, 2, '#6d6a70'); g.rect(14, 20, 2, 2, '#6d6a70'); },
  boar(g) { g.rect(6, 18, 2, 4, '#4a3020'); g.rect(10, 18, 2, 4, '#4a3020'); g.rect(13, 18, 2, 4, '#5a3d2c'); g.ell(11, 15, 7, 4.6, '#6b4a35'); for (let i = 6; i < 16; i += 2) g.tri(i, 11, i + 1, 8.5, i + 2, 11, '#4a3020'); g.rect(16, 18, 2, 4, '#5a3d2c'); g.ell(18, 15.5, 3.6, 3.3, '#5a3d2c'); g.ell(21, 16.5, 1.7, 1.6, '#d4a088'); g.px(21, 16, '#3a2020'); g.px(19, 19, '#fff6e0'); g.px(20, 18, '#fff6e0'); g.tri(16, 13, 17, 10, 18, 13, '#4a3020'); g.px(18, 14, '#ff3040'); },
  wasp(g) { g.ell(12, 8, 3.2, 2.2, '#cfe8ff'); g.ell(9, 8.6, 2.6, 1.8, '#b8dcff'); g.tri(2, 14, 5, 12.6, 5, 15.4, '#222'); g.ell(8, 14, 4, 3, '#f2c230'); g.rect(6, 11, 1, 6, '#2a2018'); g.rect(9, 11, 1, 6, '#2a2018'); g.ell(13, 13, 2.6, 2.4, '#3a2a1a'); g.ell(16.5, 12.5, 2.3, 2.3, '#f2c230'); g.px(17, 12, '#ff3040'); g.line(17, 10.5, 19, 8, '#222'); g.line(12, 15, 11, 18, '#222'); g.line(14, 15, 15, 18, '#222'); },
  shroom(g) { g.rect(8, 13, 8, 8, '#efe3cc'); g.ell(12, 21, 5, 1.2, '#d8c8a8'); g.ell(12, 10, 8.4, 5, '#d8433a'); g.ell(8, 8, 1.5, 1.2, '#fff'); g.ell(14, 6.5, 1.8, 1.3, '#fff'); g.ell(16.5, 10, 1.2, 1, '#fff'); g.px(10, 16, '#2a1010'); g.px(14, 16, '#2a1010'); g.line(9, 15, 10.5, 15.5, '#5a2a20'); g.line(15, 15, 13.5, 15.5, '#5a2a20'); g.px(11, 18, '#5a2a20'); g.px(12, 18, '#5a2a20'); },
  lizard(g) { g.line(7, 17, 1, 20, '#3f7a5a', 2); g.line(18.5, 4, 18.5, 22, '#9a7a5a'); g.tri(17, 5, 18.5, 1, 20, 5, '#c8ccd6'); g.rect(9, 18, 2, 4, '#3f7a5a'); g.rect(13, 18, 2, 4, '#3f7a5a'); g.ell(11, 14.5, 4, 4.5, '#4d8c6a'); g.ell(12, 15.5, 2.2, 3, '#d8d39a'); g.ell(15, 9.5, 3.4, 2.5, '#4d8c6a'); g.ell(17, 10.5, 1.8, 1.1, '#5d9c7a'); g.px(16, 9, '#ff3040'); g.line(13, 13, 18, 14, '#4d8c6a', 2); g.rect(8, 11, 6, 2, '#8a6a4a'); },
  crow(g) { g.tri(2, 11, 7, 13, 4, 17, '#22203a'); g.line(11, 18, 10, 21, '#e8a23a'); g.line(13, 18, 14, 21, '#e8a23a'); g.ell(11, 14, 5.6, 4, '#2a2840'); g.ell(10, 13, 4, 2.4, '#3d3a5e'); g.ell(16, 10.5, 3, 2.8, '#2a2840'); g.tri(18.4, 9.5, 22.5, 11, 18.4, 12.2, '#e8b23a'); g.px(17, 10, '#ff3040'); },
};
const BOSS_DEF = {
  bear(g) { g.rect(8, 24, 4, 6, '#4e3020'); g.rect(19, 24, 4, 6, '#4e3020'); g.ell(15, 19, 10, 7.4, '#6a4430'); g.ell(13, 22.5, 6, 3, '#8a6048'); g.rect(11, 24, 4, 6, '#6a4430'); g.rect(22, 24, 4, 6, '#6a4430'); for (const x of [11, 13, 22, 24]) g.px(x, 29, '#fff3dc'); g.ell(23, 12.5, 6, 5.6, '#6a4430'); g.ell(19.4, 7.8, 2.1, 2.1, '#6a4430'); g.ell(26.4, 7.8, 2.1, 2.1, '#6a4430'); g.px(19, 8, '#3a2418'); g.px(26, 8, '#3a2418'); g.ell(27.2, 14.6, 3, 2.3, '#c9a07a'); g.rect(28, 13, 2, 1, '#2a1810'); g.px(24, 11, '#ff3040'); g.px(25, 11, '#ff3040'); g.line(21, 9, 24, 13, '#3a2418'); g.line(26, 16, 29, 16, '#3a2418'); },
  queen(g) { g.ell(15, 9.5, 5.5, 3.4, '#cfe8ff'); g.ell(11, 10.5, 4.4, 2.8, '#b8dcff'); g.tri(1, 20, 5, 18, 5, 22, '#222'); g.ell(10, 19, 6.4, 5, '#f2c230'); for (const x of [7, 10, 13]) g.rect(x, 14.5, 1.5, 9, '#2a2018'); g.ell(17.5, 17, 4, 3.6, '#3a2a1a'); g.ell(22.5, 15, 3.6, 3.5, '#f2c230'); g.rect(20, 10, 6, 2, '#ffd84a'); g.px(20, 9, '#ffd84a'); g.px(23, 8, '#ffd84a'); g.px(25, 9, '#ffd84a'); g.px(23, 10, '#ff3a6a'); g.px(23, 15, '#ff3040'); g.px(24, 15, '#ff3040'); for (const x of [15, 18, 21]) g.line(x, 20, x - 1, 26, '#222'); },
  croc(g) { g.tri(0, 21, 6, 18, 6, 24, '#3d6a3d'); g.rect(8, 22, 3, 5, '#3d6a3d'); g.rect(17, 22, 3, 5, '#3d6a3d'); g.ell(14, 19.5, 10, 4.6, '#4a7a4a'); for (let x = 7; x < 21; x += 3) g.tri(x, 15.5, x + 1.5, 12.5, x + 3, 15.5, '#3d6a3d'); g.rect(20, 16, 11, 4, '#4a7a4a'); g.rect(21, 20, 9, 2, '#d8d39a'); for (let x = 21; x < 30; x += 2) g.px(x, 19, '#ffffff'); g.ell(22.5, 15, 1.8, 1.6, '#4a7a4a'); g.px(23, 14, '#ff3040'); g.px(30, 16, '#2a3a2a'); g.ell(13, 22, 6, 1.4, '#c8c48a'); },
  owl(g) { g.ell(9, 19, 3.2, 7.5, '#5e4430'); g.ell(23, 19, 3.2, 7.5, '#5e4430'); g.ell(16, 19, 8, 9, '#7a5a3a'); g.ell(16, 21.5, 5, 6, '#d9c39a'); for (let y = 18; y < 27; y += 3) { g.px(14, y, '#8a6a4a'); g.px(18, y, '#8a6a4a'); g.px(16, y + 1, '#8a6a4a'); } g.ell(16, 11, 6.5, 5.5, '#7a5a3a'); g.ell(16, 11.4, 5.4, 4.4, '#e6d2a8'); g.tri(10, 3, 13, 7.5, 9.5, 8, '#7a5a3a'); g.tri(22, 3, 22.5, 8, 19, 7.5, '#7a5a3a'); g.ell(13.5, 11, 2, 2, '#ffcc33'); g.ell(18.5, 11, 2, 2, '#ffcc33'); g.px(13, 11, '#1a1010'); g.px(18, 11, '#1a1010'); g.tri(15, 13, 17, 13, 16, 15.5, '#e8a23a'); g.line(13, 28, 13, 30, '#e8a23a'); g.line(19, 28, 19, 30, '#e8a23a'); },
  dragon(g) { g.tri(3, 3, 17, 14, 2, 17, '#3a2a4e'); g.line(3, 3, 17, 14, '#22182e'); g.line(3, 3, 6, 16, '#22182e'); g.line(5, 22, 0, 26, '#2a2238', 3); g.rect(9, 23, 3, 6, '#22182e'); g.rect(17, 23, 3, 6, '#22182e'); g.ell(14, 20, 9, 6, '#2a2238'); g.ell(15, 22.5, 6, 3, '#7a3a3a'); for (let x = 7; x < 19; x += 3) g.tri(x, 15, x + 1.5, 11.5, x + 3, 15, '#4a3a66'); g.ell(21, 13, 3, 6, '#2a2238'); g.ell(25, 8.6, 4.6, 3.2, '#2a2238'); g.rect(26, 10, 5, 2, '#2a2238'); g.rect(26, 12, 4, 1, '#7a3a3a'); g.line(23, 6, 21, 1.5, '#c9b89a', 2); g.line(26, 6, 26, 2, '#c9b89a'); g.px(26, 8, '#ff7a20'); g.px(27, 8, '#ffb020'); g.px(30, 12, '#ff7a20'); },
};

const cache = new Map();
const keep = (k, fn) => { if (!cache.has(k)) cache.set(k, fn()); return cache.get(k); };

export function animalSprite(key) {
  return keep('a:' + key, () => {
    if (!key.includes('+')) { const D = DEF[key]; const g = new Pix(24, 24); D.body(g, D.pal); return g.bake(); }
    const [base, mate] = key.split('+');
    const B = DEF[base], M = DEF[mate];
    const pal = Object.fromEntries(Object.entries(B.pal).map(([k, v]) => [k, ['e', 'n'].includes(k) ? v : mix(v, ANIMALS[mate].color, 0.3)]));
    const g = new Pix(24, 24);
    M.part.back?.(g, M.pal, B.A);
    B.body(g, pal);
    M.part.front?.(g, M.pal, B.A);
    // 融合の証：額の小さな宝石
    g.px(B.A.head[0], B.A.head[1] - 2, '#7af7ff');
    return g.bake();
  });
}

export function enemySprite(type) {
  return keep('e:' + type, () => {
    if (BOSS_DEF[type]) { const g = new Pix(32, 32); BOSS_DEF[type](g); return g.bake(); }
    const g = new Pix(24, 24); ENEMY_DEF[type](g); return g.bake();
  });
}

export function merchantSprite() {
  return keep('merchant', () => {
    const g = new Pix(24, 24);
    g.rect(2, 8, 6, 11, '#b5713a'); g.rect(2, 11, 6, 1, '#8a5428'); g.ell(5, 7.5, 3, 1.4, '#e6c36a');
    g.rect(9, 19, 2, 3, '#6a4a30'); g.rect(13, 19, 2, 3, '#6a4a30');
    g.ell(12, 16, 5, 5.4, '#8a6a4a'); g.ell(12, 17.4, 3.4, 3.6, '#e8d6b0');
    g.ell(12, 10, 4.8, 3.9, '#8a6a4a'); g.ell(12, 11.4, 2.6, 1.8, '#e8d6b0');
    g.ell(9.8, 9.6, 1.7, 1.3, '#3a2a20'); g.ell(14.2, 9.6, 1.7, 1.3, '#3a2a20'); g.px(10, 9, '#ffffff'); g.px(14, 9, '#ffffff'); g.px(12, 11, '#2a1a10');
    g.ell(8.5, 6.5, 1.4, 1.4, '#6a4a30'); g.ell(15.5, 6.5, 1.4, 1.4, '#6a4a30');
    g.ell(12, 5.6, 6.6, 1.4, '#e6c36a'); g.ell(12, 4.4, 3.2, 1.6, '#e6c36a'); g.rect(9, 5, 6, 1, '#c0392b');
    g.line(16, 14, 19, 17, '#8a6a4a', 2); g.ell(19.5, 18, 1.6, 1.6, '#ffd84a');
    return g.bake();
  });
}

// ---- 小物・植物 ----
const rnd = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
export function propSprite(kind, variant = 0) {
  return keep(`p:${kind}:${variant}`, () => {
    const r = rnd(1234 + variant * 97 + kind.length * 13);
    let g;
    const leafy = (w, h, cols, trunk, n = 9) => {
      g = new Pix(w, h); const cx = w / 2;
      g.rect(cx - 1.5, h - 14, 3, 13, trunk); g.rect(cx - 2.5, h - 3, 5, 2, trunk);
      for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, d = r() * (w * 0.22); g.ell(cx + Math.cos(a) * d, h * 0.38 + Math.sin(a) * d * 0.8, w * 0.22 + r() * 2, w * 0.2 + r() * 2, cols[0]); }
      for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, d = r() * (w * 0.16); g.ell(cx + Math.cos(a) * d - 1, h * 0.33 + Math.sin(a) * d * 0.7 - 1, w * 0.13 + r() * 1.5, w * 0.12 + r(), cols[1]); }
      for (let i = 0; i < 6; i++) g.px(cx + (r() - 0.5) * w * 0.5, h * 0.25 + (r() - 0.3) * h * 0.25, cols[2]);
    };
    switch (kind) {
      case 'tree': leafy(32, 40, ['#3f7f3a', '#5ea34c', '#8fd06a'], '#6a4a30'); break;
      case 'autumn': leafy(32, 40, [['#c8582e', '#d98a2e', '#c8402e'][variant % 3], '#e8a84a', '#ffd27a'], '#5a3a28'); break;
      case 'fruittree': leafy(32, 40, ['#3f7f3a', '#5ea34c', '#8fd06a'], '#6a4a30'); for (let i = 0; i < 7; i++) g.ell(8 + r() * 16, 8 + r() * 12, 1.4, 1.4, '#ff5a4a'); break;
      case 'pine': case 'snowpine': {
        g = new Pix(24, 40); g.rect(10.5, 30, 3, 9, '#5a3a28');
        const c = ['#2f6a4a', '#3f7f5a']; for (let i = 0; i < 4; i++) g.tri(12, 2 + i * 7, 3 - i * 0.5 + 2, 14 + i * 7, 21 + i * 0.5 - 2, 14 + i * 7, c[i % 2]);
        for (let i = 0; i < 4; i++) g.tri(12, 2 + i * 7, 9, 7 + i * 7, 15, 7 + i * 7, '#eef4fb');
        break;
      }
      case 'palm': {
        g = new Pix(32, 40); g.line(15, 39, 17, 12, '#8a6a48', 3); for (let i = 0; i < 5; i++) g.px(16, 16 + i * 5, '#6a4a30');
        for (const [dx, dy] of [[-10, 4], [10, 4], [-8, -3], [8, -3], [0, -6]]) g.line(16, 11, 16 + dx, 11 + dy, '#4f9a44', 3);
        g.ell(16, 13, 2, 2, '#7a5a30'); break;
      }
      case 'bush': case 'snowbush': { g = new Pix(16, 12); g.ell(8, 7.5, 7, 4.5, kind === 'snowbush' ? '#cfdbe8' : '#4f8f3e'); g.ell(6, 6, 3.5, 2.6, kind === 'snowbush' ? '#ffffff' : '#6fb050'); if (r() < 0.6 && kind === 'bush') { g.px(10, 6, '#ff9ab0'); g.px(5, 8, '#fff2a0'); } break; }
      case 'flower': { g = new Pix(8, 10); const c = ['#ff8aa8', '#fff27a', '#9ad0ff', '#ffffff', '#ffb45a'][variant % 5]; g.line(4, 9, 4, 4, '#4f8f3e'); g.px(3, 6, '#5ea34c'); g.px(3, 2, c); g.px(5, 2, c); g.px(4, 1, c); g.px(4, 3, c); g.px(4, 2, '#ffd84a'); break; }
      case 'tuft': { g = new Pix(8, 6); g.line(2, 5, 1, 1, '#4f8f3e'); g.line(4, 5, 4, 0, '#6fb050'); g.line(6, 5, 7, 2, '#4f8f3e'); return g.bake({ shade: false, outline: false }); }
      case 'shell': { g = new Pix(8, 6); g.ell(4, 4, 3, 2, '#ffd6c8'); g.px(4, 3, '#e8a090'); break; }
      case 'crystal': { g = new Pix(12, 16); const c = ['#9ad8ff', '#d0a0ff', '#7affd8'][variant % 3]; g.tri(6, 1, 2, 14, 9, 14, c); g.tri(9, 6, 7, 14, 11.5, 14, mix(c, '#000000', 0.2)); g.line(5, 4, 4, 11, '#ffffff'); break; }
      case 'shroomdeco': { g = new Pix(10, 10); g.rect(4, 5, 2, 4, '#efe3cc'); g.ell(5, 4.5, 4, 2.6, '#6fd0c0'); g.px(3, 4, '#d8fff8'); break; }
      case 'torch': { g = new Pix(8, 16); g.rect(3, 6, 2, 10, '#6a4a30'); g.ell(4, 4, 2.4, 3.4, '#ff9a3a'); g.ell(4, 4.6, 1.2, 2, '#ffe07a'); break; }
      case 'chest': case 'chestopen': {
        g = new Pix(16, 14);
        g.rect(2, 6, 12, 7, '#9a5a2a'); g.rect(2, 9, 12, 1, '#6a3a1a'); g.rect(7, 8, 2, 3, '#ffd84a');
        if (kind === 'chest') { g.ell(8, 6, 6, 2.6, '#b06a32'); g.rect(2, 5, 12, 1, '#ffd84a'); } else { g.rect(2, 1, 12, 3, '#b06a32'); g.rect(3, 5, 10, 1, '#2a1a10'); g.px(5, 4, '#fff7c0'); g.px(10, 3, '#fff7c0'); }
        break;
      }
      case 'pillar': { g = new Pix(12, 24); g.rect(2, 21, 8, 3, '#8a8a96'); g.rect(3, 4, 6, 17, '#b5b5c4'); g.rect(2, 2, 8, 3, '#8a8a96'); g.rect(4, 6, 1, 13, '#d0d0dc'); break; }
      case 'tablet': { g = new Pix(16, 20); g.ell(8, 4, 6, 3, '#8a8f9e'); g.rect(2, 4, 12, 15, '#8a8f9e'); for (let y = 6; y < 17; y += 3) g.rect(4, y, 8, 1, '#5a5f6e'); g.ell(8, 19, 7, 1.2, '#6a6f7e'); break; }
      case 'altar': { g = new Pix(14, 12); g.rect(1, 4, 12, 3, '#a8a0b8'); g.rect(3, 7, 8, 5, '#8a8296'); g.ell(7, 3, 2, 2, '#ffe9a0'); break; }
      case 'boulder': { g = new Pix(16, 14); g.ell(8, 7.5, 7, 6, '#8e8a84'); g.ell(6, 5.5, 3, 2, '#aaa69e'); g.px(10, 9, '#6e6a64'); g.px(11, 8, '#6e6a64'); break; }
      case 'dig': { g = new Pix(14, 8); g.ell(7, 5, 6, 2.6, '#7a5a3c'); g.ell(7, 4.5, 3.5, 1.6, '#9a7a54'); g.px(5, 3, '#fff7a0'); g.px(9, 4, '#fff7a0'); g.px(7, 2, '#ffffff'); return g.bake({ outline: false }); }
      case 'hole': { g = new Pix(16, 16); g.ell(8, 9, 7, 6.5, '#6a5a4a'); g.ell(8, 10, 4, 4.5, '#120c10'); g.rect(4, 14, 8, 2, '#120c10'); g.px(2, 12, '#4f8f3e'); g.px(13, 11, '#4f8f3e'); break; }
      case 'plate': { g = new Pix(16, 8); g.ell(8, 4, 7, 3, '#7a7f90'); g.ell(8, 3.6, 5, 2, '#a8adbc'); g.px(8, 3, '#fff7a0'); return g.bake({ shade: false }); }
      case 'coin': { g = new Pix(8, 8); g.ell(4, 4, 3, 3, '#ffd84a'); g.rect(4, 2, 1, 4, '#c89a20'); break; }
      default: g = new Pix(8, 8); g.rect(0, 0, 8, 8, '#ff00ff');
    }
    return g.bake();
  });
}

// ---- 地形テクスチャ (16x16) ----
export function tileTexture(cols, kind, seed = 1) {
  return keep(`t:${kind}:${cols.join()}:${seed}`, () => {
    const r = rnd(seed * 31 + kind.length);
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const ctx = cv.getContext('2d');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let c = cols[0];
      const v = r();
      if (kind === 'top') c = v < 0.18 ? cols[1] : v < 0.3 ? cols[2] : cols[0];
      else if (kind === 'side') { c = y < 3 ? mix(cols[0], '#ffffff', 0.08) : (y % 5 === 0 && v < 0.7) ? cols[1] : v < 0.15 ? cols[2] : cols[0]; }
      else if (kind === 'grassside') { c = y < 3 + (x % 3 === 0 ? 1 : 0) ? cols.grass : (y % 5 === 0 && v < 0.7) ? cols[1] : v < 0.15 ? cols[2] : cols[0]; }
      else if (kind === 'stone') { c = (x % 8 === 0 || y % 8 === 0) ? cols[1] : v < 0.2 ? cols[2] : cols[0]; }
      ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1);
    }
    return cv;
  });
}

export function glowTexture(color = '#ffffff') {
  return keep('g:' + color, () => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const ctx = cv.getContext('2d'); const gr = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 32, 32); return cv;
  });
}
