// pages/index/index.js
// 艺圆智探 · 首页 — 简洁双卡片导航

Page({
  tapGaokao() {
    wx.switchTab({ url: '/pages/gaokao/gaokao' });
  },

  tapStudyAbroad() {
    wx.navigateTo({ url: '/pages/schools/schools' });
  },
});
