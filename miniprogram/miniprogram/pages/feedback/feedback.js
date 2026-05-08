// pages/feedback/feedback.js
// 艺圆智探 · 高考志愿 · 通用问题反馈

const FEEDBACK_URL = 'https://www.theyuanxi.cn/api/feedback';
const MAX_CONTENT = 2000;
const MAX_CONTACT = 100;

Page({
  data: {
    content: '',
    contact: '',
    contentLen: 0,
    contactLen: 0,
    submitting: false,
    submitted: false,
  },

  onContentInput(e) {
    let v = e.detail.value || '';
    if (v.length > MAX_CONTENT) v = v.slice(0, MAX_CONTENT);
    this.setData({ content: v, contentLen: v.length });
  },

  onContactInput(e) {
    let v = e.detail.value || '';
    if (v.length > MAX_CONTACT) v = v.slice(0, MAX_CONTACT);
    this.setData({ contact: v, contactLen: v.length });
  },

  submit() {
    if (this.data.submitting) return;

    const content = (this.data.content || '').trim();
    const contact = (this.data.contact || '').trim();

    if (!content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' });
      return;
    }
    if (content.length > MAX_CONTENT) {
      wx.showToast({ title: '反馈内容不超过 2000 字', icon: 'none' });
      return;
    }
    if (contact.length > MAX_CONTACT) {
      wx.showToast({ title: '联系方式不超过 100 字', icon: 'none' });
      return;
    }

    const payload = { content };
    if (contact) payload.contact = contact;

    this.setData({ submitting: true });

    wx.request({
      url: FEEDBACK_URL,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: payload,
      timeout: 15000,
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.ok) {
          this.setData({ submitting: false, submitted: true });
        } else {
          this.setData({ submitting: false });
          console.error('[feedback] HTTP', res.statusCode, res.data);
          wx.showToast({ title: '提交失败，请稍后重试', icon: 'none' });
        }
      },
      fail: (err) => {
        this.setData({ submitting: false });
        console.error('[feedback] request fail:', err);
        const errMsg = (err && err.errMsg) || '';
        const tip = errMsg.indexOf('domain') >= 0
          ? '请求域名未配置，请联系管理员'
          : '网络异常，请检查后重试';
        wx.showToast({ title: tip, icon: 'none' });
      },
    });
  },

  goBack() {
    wx.navigateBack({
      fail: () => { wx.switchTab({ url: '/pages/gaokao/gaokao' }); },
    });
  },
});
