// けものみち — 本体：画面遷移・入力・通信・HUD・お店・融合
import { World } from './world.js';
import { Net } from './net.js';
import { Sim } from './sim.js';
import { Player } from './player.js';
import { ANIMALS, ANIMAL_KEYS, FUSIONS, ITEMS, GENERAL_ITEMS, PERKS, ENEMIES, TAGS_JP, SLOT_JP, speciesOf, PILLAR_COLORS } from './data.js';
import { animalSprite, enemySprite, merchantSprite } from './sprites.js';
import { generate, rng } from './stage.js';
import { initAudio, sfx, playBgm, stopBgm, setMuted } from './audio.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urlCache = new WeakMap();
const src = (cv) => { if (!urlCache.has(cv)) urlCache.set(cv, cv.toDataURL()); return urlCache.get(cv); };
const params = new URLSearchParams(location.search);

// ---------- 入力 ----------
class Input {
  constructor() {
    this.keys = new Set(); this.pressed = new Set(); this.padPrev = [];
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }
  poll() {
    const gp = navigator.getGamepads?.()[0]; this.pad = null;
    if (!gp) return;
    const map = { 0: 'j', 2: 'k', 3: 'l', 5: 'i', 1: ' ', 4: 'e', 7: 'i' };
    for (const [b, k] of Object.entries(map)) { const on = gp.buttons[b]?.pressed; if (on && !this.padPrev[b]) this.pressed.add(k); this.padPrev[b] = on; if (on) this.keys.add('pad' + k); else this.keys.delete('pad' + k); }
    this.pad = { x: Math.abs(gp.axes[0]) > 0.2 ? gp.axes[0] : 0, z: Math.abs(gp.axes[1]) > 0.2 ? gp.axes[1] : 0 };
  }
  axis() {
    const k = this.keys;
    let x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let z = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (this.pad && (this.pad.x || this.pad.z)) { x = this.pad.x; z = this.pad.z; }
    return { x, z };
  }
  hit(...ks) { return ks.some((k) => this.pressed.has(k)); }
  held(...ks) { return ks.some((k) => this.keys.has(k) || this.keys.has('pad' + k)); }
  end() { this.pressed.clear(); }
}

// ---------- 画面上のラベル ----------
class Labels {
  constructor(world) { this.world = world; this.root = $('#labels'); this.map = new Map(); }
  begin() { this.used = new Set(); }
  put(key, x, y, z, make, update) {
    this.used.add(key);
    let el = this.map.get(key);
    if (!el) { el = make(); this.root.appendChild(el); this.map.set(key, el); }
    const p = this.world.toScreen(x, y, z);
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; el.style.display = p.vis ? '' : 'none';
    update?.(el);
  }
  end() { for (const [k, el] of this.map) if (!this.used.has(k)) { el.remove(); this.map.delete(k); } }
  clear() { for (const el of this.map.values()) el.remove(); this.map.clear(); }
}

class Game {
  constructor() {
    this.world = new World($('#gl'));
    this.net = new Net(); this.net.on((m, f) => this.onMsg(m, f));
    this.input = new Input(); this.labels = new Labels(this.world);
    this.players = new Map(); this.enemies = new Map(); this.projView = new Map(); this.objState = {};
    this.mode = 'title'; this.pick = localStorage.getItem('km-animal') || 'dog'; this.lobby = []; this.ready = false;
    this.pstateT = 0; this.hudT = 0; this.rv = {}; this.muted = false;
    this.setupTitle();
    this.showPreview();
    let last = performance.now();
    const loop = (t) => { const dt = Math.min(0.05, (t - last) / 1000); last = t; this.frame(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ================= タイトル =================
  setupTitle() {
    const nameIn = $('#name');
    nameIn.value = localStorage.getItem('km-name') || '';
    const name = () => { const n = nameIn.value.trim() || 'ななし'; localStorage.setItem('km-name', n); return n; };
    const msg = (t) => ($('#title-msg').textContent = t);
    const go = async (fn) => {
      initAudio(); sfx('select');
      document.querySelectorAll('.menu .btn').forEach((b) => (b.disabled = true));
      try { await fn(); } catch (e) { msg(e.message || String(e)); document.querySelectorAll('.menu .btn').forEach((b) => (b.disabled = false)); }
    };
    $('#btn-solo').onclick = () => go(async () => { this.myName = name(); this.net.id = 'solo'; this.toLobby(); });
    $('#btn-host').onclick = () => go(async () => { msg('ルームを作っています…'); this.myName = name(); await this.net.host(); msg(''); this.toLobby(); });
    $('#btn-join').onclick = () => go(async () => {
      const code = $('#join-code').value.trim(); if (code.length < 5) throw new Error('5文字のルームコードを入力してね');
      msg('接続しています…'); this.myName = name(); await this.net.join(code); msg('');
      this.toLobby(); this.net.toHost({ type: 'hello', name: this.myName, animal: this.pick });
    });
    $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });
    $('#btn-codex').onclick = () => { initAudio(); this.openCodex(); };
    $('#btn-mute').onclick = () => this.toggleMute();
    $('#btn-copy').onclick = () => { navigator.clipboard?.writeText(this.net.code || ''); this.toast('コピーしました'); };
    $('#btn-start').onclick = () => this.lobbyButton();
  }

  toggleMute() { this.muted = !this.muted; setMuted(this.muted); $('#btn-mute').textContent = this.muted ? '×' : '♪'; }

  showPreview() {
    const st = generate(1, 20240, false);
    st.objects = st.objects.filter((o) => o.kind !== 'portal');
    this.previewStage = st; this.world.buildStage(st);
    this.world.camTarget.set(st.W / 2, 0, st.H / 2);
  }

  // ================= ロビー =================
  toLobby() {
    this.mode = 'lobby';
    $('#title').classList.add('hidden'); $('#lobby').classList.remove('hidden'); $('#hud').classList.add('hidden');
    $('#room-code').textContent = this.net.online ? this.net.code : 'ソロ';
    $('#btn-copy').classList.toggle('hidden', !this.net.online);
    if (this.net.isHost) { this.lobby = [{ id: this.net.id, name: this.myName, animal: this.pick, ready: true }]; this.broadcastLobby(); }
    this.renderAnimalGrid(); this.renderLobby();
  }

  broadcastLobby() { this.net.broadcast({ type: 'lobby', players: this.lobby, inGame: this.mode === 'game' }); }

  renderAnimalGrid() {
    const grid = $('#animal-grid'); grid.innerHTML = '';
    for (const k of ANIMAL_KEYS) {
      const a = ANIMALS[k];
      const c = document.createElement('div'); c.className = 'animal-card' + (k === this.pick ? ' sel' : '');
      c.innerHTML = `<img src="${src(animalSprite(k))}"><div class="nm">${a.name}</div><div class="rl">${a.role}</div>`;
      c.onclick = () => { this.pick = k; localStorage.setItem('km-animal', k); sfx('select'); this.ready = false; this.sendPick(); this.renderAnimalGrid(); this.renderLobby(); };
      grid.appendChild(c);
    }
    this.renderDetail(this.pick);
  }

  renderDetail(key) {
    const sp = speciesOf(key);
    const bar = (label, v, max) => `<div class="stat-row"><span style="width:52px">${label}</span><div class="sbar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div><span>${v}</span></div>`;
    $('#animal-detail').innerHTML = `
      <img class="big" src="${src(animalSprite(key))}">
      <div>
        <div class="detail-head">${sp.name}<small>${sp.title}</small></div>
        ${bar('体力', sp.stats.hp, 150)}${bar('攻撃', sp.stats.atk, 13)}${bar('速さ', sp.stats.spd, 6)}
        <div class="tags">${sp.tags.map((t) => `<span class="tag">得意：${TAGS_JP[t]}</span>`).join('')}</div>
        <div class="skill-list">
          ${['normal', 'skill', 'special', 'ult'].map((s) => `<div><span class="k">${SLOT_JP[s]}</span><b>${sp.kit[s].name}</b>${sp.kit[s].cd ? ` <small>(${sp.kit[s].cd}秒)</small>` : ''}<br>${sp.kit[s].desc}</div>`).join('')}
          ${sp.passives.map((p) => `<div><span class="k">パッシブ</span><b>${p.name}</b><br>${p.desc}</div>`).join('')}
        </div>
      </div>`;
  }

  sendPick() { if (this.net.isHost) { const me = this.lobby.find((p) => p.id === this.net.id); if (me) me.animal = this.pick; this.broadcastLobby(); } else this.net.toHost({ type: 'pick', animal: this.pick, ready: this.ready }); }

  renderLobby() {
    const ul = $('#lobby-players'); ul.innerHTML = '';
    for (const p of this.lobby) {
      const li = document.createElement('li');
      li.innerHTML = `<img src="${src(animalSprite(p.animal))}"><span>${esc(p.name)}${p.id === this.net.id ? '（じぶん）' : ''}</span><span class="ready">${p.ready ? '準備OK' : '選択中…'}</span>`;
      ul.appendChild(li);
    }
    const btn = $('#btn-start');
    if (this.net.isHost) {
      const allReady = this.lobby.every((p) => p.ready);
      btn.textContent = '冒険に出発'; btn.disabled = !allReady;
      $('#lobby-msg').textContent = allReady ? (this.net.online ? 'コードを友だちに教えよう' : '') : '仲間の準備を待っています…';
    } else {
      btn.textContent = this.ready ? '準備OK！（取り消す）' : '準備OK'; btn.disabled = false;
      $('#lobby-msg').textContent = this.ready ? 'ホストの出発を待っています…' : '';
    }
  }

  lobbyButton() {
    sfx('select');
    if (this.net.isHost) {
      this.net.broadcast({ type: 'start' });
      const n = Math.max(1, parseInt(params.get('stage') || '1', 10));
      this.sim.beginStage(n, params.get('rest') === '1');
    } else { this.ready = !this.ready; this.sendPick(); this.renderLobby(); }
  }

  // ================= 通信 =================
  onMsg(m, from) {
    const host = this.net.isHost;
    switch (m.type) {
      // --- ホストが受け取る ---
      case 'hello': if (!host) return; this.lobby.push({ id: from, name: String(m.name).slice(0, 10), animal: ANIMALS[m.animal] ? m.animal : 'dog', ready: false }); this.broadcastLobby(); this.toast(`${m.name} が参加した！`); break;
      case 'pick': {
        if (!host) return; const p = this.lobby.find((p) => p.id === from); if (!p) return;
        p.animal = ANIMALS[m.animal] ? m.animal : 'dog'; p.ready = !!m.ready; this.broadcastLobby();
        if (this.mode === 'game' && p.ready && !this.players.has(from)) { this.net.sendTo(from, { type: 'start' }); this.net.sendTo(from, this.curStage); this.net.sendTo(from, { type: 'objs', s: this.sim.objState }); }
        break;
      }
      case 'pstate': if (host && this.players.has(from) !== undefined) this.players.set(from, m.s); break;
      case 'act': if (host) this.sim.handleAct(m); break;
      case 'interact': if (host) this.sim.handleInteract(from, m.id, m.extra); break;
      case 'giftreq': if (host) this.net.broadcast({ type: 'gift', item: m.item, from: m.from, buyer: from }); break;
      case '_leave': {
        if (!host) return; const p = this.lobby.find((q) => q.id === from);
        this.lobby = this.lobby.filter((q) => q.id !== from); this.players.delete(from);
        this.broadcastLobby(); if (p) this.toast(`${p.name} が去っていった…`); break;
      }
      // --- 全員が受け取る ---
      case 'lobby': this.lobby = m.players; if (this.mode === 'lobby') this.renderLobby(); break;
      case 'start': this.enterGame(); break;
      case 'stage': if (this.mode === 'game') this.enterStage(m); break;
      case 'objs': Object.assign(this.objState, m.s); break;
      case 'snap': this.applySnap(m); break;
      case 'hurt': this.me?.hurt(m.dmg, { x: m.x, z: m.z }); break;
      case 'party': {
        const me = this.me; if (!me || me.down) return;
        if (m.heal) me.heal(me.maxHp * m.heal);
        if (m.buff) me.buffs.push({ ...m.buff, t: m.buff.dur });
        if (m.shield) { me.shield = Math.max(me.shield, me.maxHp * m.shield); me.shieldT = 6; }
        break;
      }
      case 'hits': if (this.me) { const g = 1 + (this.me.mods.ultGain || 0); this.me.ult = Math.min(100, this.me.ult + m.n * 2.4 * g); if (this.me.mods.ls) this.me.heal(m.dmg * this.me.mods.ls, true); sfx(m.n > 2 ? 'crit' : 'hit'); } break;
      case 'revived': this.me?.revive(0.4); break;
      case 'gift': if (this.me && m.buyer !== this.net.id && this.me.owns(ITEMS[m.item].for)) { this.giveItem(m.item); this.toast(`${m.from}から「${ITEMS[m.item].name}」が届いた！`); } break;
      case 'gameover': this.gameOver(m.n); break;
      case 'tolobby': this.backToLobby(); break;
      case '_hostgone': this.toast('ホストとの接続が切れました'); setTimeout(() => location.reload(), 2500); break;
    }
  }

  applySnap(m) {
    if (m.ev) for (const e of m.ev) this.onEvent(e);
    this.rv = m.rv || {};
    if (this.net.isHost) return;
    const seen = new Set();
    for (const [id, type, x, z, hp, mhp, face, flags] of m.e) {
      seen.add(id);
      let e = this.enemies.get(id);
      if (!e) { e = { id, type, x, z }; this.enemies.set(id, e); }
      Object.assign(e, { tx: x, tz: z, hp, mhp, face, flags, spawning: !!(flags & 16), boss: !!ENEMIES[type].boss });
    }
    for (const id of [...this.enemies.keys()]) if (!seen.has(id)) this.enemies.delete(id);
    const ps = new Set();
    for (const [id, kind, x, z] of m.p) { ps.add(id); const p = this.projView.get(id); if (p) { p.tx = x; p.tz = z; } else this.projView.set(id, { id, kind, x, z, tx: x, tz: z }); }
    for (const id of [...this.projView.keys()]) if (!ps.has(id)) this.projView.delete(id);
    for (const s of m.pl) if (s.id !== this.net.id) this.players.set(s.id, s);
    for (const id of [...this.players.keys()]) if (id !== this.net.id && !m.pl.some((s) => s.id === id)) this.players.delete(id);
    if (m.b && this.stage) { const b = this.stage.objects.find((o) => o.kind === 'boulder'); if (b) { b.x = m.b[0]; b.z = m.b[1]; } }
  }

  onEvent(e) {
    const me = this.me;
    switch (e.k) {
      case 'obj': this.objState[e.id] = e.state; if (e.state === 'open' && this.stage?.objects.find((o) => o.id === e.id)?.kind === 'portal') sfx('portal'); break;
      case 'fx': this.world.spawnFx(e.fx); break;
      case 'dmg': this.floatText(e.x, e.z, e.v, e.c); break;
      case 'kill': {
        this.world.spawnFx({ k: 'poof', x: e.x, z: e.z }); this.world.spawnFx({ k: 'coin', x: e.x, z: e.z }); sfx('kill');
        if (me) { const g = Math.round(e.gold * (1 + (me.mods.gold || 0))); me.gold += g; me.gainXp(e.xp); }
        if (e.boss) { this.bossId = null; $('#bossbar').classList.add('hidden'); playBgm(this.biomeIdx); }
        break;
      }
      case 'toast': this.toast(e.text, e.big ? 'big' : ''); break;
      case 'sfx': sfx(e.s); break;
      case 'boss': this.bossId = e.id; $('#bossbar').classList.remove('hidden'); $('#bossbar .boss-name').textContent = e.name; this.toast(e.name, 'big'); sfx('boss'); playBgm(this.biomeIdx, true); break;
      case 'loot': {
        if (!me) return;
        if (e.gold) { const g = Math.round(e.gold * (1 + (me.mods.gold || 0))); me.gold += g; sfx('coin'); }
        if (e.text) this.toast(e.text + (e.gold ? `（全員に ${e.gold}G）` : ''));
        if (e.item && e.to === this.net.id) { this.giveItem(e.item); this.toast(`「${ITEMS[e.item].name}」を手に入れた！`); }
        break;
      }
      case 'portalwait': this.toast(`仲間を待っています… ${e.n}/${e.of}`); break;
    }
  }

  // ================= ゲーム開始・ステージ =================
  enterGame() {
    this.mode = 'game';
    $('#lobby').classList.add('hidden'); $('#title').classList.add('hidden'); $('#hud').classList.remove('hidden'); $('#modal').classList.add('hidden');
    const mine = this.lobby.find((p) => p.id === this.net.id);
    this.me = new Player(this, this.net.id, this.myName, mine?.animal || this.pick);
    this.players.clear(); this.players.set(this.me.id, this.me.state());
    if (this.net.isHost) for (const p of this.lobby) if (p.id !== this.me.id) this.players.set(p.id, { id: p.id, name: p.name, an: p.animal, x: 0, z: 0, hp: 1, mhp: 1, lv: 1, down: false });
    this.buildSkillBar(); this.stats = { kills: 0 };
  }

  enterStage(m) {
    this.curStage = m;
    this.stage = generate(m.n, m.seed, m.rest);
    this.objState = {}; this.enemies.clear(); this.projView.clear(); this.labels.clear(); this.bossId = null; this.shop = null;
    $('#bossbar').classList.add('hidden'); this.closeModal();
    this.world.buildStage(this.stage);
    const st = this.stage, me = this.me;
    const ids = [...new Set([...this.lobby.map((p) => p.id), me.id])].sort(), idx = Math.max(0, ids.indexOf(me.id));
    me.x = st.spawn.x + (idx % 2) * 0.9; me.z = st.spawn.z + (Math.floor(idx / 2) - 0.5 * (idx > 1)) * 1.1 + (idx % 2 ? 0.5 : -0.3);
    me.lastSafe = { x: me.x, z: me.z }; me.vx = me.vz = 0; me.motion = null; me.queue = [];
    if (me.down) me.revive(0.3);
    this.world.camTarget.set(me.x, 0, me.z);
    if (this.net.isHost) this.sim.onStageBuilt(st);
    this.biomeIdx = Math.floor((m.n - 1) / 10) % 6;
    const kindTxt = st.kind === 'rest' ? '休憩所' : st.kind === 'boss' ? `ステージ ${m.n}　ボス戦` : `ステージ ${m.n}`;
    $('#stage-num').textContent = st.kind === 'rest' ? `休憩所（${m.n}）` : `ステージ ${m.n}`;
    $('#stage-biome').textContent = st.biome.name + (st.kind === 'boss' ? '　—　ボス' : '');
    this.toast(kindTxt, 'big');
    if (st.kind === 'rest') {
      me.heal(me.maxHp * 0.4);
      this.toast('タヌキの商人がいる。たき火で体力が回復した');
      if (m.n === 50) setTimeout(() => this.toast('融合の祭壇が光っている…！', 'big'), 1600);
    }
    const hints = { water: '水の中に宝箱が沈んでいる…（泳げる・飛べる動物なら）', island: '谷の向こうの小島に宝箱…（跳べる・飛べる動物なら）', dig: 'キラキラした地面がある…（穴掘りが得意な動物なら一瞬）', hole: '崖に小さなすき間…（細い体の動物なら入れそう）', fruittree: '木の実がたわわな木…（木登りが得意な動物なら）' };
    let d = 1200;
    const later = (fn, ms) => setTimeout(() => { if (this.stage === st) fn(); }, ms);
    for (const o of st.objects) { const h = hints[o.bonus || o.kind]; if (h) { later(() => this.toast(h), d); d += 900; } }
    if (st.gimmick) later(() => this.toast({ plates: '二つの床スイッチを同時に押せ（岩も使える）', riddle: '石碑のなぞなぞに答えよ', pillars: '石碑の示す順番に柱を叩け' }[st.gimmick]), 600);
    playBgm(this.biomeIdx, false);
  }

  // ================= 毎フレーム =================
  frame(dt) {
    this.input.poll();
    if (this.mode === 'game' && this.stage) this.updateGame(dt);
    else this.updatePreview(dt);
    if (this.input.hit('m')) this.toggleMute();
    this.input.end();
  }

  updatePreview(dt) {
    const st = this.previewStage, t = performance.now() / 1000;
    const list = ANIMAL_KEYS.map((k, i) => {
      const a = (i / ANIMAL_KEYS.length) * Math.PI * 2 + t * 0.15;
      const x = st.W / 2 + Math.cos(a) * 3.2, z = st.H / 2 + Math.sin(a) * 1.6;
      return { id: 'pv' + k, cv: animalSprite(k), x, z, face: -Math.sin(a) >= 0 ? 1 : -1, walking: true, hover: k === 'butterfly', flap: k === 'butterfly', size: 1.5 };
    });
    if (this.mode === 'lobby') list.push({ id: 'pvme', cv: animalSprite(this.pick), x: st.W / 2, z: st.H / 2, face: 1, size: 2.2, hover: speciesOf(this.pick).tags.includes('fly'), flap: this.pick === 'butterfly' });
    this.world.syncEntities(list);
    this.world.syncObjects([]); this.world.syncProjectiles([]);
    this.world.render(dt, { x: st.W / 2, z: st.H / 2 });
  }

  updateGame(dt) {
    const me = this.me, inp = this.input, st = this.stage;
    const modal = !$('#modal').classList.contains('hidden');
    if (!modal) {
      if (inp.held('j', 'z')) me.use('normal');
      if (inp.hit('k', 'x')) me.use('skill');
      if (inp.hit('l', 'c')) me.use('special');
      if (inp.hit('i', 'v')) me.use('ult');
      if (inp.hit(' ', 'shift')) me.dodge();
      for (const [i, k] of ['1', '2', '3'].entries()) if (inp.hit(k)) this.choosePerk(i);
    } else if (inp.hit('escape')) this.closeModal();
    me.update(dt, modal ? { x: 0, z: 0 } : inp.axis());
    this.players.set(me.id, me.state());
    this.updateInteract(dt, modal);

    if (this.net.isHost) this.sim.update(dt);
    else {
      this.pstateT -= dt;
      if (this.pstateT <= 0) { this.pstateT = 0.066; this.net.toHost({ type: 'pstate', s: me.state() }); }
      const k = Math.min(1, dt * 14);
      for (const e of this.enemies.values()) { e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; }
      for (const p of this.projView.values()) { p.x += (p.tx - p.x) * Math.min(1, dt * 20); p.z += (p.tz - p.z) * Math.min(1, dt * 20); }
    }

    // --- 描画データ ---
    const ents = [];
    for (const s of this.players.values()) {
      if (s.x === undefined || !s.an) continue;
      const isMe = s.id === me.id;
      let r = this.smooth?.get(s.id);
      if (!this.smooth) this.smooth = new Map();
      if (!r) { r = { x: s.x, z: s.z }; this.smooth.set(s.id, r); }
      if (isMe) { r.x = s.x; r.z = s.z; } else { const k = Math.min(1, dt * 12); r.x += (s.x - r.x) * k; r.z += (s.z - r.z) * k; if (Math.hypot(s.x - r.x, s.z - r.z) > 4) { r.x = s.x; r.z = s.z; } }
      const sp = speciesOf(s.an);
      ents.push({ id: 'P' + s.id, cv: animalSprite(s.an), x: r.x, z: r.z, y: s.y, face: s.f, size: 1.5, walking: s.walk, attack: s.atk, flash: s.fl ? 1 : 0, down: s.down, hover: sp.tags.includes('fly') && !s.down, flap: sp.base === 'butterfly' || sp.mate === 'butterfly', tint: s.sh ? 0x9fe8ff : null });
    }
    for (const e of this.enemies.values()) {
      const D = ENEMIES[e.type], f = this.net.isHost ? (e.stun > 0 ? 1 : 0) | (e.sleep > 0 ? 2 : 0) | (e.flash > 0 ? 4 : 0) | (e.wind > 0 ? 8 : 0) | (e.spawning ? 16 : 0) : e.flags;
      ents.push({ id: e.id, cv: enemySprite(e.type), x: e.x, z: e.z, face: e.face, size: 1.5 * D.scale, hover: D.fly, flap: false, walking: !(f & 3) && D.spd > 0, flash: f & 4, sleep: f & 2, tint: f & 8 ? 0xff5a4a : f & 1 ? 0xfff27a : null, ghost: f & 16, attack: f & 8 });
    }
    this.world.syncEntities(ents);
    const objs = st.objects.map((o) => ({ ...o, state: this.objState[o.id] || '', cv: o.kind === 'merchant' ? merchantSprite() : null }));
    this.world.syncObjects(objs);
    this.world.syncProjectiles(this.net.isHost ? this.sim.projs : [...this.projView.values()]);

    // --- ラベル ---
    const L = this.labels; L.begin();
    for (const s of this.players.values()) {
      if (!s.an) continue; const r = this.smooth.get(s.id); if (!r) continue;
      L.put('n' + s.id, r.x, 2.1 + (s.y || 0) + (speciesOf(s.an).tags.includes('fly') ? 0.5 : 0), r.z, () => Object.assign(document.createElement('div'), { className: 'lbl' + (s.id === me.id ? ' me' : '') }), (el) => { const t = `${s.name} Lv${s.lv}`; if (el.textContent !== t) el.textContent = t; });
      if (s.down) L.put('rv' + s.id, r.x, 1, r.z, () => Object.assign(document.createElement('div'), { className: 'revive-ring' }), (el) => el.style.setProperty('--p', Math.round((this.rv[s.id] || 0) * 100) + '%'));
    }
    for (const e of this.enemies.values()) {
      if (e.boss || e.spawning || e.hp >= e.mhp) continue;
      L.put('h' + e.id, e.x, 1.5 * ENEMIES[e.type].scale + (ENEMIES[e.type].fly ? 0.7 : 0) + 0.1, e.z, () => { const d = document.createElement('div'); d.className = 'ehp'; d.innerHTML = '<i></i>'; return d; }, (el) => (el.firstChild.style.width = Math.max(0, (e.hp / e.mhp) * 100) + '%'));
    }
    for (const o of st.objects) if (o.kind === 'altar') L.put('a' + o.id, o.x, 1.6, o.z, () => Object.assign(document.createElement('div'), { className: 'lbl', textContent: o.label }));
    L.end();

    this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(); }
    this.updateSkillBar();
    this.world.render(dt, me.down ? this.partyCenter() : me);
  }

  partyCenter() { const a = [...this.players.values()].filter((p) => !p.down && p.x !== undefined); return a.length ? a[0] : this.me; }

  solids() {
    const st = this.stage; if (!st) return [];
    const R = { boulder: 0.45, pillar: 0.35, tablet: 0.45, altar: 0.38, merchant: 0.45, fusion: 0.8, campfire: 0.45, fruittree: 0.4 };
    return st.objects.filter((o) => R[o.kind]).map((o) => ({ x: o.x, z: o.z, r: R[o.kind] }));
  }

  // ================= 調べる =================
  updateInteract(dt, modal) {
    const me = this.me, st = this.stage, pr = $('#prompt');
    let best = null, bd = 1.7;
    for (const o of st.objects) {
      if (!['chest', 'dig', 'hole', 'fruittree', 'altar', 'merchant', 'fusion'].includes(o.kind)) continue;
      const s = this.objState[o.id];
      if (s === 'open' || s === 'done' || (o.kind === 'altar' && s === 'bad')) continue;
      if (o.kind === 'fusion' && me.sp.mate) continue;
      const d = Math.hypot(o.x - me.x, o.z - me.z);
      if (d < bd) { bd = d; best = o; }
    }
    // 石碑の表示
    const tab = st.objects.find((o) => o.kind === 'tablet');
    const rd = $('#riddle');
    if (tab && Math.hypot(tab.x - me.x, tab.z - me.z) < 3.5 && this.objState[tab.id] !== 'done') {
      rd.classList.remove('hidden');
      const html = st.gimmick === 'riddle' ? `<div class="q">「${st.riddle.q}」</div><div class="h">答えだと思う祭壇の前で E を押そう（間違えると敵が現れる）</div>`
        : `<div class="q">石碑に光の印が刻まれている</div><div style="font-size:30px;letter-spacing:10px">${st.pillarOrder.map((c) => `<span style="color:${PILLAR_COLORS[c]}">◆</span>`).join('')}</div><div class="h">この順番に柱を攻撃しよう</div>`;
      if (rd.dataset.k !== st.gimmick + st.n) { rd.innerHTML = html; rd.dataset.k = st.gimmick + st.n; }
    } else rd.classList.add('hidden');

    if (!best || modal || me.down) { pr.classList.add('hidden'); this.holdT = 0; return; }
    const tags = me.tags;
    let text = 'E：調べる', can = true, hold = false;
    switch (best.kind) {
      case 'chest': text = 'E：宝箱を開ける'; break;
      case 'dig': if (tags.includes('dig')) text = 'E：掘る（得意！）'; else { text = 'E 長押し：がんばって掘る'; hold = true; } break;
      case 'hole': if (tags.includes('narrow')) text = 'E：すき間にもぐる'; else { text = 'すき間が狭すぎる…（細い体の動物なら入れそう）'; can = false; } break;
      case 'fruittree': if (tags.includes('climb')) text = 'E：木に登る'; else { text = '高くて届かない…（木登りが得意な動物なら）'; can = false; } break;
      case 'altar': text = `E：「${best.label}」と答える`; break;
      case 'merchant': text = 'E：お店を見る'; break;
      case 'fusion': text = 'E：融合の儀式'; break;
    }
    pr.classList.remove('hidden');
    if (hold && this.input.held('e', 'enter')) {
      this.holdT = (this.holdT || 0) + dt;
      pr.innerHTML = `${text}<div class="prog" style="width:${Math.min(100, (this.holdT / 3) * 100)}%"></div>`;
      if (this.holdT >= 3) { this.holdT = 0; this.net.toHost({ type: 'interact', id: best.id, extra: { held: true } }); }
      return;
    }
    this.holdT = 0;
    if (pr.textContent !== text) pr.textContent = text;
    if (can && !hold && this.input.hit('e', 'enter')) {
      if (best.kind === 'merchant') this.openShop();
      else if (best.kind === 'fusion') this.openFusion();
      else this.net.toHost({ type: 'interact', id: best.id });
    }
  }

  // ================= HUD =================
  buildSkillBar() {
    const me = this.me, box = $('#skills'); box.innerHTML = '';
    const slots = [['normal', 'J'], ['skill', 'K'], ['special', 'L'], ['ult', 'I'], ['dodge', 'Space']];
    this.skillEls = {};
    for (const [s, key] of slots) {
      const d = document.createElement('div');
      const k = me.kit[s];
      d.className = 'sk' + (s === 'ult' ? ' ult' : '') + (s === 'dodge' ? ' dodge' : '') + (k?.awakened ? ' awk' : '');
      d.innerHTML = `<div class="cd"></div><span class="key">${key}</span><div class="nm">${s === 'dodge' ? '回避' : k.name}</div><div class="slot">${s === 'dodge' ? '' : SLOT_JP[s]}</div><span class="cdt"></span>`;
      box.appendChild(d); this.skillEls[s] = d;
    }
    const pc = $('#me-portrait').getContext('2d'); pc.clearRect(0, 0, 24, 24); pc.drawImage(animalSprite(me.speciesKey), 0, 0);
  }

  updateSkillBar() {
    const me = this.me; if (!this.skillEls) return;
    for (const [s, el] of Object.entries(this.skillEls)) {
      let p = 0, t = '';
      if (s === 'ult') { p = 100 - me.ult; el.classList.toggle('ready', me.ult >= 100); t = me.ult >= 100 ? '' : Math.floor(me.ult) + '%'; }
      else { const max = s === 'dodge' ? 1.1 * (1 - (me.mods.dodge || 0)) : me.kit[s].cd * (s === 'normal' ? 1 : 1 - Math.min(0.6, me.mods.cdr || 0)); p = max ? (me.cd[s] / max) * 100 : 0; t = me.cd[s] > 0.5 && s !== 'normal' ? Math.ceil(me.cd[s]) : ''; }
      el.firstChild.style.setProperty('--p', p + '%');
      const c = el.lastChild; if (c.textContent !== String(t)) c.textContent = t;
    }
  }

  updateHud() {
    const me = this.me;
    $('#gold').textContent = `${me.gold} G`;
    const hp = $('#me-panel .bar.hp');
    hp.querySelector('i').style.width = (me.hp / me.maxHp) * 100 + '%';
    hp.querySelector('i').style.background = me.hp / me.maxHp < 0.3 ? 'var(--hp-low)' : '';
    hp.querySelector('b').style.width = Math.min(100, (me.shield / me.maxHp) * 100) + '%';
    hp.querySelector('span').textContent = `${Math.ceil(me.hp)} / ${me.maxHp}`;
    $('#me-panel .bar.xp i').style.width = (me.xp / me.xpNeed()) * 100 + '%';
    const nm = `${esc(me.name)}　<small>${me.sp.name}${me.sp.mate ? '（融合種）' : ''}　Lv ${me.level}</small>`;
    const ne = $('#me-panel .me-name'); if (ne.innerHTML !== nm) ne.innerHTML = nm;
    // パーティ
    const party = $('#party');
    const others = [...this.players.values()].filter((p) => p.id !== me.id && p.an);
    party.innerHTML = others.map((p) => `<div class="pf${p.down ? ' down' : ''}"><img src="${src(animalSprite(p.an))}"><div><div class="n">${esc(p.name)} Lv${p.lv}${p.down ? '（ダウン）' : ''}</div><div class="bar"><i style="width:${(p.hp / p.mhp) * 100}%"></i></div></div></div>`).join('');
    // ボス
    if (this.bossId) { const b = this.enemies.get(this.bossId); if (b) $('#bossbar .bar i').style.width = Math.max(0, (b.hp / b.mhp) * 100) + '%'; }
    // アイテム
    const counts = {}; for (const it of me.items) counts[it] = (counts[it] || 0) + 1;
    const ib = Object.entries(counts).map(([k, n]) => `<span class="${ITEMS[k].for ? 'sp' : ''}">${ITEMS[k].name}${n > 1 ? '×' + n : ''}</span>`).join('');
    if (this.lastItems !== ib) { $('#items-bar').innerHTML = ib; this.lastItems = ib; }
    this.renderLevelUp();
  }

  // ================= 成長 =================
  onLevelUp() { sfx('level'); this.world.spawnFx({ k: 'level', x: this.me.x, z: this.me.z }); this.toast(`レベル ${this.me.level}！`, 'big'); this.perkChoices = null; }

  renderLevelUp() {
    const me = this.me, box = $('#levelup');
    if (!me.pendingPerks) { box.classList.add('hidden'); return; }
    if (!this.perkChoices) { const pool = [...PERKS].sort(() => Math.random() - 0.5); this.perkChoices = pool.slice(0, 3); this.perkHtml = null; }
    const html = `<div class="lv-title">成長を選ぼう（残り${me.pendingPerks}）</div>` + this.perkChoices.map((p, i) => `<div class="perk" data-i="${i}"><span class="k">${i + 1}</span>${p.name}<div class="d">${p.desc}</div></div>`).join('');
    if (this.perkHtml !== html) { box.innerHTML = html; this.perkHtml = html; box.querySelectorAll('.perk').forEach((el) => (el.onclick = () => this.choosePerk(+el.dataset.i))); }
    box.classList.remove('hidden');
  }

  choosePerk(i) {
    const me = this.me; if (!me.pendingPerks || !this.perkChoices?.[i]) return;
    const before = me.maxHp;
    me.perks.push(this.perkChoices[i]); me.pendingPerks--; this.perkChoices = null;
    me.hp += Math.max(0, me.maxHp - before);
    sfx('select'); this.renderLevelUp();
  }

  giveItem(key) {
    const me = this.me, d = ITEMS[key];
    if (d.heal) { me.heal(me.maxHp * d.heal); return; }
    if (d.revive) me.revives++;
    const before = me.maxHp;
    me.items.push(key);
    if (d.awaken && me.owns(d.for)) { me.setSpecies(me.speciesKey); this.buildSkillBar(); this.toast(`${d.name}の力で【${me.kit[d.awaken.slot].name}】が覚醒した！`, 'big'); sfx('fusion'); }
    me.hp += Math.max(0, me.maxHp - before);
  }

  // ================= お店 =================
  openShop() {
    const me = this.me, st = this.stage;
    if (!this.shop || this.shop.n !== st.n) {
      const r = rng(st.seed + me.id.length * 131 + me.level);
      const gen = GENERAL_ITEMS.filter((k) => k !== 'herb').sort(() => r() - 0.5).slice(0, 4);
      const mine = Object.keys(ITEMS).filter((k) => ITEMS[k].for && me.owns(ITEMS[k].for) && !me.items.includes(k));
      const others = Object.keys(ITEMS).filter((k) => ITEMS[k].for && !me.owns(ITEMS[k].for));
      const mates = others.filter((k) => this.teammateOwns(ITEMS[k].for));
      const spec = [...mine.sort(() => r() - 0.5).slice(0, 2)];
      const pool = mates.length ? mates : others; spec.push(pool[Math.floor(r() * pool.length)]);
      this.shop = { n: st.n, list: ['herb', ...gen, ...spec].filter(Boolean).map((k) => ({ k, sold: false })) };
    }
    const disc = Math.min(0.5, me.mods.discount || 0);
    const price = (k) => Math.round(ITEMS[k].price * (1 + st.n * 0.035) * (1 - disc));
    const render = () => {
      const html = `<button class="btn small ghost modal-close">閉じる (Esc)</button>
        <div class="merchant-talk"><img src="${src(merchantSprite())}"><div class="bubble">「いらっしゃい！ 旅の動物さん。<br>専用品は、その動物が持つと特別な力が目覚めるよ。仲間の分を買えば贈り物になるんだ」</div></div>
        <h2>タヌキの行商　<small style="color:var(--gold)">所持金 ${me.gold} G</small>${disc ? `<small style="color:#8affa0;font-size:14px">　器用さで ${Math.round(disc * 100)}% 割引中</small>` : ''}</h2>
        <div class="shop-grid">${this.shop.list.map((it, i) => {
          const d = ITEMS[it.k], own = !d.for || me.owns(d.for), mate = d.for && !own && this.teammateOwns(d.for);
          const forTxt = d.for ? (own ? `【${ANIMALS[d.for].name}専用】あなたにぴったり！` : `【${ANIMALS[d.for].name}専用】${mate ? '仲間に贈れる' : '仲間に' + ANIMALS[d.for].name + 'がいない'}`) : '';
          const can = !it.sold && me.gold >= price(it.k) && (own || mate);
          return `<div class="shop-item${d.for ? ' special' : ''}${it.sold ? ' sold' : ''}"><div class="nm">${d.name}</div>${forTxt ? `<div class="for${own ? '' : ' other'}">${forTxt}</div>` : ''}<div class="d">${d.desc}</div><div class="row"><span class="price">${price(it.k)} G</span><button class="btn small" data-i="${i}" ${can ? '' : 'disabled'}>${it.sold ? '売り切れ' : own ? '買う' : '贈る'}</button></div></div>`;
        }).join('')}</div>`;
      this.openModal(html);
      document.querySelectorAll('.shop-item button').forEach((b) => (b.onclick = () => {
        const it = this.shop.list[+b.dataset.i], d = ITEMS[it.k], p = price(it.k);
        if (me.gold < p || it.sold) return;
        me.gold -= p; if (it.k !== 'herb') it.sold = true; sfx('buy');
        if (!d.for || me.owns(d.for)) { this.giveItem(it.k); this.toast(`「${d.name}」を買った！`); }
        else { this.net.toHost({ type: 'giftreq', item: it.k, from: me.name }); this.toast(`仲間に「${d.name}」を贈った！`); }
        render();
      }));
    };
    render();
  }

  teammateOwns(animal) { return [...this.players.values()].some((p) => p.id !== this.me.id && p.an && (speciesOf(p.an).base === animal || speciesOf(p.an).mate === animal)); }

  // ================= 融合 =================
  fusionCard(key, pick = false) {
    const sp = speciesOf(key), [a, b] = key.split('+');
    return `<div class="fcard${pick ? ' pick' : ''}" data-k="${key}"><img src="${src(animalSprite(key))}"><div>
      <div class="nm">${sp.name}</div><div class="tt">${sp.title}</div><div class="from">${ANIMALS[a].name} × ${ANIMALS[b].name}</div>
      <div class="d">${sp.desc}<br><b>融合特性</b> ${sp.fusion.trait.name}：${sp.fusion.trait.desc}<br><b>必殺技</b> ${sp.kit.ult.name}：${sp.kit.ult.desc}<br><b>得意</b> ${sp.tags.map((t) => TAGS_JP[t]).join('・')}</div></div></div>`;
  }

  openFusion() {
    const me = this.me; if (me.sp.mate) return;
    const base = me.sp.base;
    this.openModal(`<button class="btn small ghost modal-close">閉じる (Esc)</button>
      <h2>融合の祭壇</h2><div class="sub">50の試練を越えた者だけが、もう一つの魂と一つになれる。融合すると「${ANIMALS[base].name}」の通常攻撃とスキルに、相手の特殊スキル・パッシブ・得意技を受け継ぎ、新しい種族だけの必殺技が目覚める。<br>一度融合すると元には戻れない。</div>
      <div class="fusion-grid">${ANIMAL_KEYS.filter((k) => k !== base).map((k) => this.fusionCard(base + '+' + k, true)).join('')}</div>`);
    document.querySelectorAll('.fcard.pick').forEach((c) => (c.onclick = () => {
      const key = c.dataset.k, sp = speciesOf(key);
      if (!c.classList.contains('confirm')) {
        document.querySelectorAll('.fcard.confirm').forEach((x) => x.classList.remove('confirm'));
        c.classList.add('confirm'); sfx('select'); return;
      }
      const ratio = me.hp / me.maxHp;
      me.setSpecies(key); me.hp = me.maxHp * Math.max(ratio, 1); me.ult = 100;
      this.closeModal(); this.buildSkillBar(); sfx('fusion');
      this.world.spawnFx({ k: 'fusion', x: me.x, z: me.z });
      this.toast(`新たな種族「${sp.name}」が誕生した！`, 'big'); this.toast(`必殺技【${sp.kit.ult.name}】が使えるようになった`);
    }));
  }

  openCodex() {
    const keys = Object.keys(FUSIONS);
    this.openModal(`<button class="btn small ghost modal-close">閉じる (Esc)</button>
      <h2>融合種 図鑑</h2><div class="sub">ステージ50の融合の祭壇で、二つの動物が一つになる。8種の動物から生まれる、この世界に存在しない28の種族。<br>（ベースにした動物によって見た目と通常攻撃・スキルが変わります）</div>
      <div class="fusion-grid">${keys.map((k) => this.fusionCard(k)).join('')}</div>`);
  }

  openModal(html) { const m = $('#modal'); m.querySelector('.modal-box').innerHTML = html; m.classList.remove('hidden'); m.querySelector('.modal-close')?.addEventListener('click', () => this.closeModal()); }
  closeModal() { $('#modal').classList.add('hidden'); }

  // ================= 終了 =================
  gameOver(n) {
    stopBgm();
    const me = this.me;
    this.openModal(`<div class="go-box"><h2>全滅…</h2><div class="sub">動物たちの冒険はここで途切れた</div>
      <div class="go-stats"><div><span>到達ステージ</span>${n}</div><div><span>レベル</span>${me.level}</div><div><span>種族</span>${me.sp.name}</div><div><span>所持金</span>${me.gold}G</div></div>
      ${this.net.isHost ? '<button id="go-again" class="btn primary">もう一度（同じ仲間で）</button> ' : '<div class="sub">ホストの操作を待っています…</div>'}
      <button id="go-title" class="btn">タイトルへ</button></div>`);
    $('#go-again')?.addEventListener('click', () => this.net.broadcast({ type: 'tolobby' }));
    $('#go-title').onclick = () => location.reload();
  }

  backToLobby() {
    this.closeModal(); this.me = null; this.stage = null; this.players.clear(); this.enemies.clear(); this.labels.clear(); this.ready = false;
    if (this.net.isHost) { this.sim = new Sim(this); for (const p of this.lobby) p.ready = p.id === this.net.id; }
    this.showPreview(); this.toLobby();
  }

  // ================= 表示ヘルパー =================
  toast(text, cls = '') {
    const box = $('#toasts'); while (box.children.length > 4) box.firstChild.remove();
    const d = document.createElement('div'); d.className = 'toast ' + cls; d.textContent = text; box.appendChild(d);
    setTimeout(() => d.remove(), 2800);
  }

  floatText(x, z, v, cls = '') {
    const p = this.world.toScreen(x + (Math.random() - 0.5) * 0.5, 1.6, z);
    if (!p.vis) return;
    const d = document.createElement('div'); d.className = 'num ' + (cls || ''); d.textContent = v;
    d.style.left = p.x + 'px'; d.style.top = p.y + 'px'; $('#labels').appendChild(d);
    setTimeout(() => d.remove(), 800);
  }

  sfx(n) { sfx(n); }
}

const game = new Game();
game.sim = new Sim(game);
window.game = game;
