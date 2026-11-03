/* 凑十消除 · 核心逻辑
 * 规则：框选一个矩形，框内「剩余」数字之和等于 10 即可消除；
 *       消除后格子留空，其他数字位置不变；得分 = 消除的数字个数。
 * 该文件同时被 Web / Capacitor(iOS) 使用。
 *
 * 交互：按住任意格子 → 拖动画出一个矩形 → 松手判定。
 *       iOS 的 WKWebView 在 pointerdown 里 preventDefault 后会吞掉 pointermove，
 *       所以这里优先走 touch 事件，鼠标作为桌面端回退。
 */
(function () {
  'use strict';

  var ROWS = 16;
  var COLS = 10;
  var TOTAL = ROWS * COLS;
  var BOMB_INIT = 3;
  var BEST_KEY = 'sumten_best_v2';

  var boardEl = document.getElementById('board');
  var selbox = document.getElementById('selbox');
  var selSum = document.getElementById('selSum');
  var tipEl = document.getElementById('tip');
  var maskEl = document.getElementById('mask');

  var grid = new Array(TOTAL).fill(0);
  var tiles = new Array(TOTAL).fill(null);
  var cellEls = new Array(TOTAL).fill(null);
  var cellSize = 30;

  var score = 0;
  var cleared = 0;
  var bomb = BOMB_INIT;
  var over = false;
  var pending = false;
  var best = readBest();

  var dragging = false;
  var dragFrom = null;
  var dragTo = null;
  var hlSet = Object.create(null);
  var tipTimer = 0;

  /* ---------------- 工具 ---------------- */

  function readBest() {
    try {
      var v = parseInt(localStorage.getItem(BEST_KEY), 10);
      return isNaN(v) ? 0 : v;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(v) {
    try {
      localStorage.setItem(BEST_KEY, String(v));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function haptic(kind) {
    try {
      var C = window.Capacitor;
      if (C && C.Plugins && C.Plugins.Haptics) {
        if (kind === 'medium') C.Plugins.Haptics.impact({ style: 'MEDIUM' });
        else C.Plugins.Haptics.impact({ style: 'LIGHT' });
        return;
      }
    } catch (e) { /* 降级到 vibrate */ }
    if (navigator.vibrate) {
      try { navigator.vibrate(kind === 'medium' ? 18 : 8); } catch (e2) {}
    }
  }

  function flashTip(text) {
    tipEl.textContent = text;
    tipEl.style.opacity = '1';
    if (tipTimer) clearTimeout(tipTimer);
    tipTimer = setTimeout(function () {
      tipEl.style.opacity = '0';
    }, 1300);
  }

  /* ---------------- 布局 ---------------- */

  function layout() {
    var stage = boardEl.parentNode;
    var wrapW = (stage && stage.clientWidth) || (document.documentElement.clientWidth - 24) || 320;
    var wrapH = (stage && stage.clientHeight) || 0;

    if (!wrapH || wrapH < 60) {
      wrapH = (window.innerHeight || 640) * 0.6;
    }
    wrapW -= 2;
    wrapH -= 2;

    var s = Math.floor(Math.min(wrapW / COLS, wrapH / ROWS));
    if (s < 14) s = 14;
    if (s > 52) s = 52;
    cellSize = s;

    boardEl.style.width = (s * COLS) + 'px';
    boardEl.style.height = (s * ROWS) + 'px';
    boardEl.style.gridTemplateColumns = 'repeat(' + COLS + ', ' + s + 'px)';
    boardEl.style.gridTemplateRows = 'repeat(' + ROWS + ', ' + s + 'px)';

    var fs = Math.max(10, Math.round(s * 0.5));
    for (var i = 0; i < TOTAL; i++) {
      if (tiles[i]) tiles[i].style.fontSize = fs + 'px';
    }
    // 尺寸变了，正在拖的框要重画
    if (dragging) renderSel();
  }

  /* ---------------- 生成盘面 ---------------- */

  // 让 160 格总和是 10 的倍数，理论上才有可能清空
  function balanceTotal(g) {
    var total = 0;
    for (var i = 0; i < TOTAL; i++) total += g[i];
    var rem = total % 10;
    if (rem === 0) return;

    var need = 10 - rem;                 // 1..9
    for (var a = 0; a < TOTAL; a++) {
      if (g[a] + need <= 9) { g[a] += need; return; }
    }
    var sub = 10 - need;
    for (var b = 0; b < TOTAL; b++) {
      if (g[b] - sub >= 1) { g[b] -= sub; return; }
    }
  }

  function buildDom() {
    boardEl.innerHTML = '';
    boardEl.appendChild(selbox);
    tiles = new Array(TOTAL).fill(null);
    cellEls = new Array(TOTAL).fill(null);

    var frag = document.createDocumentFragment();
    for (var i = 0; i < TOTAL; i++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.textContent = grid[i];
      cell.appendChild(tile);
      frag.appendChild(cell);
      tiles[i] = tile;
      cellEls[i] = cell;
    }
    boardEl.appendChild(frag);
  }

  function newGame() {
    var g = null;
    var guard = 0;
    do {
      g = new Array(TOTAL);
      for (var i = 0; i < TOTAL; i++) g[i] = 1 + Math.floor(Math.random() * 9);
      balanceTotal(g);
      grid = g;
      guard++;
    } while (!findRect() && guard < 40);

    score = 0;
    cleared = 0;
    bomb = BOMB_INIT;
    over = false;
    pending = false;
    dragging = false;
    dragFrom = null;
    dragTo = null;
    hlSet = Object.create(null);

    buildDom();
    layout();
    updateHud();
    hideSel();
    maskEl.classList.remove('on');
    flashTip('按住格子拖动画框，和等于 10 就能消');
  }

  /* ---------------- HUD ---------------- */

  function updateHud() {
    document.getElementById('score').textContent = score;
    document.getElementById('best').textContent = best;
    document.getElementById('bombNum').textContent = bomb;
    document.getElementById('btnBomb').classList.toggle('disabled', bomb <= 0);

    var pct = Math.round((cleared / TOTAL) * 100);
    document.getElementById('barFill').style.width = pct + '%';
    document.getElementById('barText').textContent = cleared + ' / ' + TOTAL + ' 格';
  }

  /* ---------------- 求解：任意和 = 10 的矩形 ---------------- */

  function findRect() {
    for (var r1 = 0; r1 < ROWS; r1++) {
      var acc = new Array(COLS).fill(0);
      for (var r2 = r1; r2 < ROWS; r2++) {
        var base2 = r2 * COLS;
        for (var c = 0; c < COLS; c++) acc[c] += grid[base2 + c];

        var pre = [0];
        var run = 0;
        for (var k = 0; k < COLS; k++) { run += acc[k]; pre.push(run); }

        for (var c1 = 0; c1 < COLS; c1++) {
          var b0 = pre[c1];
          for (var c2 = c1; c2 < COLS; c2++) {
            if (pre[c2 + 1] - b0 === 10) {
              return { r1: r1, c1: c1, r2: r2, c2: c2 };
            }
          }
        }
      }
    }
    return null;
  }

  function sumOf(r1, c1, r2, c2) {
    var sum = 0, cnt = 0;
    for (var r = r1; r <= r2; r++) {
      var base = r * COLS;
      for (var c = c1; c <= c2; c++) {
        var v = grid[base + c];
        if (v) { sum += v; cnt++; }
      }
    }
    return { sum: sum, cnt: cnt };
  }

  /* ---------------- 框选绘制 ---------------- */

  function pointToCell(x, y) {
    var br = boardEl.getBoundingClientRect();
    var c = Math.floor((x - br.left) / cellSize);
    var r = Math.floor((y - br.top) / cellSize);
    // 允许拖出棋盘：贴边取最近的格子，松手前都能继续调整
    if (r < 0) r = 0; else if (r >= ROWS) r = ROWS - 1;
    if (c < 0) c = 0; else if (c >= COLS) c = COLS - 1;
    return { r: r, c: c };
  }

  function bounds(a, b) {
    return {
      r1: Math.min(a.r, b.r), r2: Math.max(a.r, b.r),
      c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c)
    };
  }

  function clearHL() {
    for (var k in hlSet) {
      var el = cellEls[+k];
      if (el) el.classList.remove('hl');
    }
    hlSet = Object.create(null);
  }

  function setHL(d) {
    var next = Object.create(null);
    for (var r = d.r1; r <= d.r2; r++) {
      var base = r * COLS;
      for (var c = d.c1; c <= d.c2; c++) next[base + c] = 1;
    }
    // 只增删差异，避免每次全量改 160 个 class
    for (var k in hlSet) {
      if (!next[k] && cellEls[+k]) cellEls[+k].classList.remove('hl');
    }
    for (var k2 in next) {
      if (!hlSet[k2] && cellEls[+k2]) cellEls[+k2].classList.add('hl');
    }
    hlSet = next;
  }

  function renderSel() {
    var d = bounds(dragFrom, dragTo);
    var x = d.c1 * cellSize;
    var y = d.r1 * cellSize;
    var w = (d.c2 - d.c1 + 1) * cellSize;
    var h = (d.r2 - d.r1 + 1) * cellSize;

    selbox.style.display = 'block';
    selbox.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    selbox.style.width = w + 'px';
    selbox.style.height = h + 'px';

    setHL(d);

    var res = sumOf(d.r1, d.c1, d.r2, d.c2);
    var ok = res.sum === 10 && res.cnt > 0;
    selSum.textContent = ok ? (res.sum + ' ✓') : (res.sum + ' / 10');
    selSum.className = 'sel-sum' + (ok ? ' ok' : (res.sum > 10 ? ' bad' : ''));
    selSum.style.display = 'block';

    var br = boardEl.getBoundingClientRect();
    selSum.style.left = (br.left + x + w / 2) + 'px';
    var topY = br.top + y - 8;
    if (topY < 54) topY = br.top + y + h + 34;   // 贴顶时挪到框下方
    selSum.style.top = topY + 'px';
  }

  function hideSel() {
    selbox.style.display = 'none';
    selSum.style.display = 'none';
    clearHL();
  }

  /* ---------------- 拖拽状态机 ---------------- */

  function beginDrag(x, y) {
    if (over || pending) return false;
    var p = pointToCell(x, y);
    dragging = true;
    dragFrom = p;
    dragTo = { r: p.r, c: p.c };
    renderSel();
    haptic('light');
    return true;
  }

  function moveDrag(x, y) {
    if (!dragging) return;
    var p = pointToCell(x, y);
    if (p.r !== dragTo.r || p.c !== dragTo.c) {
      dragTo = p;
      renderSel();
    }
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    var d = bounds(dragFrom, dragTo);
    dragFrom = null;
    dragTo = null;
    hideSel();

    var res = sumOf(d.r1, d.c1, d.r2, d.c2);
    if (res.cnt === 0) {
      flashTip('框里没有数字');
      return;
    }
    if (res.sum !== 10) {
      flashTip('和是 ' + res.sum + '，还差 ' + Math.abs(10 - res.sum));
      haptic('light');
      return;
    }
    clearRect(d.r1, d.c1, d.r2, d.c2);
  }

  /* ---------------- 输入绑定（touch 优先） ---------------- */

  function bindInput() {
    var hasTouch = ('ontouchstart' in window) ||
                   (navigator.maxTouchPoints > 0) ||
                   (window.matchMedia && window.matchMedia('(pointer:coarse)').matches);

    if (hasTouch) {
      boardEl.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) { endDrag(); return; }
        var t = e.touches[0];
        if (beginDrag(t.clientX, t.clientY)) e.preventDefault();
      }, { passive: false });

      // 绑在 document 上：手指滑出棋盘甚至滑出屏幕边缘时仍然跟手
      document.addEventListener('touchmove', function (e) {
        if (!dragging) return;
        if (e.touches.length !== 1) { endDrag(); return; }
        e.preventDefault();
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: false });

      document.addEventListener('touchend', function () { endDrag(); });
      document.addEventListener('touchcancel', function () { endDrag(); });
    }

    // 鼠标 / 触控板：桌面端与 iOS 模拟器
    boardEl.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      if (beginDrag(e.clientX, e.clientY)) {
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      }
    });
    function onMouseMove(e) { moveDrag(e.clientX, e.clientY); }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      endDrag();
    }
  }

  /* ---------------- 消除 ---------------- */

  function clearRect(r1, c1, r2, c2) {
    var n = 0;
    for (var r = r1; r <= r2; r++) {
      var base = r * COLS;
      for (var c = c1; c <= c2; c++) {
        var i = base + c;
        if (grid[i]) {
          grid[i] = 0;
          if (tiles[i]) {
            tiles[i].classList.add('gone');
            tiles[i].textContent = '';
          }
          n++;
        }
      }
    }
    if (!n) return;

    score += n;
    cleared += n;
    pending = true;
    updateHud();
    haptic('medium');

    setTimeout(function () {
      pending = false;
      if (!findRect()) finish();
    }, 280);
  }

  function useBomb() {
    if (over || pending) return;
    if (bomb <= 0) { flashTip('炸弹用完了'); return; }
    var rect = findRect();
    if (!rect) { flashTip('已经没得消了'); return; }
    bomb--;
    updateHud();
    clearRect(rect.r1, rect.c1, rect.r2, rect.c2);
    flashTip('炸弹清掉了 ' + (rect.r2 - rect.r1 + 1) + '×' + (rect.c2 - rect.c1 + 1) + ' 的一块');
  }

  function finish() {
    if (over) return;
    over = true;
    var isNewBest = score > best;
    if (isNewBest) {
      best = score;
      saveBest(best);
    }
    document.getElementById('finalScore').textContent = score;
    document.getElementById('finalBest').textContent = best;
    document.querySelector('.d-title').textContent = isNewBest ? '新纪录！这盘到此为止' : '这一盘消不动了';
    maskEl.classList.add('on');
    updateHud();
    haptic('medium');
  }

  /* ---------------- 绑定 ---------------- */

  function bindAll() {
    bindInput();

    boardEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    document.getElementById('btnBomb').addEventListener('click', useBomb);
    document.getElementById('btnNew').addEventListener('click', newGame);
    document.getElementById('btnAgain').addEventListener('click', newGame);
    document.getElementById('btnClose').addEventListener('click', function () {
      maskEl.classList.remove('on');
    });

    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function () {
      setTimeout(layout, 220);
    });

    // iOS 上双击缩放/多指回弹的兜底
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('touchmove', function (e) {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    try {
      bindAll();
      newGame();
      window.addEventListener('load', function () { setTimeout(layout, 80); });
      setTimeout(layout, 260);
    } catch (err) {
      window.__bootError = (err && err.stack) || String(err);
      var t = document.getElementById('tip');
      if (t) t.textContent = '启动失败，请刷新重试';
      if (window.console) console.error('[sumten] boot failed', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 调试/测试钩子（构建 ipa 时无副作用）
  window.__sumten = {
    get grid() { return grid.slice(); },
    get score() { return score; },
    get dragging() { return dragging; },
    findRect: findRect,
    sumOf: sumOf,
    newGame: newGame,
    _beginDrag: beginDrag,
    _moveDrag: moveDrag,
    _endDrag: endDrag
  };
})();
