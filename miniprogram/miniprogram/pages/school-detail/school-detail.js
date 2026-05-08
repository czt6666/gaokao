// pages/school-detail/school-detail.js
const { getById } = require('../../utils/schools_data');
const { calcFitBadge } = require('../../utils/matcher');
const CollegeAPI = require('../../utils/college_api');
const Scorer = require('../../utils/persona_scorer');
const { getUSProfile, getUSDeadlines, getProgramTier } = require('../../utils/study_abroad_engine');

const APPLY_PORTAL_LABELS = {
  commonapp: 'Common App',
  uc:        'UC系统申请',
  own:       '学校独立申请',
};

function fmtTuition(school) {
  if (school.tuitionCNY) return `约 ${Math.round(school.tuitionCNY / 10000)}万元/年`;
  if (school.tuitionUSD) return `约 $${Math.round(school.tuitionUSD / 1000)}k/年`;
  return '咨询学校';
}

const MI_NAMES = {
  linguistic:    '语言智能',
  logical:       '逻辑数学',
  spatial:       '空间视觉',
  musical:       '音乐节奏',
  bodily:        '身体运动',
  interpersonal: '人际交往',
  intrapersonal: '自我认知',
  naturalist:    '自然探索',
};

const DIFFICULTY_LABELS = {
  very_high: { label: '极难录取', color: '#B03A2E' },
  high:      { label: '较难录取', color: '#C49A22' },
  medium:    { label: '中等难度', color: '#2A7A5A' },
};

/** 根据孩子 MI 分数 × 学校 recommendedMajorsByMI，得出个性化专业推荐 */
function getPersonalizedMajors(assessmentData, school) {
  if (!assessmentData || !school.recommendedMajorsByMI) return [];
  const mi = assessmentData.multipleIntelligences || {};
  // 取分数最高的3个MI维度
  const sorted = Object.entries(mi)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => key);

  const seen = new Set();
  const result = [];
  sorted.forEach(miKey => {
    const majors = school.recommendedMajorsByMI[miKey] || [];
    majors.forEach(m => {
      if (!seen.has(m)) { seen.add(m); result.push(m); }
    });
  });
  return result.slice(0, 8); // 最多展示8个
}

/** 取孩子最强的前3个MI名称，用于标注 */
function getTopMINames(assessmentData) {
  if (!assessmentData) return [];
  const mi = assessmentData.multipleIntelligences || {};
  return Object.entries(mi)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => MI_NAMES[key] || key);
}

Page({
  data: {
    school: null,
    matchScore: 0,
    fitBadge: null,
    tuitionText: '',
    difficultyInfo: null,
    miStrengthNames: [],
    hasAssessment: false,
    personalizedMajors: [],
    topMINames: [],
    notableAlumni: [],
    alumniNetwork: '',
    alumniQuote: '',
    website: '',
    resources: null,
    // ── Phase 1-D: 收藏状态 ──
    isFaved: false,
    // ── College Scorecard 实时数据 ──
    liveData: null,
    liveDataLoading: false,
    liveDataError: false,
    isUSSchool: false,
    // ── Phase 1-B: US精选学校画像 ──
    usProfile: null,         // USA_SCHOOL_PROFILES 对应条目
    stemOptBadge: false,     // 是否显示 STEM OPT 3年工签延签提示
    applyPortalLabel: '',    // 申请平台文字
    fourYearCostFmt: '',     // 4年总花费（CNY 万元）
    chineseStudentNote: '',  // 中国学生社区/背景备注
    careerHighlights: [],    // 职业发展关键词
    deadlines: null,         // Phase 3: 申请截止日期
    // ── Phase 1-C: 快速适配度检测 ──
    fitCheck: {
      satBand:  '',     // 用户选择的 SAT 区间 key
      gpaBand:  '',     // 用户选择的 GPA 区间 key
      result:   null,   // { tier, label, color, bg, reason }
    },
    satBands: [
      { label: '<1200', value: 'low'     },
      { label: '1200-1350', value: 'mid_low' },
      { label: '1350-1450', value: 'mid'     },
      { label: '1450-1550', value: 'mid_high'},
      { label: '1550+',     value: 'high'    },
    ],
    gpaBands: [
      { label: '<3.0',    value: 'low'  },
      { label: '3.0-3.4', value: 'mid' },
      { label: '3.4-3.7', value: 'good'},
      { label: '3.7+',    value: 'high'},
    ],
    // ── 寄宿高中数据 ──
    isBoardingSchool: false,
    boardingData: null,
    // ── 中国高校 Apify 联系方式 ──
    cnContactInfo: null,
    cnContactLoading: false,
    // ── P5 专业上下文（从 career-vision → schools → school-detail）──
    programContext: null,  // { clusterLabel, cipCodes, earn, count, tier, tierLabel, avgEarn, earnVsAvg }
  },

  // ── 行为追踪：进入详情页时记录时间，离开时上报停留时长
  _detailEnterTime: null,
  _detailRegion: null,

  onLoad(options) {
    this._detailEnterTime = Date.now();

    // P5: 检测专业上下文参数（从 career-vision → schools → school-detail 携带）
    if (options.clusterId && options.cipCodes) {
      this._pendingProgramContext = {
        clusterId:    options.clusterId,
        clusterLabel: options.clusterLabel ? decodeURIComponent(options.clusterLabel) : '',
        cipCodes:     options.cipCodes.split(',').map(Number).filter(n => n > 0),
      };
    }

    // ── 路由1：扩展搜索跳转（apiUnit + apiName，学校不在本地库中）
    if (options.apiUnit) {
      this._detailRegion = 'us';
      this._loadApiOnlySchool(options.apiUnit, decodeURIComponent(options.apiName || ''));
      return;
    }

    // ── 路由3：寄宿高中（boardingId 参数）
    if (options.boardingId) {
      this._detailRegion = 'boarding';
      this._loadBoardingSchool(options.boardingId);
      return;
    }

    // ── 路由4：中国高校 Apify 详情（cnSchoolId 参数）
    if (options.cnSchoolId) {
      this._detailRegion = 'cn';
      this._loadCNApiSchool(options.cnSchoolId, decodeURIComponent(options.cnName || ''));
      return;
    }

    // ── 路由2：本地学校库（id 参数）
    const { id } = options;
    const school = getById(id);
    if (school) this._detailRegion = school.region || 'unknown';

    if (!school) {
      wx.showToast({ title: '学校信息不存在', icon: 'none' });
      wx.navigateBack();
      return;
    }

    const assessmentData = wx.getStorageSync('assessmentData');
    let matchScore = 0;
    let fitBadge = null;

    if (assessmentData) {
      matchScore = options.matchScore ? parseInt(options.matchScore) : 0;
      fitBadge = calcFitBadge({ matchScore });
    }

    const personalizedMajors = getPersonalizedMajors(assessmentData, school);
    const topMINames = getTopMINames(assessmentData);

    this.setData({
      school,
      matchScore,
      fitBadge,
      tuitionText: fmtTuition(school),
      difficultyInfo: DIFFICULTY_LABELS[school.admissionDifficulty] || DIFFICULTY_LABELS.medium,
      miStrengthNames: (school.miStrengths || []).map(m => MI_NAMES[m] || m),
      hasAssessment: !!assessmentData,
      personalizedMajors,
      topMINames,
      notableAlumni: school.notableAlumni || [],
      alumniNetwork: school.alumniNetwork || '',
      alumniQuote: school.alumniQuote || '',
      website: school.website || '',
      resources: school.resources || null,
    });

    wx.setNavigationBarTitle({ title: school.name });

    // ── 学校浏览行为追踪（回写到 assessments 文档）────────────────
    const docId = wx.getStorageSync('lastAssessmentDocId');
    if (docId) {
      wx.cloud.callFunction({
        name: 'updateAssessmentNote',
        data: {
          docId,
          behaviorUpdate: {
            viewedSchoolId:     school.id,
            viewedSchoolName:   school.name,
            viewedSchoolRegion: school.region || '',
          },
        },
        fail: () => {},
      });
    }

    // 美国大学 → 异步拉取 College Scorecard 实时数据 + Phase 1-B 画像
    const isUS = school.region === 'us';
    this.setData({ isUSSchool: isUS });
    if (isUS && school.nameEn) {
      this._fetchLiveData(school.nameEn);
      // 用本地 key（id）先做一次画像加载（liveData 未就绪时给出静态画像）
      this._applyUSProfileExtras(school.id, null);
    }

    // Phase 1-D: 初始化收藏状态
    this._initFavState(school.id);
  },

  // ── 加载寄宿高中详情（从 storage 读取）──────────────────────
  _loadBoardingSchool(boardingId) {
    const school = wx.getStorageSync('boardingSchoolDetail');
    if (!school || school.id !== boardingId) {
      wx.showToast({ title: '数据加载失败，请返回重试', icon: 'none' });
      wx.navigateBack();
      return;
    }

    // 构造 school 对象兼容现有 WXML 顶部渲染（校名、地点等）
    const proxy = {
      id: school.id,
      name: school.nameCN,
      nameEn: school.name,
      country: school.country,
      city: school.city + ', ' + school.state,
      type: 'highschool',
      level: 'boarding',
      intro: school.intro,
      tags: school.tags || [],
      website: school.website || '',
    };

    wx.setNavigationBarTitle({ title: school.nameCN });

    this.setData({
      school: proxy,
      isBoardingSchool: true,
      boardingData: school,
      resources: school.resources || null,
      hasAssessment: false,
    });
  },

  // ── 加载 API 专属学校（不在本地库中）──────────────────────────
  async _loadApiOnlySchool(unitId, nameEn) {
    const displayName = nameEn || '美国大学';
    wx.setNavigationBarTitle({ title: displayName });

    // 先用一个占位 school 对象让 WXML 有内容渲染
    const placeholder = {
      id: `api_${unitId}`,
      name: displayName,
      nameEn: displayName,
      country: '美国',
      city: '—',
      type: 'university',
      region: 'us',
      intro: '数据加载中，请稍候…',
      tags: [],
      majors: [],
    };
    this.setData({ school: placeholder, isUSSchool: true, liveDataLoading: true });

    try {
      const raw = await CollegeAPI.getDetail(nameEn, unitId);
      if (!raw) {
        this.setData({ liveDataLoading: false, liveDataError: true });
        return;
      }
      const liveData = CollegeAPI.formatForDisplay(raw);

      // 用 API 数据填充学校基本信息
      const school = {
        ...placeholder,
        city: raw.city || raw['school.city'] || '—',
        nameEn: raw.name || nameEn,
        intro: raw['school.school_url']
          ? `官网：${raw['school.school_url']}`
          : `美国教育部收录院校 · Unit ID: ${unitId}`,
        website: raw['school.school_url'] || '',
        tuitionUSD: raw['latest.cost.tuition.out_of_state'] || 0,
        admissionDifficulty: liveData.admissionRateRaw < 0.07 ? 'very_high'
          : liveData.admissionRateRaw < 0.2 ? 'high' : 'medium',
      };

      this.setData({
        school,
        tuitionText: school.tuitionUSD ? `约 $${Math.round(school.tuitionUSD / 1000)}k/年` : '费用待询',
        difficultyInfo: DIFFICULTY_LABELS[school.admissionDifficulty] || DIFFICULTY_LABELS.medium,
        website: school.website,
        liveData,
        liveDataLoading: false,
        hasAssessment: false,
      });
      wx.setNavigationBarTitle({ title: school.nameEn });
      // Phase 1-B: 加载精选画像字段
      this._applyUSProfileExtras(nameEn, liveData);
      // Phase 1-D: 初始化收藏状态
      this._initFavState(school.id);
      // P5: 如有专业上下文，附加专业收益数据
      if (this._pendingProgramContext) {
        this._applyProgramContext(liveData, this._pendingProgramContext);
      }
    } catch (err) {
      console.warn('[CollegeAPI] _loadApiOnlySchool', err);
      this.setData({ liveDataLoading: false, liveDataError: true });
    }
  },

  // ── 拉取 College Scorecard 实时数据 ──────────────────────
  async _fetchLiveData(nameEn) {
    this.setData({ liveDataLoading: true });
    try {
      const raw = await CollegeAPI.getDetail(nameEn);
      if (raw) {
        const liveData = CollegeAPI.formatForDisplay(raw);
        this.setData({ liveData, liveDataLoading: false });
        this._applyUSProfileExtras(nameEn, liveData);
        // P5: 如有专业上下文，附加专业收益数据
        if (this._pendingProgramContext) {
          this._applyProgramContext(liveData, this._pendingProgramContext);
        }
      } else {
        this.setData({ liveDataLoading: false });
      }
    } catch (err) {
      // 云函数未部署时静默失败，不显示错误状态
      console.warn('[CollegeAPI] 实时数据不可用（云函数未部署？）', err);
      this.setData({ liveDataLoading: false });
    }
  },

  // ── Phase 1-B: 加载 US精选画像字段 ──────────────────────
  _applyUSProfileExtras(nameEnOrKey, liveData) {
    const sp = getUSProfile(nameEnOrKey);
    if (!sp && !liveData) return;

    // 4年总花费 (CNY)
    let fourYearCostFmt = '';
    const costRaw = liveData && liveData.costAttendRaw;
    if (costRaw && costRaw > 0) {
      const total4yr = Math.round(costRaw * 4 * 7.25 / 10000);
      fourYearCostFmt = `约 ¥${total4yr} 万（4年总计）`;
    }

    if (!sp) {
      this.setData({ fourYearCostFmt });
      return;
    }

    const applyPortalLabel = APPLY_PORTAL_LABELS[sp.apply] || '';
    const chineseStudentNote = sp.cn || '';
    const careerHighlights = Array.isArray(sp.career) ? sp.career : [];
    const stemOptBadge = !!sp.stemOpt;

    // Phase 3: 截止日期数据
    const deadlines = getUSDeadlines(nameEnOrKey);

    this.setData({
      usProfile: sp,
      stemOptBadge,
      applyPortalLabel,
      fourYearCostFmt,
      chineseStudentNote,
      careerHighlights,
      deadlines,
    });
  },

  // ── P5: 专业上下文（Program Context）──────────────────────
  // 使用 liveData.programEarnings 提取该院校在指定 CIP 方向的薪资 + 规模
  _applyProgramContext(liveData, ctx) {
    if (!liveData || !ctx || !ctx.cipCodes || ctx.cipCodes.length === 0) return;
    const programEarnings = (liveData && liveData.programEarnings) || {};

    // 聚合多个CIP代码（取有数据的第一个）
    let earn = null, count = 0;
    ctx.cipCodes.forEach(cip => {
      const cipStr = String(Math.floor(cip));
      const entry = programEarnings[cipStr];
      if (entry) {
        if (entry.earn && !earn) earn = entry.earn;
        if (entry.count) count += entry.count;
      }
    });

    // 学校平均薪资（全专业中位）
    const avgEarn = liveData.medianEarnings6yr || null;

    // PROGRAM_RANKINGS tier
    const tierInfo = getProgramTier
      ? getProgramTier(liveData.name || '', ctx.clusterLabel)
      : null;

    // 格式化
    const fmtK = n => n && n > 0 ? '$' + Math.round(n / 1000) + 'k' : null;
    const earnVsAvg = (earn && avgEarn && avgEarn > 0)
      ? (earn > avgEarn * 1.05 ? '高于均值' : earn < avgEarn * 0.95 ? '低于均值' : '接近均值')
      : null;

    const programContext = {
      clusterLabel:  ctx.clusterLabel || '',
      earnFmt:       fmtK(earn),
      countFmt:      count > 0 ? `${count} 人/年` : null,
      avgEarnFmt:    fmtK(avgEarn),
      earnVsAvg,
      tier:          tierInfo ? tierInfo.tier      : null,
      tierLabel:     tierInfo ? tierInfo.label     : null,
      hasProgramData: !!(earn || count > 0),
    };

    this.setData({ programContext });
  },

  // ── Phase 1-D: 收藏 ──────────────────────────────────────
  /**
   * 初始化收藏状态（在 onLoad 各路由末尾调用）
   * favId 优先使用 school.id，API-only 学校用 api_{unitId}
   */
  _initFavState(favId) {
    const favIds = wx.getStorageSync('favSchoolIds') || [];
    this._favId = favId;
    this.setData({ isFaved: favIds.includes(favId) });
  },

  toggleDetailFav() {
    const favId = this._favId || (this.data.school && this.data.school.id) || '';
    if (!favId) return;
    let favIds = wx.getStorageSync('favSchoolIds') || [];
    const alreadyFaved = favIds.includes(favId);
    if (alreadyFaved) {
      favIds = favIds.filter(id => id !== favId);
      wx.showToast({ title: '已取消收藏', icon: 'none', duration: 1200 });
    } else {
      favIds.push(favId);
      wx.showToast({ title: '已收藏 ⭐', icon: 'none', duration: 1200 });
    }
    wx.setStorageSync('favSchoolIds', favIds);
    this.setData({ isFaved: !alreadyFaved });
  },

  // ── Phase 1-C: 快速适配度检测 ──────────────────────────────
  onFitSatBand(e) {
    const val = e.currentTarget.dataset.value;
    this.setData({ 'fitCheck.satBand': val });
    this._calcFitCheck();
  },

  onFitGpaBand(e) {
    const val = e.currentTarget.dataset.value;
    this.setData({ 'fitCheck.gpaBand': val });
    this._calcFitCheck();
  },

  /**
   * 基于用户的 SAT 区间 + GPA 区间 与学校录取率/SAT均分对比，输出 Reach / Target / Safety
   */
  _calcFitCheck() {
    const { fitCheck, liveData } = this.data;
    if (!fitCheck.satBand || !fitCheck.gpaBand) return;

    // SAT 区间 → 数值中位
    const SAT_MID = { low: 1100, mid_low: 1275, mid: 1400, mid_high: 1500, high: 1580 };
    // GPA 区间 → 4.0 scale 中位
    const GPA_MID = { low: 2.7, mid: 3.2, good: 3.55, high: 3.85 };

    const userSAT = SAT_MID[fitCheck.satBand] || 1300;
    const userGPA = GPA_MID[fitCheck.gpaBand] || 3.2;

    // 学校 SAT 均分（来自 liveData 或 school）
    const schoolSAT = liveData
      ? (parseInt(liveData.satAverage) || null)
      : null;
    const admRate = liveData ? (liveData.admissionRateRaw || null) : null;

    // 计算 SAT 差距
    let satGap = 0;
    if (schoolSAT) {
      satGap = userSAT - schoolSAT;
    }

    // GPA 门槛推算（根据录取率）
    let gpaThreshold = 3.8;
    if (admRate != null) {
      if (admRate < 0.07)  gpaThreshold = 3.9;
      else if (admRate < 0.15) gpaThreshold = 3.7;
      else if (admRate < 0.30) gpaThreshold = 3.5;
      else if (admRate < 0.50) gpaThreshold = 3.2;
      else gpaThreshold = 2.8;
    }

    const gpaGap = userGPA - gpaThreshold;

    // 综合打分
    const satScore = satGap > 60 ? 2 : satGap > -50 ? 1 : 0;
    const gpaScore = gpaGap > 0.2 ? 2 : gpaGap > -0.15 ? 1 : 0;
    const total = satScore + gpaScore;

    let tier, label, color, bg, reason;
    if (total >= 3) {
      tier = 'safety'; label = '保底学校 Safety';
      color = '#34C759'; bg = 'rgba(52,199,89,0.1)';
      reason = 'SAT和GPA均高于录取中位线，录取可能性较高';
    } else if (total >= 2) {
      tier = 'target'; label = '目标学校 Target';
      color = '#0071E3'; bg = 'rgba(0,113,227,0.1)';
      reason = '与录取门槛基本匹配，需保持文书与细节竞争力';
    } else if (total === 1) {
      tier = 'reach'; label = '冲刺学校 Reach';
      color = '#FF9500'; bg = 'rgba(255,149,0,0.1)';
      reason = '学术条件偏低，但通过突出文书或特长仍有机会';
    } else {
      tier = 'longshot'; label = '努力冲刺';
      color = '#FF3B30'; bg = 'rgba(255,59,48,0.1)';
      reason = '差距较大，建议同时申请更多匹配学校';
    }

    this.setData({ 'fitCheck.result': { tier, label, color, bg, reason } });
  },

  copyCssaUrl(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: 'CSSA 网址已复制', icon: 'success' }),
    });
  },

  openWebsite(e) {
    const url = (e && e.currentTarget && e.currentTarget.dataset.url)
      || this.data.website
      || (this.data.boardingData && this.data.boardingData.website);
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '网址已复制', icon: 'success' }),
    });
  },

  contactConsultant() {
    // 直接带着学校名称进入袁希AI顾问模式——实时对话，不再是死的预约流程
    const schoolName = encodeURIComponent(this.data.school?.name || this.data.school?.nameEn || '');
    // wx.navigateTo({ url: `/pages/ai-chat/ai-chat?mode=consult&school=${schoolName}` });
  },

  goReport() {
    wx.navigateTo({ url: '/pages/study-abroad-report/study-abroad-report' });
  },

  goBack() { wx.navigateBack(); },

  goAssessment() { wx.navigateTo({ url: '/pages/questionnaire/questionnaire' }); },

  // ── 行为信号：离开详情页时上报停留时长 ──────────────────
  onUnload() {
    this._reportDwell();
  },
  onHide() {
    this._reportDwell();
  },
  _reportDwell() {
    if (!this._detailEnterTime) return;
    const dwellSec = Math.round((Date.now() - this._detailEnterTime) / 1000);
    if (dwellSec < 3) return; // 忽略秒开即关
    Scorer.record('school_detail_viewed', {
      dwellSec,
      region: this._detailRegion || 'unknown',
    });
    this._detailEnterTime = null; // 防止重复上报
  },

  // ── 行为信号：查看第二层实战资源时记录 ────────────────
  onResourceSectionViewed() {
    Scorer.record('resource_layer_viewed');
  },

  onShareAppMessage() {
    const school = this.data.school;
    const name = school && school.name ? school.name : '这所学校';
    return {
      title: `${name} · 袁希精选学校详情`,
      path: `/pages/school-detail/school-detail?id=${school && school.id || ''}`,
    };
  },
});
