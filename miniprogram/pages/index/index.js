const ROWS = 16;
const COLS = 10;
const TOTAL = ROWS * COLS;

Page({
  data: {
    cells: [],
    boardW: 0,
    boardH: 0,
    cellW: 0,
    cellH: 0,
    fontSize: 16,
    sel: null,
    dragging: false,
    sumText: '',
    sumOk: false,
    iq: 0,
    best: 0,
    progress: 0,
    cleared: 0,
    total: TOTAL,
    bomb: 3,
    over: false,
    tip: ''
  },

  onLoad() {
    const info = wx.getSystemInfoSync();
    const winW = info.windowWidth;
    const winH = info.windowHeight;

    // 顶部 HUD + 底部工具 + 提示占用的高度
    const reserveH = 190;
    const availW = winW - 24;
    const availH = winH - reserveH;

    let cell = Math.floor(Math.min(availW / COLS, availH / ROWS));
    if (cell < 18) cell = 18;

    this.cellW = cell;
    this.cellH = cell;

    this.setData({
      boardW: cell * COLS,
      boardH: cell * ROWS,
      cellW: cell,
      cellH: cell,
      fontSize: Math.max(11, Math.floor(cell * 0.5)),
      best: (getApp().globalData.bestScore) || 0
    }, () => {
      // 必须等首次渲染完成再量，否则 rect 为空导致拖不动
      this.measure();
      setTimeout(() => this.measure(), 160);
    });

    this.grid = new Array(TOTAL).fill(0);
    this.newGame();
  },

  onReady() {
    this.measure();
    setTimeout(() => this.measure(), 200);
  },

  onShow() {
    const app = getApp();
    if (app.globalData.bestScore > this.data.best) {
      this.setData({ best: app.globalData.bestScore });
    }
  },

  measure() {
    wx.createSelectorQuery()
      .in(this)
      .select('#board')
      .boundingClientRect(rect => {
        if (rect) this.boardRect = rect;
      })
      .exec();
  },

  /* ---------------- 开局 ---------------- */

  newGame() {
    let g;
    let guard = 0;
    do {
      g = new Array(TOTAL);
      for (let i = 0; i < TOTAL; i++) g[i] = 1 + Math.floor(Math.random() * 9);
      this.balanceTotal(g);   // 让 160 格总和是 10 的倍数
      this.grid = g;
      guard++;
    } while (!this.findRect() && guard < 30);

    this.a = null;
    this.b = null;

    this.setData({
      cells: g.map((v, i) => ({ v, id: i, gone: false })),
      iq: 0,
      progress: 0,
      cleared: 0,
      bomb: 3,
      over: false,
      sel: null,
      tip: ''
    });

    setTimeout(() => {
      this.measure();
      this.flashTip('按住拖动，框出和为 10 的矩形');
    }, 120);
  },

  /* 把总和调成 10 的倍数：随机动一个格子，加减 10 - 余数 */
  balanceTotal(g) {
    let total = 0;
    for (let i = 0; i < TOTAL; i++) total += g[i];
    const rem = total % 10;
    if (rem === 0) return;

    const need = 10 - rem;        // 需要补的点数 1..9
    for (let i = 0; i < TOTAL; i++) {
      if (g[i] + need <= 9) {
        g[i] += need;
        return;
      }
    }
    // 加不上就改成减 (10 - need)，同样能让总和补齐
    const sub = 10 - need;
    for (let i = 0; i < TOTAL; i++) {
      if (g[i] - sub >= 1) {
        g[i] -= sub;
        return;
      }
    }
  },

  restart() {
    this.newGame();
  },

  /* ---------------- 触摸 ---------------- */

  onStart(e) {
    if (this.data.over) return;
    if (!this.boardRect) {
      this.measure();
      return;                       // 首次还没量到，这一下忽略，下一次就正常
    }
    const t = e.touches[0];
    const p = this.hit(t.clientX, t.clientY, false);
    if (!p) return;
    this.a = p;
    this.b = p;
    this.updateSel(p, p);
  },

  onMove(e) {
    if (!this.a) return;
    const t = e.touches[0];
    const p = this.hit(t.clientX, t.clientY, true);
    if (!p) return;
    if (!this.b || p.r !== this.b.r || p.c !== this.b.c) {
      this.b = p;
      this.updateSel(this.a, p);
    }
  },

  onEnd() {
    const a = this.a;
    const b = this.b;
    this.a = null;
    this.b = null;
    if (!a || !b) {
      this.setData({ sel: null, dragging: false, sumText: '' });
      return;
    }
    this.setData({ sel: null, dragging: false, sumText: '' });

    const r1 = Math.min(a.r, b.r);
    const r2 = Math.max(a.r, b.r);
    const c1 = Math.min(a.c, b.c);
    const c2 = Math.max(a.c, b.c);

    let sum = 0;
    let cnt = 0;
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const v = this.grid[r * COLS + c];
        if (v) {
          sum += v;
          cnt++;
        }
      }
    }

    if (cnt > 0 && sum === 10) {
      this.clearRect(r1, c1, r2, c2);
    } else {
      this.flashTip(sum === 0 ? '框里没有数字' : '和是 ' + sum + '，不是 10');
    }
  },

  hit(x, y, clamp) {
    const bd = this.boardRect;
    if (!bd) return null;
    let c = Math.floor((x - bd.left) / this.cellW);
    let r = Math.floor((y - bd.top) / this.cellH);
    if (clamp) {
      // 手指滑出棋盘/屏幕边缘时贴边，松手前还能继续调整
      if (r < 0) r = 0; else if (r >= ROWS) r = ROWS - 1;
      if (c < 0) c = 0; else if (c >= COLS) c = COLS - 1;
      return { r, c };
    }
    if (x < bd.left || x > bd.right || y < bd.top || y > bd.bottom) return null;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return { r, c };
  },

  sumIn(r1, c1, r2, c2) {
    let sum = 0, cnt = 0;
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const v = this.grid[r * COLS + c];
        if (v) { sum += v; cnt++; }
      }
    }
    return { sum, cnt };
  },

  updateSel(a, b) {
    const r1 = Math.min(a.r, b.r);
    const r2 = Math.max(a.r, b.r);
    const c1 = Math.min(a.c, b.c);
    const c2 = Math.max(a.c, b.c);
    const res = this.sumIn(r1, c1, r2, c2);
    const ok = res.sum === 10 && res.cnt > 0;
    this.setData({
      sel: {
        x: c1 * this.cellW,
        y: r1 * this.cellH,
        w: (c2 - c1 + 1) * this.cellW,
        h: (r2 - r1 + 1) * this.cellH
      },
      dragging: true,
      sumOk: ok,
      sumText: ok ? res.sum + ' ✓' : res.sum + ' / 10'
    });
  },

  /* ---------------- 消除 ---------------- */

  clearRect(r1, c1, r2, c2) {
    const upd = {};
    let n = 0;
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const i = r * COLS + c;
        if (this.grid[i]) {
          this.grid[i] = 0;
          upd['cells[' + i + '].gone'] = true;
          n++;
        }
      }
    }
    if (!n) return;

    const iq = this.data.iq + n;      // 分数 = 消除的数字个数
    const cleared = this.data.cleared + n;
    upd.iq = iq;
    upd.cleared = cleared;
    upd.progress = Math.round((cleared / TOTAL) * 100);
    upd.tip = '';

    this.setData(upd);

    if (wx.vibrateShort) {
      try { wx.vibrateShort({ type: 'light' }); } catch (e) {}
    }

    setTimeout(() => {
      if (!this.findRect()) this.finish();
    }, 300);
  },

  useBomb() {
    if (this.data.over) return;
    if (this.data.bomb <= 0) {
      this.flashTip('炸弹用完了');
      return;
    }
    const rect = this.findRect();
    if (!rect) {
      this.flashTip('已经没得消了');
      return;
    }
    this.setData({ bomb: this.data.bomb - 1 });
    this.clearRect(rect.r1, rect.c1, rect.r2, rect.c2);
  },

  /* ---------------- 判定 ---------------- */

  findRect() {
    const g = this.grid;
    for (let r1 = 0; r1 < ROWS; r1++) {
      const acc = new Array(COLS).fill(0);
      for (let r2 = r1; r2 < ROWS; r2++) {
        for (let c = 0; c < COLS; c++) acc[c] += g[r2 * COLS + c];
        const pre = [0];
        let run = 0;
        for (let c = 0; c < COLS; c++) {
          run += acc[c];
          pre.push(run);
        }
        for (let c1 = 0; c1 < COLS; c1++) {
          const base = pre[c1];
          for (let c2 = c1; c2 < COLS; c2++) {
            if (pre[c2 + 1] - base === 10) {
              return { r1, c1, r2, c2 };
            }
          }
        }
      }
    }
    return null;
  },

  finish() {
    const app = getApp();
    app.saveBest(this.data.iq);
    this.setData({ over: true, best: app.globalData.bestScore });
  },

  flashTip(t) {
    this.setData({ tip: t });
    if (this.tipTimer) clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => {
      this.setData({ tip: '' });
    }, 1200);
  }
});
