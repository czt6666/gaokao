// pages/commission/commission.js
// 艺圆智探 · 我的收益 — 佣金余额、明细与提现
// v2 — 与网页 dashboard 对齐：支持自定义提现金额

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
    withdrawAmount: '',
    showWithdrawSuccess: false,
    withdrawSuccessYuan: 0,
  },

  onLoad() {
    this.loadCommission();
  },

  onShow() {
    this.loadCommission();
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

  onWithdraw() {
    const { balanceFen } = this.data;
    if (balanceFen < 10000) {
      wx.showToast({ title: '满100元才可提现', icon: 'none' });
      return;
    }
    this.setData({
      showWithdrawModal: true,
      withdrawMsg: '',
      withdrawAmount: '',
      showWithdrawSuccess: false,
    });
  },

  onCloseModal() {
    if (this.data.withdrawLoading) return;
    this.setData({ showWithdrawModal: false });
  },

  onWithdrawAmountInput(e) {
    this.setData({ withdrawAmount: e.detail.value || '' });
  },

  onConfirmWithdraw() {
    const { balanceFen, withdrawLoading, withdrawAmount } = this.data;
    if (withdrawLoading) return;

    const yuan = parseFloat(withdrawAmount);
    if (!yuan || yuan < 100) {
      this.setData({ withdrawMsg: '提现金额至少为 ¥100' });
      return;
    }
    const fen = Math.round(yuan * 100);
    if (fen > balanceFen) {
      this.setData({ withdrawMsg: '提现金额不能超过可提现余额' });
      return;
    }

    const token = wx.getStorageSync('auth_token');
    if (!token) return;

    this.setData({ withdrawLoading: true, withdrawMsg: '' });
    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: { type: 'withdrawCommission', auth_token: token, amount_fen: fen },
    }).then(res => {
      const d = res.result;
      if (d && d.ok) {
        const newBalanceFen = d.balance_fen || 0;
        this.setData({
          showWithdrawModal: false,
          showWithdrawSuccess: true,
          withdrawSuccessYuan: yuan,
          balanceFen: newBalanceFen,
          balanceYuan: (newBalanceFen / 100).toFixed(2),
        });
        this.loadCommission();
      } else {
        this.setData({ withdrawMsg: d.error || d.detail || '申请失败' });
      }
    }).catch(() => {
      this.setData({ withdrawMsg: '网络错误，请重试' });
    }).finally(() => {
      this.setData({ withdrawLoading: false });
    });
  },

  onCloseSuccess() {
    this.setData({ showWithdrawSuccess: false });
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
