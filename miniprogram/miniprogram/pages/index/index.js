// pages/index/index.js
// 艺圆智探 · 首页 — 简洁双卡片导航

Page({
  tapGaokao() {
    wx.switchTab({ url: '/pages/gaokao/gaokao' });
  },

  tapStudyAbroad() {
    wx.navigateTo({ url: '/pages/schools/schools' });
  },

  onShareAppMessage() {
    const app = getApp();
    const status = app.globalData && app.globalData.userStatus;
    const code = (status && status.referralCode) || '';
    let path = '/pages/index/index';
    if (code) path += '?ref=' + code;
    return {
      title: '艺圆智探 · 高考志愿填报神器，输入位次自动推荐最优志愿',
      path,
    };
  },

  onShareTimeline() {
    const app = getApp();
    const status = app.globalData && app.globalData.userStatus;
    const code = (status && status.referralCode) || '';
    let query = '';
    if (code) query = 'ref=' + code;
    return {
      title: '艺圆智探 · 高考志愿填报神器，输入位次自动推荐最优志愿',
      query,
    };
  },
});
