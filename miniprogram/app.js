App({
  globalData: {
    bestScore: 0
  },

  onLaunch() {
    try {
      const best = wx.getStorageSync('bestScoreV2');
      if (best) this.globalData.bestScore = Number(best) || 0;
    } catch (e) {}
  },

  saveBest(score) {
    if (score > this.globalData.bestScore) {
      this.globalData.bestScore = score;
      try { wx.setStorageSync('bestScoreV2', score); } catch (e) {}
    }
  }
});
