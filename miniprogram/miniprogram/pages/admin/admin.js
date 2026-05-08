// pages/admin/admin.js — 袁希™ 线索管理后台
// 仅袁希本人可访问（密码验证）

Page({
  data: {
    // 鉴权
    authState: 'locked',   // locked | verifying | unlocked
    codeInput: '',
    authError: '',

    // 仪表盘
    stats: null,
    statsLoading: false,

    // 列表
    list: [],
    listLoading: false,
    page: 1,
    hasMore: true,
    total: 0,

    // 过滤
    activeFilter: 'all',   // all | unread | cta | highfit | hasParent
    filterOptions: [
      { key: 'all',       label: '全部' },
      { key: 'unread',    label: '未读' },
      { key: 'cta',       label: '高意向' },
      { key: 'highfit',   label: '高适配' },
      { key: 'hasParent', label: '填了问卷' },
    ],

    // 舞台标签
    stageLabels: {
      new:        '新线索',
      contacted:  '已联系',
      consulting: '咨询中',
      converted:  '已成交',
      closed:     '已关闭',
    },
    stageColors: {
      new:        '#1B3A6B',
      contacted:  '#C49A22',
      consulting: '#2A7A5A',
      converted:  '#5B3A8B',
      closed:     '#9CA3AF',
    },

    // ── 智能实验室（问卷自学习）────────────────────────────────
    activeTab: 'leads',      // leads | intelligence | gaokao
    intelligence: null,      // adminAnalytics 云函数返回的完整数据
    intelligenceLoading: false,
    expandedQId: null,       // 当前展开查看详情的问题 ID

    // ── 高考运营 ────────────────────────────────────────────────
    gaokaoSubTab:       'sessions',   // sessions | feedback
    gaokaoStats:        null,
    gaokaoStatsLoading: false,
    gaokaoList:         [],
    gaokaoListLoading:  false,
    gaokaoPage:         1,
    gaokaoHasMore:      true,
    gaokaoTotal:        0,
    gaokaoFilter:       'all',        // all | hasPhone | hasSaves
    feedbackList:       [],
    feedbackLoading:    false,
    feedbackPage:       1,
    feedbackHasMore:    true,
    feedbackTotal:      0,
    feedbackFilter:     'all',        // all | open | resolved
    resolvingId:        '',
  },

  onLoad() {
    // 检查本地是否有缓存的验证状态
    const cached = wx.getStorageSync('adminVerified');
    const expiry = wx.getStorageSync('adminVerifyExpiry');
    if (cached && expiry && Date.now() < expiry) {
      this.setData({ authState: 'unlocked', codeInput: cached });
      this._loadAll();
    }
  },

  onShow() {
    if (this.data.authState === 'unlocked') {
      this._loadStats();
    }
  },

  // ── 输入密码 ──────────────────────────────────────────────────
  onCodeInput(e) {
    this.setData({ codeInput: e.detail.value, authError: '' });
  },

  verifyCode() {
    const code = this.data.codeInput.trim();
    if (!code) return;
    this.setData({ authState: 'verifying' });

    // 用 getAssessments 做一次鉴权验证（mode: stats）
    wx.cloud.callFunction({
      name: 'getAssessments',
      data: { adminCode: code, mode: 'stats' },
      success: (res) => {
        if (res.result?.success) {
          // 验证成功，缓存24小时
          wx.setStorageSync('adminVerified', code);
          wx.setStorageSync('adminVerifyExpiry', Date.now() + 24 * 60 * 60 * 1000);
          this.setData({ authState: 'unlocked', stats: res.result.stats });
          this._loadList(true);
        } else {
          this.setData({ authState: 'locked', authError: '密码错误，请重试' });
        }
      },
      fail: () => {
        this.setData({ authState: 'locked', authError: '网络异常，请重试' });
      },
    });
  },

  // ── Tab 切换 ──────────────────────────────────────────────────
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    if (tab === 'intelligence' && !this.data.intelligence && !this.data.intelligenceLoading) {
      this._loadIntelligence();
    }
    if (tab === 'gaokao' && !this.data.gaokaoStats && !this.data.gaokaoStatsLoading) {
      this._loadGaokaoStats();
      this._loadGaokaoSessions(true);
    }
  },

  // ── 高考运营 Sub-tab ─────────────────────────────────────────
  switchGaokaoSubTab(e) {
    const sub = e.currentTarget.dataset.sub;
    this.setData({ gaokaoSubTab: sub });
    if (sub === 'feedback' && this.data.feedbackList.length === 0) {
      this._loadFeedback(true);
    }
  },

  // ── 高考统计 ──────────────────────────────────────────────────
  _loadGaokaoStats() {
    const code = wx.getStorageSync('adminVerified');
    this.setData({ gaokaoStatsLoading: true });
    wx.cloud.callFunction({
      name: 'getGaokaoAdmin',
      data: { adminCode: code, mode: 'stats' },
      success: (res) => {
        if (res.result?.success) {
          this.setData({ gaokaoStats: res.result.stats, gaokaoStatsLoading: false });
        } else {
          this.setData({ gaokaoStatsLoading: false });
        }
      },
      fail: () => this.setData({ gaokaoStatsLoading: false }),
    });
  },

  // ── 高考用户列表 ─────────────────────────────────────────────
  _loadGaokaoSessions(reset = false) {
    const code = wx.getStorageSync('adminVerified');
    if (this.data.gaokaoListLoading) return;
    const page = reset ? 1 : this.data.gaokaoPage;
    const filter = this.data.gaokaoFilter;
    const filterParam = filter === 'hasPhone' ? { hasPhone: true }
                      : filter === 'hasSaves' ? { hasSaves: true } : {};

    this.setData({ gaokaoListLoading: true });
    wx.cloud.callFunction({
      name: 'getGaokaoAdmin',
      data: { adminCode: code, mode: 'sessions', page, limit: 15, filter: filterParam },
      success: (res) => {
        if (res.result?.success) {
          const incoming = res.result.list || [];
          const list = reset ? incoming : [...this.data.gaokaoList, ...incoming];
          this.setData({
            gaokaoList:     list,
            gaokaoTotal:    res.result.total,
            gaokaoPage:     page + 1,
            gaokaoHasMore:  res.result.hasMore,
            gaokaoListLoading: false,
          });
        } else {
          this.setData({ gaokaoListLoading: false });
        }
      },
      fail: () => this.setData({ gaokaoListLoading: false }),
    });
  },

  switchGaokaoFilter(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ gaokaoFilter: key, gaokaoList: [], gaokaoPage: 1, gaokaoHasMore: true });
    this._loadGaokaoSessions(true);
  },

  // ── 反馈列表 ──────────────────────────────────────────────────
  _loadFeedback(reset = false) {
    const code = wx.getStorageSync('adminVerified');
    if (this.data.feedbackLoading) return;
    const page   = reset ? 1 : this.data.feedbackPage;
    const status = this.data.feedbackFilter;

    this.setData({ feedbackLoading: true });
    wx.cloud.callFunction({
      name: 'getGaokaoAdmin',
      data: { adminCode: code, mode: 'feedback', page, limit: 20,
              filter: { status: status === 'all' ? '' : status } },
      success: (res) => {
        if (res.result?.success) {
          const incoming = res.result.list || [];
          const list = reset ? incoming : [...this.data.feedbackList, ...incoming];
          this.setData({
            feedbackList:    list,
            feedbackTotal:   res.result.total,
            feedbackPage:    page + 1,
            feedbackHasMore: res.result.hasMore,
            feedbackLoading: false,
          });
        } else {
          this.setData({ feedbackLoading: false });
        }
      },
      fail: () => this.setData({ feedbackLoading: false }),
    });
  },

  switchFeedbackFilter(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ feedbackFilter: key, feedbackList: [], feedbackPage: 1, feedbackHasMore: true });
    this._loadFeedback(true);
  },

  resolveFeedback(e) {
    const feedbackId = e.currentTarget.dataset.id;
    if (!feedbackId || this.data.resolvingId) return;
    const code = wx.getStorageSync('adminVerified');
    this.setData({ resolvingId: feedbackId });
    wx.cloud.callFunction({
      name: 'getGaokaoAdmin',
      data: { adminCode: code, mode: 'resolve', feedbackId, status: 'resolved' },
      success: () => {
        this.setData({ resolvingId: '', feedbackList: [], feedbackPage: 1 });
        this._loadFeedback(true);
        wx.showToast({ title: '已标记解决', icon: 'success' });
      },
      fail: () => {
        this.setData({ resolvingId: '' });
        wx.showToast({ title: '操作失败', icon: 'none' });
      },
    });
  },

  // ── 加载智能实验室数据 ────────────────────────────────────────
  _loadIntelligence() {
    const code = wx.getStorageSync('adminVerified');
    this.setData({ intelligenceLoading: true });
    wx.cloud.callFunction({
      name: 'adminAnalytics',
      data: { adminCode: code },
      success: (res) => {
        if (res.result?.success) {
          this.setData({ intelligence: res.result.data, intelligenceLoading: false });
        } else {
          wx.showToast({ title: res.result?.error || '加载失败', icon: 'none' });
          this.setData({ intelligenceLoading: false });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络异常', icon: 'none' });
        this.setData({ intelligenceLoading: false });
      },
    });
  },

  // 刷新智能实验室
  refreshIntelligence() {
    this.setData({ intelligence: null });
    this._loadIntelligence();
  },

  // 展开/收起问题详情
  toggleQDetail(e) {
    const qId = e.currentTarget.dataset.qid;
    this.setData({
      expandedQId: this.data.expandedQId === qId ? null : qId,
    });
  },

  // ── 加载所有数据 ──────────────────────────────────────────────
  _loadAll() {
    this._loadStats();
    this._loadList(true);
  },

  _loadStats() {
    const code = wx.getStorageSync('adminVerified');
    this.setData({ statsLoading: true });
    wx.cloud.callFunction({
      name: 'getAssessments',
      data: { adminCode: code, mode: 'stats' },
      success: (res) => {
        if (res.result?.success) {
          this.setData({ stats: res.result.stats, statsLoading: false });
        } else {
          this.setData({ statsLoading: false });
        }
      },
      fail: () => this.setData({ statsLoading: false }),
    });
  },

  _loadList(reset = false) {
    const code = wx.getStorageSync('adminVerified');
    const filter = this.data.activeFilter;
    const page = reset ? 1 : this.data.page;

    if (this.data.listLoading) return;
    this.setData({ listLoading: true });

    // 构建过滤参数
    const filterMap = {
      unread:    { isRead: false },
      cta:       { ctaTapped: true },
      highfit:   { minScore: 68 },
      hasParent: { hasParent: true },
    };
    const filterParam = filterMap[filter] || {};

    wx.cloud.callFunction({
      name: 'getAssessments',
      data: { adminCode: code, mode: 'list', page, limit: 15, filter: filterParam },
      success: (res) => {
        if (res.result?.success) {
          const incoming = res.result.list || [];
          const list = reset ? incoming : [...this.data.list, ...incoming];
          // 处理展示数据
          const processed = list.map(item => this._processItem(item));
          this.setData({
            list: processed,
            total: res.result.total,
            page: page + 1,
            hasMore: res.result.hasMore,
            listLoading: false,
          });
        } else {
          this.setData({ listLoading: false });
        }
      },
      fail: () => this.setData({ listLoading: false }),
    });
  },

  // ── 处理单条数据，生成展示字段 ───────────────────────────────
  _processItem(item) {
    const stageLabelMap = {
      new: '新线索', contacted: '已联系', consulting: '咨询中',
      converted: '已成交', closed: '已关闭',
    };
    const stageColorMap = {
      new: '#1B3A6B', contacted: '#C49A22', consulting: '#2A7A5A',
      converted: '#5B3A8B', closed: '#9CA3AF',
    };
    const engLevelMap = { weak: '薄弱', basic: '日常', good: '流畅', native: '母语' };
    const acadMap = { low: '中下', mid: '中等', upper_mid: '中上', top: '前10%' };
    const stageMap = { primary: '小学', middle: '初中', high: '高中', preschool: '学前' };

    // 创建时间格式化
    const ts = item.createdAt?._seconds
      ? new Date(item.createdAt._seconds * 1000)
      : new Date(item.createdAt);
    const now = new Date();
    const diffDays = Math.floor((now - ts) / (1000 * 60 * 60 * 24));
    const timeStr = diffDays === 0 ? '今天' : diffDays === 1 ? '昨天' : `${diffDays}天前`;

    // 适配度颜色
    const score = item.overallScore || 0;
    const scoreColor = score >= 68 ? '#2A7A5A' : score >= 45 ? '#C49A22' : '#B03A2E';

    const bh = item.behavior || {};

    // ── 访问次数信号
    const visitCount = bh.visitCount || 1;
    const visitSignal = visitCount >= 3 ? '🔥' : visitCount >= 2 ? '👀' : '';
    const visitLabel  = visitCount >= 2 ? `复访${visitCount}次` : '';

    // ── 阅读深度信号
    const readTierMap  = { shallow: '浅读', moderate: '细读', deep: '深度阅读' };
    const readTierIcon = { shallow: '', moderate: '📖', deep: '📖📖' };
    const readTierLabel = readTierMap[bh.readTier] || '';
    const readTierIconDisplay = readTierIcon[bh.readTier] || '';

    // ── 家长问卷放弃信号
    const parentAbandoned = bh.parentAbandonedAt !== undefined && !item.hasParentAnswers;
    const abandonLabel = parentAbandoned ? `中途放弃·${bh.parentAbandonedAtLabel || ''}` : '';

    // ── 综合意向度评级（1-5星）
    let intentScore = 0;
    if (bh.ctaTapped)         intentScore += 2;
    if (visitCount >= 3)      intentScore += 2;
    else if (visitCount >= 2) intentScore += 1;
    if (bh.readTier === 'deep')     intentScore += 2;
    else if (bh.readTier === 'moderate') intentScore += 1;
    if (bh.aiChatStarted)     intentScore += 1;
    if (bh.shareGenerated)    intentScore += 1;
    if (item.hasParentAnswers) intentScore += 1;
    const intentStars = intentScore >= 7 ? '★★★★★'
                      : intentScore >= 5 ? '★★★★☆'
                      : intentScore >= 3 ? '★★★☆☆'
                      : intentScore >= 1 ? '★★☆☆☆'
                      : '★☆☆☆☆';

    return {
      ...item,
      stageLabel: stageLabelMap[item.adminStage] || '新线索',
      stageColor: stageColorMap[item.adminStage] || '#1B3A6B',
      timeStr,
      scoreColor,
      engLevelLabel: engLevelMap[item.englishLevel] || '',
      acadLabel: acadMap[item.academicTier] || '',
      schoolStageLabel: stageMap[item.schoolStage] || '',
      initial: (item.childName || '孩')[0],
      quickInsight: item.aiInsight?.blindspot || item.aiInsight?.riskSignal || '',
      keyQuoteDisplay: item.aiInsight?.keyQuote || '',
      // 新增行为信号
      visitCount, visitSignal, visitLabel,
      readTierLabel, readTierIconDisplay,
      parentAbandoned, abandonLabel,
      intentScore, intentStars,
    };
  },

  // ── 切换过滤器 ─────────────────────────────────────────────
  switchFilter(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ activeFilter: key, list: [], page: 1, hasMore: true });
    this._loadList(true);
  },

  // ── 下拉刷新 ──────────────────────────────────────────────────
  onPullDownRefresh() {
    this._loadAll();
    wx.stopPullDownRefresh();
  },

  // ── 上拉加载更多 ──────────────────────────────────────────────
  onReachBottom() {
    if (this.data.hasMore && !this.data.listLoading) {
      this._loadList(false);
    }
  },

  // ── 进入线索详情 ──────────────────────────────────────────────
  goDetail(e) {
    const docId = e.currentTarget.dataset.id;
    if (!docId) return;
    wx.navigateTo({ url: `/pages/admin-detail/admin-detail?id=${docId}` });
  },

  // ── 退出登录 ──────────────────────────────────────────────────
  logout() {
    wx.removeStorageSync('adminVerified');
    wx.removeStorageSync('adminVerifyExpiry');
    this.setData({ authState: 'locked', codeInput: '', list: [], stats: null });
  },
});
