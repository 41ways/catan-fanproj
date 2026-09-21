/**
 * 카탄 — Cloudflare Workers 무료 플랜용 서버.
 *
 *  - 화면 파일(public/)은 Cloudflare 정적 자산으로 나간다. 요청 수 한도에 잡히지 않는다.
 *  - /ws 로 오는 소켓만 Durable Object 하나(main)로 보낸다. 방은 전부 그 안에 산다.
 *    Node 서버 한 대가 모든 방을 들고 있던 것과 같은 모양이라 game.js 를 그대로 쓴다.
 *
 * 무료 한도는 "객체가 켜져 있는 시간"이 먼저 찬다. 소켓이 하나라도 붙어 있으면 객체가 깨어 있으므로
 *  - 탭은 25초마다 ping 을 보내고, 2분 반 넘게 소식이 없는 소켓은 끊긴 것으로 친다.
 *  - 20분 동안 아무 조작이 없는 소켓은 닫는다(4000). 화면은 다시 누르면 이어 붙는다.
 *  - 방도 소켓도 없으면 청소 타이머까지 멈춰서 객체가 잠들 수 있게 한다.
 *  - 되풀이 타이머는 이 청소 하나뿐이다. game.js 는 봇 차례 · 끊긴 사람 기다리기 · 방장 넘기기처럼
 *    할 일이 생길 때만 한 번짜리 타이머를 건다. 사람이 생각하는 동안 서버가 스스로 깨어 도는 일은 없다.
 */
import { DurableObject } from 'cloudflare:workers';
import game from './game.js';

// 뒤로 보낸 탭은 브라우저가 타이머를 1분에 한 번으로 줄인다. 25초 ping 이 60초마다 올 수 있어 넉넉히 둔다.
const ALIVE_MS = 150_000;
const IDLE_MS = 20 * 60_000;
const SWEEP_MS = 30_000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/ws' || url.pathname === '/healthz') {
      return env.GAME.get(env.GAME.idFromName('main')).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

/** Cloudflare 소켓을 game.js 가 아는 모양(send · close · readyState)으로 감싼다 */
class Sock {
  constructor(ws) {
    this.ws = ws;
    this.open = true;
    this.seen = this.acted = Date.now();
  }
  get readyState() { return this.open ? 1 : 3; }
  send(text) {
    if (!this.open) return;
    try { this.ws.send(text); } catch (_) { this.open = false; }   // 막 닫힌 소켓 — 청소 타이머가 멈추지 않게
  }
  close(code = 1000, reason = '') {
    if (!this.open) return;
    this.open = false;
    try { this.ws.close(code, reason); } catch (_) { /* 이미 닫힘 */ }
  }
}

export class CatanGame extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.socks = new Set();
    this.timer = null;
    // 시험할 때만 줄여 쓴다 (wrangler dev --var IDLE_MS:3000 --var SWEEP_MS:500)
    this.idleMs = Number(env.IDLE_MS) || IDLE_MS;
    this.sweepMs = Number(env.SWEEP_MS) || SWEEP_MS;
    if (!CatanGame.checked) { game.selfCheck(); CatanGame.checked = true; }
  }

  async fetch(req) {
    if (new URL(req.url).pathname === '/healthz') {
      return Response.json({ ok: true, rooms: game.rooms.size, sockets: this.socks.size });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const s = new Sock(server);
    this.socks.add(s);

    server.addEventListener('message', e => {
      s.seen = Date.now();
      let msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'ping') return;             // 살아 있다는 신호일 뿐 — 조작으로 치지 않는다
      if (msg.t !== 'rooms') s.acted = s.seen;  // 방 목록 훑기는 화면이 저절로 보낸다 — 조작이 아니다
      try { game.handle(s, msg); } catch (err) { console.error('handle error', err); }
    });
    const gone = () => {
      if (!this.socks.delete(s)) return;
      s.open = false;
      game.disconnect(s);
      this.tick();
    };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);

    this.tick();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** 끊긴 소켓 · 오래 가만있는 소켓 정리, 빈 방 청소. 할 일이 없으면 타이머를 멈춘다. */
  tick() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = Date.now();
      for (const s of [...this.socks]) {
        if (now - s.seen > ALIVE_MS) {
          this.drop(s, 1001, 'gone');
        } else if (now - s.acted > this.idleMs) {
          s.send(JSON.stringify({ t: 'idle' }));
          this.drop(s, 4000, 'idle');
        }
      }
      game.sweepRooms(now);
      if (this.socks.size || game.rooms.size) this.tick();
    }, this.sweepMs);
  }

  /** 서버가 스스로 끊는다. 사람이 나간 게 아니므로 대기실 자리는 남긴다(다시 누르면 이어 붙는다). */
  drop(s, code, reason) {
    this.socks.delete(s);
    s.close(code, reason);
    game.disconnect(s, { keepSeat: true });
  }
}
