// utils/field_schema.js
// 袁希™ Phase 1 — 决策字段 Schema
// ─────────────────────────────────────────────────────────────────────
// 职责：定义 session 数据结构、必采字段清单、默认值、状态计算函数
// 被 risk_engine.js / path_engine.js 依赖
// ─────────────────────────────────────────────────────────────────────

// ══ 1. SESSION 完整结构（文档记录用，不需要实例化这个对象）══════════
const SESSION_SCHEMA = {
  // ── 孩子维度（Phase 1 必采） ──────────────────────────────────────
  student_profile: {
    grade:              null,   // enum: 小1~小6 / 初1~初3 / 高1~高3
    grade_group:        null,   // enum: primary / middle / high (与旧 currentGrade 对应)
    school_type:        null,   // enum: public_ordinary / public_key / bilingual / international / private
    academic_level:     null,   // enum: top10 / top30 / medium / below_medium
    english_level:      null,   // enum: weak / basic / conversational / fluent
    overseas_attitude:  null,   // enum: eager / acceptable / resistant / unclear
    // ── Phase 2 补采字段（Phase 1 中条件性采集） ──
    independence_level: null,   // enum: high / medium / low
    resilience_level:   null,   // enum: strong / medium / weak
    motivation_source:  null,   // enum: internal / external / unclear
    current_stress_signal: null, // enum: normal / stressed / fatigued / avoidant
  },

  // ── 家长维度（Phase 1 必采） ──────────────────────────────────────
  parent_profile: {
    overseas_understanding: null, // enum: deep / basic / superficial / none
    control_level:          null, // enum: dominant / collaborative / hands_off
    elite_school_fixation:  null, // enum: strong / medium / weak
  },

  // ── 家庭维度（Phase 1 必采） ──────────────────────────────────────
  family_profile: {
    annual_education_budget:    null, // enum: under10w / 10_20w / 20_40w / 40_80w / over80w
    decision_timeline:          null, // enum: within6m / within1y / within2y / flexible
    family_overseas_acceptance: null, // enum: fully / acceptable / prefer_not / strongly_against
    dual_track_budget_ok:       null, // boolean
  },

  // ── 决策状态（系统内部计算，不向用户暴露原始数据） ───────────────
  decision_status: {
    dialogue_state:         'S1', // 当前状态机状态 S1~S8
    fields_collected:       [],   // 已有值的字段列表
    fields_missing:         [],   // 必采字段中缺失的列表
    confidence_level:       0,    // 0~1，路径判断置信度
    gaps_to_fill:           [],   // 如果置信度不足，需补的字段优先列表
  },

  // ── 风险 & 路径（引擎输出，挂在 cd 上） ──────────────────────────
  riskFlags:     [],   // risk_engine 输出：[ {type, level, description, needs_deepdive, deepdive_question} ]
  pathJudgment:  null, // path_engine 输出：{ primaryPath, confidence, reasons, missingFields, exclusions }
};

// ══ 2. 必采字段（缺少任意一个，路径判断置信度降级） ═══════════════════
const REQUIRED_FIELDS = [
  // 字段路径（格式：profile.fieldName）
  'student_profile.grade_group',
  'student_profile.school_type',
  'student_profile.academic_level',
  'student_profile.english_level',
  'student_profile.overseas_attitude',
  'parent_profile.overseas_understanding',
  'family_profile.annual_education_budget',
  'family_profile.decision_timeline',
  'family_profile.family_overseas_acceptance',
];

// ══ 3. 字段默认值（当字段缺失时的安全回退，用于引擎计算） ════════════
const FIELD_DEFAULTS = {
  student_profile: {
    grade_group:          'middle',
    school_type:          'public_ordinary',
    academic_level:       'medium',
    english_level:        'basic',
    overseas_attitude:    'unclear',
    independence_level:   'medium',
    resilience_level:     'medium',
    motivation_source:    'unclear',
    current_stress_signal: 'normal',
  },
  parent_profile: {
    overseas_understanding: 'basic',
    control_level:          'collaborative',
    elite_school_fixation:  'medium',
  },
  family_profile: {
    annual_education_budget:    '20_40w',
    decision_timeline:          'within2y',
    family_overseas_acceptance: 'acceptable',
    dual_track_budget_ok:       null,
  },
};

// ══ 4. getSessionStatus(cd) — 计算当前 Session 的字段完整度 ══════════
// 输入：cd（collectedData 对象，包含 student_profile / parent_profile / family_profile）
// 输出：{ collected, missing, completionRate, isReadyForPath }
function getSessionStatus(cd) {
  const sp = cd.student_profile || {};
  const pp = cd.parent_profile  || {};
  const fp = cd.family_profile  || {};

  const collected = [];
  const missing   = [];

  REQUIRED_FIELDS.forEach(fieldPath => {
    const [group, key] = fieldPath.split('.');
    const profileMap = {
      student_profile: sp,
      parent_profile:  pp,
      family_profile:  fp,
    };
    const val = (profileMap[group] || {})[key];
    if (val !== null && val !== undefined && val !== '') {
      collected.push(fieldPath);
    } else {
      missing.push(fieldPath);
    }
  });

  const completionRate = REQUIRED_FIELDS.length > 0
    ? collected.length / REQUIRED_FIELDS.length
    : 0;

  // 可以进入路径判断的最低门槛：核心6项有值
  const CORE_FIELDS = [
    'student_profile.grade_group',
    'student_profile.academic_level',
    'student_profile.english_level',
    'family_profile.annual_education_budget',
    'family_profile.family_overseas_acceptance',
    'student_profile.overseas_attitude',
  ];
  const coreMissing = CORE_FIELDS.filter(f => missing.includes(f));
  const isReadyForPath = coreMissing.length === 0;

  return { collected, missing, completionRate, isReadyForPath, coreMissing };
}

// ══ 5. 新旧字段映射（extractFn 双写辅助函数） ════════════════════════
// 调用方式：syncLegacyFields(cd)
// 把 student_profile / family_profile 的新字段同步回旧 cd.answers
// 保证旧 report_engine / matcher.js 能继续读取数据
function syncLegacyFields(cd) {
  const sp = cd.student_profile || {};
  const fp = cd.family_profile  || {};
  cd.answers = cd.answers || {};

  // grade_group → currentGrade（旧字段）
  if (sp.grade_group) {
    cd.currentGrade = sp.grade_group; // primary / middle / high
  }

  // school_type 双写
  if (sp.school_type) {
    cd.answers.schoolType = sp.school_type;
    // 国际学校自动设 education_path_preference
    if (sp.school_type === 'international') {
      cd.answers.education_path_preference = 'international_school';
    }
  }

  // academic_level → academicTier（旧格式）
  const levelToTier = {
    top10:         'top_5pct',
    top30:         'top_20pct',
    medium:        'top_50pct',
    below_medium:  'below_average',
  };
  if (sp.academic_level) {
    cd.answers.academicTier = levelToTier[sp.academic_level] || sp.academic_level;
  }

  // budget → education_budget（旧格式）
  const budgetMap = {
    under10w:  'under_5w',
    '10_20w':  '5w_15w',
    '20_40w':  '15w_30w',
    '40_80w':  '30w_60w',
    over80w:   'over_100w',
  };
  if (fp.annual_education_budget) {
    cd.answers.education_budget = budgetMap[fp.annual_education_budget] || fp.annual_education_budget;
  }

  // english_level 双写
  if (sp.english_level) {
    cd.answers.englishLevel = sp.english_level;
  }

  // overseas_attitude → 旧 answers 里也存一份
  if (sp.overseas_attitude) {
    cd.answers.overseas_attitude = sp.overseas_attitude;
  }

  // family_overseas_acceptance 双写
  if (fp.family_overseas_acceptance) {
    cd.answers.family_overseas_acceptance = fp.family_overseas_acceptance;
  }
}

// ══ 6. decision_log 评估日志结构（v1 新增，挂在 cd.decision_log）══════
// 字段总数：12个。写入时机：path_engine.judgePath() 执行后。
const DECISION_LOG_SCHEMA = {
  user_stated_geo:          null,   // 用户填写的地理偏好 (us/uk/...)
  user_stated_path:         null,   // 用户填写的路径偏好
  system_output_path:       null,   // 系统最终推荐路径
  deviation_from_preference:null,   // boolean：系统是否偏离用户偏好
  deviation_reasons:        [],     // string[]：偏离原因（来自 hard_rules + explain_engine）
  hard_rules_triggered:     [],     // string[]：触发的硬门槛 ID 列表
  primary_bottleneck:       null,   // 主要瓶颈（来自 timeline_engine）
  prep_months_estimated:    null,   // 估算准备月数
  is_staged_prep_path:      null,   // boolean：是否进入阶段性备战路径
  path_confidence:          null,   // 0~1 路径判断置信度
  assessed_at:              null,   // 时间戳
  reassess_at_suggestion:   null,   // 建议重评时间点描述
};

// 初始化 decision_log
function initDecisionLog(cd) {
  if (!cd.decision_log) {
    cd.decision_log = { ...DECISION_LOG_SCHEMA };
  }
  return cd.decision_log;
}

// 写入 decision_log（由 path_engine 调用）
function writeDecisionLog(cd, pathResult, hardResult, timelineResult) {
  const log = initDecisionLog(cd);
  const a   = cd.answers || {};

  log.user_stated_geo          = a.geo_preference || null;
  log.user_stated_path         = a.education_path_preference || null;
  log.system_output_path       = pathResult.primaryPath || null;
  log.hard_rules_triggered     = (hardResult && hardResult.triggeredIds) || [];
  log.primary_bottleneck       = timelineResult
    ? timelineResult.bottleneck.name + '（' + timelineResult.bottleneck.label + '）'
    : null;
  log.prep_months_estimated    = timelineResult
    ? timelineResult.totalRange.max
    : null;
  log.is_staged_prep_path      = pathResult.primaryPath === 'abroad_prep';
  log.path_confidence          = pathResult.confidence || null;
  log.assessed_at              = Date.now();
  log.reassess_at_suggestion   = timelineResult ? timelineResult.reassessAt : null;

  // 偏离判断：用户有明确意向，但系统推了不同路径
  const userWantsAbroad = ['university_abroad', 'international_school', 'highschool_abroad']
    .includes(a.education_path_preference);
  const systemIsNotAbroad = !['abroad', 'dual_track'].includes(pathResult.primaryPath);
  log.deviation_from_preference = !!(userWantsAbroad && systemIsNotAbroad);
  log.deviation_reasons = log.deviation_from_preference
    ? ((hardResult && hardResult.explanations) || []).slice(0, 3)
    : [];

  return log;
}

// ══ 7. evidence_log Schema（v2 新增，挂在 cd.evidence_log，由 evidence_engine 写入）
// 格式：Array of { slot, evidenceType, label, confidenceBoost, raw, ts }
// 不在此处实例化，由 evidence_engine.recordEvidence() 动态写入
const EVIDENCE_LOG_SCHEMA = {
  slot:            null, // 对应 judgment slot id
  evidenceType:    null, // 来自 EVIDENCE_TYPES 的 key
  label:           null, // 中文标签
  confidenceBoost: 0,    // 置信度修正值
  raw:             null, // 原始回答文字（截断200字）
  ts:              null, // 时间戳
};

// ══ 8. consistency_log Schema（v2 新增，挂在 cd._consistencyResult，由 consistency_engine 写入）
// 格式：{ violations:[], warnings:[], confidenceAdjustment:number, followUpTexts:[], autoFixApplied:[] }
const CONSISTENCY_LOG_SCHEMA = {
  violations:           [],  // hard/medium 不一致项
  warnings:             [],  // soft 提醒项
  confidenceAdjustment: 0,   // 置信度总调整（负数）
  followUpTexts:        [],  // 触发的追问文本
  autoFixApplied:       [],  // 已自动修正的规则 id
};

module.exports = {
  SESSION_SCHEMA,
  DECISION_LOG_SCHEMA,
  EVIDENCE_LOG_SCHEMA,
  CONSISTENCY_LOG_SCHEMA,
  REQUIRED_FIELDS,
  FIELD_DEFAULTS,
  getSessionStatus,
  syncLegacyFields,
  initDecisionLog,
  writeDecisionLog,
};
