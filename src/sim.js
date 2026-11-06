// ホスト側のシミュレーション：敵AI・ボス・弾・当たり判定・仕掛け・ウェーブ・ステージ進行
import { ENEMIES, ITEMS, GENERAL_ITEMS, speciesOf } from './data.js';
import { moveCircle, freeAt, passable, FLOOR, rng } from './stage.js';

let EID = 1;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const norm = (x, z) => { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; };

export class Sim {
  constructor(game) {
    this.g = game; this.net = game.net;
    this.enemies = game.enemies; this.projs = []; this.ev = []; this.timers = []; this.snapT = 0; this.hitAcc = {};
    this.revive = {}; this.allDownT = 0;
  }

  // ---------- ステージ進行 ----------
  beginStage(n, rest) {
    const seed = Math.floor(Math.random() * 1e9);
    this.net.broadcast({ type: 'stage', n, rest, seed });
  }

  onStageBuilt(st) {
    this.enemies.clear(); this.projs = []; this.timers = [];
    this.waves = st.waves.map((w) => w.slice()); this.waveDelay = 1.5; this.solved = !st.gimmick; this.portalOpen = false;
    this.pillarStep = 0; this.portalT = 0; this.advancing = false; this.r = rng(st.seed + 99);
    this.objState = {};
    if (st.kind === 'rest') this.openPortal(true);
  }

  setObj(id, state) { if (this.objState[id] === state) return; this.objState[id] = state; this.ev.push({ k: 'obj', id, state }); }

  openPortal(quiet) {
    if (this.portalOpen) return; this.portalOpen = true;
    const p = this.g.stage.objects.find((o) => o.kind === 'portal');
    this.setObj(p.id, 'open');
    if (!quiet) this.ev.push({ k: 'toast', text: 'ポータルが開いた！ 全員で入ろう' });
  }

  alivePlayers() { return [...this.g.players.values()].filter((p) => !p.down); }

  spawnEnemy(type, x, z, delay = 0.8) {
    const D = ENEMIES[type], n = this.g.stage.n, np = Math.max(1, this.g.players.size);
    const hpMul = (1 + (n - 1) * 0.12) * (1 + 0.55 * (np - 1)) * (n > 50 ? 1 + (n - 50) * 0.05 : 1) * (D.boss ? 0.55 : 1);
    const e = { id: 'e' + EID++, type, x, z, kvx: 0, kvz: 0, hp: D.hp * hpMul, mhp: D.hp * hpMul, atk: D.atk * (1 + (n - 1) * 0.055), spd: D.spd, r: D.r, fly: !!D.fly, boss: !!D.boss, face: 1, cd: 1 + Math.random(), state: 'idle', t: 0, spawnT: delay, spawning: true, poison: null, stun: 0, sleep: 0, slow: null, flash: 0, wind: 0, ang: Math.random() * 6 };
    this.enemies.set(e.id, e);
    this.ev.push({ k: 'fx', fx: { k: 'spawn', x, z } });
    if (e.boss) { e.phase = 1; e.atkIdx = 0; this.ev.push({ k: 'boss', id: e.id, name: D.name }); }
    return e;
  }

  spawnWave(list) {
    const st = this.g.stage, ps = this.alivePlayers(), np = Math.max(1, this.g.players.size);
    const extra = Math.floor(list.length * 0.4 * (np - 1));
    const all = [...list, ...list.slice(0, extra)];
    for (const type of all) {
      let x, z, ok = false;
      for (let k = 0; k < 80 && !ok; k++) {
        x = 2 + this.r() * (st.W - 4); z = 2 + this.r() * (st.H - 4);
        const big = ENEMIES[type].boss;
        ok = passable(st, x, z) && freeAt(st, x, z, big ? 0.9 : 0.4) && ps.every((p) => Math.hypot(p.x - x, p.z - z) > (big ? 7 : 5)) && Math.hypot(x - st.exit.x, z - st.exit.z) > 3;
      }
      if (ok) this.spawnEnemy(type, x, z, ENEMIES[type].boss ? 1.5 : 0.8);
    }
  }

  // ---------- メインループ ----------
  update(dt) {
    const st = this.g.stage; if (!st) return;
    for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; if ((t.t -= dt) <= 0) { this.timers.splice(i, 1); t.fn(); } }

    // ウェーブ
    if (st.kind !== 'rest' && this.enemies.size === 0) {
      if (this.waves.length) { if ((this.waveDelay -= dt) <= 0) { const w = this.waves.shift(); this.spawnWave(w); this.waveDelay = 1.2; if (st.kind === 'battle' && this.waves.length === 0 && st.waves.length > 1) this.ev.push({ k: 'toast', text: '最後の群れだ！' }); } }
      else if (this.solved && !this.portalOpen) { this.openPortal(); if (st.kind === 'boss') this.ev.push({ k: 'toast', text: 'ボスを倒した！', big: true }); }
      else if (!this.solved && !this.hintShown) { this.hintShown = true; this.ev.push({ k: 'toast', text: '仕掛けを解かないとポータルが開かない…' }); }
    }

    for (const e of this.enemies.values()) this.updateEnemy(e, dt);
    this.updateProjectiles(dt);
    this.updateGimmicks(dt);
    this.updateRevive(dt);
    this.updatePortal(dt);

    this.snapT -= dt;
    if (this.snapT <= 0) { this.snapT = 0.05; this.sendSnapshot(); }
  }

  sendSnapshot() {
    for (const [owner, v] of Object.entries(this.hitAcc)) this.net.sendTo(owner, { type: 'hits', n: v.n, kills: v.k, dmg: v.dmg });
    this.hitAcc = {};
    const e = [...this.enemies.values()].map((e) => [e.id, e.type, +e.x.toFixed(2), +e.z.toFixed(2), Math.ceil(e.hp), Math.ceil(e.mhp), e.face, (e.stun > 0 ? 1 : 0) | (e.sleep > 0 ? 2 : 0) | (e.flash > 0 ? 4 : 0) | (e.wind > 0 ? 8 : 0) | (e.spawning ? 16 : 0)]);
    const p = this.projs.map((p) => [p.id, p.kind, +p.x.toFixed(2), +p.z.toFixed(2)]);
    const b = this.g.stage.objects.find((o) => o.kind === 'boulder');
    const msg = { type: 'snap', e, p, pl: [...this.g.players.values()], b: b ? [b.x, b.z] : null, rv: this.revive };
    if (this.ev.length) { msg.ev = this.ev; this.ev = []; }
    this.net.broadcast(msg);
  }

  // ---------- 敵AI ----------
  nearestPlayer(e) {
    let best = null, bd = 1e9;
    for (const p of this.alivePlayers()) { const d = dist(p, e); if (d < bd) { bd = d; best = p; } }
    return best ? { p: best, d: bd } : null;
  }

  hurtPlayer(p, dmg, from) { this.net.sendTo(p.id, { type: 'hurt', dmg: Math.round(dmg), x: from.x, z: from.z }); }
  hitPlayersCircle(x, z, r, dmg, from, onlyOnce) {
    for (const p of this.alivePlayers()) if (Math.hypot(p.x - x, p.z - z) < r + 0.3 && !(onlyOnce && onlyOnce.has(p.id))) { this.hurtPlayer(p, dmg, from); onlyOnce?.add(p.id); }
  }
  tele(fx, dur, then) { this.ev.push({ k: 'fx', fx: { k: 'tele', dur, ...fx } }); this.timers.push({ t: dur, fn: then }); }
  shoot(x, z, dx, dz, spd, dmg, kind = 'enemy', r = 0.3, range = 12) {
    this.projs.push({ id: 'p' + EID++, team: 'e', x, z, vx: dx * spd, vz: dz * spd, dmg, kind, r, life: range / spd, hit: new Set(), pierce: 0 });
  }

  updateEnemy(e, dt) {
    const st = this.g.stage, D = ENEMIES[e.type];
    e.flash = Math.max(0, e.flash - dt);
    if (e.spawning) { if ((e.spawnT -= dt) <= 0) e.spawning = false; return; }
    if (e.poison) { const d = e.poison.dps * dt; e.hp -= d; e.poisonAcc = (e.poisonAcc || 0) + d; if (e.poisonAcc > 4) { this.ev.push({ k: 'dmg', x: e.x, z: e.z, v: Math.round(e.poisonAcc), c: 'poison' }); e.poisonAcc = 0; } if ((e.poison.t -= dt) <= 0) e.poison = null; if (e.hp <= 0) return this.kill(e, e.poison?.owner); }
    if (e.slow && (e.slow.t -= dt) <= 0) e.slow = null;
    // ノックバック
    if (Math.abs(e.kvx) + Math.abs(e.kvz) > 0.05) { moveCircle(st, e, e.kvx * dt, e.kvz * dt, Math.min(e.r, 0.45), { fly: e.fly }); const k = Math.pow(0.004, dt); e.kvx *= k; e.kvz *= k; }
    if (e.stun > 0) { e.stun -= dt; e.wind = 0; return; }
    if (e.sleep > 0) { e.sleep -= dt; e.wind = 0; return; }
    const tgt = this.nearestPlayer(e); if (!tgt) return;
    const { p, d } = tgt; const dir = norm(p.x - e.x, p.z - e.z);
    const spd = e.spd * (e.slow ? e.slow.m : 1);
    if (Math.abs(dir.x) > 0.2 && e.state !== 'dash') e.face = dir.x > 0 ? 1 : -1;
    e.cd -= dt;
    const move = (vx, vz, s = spd) => moveCircle(st, e, vx * s * dt, vz * s * dt, Math.min(e.r, 0.45), { fly: e.fly });
    // 敵同士で重ならないように
    for (const o of this.enemies.values()) if (o !== e && !o.spawning) { const dx = e.x - o.x, dz = e.z - o.z, dd = Math.hypot(dx, dz), min = e.r + o.r; if (dd < min && dd > 0.01) move(dx / dd, dz / dd, (min - dd) * 4); }

    if (e.boss) return this.updateBoss(e, dt, p, d, dir, move);
    switch (D.ai) {
      case 'chase':
        if (e.wind > 0) { e.wind -= dt; if (e.wind <= 0) { this.hitPlayersCircle(e.x + e.dx * 0.8, e.z + e.dz * 0.8, D.range * 0.8, e.atk, e); this.ev.push({ k: 'fx', fx: { k: 'slash', x: e.x, z: e.z, dx: e.dx, dz: e.dz, r: D.range + 0.3, arc: 100, col: '#ff7070' } }); e.cd = 1.2; } }
        else if (d > D.range + e.r) move(dir.x, dir.z);
        else if (e.cd <= 0) { e.wind = 0.4; e.dx = dir.x; e.dz = dir.z; }
        break;
      case 'charge':
        if (e.state === 'dash') {
          e.t -= dt; move(e.dx, e.dz, 10.5);
          this.hitPlayersCircle(e.x, e.z, e.r + 0.2, e.atk * 1.3, e, e.hitSet);
          if (e.t <= 0) { e.state = 'idle'; e.cd = 2.4; }
        } else if (e.wind > 0) { e.wind -= dt; if (e.wind <= 0) { e.state = 'dash'; e.t = 0.55; e.hitSet = new Set(); } }
        else if (d > 6) move(dir.x, dir.z);
        else if (e.cd <= 0) { e.wind = 0.7; e.dx = dir.x; e.dz = dir.z; e.face = dir.x > 0 ? 1 : -1; this.ev.push({ k: 'fx', fx: { k: 'tele', shape: 'line', x: e.x, z: e.z, dx: dir.x, dz: dir.z, len: 6, w: 1, dur: 0.7 } }); }
        else move(dir.x, dir.z, spd * 0.4);
        break;
      case 'ranged':
        if (d > 6.5) move(dir.x, dir.z); else if (d < 4) move(-dir.x, -dir.z, spd * 0.8);
        else { e.ang += dt; move(-dir.z * Math.sin(e.ang), dir.x * Math.sin(e.ang), spd * 0.5); }
        if (e.cd <= 0 && d < 9) { e.cd = 1.9; e.wind = 0.25; this.timers.push({ t: 0.25, fn: () => { if (this.enemies.has(e.id)) { const dd = norm(p.x - e.x, p.z - e.z); this.shoot(e.x, e.z, dd.x, dd.z, 7, e.atk); e.wind = 0; } } }); }
        break;
      case 'turret':
        if (e.cd <= 0) { e.cd = 2.8; e.ang += 0.5; for (let i = 0; i < 6; i++) { const a = e.ang + (i / 6) * Math.PI * 2; this.shoot(e.x, e.z, Math.cos(a), Math.sin(a), 4.2, e.atk, 'spore', 0.35, 9); } }
        break;
      case 'swoop':
        if (e.state === 'dash') { e.t -= dt; move(e.dx, e.dz, 9.5); this.hitPlayersCircle(e.x, e.z, e.r + 0.2, e.atk, e, e.hitSet); if (e.t <= 0) { e.state = 'idle'; e.cd = 2.6; } }
        else if (e.wind > 0) { e.wind -= dt; if (e.wind <= 0) { e.state = 'dash'; e.t = 0.5; e.hitSet = new Set(); } }
        else {
          e.ang += dt * 1.4; const tx = p.x + Math.cos(e.ang) * 3.5, tz = p.z + Math.sin(e.ang) * 3.5; const m = norm(tx - e.x, tz - e.z); move(m.x, m.z);
          if (e.cd <= 0 && d < 6) { e.wind = 0.45; e.dx = dir.x; e.dz = dir.z; this.ev.push({ k: 'fx', fx: { k: 'tele', shape: 'line', x: e.x, z: e.z, dx: dir.x, dz: dir.z, len: 4.8, w: 0.8, dur: 0.45 } }); }
        }
        break;
    }
  }

  updateBoss(e, dt, p, d, dir, move) {
    const D = ENEMIES[e.type];
    if (e.hp < e.mhp * 0.5 && e.phase === 1) { e.phase = 2; this.ev.push({ k: 'toast', text: `${D.name}が怒り狂った！`, big: true }); }
    const haste = e.phase === 2 ? 0.65 : 1;
    if (e.state === 'dash') {
      e.t -= dt; move(e.dx, e.dz, 11); this.hitPlayersCircle(e.x, e.z, e.r + 0.3, e.atk * 1.4, e, e.hitSet);
      if (e.t <= 0) { e.state = 'idle'; this.ev.push({ k: 'fx', fx: { k: 'boom', x: e.x, z: e.z, r: 2, col: '#ffb070' } }); }
      return;
    }
    if (e.state === 'busy') { e.t -= dt; if (e.t <= 0) e.state = 'idle'; return; }
    if (d > 2.5 + e.r) move(dir.x, dir.z, e.spd * (e.slow ? e.slow.m : 1));
    if (e.cd > 0) return;
    const atk = D.attacks[e.atkIdx++ % D.attacks.length];
    e.cd = 2.2 * haste; e.state = 'busy'; e.t = 1.1; e.wind = 1;
    const tp = { x: p.x, z: p.z };
    switch (atk) {
      case 'slam': {
        const n = e.phase === 2 ? 3 : 1;
        for (let i = 0; i < n; i++) { const x = tp.x + (i ? (this.r() - 0.5) * 6 : 0), z = tp.z + (i ? (this.r() - 0.5) * 6 : 0); this.tele({ x, z, r: 2.4 }, 1.0, () => { this.hitPlayersCircle(x, z, 2.4, e.atk * 1.5, { x, z }); this.ev.push({ k: 'fx', fx: { k: 'boom', x, z, r: 2.4, col: '#ffb070' } }); }); }
        break;
      }
      case 'charge': e.dx = dir.x; e.dz = dir.z; e.face = dir.x > 0 ? 1 : -1; this.tele({ shape: 'line', x: e.x, z: e.z, dx: dir.x, dz: dir.z, len: 9, w: e.r * 2, }, 0.9, () => { if (this.enemies.has(e.id)) { e.state = 'dash'; e.t = 0.75; e.hitSet = new Set(); } }); e.t = 0.9; break;
      case 'sweep': this.tele({ x: e.x, z: e.z, r: 3.4 }, 0.8, () => { this.hitPlayersCircle(e.x, e.z, 3.4, e.atk * 1.3, e); this.ev.push({ k: 'fx', fx: { k: 'wave', x: e.x, z: e.z, r: 3.4, col: '#9fe8ff' } }); }); break;
      case 'summon': { const n = 2 + this.g.players.size; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const x = e.x + Math.cos(a) * 2.5, z = e.z + Math.sin(a) * 2.5; if (passable(this.g.stage, x, z)) this.spawnEnemy(D.summon, x, z, 0.9); } this.ev.push({ k: 'toast', text: '仲間を呼んだ！' }); break; }
      case 'ring': { const waves = e.phase === 2 ? 3 : 2; for (let w = 0; w < waves; w++) this.timers.push({ t: w * 0.45, fn: () => { if (!this.enemies.has(e.id)) return; const off = this.r() * 6; for (let i = 0; i < 14; i++) { const a = off + (i / 14) * Math.PI * 2; this.shoot(e.x, e.z, Math.cos(a), Math.sin(a), 5.5, e.atk * 0.8, e.type === 'owl' ? 'feather' : 'enemy', 0.35, 14); } } }); break; }
      case 'barrage': for (let i = 0; i < (e.phase === 2 ? 8 : 5); i++) this.timers.push({ t: i * 0.14, fn: () => { if (!this.enemies.has(e.id)) return; const q = this.nearestPlayer(e); if (!q) return; const dd = norm(q.p.x - e.x, q.p.z - e.z); this.shoot(e.x, e.z, dd.x, dd.z, 9, e.atk * 0.7, e.type === 'owl' ? 'feather' : 'enemy'); } }); break;
      case 'blink': {
        let x = e.x, z = e.z; for (let k = 0; k < 30; k++) { const a = this.r() * 6.28; x = tp.x + Math.cos(a) * 4; z = tp.z + Math.sin(a) * 4; if (freeAt(this.g.stage, x, z, 0.8, { fly: true }) && passable(this.g.stage, x, z)) break; }
        this.ev.push({ k: 'fx', fx: { k: 'poof', x: e.x, z: e.z, col: '#c9b8ff' } }); e.x = x; e.z = z; this.ev.push({ k: 'fx', fx: { k: 'poof', x, z, col: '#c9b8ff' } }); e.cd = 0.6; break;
      }
      case 'cone': {
        e.dx = dir.x; e.dz = dir.z;
        this.tele({ shape: 'cone', x: e.x, z: e.z, dx: dir.x, dz: dir.z, r: 7 }, 0.9, () => { if (!this.enemies.has(e.id)) return; for (let i = 0; i < 11; i++) { const a = Math.atan2(e.dz, e.dx) + (i / 10 - 0.5) * 1.0; this.shoot(e.x, e.z, Math.cos(a), Math.sin(a), 10, e.atk * 0.9, 'fire', 0.45, 8); } this.ev.push({ k: 'fx', fx: { k: 'boom', x: e.x + e.dx * 1.5, z: e.z + e.dz * 1.5, r: 1.5, col: '#ff8a3a' } }); });
        break;
      }
      case 'rain': for (const pl of this.alivePlayers()) for (let i = 0; i < 3; i++) { const x = pl.x + (this.r() - 0.5) * 5, z = pl.z + (this.r() - 0.5) * 5; this.tele({ x, z, r: 1.6 }, 1.1 + i * 0.2, () => { this.hitPlayersCircle(x, z, 1.6, e.atk * 1.2, { x, z }); this.ev.push({ k: 'fx', fx: { k: 'boom', x, z, r: 1.6, col: '#ff8a3a' } }); }); } break;
    }
  }

  // ---------- 弾 ----------
  updateProjectiles(dt) {
    const st = this.g.stage;
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i];
      if (p.homing) {
        let best = null, bd = 36; for (const e of this.enemies.values()) { if (e.spawning) continue; const d = (e.x - p.x) ** 2 + (e.z - p.z) ** 2; if (d < bd) { bd = d; best = e; } }
        if (best) { const s = Math.hypot(p.vx, p.vz), want = norm(best.x - p.x, best.z - p.z), k = Math.min(1, p.homing * dt); const n = norm(p.vx / s + (want.x - p.vx / s) * k, p.vz / s + (want.z - p.vz / s) * k); p.vx = n.x * s; p.vz = n.z * s; }
      }
      p.x += p.vx * dt; p.z += p.vz * dt; p.life -= dt;
      let dead = p.life <= 0 || !passable(st, p.x, p.z, { fly: true });
      if (!dead && p.team === 'p') {
        for (const e of this.enemies.values()) {
          if (e.spawning || p.hit.has(e.id)) continue;
          if (Math.hypot(e.x - p.x, e.z - p.z) < e.r + p.r) { p.hit.add(e.id); this.damage(e, p.c, p.step, { x: p.vx, z: p.vz }); if (p.pierce-- <= 0) { dead = true; break; } }
        }
        this.hitPillars(p.x, p.z, 0.4);
      } else if (!dead) {
        for (const pl of this.alivePlayers()) if (Math.hypot(pl.x - p.x, pl.z - p.z) < 0.35 + p.r) { this.hurtPlayer(pl, p.dmg, p); dead = true; break; }
      }
      if (dead) { this.projs.splice(i, 1); if (p.team === 'p' && p.life > 0) this.ev.push({ k: 'fx', fx: { k: 'hit', x: p.x, z: p.z } }); }
    }
  }

  // ---------- プレイヤーの攻撃 ----------
  handleAct(msg) {
    const { step: s, c } = msg; if (!s || !c) return;
    const aoe = c.aoe || 1;
    const dir = { x: c.dx, z: c.dz };
    switch (s.t) {
      case 'melee': {
        const range = s.range * aoe, half = (s.arc / 2) * Math.PI / 180;
        for (const e of [...this.enemies.values()]) {
          if (e.spawning) continue;
          const dx = e.x - c.x, dz = e.z - c.z, d = Math.hypot(dx, dz);
          if (d > range + e.r) continue;
          if (s.arc < 360 && d > e.r && Math.acos(Math.max(-1, Math.min(1, (dx * dir.x + dz * dir.z) / d))) > half) continue;
          this.damage(e, c, s, { x: dx, z: dz });
        }
        this.hitPillars(c.x + dir.x * range * 0.6, c.z + dir.z * range * 0.6, range * 0.7);
        this.ev.push({ k: 'fx', fx: { k: 'slash', x: c.x, z: c.z, dx: dir.x, dz: dir.z, r: range, arc: s.arc, col: s.col || '#fff3d0' } });
        break;
      }
      case 'aoe': {
        const r = s.r * aoe, x = c.x + dir.x * (s.off || 0), z = c.z + dir.z * (s.off || 0);
        for (const e of [...this.enemies.values()]) if (!e.spawning && Math.hypot(e.x - x, e.z - z) < r + e.r) this.damage(e, c, s, { x: e.x - x, z: e.z - z });
        this.hitPillars(x, z, r);
        this.ev.push({ k: 'fx', fx: { k: s.fx || 'ring', x, z, r, col: s.col || '#ffffff' } });
        break;
      }
      case 'line': {
        const a = c.from || { x: c.x - dir.x * 3, z: c.z - dir.z * 3 }, b = { x: c.x, z: c.z };
        const abx = b.x - a.x, abz = b.z - a.z, L = abx * abx + abz * abz || 1;
        for (const e of [...this.enemies.values()]) {
          if (e.spawning) continue;
          const t = Math.max(0, Math.min(1, ((e.x - a.x) * abx + (e.z - a.z) * abz) / L));
          const px = a.x + abx * t, pz = a.z + abz * t;
          if (Math.hypot(e.x - px, e.z - pz) < (s.w * aoe) / 2 + e.r) this.damage(e, c, s, { x: e.x - px + abx * 0.3, z: e.z - pz + abz * 0.3 });
        }
        this.hitPillars((a.x + b.x) / 2, (a.z + b.z) / 2, Math.sqrt(L) / 2);
        this.ev.push({ k: 'fx', fx: { k: 'ring', x: b.x, z: b.z, r: 1.4, col: '#fff3d0' } });
        break;
      }
      case 'proj': {
        const n = s.n || 1, base = Math.atan2(dir.z, dir.x);
        for (let i = 0; i < n; i++) {
          const a = s.ring ? (i / n) * Math.PI * 2 : base + (n > 1 ? (i / (n - 1) - 0.5) * (s.spread || 0) * Math.PI / 180 : 0);
          this.projs.push({ id: 'p' + EID++, team: 'p', x: c.x + Math.cos(a) * 0.4, z: c.z + Math.sin(a) * 0.4, vx: Math.cos(a) * s.spd, vz: Math.sin(a) * s.spd, kind: s.kind || 'nut', r: 0.3, life: (s.range || 8) / s.spd, hit: new Set(), pierce: s.pierce || 0, homing: s.homing || 0, c, step: s });
        }
        break;
      }
      case 'party': {
        for (const p of this.g.players.values()) if (Math.hypot(p.x - c.x, p.z - c.z) < s.r) this.net.sendTo(p.id, { type: 'party', heal: s.heal ? s.heal * (c.heal || 1) : 0, buff: s.buff, shield: s.shield });
        this.ev.push({ k: 'fx', fx: { k: s.fx || 'heal', x: c.x, z: c.z, r: Math.min(s.r, 5), col: s.fx === 'shield' ? '#9fe8ff' : s.fx === 'howl' ? '#ffd27a' : '#9fffb0' } });
        break;
      }
      case 'rain': {
        const cx = c.x + dir.x * 2.5, cz = c.z + dir.z * 2.5;
        for (let i = 0; i < s.n; i++) this.timers.push({
          t: i * (s.gap || 0.08), fn: () => {
            const targets = [...this.enemies.values()].filter((e) => !e.spawning && Math.hypot(e.x - cx, e.z - cz) < s.area);
            const tg = targets.length && this.r() < 0.65 ? targets[Math.floor(this.r() * targets.length)] : null;
            const x = tg ? tg.x + (this.r() - 0.5) : cx + (this.r() - 0.5) * s.area * 1.6, z = tg ? tg.z + (this.r() - 0.5) : cz + (this.r() - 0.5) * s.area * 1.6;
            for (const e of [...this.enemies.values()]) if (!e.spawning && Math.hypot(e.x - x, e.z - z) < s.r + e.r) this.damage(e, c, s, { x: e.x - x, z: e.z - z });
            this.hitPillars(x, z, s.r);
            this.ev.push({ k: 'fx', fx: { k: 'boom', x, z, r: s.r, col: s.col || '#ffffff' } });
          },
        });
        break;
      }
      case 'pull': {
        for (const e of this.enemies.values()) { const dx = c.x - e.x, dz = c.z - e.z, d = Math.hypot(dx, dz); if (d < s.r && d > 1) { const k = Math.min(d - 1, s.str) / d; moveCircle(this.g.stage, e, dx * k, dz * k, Math.min(e.r, 0.45), { fly: e.fly }); } }
        this.ev.push({ k: 'fx', fx: { k: 'wave', x: c.x, z: c.z, r: s.r, col: '#5fe0b0' } });
        break;
      }
    }
  }

  damage(e, c, s, kdir) {
    if (!this.enemies.has(e.id)) return;
    const crit = Math.random() < (c.crit || 0);
    const v = Math.round(s.dmg * c.atk * (crit ? c.cm || 1.7 : 1) * (0.92 + Math.random() * 0.16));
    e.hp -= v; e.flash = 0.1; e.sleep = 0;
    const st = s.st || {};
    if (st.poison) e.poison = { dps: Math.max(e.poison?.dps || 0, st.poison[0] * c.atk * (c.poison || 1)), t: Math.max(e.poison?.t || 0, st.poison[1]), owner: c.owner };
    const res = e.boss ? 0.35 : 1;
    if (st.stun) e.stun = Math.max(e.stun, st.stun * res);
    if (st.sleep) this.timers.push({ t: 0, fn: () => { if (this.enemies.has(e.id)) e.sleep = st.sleep * res; } });
    if (st.slow) e.slow = { m: st.slow[0], t: st.slow[1] };
    const kb = (s.kb || 0.4) * (c.kb || 1) * (e.boss ? 0.15 : 1);
    if (kb > 0) { const n = norm(kdir.x, kdir.z); e.kvx += n.x * kb * 4; e.kvz += n.z * kb * 4; }
    this.ev.push({ k: 'dmg', x: e.x, z: e.z, v, c: crit ? 'crit' : '' });
    const a = (this.hitAcc[c.owner] ||= { n: 0, k: 0, dmg: 0 }); a.n++; a.dmg += v;
    if (e.hp <= 0) this.kill(e, c.owner);
  }

  kill(e, owner) {
    if (!this.enemies.has(e.id)) return;
    this.enemies.delete(e.id);
    const D = ENEMIES[e.type], n = this.g.stage.n;
    const gold = Math.round(D.gold * (1 + n * 0.08)), xp = Math.round(D.xp * (1 + n * 0.05));
    this.ev.push({ k: 'kill', x: e.x, z: e.z, gold, xp, boss: e.boss, id: e.id });
    if (owner && this.hitAcc[owner]) this.hitAcc[owner].k++;
  }

  // ---------- 仕掛け ----------
  hitPillars(x, z, r) {
    const st = this.g.stage; if (st.gimmick !== 'pillars' || this.solved) return;
    for (const o of st.objects) {
      if (o.kind !== 'pillar' || Math.hypot(o.x - x, o.z - z) > r + 0.5) continue;
      if (this.objState[o.id] === 'lit') continue;
      if ((o.hitCd || 0) > performance.now()) continue; o.hitCd = performance.now() + 400;
      if (st.pillarOrder[this.pillarStep] === o.color) {
        this.setObj(o.id, 'lit'); this.pillarStep++; this.ev.push({ k: 'sfx', s: 'ding' });
        if (this.pillarStep >= 4) this.solve();
      } else {
        this.pillarStep = 0; for (const p of st.objects) if (p.kind === 'pillar') this.setObj(p.id, '');
        this.ev.push({ k: 'toast', text: '順番が違う…柱の光が消えた' }); this.ev.push({ k: 'sfx', s: 'buzz' });
      }
    }
  }

  solve() {
    if (this.solved) return; this.solved = true;
    const st = this.g.stage;
    for (const o of st.objects) if (['plate', 'pillar', 'tablet', 'altar'].includes(o.kind)) this.setObj(o.id, o.kind === 'altar' && !o.correct ? 'bad' : 'done');
    this.ev.push({ k: 'toast', text: '謎が解けた！', big: true }); this.ev.push({ k: 'sfx', s: 'solve' });
    const gold = 20 + st.n * 3; this.ev.push({ k: 'loot', gold, to: null, item: null, text: `謎解きの報酬 ${gold}G` });
  }

  updateGimmicks(dt) {
    const st = this.g.stage;
    const boulder = st.objects.find((o) => o.kind === 'boulder');
    if (boulder) {
      for (const p of this.alivePlayers()) {
        const dx = boulder.x - p.x, dz = boulder.z - p.z, d = Math.hypot(dx, dz);
        if (d < 0.95 && d > 0.01) {
          const strong = speciesOf(p.an).tags.includes('push');
          const s = (strong ? 3.6 : 1.5) * dt;
          moveCircle(st, boulder, (dx / d) * s, (dz / d) * s, 0.42, {});
        }
      }
    }
    if (st.gimmick === 'plates' && !this.solved) {
      const plates = st.objects.filter((o) => o.kind === 'plate');
      let all = true;
      for (const pl of plates) {
        const on = this.alivePlayers().some((p) => Math.hypot(p.x - pl.x, p.z - pl.z) < 0.6) || (boulder && Math.hypot(boulder.x - pl.x, boulder.z - pl.z) < 0.6);
        this.setObj(pl.id, on ? 'on' : '');
        all = all && on;
      }
      if (all) this.solve();
    }
  }

  handleInteract(from, id, extra = {}) {
    const st = this.g.stage, o = st.objects.find((o) => o.id === id), p = this.g.players.get(from);
    if (!o || !p || p.down) return;
    if (this.objState[o.id] === 'open' || this.objState[o.id] === 'done') return;
    const tags = speciesOf(p.an).tags;
    const reward = (mult, text) => {
      const gold = Math.round((14 + st.n * 3) * mult);
      const item = this.r() < 0.5 * mult ? GENERAL_ITEMS.filter((k) => k !== 'phoenix')[Math.floor(this.r() * (GENERAL_ITEMS.length - 1))] : null;
      this.setObj(o.id, 'open');
      this.ev.push({ k: 'loot', gold, to: from, item, text });
      this.ev.push({ k: 'sfx', s: 'chest' });
    };
    switch (o.kind) {
      case 'chest': reward(o.bonus ? 1.5 : 1, o.bonus === 'water' ? `${p.name}が水中の宝箱を見つけた！` : `${p.name}が小島の宝箱を開けた！`); break;
      case 'dig': if (tags.includes('dig') || extra.held) reward(1, `${p.name}が地面を掘ってお宝を見つけた！`); break;
      case 'hole': if (tags.includes('narrow')) reward(2, `${p.name}がすき間の奥から宝物を持ち帰った！`); break;
      case 'fruittree': if (tags.includes('climb')) { this.setObj(o.id, 'open'); for (const q of this.g.players.values()) this.net.sendTo(q.id, { type: 'party', heal: 0.35 }); this.ev.push({ k: 'loot', gold: 10 + st.n * 2, to: from, item: 'herb', text: `${p.name}が木に登って木の実を落とした！ 全員回復` }); } break;
      case 'altar':
        if (this.solved) return;
        if (o.correct) this.solve();
        else { this.setObj(o.id, 'bad'); this.ev.push({ k: 'toast', text: 'ちがう！ 石碑が怒っている…' }); this.ev.push({ k: 'sfx', s: 'buzz' }); this.spawnWave(Array(3).fill(st.biome.enemies[0])); this.timers.push({ t: 3, fn: () => this.setObj(o.id, '') }); }
        break;
    }
  }

  // ---------- 復活・全滅 ----------
  updateRevive(dt) {
    const ps = [...this.g.players.values()];
    for (const p of ps) {
      if (!p.down) { delete this.revive[p.id]; continue; }
      const helper = ps.some((q) => !q.down && q.id !== p.id && Math.hypot(q.x - p.x, q.z - p.z) < 1.4);
      this.revive[p.id] = Math.max(0, (this.revive[p.id] || 0) + (helper ? dt / 2.5 : -dt));
      if (this.revive[p.id] >= 1) { this.revive[p.id] = 0; this.net.sendTo(p.id, { type: 'revived' }); this.ev.push({ k: 'toast', text: `${p.name}が復活した！` }); }
    }
    if (ps.length && ps.every((p) => p.down && !p.phx)) {
      this.allDownT += dt;
      if (this.allDownT > 1.5 && !this.over) { this.over = true; this.net.broadcast({ type: 'gameover', n: this.g.stage.n }); }
    } else this.allDownT = 0;
  }

  updatePortal(dt) {
    if (!this.portalOpen || this.advancing) return;
    const st = this.g.stage, alive = this.alivePlayers();
    const inside = alive.filter((p) => Math.hypot(p.x - st.exit.x, p.z - st.exit.z) < 1.3);
    if (alive.length && inside.length === alive.length) {
      this.portalT += dt;
      if (this.portalT > 0.6) {
        this.advancing = true;
        const n = st.n, rest = st.kind === 'rest';
        if (!rest && n % 5 === 0) this.beginStage(n, true);
        else this.beginStage(n + 1, false);
      }
    } else {
      this.portalT = 0;
      if (inside.length && inside.length < alive.length && !this.waitMsgT) { this.waitMsgT = 1; this.ev.push({ k: 'portalwait', n: inside.length, of: alive.length }); }
    }
    if (this.waitMsgT) this.waitMsgT = Math.max(0, this.waitMsgT - dt) || 0;
  }
}
