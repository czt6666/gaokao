// pages/schools/schools.js
// 美国大学数据库 · 浏览 & 搜索

let _CollegeAPI = null;

function _lazyLoad() {
  if (_CollegeAPI) return;
  _CollegeAPI = require('../../utils/college_api');
}

Page({
  data: {
    // ── 登录状态 ───────────────────────────────────────────────
    isLoggedIn:      false,
    showLoginModal:  false,   // 登录弹窗
    loginLoading:    false,   // 手机号获取中

    // ── 搜索 ──────────────────────────────────────────────────
    searchKeyword: '',
    searchFocus:   false,

    // ── 活跃筛选标签（显示在搜索框下方）──────────────────────
    activeFilterLabel: '',

    // ── 来自首页 globalData 的筛选条件 ───────────────────────
    filterCip:        '',   // CIP 家族码，如 '11'
    filterCategory:   '',   // ivy / public / stem / liberal / arts / business
    filterCollection: '',   // hard / mid / open / cheap / intl

    // ── 底部 Picker 显示状态 ──────────────────────────────────
    showAdmSheet:   false,
    showTypeSheet:  false,
    showStateSheet: false,
    showSortSheet:  false,

    // ── 筛选条件 ──────────────────────────────────────────────
    usFilter_adm:  'all',   // 录取难度
    usFilter_type: 'all',   // 学校类型
    filterState:   '',      // 州缩写，如 'CA'
    usSort:        'adm',   // 排序方式

    // ── 筛选标签文字 ──────────────────────────────────────────
    admFilterLabel:  '录取难度',
    typeFilterLabel: '学校类型',
    sortLabel:       '录取率↑',

    // ── 筛选选项数据 ──────────────────────────────────────────
    usAdmFilters: [
      { label: '全部难度',        value: 'all'  },
      { label: '极难 (< 15%)',    value: 'hard' },
      { label: '竞争 (15–40%)',   value: 'mid'  },
      { label: '较易 (40%+)',     value: 'open' },
    ],
    usTypeFilters: [
      { label: '公立 + 私立',  value: 'all'     },
      { label: '私立大学',     value: 'private' },
      { label: '公立旗舰',     value: 'public'  },
    ],
    usSortOptions: [
      { label: '录取率↑',   value: 'adm'       },
      { label: 'SAT 均分↓', value: 'sat'       },
      { label: '学费 低→高', value: 'cost_asc'  },
      { label: '学费 高→低', value: 'cost_desc' },
    ],

    // ── 州列表（全部 50 州 + DC）─────────────────────────────
    stateList: [
      { abbr: 'AL', name: '阿拉巴马' }, { abbr: 'AK', name: '阿拉斯加' },
      { abbr: 'AZ', name: '亚利桑那' }, { abbr: 'AR', name: '阿肯色'   },
      { abbr: 'CA', name: '加利福尼亚'}, { abbr: 'CO', name: '科罗拉多' },
      { abbr: 'CT', name: '康涅狄格' }, { abbr: 'DE', name: '特拉华'   },
      { abbr: 'DC', name: '华盛顿DC' }, { abbr: 'FL', name: '佛罗里达' },
      { abbr: 'GA', name: '佐治亚'   }, { abbr: 'HI', name: '夏威夷'   },
      { abbr: 'ID', name: '爱达荷'   }, { abbr: 'IL', name: '伊利诺伊' },
      { abbr: 'IN', name: '印第安纳' }, { abbr: 'IA', name: '爱荷华'   },
      { abbr: 'KS', name: '堪萨斯'   }, { abbr: 'KY', name: '肯塔基'   },
      { abbr: 'LA', name: '路易斯安那'}, { abbr: 'ME', name: '缅因'     },
      { abbr: 'MD', name: '马里兰'   }, { abbr: 'MA', name: '马萨诸塞' },
      { abbr: 'MI', name: '密歇根'   }, { abbr: 'MN', name: '明尼苏达' },
      { abbr: 'MS', name: '密西西比' }, { abbr: 'MO', name: '密苏里'   },
      { abbr: 'MT', name: '蒙大拿'   }, { abbr: 'NE', name: '内布拉斯加'},
      { abbr: 'NV', name: '内华达'   }, { abbr: 'NH', name: '新罕布什尔'},
      { abbr: 'NJ', name: '新泽西'   }, { abbr: 'NM', name: '新墨西哥' },
      { abbr: 'NY', name: '纽约'     }, { abbr: 'NC', name: '北卡罗来纳'},
      { abbr: 'ND', name: '北达科他' }, { abbr: 'OH', name: '俄亥俄'   },
      { abbr: 'OK', name: '俄克拉荷马'}, { abbr: 'OR', name: '俄勒冈'  },
      { abbr: 'PA', name: '宾夕法尼亚'}, { abbr: 'RI', name: '罗德岛'  },
      { abbr: 'SC', name: '南卡罗来纳'}, { abbr: 'SD', name: '南达科他'},
      { abbr: 'TN', name: '田纳西'   }, { abbr: 'TX', name: '德克萨斯' },
      { abbr: 'UT', name: '犹他'     }, { abbr: 'VT', name: '佛蒙特'   },
      { abbr: 'VA', name: '弗吉尼亚' }, { abbr: 'WA', name: '华盛顿州' },
      { abbr: 'WV', name: '西弗吉尼亚'}, { abbr: 'WI', name: '威斯康星'},
      { abbr: 'WY', name: '怀俄明'   },
    ],

    // ── College Scorecard API 数据 ────────────────────────────
    usApiSchools:         [],   // 原始数据（Top ~60）
    usApiFilteredSchools: [],   // 经搜索+筛选后的显示列表
    usApiLoading:         false,
    usApiLoaded:          false,
    usApiError:           false,
    usApiLoadTime:        '',

    // ── 扩展搜索（全量 6,400+）────────────────────────────────
    expandResults: [],
    expandLoading: false,
    expandDone:    false,
  },

  // ═══════════════════════════════════════════════════════════
  //  生命周期
  // ═══════════════════════════════════════════════════════════

  onLoad() {
    _lazyLoad();
    // 同步登录状态
    const app = getApp();
    this.setData({ isLoggedIn: !!(app && app.globalData && app.globalData.isLoggedIn) });
    this._loadUSApiSchools();
  },

  onShareAppMessage() {
    return {
      title: '美国大学数据库 · 录取率、学费、SAT一键查',
      path: '/pages/schools/schools',
    };
  },

  onShareTimeline() {
    return {
      title: '美国大学数据库 · 录取率、学费、SAT一键查',
      query: '',
    };
  },

  onShow() {
    // 接收首页通过 globalData 传递的筛选条件
    const app = getApp();
    if (!app || !app.globalData) return;
    const gd = app.globalData;

    let changed = false;
    const update = {};

    // 搜索关键词
    if (gd.searchQuery) {
      update.searchKeyword = gd.searchQuery;
      update.searchFocus   = true;
      gd.searchQuery       = null;
      changed = true;
    }
    // 搜索框聚焦（不带关键词）
    if (gd.focusSearch) {
      update.searchFocus = true;
      gd.focusSearch     = false;
      changed = true;
    }

    // CIP 专业筛选
    if (gd.filterCip) {
      update.filterCip        = gd.filterCip;
      update.filterCategory   = '';
      update.filterCollection = '';
      update.filterState      = '';
      update.usFilter_adm     = 'all';
      update.usFilter_type    = 'all';
      update.activeFilterLabel = gd.filterLabel || ('专业: ' + gd.filterCip);
      gd.filterCip    = null;
      gd.filterLabel  = null;
      changed = true;
    }
    // 院校分类筛选
    else if (gd.filterCategory) {
      update.filterCategory   = gd.filterCategory;
      update.filterCip        = '';
      update.filterCollection = '';
      update.filterState      = '';
      update.usFilter_adm     = 'all';
      update.usFilter_type    = 'all';
      update.activeFilterLabel = gd.filterLabel || gd.filterCategory;
      gd.filterCategory = null;
      gd.filterLabel    = null;
      changed = true;
    }
    // 合集筛选（录取率、学费等）
    else if (gd.filterCollection) {
      update.filterCollection  = gd.filterCollection;
      update.filterCip         = '';
      update.filterCategory    = '';
      update.filterState       = '';
      update.activeFilterLabel = gd.filterLabel || gd.filterCollection;
      gd.filterCollection = null;
      gd.filterLabel      = null;
      changed = true;
    }
    // 按州筛选
    else if (gd.filterState) {
      update.filterState       = gd.filterState;
      update.filterCip         = '';
      update.filterCategory    = '';
      update.filterCollection  = '';
      update.activeFilterLabel = gd.filterLabel || gd.filterState;
      gd.filterState = null;
      gd.filterLabel = null;
      changed = true;
    }

    if (changed) {
      // 有新筛选条件时，重置扩展搜索结果（清除上次的全量结果）
      update.expandResults = [];
      update.expandDone    = false;
      update.expandLoading = false;
      this.setData(update);
    }

    // 数据已加载 → 重新应用筛选
    // 刷新登录状态（可能刚从 profile 页填完信息回来）
    const appInst = getApp();
    if (appInst && appInst.globalData) {
      this.setData({ isLoggedIn: !!appInst.globalData.isLoggedIn });
    }

    if (this.data.usApiLoaded) {
      this._applyUsFilters();
    }
  },

  // ═══════════════════════════════════════════════════════════
  //  College Scorecard API
  // ═══════════════════════════════════════════════════════════

  _loadUSApiSchools() {
    if (this.data.usApiLoaded || this.data.usApiLoading) return;
    this.setData({ usApiLoading: true, usApiError: false });

    _CollegeAPI.getTopUSSchools(60)
      .then(schools => {
        const now   = new Date();
        const pad   = n => String(n).padStart(2, '0');
        const loadTime = `今天 ${pad(now.getHours())}:${pad(now.getMinutes())} 调取`;

        if (!schools || schools.length === 0) {
          // API 调用成功但返回 0 条 → 视作错误，显示重试按钮
          // 常见原因：云函数首次部署后未热身、API key 临时限流
          console.warn('[CollegeAPI] API returned 0 schools, treating as error');
          this.setData({ usApiLoading: false, usApiError: true, usApiLoadTime: '' });
          wx.showToast({ title: '数据加载异常，请重试', icon: 'none', duration: 2000 });
          return;
        }

        const display = schools.map(s => _enrichSchool(s));
        this.setData({
          usApiSchools:  display,
          usApiLoading:  false,
          usApiLoaded:   true,
          usApiLoadTime: loadTime,
        });
        this._applyUsFilters();
      })
      .catch(err => {
        console.error('[CollegeAPI] getTopUSSchools error:', err);
        this.setData({ usApiLoading: false, usApiError: true });
        wx.showToast({ title: '数据加载失败，请重试', icon: 'none', duration: 2000 });
      });
  },

  retryUsApi() {
    this.setData({ usApiLoaded: false, usApiError: false });
    this._loadUSApiSchools();
  },

  // ═══════════════════════════════════════════════════════════
  //  扩展搜索（全量 6,400+）
  // ═══════════════════════════════════════════════════════════

  expandSearch() {
    if (this.data.expandLoading || this.data.expandDone) return;

    const {
      searchKeyword, filterState, usFilter_adm, usFilter_type,
      filterCollection, filterCategory,
    } = this.data;

    this.setData({ expandLoading: true, expandResults: [] });

    const query = searchKeyword.trim();

    // ── 关键词为空时，使用服务端 API 条件过滤，而非 school.name= 空值搜索
    // （空名称搜索返回的是按学校ID排序的随机15所，与用户意图无关）
    let expandPromise;
    if (!query) {
      expandPromise = _CollegeAPI.searchByFilter({
        usFilter_adm,
        usFilter_type,
        filterCollection,
        filterState,
      });
    } else {
      expandPromise = _CollegeAPI.searchExpand(query);
    }

    expandPromise
      .then(list => {
        let enriched = (list || []).map(s => _enrichSchool(s));

        // 应用所有客户端筛选条件（与 _applyUsFilters 保持一致）
        if (filterState) enriched = enriched.filter(s => s.state === filterState);
        // 与 _applyUsFilters 保持相同逻辑：hard 同时纳入 null-rate 高SAT学校
        if (usFilter_adm === 'hard') {
          enriched = enriched.filter(s =>
            (s.admissionRateRaw != null && s.admissionRateRaw < 0.15) ||
            (s.admissionRateRaw == null  && (s.satAverage || 0) >= 1400)
          );
        }
        if (usFilter_adm === 'mid') {
          enriched = enriched.filter(s =>
            s.admissionRateRaw != null && s.admissionRateRaw >= 0.15 && s.admissionRateRaw < 0.40
          );
        }
        if (usFilter_adm === 'open') {
          enriched = enriched.filter(s =>
            s.admissionRateRaw != null && s.admissionRateRaw >= 0.40
          );
        }
        if (usFilter_type === 'private') enriched = enriched.filter(s => s.ownership && s.ownership.includes('私立'));
        if (usFilter_type === 'public')  enriched = enriched.filter(s => s.ownership && s.ownership.includes('公立'));
        // 合集和院校分类筛选也要在扩展结果中应用
        if (filterCollection)          enriched = _filterByCollection(enriched, filterCollection);
        if (filterCategory)            enriched = _filterByCategory(enriched, filterCategory);

        // 标注收藏状态
        const favSchools = wx.getStorageSync('favSchools') || [];
        const favIds = new Set(favSchools.map(s => String(s.unitId)));
        enriched = enriched.map(s => ({ ...s, isFav: favIds.has(String(s.unitId)) }));

        this.setData({
          expandResults: enriched,
          expandLoading: false,
          expandDone:    true,
        });
      })
      .catch(() => {
        this.setData({ expandLoading: false, expandDone: false });
        wx.showToast({ title: '搜索失败，请检查网络', icon: 'none' });
      });
  },

  // ═══════════════════════════════════════════════════════════
  //  搜索
  // ═══════════════════════════════════════════════════════════

  onSearch(e) {
    const kw = e.detail.value;
    this.setData({
      searchKeyword: kw,
      expandResults: [],
      expandDone:    false,
    });
    this._applyUsFilters();
  },

  onSearchConfirm() {
    // 确认搜索时，如果关键词非空，提示可扩展搜索
    this._applyUsFilters();
  },

  clearSearch() {
    this.setData({
      searchKeyword: '',
      expandResults: [],
      expandDone:    false,
      searchFocus:   false,
    });
    this._applyUsFilters();
  },

  // ═══════════════════════════════════════════════════════════
  //  Picker 控制
  // ═══════════════════════════════════════════════════════════

  showAdmPicker()   { this.setData({ showAdmSheet:   true, showTypeSheet: false, showStateSheet: false, showSortSheet: false }); },
  showTypePicker()  { this.setData({ showTypeSheet:  true, showAdmSheet:  false, showStateSheet: false, showSortSheet: false }); },
  showStatePicker() { this.setData({ showStateSheet: true, showAdmSheet:  false, showTypeSheet:  false, showSortSheet: false }); },
  showSortPicker()  { this.setData({ showSortSheet:  true, showAdmSheet:  false, showTypeSheet:  false, showStateSheet: false }); },

  closeAllPickers() {
    this.setData({ showAdmSheet: false, showTypeSheet: false, showStateSheet: false, showSortSheet: false });
  },

  noop() {},

  // ── 录取难度筛选 ─────────────────────────────────────────────
  setAdmFilter(e) {
    const { value, label } = e.currentTarget.dataset;
    this.setData({
      usFilter_adm:   value,
      admFilterLabel: value === 'all' ? '录取难度' : label,
      showAdmSheet:   false,
    });
    this._applyUsFilters();
    this._updateActiveLabel();
  },

  // ── 学校类型筛选 ─────────────────────────────────────────────
  setTypeFilter(e) {
    const { value, label } = e.currentTarget.dataset;
    this.setData({
      usFilter_type:   value,
      typeFilterLabel: value === 'all' ? '学校类型' : label,
      showTypeSheet:   false,
    });
    this._applyUsFilters();
    this._updateActiveLabel();
  },

  // ── 按州筛选 ─────────────────────────────────────────────────
  setStateFilter(e) {
    const abbr = e.currentTarget.dataset.abbr;
    this.setData({
      filterState:   abbr,
      showStateSheet: false,
      // 清除首页带来的 category/collection/cip 筛选（州筛选独立）
      filterCategory:   '',
      filterCollection: '',
      filterCip:        '',
      activeFilterLabel: abbr ? ('州: ' + abbr) : '',
    });
    this._applyUsFilters();
  },

  clearStateFilter() {
    this.setData({
      filterState:    '',
      showStateSheet: false,
      activeFilterLabel: '',
    });
    this._applyUsFilters();
  },

  // ── 排序 ─────────────────────────────────────────────────────
  setSortOption(e) {
    const { value, label } = e.currentTarget.dataset;
    this.setData({
      usSort:       value,
      sortLabel:    label,
      showSortSheet: false,
    });
    this._applyUsFilters();
  },

  // ── 清除所有筛选 ──────────────────────────────────────────────
  clearAllFilters() {
    this.setData({
      usFilter_adm:     'all',
      usFilter_type:    'all',
      filterState:      '',
      filterCip:        '',
      filterCategory:   '',
      filterCollection: '',
      admFilterLabel:   '录取难度',
      typeFilterLabel:  '学校类型',
      activeFilterLabel: '',
      expandResults:    [],
      expandDone:       false,
    });
    this._applyUsFilters();
  },

  // ── 更新活跃筛选标签 ──────────────────────────────────────────
  _updateActiveLabel() {
    const { usFilter_adm, usFilter_type, filterState,
            filterCip, filterCategory, filterCollection } = this.data;

    // 首页筛选优先显示
    if (filterCip || filterCategory || filterCollection) return;

    const parts = [];
    if (usFilter_adm  !== 'all') parts.push(this.data.admFilterLabel);
    if (usFilter_type !== 'all') parts.push(this.data.typeFilterLabel);
    if (filterState)              parts.push('州: ' + filterState);

    this.setData({ activeFilterLabel: parts.join(' · ') });
  },

  // ═══════════════════════════════════════════════════════════
  //  核心筛选函数
  // ═══════════════════════════════════════════════════════════

  _applyUsFilters() {
    const {
      usApiSchools,
      usFilter_adm, usFilter_type, usSort,
      filterState, filterCip, filterCategory, filterCollection,
      searchKeyword,
    } = this.data;

    let r = [...usApiSchools];

    // 1. 关键词搜索（name 是 College Scorecard 英文校名；state 是2字母州缩写）
    if (searchKeyword) {
      const kw = searchKeyword.toLowerCase();
      const kwUpper = searchKeyword.toUpperCase();
      r = r.filter(s =>
        (s.name || '').toLowerCase().includes(kw) ||
        (s.city || '').toLowerCase().includes(kw) ||
        (s.state || '') === kwUpper
      );
    }

    // 2. 录取难度筛选（UI 筛选器）
    // ⚠️ 重要：College Scorecard 近几年数据中，MIT/Harvard/Stanford 等精英校
    //    已停止向联邦上报录取率，导致 admissionRateRaw = null。
    //    因此"极难"过滤器同时纳入 SAT 均分 ≥ 1400 的学校（精英校高度相关）。
    if (usFilter_adm === 'hard') {
      r = r.filter(s =>
        (s.admissionRateRaw != null && s.admissionRateRaw < 0.15) ||
        (s.admissionRateRaw == null  && (s.satAverage || 0) >= 1400)
      );
    } else if (usFilter_adm === 'mid') {
      r = r.filter(s =>
        s.admissionRateRaw != null &&
        s.admissionRateRaw >= 0.15 && s.admissionRateRaw < 0.40
      );
    } else if (usFilter_adm === 'open') {
      // "较易"：录取率 ≥ 40%，排除不公开录取率的精英校（它们绝对不是"较易"）
      r = r.filter(s =>
        s.admissionRateRaw != null && s.admissionRateRaw >= 0.40
      );
    }

    // 3. 学校类型筛选
    if (usFilter_type === 'private') {
      r = r.filter(s => s.ownership && s.ownership.includes('私立'));
    } else if (usFilter_type === 'public') {
      r = r.filter(s => s.ownership && s.ownership.includes('公立'));
    }

    // 4. 按州筛选（state 字段是 College Scorecard 返回的 2 字母缩写，如 'CA'）
    if (filterState) {
      r = r.filter(s => s.state === filterState);
    }

    // 5. 首页院校分类筛选
    if (filterCategory) {
      r = _filterByCategory(r, filterCategory);
    }

    // 6. 首页合集筛选
    if (filterCollection) {
      r = _filterByCollection(r, filterCollection);
    }

    // 7. 首页专业（CIP）筛选
    if (filterCip) {
      // College Scorecard 数据中有 cipCodes 字段（数组）
      r = r.filter(s =>
        s.cipCodes && s.cipCodes.some(c => String(c).split('.')[0] === filterCip)
      );
    }

    // 8. 排序
    r.sort((a, b) => {
      if (usSort === 'adm') {
        const ra = a.admissionRateRaw != null ? a.admissionRateRaw : 1;
        const rb = b.admissionRateRaw != null ? b.admissionRateRaw : 1;
        return ra - rb;
      }
      if (usSort === 'sat')       return (b.satAverage || 0) - (a.satAverage || 0);
      if (usSort === 'cost_asc')  return (a.tuitionOut || 0) - (b.tuitionOut || 0);
      if (usSort === 'cost_desc') return (b.tuitionOut || 0) - (a.tuitionOut || 0);
      return 0;
    });

    // 标注收藏状态
    const favSchools = wx.getStorageSync('favSchools') || [];
    const favIds = new Set(favSchools.map(s => String(s.unitId)));
    r = r.map(s => ({ ...s, isFav: favIds.has(String(s.unitId)) }));

    this.setData({ usApiFilteredSchools: r });

    // 当筛选结果为 0 且有活跃筛选条件时，自动触发全量搜索
    // （顶部60所按SAT排名的精选库无法覆盖"低学费/高录取率/艺术/小文理"等场景）
    if (r.length === 0 && !this.data.expandDone && !this.data.expandLoading) {
      const hasFilter = filterCollection || filterCategory || filterState || filterCip ||
                        usFilter_adm !== 'all' || usFilter_type !== 'all';
      if (hasFilter) {
        // 稍延迟执行，让 UI 先渲染空状态提示，再自动搜索
        setTimeout(() => { this.expandSearch(); }, 300);
      }
    }
  },

  // ═══════════════════════════════════════════════════════════
  //  收藏
  // ═══════════════════════════════════════════════════════════

  toggleFav(e) {
    const unitId = String(e.currentTarget.dataset.unitid);

    // ── 未登录 → 弹出登录引导 ────────────────────────────────
    if (!this.data.isLoggedIn) {
      // 暂存想收藏的学校 id，登录完成后自动完成收藏
      this._pendingFavUnitId = unitId;
      this.setData({ showLoginModal: true });
      return;
    }

    this._doToggleFav(unitId);
  },

  _doToggleFav(unitId) {
    let favSchools = wx.getStorageSync('favSchools') || [];
    const idx = favSchools.findIndex(s => String(s.unitId) === unitId);

    if (idx >= 0) {
      favSchools.splice(idx, 1);
      wx.showToast({ title: '已取消收藏', icon: 'none', duration: 1200 });
    } else {
      const all = [...this.data.usApiFilteredSchools, ...this.data.expandResults];
      const school = all.find(s => String(s.unitId) === unitId);
      if (school) favSchools.push(school);
      wx.showToast({ title: '收藏成功 ♥', icon: 'none', duration: 1200 });
    }

    wx.setStorageSync('favSchools', favSchools);
    const favIds = new Set(favSchools.map(s => String(s.unitId)));
    const markFav = arr => arr.map(s => ({ ...s, isFav: favIds.has(String(s.unitId)) }));
    this.setData({
      usApiFilteredSchools: markFav(this.data.usApiFilteredSchools),
      expandResults:        markFav(this.data.expandResults),
    });
  },

  // ── 登录弹窗控制 ─────────────────────────────────────────────

  closeLoginModal() {
    this.setData({ showLoginModal: false });
    this._pendingFavUnitId = null;
  },

  // 微信"获取手机号"按钮回调（open-type="getPhoneNumber"）
  onGetPhoneNumber(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      wx.showToast({ title: '授权失败，请重试', icon: 'none' });
      return;
    }
    this.setData({ loginLoading: true });

    // 调用云函数解密手机号
    wx.cloud.callFunction({
      name: 'getPhoneNumber',
      data: { code: e.detail.code },
      success: (res) => {
        const r = res.result;
        if (!r || !r.success) {
          wx.showToast({ title: '获取手机号失败', icon: 'none' });
          this.setData({ loginLoading: false });
          return;
        }
        // 保存到 app globalData + storage
        const app = getApp();
        app.saveUserInfo({ phone: r.purePhone || r.phone });

        this.setData({ isLoggedIn: true, showLoginModal: false, loginLoading: false });
        wx.showToast({ title: '登录成功 ✓', icon: 'success', duration: 1500 });

        // 完成之前挂起的收藏
        if (this._pendingFavUnitId) {
          setTimeout(() => {
            this._doToggleFav(this._pendingFavUnitId);
            this._pendingFavUnitId = null;
          }, 500);
        }

        // 引导去填写用户画像（如果还没填过）
        const userInfo = app.globalData.userInfo || {};
        if (!userInfo.grade) {
          setTimeout(() => {
            wx.navigateTo({ url: '/pages/profile/profile' });
          }, 1500);
        }
      },
      fail: () => {
        this.setData({ loginLoading: false });
        wx.showToast({ title: '网络异常，请重试', icon: 'none' });
      },
    });
  },

  // 跳过登录（先浏览不收藏）
  skipLogin() {
    this.setData({ showLoginModal: false });
    this._pendingFavUnitId = null;
  },

  // ═══════════════════════════════════════════════════════════
  //  跳转
  // ═══════════════════════════════════════════════════════════

  viewSchool(e) {
    const id     = e.currentTarget.dataset.id;
    const source = e.currentTarget.dataset.source || 'api';

    if (source === 'api') {
      // College Scorecard 学校：用 unitId（数字） or id
      const school = this._findSchool(id);
      const unitId = school ? (school.unitId || school.id) : id;
      const name   = school ? (school.nameEn || school.name || '') : '';
      wx.navigateTo({
        url: `/pages/school-detail/school-detail?apiUnit=${unitId}&apiName=${encodeURIComponent(name)}`,
      });
    } else {
      wx.navigateTo({ url: `/pages/school-detail/school-detail?id=${id}` });
    }
  },

  _findSchool(id) {
    const allSchools = [
      ...this.data.usApiSchools,
      ...this.data.expandResults,
    ];
    return allSchools.find(s => String(s.id) === String(id) || String(s.unitId) === String(id));
  },
});

// ═══════════════════════════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 为 API 返回的学校数据添加展示字段
 * College Scorecard normalize() 返回字段: unitId, name, city, state(2-letter abbr), ownership, ...
 */
function _enrichSchool(s) {
  return {
    ...s,
    // id 字段别名（WXML data-id 用）
    id:               s.unitId,
    // 兼容 stateAbbr 写法（College Scorecard 的 state 字段已是2字母缩写）
    stateAbbr:        s.state || '',
    tuitionDisplay:   s.tuitionOut
      ? `$${(s.tuitionOut / 1000).toFixed(0)}k/年`
      : '待询',
    admissionDisplay: s.admissionRateRaw != null
      ? `${Math.round(s.admissionRateRaw * 100)}%`
      : '—',
    satDisplay:       s.satAverage ? `${s.satAverage}` : '',
    difficultyTag:    _admDifficulty(s.admissionRateRaw),
    difficultyColor:  _admColor(s.admissionRateRaw),
    difficultyBg:     _admBg(s.admissionRateRaw),
    ownershipShort:   s.ownership && s.ownership.includes('公立') ? '公立' : '私立',
    gradRateFmt:      s.gradRate != null ? `${Math.round(s.gradRate)}%` : '',
  };
}

/**
 * 院校分类筛选
 */
function _filterByCategory(schools, category) {
  // 常青藤 + Top20 名单（按 College Scorecard unitId 或名称匹配）
  const IVY_NAMES = [
    'harvard', 'mit', 'stanford', 'yale', 'princeton', 'columbia',
    'university of pennsylvania', 'brown', 'dartmouth', 'cornell',
    'duke', 'northwestern', 'johns hopkins', 'caltech', 'vanderbilt',
    'rice', 'notre dame', 'tufts', 'emory', 'georgetown', 'washington university',
  ];

  if (category === 'ivy') {
    return schools.filter(s => {
      const n = (s.nameEn || s.name || '').toLowerCase();
      return IVY_NAMES.some(iv => n.includes(iv));
    });
  }
  if (category === 'public') {
    return schools.filter(s => s.ownership && s.ownership.includes('公立'));
  }
  if (category === 'stem') {
    // STEM 强校：高 SAT + 已知 STEM 校名 + 理工型
    const STEM_NAMES = [
      'mit', 'caltech', 'carnegie mellon', 'georgia tech', 'harvey mudd',
      'rensselaer', 'rose-hulman', 'colorado school of mines', 'worcester',
      'georgia institute', 'purdue', 'virginia tech', 'penn state',
    ];
    return schools.filter(s => {
      const n = (s.nameEn || s.name || '').toLowerCase();
      return (s.satAverage >= 1400) || STEM_NAMES.some(st => n.includes(st));
    });
  }
  if (category === 'liberal') {
    // 文理学院：学生规模小（< 5000）+ 私立
    return schools.filter(s =>
      s.ownership && s.ownership.includes('私立') &&
      s.studentSize && s.studentSize < 5000
    );
  }
  if (category === 'arts') {
    const ARTS_NAMES = [
      'risd', 'parsons', 'pratt', 'school of visual arts', 'calarts',
      'saic', 'otis', 'ringling', 'savannah', 'rhode island school',
      'art center', 'new york film', 'berklee',
    ];
    return schools.filter(s => {
      const n = (s.nameEn || s.name || '').toLowerCase();
      return ARTS_NAMES.some(a => n.includes(a));
    });
  }
  if (category === 'business') {
    const BIZ_NAMES = [
      'wharton', 'kellogg', 'stern', 'booth', 'haas', 'ross',
      'sloan', 'mccombs', 'kelley', 'mendoza', 'olin', 'fox',
      'babson', 'bentley', 'lehigh',
    ];
    return schools.filter(s => {
      const n = (s.nameEn || s.name || '').toLowerCase();
      return BIZ_NAMES.some(b => n.includes(b));
    });
  }
  return schools;
}

/**
 * 合集筛选
 */
function _filterByCollection(schools, collection) {
  if (collection === 'hard') {
    return schools.filter(s => s.admissionRateRaw != null && s.admissionRateRaw < 0.15);
  }
  if (collection === 'mid') {
    return schools.filter(s => s.admissionRateRaw != null && s.admissionRateRaw >= 0.15 && s.admissionRateRaw < 0.40);
  }
  if (collection === 'open') {
    return schools.filter(s => s.admissionRateRaw == null || s.admissionRateRaw >= 0.40);
  }
  if (collection === 'cheap') {
    // 学费亲民：外州学费 < $25,000
    return schools.filter(s => s.tuitionOut && s.tuitionOut < 25000);
  }
  if (collection === 'intl') {
    // 国际生友好：按机构大小 + 接受外国学生的录取率（数据有限，按学生规模 > 10000 + 私立）
    return schools.filter(s =>
      s.studentSize && s.studentSize >= 5000
    );
  }
  return schools;
}

// ── 难度标签和颜色 ──────────────────────────────────────────────

function _admDifficulty(rate) {
  if (rate == null) return '未公开';
  if (rate < 0.07)  return '极难录取';
  if (rate < 0.15)  return '难度极高';
  if (rate < 0.30)  return '竞争激烈';
  if (rate < 0.50)  return '选择性强';
  return '相对开放';
}

function _admColor(rate) {
  if (rate == null) return '#86868B';
  if (rate < 0.07)  return '#FF3B30';
  if (rate < 0.15)  return '#FF6B35';
  if (rate < 0.30)  return '#FF9500';
  if (rate < 0.50)  return '#34C759';
  return '#5AC8FA';
}

function _admBg(rate) {
  if (rate == null) return 'rgba(134,134,139,0.10)';
  if (rate < 0.07)  return 'rgba(255,59,48,0.10)';
  if (rate < 0.15)  return 'rgba(255,107,53,0.10)';
  if (rate < 0.30)  return 'rgba(255,149,0,0.10)';
  if (rate < 0.50)  return 'rgba(52,199,89,0.10)';
  return 'rgba(90,200,250,0.10)';
}
