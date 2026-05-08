// utils/consistency_engine.js
// 袁希™ — 一致性检查层 v1
// ─────────────────────────────────────────────────────────────────────
// 职责：
//   1. 定义 12 条一致性规则
//   2. checkConsistency(cd) → { violations, warnings, confidenceAdjustment, followUpTexts }
//   3. 不判断"撒谎"，只判断：信息是否一致 / 是否有充分依据 / 是否存在理想化
//   4. 结果写入 cd._consistencyResult，供 path_engine 和 report 使用
//
// 规则设计原则：
//   - 每条规则：触发条件 → severity（hard/medium/soft）→ 是否追问 → 置信度影响
//   - 'hard'  : 直接修改路径判断置信度 -0.20，且写入 alternativeBlocked
//   - 'medium': 置信度 -0.10，生成 followUpText 但不阻断
//   - 'soft'  : 仅记录 warning，置信度 -0.05
// ─────────────────────────────────────────────────────────────────────

// ══ 12 条一致性规则 ══════════════════════════════════════════════════
const CONSISTENCY_RULES = [
  // ─── 规则1：名校执念 vs 学业现实 ──────────────────────────────────
  {
    id: 'cr_elite_vs_academic',
    description: '名校期待与学业基础不匹配',
    check: (cd) => {
      const fixation = (cd.parent_profile || {}).elite_school_fixation;
      const academic = (cd.student_profile || {}).academic_level;
      return fixation === 'strong' && ['medium', 'below_medium'].includes(academic);
    },
    severity: 'medium',
    shouldFollowUp: true,
    followUpText: '你期待顶尖名校，但孩子目前成绩在中等水平。我想帮你看清楚这个差距——你们目前有没有具体的提分计划？',
    pathConfidenceImpact: -0.10,
    pathNote: '家长期望与孩子现实有较大落差，推荐名单应以匹配/保底为主',
  },
  // ─── 规则2：英语自评与细分层级矛盾 ──────────────────────────────
  {
    id: 'cr_english_sublevel_override',
    description: 'english_level声称basic但sublevel是zero，应覆盖为weak',
    check: (cd) => {
      const sp = cd.student_profile || {};
      return sp.english_level === 'basic' && sp._english_sublevel === 'zero';
    },
    severity: 'hard',
    shouldFollowUp: false,
    followUpText: null,
    pathConfidenceImpact: -0.15,
    // 自动修正：直接改 english_level
    autoFix: (cd) => {
      if (cd.student_profile) cd.student_profile.english_level = 'weak';
    },
    pathNote: '英语细分级别显示接近零基础，系统已修正为weak级别',
  },
  // ─── 规则3：独立性声称高但无行为佐证 ────────────────────────────
  {
    id: 'cr_independence_no_behavior',
    description: '独立性声称high但证据记录仅为parent_impression',
    check: (cd) => {
      const indep = (cd.student_profile || {}).independence_level;
      if (indep !== 'high') return false;
      const evidenceLog = (cd.evidence_log || []).filter(e => e.slot === 'independence_capacity');
      const hasBehavior = evidenceLog.some(e =>
        ['behavior_observation', 'third_party_observation', 'child_self_report'].includes(e.evidenceType)
      );
      return !hasBehavior;
    },
    severity: 'soft',
    shouldFollowUp: false,
    followUpText: '你说孩子独立性很强——能举个具体的例子吗？比如有没有独立解决过什么问题？',
    pathConfidenceImpact: -0.05,
    pathNote: '独立性判断仅基于家长印象，置信度偏低',
  },
  // ─── 规则4：留学意向与家庭接受度冲突 ────────────────────────────
  {
    id: 'cr_intent_vs_acceptance',
    description: '学生留学意向eager但家庭strongly_against',
    check: (cd) => {
      const attitude   = (cd.student_profile || {}).overseas_attitude;
      const acceptance = (cd.family_profile || {}).family_overseas_acceptance;
      return attitude === 'eager' && acceptance === 'strongly_against';
    },
    severity: 'hard',
    shouldFollowUp: true,
    followUpText: '孩子很想出国，但家里明确反对——这个分歧现在是什么状态？有没有在讨论解决方案？',
    pathConfidenceImpact: -0.20,
    pathNote: '孩子意愿与家庭立场冲突，路径执行风险极高',
  },
  // ─── 规则5：目标国家与预算不匹配 ────────────────────────────────
  {
    id: 'cr_country_budget_mismatch',
    description: '目标美国/英国但预算under10w或10_20w',
    check: (cd) => {
      const geo    = (cd.answers || {}).geo_preference;
      const budget = (cd.family_profile || {}).annual_education_budget;
      const highCostGeo = ['us', 'uk'];
      const lowBudget   = ['under10w', '10_20w'];
      return highCostGeo.includes(geo) && lowBudget.includes(budget);
    },
    severity: 'hard',
    shouldFollowUp: true,
    followUpText: '你希望去英美，但当前预算和英美院校实际费用（年均40-80万）有较大差距——这个预算是当前估计，还是已经是上限了？',
    pathConfidenceImpact: -0.20,
    pathNote: '目标国家与预算不匹配，需在报告中明确说明并转向替代地区',
  },
  // ─── 规则6：时间线与英语水平冲突 ────────────────────────────────
  {
    id: 'cr_timeline_english_conflict',
    description: '6个月内决定但英语weak',
    check: (cd) => {
      const timeline = (cd.family_profile || {}).decision_timeline;
      const english  = (cd.student_profile || {}).english_level;
      return ['within6m'].includes(timeline) && english === 'weak';
    },
    severity: 'hard',
    shouldFollowUp: false,
    followUpText: null, // 已由 q_timeline_reality 问题覆盖
    pathConfidenceImpact: -0.20,
    pathNote: '6个月内决定 + 英语极弱：时间窗口危机，只能推荐阶段性备战路径',
  },
  // ─── 规则7：国际学校 + 明确不出国 ───────────────────────────────
  {
    id: 'cr_intl_school_no_overseas',
    description: '国际学校学生但有_no_overseas标记',
    check: (cd) => {
      const school = (cd.student_profile || {}).school_type;
      const noOverseas = (cd.family_profile || {})._no_overseas;
      return school === 'international' && noOverseas;
    },
    severity: 'medium',
    shouldFollowUp: true,
    followUpText: '孩子读国际学校但你说不考虑出国——国际学校通常是留学路径的准备，这个选择背后是什么考虑？',
    pathConfidenceImpact: -0.10,
    pathNote: '国际学校 + 不出国：路径存在矛盾，需在报告中厘清',
  },
  // ─── 规则8：盲目决策风险 ─────────────────────────────────────────
  {
    id: 'cr_blind_decision',
    description: '想出国 + overseas_understanding=none + 无具体证据',
    check: (cd) => {
      const understanding = (cd.parent_profile || {}).overseas_understanding;
      const attitude      = (cd.student_profile || {}).overseas_attitude;
      const wantsAbroad   = ['eager', 'acceptable'].includes(attitude);
      const evidenceLog   = cd.evidence_log || [];
      const hasAnyGrade   = evidenceLog.some(e => e.evidenceType === 'grade_report');
      return wantsAbroad && understanding === 'none' && !hasAnyGrade;
    },
    severity: 'medium',
    shouldFollowUp: true,
    followUpText: '你们想出国，但对具体流程还不太了解，也还没有孩子的具体成绩数据——这个阶段，我建议先把"了解信息"作为优先级，再做路径决定。你们现在有没有渠道获取这些信息？',
    pathConfidenceImpact: -0.10,
    pathNote: '盲目决策风险：缺乏信息基础的留学意向',
  },
  // ─── 规则9：高成绩声称但只有家长印象 ────────────────────────────
  {
    id: 'cr_academic_no_evidence',
    description: 'top10声称但证据仅为parent_impression',
    check: (cd) => {
      const academic = (cd.student_profile || {}).academic_level;
      if (academic !== 'top10') return false;
      const evidenceLog = (cd.evidence_log || []).filter(e => e.slot === 'academic_reality');
      const hasStrongEvidence = evidenceLog.some(e =>
        ['grade_report', 'teacher_feedback', 'third_party_observation'].includes(e.evidenceType)
      );
      return !hasStrongEvidence;
    },
    severity: 'soft',
    shouldFollowUp: false,
    followUpText: null,
    pathConfidenceImpact: -0.05,
    pathNote: 'top10学业声称缺乏具体证据支撑，置信度轻微降低',
  },
  // ─── 规则10：孩子抗拒 + 家长热切 ────────────────────────────────
  {
    id: 'cr_kid_resistant_parent_eager',
    description: '孩子overseas_attitude=resistant + 家庭fully接受',
    check: (cd) => {
      const attitude   = (cd.student_profile || {}).overseas_attitude;
      const acceptance = (cd.family_profile || {}).family_overseas_acceptance;
      return attitude === 'resistant' && acceptance === 'fully';
    },
    severity: 'medium',
    shouldFollowUp: true,
    followUpText: '家长完全支持出国，但孩子本身有些抗拒——孩子的抗拒是表面的，还是比较坚定？这会很大程度上影响路径建议。',
    pathConfidenceImpact: -0.10,
    pathNote: '孩子抗拒留学，家长热切；路径需考虑孩子意愿，不能只推留学',
  },
  // ─── 规则11：预算 vs 目标层级（亚太+欧陆超预算）────────────────
  {
    id: 'cr_budget_overclaim',
    description: 'over80w预算 + 只考虑asia_pacific/europe（可能过度预算）',
    check: (cd) => {
      const budget = (cd.family_profile || {}).annual_education_budget;
      const geo    = (cd.answers || {}).geo_preference;
      return budget === 'over80w' && ['asia_pacific', 'europe'].includes(geo);
    },
    severity: 'soft',
    shouldFollowUp: false,
    followUpText: null,
    pathConfidenceImpact: 0, // 不扣分，只记录
    pathNote: '超高预算 + 非英美目标：可能存在预算未充分利用，可以考虑更高层级院校',
  },
  // ─── 规则12：abroad_prep路径 + 预算under10w ──────────────────────
  {
    id: 'cr_prep_path_budget',
    description: '路径判断为abroad_prep但预算under10w',
    check: (cd) => {
      const path   = (cd.pathJudgment || {}).primaryPath;
      const budget = (cd.family_profile || {}).annual_education_budget;
      return path === 'abroad_prep' && budget === 'under10w';
    },
    severity: 'medium',
    shouldFollowUp: false,
    followUpText: null,
    pathConfidenceImpact: -0.10,
    pathNote: '阶段性备战路径 + 预算10万以内：备考成本可能超出预算，需在报告中明确说明',
  },
];

// ══ 主函数：checkConsistency(cd) ══════════════════════════════════════
// 返回：{ violations, warnings, confidenceAdjustment, followUpTexts, autoFixApplied }
function checkConsistency(cd) {
  const violations = [];
  const warnings   = [];
  const followUpTexts = [];
  let confidenceAdjustment = 0;
  const autoFixApplied = [];

  CONSISTENCY_RULES.forEach(rule => {
    let triggered = false;
    try {
      triggered = rule.check(cd);
    } catch (e) {
      console.warn('[consistency_engine] rule check failed:', rule.id, e);
    }
    if (!triggered) return;

    // 执行自动修正（如果有）
    if (typeof rule.autoFix === 'function') {
      try { rule.autoFix(cd); autoFixApplied.push(rule.id); } catch(e) {}
    }

    confidenceAdjustment += rule.pathConfidenceImpact || 0;

    if (rule.severity === 'hard' || rule.severity === 'medium') {
      violations.push({
        ruleId:      rule.id,
        description: rule.description,
        severity:    rule.severity,
        pathNote:    rule.pathNote || '',
      });
    } else {
      warnings.push({
        ruleId:      rule.id,
        description: rule.description,
        pathNote:    rule.pathNote || '',
      });
    }

    if (rule.shouldFollowUp && rule.followUpText) {
      followUpTexts.push({
        ruleId: rule.id,
        text:   rule.followUpText,
      });
    }
  });

  // 置信度修正上下限：最多扣 60%
  confidenceAdjustment = Math.max(confidenceAdjustment, -0.60);

  return {
    violations,          // hard/medium 不一致
    warnings,            // soft 提醒
    confidenceAdjustment,// 负数，扣除置信度
    followUpTexts,       // 一致性触发的追问（取第一条最高优先级）
    autoFixApplied,      // 已自动修正的规则
  };
}

// ══ 将一致性结果应用到 cd ═════════════════════════════════════════════
function applyConsistencyToCD(cd, consistencyResult) {
  cd._consistencyResult = consistencyResult;
  // 将置信度修正写入 cd，供 path_engine 读取
  cd._consistencyConfidenceAdj = consistencyResult.confidenceAdjustment;
}

// ══ 构建一致性摘要文本（供 buildAnalysisPrompt 注入）════════════════
function buildConsistencyText(cd) {
  const result = cd._consistencyResult;
  if (!result || (result.violations.length === 0 && result.warnings.length === 0)) return '';

  const lines = [];
  if (result.violations.length > 0) {
    lines.push('## 一致性检查发现（请在报告中有选择性地体现）');
    result.violations.forEach(v => {
      lines.push(`- [${v.severity.toUpperCase()}] ${v.description}：${v.pathNote}`);
    });
  }
  if (result.warnings.length > 0) {
    lines.push('## 软性提醒');
    result.warnings.forEach(w => {
      lines.push(`- ${w.description}：${w.pathNote}`);
    });
  }
  return lines.join('\n');
}

module.exports = {
  CONSISTENCY_RULES,
  checkConsistency,
  applyConsistencyToCD,
  buildConsistencyText,
};
