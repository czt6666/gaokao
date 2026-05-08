// cloudfunctions/saveAssessment/index.js
// 袁希™ · 评估结果持久化
// ═══════════════════════════════════════════════════════════════
//  每次用户生成报告后调用，将完整数据写入云数据库 assessments 集合
//  数据结构设计为：可直接用于袁希咨询前的背景浏览
// ═══════════════════════════════════════════════════════════════

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  // ── mode: 'getLatest' — 查询当前用户最近一次评估（用于本地数据恢复）──
  if (event.mode === 'getLatest') {
    try {
      const res = await db.collection('assessments')
        .where({ _openid: OPENID })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      if (!res.data || res.data.length === 0) {
        return { success: true, found: false };
      }
      const doc = res.data[0];
      return {
        success: true, found: true, docId: doc._id,
        answers:      doc.childAnswers   || {},
        miScores:     doc.miScores       || {},
        mindsetScore: doc.mindsetScore   || 3,
        parentAnswers:doc.parentAnswers  || {},
        childName:    doc.childName      || '孩子',
        overallScore: doc.overallScore   || 0,
        primaryPath:  doc.primaryPath    || '',
        primaryPathLabel: doc.primaryPathLabel || '',
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  try {
    const d = event.data || {};
    const report = d.report || {};
    const answers = d.answers || {};
    const miScores = d.miScores || {};
    const parentAnswers = d.parentAnswers || {};
    const aiInsight = d.aiInsight || null;
    const compat = report.compatibility || {};
    const pathRec = report.pathRecommendation || {};
    const childPortrait = report.childPortrait || {};
    const familyPortrait = report.familyPortrait || {};

    // ── 判断是新建还是更新（同一 openid 可能多次评估）──
    // 策略：永远新建，保留历史记录；同一 openid 的多条记录在管理端可以看到演变
    const docData = {

      // ── 身份 ──────────────────────────────────────────────────
      _openid: OPENID,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),

      // ── 孩子基本信息 ──────────────────────────────────────────
      childName:    answers.childName    || '孩子',
      childAge:     answers.childAge     || null,
      schoolStage:  answers.schoolStage  || null,
      schoolType:   answers.schoolType   || null,
      englishLevel: answers.englishLevel || null,
      academicTier: answers.academicTier || null,

      // ── 教育方向偏好（新增，直接用于筛选/统计）────────────────
      educationPath:    answers.education_path_preference || null,  // gaokao/international_school/highschool_abroad/university_abroad/undecided
      subjectInterest:  answers.subject_interest          || null,  // stem/natural_science/business/humanities/arts_design/communication/undecided
      geoPreference:    answers.geo_preference            || null,  // us/uk/canada/au_nz/asia_pacific/europe/cn_only/open
      targetCountry:    answers.geo_preference            || null,  // alias，方便后台理解
      educationBudget:  answers.education_budget          || null,  // under_5w/5w_15w/.../over_100w

      // ── 多元智能评分（原始） ──────────────────────────────────
      miScores: {
        linguistic:    miScores.linguistic    || null,
        logical:       miScores.logical       || null,
        spatial:       miScores.spatial       || null,
        musical:       miScores.musical       || null,
        bodily:        miScores.bodily        || null,
        interpersonal: miScores.interpersonal || null,
        intrapersonal: miScores.intrapersonal || null,
        naturalist:    miScores.naturalist    || null,
      },
      mindsetScore: d.mindsetScore || null,

      // ── 孩子问卷原始答案（全量保留，便于袁希翻阅） ──────────
      childAnswers: answers,

      // ── 家长问卷原始答案（全量保留） ─────────────────────────
      hasParentAnswers: Object.keys(parentAnswers).length > 0,
      parentAnswerCount: Object.keys(parentAnswers).filter(k => parentAnswers[k]?.trim?.()?.length > 5).length,
      parentAnswers: parentAnswers,

      // ── 报告摘要（快速浏览用） ────────────────────────────────
      overallScore:   compat.overall        || null,
      overallLabel:   compat.overallLabel   || null,
      overallColor:   compat.overallColor   || null,
      primaryPath:    pathRec.primaryPath   || null,
      primaryPathLabel: pathRec.primaryLabel || null,
      pathConfidence: pathRec.confidence    || null,

      // ── 4维度分数（袁希咨询的核心切入点） ────────────────────
      dimensions: (compat.dimensions || []).map(dim => ({
        id:         dim.id,
        label:      dim.label,
        score:      dim.score,
        level:      dim.level,
        levelLabel: dim.levelLabel,
        evidence:   dim.evidence,   // 袁希看这个了解孩子的具体情况
      })),

      // ── 前三优势智能 ──────────────────────────────────────────
      topIntelligences: (childPortrait.topIntelligences || []).slice(0, 3).map(m => ({
        key: m.key, label: m.label, score: m.score, pct: m.pct,
      })),
      mindsetLevel:  childPortrait.mindsetLevel  || null,
      mindsetLabel:  childPortrait.mindsetLabel  || null,
      mindsetDesc:   childPortrait.mindsetDesc   || null,

      // ── 路径建议完整内容 ──────────────────────────────────────
      pathRationale: pathRec.rationale     || [],
      pathRisks:     pathRec.risks         || [],
      altPath:       pathRec.alternativePath || null,

      // ── 家庭画像（关键词分析结果） ────────────────────────────
      parentingStyle:  familyPortrait.parentingStyle  || null,
      parentingLabel:  familyPortrait.parentingLabel  || null,
      parentingNote:   familyPortrait.parentingNote   || null,
      commQuality:     familyPortrait.commQuality     || null,
      commLabel:       familyPortrait.commLabel       || null,
      valueConsensus:  familyPortrait.valueConsensus  || null,
      engagementLabel: familyPortrait.engagementLabel || null,
      avgAnswerDepth:  familyPortrait.avgDepth        || null,
      // 家长问卷里最有价值的4句原话引用
      keyQuotes: familyPortrait.keyQuotes || {},

      // ── AI深度洞察（如果已生成） ──────────────────────────────
      aiInsight: aiInsight ? {
        parentingStyle:   aiInsight.parentingStyle   || null,
        commQuality:      aiInsight.commQuality      || null,
        keyQuote:         aiInsight.keyQuote         || null,
        valueConsensus:   aiInsight.valueConsensus   || null,
        blindspot:        aiInsight.blindspot        || null,
        strengthSignal:   aiInsight.strengthSignal   || null,
        riskSignal:       aiInsight.riskSignal       || null,
        yuanxiPerspective: aiInsight.yuanxiPerspective || null,
      } : null,
      hasAiInsight: !!aiInsight,

      // ── 三个行动建议 ──────────────────────────────────────────
      actions: (report.actions || []).map(a => ({
        priority: a.priority, icon: a.icon, title: a.title,
        timeframe: a.timeframe, description: a.description,
      })),

      // ── 行为追踪（用户参与深度 = 意向度指标） ─────────────────
      behavior: {
        ctaTapped:         d.behavior?.ctaTapped         || false,
        shareGenerated:    d.behavior?.shareGenerated    || false,
        parentAnswered:    Object.keys(parentAnswers).length > 0,
        aiChatStarted:     d.behavior?.aiChatStarted     || false,
        retakeCount:       d.behavior?.retakeCount       || 0,
      },

      // ── 问卷交互质量日志（自学习引擎核心数据）────────────────
      // 每道开放题的回答质量、追问触发情况、答案长度
      // 供 adminAnalytics 云函数聚合分析，驱动问题进化建议
      questionLog: (d.qualityLog || []).map(entry => ({
        qId:          entry.qId          || null,
        stage:        entry.stage        || null,
        firstQuality: entry.firstQuality ?? null,   // 0=敷衍 1=简略 2=基础 3=深度
        finalQuality: entry.finalQuality ?? entry.firstQuality ?? null,
        probed:       entry.probed       || false,   // 是否触发了追问
        firstLen:     entry.firstLen     || (entry.firstAnswer?.length ?? 0),
        finalLen:     entry.finalLen     || (entry.finalAnswer?.length ?? entry.firstLen ?? 0),
        // 保存首次回答供语义分析（匿名，不含个人信息）
        // 仅保存前100字，避免存储过多原始文本
        firstAnswerSample: (entry.firstAnswer || '').slice(0, 100) || null,
      })),

      // 整体参与度指标（qualityLog 的汇总，供快速筛选）
      avgAnswerDepth: (() => {
        const ql = d.qualityLog || [];
        if (ql.length === 0) return null;
        const sum = ql.reduce((s, e) => s + (e.finalQuality ?? e.firstQuality ?? 2), 0);
        return Math.round(sum / ql.length * 10) / 10;
      })(),

      // ── 袁希备注（初始为空，管理端填写） ─────────────────────
      adminNote:    '',
      adminTags:    [],       // 例如：['高意向', '已联系', '已成交']
      adminStage:   'new',    // new | contacted | consulting | converted | closed
      isRead:       false,    // 管理端是否已查看
    };

    const result = await db.collection('assessments').add({ data: docData });

    return {
      success: true,
      docId: result._id,
    };

  } catch (err) {
    console.error('[saveAssessment]', err);
    return { success: false, error: err.message };
  }
};
