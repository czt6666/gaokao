// pages/study-abroad-report/study-abroad-report.js
// Phase 2 + P6 Career-First: 选校分析报告 · 付费解锁 · ¥199
//
// 报告6个模块:
//   M0 — 职业愿景锚点 (来自 career-vision 路径，有则显示)
//   M1 — 个人画像摘要 (GPA/SAT/专业/预算)
//   M2 — 收藏学校对比表 (校名/QS/录取率/SAT均值/CNY年费 + 专业层级)
//   M3 — 4年留学总花费 + ROI 预估 (CNY万元)
//   M4 — 就业出路指标 (STEM OPT / H1B 提示)
//   M5 — 申请时间轴 (ED/EA/RD 通用版)

const { getUSProfile, getUSDeadlines, buildCareerVisions, CAREER_VISIONS, getProgramTier } = require('../../utils/study_abroad_engine');
const CollegeAPI = require('../../utils/college_api');

const SAT_MID = { low: 1100, mid_low: 1275, mid: 1400, mid_high: 1500, high: 1580 };
const GPA_MID = { low: 2.7, mid: 3.2, good: 3.55, high: 3.85 };

const APPLY_PORTAL_LABELS = {
  commonapp: 'Common App',
  uc:        'UC系统申请',
  own:       '学校独立申请',
};

// 通用 ED/EA/RD 时间轴（学校独立数据为 Phase 3 补充）
const DEFAULT_TIMELINE = [
  { phase: 'ED', date: '11月1日',  desc: '提前决定截止（ED）· 录取率通常最高' },
  { phase: 'EA', date: '11月1日',  desc: '提前行动截止（EA）· 无约束力，建议考虑' },
  { phase: 'RD', date: '1月1日',   desc: '常规轮截止（RD）· 大多数学校采用' },
  { phase: '录取结果', date: '3–4月', desc: '放榜 · Waitlist 持续到5月' },
  { phase: '5月1日', date: '5月1日', desc: '最终确认截止 · National Decision Day' },
];

Page({
  data: {
    // ── 步骤状态 ──
    step: 'input',   // 'input' | 'preview' | 'unlocked'

    // ── 用户输入 ──
    satBand:    '',
    gpaBand:    '',
    majorLabel: '',
    budgetBand: '',
    satBands: [
      { label: '<1200',     value: 'low'      },
      { label: '1200-1350', value: 'mid_low'  },
      { label: '1350-1450', value: 'mid'      },
      { label: '1450-1550', value: 'mid_high' },
      { label: '1550+',     value: 'high'     },
    ],
    gpaBands: [
      { label: '<3.0',    value: 'low'  },
      { label: '3.0-3.4', value: 'mid' },
      { label: '3.4-3.7', value: 'good'},
      { label: '3.7+',    value: 'high'},
    ],
    majorBands: [
      { label: '计算机/数据',   value: 'CS & Data'         },
      { label: '商科/金融',     value: '商科 & Finance'    },
      { label: '工程',          value: '工程类'            },
      { label: '理科/生物',     value: '理科 & 生物'       },
      { label: '人文/社科',     value: '人文 & 社科'       },
      { label: '艺术/设计',     value: '艺术 & 设计'       },
    ],
    budgetBands: [
      { label: '¥200万内/4年',  value: 'budget'   },
      { label: '¥200-300万/4年',value: 'mid'      },
      { label: '¥300万+/4年',   value: 'premium'  },
    ],

    // ── 收藏学校 ──
    favSchools: [],   // 收藏的学校（从 storage 读取 + API/profile 补充）
    favCount: 0,

    // ── P6 职业愿景上下文 ──
    careerPathData: null,   // { id, icon, label, tagline, cipCodes, stemOpt, usStayRate }

    // ── 报告内容 ──
    report: null,     // 生成完成后填充

    // ── 支付状态 ──
    payLoading: false,
    reportPrice: '¥199',

    // ── 报告模块预告（避免 WXML 内联对象数组编译问题）──
    reportModules: [
      { icon: '🧭', title: '职业愿景锚点',   desc: '你的目标路径 · 美国就业前景' },
      { icon: '👤', title: '个人画像摘要',   desc: 'GPA/SAT/专业/预算 一页纸' },
      { icon: '📊', title: '学校对比 + 项目层级', desc: 'QS排名 · PROGRAM_RANKINGS · CNY费用' },
      { icon: '💰', title: '4年ROI分析',     desc: '含学费+生活费 · 回本年数估算' },
      { icon: '💼', title: '就业出路指标',   desc: 'STEM OPT延签资格 · 主要就业方向' },
      { icon: '📅', title: '申请时间轴',     desc: 'ED/EA/RD 截止日期 · 不错过任何节点' },
    ],
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '选校分析报告' });
    this._loadFavSchools();
    this._loadCareerPath();
    // 如果已有测评数据，预填基本信息
    const assessment = wx.getStorageSync('assessmentData');
    if (assessment) {
      const satBand = this._estimateSatBand(assessment);
      const gpaBand = this._estimateGpaBand(assessment);
      this.setData({ satBand, gpaBand });
    }
  },

  // P6: 加载当前选定的职业路径（用于丰富报告内容）
  _loadCareerPath() {
    const clusterId = wx.getStorageSync('selectedCareerPath') || '';
    if (!clusterId || !CAREER_VISIONS) return;
    const cluster = CAREER_VISIONS.find(c => c.id === clusterId);
    if (!cluster) return;
    this.setData({
      careerPathData: {
        id:         cluster.id,
        icon:       cluster.icon,
        label:      cluster.label,
        tagline:    cluster.tagline,
        cipCodes:   cluster.cipCodes || [],
        stemOpt:    cluster.stemOpt,
        usStayRate: cluster.usStayRate,
        usPath:     cluster.usPath || '',
        programPercentageKeys: cluster.programPercentageKeys || [],
      },
    });
    // 如果用户还没选专业方向，自动预填
    if (!this.data.majorLabel && cluster.programPercentageKeys && cluster.programPercentageKeys.length > 0) {
      this.setData({ majorLabel: cluster.programPercentageKeys[0] });
    }
  },

  _loadFavSchools() {
    const favIds = wx.getStorageSync('favSchoolIds') || [];
    // 从 USA_SCHOOL_PROFILES 中尽量补充信息
    const schools = favIds.map(id => {
      const sp = getUSProfile(id);
      return {
        id,
        name: sp ? id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : id,
        profile: sp,
      };
    });
    this.setData({ favSchools: schools, favCount: schools.length });
  },

  _estimateSatBand(assessment) {
    const sat = assessment.sat || 0;
    if (sat >= 1550) return 'high';
    if (sat >= 1450) return 'mid_high';
    if (sat >= 1350) return 'mid';
    if (sat >= 1200) return 'mid_low';
    return 'low';
  },

  _estimateGpaBand(assessment) {
    const gpa = assessment.gpa || 0;
    if (gpa >= 3.7) return 'high';
    if (gpa >= 3.4) return 'good';
    if (gpa >= 3.0) return 'mid';
    return 'low';
  },

  // ── 输入选择处理 ──────────────────────────────────────────

  onSatBand(e)    { this.setData({ satBand: e.currentTarget.dataset.value }); },
  onGpaBand(e)    { this.setData({ gpaBand: e.currentTarget.dataset.value }); },
  onMajorBand(e)  { this.setData({ majorLabel: e.currentTarget.dataset.value }); },
  onBudgetBand(e) { this.setData({ budgetBand: e.currentTarget.dataset.value }); },

  // ── 生成预览（未付费，仅显示前两个模块）─────────────────────

  generatePreview() {
    const { satBand, gpaBand, majorLabel, budgetBand } = this.data;
    if (!satBand || !gpaBand) {
      wx.showToast({ title: '请先选择 SAT 和 GPA', icon: 'none' });
      return;
    }
    const report = this._buildReport();
    this.setData({ report, step: 'preview' });
  },

  // ── 解锁完整报告（付费流程，当前为模拟）──────────────────────

  unlockReport() {
    // TODO Phase 2 正式版：接入 wx.requestPayment
    // 当前：模拟支付延迟后解锁
    this.setData({ payLoading: true });
    setTimeout(() => {
      this.setData({ payLoading: false, step: 'unlocked' });
      wx.showToast({ title: '报告已解锁！', icon: 'success', duration: 1500 });
    }, 1500);
  },

  // ── 核心：构建报告数据 ────────────────────────────────────────

  _buildReport() {
    const { satBand, gpaBand, majorLabel, budgetBand, favSchools, careerPathData } = this.data;
    const userSAT = SAT_MID[satBand] || 0;
    const userGPA = GPA_MID[gpaBand] || 0;

    // M0: 职业愿景锚点（如已选定职业路径）
    const m0 = careerPathData ? {
      icon:       careerPathData.icon,
      label:      careerPathData.label,
      tagline:    careerPathData.tagline,
      stemOpt:    careerPathData.stemOpt,
      usStayRate: careerPathData.usStayRate,
      usPath:     careerPathData.usPath,
    } : null;

    // M1: 个人画像摘要
    const m1 = {
      satLabel:    this.data.satBands.find(b => b.value === satBand)?.label || '未填写',
      gpaLabel:    this.data.gpaBands.find(b => b.value === gpaBand)?.label || '未填写',
      majorLabel:  majorLabel || (careerPathData ? careerPathData.label : '未选择'),
      budgetLabel: this.data.budgetBands.find(b => b.value === budgetBand)?.label || '未选择',
      careerLabel: careerPathData ? careerPathData.label : '',
    };

    // M2 + M3 + M4: 学校对比（基于收藏）
    const BUDGET_USD = { budget: 50000, mid: 62500, premium: 80000 };
    const annualBudgetUSD = BUDGET_USD[budgetBand] || 55000;

    const schools = favSchools.map((s, idx) => {
      const sp = s.profile;
      const qsRankFmt = sp && sp.qs ? `QS #${sp.qs}` : '未排名';
      const applyLabel = sp && sp.apply ? (APPLY_PORTAL_LABELS[sp.apply] || sp.apply) : '—';
      const stemOpt = sp ? sp.stemOpt : false;
      const careerTags = sp && sp.career ? sp.career.slice(0, 3) : [];
      const cnNote = sp ? sp.cn : '';

      // 适配度
      let fitLabel = '—', fitColor = '#86868B';
      if (sp && sp.qs) {
        const qs = sp.qs;
        const satThreshold = qs < 20 ? 1520 : qs < 50 ? 1480 : qs < 100 ? 1400 : 1300;
        const gap = userSAT - satThreshold;
        if (gap > 50) { fitLabel = '✓ Safety'; fitColor = '#34C759'; }
        else if (gap > -80) { fitLabel = '~ Target'; fitColor = '#0071E3'; }
        else { fitLabel = '↑ Reach'; fitColor = '#FF9500'; }
      }

      // P6: 专业层级（PROGRAM_RANKINGS）
      let programTierLabel = '';
      if (careerPathData && getProgramTier) {
        const tier = getProgramTier(s.name || s.id, careerPathData.programPercentageKeys[0] || '');
        if (tier) programTierLabel = tier.label;
      }

      // P6: ROI 估算（4年总成本 vs 预期年薪 × 10年净现值简化）
      let roiNote = '';
      if (budgetBand) {
        const cost4yr = annualBudgetUSD * 4;
        // 粗略参考：tech_startup 等高薪专业 $85k起，商科 $65k，其他 $55k
        const estSalary = careerPathData
          ? (['tech_startup','quant_finance'].includes(careerPathData.id) ? 85000
             : careerPathData.id === 'consulting_management' ? 70000 : 60000)
          : 60000;
        const payback = cost4yr / estSalary; // 简化回本年数
        roiNote = payback < 3.5 ? '优 (<3.5年回本)' : payback < 5 ? '良 (3-5年)' : '一般 (5+年)';
      }

      // P6: 学校特定截止日期
      const schoolDeadlines = sp ? getUSDeadlines(s.id) : null;
      const edDate = schoolDeadlines?.ed?.deadline || 'Nov 1';
      const rdDate = schoolDeadlines?.rd?.deadline || 'Jan 1';

      return {
        idx: idx + 1,
        id: s.id,
        nameDisplay: s.name,
        qsRankFmt,
        applyLabel,
        stemOpt,
        careerTags,
        cnNote,
        fitLabel,
        fitColor,
        ps: sp ? sp.ps : '',
        programTierLabel,
        roiNote,
        edDate,
        rdDate,
      };
    });

    // P6: 预算ROI总结
    const budgetRoi = schools.length > 0 ? {
      annualBudgetFmt: annualBudgetUSD >= 70000 ? '$70k+/年' : '$' + Math.round(annualBudgetUSD/1000) + 'k/年',
      total4yrFmt: '¥' + Math.round(annualBudgetUSD * 4 * 7.25 / 10000) + '万',
      careerLabel: careerPathData ? careerPathData.label : majorLabel || '',
    } : null;

    // M5: 申请时间轴（优先使用学校特定截止日期，否则用通用版）
    const timeline = DEFAULT_TIMELINE;

    return { m0, m1, schools, timeline, budgetRoi, generatedAt: this._now() };
  },

  _now() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}年${pad(d.getMonth()+1)}月${pad(d.getDate())}日`;
  },

  // ── 跳转 ──────────────────────────────────────────────────

  goSchools() {
    // P6: 如有职业路径，跳转时携带专业模式参数
    const { careerPathData } = this.data;
    if (careerPathData && careerPathData.cipCodes && careerPathData.cipCodes.length > 0) {
      const cipParam = careerPathData.cipCodes.join(',');
      wx.navigateTo({
        url: `/pages/schools/schools?programMode=1&cipCodes=${cipParam}&clusterId=${careerPathData.id}&clusterLabel=${encodeURIComponent(careerPathData.label)}`,
      });
      return;
    }
    wx.navigateTo({ url: '/pages/schools/schools' });
  },

  goCareerVision() {
    const { careerPathData } = this.data;
    if (careerPathData) {
      wx.navigateTo({ url: `/pages/career-vision/career-vision?id=${careerPathData.id}` });
    } else {
      wx.navigateBack();
    }
  },

  goAssessment() {
    wx.navigateTo({ url: '/pages/questionnaire/questionnaire' });
  },

  shareReport() {
    wx.showToast({ title: '功能开发中', icon: 'none' });
  },

  goBack() { wx.navigateBack(); },
});
