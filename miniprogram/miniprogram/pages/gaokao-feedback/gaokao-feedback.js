// pages/gaokao-feedback/gaokao-feedback.js
// 艺圆智探 · 用户反馈页

const TYPE_OPTIONS = [
  { key: 'data_error',         label: '数据错误',   desc: '录取数据、分数线有误' },
  { key: 'bad_recommendation', label: '推荐不准',   desc: '推荐的学校/专业不符合我的情况' },
  { key: 'ui_bug',             label: '功能异常',   desc: '页面卡顿、按钮无响应等' },
  { key: 'question',           label: '使用疑问',   desc: '不知道怎么用某个功能' },
  { key: 'praise',             label: '好评反馈',   desc: '这个功能帮了我很多' },
];

Page({
  data: {
    // 从 URL 传入的上下文
    targetSchool: '',
    targetMajor:  '',
    userRank:     0,
    userProvince: '',
    sessionId:    '',

    // 表单状态
    typeOptions:    TYPE_OPTIONS,
    selectedTypeIdx: 0,
    description:    '',
    submitting:     false,
    submitted:      false,
    charCount:      0,
  },

  onLoad(options) {
    var _dec = function(s) { try { return decodeURIComponent(s || ''); } catch (e) { return s || ''; } };
    this.setData({
      targetSchool: _dec(options.school),
      targetMajor:  _dec(options.major),
      userProvince: _dec(options.province),
      userRank:     Number(options.rank || 0),
      sessionId:    options.sessionId || '',
    });
  },

  selectType(e) {
    this.setData({ selectedTypeIdx: Number(e.currentTarget.dataset.idx) });
  },

  onInput(e) {
    var val = e.detail.value || '';
    if (val.length > 500) val = val.slice(0, 500);  // 防止超长输入
    this.setData({ description: val, charCount: val.length });
  },

  submit() {
    const { description, selectedTypeIdx, targetSchool, targetMajor, userRank, userProvince, sessionId, submitting } = this.data;
    if (submitting) return;

    const trimmed = description.trim();
    if (!trimmed) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' });
      return;
    }
    if (trimmed.length < 5) {
      wx.showToast({ title: '反馈内容太短', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });

    const type = TYPE_OPTIONS[selectedTypeIdx].key;

    wx.cloud.callFunction({
      name: 'submitFeedback',
      data: {
        type,
        targetSchool,
        targetMajor,
        userRank,
        userProvince,
        description: trimmed,
        sessionId,
      },
      success: (res) => {
        if (res.result && res.result.success) {
          this.setData({ submitting: false, submitted: true });
        } else {
          this.setData({ submitting: false });
          wx.showToast({ title: res.result?.error || '提交失败，请重试', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ submitting: false });
        wx.showToast({ title: '网络异常，请检查后重试', icon: 'none' });
      },
    });
  },

  goBack() {
    wx.navigateBack();
  },
});
