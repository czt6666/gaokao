// pages/result/result.js — 袁希™ 成长战略报告 v2
const { generateReport } = require('../../utils/report_engine');
const Scorer = require('../../utils/persona_scorer');
const { matchSchools } = require('../../utils/matcher');
const { runMatch, extractProfileFromAssessment, buildCareerVisions } = require('../../utils/study_abroad_engine');

Page({
  data: {
    status: 'loading',   // loading | done | error
    loadingDots: '',
    report: null,
    expandedSection: 'path',   // 默认展开路径建议
    aiInsight: null,           // AI深度分析结果（异步注入）
    aiInsightLoading: false,   // AI分析加载中
    aiPlanText: '',            // LLM完整战略规划文案（宪法验证后）
    showFullPlan: false,       // 是否展开完整AI规划
    shareCardPath: null,       // 分享卡片临时路径
    showPosterModal: false,    // 是否显示海报预览弹层
    schoolRecs: null,          // 院校推荐（三层：冲刺/目标/稳妥）
    _docId: null,              // 云数据库文档ID（用于行为追踪回写）
    _behavior: {               // 行为追踪
      ctaTapped: false,
      shareGenerated: false,
      aiChatStarted: false,
      retakeCount: 0,
    },
    _openTimestamp: null,      // 当次进入时间戳（用于计算停留时长）
    _visitCount: 0,            // 累计访问次数
    // ── Student 问卷数据 ──────────────────────────────────────────
    studentSelfDone: false,    // 孩子是否已完成学生问卷
    studentDivergence: null,   // 差异检测结果
    // ── LLM 院校智能推荐 ──────────────────────────────────────────
    aiSchoolRecs: null,        // LLM 生成的个性化院校推荐数组
    aiSchoolRecsLoading: true, // 加载中状态
    // ── 全量智能报告（每章节都有具体理由的真正智能报告）───────────
    aiFullReport: null,        // reportFullGenerate 返回的完整智能内容
    aiFullReportLoading: true, // 加载状态
    // ── 调试：重新生成状态栏 ──────────────────────────────────────
    regenStatus: '',           // 最近一次重新生成的结果状态文字
    regenTs: '',               // 最近一次重新生成的时间戳
    // ── 美国大学智能匹配（College Scorecard 实时数据）────────────
    studyAbroadResult: null,   // 匹配结果：{ reach[], target[], safety[], meta{} }
    studyAbroadLoading: false, // 是否正在查询 API
    studyAbroadError: null,    // 错误信息（网络失败等）
    // ── 职业愿景（Career Vision）————————————————————————————————
    careerVisions: null,       // top 2-3 职业集群，由 buildCareerVisions() 生成
    careerVisionsLoading: false,
  },

  onLoad() {
    this._startDotAnimation();
    const stored = wx.getStorageSync('assessmentData');
    if (stored) {
      this._renderFromData(stored, true /* saveToCloud */);
    } else {
      // 本地存储丢失 → 静默从云端恢复
      this._recoverFromCloud();
    }
  },

  // ── 渲染报告（本地数据 or 云端恢复数据均走此路径）──────────────
  _renderFromData(stored, saveToCloud) {
    try {
      const report = generateReport(stored);
      // 更新 reportData（保留 summary 字段以便首页使用）
      const existingReportData = wx.getStorageSync('reportData') || {};
      wx.setStorageSync('reportData', {
        ...existingReportData,
        childName: stored.answers?.childName || report.meta?.childName || '孩子',
        summary:   existingReportData.summary || report.pathRecommendation?.primaryLabel || '报告已生成',
      });
      // ── 读取LLM完整规划文案（由ai-chat.js的_onAnalysisComplete写入）──
      const reportData = wx.getStorageSync('reportData') || {};
      const aiPlanText = reportData.aiAnalysisText || '';

      if (this._dotTimer) clearInterval(this._dotTimer);
      this.setData({ status: 'done', report, aiPlanText });
      Scorer.record && Scorer.record('assessment_completed');

      // ── 院校推荐（客观三层匹配）──────────────────────────────
      const stageMap = { primary: 'primary', middle: 'middle', junior_high: 'middle',
                         high: 'high', senior_high: 'high' };
      const storedForMatch = {
        ...stored,
        currentGrade: stageMap[stored.answers?.schoolStage] || stored.answers?.schoolStage || '',
        passportType: 'cn',
      };
      try {
        const schoolResult = matchSchools(storedForMatch);
        const tiered = schoolResult.tiered;
        if (tiered && (tiered.reach.length + tiered.match.length + tiered.safety.length > 0)) {
          this.setData({ schoolRecs: tiered });
        }
      } catch (e) {
        console.warn('[matchSchools]', e);
      }

      // ── 首次完成评估才保存到云数据库，云端恢复的数据不重复保存 ──
      if (saveToCloud) {
        this._saveToCloud(stored, report);
      }
      // ── 异步调用AI深度分析（有家长数据才触发）──
      if (stored.parentAnswers && Object.keys(stored.parentAnswers).length >= 3) {
        this._enrichWithAI(stored, report);
      }
      // ── 异步调用LLM报告文字增强（总是触发，替换规则生成的硬编码文字）──
      this._enrichReportText(stored, report);
      // ── 异步调用LLM院校智能推荐（补充静态库不足，真正个性化）────
      this._llmSchoolRec(stored, report);
      // ── 异步调用完整智能报告生成（核心升级：每章节有具体理由）────
      this._generateIntelligentReport(stored, report);
      // ── 职业愿景匹配（Career Vision，始终触发）──────────────────
      this._buildCareerVisions(stored);

      // ── 自动触发美国大学匹配 ──────────────────────────────────
      this._autoStudyAbroadMatch(stored);

      // ── 加载学生问卷数据（如孩子已填过）──────────────────────────
      this._loadStudentData();
    } catch (e) {
      console.error('report_engine error', e);
      if (this._dotTimer) clearInterval(this._dotTimer);
      this.setData({ status: 'error' });
    }
  },

  // ── 云端恢复：本地存储丢失时调用 ────────────────────────────────
  _recoverFromCloud() {
    wx.cloud.callFunction({
      name: 'saveAssessment', data: { mode: 'getLatest' },
      success: (res) => {
        const r = res.result;
        if (!r || !r.found) {
          if (this._dotTimer) clearInterval(this._dotTimer);
          this.setData({ status: 'error' });
          return;
        }
        // 重建 assessmentData 并写回本地存储
        const recovered = {
          answers:      r.answers      || {},
          miScores:     r.miScores     || {},
          mindsetScore: r.mindsetScore || 3,
          parentAnswers:r.parentAnswers|| {},
          source:       'cloud_recovery',
        };
        wx.setStorageSync('assessmentData', recovered);
        wx.setStorageSync('lastAssessmentDocId', r.docId);
        if (r.answers?.childName) {
          wx.setStorageSync('lastChildName', r.answers.childName);
        }
        // 恢复数据不重复写云端（saveToCloud=false）
        this._renderFromData(recovered, false);
      },
      fail: () => {
        if (this._dotTimer) clearInterval(this._dotTimer);
        this.setData({ status: 'error' });
      },
    });
  },

  onShow() {
    // ── 记录本次进入时间（用于计算停留时长）──
    this.setData({ _openTimestamp: Date.now() });
    if (this.data.status !== 'done') return;

    // ── 访问次数统计 ──────────────────────────────────────────
    const visitHistory = wx.getStorageSync('reportVisitHistory') || [];
    visitHistory.push(Date.now());
    wx.setStorageSync('reportVisitHistory', visitHistory);
    const visitCount = visitHistory.length;
    this.setData({ _visitCount: visitCount });

    // 第2次以上访问才回写（第1次已在 _saveToCloud 里初始化）
    if (visitCount >= 2) {
      const docId = this.data._docId || wx.getStorageSync('lastAssessmentDocId');
      if (docId) {
        // 计算距上次访问的间隔（天数）
        const prev = visitHistory[visitHistory.length - 2];
        const gapHours = Math.round((Date.now() - prev) / (1000 * 60 * 60));
        this._pushBehavior({ visitCount, visitGapHours: gapHours });
      }
    }
    // ── 从学生问卷页返回时刷新学生数据 ───────────────────────────
    this._loadStudentData();
  },

  onHide() { this._recordReadDuration(); },
  onUnload() {
    // ① 记录阅读时长（行为追踪）
    this._recordReadDuration();
    // ② 清理动画定时器
    if (this._dotTimer) clearInterval(this._dotTimer);
  },

  // ── 计算并回写报告停留时长 ──────────────────────────────────
  _recordReadDuration() {
    const openTime = this.data._openTimestamp;
    if (!openTime || this.data.status !== 'done') return;

    const duration = Math.floor((Date.now() - openTime) / 1000); // 秒
    this.setData({ _openTimestamp: null });
    if (duration < 5) return; // 太短不计入（防止误触）

    // 三档分类
    const tier = duration < 60  ? 'shallow'  // 浅读  <1分钟
               : duration < 300 ? 'moderate' // 细读  1-5分钟
               :                  'deep';    // 深度  >5分钟
    const tierLabel = { shallow: '浅读(<1分钟)', moderate: '细读(1-5分钟)', deep: '深度阅读(>5分钟)' }[tier];

    // 取历史最长阅读时长（代表"最认真的那次"）
    const prevMax = wx.getStorageSync('reportMaxReadDuration') || 0;
    const maxDuration = Math.max(prevMax, duration);
    wx.setStorageSync('reportMaxReadDuration', maxDuration);

    const docId = this.data._docId || wx.getStorageSync('lastAssessmentDocId');
    if (docId) {
      this._pushBehavior({ readDuration: maxDuration, readTier: tier, readTierLabel: tierLabel });
    }
  },

  // ── 统一行为事件推送到云端（无需管理员验证码）──────────────
  _pushBehavior(behaviorUpdate) {
    const docId = this.data._docId || wx.getStorageSync('lastAssessmentDocId');
    if (!docId) return;
    wx.cloud.callFunction({
      name: 'updateAssessmentNote',
      data: { docId, behaviorUpdate },
      fail: () => {},
    });
  },

  // ── 云端保存：异步将完整评估数据持久化到数据库 ──────────────
  _saveToCloud(assessmentData, report) {
    wx.cloud.callFunction({
      name: 'saveAssessment',
      data: {
        data: {
          answers:      assessmentData.answers      || {},
          miScores:     assessmentData.miScores     || {},
          mindsetScore: assessmentData.mindsetScore || 3,
          parentAnswers:assessmentData.parentAnswers|| {},
          aiInsight:    null,   // AI洞察异步生成，后续通过 _updateCloudWithAI 回写
          report,
          behavior:     this.data._behavior,
          // ── 自学习引擎数据：每道开放题的回答质量日志 ──────────────
          // 供 adminAnalytics 云函数聚合，驱动灵魂进化
          qualityLog:   assessmentData.qualityLog   || [],
        },
      },
      success: (res) => {
        if (res.result?.success && res.result.docId) {
          // 保存文档ID，供后续行为追踪回写使用
          this.setData({ _docId: res.result.docId });
          wx.setStorageSync('lastAssessmentDocId', res.result.docId);
          console.log('[saveAssessment] saved:', res.result.docId);
        }
      },
      fail: (err) => {
        // 保存失败不影响用户体验，静默处理
        console.warn('[saveAssessment] failed (silent):', err);
      },
    });
  },

  // ── 行为事件回写到云数据库 ──────────────────────────────────
  _trackBehavior(event) {
    const behavior = { ...this.data._behavior };
    if (event === 'cta')   behavior.ctaTapped = true;
    if (event === 'share') behavior.shareGenerated = true;
    if (event === 'chat')  behavior.aiChatStarted = true;
    this.setData({ _behavior: behavior });
    // 复用统一推送
    const flagMap = { cta: 'ctaTapped', share: 'shareGenerated', chat: 'aiChatStarted' };
    if (flagMap[event]) this._pushBehavior({ [flagMap[event]]: true });
  },

  // ── AI洞察生成后，回写到云数据库 ──────────────────────────
  _updateCloudWithAI(insight) {
    const docId = this.data._docId;
    if (!docId || !insight) return;
    wx.cloud.callFunction({
      name: 'updateAssessmentNote',
      data: {
        adminCode: 'wangzi@YX2024',
        docId,
        aiInsight: {
          parentingStyle:    insight.parentingStyle    || null,
          commQuality:       insight.commQuality       || null,
          keyQuote:          insight.keyQuote          || null,
          valueConsensus:    insight.valueConsensus    || null,
          blindspot:         insight.blindspot         || null,
          strengthSignal:    insight.strengthSignal    || null,
          riskSignal:        insight.riskSignal        || null,
          yuanxiPerspective: insight.yuanxiPerspective || null,
        },
      },
      fail: () => {},
    });
  },

  // ── AI增强：异步调用云函数，将袁希深度洞察注入报告 ──
  _enrichWithAI(assessmentData, report) {
    this.setData({ aiInsightLoading: true });
    const meta = report.meta || {};
    const pathRec = report.pathRecommendation || {};
    wx.cloud.callFunction({
      name: 'aiAnalysis',
      data: {
        mode: 'reportAnalysis',
        data: {
          childName:     meta.childName    || assessmentData.childName || '孩子',
          childAge:      meta.childAge     || assessmentData.childAge  || '',
          schoolStage:   meta.schoolStage  || assessmentData.schoolStage || '',
          miScores:      assessmentData.miScores || {},
          mindsetScore:  assessmentData.mindsetScore || 3,
          pathPreference: assessmentData.answers?.education_path_preference || pathRec.pathKey || '',
          parentAnswers: assessmentData.parentAnswers || {},
        },
      },
      success: (res) => {
        if (res.result && res.result.success && res.result.insight) {
          const insight = res.result.insight;
          // 将AI洞察注入到家庭画像中
          const report = this.data.report;
          if (report && report.familyPortrait) {
            report.familyPortrait.aiInsight = insight;
            if (insight.keyQuote) report.familyPortrait.keyQuotes = report.familyPortrait.keyQuotes || {};
          }
          this.setData({ aiInsight: insight, aiInsightLoading: false, report });
          // 保存增强后的报告
          const savedReport = wx.getStorageSync('reportData') || {};
          wx.setStorageSync('reportData', { ...savedReport, aiInsight: insight });
          // 回写AI洞察到云数据库
          this._updateCloudWithAI(insight);
        } else {
          this.setData({ aiInsightLoading: false });
        }
      },
      fail: (err) => {
        console.warn('AI分析云函数调用失败（降级运行）', err);
        this.setData({ aiInsightLoading: false });
      },
    });
  },

  // ── LLM报告文字增强：用真实答案替换硬编码evidence/rationale/actions ──
  // 不影响数值评分；只替换展示用的文字说明
  _enrichReportText(assessmentData, report) {
    const compat   = report.compatibility || {};
    const pathRec  = report.pathRecommendation || {};
    const meta     = report.meta || {};

    // 整理传给cloud function的数据
    const dimensions = (compat.dimensions || []).map(d => ({
      id: d.id, label: d.label, score: d.score, level: d.level,
    }));

    wx.cloud.callFunction({
      name: 'aiAnalysis',
      data: {
        mode: 'reportEnrich',
        data: {
          childName:    meta.childName    || assessmentData.answers?.childName || '孩子',
          schoolStage:  meta.schoolStage  || '',
          overallScore: compat.overall    || 50,
          pathKey:      pathRec.pathKey   || '',
          dimensions,
          miScores:     assessmentData.miScores     || {},
          parentAnswers: assessmentData.parentAnswers || {},
        },
      },
      success: (res) => {
        if (!res.result || !res.result.success || !res.result.enriched) return;
        const e = res.result.enriched;

        // 深拷贝report并注入LLM文字
        const updatedReport = this.data.report;
        if (!updatedReport) return;

        // 注入evidence（覆盖rule-based文字）
        if (e.evidence && updatedReport.compatibility && updatedReport.compatibility.evidence) {
          const ev = updatedReport.compatibility.evidence;
          if (e.evidence.resilience) ev.resilience = e.evidence.resilience;
          if (e.evidence.ability)    ev.ability    = e.evidence.ability;
          if (e.evidence.motivation) ev.motivation = e.evidence.motivation;
          if (e.evidence.family)     ev.family     = e.evidence.family;
        }

        // 注入rationale和risks
        if (e.rationale && Array.isArray(e.rationale) && updatedReport.pathRecommendation) {
          updatedReport.pathRecommendation.rationale = e.rationale.filter(Boolean);
        }
        if (e.risks && Array.isArray(e.risks) && updatedReport.pathRecommendation) {
          updatedReport.pathRecommendation.risks = e.risks.filter(Boolean);
        }

        // 注入actionHints（更新最弱维度对应行动的具体说明）
        if (e.actionHints && updatedReport.actions && updatedReport.actions.length > 0) {
          const hint = e.actionHints.pathSpecificHint;
          if (hint) {
            // 在第2个行动（路径导向行动）的 description 中追加具体提示
            updatedReport.actions[1] = {
              ...updatedReport.actions[1],
              description: hint + '\n\n' + (updatedReport.actions[1]?.description || ''),
            };
          }
        }

        this.setData({ report: updatedReport });
      },
      fail: (err) => {
        // 降级：保留report_engine原有文字，不影响页面显示
        console.warn('[reportEnrich] 降级运行:', err.errMsg || err);
      },
    });
  },

  // ── 全量智能报告生成：让每个章节都有针对该孩子的具体理由 ────────
  // 这是报告从"死"到"活"的核心升级：不再是规则模板，而是真正的AI洞察
  _generateIntelligentReport(stored, report) {
    this.setData({ aiFullReportLoading: true });

    const meta    = report.meta    || {};
    const pathRec = report.pathRecommendation || {};
    const compat  = report.compatibility || {};
    const answers = stored.answers || {};

    // 学术水平映射
    const acadMap = { top10: '优秀(前10%)', top30: '良好(前30%)', medium: '中等', below_medium: '中等偏下' };
    // 英语水平映射
    const engMap  = { fluent: '流利', conversational: '日常交流', basic: '基础', weak: '薄弱' };

    wx.cloud.callFunction({
      name: 'aiAnalysis',
      data: {
        mode: 'reportFullGenerate',
        data: {
          childName:      meta.childName    || stored.childName || '孩子',
          schoolStage:    meta.schoolStage  || answers.schoolStage || '',
          overallScore:   compat.overall    || 50,
          pathKey:        pathRec.pathKey   || answers.education_path_preference || 'hybrid',
          miScores:       stored.miScores   || {},
          mindsetScore:   stored.mindsetScore || 3,
          // 新增：职业/专业相关字段
          careerVision:   answers.career_vision    || '',
          observedSkills: answers.observed_skills  || '',
          talentSignals:  answers.talent_signals   || [],
          subjectInterest: answers.subject_interest || 'undecided',
          careerCluster:  answers.career_cluster   || 'open',
          // RIASEC 五轴（S5c1-S5c5）— 全量报告需要这些做专业推荐
          riasecPrimary:  answers.riasec_primary   || '',
          motivationType: answers.motivation_type  || '',
          envPreference:  answers.env_preference   || '',
          socialRole:     answers.social_role      || '',
          riskProfile:    answers.risk_profile     || '',
          // 学术与背景
          academicLevel:  acadMap[answers.academic_level] || answers.academic_level || '中等',
          englishLevel:   engMap[answers.english_level]   || answers.english_level  || '基础',
          budget:         answers.education_budget || answers.annual_budget || '未知',
          parentAnswers:  stored.parentAnswers || {},
        },
      },
      success: (res) => {
        if (!res.result || !res.result.success) {
          this.setData({ aiFullReportLoading: false });
          return;
        }
        const fullReport = res.result.fullReport;
        if (!fullReport) { this.setData({ aiFullReportLoading: false }); return; }

        // 将 openingInsight 注入到现有报告的 AI 规划文字区域
        // 如果原来没有 aiPlanText，就用这里的完整叙述
        const current = this.data;
        const updatedReport = current.report;
        if (!current.aiPlanText && fullReport.openingInsight && updatedReport) {
          // 构建丰富的AI规划文字（从全量报告拼接）
          const planParts = [
            fullReport.openingInsight || '',
            fullReport.giftNarrative  ? '\n\n【天赋解读】\n' + fullReport.giftNarrative  : '',
            fullReport.mindsetAnalysis? '\n\n【思维模式】\n' + fullReport.mindsetAnalysis : '',
            fullReport.pathReasoning  ? '\n\n【路径理由】\n' + fullReport.pathReasoning   : '',
            fullReport.yuanxiSignature? '\n\n' + fullReport.yuanxiSignature               : '',
          ].filter(Boolean).join('');
          if (planParts) this.setData({ aiPlanText: planParts });
        }

        // 把完整 fullReport 存入 data，供 WXML 渲染职业/专业推荐等新章节
        this.setData({ aiFullReport: fullReport, aiFullReportLoading: false });
      },
      fail: (err) => {
        console.warn('[reportFullGenerate] 降级:', err.errMsg || err);
        this.setData({ aiFullReportLoading: false });
      },
    });
  },

  // ── 动态省略号动画 ──
  _startDotAnimation() {
    let count = 0;
    this._dotTimer = setInterval(() => {
      count = (count + 1) % 4;
      this.setData({ loadingDots: '…'.repeat(count) || ' ' });
    }, 500);
  },

  // ── 展开/收起区块 ──
  toggleSection(e) {
    const sec = e.currentTarget.dataset.section;
    this.setData({ expandedSection: this.data.expandedSection === sec ? '' : sec });
  },

  // ── AI规划展开/收起 ──────────────────────────────────────────
  toggleAiPlan() {
    this.setData({ showFullPlan: !this.data.showFullPlan });
  },

  goSchools() { wx.navigateTo({ url: '/pages/schools/schools' }); },

  // ── 跳转到单所学校详情 ──
  goToSchool(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    Scorer.record && Scorer.record('school_rec_tapped');
    wx.navigateTo({ url: `/pages/school-detail/school-detail?id=${id}` });
  },

  // ── 查看全部推荐院校 ──
  goToAllSchools() {
    Scorer.record && Scorer.record('school_rec_view_all');
    wx.navigateTo({ url: '/pages/schools/schools' });
  },

  goConsult() {
    Scorer.record && Scorer.record('consult_cta_tapped');
    this._trackBehavior('cta');

    // 将报告摘要 + 痛点存储，供预约页使用
    const r = this.data.report;
    const stored = wx.getStorageSync('assessmentData') || {};
    if (r) {
      wx.setStorageSync('consultContext', {
        childName:    r.meta?.childName    || stored.childName || '',
        overallScore: r.compatibility?.overall || null,
        primaryPath:  r.pathRecommendation?.primaryLabel || '',
        // 用户在问卷末尾填写的痛点（q_pain_points 的答案）
        painPoints:   stored.consultPainPoints
                   || stored.parentAnswers?.pain_points
                   || '',
        timestamp: Date.now(),
      });
    }

    // 跳转到预约咨询页
    wx.navigateTo({ url: '/pages/booking/booking' });
  },

  // （第一定义已合并至下方详细版，此处删除）

  // ── 生成报告海报（全报告级，用于分享到朋友圈/转发）──────────
  generateShareCard() {
    Scorer.record && Scorer.record('share_card_tapped');
    this._trackBehavior('share');
    const r = this.data.report;
    if (!r) return;

    wx.showLoading({ title: '生成海报中…', mask: true });

    const meta    = r.meta    || {};
    const compat  = r.compatibility || {};
    const path    = r.pathRecommendation || {};
    const portrait = r.childPortrait || {};
    const dims    = compat.dimensions || [];

    const childName  = meta.childName  || '孩子';
    const score      = compat.overall  || 0;
    const scoreColor = compat.overallColor || '#C4A35A';
    const scoreLabel = compat.overallLabel || '';
    const pathLabel  = path.primaryLabel  || '';
    const pathIcon   = path.primaryIcon   || '🎯';
    const rationale  = (path.rationale   || [])[0] || '';
    const topMIs     = (portrait.topIntelligences || []).slice(0, 3);
    const MI_COLORS_POSTER = ['#C4A35A', '#0071E3', '#2A7A5A'];

    // 长图尺寸：375宽 × 1500高（约2.3屏，包含完整报告内容）
    const W = 375, H = 1500;

    const query = wx.createSelectorQuery();
    query.select('#shareCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) {
          wx.hideLoading();
          wx.showToast({ title: '画布初始化失败', icon: 'none' });
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio || 2;
        canvas.width  = W * dpr;
        canvas.height = H * dpr;
        ctx.scale(dpr, dpr);

        // ── Apple Light 令牌（海报复用）──────────────────────────
        const PT = {
          bg:     '#F5F5F7', card: '#FFFFFF',
          text1:  '#1D1D1F', text2: '#6E6E73', text3: '#AEAEB2',
          gold:   '#C4A35A',
          goldBg: 'rgba(196,163,90,0.07)',
          goldBrd:'rgba(196,163,90,0.22)',
          div:    'rgba(0,0,0,0.07)',
          barBg:  'rgba(0,0,0,0.07)',
          reach:  '#C75B2A', target: '#0071E3', safety: '#2A7A5A',
        };

        // ════════════════════════════════════════════════
        //  背景：Apple 浅灰
        // ════════════════════════════════════════════════
        ctx.fillStyle = PT.bg;
        ctx.fillRect(0, 0, W, H);
        // 顶部品牌金线
        ctx.fillStyle = PT.gold;
        ctx.fillRect(0, 0, W, 3);

        // ════════════════════════════════════════════════
        //  Section 1：品牌 Header
        // ════════════════════════════════════════════════
        ctx.textAlign = 'center';
        ctx.fillStyle = PT.gold;
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('袁希™', W / 2, 32);
        ctx.fillStyle = PT.text3;
        ctx.font = '400 11px sans-serif';
        ctx.fillText('多元智能  ·  成长战略报告', W / 2, 50);

        // ════════════════════════════════════════════════
        //  Section 2：孩子身份
        // ════════════════════════════════════════════════
        const avatarX = W / 2, avatarY = 100, avatarR = 36;
        ctx.beginPath();
        ctx.arc(avatarX, avatarY, avatarR, 0, Math.PI * 2);
        ctx.fillStyle = PT.card; ctx.fill();
        ctx.strokeStyle = PT.gold; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = PT.gold;
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(childName[0] || '子', avatarX, avatarY + 9);

        ctx.fillStyle = PT.text1;
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(childName + ' 的成长战略报告', W / 2, 152);
        ctx.fillStyle = PT.text2;
        ctx.font = '400 11px sans-serif';
        ctx.fillText((meta.schoolStage || '') + (meta.childAge ? '  ·  ' + meta.childAge + '岁' : ''), W / 2, 170);

        // ════════════════════════════════════════════════
        //  分割线
        // ════════════════════════════════════════════════
        ctx.strokeStyle = PT.div; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(40, 184); ctx.lineTo(W - 40, 184); ctx.stroke();

        // ════════════════════════════════════════════════
        //  Section 3：总分
        // ════════════════════════════════════════════════
        ctx.textAlign = 'center';
        ctx.font = 'bold 64px sans-serif';
        ctx.fillStyle = scoreColor || PT.gold;
        ctx.fillText(String(score), W / 2, 254);
        ctx.font = '400 12px sans-serif';
        ctx.fillStyle = PT.text2;
        ctx.fillText('综合适配度  ·  ' + scoreLabel, W / 2, 272);

        // ════════════════════════════════════════════════
        //  Section 4：四维评分（两列布局）
        // ════════════════════════════════════════════════
        const dimStartY = 292;
        const dimColW   = (W - 56) / 2;
        const dimLabels = dims.slice(0, 4);
        dimLabels.forEach((d, i) => {
          const col = i % 2, row = Math.floor(i / 2);
          const dx = 28 + col * (dimColW + 8);
          const dy = dimStartY + row * 44;
          const barW = dimColW - 4;
          const fillW = Math.round(barW * d.score / 100);

          ctx.textAlign = 'left';
          ctx.fillStyle = PT.text2;
          ctx.font = '400 11px sans-serif';
          ctx.fillText(d.label, dx, dy + 14);

          ctx.textAlign = 'right';
          ctx.fillStyle = d.levelColor || PT.gold;
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText(d.score + ' · ' + d.levelLabel, dx + barW, dy + 14);

          ctx.fillStyle = PT.barBg;
          _roundRect(ctx, dx, dy + 18, barW, 5, 3); ctx.fill();
          if (fillW > 0) {
            ctx.fillStyle = d.levelColor || PT.gold;
            _roundRect(ctx, dx, dy + 18, fillW, 5, 3); ctx.fill();
          }
        });

        // ════════════════════════════════════════════════
        //  Section 5：建议路径卡
        // ════════════════════════════════════════════════
        const pathY = 384;
        ctx.fillStyle = PT.goldBg;
        _roundRect(ctx, 28, pathY, W - 56, 52, 12); ctx.fill();
        ctx.strokeStyle = PT.goldBrd; ctx.lineWidth = 0.8;
        _roundRect(ctx, 28, pathY, W - 56, 52, 12); ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillStyle = PT.text3;
        ctx.font = '400 12px sans-serif';
        ctx.fillText('建议路径', 42, pathY + 17);
        ctx.fillStyle = PT.text1;
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText('→  ' + pathLabel, 42, pathY + 38);

        // ════════════════════════════════════════════════
        //  Section 6：核心判断
        // ════════════════════════════════════════════════
        if (rationale) {
          ctx.textAlign = 'left';
          ctx.fillStyle = PT.text3;
          ctx.font = '400 10px sans-serif';
          ctx.fillText('核心判断', 28, 462);
          ctx.fillStyle = PT.text2;
          ctx.font = '400 12px sans-serif';
          this._canvasWrapText(ctx, rationale, 28, 480, W - 56, 18, 'left');
        }

        // ════════════════════════════════════════════════
        //  Section 7：优势智能 Chips
        // ════════════════════════════════════════════════
        ctx.textAlign = 'left';
        ctx.fillStyle = PT.text3;
        ctx.font = '400 10px sans-serif';
        ctx.fillText('优势智能', 28, 530);

        let chipX = 28;
        topMIs.forEach((mi, i) => {
          const chipColor = MI_COLORS_POSTER[i] || '#6B7280';
          const chipW = ctx.measureText(mi.label).width + 22;
          ctx.fillStyle = chipColor + '1A';
          _roundRect(ctx, chipX, 538, chipW, 22, 11); ctx.fill();
          ctx.strokeStyle = chipColor + '44';
          ctx.lineWidth = 0.7;
          _roundRect(ctx, chipX, 538, chipW, 22, 11); ctx.stroke();
          ctx.fillStyle = chipColor;
          ctx.font = '500 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(mi.label, chipX + chipW / 2, 553);
          chipX += chipW + 8;
        });

        // ════════════════════════════════════════════════
        //  分割线
        // ════════════════════════════════════════════════
        ctx.strokeStyle = PT.div; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(28, 576); ctx.lineTo(W - 28, 576); ctx.stroke();

        // ════════════════════════════════════════════════
        //  Section 8：关键风险提示
        // ════════════════════════════════════════════════
        const risks = path.risks || [];
        let nextSectionY = 584;
        if (risks.length > 0) {
          ctx.textAlign = 'left';
          ctx.fillStyle = PT.text3;
          ctx.font = '400 10px sans-serif';
          ctx.fillText('需要关注', 28, 598);

          risks.slice(0, 3).forEach((risk, i) => {
            const ry = 612 + i * 34;
            ctx.fillStyle = 'rgba(199,91,42,0.07)';
            _roundRect(ctx, 28, ry - 14, W - 56, 28, 6); ctx.fill();
            ctx.strokeStyle = 'rgba(199,91,42,0.18)'; ctx.lineWidth = 0.5;
            _roundRect(ctx, 28, ry - 14, W - 56, 28, 6); ctx.stroke();
            ctx.fillStyle = PT.reach;
            ctx.font = '400 11px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('! ' + (risk.length > 38 ? risk.slice(0, 36) + '…' : risk), 38, ry + 3);
          });
          nextSectionY = 612 + risks.slice(0, 3).length * 34 + 20;

          ctx.strokeStyle = PT.div; ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(28, nextSectionY); ctx.lineTo(W - 28, nextSectionY); ctx.stroke();
          nextSectionY += 14;
        }

        // ════════════════════════════════════════════════
        //  Section 9：学校梯度推荐
        // ════════════════════════════════════════════════
        const schoolRecs = this.data.schoolRecs;
        const schoolReach  = (schoolRecs && (schoolRecs.reach  || []));
        const schoolTarget = (schoolRecs && (schoolRecs.target || schoolRecs.match || []));
        const schoolSafety = (schoolRecs && (schoolRecs.safety || []));
        const hasSchools   = schoolRecs && (
          (schoolReach?.length || 0) + (schoolTarget?.length || 0) + (schoolSafety?.length || 0) > 0
        );

        if (hasSchools) {
          ctx.textAlign = 'left';
          ctx.fillStyle = PT.text3;
          ctx.font = '400 10px sans-serif';
          ctx.fillText('院校参考梯度', 28, nextSectionY);
          nextSectionY += 16;

          const GRADE_CONFIGS = [
            { schools: schoolReach,  label: '冲刺', color: PT.reach  },
            { schools: schoolTarget, label: '目标', color: PT.target },
            { schools: schoolSafety, label: '稳妥', color: PT.safety },
          ];

          GRADE_CONFIGS.forEach(({ schools, label, color }) => {
            if (!schools || schools.length === 0) return;
            ctx.fillStyle = color;
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(label, 28, nextSectionY + 11);
            nextSectionY += 20;

            schools.slice(0, 3).forEach(s => {
              const schoolName = (s.name || s.schoolName || '').slice(0, 14);
              const acc = s.acceptance ? Math.round(s.acceptance * 100) + '%' : '';
              const qs  = s.qs_rank   ? 'QS #' + s.qs_rank : '';

              ctx.fillStyle = PT.card;
              _roundRect(ctx, 28, nextSectionY, W - 56, 32, 8); ctx.fill();
              ctx.strokeStyle = PT.div; ctx.lineWidth = 0.5;
              _roundRect(ctx, 28, nextSectionY, W - 56, 32, 8); ctx.stroke();

              ctx.fillStyle = PT.text1;
              ctx.font = '500 12px sans-serif';
              ctx.textAlign = 'left';
              ctx.fillText(schoolName, 40, nextSectionY + 20);

              ctx.fillStyle = PT.text2;
              ctx.font = '400 10px sans-serif';
              ctx.textAlign = 'right';
              ctx.fillText([qs, acc].filter(Boolean).join('  '), W - 40, nextSectionY + 20);

              nextSectionY += 38;
            });
            nextSectionY += 4;
          });

          ctx.strokeStyle = PT.div; ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(28, nextSectionY); ctx.lineTo(W - 28, nextSectionY); ctx.stroke();
          nextSectionY += 16;
        }

        // ════════════════════════════════════════════════
        //  Section 10：底部 Footer — QR码 + 小程序入口
        // ════════════════════════════════════════════════
        const footerY = Math.max(nextSectionY, H - 130);

        const qrImg = canvas.createImage();
        qrImg.onload = () => {
          const qrSize = 70;
          const qrX = 28, qrY = footerY;
          ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

          ctx.textAlign = 'left';
          const textX = qrX + qrSize + 16;
          ctx.fillStyle = PT.text3;
          ctx.font = '400 10px sans-serif';
          ctx.fillText('微信小程序', textX, qrY + 16);
          ctx.fillStyle = PT.gold;
          ctx.font = 'bold 18px sans-serif';
          ctx.fillText('「袁希」', textX, qrY + 36);
          ctx.fillStyle = PT.text2;
          ctx.font = '400 10px sans-serif';
          ctx.fillText('为孩子生成专属成长战略报告', textX, qrY + 52);
          ctx.fillStyle = PT.text3;
          ctx.font = '400 9px sans-serif';
          ctx.fillText('扫码或微信搜索「袁希」开始', textX, qrY + 68);

          // 底部金线
          ctx.fillStyle = PT.gold;
          ctx.fillRect(0, H - 3, W, 3);

          wx.hideLoading();
          wx.canvasToTempFilePath({
            canvas,
            success: (res) => {
              this.setData({ shareCardPath: res.tempFilePath, showPosterModal: true });
            },
            fail: (err) => {
              console.error('canvasToTempFilePath error', err);
              wx.showToast({ title: '生成失败，请重试', icon: 'none' });
            },
          });
        };
        qrImg.onerror = () => {
          ctx.fillStyle = PT.goldBg;
          _roundRect(ctx, 28, footerY, 70, 70, 8); ctx.fill();
          ctx.strokeStyle = PT.goldBrd; ctx.lineWidth = 0.8;
          _roundRect(ctx, 28, footerY, 70, 70, 8); ctx.stroke();
          ctx.fillStyle = PT.gold;
          ctx.font = '400 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('袁希™', 63, footerY + 39);

          ctx.textAlign = 'left';
          ctx.fillStyle = PT.gold;
          ctx.font = 'bold 18px sans-serif';
          ctx.fillText('微信搜索「袁希」', 110, footerY + 34);
          ctx.fillStyle = PT.text2;
          ctx.font = '400 11px sans-serif';
          ctx.fillText('获取孩子的专属成长报告', 110, footerY + 56);

          ctx.fillStyle = PT.gold;
          ctx.fillRect(0, H - 3, W, 3);

          wx.hideLoading();
          wx.canvasToTempFilePath({
            canvas,
            success: (res) => {
              this.setData({ shareCardPath: res.tempFilePath, showPosterModal: true });
            },
            fail: () => wx.showToast({ title: '生成失败，请重试', icon: 'none' }),
          });
        };
        qrImg.src = '/images/share-qrcode.png';
      });
  },

  // canvas文字换行辅助
  _canvasWrapText(ctx, text, x, y, maxWidth, lineHeight, align) {
    const chars = text.split('');
    let line = '';
    let lineY = y;
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.textAlign = align || 'left';
        ctx.fillText(line, x, lineY);
        line = chars[i];
        lineY += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, lineY);
  },

  saveShareCard() {
    if (!this.data.shareCardPath) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.shareCardPath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (err) => {
        if (err.errMsg?.includes('auth')) {
          wx.showModal({
            title: '需要授权', content: '请在设置中允许访问相册',
            confirmText: '去设置',
            success: r => { if (r.confirm) wx.openSetting(); },
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      },
    });
  },

  closeShareCard() {
    this.setData({ shareCardPath: null, showPosterModal: false });
  },

  // ── 复制完整文字报告到剪贴板 ────────────────────────────────
  copyReport() {
    const r = this.data.report;
    if (!r) return;

    const meta    = r.meta || {};
    const compat  = r.compatibility || {};
    const path    = r.pathRecommendation || {};
    const topMIs  = (r.childPortrait?.topIntelligences || []).slice(0, 3);
    const actions = r.actions || [];
    const insight = this.data.aiInsight;

    // ── 能力优势段落
    const miLines = topMIs.map((m, i) =>
      `${i + 1}. ${m.label}（${m.pct}%）— ${m.description || ''}`
    ).join('\n');

    // ── 路径依据段落
    const rationaleLines = (path.rationale || []).map(s => `· ${s}`).join('\n');

    // ── 三件事段落
    const actionLines = actions.map(a =>
      `${a.priority}. ${a.icon || ''}${a.title}（${a.timeframe}）\n   ${a.description}`
    ).join('\n');

    // ── 袁希洞察（如已加载）
    const insightSection = insight?.yuanxiPerspective
      ? `\n▌ 袁希洞察\n${insight.yuanxiPerspective}\n`
      : '';

    // ── 风险段落
    const riskLines = (path.risks || []).map(s => `! ${s}`).join('\n');

    const text = [
      `【袁希™ · 1% 成长路径】`,
      `${meta.childName || '孩子'} 的成长战略报告`,
      `${meta.schoolStage || ''} · ${meta.childAge || ''}岁 · 袁希方法论评估`,
      ``,
      `综合适配度：${compat.overall || '-'}分（${compat.overallLabel || ''}）`,
      `建议路径：${path.primaryIcon || ''} ${path.primaryLabel || ''} — ${path.confidenceLabel || ''}`,
      ``,
      `▌ 能力优势（前三维度）`,
      miLines,
      ``,
      `▌ 路径建议依据`,
      rationaleLines,
      riskLines ? `\n需要关注的风险：\n${riskLines}` : '',
      ``,
      `▌ 现在最重要的三件事`,
      actionLines,
      insightSection,
      `— 袁希™ · 1% 教育研究`,
    ].filter(s => s !== null && s !== undefined).join('\n');

    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '报告已复制，可粘贴分享', icon: 'success' }),
      fail: ()    => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
    });

    Scorer.record && Scorer.record('report_text_copied');
    this._trackBehavior('copy');
  },

  // ── 以下旧方法保留兼容性但不再主路径调用 ────────────────────

  // ── 本地报告生成（从原始 assessmentData 重建）──
  _localGenerateReport(data) {
    // miScores 可能是 0-1 归一化（来自旧格式 assessmentData）
    // 也可能是 1-5 原始分（来自新格式 reportData）
    // 统一转换到 1-5 区间供渲染
    const rawScores = {};
    Object.entries(data.miScores || data.multipleIntelligences || {}).forEach(([k, v]) => {
      rawScores[k] = v <= 1 ? Math.round(v * 5) : v;  // 0-1 → 1-5
    });

    const miList = Object.entries(rawScores)
      .map(([key, val]) => ({ key, val, label: MI_LABELS[key] || key }))
      .sort((a, b) => b.val - a.val);

    const topMI = miList.slice(0, 3);
    const topMINames = topMI.map(m => m.label).join('、');
    const ms = data.mindsetScore || 3;
    const childName = data.childName || '孩子';

    const report = {
      childName,
      childAge: data.childAge || '10–15岁',
      summary: data.aiAnalysisText ||
        `根据评估，${childName}在${topMINames}方面表现出较强的天赋倾向。` +
        `成长型思维得分 ${ms}/5，${ms >= 4 ? '展现出优秀的学习韧性' : ms >= 3 ? '思维模式发展中，有很大提升空间' : '建议重点培养成长型思维'}。`,
      miScores: rawScores,
      miList,
      mindsetScore: ms,
      answers: data.answers || {},
      topMI,
      educationPath: data.educationPath || this._suggestPath(data.answers || {}),
      generatedAt: Date.now(),
      isLocal: true,
    };

    wx.setStorageSync('reportData', report);
    this._renderReport(report);
  },

  // ── 根据答案推荐教育路径 ──
  _suggestPath(answers) {
    const { education_path_preference, goal_at_25, education_budget } = answers;
    if (education_path_preference && education_path_preference !== 'undecided') {
      return PATH_LABELS[education_path_preference] || '定制化路径';
    }
    // 根据目标推断
    if (goal_at_25 === 'career_overseas' || goal_at_25 === 'academia') return '国际路线';
    if (goal_at_25 === 'stable_china') return '国内精英路线';
    return '综合多元路线';
  },

  // ── AI输出六段式解析器 ──────────────────────────────────────────
  // 宪法2.5要求：推理路径/风险区间/变量敏感性/替代方案 必须可见
  // AI输出格式：**孩子能力结构** ... **袁希视角** ... 等6个段落
  _parseAIReport(text) {
    const SECTIONS = [
      { key: 'capability', title: '孩子能力结构', icon: '▲',  accentColor: '#0071E3', bgColor: 'rgba(0,113,227,0.07)' },
      { key: 'yuanxi',     title: '袁希视角',     icon: '✦',  accentColor: '#5B3A8B', bgColor: 'rgba(91,58,139,0.07)' },
      { key: 'mindset',    title: '思维模式分析', icon: '◆',  accentColor: '#2A7A5A', bgColor: 'rgba(42,122,90,0.07)' },
      { key: 'paths',      title: '路径参考方向', icon: '→',  accentColor: '#C4A35A', bgColor: 'rgba(196,163,90,0.07)' },
      { key: 'variables',  title: '关键变量提示', icon: '·',  accentColor: '#E67E22', bgColor: 'rgba(230,126,34,0.07)' },
      { key: 'blindspot',  title: '家长认知盲区', icon: '!',  accentColor: '#B03A2E', bgColor: 'rgba(176,58,46,0.07)' },
    ];

    const parsed = [];
    for (let i = 0; i < SECTIONS.length; i++) {
      const sec = SECTIONS[i];
      const startTag = `**${sec.title}**`;
      const startIdx = text.indexOf(startTag);
      if (startIdx === -1) continue;

      let endIdx = text.length;
      for (let j = i + 1; j < SECTIONS.length; j++) {
        const nextIdx = text.indexOf(`**${SECTIONS[j].title}**`, startIdx + startTag.length);
        if (nextIdx !== -1) { endIdx = nextIdx; break; }
      }

      const content = text.slice(startIdx + startTag.length, endIdx)
        .replace(/\*\*/g, '')   // 去掉子标题的**（AI可能在内容里用**加粗）
        .trim();
      if (content) parsed.push({ ...sec, content });
    }

    // 解析失败（旧格式/AI未按结构输出）→ 原始文本单卡降级
    if (parsed.length === 0) {
      return [{
        key: 'raw', title: '诊断摘要', icon: '📋',
        accentColor: '#6E6E73', bgColor: '#F5F5F7',
        content: text.replace(/\*\*/g, ''),
      }];
    }
    return parsed;
  },

  // ── 渲染报告数据到页面 ──
  _renderReport(report) {
    if (this._dotTimer) clearInterval(this._dotTimer);

    // 构建 MI 图表数据（百分比换算，满分5分 → 100%）
    const miChartData = (report.miList || Object.entries(report.miScores || {})
      .map(([key, val]) => ({ key, val, label: MI_LABELS[key] || key }))
      .sort((a, b) => b.val - a.val)
    ).map((item, index) => ({
      ...item,
      pct: Math.round((item.val / 5) * 100),
      color: MI_COLORS[index % MI_COLORS.length],
    }));

    // 思维得分等级（1-5分制）
    const ms = report.mindsetScore || 3;
    let mindsetLevel = '发展中';
    let mindsetColor = '#6B7280';
    if (ms >= 4)      { mindsetLevel = '成长型'; mindsetColor = '#2A7A5A'; }
    else if (ms >= 3) { mindsetLevel = '发展中'; mindsetColor = '#C49A22'; }
    else              { mindsetLevel = '固化型'; mindsetColor = '#B03A2E'; }

    // 解析 AI 结构化输出 → 六段式卡片数据
    const rawText = report.summary || report.aiAnalysisText || '';
    const reportSections = this._parseAIReport(rawText);

    // 数据版本标记（宪法4.3：可追溯模型版本）
    const dataVersionLabel = report.generatedAt
      ? new Date(report.generatedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' 生成'
      : '';
    const modelVersionLabel = report.isLocal ? '本地快速版' : 'DeepSeek v2 · 袁希方法论框架';

    this.setData({
      status: 'done',
      report,
      miChartData,
      mindsetScore: ms,
      mindsetLevel,
      mindsetColor,
      reportSections,
      dataVersionLabel,
      modelVersionLabel,
    });
  },

  // ── 标签切换 ──
  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  // ── 跳转学校库 ──
  goToSchools() {
    wx.navigateTo({ url: '/pages/schools/schools' });
  },

  // ── 重新生成AI报告（调试/测试专用，跳过评测直接重触发AI）───────────
  // 不需要重走评测：读取 assessmentData 本地缓存，重新调用两个云函数
  regenAIReport() {
    const stored = wx.getStorageSync('assessmentData');
    if (!stored) {
      wx.showToast({ title: '无本地评测数据', icon: 'error', duration: 2000 });
      return;
    }
    const report = this.data.report;
    if (!report) {
      wx.showToast({ title: '报告结构未就绪', icon: 'error', duration: 2000 });
      return;
    }

    // 清除上一次的监听器（防止多次点击时 interval 累积泄漏）
    if (this._regenCheckTimer) {
      clearInterval(this._regenCheckTimer);
      this._regenCheckTimer = null;
    }

    // 重置所有AI生成状态（包括 aiPlanText，否则顶部AI文字不会刷新）
    this.setData({
      aiFullReport: null,
      aiFullReportLoading: true,
      aiSchoolRecs: null,
      aiSchoolRecsLoading: true,
      aiPlanText: '',          // 必须清空，否则 _generateIntelligentReport 里的更新逻辑跳过
      regenStatus: '⏳ 正在调用AI…',
      regenTs: new Date().toLocaleTimeString(),
    });

    wx.showToast({ title: '重新生成中…', icon: 'loading', duration: 4000, mask: false });

    // 并发触发两个云函数
    this._generateIntelligentReport(stored, report);
    this._llmSchoolRec(stored, report);

    // 轮询直到两个 loading 均为 false
    this._regenCheckTimer = setInterval(() => {
      const { aiFullReportLoading, aiSchoolRecsLoading, aiFullReport, aiSchoolRecs } = this.data;
      if (!aiFullReportLoading && !aiSchoolRecsLoading) {
        clearInterval(this._regenCheckTimer);
        this._regenCheckTimer = null;

        const ok1 = !!aiFullReport;
        const ok2 = !!(aiSchoolRecs && aiSchoolRecs.length);

        const parts = [
          ok1 ? '✅ 专业推荐完毕' : '❌ 专业推荐失败',
          ok2 ? `✅ 院校推荐完毕（${(aiSchoolRecs||[]).length}所）` : '❌ 院校推荐失败',
        ];
        this.setData({ regenStatus: parts.join('  |  ') });

        const allOk = ok1 && ok2;
        wx.showToast({
          title: allOk ? '重新生成成功' : '部分失败，见状态栏',
          icon:  allOk ? 'success' : 'none',
          duration: 2500,
        });
      }
    }, 900);
  },

  // ── 一键查看完整报告（Jobs版：原生WXML渲染，无画布，完美排版）────
  exportFullReport() {
    const r         = this.data.report;
    const aiSchools = this.data.aiSchoolRecs || [];
    const aiPlanText = this.data.aiPlanText  || '';
    const usaResult = this.data.studyAbroadResult || null;
    if (!r) { wx.showToast({ title: '报告未加载', icon: 'none' }); return; }

    // 将数据挂载到 globalData（避免跨页面传大参数）
    const app = getApp();
    if (!app.globalData) app.globalData = {};
    app.globalData.pendingPrintData = { report: r, aiPlanText, aiSchools, usaResult };

    wx.navigateTo({ url: '/pages/printview/printview' });
  },

  // ── 保存长图（兜底 / 旧方案，由 printview 页面调用）───────────────
  exportLongImage() {
    const r         = this.data.report;
    const full      = this.data.aiFullReport;
    const aiSchools = this.data.aiSchoolRecs || [];
    const aiPlanText = this.data.aiPlanText  || '';
    const usaResult = this.data.studyAbroadResult || null;
    if (!r) { wx.showToast({ title: '报告未加载', icon: 'none' }); return; }

    const stillLoading = this.data.aiFullReportLoading
      || this.data.aiSchoolRecsLoading
      || this.data.studyAbroadLoading;
    if (stillLoading) {
      wx.showModal({
        title: '内容还在生成中',
        content: '部分内容尚未加载完毕，长图会有空白。建议稍等片刻。',
        confirmText: '等一等',
        cancelText: '强行导出',
        success: (res) => {
          if (!res.confirm) this._drawExportCanvas(r, full, aiSchools, aiPlanText, usaResult);
        },
      });
      return;
    }
    this._drawExportCanvas(r, full, aiSchools, aiPlanText, usaResult);
  },

  _drawExportCanvas(r, full, aiSchools, aiPlanText, usaResult) {
    wx.showLoading({ title: '正在生成报告长图…', mask: true });

    const meta     = r.meta               || {};
    const compat   = r.compatibility      || {};
    const pathRec  = r.pathRecommendation || {};
    const portrait = r.childPortrait      || {};
    const dims     = compat.dimensions    || [];
    const actions  = r.actions            || [];
    const childName  = meta.childName || '孩子';
    const score      = compat.overall || 0;
    const scoreColor = compat.overallColor || '#C4A35A';
    const W          = 750;
    // 8000px 足以容纳所有节；裁剪到真实 y 高度后导出
    const MAX_H      = 8000;

    const query = wx.createSelectorQuery();
    query.select('#exportCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0]) {
        wx.hideLoading();
        wx.showToast({ title: '画布初始化失败，请重试', icon: 'none' });
        return;
      }
      const canvas = res[0].node;
      const ctx    = canvas.getContext('2d');
      // DPR 最高2倍，避免内存溢出
      const dpr    = Math.min(wx.getSystemInfoSync().pixelRatio || 2, 2);
      canvas.width  = W    * dpr;
      canvas.height = MAX_H * dpr;
      ctx.scale(dpr, dpr);

      // ── 工具函数 ──────────────────────────────────────────────
      // 圆角矩形路径
      const rRect = (x, yy, w, h, r) => {
        ctx.beginPath();
        ctx.moveTo(x + r, yy);
        ctx.lineTo(x + w - r, yy); ctx.arcTo(x+w, yy,   x+w, yy+r,   r);
        ctx.lineTo(x + w, yy + h - r); ctx.arcTo(x+w, yy+h, x+w-r, yy+h, r);
        ctx.lineTo(x + r, yy + h); ctx.arcTo(x,   yy+h, x,   yy+h-r, r);
        ctx.lineTo(x,     yy + r); ctx.arcTo(x,   yy,   x+r, yy,     r);
        ctx.closePath();
      };

      // 自动换行文字，返回绘制结束的y坐标
      const wrapText = (text, x, startY, maxW, lineH, maxLines) => {
        if (!text) return startY;
        const chars = text.split('');
        let line = '', lineCount = 0, yy = startY;
        for (let i = 0; i < chars.length; i++) {
          const test = line + chars[i];
          if (ctx.measureText(test).width > maxW) {
            if (lineCount >= maxLines - 1) {
              ctx.fillText(line + (i < chars.length - 1 ? '…' : ''), x, yy);
              return yy + lineH;
            }
            ctx.fillText(line, x, yy);
            line = chars[i]; yy += lineH; lineCount++;
          } else { line = test; }
        }
        if (line) { ctx.fillText(line, x, yy); yy += lineH; }
        return yy;
      };

      // ── Apple Light 设计令牌 ───────────────────────────────────
      const T = {
        bg:      '#F5F5F7',             // 页面背景
        card:    '#FFFFFF',             // 卡片白
        text1:   '#1D1D1F',             // 主文字
        text2:   '#6E6E73',             // 次文字
        text3:   '#AEAEB2',             // 辅文字
        gold:    '#C4A35A',             // 品牌金
        goldBg:  'rgba(196,163,90,0.07)',
        goldBrd: 'rgba(196,163,90,0.22)',
        div:     'rgba(0,0,0,0.07)',    // 分割线
        cardBrd: 'rgba(0,0,0,0.08)',    // 卡片边框
        barBg:   'rgba(0,0,0,0.07)',    // 进度条底
        reach:   '#C75B2A',             // 冲刺红
        target:  '#0071E3',             // 目标蓝（Apple system blue）
        safety:  '#2A7A5A',             // 稳妥绿
      };

      // 分割线
      let y = 32;
      const divider = () => {
        ctx.strokeStyle = T.div; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(28, y); ctx.lineTo(W - 28, y); ctx.stroke();
        y += 32;
      };

      // 节标题：左侧金色竖条 + 深色文字
      const sectionTitle = (text) => {
        ctx.fillStyle = T.gold; ctx.fillRect(28, y, 3, 19);
        ctx.fillStyle = T.text1; ctx.font = '600 16px sans-serif';
        ctx.textAlign = 'left'; ctx.fillText(text, 38, y + 14); y += 38;
      };

      // ── 背景 ──────────────────────────────────────────────────
      ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, MAX_H);
      // 顶部品牌金线（3px）
      ctx.fillStyle = T.gold; ctx.fillRect(0, 0, W, 3);

      // ── 封面 ──────────────────────────────────────────────────
      ctx.textAlign = 'center';
      ctx.fillStyle = T.gold; ctx.font = 'bold 24px sans-serif';
      ctx.fillText('袁希™ 成长战略报告', W / 2, y + 30); y += 54;

      // 头像圆（金色描边，白底）
      ctx.beginPath(); ctx.arc(W / 2, y + 40, 38, 0, Math.PI * 2);
      ctx.fillStyle = T.card; ctx.fill();
      ctx.strokeStyle = T.gold; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = T.gold; ctx.font = 'bold 28px sans-serif';
      ctx.fillText(childName[0] || '子', W / 2, y + 50); y += 94;

      ctx.fillStyle = T.text1; ctx.font = 'bold 20px sans-serif';
      ctx.fillText(childName + ' 的成长战略报告', W / 2, y); y += 28;
      ctx.fillStyle = T.text2; ctx.font = '400 13px sans-serif';
      ctx.fillText((meta.schoolStage || '') + (meta.childAge ? '  ·  ' + meta.childAge + '岁' : ''), W / 2, y); y += 40;

      // 综合评分卡（白卡，金色描边）
      ctx.fillStyle = T.card; rRect(28, y, W - 56, 80, 14); ctx.fill();
      ctx.strokeStyle = T.goldBrd; ctx.lineWidth = 1; rRect(28, y, W - 56, 80, 14); ctx.stroke();
      ctx.fillStyle = scoreColor || T.gold; ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(score), W / 2, y + 50);
      ctx.fillStyle = T.text2; ctx.font = '400 12px sans-serif';
      ctx.fillText('综合适配度  ·  ' + (compat.overallLabel || ''), W / 2, y + 68); y += 94;

      // 建议路径行（金色浅底卡片）
      ctx.textAlign = 'left';
      ctx.fillStyle = T.goldBg; rRect(28, y, W - 56, 58, 12); ctx.fill();
      ctx.strokeStyle = T.goldBrd; ctx.lineWidth = 0.8; rRect(28, y, W - 56, 58, 12); ctx.stroke();
      ctx.fillStyle = T.text3; ctx.font = '400 12px sans-serif';
      ctx.fillText('建议路径', 44, y + 18);
      ctx.fillStyle = T.text1; ctx.font = 'bold 17px sans-serif';
      ctx.fillText('→  ' + (pathRec.primaryLabel || ''), 44, y + 42); y += 72;

      divider();

      // ── 四维适配性评分 ────────────────────────────────────────
      sectionTitle('四维适配性评分');
      dims.slice(0, 4).forEach(dim => {
        ctx.fillStyle = T.text2; ctx.font = '400 14px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(dim.label, 28, y + 16);
        ctx.fillStyle = dim.levelColor || T.gold; ctx.font = '600 13px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(dim.score + '分 · ' + dim.levelLabel, W - 28, y + 16);
        ctx.textAlign = 'left';
        ctx.fillStyle = T.barBg; rRect(28, y + 24, W - 56, 6, 3); ctx.fill();
        const fw = Math.round((W - 56) * Math.min(dim.score, 100) / 100);
        if (fw > 0) { ctx.fillStyle = dim.levelColor || T.gold; rRect(28, y + 24, fw, 6, 3); ctx.fill(); }
        y += 44;
      }); y += 10; divider();

      // ── 多元智能前三 ─────────────────────────────────────────
      sectionTitle('多元智能前三维度');
      const miColors = [T.gold, T.target, T.safety];
      const topMIs = (portrait.topIntelligences || []).slice(0, 3);
      topMIs.forEach((mi, i) => {
        ctx.fillStyle = miColors[i]; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText((i + 1) + '. ' + mi.label, 28, y + 17);
        ctx.fillStyle = T.text2; ctx.font = '400 13px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(mi.pct + '%', W - 28, y + 17); ctx.textAlign = 'left';
        ctx.fillStyle = T.barBg; rRect(28, y + 25, W - 56, 5, 2); ctx.fill();
        const mfw = Math.round((W - 56) * Math.min(mi.pct, 100) / 100);
        if (mfw > 0) { ctx.fillStyle = miColors[i]; rRect(28, y + 25, mfw, 5, 2); ctx.fill(); }
        y += 46;
      }); y += 10; divider();

      // ── 路径建议 rationale ────────────────────────────────────
      if (pathRec.primaryLabel) {
        sectionTitle('路径建议：' + (pathRec.primaryLabel || ''));
        if (pathRec.rationale && pathRec.rationale.length > 0) {
          pathRec.rationale.slice(0, 3).forEach(r2 => {
            ctx.fillStyle = T.text2; ctx.font = '400 14px sans-serif'; ctx.textAlign = 'left';
            y = wrapText('· ' + (r2.text || r2), 28, y, W - 56, 22, 2);
            y += 6;
          });
        } else if (pathRec.description) {
          ctx.fillStyle = T.text2; ctx.font = '400 14px sans-serif';
          y = wrapText(pathRec.description, 28, y, W - 56, 22, 4);
        }
        y += 8; divider();
      }

      // ── AI 战略规划（3/5/10 年路径）──────────────────────────
      if (aiPlanText) {
        sectionTitle('AI 战略规划（含 3/5/10 年路径）');
        ctx.fillStyle = T.text2; ctx.font = '400 14px sans-serif'; ctx.textAlign = 'left';
        const planSnippet = aiPlanText.length > 400 ? aiPlanText.slice(0, 400) + '…' : aiPlanText;
        y = wrapText(planSnippet, 28, y, W - 56, 22, 20);
        y += 8; divider();
      }

      // ── AI 专业方向推荐 ───────────────────────────────────────
      if (full && Array.isArray(full.careerMajorRecs) && full.careerMajorRecs.length > 0) {
        sectionTitle('AI 专业方向推荐（针对' + childName + '）');
        full.careerMajorRecs.slice(0, 3).forEach((rec, i) => {
          const cardTop = y;
          y += 18;

          ctx.fillStyle = T.gold; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'left';
          ctx.fillText((i + 1) + '. ' + (rec.majorName || ''), 44, y); y += 26;

          ctx.fillStyle = T.text2; ctx.font = '400 13px sans-serif';
          y = wrapText(rec.whyThisChild || '', 44, y, W - 88, 21, 3);
          y += 6;

          ctx.fillStyle = T.safety; ctx.font = '400 13px sans-serif';
          ctx.fillText('方向：' + (rec.careerPath || ''), 44, y); y += 20;
          y += 16;

          const cardH = y - cardTop;
          // 白色背景绘制在已有文字后面（destination-over），避免覆盖文字
          ctx.save(); ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = T.card; rRect(28, cardTop, W - 56, cardH, 12); ctx.fill();
          ctx.restore();
          ctx.strokeStyle = T.cardBrd; ctx.lineWidth = 0.8; rRect(28, cardTop, W - 56, cardH, 12); ctx.stroke();
        }); y += 10; divider();
      } else {
        sectionTitle('AI 专业方向推荐');
        ctx.fillStyle = T.text3; ctx.font = '400 13px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('（本次评测未获取到AI专业推荐数据，可重新生成报告）', 28, y); y += 28;
        divider();
      }

      // ── AI 院校推荐 ──────────────────────────────────────────
      if (aiSchools.length > 0) {
        sectionTitle(childName + ' AI 院校推荐');
        aiSchools.slice(0, 4).forEach(s => {
          const tierColor = s.tier === 'reach' ? T.reach : s.tier === 'match' ? T.target : T.safety;
          const tierLabel = s.tier === 'reach' ? '冲刺' : s.tier === 'match' ? '目标' : '稳妥';
          const cardTop = y;
          y += 18;

          ctx.fillStyle = T.text1; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'left';
          ctx.fillText(s.nameCn || s.name || '', 44, y);
          ctx.fillStyle = tierColor; ctx.font = '600 12px sans-serif'; ctx.textAlign = 'right';
          ctx.fillText(tierLabel + '  ' + (s.country || ''), W - 38, y);
          ctx.textAlign = 'left'; y += 24;

          ctx.fillStyle = T.text2; ctx.font = '400 13px sans-serif';
          y = wrapText(s.whyFit || '', 44, y, W - 88, 21, 3);
          y += 6;

          ctx.fillStyle = 'rgba(196,163,90,0.75)'; ctx.font = '400 12px sans-serif';
          y = wrapText('特色：' + (s.feature || s.specialty || ''), 44, y, W - 88, 19, 2);
          y += 16;

          const cardH = y - cardTop;
          ctx.save(); ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = T.card; rRect(28, cardTop, W - 56, cardH, 12); ctx.fill();
          ctx.restore();
          ctx.strokeStyle = T.cardBrd; ctx.lineWidth = 0.5; rRect(28, cardTop, W - 56, cardH, 12); ctx.stroke();
        }); y += 10; divider();
      } else {
        sectionTitle('AI 院校推荐');
        ctx.fillStyle = T.text3; ctx.font = '400 13px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('（本次路径为国内高考或AI院校数据未加载）', 28, y); y += 28;
        divider();
      }

      // ── 美国大学精准匹配（College Scorecard 算法匹配）────────
      if (usaResult && (
        (usaResult.reach  && usaResult.reach.length  > 0) ||
        (usaResult.target && usaResult.target.length > 0) ||
        (usaResult.safety && usaResult.safety.length > 0)
      )) {
        const usaMeta = usaResult.meta || {};
        sectionTitle('美国大学精准匹配（实时算法）');
        ctx.fillStyle = T.text3; ctx.font = '400 12px sans-serif'; ctx.textAlign = 'left';
        const summaryParts = [];
        if (usaMeta.totalSchools) summaryParts.push('扫描 ' + usaMeta.totalSchools + ' 所');
        if (usaMeta.budgetFmt)    summaryParts.push('预算 ' + usaMeta.budgetFmt);
        if (usaMeta.majorArea)    summaryParts.push('方向：' + usaMeta.majorArea);
        if (summaryParts.length)  { ctx.fillText(summaryParts.join('  ·  '), 28, y); y += 20; }

        const drawUsaTier = (list, tierLabel, tierColor) => {
          if (!list || list.length === 0) return;
          // 档位行：浅色底 + 色字
          ctx.fillStyle = tierColor + '14'; rRect(28, y, W - 56, 24, 6); ctx.fill();
          ctx.fillStyle = tierColor; ctx.font = '600 12px sans-serif'; ctx.textAlign = 'left';
          ctx.fillText(tierLabel, 38, y + 16); y += 30;
          list.slice(0, 3).forEach(s => {
            const cardTop = y;
            y += 16;
            // 学校名 + 匹配分
            ctx.fillStyle = T.text1; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'left';
            ctx.fillText(s.name || '', 44, y);
            ctx.fillStyle = tierColor; ctx.font = '600 13px sans-serif'; ctx.textAlign = 'right';
            ctx.fillText(String(s.totalScore || '') + ' 分', W - 38, y);
            ctx.textAlign = 'left'; y += 22;
            // 地点 + 录取率 + 薪资
            ctx.fillStyle = T.text2; ctx.font = '400 12px sans-serif';
            const statLine = [
              s.locationFmt || '',
              '录取率 ' + (s.admRateFmt || '--'),
              '薪资 ' + (s.earn6yrFmt || '--'),
            ].filter(Boolean).join('  ');
            ctx.fillText(statLine, 44, y); y += 19;
            if (s.insightSentence) {
              ctx.fillStyle = 'rgba(196,163,90,0.75)'; ctx.font = '400 12px sans-serif';
              y = wrapText(s.insightSentence, 44, y, W - 88, 19, 2);
            }
            y += 14;
            const cardH = y - cardTop;
            ctx.save(); ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = T.card; rRect(28, cardTop, W - 56, cardH, 10); ctx.fill();
            ctx.restore();
            ctx.strokeStyle = T.cardBrd; ctx.lineWidth = 0.5; rRect(28, cardTop, W - 56, cardH, 10); ctx.stroke();
          });
          y += 6;
        };

        drawUsaTier(usaResult.reach,  '冲刺院校', T.reach);
        drawUsaTier(usaResult.target, '目标院校', T.target);
        drawUsaTier(usaResult.safety, '稳妥院校', T.safety);
        y += 4; divider();
      }

      // ── 行动计划 ─────────────────────────────────────────────
      sectionTitle('现在最重要的三件事');
      actions.slice(0, 3).forEach((a, ai) => {
        const cardTop = y;
        y += 18;

        // 序号圆圈
        ctx.beginPath(); ctx.arc(44, y + 5, 11, 0, Math.PI * 2);
        ctx.fillStyle = T.goldBg; ctx.fill();
        ctx.strokeStyle = T.goldBrd; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = T.gold; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(ai + 1), 44, y + 9); ctx.textAlign = 'left';

        ctx.fillStyle = T.text1; ctx.font = 'bold 14px sans-serif';
        ctx.fillText(a.title || '', 62, y + 9); y += 26;

        ctx.fillStyle = T.text3; ctx.font = '400 12px sans-serif';
        ctx.fillText(a.timeframe || '', 62, y); y += 20;

        ctx.fillStyle = T.text2; ctx.font = '400 13px sans-serif';
        y = wrapText(a.description || '', 62, y, W - 90, 21, 3);
        y += 16;

        const cardH = y - cardTop;
        ctx.save(); ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = T.card; rRect(28, cardTop, W - 56, cardH, 12); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = T.cardBrd; ctx.lineWidth = 0.5; rRect(28, cardTop, W - 56, cardH, 12); ctx.stroke();
      }); y += 12;

      // ── 底部署名 ──────────────────────────────────────────────
      ctx.strokeStyle = T.div; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(28, y); ctx.lineTo(W - 28, y); ctx.stroke(); y += 24;
      ctx.textAlign = 'center';
      ctx.fillStyle = T.gold; ctx.font = '600 15px sans-serif';
      ctx.fillText('袁希™ · 1% 成长路径', W / 2, y); y += 22;
      ctx.fillStyle = T.text2; ctx.font = '400 12px sans-serif';
      ctx.fillText('艺圆智探 · 多元智能成长评估系统', W / 2, y); y += 20;

      // 底部金线
      ctx.fillStyle = T.gold; ctx.fillRect(0, y, W, 3);
      const finalH = y + 6; // 实际内容高度

      // ── 按实际内容高度裁剪导出 ───────────────────────────────
      // 注意：wx.canvasToTempFilePath 的 x/y/width/height 单位是 canvas 逻辑坐标
      // (即 ctx.scale(dpr,dpr) 之后的 CSS 像素，不是物理像素)
      // 用物理像素会导致超出范围，回退到全幅导出，产生大片黑色空白
      wx.canvasToTempFilePath({
        canvas,
        x: 0, y: 0,
        width:  W,          // CSS 逻辑像素宽度（750）
        height: finalH,     // CSS 逻辑像素高度（实际内容高度，裁掉空白）
        destWidth:  W * dpr,
        destHeight: finalH * dpr,
        fileType: 'png',
        success: (fileRes) => {
          wx.hideLoading();
          wx.saveImageToPhotosAlbum({
            filePath: fileRes.tempFilePath,
            success: () => {
              wx.showModal({
                title: '报告已保存',
                content: '完整报告长图已保存到相册，可转发微信好友或打印使用',
                showCancel: false,
                confirmText: '好的',
              });
            },
            fail: (e) => {
              if ((e.errMsg || '').includes('auth')) {
                wx.showModal({
                  title: '需要相册权限',
                  content: '请在设置中允许访问相册',
                  confirmText: '去设置',
                  success: (r2) => { if (r2.confirm) wx.openSetting(); },
                });
              } else {
                wx.showToast({ title: '保存失败，请重试', icon: 'none' });
              }
            },
          });
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '生成失败，请重试', icon: 'none' });
        },
      });
    });
  },

  // ── 针对报告问袁希（核心体验升级：报告→对话）──────────────────────
  goAskYuanxi() {
    // 行为追踪：aiChatStarted 信号
    this._trackBehavior('chat');
    // 【1%信号】用户主动追问 = 高参与度信号
    Scorer.record && Scorer.record('report_followup_tapped');

    const report = this.data.report;
    const sections = this.data.reportSections;

    if (!report || !sections) {
      wx.showToast({ title: '报告加载中，请稍候', icon: 'none' });
      return;
    }

    // 打包报告核心数据作为对话上下文
    // 只传 AI 对话实际需要的字段（不传大型原始数据）
    const reportContext = {
      childName:      report.childName || '孩子',
      childAge:       report.childAge  || '',
      educationPath:  report.educationPath || '',
      mindsetScore:   report.mindsetScore  || 3,
      topMI:          (report.topMI || []).map(m => m.label || m.key || m),
      miScores:       report.miScores || {},
      answers:        report.answers  || {},
      // 六段式报告内容（标题+正文，供 AI 引用）
      sections: (sections || []).map(s => ({
        title:   s.title,
        content: s.content ? s.content.slice(0, 300) : '', // 截断过长段落
      })),
      generatedAt: report.generatedAt || Date.now(),
    };

    wx.setStorageSync('reportFollowUpContext', reportContext);
    // wx.navigateTo({ url: '/pages/ai-chat/ai-chat?mode=followup' });
  },

  // ── 职业愿景构建（Career Vision）─────────────────────────────────
  // 调用 buildCareerVisions() 生成 top 3 职业集群并注入 data
  _buildCareerVisions(stored) {
    this.setData({ careerVisionsLoading: true });
    try {
      const visions = buildCareerVisions(stored);
      // 只取 top 2，每条保留 reasons 前3条
      const top2 = (visions || []).slice(0, 2).map(v => ({
        id:          v.id,
        icon:        v.icon,
        label:       v.label,
        tagline:     v.tagline,
        matchScore:  v.matchScore,
        reasons:     (v.reasons || []).slice(0, 3),
        stemOpt:     v.stemOpt,
        usStayRate:  v.usStayRate,
        careerTimeline: v.careerTimeline || {},
      }));
      this.setData({ careerVisions: top2, careerVisionsLoading: false });
    } catch (e) {
      console.warn('[careerVisions]', e);
      this.setData({ careerVisionsLoading: false });
    }
  },

  // 跳转到职业愿景详情页
  goCareerVision(e) {
    const clusterId = e.currentTarget.dataset.id;
    if (!clusterId) return;
    wx.setStorageSync('selectedCareerPath', clusterId);
    wx.navigateTo({ url: `/pages/career-vision/career-vision?id=${clusterId}` });
  },

  // ── 自动触发美国大学智能匹配（College Scorecard 实时引擎）─────────
  // 从 assessmentData 提取画像 → 调用 runMatch() → 结果注入报告页
  // 触发条件：education_path_preference ≠ 'gaokao'（在 _renderFromData 中判断）
  _autoStudyAbroadMatch(stored) {
    this.setData({ studyAbroadLoading: true, studyAbroadError: null });

    const profile = extractProfileFromAssessment(stored);

    // 如果无法确定专业方向，给一个宽泛默认值避免 API 不返回结果
    if (!profile.majorArea) {
      profile.majorArea = 'computer'; // 最高就业率专业作为默认
    }

    // ── 个人化锚点（供 insightSentence 使用）──────────────────────────
    const MI_NAMES_SHORT = {
      linguistic: '语言', logical: '逻辑', spatial: '空间',
      musical: '音乐', bodily: '体感', naturalist: '自然',
      interpersonal: '社交', intrapersonal: '内省',
    };
    const miScores = stored.multipleIntelligences || stored.miScores || {};
    const sortedMI = Object.entries(miScores).sort((a, b) => b[1] - a[1]);
    const topMIName    = sortedMI[0] ? (MI_NAMES_SHORT[sortedMI[0][0]] || '') : '';
    const secondMIName = sortedMI[1] ? (MI_NAMES_SHORT[sortedMI[1][0]] || '') : '';
    const miLabel = topMIName && secondMIName
      ? `${topMIName}-${secondMIName}型`
      : topMIName ? `${topMIName}型` : '';
    const answers   = stored.answers || {};
    const childName = stored.childName || answers.childName || answers.child_name || '';
    const name      = childName || '孩子';

    // 专业键→中文标签
    const MAJOR_LABEL_MAP = {
      computer: '计算机/信息技术', engineering: '工程学', business: '商科/管理',
      data_science: '数据科学', biology: '生物/生命科学', medicine: '医学预科',
      law: '法律预科', arts: '艺术/设计', social_science: '社会科学',
      education: '教育学', psychology: '心理学', communications: '传媒/新闻',
      environmental: '环境科学', mathematics: '数学/统计', physics: '物理/天文',
      chemistry: '化学', economics: '经济学', architecture: '建筑学',
      film: '影视/表演', music: '音乐', nursing: '护理', pharmacy: '药学',
    };

    runMatch(profile)
      .then(result => {
        // 格式化学校字段，使 WXML 可直接显示（不需要 wxs 或 filter 函数）
        const fmtSchool = s => {
          // runMatch 返回嵌套模块分 {modules:{m1,m2,...}}，展平供 insightSentence 使用
          const mods = s.modules || {};
          const m1 = mods.m1 || 0;
          const m2 = mods.m2 || 0;
          const m3 = mods.m3 || 0;
          const m5 = mods.m5 || 0;
          const m6 = mods.m6 || 0;

          // 主力专业标签（优先 programWeights，回退到 profile.majorArea）
          let primaryField = null;
          let primaryWeight = 0;
          if (s.programWeights) {
            Object.entries(s.programWeights).forEach(([field, w]) => {
              if (w > primaryWeight) { primaryWeight = w; primaryField = field; }
            });
          }
          const prog = primaryField
            ? (MAJOR_LABEL_MAP[primaryField] || primaryField)
            : (MAJOR_LABEL_MAP[profile.majorArea] || '主力方向');

          // ── insightSentence（每所学校唯一个性化推荐语）────────────
          const earn6k = s.earn6yr ? Math.round(s.earn6yr / 1000) : 0;
          const m1Pct  = m1 / 25;
          const m2Pct  = m2 / 20;
          const m3Pct  = m3 / 20;
          const m5Pct  = m5 / 10;
          const m6Pct  = m6 / 15;
          const talent = miLabel || `${name}的画像`;
          let insightSentence;

          if (s.tier === 'reach' && m1Pct >= 0.8 && m6Pct >= 0.75) {
            const earnStr = earn6k >= 80 ? `，毕业薪资 $${earn6k}k` : '';
            insightSentence = miLabel
              ? `${name}的${talent}天赋，在这里的 ${prog} 体系里有完整出口${earnStr}——方向对了，起点就对了`
              : `${name}的兴趣画像与 ${prog} 高度吻合${earnStr}，行业增速强劲——方向对了，起点就对了`;
          } else if (s.tier === 'reach' && earn6k >= 100 && m6Pct >= 0.85) {
            insightSentence = `${name}冲这里意义重大：${prog}毕业薪资 $${earn6k}k，就业前景卓越——这个起点值一次全力争取`;
          } else if (s.tier === 'reach' && earn6k >= 90 && m6Pct >= 0.80) {
            insightSentence = `${name}的 ${prog} 方向与这所学校的产学出口高度匹配——毕业薪资 $${earn6k}k，冲刺有意义`;
          } else if (s.tier === 'reach' && earn6k >= 80) {
            insightSentence = `冲刺门槛高，但${name}的综合画像具备竞争力——毕业薪资 $${earn6k}k，值得放手一搏`;
          } else if (s.tier === 'reach') {
            insightSentence = `冲刺难度大——但${name}的各维度画像与这里高度匹配，值得全力争取`;
          } else if (s.tier === 'target' && m5Pct >= 0.8) {
            insightSentence = `${name}预算范围内被低估的好学校——录取门槛可控，但毕业薪资表现超出预期`;
          } else if (s.tier === 'safety' && m6Pct >= 0.6 && earn6k > 0) {
            insightSentence = `${name}进这里的把握很高，且 ${prog} 就业前景良好，毕业薪资 $${earn6k}k——扎实的起点`;
          } else if (s.tier === 'safety') {
            insightSentence = earn6k > 0
              ? `${name}进这里的概率很高，综合匹配度强，毕业薪资 $${earn6k}k——不是退而求其次，是稳中求进`
              : `${name}进这里的概率很高，综合匹配度强——不是退而求其次，是稳中求进`;
          } else if (m1Pct >= 0.82) {
            insightSentence = miLabel
              ? `${name}的${talent}天赋，在 ${prog} 方向找到了最自然的承接——不只是成绩匹配，是方向匹配`
              : `${name}的兴趣画像与 ${prog} 深度吻合——不只是成绩匹配，是方向匹配`;
          } else if (m2Pct >= 0.82) {
            insightSentence = miLabel
              ? `评测显示${name}是典型的${talent}孩子，这所学校的培养体系与这个天赋结构高度契合`
              : `多元智能评测显示，${name}的天赋结构与这所学校的培养体系契合度极高`;
          } else if (m3Pct >= 0.82 && earn6k >= 90) {
            insightSentence = `毕业薪资 $${earn6k}k——在${name}的预算内，这是投资回报最突出的选项之一`;
          } else if (m6Pct >= 0.85) {
            insightSentence = `${name}选择的 ${prog} 行业，10年就业增速领先全国——这所学校的毕业生正好站在入口`;
          } else if (m1Pct >= 0.65 && m3Pct >= 0.65 && earn6k > 0) {
            insightSentence = `${prog} 方向适合${name}，毕业薪资 $${earn6k}k——既对得上孩子，也对得上这笔投资`;
          } else {
            const signals = [
              m1Pct >= 0.65 ? '兴趣契合' : null,
              m2Pct >= 0.65 ? '天赋匹配' : null,
              m3Pct >= 0.65 ? '回报出色' : null,
              m5Pct >= 0.6  ? '性价比突出' : null,
              m6Pct >= 0.65 ? '就业向好' : null,
            ].filter(Boolean).slice(0, 2);
            insightSentence = signals.length >= 2
              ? `${name}：${signals.join(' · ')}，综合匹配度 ${s.total} 分`
              : earn6k > 0
                ? `${name}综合匹配 ${s.total} 分 · 毕业薪资 $${earn6k}k`
                : `${name}综合匹配评分 ${s.total} 分`;
          }

          return {
            ...s,
            unitId:         String(s.id || Math.random()),
            totalScore:     s.total || 0,
            admRateFmt:     s.admRate != null ? Math.round(s.admRate * 100) + '%' : '数据缺失',
            earn6yrFmt:     s.earn6yr ? '$' + Math.round(s.earn6yr / 1000) + 'k/年' : '数据缺失',
            gradRateFmt:    s.gradRate != null ? Math.round(s.gradRate * 100) + '%' : '数据缺失',
            locationFmt:    [s.city, s.state].filter(Boolean).join(', '),
            insightSentence,
          };
        };

        const formatted = {
          ...result,
          reach:  (result.reach  || []).map(fmtSchool),
          target: (result.target || []).map(fmtSchool),
          safety: (result.safety || []).map(fmtSchool),
          meta: {
            totalSchools: result.totalScanned || 0,
            majorArea:    profile.majorArea || '',
            budgetUSD:    profile.budgetUSD || 0,
            budgetFmt:    profile.budgetUSD ? '$' + Math.round(profile.budgetUSD / 1000) + 'k' : '',
            usedFallback: result.usedFallback || false,
          },
        };
        this.setData({
          studyAbroadResult: formatted,
          studyAbroadLoading: false,
        });
      })
      .catch(err => {
        // fetchSchools 已内置 fallback，此处仅处理 runMatch 自身意外抛出的情况
        console.error('[autoStudyAbroadMatch] unexpected error', err);
        this.setData({
          studyAbroadLoading: false,
          studyAbroadError: '匹配计算出现错误，请稍后重试（' + (err && err.message ? err.message : String(err)) + '）',
        });
      });
  },

  // ── LLM 院校智能推荐（真正个性化，不受静态库限制）──────────────────
  _llmSchoolRec(stored, report) {
    const answers  = stored.answers  || {};
    const miScores = stored.multipleIntelligences || stored.miScores || {};

    const MI_NAMES = {
      linguistic:'语言智能', logical:'逻辑数学', spatial:'空间视觉',
      musical:'音乐节奏', bodily:'身体运动', interpersonal:'人际交往',
      intrapersonal:'自我认知', naturalist:'自然探索',
    };
    // miScores 可能是归一化(0-1)或原始(1-5)，统一转成 x/5 显示
    const normalizedMI = {};
    Object.entries(miScores).forEach(([k,v]) => {
      normalizedMI[k] = v <= 1 ? Math.round(v * 5) : v;
    });

    wx.cloud.callFunction({
      name: 'aiAnalysis',
      data: {
        mode: 'schoolRec',
        data: {
          childName:       stored.childName || answers.childName || '孩子',
          schoolStage:     answers.schoolStage || stored.currentGrade || '',
          miScores:        normalizedMI,
          subjectInterest: answers.subject_interest || '',
          englishLevel:    answers.english_level || stored.student_profile?.english_level || '基础',
          geoPreference:   answers.geo_preference || 'open',
          academicLevel:   answers.academic_level || 'medium',
          budget:          answers.education_budget || answers.annual_budget || '',
          pathKey:         report?.pathRecommendation?.pathKey || pathPref || 'university_abroad',
          // ── 新增：职业方向 + RIASEC 数据（驱动个性化学校理由）──────
          riasecPrimary:   answers.riasec_primary  || '',
          motivationType:  answers.motivation_type || '',
          socialRole:      answers.social_role     || '',
          riskProfile:     answers.risk_profile    || '',
          careerCluster:   answers.career_cluster  || '',
          observedSkills:  answers.observed_skills || '',
        },
      },
      success: (res) => {
        this.setData({ aiSchoolRecsLoading: false });
        if (res.result?.success && Array.isArray(res.result.schools) && res.result.schools.length > 0) {
          this.setData({ aiSchoolRecs: res.result.schools });
        }
      },
      fail: () => {
        this.setData({ aiSchoolRecsLoading: false });
      },
    });
  },

  // ── 学生问卷入口 ──────────────────────────────────────────────────
  goStudentQuestionnaire() {
    // 将报告上下文传给 ai-chat，让学生问卷知道孩子姓名
    const report = this.data.report;
    if (report) {
      const existing = wx.getStorageSync('reportFollowUpContext') || {};
      wx.setStorageSync('reportFollowUpContext', {
        ...existing,
        childName: report.meta?.childName || '',
      });
    }
    // wx.navigateTo({ url: '/pages/ai-chat/ai-chat?mode=student' });
  },

  // ── 加载/刷新学生问卷结果 ──────────────────────────────────────
  // 统一从 assessmentData 读取（由 _onStudentFlowComplete 写入）
  _loadStudentData() {
    try {
      const ad = wx.getStorageSync('assessmentData') || {};
      if (ad.student_self && ad.student_self.student_overseas_motivation) {
        this.setData({
          studentSelfDone: true,
          studentDivergence: ad.student_divergence || null,
        });
      }
    } catch(e) {}
  },

  // ── 重新测评 ──
  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },

  retake() {
    wx.showModal({
      title: '重新评估',
      content: '将清除当前报告并重新开始评估，确定吗？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('assessmentData');
          wx.removeStorageSync('reportData');
          // wx.redirectTo({ url: '/pages/ai-chat/ai-chat' });
        }
      }
    });
  },

  // ── 分享报告（完整报告页） ──
  onShareAppMessage() {
    // 【1%信号】分享报告 = 高行动意愿信号
    Scorer.record('report_shared');
    this._trackBehavior('share');
    const report = this.data.report;
    const child  = report?.meta?.childName || '孩子';
    const path   = report?.pathRecommendation?.primaryLabel || '综合路线';
    const score  = report?.compatibility?.overall || '';
    return {
      title: `艺圆智探 | ${child}的成长战略报告 · ${path} · 袁希™`,
      // 分享到好友后，对方打开即看完整报告（不是首页）
      path: '/pages/result/result',
      imageUrl: this.data.shareCardPath || '',   // 若已生成海报则用海报，否则用默认图
    };
  },

  // ── 报告加载完成时记录评估完成信号 ──────────────────────
  _recordAssessmentSignal(assessmentData) {
    if (!assessmentData) return;
    // 规划时间跨度推算（从教育路径偏好）
    const horizonMap = {
      highschool_abroad:   5,
      university_abroad:   6,
      international_school:8,
      undecided:           4,
    };
    const horizon = horizonMap[assessmentData.education_path_preference] || 3;
    // 家庭背景完整度
    const familyComplete = !!(assessmentData.parent_occupation && assessmentData.city_tier);
    // 预算
    const budget = assessmentData.education_budget || null;
    // 决策风险：海外+高预算=高风险
    let risk = 0;
    if (assessmentData.education_path_preference === 'highschool_abroad' ||
        assessmentData.education_path_preference === 'university_abroad') risk += 1;
    if (assessmentData.education_path_preference === 'international_school') risk += 1;
    if (budget && budget.includes('60')) risk += 1; // 60万+预算

    Scorer.record('assessment_completed', { planningHorizon: horizon, budget, familyComplete });
    Scorer.record('decision_risk', risk);
  },
});

// ── 常量：智能维度中文名 ──
const MI_LABELS = {
  linguistic:    '语言智能',
  logical:       '逻辑数学',
  spatial:       '空间视觉',
  musical:       '音乐节奏',
  bodily:        '身体运动',
  interpersonal: '人际交往',
  intrapersonal: '自我认知',
  naturalist:    '自然探索',
};

const MI_COLORS = [
  '#0071E3', '#2A7A5A', '#C4A35A', '#5B3A8B',
  '#C75B2A', '#1A5276', '#117A65', '#6E2F8A'
];

const PATH_LABELS = {
  highschool_abroad:  '高中出国路线',
  university_abroad:  '大学出国路线',
  international_school: '国际学校路线',
};

// canvas 圆角矩形辅助（复用于分享卡绘制）
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
