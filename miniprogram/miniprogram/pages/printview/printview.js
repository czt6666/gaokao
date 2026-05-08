// pages/printview/printview.js
// 袁希™ 报告文档视图 — Jobs版：用原生WXML渲染，告别画布涂鸦

const app = getApp();

Page({
  data: {
    report:      null,
    aiPlanText:  '',
    aiSchools:   [],
    usaResult:   null,
    childName:   '',
    // 控制各节展开（文档视图全部展开）
    showAiSchools: true,
    showUsaMatch:  true,
    showActions:   true,
  },

  onLoad() {
    const d = (app.globalData && app.globalData.pendingPrintData) || {};
    const r = d.report;
    if (!r) {
      wx.showToast({ title: '报告数据丢失，请返回重试', icon: 'none' });
      return;
    }
    const childName = (r.meta && r.meta.childName) || '孩子';
    this.setData({
      report:     r,
      aiPlanText: d.aiPlanText || '',
      aiSchools:  d.aiSchools  || [],
      usaResult:  d.usaResult  || null,
      childName,
    });
    wx.setNavigationBarTitle({ title: childName + ' 的成长战略报告' });
  },

  onUnload() {
    // 清理 globalData，避免内存泄漏
    if (app.globalData) app.globalData.pendingPrintData = null;
  },

  // 保存为长图（兜底方案）
  saveAsImage() {
    const pages = getCurrentPages();
    const resultPage = pages.find(p => p.route === 'pages/result/result');
    if (resultPage && resultPage.exportLongImage) {
      wx.navigateBack({ delta: 1 });
      setTimeout(() => resultPage.exportLongImage(), 400);
    } else {
      wx.showToast({ title: '请返回报告页使用导出功能', icon: 'none' });
    }
  },

  onShareAppMessage() {
    const name = this.data.childName;
    return {
      title: `${name}的成长战略报告 · 袁希方法论`,
      path: '/pages/index/index',
      imageUrl: '',
    };
  },
});
