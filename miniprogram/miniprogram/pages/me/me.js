// pages/me/me.js
// 艺圆智探 · 个人中心 — 与网页 dashboard 对齐

const app = getApp();
const MILESTONE = 4;

Page({
  data: {
    loading: true,

    // 用户身份
    userId: 0,
    avatar: '',
    nickname: '',
    phone: '',
    displayName: '',

    // 会员状态
    isPaid: false,
    subscriptionType: '',
    subscriptionLabel: '',
    subscriptionEndAt: null,
    daysRemaining: null,
    isExpired: false,
    isExpiringSoon: false,
    endDateStr: '',

    // 推荐返佣
    referralCode: '',
    referralCount: 0,
    referralRewardDays: 0,
    rewardDays: 0,
    refCopied: false,

    // 收益（简化展示，点击进入 commission 详情）
    commission: null,

    // 快捷入口
    formCount: 0,
  },

  onLoad() {
    this._loadUserInfo();
    this._loadCommission();
    this._loadFormCount();
  },

  onShow() {
    this._refreshUserStatus();
    this._loadFormCount();
  },

  onPullDownRefresh() {
    this._refreshUserStatus();
    this._loadCommission();
    this._loadFormCount();
    wx.stopPullDownRefresh();
  },

  // ── 加载本地用户信息 ──
  _loadUserInfo() {
    const userInfo = app.globalData.userInfo || {};
    const status = app.globalData.userStatus || {};

    const phone = userInfo.phone || '';
    const nickname = userInfo.nickname || userInfo.wechat_nickname || '';
    const avatar = userInfo.avatar || userInfo.wechat_avatar || '';
    const displayName = nickname
      ? nickname
      : phone
      ? phone.slice(0, 3) + '****' + phone.slice(-4)
      : '用户' + String(status.userId || userInfo.userId || '').slice(-4);

    const isSingle = !status.subscriptionType
      || status.subscriptionType === 'single_report'
      || status.subscriptionType === 'report_export'
      || status.subscriptionType === 'trial_report';
    const isExpired = !isSingle && !status.isPaid;
    const isExpiringSoon = !isSingle && status.isPaid
      && status.daysRemaining !== null && status.daysRemaining !== undefined
      && status.daysRemaining <= 7;

    const endDateStr = status.subscriptionEndAt
      ? this._formatDate(status.subscriptionEndAt)
      : '';

    const referralCount = status.referralCount || 0;
    const rewardDays = (referralCount * 3) + (status.referralRewardDays || 0);
    const milestonePct = Math.min((referralCount / MILESTONE) * 100, 100);

    this.setData({
      loading: false,
      userId: status.userId || userInfo.userId || 0,
      avatar,
      nickname,
      phone,
      displayName,
      isPaid: status.isPaid || false,
      subscriptionType: status.subscriptionType || '',
      subscriptionLabel: status.subscriptionLabel || '',
      subscriptionEndAt: status.subscriptionEndAt || null,
      daysRemaining: status.daysRemaining != null ? status.daysRemaining : null,
      isExpired,
      isExpiringSoon,
      endDateStr,
      referralCode: status.referralCode || '',
      referralCount,
      referralRewardDays: status.referralRewardDays || 0,
      rewardDays,
      milestonePct,
    });
  },

  // ── 刷新后端用户状态 ──
  _refreshUserStatus() {
    app.refreshUserStatus && app.refreshUserStatus();
    // 延迟一小会儿让云函数返回，然后重新加载
    setTimeout(() => {
      this._loadUserInfo();
    }, 600);
  },

  // ── 加载收益摘要 ──
  _loadCommission() {
    const token = wx.getStorageSync('auth_token');
    if (!token) return;
    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: { type: 'getCommission', auth_token: token },
    }).then(res => {
      const d = res.result;
      if (d && d.success) {
        this.setData({
          commission: {
            balanceFen: d.balance_fen || 0,
            balanceYuan: (d.balance_yuan ?? 0).toFixed(2),
            pendingYuan: (d.pending_yuan ?? 0).toFixed(2),
            totalEarnedYuan: (d.total_earned_yuan ?? 0).toFixed(2),
            recordCount: (d.records || []).length,
          },
        });
      }
    }).catch(() => {});
  },

  // ── 志愿表数量 ──
  _loadFormCount() {
    try {
      const saved = JSON.parse(wx.getStorageSync('gaokao_form_v3') || '[]');
      this.setData({ formCount: Array.isArray(saved) ? saved.length : 0 });
    } catch (e) {
      this.setData({ formCount: 0 });
    }
  },

  // ── 格式化日期 ──
  _formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'Z');
    if (isNaN(d.getTime())) return '';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  },

  // ── 分享 ──
  onShareAppMessage() {
    const code = this.data.referralCode || '';
    let path = '/pages/index/index';
    if (code) path += '?ref=' + code;
    return {
      title: '高考志愿填报神器！输入位次自动算出每所学校录取概率，冷门宝藏院校一键找到',
      path,
    };
  },

  onShareTimeline() {
    const code = this.data.referralCode || '';
    let query = '';
    if (code) query = 'ref=' + code;
    return {
      title: '高考志愿填报神器！输入位次自动算出每所学校录取概率，冷门宝藏院校一键找到',
      query,
    };
  },

  // ── 复制邀请链接 ──
  onCopyRef() {
    const code = this.data.referralCode;
    if (!code) {
      wx.showToast({ title: '暂无邀请码', icon: 'none' });
      return;
    }
    const link = 'https://www.theyuanxi.cn/?ref=' + code;
    const text = '高考志愿填报神器！输入位次自动算出每所学校录取概率，冷门宝藏院校一键找到。用我的专属链接还有优惠 👉 ' + link;
    wx.setClipboardData({
      data: text,
      success: () => {
        this.setData({ refCopied: true });
        wx.showToast({ title: '已复制邀请链接', icon: 'success' });
        setTimeout(() => this.setData({ refCopied: false }), 2500);
      },
    });
  },

  // ── 导航 ──
  goCommission() {
    wx.navigateTo({ url: '/pages/commission/commission' });
  },

  goReports() {
    wx.navigateTo({ url: '/pages/my-reports/my-reports' });
  },

  goForm() {
    wx.navigateTo({ url: '/pages/gaokao-form/gaokao-form' });
  },

  goSeasonPay() {
    // 跳转查询页并唤起季会员支付（简化：先跳查询页，用户自行查询后看到季会员横幅）
    wx.switchTab({ url: '/pages/gaokao/gaokao' });
  },

  // ── 退出登录 ──
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      confirmColor: '#FF3B30',
      success: (res) => {
        if (res.confirm) {
          try {
            wx.removeStorageSync('auth_token');
            wx.removeStorageSync('userInfo');
            wx.removeStorageSync('user_status');
            wx.removeStorageSync('is_paid');
          } catch (e) {}
          app.globalData.userInfo = null;
          app.globalData.userStatus = null;
          app.globalData.backendToken = '';
          app.globalData.isPaid = false;
          wx.showToast({ title: '已退出', icon: 'success' });
          setTimeout(() => {
            wx.switchTab({ url: '/pages/index/index' });
          }, 800);
        }
      },
    });
  },
});
