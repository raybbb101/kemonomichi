// ルームコード式 P2P 通信（PeerJS / WebRTC）。サーバー不要で GitHub Pages から遊べる。
// ホストがゲームの正解(敵・弾・仕掛け)を持ち、参加者は自分の動物の位置と行動を送る。
const PREFIX = 'kemonomichi-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Net {
  constructor() { this.isHost = true; this.id = 'solo'; this.peer = null; this.conns = new Map(); this.hostConn = null; this.handlers = []; this.code = null; this.online = false; }
  on(fn) { this.handlers.push(fn); }
  emit(msg, from) { for (const h of this.handlers) h(msg, from); }

  host() {
    return new Promise((resolve, reject) => {
      const code = Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
      const peer = new window.Peer(PREFIX + code, { debug: 1 });
      const timer = setTimeout(() => reject(new Error('サーバーに接続できませんでした')), 12000);
      peer.on('open', (id) => {
        clearTimeout(timer);
        Object.assign(this, { peer, id, code, isHost: true, online: true });
        peer.on('connection', (conn) => {
          conn.on('open', () => { this.conns.set(conn.peer, conn); });
          conn.on('data', (d) => this.emit(d, conn.peer));
          conn.on('close', () => { this.conns.delete(conn.peer); this.emit({ type: '_leave' }, conn.peer); });
        });
        resolve(code);
      });
      peer.on('error', (e) => { clearTimeout(timer); if (e.type === 'unavailable-id') reject(new Error('もう一度お試しください')); else if (!this.online) reject(e); });
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      const peer = new window.Peer({ debug: 1 });
      const timer = setTimeout(() => reject(new Error('ルームが見つかりませんでした')), 12000);
      peer.on('open', (id) => {
        const conn = peer.connect(PREFIX + code.toUpperCase().trim(), { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          clearTimeout(timer);
          Object.assign(this, { peer, id, code: code.toUpperCase(), isHost: false, hostConn: conn, online: true });
          resolve();
        });
        conn.on('data', (d) => this.emit(d, 'host'));
        conn.on('close', () => this.emit({ type: '_hostgone' }, 'host'));
      });
      peer.on('error', (e) => { clearTimeout(timer); reject(e.type === 'peer-unavailable' ? new Error('ルームが見つかりませんでした') : e); });
    });
  }

  // 参加者 → ホスト（ホスト自身なら直接処理）
  toHost(msg) { if (this.isHost) this.emit(msg, this.id); else this.hostConn?.open && this.hostConn.send(msg); }
  // ホスト → 全員（自分にも届ける）
  broadcast(msg, self = true) { for (const c of this.conns.values()) if (c.open) c.send(msg); if (self) this.emit(msg, this.id); }
  sendTo(id, msg) { if (id === this.id) this.emit(msg, this.id); else { const c = this.conns.get(id); if (c?.open) c.send(msg); } }
}
