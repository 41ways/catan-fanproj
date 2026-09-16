/* 카탄 — 화면과 진행
   방장(또는 혼자 하기)의 브라우저가 심판이다. 참가자는 자기 시야만 받아서 그린다. */
(function () {
  'use strict';
  var R = window.Rules, AI = window.AI;
  var CK = window.CK, CKAI = window.CKAI;
  // 지금 판이 쓰는 엔진과 봇
  function E() { return App.ext ? CK : R; }
  function BOT() { return App.ext ? CKAI : AI; }
  function isExt(v) { return !!(v && v.ext === 'ck'); }
  var $ = function (id) { return document.getElementById(id); };
  var RES = R.RES;
  var RN = { b: '벽돌', l: '나무', w: '양', g: '밀', o: '철', c: '옷감', p: '종이', n: '화폐' };
  // 확장에서는 흙이라 부른다
  function resName(c) { return App.ext && c === 'b' ? '흙' : RN[c]; }
  function cardsOf(v) { return isExt(v) ? CK.ALL : RES; }
  // 이름은 참가자가 직접 정한다. innerHTML 로 넣는 문장에는 반드시 이렇게 걸러서 넣는다.
  function H(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var PCOLOR = { red: '#d95f4a', blue: '#5a8fd9', orange: '#e09a3e', white: '#d8dce6' };
  var EMOJI = {
    b: '\uD83E\uDDF1', l: '\uD83E\uDEB5', w: '\uD83D\uDC11', g: '\uD83C\uDF3E', o: '\uD83E\uDEA8',
    c: '\uD83E\uDDF6', p: '\uD83D\uDCDC', n: '\uD83E\uDE99'          // 🧶 옷감 · 📜 종이 · 🪙 화폐
  };
  function rchip(c) { return el('i', 'rc r-' + c, EMOJI[c]); }
  var S = 52;                                     // 육각형 한 변(px)
  var SVGNS = 'http://www.w3.org/2000/svg';

  var App = {
    ext: false, feed: [], feedBusy: false, feedTimer: null, bigTimer: null, lastLogId: undefined,
    mode: 'solo', me: 'me', net: null, seats: [], state: null, view: null,
    started: false, skill: 1, botTimer: null,
    build: null,               // 'road' | 'settlement' | 'city' — 짓기 모드
    discardSel: [],            // 버리기 선택
    tGive: {}, tWant: {},      // 거래 제안 폼
    tourStep: 0
  };

  function show(which) {
    ['title', 'home', 'lobby', 'game'].forEach(function (id) {
      $(id).classList.toggle('hidden', id !== which);
    });
    if (which === 'title') replayTitleIntro();
    if (which === 'game') { initZoom(); initLogFold(); }
  }

  // 타이틀로 돌아올 때마다 등장 연출을 처음부터 다시 돌린다
  function replayTitleIntro() {
    var t = $('title');
    if (!t) return;
    t.classList.remove('curtain');
    void t.offsetWidth;
    t.classList.add('curtain');
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }
  function myName() { return $('name').value.trim() || '나'; }

  /* ---------------- 조사 ---------------- */
  // 받침에 따라 조사를 골라 붙인다 — '민수가', '벽돌이', '봇 둘이'
  function hasJong(w) {
    if (!w) return false;
    var ch = w.charCodeAt(w.length - 1);
    if (ch >= 0xAC00 && ch <= 0xD7A3) return (ch - 0xAC00) % 28 !== 0;
    if (ch >= 0x30 && ch <= 0x39) return '013678'.indexOf(String.fromCharCode(ch)) >= 0;
    // 로마자 이름도 읽는 소리로 친다 — Sherlock 은 「이」, Holmes 는 「가」
    var c = String.fromCharCode(ch);
    if (/[a-z]/i.test(c)) return !/[aeiouysxz]/i.test(c);
    return false;
  }
  function jongIs(w, code) {
    if (!w) return false;
    var ch = w.charCodeAt(w.length - 1);
    return ch >= 0xAC00 && ch <= 0xD7A3 && (ch - 0xAC00) % 28 === code;
  }
  function GA(w) { return w + (hasJong(w) ? '이' : '가'); }
  function EUL(w) { return w + (hasJong(w) ? '을' : '를'); }
  function EUN(w) { return w + (hasJong(w) ? '은' : '는'); }
  function WA(w) { return w + (hasJong(w) ? '과' : '와'); }
  function EURO(w) { return w + (!hasJong(w) || jongIs(w, 8) ? '로' : '으로'); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function meOf(v) {
    for (var i = 0; i < v.players.length; i++) if (v.players[i].id === v.me) return v.players[i];
    return null;
  }
  function playerIn(v, pid) {
    for (var i = 0; i < v.players.length; i++) if (v.players[i].id === pid) return v.players[i];
    return null;
  }
  function isMyTurn(v) {
    if (v.phase === 'setup') return v.setup.who === v.me;
    return v.players[v.turn] && v.players[v.turn].id === v.me;
  }
  var INTRO_TILES = 19 * 70 + 260;          // 타일이 다 깔리는 데 걸리는 시간
  var INTRO_ALL = INTRO_TILES + 19 * 55 + 420;
  // 판이 깔리는 연출을 시작한다 (한 판에 한 번)
  function startIntro() {
    App.intro = true;
    App.introAt = Date.now();          // 다시 그려도 이어서 — 처음부터 다시 돌지 않게
    App.seenBuilt = App.seenBuilt || {};
    clearTimeout(App.introTimer);
    App.introTimer = setTimeout(function () {
      App.intro = false;
      render();
    }, INTRO_ALL);
  }

  // 등장 연출에서 이 조각이 아직 나올 차례가 남았는지 — 남았으면 지금 기준의 지연(음수 가능)을 준다.
  // 다시 그려도 이미 나온 조각은 그대로 두고, 나오는 중인 조각은 이어서 돈다.
  function introLeft(at, dur) {
    if (!App.intro) return null;
    var t = Date.now() - (App.introAt || 0);
    if (t >= at + dur) return null;
    return at - t;
  }

  /* ---------------- 판 확대·이동 ----------------
     휠·손가락 두 개로 확대하고, 확대된 상태에서 끌어 옮긴다.
     화면에 보이는 것만 키우므로 규칙과 좌표 계산에는 영향이 없다. */
  var Zoom = { z: 1, x: 0, y: 0, drag: null, moved: false, pts: {} };
  var ZOOM_MIN = 1, ZOOM_MAX = 3.2;

  function applyZoom() {
    var svg = $('board'), box = $('boardBox');
    if (!svg || !box) return;
    svg.style.transform = 'translate(' + Zoom.x.toFixed(1) + 'px,' + Zoom.y.toFixed(1) + 'px) scale(' + Zoom.z.toFixed(3) + ')';
    box.classList.toggle('zoomed', Zoom.z > 1.01);
  }
  function clampPan() {
    var box = $('boardBox');
    if (!box) return;
    var r = box.getBoundingClientRect();
    var lx = Math.max(0, (r.width * Zoom.z - r.width) / 2);
    var ly = Math.max(0, (r.height * Zoom.z - r.height) / 2);
    Zoom.x = Math.max(-lx, Math.min(lx, Zoom.x));
    Zoom.y = Math.max(-ly, Math.min(ly, Zoom.y));
  }
  // cx, cy 는 박스 한가운데를 기준으로 한 확대 중심
  function setZoom(nz, cx, cy) {
    nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nz));
    if (cx === undefined) { cx = 0; cy = 0; }
    var k = nz / Zoom.z;
    Zoom.x = cx - (cx - Zoom.x) * k;
    Zoom.y = cy - (cy - Zoom.y) * k;
    Zoom.z = nz;
    clampPan(); applyZoom();
  }
  function resetZoom() { Zoom.z = 1; Zoom.x = 0; Zoom.y = 0; applyZoom(); }
  function boxOffset(e) {
    var r = $('boardBox').getBoundingClientRect();
    return { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
  }
  function initZoom() {
    var box = $('boardBox');
    if (!box || box.dataset.zoomReady) return;
    box.dataset.zoomReady = '1';

    box.addEventListener('wheel', function (e) {
      e.preventDefault();
      var o = boxOffset(e);
      setZoom(Zoom.z * (e.deltaY < 0 ? 1.14 : 1 / 1.14), o.x, o.y);
    }, { passive: false });

    box.addEventListener('pointerdown', function (e) {
      Zoom.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(Zoom.pts);
      if (ids.length === 2) {                       // 손가락 두 개 — 벌려서 확대
        var a = Zoom.pts[ids[0]], b = Zoom.pts[ids[1]];
        Zoom.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: Zoom.z };
        Zoom.drag = null;
      } else if (Zoom.z > 1.01) {
        Zoom.drag = { x: e.clientX, y: e.clientY, ox: Zoom.x, oy: Zoom.y };
        Zoom.moved = false;
      }
    });
    box.addEventListener('pointermove', function (e) {
      if (!Zoom.pts[e.pointerId]) return;
      Zoom.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(Zoom.pts);
      if (ids.length === 2 && Zoom.pinch) {
        var a = Zoom.pts[ids[0]], b = Zoom.pts[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        if (Zoom.pinch.d > 8) setZoom(Zoom.pinch.z * (d / Zoom.pinch.d));
        Zoom.moved = true;
        e.preventDefault();
        return;
      }
      if (Zoom.drag) {
        var dx = e.clientX - Zoom.drag.x, dy = e.clientY - Zoom.drag.y;
        if (!Zoom.moved && Math.hypot(dx, dy) < 7) return;   // 살짝 흔들린 건 누른 것으로 본다
        Zoom.moved = true;
        Zoom.x = Zoom.drag.ox + dx; Zoom.y = Zoom.drag.oy + dy;
        clampPan(); applyZoom();
      }
    });
    var end = function (e) {
      delete Zoom.pts[e.pointerId];
      if (Object.keys(Zoom.pts).length < 2) Zoom.pinch = null;
      Zoom.drag = null;
      if (Zoom.moved) setTimeout(function () { Zoom.moved = false; }, 60);
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('pointerleave', end);
    // 끌어 옮긴 직후의 클릭은 놓기로 치지 않는다
    box.addEventListener('click', function (e) {
      if (Zoom.moved) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    box.addEventListener('dblclick', function () { resetZoom(); });

    $('zoomIn').onclick = function () { setZoom(Zoom.z * 1.35); };
    $('zoomOut').onclick = function () { setZoom(Zoom.z / 1.35); };
    $('zoomFit').onclick = function () { resetZoom(); };
  }

  function px(X) { return X * S * 0.8660254; }
  function py(Y) { return Y * S * 0.5; }
  // #rrggbb 를 밝기 f 배로
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.round((n >> 16 & 255) * f));
    var g = Math.min(255, Math.round((n >> 8 & 255) * f));
    var b = Math.min(255, Math.round((n & 255) * f));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* ---------------- 진행 ---------------- */

  function startEngine() {
    App.ext = (App.mode === 'solo' || App.mode === 'host') ? App.wantExt : App.ext;
    if (App.seats.length < 2) { toast('2명 이상이어야 시작할 수 있습니다.'); return; }
    App.started = true;
    App.state = E().newGame(App.seats.map(function (s) {
      return { id: s.id, name: s.name, bot: s.bot };
    }), Math.floor(Math.random() * 1e9));
    // 판 수 세기 — 방장(또는 혼자 하기)만 보낸다. 참가자도 보내면 한 판이 인원수만큼 세어진다.
    App.statAt = Date.now();
    App.statOver = false;
    if (App.mode !== 'client' && window.norara) {
      norara.ev('start', { n: App.seats.filter(function (s) { return !s.bot; }).length });
    }

    App.build = null; App.discardSel = [];
    App.lastLogId = undefined; App.feed = []; App.feedBusy = false;
    App.seenBuilt = {}; App.confettiDone = false; App.orderSeen = {};
    resetZoom();
    show('game');
    startIntro();
    pushViews();
  }

  function pushViews() {
    var s = App.state;
    if (App.mode === 'host' && App.net) {
      App.net.broadcast(function (pid) { return { t: 'view', view: E().viewFor(s, pid) }; });
    }
    applyView(E().viewFor(s, App.me));
  }

  function applyView(v) {
    var prev = App.view;
    // 순서 정하기에 들어서면 무엇을 하는 단계인지 먼저 크게 알린다
    if (v.phase === 'order' && (!prev || prev.phase !== 'order')) {
      showPlaque('\uD83C\uDFB2', '순서를 정합니다', '모두 주사위를 굴려 가장 높은 눈이 첫 번째로 놓습니다', '', 2000);
    }
    // 단계가 바뀌면 선택을 정리한다
    if (!prev || prev.phase !== v.phase || prev.turn !== v.turn) {
      App.build = null; App.discardSel = [];
      App.pickVert = App.pickHex = App.pickEdge = null; App.knightSel = null;
    }
    App.view = v;
    // 새로 굴린 주사위면 가운데에 연출로 보여준다
    if (v.dice) {
      var dk = v.turnCount + '-' + v.dice[0] + v.dice[1];
      if (App.diceKey !== dk) {
        App.diceKey = dk;
        var gains = (v.lastGain && v.lastGain.length) ? v.lastGain : null;
        var isSeven = v.dice[0] + v.dice[1] === 7;
        // 주사위가 화면에서 사라진 뒤에 해당 칸이 점등하고, 그 다음 카드가 온다
        var roller = v.players[v.turn];
        showDiceRoll(v.dice, roller, v, function () {
          if (isSeven) robberSweep(litRobber);
          else if (gains) flyGains(gains);
          else showBlocked(v);
        });
      }
    }
    if (v.phase === 'order' || (prev && prev.phase === 'order')) showOrderRolls(prev, v);
    render();
    // 지난 차례에 무슨 일이 있었는지 한 줄씩 풀어 준다
    pushFeed(v);
    renderNow(v);
    // 순서가 정해진 순간 — 결과를 읽고 넘어간다
    if (prev && prev.phase === 'order' && v.phase === 'setup') {
      var seq = setupOrderNames(v), rolls = (v.order && v.order.rolls) || {};
      gateSoon(700, '\uD83E\uDD47', '순서가 정해졌습니다',
        (seq[0] ? seq[0].name : '') + '부터 마을과 도로를 하나씩 놓습니다. 두 바퀴째는 반대 순서입니다.',
        seq.map(function (p, i) {
          var r = rolls[p.id];
          return {
            name: (i + 1) + '. ' + p.name + (p.id === v.me ? ' (나)' : ''),
            val: r ? (r.d[0] + ' + ' + r.d[1] + ' = ' + r.sum) : '',
            color: PCOLOR[p.color]
          };
        }));
    }
    // 준비가 끝나고 본게임이 시작되는 순간
    if (prev && prev.phase === 'setup' && v.phase !== 'setup' && v.phase !== 'over') {
      var starter = v.players[v.turn], meP = playerIn(v, v.me);
      var rows = [];
      if (meP && meP.res) {
        RES.forEach(function (c) {
          if (meP.res[c]) rows.push({ name: EMOJI[c] + ' ' + resName(c), val: meP.res[c] + '장' });
        });
      }
      gateSoon(700, '\uD83C\uDFB2', '준비 끝 — 이제 본게임',
        (starter ? starter.name : '') + '부터 주사위를 굴립니다. 나온 눈과 같은 숫자 타일 둘레에 내 마을이 있으면 자원을 받습니다.',
        rows.length ? rows : null);
    }
    if (prev && prev.turn !== v.turn && v.phase !== 'over' && v.phase !== 'setup') announceTurn(v);
    // 마을·도로를 놓는 동안에도 누구 차례인지 크게 알린다
    if (v.phase === 'setup' && v.setup && v.setup.who &&
        (!prev || !prev.setup || prev.setup.who !== v.setup.who)) announceSetupTurn(v);
    if (v.lastTrade) playTradeAnim(v);
    if (v.lastBank) playBankAnim(v);
    if (v.lastRobber) playRobberAnim(v);
    if (v.lastSteal) playStealAnim(v);
    if (v.phase === 'over') showOver(v);
    scheduleBot();
  }

  function act(action, args) {
    if (App.mode === 'client') { App.net.toHost({ t: 'act', action: action, args: args }); return; }
    doAction(App.me, action, args);
  }
  var ALLOWED = ['placeSettlement', 'placeRoad', 'roll', 'discard', 'moveRobber', 'build',
    'buyDev', 'playDev', 'bankTrade', 'offerTrade', 'replyTrade', 'acceptTrade', 'cancelTrade', 'endTurn'];
  function doAction(pid, action, args) {
    var s = App.state;
    if (!s) return;
    var allowed = ['rollForOrder', 'placeSettlement', 'placeRoad', 'roll', 'discard', 'moveRobber',
      'build', 'buyDev', 'playDev', 'bankTrade', 'offerTrade', 'replyTrade',
      'acceptTrade', 'cancelTrade', 'endTurn',
      // 도시와 기사
      'placeKnight', 'activateKnight', 'upgradeKnight', 'moveKnight', 'chaseRobber',
      'develop', 'playCard'];
    if (allowed.indexOf(action) < 0) return;
    var eng = E();
    if (typeof eng[action] !== 'function') return;
    var r = eng[action].apply(null, [s, pid].concat(args || []));
    if (!r.ok) {
      if (pid === App.me) toast(r.error);
      else if (App.net) App.net.toPlayer(pid, { t: 'err', msg: r.error });
      return;
    }
    App.build = null;
    App.knightSel = null;
    pushViews();
  }


  /* ---------------- 봇 ---------------- */

  function scheduleBot() {
    if (App.mode === 'client') return;
    var s = App.state, eng = E();
    if (!s || s.phase === 'over') return;
    clearTimeout(App.botTimer);
    if (App.hold) return;                              // 관문이 떠 있으면 봇도 기다린다
    // 거래 응답이 먼저다
    var pend = eng.tradePending(s).filter(function (pid) { return eng.playerOf(s, pid).bot; });
    if (pend.length) {
      var w = 700 + Math.min(1400, App.feed.length * 340);
      App.botTimer = setTimeout(function () { botTradeReply(pend[0]); }, w);
      return;
    }
    // 제안이 떠 있는데 응답이 다 모였으면 사람(제안자)의 몫 — 봇은 제안하지 않는다
    if (s.trade) return;
    var all = eng.needsAction(s);
    // 순서 정하기는 사람이 먼저 굴린 뒤에 봇이 이어 굴린다 — 그래야 무슨 일이 일어나는지 보인다
    if (s.phase === 'order' && all.some(function (pid) { return !eng.playerOf(s, pid).bot; })) return;
    var need = all.filter(function (pid) { return eng.playerOf(s, pid).bot; });
    if (!need.length) return;
    var wait = s.phase === 'order' ? 2900 : s.phase === 'setup' ? 1300 : s.phase === 'roll' ? 900 : 820;
    if (App.intro) wait += 700;                       // 판이 깔리는 동안은 천천히
    // 아직 중계할 줄이 남아 있으면 그만큼 늦춘다 (한 수씩 눈에 들어오게)
    wait += Math.min(3200, App.feed.length * 520 + (App.feedBusy ? 320 : 0));
    App.botTimer = setTimeout(function () { botStep(need[0]); }, wait);
  }

  function botTradeReply(pid) {
    var s = App.state, eng = E();
    if (!s || !s.trade) { scheduleBot(); return; }
    eng.replyTrade(s, pid, BOT().replyToTrade(eng.viewFor(s, pid)));
    pushViews();
  }

  function botStep(pid) {
    var s = App.state, eng = E(), bot = BOT();
    if (!s || s.phase === 'over') return;
    var p = eng.playerOf(s, pid);
    if (!p || !p.bot) return;
    var v = eng.viewFor(s, pid), r = null;
    var cards = App.ext ? CK.ALL : RES;

    if (s.phase === 'order') {
      r = eng.rollForOrder(s, pid);
    } else if (s.phase === 'setup') {
      if (s.setupSub === 'settlement') {
        r = eng.placeSettlement(s, pid, bot.chooseSetupSettlement(v));
        if (!r.ok) r = eng.placeSettlement(s, pid, eng.legalSettlements(s, pid)[0]);
      } else {
        r = eng.placeRoad(s, pid, bot.chooseSetupRoad(v));
        if (!r.ok) r = eng.placeRoad(s, pid, eng.legalRoads(s, pid)[0]);
      }
    } else if (s.phase === 'discard') {
      var need = s.mustDiscard[pid];
      r = eng.discard(s, pid, bot.chooseDiscard(v, need));
      if (!r.ok) {
        var pool = [];
        cards.forEach(function (c) { for (var i = 0; i < p.res[c]; i++) pool.push(c); });
        r = eng.discard(s, pid, pool.slice(0, need));
      }
    } else if (s.phase === 'robber') {
      var rb = bot.chooseRobber(v);
      var cands = eng.robberVictims(s, rb.hex, pid);
      r = eng.moveRobber(s, pid, rb.hex, cands.length ? (rb.victim && cands.indexOf(rb.victim) >= 0 ? rb.victim : cands[0]) : null);
      if (!r.ok) {
        var hx = (s.robber + 1) % 19, cd = eng.robberVictims(s, hx, pid);
        r = eng.moveRobber(s, pid, hx, cd.length ? cd[0] : null);
      }
    } else {
      var key = s.turnCount + ':' + pid;
      if (!App.botSkip || App.botSkip.k !== key) App.botSkip = { k: key, list: [] };
      var a = bot.act(v, App.skill, App.botSkip.list);
      if (a && typeof eng[a.action] === 'function') r = eng[a.action].apply(null, [s, pid].concat(a.args));
      if ((!r || !r.ok) && a && a.action === 'playCard' && App.botSkip.list.length < 8) {
        App.botSkip.list.push(a.args[0]);      // 거절된 카드 — 이번 차례엔 다시 고르지 않는다
        pushViews();                           // 다음 봇 걸음에서 다른 수를 둔다
        return;
      }
      if (!r || !r.ok) {
        if (s.phase === 'roll') r = eng.roll(s, pid);
        else { if (s.freeRoads > 0) s.freeRoads = 0; r = eng.endTurn(s, pid); }
      }
    }
    if (!r || !r.ok) { toast('봇이 막혔습니다.'); return; }
    pushViews();
  }

  // 판 테두리를 지금 차례인 사람 색으로 물들인다 — 내 차례면 더 진하게
  function paintTurnFrame(v) {
    var box = $('boardBox');
    if (!box) return;
    var cur = v.phase === 'setup' ? playerIn(v, v.setup.who)
      : v.phase === 'order' ? null : v.players[v.turn];
    if (!cur || v.phase === 'over') {
      box.style.boxShadow = '';
      box.classList.remove('myTurnFrame');
      return;
    }
    var col = PCOLOR[cur.color] || '#888';
    var mine = cur.id === v.me;
    box.style.boxShadow = 'inset 0 0 0 ' + (mine ? '3px' : '2px') + ' ' + col +
      (mine ? ', 0 0 18px -4px ' + col : '');
    box.classList.toggle('myTurnFrame', mine);
  }

  /* ---------------- 분위기 연출 ---------------- */

  function screenShake() {
    var box = $('boardBox');
    if (!box) return;
    box.classList.remove('shake');
    void box.offsetWidth;
    box.classList.add('shake');
    setTimeout(function () { box.classList.remove('shake'); }, 600);
  }

  // 7 — 도둑이 흙먼지를 일으키며 화면을 가로질러 달려간다
  function robberSweep(done) {
    var ov = $('robberSweep'), fig = $('sweepFig');
    if (!ov) { if (done) done(); return; }
    ov.classList.remove('hidden');
    fig.style.animation = 'none'; void fig.offsetWidth; fig.style.animation = '';
    var txt = $('sweepText');
    txt.style.animation = 'none'; void txt.offsetWidth; txt.style.animation = '';
    screenShake();
    // 달리는 길을 따라 흙먼지
    var puffs = 0;
    var puffTimer = setInterval(function () {
      var r = fig.getBoundingClientRect();
      if (!r.width) return;
      var p = el('i', 'puff');
      p.style.left = (r.left + r.width * 0.25 + (Math.random() * 16 - 8)) + 'px';
      p.style.top = (r.bottom - 10 + (Math.random() * 10 - 5)) + 'px';
      ov.appendChild(p);
      setTimeout(function () { p.remove(); }, 950);
      if (++puffs > 18) clearInterval(puffTimer);
    }, 70);
    setTimeout(function () {
      clearInterval(puffTimer);
      ov.classList.add('hidden');
      ov.querySelectorAll('.puff').forEach(function (p) { p.remove(); });
      if (done) done();
    }, 1550);
  }

  // 승리 — 색종이
  function confetti() {
    var box = $('confetti');
    if (!box) return;
    box.innerHTML = '';
    box.classList.remove('hidden');
    var colors = ['#d95f4a', '#5a8fd9', '#e09a3e', '#f5c542', '#5aa96b', '#c46b9a', '#fff'];
    for (var i = 0; i < 90; i++) {
      var f = el('i');
      f.style.left = (Math.random() * 100) + 'vw';
      f.style.background = colors[i % colors.length];
      f.style.animationDuration = (2.2 + Math.random() * 1.8) + 's';
      f.style.animationDelay = (Math.random() * 0.9) + 's';
      f.style.width = (6 + Math.random() * 6) + 'px';
      f.style.height = (10 + Math.random() * 8) + 'px';
      box.appendChild(f);
    }
    setTimeout(function () { box.classList.add('hidden'); box.innerHTML = ''; }, 4600);
  }

  // 거래 성사 — 두 사람 사이에 악수
  function handshakeAt(ra, rb) {
    var x = (ra.left + ra.width / 2 + rb.left + rb.width / 2) / 2;
    var y = (ra.top + ra.height / 2 + rb.top + rb.height / 2) / 2 + 26;
    var h = el('div', 'handshake', '\uD83E\uDD1D');
    h.style.left = x + 'px'; h.style.top = y + 'px';
    document.body.appendChild(h);
    setTimeout(function () { h.remove(); }, 1200);
  }

  // 새로 지은 것은 한 번만 착지 연출을 한다
  function freshKey(r) { return r.kind + ':' + r.id + ':' + r.p + ':' + r.turn; }
  function isFresh(r) {
    App.seenBuilt = App.seenBuilt || {};
    var k = freshKey(r);
    if (App.seenBuilt[k]) return false;
    App.seenBuilt[k] = 1;
    return true;
  }

  /* ---------------- 중계 — 로그를 한 줄씩 풀어 보여준다 ---------------- */

  // 로그 한 줄이 무슨 일인지 알아본다 (표시 전용)
  // big:true 는 화면 가운데 큰 알림까지 띄운다
  function readLine(text) {
    var t = text;
    function has() {
      for (var i = 0; i < arguments.length; i++) if (t.indexOf(arguments[i]) >= 0) return true;
      return false;
    }
    // ── 판을 뒤흔드는 일 ──────────────────────────────
    if (has('승리')) return { icon: '\uD83C\uDFC6', hold: 2000, big: true };
    if (has('야만족 상륙')) return { icon: '\u2694\uFE0F', hold: 1700, big: true };
    if (has('약탈이 없습니다')) return { icon: '\uD83D\uDE0C', hold: 1100 };
    if (has('약탈')) return { icon: '\uD83D\uDD25', hold: 1500, big: true };
    if (has('카탄의 수호자')) return { icon: '\uD83C\uDF96\uFE0F', hold: 1500, big: true };
    if (has('최장 교역로가 사라', '최장 교역로가 동점')) return { icon: '\uD83D\uDEE3\uFE0F', hold: 1300, big: true };
    if (has('최장 교역로')) return { icon: '\uD83D\uDEE3\uFE0F', hold: 1500, big: true };
    if (has('최강 기사단')) return { icon: '\uD83D\uDEE1\uFE0F', hold: 1500, big: true };
    if (has('수도 건설', '수도를 빼앗')) return { icon: '\uD83C\uDFF0', hold: 1500, big: true };
    if (has('절반 버리기')) return { icon: '\uD83D\uDDD1\uFE0F', hold: 1600, big: true };
    if (has('첫 번째로 놓습니다')) return { icon: '\uD83E\uDD47', hold: 1000 };   // 관문에서 크게 보여 준다
    if (has('놓는 순서:')) return { icon: '\uD83D\uDD22', hold: 1000 };
    if (has('순서 주사위')) return { icon: '\uD83C\uDFB2', hold: 900 };
    if (has('동점')) return { icon: '\uD83D\uDD01', hold: 1400, big: true };
    if (has('독점')) return { icon: '\uD83E\uDDF2', hold: 1500, big: true };

    // ── 주사위와 생산 ────────────────────────────────
    if (has('주사위')) return { icon: '\uD83C\uDFB2', hold: 700 };
    if (has('도둑이', '막고 있어')) return { icon: '\uD83D\uDEAB', hold: 1400, big: true };
    if (has('모자라')) return { icon: '\u26A0\uFE0F', hold: 1200 };
    if (has('아무도 못 받')) return { icon: '\uD83D\uDCA8', hold: 900 };
    if (has('\u2190', '첫 자원', '거둬', '받았습니다', '캤습니다', '거뒀습니다 —')) return { icon: '\uD83D\uDCE6', hold: 850 };

    // ── 도둑 ────────────────────────────────────────
    if (has('도둑을', '옮김')) return { icon: '\uD83D\uDD75\uFE0F', hold: 1500, big: true };
    if (has('도둑을 옮깁니다', '도둑을 쫓')) return { icon: '\uD83D\uDD75\uFE0F', hold: 1200 };
    if (has('가져갔습니다')) return { icon: '\uD83E\uDD1A', hold: 1600, big: true };
    if (has('빼앗긴 것')) return { icon: '\uD83D\uDE23', hold: 1600 };
    if (has('가져온 것')) return { icon: '\uD83D\uDC40', hold: 1500 };
    if (has('도둑은 움직이지', '도둑은 그대로')) return { icon: '\uD83D\uDE34', hold: 1200 };
    if (has('버림 —')) return { icon: '\uD83D\uDDD1\uFE0F', hold: 1100 };

    // ── 짓기 ────────────────────────────────────────
    if (has('성벽')) return { icon: '\uD83E\uDDF1', hold: 1200 };
    if (has('도시 — 2점', '도시\n', '도시')) return { icon: '\uD83C\uDFDB\uFE0F', hold: 1200 };
    if (has('마을')) return { icon: '\uD83C\uDFE0', hold: 1100 };
    if (has('항구 확보')) return { icon: '\u2693', hold: 1300 };
    if (has('도로')) return { icon: '\uD83D\uDEE4\uFE0F', hold: 850 };

    // ── 기사 (확장) ─────────────────────────────────
    if (has('기사를 놓', '기사를 활동', '승급', '밀어냈', '추방', '기사가 이동')) {
      return { icon: '\u2694\uFE0F', hold: 1200 };
    }
    if (has('야만족 함대')) return { icon: '\u26F5', hold: 1100 };

    // ── 카드 ────────────────────────────────────────
    if (has('자원 발견')) return { icon: '\uD83C\uDF81', hold: 1200 };
    if (has('도로 건설 —')) return { icon: '\uD83D\uDEA7', hold: 1200 };
    if (has('성문 —', '진보카드')) return { icon: '\uD83D\uDCDC', hold: 1200 };
    if (has('발전 카드', '뽑은 카드')) return { icon: '\uD83C\uDCCF', hold: 1000 };
    if (has('단계 —')) return { icon: '\uD83C\uDFD7\uFE0F', hold: 1700, big: true };   // 도시 개발은 큰 일이다

    // ── 거래 ────────────────────────────────────────
    if (has('거래 성사')) return { icon: '\uD83E\uDD1D', hold: 1400 };
    if (has('거래 제안')) return { icon: '\uD83D\uDCAC', hold: 1200 };
    if (has('받겠다고')) return { icon: '\uD83D\uDC4D', hold: 900 };
    if (has('거절')) return { icon: '\uD83D\uDC4E', hold: 900 };
    if (has('제안을 거뒀')) return { icon: '\u21A9\uFE0F', hold: 900 };
    if (has('은행과')) return { icon: '\uD83C\uDFE6', hold: 1000 };

    // ── 진행 ────────────────────────────────────────
    if (has('준비 끝')) return { icon: '\uD83C\uDFC1', hold: 1200 };
    if (has('나감')) return { icon: '\uD83D\uDEAA', hold: 1200 };
    if (has('놓을 자리가 없어', '넘어갑니다')) return { icon: '\u23ED\uFE0F', hold: 1000 };
    if (has('차례')) return { icon: '\u23ED\uFE0F', hold: 700 };
    return { icon: '\u2022', hold: 900 };
  }

  // 그 줄이 누구 이야기인지 — 이름으로 찾아 색을 입힌다
  function lineOwner(v, text) {
    var best = null;
    v.players.forEach(function (p) {
      if (text.indexOf(p.name) === 0) best = p;
    });
    if (best) return best;
    v.players.forEach(function (p) {
      if (!best && text.indexOf(p.name) >= 0) best = p;
    });
    return best;
  }

  /* ---------------- 카드 한 장 한 장이 무슨 카드인지 ---------------- */
  // 뽑는 순간 화면 가운데에 펼쳐 보여 준다. 손패 칩의 설명(title)도 여기서 온다.
  var CARD_INFO = {
    /* 기본판 발전 카드 */
    knight:   { name: '기사', icon: '\u2694\uFE0F', kind: '발전 카드', cls: 'k-dev',
                img: 'img/knight.webp', art: 'img/a-knight.webp',
                desc: '도둑을 옮기고, 그 땅에 닿은 사람 하나에게서 카드를 한 장 가져옵니다. 세 장을 쓰면 최강 기사단 2점.' },
    vp:       { name: '승점', icon: '\uD83C\uDFC6', kind: '발전 카드', cls: 'k-dev',
                img: 'img/victorypoint.webp', art: 'img/a-victorypoint.webp',
                desc: '가지고만 있어도 1점. 이길 때까지 아무에게도 보이지 않습니다.' },
    road:     { name: '도로 건설', icon: '\uD83D\uDEE4\uFE0F', kind: '발전 카드', cls: 'k-dev',
                img: 'img/roadbuilding.webp', art: 'img/a-roadbuilding.webp',
                desc: '도로 두 개를 재료 없이 바로 놓습니다.' },
    plenty:   { name: '자원 발견', icon: '\uD83C\uDF81', kind: '발전 카드', cls: 'k-dev',
                img: 'img/yearofplenty.webp', art: 'img/a-yearofplenty.webp',
                desc: '은행에서 원하는 자원 두 장을 골라 가져옵니다.' },
    monopoly: { name: '독점', icon: '\uD83D\uDCE2', kind: '발전 카드', cls: 'k-dev',
                img: 'img/monopoly.webp', art: 'img/a-monopoly.webp',
                desc: '자원 하나를 고르면 모든 사람이 가진 그 자원을 전부 거둬 옵니다.' },

    /* 도시와 기사 — 과학(초록) */
    alchemist:  { name: '연금술사', icon: '\uD83E\uDDEA', kind: '과학 진보카드', cls: 'k-sci',
                  img: 'img/alchemist.webp', art: 'img/a-alchemist.webp',
                  desc: '주사위를 굴리기 전에 써서, 이번에 나올 흰·빨강 눈을 직접 정합니다.' },
    crane:      { name: '기중기', icon: '\uD83C\uDFD7\uFE0F', kind: '과학 진보카드', cls: 'k-sci',
                  img: 'img/crane.webp', art: 'img/a-crane.webp',
                  desc: '이번 차례의 도시 개발 한 번을 상품 한 장 싸게 합니다.' },
    mining:     { name: '광산', icon: '\u26CF\uFE0F', kind: '과학 진보카드', cls: 'k-sci',
                  img: 'img/mining.webp', art: 'img/a-mining.webp',
                  desc: '내 건물이 닿은 산 하나당 철 두 장을 캡니다.' },
    irrigation: { name: '관개 시설', icon: '\uD83D\uDCA7', kind: '과학 진보카드', cls: 'k-sci',
                  img: 'img/irrigation.webp', art: 'img/a-irrigation.webp',
                  desc: '내 건물이 닿은 농지 하나당 밀 두 장을 거둡니다.' },
    printer:    { name: '인쇄소', icon: '\uD83D\uDDA8\uFE0F', kind: '과학 진보카드', cls: 'k-sci',
                  img: 'img/printer.webp', art: 'img/a-printer.webp',
                  desc: '받는 즉시 공개하는 승점 카드 — 1점.' },
    inventor:   { name: '발명가', icon: '\uD83D\uDCA1', kind: '과학 진보카드', cls: 'k-sci',
                  img: 'img/inventor.webp', art: 'img/a-inventor.webp',
                  desc: '숫자 칩 두 개의 자리를 맞바꿉니다. 2 · 12 · 6 · 8 은 손댈 수 없습니다.' },
    engineer:   { name: '기술자', icon: '\uD83E\uDDF1', kind: '과학 진보카드', cls: 'k-sci',
                  img: 'img/engineer.webp', art: 'img/a-engineer.webp',
                  desc: '내 도시에 성벽 하나를 공짜로 쌓습니다. 손패 한도가 두 장 늘어납니다.' },
    medicine:   { name: '의료기술', icon: '\u2695\uFE0F', kind: '과학 진보카드', cls: 'k-sci',
                  img: 'img/medicine.webp', art: 'img/a-medicine.webp',
                  desc: '철 두 장과 밀 한 장만으로 마을을 도시로 올립니다.' },
    smith:      { name: '제련술', icon: '\uD83D\uDD28', kind: '과학 진보카드', cls: 'k-sci',
                  img: 'img/smith.webp', art: 'img/a-smith.webp',
                  desc: '내 기사 둘을 공짜로 한 등급씩 승급시킵니다.' },
    roadbuild:  { name: '도로 건설', icon: '\uD83D\uDEE4\uFE0F', kind: '과학 진보카드', cls: 'k-sci',
                  img: 'img/roadbuild.webp', art: 'img/a-roadbuild.webp',
                  desc: '도로 두 개를 재료 없이 놓습니다.' },

    /* 도시와 기사 — 정치(파랑) */
    bishop:       { name: '주교', icon: '\u26EA', kind: '정치 진보카드', cls: 'k-pol',
                  img: 'img/bishop.webp', art: 'img/a-bishop.webp',
                    desc: '도둑을 옮기고, 그 땅에 닿은 상대 모두에게서 한 장씩 가져옵니다.' },
    diplomat:     { name: '외교관', icon: '\uD83E\uDD1D', kind: '정치 진보카드', cls: 'k-pol',
                  img: 'img/diplomat.webp', art: 'img/a-diplomat.webp',
                    desc: '끝이 열린 도로 하나를 없앱니다. 내 도로였다면 다른 곳에 다시 놓습니다.' },
    constitution: { name: '헌법', icon: '\uD83D\uDCDC', kind: '정치 진보카드', cls: 'k-pol',
                  img: 'img/constitution.webp', art: 'img/a-constitution.webp',
                    desc: '받는 즉시 공개하는 승점 카드 — 1점.' },
    deserter:     { name: '변절자', icon: '\uD83C\uDFF3\uFE0F', kind: '정치 진보카드', cls: 'k-pol',
                  img: 'img/deserter.webp', art: 'img/a-deserter.webp',
                    desc: '상대 기사 하나를 없애고, 같은 등급의 기사를 내 땅에 세웁니다.' },
    saboteur:     { name: '방해자', icon: '\uD83D\uDCA3', kind: '정치 진보카드', cls: 'k-pol',
                  img: 'img/saboteur.webp', art: 'img/a-saboteur.webp',
                    desc: '나보다 점수가 높거나 같은 사람은 손패의 절반을 버립니다.' },
    spy:          { name: '첩자', icon: '\uD83D\uDD75\uFE0F', kind: '정치 진보카드', cls: 'k-pol',
                  img: 'img/spy.webp', art: 'img/a-spy.webp',
                    desc: '한 사람의 진보카드를 들여다보고 그중 한 장을 가져옵니다.' },
    intrigue:     { name: '음모', icon: '\uD83C\uDF00', kind: '정치 진보카드', cls: 'k-pol',
                  img: 'img/intrigue.webp', art: 'img/a-intrigue.webp',
                    desc: '내 도로가 닿은 자리에 선 상대 기사를 밀어냅니다.' },
    wedding:      { name: '결혼', icon: '\uD83D\uDC8D', kind: '정치 진보카드', cls: 'k-pol',
                  img: 'img/wedding.webp', art: 'img/a-wedding.webp',
                    desc: '나보다 점수가 높은 사람마다 카드를 두 장씩 받습니다.' },
    warlord:      { name: '사령관', icon: '\uD83C\uDF96\uFE0F', kind: '정치 진보카드', cls: 'k-pol',
                  img: 'img/warlord.webp', art: 'img/a-warlord.webp',
                    desc: '내 기사 전부가 곡식 없이 활동 상태가 됩니다.' },

    /* 도시와 기사 — 상업(노랑) */
    merchant: { name: '상인', icon: '\uD83C\uDFEA', kind: '상업 진보카드', cls: 'k-tra',
                  img: 'img/merchant.webp', art: 'img/a-merchant.webp',
                desc: '내 건물이 닿은 땅에 상인을 놓습니다. 그 자원을 2:1로 바꾸고 승점 1점.' },
    harbor:   { name: '무역항', icon: '\u2693', kind: '상업 진보카드', cls: 'k-tra',
                  img: 'img/harbor.webp', art: 'img/a-harbor.webp',
                desc: '상대마다 내 자원 한 장을 주고 상품 한 장을 받아 옵니다.' },
    fleet:    { name: '상선대', icon: '\u26F5', kind: '상업 진보카드', cls: 'k-tra',
                  img: 'img/fleet.webp', art: 'img/a-fleet.webp',
                desc: '이번 차례 동안 고른 것 하나를 2:1로 바꿉니다.' },
    trader:   { name: '전문 상인', icon: '\uD83D\uDCBC', kind: '상업 진보카드', cls: 'k-tra',
                  img: 'img/trader.webp', art: 'img/a-trader.webp',
                desc: '나보다 점수가 높은 사람의 손을 보고 두 장을 가져옵니다.' },
    commMono: { name: '상품 독점', icon: '\uD83C\uDFED', kind: '상업 진보카드', cls: 'k-tra',
                  img: 'img/commMono.webp', art: 'img/a-commMono.webp',
                desc: '상품 하나를 골라 모든 상대에게서 한 장씩 거둡니다.' },
    resMono:  { name: '자원 독점', icon: '\uD83D\uDCE6', kind: '상업 진보카드', cls: 'k-tra',
                  img: 'img/resMono.webp', art: 'img/a-resMono.webp',
                desc: '자원 하나를 골라 모든 상대에게서 두 장씩 거둡니다.' }
  };
  var CARD_BY_NAME = {};
  Object.keys(CARD_INFO).forEach(function (k) {
    // 이름이 겹치는 '도로 건설'은 확장판 것이 뒤에 와도 설명이 같아 문제되지 않는다
    CARD_BY_NAME[CARD_INFO[k].name] = k;
  });
  function cardTip(type) {
    var c = CARD_INFO[type];
    return c ? c.name + ' — ' + c.desc : '';
  }
  // 화면 가운데에 카드를 펼쳐 보일 줄인지 — 내가 뽑았거나, 누가 꺼내 보인 카드
  function drawnCardOf(text) {
    var m = /^뽑은 카드 — (.+)$/.exec(text)
         || /^진보카드를 받았습니다 — (.+)$/.exec(text)
         || /^가져온 카드: (.+)$/.exec(text);
    if (m) return CARD_BY_NAME[m[1].trim()] || null;
    // 누군가 진보카드를 냈다 — 모두에게 공개된다
    m = /진보카드 — (.+?)(?:\s*\(|$)/.exec(text);
    return m ? (CARD_BY_NAME[m[1].trim()] || null) : null;
  }
  function myCardLine(text) {
    return /^뽑은 카드 — /.test(text) || /^진보카드를 받았습니다 — /.test(text) || /^가져온 카드: /.test(text);
  }

  // 뽑은 카드를 화면 가운데에 펼쳐 보여 준다
  function showCardReveal(type, mine) {
    var c = CARD_INFO[type], box = $('cardReveal');
    if (!c || !box) return;
    // 큰 알림이 떠 있으면 겹치지 않게 먼저 치운다
    var bn = $('bigNews');
    if (bn && !bn.classList.contains('hidden')) {
      clearTimeout(App.bigTimer); clearTimeout(App.bigHideTimer);
      bn.classList.add('hidden'); bn.classList.remove('out');
    }
    var backImg = $('crBackImg');
    if (backImg) {
      backImg.src = c.cls === 'k-sci' ? 'img/back-sci.webp'
                  : c.cls === 'k-pol' ? 'img/back-pol.webp'
                  : c.cls === 'k-tra' ? 'img/back-tra.webp' : 'img/back.webp';
    }
    var img = $('crImg'), hasImg = !!c.img;
    img.hidden = !hasImg;
    if (hasImg) img.src = c.img;
    $('crKind').hidden = hasImg;
    $('crFace').hidden = hasImg;
    $('crName').hidden = hasImg;
    $('crDesc').hidden = hasImg;
    $('crKind').textContent = c.kind;
    $('crFace').textContent = c.icon;
    $('crName').textContent = c.name;
    $('crDesc').textContent = c.desc;
    var card = box.querySelector('.crCard');
    card.className = 'crSide crCard ' + (c.cls || '') + (hasImg ? ' art' : '');
    box.classList.remove('hidden');
    var flip = $('crFlip'), wrap = box.querySelector('.crWrap');
    flip.style.animation = 'none'; wrap.style.animation = 'none';
    void flip.offsetWidth;
    flip.style.animation = ''; wrap.style.animation = '';
    clearTimeout(App.crTimer);
    App.crTimer = setTimeout(function () { box.classList.add('hidden'); },
      mine === false ? 2200 : (hasImg ? 3800 : 2600));
    box.onclick = function () { clearTimeout(App.crTimer); box.classList.add('hidden'); };
  }

  function pushFeed(v) {
    var lines = v.log || [];
    if (App.lastLogId === undefined) {
      // 첫 화면에서는 지난 줄을 몰아 보여주지 않는다
      App.lastLogId = lines.length ? lines[lines.length - 1].i : -1;
      return;
    }
    lines.forEach(function (l) {
      if (l.i <= App.lastLogId) return;
      App.lastLogId = l.i;
      if (l.text.indexOf('— ') === 0 && l.text.indexOf('차례') > 0) return;  // 큰 배너가 알려 준다
      if (l.text.indexOf('순서 주사위') >= 0) return;                         // 주사위 연출이 대신한다
      var info = readLine(l.text);
      var drew = drawnCardOf(l.text);
      App.feed.push({
        text: l.text, icon: drew ? CARD_INFO[drew].icon : info.icon,
        hold: drew ? (myCardLine(l.text) ? (CARD_INFO[drew].img ? 3800 : 2600) : 2400) : info.hold,
        big: info.big, mineCard: drew ? myCardLine(l.text) : false,
        owner: lineOwner(v, l.text), card: drew
      });
    });
    if (App.feed.length > 14) App.feed = App.feed.slice(-14);   // 너무 밀리면 앞을 버린다
    pumpFeed();
  }

  // 지금 화면이 다른 안내로 차 있는가 — 겹쳐 띄우지 않기 위해
  function overlayBusy() {
    var ids = ['diceOverlay', 'gate', 'cardReveal', 'robberSweep'];
    for (var i = 0; i < ids.length; i++) {
      var e = $(ids[i]);
      if (e && !e.classList.contains('hidden')) return true;
    }
    return false;
  }
  // 한 줄을 읽는 데 걸리는 시간 — 글자 수로 잡는다 (최소 1.2초)
  function readTime(text, base) {
    var n = (text || '').replace(/\s/g, '').length;
    return Math.max(1300, base || 0, 850 + n * 75);
  }

  function pumpFeed() {
    if (App.feedBusy || !App.feed.length) return;
    // 앞선 안내를 아직 읽는 중이면 그게 끝난 뒤에
    if (overlayBusy() || Date.now() < (App.plaqueUntil || 0)) {
      clearTimeout(App.feedWait);
      App.feedWait = setTimeout(pumpFeed, 220);
      return;
    }
    App.feedBusy = true;
    var item = App.feed.shift();
    showNow(item.icon, item.text, item.owner);
    if (item.card) showCardReveal(item.card, item.mineCard);
    else if (item.big) showBigNews(item);
    var hold = readTime(item.text, item.hold);
    if (App.feed.length > 6) hold = Math.max(1150, hold * 0.82);   // 아주 밀렸을 때만 조금 서두른다
    clearTimeout(App.feedTimer);
    App.feedTimer = setTimeout(function () {
      App.feedBusy = false;
      if (App.feed.length) pumpFeed();
      else renderNow(App.view);          // 할 말이 없으면 지금 상황으로 돌아간다
    }, hold);
  }

  function showNow(icon, text, owner) {
    var bar = $('nowBar'), dot = $('nowDot'), txt = $('nowText');
    bar.classList.remove('step');
    void bar.offsetWidth;                 // 애니메이션 다시 태우기
    bar.classList.add('step');
    dot.style.background = owner ? (PCOLOR[owner.color] || 'var(--faint)') : 'var(--faint)';
    txt.textContent = icon + '  ' + text;
    bar.classList.toggle('mine', !!(owner && App.view && owner.id === App.view.me));
    var vv = App.view;
    if (vv) {
      bar.classList.toggle('urgent', !!vv.mustDiscard[vv.me] ||
        (!!vv.trade && vv.trade.from !== vv.me && !vv.trade.replies[vv.me]));
    }
  }

  // 지금 누가 무엇을 할 차례인지 (중계할 게 없을 때)
  function renderNow(v) {
    if (!v || App.feedBusy) return;
    var bar = $('nowBar'), dot = $('nowDot'), txt = $('nowText');
    var actor = null, msg = '';
    var mine = isMyTurn(v);

    if (v.phase === 'over') {
      var w = playerIn(v, v.winner);
      showNow('\uD83C\uDFC6', w ? (w.name + ' 승리!') : '판이 끝났습니다.', w);
      return;
    }
    if (v.trade) {
      actor = playerIn(v, v.trade.from);
      var waiting = v.players.filter(function (p) {
        return !p.out && p.id !== v.trade.from && !v.trade.replies[p.id];
      });
      var yes = Object.keys(v.trade.replies).filter(function (k) { return v.trade.replies[k] === 'yes'; });
      var mineOffer = v.trade.from === v.me;
      if (waiting.length) {
        msg = (mineOffer ? '내 거래 제안' : actor.name + '의 거래 제안') + ' — ' +
          waiting.map(function (p) { return p.name; }).join(', ') + '의 답을 기다리는 중';
      } else if (yes.length) {
        msg = (mineOffer ? '내 제안' : actor.name + '의 제안') + ' — ' +
          GA(yes.map(function (k) { return (playerIn(v, k) || {}).name; }).join(', ')) + ' 받겠다고 했습니다' +
          (mineOffer ? '. 누구와 바꿀지 고르세요' : '');
      } else {
        msg = (mineOffer ? '내 제안' : actor.name + '의 제안') + ' — 모두 거절했습니다' +
          (mineOffer ? '. 조건을 바꾸거나 제안을 거두세요' : '');
      }
      if (!mineOffer && !v.trade.replies[v.me]) msg = actor.name + '의 제안 — 받을지 말지 고르세요';
    } else if (v.phase === 'order') {
      var need = v.players.filter(function (p2) {
        if (p2.out) return false;
        if (v.order.tie && v.order.tie.indexOf(p2.id) < 0) return false;
        return v.order.rolls[p2.id] === undefined;
      });
      actor = need[0] || null;
      var mineTurn = need.some(function (p2) { return p2.id === v.me; });
      msg = v.order.tie
        ? '동점! ' + GA(need.map(function (p2) { return p2.name; }).join(', ')) + ' 다시 굴립니다'
        : '순서를 정합니다 — 가장 높은 눈이 첫 번째';
      if (mineTurn) msg += ' · 내 차례입니다';
    } else if (v.phase === 'setup') {
      actor = playerIn(v, v.setup.who);
      var second = v.setup.idx >= (v.setup.half || v.players.length);
      var what = (isExt(v) && second) ? '도시' : '마을';
      msg = (actor && actor.id === v.me)
        ? '내 차례 — ' + (v.setup.sub === 'settlement' ? EUL(what) + ' 놓으세요' : '도로를 놓으세요')
        : GA(actor ? actor.name : '?') + ' 자리를 고르는 중';
    } else if (v.phase === 'discard') {
      var who = Object.keys(v.mustDiscard).map(function (pid) { return playerIn(v, pid); }).filter(Boolean);
      actor = who[0] || null;
      msg = v.mustDiscard[v.me]
        ? '내 손패가 넘칩니다 — ' + v.mustDiscard[v.me] + '장을 골라 버리세요'
        : GA(who.map(function (p) { return p.name; }).join(', ')) + ' 카드를 버리는 중';
    } else if (v.phase === 'robber') {
      actor = v.players[v.turn];
      msg = mine ? '내 차례 — 도둑을 옮길 타일을 누르세요' : GA(actor.name) + ' 도둑을 옮기는 중';
    } else if (v.phase === 'roll') {
      actor = v.players[v.turn];
      msg = mine ? '내 차례 — 주사위를 굴리세요' : GA(actor.name) + ' 주사위를 굴릴 차례';
    } else {
      actor = v.players[v.turn];
      if (v.freeRoads > 0) msg = mine ? '공짜 도로 ' + v.freeRoads + '개를 놓으세요' : GA(actor.name) + ' 도로를 놓는 중';
      else msg = mine ? '내 차례 — 짓거나 거래하세요' : GA(actor.name) + ' 짓고 거래하는 중';
    }

    bar.classList.remove('step');
    dot.style.background = actor ? (PCOLOR[actor.color] || 'var(--faint)') : 'var(--faint)';
    txt.textContent = msg;
    bar.classList.toggle('mine', mine && !v.trade);
    // 내가 지금 꼭 해야 하는 일이면 눈에 띄게 재촉한다
    var urgent = !!v.mustDiscard[v.me] ||
      (v.trade && v.trade.from !== v.me && !v.trade.replies[v.me]) ||
      (mine && v.phase === 'robber');
    bar.classList.toggle('urgent', !!urgent);
    // 남을 기다리는 중이면 점 세 개
    var wait = bar.querySelector('.nowWait');
    var waitingForOther = !mine || v.phase === 'discard' || !!v.trade;
    if (waitingForOther && !wait) {
      var w2 = el('span', 'nowWait');
      w2.appendChild(el('i')); w2.appendChild(el('i')); w2.appendChild(el('i'));
      bar.appendChild(w2);
    } else if (!waitingForOther && wait) wait.remove();
  }

  // 이번 강탈에서 오간 카드 — 당사자에게만 로그로 온다
  function stolenCard(v) {
    if (!v || !v.log) return null;
    for (var i = v.log.length - 1; i >= Math.max(0, v.log.length - 8); i--) {
      var l = v.log[i];
      if (!l.mine) continue;
      var m = /^(가져온|빼앗긴) 것: (.+)$/.exec(l.text);
      if (!m) continue;
      var nm = m[2], key = null;
      cardsOf(v).forEach(function (c) { if (resName(c) === nm) key = c; });
      return { role: m[1] === '가져온' ? 'thief' : 'victim', name: nm, key: key };
    }
    return null;
  }

  // 색이 붙은 이름표 — 누가 누구에게 했는지 한눈에
  function nameTag(p) {
    var t = el('span', 'bnName', p ? p.name : '?');
    if (p) {
      t.style.borderColor = PCOLOR[p.color] || '';
      t.style.color = PCOLOR[p.color] || '';
    }
    return t;
  }

  // 큰 소식 — 잠깐 화면 가운데에. 업적은 더 오래, 더 크게
  function showBigNews(item) {
    var box = $('bigNews'), inner = box.querySelector('.bigNewsInner');
    var text = item.text, title = text, sub = '';
    var m = text.indexOf(' — ');
    if (m > 0) { title = text.slice(0, m); sub = text.slice(m + 3); }

    var award = false;
    if (text.indexOf('최장 교역로') >= 0) {
      award = true;
      title = (item.owner ? item.owner.name : '') + ' 최장 교역로!';
      sub = '가장 긴 길을 이었습니다 — 2점';
    } else if (text.indexOf('최강 기사단') >= 0) {
      award = true;
      title = (item.owner ? item.owner.name : '') + ' 최강 기사단!';
      sub = '기사를 가장 많이 썼습니다 — 2점';
    } else if (text.indexOf('수도 건설') >= 0) {
      award = true;
      sub = '수도를 세웠습니다 — 2점';
    } else if (text.indexOf('수도를 빼앗') >= 0) {
      award = true;
      sub = '더 높이 개발해 수도를 가져왔습니다 — 2점';
    } else if (text.indexOf('야만족 상륙') >= 0) {
      title = '야만족 상륙!';
      screenShake();
      sub = text.replace(/^.*상륙!\s*/, '');
    } else if (text.indexOf('절반 버리기') >= 0) {
      var mineNeed = App.view && App.view.mustDiscard ? App.view.mustDiscard[App.view.me] : 0;
      title = mineNeed ? ('7! 내 카드 ' + mineNeed + '장을 버립니다') : '7! 카드를 버립니다';
      sub = text.replace('7 — 절반 버리기: ', '') || '손패가 8장 이상인 사람은 절반을 버립니다';
      $('bnIcon').textContent = '\uD83D\uDDD1\uFE0F';
    } else if (text.indexOf('막고 있어') >= 0) {
      title = '도둑이 막았습니다';
      sub = text.replace(/^도둑이 /, '').replace('막고 있어 ', '막고 있어\n');
    } else if (text.indexOf('독점') >= 0) {
      title = (item.owner ? item.owner.name : '') + ' 독점!';
      sub = text.replace(/^.*독점 — /, '');
    } else if (text.indexOf('가져갔습니다') >= 0) {
      // 도둑으로 카드를 빼앗았다 — 당사자에게만 무슨 카드인지 밝힌다
      var v0 = App.view;
      var st = v0 && v0.lastSteal;
      var card = stolenCard(v0);
      if (card && card.role === 'victim') {
        title = '카드를 빼앗겼습니다';
        sub = EMOJI[card.key] + ' ' + card.name + ' 한 장을 잃었습니다';
        $('bnIcon').textContent = '\uD83D\uDE23';
      } else if (card && card.role === 'thief') {
        title = '카드를 빼앗았습니다';
        sub = EMOJI[card.key] + ' ' + card.name + ' 한 장을 얻었습니다';
        $('bnIcon').textContent = '\uD83E\uDD1A';
      } else {
        title = '카드를 빼앗았습니다';
        sub = '무슨 카드인지는 두 사람만 압니다';
        $('bnIcon').textContent = '\uD83C\uDCCF';
      }
      if (st) {
        item.pair = { from: playerIn(v0, st.victim), to: playerIn(v0, st.thief), icon: '\u2192' };
      }
    } else if (text.indexOf('옮김') >= 0) {
      var v1 = App.view, rb = v1 && v1.lastRobber;
      title = GA(item.owner ? item.owner.name : '') + ' 도둑을 옮겼습니다';
      if (rb && v1.board.hexes[rb.to]) {
        var toHex = v1.board.hexes[rb.to];
        sub = toHex.number ? (toHex.number + ' 타일이 막혔습니다') : '사막으로 옮겼습니다';
      } else sub = '';
    } else if (text.indexOf('수호자') >= 0) {
      award = true;
      title = (item.owner ? item.owner.name : '') + ' 카탄의 수호자!';
      sub = '야만족을 막아낸 공로 — 승점 1';
    } else if (text.indexOf('약탈') >= 0) {
      title = '도시가 약탈당했습니다';
      sub = text.replace('의 도시가 약탈당해 마을로 내려갔습니다.', ' — 도시가 마을로');
    }

    var bnCard = $('bnCard');
    if (bnCard) {
      var awardImg = text.indexOf('최장 교역로') >= 0 ? 'img/longestroad.webp'
                   : text.indexOf('최강 기사단') >= 0 ? 'img/largestarmy.webp'
                   : text.indexOf('수호자') >= 0 ? 'img/defender.webp'
                   : text.indexOf('야만족 상륙') >= 0 ? 'img/barbarians.webp' : '';
      bnCard.hidden = !awardImg;
      if (awardImg) bnCard.src = awardImg;
    }
    $('bnIcon').textContent = item.icon;
    $('bnTitle').textContent = title;
    $('bnTitle').style.color = item.owner ? (PCOLOR[item.owner.color] || '') : '';
    $('bnSub').textContent = sub;
    // 두 사람 사이에 일어난 일이면 '누가 → 누구' 를 색으로 보여준다
    var pair = $('bnPair');
    if (pair) {
      pair.innerHTML = '';
      if (item.pair) {
        pair.appendChild(nameTag(item.pair.from));
        var arrow = el('span', 'bnArrow', item.pair.icon || '\u2192');
        pair.appendChild(arrow);
        pair.appendChild(nameTag(item.pair.to));
        pair.classList.remove('hidden');
      } else pair.classList.add('hidden');
    }
    inner.classList.toggle('award', award);
    box.classList.remove('hidden', 'out');
    clearTimeout(App.bigTimer); clearTimeout(App.bigHideTimer);
    App.bigTimer = setTimeout(function () {
      box.classList.add('out');
      App.bigHideTimer = setTimeout(function () {
        box.classList.add('hidden');
        $('bnTitle').style.color = '';
        inner.classList.remove('award');
      }, 300);
    }, award ? 2600 : (item.pair ? 2400 : 1900));
    App.plaqueUntil = Date.now() + (award ? 2600 : (item.pair ? 2400 : 1900));
  }

  // 화면 가운데 큰 알림 — 지금 무슨 단계인지 알려 주는 데 쓴다
  function showPlaque(icon, title, sub, color, hold) {
    // 주사위·관문이 떠 있거나 앞 알림을 아직 읽는 중이면 기다렸다 띄운다
    if (overlayBusy() || Date.now() < (App.plaqueUntil || 0)) {
      if ((App.plaqueWait || 0) > 26) { App.plaqueWait = 0; return; }
      App.plaqueWait = (App.plaqueWait || 0) + 1;
      setTimeout(function () { showPlaque(icon, title, sub, color, hold); }, 220);
      return;
    }
    App.plaqueWait = 0;
    var box = $('bigNews'), inner = box.querySelector('.bigNewsInner');
    var bnCard = $('bnCard');
    if (bnCard) bnCard.hidden = true;
    var pair = $('bnPair');
    if (pair) { pair.innerHTML = ''; pair.classList.add('hidden'); }
    inner.classList.remove('award');
    $('bnIcon').textContent = icon;
    $('bnTitle').textContent = title;
    $('bnTitle').style.color = color || '';
    $('bnSub').textContent = sub || '';
    box.classList.remove('hidden', 'out');
    clearTimeout(App.bigTimer); clearTimeout(App.bigHideTimer);
    App.plaqueUntil = Date.now() + hold;
    App.bigTimer = setTimeout(function () {
      box.classList.add('out');
      App.bigHideTimer = setTimeout(function () {
        box.classList.add('hidden');
        $('bnTitle').style.color = '';
      }, 300);
    }, hold);
  }

  // 떠 있는 큰 알림을 즉시 치운다
  function hidePlaque() {
    var box = $('bigNews');
    if (!box || box.classList.contains('hidden')) return;
    clearTimeout(App.bigTimer); clearTimeout(App.bigHideTimer);
    box.classList.add('hidden'); box.classList.remove('out');
    $('bnTitle').style.color = '';
    App.plaqueUntil = 0;
  }

  // 단계가 바뀔 때 한 번 멈춰서, 무슨 일이 있었고 다음에 뭘 하는지 읽고 넘어가게 한다
  function showGate(icon, title, sub, rows) {
    var box = $('gate');
    if (!box) return;
    // 명패가 아직 떠 있으면 다 읽고 나서 관문을 연다.
    // 바로 덮으면 방금 뜬 "○○의 차례" 가 0.7초 만에 사라진다.
    var leftP = (App.plaqueUntil || 0) - Date.now();
    if (leftP > 120) {
      clearTimeout(App.gateWaitTimer);
      App.gateWaitTimer = setTimeout(function () { showGate(icon, title, sub, rows); },
                                     Math.min(leftP, 2200));
      return;
    }
    $('gateIcon').textContent = icon;
    $('gateTitle').textContent = title;
    $('gateSub').textContent = sub || '';
    var list = $('gateList');
    list.innerHTML = '';
    (rows || []).forEach(function (r) {
      var row = el('div', 'gateRow');
      if (r.color) row.style.borderLeftColor = r.color;
      row.appendChild(el('span', 'grName', r.name));
      row.appendChild(el('span', 'grVal', r.val || ''));
      list.appendChild(row);
    });
    list.classList.toggle('hidden', !(rows && rows.length));
    hidePlaque();
    App.hold = true;                       // 봇은 기다린다
    clearTimeout(App.botTimer);
    box.classList.remove('hidden');
    var close = function () {
      if (box.classList.contains('hidden')) return;
      clearTimeout(App.gateTimer);
      box.classList.add('hidden');
      App.hold = false;
      render();
      scheduleBot();
    };
    $('gateBtn').onclick = close;
    box.onclick = function (e) { if (e.target === box) close(); };
    clearTimeout(App.gateTimer);
    App.gateTimer = setTimeout(close, 60000);   // 자리를 아주 오래 비웠을 때만 알아서 넘어간다
  }

  // 연출이 끝난 뒤에 관문을 띄운다. 그 사이 봇은 멈춰 있는다.
  function gateSoon(delay, icon, title, sub, rows) {
    App.hold = true;
    clearTimeout(App.botTimer); clearTimeout(App.gateSoonTimer);
    var tries = 0;
    var tick = function () {
      var ov = $('diceOverlay');
      var busy = ov && !ov.classList.contains('hidden');     // 주사위가 굴러가는 중이면 그것부터
      if (busy && tries++ < 32) { App.gateSoonTimer = setTimeout(tick, 250); return; }
      showGate(icon, title, sub, rows);
    };
    App.gateSoonTimer = setTimeout(tick, delay);
  }

  // 놓는 순서를 사람 이름으로 풀어 준다
  function setupOrderNames(v) {
    var first = v.order && v.order.first;
    var idx = 0;
    v.players.forEach(function (p, i) { if (p.id === first) idx = i; });
    var seq = [];
    for (var k = 0; k < v.players.length; k++) {
      var p = v.players[(idx + k) % v.players.length];
      if (!p.out) seq.push(p);
    }
    return seq;
  }

  // 차례가 넘어갈 때 — 누구 차례인지 확실히 알려준다
  // 좁은 화면에서 판을 크게 쓰기 위해, 지금 무엇을 하는 중인지 화면에 표시해 둔다
  function paintPlayMode(v) {
    var g = $('game');
    if (!g) return;
    var mine = v.phase === 'setup' ? (v.setup && v.setup.who === v.me) : isMyTurn(v);
    // 판에서 무언가를 골라야 하는 때 — 짓기뿐 아니라 기사 이동·진보카드 대상 고르기도 판을 크게 보여 준다
    var picking = !!(App.pickVert || App.pickHex || App.pickEdge) || (App.knightSel !== null && App.knightSel !== undefined);
    var placing = mine && (v.phase === 'setup' || v.phase === 'robber' || !!App.build || v.freeRoads > 0 || picking);
    // 순서를 정하는 동안에는 짓기 칸이 아무 쓸모가 없다 — 접어서 판에 자리를 준다
    g.classList.toggle('ordering', v.phase === 'order');
    g.classList.toggle('mine', !!mine);
    g.classList.toggle('placing', !!placing);
  }

  // 뒷면 카드를 겹쳐 몇 장인지 보여 준다 (내 것이면 앞면을 이미 아니까 숫자만)
  function backStack(n, label, mine) {
    var box = el('span', 'stCards' + (mine ? ' mine' : ''));
    box.title = label + ' ' + n + '장';
    if (!mine) {
      var show = Math.min(n, 3);
      for (var i = 0; i < show; i++) {
        var b = el('i', 'miniBack');
        b.style.marginLeft = i ? '-7px' : '0';
        b.style.zIndex = String(10 - i);
        box.appendChild(b);
      }
    } else box.appendChild(el('i', 'stIcon', label === '진보카드' ? '\uD83D\uDCDC' : '\u2699'));
    box.appendChild(el('b', 'stNum', String(n)));
    return box;
  }

  function announceTurn(v) {
    var p = v.players[v.turn];
    if (!p) return;
    var mine = p.id === v.me;
    showPlaque(mine ? '\uD83D\uDC4B' : '\u23ED\uFE0F',
      mine ? '내 차례' : p.name + '의 차례',
      mine ? '주사위를 굴려 시작하세요' : '지켜보는 차례입니다',
      PCOLOR[p.color] || '', mine ? 2200 : 1500);
  }

  // 마을·도로를 놓는 동안 — 지금 누가 놓을 차례인지
  function announceSetupTurn(v) {
    var p = playerIn(v, v.setup.who);
    if (!p) return;
    var mine = p.id === v.me;
    var round2 = v.setup.idx >= (v.setup.half || v.players.length);
    showPlaque(mine ? '\uD83C\uDFD8\uFE0F' : '\u23ED\uFE0F',
      mine ? '내 차례 — 놓을 곳을 고르세요' : GA(p.name) + ' 놓는 중',
      mine ? (round2 ? '두 번째 마을과 도로 — 이 마을 둘레의 자원을 바로 받습니다'
                    : '마을 하나와 이어진 도로 하나를 놓습니다')
           : (round2 ? '두 바퀴째는 반대 순서입니다' : '마을과 도로를 하나씩 놓습니다'),
      PCOLOR[p.color] || '', mine ? 2000 : 1400);
  }

  // 거래 — 카드가 두 사람 사이를 실제로 건너간다
  function playTradeAnim(v) {
    var t = v.lastTrade;
    if (!t) return;
    var key = t.turn + ':' + t.a + '>' + t.b + ':' + JSON.stringify(t.give) + JSON.stringify(t.want);
    if (App.tradeKey === key) return;
    App.tradeKey = key;
    var ra = chipRect(t.a), rb = chipRect(t.b);
    if (!ra || !rb) return;
    handshakeAt(ra, rb);
    var delay = 0;
    Object.keys(t.give).forEach(function (c) {
      for (var i = 0; i < t.give[c]; i++) { flyBetween(ra, rb, c, delay); delay += 130; }
    });
    Object.keys(t.want).forEach(function (c) {
      for (var i = 0; i < t.want[c]; i++) { flyBetween(rb, ra, c, delay); delay += 130; }
    });
  }
  function chipRect(pid) {
    var e = document.querySelector('.pl[data-pid="' + pid + '"]');
    if (!e) return null;
    var r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, host: e };
  }
  // 은행 교환 — 내 손패에서 나갔다가 들어온다
  function playBankAnim(v) {
    var t = v.lastBank;
    if (!t) return;
    var key = t.turn + ':' + t.p + ':' + t.give + t.rate + t.get;
    if (App.bankKey === key) return;
    App.bankKey = key;
    var from = chipRect(t.p) || null;
    var toStack = document.querySelector('.cardSlot[data-res="' + t.get + '"]');
    var giveStack = document.querySelector('.cardSlot[data-res="' + t.give + '"]');
    if (t.p === v.me && giveStack && toStack) {
      var g = giveStack.getBoundingClientRect(), h = toStack.getBoundingClientRect();
      var bankPt = { left: (g.left + h.left) / 2, top: g.top - 70, width: 0, height: 0 };
      for (var i = 0; i < t.rate; i++) flyBetween(g, bankPt, t.give, i * 90);
      flyBetween(bankPt, h, t.get, t.rate * 90 + 160);
    }
  }

  function flyBetween(fromRect, toRect, resC, delay) {
    setTimeout(function () {
      var card = el('div', 'flyCard', EMOJI[resC]);
      var x0 = fromRect.left + (fromRect.width || 0) / 2 - 15;
      var y0 = fromRect.top + (fromRect.height || 0) / 2 - 20;
      card.style.left = x0 + 'px';
      card.style.top = y0 + 'px';
      document.body.appendChild(card);
      var tx = toRect.left + (toRect.width || 0) / 2 - 15 - x0;
      var ty = toRect.top + (toRect.height || 0) / 2 - 20 - y0;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          card.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(0.6)';
        });
      });
      setTimeout(function () {
        card.style.opacity = '0';
        setTimeout(function () { card.remove(); }, 280);
        if (toRect.host) {
          toRect.host.classList.add('gotIt');
          setTimeout(function () { toRect.host.classList.remove('gotIt'); }, 520);
        }
      }, 780);
    }, delay);
  }

  // 도둑 — 어디서 어디로 갔는지 미끄러져 보여준다
  function playRobberAnim(v) {
    var t = v.lastRobber;
    if (!t) return;
    var key = t.turn + ':' + t.from + '>' + t.to + ':' + t.p;
    if (App.robberKey === key) return;
    App.robberKey = key;
    if (t.from === t.to) return;
    var a = v.board.hexes[t.from], b = v.board.hexes[t.to];
    if (!a || !b) return;
    var from = boardToScreen(px(a.X) - 27, py(a.Y) + 19);
    var to = boardToScreen(px(b.X) - 27, py(b.Y) + 19);
    // 지나간 길에 발자국
    var steps = 5;
    for (var si = 1; si <= steps; si++) {
      (function (k) {
        setTimeout(function () {
          var fx = from.x + (to.x - from.x) * (k / (steps + 1));
          var fy = from.y + (to.y - from.y) * (k / (steps + 1));
          var fp = el('div', 'footprint', '\uD83D\uDC63');
          fp.style.left = (fx - 9) + 'px'; fp.style.top = (fy - 6) + 'px';
          fp.style.transform = 'rotate(' + (Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI + 90) + 'deg)';
          document.body.appendChild(fp);
          setTimeout(function () { fp.remove(); }, 2600);
        }, k * 130);
      })(si);
    }
    var ghost = el('div', 'robberGhost', '\uD83D\uDD75\uFE0F');
    ghost.style.left = (from.x - 16) + 'px';
    ghost.style.top = (from.y - 16) + 'px';
    document.body.appendChild(ghost);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        ghost.style.transform = 'translate(' + (to.x - from.x) + 'px,' + (to.y - from.y) + 'px)';
      });
    });
    setTimeout(function () {
      ghost.style.opacity = '0';
      setTimeout(function () { ghost.remove(); }, 260);
      // 도착한 칸을 잠깐 붉게
      var poly = $('board').querySelector('.hex[data-hex="' + t.to + '"]');
      if (poly) {
        poly.classList.add('litRob');
        setTimeout(function () { poly.classList.remove('litRob'); }, 1600);
      }
    }, 760);
  }

  // 강탈 — 빼앗긴 사람에게서 훔친 사람에게 뒷면 카드가 건너간다
  function playStealAnim(v) {
    var t = v.lastSteal;
    if (!t) return;
    var key = t.turn + ':' + t.thief + '<' + t.victim;
    if (App.stealKey === key) return;
    App.stealKey = key;
    var rv = chipRect(t.victim), rt = chipRect(t.thief);
    if (!rv || !rt) return;
    var known = stolenCard(v);
    setTimeout(function () {
      var card = known && known.key
        ? el('div', 'flyCard', EMOJI[known.key])
        : el('div', 'flyCard back', '?');
      var x0 = rv.left + rv.width / 2 - 15, y0 = rv.top + rv.height / 2 - 20;
      card.style.left = x0 + 'px';
      card.style.top = y0 + 'px';
      document.body.appendChild(card);
      var tx = rt.left + rt.width / 2 - 15 - x0, ty = rt.top + rt.height / 2 - 20 - y0;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          card.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(0.6)';
        });
      });
      setTimeout(function () {
        card.style.opacity = '0';
        setTimeout(function () { card.remove(); }, 280);
      }, 800);
    }, 900);
  }

  /* ---------------- 주사위 연출 ---------------- */

  var PIP_CELLS = {
    1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9]
  };
  function dieFace(elm, n) {
    elm.innerHTML = '';
    var cells = PIP_CELLS[n] || [];
    for (var i = 1; i <= 9; i++) {
      var cell = document.createElement('span');
      if (cells.indexOf(i) >= 0) cell.appendChild(document.createElement('i'));
      elm.appendChild(cell);
    }
  }
  var diceSpin = null, diceHide = null;
  function showDiceRoll(d, roller, v, done, opts) {
    // 큰 알림이 떠 있으면 — 내가 굴린 것이면 바로 치우고(내가 누른 것이니까),
    // 떠 있는 명패를 다 읽고 나서 굴린다.
    // 내가 굴릴 때도 기다려야 한다 — 이때 지워지는 명패가 하필 "내 차례" 라서,
    // 정작 가장 중요한 알림이 0초 만에 사라졌다. (qa/run.sh pace 로 잡음)
    // 다만 내 차례는 내가 곧 굴릴 것을 아니까 남의 차례보다는 짧게 기다린다.
    var byMe = !!(roller && v && roller.id === v.me);
    var left = (App.plaqueUntil || 0) - Date.now();
    if (left > 120) {
      setTimeout(function () { showDiceRoll(d, roller, v, done, opts); },
                 Math.min(left, byMe ? 1400 : 2200));
      return;
    }
    hidePlaque();
    var forOrder = !!(opts && opts.order);
    var ov = $('diceOverlay');
    ov.classList.remove('hidden'); ov.classList.remove('out');
    $('diceSum').textContent = ''; $('diceNote').textContent = '';
    var who = $('diceWho');
    if (who) {
      who.textContent = roller ? (roller.id === (v && v.me) ? '내가 굴립니다' : GA(roller.name) + ' 굴립니다') : '';
      who.style.color = roller ? (PCOLOR[roller.color] || '') : '';
    }
    var b1 = $('bd1'), b2 = $('bd2');
    b1.classList.add('rolling'); b2.classList.add('rolling');
    clearInterval(diceSpin); clearTimeout(diceHide);
    var t0 = Date.now();
    diceSpin = setInterval(function () {
      dieFace(b1, 1 + Math.floor(Math.random() * 6));
      dieFace(b2, 1 + Math.floor(Math.random() * 6));
      if (Date.now() - t0 > 700) {
        clearInterval(diceSpin);
        b1.classList.remove('rolling'); b2.classList.remove('rolling');
        dieFace(b1, d[0]); dieFace(b2, d[1]);
        b1.classList.add('land'); b2.classList.add('land');
        setTimeout(function () { b1.classList.remove('land'); b2.classList.remove('land'); }, 400);
        var sum = d[0] + d[1];
        if (sum === 7 && !forOrder) screenShake();
        $('diceSum').textContent = d[0] + ' + ' + d[1] + ' = ' + sum;
        var note;
        if (forOrder) {
          note = '순서 주사위 — 가장 높은 눈이 첫 번째로 놓습니다';
        } else if (sum === 7) {
          note = '\uD83D\uDD75\uFE0F 도둑이 움직입니다 — 8장 이상은 절반을 버립니다';
        } else {
          var names = [];
          if (v && v.lastGain) {
            var seen = {};
            v.lastGain.forEach(function (gg) {
              if (seen[gg.p]) return;
              seen[gg.p] = 1;
              var q = playerIn(v, gg.p);
              if (q) names.push(q.name);
            });
          }
          note = names.length
            ? sum + ' 타일에서 자원 — ' + GA(names.join(', ')) + ' 받습니다'
            : sum + ' 타일 — 받는 사람이 없습니다';
        }
        $('diceNote').textContent = note;
        // 눈을 충분히 읽을 시간을 준 뒤 사라진다
        diceHide = setTimeout(function () {
          ov.classList.add('out');
          setTimeout(function () {
            ov.classList.add('hidden');
            if (done) done();                    // 다 사라지고 나서 다음 연출
          }, 340);
        }, forOrder ? 1000 : 1500);
      }
    }, 85);
  }

  // 순서 주사위 — 누가 몇을 냈는지 화면 가운데에서 굴려 보여 준다
  function showOrderRolls(prev, v) {
    var rolls = (v.order && v.order.rolls) || {};
    var seen = App.orderSeen || (App.orderSeen = {});
    // 동점으로 다시 굴리게 되면 기록을 지워 다음 굴림도 보여 준다
    Object.keys(seen).forEach(function (pid) { if (!rolls[pid]) delete seen[pid]; });
    Object.keys(rolls).forEach(function (pid) {
      var r = rolls[pid];
      var key = r.d.join('') + '/' + r.sum;
      if (seen[pid] === key) return;
      seen[pid] = key;
      var who = playerIn(v, pid);
      showDiceRoll(r.d, who, v, null, { order: true });
    });
  }

  /* ---------------- 카드 날아오기 ---------------- */

  // 판 좌표(viewBox)를 화면 좌표로 — viewBox 는 (0,0) 이 한가운데다
  function boardToScreen(x, y) {
    var svg = $('board'), rect = svg.getBoundingClientRect();
    var scale = Math.min(rect.width / 584, rect.height / 584);
    return {
      x: rect.left + rect.width / 2 + x * scale,
      y: rect.top + rect.height / 2 + y * scale
    };
  }
  function gainTarget(pid) {
    if (pid === App.view.me) {
      return null;                       // 자원별 손패 칩으로 — flyOne 에서 자원별로 찾는다
    }
    var chip = document.querySelector('.pl[data-pid="' + pid + '"]');
    return chip ? chip.getBoundingClientRect() : null;
  }
  // 7 — 지금 도둑이 앉아 있는 칸을 밝혀서 "여기를 옮긴다"를 보여준다
  function litRobber() {
    var v = App.view;
    if (!v) return;
    var poly = $('board').querySelector('.hex[data-hex="' + v.robber + '"]');
    if (poly) {
      poly.classList.add('litRob');
      setTimeout(function () { poly.classList.remove('litRob'); }, 2600);
    }
    var mine = v.mustDiscard && v.mustDiscard[v.me];
    if (mine) toast('7 — 먼저 ' + mine + '장을 버립니다.');
    else if (isMyTurn(v)) toast('7 — 도둑을 옮길 타일을 누르세요.');
  }

  // 도둑이 막아 못 받은 타일 — 붉게 짚어 준다
  function showBlocked(v) {
    var b = v.blocked;
    if (!b) return;
    var key = b.turn + ':' + b.hex;
    if (App.blockedKey === key) return;
    App.blockedKey = key;
    var poly = $('board').querySelector('.hex[data-hex="' + b.hex + '"]');
    if (poly) {
      poly.classList.add('litRob');
      setTimeout(function () { poly.classList.remove('litRob'); }, 2200);
    }
    var hex = v.board.hexes[b.hex];
    if (!hex) return;
    var pt = boardToScreen(px(hex.X), py(hex.Y));
    var mark = el('div', 'blockMark', '\uD83D\uDEAB');
    mark.style.left = (pt.x - 20) + 'px';
    mark.style.top = (pt.y - 20) + 'px';
    document.body.appendChild(mark);
    setTimeout(function () {
      mark.style.opacity = '0';
      setTimeout(function () { mark.remove(); }, 300);
    }, 1700);
  }

  function flyGains(gains) {
    var v = App.view;
    if (!v) return;
    showBlocked(v);

    // 생산한 칸을 먼저 밝힌다
    var hexes = {};
    gains.forEach(function (gGain) { hexes[gGain.hex] = true; });
    var lit = [];
    Object.keys(hexes).forEach(function (hi) {
      var poly = $('board').querySelector('.hex[data-hex="' + hi + '"]');
      if (poly) { poly.classList.add('lit'); lit.push(poly); }
      var chip = $('board').querySelector('.chipG[data-hex="' + hi + '"]');
      if (chip) { chip.classList.add('chipPop'); setTimeout(function () { chip.classList.remove('chipPop'); }, 700); }
    });

    // 점등을 눈으로 확인할 틈을 주고 카드를 보낸다
    var delay = 520;
    gains.forEach(function (gGain) {
      var hex = v.board.hexes[gGain.hex];
      if (!hex) return;
      var from = boardToScreen(px(hex.X), py(hex.Y));
      for (var i = 0; i < gGain.n; i++) {
        flyOne(from, gGain.p, gGain.res, delay);
        delay += 260;
      }
    });
    setTimeout(function () {
      lit.forEach(function (poly) { poly.classList.remove('lit'); });
    }, delay + 700);
  }
  function flyOne(from, pid, resC, delay) {
    setTimeout(function () {
      var toRect;
      if (pid === App.view.me) {
        var stack = document.querySelector('.cardSlot[data-res="' + resC + '"]');
        toRect = stack ? stack.getBoundingClientRect() : null;
      } else {
        var chip = document.querySelector('.pl[data-pid="' + pid + '"]');
        toRect = chip ? chip.getBoundingClientRect() : null;
      }
      if (!toRect) return;
      var card = el('div', 'flyCard', EMOJI[resC]);
      var x0 = from.x - 15, y0 = from.y - 20;
      card.style.left = x0 + 'px';
      card.style.top = y0 + 'px';
      document.body.appendChild(card);
      var tx = toRect.left + toRect.width / 2 - 15 - x0;
      var ty = toRect.top + toRect.height / 2 - 20 - y0;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          card.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(0.55)';
        });
      });
      setTimeout(function () {
        card.style.opacity = '0';
        setTimeout(function () { card.remove(); }, 300);
        // 받는 쪽을 잠깐 밝혀 어디로 갔는지 확실히 보이게
        var host = (pid === App.view.me)
          ? document.querySelector('.cardSlot[data-res="' + resC + '"]')
          : document.querySelector('.pl[data-pid="' + pid + '"]');
        if (host) {
          host.classList.add('gotIt');
          setTimeout(function () { host.classList.remove('gotIt'); }, 520);
        }
      }, 900);
    }, delay);
  }

  /* ---------------- 타일 풍경 — 지형마다 작은 그림 ---------------- */

  // 육각형 안에 은은하게 깔리는 풍경. 이모지·숫자 칩 아래에 놓인다.
  function scenery(terrain, cx, cy) {
    var sg = svgEl('g', { class: 'scene scene-' + terrain });
    function P(d, cls, extra) {
      var a = { d: d, class: cls };
      if (extra) for (var k in extra) a[k] = extra[k];
      return svgEl('path', a);
    }
    var i, x, y;
    if (terrain === 'forest') {
      // 나무 다섯 그루 — 세모 잎에 짧은 줄기
      var spots = [[-30, 12], [-14, 26], [24, 18], [34, -4], [-32, -14]];
      for (i = 0; i < spots.length; i++) {
        x = cx + spots[i][0]; y = cy + spots[i][1];
        var tree = svgEl('g', { class: 'tree sway', style: 'transform-origin: ' + x + 'px ' + (y + 8) + 'px' });
        tree.appendChild(P('M' + (x - 1.2) + ' ' + (y + 8) + ' h2.4 v-5 h-2.4 z', 'trunk'));
        tree.appendChild(P('M' + x + ' ' + (y - 9) + ' l7 10 h-14 z', 'leaf'));
        tree.appendChild(P('M' + x + ' ' + (y - 4) + ' l5.5 8 h-11 z', 'leaf2'));
        sg.appendChild(tree);
      }
    } else if (terrain === 'pasture') {
      // 풀 포기와 양 두 마리
      var tufts = [[-28, 20], [-10, 30], [12, 28], [30, 14], [-34, -6], [30, -12], [6, -30]];
      for (i = 0; i < tufts.length; i++) {
        x = cx + tufts[i][0]; y = cy + tufts[i][1];
        sg.appendChild(P('M' + (x - 4) + ' ' + y + ' q2 -6 4 0 q2 -6 4 0', 'grass'));
      }
      [[-18, 6], [22, -2]].forEach(function (p2) {
        x = cx + p2[0]; y = cy + p2[1];
        var sheep = svgEl('g', { class: 'sheep' });
        sheep.appendChild(svgEl('ellipse', { cx: x, cy: y, rx: 5.5, ry: 3.6, class: 'wool' }));
        sheep.appendChild(svgEl('circle', { cx: x + 5, cy: y - 0.5, r: 1.9, class: 'head' }));
        sheep.appendChild(P('M' + (x - 3) + ' ' + (y + 3) + ' v2.5 M' + (x + 2) + ' ' + (y + 3) + ' v2.5', 'legs'));
        sg.appendChild(sheep);
      });
    } else if (terrain === 'fields') {
      // 이랑 세 줄에 이삭
      for (i = 0; i < 3; i++) {
        y = cy - 18 + i * 17;
        sg.appendChild(P('M' + (cx - 34) + ' ' + y + ' q17 -5 34 0 q17 5 34 0', 'furrow'));
        for (var k = -28; k <= 28; k += 14) {
          sg.appendChild(P('M' + (cx + k) + ' ' + (y - 1) + ' v-7 m-2 3 l2 -2 l2 2', 'ear'));
        }
      }
    } else if (terrain === 'hills') {
      // 낮은 둔덕과 벽돌 가마
      sg.appendChild(P('M' + (cx - 40) + ' ' + (cy + 22) + ' q22 -22 44 0 q16 -16 36 0', 'mound'));
      sg.appendChild(P('M' + (cx - 38) + ' ' + (cy - 2) + ' q18 -18 36 0', 'mound2'));
      var kx = cx + 18, ky = cy - 8;
      sg.appendChild(svgEl('rect', { x: kx - 8, y: ky - 4, width: 16, height: 11, rx: 1.5, class: 'kiln' }));
      sg.appendChild(P('M' + (kx - 8) + ' ' + (ky + 1) + ' h16 M' + (kx - 8) + ' ' + (ky + 5) + ' h16 M' + (kx - 3) + ' ' + (ky - 4) + ' v5 M' + (kx + 3) + ' ' + (ky + 1) + ' v4', 'brickLine'));
    } else if (terrain === 'mountains') {
      // 봉우리 셋, 눈 덮인 꼭대기
      var peaks = [[-22, 8, 22], [4, -2, 30], [26, 12, 20]];
      for (i = 0; i < peaks.length; i++) {
        x = cx + peaks[i][0]; y = cy + peaks[i][1]; var h = peaks[i][2];
        sg.appendChild(P('M' + (x - h * 0.75) + ' ' + (y + 14) + ' L' + x + ' ' + (y + 14 - h) + ' L' + (x + h * 0.75) + ' ' + (y + 14) + ' z', 'peak'));
        sg.appendChild(P('M' + (x - h * 0.22) + ' ' + (y + 14 - h * 0.7) + ' L' + x + ' ' + (y + 14 - h) + ' L' + (x + h * 0.22) + ' ' + (y + 14 - h * 0.7) + ' l-3 3 l-3 -2 l-3 2 z', 'snow'));
      }
    } else if (terrain === 'desert') {
      // 모래 언덕과 선인장
      sg.appendChild(P('M' + (cx - 42) + ' ' + (cy + 18) + ' q20 -14 42 -2 q18 -10 42 4', 'dune'));
      sg.appendChild(P('M' + (cx - 44) + ' ' + (cy + 30) + ' q24 -10 46 0 q20 -8 42 2', 'dune'));
      var cxx = cx - 22, cyy = cy - 6;
      sg.appendChild(P('M' + cxx + ' ' + (cyy + 14) + ' v-22 M' + (cxx - 6) + ' ' + (cyy - 2) + ' v6 q0 3 3 3 h3 M' + (cxx + 6) + ' ' + (cyy - 6) + ' v7 q0 3 -3 3 h-3', 'cactus'));
    }
    return sg;
  }

  /* ---------------- 판 그리기 ---------------- */

  function hexPoints(cx, cy) {
    var pts = [];
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 180 * (60 * i - 90);
      pts.push((cx + S * Math.cos(a)).toFixed(1) + ',' + (cy + S * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }

  function renderBoard(v) {
    var svg = $('board');
    svg.innerHTML = '';
    // 도둑 칸에 덮을 빗금
    var defs = svgEl('defs', {});
    var pat = svgEl('pattern', { id: 'hatch', width: 9, height: 9, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.appendChild(svgEl('rect', { width: 9, height: 9, fill: '#14171f', 'fill-opacity': 0.16 }));
    pat.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 9, stroke: '#14171f', 'stroke-width': 4, 'stroke-opacity': 0.5 }));
    defs.appendChild(pat);
    // 섬이 바다 위에 살짝 떠 있는 느낌
    var flt = svgEl('filter', { id: 'isleShadow', x: '-20%', y: '-20%', width: '140%', height: '140%' });
    var sh = svgEl('feDropShadow', { dx: 0, dy: 3, stdDeviation: 3.5, 'flood-color': '#0b0e14', 'flood-opacity': 0.35 });
    flt.appendChild(sh);
    defs.appendChild(flt);
    // 타일 안쪽에 부드러운 빛 — 종이에 인쇄된 느낌
    var grad = svgEl('radialGradient', { id: 'tileLight', cx: '38%', cy: '30%', r: '75%' });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': 0.22 }));
    grad.appendChild(svgEl('stop', { offset: '60%', 'stop-color': '#fff', 'stop-opacity': 0.04 }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': 0.12 }));
    defs.appendChild(grad);
    svg.appendChild(defs);
    var g = svgEl('g', {});
    svg.appendChild(g);
    var myTurn = isMyTurn(v);

    // 바다 — 섬 둘레만 얇게 두른다 (판이 잘리지 않게)
    (function () {
      var pts = [];
      var Rr = S * 5.28;                     // 섬 바깥 반지름보다 살짝 크게
      for (var i = 0; i < 6; i++) {
        var a = Math.PI / 180 * (60 * i - 90);
        pts.push((Rr * Math.cos(a)).toFixed(1) + ',' + (Rr * Math.sin(a)).toFixed(1));
      }
      g.appendChild(svgEl('polygon', { points: pts.join(' '), class: 'seaRing' }));
      // 물결 — 섬 바깥 바다에 짧은 곡선들이 흘러간다
      var waves = svgEl('g', { class: 'waves' });
      var rows = [-236, -196, 200, 236, -120, 120];
      rows.forEach(function (yy, ri) {
        var d = '';
        for (var xx = -280; xx <= 280; xx += 28) {
          d += (xx === -280 ? 'M' : 'L') + xx + ' ' + yy + ' q7 -4 14 0 q7 4 14 0';
        }
        var w = svgEl('path', { d: d, class: 'wave', pathLength: 100 });
        w.style.animationDelay = (ri * -0.9) + 's';
        waves.appendChild(w);
      });
      // 섬 안쪽에는 물결이 보이지 않게 — 섬 모양으로 구멍을 낸다
      var mask = svgEl('mask', { id: 'seaOnly' });
      mask.appendChild(svgEl('rect', { x: -300, y: -300, width: 600, height: 600, fill: '#fff' }));
      var islePts = [];
      for (var mi = 0; mi < 6; mi++) {
        var ma = Math.PI / 180 * (60 * mi - 90);
        islePts.push((S * 4.55 * Math.cos(ma)).toFixed(1) + ',' + (S * 4.55 * Math.sin(ma)).toFixed(1));
      }
      mask.appendChild(svgEl('polygon', { points: islePts.join(' '), fill: '#000' }));
      svg.querySelector('defs').appendChild(mask);
      waves.setAttribute('mask', 'url(#seaOnly)');
      g.appendChild(waves);
    })();

    // 땅 타일 — 한 그룹으로 묶어 섬 전체에 그림자
    var isle = svgEl('g', { class: 'isle', filter: 'url(#isleShadow)' });
    g.appendChild(isle);
    v.board.hexes.forEach(function (h) {
      var cx = px(h.X), cy = py(h.Y);
      var robbedHere = h.i === v.robber;
      var hexEl = svgEl('polygon', {
        points: hexPoints(cx, cy),
        class: 'hex t-' + h.terrain + (robbedHere ? ' robbed' : '') + (introLeft(h.i * 70, 420) !== null ? ' tileIn' : ''),
        'data-hex': h.i
      });
      var tl = introLeft(h.i * 70, 420);
      if (tl !== null) hexEl.style.animationDelay = tl + 'ms';
      // 도둑 옮기기 — 내 차례면 타일을 누른다
      if (v.phase === 'robber' && myTurn && h.i !== v.robber) {
        hexEl.classList.add('robTarget');
        hexEl.addEventListener('click', function () { clickRobber(h.i); });
      }
      isle.appendChild(hexEl);
      isle.appendChild(scenery(h.terrain, cx, cy));
      // 인쇄된 종이 타일 같은 빛
      isle.appendChild(svgEl('polygon', { points: hexPoints(cx, cy), fill: 'url(#tileLight)', class: 'tileLight' }));
      if (robbedHere) {
        isle.appendChild(svgEl('polygon', { points: hexPoints(cx, cy), fill: 'url(#hatch)', class: 'robHatch' }));
      }

      // 육각형 안을 위아래로 나눠 쓴다 — 위는 자원, 아래는 숫자 칩
      var hasNum = !!h.number;
      var emo = svgEl('text', {
        x: cx, y: cy + (hasNum ? -12 : 6), 'font-size': hasNum ? 21 : 26,
        'text-anchor': 'middle', class: 'terrEmo' + (introLeft(INTRO_TILES + h.i * 55, 340) !== null ? ' chipIn' : '')
      });
      var el2 = introLeft(INTRO_TILES + h.i * 55, 340);
      if (el2 !== null) emo.style.animationDelay = el2 + 'ms';
      emo.textContent = h.res ? EMOJI[h.res] : '\uD83C\uDF35';   // 사막은 🌵
      g.appendChild(emo);

      if (hasNum) {
        var hot = h.number === 6 || h.number === 8;
        var ny = cy + 17;
        var cl = introLeft(INTRO_TILES + h.i * 55, 340);
        var chipG = svgEl('g', { class: 'chipG' + (cl !== null ? ' chipIn' : ''), 'data-hex': h.i });
        if (cl !== null) chipG.style.animationDelay = cl + 'ms';
        chipG.appendChild(svgEl('circle', { cx: cx, cy: ny, r: 14, class: 'chipC' }));
        var t = svgEl('text', { x: cx, y: ny + 5, 'font-size': 15, class: 'chipT' + (hot ? ' hot' : '') });
        t.textContent = h.number;
        chipG.appendChild(t);
        g.appendChild(chipG);
      }
    });

    // 항구 — 바닷가 부두와 선착장 다리 두 개
    v.board.ports.forEach(function (port) {
      var a = v.board.verts[port.verts[0]], b = v.board.verts[port.verts[1]];
      var hx = v.board.hexes[port.hex];
      var ax = px(a.X), ay = py(a.Y), bx0 = px(b.X), by0 = py(b.Y);
      var mx = (ax + bx0) / 2, my = (ay + by0) / 2;
      var ox = mx - px(hx.X), oy = my - py(hx.Y);          // 바다 쪽 방향
      var len = Math.hypot(ox, oy) || 1;
      ox /= len; oy /= len;
      var cx = mx + ox * 21, cy = my + oy * 21;            // 부두 중심

      var pg = svgEl('g', { class: 'port' });

      // 선착장 다리 — 꼭짓점에서 부두까지
      [[ax, ay], [bx0, by0]].forEach(function (pt) {
        var tx = cx - ox * 6, ty = cy - oy * 6;
        var vx = tx - pt[0], vy = ty - pt[1];
        var vl = Math.hypot(vx, vy) || 1;
        var nx = -vy / vl, ny = vx / vl;                   // 다리에 수직인 방향
        pg.appendChild(svgEl('line', { x1: pt[0], y1: pt[1], x2: tx, y2: ty, class: 'pierBase' }));
        pg.appendChild(svgEl('line', { x1: pt[0], y1: pt[1], x2: tx, y2: ty, class: 'pierTop' }));
        for (var t = 0.28; t <= 0.8; t += 0.26) {          // 널빤지
          var wx = pt[0] + vx * t, wy = pt[1] + vy * t;
          pg.appendChild(svgEl('line', {
            x1: wx - nx * 3, y1: wy - ny * 3, x2: wx + nx * 3, y2: wy + ny * 3, class: 'plank'
          }));
        }
      });

      // 부두 — 라벨이 읽히도록 수평으로 둔다
      var w = port.type === 'any' ? 30 : 40, hgt = 20;
      pg.appendChild(svgEl('rect', {
        x: cx - w / 2, y: cy - hgt / 2, width: w, height: hgt, rx: 4, class: 'dock'
      }));
      pg.appendChild(svgEl('line', {
        x1: cx - w / 2 + 3, y1: cy - hgt / 2 + 4.5, x2: cx + w / 2 - 3, y2: cy - hgt / 2 + 4.5, class: 'dockGrain'
      }));
      pg.appendChild(svgEl('line', {
        x1: cx - w / 2 + 3, y1: cy + hgt / 2 - 4.5, x2: cx + w / 2 - 3, y2: cy + hgt / 2 - 4.5, class: 'dockGrain'
      }));
      var label = svgEl('text', { x: cx, y: cy + 4, 'font-size': 11.5, 'text-anchor': 'middle', class: 'portT' });
      label.textContent = port.type === 'any' ? '3:1' : EMOJI[port.type] + '2:1';
      pg.appendChild(label);
      // 배 한 척이 부두 바깥에서 흔들린다
      var bxs = cx + ox * 22, bys = cy + oy * 22;
      var boat = svgEl('text', { x: bxs, y: bys + 5, 'font-size': 14, 'text-anchor': 'middle', class: 'boat' });
      boat.textContent = '\u26F5';
      boat.style.animationDelay = ((port.edge % 5) * -0.7) + 's';
      pg.appendChild(boat);
      g.appendChild(pg);

      // 항구가 걸리는 두 꼭짓점
      [[ax, ay], [bx0, by0]].forEach(function (pt) {
        g.appendChild(svgEl('circle', { cx: pt[0], cy: pt[1], r: 3.2, class: 'portDot' }));
      });
    });

    // 기사 말 — 등급과 활동 상태
    if (isExt(v)) {
      v.players.forEach(function (q) {
        (q.knights || []).forEach(function (k) {
          var vt = v.board.verts[k.v];
          if (!vt) return;
          var cx = px(vt.X), cy = py(vt.Y);
          var col = PCOLOR[q.color] || '#fff';
          var kg = svgEl('g', { class: 'knight' + (k.active ? ' act' : '') });
          kg.appendChild(svgEl('circle', { cx: cx, cy: cy, r: 11, fill: col, stroke: '#14171f', 'stroke-width': 1.6 }));
          // 깃발 — 뾰족한 부분 수가 등급
          var flag = svgEl('path', {
            d: 'M' + (cx - 1) + ' ' + (cy - 9) + ' v13',
            stroke: '#14171f', 'stroke-width': 1.6, fill: 'none'
          });
          kg.appendChild(flag);
          for (var i = 0; i < k.rank; i++) {
            kg.appendChild(svgEl('path', {
              d: 'M' + (cx - 1) + ' ' + (cy - 8 + i * 3.6) + ' l6 1.6 l-6 1.6 z',
              fill: k.active ? '#f5c542' : '#e8e2d4', stroke: '#14171f', 'stroke-width': 0.7
            }));
          }
          if (q.id === v.me && isMyTurn(v) && v.phase === 'main') {
            kg.setAttribute('class', kg.getAttribute('class') + ' mine');
            kg.style.cursor = 'pointer';
            kg.onclick = function () { clickVertex(k.v); };
          }
          if (App.knightSel === k.v) {
            kg.appendChild(svgEl('circle', { cx: cx, cy: cy, r: 15, class: 'knightSel' }));
          }
          g.appendChild(kg);
        });
      });
      // 성벽
      v.board.verts.forEach(function (vt) {
        if (!vt.wall || !vt.b) return;
        var col = PCOLOR[(playerIn(v, vt.b.p) || {}).color] || '#fff';
        g.appendChild(svgEl('path', {
          d: 'M' + (px(vt.X) - 13) + ' ' + (py(vt.Y) + 9) + ' h26',
          stroke: col, 'stroke-width': 4, 'stroke-linecap': 'round', class: 'wallMark'
        }));
      });
      // 상인 말
      if (v.merchant) {
        var mh = v.board.hexes[v.merchant.hex];
        if (mh) {
          var mx = px(mh.X) + 26, my = py(mh.Y) - 20;
          g.appendChild(svgEl('circle', { cx: mx, cy: my, r: 11, class: 'merchantMark' }));
          var mt = svgEl('text', { x: mx, y: my + 4, 'font-size': 11, 'text-anchor': 'middle', class: 'chipT' });
          mt.textContent = '商';
          g.appendChild(mt);
        }
      }
    }

    // 방금 지은 것 — 어디에 놓았는지 눈에 걸리게
    (v.recent || []).forEach(function (r) {
      if (r.p === v.me) return;                          // 내가 지은 건 이미 안다
      var pc = PCOLOR[(playerIn(v, r.p) || {}).color] || '#fff';
      if (r.kind === 'road') {
        var e = v.board.edges[r.id];
        if (!e) return;
        var a = v.board.verts[e.a], b = v.board.verts[e.b];
        g.appendChild(svgEl('line', {
          x1: px(a.X), y1: py(a.Y), x2: px(b.X), y2: py(b.Y),
          class: 'justBuiltRoad', stroke: pc
        }));
      } else {
        var vt = v.board.verts[r.id];
        if (!vt) return;
        g.appendChild(svgEl('circle', {
          cx: px(vt.X), cy: py(vt.Y), r: 17, class: 'justBuilt', stroke: pc
        }));
      }
    });

    // 도둑 — 숫자 칩 왼쪽에 세운다. 칩은 그대로 보인다
    (function () {
      var h = v.board.hexes[v.robber];
      var cx = px(h.X) + (h.number ? -27 : 0), cy = py(h.Y) + (h.number ? 19 : 10);
      g.appendChild(svgEl('circle', { cx: cx, cy: cy - 1, r: 14, fill: '#14171f', 'fill-opacity': 0.55, class: 'robHatch' }));
      var path = svgEl('path', {
        d: 'M' + cx + ' ' + (cy - 11) + ' a6.5 6.5 0 0 1 6.5 6.5 c0 2.8 -1.5 4.2 -1.5 6.5 h-10 c0 -2.3 -1.5 -3.7 -1.5 -6.5 a6.5 6.5 0 0 1 6.5 -6.5 z ' +
           'M' + (cx - 7.5) + ' ' + (cy + 4) + ' h15 l2.8 7.5 h-20.6 z',
        class: 'robber'
      });
      g.appendChild(path);
    })();

    // 도로 — 갓돌을 두른 길바닥에 짧은 침목을 깐다
    v.board.edges.forEach(function (e) {
      if (!e.road) return;
      var a = v.board.verts[e.a], b = v.board.verts[e.b];
      var col = PCOLOR[(playerIn(v, e.road) || {}).color] || '#fff';
      var ax0 = px(a.X), ay0 = py(a.Y), bx0 = px(b.X), by0 = py(b.Y);
      var dx = bx0 - ax0, dy = by0 - ay0, len = Math.hypot(dx, dy) || 1;
      var ux = dx / len, uy = dy / len, pad = len * 0.15;
      var x1 = ax0 + ux * pad, y1 = ay0 + uy * pad;
      var x2 = bx0 - ux * pad, y2 = by0 - uy * pad;
      var rg = svgEl('g', { class: 'roadG' });
      (v.recent || []).forEach(function (r) {
        if (r.kind !== 'road' || r.id !== e.i) return;
        if (isFresh(r)) rg.classList.add('roadDraw');
      });
      // 갓돌 — 길 양옆의 어두운 턱
      rg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'roadEdge', pathLength: 1 }));
      // 노반과 포장
      rg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'roadBed', stroke: shade(col, 0.6), pathLength: 1 }));
      rg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'roadTop', stroke: col, pathLength: 1 }));
      // 윗면 하이라이트 — 빛 받는 쪽
      rg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'roadShine', stroke: shade(col, 1.35), pathLength: 1 }));
      // 가운데 차선
      rg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: 'roadLane', pathLength: 1 }));
      g.appendChild(rg);
    });

    // 지을 수 있는 자리 표시
    var mode = buildModeNow(v);
    if (mode === 'road') {
      v.legal.roads.forEach(function (ei) {
        var e = v.board.edges[ei];
        var a = v.board.verts[e.a], b = v.board.verts[e.b];
        var ax = px(a.X), ay = py(a.Y), bx2 = px(b.X), by2 = py(b.Y);
        var t = 0.22;
        var line = svgEl('line', {
          x1: ax + (bx2 - ax) * t, y1: ay + (by2 - ay) * t,
          x2: bx2 + (ax - bx2) * t, y2: by2 + (ay - by2) * t,
          'stroke-width': 16, class: 'edgeHit'
        });
        line.addEventListener('click', function () { clickEdge(ei); });
        g.appendChild(line);
      });
    } else if (mode === 'settlement') {
      v.legal.settlements.forEach(function (vi) {
        var vert = v.board.verts[vi];
        var halo = svgEl('circle', { cx: px(vert.X), cy: py(vert.Y), r: 9, class: 'spotHalo' });
        halo.style.animationDelay = ((vi % 7) * 0.14) + 's';
        g.appendChild(halo);
        var c = svgEl('circle', { cx: px(vert.X), cy: py(vert.Y), r: 9.5, class: 'spotDot' });
        g.appendChild(c);
        // 손가락으로 누를 수 있게 보이지 않는 넓은 과녁을 덧댄다
        var hit = svgEl('circle', { cx: px(vert.X), cy: py(vert.Y), r: 19, class: 'spotHit' });
        hit.addEventListener('click', function () { clickVertex(vi); });
        g.appendChild(hit);
      });
    }

    // 확장판 · 진보카드 — 판에서 대상을 고르는 모드. 클릭은 clickVertex/clickEdge/clickRobber 가
    // 처리하지만 과녁을 그려 주지 않으면 누를 곳이 없어 기사·성벽·카드를 쓸 수가 없었다.
    var pick = pickTargets(v, mode);
    (pick.hexes || []).forEach(function (hi) {
      var h = v.board.hexes[hi];
      var sel = App.pickHex && App.pickHex.first === hi;
      var poly = svgEl('polygon', { points: hexPoints(px(h.X), py(h.Y)), class: 'hexPick' + (sel ? ' on' : '') });
      poly.addEventListener('click', function () { clickRobber(hi); });
      g.appendChild(poly);
    });
    (pick.edges || []).forEach(function (ei) {
      var e = v.board.edges[ei];
      var a = v.board.verts[e.a], b = v.board.verts[e.b];
      var line = svgEl('line', { x1: px(a.X), y1: py(a.Y), x2: px(b.X), y2: py(b.Y), 'stroke-width': 16, class: 'edgeHit edgePick' });
      line.addEventListener('click', function () { clickEdge(ei); });
      g.appendChild(line);
    });
    (pick.verts || []).forEach(function (vi) {
      var vert = v.board.verts[vi];
      var halo = svgEl('circle', { cx: px(vert.X), cy: py(vert.Y), r: 11, class: 'spotHalo' });
      halo.style.animationDelay = ((vi % 7) * 0.14) + 's';
      g.appendChild(halo);
      g.appendChild(svgEl('circle', { cx: px(vert.X), cy: py(vert.Y), r: 10, class: 'spotDot pickDot' }));
      pick.late.push(function () {                  // 건물·기사 위에 얹어야 눌린다
        var hit = svgEl('circle', { cx: px(vert.X), cy: py(vert.Y), r: 19, class: 'spotHit' });
        hit.addEventListener('click', function () { clickVertex(vi); });
        g.appendChild(hit);
      });
    });

    // 건물
    v.board.verts.forEach(function (vert) {
      if (!vert.b) return;
      var p = playerIn(v, vert.b.p);
      var cx = px(vert.X), cy = py(vert.Y);
      var col = PCOLOR[p.color];
      var roof = shade(col, 0.62), wallHi = shade(col, 1.18);
      var shape = svgEl('g', { class: 'bld bldG' });
      if (vert.b.t === 'settlement') {
        // 마을 — 작고 낮은 오두막 하나
        shape.appendChild(svgEl('rect', { x: cx - 5.5, y: cy - 1, width: 11, height: 8, fill: col, class: 'bld' }));
        shape.appendChild(svgEl('path', {
          d: 'M' + (cx - 7.5) + ' ' + (cy - 0.4) + ' L' + cx + ' ' + (cy - 7.5) + ' L' + (cx + 7.5) + ' ' + (cy - 0.4) + ' z',
          fill: roof, class: 'bld'
        }));
        shape.appendChild(svgEl('rect', { x: cx - 1.5, y: cy + 2.4, width: 3, height: 4.6, rx: 1, fill: '#1a1410', stroke: 'none' }));
      } else {
        // 도시 — 성벽 위에 탑 둘과 본채. 마을보다 확실히 크고 높다
        // 바닥 성벽
        shape.appendChild(svgEl('rect', { x: cx - 14, y: cy + 1, width: 28, height: 8, fill: wallHi, class: 'bld' }));
        // 성가퀴
        for (var bi = 0; bi < 5; bi++) {
          shape.appendChild(svgEl('rect', {
            x: cx - 14 + bi * 5.6, y: cy - 1.6, width: 3.4, height: 3, fill: wallHi, class: 'bld'
          }));
        }
        // 왼쪽 큰 탑
        shape.appendChild(svgEl('rect', { x: cx - 13, y: cy - 13, width: 10, height: 14, fill: col, class: 'bld' }));
        shape.appendChild(svgEl('path', {
          d: 'M' + (cx - 15) + ' ' + (cy - 12.4) + ' L' + (cx - 8) + ' ' + (cy - 21) + ' L' + (cx - 1) + ' ' + (cy - 12.4) + ' z',
          fill: roof, class: 'bld'
        }));
        // 오른쪽 작은 탑
        shape.appendChild(svgEl('rect', { x: cx + 2, y: cy - 8, width: 9, height: 9, fill: col, class: 'bld' }));
        shape.appendChild(svgEl('path', {
          d: 'M' + cx + ' ' + (cy - 7.4) + ' L' + (cx + 6.5) + ' ' + (cy - 15) + ' L' + (cx + 13) + ' ' + (cy - 7.4) + ' z',
          fill: roof, class: 'bld'
        }));
        // 창문과 성문
        shape.appendChild(svgEl('rect', { x: cx - 10.6, y: cy - 10, width: 3, height: 3.6, rx: 0.7, fill: '#1a1410', stroke: 'none' }));
        shape.appendChild(svgEl('rect', { x: cx - 6, y: cy - 10, width: 3, height: 3.6, rx: 0.7, fill: '#1a1410', stroke: 'none' }));
        shape.appendChild(svgEl('rect', { x: cx + 5, y: cy - 5.4, width: 3, height: 3.4, rx: 0.7, fill: '#1a1410', stroke: 'none' }));
        shape.appendChild(svgEl('path', {
          d: 'M' + (cx - 2.6) + ' ' + (cy + 9) + ' v-4.4 a2.6 2.6 0 0 1 5.2 0 V' + (cy + 9) + ' z',
          fill: '#1a1410', stroke: 'none'
        }));
        // 깃대
        shape.appendChild(svgEl('line', { x1: cx - 8, y1: cy - 21, x2: cx - 8, y2: cy - 26, stroke: '#0b0e14', 'stroke-width': 1.1 }));
        shape.appendChild(svgEl('path', { d: 'M' + (cx - 8) + ' ' + (cy - 26) + ' h6 l-1.9 2.1 1.9 2.1 h-6 z', fill: roof, stroke: 'none' }));
      }
      // 굴뚝 연기 — 사람이 사는 느낌
      (function () {
        var chimneys = vert.b.t === 'city' ? [[cx - 3, cy - 20], [cx + 8, cy - 12]] : [[cx + 4, cy - 9]];
        chimneys.forEach(function (ch, ci) {
          for (var k = 0; k < (vert.b.t === 'city' ? 3 : 2); k++) {
            var puff = svgEl('circle', { cx: ch[0], cy: ch[1], r: vert.b.t === 'city' ? 2.2 : 1.6, class: 'smoke' });
            puff.style.animationDelay = (-(k * 1.1 + ci * 0.6)) + 's';
            shape.appendChild(puff);
          }
        });
      })();
      // 방금 지어졌으면 툭 떨어지는 연출 (한 번만)
      (v.recent || []).forEach(function (r) {
        if (r.kind === 'road' || r.id !== vert.i) return;
        if (r.kind !== vert.b.t) return;
        if (!isFresh(r)) return;
        shape.classList.add('bldDrop');
        var dust = svgEl('circle', { cx: cx, cy: cy + 8, r: 3, class: 'dust' });
        g.appendChild(dust);
        setTimeout(function () { dust.remove(); }, 800);
      });
      // 도시 올리기 모드 — 내 마을을 누른다
      if (mode === 'city' && vert.b.p === v.me && vert.b.t === 'settlement') {
        shape.classList.add('pick');
        var halo = svgEl('circle', { cx: cx, cy: cy, r: 13, class: 'spotDot', 'fill-opacity': 0.25 });
        halo.addEventListener('click', function () { clickVertex(vert.i); });
        g.appendChild(halo);
        shape.addEventListener('click', function () { clickVertex(vert.i); });
      }
      g.appendChild(shape);
    });
    pick.late.forEach(function (f) { f(); });
  }

  /** 판에서 누를 대상 — 기사·성벽 짓기, 기사 이동, 진보카드 */
  function pickTargets(v, mode) {
    var out = { verts: null, edges: null, hexes: null, late: [] };
    if (!isMyTurn(v) || !v.legal) return out;
    if (App.pickVert) out.verts = App.pickVert.list;
    else if (App.pickEdge) out.edges = v.legal.openRoads || [];
    else if (App.pickHex) out.hexes = hexTargets(v, App.pickHex);
    else if (App.knightSel !== null && App.knightSel !== undefined) out.verts = (v.legal.knightMoves || {})[App.knightSel] || [];
    else if (mode === 'knight') out.verts = v.legal.knightSpots || [];
    else if (mode === 'wall') out.verts = v.legal.walls || [];
    return out;
  }
  function hexTargets(v, pk) {
    var out = [];
    v.board.hexes.forEach(function (h, i) {
      if (pk.kind === 'inventor') { if (pk.list.indexOf(i) >= 0) out.push(i); }
      else if (pk.kind === 'bishop') { if (i !== v.robber) out.push(i); }
      else if (pk.kind === 'merchant') {
        if (h.res && h.corners.some(function (vi) { var b = v.board.verts[vi].b; return b && b.p === v.me; })) out.push(i);
      }
    });
    return out;
  }

  // 지금 판에서 자리를 보여줄 모드
  function buildModeNow(v) {
    if (!isMyTurn(v)) return null;
    if (v.phase === 'setup') return v.setup.sub === 'settlement' ? 'settlement' : 'road';
    if ((v.phase === 'main' || v.phase === 'roll') && v.freeRoads > 0) return 'road';   // 주사위 전에 쓴 도로 건설 카드
    if (v.phase === 'main') return App.build;
    return null;
  }

  function clickVertex(vi) {
    var v = App.view;
    // 진보카드가 자리를 고르는 중
    if (App.pickVert) {
      var pk = App.pickVert;
      if (pk.list.indexOf(vi) < 0) { toast('고를 수 있는 자리가 아닙니다.'); return; }
      App.pickVert = null;
      act('playCard', [pk.kind, [vi]]);
      return;
    }
    // 기사 조작
    if (isExt(v)) {
      var p = meOf(v);
      var mine = (p.knights || []).filter(function (k) { return k.v === vi; })[0];
      if (App.knightSel !== null && App.knightSel !== undefined) {
        var from = App.knightSel;
        App.knightSel = null;
        act('moveKnight', [from, vi]);
        return;
      }
      if (mine) { openKnightMenu(v, mine); return; }
      if (App.build === 'knight') {
        if (v.legal.knightSpots.indexOf(vi) < 0) { toast('내 도로가 닿은 빈 꼭짓점에만 놓을 수 있습니다.'); return; }
        App.build = null;
        act('placeKnight', [vi]);
        return;
      }
      if (App.build === 'wall') {
        App.build = null;
        act('build', ['wall', vi]);
        return;
      }
    }
    if (v.phase === 'setup') { act('placeSettlement', [vi]); return; }
    if (App.build === 'settlement') { act('build', ['settlement', vi]); App.build = null; return; }
    if (App.build === 'city') { act('build', ['city', vi]); App.build = null; return; }
  }
  function clickEdge(ei) {
    var v = App.view;
    if (App.pickEdge) {
      App.pickEdge = null;
      act('playCard', ['diplomat', [ei]]);
      return;
    }
    if (v.phase === 'setup') { act('placeRoad', [ei]); return; }
    // 공짜 도로가 남아 있으면 계속 놓는다. 아니면 한 번 짓고 모드를 푼다.
    if (v.freeRoads <= 1) App.build = null;
    act('build', ['road', ei]);
  }
  function clickRobber(hex) {
    if (App.pickHex) {
      var pk = App.pickHex;
      if (pk.kind === 'inventor') {
        if (pk.list.indexOf(hex) < 0) { toast('2 · 12 · 6 · 8 은 바꿀 수 없습니다.'); return; }
        if (pk.first === null) { pk.first = hex; toast('바꿀 다른 칩을 누르세요.'); render(); return; }
        if (pk.first === hex) { toast('다른 칩을 골라 주세요.'); return; }
        var a = pk.first;
        App.pickHex = null;
        act('playCard', ['inventor', [a, hex]]);
        return;
      }
      App.pickHex = null;
      act('playCard', [pk.kind, [hex]]);
      return;
    }
    var v = App.view;
    // 피해자 후보 — 공개 정보(카드 수)로 판단할 수 있다
    var owners = {};
    v.board.hexes[hex].corners.forEach(function (vi) {
      var b = v.board.verts[vi].b;
      if (!b || b.p === v.me) return;
      var p = playerIn(v, b.p);
      if (p && !p.out && p.cards > 0) owners[b.p] = true;
    });
    var cands = Object.keys(owners);
    if (cands.length <= 1) { act('moveRobber', [hex, cands[0] || null]); return; }
    openPick('누구에게서 가져올까요?', '', cands.map(function (pid) {
      var p = playerIn(v, pid);
      return { label: p.name + ' (' + p.cards + '장)', fn: function () { act('moveRobber', [hex, pid]); } };
    }));
  }

  /* ---------------- 위쪽 — 플레이어 ---------------- */

  function renderPlayers(v) {
    var box = $('players');
    box.innerHTML = '';
    v.players.forEach(function (p, i) {
      var d = el('div', 'pl' + (p.out ? ' out' : ''));
      d.dataset.pid = p.id;
      d.style.borderLeftColor = PCOLOR[p.color];
      var isTurn;
      if (v.phase === 'order') {
        isTurn = (!v.order.tie || v.order.tie.indexOf(p.id) >= 0) && v.order.rolls[p.id] === undefined;
      } else if (v.phase === 'setup') isTurn = v.setup.who === p.id;
      else isTurn = v.turn === i;
      isTurn = isTurn && v.phase !== 'over';
      if (isTurn) {
        d.classList.add('turn');
        d.classList.add(p.id === v.me ? 'turnMine' : 'turnOther');
        var mark = el('span', 'turnMark', '\u25B6');
        mark.style.color = PCOLOR[p.color];
        mark.title = '지금 차례';
        d.appendChild(mark);
      }
      // 내 색깔 말 — 작은 집 모양
      var pawn = document.createElementNS(SVGNS, 'svg');
      pawn.setAttribute('viewBox', '0 0 16 16'); pawn.setAttribute('class', 'pawn');
      var pawnBody = document.createElementNS(SVGNS, 'path');
      pawnBody.setAttribute('d', 'M2 8 L8 2 L14 8 V14 H2 Z');
      pawnBody.setAttribute('fill', PCOLOR[p.color]); pawnBody.setAttribute('stroke', '#2b2419'); pawnBody.setAttribute('stroke-width', '1.2');
      pawn.appendChild(pawnBody);
      d.appendChild(pawn);
      var nm = el('span', 'nm', p.name);
      d.appendChild(nm);
      if (p.id === v.me) d.appendChild(el('span', 'meTag', '나'));
      if (isTurn) d.appendChild(el('span', 'turnTag', p.id === v.me ? '내 차례' : '차례'));
      // 남의 차례면 말풍선 — 지금 뭘 하는지
      if (isTurn && p.id !== v.me && v.phase !== 'over') {
        var what = v.phase === 'order' ? '주사위 굴리는 중'
          : v.phase === 'setup' ? '자리 고르는 중'
          : v.phase === 'roll' ? '주사위 굴리는 중'
          : v.phase === 'robber' ? '도둑 옮기는 중'
          : v.phase === 'discard' ? '카드 버리는 중'
          : v.trade ? '거래 고르는 중' : '생각 중';
        var bub = el('span', 'think');
        bub.appendChild(el('span', null, what));
        var dots = el('i'); dots.appendChild(el('b')); dots.appendChild(el('b')); dots.appendChild(el('b'));
        bub.appendChild(dots);
        d.appendChild(bub);
      }
      // 기본판은 승점 카드가 비밀이라 본인만 vpFull 을 받고, 확장판은 모두 받는다
      d.appendChild(el('span', 'vp', (p.vpFull !== undefined ? p.vpFull : p.vp) + '점'));
      var cardIc = el('span', 'st');
      cardIc.appendChild(el('i', 'cardIc'));
      cardIc.appendChild(document.createTextNode(String(p.cards)));
      cardIc.title = '자원 카드';
      d.appendChild(cardIc);
      // 남의 손에 든 카드는 뒷면으로 — 몇 장인지만 보인다
      if (!isExt(v) && p.devCount) d.appendChild(backStack(p.devCount, '발전 카드', p.id === v.me));
      if (isExt(v) && p.cardCount) d.appendChild(backStack(p.cardCount, '진보카드', p.id === v.me));
      if (!isExt(v) && p.knights) { var kn = el('span', 'st', '⚔' + p.knights); kn.title = '쓴 기사'; d.appendChild(kn); }
      // 남은 말 — 도로 / 마을 / 도시
      var left = el('span', 'left');
      left.title = '남은 말 — 도로 ' + p.left.road + ' · 마을 ' + p.left.settlement + ' · 도시 ' + p.left.city;
      left.textContent = p.left.road + '/' + p.left.settlement + '/' + p.left.city;
      d.appendChild(left);
      if (v.longest.p === p.id) d.appendChild(el('span', 'badge', '교역로'));
      if (!isExt(v) && v.army && v.army.p === p.id) d.appendChild(el('span', 'badge', '기사단'));
      if (p.roadLen >= 3 && v.longest.p !== p.id) {
        var rl = el('span', 'st road', '\uD83D\uDEE3' + p.roadLen);
        rl.title = '이어진 도로 ' + p.roadLen + '개 — 5개부터 최장 교역로';
        d.appendChild(rl);
      }
      if (isExt(v)) {
        var mm = 0;
        CK.TRACKS.forEach(function (t) { if (p.metro[t]) mm++; });
        if (mm) d.appendChild(el('span', 'badge', '수도' + (mm > 1 ? ' ' + mm : '')));
        if (p.power) d.appendChild(el('span', 'st', '⚔' + p.power));
      }
      box.appendChild(d);
    });
    var dice = $('dice');
    if (v.dice) {
      dice.classList.remove('hidden');
      $('die1').textContent = v.dice[0];
      $('die2').textContent = v.dice[1];
      $('dsum').textContent = '= ' + (v.dice[0] + v.dice[1]);
    } else dice.classList.add('hidden');
  }

  /* ---------------- 아래쪽 — 손패와 행동 ---------------- */

  function renderHand(v) {
    var outer = $('hand');
    outer.innerHTML = '';
    var p = meOf(v);
    if (!p || p.res === undefined) return;
    var discarding = v.phase === 'discard' && v.mustDiscard[v.me];
    // 카드 묶음 — 이 안의 것만 가운데 정렬에 들어간다
    var box = el('div', 'handCards');
    outer.appendChild(box);

    cardsOf(v).forEach(function (c) {
      var n = p.res[c] || 0;
      var picked = App.discardSel.filter(function (x) { return x === c; }).length;
      var slot = el('div', 'cardSlot' + (n ? '' : ' empty') +
        (isExt(v) && CK.COM.indexOf(c) >= 0 ? ' com' : ''));
      slot.dataset.res = c;
      slot.title = resName(c) + ' ' + n + '장';

      // 실제 카드처럼 겹쳐 쌓는다 (많으면 다섯 장까지만 보여주고 숫자로)
      var fan = el('div', 'fan');
      var show = Math.min(n, 5);
      fan.style.setProperty('--mid', (show - 1) / 2);
      for (var i = 0; i < show; i++) {
        var card = el('div', 'resCard r-' + c);
        card.style.setProperty('--i', i);
        var taken = discarding && picked > (show - 1 - i);
        if (taken) card.classList.add('taken');
        card.appendChild(el('span', 'resFace', EMOJI[c]));
        card.appendChild(el('span', 'resName', resName(c)));
        fan.appendChild(card);
      }
      if (!n) {
        var ghost = el('div', 'resCard ghost r-' + c);
        ghost.style.setProperty('--i', 0);
        ghost.appendChild(el('span', 'resFace', EMOJI[c]));
        ghost.appendChild(el('span', 'resName', resName(c)));
        fan.appendChild(ghost);
      }
      slot.appendChild(fan);

      var cnt = el('span', 'cardCount' + (n ? '' : ' zero'));
      cnt.textContent = discarding && picked ? (n - picked) + '/' + n : String(n);
      slot.appendChild(cnt);

      if (discarding && n > 0) {
        slot.classList.add('selectable');
        if (picked) slot.classList.add('sel');
        slot.onclick = function () {
          var need = v.mustDiscard[v.me];
          if (picked < n && App.discardSel.length < need) App.discardSel.push(c);
          else App.discardSel = App.discardSel.filter(function (x, i2) {
            return !(x === c && i2 === App.discardSel.indexOf(c));
          });
          render();
        };
      }
      box.appendChild(slot);
    });

    // 7이 나오면 버려야 하는 상태를 미리 경고한다
    var total = 0;
    cardsOf(v).forEach(function (c) { total += p.res[c] || 0; });
    var limit = isExt(v) ? (p.handLimit || 7) : R.HAND_LIMIT;
    if (!discarding && total > limit) {
      // 정렬을 흔들지 않게 묶음 밖에 절대 위치로 붙인다
      var warn = el('button', 'handWarn', '!');
      warn.type = 'button';
      warn.setAttribute('aria-label', '손패 한도 경고');
      warn.dataset.tip = '손패 ' + total + '장 — 7이 나오면 ' + Math.floor(total / 2) + '장을 버립니다.\n한도는 ' +
        limit + '장' + (isExt(v) ? ' (성벽 하나마다 +2)' : '') + '입니다.';
      warn.onclick = function () { toast(warn.dataset.tip.replace('\n', ' ')); };
      box.appendChild(warn);
    }

    // 발전·진보카드 칩은 자원 카드와 줄을 나눈다 — 서로 밀어내지 않게
    var chipRow = el('div', 'handChips');
    outer.appendChild(chipRow);
    box = chipRow;
    if (isExt(v)) {
      (p.cardList || []).forEach(function (c) {
        var b = el('button', 'devchip trk-' + c.track, CK.CARD_NAME[c.type]);
        var cart = CARD_INFO[c.type] && CARD_INFO[c.type].art;
        if (cart) {
          var cthumb = document.createElement('img');
          cthumb.className = 'chipArt'; cthumb.src = cart; cthumb.alt = '';
          b.insertBefore(cthumb, b.firstChild);
        }
        b.title = cardTip(c.type) || (CK.TRACK_NAME[c.track] + ' 진보카드');
        b.onclick = function () { playProgressUI(c.type); };
        box.appendChild(b);
      });
      if (p.vpCards) box.appendChild(el('span', 'devchip vp', '승점 ' + p.vpCards));
      if (p.defender) box.appendChild(el('span', 'devchip vp', '수호자 ' + p.defender));
      return;
    }

    (p.dev || []).forEach(function (d) {
      var b = el('button', 'devchip' + (d.fresh ? ' fresh' : ''), R.DEV_NAME[d.type]);
      var art = CARD_INFO[d.type] && CARD_INFO[d.type].art;
      if (art) {
        var thumb = document.createElement('img');
        thumb.className = 'chipArt'; thumb.src = art; thumb.alt = '';
        b.insertBefore(thumb, b.firstChild);
      }
      b.title = cardTip(d.type);
      if (d.type === 'vp') { b.classList.remove('fresh'); b.title = '승점 1점 — 그냥 점수로 들어갑니다'; b.onclick = function () { toast('승점 카드는 쓰는 카드가 아닙니다. 점수에 이미 들어가 있습니다.'); }; }
      else if (d.fresh) { b.title = cardTip(d.type) + '\n(산 턴에는 쓸 수 없습니다)'; b.onclick = function () { toast('산 턴에는 쓸 수 없습니다.'); }; }
      else b.onclick = function () { playDevUI(d.type); };
      box.appendChild(b);
    });
  }



  function playDevUI(type) {
    var v = App.view;
    if (!isMyTurn(v)) { toast('내 차례에만 쓸 수 있습니다.'); return; }
    if (v.playedDev) { toast('발전 카드는 한 턴에 하나만 씁니다.'); return; }
    if (type === 'knight' || type === 'road') { act('playDev', [type, []]); return; }
    if (type === 'monopoly') {
      openPick('독점 — 어떤 자원을 거둘까요?', '모든 사람의 그 자원을 전부 가져옵니다.', RES.map(function (c) {
        return { label: resName(c), res: c, fn: function () { act('playDev', ['monopoly', [c]]); } };
      }));
      return;
    }
    if (type === 'plenty') {
      var first = null;
      // 은행에 남은 것만 고를 수 있게, 몇 장 남았는지도 보여 준다
      var left = function (c) { return (v.bank && v.bank[c] !== undefined) ? v.bank[c] : 19; };
      openPick('자원 발견 — 첫 장', '은행에서 두 장을 가져옵니다.',
        RES.filter(function (c) { return left(c) > 0; }).map(function (c) {
          return { label: resName(c) + ' (은행에 ' + left(c) + ')', res: c, fn: function () {
            first = c;
            openPick('자원 발견 — 둘째 장', resName(first) + '을(를) 골랐습니다. 한 장 더 고르세요.',
              RES.filter(function (c2) { return left(c2) - (c2 === first ? 1 : 0) > 0; }).map(function (c2) {
                return { label: resName(c2) + ' (은행에 ' + (left(c2) - (c2 === first ? 1 : 0)) + ')', res: c2,
                         fn: function () { act('playDev', ['plenty', [first, c2]]); } };
              }));
          } };
        }));
    }
  }

  /* ---------------- 도시와 기사 — 전용 화면 ---------------- */

  // 내 기사를 누르면 할 수 있는 일을 보여준다
  function openKnightMenu(v, k) {
    var p = meOf(v);
    var opts = [];
    var rankName = k.rank === 1 ? '하급' : k.rank === 2 ? '중급' : '상급';
    if (!k.active) {
      opts.push({ label: '활동 상태로 (밀 1)', res: 'g', fn: function () { act('activateKnight', [k.v]); } });
    }
    if (k.rank < 3) {
      var canUp = k.rank === 1 || p.level.politics >= 3;
      opts.push({
        label: '승급 (철 1 · 양 1)' + (canUp ? '' : ' — 요새 필요'),
        fn: function () {
          if (!canUp) { toast('상급으로 올리려면 정치 3단계(요새)가 필요합니다.'); return; }
          act('upgradeKnight', [k.v]);
        }
      });
    }
    // 갈 곳·밀어낼 곳은 방장이 뷰에 실어 준 목록으로 센다 (참가자는 App.state 가 없어 늘 0 으로 보였다)
    var moves = ((v.legal && v.legal.knightMoves) || {})[k.v] || [];
    if (k.canAct && moves.length) {
      opts.push({ label: '이동 / 추방', fn: function () {
        App.knightSel = k.v;
        toast('갈 자리나 밀어낼 상대 기사를 누르세요.');
        render();
      } });
    }
    if (k.canAct) {
      if (v.board.verts[k.v].hexes.indexOf(v.robber) >= 0) {
        opts.push({ label: '도둑 쫓아내기', fn: function () { act('chaseRobber', [k.v]); } });
      }
    }
    // 왜 못 움직이는지까지 한 줄로 알려 준다
    var hint;
    if (!k.active) hint = '비활동 상태 — 밀 1장으로 깨워야 움직이거나 도둑을 쫓을 수 있습니다.';
    else if (!k.canAct) hint = '활동 상태 — 이번 차례에 깨웠거나 이미 움직여서, 다음 차례부터 움직일 수 있습니다.';
    else {
      hint = !moves.length ? '활동 상태 — 이어진 내 도로 끝에 갈 자리가 없습니다. 도로를 더 이어 보세요.'
                         : '활동 상태 — 움직이거나 상대 기사를 밀어낼 수 있습니다.';
    }
    if (!opts.length) { toast(rankName + ' 기사 — ' + hint); return; }
    openPick(rankName + ' 기사', hint, opts);
  }



  // 진보카드 사용 — 고를 게 있으면 창을 띄운다
  function playProgressUI(type) {
    var v = App.view, p = meOf(v);
    var opp = v.players.filter(function (q) { return q.id !== v.me && !q.out; });
    function go(args) { act('playCard', [type, args || []]); }
    // 주사위 전·도둑 단계에 대상을 고르는 카드를 누르면 판에 과녁은 뜨는데 그만두기가 없고, 눌러도 거절됐다
    if (type !== 'alchemist' && v.phase !== 'main') { toast('진보카드는 주사위를 굴린 뒤에 씁니다. (연금술사만 굴리기 전)'); return; }

    if (type === 'alchemist') {
      if (v.phase !== 'roll') { toast('연금술사는 주사위를 굴리기 전에만 씁니다.'); return; }
      var faces = [1, 2, 3, 4, 5, 6];
      openPick('연금술사 — 흰 주사위', '이번에 나올 눈을 고릅니다.', faces.map(function (a) {
        return { label: String(a), fn: function () {
          openPick('연금술사 — 빨간 주사위', '빨간 눈도 고릅니다. (진보카드 조건에 쓰입니다)', faces.map(function (b) {
            return { label: String(b), fn: function () { go([a, b]); } };
          }));
        } };
      }));
      return;
    }
    if (type === 'resMono') {
      openPick('자원 독점', '고른 자원을 모두에게서 두 장씩 가져옵니다.', CK.RES.map(function (c) {
        return { label: resName(c), res: c, fn: function () { go([c]); } };
      }));
      return;
    }
    if (type === 'commMono') {
      openPick('상품 독점', '고른 상품을 모두에게서 한 장씩 가져옵니다.', CK.COM.map(function (c) {
        return { label: resName(c), res: c, fn: function () { go([c]); } };
      }));
      return;
    }
    if (type === 'fleet') {
      openPick('상선대', '이번 차례에 2:1로 바꿀 것을 고릅니다.', CK.ALL.map(function (c) {
        return { label: resName(c), res: c, fn: function () { go([c]); } };
      }));
      return;
    }
    if (type === 'spy' || type === 'deserter' || type === 'trader') {
      var title = type === 'spy' ? '첩자 — 진보카드를 가져올 상대'
        : type === 'deserter' ? '변절자 — 기사를 데려올 상대' : '전문 상인 — 손을 볼 상대';
      var list = opp;
      if (type === 'trader') list = opp.filter(function (q) { return (q.vpFull !== undefined ? q.vpFull : q.vp) > (p.vpFull !== undefined ? p.vpFull : p.vp); });
      if (!list.length) { toast(type === 'trader' ? '나보다 점수가 높은 사람이 없습니다.' : '고를 상대가 없습니다.'); return; }
      openPick(title, '', list.map(function (q) {
        return { label: q.name, fn: function () {
          if (type !== 'trader') { go([q.id]); return; }
          // 전문 상인은 두 장을 고른다 — 상대 손은 안 보이므로 종류만 지정
          openPick('전문 상인 — 무엇을 가져올까요', q.name + '에게서 두 장을 가져옵니다.', CK.ALL.map(function (c) {
            return { label: resName(c) + ' 두 장', res: c, fn: function () { go([q.id, [c, c]]); } };
          }));
        } };
      }));
      return;
    }
    if (type === 'medicine') {
      if (!v.legal.cities.length) { toast('올릴 마을이 없습니다.'); return; }
      App.pickVert = { kind: 'medicine', list: v.legal.cities };
      toast('도시로 올릴 내 마을을 판에서 누르세요.');
      render();
      return;
    }
    if (type === 'engineer') {
      if (!v.legal.walls.length) { toast('성벽을 쌓을 도시가 없습니다.'); return; }
      App.pickVert = { kind: 'engineer', list: v.legal.walls };
      toast('성벽을 쌓을 도시를 판에서 누르세요.');
      render();
      return;
    }
    if (type === 'bishop' || type === 'merchant') {
      App.pickHex = { kind: type };
      toast(type === 'bishop' ? '도둑을 옮길 타일을 누르세요.' : '상인을 놓을 내 땅을 누르세요.');
      render();
      return;
    }
    if (type === 'intrigue') {
      var spots = [];
      // 엔진은 내 도로가 닿은 자리의 기사만 받는다 — 닿지 않은 기사를 고르면 거절되고 고르기만 날아갔다
      var touchesMine = function (vi) {
        return v.board.edges.some(function (e) { return e.road === v.me && (e.a === vi || e.b === vi); });
      };
      v.players.forEach(function (q) {
        if (q.id === v.me) return;
        (q.knights || []).forEach(function (k) { if (touchesMine(k.v)) spots.push(k.v); });
      });
      if (!spots.length) { toast('내 도로가 닿은 상대 기사가 없습니다.'); return; }
      App.pickVert = { kind: 'intrigue', list: spots };
      toast('밀어낼 상대 기사를 누르세요.');
      render();
      return;
    }
    if (type === 'inventor') {
      var ok = [];
      v.board.hexes.forEach(function (h, i) {
        if (h.number && [2, 12, 6, 8].indexOf(h.number) < 0) ok.push(i);
      });
      if (ok.length < 2) { toast('바꿀 수 있는 숫자 칩이 없습니다.'); return; }
      App.pickHex = { kind: 'inventor', list: ok, first: null };
      toast('자리를 바꿀 숫자 칩 두 개를 차례로 누르세요.');
      render();
      return;
    }
    if (type === 'diplomat') {
      App.pickEdge = { kind: 'diplomat' };
      toast('없앨 도로(맨 끝)를 누르세요.');
      render();
      return;
    }
    if (type === 'smith') {
      var ks = (p.knights || []).filter(function (k) { return k.rank < 3; }).map(function (k) { return k.v; });
      if (!ks.length) { toast('승급시킬 기사가 없습니다.'); return; }
      go([ks.slice(0, 2)]);
      return;
    }
    if (type === 'harbor') {
      // 각 상대에게 자원 하나를 주고 상품 하나를 받는다 — 간단히 한 명씩 고른다
      if (!opp.length) { toast('상대가 없습니다.'); return; }
      var mine = CK.RES.filter(function (c) { return p.res[c] > 0; });
      if (!mine.length) { toast('줄 자원이 없습니다.'); return; }
      openPick('무역항 — 내가 줄 자원', '상대마다 자원 1장을 주고 상품 1장을 받습니다.', mine.map(function (giveC) {
        return { label: resName(giveC), res: giveC, fn: function () {
          openPick('무역항 — 받을 상품', '', CK.COM.map(function (wantC) {
            return { label: resName(wantC), res: wantC, fn: function () {
              var picks = {};
              opp.forEach(function (q) { picks[q.id] = [giveC, wantC]; });
              go([picks]);
            } };
          }));
        } };
      }));
      return;
    }
    go([]);                                              // 고를 게 없는 카드
  }

  // 야만족 트랙과 도시 개발판
  function renderCkBar(v) {
    var bar = $('ckBar');
    if (!isExt(v)) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    var track = $('barbTrack');
    track.innerHTML = '';
    for (var i = 0; i < v.barbMax; i++) {
      var dot = el('i', i < v.barb ? 'on' : null);
      if (i === v.barb - 1 && App.barbSeen !== v.barb) dot.classList.add('pop');
      track.appendChild(dot);
    }
    App.barbSeen = v.barb;
    var cityTotal = 0, power = 0;
    v.players.forEach(function (q) {
      if (q.out) return;
      cityTotal += q.cities.length;
      power += q.power;
    });
    $('barbInfo').textContent = '힘 ' + cityTotal + ' vs 기사 ' + power +
      (v.barb >= v.barbMax - 1 ? ' — 곧 상륙!' : '');
    $('barbInfo').className = 'barbInfo' + (power < cityTotal ? ' danger' : '');

    var box = $('ckTracks');
    box.innerHTML = '';
    var p = meOf(v);
    CK.TRACKS.forEach(function (t) {
      var row = el('div', 'trk trk-' + t);
      var head = el('span', 'trkName', CK.TRACK_NAME[t]);
      head.appendChild(rchip(CK.TRACK_COM[t]));
      row.appendChild(head);
      var lv = p ? p.level[t] : 0;
      var pips = el('span', 'trkPips');
      for (var i2 = 1; i2 <= CK.MAX_LEVEL; i2++) {
        var pip = el('i', i2 <= lv ? 'on' : null);
        pip.title = i2 + '단계 — ' + CK.LEVEL_NAME[t][i2 - 1];
        pips.appendChild(pip);
      }
      row.appendChild(pips);
      if (p && p.metro[t]) row.appendChild(el('span', 'metro', '수도'));
      // 개발 버튼
      var can = p && isMyTurn(v) && v.phase === 'main' && lv < CK.MAX_LEVEL;
      var crane = !!(p && p.craneReady);                  // 기중기 — 한 장 덜 든다 (예전엔 늘 false 로 보내 효과가 없었다)
      var cost = lv + 1 - (crane ? 1 : 0);
      var b = el('button', 'trkBtn', lv < CK.MAX_LEVEL ? ('개발 ' + cost + (crane ? ' 🏗' : '')) : '완료');
      if (can && p.res[CK.TRACK_COM[t]] >= cost) {
        b.classList.add('can');
        b.onclick = function () { act('develop', [t, crane]); };
      } else {
        b.disabled = lv >= CK.MAX_LEVEL;
        b.onclick = function () {
          if (lv >= CK.MAX_LEVEL) return;
          if (!isMyTurn(v) || v.phase !== 'main') { toast('내 차례에 지을 수 있습니다.'); return; }
          toast(resName(CK.TRACK_COM[t]) + ' ' + cost + '장이 필요합니다. (지금 ' + p.res[CK.TRACK_COM[t]] + '장)');
        };
      }
      row.appendChild(b);
      box.appendChild(row);
    });
  }

  /* ---------------- 조작판 ----------------
     한 화면에 세 가지만 말한다.
       1) 지금 누구 차례이고 무슨 단계인가   (머리줄)
       2) 지금 반드시 해야 할 일 하나        (큰 글씨 + 주 버튼)
       3) 지금 할 수 있는 일                 (지을 수 있는 것 · 거래)
     할 수 없는 것은 아예 내보내지 않는다. */

  var PHASE_TAG = {
    order: '순서 정하기', setup: '준비', roll: '주사위 굴리기',
    discard: '카드 버리기', robber: '도둑 옮기기', main: '짓기와 거래', over: '끝'
  };

  function renderPanel(v) {
    var box = $('panel');
    box.innerHTML = '';
    var p = meOf(v);
    var myTurn = isMyTurn(v);
    var res = p && p.res ? p.res : { b: 0, l: 0, w: 0, g: 0, o: 0 };

    /* ── 머리줄: 누구 차례 · 무슨 단계 ── */
    var actor = v.phase === 'setup' ? playerIn(v, v.setup.who)
              : v.phase === 'order' ? null : v.players[v.turn];
    var mineNow = v.phase === 'setup' ? (v.setup && v.setup.who === v.me)
                : v.phase === 'order' ? true : myTurn;
    var head = el('div', 'pHead' + (mineNow ? ' mine' : ''));
    if (App.panelOpen === undefined) App.panelOpen = true;
    if (actor) {
      var dot = el('i', 'pDot');
      dot.style.background = PCOLOR[actor.color] || '';
      head.appendChild(dot);
    }
    head.appendChild(el('b', 'pWho', v.phase === 'order' ? '모두' : (actor ? (actor.id === v.me ? '내 차례' : actor.name + '의 차례') : '')));
    head.appendChild(el('span', 'pPhase', PHASE_TAG[v.phase] || ''));
    // 접기 단추 — 판을 더 보고 싶을 때
    var fold = el('button', 'pFold', App.panelOpen ? '▾' : '▴');
    fold.type = 'button';
    fold.title = App.panelOpen ? '조작판 접기 — 판을 더 크게' : '조작판 펼치기';
    fold.onclick = function () { App.panelOpen = !App.panelOpen; render(); };
    head.appendChild(fold);
    box.appendChild(head);
    box.classList.toggle('folded', !App.panelOpen);

    /* ── 지시문 · 부연 ── */
    var doLine = el('p', 'pDo');
    var whyLine = el('p', 'pWhy');
    box.appendChild(doLine);
    box.appendChild(whyLine);
    function say2(main2, sub) {
      doLine.innerHTML = main2;
      whyLine.innerHTML = sub || '';
      whyLine.classList.toggle('hidden', !sub);
    }

    /* ── 주 버튼: 화면에 하나만 ── */
    var mainRow = el('div', 'pMain');
    box.appendChild(mainRow);
    function primary(label, fn, disabled, tone) {
      var b = el('button', 'primary pBig' + (tone ? ' ' + tone : ''), label);
      if (disabled) b.disabled = true;
      b.onclick = fn;
      mainRow.appendChild(b);
      return b;
    }
    function ghost(label, fn) {
      var b = el('button', 'pGhost', label);
      b.onclick = fn;
      mainRow.appendChild(b);
      return b;
    }

    if (v.phase === 'over') { say2('판이 끝났습니다.'); return; }
    if (p && p.out) { say2('판에서 나갔습니다.'); return; }

    /* ── 거래 제안이 떠 있으면 그것부터 ── */
    if (v.trade) { renderTrade(v, doLine, mainRow, function (label, fn, isP, dis) {
      return isP ? primary(label, fn, dis) : ghost(label, fn);
    }); return; }

    /* ── 순서 정하기 ── */
    if (v.phase === 'order') {
      var needRoll = (!v.order.tie || v.order.tie.indexOf(v.me) >= 0) && v.order.rolls[v.me] === undefined;
      say2(v.order.tie ? '동점입니다 — 다시 굴리세요.' : (needRoll ? '주사위를 굴리세요.' : '다른 사람이 굴리는 것을 기다립니다.'),
        '가장 높은 눈을 낸 사람이 첫 번째로 마을을 놓습니다.');
      var list = el('div', 'orderList');
      v.players.forEach(function (q) {
        if (q.out) return;
        var row = el('span', 'orderRow');
        var d2 = el('i', 'orderDot');
        d2.style.background = PCOLOR[q.color];
        row.appendChild(d2);
        row.appendChild(el('b', null, q.name));
        var rr = v.order.rolls[q.id];
        row.appendChild(el('span', 'orderVal', rr ? (rr.d[0] + ' + ' + rr.d[1] + ' = ' + rr.sum) : '…'));
        if (v.order.tie && v.order.tie.indexOf(q.id) >= 0) row.classList.add('tie');
        list.appendChild(row);
      });
      box.insertBefore(list, mainRow);
      if (needRoll) primary('🎲  주사위 굴리기', function () { act('rollForOrder', []); });
      return;
    }

    /* ── 마을·도로 놓기 ── */
    if (v.phase === 'setup') {
      if (mineNow) {
        var second = v.setup.idx >= (v.setup.half || v.players.length);
        var what = (isExt(v) && second) ? '도시' : '마을';
        if (v.setup.sub === 'settlement') {
          say2('판에서 <b>' + EUL(what) + ' 놓을 자리</b>를 누르세요.',
            second ? '두 바퀴째입니다. 이번에 놓는 ' + what + ' 둘레의 자원을 바로 받습니다.'
                   : '주황 점이 놓을 수 있는 자리입니다. 마을끼리는 두 변 이상 떨어져야 합니다.');
        } else {
          say2('방금 놓은 ' + what + '에 <b>이을 도로</b>를 누르세요.',
            '주황 굵은 선이 놓을 수 있는 자리입니다.');
        }
      } else {
        say2(H(GA(actor ? actor.name : '?')) + ' 자리를 고르는 중…', '차례가 오면 알려 드립니다.');
      }
      return;
    }

    /* ── 7 — 카드 버리기 ── */
    if (v.phase === 'discard') {
      var need = v.mustDiscard[v.me];
      if (need) {
        say2('손패에서 <b>' + need + '장</b>을 골라 버리세요.',
          '7이 나왔습니다. 8장 이상 든 사람은 절반을 버립니다. 아래 카드를 눌러 고르세요.');
        primary('버리기 ' + App.discardSel.length + ' / ' + need,
          function () { act('discard', [App.discardSel.slice()]); App.discardSel = []; },
          App.discardSel.length !== need, 'warn');
      } else {
        var names = Object.keys(v.mustDiscard).map(function (pid) { return playerIn(v, pid).name; });
        say2(H(GA(names.join(', '))) + ' 카드를 버리는 중…', '나는 버릴 것이 없습니다.');
      }
      return;
    }

    /* ── 도둑 ── */
    if (v.phase === 'robber') {
      if (myTurn) say2('판에서 <b>도둑을 옮길 타일</b>을 누르세요.',
        '옮긴 타일에 마을이 닿은 사람에게서 카드를 한 장 빼앗습니다. 빗금 친 지금 자리는 고를 수 없습니다.');
      else say2(H(GA(actor ? actor.name : '?')) + ' 도둑을 옮기는 중…', '');
      return;
    }

    /* ── 남의 차례 ── */
    if (!myTurn) {
      say2(actor ? (H(actor.name) + '의 차례입니다.') : '', '지켜보는 차례입니다. 위쪽 안내줄에 무슨 일이 일어나는지 나옵니다.');
      return;
    }

    /* ── 내 차례: 주사위 ── */
    if (v.phase === 'roll') {
      say2('<b>주사위</b>를 굴리세요.', '나온 눈과 같은 숫자 타일 둘레에 마을이 있으면 자원을 받습니다.');
      primary('🎲  주사위 굴리기', function () { act('roll', []); });
      return;
    }

    /* ── 내 차례: 공짜 도로 ── */
    if (v.freeRoads > 0) {
      if (v.legal.roads.length && p.left.road) {
        say2('공짜 도로 <b>' + v.freeRoads + '개</b>를 놓으세요.', '판에서 주황 굵은 선을 누르세요.');
      } else {
        say2('놓을 자리가 없어 공짜 도로는 넘어갑니다.', '');
        primary('차례 넘기기', function () { act('endTurn', []); });
      }
      return;
    }

    /* ── 내 차례: 판에서 무언가를 고르는 중 ── */
    var picking = { road: ['도로를 놓을 변', '주황 굵은 선이 놓을 수 있는 자리입니다.'],
                    settlement: ['마을을 놓을 꼭짓점', '주황 점이 놓을 수 있는 자리입니다.'],
                    city: ['도시로 올릴 내 마을', '내 마을 위에 표시가 뜹니다.'],
                    knight: ['기사를 놓을 꼭짓점', '내 도로가 닿은 빈 자리에만 놓을 수 있습니다.'],
                    wall: ['성벽을 쌓을 내 도시', '마을에는 쌓을 수 없습니다.'] }[App.build];
    if (picking) {
      say2('판에서 <b>' + picking[0] + '</b>을(를) 누르세요.', picking[1]);
      ghost('그만두기', function () { App.build = null; render(); });
      return;
    }
    if (App.knightSel !== null && App.knightSel !== undefined) {
      say2('<b>기사가 갈 자리</b>나 밀어낼 상대 기사를 누르세요.', '');
      ghost('그만두기', function () { App.knightSel = null; render(); });
      return;
    }
    if (App.pickVert || App.pickHex || App.pickEdge) {
      say2('<b>진보카드</b> — 판에서 반짝이는 대상을 고르세요.', '');
      // 카드는 대상을 고른 뒤에야 쓰이므로, 그만두면 카드는 손에 그대로 남는다
      ghost('그만두기', function () { App.pickVert = App.pickHex = App.pickEdge = null; render(); });
      return;
    }

    /* ── 내 차례: 짓기와 거래 ── */
    var buildable = !(p && p.out);
    function afford(cost) {
      var need2 = {};
      cost.forEach(function (c) { need2[c] = (need2[c] || 0) + 1; });
      for (var c in need2) if (res[c] < need2[c]) return false;
      return true;
    }
    var canRoad = buildable && afford(['b', 'l']) && p.left.road > 0 && v.legal.roads.length > 0;
    var canSett = buildable && afford(['b', 'l', 'w', 'g']) && p.left.settlement > 0 && v.legal.settlements.length > 0;
    var canCity = buildable && afford(['g', 'g', 'o', 'o', 'o']) && p.left.city > 0 && v.legal.cities.length > 0;
    var canDev = buildable && afford(['w', 'g', 'o']) && v.devLeft > 0;
    var canKnight = false, canWall = false;
    if (isExt(v)) {
      canKnight = buildable && afford(['o', 'w']) && v.legal.knightSpots.length &&
        (function () { var n = 0; (p.knights || []).forEach(function (k) { if (k.rank === 1) n++; }); return n < 2; })();
      canWall = buildable && afford(['b', 'b']) && v.legal.walls.length && p.walls < CK.WALL_MAX;
    }
    var canCount = (canRoad ? 1 : 0) + (canSett ? 1 : 0) + (canCity ? 1 : 0) +
                   (isExt(v) ? (canKnight ? 1 : 0) + (canWall ? 1 : 0) : (canDev ? 1 : 0));

    say2('짓거나 거래한 뒤 <b>차례를 넘기세요</b>.',
      canCount ? ('지금 지을 수 있는 것이 <b>' + canCount + '가지</b> 있습니다.')
               : '지을 수 있는 것이 없습니다. 거래로 자원을 맞춰 보세요.');

    // 지을 것 고르기
    var sec = el('div', 'pSec');
    sec.appendChild(el('span', 'pSecName', '지을 것'));
    sec.appendChild(el('span', 'pSecNum', canCount + ' / ' + (isExt(v) ? 5 : 4)));
    box.insertBefore(sec, mainRow);
    var buildRow = el('div', 'buildRow' + (isExt(v) ? ' five' : ''));
    box.insertBefore(buildRow, mainRow);

    function bbtn(label, pts, cost, usable, onClick, mode, why2) {
      var b = el('button', 'bcard');
      var h2 = el('span', 'bhead');
      h2.appendChild(el('span', 'bname', label));
      h2.appendChild(el('span', 'bpts', pts));
      b.appendChild(h2);
      var cs = el('span', 'bcost');
      var have = {};
      cardsOf(v).forEach(function (c) { have[c] = res[c]; });
      cost.forEach(function (c) {
        var chip = rchip(c);
        if (have[c] > 0) have[c]--;
        else chip.classList.add('miss');
        cs.appendChild(chip);
      });
      b.appendChild(cs);
      if (usable) { b.classList.add('can'); b.onclick = onClick; }
      else { b.classList.add('off'); b.onclick = function () { toast(why2 || '지금은 지을 수 없습니다.'); }; }
      if (mode && App.build === mode) b.classList.add('on');
      buildRow.appendChild(b);
      return b;
    }
    function why(kind) {
      if (kind === 'dev') {
        if (!v.devLeft) return '발전 카드가 다 떨어졌습니다.';
        return '자원이 모자랍니다 — 양 1 · 밀 1 · 철 1이 필요합니다.';
      }
      if (kind === 'road') {
        if (!p.left.road) return '도로 말 15개를 다 썼습니다.';
        if (!v.legal.roads.length) return '이어 놓을 자리가 없습니다.';
        return '자원이 모자랍니다 — ' + (isExt(v) ? '흙' : '벽돌') + ' 1 · 나무 1이 필요합니다.';
      }
      if (kind === 'settlement') {
        if (!p.left.settlement) return '마을 말 5개를 다 썼습니다. 하나를 도시로 올리면 말이 돌아옵니다.';
        if (!v.legal.settlements.length) return '지을 자리가 없습니다 — 도로를 더 이어서 빈 꼭짓점을 만들어야 합니다. (마을끼리는 두 변 이상 떨어져야 합니다)';
        return '자원이 모자랍니다 — ' + (isExt(v) ? '흙' : '벽돌') + '·나무·양·밀이 한 장씩 필요합니다.';
      }
      if (kind === 'city') {
        if (!p.left.city) return '도시 말 4개를 다 썼습니다.';
        if (!v.legal.cities.length) return '올릴 내 마을이 없습니다. 마을을 먼저 지으세요.';
        return '자원이 모자랍니다 — 밀 2 · 철 3이 필요합니다.';
      }
      return '지금은 지을 수 없습니다.';
    }
    function whyKnight() {
      var n = 0;
      (p.knights || []).forEach(function (k) { if (k.rank === 1) n++; });
      if (n >= 2) return '하급 기사는 둘까지입니다. 하나를 승급시키면 더 놓을 수 있습니다.';
      if (!v.legal.knightSpots.length) return '내 도로가 닿은 빈 꼭짓점이 없습니다. 도로를 더 이어 보세요.';
      return '자원이 모자랍니다 — 철 1 · 양 1이 필요합니다.';
    }
    function whyWall() {
      if (p.walls >= CK.WALL_MAX) return '성벽은 3개까지입니다.';
      if (!v.legal.walls.length) return '성벽을 쌓을 도시가 없습니다. (마을에는 못 쌓습니다)';
      return '자원이 모자랍니다 — 흙 2장이 필요합니다.';
    }
    function modeToggle(mode) {
      return function () { App.build = App.build === mode ? null : mode; render(); };
    }
    bbtn('도로', '0점', ['b', 'l'], canRoad, modeToggle('road'), 'road', why('road'));
    bbtn('마을', '1점', ['b', 'l', 'w', 'g'], canSett, modeToggle('settlement'), 'settlement', why('settlement'));
    bbtn('도시', '2점', ['g', 'g', 'o', 'o', 'o'], canCity, modeToggle('city'), 'city', why('city'));
    if (isExt(v)) {
      bbtn('기사', '방어', ['o', 'w'], canKnight, function () {
        App.build = App.build === 'knight' ? null : 'knight'; render();
      }, 'knight', whyKnight());
      bbtn('성벽', '손패+2', ['b', 'b'], canWall, function () {
        App.build = App.build === 'wall' ? null : 'wall'; render();
      }, 'wall', whyWall());
    } else {
      bbtn('발전 카드', '?점', ['w', 'g', 'o'], canDev, function () { act('buyDev', []); }, null, why('dev'));
    }

    // 거래는 할 수 있을 때만 내놓는다
    var canBank = cardsOf(v).some(function (c) { return res[c] >= (isExt(v) ? CK.tradeRate(p, c, v) : R.tradeRate(p, c)); });
    var others = v.players.filter(function (q) { return q.id !== v.me && !q.out; }).length;
    var canOffer = others > 0 && cardsOf(v).some(function (c) { return res[c] > 0; });
    if (canBank || canOffer) {
      var trow = el('div', 'pTrade');
      if (canBank) {
        var b1 = el('button', 'pGhost', '🏦  은행 교환');
        b1.onclick = function () { openBankTrade(v, p); };
        trow.appendChild(b1);
      }
      if (canOffer) {
        var b2 = el('button', 'pGhost', '🤝  거래 제안');
        b2.onclick = function () { openTradeModal(v, p); };
        trow.appendChild(b2);
      }
      box.insertBefore(trow, mainRow);
    }

    primary('차례 넘기기  →', function () { act('endTurn', []); });
  }

  /* ---------------- 거래 ---------------- */

  function renderTrade(v, msg, acts, btn) {
    var t = v.trade;
    var from = playerIn(v, t.from);
    // 확장판이면 상품(옷감·종이·화폐)까지 적는다 — 기본판 글로 쓰면 상품이 빠져 빈 제안처럼 보였다
    var txt = function (m) { return H(isExt(v) ? CK.handText(m) : R.resText(m)); };
    var giveTxt = txt(t.give), wantTxt = txt(t.want);
    if (t.from === v.me) {
      var yes = [], waiting = [];
      v.players.forEach(function (q) {
        if (q.id === v.me || q.out) return;
        if (t.replies[q.id] === 'yes') yes.push(q);
        else if (!t.replies[q.id]) waiting.push(q);
      });
      msg.innerHTML = '내 제안 — <b>' + giveTxt + '</b> 주고 <b>' + wantTxt + '</b> 받기.' +
        (waiting.length ? ' (' + H(waiting.map(function (q) { return q.name; }).join(', ')) + ' 대답 대기 중)' : '');
      yes.forEach(function (q) {
        btn(WA(q.name) + ' 교환', function () { act('acceptTrade', [q.id]); }, true);   // 받침 따라 와/과
      });
      btn('제안 거두기', function () { act('cancelTrade', []); });
    } else {
      msg.innerHTML = '<b>' + H(from.name) + '</b>의 제안 — ' + giveTxt + ' 주고 <b>' + wantTxt + '</b> 받겠답니다.';
      var myReply = t.replies[v.me];
      if (myReply) {
        msg.innerHTML += ' (' + (myReply === 'yes' ? '받겠다고 했습니다' : '거절했습니다') + ')';
      } else {
        var p = meOf(v);
        var canAfford = Object.keys(t.want).every(function (c) { return p.res && p.res[c] >= t.want[c]; });
        btn('받기', function () { act('replyTrade', [true]); }, true, !canAfford);
        btn('거절', function () { act('replyTrade', [false]); });
      }
    }
  }

  function openBankTrade(v, p) {
    var all = cardsOf(v);
    var rateOf = function (c) { return isExt(v) ? CK.tradeRate(p, c, v) : R.tradeRate(p, c); };
    var opts = [];
    all.forEach(function (c) {
      var rate = rateOf(c);
      if (p.res[c] >= rate) opts.push({ c: c, rate: rate });
    });
    openPick('은행 교환 — 무엇을 낼까요?', '항구가 있으면 교환비가 좋아집니다. 지금 낼 수 있는 것만 보입니다.', opts.map(function (o) {
      return { label: resName(o.c) + ' ' + o.rate + '장 내기 (가진 것 ' + p.res[o.c] + ')', res: o.c, fn: function () {
        openPick('무엇을 받을까요?', resName(o.c) + ' ' + o.rate + '장을 내고 한 장을 받습니다.',
          all.filter(function (c) { return c !== o.c && v.bank[c] > 0; }).map(function (c) {
            return { label: resName(c) + ' 1장 (은행에 ' + v.bank[c] + ')', res: c, fn: function () { act('bankTrade', [o.c, c]); } };
          }));
      } };
    }));
  }

  function openTradeModal(v, p) {
    App.tGive = {}; App.tWant = {};
    renderTradeForm(v, p);
    $('tradeModal').classList.remove('hidden');
  }
  function renderTradeForm(v, p) {
    var all = cardsOf(v);
    ['tGive', 'tWant'].forEach(function (side) {
      var box = $(side);
      box.innerHTML = '';
      box.classList.toggle('wide', all.length > 5);
      all.forEach(function (c) {
        var give = side === 'tGive';
        var have = p.res[c] || 0;
        var row = el('div', 'tRow' + (give && !have ? ' none' : ''));
        row.appendChild(rchip(c));
        var minus = el('button', null, '−');
        var cnt = el('span', 'cnt', String(App[side][c] || 0));
        var plus = el('button', null, '+');
        var max = give ? have : 19;
        var now = App[side][c] || 0;
        minus.disabled = now === 0;
        plus.disabled = now >= max || (give && App.tWant[c]) || (!give && App.tGive[c]);
        minus.onclick = function () { App[side][c] = Math.max(0, (App[side][c] || 0) - 1); renderTradeForm(v, p); };
        plus.onclick = function () {
          if ((App[side][c] || 0) >= max) return;
          if (give && App.tWant[c]) return;
          if (!give && App.tGive[c]) return;
          App[side][c] = (App[side][c] || 0) + 1; renderTradeForm(v, p);
        };
        row.appendChild(minus); row.appendChild(cnt); row.appendChild(plus);
        if (give) row.appendChild(el('span', 'tHave', have + '장'));
        box.appendChild(row);
      });
    });
  }

  /* ---------------- 자원/대상 고르기 ---------------- */

  function openPick(title, hint, options) {
    $('pickTitle').textContent = title;
    $('pickHint').textContent = hint || '';
    var list = $('pickList');
    list.innerHTML = '';
    options.forEach(function (o) {
      var b = el('button', null, '');
      if (o.res) b.appendChild(rchip(o.res));
      b.appendChild(el('span', null, o.label));
      b.onclick = function () { $('pickModal').classList.add('hidden'); o.fn(); };
      list.appendChild(b);
    });
    $('pickModal').classList.remove('hidden');
  }
  $('btnPickCancel').onclick = function () { $('pickModal').classList.add('hidden'); };

  /* ---------------- 로그 / 끝 ---------------- */

  function renderLog(v) {
    var box = $('log');
    box.innerHTML = '';
    v.log.forEach(function (l, i) {
      var row = el('div', 'logRow' + (l.mine ? ' mine' : '') + (i === v.log.length - 1 ? ' last' : ''));
      var who = lineOwner(v, l.text);
      var dot = el('i', 'logDot');
      dot.style.background = who ? (PCOLOR[who.color] || 'transparent') : 'transparent';
      row.appendChild(dot);
      row.appendChild(el('span', 'logTxt', l.text));
      box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
  }

  function winTarget(v) { return isExt(v) ? CK.WIN_VP : R.WIN_VP; }

  function showOver(v) {
    // 떠 있던 명패·중계는 치우고 트로피만 보이게
    clearTimeout(App.bigTimer);
    $('bigNews').classList.add('hidden');
    App.feed.length = 0;
    if (!App.confettiDone) { App.confettiDone = true; confetti(); }
    // 판 하나에 한 번만 — 이 화면은 다시 그릴 때마다 불린다
    if (App.mode !== 'client' && !App.statOver && window.norara) {
      App.statOver = true;
      norara.ev('end', {
        n: App.seats.filter(function (s) { return !s.bot; }).length,
        sec: Math.round((Date.now() - (App.statAt || Date.now())) / 1000)
      });
    }

    var w = v.winner ? playerIn(v, v.winner) : null;
    var title = $('overTitle');
    title.textContent = w ? w.name + ' 승리!' : '판이 끝났습니다';
    title.style.color = w ? (PCOLOR[w.color] || '') : '';
    var sheet = $('over').querySelector('.sheet');
    sheet.classList.add('trophy');
    var body = $('overBody');
    body.innerHTML = '';
    var medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
    v.players.slice().sort(function (a, b) {
      return (b.vpFull || b.vp) - (a.vpFull || a.vp);
    }).forEach(function (p, i) {
      var row = el('div', 'overRow' + (p.id === v.winner ? ' win' : ''));
      row.style.borderLeftColor = PCOLOR[p.color] || 'transparent';
      row.appendChild(el('span', 'medal', medals[i] || (i + 1) + '.'));
      row.appendChild(el('b', 'oname', p.name));
      var pts = (p.vpFull !== undefined ? p.vpFull : p.vp);
      row.appendChild(el('span', 'opts', pts + '점'));
      var extra = [];
      if (p.vpCards) extra.push('승점 카드 ' + p.vpCards);
      if (v.longest.p === p.id) extra.push('최장 교역로');
      if (!isExt(v) && v.army && v.army.p === p.id) extra.push('최강 기사단');
      if (isExt(v) && p.defender) extra.push('수호자 ' + p.defender);
      if (p.out) extra.push('나감');
      if (extra.length) row.appendChild(el('span', 'oextra', extra.join(' · ')));
      body.appendChild(row);
    });
    $('over').classList.remove('hidden');
  }


  // 누르고 있는 동안에는 다시 그리지 않는다.
  // 누르는 사이에 화면을 갈아엎으면 버튼이 사라져 클릭이 먹지 않는다.
  var holdTimer = null, releaseTimer = null;
  function holdRender() {
    App.pressing = true;
    clearTimeout(releaseTimer); clearTimeout(holdTimer);
    holdTimer = setTimeout(releaseRender, 1200);      // 뗀 신호를 못 받아도 굳지 않게
  }
  function releaseRender() {
    clearTimeout(holdTimer); clearTimeout(releaseTimer);
    releaseTimer = setTimeout(function () {
      App.pressing = false;
      if (App.pendingRender) { App.pendingRender = false; render(); }
    }, 60);                                            // click 까지 다 지나간 뒤에
  }
  document.addEventListener('pointerdown', holdRender, true);
  document.addEventListener('pointerup', releaseRender, true);
  document.addEventListener('pointercancel', releaseRender, true);

  // 지금 어느 단계인지 위쪽에 늘 보이게
  // 판 위 안내 — 지금 판에서 무엇을 눌러야 하는지
  function renderBoardHint(v) {
    var box = $('boardHint');
    if (!box) return;
    var txt = '';
    if (v.phase === 'setup' && v.setup && v.setup.who === v.me) {
      var second = v.setup.idx >= (v.setup.half || v.players.length);
      var what = (isExt(v) && second) ? '도시' : '마을';
      txt = v.setup.sub === 'settlement'
        ? '주황 점을 눌러 ' + EUL(what) + ' 놓으세요 · ' + (v.legal.settlements || []).length + '곳'
        : '주황 선을 눌러 도로를 놓으세요 · ' + (v.legal.roads || []).length + '곳';
    } else if (v.phase === 'robber' && isMyTurn(v)) {
      txt = '타일을 눌러 도둑을 옮기세요';
    } else if (isMyTurn(v) && v.freeRoads > 0) {
      txt = '주황 선을 눌러 공짜 도로를 놓으세요 · ' + v.freeRoads + '개 남음';
    } else if (isMyTurn(v) && App.build) {
      var n = App.build === 'road' ? (v.legal.roads || []).length
            : App.build === 'settlement' ? (v.legal.settlements || []).length
            : App.build === 'city' ? (v.legal.cities || []).length
            : App.build === 'knight' ? (v.legal.knightSpots || []).length
            : App.build === 'wall' ? (v.legal.walls || []).length : 0;
      var name = { road: '도로', settlement: '마을', city: '도시', knight: '기사', wall: '성벽' }[App.build];
      txt = (App.build === 'road' ? '주황 선' : '주황 점') + '을 눌러 ' + EUL(name) + ' 놓으세요 · ' + n + '곳';
    }
    box.textContent = txt;
    box.classList.toggle('hidden', !txt);
  }

  // 기록 접기 — 좁은 화면에서는 접어 두고 필요할 때만 편다
  function initLogFold() {
    var bar = $('nowBar');
    if (!bar || bar.dataset.foldReady) return;
    bar.dataset.foldReady = '1';
    if (App.logOpen === undefined) {
      var saved = null;
      try { saved = localStorage.getItem('catan.log'); } catch (e) {}
      // 넓은 화면에는 자리가 있으니 기록을 펴 두고, 좁은 화면에서는 접어 둔다
      App.logOpen = saved ? saved === 'open' : window.innerWidth >= 900;
    }
    var b = el('button', 'logFold', '기록');
    b.type = 'button';
    b.onclick = function () {
      App.logOpen = !App.logOpen;
      try { localStorage.setItem('catan.log', App.logOpen ? 'open' : 'shut'); } catch (e) {}
      paintLogFold();
    };
    bar.appendChild(b);
    paintLogFold();
  }
  function paintLogFold() {
    var g = $('game'), b = document.querySelector('.logFold');
    if (!g) return;
    g.classList.toggle('logOpen', !!App.logOpen);
    if (b) b.classList.toggle('on', !!App.logOpen);
  }

  function renderPhaseBar(v) {
    var bar = $('phaseBar');
    if (!bar) return;
    if (!v || v.phase === 'over') { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    var now = v.phase === 'order' ? 'order' : v.phase === 'setup' ? 'setup' : 'play';
    var seen = false;
    bar.querySelectorAll('.phStep').forEach(function (e) {
      var ph = e.getAttribute('data-ph');
      var isNow = ph === now;
      if (isNow) seen = true;
      e.classList.toggle('on', isNow);
      e.classList.toggle('done', !isNow && !seen);
    });
    var last = bar.querySelector('[data-ph="play"]');
    last.childNodes[1].nodeValue = now === 'play' ? ('본게임 · ' + Math.max(1, v.turnCount) + '번째 차례') : '본게임';
  }

  function render() {
    if (App.pressing) { App.pendingRender = true; return; }
    if (App.view) {
      renderPhaseBar(App.view);
      renderBoardHint(App.view);
      paintPlayMode(App.view);
    }
    if (App.view) {
      renderCkBar(App.view);
      paintTurnFrame(App.view);
    }
    var v = App.view;
    if (!v) return;
    renderBoard(v);
    renderPlayers(v);
    renderHand(v);
    renderPanel(v);
    renderLog(v);
  }

  /* ---------------- 대기실 ---------------- */

  function renderSeats(seats, canControl) {
    var box = $('seats');
    box.innerHTML = '';
    seats.forEach(function (s, i) {
      var d = el('div', 'seat');
      var dot = el('span', 'dot');
      dot.style.background = PCOLOR[R.COLORS[i]] || '#666';
      d.appendChild(dot);
      d.appendChild(el('span', null, s.name));
      if (s.bot) d.appendChild(el('span', 'bot', '봇'));
      box.appendChild(d);
    });
    $('hostControls').classList.toggle('hidden', !canControl);
  }

  function broadcastLobby() {
    if (!App.net) return;
    var list = App.seats.map(function (s) { return { name: s.name, bot: s.bot }; });
    App.net.broadcast(function () { return { t: 'lobby', seats: list }; });
  }

  /* ---------------- 방장 / 참가자 ---------------- */

  function beHost() {
    App.mode = 'host'; App.me = 'host';
    App.seats = [{ id: 'host', name: myName(), bot: false }];
    App.net = new Net();
    App.net.on.status = toast;
    App.net.on.error = toast;
    App.net.on.open = function (code) {
      $('roomCode').textContent = code;
      $('lobbyHint').textContent = '친구에게 이 코드를 알려주세요.';
      show('lobby'); renderSeats(App.seats, true);
    };
    App.net.on.join = function (pid, name) {
      if (App.started || App.seats.length >= 4) {
        App.net.toPlayer(pid, { t: 'err', msg: App.started ? '이미 시작된 방입니다.' : '자리가 찼습니다.' });
        return;
      }
      var base = name, n = 2;
      while (App.seats.some(function (s) { return s.name === name; })) name = base + n++;
      App.seats.push({ id: pid, name: name, bot: false });
      renderSeats(App.seats, true); broadcastLobby(); toast(name + ' 참가');
    };
    App.net.on.leave = function (pid) {
      var seat = null;
      App.seats.forEach(function (s) { if (s.id === pid) seat = s; });
      if (!seat) return;
      App.seats = App.seats.filter(function (s) { return s.id !== pid; });
      // 확장판이면 확장판 엔진으로 — 기본판 dropPlayer 가 확장판 상태를 읽다 던져 모든 화면이 멈췄다
      if (App.started && App.state) { E().dropPlayer(App.state, pid); pushViews(); }
      else { renderSeats(App.seats, true); broadcastLobby(); }
      toast(seat.name + ' 나감');
    };
    App.net.on.data = function (pid, msg) {
      if (msg.t === 'act' && App.started) doAction(pid, msg.action, msg.args || []);
    };
    App.net.host();
  }

  function beClient(code) {
    App.mode = 'client';
    App.net = new Net();
    App.net.on.status = toast;
    App.net.on.error = function (m) { toast(m); show('home'); App.net.close(); };
    App.net.on.open = function (c) {
      $('roomCode').textContent = c;
      $('lobbyHint').textContent = '방장이 시작하기를 기다리는 중…';
      show('lobby'); renderSeats([], false);
    };
    App.net.on.data = function (_, msg) {
      if (msg.t === 'lobby') renderSeats(msg.seats, false);
      else if (msg.t === 'view') {
        App.me = msg.view.me;
        App.ext = msg.view.ext === 'ck';
        if ($('game').classList.contains('hidden')) { show('game'); startIntro(); }
        applyView(msg.view);
      } else if (msg.t === 'err') toast(msg.msg);
    };
    App.net.join(code, myName());
  }

  /* ---------------- 첫 안내 ---------------- */

  var TOUR_LAST = 5;
  function tourShow(step) {
    App.tourStep = Math.max(0, Math.min(TOUR_LAST, step));
    var steps = document.querySelectorAll('#tour .tstep');
    for (var i = 0; i < steps.length; i++) steps[i].classList.toggle('hidden', i !== App.tourStep);
    var dots = $('tourDots'); dots.innerHTML = '';
    for (var j = 0; j <= TOUR_LAST; j++) dots.appendChild(el('i', j === App.tourStep ? 'on' : null));
    $('btnTourPrev').disabled = App.tourStep === 0;
    $('btnTourNext').textContent = App.tourStep === TOUR_LAST ? '시작하기' : '다음';
    $('tour').classList.remove('hidden');
  }
  function tourClose() {
    $('tour').classList.add('hidden');
    try { localStorage.setItem('catan.seen', '1'); } catch (e) {}
  }

  /* ---------------- 버튼 ---------------- */

  $('mode').onchange = function () {
    var ck = $('mode').value === 'ck';
    App.wantExt = ck;
    $('modeNote').textContent = ck
      ? '상품·기사·야만족이 더해진 확장. 도시를 개발해 수도를 세우고 13점을 먼저 넘기면 이깁니다.'
      : '주사위로 자원을 모아 도로·마을·도시를 짓습니다. 처음이면 여기부터.';
    $('modeWarn').classList.toggle('hidden', !ck);
    try { localStorage.setItem('catan.mode', ck ? 'ck' : 'base'); } catch (e) {}
  };
  (function () {
    var saved = null;
    try { saved = localStorage.getItem('catan.mode'); } catch (e) {}
    if (saved === 'ck') { $('mode').value = 'ck'; }
    $('mode').onchange();
  })();

  $('btnSolo').onclick = function () {
    var count = parseInt($('soloCount').value, 10);
    App.skill = parseFloat($('soloSkill').value);
    App.mode = 'solo'; App.me = 'me';
    App.seats = [{ id: 'me', name: myName(), bot: false }];
    var names = ['봇 하나', '봇 둘', '봇 셋'];
    for (var i = 0; i < count - 1; i++) App.seats.push({ id: 'bot' + i, name: names[i], bot: true });
    startEngine();
  };
  $('btnHost').onclick = function () {
    if (!window.Peer) { toast('통신 모듈을 불러오지 못했습니다.'); return; }
    beHost();
  };
  $('btnJoin').onclick = function () {
    var code = $('joinCode').value.trim().toUpperCase();
    if (code.length !== 4) { toast('방 코드 4자리를 입력해 주세요.'); return; }
    if (!window.Peer) { toast('통신 모듈을 불러오지 못했습니다.'); return; }
    beClient(code);
  };
  $('joinCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btnJoin').click(); });
  $('btnAddBot').onclick = function () {
    if (App.seats.length >= 4) return;
    var names = ['봇 하나', '봇 둘', '봇 셋'];
    var used = App.seats.filter(function (s) { return s.bot; }).length;
    App.seats.push({ id: 'bot' + used + '-' + Date.now(), name: names[used] || ('봇 ' + (used + 1)), bot: true });
    renderSeats(App.seats, true); broadcastLobby();
  };
  $('btnStart').onclick = function () { App.skill = 0.75; startEngine(); };
  $('btnLeave').onclick = function () { if (App.net) App.net.close(); location.reload(); };
  $('btnAgain').onclick = function () { if (App.net) App.net.close(); location.reload(); };
  $('btnRules').onclick = function () { tourShow(0); };
  $('btnHelp').onclick = function () { $('rules').classList.remove('hidden'); };
  $('btnCloseRules').onclick = function () { $('rules').classList.add('hidden'); };
  $('btnTourAgain').onclick = function () { $('rules').classList.add('hidden'); tourShow(0); };
  $('btnTourNext').onclick = function () {
    if (App.tourStep === TOUR_LAST) tourClose(); else tourShow(App.tourStep + 1);
  };
  $('btnTourPrev').onclick = function () { tourShow(App.tourStep - 1); };
  $('btnTourSkip').onclick = tourClose;
  $('btnTradeCancel').onclick = function () { $('tradeModal').classList.add('hidden'); };
  $('btnTradeOffer').onclick = function () {
    var g = {}, w = {}, gn = 0, wn = 0;
    // 폼은 확장판이면 상품(옷감·종이·화폐)까지 8가지를 보여 준다. 기본 자원 5가지만 모으면
    // 상품을 넣은 제안이 조용히 빠지거나 "한 장 이상씩 골라 주세요" 로 막혔다.
    cardsOf(App.view).forEach(function (c) {
      if (App.tGive[c]) { g[c] = App.tGive[c]; gn += g[c]; }
      if (App.tWant[c]) { w[c] = App.tWant[c]; wn += w[c]; }
    });
    if (!gn || !wn) { toast('주고받을 자원을 한 장 이상씩 골라 주세요.'); return; }
    $('tradeModal').classList.add('hidden');
    act('offerTrade', [g, w]);
  };

  $('btnPlay').onclick = function () { show('home'); };
  $('btnBack').onclick = function () { show('title'); };

  // 테마 — 라이트가 기본, 한 번 고르면 기억한다
  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    $('themeToggle').checked = dark;
    $('themeLabel').textContent = dark ? '다크' : '라이트';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0d1017' : '#f6efe0');
    try { localStorage.setItem('catan.dark', dark ? '1' : '0'); } catch (e) {}
    if (App.view) render();
  }
  (function () {
    var saved = null;
    try { saved = localStorage.getItem('catan.dark'); } catch (e) {}
    applyTheme(saved === '1');
  })();
  $('themeToggle').onchange = function () { applyTheme($('themeToggle').checked); };

  // 안내는 타이틀의 `가이드` 를 눌렀을 때만 연다
  // 저장소가 막힌 브라우저(사생활 보호 모드 등)에서는 localStorage 가 던진다 — 그 뒤 스크립트가 통째로 멈추지 않게
  try { $('name').value = localStorage.getItem('catan.name') || ''; } catch (e) {}
  $('name').addEventListener('change', function () { try { localStorage.setItem('catan.name', myName()); } catch (e) {} });

  App.readLine = readLine;
  App.act = act; App.doAction = doAction; App.pushViews = pushViews; App.render = render;
  window.__ct = App;
})();
