// 自分が操作する動物。移動・スキル実行・成長はすべて手元で処理し、
// 敵への当たり判定が必要な部分だけホストへ送る。
import { speciesOf, ITEMS } from './data.js';
import { moveCircle, passable, freeAt, tileAt, FLOOR } from './stage.js';

const SELF_STEPS = new Set(['dash', 'leap', 'blink', 'selfbuff', 'shield']);
const clone = (o) => JSON.parse(JSON.stringify(o));

export class Player {
  constructor(game, id, name, speciesKey) {
    this.game = game; this.id = id; this.name = name;
    this.level = 1; this.xp = 0; this.gold = 0;
    this.items = []; this.perks = []; this.pendingPerks = 0;
    this.revives = 0;
    this.setSpecies(speciesKey);
    this.hp = this.maxHp;
    this.x = 0; this.z = 0; this.y = 0; this.vx = 0; this.vz = 0; this.face = 1; this.dir = { x: 1, z: 0 };
    this.cd = { normal: 0, skill: 0, special: 0, dodge: 0 }; this.ult = 0;
    this.buffs = []; this.shield = 0; this.shieldT = 0; this.iframes = 0; this.flash = 0; this.atkT = 0;
    this.queue = []; this.motion = null; this.down = false; this.downT = 0; this.lastSafe = { x: 0, z: 0 };
  }

  setSpecies(key) {
    this.speciesKey = key; this.sp = speciesOf(key);
    this.kit = clone(this.sp.kit);
    for (const it of this.items) { const d = ITEMS[it]; if (d.awaken && this.owns(d.for)) this.applyAwaken(d.awaken); }
    if (this.hp !== undefined) this.hp = Math.min(this.hp, this.maxHp);
  }
  owns(animal) { return this.sp.base === animal || this.sp.mate === animal || this.sp.key === animal; }
  applyAwaken(a) {
    const slot = this.kit[a.slot]; if (!slot) return;
    if (a.add) slot.steps.push(...clone(a.add));
    if (a.patch) { const { type, ...rest } = a.patch; const s = slot.steps.find((s) => s.t === type); if (s) Object.assign(s, rest); }
    slot.awakened = true;
  }

  get mods() {
    const m = {};
    const addM = (o) => { for (const k in o) m[k] = (m[k] || 0) + o[k]; };
    for (const p of this.sp.passives) addM(p.mods || {});
    for (const it of this.items) if (ITEMS[it].mods && (!ITEMS[it].for || this.owns(ITEMS[it].for))) addM(ITEMS[it].mods);
    for (const p of this.perks) addM(p.mods);
    return m;
  }
  buffMul(stat) { return this.buffs.filter((b) => b.stat === stat && b.mult).reduce((a, b) => a * b.mult, 1); }
  buffAdd(stat) { return this.buffs.filter((b) => b.stat === stat && b.add).reduce((a, b) => a + b.add, 0); }
  get maxHp() { return Math.round(this.sp.stats.hp * (1 + (this.mods.hp || 0)) * (1 + (this.level - 1) * 0.06)); }
  get atk() { return this.sp.stats.atk * (1 + (this.mods.atk || 0)) * (1 + (this.level - 1) * 0.05) * this.buffMul('atk'); }
  get spd() { return this.sp.stats.spd * (1 + (this.mods.spd || 0)) * this.buffMul('spd'); }
  get crit() { return 0.05 + (this.mods.crit || 0) + this.buffAdd('crit'); }
  get tags() { return this.sp.tags; }
  get mode() { return { fly: this.tags.includes('fly'), swim: this.tags.includes('swim'), leap: this.motion?.type === 'leap' }; }

  casterSnapshot(from) {
    const m = this.mods;
    const aim = this.aimDir();
    return { owner: this.id, x: this.x, z: this.z, dx: aim.x, dz: aim.z, atk: this.atk, crit: this.crit, cm: 1.7, aoe: 1 + (m.aoe || 0), kb: 1 + (m.kb || 0), poison: 1 + (m.poison || 0), heal: 1 + (m.heal || 0), from };
  }

  // 近くの敵がいれば自動で狙う（キーボードでも遊びやすく）
  aimDir() {
    let best = null, bd = 49;
    for (const e of this.game.enemies.values()) {
      if (e.spawning) continue;
      const dx = e.x - this.x, dz = e.z - this.z, d = dx * dx + dz * dz;
      const facing = dx * this.dir.x + dz * this.dir.z > -0.3 * Math.sqrt(d);
      if (d < bd && (facing || d < 6)) { bd = d; best = { x: dx, z: dz }; }
    }
    if (!best) return this.dir;
    const l = Math.hypot(best.x, best.z) || 1; return { x: best.x / l, z: best.z / l };
  }

  use(slot) {
    if (this.down || this.queue.length || this.motion) return false;
    const k = this.kit[slot];
    if (slot === 'ult') { if (this.ult < 100) return false; this.ult = 0; }
    else { if (this.cd[slot] > 0) return false; this.cd[slot] = k.cd * (slot === 'normal' ? 1 : 1 - Math.min(0.6, this.mods.cdr || 0)); }
    let t = 0;
    for (const s of k.steps) { t += s.at || 0; this.queue.push({ s, t }); if (s.t === 'dash' || s.t === 'leap') t += s.dur; }
    this.qt = 0; this.atkT = 0.15;
    if (slot !== 'normal') this.game.sfx(slot === 'ult' ? 'ult' : 'skill');
    else this.game.sfx('swing');
    if (slot === 'ult') this.game.toast(`${this.kit.ult.name}！`, 'ult');
    return true;
  }

  dodge() {
    if (this.down || this.motion || this.cd.dodge > 0) return;
    this.cd.dodge = 1.1 * (1 - (this.mods.dodge || 0));
    this.startMotion('dash', 3.2, 0.24, true); this.iframes = 0.35; this.game.sfx('dodge');
  }

  startMotion(type, dist, dur, useMove = true) {
    const d = this.dir;
    this.motion = { type, vx: (d.x * dist) / dur, vz: (d.z * dist) / dur, t: dur, dur, from: { x: this.x, z: this.z } };
    if (type === 'dash') this.iframes = Math.max(this.iframes, dur + 0.1);
  }

  runStep(s) {
    const g = this.game;
    switch (s.t) {
      case 'dash': this.startMotion('dash', s.dist, s.dur); this.lastFrom = { x: this.x, z: this.z }; return;
      case 'leap': this.startMotion('leap', s.dist, s.dur); this.lastFrom = { x: this.x, z: this.z }; this.iframes = s.dur; return;
      case 'blink': {
        const from = { x: this.x, z: this.z };
        for (let i = 0; i < s.dist * 4; i++) { const nx = this.x + this.dir.x * 0.25, nz = this.z + this.dir.z * 0.25; if (!freeAt(g.stage, nx, nz, 0.3, this.mode)) break; this.x = nx; this.z = nz; }
        this.lastFrom = from; this.iframes = Math.max(this.iframes, 0.25);
        g.world.spawnFx({ k: 'poof', x: from.x, z: from.z, col: '#b9a3ff' }); return;
      }
      case 'selfbuff': this.buffs.push({ ...s.buff, t: s.buff.dur }); g.world.spawnFx({ k: 'howl', x: this.x, z: this.z, r: 1.2, col: '#ffe07a' }); return;
      case 'shield': this.shield = Math.max(this.shield, this.maxHp * s.amt); this.shieldT = s.dur; g.world.spawnFx({ k: 'shield', x: this.x, z: this.z, r: 1.4, col: '#9fe8ff' }); return;
      default: g.net.toHost({ type: 'act', step: s, c: this.casterSnapshot(this.lastFrom) });
    }
  }

  update(dt, input) {
    const g = this.game, st = g.stage;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.iframes = Math.max(0, this.iframes - dt); this.flash = Math.max(0, this.flash - dt); this.atkT = Math.max(0, this.atkT - dt);
    this.buffs = this.buffs.filter((b) => (b.t -= dt) > 0);
    if (this.shieldT > 0 && (this.shieldT -= dt) <= 0) this.shield = 0;
    if (this.down) {
      this.downT += dt;
      if (this.revives > 0 && this.downT > 1.2) { this.revives--; this.items.splice(this.items.indexOf('phoenix'), 1); this.revive(0.5); g.toast('不死鳥の羽根で復活！'); }
      return;
    }
    const m = this.mods;
    if (m.regen) this.heal(this.maxHp * m.regen * dt, true);
    this.ult = Math.min(100, this.ult + dt * 1.2 * (1 + (m.ultGain || 0)));

    // スキルの段取り
    if (this.queue.length && !this.motion) {
      this.qt += dt;
      while (this.queue.length && this.queue[0].t <= this.qt && !this.motion) this.runStep(this.queue.shift().s);
    }

    if (this.motion) {
      const mo = this.motion; const step = Math.min(dt, mo.t);
      moveCircle(st, this, mo.vx * step, mo.vz * step, 0.3, this.mode);
      mo.t -= dt;
      if (mo.type === 'leap') this.y = Math.sin((1 - mo.t / mo.dur) * Math.PI) * 1.6;
      if (mo.t <= 0) {
        this.motion = null; this.y = 0;
        if (this.queue.length) this.qt = Math.max(this.qt, this.queue[0].t);
        if (!passable(st, this.x, this.z, this.mode)) this.fall();
      }
    } else {
      let ix = input.x, iz = input.z;
      const l = Math.hypot(ix, iz);
      if (l > 0.1) { ix /= l; iz /= l; this.dir = { x: ix, z: iz }; if (Math.abs(ix) > 0.2) this.face = ix > 0 ? 1 : -1; }
      const sp = this.spd * (this.queue.length ? 0.55 : 1);
      const k = 1 - Math.pow(0.0005, dt);
      this.vx += ((l > 0.1 ? ix * sp : 0) - this.vx) * k; this.vz += ((l > 0.1 ? iz * sp : 0) - this.vz) * k;
      moveCircle(st, this, this.vx * dt, this.vz * dt, 0.3, this.mode);
    }
    // 置物との衝突
    for (const o of g.solids()) {
      const dx = this.x - o.x, dz = this.z - o.z, d = Math.hypot(dx, dz), min = o.r + 0.3;
      if (d < min && d > 0.001) { const nx = this.x + (dx / d) * (min - d), nz = this.z + (dz / d) * (min - d); if (freeAt(st, nx, nz, 0.3, this.mode)) { this.x = nx; this.z = nz; } }
    }
    if (tileAt(st, this.x, this.z) === FLOOR) this.lastSafe = { x: this.x, z: this.z };
  }

  fall() {
    this.x = this.lastSafe.x; this.z = this.lastSafe.z;
    this.game.toast('落ちてしまった！'); this.hurt(this.maxHp * 0.1, null, true);
  }

  hurt(dmg, from, force = false) {
    if (this.down || (!force && this.iframes > 0)) return;
    const m = this.mods;
    if (!force && Math.random() < (m.evade || 0)) { this.game.floatText(this.x, this.z, 'MISS', 'miss'); this.iframes = 0.2; return; }
    dmg = dmg * Math.max(0.3, 1 - (m.dmgTaken || 0));
    if (this.shield > 0) { const a = Math.min(this.shield, dmg); this.shield -= a; dmg -= a; }
    dmg = Math.round(dmg);
    this.hp -= dmg; this.iframes = 0.5; this.flash = 0.12;
    if (dmg > 0) this.game.floatText(this.x, this.z, dmg, 'hurt');
    this.game.sfx('hurt'); this.game.world.shake(0.12);
    if (from) { const dx = this.x - from.x, dz = this.z - from.z, d = Math.hypot(dx, dz) || 1; moveCircle(this.game.stage, this, (dx / d) * 0.35, (dz / d) * 0.35, 0.3, this.mode); }
    if (this.hp <= 0) { this.hp = 0; this.down = true; this.downT = 0; this.queue = []; this.motion = null; this.y = 0; this.game.toast(this.revives > 0 ? '倒れた…（不死鳥の羽根が光っている）' : '倒れた…仲間に近くで助けてもらおう'); }
  }

  heal(v, silent = false) {
    if (this.down) return;
    const before = this.hp; this.hp = Math.min(this.maxHp, this.hp + v);
    if (!silent && this.hp - before >= 1) this.game.floatText(this.x, this.z, '+' + Math.round(this.hp - before), 'heal');
  }

  revive(frac) { this.down = false; this.hp = Math.max(1, Math.round(this.maxHp * frac)); this.iframes = 1.5; this.game.world.spawnFx({ k: 'heal', x: this.x, z: this.z, r: 1.5, col: '#9fffb0' }); }

  gainXp(v) {
    this.xp += v;
    let need;
    while (this.xp >= (need = this.xpNeed())) { this.xp -= need; this.level++; this.pendingPerks++; this.heal(this.maxHp * 0.25); this.game.onLevelUp(); }
  }
  xpNeed() { return 16 + this.level * 9; }

  state() {
    return { id: this.id, name: this.name, an: this.speciesKey, x: +this.x.toFixed(2), z: +this.z.toFixed(2), y: +this.y.toFixed(2), f: this.face, hp: Math.round(this.hp), mhp: this.maxHp, lv: this.level, down: this.down, atk: this.atkT > 0, walk: Math.hypot(this.vx, this.vz) > 0.5 || !!this.motion, fl: this.flash > 0, gh: this.iframes > 0 && !this.down && this.iframes < 1.6 && this.flash <= 0 && this.motion === null && this.iframes > 0.6, sh: this.shield > 0, phx: this.revives > 0 };
  }
}
