// app.js — 艺圆智探 · 水卢冷门高报引擎
const CLOUD_ENV = 'cloud1-9gfd66fq5f304f03';

App({
  onLaunch(options) {
    // ── 初始化云开发 ──────────────────────────────────────────
    if (wx.cloud) {
      try {
        wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
      } catch (e) {
        console.warn('[Cloud] 初始化失败', e);
      }
    }

    // ── 静默登录（获取 openid + 后端 JWT）────────────────────
    this._silentLogin();

    // ── 从 Storage 恢复用户状态 ───────────────────────────────
    const stored = wx.getStorageSync('userInfo');
    if (stored && stored.phone) {
      this.globalData.userInfo    = stored;
      this.globalData.isLoggedIn  = true;
    }
    // 恢复付费状态
    try {
      this.globalData.isPaid = wx.getStorageSync('is_paid') === '1';
    } catch (e) {}
    // 恢复完整会员状态
    try {
      var storedStatus = wx.getStorageSync('user_status');
      if (storedStatus) this.globalData.userStatus = JSON.parse(storedStatus);
    } catch (e) {}

    // ── 捕获裂变分享 token（通过分享链接进入）──────────────────
    const query = (options && options.query) || {};
    if (query.ref) {
      this.globalData.pendingReferralToken = query.ref;
      console.log('[App] 捕获裂变 token:', query.ref);
    }
  },

  // ── 云函数连通性检测（启动时自动运行）─────────────────────
  _testCloudFunction() {
    if (!wx.cloud) {
      console.error('[CloudTest] wx.cloud 不可用！');
      return;
    }
    console.log('[CloudTest] 开始测试云函数连通性...');
    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: { type: 'ping' },
      success: (res) => {
        console.log('[CloudTest] 云函数调用成功!', JSON.stringify(res.result));
        this.globalData._cloudReady = true;
      },
      fail: (err) => {
        console.error('[CloudTest] 云函数调用失败!', JSON.stringify(err));
        console.error('[CloudTest] errMsg:', err.errMsg);
        this.globalData._cloudReady = false;
        // 常见原因：
        // 1. 云函数未部署 → "cloud.callFunction:fail Error: errCode: -1 | cloud function not found"
        // 2. 云环境未选择 → "cloud.callFunction:fail Error: errCode: -1 | cloud not init"
        // 3. 网络问题 → "cloud.callFunction:fail Error: timeout"
      },
    });
  },

  // ── 静默登录：获取 openid + 在后端创建/查找用户 ──────────────
  // 任何一步失败都不影响浏览，但支付功能需要 openid，因此失败时标记状态
  _silentLogin() {
    var self = this;
    wx.login({
      success: (res) => {
        if (!res.code) return;
        self.globalData.wxLoginCode = res.code;
        if (wx.cloud) {
          wx.cloud.callFunction({
            name: 'getOpenId',
            success: (r) => {
              const openid = r.result && r.result.openid;
              if (openid) {
                self.globalData.openid = openid;
                self.globalData._loginReady = true;
                const ui = self.globalData.userInfo || {};
                if (!ui.openid) {
                  ui.openid = openid;
                  self.globalData.userInfo = ui;
                  try { wx.setStorageSync('userInfo', ui); } catch (e) {}
                }
                self._backendLogin();
              } else {
                console.warn('[Cloud] getOpenId 返回空');
                self.globalData._loginReady = false;
              }
            },
            fail: (err) => {
              console.warn('[Cloud] getOpenId 失败:', err);
              self.globalData._loginReady = false;
              // 3 秒后自动重试一次（网络可能刚启动时不稳定），最多重试 1 次
              if (!self._loginRetried) {
                self._loginRetried = true;
                setTimeout(function() { self._silentLogin(); }, 3000);
              }
            },
          });
        }
      },
      fail: () => {
        console.warn('[Login] 静默登录失败');
        self.globalData._loginReady = false;
      },
    });
  },

  // ── 后端登录：通过 miniLogin 云函数在后端创建用户 ──────────────
  _backendLogin() {
    var self = this;
    wx.cloud.callFunction({
      name: 'miniLogin',
      success: (res) => {
        const result = res.result;
        if (result && result.success) {
          self.globalData.backendToken = result.token;
          self.globalData.backendUserId = result.user_id;
          if (result.is_paid) {
            self.globalData.isPaid = true;
            try { wx.setStorageSync('is_paid', '1'); } catch (e) {}
          }
          console.log('[Backend] 登录成功, user_id:', result.user_id, 'is_paid:', result.is_paid);
          // 登录成功后立即拉取完整会员状态（订阅类型、到期时间等）
          self._refreshUserStatus();
        }
      },
      fail: (err) => {
        console.warn('[Backend] miniLogin 失败:', err);
      },
    });
  },

  // ── 刷新用户会员状态（订阅类型、到期时间、推荐统计）─────────────
  _refreshUserStatus() {
    var self = this;
    var token = self.globalData.backendToken;
    if (!token) return;
    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: { type: 'getUserStatus', auth_token: token },
      success: function(res) {
        var r = res.result;
        if (r && r.success) {
          var status = {
            userId:             r.user_id,
            isPaid:             r.is_paid,
            subscriptionType:   r.subscription_type   || '',
            subscriptionLabel:  r.subscription_label  || '',
            subscriptionEndAt:  r.subscription_end_at || null,
            daysRemaining:      r.days_remaining,
            referralCode:       r.referral_code       || '',
            referralCount:      r.referral_count      || 0,
            referralRewardDays: r.referral_reward_days || 0,
          };
          self.globalData.userStatus = status;
          self.globalData.isPaid = status.isPaid;
          try { wx.setStorageSync('user_status', JSON.stringify(status)); } catch (e) {}
          console.log('[UserStatus] 刷新成功', status.subscriptionType, status.daysRemaining != null ? status.daysRemaining + '天' : '永久');
        } else if (r && r.code === 401) {
          // Token 过期，清除本地状态
          self.globalData.backendToken = '';
          self.globalData.userStatus = null;
          try { wx.removeStorageSync('user_status'); } catch (e) {}
        }
      },
      fail: function(err) {
        console.warn('[UserStatus] 刷新失败:', err);
      },
    });
  },

  // ── 供页面调用的刷新会员状态入口（支付后、进入结果页时调用）──
  refreshUserStatus() {
    this._refreshUserStatus();
  },

  // ── 保存用户信息（登录/填写画像后调用）──────────────────────
  // info: { phone?, grade?, budget?, direction?, nickname? }
  saveUserInfo(info) {
    const existing = this.globalData.userInfo || {};
    const merged   = { ...existing, ...info, updatedAt: Date.now() };
    this.globalData.userInfo   = merged;
    this.globalData.isLoggedIn = !!(merged.phone);
    wx.setStorageSync('userInfo', merged);

    // 同步到云数据库（用于线索管理）
    this._syncToCloud(merged);
    return merged;
  },

  // ── 云数据库同步（异步，不阻塞主流程）────────────────────────
  _syncToCloud(userInfo) {
    if (!wx.cloud || !userInfo) return;
    try {
      const db = wx.cloud.database();
      db.collection('users').where({
        _openid: db.command.eq(userInfo.openid || ''),
      }).count().then(res => {
        const record = {
          phone:     userInfo.phone     || '',
          grade:     userInfo.grade     || '',
          budget:    userInfo.budget    || '',
          direction: userInfo.direction || '',
          updatedAt: db.serverDate(),
        };
        if (res.total > 0) {
          db.collection('users').where({ _openid: db.command.eq(userInfo.openid) })
            .update({ data: record });
        } else {
          db.collection('users').add({ data: record });
        }
      }).catch(e => console.warn('[Cloud DB] 同步失败', e));
    } catch (e) {
      console.warn('[Cloud DB] 操作异常', e);
    }
  },

  globalData: {
    // 用户身份
    userInfo:    null,    // { openid, phone, grade, budget, direction, updatedAt }
    isLoggedIn:  false,
    openid:      '',
    wxLoginCode: '',
    // 后端认证
    backendToken:  '',    // JWT token from backend
    backendUserId: null,  // user.id in backend DB
    isPaid:        false, // 是否已付费
    userStatus:    null,  // 完整会员状态：{ subscriptionType, subscriptionEndAt, daysRemaining, referralCount... }
    // 裂变系统
    pendingReferralToken: '',  // 通过分享链接进入时携带的 referral token

    // 页面间传递的筛选参数（由 index 页写入，由 schools 页读取）
    filterCip:        null,
    filterCategory:   null,
    filterCollection: null,
    filterState:      null,
    filterLabel:      null,
    searchQuery:      null,
    focusSearch:      false,
  },
});
