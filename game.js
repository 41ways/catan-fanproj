'use strict';
/**
 * 카탄 — 방 관리와 판 진행.
 *  - 판(땅·주사위·손패·더미·차례)과 봇은 전부 서버가 쥔다(권위 서버). 규칙 판정은 규칙 엔진이 한다.
 *    기본판은 rules.js, 도시와 기사는 ck.js. 방 설정(cfg.ext)으로 골라 판마다 하나를 쓴다.
 *    화면은 "이 행동 할래" 만 보내고, 서버는 사람마다 볼 수 있는 만큼(viewFor)만 잘라서 보낸다.
 *    판 상태를 통째로 보내는 길은 없다 — 남의 손패 종류·발전(진보)카드·승점 카드·더미 순서·주사위 씨앗은 안 나간다.
 *  - 여러 사람의 대답을 기다리는 단계(순서 주사위 · 7 버리기 · 거래 제안 받기/거절)는 규칙 엔진의 상태
 *    (orderRolls · mustDiscard · trade.replies)에 이미 들어 있다. 서버는 누가 아직 안 했는지를
 *    needsAction · tradePending 으로 읽어 봇을 움직이고, 끊긴 사람은 기다렸다가 빼거나 대신 거절한다.
 *  - 통신 방식은 모른다. 소켓은 send(문자열) · close() · readyState 만 있으면 된다.
 *    Node 서버(server.js)와 Cloudflare(worker.js)가 이 파일을 똑같이 쓴다.
 *  - 혼자 하기(봇과)는 여기를 거치지 않는다. 브라우저가 같은 엔진 · 봇 파일로 직접 돌린다.
 *  - 연출(주사위 굴림 · 큰 소식 · 중계 · 날아가는 카드)은 화면 몫이다. 서버는 상태만 보낸다.
 */

// 엔진 파일들은 끝에서 `self.Rules` · `self.CK` 처럼 전역에 붙는다(브라우저와 같은 모양).
// ck.js 는 먼저 붙은 self.Rules 를 읽으므로 같은 전역을 봐야 한다. Cloudflare 에는 self 가 있고,
// Node 에는 없어서 여기서 하나 만들어 준다. 엔진 파일은 한 글자도 고치지 않는다.
if (typeof self === 'undefined') globalThis.self = globalThis;
require('./rules');
require('./ai');
require('./ck');
require('./ck-ai');
const R = self.Rules, AI = self.AI, CK = self.CK, CKAI = self.CKAI;

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const SKILLS = [0.4, 0.75, 1];                 // 쉬움 · 보통 · 어려움 — 화면의 고르기 칸과 같은 값
// 테스트는 판을 빨리 돌려야 해서 CATAN_FAST=1 로 뜸을 들이지 않게 한다
const FAST = typeof process !== 'undefined' && !!process.env && process.env.CATAN_FAST === '1';
const LOBBY_GRACE = FAST ? 300 : 20_000;       // 끊긴 방장을 넘기기까지 · 대기실에서 끊긴 자리를 비우기까지
const DC_GRACE = FAST ? 300 : 20_000;          // 판 중에 끊긴 사람이 해야 할 일이 오면 이만큼 기다렸다가 판에서 뺀다
const BOT_NAMES = ['봇 하나', '봇 둘', '봇 셋'];

/* ── 봇 페이싱 ──
   예전에는 방장 화면이 자기 중계(feed)가 얼마나 밀렸는지 보고 다음 봇 수를 미뤘다.
   서버에는 화면이 없으니 같은 셈을 흉내 낸다 — 새 기록 줄마다 화면이 그 줄을 띄워 두는 시간
   (0.85초 + 글자당 0.075초, 최소 1.3초 — app.js 의 readTime)을 쌓아 "중계가 언제 끝날지" 를 어림한다.
   주사위를 굴리면 그 연출(약 2.3초)도 더한다. 기다리는 값은 예전 방장 화면의 scheduleBot 그대로다. */
const WAIT = FAST
  ? { order: 5, setup: 5, roll: 5, other: 5, reply: 5, intro: 0 }
  : { order: 2900, setup: 1300, roll: 900, other: 820, reply: 700, intro: 700 };
const INTRO_MS = FAST ? 0 : 19 * 70 + 260 + 19 * 55 + 420;   // 판이 깔리는 연출 (app.js 의 INTRO_ALL)
const DICE_MS = FAST ? 0 : 2300;               // 주사위가 굴러 사라지기까지
const GATE_MS = FAST ? 0 : 3500;               // 순서가 정해짐 · 준비 끝 — 화면이 한 번 멈춰 세우는 관문
const FEED_CAP = 14 * 1600;                    // 화면도 14줄 넘게 밀리면 앞을 버린다
const BOT_TURN_GUARD = 80;                     // 봇이 한 차례에 이보다 많이 두면 어딘가 어긋난 것 — 차례를 넘긴다
function readTime(text) {
  if (FAST) return 0;
  const n = String(text || '').replace(/\s/g, '').length;
  return Math.max(1300, 850 + n * 75);
}

/* 화면에서 보내도 되는 행동. 신원(pid)은 서버가 붙인다. 엔진에 없는 이름(기본판의 develop 등)은 걸러진다. */
const ACTIONS = ['rollForOrder', 'placeSettlement', 'placeRoad', 'roll', 'discard', 'moveRobber',
  'build', 'buyDev', 'playDev', 'bankTrade', 'offerTrade', 'replyTrade', 'acceptTrade', 'cancelTrade', 'endTurn',
  // 도시와 기사
  'placeKnight', 'activateKnight', 'upgradeKnight', 'moveKnight', 'chaseRobber', 'develop', 'playCard'];

/* ─────────────────────────── 유틸 ─────────────────────────── */

const pick = a => a[Math.floor(Math.random() * a.length)];
const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
const token = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)),
  b => b.toString(16).padStart(2, '0')).join('');

/** setTimeout 으로 나중에 도는 콜백(봇 걸음 · 끊긴 사람 빼기 · 방장 넘기기 등)은 사람이 보낸 메시지와
 *  달리 handle() 의 바깥 try/catch를 지나지 않는다 — 안에서 뭔가 어긋나 던지면 Node 프로세스가 죽어
 *  이 방과 무관한 다른 방의 판까지 통째로 멈춘다. 그런 콜백은 전부 이걸로 감싼다: 한 방이 어긋나도
 *  로그만 남기고 나머지 방은 그대로 돈다. */
function safeTimer(fn) {
  return (...a) => {
    try { fn(...a); }
    catch (e) { console.error('타이머 처리 오류', e && e.stack || e); }
  };
}

/** 화면이 보낸 인자를 엔진에 넘길 수 있는 모양으로만 남긴다 — 숫자 · 짧은 글자 · 참거짓 · null,
 *  그것들의 배열과 묶음(거래 제안의 자원 → 장수, 무역항의 사람 → [줄 것, 받을 것]).
 *  너무 깊거나 긴 것, 이상한 키(__proto__ 등)가 섞이면 통째로 거절한다. */
function safeArg(a, depth) {
  if (a === null || typeof a === 'boolean') return { ok: true, v: a };
  if (typeof a === 'number') return Number.isFinite(a) ? { ok: true, v: a } : { ok: false };
  if (typeof a === 'string') return a.length <= 24 ? { ok: true, v: a } : { ok: false };
  if (depth > 3 || typeof a !== 'object') return { ok: false };
  if (Array.isArray(a)) {
    if (a.length > 24) return { ok: false };
    const out = [];
    for (const x of a) { const r = safeArg(x, depth + 1); if (!r.ok) return r; out.push(r.v); }
    return { ok: true, v: out };
  }
  const keys = Object.keys(a);
  if (keys.length > 12) return { ok: false };
  const out = {};
  for (const k of keys) {
    if (!/^[A-Za-z0-9]{1,16}$/.test(k)) return { ok: false };
    const r = safeArg(a[k], depth + 1);
    if (!r.ok) return r;
    out[k] = r.v;
  }
  return { ok: true, v: out };
}

/* ─────────────────────────── 방 ─────────────────────────── */

const rooms = new Map();

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 헷갈리는 글자 제외
  let code;
  do {
    code = Array.from({ length: 4 }, () => pick(alphabet.split(''))).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const room = {
    code: makeCode(),
    phase: 'lobby',            // lobby | playing | over
    hostId: null,
    players: [],               // 자리 — 사람과 봇. 판이 시작되면 이 순서가 자리 순서(색)다
    nextId: 1,
    cfg: { ext: false, skill: 0.75, priv: false },
    eng: R,                    // 이번 판의 엔진 — 시작할 때 cfg.ext 로 정한다
    state: null,               // 엔진의 판 상태. 대기실에서는 null. 밖으로는 절대 그대로 나가지 않는다
    feed: null,                // 화면 중계가 언제쯤 끝날지 어림한 것 (봇 페이싱)
    holdUntil: 0,              // 이 시각까지는 봇이 다음 수를 두지 않는다
    botSkip: null,             // 이번 차례에 거절된 진보카드 — 봇이 같은 카드를 또 고르지 않게
    botSteps: null,            // 이번 차례에 봇이 둔 수 — 헛돌기 방지
    startedAt: 0,
    timers: { bot: null, host: null },
    dc: new Map(),             // 끊긴 사람마다 하나 — 기다렸다가 빼거나 대신 거절하는 예약
    madeAt: Date.now(),
    lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

/** 같은 이름이 둘이면 화면에서 누가 누군지 모른다 — 뒤에 숫자를 붙인다 */
function uniqueName(room, name) {
  const base = name;
  let n = 2;
  while (room.players.some(p => p.name === name)) name = base + n++;
  return name;
}

function addPlayer(room, { name, bot }) {
  const n = room.nextId++;
  const p = {
    // 엔진은 id 를 === 로 견주고 mustDiscard 같은 객체 키로도 쓴다. 키는 늘 글자라서 id 도 글자로 둔다.
    id: 'p' + n,
    token: bot ? null : token(),
    name: uniqueName(room, name || `플레이어 ${n}`),
    bot: !!bot,
    ws: null,
    connected: !!bot,
  };
  room.players.push(p);
  if (!p.bot && room.hostId == null) room.hostId = p.id;
  return p;
}

const playerOf = (room, id) => room.players.find(p => p.id === id) || null;

/** 자리를 뺀다. 판 중이면 판에서도 빠지게 한다 — 버리기 · 거래 대답에서도 빠지고, 내 차례였으면 넘어간다. */
function removePlayer(room, id) {
  const i = room.players.findIndex(p => p.id === id);
  if (i < 0) return;
  const [gone] = room.players.splice(i, 1);
  clearTimeout(gone.leaveT);
  clearDc(room, gone.id);

  if (room.hostId === gone.id) {
    const next = room.players.find(p => !p.bot && p.connected) || room.players.find(p => !p.bot);
    room.hostId = next ? next.id : null;
  }
  if (room.phase === 'playing' && room.state) {
    const sp = room.eng.playerOf(room.state, gone.id);
    if (sp && !sp.out) {
      const prevPhase = room.state.phase;
      room.eng.dropPlayer(room.state, gone.id);
      afterMove(room, prevPhase);
    }
  }
}

/* ─────────────────────────── 판 진행 ─────────────────────────── */

function startGame(room) {
  clearAll(room);
  room.phase = 'playing';
  room.eng = room.cfg.ext ? CK : R;
  room.state = room.eng.newGame(room.players.map(p => ({ id: p.id, name: p.name, bot: p.bot })),
    Math.floor(Math.random() * 1e9));
  room.startedAt = Date.now();
  room.feed = { at: Date.now() + INTRO_MS, lastI: -1, dice: '' };
  room.holdUntil = 0;
  room.botSkip = null; room.botSteps = null;
  trackFeed(room, null);             // 첫 안내 줄은 화면이 몰아 보여 주지 않는다 — 읽음으로 쳐 둔다
  room.feed.at = Date.now() + INTRO_MS;
  pushState(room);
  scheduleBot(room);
  watchAbsent(room);
}

/** 행동 하나가 판에 반영된 뒤 — 중계 시간 어림 · 판 끝 확인 · 모두에게 알리기 · 다음 봇 예약 · 끊긴 사람 확인 */
function afterMove(room, prevPhase) {
  const s = room.state;
  trackFeed(room, prevPhase);
  if (s.phase === 'over') {
    finish(room);
    return;
  }
  pushState(room);
  scheduleBot(room);
  watchAbsent(room);
}

/** 새로 생긴 기록 줄 · 주사위를 화면이 보여 주는 데 걸릴 시간만큼 중계 끝 시각을 민다.
 *  볼 사람이 없으면(봇들과 온라인 방에서 모두 끊김) 쌓지 않는다 — 기다릴 까닭이 없다. */
function trackFeed(room, prevPhase) {
  const s = room.state, f = room.feed, now = Date.now();
  const watching = room.players.some(p => !p.bot && p.connected);
  if (f.at < now) f.at = now;
  if (s.dice) {
    const dk = s.turnCount + ':' + s.dice.join(',');
    if (dk !== f.dice) { f.dice = dk; if (watching) f.at += DICE_MS; }
  }
  for (const l of s.log) {
    if (l.i <= f.lastI) continue;
    f.lastI = l.i;
    if (!watching || l.only) continue;                       // 한 사람만 보는 줄은 셈에서 뺀다
    if (l.text.indexOf('— ') === 0 && l.text.indexOf('차례') > 0) continue;   // 화면이 큰 배너로 대신 알린다
    if (l.text.indexOf('순서 주사위') >= 0) continue;         // 주사위 연출이 대신한다
    f.at += readTime(l.text);
  }
  f.at = Math.min(f.at, now + FEED_CAP);
  // 순서가 정해진 순간 · 준비가 끝난 순간 — 화면이 관문을 띄워 한 번 멈춰 세운다. 봇도 그만큼 기다린다.
  if (watching && prevPhase && prevPhase !== s.phase &&
      ((prevPhase === 'order' && s.phase === 'setup') || (prevPhase === 'setup' && s.phase === 'roll'))) {
    room.holdUntil = Math.max(room.holdUntil, f.at + GATE_MS);
  }
}

function finish(room) {
  clearAll(room);
  room.phase = 'over';
  pushState(room);
}

/** 봇이 지금 해야 할 일 — 거래 대답이 먼저, 그다음 needsAction 에 든 봇. 없으면 null. */
function botDuty(room) {
  const s = room.state, eng = room.eng;
  const isBot = id => { const q = eng.playerOf(s, id); return !!(q && q.bot && !q.out); };
  const reply = eng.tradePending(s).filter(isBot);
  if (reply.length) return { kind: 'reply', pid: reply[0] };
  if (s.trade) return null;          // 제안이 떠 있고 대답이 다 모였으면 제안한 사람(사람)의 몫 — 봇은 제안하지 않는다
  const all = eng.needsAction(s);
  // 순서 정하기는 사람이 먼저 굴린 뒤에 봇이 이어 굴린다 — 그래야 무슨 일이 일어나는지 보인다
  if (s.phase === 'order' && all.some(id => { const q = eng.playerOf(s, id); return q && !q.bot; })) return null;
  const need = all.filter(isBot);
  return need.length ? { kind: 'act', pid: need[0] } : null;
}

function scheduleBot(room) {
  clearTimeout(room.timers.bot); room.timers.bot = null;
  const s = room.state;
  if (room.phase !== 'playing' || !s || s.phase === 'over') return;
  const duty = botDuty(room);
  if (!duty) return;
  const now = Date.now();
  const backlog = Math.max(0, room.feed.at - now);
  let wait;
  if (duty.kind === 'reply') wait = WAIT.reply + Math.min(1400, Math.round(backlog * 0.2));
  else {
    wait = s.phase === 'order' ? WAIT.order : s.phase === 'setup' ? WAIT.setup : s.phase === 'roll' ? WAIT.roll : WAIT.other;
    if (now - room.startedAt < INTRO_MS) wait += WAIT.intro;          // 판이 깔리는 동안은 천천히
    // 아직 중계할 줄이 남아 있으면 그만큼 늦춘다 (예전 방장 화면: 밀린 줄 하나당 0.52초, 최대 3.2초)
    wait += Math.min(3200, Math.round(backlog * 0.3));
  }
  wait = Math.max(wait, room.holdUntil - now);
  room.timers.bot = setTimeout(safeTimer(() => botStep(room)), wait);
}

function botStep(room) {
  room.timers.bot = null;
  const s = room.state, eng = room.eng;
  if (room.phase !== 'playing' || !s || s.phase === 'over' || rooms.get(room.code) !== room) return;
  const duty = botDuty(room);
  if (!duty) return;
  const prevPhase = s.phase;
  const p = eng.playerOf(s, duty.pid);
  const bot = eng === CK ? CKAI : AI;
  const v = eng.viewFor(s, p.id);
  let r = null;
  try {
    if (duty.kind === 'reply') r = eng.replyTrade(s, p.id, !!bot.replyToTrade(v));
    else r = botMove(room, p, v, bot);
  } catch (e) {
    console.error('봇 판단 오류', room.code, p.name, e && e.message);
    r = null;
  }
  if (r === 'retry') { scheduleBot(room); return; }      // 거절된 카드를 빼고 다음 걸음에서 다시 고른다
  if (!r || !r.ok) {
    // 여기까지 오면 규칙 엔진과 봇이 어긋난 것이다. 판이 영영 멈추지 않게 그 봇을 판에서 뺀다.
    console.error('봇이 막힘', room.code, p.name, r && r.error);
    eng.dropPlayer(s, p.id);
  }
  afterMove(room, prevPhase);
}

/** 봇 한 수 — 예전 방장 화면의 botStep 을 그대로 옮겼다. 판단이 규칙에 걸리면 아무 합법 수로 메운다. */
function botMove(room, p, v, bot) {
  const s = room.state, eng = room.eng, pid = p.id;
  const cards = eng === CK ? CK.ALL : R.RES;
  let r = null;

  if (s.phase === 'order') return eng.rollForOrder(s, pid);
  if (s.phase === 'setup') {
    if (s.setupSub === 'settlement') {
      r = eng.placeSettlement(s, pid, bot.chooseSetupSettlement(v));
      if (!r.ok) r = eng.placeSettlement(s, pid, eng.legalSettlements(s, pid)[0]);
    } else {
      r = eng.placeRoad(s, pid, bot.chooseSetupRoad(v));
      if (!r.ok) r = eng.placeRoad(s, pid, eng.legalRoads(s, pid)[0]);
    }
    return r;
  }
  if (s.phase === 'discard') {
    const need = s.mustDiscard[pid];
    r = eng.discard(s, pid, bot.chooseDiscard(v, need));
    if (!r.ok) {
      const pool = [];
      cards.forEach(c => { for (let i = 0; i < p.res[c]; i++) pool.push(c); });
      r = eng.discard(s, pid, pool.slice(0, need));
    }
    return r;
  }
  if (s.phase === 'robber') {
    const rb = bot.chooseRobber(v);
    const cands = eng.robberVictims(s, rb.hex, pid);
    r = eng.moveRobber(s, pid, rb.hex, cands.length ? (rb.victim && cands.indexOf(rb.victim) >= 0 ? rb.victim : cands[0]) : null);
    if (!r.ok) {
      // 도둑이 이미 앉은 칸만 아니면 어디든 — 한 칸씩 돌며 받아 주는 곳을 찾는다
      for (let k = 1; k <= s.board.hexes.length && !r.ok; k++) {
        const hx = (s.robber + k) % s.board.hexes.length;
        const cd = eng.robberVictims(s, hx, pid);
        r = eng.moveRobber(s, pid, hx, cd.length ? cd[0] : null);
      }
    }
    return r;
  }

  // 본게임 — 굴리기 · 짓기 · 카드 · 거래 · 넘기기
  const key = s.turnCount + ':' + pid;
  if (!room.botSkip || room.botSkip.k !== key) room.botSkip = { k: key, list: [] };
  if (!room.botSteps || room.botSteps.k !== key) room.botSteps = { k: key, n: 0 };
  if (++room.botSteps.n > BOT_TURN_GUARD) {
    console.error('봇이 한 차례에 너무 많이 둠', room.code, p.name);
    if (s.phase === 'roll') return eng.roll(s, pid);
    s.freeRoads = 0;
    return eng.endTurn(s, pid);
  }
  const a = bot.act(v, room.cfg.skill, room.botSkip.list);
  if (a && typeof eng[a.action] === 'function') r = eng[a.action].apply(null, [s, pid].concat(a.args));
  if ((!r || !r.ok) && a && a.action === 'playCard' && room.botSkip.list.length < 8) {
    room.botSkip.list.push(a.args[0]);      // 거절된 카드 — 이번 차례엔 다시 고르지 않는다
    return 'retry';
  }
  if (!r || !r.ok) {
    if (s.phase === 'roll') r = eng.roll(s, pid);
    else { if (s.freeRoads > 0) s.freeRoads = 0; r = eng.endTurn(s, pid); }
  }
  return r;
}

/** 지금 누구를 기다리는가 — 해야 할 일(act: 굴리기·놓기·버리기·차례)과 거래 대답(reply) */
function waitingOn(room) {
  const s = room.state, eng = room.eng, need = new Map();
  eng.needsAction(s).forEach(id => need.set(id, 'act'));
  eng.tradePending(s).forEach(id => { if (!need.has(id)) need.set(id, 'reply'); });
  return need;
}

/** 판 중에 끊긴 사람이 해야 할 일이 오면 잠깐 기다렸다가(새로고침은 그 안에 돌아온다)
 *  - 해야 할 일(내 차례 · 순서 주사위 · 버리기)이면 판에서 뺀다. 빼지 않으면 남은 사람들이 영영 멈춘다.
 *  - 거래 대답만 남았으면 판에서 빼지 않고 거절로 대신 답한다. 제안한 사람이 누구와 바꿀지 고를 수 있게.
 *  버리기는 여럿이 동시에 하므로 끊긴 사람마다 따로 센다. */
function watchAbsent(room) {
  const s = room.state;
  if (room.phase !== 'playing' || !s || s.phase === 'over') { clearDc(room); return; }
  const need = waitingOn(room);
  for (const [pid] of room.dc) {
    const seat = playerOf(room, pid);
    if (!need.has(pid) || !seat || seat.connected) clearDc(room, pid);
  }
  for (const [pid] of need) {
    const seat = playerOf(room, pid);
    if (!seat || seat.bot || seat.connected || room.dc.has(pid)) continue;
    room.dc.set(pid, setTimeout(safeTimer(() => absentTimeout(room, s, pid)), DC_GRACE));
  }
}

function absentTimeout(room, s, pid) {
  room.dc.delete(pid);
  if (room.phase !== 'playing' || room.state !== s || s.phase === 'over' || rooms.get(room.code) !== room) return;
  const seat = playerOf(room, pid);
  if (!seat || seat.connected) return;
  const kind = waitingOn(room).get(pid);
  if (!kind) return;
  const prevPhase = s.phase;
  if (kind === 'act') {
    room.eng.dropPlayer(s, pid);
    ev(room, { kind: 'dropped', name: seat.name });
  } else {
    room.eng.replyTrade(s, pid, false);
  }
  afterMove(room, prevPhase);
}

function clearDc(room, pid) {
  if (pid === undefined) {
    for (const t of room.dc.values()) clearTimeout(t);
    room.dc.clear();
    return;
  }
  clearTimeout(room.dc.get(pid));
  room.dc.delete(pid);
}

/* ─────────────────────────── 통신 ─────────────────────────── */

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (_) {}
  }
}

function stateFor(room, me) {
  return {
    t: 'state',
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    cfg: room.cfg,
    max: MAX_PLAYERS,          // 인원 상한은 서버 값 하나만 쓴다 (화면 표기가 어긋나지 않게)
    min: MIN_PLAYERS,
    now: Date.now(),
    you: me ? me.id : null,
    players: room.players.map(p => ({ id: p.id, name: p.name, bot: p.bot, connected: p.connected })),
    // 판 화면은 사람마다 다르다 — 엔진의 viewFor 가 남의 손패 종류 · 카드를 잘라 낸 것만 보낸다
    view: room.state && room.phase !== 'lobby' && me ? room.eng.viewFor(room.state, me.id) : null,
  };
}

function pushState(room) {
  for (const p of room.players) if (!p.bot) send(p.ws, stateFor(room, p));
}
function broadcast(room, obj) {
  for (const p of room.players) if (!p.bot) send(p.ws, obj);
}
const ev = (room, obj) => broadcast(room, Object.assign({ t: 'ev' }, obj));

function clearAll(room) {
  clearTimeout(room.timers.bot); room.timers.bot = null;
  clearDc(room);
}

/* ─────────────────────────── 메시지 처리 ─────────────────────────── */

function attach(room, p, ws) {
  clearTimeout(p.leaveT);
  p.ws = ws; p.connected = true;
  // 방장이 자리를 비운 채면(모두 끊겼다 이 사람이 먼저 돌아온 경우 등) 돌아온 사람이 방장을 맡는다
  const host = playerOf(room, room.hostId);
  if (!host || (!host.connected && host !== p)) room.hostId = p.id;
  ws.roomCode = room.code; ws.playerId = p.id;
  room.lastActive = Date.now();
  send(ws, { t: 'welcome', you: p.id, token: p.token, code: room.code });
  pushState(room);
  watchAbsent(room);             // 끊겼다 돌아왔으면 빼려던 예약을 거둔다
}

/** 이 소켓이 이미 어느 자리에 앉아 있으면 거기서 떼어 낸다. create/join 을 연달아 받으면 앞 자리가
 *  소켓을 쥔 채 "접속 중" 으로 영영 남아서, 그 자리 차례에서 판이 멈추고 방도 치워지지 않는다. */
function detach(ws) {
  const room = rooms.get(ws.roomCode);
  if (room) {
    const p = playerOf(room, ws.playerId);
    if (p && p.ws === ws) {
      if (room.phase === 'lobby') {
        removePlayer(room, p.id);
        if (!room.players.some(x => !x.bot)) dropRoom(room);   // 빈 방은 곧바로 치운다
        else pushState(room);
      } else disconnect(ws);
    }
  }
  ws.roomCode = null; ws.playerId = null;
}

function dropRoom(room) {
  clearAll(room);
  clearTimeout(room.timers.host);
  for (const p of room.players) clearTimeout(p.leaveT);
  rooms.delete(room.code);
}

/** 열린 방 목록 — 코드를 몰라도 들어갈 수 있게. 시작 전이고 자리가 남았고 비공개가 아닌 방만. */
function roomList() {
  const list = [];
  const now = Date.now();
  for (const r of rooms.values()) {
    if (r.cfg.priv) continue;
    if (!r.players.some(p => !p.bot && p.connected)) continue;
    const state = r.phase !== 'lobby' ? 'playing' : r.players.length >= MAX_PLAYERS ? 'full' : 'wait';
    const host = playerOf(r, r.hostId);
    list.push({
      code: r.code,
      n: r.players.length,
      max: MAX_PLAYERS,
      bots: r.players.filter(p => p.bot).length,
      ext: !!r.cfg.ext,
      host: host ? host.name : '',
      age: Math.round((now - r.madeAt) / 1000),
      state,
    });
  }
  list.sort((a, b) => (a.state === 'wait' ? 0 : 1) - (b.state === 'wait' ? 0 : 1) || a.age - b.age);
  return list.slice(0, 12);
}

function handle(ws, msg) {
  if ((msg.t === 'create' || msg.t === 'join' || msg.t === 'resume') && ws.roomCode) detach(ws);
  switch (msg.t) {
    case 'rooms':
      return send(ws, { t: 'rooms', list: roomList() });

    case 'create': {
      const r = createRoom();
      if (msg.priv === true) r.cfg.priv = true;
      if (msg.ext === true) r.cfg.ext = true;
      if (SKILLS.includes(msg.skill)) r.cfg.skill = msg.skill;
      const p = addPlayer(r, { name: clean(msg.name, 12) || '이름없음' });
      attach(r, p, ws);
      return;
    }
    case 'join': {
      const code = clean(msg.code, 8).toUpperCase();
      const r = rooms.get(code);
      if (!r) return send(ws, { t: 'err', msg: '그런 방이 없습니다. 코드를 확인해 주세요.' });
      if (r.phase !== 'lobby') return send(ws, { t: 'err', msg: '이미 시작된 방입니다.' });
      if (r.players.length >= MAX_PLAYERS) return send(ws, { t: 'err', msg: '자리가 찼습니다.' });
      const p = addPlayer(r, { name: clean(msg.name, 12) || '이름없음' });
      attach(r, p, ws);
      ev(r, { kind: 'joined', by: p.id, name: p.name });
      return;
    }
    case 'resume': {
      const r = rooms.get(clean(msg.code, 8).toUpperCase());
      if (!r) return send(ws, { t: 'err', msg: '방이 사라졌습니다.', fatal: true });
      const p = r.players.find(x => !x.bot && x.token === msg.token);
      if (!p) return send(ws, { t: 'err', msg: '자리를 찾을 수 없습니다.', fatal: true });
      // 먼저 붙어 있던 소켓(복제한 탭 등)은 4001 로 닫는다. 그 탭은 스스로 다시 붙지 않으므로
      // 두 탭이 서로를 밀어내며 끝없이 다시 붙는 일이 없다. 닫는 코드는 중간에 떨어지기도 해서 알림을 먼저 보낸다.
      if (p.ws && p.ws !== ws) {
        const old = p.ws;
        old.roomCode = null; old.playerId = null;      // 옛 소켓이 닫혀도 이 자리를 끊긴 걸로 치지 않게
        send(old, { t: 'moved' });
        try { old.close(4001, 'moved'); } catch (_) {}
      }
      attach(r, p, ws);
      return;
    }
  }

  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const me = playerOf(room, ws.playerId);
  if (!me) return;
  const isHost = room.hostId === me.id;
  room.lastActive = Date.now();

  switch (msg.t) {
    case 'cfg': {
      if (!isHost || room.phase !== 'lobby') return;
      if (SKILLS.includes(msg.skill)) room.cfg.skill = msg.skill;
      if (typeof msg.priv === 'boolean') room.cfg.priv = msg.priv;
      if (typeof msg.ext === 'boolean') room.cfg.ext = msg.ext;
      pushState(room);
      break;
    }

    case 'addBot': {
      if (!isHost || room.phase !== 'lobby') return;
      if (room.players.length >= MAX_PLAYERS) return send(ws, { t: 'err', msg: '자리가 찼습니다.' });
      const used = new Set(room.players.map(p => p.name));
      const name = BOT_NAMES.find(n => !used.has(n)) || `봇 ${room.players.length + 1}`;
      addPlayer(room, { name, bot: true });
      pushState(room);
      break;
    }

    case 'kick': {
      if (!isHost || room.phase !== 'lobby') return;
      const target = playerOf(room, msg.id);
      if (!target || target.id === room.hostId) return;
      if (target.ws) {
        send(target.ws, { t: 'err', msg: '방장이 내보냈습니다.', fatal: true });
        target.ws.roomCode = null; target.ws.playerId = null;
      }
      removePlayer(room, target.id);
      pushState(room);
      break;
    }

    case 'start': {
      if (!isHost || room.phase !== 'lobby') return;
      if (room.players.length < MIN_PLAYERS) return send(ws, { t: 'err', msg: '2명 이상이어야 시작할 수 있습니다.' });
      startGame(room);
      break;
    }

    case 'act': {
      if (room.phase !== 'playing' || !room.state) return;
      const eng = room.eng;
      if (ACTIONS.indexOf(msg.action) < 0 || typeof eng[msg.action] !== 'function') return;
      const args = safeArg(Array.isArray(msg.args) ? msg.args.slice(0, 4) : [], 0);
      if (!args.ok) return send(ws, { t: 'err', msg: '잘못된 요청입니다.' });
      const s = room.state, prevPhase = s.phase;
      // 신원은 소켓이 정한다 — 메시지에 누구인지 적어 보내도 무시한다. 남의 차례를 가로챌 수 없다.
      let r;
      try { r = eng[msg.action].apply(null, [s, me.id].concat(args.v)); }
      catch (e) {
        // 엔진은 대부분 먼저 따져 보고 고치지만, 이상한 번호 하나로 던질 수도 있다. 서버가 죽지 않게 막는다.
        console.error('행동 처리 오류', room.code, msg.action, e && e.message);
        r = { ok: false, error: '할 수 없는 행동입니다.' };
      }
      if (!r || !r.ok) return send(ws, { t: 'err', msg: (r && r.error) || '할 수 없는 행동입니다.' });
      afterMove(room, prevPhase);
      break;
    }

    // 같은 방 사람끼리 하는 잡담. 판정에는 아무 영향이 없고 서버는 저장하지 않는다.
    case 'chat': {
      const text = clean(msg.text, 200);
      if (!text) return;
      const now = Date.now();
      // 한 사람이 몰아치는 것만 막는다. 전체를 하나로 세면 두 사람이 동시에 말할 때 한쪽 말이 사라진다.
      if (now - (me.lastChat || 0) < 350) return;
      me.lastChat = now;
      broadcast(room, { t: 'chat', from: me.id, name: me.name, text });
      break;
    }

    case 'again': {
      if (!isHost || room.phase !== 'over') return;
      clearAll(room);
      room.phase = 'lobby';
      room.state = null;
      // 판 중에 떠난 사람은 대기실 떠나기 예약이 없어 다음 판에 유령 자리로 남는다
      for (const p of room.players) if (!p.bot && !p.connected) armLeave(room, p);
      pushState(room);
      break;
    }

    case 'leave': {
      const name = me.name;
      removePlayer(room, me.id);
      ws.roomCode = null; ws.playerId = null;
      send(ws, { t: 'left' });
      if (!room.players.some(p => !p.bot)) { dropRoom(room); break; }   // 봇만 남은 방은 둘 까닭이 없다
      ev(room, { kind: 'left', name });
      pushState(room);
      break;
    }
  }
}

/** 대기실에서 끊긴 자리를 잠깐 뒤에 비운다 — 그 사이 돌아오면(attach) 취소된다 */
function armLeave(room, p) {
  clearTimeout(p.leaveT);
  p.leaveT = setTimeout(safeTimer(() => {
    if (p.connected || room.phase !== 'lobby' || rooms.get(room.code) !== room) return;
    removePlayer(room, p.id);
    pushState(room);
  }), LOBBY_GRACE);
}

/** 소켓이 닫혔다. 그 사이 같은 자리가 새 소켓으로 다시 붙었으면(새로고침) 건드리지 않는다.
 *  keepSeat — 서버가 스스로 끊은 경우(오래 조작 없음 · 소식 없음). 사람은 나간 게 아니라서
 *  대기실 자리를 지워 버리면 "누르면 다시 붙어요" 가 거짓말이 된다. 자리는 두고 방장만 넘긴다. */
function disconnect(ws, { keepSeat = false } = {}) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const p = playerOf(room, ws.playerId);
  if (!p || p.ws !== ws) return;
  p.connected = false; p.ws = null;
  room.lastActive = Date.now();              // 빈 방 청소는 마지막 사람이 떠난 때부터 센다

  // 방장이 끊기면 잠깐 기다렸다가 붙어 있는 사람에게 넘긴다 — 판 중이든 끝난 뒤든.
  // 곧바로 넘기면 새로고침 한 번에 방장을 잃는다. 안 넘기면 '시작'·'한 판 더'를 누를 사람이 없다.
  if (room.hostId === p.id) {
    clearTimeout(room.timers.host);
    room.timers.host = setTimeout(safeTimer(() => {
      if (rooms.get(room.code) !== room) return;
      const h = playerOf(room, room.hostId);
      if (h && h.connected) return;
      const next = room.players.find(x => !x.bot && x.connected);
      if (next) { room.hostId = next.id; pushState(room); }
    }), LOBBY_GRACE);
  }

  if (room.phase === 'lobby') {
    // 새로고침·앱 전환은 소켓이 먼저 닫히고 곧바로 다시 붙는다. 그 사이에 자리를 지우면
    // 돌아왔을 때 "자리를 찾을 수 없습니다" 로 쫓겨난다. 잠깐 기다렸다가 그래도 없으면 뺀다.
    clearTimeout(p.leaveT);
    if (!keepSeat) armLeave(room, p);
  }
  pushState(room);
  watchAbsent(room);
}

/** 사람이 다 떠난 방을 치운다. 통신 쪽이 30초마다 부른다.
 *  대기실에 자리만 남은 사람이 있으면(서버가 오래 조작 없는 연결을 닫은 경우) 10분까지 기다려 준다. */
function sweepRooms(now = Date.now()) {
  for (const room of [...rooms.values()]) {
    const humans = room.players.filter(p => !p.bot && p.connected).length;
    const seated = room.phase === 'lobby' && room.players.some(p => !p.bot);
    if (humans === 0 && now - room.lastActive > (seated ? 10 * 60_000 : 90_000)) dropRoom(room);
  }
}

/** 엔진이 어긋나면 게임 도중이 아니라 켤 때 바로 터지게 한다 */
function selfCheck() {
  if (!R || !CK || !AI || !CKAI) throw new Error('규칙 엔진이나 봇을 불러오지 못했습니다');
  for (const eng of [R, CK]) {
    const s = eng.newGame([{ id: 'p1', name: 'a' }, { id: 'p2', name: 'b' }], 1);
    const v = eng.viewFor(s, 'p1');
    if (v.me !== 'p1') throw new Error('viewFor 가 자리를 못 찾습니다');
    const other = v.players.find(p => p.id === 'p2');
    if (other.res || other.dev || other.cardList) throw new Error('viewFor 가 남의 손패를 보여 줍니다');
    if ('devDeck' in v || 'progress' in v || 'seed' in v || 'rnd' in v) throw new Error('viewFor 가 더미나 씨앗을 보여 줍니다');
  }
  console.log(`  기본판 ${R.WIN_VP}점 · 도시와 기사 ${CK.WIN_VP}점 · 최대 ${MAX_PLAYERS}인`);
}

module.exports = {
  rooms, handle, disconnect, sweepRooms, selfCheck,
  MAX_PLAYERS, LOBBY_GRACE, DC_GRACE, FAST, readTime,
};
