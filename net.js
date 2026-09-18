/* 카탄 — 통신
   PeerJS 로 방장과 참가자를 직접 잇는다. 서버도 계정도 없다.
   방장이 심판이고, 참가자에게는 각자 볼 수 있는 만큼만 잘라서 보낸다. */
(function (root) {
  'use strict';

  var PREFIX = 'catan4-';
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 헷갈리는 글자 제외

  function makeCode() {
    var s = '';
    for (var i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }

  // PeerJS 는 상대가 탭을 닫아도 close 이벤트를 안 주는 경우가 많다.
  // (RTCPeerConnection 이 failed 로 떨어져도 conn.open 은 true 로 남는다)
  // 그래서 응용 계층에서 직접 살아 있는지 확인한다.
  var BEAT_MS = 2500;      // 확인 주기
  var DEAD_MS = 11000;     // 이 시간 동안 아무 소식 없으면 끊긴 것으로 본다

  function pcDead(conn) {
    var pc = conn && conn.peerConnection;
    if (!pc) return false;
    return pc.connectionState === 'failed' || pc.connectionState === 'closed';
  }

  function Net() {
    this.peer = null;
    this.watch = null;
    this.conns = {};        // playerId -> DataConnection (방장 전용)
    this.hostConn = null;   // 참가자 전용
    this.isHost = false;
    this.code = null;
    this.on = {};           // open, join, leave, data, error, status
  }

  Net.prototype.emit = function (ev, a, b) {
    if (this.on[ev]) this.on[ev](a, b);
  };

  Net.prototype.host = function (attempt) {
    var self = this;
    attempt = attempt || 0;
    if (attempt > 6) { self.emit('error', '방을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.'); return; }

    var code = makeCode();
    self.isHost = true;
    self.emit('status', '방 여는 중…');

    var peer = new Peer(PREFIX + code, { debug: 0 });
    self.peer = peer;

    peer.on('open', function () {
      self.code = code;
      self.startHostWatch();
      self.emit('open', code);
    });

    peer.on('connection', function (conn) {
      conn.on('open', function () {
        conn.__lastSeen = Date.now();
        conn.on('data', function (msg) {
          if (!msg || typeof msg !== 'object') return;
          conn.__lastSeen = Date.now();
          if (msg.t === 'ping') return;                 // 생존 신호는 여기서 소비한다
          if (msg.t === 'hello') {
            self.conns[conn.peer] = conn;
            // 이름은 참가자가 정하지만 신원(id)은 연결이 정한다. 사칭을 막는다.
            self.emit('join', conn.peer, String(msg.name || '손님').slice(0, 12));
          } else {
            self.emit('data', conn.peer, msg);
          }
        });
      });
      conn.on('close', function () {
        delete self.conns[conn.peer];
        self.emit('leave', conn.peer);
      });
      conn.on('error', function () {
        delete self.conns[conn.peer];
        self.emit('leave', conn.peer);
      });
    });

    peer.on('error', function (err) {
      if (err && (err.type === 'unavailable-id')) {
        try { peer.destroy(); } catch (e) {}
        self.host(attempt + 1);              // 코드가 겹쳤다. 다시 뽑는다.
        return;
      }
      self.emit('error', describe(err));
    });
  };

  // 방장: 조용해진 참가자를 떨궈낸다
  Net.prototype.startHostWatch = function () {
    var self = this;
    if (self.watch) return;
    self.watch = setInterval(function () {
      var now = Date.now();
      for (var pid in self.conns) {
        if (!Object.prototype.hasOwnProperty.call(self.conns, pid)) continue;
        var c = self.conns[pid];
        if (!c) { delete self.conns[pid]; continue; }
        var gone = pcDead(c) || !c.open || (now - (c.__lastSeen || 0) > DEAD_MS);
        if (gone) {
          delete self.conns[pid];
          try { c.close(); } catch (e) {}
          self.emit('leave', pid);
        } else {
          try { c.send({ t: 'ping' }); } catch (e) {}
        }
      }
    }, BEAT_MS);
  };

  // 참가자: 방장이 사라진 것을 알아챈다
  Net.prototype.startClientWatch = function () {
    var self = this;
    if (self.watch) return;
    self.lastSeen = Date.now();
    self.watch = setInterval(function () {
      var c = self.hostConn;
      if (c && c.open) { try { c.send({ t: 'ping' }); } catch (e) {} }
      if (pcDead(c) || !c || Date.now() - self.lastSeen > DEAD_MS + 2000) {
        clearInterval(self.watch); self.watch = null;
        self.emit('error', '방장과 연결이 끊겼습니다.');
      }
    }, BEAT_MS);
  };

  Net.prototype.join = function (code, name) {
    var self = this;
    self.isHost = false;
    self.code = code;
    self.emit('status', '접속 중…');

    var peer = new Peer({ debug: 0 });
    self.peer = peer;

    peer.on('open', function () {
      var conn = peer.connect(PREFIX + code, { reliable: true });
      self.hostConn = conn;

      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) self.emit('error', '방을 찾지 못했습니다. 코드를 확인해 주세요.');
      }, 12000);

      conn.on('open', function () {
        settled = true; clearTimeout(timer);
        conn.send({ t: 'hello', name: name });
        self.startClientWatch();
        self.emit('open', code);
      });
      conn.on('data', function (msg) {
        self.lastSeen = Date.now();
        if (msg && msg.t === 'ping') return;
        self.emit('data', null, msg);
      });
      conn.on('close', function () { self.emit('error', '방장과 연결이 끊겼습니다.'); });
      conn.on('error', function () { self.emit('error', '연결 오류가 발생했습니다.'); });
    });

    peer.on('error', function (err) {
      if (err && err.type === 'peer-unavailable') {
        self.emit('error', '그런 방이 없습니다. 코드를 확인해 주세요.');
        return;
      }
      self.emit('error', describe(err));
    });
  };

  function describe(err) {
    var t = err && err.type;
    if (t === 'browser-incompatible') return '이 브라우저는 WebRTC를 지원하지 않습니다.';
    if (t === 'network' || t === 'server-error') return '중계 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    if (t === 'disconnected') return '연결이 끊겼습니다.';
    return '통신 오류' + (t ? ' (' + t + ')' : '');
  }

  Net.prototype.toHost = function (msg) {
    if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
  };

  Net.prototype.toPlayer = function (pid, msg) {
    var c = this.conns[pid];
    if (c && c.open) c.send(msg);
  };

  Net.prototype.broadcast = function (fn) {
    for (var pid in this.conns) {
      if (!Object.prototype.hasOwnProperty.call(this.conns, pid)) continue;
      var c = this.conns[pid];
      if (c && c.open) c.send(fn(pid));
    }
  };

  /** 방장이 받지 않기로 한 참가자를 끊는다 — 붙어 있으면 판 화면과 채팅을 계속 받는다 */
  Net.prototype.kick = function (pid) {
    var c = this.conns[pid];
    delete this.conns[pid];
    if (c) setTimeout(function () { try { c.close(); } catch (e) {} }, 400);   // 거절 사유가 먼저 닿게
  };

  Net.prototype.close = function () {
    if (this.watch) { clearInterval(this.watch); this.watch = null; }
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.peer = null; this.conns = {}; this.hostConn = null;
  };

  root.Net = Net;
  root.makeRoomCode = makeCode;
})(typeof self !== 'undefined' ? self : this);
