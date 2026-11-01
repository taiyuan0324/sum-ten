/* 凑十消除 · 核心逻辑
 * 规则：框选一个矩形，框内「剩余」数字之和等于 10 即可消除；
 *       消除后格子留空，其他数字位置不变；得分 = 消除的数字个数。
 * 该文件同时被 Web / Capacitor(iOS) 使用。
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
  var cellSize = 30;

  var score = 0;
  var cleared = 0;
  var bomb = BOMB_INIT;
  var over = false;
  var pending = false;
  var best = readBest();

  var startCell = null;
  var endCell = null;
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
    // 用容器的真实尺寸，而不是 innerWidth：iOS 安全区/滚动条都会让两者不等
    var wrapW = (stage && stage.clientWidth) || (document.documentElement.clientWidth - 24) || 320;
    var wrapH = (stage && stage.clientHeight) || 0;

    if (!wrapH || wrapH < 60) {
      wrapH = (window.innerHeight || 640) * 0.6;
    }
    wrapW -= 2;
    wrapH -= 2;

    var s = Math.floor(Math.min(wrapW / COLS, wrapH / ROWS));

    // 兜底：极窄屏也保证 14px 以上，避免数字糊成一团
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
    startCell = null;
    endCell = null;

    buildDom();
    layout();
    updateHud();
    hideSel();
    maskEl.classList.remove('on');
    flashTip('按住拖动，框出和为 10 的矩形');
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

        // 列前缀和，配合双指针之外的双重循环（COLS 只有 10，直接枚举更快）
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

  /* ---------------- 框选交互 ---------------- */

  function hitTest(x, y) {
    var rect = boardEl.getBoundingClientRect();
    var c = Math.floor((x - rect.left) / cellSize);
    var r = Math.floor((y - rect.top) / cellSize);
    if (r < 0) r = 0; if (r >= ROWS) r = ROWS - 1;
    if (c < 0) c = 0; if (c >= COLS) c = COLS - 1;
    return { r: r, c: c };
  }

  function bounds(a, b) {
    return {
      r1: Math.min(a.r, b.r), r2: Math.max(a.r, b.r),
      c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c)
    };
  }

  function drawSel(a, b) {
    var d = bounds(a, b);
    var x = d.c1 * cellSize;
    var y = d.r1 * cellSize;
    var w = (d.c2 - d.c1 + 1) * cellSize;
    var h = (d.r2 - d.r1 + 1) * cellSize;

    selbox.style.display = 'block';
    selbox.style.left = x + 'px';
    selbox.style.top = y + 'px';
    selbox.style.width = w + 'px';
    selbox.style.height = h + 'px';

    var res = sumOf(d.r1, d.c1, d.r2, d.c2);
    selSum.textContent = res.sum + (res.sum === 10 ? ' ✓' : '');
    selSum.className = 'sel-sum' + (res.sum === 10 ? ' ok' : (res.sum > 10 ? ' bad' : ''));
    selSum.style.display = 'block';

    // 气泡用 fixed 定位（不受棋盘 overflow:hidden 裁剪）
    var br = boardEl.getBoundingClientRect();
    selSum.style.left = (br.left + x + w / 2) + 'px';
    var topY = br.top + y - 6;
    if (topY < 52) topY = br.top + y + h + 32;   // 贴顶时改到框下方
    selSum.style.top = topY + 'px';
  }

  function hideSel() {
    selbox.style.display = 'none';
    selSum.style.display = 'none';
  }

  function onDown(e) {
    if (over) return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    startCell = hitTest(e.clientX, e.clientY);
    endCell = startCell;
    drawSel(startCell, startCell);
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function onMove(e) {
    if (!startCell) return;
    e.preventDefault();
    var p = hitTest(e.clientX, e.clientY);
    if (p.r !== endCell.r || p.c !== endCell.c) {
      endCell = p;
      drawSel(startCell, endCell);
    }
  }

  function onUp(e) {
    if (!startCell) return;
    if (e && e.clientX !== undefined) {
      endCell = hitTest(e.clientX, e.clientY);
    }
    var d = bounds(startCell, endCell);
    startCell = null;
    endCell = null;
    hideSel();

    var res = sumOf(d.r1, d.c1, d.r2, d.c2);
    if (res.cnt === 0) {
      flashTip('框里没有数字');
      return;
    }
    if (res.sum !== 10) {
      flashTip('和是 ' + res.sum + '，不是 10');
      haptic('light');
      return;
    }
    clearRect(d.r1, d.c1, d.r2, d.c2);
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
    boardEl.addEventListener('pointerdown', onDown);
    boardEl.addEventListener('pointermove', onMove);
    boardEl.addEventListener('pointerup', onUp);
    boardEl.addEventListener('pointercancel', function () {
      startCell = null;
      endCell = null;
      hideSel();
    });
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

    // iOS 上双击缩放/回弹的兜底
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
      // 字体加载完/地址栏收起后尺寸会变，补一次
      window.addEventListener('load', function () { setTimeout(layout, 80); });
      setTimeout(layout, 260);
    } catch (err) {
      // 启动失败时不要白屏，把原因挂出来便于排查
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
    findRect: findRect,
    sumOf: sumOf,
    newGame: newGame
  };
})();
