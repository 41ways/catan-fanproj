'use strict';
/**
 * 카탄 — Node 서버 (로컬 개발 · 테스트용)
 *  - 정적 파일(public/) + WebSocket(/ws). 판은 game.js 가 쥐고 여기는 전달만 한다.
 *  - 실제 서비스는 Cloudflare(worker.js)에서 같은 game.js 로 돈다.
 *  - public/rules.js · ai.js · ck.js · ck-ai.js 는 루트 원본을 가리키는 심볼릭 링크라 fs 가 그대로 따라간다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { rooms, handle, disconnect, sweepRooms, selfCheck } = require('./game');

const PORT = process.env.PORT || 8878;
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let file;
  try { file = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch (_) { res.writeHead(400).end('bad request'); return; }   // %E0 같은 주소 하나로 서버가 죽지 않게

  if (file === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, sockets: wss.clients.size }));
  }

  if (file === '/') file = '/index.html';
  const full = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end('forbidden'); return; }

  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('없는 페이지입니다'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'ping') return;               // 살아 있다는 신호일 뿐
    try { handle(ws, msg); }
    catch (e) { console.error('handle error', e); }
  });

  ws.on('close', () => disconnect(ws));
});

// 끊긴 소켓 정리 + 빈 방 청소
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  });
  // sweepRooms 가 던지면(방 하나 상태가 어긋난 경우 등) 이 되풀이 타이머가 죽어 이후로 아무 방도
  // 청소되지 않는다 — 그보다는 로그만 남기고 다음 틱을 잇는다. 다른 방의 판은 이 타이머와 무관하다.
  try { sweepRooms(); } catch (e) { console.error('방 청소 오류', e); }
}, 30_000).unref();

server.listen(PORT, () => {
  selfCheck();
  console.log(`카탄 서버 → http://localhost:${PORT}`);
});
