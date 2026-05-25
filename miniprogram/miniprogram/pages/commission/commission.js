// pages/commission/commission.js
// 艺圆智探 · 我的收益 — 佣金余额、明细与提现

Page({
  data: {
    loading: true,
    balanceFen: 0,
    pendingFen: 0,
    totalEarnedFen: 0,
    balanceYuan: '0.00',
    pendingYuan: '0.00',
    totalEarnedYuan: '0.00',
    records: [],
    withdrawals: [],
    showWithdrawModal: false,
    withdrawLoading: false,
    withdrawMsg: '',
  },

  onLoad() {
    this.loadCommission();
    this.loadWithdrawals();
  },

  onShow() {
    this.loadCommission();
    this.loadWithdrawals();
  },

  loadCommission() {
    const token = wx.getStorageSync('auth_token');
    if (!token) {
      this.setData({ loading: false });
      return;
    }
    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: { type: 'getCommission', auth_token: token },
    }).then(res => {
      const d = res.result;
      if (d && d.success) {
        this.setData({
          balanceFen: d.balance_fen || 0,
          pendingFen: d.pending_fen || 0,
          totalEarnedFen: d.total_earned_fen || 0,
          balanceYuan: (d.balance_yuan ?? 0).toFixed(2),
          pendingYuan: (d.pending_yuan ?? 0).toFixed(2),
          totalEarnedYuan: (d.total_earned_yuan ?? 0).toFixed(2),
          records: d.records || [],
          loading: false,
        });
      } else {
        this.setData({ loading: false });
      }
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  loadWithdrawals() {
    const token = wx.getStorageSync('auth_token');
    if (!token) return;
    // 复用已有的 getUserStatus 或其他方式？目前 commission API 暂无 withdrawals 独立列表，
    // 这里直接调用 getCommission 没有 withdrawals，暂时留空，后续可扩展
    this.setData({ withdrawals: [] });
  },

  onWithdraw() {
    const { balanceFen } = this.data;
    if (balanceFen < 10000) {
      wx.showToast({ title: '满100元才可提现', icon: 'none' });
      return;
    }
    this.setData({ showWithdrawModal: true, withdrawMsg: '' });
  },

  onCloseModal() {
    if (this.data.withdrawLoading) return;
    this.setData({ showWithdrawModal: false });
  },

  onConfirmWithdraw() {
    const { balanceFen, withdrawLoading } = this.data;
    if (withdrawLoading) return;
    const token = wx.getStorageSync('auth_token');
    if (!token) return;

    this.setData({ withdrawLoading: true, withdrawMsg: '' });
    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: { type: 'withdrawCommission', auth_token: token, amount_fen: balanceFen },
    }).then(res => {
      const d = res.result;
      if (d && d.ok) {
        this.setData({
          withdrawMsg: '申请成功，请添加客服微信等待转账',
          balanceFen: d.balance_fen || 0,
          balanceYuan: ((d.balance_fen || 0) / 100).toFixed(2),
        });
        setTimeout(() => {
          this.setData({ showWithdrawModal: false });
          this.loadCommission();
        }, 1500);
      } else {
        this.setData({ withdrawMsg: d.error || d.detail || '申请失败' });
      }
    }).catch(() => {
      this.setData({ withdrawMsg: '网络错误，请重试' });
    }).finally(() => {
      this.setData({ withdrawLoading: false });
    });
  },

  onCopyWechat() {
    wx.setClipboardData({
      data: 'shuilukefu',
      success: () => wx.showToast({ title: '微信号已复制', icon: 'success' }),
    });
  },

  onPullDownRefresh() {
    this.loadCommission();
    wx.stopPullDownRefresh();
  },
});
