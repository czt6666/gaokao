// pages/gaokao-results/gaokao-results.js
// 艺圆智探 · 志愿推荐结果页
// v3 — PDF云代理、支付倒计时、推荐裂变、免费次数抵扣
//
// ━━━ WXML 需配合的修改 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. 锁定卡片按钮绑定：
//    <button data-locked-idx="{{item._lockedIdx}}" bindtap="onCardUnlock">...</button>
//    第 3 所（_lockedIdx===2）且未付费时自动弹出 ¥9.9 试看，其余弹出 ¥39 完整报告
//
// 2. 底部横幅文案绑定：
//    <view>{{payBannerText}}</view>
//    未付费 → "¥9.9 起解锁"；试看 → "升级完整报告 ¥39"
//
// 3. 季会员推广卡片：
//    <view wx:if="{{showSeasonPromo}}" bindtap="onSeasonPromoTap">...</view>
//
// 4. 无结果提示：
//    <view wx:if="{{noResultText}}">{{noResultText}}</view>
//
// 5. 当前列表为空时（tab 内无数据）：
//    <view wx:if="{{currentList.length === 0 && noResultText}}">{{noResultText}}</view>

const FORM_KEY = 'gaokao_form_v3';

// 按省份+位次+选科维度隔离付费状态
function _payKey(province, rank, subject) {
  return 'paid_' + province + '_' + rank + '_' + (subject || 'all');
}

function probColor(prob) {
  if (prob === null || prob === undefined) return '#8E8E93';
  if (prob >= 0.7) return '#059669';
  if (prob >= 0.4) return '#C9922A';
  return '#DC2626';
}
function probText(prob) {
  if (prob === null || prob === undefined) return '—';
  return Math.round(prob * 100) + '%';
}
function probPct(prob) {
  if (!prob) return 0;
  return Math.min(100, Math.round(prob * 100));
}
function salaryK(employment) {
  if (!employment || !employment.avg_salary) return null;
  return Math.round(employment.avg_salary / 1000);
}
function yearColor(status) {
  if (!status) return { color: '#8E8E93', bg: 'rgba(142,142,147,0.1)', icon: '' };
  if (status.includes('大年')) return { color: '#DC2626', bg: 'rgba(220,38,38,0.08)', icon: '⚠️' };
  if (status.includes('小年')) return { color: '#059669', bg: 'rgba(5,150,105,0.08)', icon: '✅' };
  return { color: '#8E8E93', bg: 'rgba(142,142,147,0.1)', icon: '' };
}
function enrichList(list, isPaid) {
  if (!list) return [];
  var lockedIdx = 0;
  var visibleIdx = 0;   // 前 2 所可见卡片打码（仅未付费时生效）
  return list.map(function(item, idx) {
    var prob = item.probability;
    var bsy  = item.big_small_year || {};
    var yc   = yearColor(bsy.prediction);
    var li   = item.locked ? lockedIdx++ : -1;
    var blurred = (!isPaid && !item.locked && visibleIdx < 2) ? true : false;
    if (!item.locked) visibleIdx++;
    return Object.assign({}, item, {
      idx:        idx,
      _probColor: probColor(prob),
      _probText:  probText(prob),
      _probPct:   probPct(prob),
      _barColor:  probColor(prob),
      _salaryK:   salaryK(item.employment),
      _yearColor: yc.color,
      _yearBg:    yc.bg,
      _yearIcon:  yc.icon,
      _lockedIdx: li,
      _reasonExpanded: false,
      _blurred:   blurred,
    });
  });
}

Page({
  data: {
    query:              {},
    activeTab:          'stable',
    isPaid:             false,
    isTrial:            false,
    existingProductType: '',   // 用户已购产品类型（trial_report / single_report / season_2026）
    showPayBanner:      false,
    surgeList:          [],
    stableList:         [],
    safeList:           [],
    gemsList:           [],
    currentList:        [],
    surgeCount:         0,
    stableCount:        0,
    safeCount:          0,
    gemsCount:          0,
    totalCount:         0,
    showPhoneModal:     false,
    phoneCollected:     false,
    // 付费流程状态
    showPaySuccess:     false,
    generatingPDF:      false,
    payCountdown:       0,        // 支付后倒计时秒数（5→0）
    showPayCountdown:   false,    // 是否显示倒计时界面
    payBannerText:      '',       // 付费引导文案（含省份+位次）
    // 裂变相关
    showShareAfterPay:  false,    // 付费后显示分享解锁按钮
    referralToken:      '',       // 本用户的裂变 token
    hasFreeCredit:      false,    // 是否有可用的免费次数
    creditId:           '',       // 免费次数对应的记录 ID
    currentLockedCount: 0,
    showSeasonPromo:    false,
    noResultText:       '',
    // 支付确认弹窗
    showPayConfirm:     false,
    pendingProductType: '',
    confirmTitle:       '',
    confirmPrice:       '',
    confirmDesc:        '',
  },

  onShareAppMessage: function() {
    var q     = this.data.query;
    var token = this.data.referralToken;
    var path  = '/pages/gaokao/gaokao';
    if (token) path += '?ref=' + token;
    return {
      title: '我用这个工具找到了' + (q.province || '') + '位次' + (q.rank || '') + '的最优志愿，快来看看你的！',
      path:  path,
    };
  },

  onLoad: function(options) {
    this._startTime        = Date.now();
    this._tabsViewed       = ['stable'];
    this._savedSchools     = [];
    this._aiRequested      = false;
    this._orderNo          = '';
    this._creditId         = '';
    this._countdownTimer   = null;   // setInterval 引用，供 onUnload 清理
    this._pdfTimeoutTimer  = null;   // PDF 超时保护

    try { this._phoneCollected = !!wx.getStorageSync('gaokao_phone_collected'); }
    catch (e) { this._phoneCollected = false; }
    if (this._phoneCollected) this.setData({ phoneCollected: true });

    var app    = getApp();
    var result = app.globalData && app.globalData.gaokaoResult;
    var query  = app.globalData && app.globalData.gaokaoQuery;

    // 若 globalData 无 query，从 URL options 构建基础 query
    if (!query && options && options.rank) {
      query = {
        rank:      options.rank,
        province:  decodeURIComponent(options.province || ''),
        subject:   decodeURIComponent(options.subject || ''),
        exam_mode: options.exam_mode || '',
        queryMode: options.queryMode || 'rank',
        fromMock:  options.fromMock === '1',
        mockScore: options.mockScore ? parseInt(options.mockScore) : undefined,
      };
    }

    // 约束参数：URL options 优先，其次 globalData 已有，兜底空对象
    var qc = (query && query.constraints) || {};
    if (options && (options.c_major !== undefined || options.c_city || options.c_nature || options.c_tier)) {
      qc = {
        c_major:  decodeURIComponent(options.c_major || ''),
        c_city:   decodeURIComponent(options.c_city || ''),
        c_nature: decodeURIComponent(options.c_nature || ''),
        c_tier:   decodeURIComponent(options.c_tier || ''),
      };
    }
    if (query) query.constraints = qc;

    if (!result) {
      wx.showToast({ title: '数据加载失败，请返回重试', icon: 'none' });
      return;
    }

    // 恢复本地 order_no
    if (query) {
      var stored = this._getStoredOrderNo(query);
      if (stored) this._orderNo = stored;
    }

    var isPaid     = result.is_paid === true || !!this._orderNo;
    var surgeList  = enrichList(result.surge, isPaid);
    var stableList = enrichList(result.stable, isPaid);
    var safeList   = enrichList(result.safe, isPaid);
    var gemsList   = enrichList(result.hidden_gems, isPaid);
    var isTrial    = result.is_trial === true;
    var totalCount = result.total_matched || (surgeList.length + stableList.length + safeList.length + gemsList.length);
    var surgeLockedCount = surgeList.filter(function(i) { return i.locked; }).length;

    // 读取用户已购产品类型（从 app.globalData.userStatus，由 _refreshUserStatus 拉取）
    var appStatus = app.globalData && app.globalData.userStatus;
    var existingProductType = '';
    if (appStatus && appStatus.subscriptionType) {
      existingProductType = appStatus.subscriptionType;
    }

    // 付费引导文案：根据已购状态动态展示
    var bannerText = '';
    if (!isPaid && !isTrial) {
      bannerText = '¥9.9 起解锁';
      if (query && query.province && query.rank) {
        bannerText = '¥9.9 起解锁「' + query.province + '·' + query.rank + '位」报告';
      }
    } else if (isTrial) {
      bannerText = '升级完整报告 ¥39';
    }

    // 把约束条件整理成数组，供 WXML 循环渲染
    var constraintTags = [];
    var qc = query && query.constraints;
    if (qc) {
      if (qc.c_major)  constraintTags.push({ label: '专业', value: qc.c_major });
      if (qc.c_city)   constraintTags.push({ label: '城市', value: qc.c_city });
      if (qc.c_nature) constraintTags.push({ label: '性质', value: qc.c_nature });
      if (qc.c_tier)   constraintTags.push({ label: '档次', value: qc.c_tier });
    }

    this.setData({
      query:              query || {},
      isPaid:             isPaid,
      isTrial:            isTrial,
      existingProductType: existingProductType,
      showPayBanner:      !isPaid && totalCount > 5,
      payBannerText:      bannerText,
      constraintTags:     constraintTags,
      surgeList:          surgeList,
      stableList:         stableList,
      safeList:           safeList,
      gemsList:           gemsList,
      surgeCount:         surgeList.length,
      stableCount:        stableList.length,
      safeCount:          safeList.length,
      gemsCount:          gemsList.length,
      totalCount:         totalCount,
      currentList:        stableList,
      activeTab:          'stable',
      currentLockedCount: surgeLockedCount,
      showSeasonPromo:    (!isPaid || isTrial) && totalCount > 0 && existingProductType !== 'season_2026',
      noResultText:       totalCount === 0 ? this._getNoResultText(query) : '',
    });

    // 刷新当前 tab 的 noResultText
    this._updateNoResultText(stableList, 'stable');

    // 若本地有 order_no 但后端数据仍锁定，补拉完整数据
    if (this._orderNo && !result.is_paid) {
      this._reloadResults(this._orderNo);
    } else if (isPaid && this._orderNo) {
      // 已付费且有 order_no：确保报告存入云端（幂等，重复调用安全）
      this._saveReportToCloud(this._orderNo);
    }

    // 若未付费：检查是否有可用免费次数
    if (!isPaid) {
      this._checkFreeCredit();
    }

    // 进入结果页时刷新会员状态（确保 subscription_type / days_remaining 最新）
    if (app.refreshUserStatus) app.refreshUserStatus();

    // 处理裂变 token（通过分享链接进入时，在首次付费时兑换）
    var pendingToken = app.globalData && app.globalData.pendingReferralToken;
    if (pendingToken) {
      this._pendingReferralToken = pendingToken;
    }
  },

  onUnload: function() {
    // 清理所有定时器，防止内存泄漏
    if (this._countdownTimer)  { clearInterval(this._countdownTimer);  this._countdownTimer  = null; }
    if (this._pdfTimeoutTimer) { clearTimeout(this._pdfTimeoutTimer);  this._pdfTimeoutTimer = null; }
    this._flushSession();
  },

  _getStoredOrderNo: function(query) {
    if (!query) return '';
    try { return wx.getStorageSync(_payKey(query.province, query.rank, query.subject)) || ''; }
    catch (e) { return ''; }
  },

  _flushSession: function() {
    var app = getApp();
    var sessionId = app.globalData && app.globalData.currentSessionId;
    if (!sessionId) return;
    wx.cloud.callFunction({
      name: 'trackGaokaoSession',
      data: {
        action:          'update',
        sessionId:       sessionId,
        tabsViewed:      this._tabsViewed,
        savedSchools:    this._savedSchools,
        aiRequested:     this._aiRequested,
        sessionDuration: Math.round((Date.now() - this._startTime) / 1000),
      },
    });
  },

  // ── 检查是否有裂变免费次数 ───────────────────────────────────
  _checkFreeCredit: function() {
    var self = this;
    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: { type: 'checkReferralCredit' },
      success: function(res) {
        if (res.result && res.result.hasCredit) {
          self._creditId = res.result.creditId || '';
          self.setData({ hasFreeCredit: true, creditId: res.result.creditId || '' });
          console.log('[FreeCredit] 有可用免费次数，creditId=', self._creditId);
        }
      },
      fail: function() {},
    });
  },

  // ── 无结果提示文案（与 web 前端保持一致）──────────────────────
  _getNoResultText: function(query) {
    var qc = query && query.constraints || {};
    var province = query && query.province || '';
    if (qc.c_major) return '未找到匹配的结果，请输入正确的专业名称';
    if (qc.c_city || qc.c_nature || qc.c_tier) return '未找到匹配的结果，请扩大筛选范围';
    return province + '数据建设中';
  },

  _updateNoResultText: function(list, tab) {
    if (list && list.length > 0) {
      this.setData({ noResultText: '' });
      return;
    }
    var text = tab === 'gems' ? '该位次区间暂无冷门推荐' : '暂无匹配数据';
    this.setData({ noResultText: text });
  },

  setTab: function(e) {
    var tab = e.currentTarget.dataset.tab;
    var map = { surge: 'surgeList', stable: 'stableList', safe: 'safeList', gems: 'gemsList' };
    if (this._tabsViewed.indexOf(tab) === -1) this._tabsViewed.push(tab);
    var list        = this.data[map[tab]];
    var lockedCount = list.filter(function(i) { return i.locked; }).length;
    this.setData({ activeTab: tab, currentList: list, currentLockedCount: lockedCount });
    this._updateNoResultText(list, tab);
  },

  toggleReason: function(e) {
    var idx = e.currentTarget.dataset.idx;
    var tab = this.data.activeTab;
    var map = { surge: 'surgeList', stable: 'stableList', safe: 'safeList', gems: 'gemsList' };
    var listKey = map[tab];
    var list = this.data[listKey].map(function(item, i) {
      if (i === idx) {
        return Object.assign({}, item, { _reasonExpanded: !item._reasonExpanded });
      }
      return item;
    });
    var update = {};
    update[listKey] = list;
    update.currentList = list;
    this.setData(update);
  },

  addToForm: function(e) {
    var idx  = e.currentTarget.dataset.idx;
    var item = this.data.currentList[idx];
    if (!item || item.locked) {
      wx.showToast({ title: '请先解锁完整报告', icon: 'none' });
      return;
    }
    try {
      var saved  = JSON.parse(wx.getStorageSync(FORM_KEY) || '[]');
      var exists = saved.find(function(i) { return i.school === item.school_name && i.major === item.major_name; });
      if (exists) { wx.showToast({ title: '已在志愿表中', icon: 'none' }); return; }
      var prob   = item.probability || 0;
      var action = '稳';
      if (prob >= 0.65) action = '保';
      else if (prob < 0.35) action = '冲';
      saved.push({
        id: String(Date.now()), rank: saved.length + 1,
        school: item.school_name, major: item.major_name,
        probability: prob, action: action,
        addedAt: new Date().toISOString(),
      });
      wx.setStorageSync(FORM_KEY, JSON.stringify(saved));
      wx.showToast({ title: '已加入志愿表', icon: 'success' });
      this._savedSchools.push({ school: item.school_name, major: item.major_name, action: action, tab: this.data.activeTab });
      if (this._savedSchools.length === 1 && !this._phoneCollected) {
        this.setData({ showPhoneModal: true });
      }
    } catch (err) {
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    }
  },

  // HIDDEN: AI 分析入口
  goAiAnalysis: function(e) {
    // 恢复：取消下方注释即可重新打开 AI 分析
    // var idx  = e.currentTarget.dataset.idx;
    // var item = this.data.currentList[idx];
    // if (!item || item.locked) return;
    // this._aiRequested = true;
    // var app = getApp();
    // app.globalData = app.globalData || {};
    // app.globalData.aiAnalysisContext = {
    //   school: item.school_name, major: item.major_name,
    //   probability: item.probability, query: this.data.query,
    // };
    // wx.navigateTo({ url: '/pages/ai-chat/ai-chat' });
    wx.showToast({ title: '功能升级中', icon: 'none' });
  },

  // ── 使用免费次数解锁 ──────────────────────────────────────────
  // 说明：免费次数标记在云端，与 order_no 无关。
  // 兑换时先弹二次确认，确认后消耗次数并写入本地"免费 token"，
  // 然后用空 order_no 重拉数据（后端该用户无 paid order，会返回锁定数据）。
  // 真正让后端解锁需要 order_no，因此免费次数的正确用途是：
  // 下次查询时跳过付款弹窗，直接发起正常付款流程的首帧 → 暂以"返回重查"方式实现。
  onFreeUnlock: function() {
    var self     = this;
    var creditId = this._creditId;
    if (!creditId) return;

    wx.showModal({
      title: '🎁 使用 1 次免费查询',
      content: '好友已帮你解锁一次免费查询。确认使用后，请返回重新提交本次查询，系统将自动为你解锁完整报告。',
      confirmText: '确认使用',
      cancelText: '暂不',
      success: function(modalRes) {
        if (!modalRes.confirm) return;

        wx.showLoading({ title: '兑换中...' });
        wx.cloud.callFunction({
          name: 'gaokaoQuery',
          data: { type: 'consumeReferralCredit', creditId: creditId },
          success: function(res) {
            wx.hideLoading();
            if (res.result && res.result.success) {
              // 本地标记：本次查询使用了免费次数（存储特殊 key，供提交查询时识别）
              try { wx.setStorageSync('gaokao_free_credit_used', '1'); } catch (e) {}
              self.setData({ hasFreeCredit: false });

              wx.showModal({
                title: '✅ 兑换成功',
                content: '请返回重新提交查询，系统将为你解锁完整报告（无需再次付费）。',
                showCancel: false,
                confirmText: '返回重新查询',
                success: function() { wx.navigateBack({ delta: 2 }); },
              });
            } else {
              wx.showToast({ title: '兑换失败，请重试', icon: 'none' });
            }
          },
          fail: function() {
            wx.hideLoading();
            wx.showToast({ title: '网络异常，请重试', icon: 'none' });
          },
        });
      },
    });
  },

  // ── 根据当前状态与点击位置，判断应购买的产品 ─────────────────
  // lockedIdx: 当前 tab 中锁定项的索引（从 0 开始）
  _resolveProductType: function(lockedIdx) {
    var isPaid  = this.data.isPaid;
    var isTrial = this.data.isTrial;
    var existing = this.data.existingProductType;

    // 已付费或季会员 → 无需再购买
    if (isPaid && !isTrial) return null;

    // 试看用户 → 只能升级完整报告
    if (isTrial) return 'single_report';

    // 未付费用户：点击第 3 所（lockedIdx === 2）→ 试看；其余 → 完整报告
    // 注意：lockedIdx 从 0 开始，所以第 3 所是 index 2
    if (!isPaid && !isTrial) {
      if (lockedIdx === 2) return 'trial_report';
      return 'single_report';
    }

    return 'single_report';
  },

  // ── 获取产品展示文案 ─────────────────────────────────────────
  _getPayLabel: function(productType) {
    var labels = {
      trial_report:  '¥9.9 解锁前三所',
      single_report: '¥39 解锁完整报告',
      season_2026:   '¥99 开通季会员',
    };
    return labels[productType] || '解锁';
  },

  // ── 支付确认弹窗 ────────────────────────────────────────────
  _openPayConfirm: function(productType) {
    var map = {
      trial_report:  { title: '试看报告',        price: '¥9.9',  desc: '解锁冲/稳/保/冷门宝藏各前3所，含录取概率、就业薪资' },
      single_report: { title: '单次完整报告',    price: '¥39',  desc: '本次查询全部' + this.data.totalCount + '所院校完整分析（含安全线、风险提醒、近3年趋势、在读生口碑、PDF下载）。本次查询永久解锁' },
      season_2026:   { title: '2026填报季会员',  price: '¥99',  desc: '包含单次完整报告全部内容 + 期内无限次重新查询 + 位次微调随时重查 + 志愿表收藏 + 院校对比 + PDF随时下载。有效期至2026-09-01' },
    };
    var info = map[productType] || map['single_report'];
    this.setData({
      showPayConfirm:     true,
      pendingProductType: productType,
      confirmTitle:       info.title,
      confirmPrice:       info.price,
      confirmDesc:        info.desc,
    });
  },

  closePayConfirm: function() {
    this.setData({ showPayConfirm: false, pendingProductType: '' });
  },

  onConfirmPay: function() {
    var productType = this.data.pendingProductType;
    this.closePayConfirm();
    this._executePay(productType);
  },

  // ── 点击锁定卡片解锁 ─────────────────────────────────────────
  onCardUnlock: function(e) {
    var lockedIdx = e.currentTarget.dataset.lockedIdx;
    // 第一所（index 0）→ 试看 ¥9.9；其他 → 完整报告 ¥39
    var productType = (lockedIdx === 0) ? 'trial_report' : 'single_report';
    this._openPayConfirm(productType);
  },

  // ── 点击单次完整报告横幅 ─────────────────────────────────────
  onSingleBannerTap: function() {
    this._openPayConfirm('single_report');
  },

  // ── 点击季会员推广横幅 ───────────────────────────────────────
  onSeasonBannerTap: function() {
    this._openPayConfirm('season_2026');
  },

  // ── 点击折叠提示 ─────────────────────────────────────────────
  onFoldTap: function() {
    this._openPayConfirm('single_report');
  },

  // ── 实际执行支付 ─────────────────────────────────────────────
  _executePay: function(productType) {
    var self  = this;
    var app   = getApp();
    var query = this.data.query;

    // 季会员已在有效期内 → 无需再付费
    if (self.data.existingProductType === 'season_2026' && self.data.isPaid) {
      wx.showToast({ title: '您已是季会员，可直接查看完整报告', icon: 'none' });
      return;
    }

    // 检查登录状态是否就绪（openid 为空时支付必失败）
    if (!app.globalData || !app.globalData.openid) {
      wx.showToast({ title: '正在初始化，请稍等几秒后重试', icon: 'none', duration: 2000 });
      if (app._silentLogin) app._silentLogin();
      return;
    }

    wx.showLoading({ title: '正在创建订单...' });

    wx.cloud.callFunction({
      name: 'createPayment',
      data: {
        product_type: productType,
        province:     query.province  || '',
        rank_input:   query.rank      || 0,
        subject:      query.subject   || '',
      },
      success: function(res) {
        wx.hideLoading();
        var result = res.result;
        if (!result || !result.success || !result.pay_params) {
          wx.showToast({ title: result ? result.error || '创建订单失败' : '网络错误', icon: 'none' });
          return;
        }
        var params  = result.pay_params;
        var orderNo = result.order_no;

        wx.requestPayment({
          timeStamp: params.timeStamp,
          nonceStr:  params.nonceStr,
          package:   params.package,
          signType:  params.signType || 'RSA',
          paySign:   params.paySign,
          success: function() {
            // 持久化 order_no
            self._orderNo = orderNo;
            try { wx.setStorageSync(_payKey(query.province, query.rank, query.subject), orderNo); } catch (e) {}

            // 根据购买产品更新本地状态
            var isTrialPurchase = (productType === 'trial_report');
            if (isTrialPurchase) {
              if (app.globalData) app.globalData.isPaid = false;
              self.setData({ isTrial: true, isPaid: false });
            } else {
              if (app.globalData) app.globalData.isPaid = true;
              self.setData({ isPaid: true, isTrial: false });
            }

            // 刷新用户会员状态
            if (app.refreshUserStatus) app.refreshUserStatus();

            // 兑换裂变 token
            var pendingToken = self._pendingReferralToken;
            if (pendingToken) {
              wx.cloud.callFunction({
                name: 'gaokaoQuery',
                data: { type: 'redeemReferral', referral_token: pendingToken },
                success: function(r) {
                  console.log('[Referral] redeem:', r.result && r.result.success);
                  self._pendingReferralToken = '';
                  if (app.globalData) app.globalData.pendingReferralToken = '';
                },
                fail: function() {},
              });
            }

            // 更新 UI 并启动 5 秒倒计时
            self.setData({
              showPayBanner:    false,
              showPayCountdown: true,
              payCountdown:     5,
            });

            self._startPayCountdown(orderNo);
          },
          fail: function(err) {
            if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) {
              wx.showToast({ title: '已取消支付', icon: 'none' });
            } else {
              wx.showToast({ title: '支付失败，请重试', icon: 'none' });
              console.error('[_executePay] fail:', err);
            }
          },
        });
      },
      fail: function(err) {
        wx.hideLoading();
        console.error('[_executePay] createPayment fail:', err);
        wx.showToast({ title: '网络异常，请重试', icon: 'none' });
      },
    });
  },

  // ── 支付后 5 秒倒计时，等待 Webhook，然后拉取完整报告 ─────────
  _startPayCountdown: function(orderNo) {
    var self  = this;
    var count = 5;

    // 保存引用以便 onUnload 时清理
    this._countdownTimer = setInterval(function() {
      count--;
      if (count <= 0) {
        clearInterval(self._countdownTimer);
        self._countdownTimer = null;
        self.setData({ showPayCountdown: false, payCountdown: 0, showPaySuccess: true });
        self._reloadResults(orderNo);
        // 生成裂变 token（供付费后分享）
        self._createReferralToken();
      } else {
        self.setData({ payCountdown: count });
      }
    }, 1000);
  },

  // ── 生成裂变分享 token ──────────────────────────────────────
  _createReferralToken: function() {
    var self = this;
    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: { type: 'createReferral' },
      success: function(res) {
        if (res.result && res.result.success && res.result.token) {
          self._referralToken = res.result.token;
          self.setData({ showShareAfterPay: true, referralToken: res.result.token });
          console.log('[Referral] token 已生成:', res.result.token);
        }
      },
      fail: function() {},
    });
  },

  // ── 带 order_no 重拉完整数据（含超时保护 + 失败重试）──────────
  _reloadResults: function(orderNo, retryCount) {
    var self  = this;
    var query = this.data.query;
    var retry = retryCount || 0;
    if (!query.rank || !query.province) return;

    wx.showLoading({ title: retry > 0 ? '重新加载中...' : '加载完整报告...' });

    // 30 秒超时保护
    var reloadTimer = setTimeout(function() {
      wx.hideLoading();
      if (retry < 2) {
        wx.showModal({
          title: '加载较慢',
          content: '报告数据加载中，点击重试。您的付费订单已生效，不会重复扣费。',
          confirmText: '重试',
          cancelText: '稍后查看',
          success: function(r) {
            if (r.confirm) self._reloadResults(orderNo, retry + 1);
          },
        });
      } else {
        wx.showToast({ title: '加载超时，请从「我的报告」重新查看', icon: 'none', duration: 3000 });
      }
    }, 30000);

    var payload = {
      type:     'recommend',
      rank:     query.rank,
      province: query.province,
      subject:  query.subject || '',
      exam_mode: query.exam_mode || '',
      order_no: orderNo || '',
    };
    var c = query.constraints || {};
    ['c_major', 'c_city', 'c_nature', 'c_tier'].forEach(function(k) {
      if (c[k]) payload[k] = c[k];
    });
    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: payload,
      success: function(res) {
        clearTimeout(reloadTimer);
        wx.hideLoading();
        if (res.result && res.result.success && res.result.data) {
          var data       = res.result.data;
          var isPaid2    = data.is_paid === true || !!self._orderNo;
          var surgeList  = enrichList(data.surge, isPaid2);
          var stableList = enrichList(data.stable, isPaid2);
          var safeList   = enrichList(data.safe, isPaid2);
          var gemsList   = enrichList(data.hidden_gems, isPaid2);
          var tab        = self.data.activeTab;
          var map = { surge: surgeList, stable: stableList, safe: safeList, gems: gemsList };
          var totalCount = data.total_matched || (surgeList.length + stableList.length + safeList.length + gemsList.length);

          // 更新 globalData（供存报告时读取完整数据）
          var app = getApp();
          if (app.globalData) {
            app.globalData.gaokaoResult = {
              surge:        data.surge        || [],
              stable:       data.stable       || [],
              safe:         data.safe         || [],
              hidden_gems:  data.hidden_gems  || [],
              total_matched: totalCount,
              is_paid:      true,
            };
          }
          // 幂等存入云端
          self._saveReportToCloud(orderNo);

          var activeList = map[tab] || stableList;
          self.setData({
            surgeList: surgeList, stableList: stableList,
            safeList: safeList,   gemsList: gemsList,
            surgeCount:  surgeList.length,  stableCount: stableList.length,
            safeCount:   safeList.length,   gemsCount:   gemsList.length,
            totalCount:  totalCount,
            currentList: activeList,
            isPaid:      data.is_paid || false,
            isTrial:     data.is_trial || false,
            showPayBanner: (!data.is_paid || data.is_trial) && totalCount > 5,
            showSeasonPromo: (!data.is_paid || data.is_trial) && totalCount > 0 && self.data.existingProductType !== 'season_2026',
          });
          self._updateNoResultText(activeList, tab);
        } else {
          // 后端返回了但数据为空/失败 → 重试
          if (retry < 2) {
            self._reloadResults(orderNo, retry + 1);
          } else {
            wx.showToast({ title: '加载失败，请从「我的报告」重新查看', icon: 'none', duration: 3000 });
          }
        }
      },
      fail: function(err) {
        clearTimeout(reloadTimer);
        wx.hideLoading();
        console.error('[_reloadResults] fail:', err);
        // 付费后重拉失败 → 自动重试，不能让家长付了钱看到空白页
        if (retry < 2) {
          setTimeout(function() { self._reloadResults(orderNo, retry + 1); }, 2000);
        } else {
          wx.showModal({
            title: '加载暂时失败',
            content: '您的付费已成功，不会重复扣费。请从底部「我的报告」Tab 重新查看。',
            showCancel: false,
            confirmText: '好的',
          });
        }
      },
    });
  },

  // ── 下载 PDF（走云函数代理，绕过鉴权限制，内置重试）──────────
  downloadReport: function() {
    var orderNo = this._orderNo;
    if (!orderNo) {
      wx.showToast({ title: '找不到订单，请重新支付', icon: 'none' });
      return;
    }
    if (this.data.generatingPDF) return;
    this.setData({ generatingPDF: true });
    wx.showLoading({ title: '正在生成完整报告...' });
    this._tryDownloadPDF(orderNo, 0);
  },

  _tryDownloadPDF: function(orderNo, retryCount) {
    var self  = this;
    var q     = this.data.query;
    var retry = retryCount || 0;

    if (retry > 0) {
      wx.showLoading({ title: '重试中（第' + retry + '次）...' });
    }

    // 70 秒超时保护
    this._pdfTimeoutTimer = setTimeout(function() {
      if (self.data.generatingPDF) {
        wx.hideLoading();
        if (retry < 1) {
          wx.showModal({
            title: '报告生成中',
            content: '首次生成报告需要约20秒，系统已在后台缓存。点击「重试」即可快速获取。',
            confirmText: '重试',
            cancelText: '稍后再试',
            success: function(modalRes) {
              if (modalRes.confirm) {
                self.setData({ generatingPDF: true });
                self._tryDownloadPDF(orderNo, retry + 1);
              } else {
                self.setData({ generatingPDF: false });
              }
            },
          });
        } else {
          self.setData({ generatingPDF: false });
          wx.showToast({ title: '生成超时，请稍后重试', icon: 'none' });
        }
      }
    }, 70000);

    var payload2 = {
      type:     'fetchPDF',
      province: q.province || '',
      rank:     q.rank     || 0,
      subject:  q.subject  || '',
      exam_mode: q.exam_mode || '',
      order_no: orderNo,
    };
    var qc = q.constraints || {};
    ['c_major', 'c_city', 'c_nature', 'c_tier'].forEach(function(k) {
      if (qc[k]) payload2[k] = qc[k];
    });
    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: payload2,
      success: function(res) {
        wx.hideLoading();
        if (self._pdfTimeoutTimer) { clearTimeout(self._pdfTimeoutTimer); self._pdfTimeoutTimer = null; }

        if (res.result && res.result.success && res.result.fileID) {
          wx.cloud.downloadFile({
            fileID: res.result.fileID,
            success: function(dlRes) {
              self.setData({ generatingPDF: false });
              wx.openDocument({
                filePath: dlRes.tempFilePath,
                fileType: 'pdf',
                showMenu: true,
              });
            },
            fail: function(err) {
              self.setData({ generatingPDF: false });
              console.error('[_tryDownloadPDF] cloud download fail:', err);
              wx.showToast({ title: '下载失败，请重试', icon: 'none' });
            },
          });
        } else {
          var errMsg = (res.result && res.result.error) || 'PDF生成失败';

          if (errMsg.indexOf('timeout') !== -1 && retry < 1) {
            self._tryDownloadPDF(orderNo, retry + 1);
            return;
          }

          self.setData({ generatingPDF: false });
          if (errMsg.indexOf('支付核验') !== -1) {
            wx.showModal({
              title: '支付核验中',
              content: '支付正在核验中（通常需要 5-30 秒），请稍等片刻后重试。',
              showCancel: false,
              confirmText: '好的',
            });
          } else if (errMsg.indexOf('timeout') !== -1) {
            wx.showModal({
              title: '报告生成中',
              content: '报告正在后台生成中，请等待约30秒后点击「重试」即可获取。',
              confirmText: '重试',
              cancelText: '稍后再试',
              success: function(modalRes) {
                if (modalRes.confirm) {
                  self.setData({ generatingPDF: true });
                  self._tryDownloadPDF(orderNo, retry + 1);
                }
              },
            });
          } else {
            wx.showToast({ title: errMsg, icon: 'none' });
          }
        }
      },
      fail: function(err) {
        wx.hideLoading();
        if (self._pdfTimeoutTimer) { clearTimeout(self._pdfTimeoutTimer); self._pdfTimeoutTimer = null; }

        var errStr = (err && err.errMsg) || String(err);

        if ((errStr.indexOf('timeout') !== -1 || errStr.indexOf('time out') !== -1) && retry < 1) {
          self._tryDownloadPDF(orderNo, retry + 1);
          return;
        }

        self.setData({ generatingPDF: false });
        console.error('[_tryDownloadPDF] cloud call fail:', err);

        if (errStr.indexOf('timeout') !== -1 || errStr.indexOf('time out') !== -1) {
          wx.showModal({
            title: '报告生成中',
            content: '报告正在后台生成中，请等待约30秒后重试。',
            confirmText: '重试',
            cancelText: '稍后再试',
            success: function(modalRes) {
              if (modalRes.confirm) {
                self.setData({ generatingPDF: true });
                self._tryDownloadPDF(orderNo, retry + 1);
              }
            },
          });
        } else {
          wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
        }
      },
    });
  },

  // ── 分享解锁按钮：付费后显示，分享后好友付费可换免费次数 ──────
  onShareUnlock: function() {
    // 触发系统分享面板（带 referral token）
    wx.showShareMenu({ withShareTicket: false });
    wx.showToast({ title: '点击右上角"···"分享给好友', icon: 'none', duration: 3000 });
  },

  // ── 手机号收集 ───────────────────────────────────────────────
  onGetPhoneNumber: function(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      this.setData({ showPhoneModal: false });
      return;
    }
    var code = e.detail.code;
    var app  = getApp();
    var sessionId = (app.globalData && app.globalData.currentSessionId) || '';
    var self = this;
    wx.cloud.callFunction({
      name: 'trackGaokaoSession',
      data: { action: 'resolvePhone', code: code, sessionId: sessionId },
      success: function(res) {
        self.setData({ showPhoneModal: false, phoneCollected: true });
        self._phoneCollected = true;
        try { wx.setStorageSync('gaokao_phone_collected', '1'); } catch (e) {}
        if (res.result && res.result.success) wx.showToast({ title: '绑定成功', icon: 'success' });
      },
      fail: function() {
        self.setData({ showPhoneModal: false });
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
      },
    });
  },

  skipPhone:        function() { this.setData({ showPhoneModal: false }); },
  closePaySuccess:  function() { this.setData({ showPaySuccess: false }); },

  shareToParent: function() {
    this.setData({ showPaySuccess: false });
  },

  goMyReports: function() { wx.switchTab({ url: '/pages/my-reports/my-reports' }); },

  // ── 保存报告（双保险：先写 localStorage，再写云端）──────────────
  _saveReportToCloud: function(orderNo) {
    var app    = getApp();
    var q      = this.data.query;
    if (!q || !q.province || !q.rank || !orderNo) return;
    var result = app.globalData && app.globalData.gaokaoResult;

    var meta = {
      orderNo:      orderNo,
      rank:         q.rank     || 0,
      province:     q.province || '',
      subject:      q.subject  || '',
      examMode:     q.exam_mode || '',
      queryMode:    q.queryMode || 'rank',
      constraints:  q.constraints || {},
      totalMatched: (result && result.total_matched) || 0,
      surgeCount:   (result && (result.surge        || []).length) || 0,
      stableCount:  (result && (result.stable       || []).length) || 0,
      safeCount:    (result && (result.safe         || []).length) || 0,
      gemsCount:    (result && (result.hidden_gems  || []).length) || 0,
      createdAt:    Date.now(),
    };

    // 第一保险：写入 localStorage（即使云端失败，我的报告仍可读取）
    try {
      var localKey  = 'local_report_' + orderNo;
      var localList = [];
      try { localList = JSON.parse(wx.getStorageSync('local_reports') || '[]'); } catch (e) {}
      // 幂等：同 orderNo 不重复写
      var exists = localList.some(function(r) { return r.orderNo === orderNo; });
      if (!exists) {
        localList.unshift(meta);         // 最新的放最前
        if (localList.length > 30) localList = localList.slice(0, 30);
        wx.setStorageSync('local_reports', JSON.stringify(localList));
      }
      console.log('[Report] local save ok, orderNo=%s', orderNo);
    } catch (e) {
      console.warn('[Report] local save fail:', e.message);
    }

    // 第二保险：写入云端（幂等，失败不影响本地）
    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: { type: 'saveReport', reportData: meta },
      success: function(res) {
        var ok = res.result && res.result.success;
        console.log('[Report] cloud save ok=%s skipped=%s', ok, !!(res.result && res.result.skipped));
        if (!ok) console.error('[Report] cloud save error:', JSON.stringify(res.result));
      },
      fail: function(e) {
        console.error('[Report] cloud save fail:', JSON.stringify(e));
      },
    });
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },
});
