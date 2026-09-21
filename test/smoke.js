'use strict';
/**
 * 떠 있는 서버에 붙어서 한 판의 뼈대를 확인한다 — 어느 서버든 주소만 주면 된다.
 *   node test/smoke.js http://127.0.0.1:8878          (node server.js)
 *   node test/smoke.js http://127.0.0.1:8879          (wrangler dev)
 *   node test/smoke.js https://catan.xxx.workers.dev  (배포본)
 * 화면 파일(심볼릭 링크로 둔 rules.js · ai.js · ck.js · ck-ai.js 포함) · 상태 확인 · 방 만들기 · 들어가기 ·
 * 채팅 · 열린 방 목록과 비공개 방 · 시작해서 순서 주사위 · 남의 손패가 안 보이는지 · 확장판 방 ·
 * 새로고침(resume)까지. IDLE=1 을 주면 조작 없는 소켓이 4000 으로 닫히는지도 본다
 * (서버를 IDLE_MS 를 줄여 띄웠을 때만).
 */
const assert = require('assert');
const WebSocket = require('ws');

const BASE = (process.argv[2] || 'http://127.0.0.1:8878').replace(/\/$/, '');
const WS = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    ws.inbox = [];
    ws.closed = null;
    ws.on('message', raw => ws.inbox.push(JSON.parse(raw)));
    ws.on('close', code => { ws.closed = code; });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
const tx = (ws, obj) => ws.send(JSON.stringify(obj));
async function waitFor(ws, pred, ms = 6000, what = '') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (let i = ws.inbox.length - 1; i >= 0; i--) if (pred(ws.inbox[i])) return ws.inbox[i];
    await sleep(25);
  }
  throw new Error('기다리던 메시지가 오지 않음 ' + what + ': ' + JSON.stringify(ws.inbox.slice(-2)).slice(0, 300));
}
async function rooms() {
  const ws = await open();
  tx(ws, { t: 'rooms' });
  const m = await waitFor(ws, x => x.t === 'rooms');
  ws.close();
  return m.list;
}

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message); }
}

(async () => {
  console.log('카탄 연결 확인 → ' + BASE);
  let a, b, code, tokenB, idA, idB;

  await check('화면 파일이 나온다', async () => {
    const html = await fetch(BASE + '/').then(r => r.text());
    assert.ok(html.includes('카탄') && html.includes('app.js'), 'index.html 이 아님');
    assert.ok(!/peerjs|net\.js/.test(html), '옛 PeerJS 스크립트가 남아 있음');
    for (const f of ['/style.css', '/app.js', '/img/back.webp']) {
      const r = await fetch(BASE + f);
      assert.strictEqual(r.status, 200, f + ' ' + r.status);
    }
  });

  await check('규칙 엔진 · 봇 파일이 루트 원본 그대로 나온다 (심볼릭 링크)', async () => {
    const fs = require('fs'), path = require('path');
    for (const f of ['rules.js', 'ai.js', 'ck.js', 'ck-ai.js']) {
      const r = await fetch(BASE + '/' + f);
      assert.strictEqual(r.status, 200, f + ' ' + r.status);
      const body = await r.text();
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      assert.strictEqual(body, src, f + ' 내용이 루트 원본과 다름');
    }
  });

  await check('상태 확인', async () => {
    const h = await fetch(BASE + '/healthz').then(r => r.json());
    assert.strictEqual(h.ok, true);
    assert.strictEqual(typeof h.rooms, 'number');
    assert.strictEqual(typeof h.sockets, 'number');
  });

  await check('방 만들기 · 들어가기', async () => {
    a = await open();
    tx(a, { t: 'create', name: '방장' });
    const w = await waitFor(a, m => m.t === 'welcome');
    code = w.code; idA = w.you;
    b = await open();
    tx(b, { t: 'join', code, name: '민수' });
    const wb = await waitFor(b, m => m.t === 'welcome');
    tokenB = wb.token; idB = wb.you;
    const s = await waitFor(a, m => m.t === 'state' && m.players.length === 2);
    assert.strictEqual(s.phase, 'lobby');
    assert.strictEqual(s.cfg.ext, false);
  });

  await check('ping 은 아무 일도 일으키지 않는다', async () => {
    const n = a.inbox.length;
    tx(a, { t: 'ping' });
    await sleep(300);
    assert.strictEqual(a.inbox.length, n);
  });

  await check('채팅이 같은 방에 간다', async () => {
    tx(b, { t: 'chat', text: '안녕하세요' });
    const c = await waitFor(a, m => m.t === 'chat');
    assert.strictEqual(c.text, '안녕하세요');
    assert.strictEqual(c.name, '민수');
  });

  await check('열린 방 목록에 보이고, 비공개로 바꾸면 사라진다', async () => {
    assert.ok((await rooms()).some(r => r.code === code), '목록에 없음');
    tx(a, { t: 'cfg', priv: true });
    await waitFor(a, m => m.t === 'state' && m.cfg.priv === true);
    assert.ok(!(await rooms()).some(r => r.code === code), '비공개인데 목록에 보임');
  });

  await check('시작하면 순서 주사위부터 — 남의 손패는 안 보인다', async () => {
    tx(a, { t: 'start' });
    const s = await waitFor(a, m => m.t === 'state' && m.phase === 'playing');
    assert.strictEqual(s.view.phase, 'order');
    assert.ok(s.view.players.find(p => p.id === idA).res, '내 손패가 안 보임');
    assert.ok(!s.view.players.find(p => p.id === idB).res, '남의 손패가 보임');
    assert.ok(!('devDeck' in s.view) && !('seed' in s.view), '더미나 씨앗이 새어 나옴');
    tx(a, { t: 'act', action: 'rollForOrder', args: [] });
    await waitFor(a, m => m.t === 'state' && m.view && m.view.order.rolls[idA], 6000, '(순서 주사위)');
    tx(b, { t: 'act', action: 'rollForOrder', args: [] });
    const s2 = await waitFor(b, m => m.t === 'state' && m.view && m.view.phase === 'setup', 6000, '(준비 단계)');
    assert.ok(s2.view.legal, '놓을 수 있는 자리 목록이 없음');
  });

  await check('새로고침해도 자리를 지키고, 옛 소켓이 닫혀도 끊긴 걸로 치지 않는다', async () => {
    const b2 = await open();
    tx(b2, { t: 'resume', code, token: tokenB });
    const s = await waitFor(b2, m => m.t === 'state' && m.phase === 'playing');
    assert.strictEqual(s.view.me, idB);
    b.close();
    await sleep(800);
    const last = a.inbox.filter(m => m.t === 'state').pop();
    assert.strictEqual(last.players.find(p => p.id === idB).connected, true, '새 소켓이 붙어 있는데 끊긴 걸로 표시됨');
    b = b2;
  });

  await check('같은 자리로 다른 탭이 들어오면 먼저 탭은 4001 로 닫힌다', async () => {
    const b2 = await open();
    tx(b2, { t: 'resume', code, token: tokenB });
    await waitFor(b2, m => m.t === 'welcome');
    const end = Date.now() + 3000;
    while (b.closed == null && Date.now() < end) await sleep(25);
    assert.strictEqual(b.closed, 4001);
    b = b2;
  });

  await check('나가기를 누르면 판에서 빠지고 남은 사람이 이긴다', async () => {
    tx(b, { t: 'leave' });
    await waitFor(b, m => m.t === 'left');
    const s = await waitFor(a, m => m.t === 'state' && m.phase === 'over');
    assert.strictEqual(s.view.winner, idA);
  });

  await check('확장판 방도 시작된다 — 진보카드는 내 것만 보인다', async () => {
    const x = await open();
    tx(x, { t: 'create', name: '확장', ext: true });
    const w = await waitFor(x, m => m.t === 'welcome');
    const y = await open();
    tx(y, { t: 'join', code: w.code, name: '기사' });
    const wy = await waitFor(y, m => m.t === 'welcome');
    await waitFor(x, m => m.t === 'state' && m.players.length === 2 && m.cfg.ext === true);
    tx(x, { t: 'start' });
    const s = await waitFor(y, m => m.t === 'state' && m.phase === 'playing');
    assert.strictEqual(s.view.ext, 'ck');
    assert.ok(s.view.players.find(p => p.id === wy.you).cardList, '내 진보카드 목록이 없음');
    assert.ok(!s.view.players.find(p => p.id === w.you).cardList, '남의 진보카드가 보임');
    tx(x, { t: 'leave' }); tx(y, { t: 'leave' });
    await waitFor(y, m => m.t === 'left');
    x.close(); y.close();
  });

  if (process.env.IDLE) {
    await check('조작이 없으면 4000 으로 닫힌다 (ping 만 보내도)', async () => {
      const c = await open();
      tx(c, { t: 'create', name: '가만히' });
      await waitFor(c, m => m.t === 'welcome');
      const end = Date.now() + 15000;
      while (c.closed == null && Date.now() < end) { tx(c, { t: 'ping' }); await sleep(400); }
      assert.strictEqual(c.closed, 4000);
      assert.ok(c.inbox.some(m => m.t === 'idle'), 'idle 알림이 먼저 와야 함');
      // 서버가 스스로 끊은 것이라 대기실 자리는 남아 있어야 한다 — 다시 누르면 이어 붙는다
      const w = c.inbox.find(m => m.t === 'welcome');
      const c2 = await open();
      tx(c2, { t: 'resume', code: w.code, token: w.token });
      const back = await waitFor(c2, m => m.t === 'welcome' || m.t === 'err');
      assert.strictEqual(back.t, 'welcome', '자리가 지워짐: ' + JSON.stringify(back));
      c2.close();
    });
  }

  a.close(); b.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
