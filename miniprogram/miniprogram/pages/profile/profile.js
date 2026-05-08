// pages/profile/profile.js
// 用户画像问卷 — 3题：年级 / 预算 / 方向

const app = getApp();

Page({
  data: {
    // 当前选中值
    selectedGrade:    '',   // 年级
    selectedBudget:   '',   // 预算
    selectedInterest: '',   // 兴趣方向

    // 是否可提交
    canSubmit: false,

    // 提交中
    submitting: false,

    // 是否是首次填写（影响顶部文案）
    isFirstTime: true,

    // 选项列表
    gradeOptions: [
      { label: '初一', value: 'g7' },
      { label: '初二', value: 'g8' },
      { label: '初三', value: 'g9' },
      { label: '高一', value: 'g10' },
      { label: '高二', value: 'g11' },
      { label: '高三', value: 'g12' },
      { label: '其他', value: 'other' },
    ],
    budgetOptions: [
      { label: '20万以下', value: 'lt20' },
      { label: '20–40万', value: '20_40' },
      { label: '40–60万', value: '40_60' },
      { label: '60万以上', value: 'gt60' },
    ],
    interestOptions: [
      { label: '理工 STEM', value: 'stem' },
      { label: '商科', value: 'business' },
      { label: '文社', value: 'liberal' },
      { label: '艺术', value: 'arts' },
      { label: '医疗 / 健康', value: 'health' },
      { label: '还在探索', value: 'exploring' },
    ],
  },

  onLoad(options) {
    // 如果已有档案，预填
    const userInfo = app.globalData.userInfo || {};
    const isFirstTime = !userInfo.grade;
    this.setData({
      selectedGrade:    userInfo.grade    || '',
      selectedBudget:   userInfo.budget   || '',
      selectedInterest: userInfo.interest || '',
      isFirstTime,
    });
    this._checkCanSubmit();
  },

  // ── 选择年级 ──
  selectGrade(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ selectedGrade: value === this.data.selectedGrade ? '' : value });
    this._checkCanSubmit();
  },

  // ── 选择预算 ──
  selectBudget(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ selectedBudget: value === this.data.selectedBudget ? '' : value });
    this._checkCanSubmit();
  },

  // ── 选择方向 ──
  selectInterest(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ selectedInterest: value === this.data.selectedInterest ? '' : value });
    this._checkCanSubmit();
  },

  // ── 检查是否可提交 ──
  _checkCanSubmit() {
    const { selectedGrade, selectedBudget, selectedInterest } = this.data;
    this.setData({ canSubmit: !!(selectedGrade && selectedBudget && selectedInterest) });
  },

  // ── 提交 ──
  submit() {
    if (!this.data.canSubmit || this.data.submitting) return;

    const { selectedGrade, selectedBudget, selectedInterest } = this.data;
    this.setData({ submitting: true });

    const saved = app.saveUserInfo({
      grade:    selectedGrade,
      budget:   selectedBudget,
      interest: selectedInterest,
    });

    wx.showToast({ title: '档案已保存 ✓', icon: 'success', duration: 1500 });

    // 短暂延迟后返回
    setTimeout(() => {
      this.setData({ submitting: false });
      // 如果有上一页，返回；否则去首页
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
      } else {
        wx.switchTab({ url: '/pages/index/index' });
      }
    }, 1600);
  },

  // ── 跳过 ──
  skip() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  noop() {},
});
