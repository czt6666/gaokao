// pages/booking/booking.js
// 袁希™ · 袁希 1对1 预约页
// ──────────────────────────────────────────────────────
//  流程：
//   1. 展示服务内容（含用户填写的痛点，让他感到"被读到了"）
//   2. 收集手机号（手动输入 OR 微信授权）
//   3. 选择预约方式（加助理微信 / 微信支付）
//   4. 提交 → 写入云数据库 → 展示成功状态
//
//  ⚠️  上线前替换：
//   - assistantQR：换成助理真实的微信二维码图片路径
//   - assistantWechatId：换成助理真实的微信号
// ──────────────────────────────────────────────────────

Page({
  data: {
    // 从报告页传入的上下文
    childName:   '',
    painPoints:  '',
    overallScore: null,
    primaryPath: '',

    // 表单状态
    phone:       '',
    phoneError:  '',
    activeWay:   'wechat',   // wechat | pay
    submitting:  false,
    showSuccess: false,

    // ⚠️ 上线前替换为真实信息
    assistantQR:       '/images/assistant-qr-placeholder.png',
    assistantWechatId: '请联系助理微信',
  },

  onLoad() {
    // 从 consultContext / reportData 读取上下文
    const ctx        = wx.getStorageSync('consultContext') || {};
    const reportData = wx.getStorageSync('reportData') || {};
    const profile    = wx.getStorageSync('userProfile') || {};

    this.setData({
      childName:    ctx.childName    || reportData.childName || profile.childName || '',
      painPoints:   ctx.painPoints   || reportData.consultPainPoints || '',
      overallScore: ctx.overallScore || null,
      primaryPath:  ctx.primaryPath  || '',
      // 预填手机号（如果 profile 里有）
      phone:        profile.phone    || '',
    });
  },

  // ── 手机号输入 ─────────────────────────────────────
  onPhoneInput(e) {
    this.setData({ phone: e.detail.value, phoneError: '' });
  },

  // ── 微信授权手机号 ──────────────────────────────────
  onGetWxPhone(e) {
    if (e.detail.code) {
      // 调用云函数解密手机号
      wx.cloud.callFunction({
        name: 'getPhoneNumber',
        data: { code: e.detail.code },
        success: (res) => {
          if (res.result?.phoneNumber) {
            const phone = res.result.phoneNumber.replace('+86', '').trim();
            this.setData({ phone, phoneError: '' });
            // 同步存档
            const profile = wx.getStorageSync('userProfile') || {};
            wx.setStorageSync('userProfile', { ...profile, phone });
            wx.showToast({ title: '手机号已获取', icon: 'success' });
          }
        },
        fail: () => {
          // 获取失败不影响流程，用户手动输入即可
          wx.showToast({ title: '请手动输入手机号', icon: 'none' });
        },
      });
    } else if (e.detail.errMsg && !e.detail.errMsg.includes('cancel')) {
      wx.showToast({ title: '需要企业小程序资质，请手动输入', icon: 'none', duration: 2500 });
    }
  },

  // ── 选择预约方式 ─────────────────────────────────────
  selectWechat() {
    this.setData({ activeWay: 'wechat' });
  },
  selectPay() {
    wx.showToast({ title: '微信支付即将开放，请先添加助理微信', icon: 'none', duration: 2500 });
  },

  // ── 提交预约信息 ─────────────────────────────────────
  onSubmit() {
    if (this.data.submitting) return;

    const phone = this.data.phone.trim();
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      this.setData({ phoneError: '请输入正确的手机号（11位）' });
      return;
    }

    this.setData({ submitting: true });

    // 保存手机号到 profile
    const profile = wx.getStorageSync('userProfile') || {};
    wx.setStorageSync('userProfile', { ...profile, phone });

    // 写入云数据库（consulting_requests 集合）
    wx.cloud.callFunction({
      name: 'saveConsultRequest',
      data: {
        phone,
        childName:   this.data.childName,
        painPoints:  this.data.painPoints,
        overallScore: this.data.overallScore,
        primaryPath: this.data.primaryPath,
        bookingWay:  this.data.activeWay,
        source:      'report_cta',
      },
      success: () => {
        this.setData({ submitting: false, showSuccess: true });
      },
      fail: () => {
        // 云函数失败：本地缓存，后续重试
        const pending = wx.getStorageSync('pendingConsultRequests') || [];
        pending.push({ phone, childName: this.data.childName, ts: Date.now() });
        wx.setStorageSync('pendingConsultRequests', pending);
        this.setData({ submitting: false, showSuccess: true });
      },
    });
  },

  // ── 成功后关闭 ───────────────────────────────────────
  onSuccessClose() {
    this.setData({ showSuccess: false });
    // 回到报告页
    wx.navigateBack({ delta: 1 });
  },
});
