'use strict';
/**
 * 서버를 실제로 띄우고 방·판 흐름을 끝까지 돌려 본다 — node test/flow.js
 *  - 서버는 CATAN_FAST=1 로 띄운다. 봇 뜸 · 중계 기다림 · 20초 유예가 전부 짧아진다(유예 300ms).
 *    20초라는 실제 값은 맨 끝에서 game.js 를 FAST 없이 불러 따로 확인한다.
 *  - PORT 를 주면 이미 떠 있는 서버(CATAN_FAST=1 로 띄운 것)에 붙는다 — wrangler dev 시험용.
 *  - 모든 손님이 받은 메시지를 하나하나 숨은 정보 검사(leakCheck)에 건다. 남의 손패 종류 · 발전(진보)카드 ·
 *    한 사람만 볼 기록 줄 · 더미 · 씨앗이 한 번이라도 섞이면 실패다.
 */
const assert = require('assert');
const { spawn } = require('child_process');
const WebSocket = require('ws');
if (typeof self === 'undefined') globalThis.self = globalThis;
require('../rules'); require('../ai'); require('../ck'); require('../ck-ai');
const R = self.Rules, AI = self.AI, CK = self.CK, CKAI = self.CKAI;

const USE_EXISTING = !!process.env.PORT;
const PORT = process.env.PORT || 8878;
const URL = `ws://127.0.0.1:${PORT}/ws`;
const GRACE = 300;                      // game.js 의 FAST 유예
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ─────────────── 숨은 정보 검사 ─────────────── */

const LEAKS = [];
let checkedMsgs = 0, checkedViews = 0;
const FORBIDDEN = ['only', 'rnd', 'seed', 'devDeck', 'progress', 'token', 'ws', 'orderSeed'];
const OWN_ONLY = ['res', 'dev', 'cardList', 'craneReady', 'fleetPick'];
const PRIVATE_LINE = /^(뽑은 카드 — |진보카드를 받았습니다 — |가져온 카드: |가져온 것: |빼앗긴 것: )|(에게서 가져온 것|에게 빼앗긴 것|에게 준 것|가져간 카드): /;

function leakCheck(ws, m) {
  checkedMsgs++;
  const bad = why => LEAKS.push(`${ws.label || '?'} ← ${m.t}: ${why}`);
  if (m.t === 'state') {
    for (const p of m.players || []) {
      const extra = Object.keys(p).filter(k => ['id', 'name', 'bot', 'connected'].indexOf(k) < 0);
      if (extra.length) bad('자리 목록에 ' + extra.join(','));
    }
    const v = m.view;
    if (!v) return;
    checkedViews++;
    if (v.me !== m.you) bad('다른 사람의 시야가 옴 ' + v.me + ' ≠ ' + m.you);
    (function walk(o, path) {
      if (!o || typeof o !== 'object') return;
      for (const k of Object.keys(o)) {
        if (FORBIDDEN.indexOf(k) >= 0) bad('금지된 키 ' + path + '.' + k);
        walk(o[k], path + '.' + k);
      }
    })(v, 'view');
    const baseOpen = v.ext !== 'ck' && v.phase === 'over';   // 기본판은 끝나면 승점 카드까지 전부 공개
    for (const p of v.players) {
      if (p.id === v.me) continue;
      for (const k of OWN_ONLY) if (k in p) bad(`남(${p.name})의 ${k}`);
      if (v.ext !== 'ck' && !baseOpen && ('vpFull' in p || 'vpCards' in p)) bad(`남(${p.name})의 숨은 승점`);
    }
    for (const l of v.log || []) {
      const ks = Object.keys(l).sort().join(',');
      if (ks !== 'i,mine,text') bad('기록 줄 모양이 ' + ks);
      if (PRIVATE_LINE.test(l.text) && !l.mine) bad('남의 비밀 기록 줄: ' + l.text);
    }
  } else {
    const s = JSON.stringify(m);
    for (const k of ['"res":{', '"dev":', '"cardList"', '"devDeck"', '"rnd"', '"seed"']) {
      if (s.indexOf(k) >= 0) bad('판 정보가 ' + m.t + ' 에 섞임 ' + k);
    }
  }
}

/** 같은 방 사람들끼리 — 남이 보는 내 손패 장수가 내 손패와 맞는지 */
function crossCheck(clients) {
  const mine = {};
  for (const c of clients) {
    const v = lastView(c);
    if (!v) continue;
    const me = v.players.find(p => p.id === v.me);
    if (me && me.res) mine[v.me] = Object.values(me.res).reduce((a, b) => a + b, 0);
  }
  for (const c of clients) {
    const v = lastView(c);
    if (!v) continue;
    for (const p of v.players) if (mine[p.id] !== undefined && p.cards !== mine[p.id] && sameTime(clients)) {
      assert.fail(`${c.label} 가 보는 ${p.name} 손패 ${p.cards}장 ≠ 본인 ${mine[p.id]}장`);
    }
  }
}
// 모두가 같은 시점의 시야를 들고 있을 때만 견준다(기록 번호가 같을 때)
function sameTime(clients) {
  const ids = clients.map(c => { const v = lastView(c); return v && v.log.length ? v.log[v.log.length - 1].i : -1; });
  return ids.every(x => x === ids[0]);
}

/* ─────────────── 손님 하나 ─────────────── */

function open(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.inbox = [];
    ws.closed = null;
    ws.label = label;
    ws.on('message', raw => { const m = JSON.parse(raw); leakCheck(ws, m); ws.inbox.push(m); });
    ws.on('close', code => { ws.closed = code; });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
const tx = (ws, obj) => ws.send(JSON.stringify(obj));
/** 조건에 맞는 메시지를 기다린다. from 이후에 온 것만 본다(예전 메시지에 속지 않게). */
async function waitFor(ws, pred, { ms = 6000, from = 0, what = '' } = {}) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (let i = ws.inbox.length - 1; i >= from; i--) if (pred(ws.inbox[i])) return ws.inbox[i];
    await sleep(5);
  }
  throw new Error('기다리던 메시지가 오지 않음 ' + what + ': ' + JSON.stringify(ws.inbox.slice(-2)).slice(0, 500));
}
const lastState = ws => ws.inbox.filter(m => m.t === 'state').pop();
const lastView = ws => { const s = lastState(ws); return s && s.view; };
const mark = ws => ws.inbox.length;

async function create(name, extra = {}) {
  const ws = await open(name);
  tx(ws, Object.assign({ t: 'create', name }, extra));
  const w = await waitFor(ws, m => m.t === 'welcome', { what: '(만들기)' });
  ws.me = w; return ws;
}
async function join(code, name) {
  const ws = await open(name);
  tx(ws, { t: 'join', code, name });
  const w = await waitFor(ws, m => m.t === 'welcome' || m.t === 'err', { what: '(참가)' });
  if (w.t === 'err') throw new Error('참가 거절: ' + w.msg);
  ws.me = w; return ws;
}
async function listRooms() {
  const ws = await open('목록');
  tx(ws, { t: 'rooms' });
  const m = await waitFor(ws, x => x.t === 'rooms');
  ws.close();
  return m.list;
}

/** act 를 보내고 그 결과(새 상태나 거절)를 기다린다 */
async function act(ws, action, args = []) {
  const k = mark(ws);
  tx(ws, { t: 'act', action, args });
  const m = await waitFor(ws, x => x.t === 'state' || x.t === 'err', { from: k, what: `(${ws.label} ${action})` });
  return m;
}

/* ─────────────── 시야로 할 일 고르기 ─────────────── */

const meP = v => v.players.find(p => p.id === v.me);
const isTurn = v => ['roll', 'main', 'robber'].indexOf(v.phase) >= 0 && v.players[v.turn].id === v.me;
function mustAct(v) {
  if (!v || v.phase === 'over' || meP(v).out) return null;
  if (v.trade && v.trade.from !== v.me && !v.trade.replies[v.me]) return 'reply';
  if (v.phase === 'order') {
    const inTie = !v.order.tie || v.order.tie.indexOf(v.me) >= 0;
    return inTie && v.order.rolls[v.me] === undefined ? 'order' : null;
  }
  if (v.phase === 'setup') return v.setup.who === v.me ? 'setup' : null;
  if (v.phase === 'discard') return v.mustDiscard[v.me] ? 'discard' : null;
  return isTurn(v) ? 'turn' : null;
}
function victimsFromView(v, hex) {
  const out = [];
  v.board.hexes[hex].corners.forEach(vi => {
    const b = v.board.verts[vi].b;
    if (!b || b.p === v.me) return;
    const p = v.players.find(q => q.id === b.p);
    if (p && !p.out && p.cards > 0 && out.indexOf(b.p) < 0) out.push(b.p);
  });
  return out;
}
function robberMove(v) {
  const Ai = v.ext === 'ck' ? CKAI : AI;
  let rb = null;
  try { rb = Ai.chooseRobber(v); } catch (_) {}
  const hex = rb && rb.hex != null ? rb.hex : (v.robber + 1) % v.board.hexes.length;
  const cands = victimsFromView(v, hex);
  const victim = cands.length ? (rb && rb.victim && cands.indexOf(rb.victim) >= 0 ? rb.victim : cands[0]) : null;
  return ['moveRobber', [hex, victim]];
}
/** 봇 판단을 빌려 한 수를 고른다. mode: 'play'(봇처럼) · 'hoard'(굴리고 넘기기만 — 손패를 쌓는다) */
function pickMove(v, mode = 'play', failed = false) {
  const ext = v.ext === 'ck', Ai = ext ? CKAI : AI;
  const need = mustAct(v);
  if (need === 'reply') return ['replyTrade', [false]];
  if (need === 'order') return ['rollForOrder', []];
  if (need === 'setup') {
    if (v.setup.sub === 'settlement') { const x = Ai.chooseSetupSettlement(v); return ['placeSettlement', [x != null ? x : v.legal.settlements[0]]]; }
    const e = Ai.chooseSetupRoad(v); return ['placeRoad', [e != null ? e : v.legal.roads[0]]];
  }
  if (need === 'discard') return ['discard', [Ai.chooseDiscard(v, v.mustDiscard[v.me])]];
  if (need !== 'turn') return null;
  if (v.trade && v.trade.from === v.me) return ['cancelTrade', []];
  if (v.phase === 'robber') return robberMove(v);
  if (v.phase === 'roll' && (mode === 'hoard' || failed)) return ['roll', []];
  if (mode === 'hoard' || failed) {
    if (v.freeRoads > 0 && v.legal.roads.length) return ['build', ['road', v.legal.roads[0]]];
    return ['endTurn', []];
  }
  const a = ext ? Ai.act(v, 1, []) : Ai.act(v, 1);
  if (a && a.action !== 'offerTrade') return [a.action, a.args];
  return v.phase === 'roll' ? ['roll', []] : ['endTurn', []];
}

/** 여러 손님이 각자 할 일을 할 때까지 돌린다. until(v 들) 이 참이면 멈춘다. */
async function drive(clients, { until, mode = 'play', max = 3000, what = '' }) {
  const failedOn = new Map();
  for (let step = 0; step < max; step++) {
    if (until && until(clients.map(lastView))) return step;
    let moved = false;
    for (const c of clients) {
      if (c.closed != null) continue;
      const v = lastView(c);
      if (!v || !mustAct(v)) continue;
      const lastI = v.log.length ? v.log[v.log.length - 1].i : -1;
      const key = v.phase + ':' + v.turnCount + ':' + lastI;
      const mv = pickMove(v, typeof mode === 'function' ? mode(c, v) : mode, failedOn.get(c) === key);
      if (!mv) continue;
      const r = await act(c, mv[0], mv[1]);
      if (r.t === 'err') failedOn.set(c, key);
      moved = true;
      if (until && until(clients.map(lastView))) return step;
    }
    if (!moved) await sleep(5);          // 봇 차례 · 다른 사람을 기다리는 중
  }
  throw new Error('drive 가 끝나지 않음 ' + what + ' — ' + JSON.stringify(clients.map(c => { const v = lastView(c); return v && [v.phase, v.turnCount]; })));
}

/* ─────────────── 시나리오 ─────────────── */

let pass = 0;
async function step(name, fn) {
  const t0 = Date.now();
  await fn();
  pass++;
  console.log(`  ✓ ${name}  (${Date.now() - t0}ms)`);
}

async function scenarios() {
  let a, b, code, idA, idB;

  await step('두 사람이 방을 만들고 들어온다', async () => {
    a = await create('방장');
    code = a.me.code;
    assert.match(code, /^[A-Z2-9]{4}$/);
    b = await join(code, '민수');
    idA = a.me.you; idB = b.me.you;
    const s = await waitFor(a, m => m.t === 'state' && m.players.length === 2);
    assert.strictEqual(s.phase, 'lobby');
    assert.strictEqual(s.hostId, idA);
    assert.strictEqual(s.view, null, '대기실인데 판 시야가 옴');
    assert.strictEqual(s.cfg.ext, false, '기본판이 기본값이어야 함');
    await waitFor(a, m => m.t === 'ev' && m.kind === 'joined' && m.name === '민수');
  });

  await step('같은 이름으로 들어오면 뒤에 숫자가 붙는다', async () => {
    const c = await join(code, '민수');
    const s = await waitFor(c, m => m.t === 'state' && m.players.length === 3);
    assert.ok(s.players.some(p => p.name === '민수2'), JSON.stringify(s.players.map(p => p.name)));
    const k = mark(a);
    tx(c, { t: 'leave' });
    await waitFor(c, m => m.t === 'left');
    await waitFor(a, m => m.t === 'state' && m.players.length === 2, { from: k });
    c.close();
  });

  await step('채팅이 같은 방 모두에게 간다(보낸 사람 포함)', async () => {
    tx(b, { t: 'chat', text: '  안녕하세요  ' });
    const c1 = await waitFor(a, m => m.t === 'chat');
    assert.strictEqual(c1.text, '안녕하세요');
    assert.strictEqual(c1.name, '민수');
    assert.strictEqual(c1.from, idB);
    await waitFor(b, m => m.t === 'chat');
  });

  await step('방장이 아니면 시작 · 봇 추가 · 설정을 못 한다', async () => {
    const k = mark(a);
    tx(b, { t: 'start' }); tx(b, { t: 'addBot' }); tx(b, { t: 'cfg', priv: true, ext: true });
    await sleep(150);
    assert.ok(!a.inbox.slice(k).some(m => m.t === 'state'), '방장 아닌 사람의 조작이 먹힘');
  });

  await step('비공개 방은 열린 방 목록에 안 보인다', async () => {
    let list = await listRooms();
    const row = list.find(r => r.code === code);
    assert.ok(row, '공개 방이 목록에 없음');
    assert.strictEqual(row.ext, false);
    const k = mark(a);
    tx(a, { t: 'cfg', priv: true });
    await waitFor(a, m => m.t === 'state' && m.cfg.priv === true, { from: k });
    list = await listRooms();
    assert.ok(!list.some(r => r.code === code), '비공개로 바꿨는데 목록에 보임');
    const p = await create('숨은방', { priv: true });
    list = await listRooms();
    assert.ok(!list.some(r => r.code === p.me.code), '비공개로 만든 방이 목록에 보임');
    tx(p, { t: 'leave' }); await waitFor(p, m => m.t === 'left'); p.close();
    tx(a, { t: 'cfg', priv: false });
    await waitFor(a, m => m.t === 'state' && m.cfg.priv === false);
  });

  await step('판 종류 · 봇 실력은 방 설정이다', async () => {
    let k = mark(a);
    tx(a, { t: 'cfg', ext: true, skill: 1 });
    await waitFor(a, m => m.t === 'state' && m.cfg.ext === true && m.cfg.skill === 1, { from: k });
    assert.ok((await listRooms()).find(r => r.code === code).ext, '목록에 확장판 표시가 없음');
    tx(a, { t: 'cfg', skill: 7 });          // 없는 값은 무시
    await sleep(80);
    assert.strictEqual(lastState(a).cfg.skill, 1);
    k = mark(a);
    tx(a, { t: 'cfg', ext: false, skill: 0.75 });
    await waitFor(a, m => m.t === 'state' && m.cfg.ext === false && m.cfg.skill === 0.75, { from: k });
  });

  await step('기본판을 시작하면 사람마다 자기 시야를 받는다', async () => {
    const k = mark(a), kb = mark(b);
    tx(a, { t: 'start' });
    const sa = await waitFor(a, m => m.t === 'state' && m.phase === 'playing', { from: k });
    const sb = await waitFor(b, m => m.t === 'state' && m.phase === 'playing', { from: kb });
    assert.strictEqual(sa.view.me, idA);
    assert.strictEqual(sb.view.me, idB);
    assert.ok(!sa.view.ext, '기본판인데 확장판 시야');
    assert.strictEqual(sa.view.phase, 'order');
    assert.ok(meP(sa.view).res, '내 손패가 안 보임');
    assert.ok(!sa.view.players.find(p => p.id === idB).res, '남의 손패가 보임');
  });

  await step('남의 차례 · 없는 행동 · 이상한 인자는 거절한다', async () => {
    let r = await act(a, 'roll');
    assert.strictEqual(r.t, 'err');
    r = await act(a, 'placeSettlement', [{ __proto__: 1 }]);
    assert.strictEqual(r.t, 'err');
    const k = mark(a);
    tx(a, { t: 'act', action: 'newGame', args: [] });     // 목록에 없는 행동은 아예 무시
    tx(a, { t: 'act', action: 'develop', args: [] });     // 기본판 엔진에 없는 행동도 무시
    await sleep(80);
    assert.ok(!a.inbox.slice(k).some(m => m.t === 'state'));
  });

  await step('순서 주사위를 둘 다 굴리면 준비 단계로 넘어간다', async () => {
    await drive([a, b], { until: vs => vs.every(v => v.phase !== 'order'), what: '(순서)' });
    const v = lastView(a);
    assert.strictEqual(v.phase, 'setup');
    assert.ok(v.order.first === idA || v.order.first === idB);
  });

  await step('초기 배치 두 바퀴 — 마을과 도로를 둘씩 놓고, 남의 자리 차례에는 거절된다', async () => {
    const v = lastView(a);
    const other = v.setup.who === idA ? b : a;
    const r = await act(other, 'placeSettlement', [lastView(other).legal.settlements[0]]);
    assert.strictEqual(r.t, 'err');
    await drive([a, b], { until: vs => vs.every(x => x.phase !== 'setup'), what: '(준비)' });
    const va = lastView(a);
    assert.strictEqual(va.phase, 'roll');
    for (const p of va.players) {
      const n = va.board.verts.filter(x => x.b && x.b.p === p.id).length;
      const roads = va.board.edges.filter(e => e.road === p.id).length;
      assert.strictEqual(n, 2, p.name + ' 마을이 ' + n);
      assert.strictEqual(roads, 2, p.name + ' 도로가 ' + roads);
    }
    crossCheck([a, b]);
  });

  await step('주사위를 굴리면 모두가 같은 눈을 본다', async () => {
    const v = lastView(a);
    const who = v.players[v.turn].id === idA ? a : b;
    const r = await act(who, 'roll');
    assert.strictEqual(r.t, 'state');
    await sleep(30);
    const da = lastView(a).dice, db = lastView(b).dice;
    assert.ok(da && da.length >= 2);
    assert.deepStrictEqual(da, db);
  });

  await step('차례대로 두다 보면 건설이 서버에서 받아들여진다', async () => {
    const roads0 = lastView(a).board.edges.filter(e => e.road).length;
    const setl0 = lastView(a).board.verts.filter(x => x.b).length;
    await drive([a, b], {
      until: vs => vs[0].board.edges.filter(e => e.road).length > roads0 || vs[0].board.verts.filter(x => x.b).length > setl0,
      max: 4000, what: '(건설)',
    });
    crossCheck([a, b]);
  });

  /** 사람 둘 사이 거래를 할 수 있는 순간까지 굴리고 넘기기만 한다 — 제안자가 줄 것, 상대가 낼 것이 있어야 */
  function tradePlan(clients) {
    for (const c of clients) {
      const v = lastView(c);
      if (!v || v.phase !== 'main' || !isTurn(v) || v.trade) continue;
      const mine = meP(v).res;
      for (const d of clients) {
        if (d === c) continue;
        const theirs = meP(lastView(d)).res;
        const give = R.RES.find(x => mine[x] > 0);
        const want = R.RES.find(x => x !== give && theirs[x] > 0);
        if (give && want) return { from: c, to: d, give, want };
      }
    }
    return null;
  }
  const hoardUntilTrade = clients => ({ until: () => !!tradePlan(clients), mode: 'hoard', max: 4000, what: '(거래 준비)' });

  await step('사람끼리 거래 — 제안 · 거절과 제안 거두기', async () => {
    await drive([a, b], hoardUntilTrade([a, b]));
    const plan = tradePlan([a, b]);
    let r = await act(plan.to, 'offerTrade', [{ [plan.give]: 1 }, { [plan.want]: 1 }]);
    assert.strictEqual(r.t, 'err', '차례가 아닌 사람의 제안이 먹힘');
    r = await act(plan.from, 'offerTrade', [{ [plan.give]: 1 }, { [plan.give]: 1 }]);
    assert.strictEqual(r.t, 'err', '같은 자원 맞바꾸기가 먹힘');
    r = await act(plan.from, 'offerTrade', [{ [plan.give]: 1 }, { [plan.want]: 1 }]);
    assert.strictEqual(r.t, 'state', r.msg);
    const t = (await waitFor(plan.to, m => m.t === 'state' && m.view && m.view.trade)).view.trade;
    assert.strictEqual(t.from, plan.from.me.you);
    r = await act(plan.from, 'replyTrade', [true]);
    assert.strictEqual(r.t, 'err', '제안자가 자기 제안에 답함');
    r = await act(plan.to, 'replyTrade', [false]);
    assert.strictEqual(r.t, 'state');
    r = await act(plan.from, 'acceptTrade', [plan.to.me.you]);
    assert.strictEqual(r.t, 'err', '거절한 사람과 성사됨');
    r = await act(plan.from, 'cancelTrade');
    assert.strictEqual(r.t, 'state');
    await waitFor(plan.to, m => m.t === 'state' && m.view && !m.view.trade);
  });

  await step('사람끼리 거래 — 제안 · 수락 · 제안자가 골라 성사, 두 사람 손패가 맞게 바뀐다', async () => {
    await drive([a, b], hoardUntilTrade([a, b]));
    const plan = tradePlan([a, b]);
    const before = { f: Object.assign({}, meP(lastView(plan.from)).res), t: Object.assign({}, meP(lastView(plan.to)).res) };
    let r = await act(plan.from, 'offerTrade', [{ [plan.give]: 1 }, { [plan.want]: 1 }]);
    assert.strictEqual(r.t, 'state', r.msg);
    await waitFor(plan.to, m => m.t === 'state' && m.view && m.view.trade);
    r = await act(plan.to, 'replyTrade', [true]);
    assert.strictEqual(r.t, 'state', r.msg);
    await waitFor(plan.from, m => m.t === 'state' && m.view && m.view.trade && m.view.trade.replies[plan.to.me.you] === 'yes');
    r = await act(plan.to, 'acceptTrade', [plan.to.me.you]);
    assert.strictEqual(r.t, 'err', '제안자 아닌 사람이 성사시킴');
    r = await act(plan.from, 'acceptTrade', [plan.to.me.you]);
    assert.strictEqual(r.t, 'state', r.msg);
    const vt = (await waitFor(plan.to, m => m.t === 'state' && m.view && !m.view.trade && m.view.lastTrade)).view;
    const vf = lastView(plan.from);
    const af = meP(vf).res, at = meP(vt).res;
    assert.strictEqual(af[plan.give], before.f[plan.give] - 1);
    assert.strictEqual(af[plan.want], before.f[plan.want] + 1);
    assert.strictEqual(at[plan.give], before.t[plan.give] + 1);
    assert.strictEqual(at[plan.want], before.t[plan.want] - 1);
    assert.ok(vf.log.some(l => /거래 성사/.test(l.text)));
    crossCheck([a, b]);
  });

  await step('7이 나오면 둘이 동시에 버리고, 굴린 사람이 도둑을 옮겨 한 장을 가져간다', async () => {
    // 굴리고 넘기기만 해서 손패를 쌓는다. 둘 다 8장 이상일 때 7이 나오면 둘이 함께 버리는 단계가 된다.
    let both = false;
    await drive([a, b], {
      mode: 'hoard', max: 20000, what: '(7 기다리기)',
      until: vs => {
        const v = vs[0];
        if (v.phase === 'discard' && Object.keys(v.mustDiscard).length === 2) { both = true; return true; }
        return false;
      },
    });
    assert.ok(both);
    const va = lastView(a), vb = lastView(b);
    const needA = va.mustDiscard[idA], needB = vb.mustDiscard[idB];
    const cardsA = R.handCount(meP(va)), cardsB = R.handCount(meP(vb));
    assert.strictEqual(needA, Math.floor(cardsA / 2));
    // 둘이 거의 동시에 보낸다 — 서버가 차례대로 받아 둘 다 반영해야 한다
    const ka = mark(a), kb = mark(b);
    tx(a, { t: 'act', action: 'discard', args: [AI.chooseDiscard(va, needA)] });
    tx(b, { t: 'act', action: 'discard', args: [AI.chooseDiscard(vb, needB)] });
    const s2 = await waitFor(a, m => m.t === 'state' && m.view && m.view.phase === 'robber', { from: ka, what: '(둘 다 버림)' });
    assert.ok(!a.inbox.slice(ka).some(m => m.t === 'err') && !b.inbox.slice(kb).some(m => m.t === 'err'), '버리기가 거절됨');
    assert.strictEqual(R.handCount(meP(s2.view)), cardsA - needA);
    await sleep(30);
    assert.strictEqual(R.handCount(meP(lastView(b))), cardsB - needB);
    // 도둑 — 굴린 사람이 상대 마을이 닿은 칸으로 옮긴다
    const v = lastView(a);
    const thief = v.players[v.turn].id === idA ? a : b, victim = thief === a ? b : a;
    const tv = lastView(thief), vid = victim.me.you;
    const hex = tv.board.hexes.findIndex((h, i) => i !== tv.robber && victimsFromView(tv, i).indexOf(vid) >= 0);
    assert.ok(hex >= 0, '상대에게 닿은 칸이 없음');
    const vcards = lastView(victim).players.find(p => p.id === vid).cards;
    const logAt = lastView(thief).log.slice(-1)[0].i;
    const r = await act(thief, 'moveRobber', [hex, vid]);
    assert.strictEqual(r.t, 'state', r.msg);
    const after = await waitFor(victim, m => m.t === 'state' && m.view && m.view.robber === hex);
    assert.strictEqual(R.handCount(meP(after.view)), vcards - 1);
    // 무슨 카드인지는 두 사람에게만 — 이번 강탈로 새로 생긴 줄에서 각자 자기 것만 받는다
    const fresh = v2 => v2.log.filter(l => l.i > logAt);
    assert.ok(fresh(lastView(thief)).some(l => /^가져온 것: /.test(l.text) && l.mine), '훔친 사람이 무슨 카드인지 모름');
    assert.ok(fresh(after.view).some(l => /^빼앗긴 것: /.test(l.text) && l.mine), '뺏긴 사람이 무슨 카드인지 모름');
    assert.ok(!fresh(lastView(thief)).some(l => /^빼앗긴 것: /.test(l.text)), '훔친 사람이 뺏긴 사람 줄을 받음');
    assert.ok(!fresh(after.view).some(l => /^가져온 것: /.test(l.text)), '뺏긴 사람이 훔친 사람 줄을 받음');
    crossCheck([a, b]);
  });

  await step('새로고침(resume)하면 같은 자리 · 같은 시야로 돌아오고 옛 탭은 4001', async () => {
    const before = lastView(b);
    const b2 = await open('민수(새 탭)');
    tx(b2, { t: 'resume', code, token: b.me.token });
    const w = await waitFor(b2, m => m.t === 'welcome');
    assert.strictEqual(w.you, idB);
    const s = await waitFor(b2, m => m.t === 'state' && m.phase === 'playing');
    assert.strictEqual(s.view.me, idB);
    assert.deepStrictEqual(meP(s.view).res, meP(lastView(b)).res, '돌아왔는데 손패가 다름');
    assert.ok(s.view.log[s.view.log.length - 1].i >= before.log[before.log.length - 1].i);
    await waitFor(b, m => m.t === 'moved');
    const end = Date.now() + 2000;
    while (b.closed == null && Date.now() < end) await sleep(10);
    assert.strictEqual(b.closed, 4001);
    await sleep(60);
    assert.strictEqual(lastState(a).players.find(p => p.id === idB).connected, true, '새 소켓이 붙어 있는데 끊긴 걸로 표시됨');
    b2.me = Object.assign({}, b.me, w);
    b = b2;
  });

  await step('틀린 자리표로는 돌아올 수 없고, 시작된 방에는 못 들어간다', async () => {
    const x = await open('낯선이');
    tx(x, { t: 'resume', code, token: 'nope' });
    const e = await waitFor(x, m => m.t === 'err');
    assert.strictEqual(e.fatal, true);
    tx(x, { t: 'join', code, name: '늦음' });
    const e2 = await waitFor(x, m => m.t === 'err' && !m.fatal);
    assert.strictEqual(e2.msg, '이미 시작된 방입니다.');
    x.close();
  });

  await step('방장이 끊기면 유예 뒤 남은 사람에게 넘어가고, 판은 이어진다', async () => {
    // b 차례에 끊겨야 판이 곧바로 끝나지 않는다
    await drive([a, b], { mode: 'hoard', until: vs => isTurn(vs[1]) && vs[1].phase === 'roll', what: '(b 차례까지)' });
    const k = mark(b);
    a.close();
    await sleep(GRACE / 3);
    assert.strictEqual(lastState(b).hostId, idA, '유예 전에 방장이 넘어감');
    const s = await waitFor(b, m => m.t === 'state' && m.hostId === idB, { from: k, ms: 3000 });
    assert.strictEqual(s.phase, 'playing');
    assert.ok(!s.view.players.find(p => p.id === idA).out, '차례도 아닌데 판에서 빠짐');
  });

  await step('끊긴 사람 차례가 오면 유예 뒤 판에서 빠지고, 남은 사람이 이긴다', async () => {
    await act(b, 'roll');
    await drive([b], { mode: 'hoard', until: vs => !isTurn(vs[0]) || vs[0].phase === 'over', what: '(b 차례 끝)' });
    const s = await waitFor(b, m => m.t === 'state' && m.phase === 'over', { ms: 4000, what: '(끊긴 사람 빠짐)' });
    assert.ok(s.view.players.find(p => p.id === idA).out, '끊긴 사람이 빠지지 않음');
    assert.strictEqual(s.view.winner, idB);
    await waitFor(b, m => m.t === 'ev' && m.kind === 'dropped');
  });

  await step('끝난 뒤 방장이 한 판 더를 누르면 대기실로 돌아가고, 끊긴 자리는 비워진다', async () => {
    const k = mark(b);
    tx(b, { t: 'again' });
    await waitFor(b, m => m.t === 'state' && m.phase === 'lobby', { from: k });
    const s = await waitFor(b, m => m.t === 'state' && m.phase === 'lobby' && m.players.length === 1, { from: k, ms: 3000 });
    assert.strictEqual(s.view, null);
    tx(b, { t: 'leave' }); await waitFor(b, m => m.t === 'left'); b.close();
  });

  /* ── 셋이 하는 판 — 여러 사람이 동시에 끼는 거래 ── */
  let h, d, e;
  await step('셋이 거래 — 한 사람은 받고 한 사람은 거절, 제안자가 받은 사람과 성사', async () => {
    h = await create('하나'); d = await join(h.me.code, '둘'); e = await join(h.me.code, '셋');
    await waitFor(h, m => m.t === 'state' && m.players.length === 3);
    tx(h, { t: 'start' });
    await waitFor(e, m => m.t === 'state' && m.phase === 'playing');
    const all = [h, d, e];
    await drive(all, { until: vs => vs.every(v => v.phase === 'roll' || v.phase === 'main'), what: '(셋 준비)' });
    await drive(all, hoardUntilTrade(all));
    const plan = tradePlan(all);
    const third = all.find(c => c !== plan.from && c !== plan.to);
    // 셋째가 낼 수 없는 자원이면 거절만 한다 — 둘 다 받을 수 있어도 상관없다
    let r = await act(plan.from, 'offerTrade', [{ [plan.give]: 1 }, { [plan.want]: 1 }]);
    assert.strictEqual(r.t, 'state', r.msg);
    await waitFor(plan.to, m => m.t === 'state' && m.view && m.view.trade);
    await waitFor(third, m => m.t === 'state' && m.view && m.view.trade);
    // 두 사람이 동시에 답한다
    const kf = mark(plan.from);
    tx(plan.to, { t: 'act', action: 'replyTrade', args: [true] });
    tx(third, { t: 'act', action: 'replyTrade', args: [false] });
    const st = await waitFor(plan.from, m => m.t === 'state' && m.view && m.view.trade &&
      Object.keys(m.view.trade.replies).length === 2, { from: kf, what: '(두 대답)' });
    assert.strictEqual(st.view.trade.replies[plan.to.me.you], 'yes');
    assert.strictEqual(st.view.trade.replies[third.me.you], 'no');
    r = await act(plan.from, 'acceptTrade', [third.me.you]);
    assert.strictEqual(r.t, 'err', '거절한 사람과 성사됨');
    r = await act(plan.from, 'acceptTrade', [plan.to.me.you]);
    assert.strictEqual(r.t, 'state', r.msg);
    assert.ok(!r.view.trade && r.view.lastTrade && r.view.lastTrade.b === plan.to.me.you);
    await sleep(30);
    crossCheck(all);
  });

  await step('거래 창이 떠 있는 동안 끊긴 사람은 유예 뒤 거절로 대신 답하고, 판에서는 빠지지 않는다', async () => {
    const all = [h, d, e];
    await drive(all, hoardUntilTrade(all));
    const plan = tradePlan(all);
    const third = all.find(c => c !== plan.from && c !== plan.to);
    const idT = third.me.you;
    third.close();
    await sleep(50);
    let r = await act(plan.from, 'offerTrade', [{ [plan.give]: 1 }, { [plan.want]: 1 }]);
    assert.strictEqual(r.t, 'state', r.msg);
    await act(plan.to, 'replyTrade', [false]);
    const s = await waitFor(plan.from, m => m.t === 'state' && m.view && m.view.trade && m.view.trade.replies[idT] === 'no',
      { ms: 3000, what: '(끊긴 사람 대신 거절)' });
    assert.ok(!s.view.players.find(p => p.id === idT).out, '거래 대답만 남은 사람이 판에서 빠짐');
    await act(plan.from, 'cancelTrade');
    // 끊긴 사람이 돌아온다
    const back = await open('셋(돌아옴)');
    tx(back, { t: 'resume', code: h.me.code, token: third.me.token });
    await waitFor(back, m => m.t === 'state' && m.view);
    back.me = third.me;
    all[all.indexOf(third)] = back;
    if (third === h) h = back; else if (third === d) d = back; else e = back;
  });

  await step('제안자가 거래 창을 띄운 채 나가면 제안이 걷히고 남은 사람끼리 이어 간다', async () => {
    const all = [h, d, e];
    await drive(all, hoardUntilTrade(all));
    const plan = tradePlan(all);
    const rest = all.filter(c => c !== plan.from);
    let r = await act(plan.from, 'offerTrade', [{ [plan.give]: 1 }, { [plan.want]: 1 }]);
    assert.strictEqual(r.t, 'state', r.msg);
    await act(plan.to, 'replyTrade', [true]);
    const k = mark(rest[0]);
    tx(plan.from, { t: 'leave' });
    await waitFor(plan.from, m => m.t === 'left');
    const s = await waitFor(rest[0], m => m.t === 'state' && m.players.length === 2, { from: k });
    assert.strictEqual(s.view.trade, null, '나간 사람의 제안이 남음');
    assert.ok(s.view.players.find(p => p.id === plan.from.me.you).out);
    assert.strictEqual(s.phase, 'playing');
    assert.ok(rest.some(c => isTurn(lastView(c))), '나간 사람 다음 차례로 안 넘어감');
    await drive(rest, { mode: 'hoard', until: vs => vs.every(v => v.turnCount >= s.view.turnCount + 2), what: '(남은 둘)' });
    crossCheck(rest);
    rest.forEach(c => c.close()); plan.from.close();
  });

  await step('순서를 정할 때 끊긴 사람은 유예 뒤 빠지고 남은 사람이 준비로 넘어간다', async () => {
    const x = await create('남음'); const y = await join(x.me.code, '끊김'); const z = await join(x.me.code, '셋째');
    await waitFor(x, m => m.t === 'state' && m.players.length === 3);
    tx(x, { t: 'start' });
    await waitFor(y, m => m.t === 'state' && m.phase === 'playing');
    y.close();
    // 남은 둘은 굴렸는데 끊긴 사람이 안 굴려 멈춰 있다 — 유예 뒤 그 사람이 빠지고 넘어간다(동점이면 다시 굴린다)
    await drive([x, z], { until: vs => vs.every(v => v.phase !== 'order'), max: 2000, what: '(순서 중 빠짐)' });
    const s = lastState(x);
    assert.strictEqual(s.view.phase, 'setup');
    assert.ok(s.view.players.find(p => p.id === y.me.you).out);
    await waitFor(x, m => m.t === 'ev' && m.kind === 'dropped');
    x.close(); z.close();
  });

  await step('7에 버려야 하는 사람이 끊겨 있으면 유예 뒤 빠지고, 도둑 단계로 넘어간다', async () => {
    const x = await create('버림1'); const y = await join(x.me.code, '버림2'); const z = await join(x.me.code, '버림3');
    await waitFor(x, m => m.t === 'state' && m.players.length === 3);
    tx(x, { t: 'start' });
    const all = [x, y, z];
    await waitFor(z, m => m.t === 'state' && m.phase === 'playing');
    await drive(all, { until: vs => vs.every(v => v.phase === 'roll' || v.phase === 'main'), what: '(준비)' });
    // 버려야 하는 사람이 생길 때까지 쌓는다 — 그 사람이 굴린 사람이 아니면 끊는다
    let gone = null;
    await drive(all, {
      mode: 'hoard', max: 20000, what: '(버리기 기다림)',
      until: vs => {
        const v = vs[0];
        if (v.phase !== 'discard') return false;
        const roller = v.players[v.turn].id;
        const who = Object.keys(v.mustDiscard).find(id => id !== roller);
        if (!who) return false;
        gone = all.find(c => c.me.you === who);
        return true;
      },
    });
    gone.close();
    const rest = all.filter(c => c !== gone);
    // 남은 사람들은 버릴 것만 버린다
    await drive(rest, { until: vs => vs[0].phase !== 'discard', what: '(남은 사람 버림)', max: 200 });
    const s = lastView(rest[0]);
    assert.ok(s.players.find(p => p.id === gone.me.you).out, '끊긴 사람이 빠지지 않음');
    assert.ok(s.phase === 'robber' || s.phase === 'main', '도둑 단계로 안 넘어감: ' + s.phase);
    rest.forEach(c => c.close());
  });

  await step('도시와 기사로 시작해서 몇 차례 둔다', async () => {
    const x = await create('확장', { ext: true });
    const y = await join(x.me.code, '기사');
    await waitFor(x, m => m.t === 'state' && m.players.length === 2 && m.cfg.ext === true);
    tx(x, { t: 'start' });
    const s = await waitFor(y, m => m.t === 'state' && m.phase === 'playing');
    assert.strictEqual(s.view.ext, 'ck');
    assert.ok(meP(s.view).cardList, '내 진보카드 목록이 안 옴');
    assert.ok(!s.view.players.find(p => p.id === x.me.you).cardList, '남의 진보카드가 보임');
    const k = mark(x);
    tx(x, { t: 'act', action: 'playDev', args: ['knight', []] });   // 확장판 엔진에 없는 행동 — 말없이 무시된다
    await sleep(80);
    assert.ok(!x.inbox.slice(k).some(m => m.t === 'state' || m.t === 'err'), '확장판에 없는 행동이 먹힘');
    await drive([x, y], { until: vs => vs.every(v => v.turnCount >= 6) || vs[0].phase === 'over', max: 6000, what: '(확장판)' });
    const v = lastView(x);
    assert.ok(v.barb !== undefined, '야만족 표시가 없음');
    for (const p of v.players) assert.ok(v.board.verts.some(q => q.b && q.b.p === p.id));
    crossCheck([x, y]);
    x.close(); y.close();
  });

  async function soloVsBots(ext) {
    const h1 = await create(ext ? '혼자확장' : '혼자온라인', { ext });
    for (let i = 0; i < 3; i++) tx(h1, { t: 'addBot' });
    await waitFor(h1, m => m.t === 'state' && m.players.length === 4);
    tx(h1, { t: 'addBot' });                    // 다섯 번째는 거절
    await waitFor(h1, m => m.t === 'err' && /자리/.test(m.msg));
    tx(h1, { t: 'start' });
    await waitFor(h1, m => m.t === 'state' && m.phase === 'playing');
    let moves = 0;
    await drive([h1], {
      until: vs => { moves++; return vs[0].phase === 'over'; },
      max: 200000, what: ext ? '(확장판 봇 판)' : '(봇 판)',
    });
    const v = lastView(h1);
    const E = ext ? CK : R;
    const top = v.players.slice().sort((p, q) => (q.vpFull || q.vp) - (p.vpFull || p.vp))[0];
    assert.ok(v.winner, '승자가 없음');
    const w = v.players.find(p => p.id === v.winner);
    assert.ok((w.vpFull || w.vp) >= E.WIN_VP || v.players.filter(p => !p.out).length <= 1,
      `${E.WIN_VP}점 없이 끝남: ${w.name} ${w.vpFull || w.vp}`);
    assert.ok(!v.players.some(p => p.out), '봇이 막혀서 빠짐');
    console.log(`      ${v.turnCount}번째 차례 · 승자 ${w.name} ` + v.players.map(p => `${p.name} ${p.vpFull != null ? p.vpFull : p.vp}`).join(' / ') +
      ` (최고 ${top.name})`);
    h1.close();
  }

  await step('사람 하나 + 봇 셋으로 기본판 한 판을 끝까지 둔다', () => soloVsBots(false));
  await step('사람 하나 + 봇 셋으로 도시와 기사 한 판을 끝까지 둔다', () => soloVsBots(true));

  await step('ping 은 아무 일도 일으키지 않는다 · 빈 메시지는 무시한다', async () => {
    const x = await open('핑');
    tx(x, { t: 'ping' }); x.send('not json'); tx(x, { nope: 1 }); tx(x, { t: 'act' });
    await sleep(150);
    assert.strictEqual(x.inbox.length, 0);
    x.close();
  });

  await step(`숨은 정보가 새지 않았다 — 메시지 ${checkedMsgs}개 전부 검사`, async () => {
    assert.ok(checkedViews > 500, '검사한 시야가 너무 적음: ' + checkedViews);
    assert.deepStrictEqual(LEAKS.slice(0, 10), [], '숨은 정보가 샘');
  });
}

(async () => {
  let srv = { kill() {} };
  let stderr = '';
  if (!USE_EXISTING) {
    srv = spawn(process.execPath, [require.resolve('../server.js')], {
      env: Object.assign({}, process.env, { PORT: String(PORT), CATAN_FAST: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    srv.stderr.on('data', d => { stderr += d; process.stderr.write(d); });
    await new Promise((r, j) => {
      srv.stdout.on('data', d => { if (String(d).includes('카탄 서버')) r(); });
      srv.on('exit', c => j(new Error('서버가 뜨지 않음 ' + c)));
    });
  }
  console.log('카탄 서버 흐름 → ' + URL);
  try {
    await scenarios();
    console.log(`      (검사한 메시지 ${checkedMsgs}개 · 그중 판 시야 ${checkedViews}개 · 샌 것 ${LEAKS.length}개)`);
    // 실제 값 — FAST 없이 불러서 유예가 20초인지 본다
    delete process.env.CATAN_FAST;
    const g = require('../game');
    assert.strictEqual(g.FAST, false);
    assert.strictEqual(g.LOBBY_GRACE, 20000, '방장 넘기기 유예가 20초가 아님');
    assert.strictEqual(g.DC_GRACE, 20000);
    assert.ok(g.readTime('봇 하나 도시 — 2점을 올렸습니다') > 1300);
    pass++; console.log('  ✓ 실제 유예는 20초, 중계 한 줄 읽는 시간은 글자 수만큼');

    assert.strictEqual(stderr.trim(), '', '서버가 오류를 뱉음');
    console.log(`\n통과 ${pass}\n`);
    srv.kill();
    process.exit(0);
  } catch (e) {
    console.error('\n실패:', e.stack || e.message, '\n');
    if (LEAKS.length) console.error('샌 것:', LEAKS.slice(0, 10));
    srv.kill();
    process.exit(1);
  }
})();
