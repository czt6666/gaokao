// pages/gaokao/gaokao.js
// 艺圆智探 · 高考志愿查询页

const FORM_KEY = 'gaokao_form_v3';
const CONSTRAINT_KEY = 'gaokao_constraints';

const PROVINCES = [
  '北京','河北','四川','贵州','安徽','广西','江西','云南','山西','重庆',
  '内蒙古','陕西','吉林','新疆','天津','青海','黑龙江','辽宁','湖南',
  '河南','广东','上海','福建','江苏','山东','浙江','湖北','甘肃','宁夏',
  '海南','西藏',
];

const PROVINCE_STATUS = {
  '北京':'full9','河北':'full','四川':'full','贵州':'full','安徽':'full',
  '广西':'full','江西':'full','云南':'full','山西':'full','重庆':'full',
  '内蒙古':'full','陕西':'full','吉林':'full','新疆':'full','天津':'full',
  '青海':'full','河南':'full','广东':'full','湖南':'full','黑龙江':'full',
  '辽宁':'full','上海':'full','福建':'full','江苏':'full','山东':'full',
  '浙江':'full','湖北':'full','甘肃':'full','宁夏':'full',
  '海南':'partial','西藏':'partial',
};

const PROVINCE_MODE = {
  '河北':'3+1+2', '辽宁':'3+1+2', '江苏':'3+1+2', '福建':'3+1+2',
  '湖北':'3+1+2', '湖南':'3+1+2', '广东':'3+1+2', '重庆':'3+1+2',
  '吉林':'3+1+2', '黑龙江':'3+1+2', '安徽':'3+1+2', '江西':'3+1+2',
  '广西':'3+1+2', '贵州':'3+1+2', '甘肃':'3+1+2', '河南':'3+1+2',
  '山西':'3+1+2', '陕西':'3+1+2', '内蒙古':'3+1+2', '四川':'3+1+2',
  '云南':'3+1+2', '宁夏':'3+1+2', '青海':'3+1+2',
  '北京':'3+3', '天津':'3+3', '山东':'3+3', '上海':'3+3',
  '浙江':'3+3', '海南':'3+3',
  '新疆':'old', '西藏':'old',
};

function getProvinceTip(province) {
  const s = PROVINCE_STATUS[province];
  if (s === 'full9') return '数据完整（2017–2025，9年）✓';
  if (s === 'full')  return '数据完整（2021–2025，含2025）✓';
  if (s === 'partial') return '2021–2025 院校录取数据';
  return '数据建设中';
}

function getExamMode(province) {
  return PROVINCE_MODE[province] || '3+1+2';
}

function getSubjectStr(examMode, first312, second312, subjects333, oldSubject) {
  if (examMode === '3+1+2') {
    return [first312, ...second312].join('+');
  }
  if (examMode === '3+3') {
    return subjects333.join('+');
  }
  return oldSubject;
}

function getFormCount() {
  try {
    const saved = JSON.parse(wx.getStorageSync(FORM_KEY) || '[]');
    return Array.isArray(saved) ? saved.length : 0;
  } catch (e) {
    return 0;
  }
}

Page({
  data: {
    mode: 'score',
    rankInput: '',
    scoreInput: '',
    provinces: PROVINCES,
    provinceIdx: 0,
    provinceTip: getProvinceTip('北京'),
    examMode: '3+3',
    first312: '',
    second312: [],
    subjects333: [],
    oldSubject: '',
    subjectError: '',

    // 偏好约束
    constraintExpanded: false,
    constraintMajor: '',
    constraintCities: [],
    constraintNature: [],
    constraintLevels: [],

    gkLoading: false,
    gkError: '',
    formCount: 0,
  },

  onLoad(options) {
    try {
      const p = wx.getStorageSync('gaokao_province');
      if (p) {
        const idx = PROVINCES.indexOf(p);
        if (idx >= 0) {
          const mode = getExamMode(p);
          this.setData({
            provinceIdx: idx,
            provinceTip: getProvinceTip(p),
            examMode: mode,
            first312: '',
            second312: [],
            subjects333: [],
            oldSubject: '',
            subjectError: '',
          });
        }
      }
    } catch (e) {}

    this._loadConstraints(options);
  },

  onShow() {
    this.setData({ formCount: getFormCount() });
  },

  _loadConstraints(options) {
    let constraints = null;

    // 优先从 URL query 恢复（参数名 c_major / c_city / c_nature / c_tier）
    if (options) {
      const hasAny = options.c_major !== undefined || options.c_city || options.c_nature || options.c_tier;
      if (hasAny) {
        constraints = {
          major: options.c_major || '',
          cities: this._parseQueryArr(options.c_city),
          nature: this._parseQueryArr(options.c_nature),
          levels: this._parseQueryArr(options.c_tier),
        };
      }
    }

    // 其次从 localStorage 恢复
    if (!constraints) {
      try {
        const raw = wx.getStorageSync(CONSTRAINT_KEY);
        if (raw) constraints = JSON.parse(raw);
      } catch (e) {}
    }

    if (constraints) {
      this.setData({
        constraintMajor: constraints.major || '',
        constraintCities: constraints.cities || [],
        constraintNature: constraints.nature || [],
        constraintLevels: constraints.levels || [],
      });
    }
  },

  _parseQueryArr(val) {
    if (!val) return [];
    if (typeof val === 'string') {
      try {
        return decodeURIComponent(val).split(',').filter(Boolean);
      } catch (e) {
        return val.split(',').filter(Boolean);
      }
    }
    return [];
  },

  _saveConstraints() {
    const { constraintMajor, constraintCities, constraintNature, constraintLevels } = this.data;
    try {
      wx.setStorageSync(CONSTRAINT_KEY, JSON.stringify({
        major: constraintMajor,
        cities: constraintCities,
        nature: constraintNature,
        levels: constraintLevels,
      }));
    } catch (e) {}
  },

  setMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode, gkError: '' });
  },

  onInput(e) {
    if (this.data.mode === 'rank') {
      this.setData({ rankInput: e.detail.value });
    } else {
      this.setData({ scoreInput: e.detail.value });
    }
  },

  onProvinceChange(e) {
    const idx = Number(e.detail.value);
    const province = PROVINCES[idx];
    const mode = getExamMode(province);
    this.setData({
      provinceIdx: idx,
      provinceTip: getProvinceTip(province),
      examMode: mode,
      first312: '',
      second312: [],
      subjects333: [],
      oldSubject: '',
      subjectError: '',
      gkError: '',
    });
    try { wx.setStorageSync('gaokao_province', province); } catch (e) {}
  },

  toggleFirst312(e) {
    const v = e.currentTarget.dataset.value;
    this.setData({ first312: v, subjectError: '' });
  },

  toggleSecond312(e) {
    const v = e.currentTarget.dataset.value;
    const arr = this.data.second312.slice();
    const i = arr.indexOf(v);
    if (i >= 0) {
      arr.splice(i, 1);
    } else {
      if (arr.length >= 2) {
        this.setData({ subjectError: '请再选 2 科（已选 2 科）' });
        return;
      }
      arr.push(v);
    }
    this.setData({
      second312: arr,
      subjectError: arr.length === 2 ? '' : `请再选 2 科（已选 ${arr.length} 科）`,
    });
  },

  toggleSubject333(e) {
    const v = e.currentTarget.dataset.value;
    const arr = this.data.subjects333.slice();
    const i = arr.indexOf(v);
    if (i >= 0) {
      arr.splice(i, 1);
    } else {
      if (arr.length >= 3) {
        this.setData({ subjectError: '请选 3 科（已选 3 科）' });
        return;
      }
      arr.push(v);
    }
    this.setData({
      subjects333: arr,
      subjectError: arr.length === 3 ? '' : `请选 3 科（已选 ${arr.length} 科）`,
    });
  },

  toggleOldSubject(e) {
    const v = e.currentTarget.dataset.value;
    this.setData({ oldSubject: v, subjectError: '' });
  },

  // ── 偏好约束 ──
  toggleConstraintPanel() {
    this.setData({ constraintExpanded: !this.data.constraintExpanded });
  },

  onConstraintMajorInput(e) {
    let v = e.detail.value || '';
    if (v.length > 50) v = v.slice(0, 50);
    this.setData({ constraintMajor: v }, () => {
      this._saveConstraints();
    });
  },

  toggleConstraint(e) {
    const field = e.currentTarget.dataset.field;
    const v = e.currentTarget.dataset.value;
    const arr = this.data[field].slice();
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(v);
    var update = {};
    update[field] = arr;
    this.setData(update, () => {
      this._saveConstraints();
    });
  },

  onSubmit() {
    const {
      mode, rankInput, scoreInput, provinceIdx,
      examMode, first312, second312, subjects333, oldSubject,
      constraintMajor, constraintCities, constraintNature, constraintLevels,
      gkLoading,
    } = this.data;
    if (gkLoading) return;

    const input = mode === 'rank' ? rankInput : scoreInput;
    if (!input || !input.trim()) {
      this.setData({ gkError: mode === 'rank' ? '请输入全省排名位次' : '请输入模考成绩' });
      return;
    }

    const numInput = parseInt(input);
    if (isNaN(numInput) || numInput <= 0) {
      this.setData({ gkError: mode === 'rank' ? '位次必须是正整数' : '分数必须是正整数' });
      return;
    }
    if (mode === 'rank' && numInput > 500000) {
      this.setData({ gkError: '位次不能超过 500,000，请核实后输入' });
      return;
    }
    if (mode === 'score' && numInput > 750) {
      this.setData({ gkError: '分数不能超过 750 分，请核实后输入' });
      return;
    }

    const province = PROVINCES[provinceIdx];

    let subjectStr = '';
    if (examMode === '3+1+2') {
      if (!first312) {
        this.setData({ gkError: '请选择首选科目' });
        return;
      }
      if (second312.length !== 2) {
        this.setData({ gkError: `请再选 2 科（已选 ${second312.length} 科）` });
        return;
      }
      subjectStr = [first312, ...second312].join('+');
    } else if (examMode === '3+3') {
      if (subjects333.length !== 3) {
        this.setData({ gkError: `请选 3 科（已选 ${subjects333.length} 科）` });
        return;
      }
      subjectStr = subjects333.join('+');
    } else {
      if (!oldSubject) {
        this.setData({ gkError: '请选择文科或理科' });
        return;
      }
      subjectStr = oldSubject;
    }

    // 组装约束参数（URL query 格式）
    const constraintParams = {};
    if (constraintMajor && constraintMajor.trim()) {
      constraintParams.c_major = constraintMajor.trim().slice(0, 50);
    }
    if (constraintCities.length) {
      constraintParams.c_city = constraintCities.join(',');
    }
    if (constraintNature.length) {
      constraintParams.c_nature = constraintNature.join(',');
    }
    if (constraintLevels.length) {
      constraintParams.c_tier = constraintLevels.join(',');
    }

    this.setData({ gkLoading: true, gkError: '' });

    if (!wx.cloud) {
      this.setData({ gkLoading: false, gkError: '云开发未初始化，请重启小程序' });
      return;
    }

    if (mode === 'score') {
      wx.cloud.callFunction({
        name: 'gaokaoQuery',
        data: { type: 'simulate', mockScore: numInput, province, subject: subjectStr, exam_mode: examMode },
        success: (res) => {
          const r = res.result;
          if (!r || !r.success) {
            this.setData({ gkLoading: false, gkError: (r && r.error) || '查询失败，请稍后重试' });
            return;
          }
          const simData = r.data;
          if (simData.no_data || !simData.estimated_rank) {
            this.setData({
              gkLoading: false,
              gkError: (simData.note || '该省暂无一分一段数据') + '\n请切换到「位次」模式直接输入位次',
            });
            return;
          }
          this._fetchRecommend(simData.estimated_rank, province, subjectStr, examMode, {
            fromMock: true,
            mockScore: numInput,
            queryMode: 'score',
          }, constraintParams);
        },
        fail: (err) => {
          console.error('[gaokao] simulate fail:', err);
          const errMsg = (err && err.errMsg) || '';
          const userMsg = errMsg.includes('NOLOGIN') || errMsg.includes('timeout')
            ? '网络异常，请关闭小程序后重新进入再试'
            : '查询失败，请检查网络后重试';
          this.setData({ gkLoading: false, gkError: userMsg });
        },
      });
    } else {
      this._fetchRecommend(numInput, province, subjectStr, examMode, { queryMode: 'rank' }, constraintParams);
    }
  },

  _fetchRecommend(rank, province, subject, examMode, extra, constraints) {
    var self = this;
    this._recommendTimer = setTimeout(function() {
      if (self.data.gkLoading) {
        self.setData({ gkLoading: false, gkError: '查询超时，请检查网络后重试' });
      }
    }, 35000);

    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: { type: 'recommend', rank, province, subject, exam_mode: examMode, ...constraints },
      success: (res) => {
        if (this._recommendTimer) { clearTimeout(this._recommendTimer); this._recommendTimer = null; }
        this.setData({ gkLoading: false });
        const r = res.result;
        if (!r || !r.success) {
          this.setData({ gkError: (r && r.error) || '查询失败，请稍后重试' });
          return;
        }
        const app = getApp();
        app.globalData              = app.globalData || {};
        app.globalData.gaokaoResult = r.data;
        app.globalData.gaokaoQuery  = { rank, province, subject, exam_mode: examMode, constraints: constraints, ...extra };
        app.globalData.currentSessionId = '';

        this._createSession(rank, province, subject, examMode, extra.queryMode || 'rank', r.data);

        // 构建 URL query，支持刷新/分享后状态不丢失
        var urlParts = [
          'rank=' + encodeURIComponent(rank),
          'province=' + encodeURIComponent(province),
          'subject=' + encodeURIComponent(subject),
          'exam_mode=' + encodeURIComponent(examMode),
        ];
        if (extra.queryMode) urlParts.push('queryMode=' + encodeURIComponent(extra.queryMode));
        if (extra.fromMock) urlParts.push('fromMock=1');
        if (extra.mockScore != null) urlParts.push('mockScore=' + encodeURIComponent(extra.mockScore));
        if (constraints) {
          if (constraints.c_major) urlParts.push('c_major=' + encodeURIComponent(constraints.c_major));
          if (constraints.c_city) urlParts.push('c_city=' + encodeURIComponent(constraints.c_city));
          if (constraints.c_nature) urlParts.push('c_nature=' + encodeURIComponent(constraints.c_nature));
          if (constraints.c_tier) urlParts.push('c_tier=' + encodeURIComponent(constraints.c_tier));
        }
        wx.navigateTo({ url: '/pages/gaokao-results/gaokao-results?' + urlParts.join('&') });
      },
      fail: (err) => {
        if (this._recommendTimer) { clearTimeout(this._recommendTimer); this._recommendTimer = null; }
        console.error('[gaokao] recommend fail:', err);
        const errMsg = (err && err.errMsg) || '';
        const userMsg = errMsg.includes('NOLOGIN') || errMsg.includes('timeout')
          ? '网络异常，请关闭小程序后重新进入再试'
          : '查询失败，请检查网络后重试';
        this.setData({ gkLoading: false, gkError: userMsg });
      },
    });
  },

  _createSession(rank, province, subject, examMode, mode, resultData) {
    const resultCounts = {
      surge:  (resultData.surge        || []).length,
      stable: (resultData.stable       || []).length,
      safe:   (resultData.safe         || []).length,
      gems:   (resultData.hidden_gems  || []).length,
    };
    wx.cloud.callFunction({
      name: 'trackGaokaoSession',
      data: { action: 'create', mode, rank, province, subject, exam_mode: examMode, resultCounts },
      success: (res) => {
        if (res.result && res.result.success) {
          const app = getApp();
          app.globalData = app.globalData || {};
          app.globalData.currentSessionId = res.result.sessionId;
        }
      },
      fail: () => { /* 不影响主流程 */ },
    });
  },

  goToForm() {
    wx.navigateTo({ url: '/pages/gaokao-form/gaokao-form' });
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },
});
