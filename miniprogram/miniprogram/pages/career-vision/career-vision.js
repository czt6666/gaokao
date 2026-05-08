// pages/career-vision/career-vision.js
// P3 — 职业愿景详情页
// 展示单个职业集群的完整信息：
//   S1 — 概览（图标 / 标题 / tagline / 匹配分 / 匹配原因）
//   S2 — 为什么这条路适合你的孩子（基于MI分析）
//   S3 — 专业路径选择（美国本科专业 → CIP代码）
//   S4 — 美国 vs 回国 路径对比
//   S5 — 行动建议（CTA → 跳转学校列表程序化筛选）

const { buildCareerVisions, CAREER_VISIONS } = require('../../utils/study_abroad_engine');

Page({
  data: {
    clusterId:    '',      // 从 URL 传入 or storage
    cluster:      null,   // CAREER_VISIONS 对应的完整数据
    vision:       null,   // buildCareerVisions 中该 cluster 的匹配结果（含 matchScore/reasons）
    childName:    '孩子',

    // 展开状态
    expandedSection: 'overview',

    // 专业路径子选项（用户选择一个具体方向）
    selectedMajorIdx: 0,

    // 页面加载状态
    ready: false,
  },

  onLoad(options) {
    const clusterId = options.id || wx.getStorageSync('selectedCareerPath') || '';
    if (!clusterId) {
      wx.showToast({ title: '参数缺失', icon: 'none' });
      wx.navigateBack();
      return;
    }
    wx.setStorageSync('selectedCareerPath', clusterId);

    // 找到集群完整数据
    const cluster = (CAREER_VISIONS || []).find(c => c.id === clusterId) || null;
    if (!cluster) {
      wx.showToast({ title: '路径数据未找到', icon: 'none' });
      wx.navigateBack();
      return;
    }

    // 从 assessmentData 中重新计算该集群的匹配细节
    const stored = wx.getStorageSync('assessmentData') || {};
    const childName = stored.answers?.childName || '孩子';

    let vision = null;
    try {
      const all = buildCareerVisions(stored);
      vision = all.find(v => v.id === clusterId) || null;
    } catch (e) {
      console.warn('[careerVision] buildCareerVisions error', e);
    }

    wx.setNavigationBarTitle({ title: cluster.label });

    this.setData({
      clusterId,
      cluster,
      vision,
      childName,
      ready: true,
    });
  },

  toggleSection(e) {
    const sec = e.currentTarget.dataset.section;
    this.setData({
      expandedSection: this.data.expandedSection === sec ? '' : sec,
    });
  },

  selectMajor(e) {
    const idx = e.currentTarget.dataset.idx;
    this.setData({ selectedMajorIdx: idx });
  },

  // 跳转到学校列表（Program-First模式），传入该集群的 CIP codes
  goSchoolsByProgram() {
    const { cluster } = this.data;
    if (!cluster) return;
    const cipParam = (cluster.cipCodes || []).join(',');
    wx.navigateTo({
      url: `/pages/schools/schools?programMode=1&cipCodes=${cipParam}&clusterId=${cluster.id}&clusterLabel=${encodeURIComponent(cluster.label)}`,
    });
  },

  // 跳转到选校分析报告（填入专业方向）
  goReport() {
    wx.navigateTo({ url: '/pages/study-abroad-report/study-abroad-report' });
  },

  // 跳转到评估问卷（重新做）
  goAssessment() {
    wx.navigateTo({ url: '/pages/questionnaire/questionnaire' });
  },

  goBack() {
    wx.navigateBack();
  },
});
