// ?scene=mine | other | steal | discard 로 장면을 만든다
(function(){
  var q = new URLSearchParams(location.search);
  var scene = q.get('scene');
  if (q.get('theme')) document.documentElement.setAttribute('data-theme', q.get('theme'));
  if (!scene) return;
  function ready(fn){ if(window.__ct && window.Rules) fn(); else setTimeout(function(){ready(fn);}, 50); }
  var vr = q.get('v');
  if (vr) document.body.classList.add('v' + vr);
  window.__variant = vr;
  ready(function(){
    document.getElementById('btnPlay').click();
    document.getElementById('name').value = '민수';
    // ---- 화면에 뜬 안내가 몇 초씩 떠 있었는지 잰다 (?scene=timing&mode=base|ck) ----
    if (scene === 'timing') {
      var ext = q.get('mode') === 'ck';
      var msel = document.getElementById('mode');
      msel.value = ext ? 'ck' : 'base'; msel.onchange();
      document.getElementById('btnSolo').click();
      var A = window.__ct, E = ext ? window.CK : window.Rules, Ai = ext ? window.CKAI : window.AI;
      var T0 = Date.now();
      var ev = [];                                    // {t, kind, what, on}
      var log = function (kind, what, on) { ev.push({ t: Date.now() - T0, kind: kind, what: what, on: on ? 1 : 0 }); };

      // 켜지고 꺼지는 화면들
      var watch = [
        ['dice', 'diceOverlay', null],
        ['plaque', 'bigNews', 'bnTitle'],
        ['gate', 'gate', 'gateTitle'],
        ['card', 'cardReveal', 'crName'],
        ['robber', 'robberSweep', null],
        ['over', null, null]
      ];
      var state = {};
      var poll = setInterval(function () {
        watch.forEach(function (w) {
          if (!w[1]) return;
          var e = document.getElementById(w[1]);
          if (!e) return;
          var on = !e.classList.contains('hidden');
          if (state[w[0]] === on) return;
          state[w[0]] = on;
          var label = w[2] && document.getElementById(w[2]) ? document.getElementById(w[2]).textContent : '';
          log(w[0], label, on);
        });
        var nt = document.getElementById('nowText');
        if (nt && nt.textContent !== state.now) { state.now = nt.textContent; log('now', nt.textContent, 1); }
        var v = A.view;
        if (v) {
          var key = v.phase + '/' + v.turn + '/' + (v.setup ? v.setup.who : '');
          if (key !== state.turnKey) { state.turnKey = key; log('turn', key, 1); }
        }
      }, 30);

      var out = { mode: ext ? 'ck' : 'base', ev: ev, done: false, errs: [] };
      window.onerror = function (m, s2, l) { out.errs.push(m + ' @' + l); };
      var pre = document.createElement('pre');
      pre.id = 'qaout'; pre.style.display = 'none'; document.body.appendChild(pre);
      var report = function () { pre.textContent = JSON.stringify(out); document.title = out.done ? 'QA DONE' : 'QA'; };

      var gateSeen = 0, steps = 0;
      var t = setInterval(function () {
        var v = A.view, st = A.state;
        if (!v || !st) return;
        // 사람이 읽고 누르는 시간을 흉내낸다
        var gb = document.getElementById('gate');
        if (gb && !gb.classList.contains('hidden')) {
          gateSeen++;
          if (gateSeen > 40) { document.getElementById('gateBtn').click(); gateSeen = 0; }   // 1.2초쯤 읽고 누른다
          return;
        }
        if (v.phase === 'over' || steps++ > 3000) { out.done = true; clearInterval(t); clearInterval(poll); report(); return; }
        var need;
        try { need = E.needsAction(st); } catch (e1) { return; }
        if (need.indexOf('me') < 0) { report(); return; }
        log('me', v.phase, 1);
        try {
          if (st.trade && E.tradePending(st).indexOf('me') >= 0) { A.act('replyTrade', [Ai.replyToTrade(v)]); report(); return; }
          if (v.phase === 'order') { A.act('rollForOrder', []); report(); return; }
          if (v.phase === 'setup') {
            if (v.setup.who !== 'me') { report(); return; }
            if (v.setup.sub === 'settlement') { var x = Ai.chooseSetupSettlement(v); A.act('placeSettlement', [x != null ? x : v.legal.settlements[0]]); }
            else { var e2 = Ai.chooseSetupRoad(v); A.act('placeRoad', [e2 != null ? e2 : v.legal.roads[0]]); }
            report(); return;
          }
          if (v.phase === 'discard') { A.act('discard', [ext ? Ai.chooseDiscard(v, v.mustDiscard[v.me]) : Ai.chooseDiscard(v)]); report(); return; }
          if (v.phase === 'robber') {
            var rb = Ai.chooseRobber(v), cs = E.robberVictims(st, rb.hex, 'me');
            A.act('moveRobber', [rb.hex, cs.length ? (rb.victim && cs.indexOf(rb.victim) >= 0 ? rb.victim : cs[0]) : null]);
            report(); return;
          }
          var a2 = ext ? Ai.act(v) : Ai.act(v, 1);
          if (a2) A.act(a2.action, a2.args);
          else if (v.phase === 'roll') A.act('roll', []);
          else A.act('endTurn', []);
        } catch (e3) { out.errs.push('내 차례: ' + e3.message); }
        report();
      }, 30);
      report();
      return;
    }

    // ---- 한 판을 끝까지 돌리며 오류를 모은다 (?scene=qa&mode=base|ck) ----
    if (scene === 'qa') {
      var ext = q.get('mode') === 'ck';
      var msel = document.getElementById('mode');
      msel.value = ext ? 'ck' : 'base'; msel.onchange();
      document.getElementById('btnSolo').click();
      var A = window.__ct, E = ext ? window.CK : window.Rules, Ai = ext ? window.CKAI : window.AI;
      var out = { mode: ext ? 'ck' : 'base', errs: [], acts: 0, steps: 0, done: false, turn: 0, winner: null, vps: null };
      window.onerror = function (m, src, l, c) { out.errs.push(m + ' @' + l + ':' + c); };
      window.addEventListener('unhandledrejection', function (e) { out.errs.push('promise: ' + e.reason); });
      var ce = console.error;
      console.error = function () { out.errs.push('console: ' + Array.prototype.join.call(arguments, ' ')); ce.apply(console, arguments); };
      var pre = document.createElement('pre');
      pre.id = 'qaout'; pre.style.display = 'none'; document.body.appendChild(pre);
      var report = function () { pre.textContent = JSON.stringify(out); document.title = out.done ? 'QA DONE' : 'QA'; };
      var t = setInterval(function () {
        var v = A.view, st = A.state;
        if (!v || !st) return;
        var gb = document.getElementById('gate');
        if (gb && !gb.classList.contains('hidden')) { document.getElementById('gateBtn').click(); return; }
        out.steps++; out.turn = v.turnCount;
        if (v.phase === 'over') {
          out.done = true; out.winner = v.winner;
          out.vps = v.players.map(function (p) { return p.name + ':' + (p.vpFull != null ? p.vpFull : p.vp); });
          clearInterval(t); report(); return;
        }
        if (out.steps > 26000) { out.errs.push('끝나지 않음 phase=' + v.phase + ' turn=' + v.turnCount); clearInterval(t); report(); return; }
        var need;
        try { need = E.needsAction(st); } catch (e1) { out.errs.push('needsAction: ' + e1.message); report(); return; }
        if (need.indexOf('me') < 0) { report(); return; }
        try {
          if (st.trade && E.tradePending(st).indexOf('me') >= 0) { A.act('replyTrade', [Ai.replyToTrade(v)]); out.acts++; report(); return; }
          if (v.phase === 'order') { A.act('rollForOrder', []); out.acts++; report(); return; }
          if (v.phase === 'setup') {
            if (v.setup.who !== 'me') { report(); return; }
            if (v.setup.sub === 'settlement') { var x = Ai.chooseSetupSettlement(v); A.act('placeSettlement', [x != null ? x : v.legal.settlements[0]]); }
            else { var e2 = Ai.chooseSetupRoad(v); A.act('placeRoad', [e2 != null ? e2 : v.legal.roads[0]]); }
            out.acts++; report(); return;
          }
          if (v.phase === 'discard') {
            A.act('discard', [ext ? Ai.chooseDiscard(v, v.mustDiscard[v.me]) : Ai.chooseDiscard(v)]);
            out.acts++; report(); return;
          }
          if (v.phase === 'robber') {
            var rb = Ai.chooseRobber(v), cs = E.robberVictims(st, rb.hex, 'me');
            A.act('moveRobber', [rb.hex, cs.length ? (rb.victim && cs.indexOf(rb.victim) >= 0 ? rb.victim : cs[0]) : null]);
            out.acts++; report(); return;
          }
          var a2 = ext ? Ai.act(v) : Ai.act(v, 1);
          if (a2) { A.act(a2.action, a2.args); out.acts++; }
          else if (v.phase === 'roll') A.act('roll', []);
          else A.act('endTurn', []);
        } catch (e3) {
          out.errs.push('내 차례: ' + e3.message + ' | ' + (e3.stack || '').split('\n')[1]);
        }
        report();
      }, 130);
      report();
      return;
    }

    if (scene === 'home') {
      var mh = document.getElementById('mode');
      mh.value = 'ck'; mh.onchange();
      document.getElementById('name').value = '민수';
      document.title = 'READY';
      return;
    }
    if (scene === 'ckcard') {
      var CKm = document.getElementById('mode');
      CKm.value = 'ck'; CKm.onchange();
      document.getElementById('btnSolo').click();
      var A2 = window.__ct, K = window.CK, s2 = A2.state;
      while (s2.phase === 'order') K.needsAction(s2).forEach(function (pid) { K.rollForOrder(s2, pid); });
      while (s2.phase === 'setup') {
        var w2 = s2.players[s2.setupOrder[s2.setupIdx]].id;
        if (s2.setupSub === 'settlement') K.placeSettlement(s2, w2, K.legalSettlements(s2, w2)[0]);
        else K.placeRoad(s2, w2, K.legalRoads(s2, w2)[0]);
      }
      A2.intro = false; clearTimeout(A2.introTimer);
      var me2 = K.playerOf(s2, 'me');
      s2.turn = s2.players.indexOf(me2); s2.phase = 'main';
      me2.cards.push({ type: 'alchemist', track: 'science', turn: s2.turnCount });
      s2.log.push({ i: s2.logId++, only: 'me', text: '진보카드를 받았습니다 — 연금술사' });
      A2.lastLogId = s2.log[s2.log.length - 2].i;
      A2.feed.length = 0; A2.feedBusy = false;
      A2.pushViews();
      setInterval(function () { clearTimeout(A2.botTimer); clearTimeout(A2.crTimer); clearTimeout(A2.bigTimer); }, 40);
      setTimeout(function () { document.title = 'READY'; }, 900);
      return;
    }
    document.getElementById('mode').value = 'base';
    document.getElementById('mode').onchange();
    document.getElementById('btnSolo').click();
    if (scene === 'play') { document.title = 'READY'; return; }   // 그냥 흘러가게 두고 지켜본다
    var A = window.__ct, R = window.Rules, AI = window.AI, s = A.state;
    while (s.phase === 'order' && scene !== 'order') {
      R.needsAction(s).forEach(function (pid) { R.rollForOrder(s, pid); });
    }
    while (s.phase === 'setup') {
      var w = s.players[s.setupOrder[s.setupIdx]].id;
      if (s.setupSub === 'settlement') {
        if (!R.placeSettlement(s, w, AI.chooseSetupSettlement(R.viewFor(s, w))).ok)
          R.placeSettlement(s, w, R.legalSettlements(s, w)[0]);
      } else {
        if (!R.placeRoad(s, w, AI.chooseSetupRoad(R.viewFor(s, w))).ok)
          R.placeRoad(s, w, R.legalRoads(s, w)[0]);
      }
    }
    if (scene === 'order') {
      clearTimeout(A.botTimer);
      A.pushViews();
      setInterval(function(){ clearTimeout(A.botTimer); }, 50);
      document.title = 'READY';
      return;
    }
    // ---- 카드 그림 장면들 ----
    var freeze = function () { setInterval(function () {
      clearTimeout(A.botTimer); clearTimeout(A.crTimer); clearTimeout(A.bigTimer);
    }, 40); };
    var onlyLastLine = function () { A.lastLogId = s.log[s.log.length - 2].i; A.feed.length = 0; A.feedBusy = false; };

    if (scene === 'card' || scene === 'card2' || scene === 'award' || scene === 'hand') {
      var me = R.playerOf(s, 'me');
      A.intro = false; clearTimeout(A.introTimer);
      s.turn = s.players.indexOf(me); s.phase = 'main';
      me.res = { b: 0, l: 0, w: 3, g: 3, o: 3 };
      if (scene === 'card' || scene === 'card2') {
        s.devDeck.push(scene === 'card' ? 'knight' : 'monopoly');
        R.buyDev(s, 'me');
        onlyLastLine();
      } else if (scene === 'award') {
        s.log.push({ i: s.logId++, only: null, text: me.name + ' 최장 교역로 (5) — 2점' });
        onlyLastLine();
      } else {
        // 손패에 발전 카드 몇 장을 쥔 모습
        me.dev = [{ type: 'knight', turn: 0 }, { type: 'monopoly', turn: 0 }, { type: 'plenty', turn: 0 }];
        me.res = { b: 2, l: 3, w: 1, g: 2, o: 2 };
        A.feed.length = 0; A.feedBusy = true;
      }
      A.pushViews();
      freeze();
      setTimeout(function () { document.title = 'READY'; }, 900);
      return;
    }

    var p = R.playerOf(s, 'me');
    s.turn = 0; s.phase = 'main';
    p.res = { b: 3, l: 3, w: 2, g: 2, o: 1 };
    clearTimeout(A.botTimer);

    if (scene === 'other') {
      p.res = { g: 2, o: 3, b: 0, l: 0, w: 0 };
      R.build(s, 'me', 'city', R.legalCities(s, 'me')[0]);
      R.endTurn(s, 'me');
    } else if (scene === 'steal') {
      var bot = R.playerOf(s, 'bot0'); bot.res.l += 3; s.bank.l -= 3;
      s.phase = 'robber'; s.robberBack = 'main';
      var target = null;
      s.board.hexes.forEach(function (h, i) {
        if (target !== null || i === s.robber || !h.res) return;
        if (R.robberVictims(s, i, 'me').length) target = i;
      });
      var c = R.robberVictims(s, target, 'me');
      R.moveRobber(s, 'me', target, c[0]);
    } else if (scene === 'robbed') {
      // 봇이 내 카드를 빼앗는 장면
      p.res = { b: 2, l: 2, w: 1, g: 1, o: 1 };
      var v2 = null;
      s.board.hexes.forEach(function (h, i) {
        if (v2 !== null || i === s.robber || !h.res) return;
        if (R.robberVictims(s, i, 'bot0').indexOf('me') >= 0) v2 = i;
      });
      s.phase = 'robber'; s.turn = 1; s.robberBack = 'main';
      R.moveRobber(s, 'bot0', v2, 'me');
    } else if (scene === 'over') {
      A.intro = false; clearTimeout(A.introTimer);
      p.res = { g: 2, o: 3, b: 0, l: 0, w: 0 };
      R.build(s, 'me', 'city', R.legalCities(s, 'me')[0]);
      s.winner = 'me'; s.phase = 'over'; A.confettiDone = true;
      A.feed.length = 0; A.feedBusy = true;
      A.pushViews(); clearTimeout(A.botTimer);
      setInterval(function () { clearTimeout(A.botTimer); }, 50);
      document.title = 'READY';
      return;
    } else if (scene === 'dice') {
      // 주사위 트레이 — 굴린 직후 멈춘 상태
      A.intro = false; clearTimeout(A.introTimer);
      s.phase = 'main'; s.dice = [3, 5]; A.diceKey = null;
      A.feed.length = 0; A.feedBusy = true;
      A.pushViews(); clearTimeout(A.botTimer);
      setInterval(function () { clearTimeout(A.botTimer); }, 50);
      document.title = 'READY';
      return;
    } else if (scene === 'sweep') {
      // 7 — 도둑이야! 질주를 중간 프레임에서 멈춘다
      A.intro = false; clearTimeout(A.introTimer);
      A.pushViews(); clearTimeout(A.botTimer);
      var ov = document.getElementById('robberSweep'), fig = document.getElementById('sweepFig'), txt = document.getElementById('sweepText');
      document.getElementById('bigNews').classList.add('hidden'); clearTimeout(A.bigTimer);
      A.feed.length = 0; A.feedBusy = true;
      ov.classList.remove('hidden');
      fig.style.animation = 'sweepRun 1.5s cubic-bezier(0.3,0.05,0.6,1) -0.62s paused forwards';
      txt.style.animation = 'sweepTextPop 1.5s cubic-bezier(0.2,1.4,0.4,1) -0.5s paused forwards';
      setTimeout(function () {
        var r = fig.getBoundingClientRect();
        for (var i = 0; i < 8; i++) {
          var pf = document.createElement('i'); pf.className = 'puff';
          pf.style.left = (r.left + r.width * 0.2 - i * 30 + (Math.random() * 10 - 5)) + 'px';
          pf.style.top = (r.bottom - 12 + (Math.random() * 8 - 4)) + 'px';
          pf.style.animation = 'puffOut 0.9s ease-out ' + (-0.1 * i - 0.05) + 's paused forwards';
          ov.appendChild(pf);
        }
        document.title = 'READY';
      }, 200);
      setInterval(function () { clearTimeout(A.botTimer); }, 50);
      return;
    } else if (scene === 'discard') {
      R.RES.forEach(function (c2) { p.res[c2] = 2; });
      s.phase = 'roll';
      var n = 0;
      while (n++ < 600) {
        s.phase = 'roll'; s.dice = null;
        R.roll(s, 'me');
        if (s.dice[0] + s.dice[1] === 7) break;
        if (s.phase !== 'roll') s.phase = 'main';
        R.RES.forEach(function (c3) { p.res[c3] = 2; });
      }
    }
    clearTimeout(A.botTimer);
    A.feed.length = 0; A.feedBusy = false; A.lastLogId = undefined;
    A.pushViews();
    clearTimeout(A.botTimer);
    // 장면별 알림을 띄운 채로 고정
    if (scene === 'robbed') {
      var thief2 = A.view.players.filter(function (x) { return x.id === 'bot0'; })[0];
      A.feed = [{ text: '봇 하나이(가) 민수에게서 카드 한 장을 가져갔습니다.', icon: '🤚', hold: 99000, big: true, owner: thief2 }];
      A.feedBusy = false; A.pushViews();
    } else if (scene === 'steal') {
      var thief = A.view.players.filter(function (x) { return x.id === 'me'; })[0];
      A.feed = [{ text: '민수이(가) 봇 둘에게서 카드 한 장을 가져갔습니다.', icon: '🤚', hold: 99000, big: true, owner: thief }];
      A.feedBusy = false; A.pushViews();
    } else if (scene === 'robbed') {
      // 봇이 내 카드를 빼앗는 장면
      p.res = { b: 2, l: 2, w: 1, g: 1, o: 1 };
      var v2 = null;
      s.board.hexes.forEach(function (h, i) {
        if (v2 !== null || i === s.robber || !h.res) return;
        if (R.robberVictims(s, i, 'bot0').indexOf('me') >= 0) v2 = i;
      });
      s.phase = 'robber'; s.turn = 1; s.robberBack = 'main';
      R.moveRobber(s, 'bot0', v2, 'me');
    } else if (scene === 'over') {
      A.intro = false; clearTimeout(A.introTimer);
      p.res = { g: 2, o: 3, b: 0, l: 0, w: 0 };
      R.build(s, 'me', 'city', R.legalCities(s, 'me')[0]);
      s.winner = 'me'; s.phase = 'over'; A.confettiDone = true;
      A.feed.length = 0; A.feedBusy = true;
      A.pushViews(); clearTimeout(A.botTimer);
      setInterval(function () { clearTimeout(A.botTimer); }, 50);
      document.title = 'READY';
      return;
    } else if (scene === 'dice') {
      // 주사위 트레이 — 굴린 직후 멈춘 상태
      A.intro = false; clearTimeout(A.introTimer);
      s.phase = 'main'; s.dice = [3, 5]; A.diceKey = null;
      A.feed.length = 0; A.feedBusy = true;
      A.pushViews(); clearTimeout(A.botTimer);
      setInterval(function () { clearTimeout(A.botTimer); }, 50);
      document.title = 'READY';
      return;
    } else if (scene === 'sweep') {
      // 7 — 도둑이야! 질주를 중간 프레임에서 멈춘다
      A.intro = false; clearTimeout(A.introTimer);
      A.pushViews(); clearTimeout(A.botTimer);
      var ov = document.getElementById('robberSweep'), fig = document.getElementById('sweepFig'), txt = document.getElementById('sweepText');
      document.getElementById('bigNews').classList.add('hidden'); clearTimeout(A.bigTimer);
      A.feed.length = 0; A.feedBusy = true;
      ov.classList.remove('hidden');
      fig.style.animation = 'sweepRun 1.5s cubic-bezier(0.3,0.05,0.6,1) -0.62s paused forwards';
      txt.style.animation = 'sweepTextPop 1.5s cubic-bezier(0.2,1.4,0.4,1) -0.5s paused forwards';
      setTimeout(function () {
        var r = fig.getBoundingClientRect();
        for (var i = 0; i < 8; i++) {
          var pf = document.createElement('i'); pf.className = 'puff';
          pf.style.left = (r.left + r.width * 0.2 - i * 30 + (Math.random() * 10 - 5)) + 'px';
          pf.style.top = (r.bottom - 12 + (Math.random() * 8 - 4)) + 'px';
          pf.style.animation = 'puffOut 0.9s ease-out ' + (-0.1 * i - 0.05) + 's paused forwards';
          ov.appendChild(pf);
        }
        document.title = 'READY';
      }, 200);
      setInterval(function () { clearTimeout(A.botTimer); }, 50);
      return;
    } else if (scene === 'discard') {
      A.feed = [{ text: '7 — 절반 버리기: 민수 5장', icon: '🗑️', hold: 99000, big: true, owner: null }];
      A.feedBusy = false; A.pushViews();
    }
    clearTimeout(A.botTimer);
    setInterval(function(){ clearTimeout(A.botTimer); }, 200);
    if (window.__variant === 'D') {
      document.querySelectorAll('.cardSlot').forEach(function (el2) {
        var nm = el2.querySelector('.resName');
        el2.dataset.label = nm ? nm.textContent : '';
      });
    }
    document.title = 'READY';
  });
})();
