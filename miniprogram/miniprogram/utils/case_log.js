// utils/case_log.js
// 袁希™ — 案例沉淀框架 v1
// ─────────────────────────────────────────────────────────────────────
// 职责：
//   1. 定义 15 字段案例结构（9 必填 + 6 预留）
//   2. initCaseLog(cd) — 在 FLOW 开始时初始化
//   3. writeCaseLog(cd, pathResult, consistencyResult) — 在 _startAnalysis 写入
//   4. exportCaseLog(cd) — 导出用于后续分析（存入 wx.setStorage 或云端）
//
// 案例如何帮助持续优化：
//   a. 问题设计优化：分析哪些槽位"经常未填"→ FLOW 缺少对应问题
//   b. 规则优化：统计哪些 consistency_rule 频繁触发→ 是规则问题还是用户问题
//   c. 解释模板优化：统计 user_acknowledged=false 时最常见的 deviation_reasons
//   d. 推荐优化：统计 user_rejection_points 与学校层级的关系
// ─────────────────────────────────────────────────────────────────────

// ══ 15 字段案例 Schema ════════════════════════════════════════════════
const CASE_LOG_SCHEMA = {
  // ─── 必填字段（本次实现，9个）───────────────────────────────────
  case_id:                null,   // 唯一标识（timestamp+random）
  created_at:             null,   // ISO 时间戳
  user_initial_preference: null,  // 用户最初表达的倾向（首题开放回答前几个词）
  key_answers: {                  // 最关键的 3-5 个判断槽位答案
    academic_level:       null,   // top10/top30/medium/below_medium
    english_level:        null,   // weak/basic/conversational/fluent
    overseas_attitude:    null,   // eager/acceptable/resistant
    family_acceptance:    null,   // fully/acceptable/prefer_not/strongly_against
    budget:               null,   // under10w/...
  },
  evidence_types_seen:    [],     // 出现的证据类型列表（uniqued）
  consistency_violations: [],     // 触发的一致性规则 id 列表
  system_path:            null,   // 系统最终输出路径
  deviation_from_preference: false, // 系统路径是否偏离用户初始意向
  deviation_reasons:      [],     // 偏离原因（从 pathJudgment.reasons 提取）
  user_acknowledged:      null,   // 用户是否认可（从 q_path_confirm 提取）

  // ─── 预留扩展字段（未来采集，6个）──────────────────────────────
  user_rejection_points:  [],     // 用户最不认可的点（未来追问时采集）
  follow_up_count:        0,      // 本次对话中追问次数
  slot_completion_rate:   null,   // 槽位完整率（0-1）
  path_confidence:        null,   // 最终置信度
  reassess_at:            null,   // 建议重新评估时间点
  session_duration_mins:  null,   // 会话时长（分钟）

  // ─── v2 新增字段（学习回路 + 宪法守卫）──────────────────────────
  constitution_violations: [],    // 输出守卫捕获的宪法违规 id 列表
  dispatch_interrupts:    0,      // 本次对话中用户反问/打断的次数
  semantic_vague_count:   0,      // 语义判断为"真正模糊"并触发追问的次数
};

// ══ 初始化案例日志（在 FLOW 最开始调用）══════════════════════════════
function initCaseLog(cd) {
  cd.caseLog = {
    case_id: `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
    user_initial_preference: null,
    key_answers: {
      academic_level: null,
      english_level:  null,
      overseas_attitude: null,
      family_acceptance: null,
      budget: null,
    },
    evidence_types_seen:       [],
    consistency_violations:    [],
    system_path:               null,
    deviation_from_preference: false,
    deviation_reasons:         [],
    user_acknowledged:         null,
    // 扩展字段（空值，未来填入）
    user_rejection_points:   [],
    follow_up_count:         0,
    slot_completion_rate:    null,
    path_confidence:         null,
    reassess_at:             null,
    session_duration_mins:   null,
    // v2 字段
    constitution_violations: [],
    dispatch_interrupts:     0,
    semantic_vague_count:    0,
  };
}

// ══ 更新初始偏好（在第一题回答后调用）═══════════════════════════════
function recordInitialPreference(cd, openAnswer) {
  if (!cd.caseLog) return;
  // 截取前 50 字，提取关键词
  const t = (openAnswer || '').slice(0, 50);
  cd.caseLog.user_initial_preference = t || '未提供';
}

// ══ 写入案例日志（在 _startAnalysis 中调用）══════════════════════════
function writeCaseLog(cd, pathResult, consistencyResult) {
  if (!cd.caseLog) initCaseLog(cd);
  const log    = cd.caseLog;
  const pj     = pathResult || cd.pathJudgment || {};
  const consis = consistencyResult || cd._consistencyResult || {};
  const sp     = cd.student_profile  || {};
  const fp     = cd.family_profile   || {};

  // ── 必填字段 ─────────────────────────────────────────────────────
  log.key_answers = {
    academic_level:   sp.academic_level   || null,
    english_level:    sp.english_level    || null,
    overseas_attitude:sp.overseas_attitude|| null,
    family_acceptance:fp.family_overseas_acceptance || null,
    budget:           fp.annual_education_budget    || null,
  };

  // 证据类型去重列表
  const evidenceLog = cd.evidence_log || [];
  const evTypes = [...new Set(evidenceLog.map(e => e.evidenceType))];
  log.evidence_types_seen = evTypes;

  // 一致性违规列表
  const violations = (consis.violations || []).map(v => v.ruleId);
  log.consistency_violations = violations;

  // 系统路径
  log.system_path = pj.primaryPath || null;

  // 是否偏离用户初始意向
  const initialPref = log.user_initial_preference || '';
  const userWantedAbroad = /出国|留学|abroad|国外/.test(initialPref);
  const userWantedGaokao = /高考|国内|不出国/.test(initialPref);
  if ((userWantedAbroad && pj.primaryPath === 'gaokao') ||
      (userWantedGaokao && ['abroad', 'dual_track'].includes(pj.primaryPath))) {
    log.deviation_from_preference = true;
    log.deviation_reasons = (pj.reasons || []).slice(0, 3);
  } else {
    log.deviation_from_preference = false;
    log.deviation_reasons = [];
  }

  // 用户认可（从 q_path_confirm 的回答中提取）
  const pathConfirmResponse = (cd.answers || {})._pathConfirmResponse || '';
  if (/一致|符合|对/.test(pathConfirmResponse)) {
    log.user_acknowledged = true;
  } else if (/不同|疑问|不认可|不对/.test(pathConfirmResponse)) {
    log.user_acknowledged = false;
    // 如果不认可，记录为 rejection point
    log.user_rejection_points = [pathConfirmResponse.slice(0, 100)];
  } else {
    log.user_acknowledged = null; // 未明确表态
  }

  // ── 扩展字段（部分可以现在填）────────────────────────────────────
  log.path_confidence = pj.confidence || null;
  log.reassess_at     = pj.reassessAt || null;

  // 追问次数（从 qualityLog 统计）
  const qualityLog = cd.qualityLog || [];
  log.follow_up_count = qualityLog.filter(l => l.probed).length;

  // 槽位完整率
  const totalSlots = 12;
  const requiredFilled = [
    sp.academic_level, sp.english_level, sp.overseas_attitude,
    fp.family_overseas_acceptance, fp.annual_education_budget,
  ].filter(Boolean).length;
  log.slot_completion_rate = Math.round((requiredFilled / totalSlots) * 100) / 100;

  // ── v2 字段：宪法违规 + 调度中断 + 语义模糊次数 ──────────────────
  log.constitution_violations = cd._constitutionViolations || [];
  log.dispatch_interrupts     = cd._dispatchInterruptCount || 0;
  log.semantic_vague_count    = (cd.qualityLog || []).filter(l =>
    l.semanticType === 'vague' && l.probed
  ).length;
}

// ══ 导出案例日志（写入本地存储，等待云端上传）════════════════════════
// 调用方：在 _onAnalysisComplete 或 _startAnalysis 末尾
function exportCaseLog(cd) {
  if (!cd.caseLog) return;
  try {
    // 读取已有案例列表，追加新案例（最多保留 50 个）
    let cases = [];
    try { cases = wx.getStorageSync('wangzi_case_logs') || []; } catch(e) {}
    cases.push(cd.caseLog);
    if (cases.length > 50) cases = cases.slice(-50);
    wx.setStorageSync('wangzi_case_logs', cases);
  } catch(e) {
    console.warn('[case_log] 写入本地存储失败:', e);
  }
}

// ══ 批量案例分析辅助（运营侧调用，不在用户流中运行）════════════════
// 返回：{ topViolations, avgCompletion, rejectionRate, avgFollowUps }
function analyzeCaseLogs(cases) {
  if (!cases || cases.length === 0) return null;

  // 最频繁触发的一致性规则
  const violationCount = {};
  cases.forEach(c => {
    (c.consistency_violations || []).forEach(v => {
      violationCount[v] = (violationCount[v] || 0) + 1;
    });
  });
  const topViolations = Object.entries(violationCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ id, count }));

  const avgCompletion = cases.reduce((s, c) => s + (c.slot_completion_rate || 0), 0) / cases.length;
  const rejectionRate = cases.filter(c => c.user_acknowledged === false).length / cases.length;
  const avgFollowUps  = cases.reduce((s, c) => s + (c.follow_up_count || 0), 0) / cases.length;

  return {
    total:          cases.length,
    topViolations,
    avgCompletion:  Math.round(avgCompletion * 100) + '%',
    rejectionRate:  Math.round(rejectionRate * 100) + '%',
    avgFollowUps:   avgFollowUps.toFixed(1),
  };
}

// ══ 学习回路：从历史案例提取系统提示（注入 buildAnalysisPrompt）══════
// 调用方：_callAIAPI() 中，在 buildAnalysisPrompt(cd) 之前执行
// 返回：string（空字符串 = 无有效历史数据）
function getSystemHints() {
  try {
    const cases = wx.getStorageSync('wangzi_case_logs') || [];
    if (cases.length < 5) return ''; // 数据不足，不注入

    const analysis = analyzeCaseLogs(cases);
    if (!analysis) return '';

    const hints = [];

    // ── 提示1：高频一致性违规（说明某些组合需要特别解释）──────────
    if (analysis.topViolations && analysis.topViolations.length > 0) {
      const topV = analysis.topViolations[0];
      hints.push(
        `历史数据提示：规则"${topV.id}"在过去${cases.length}个案例中触发${topV.count}次。`
        + `这类家庭往往存在信息自相矛盾，分析时请主动指出矛盾点并给出统一解读，而非绕过。`
      );
    }

    // ── 提示2：用户不认可率（高拒绝率 → 报告语气太强）──────────────
    const rejRate = parseFloat(analysis.rejectionRate) || 0;
    if (rejRate > 0.3) {
      hints.push(
        `历史数据提示：约${analysis.rejectionRate}的用户对系统路径判断表示不认可。`
        + `请在报告中更多地呈现"这是基于现有信息的判断，非最终结论"，给用户保留反馈空间。`
      );
    }

    // ── 提示3：平均追问次数（高追问 → 信息采集质量偏低）──────────
    const avgF = parseFloat(analysis.avgFollowUps) || 0;
    if (avgF > 2) {
      hints.push(
        `历史数据提示：平均每个案例需追问${analysis.avgFollowUps}次才能采集到有效信息。`
        + `当本次收集到的信息仍存在模糊项时，报告中请显式标注哪些判断依赖了"假设"。`
      );
    }

    // ── 提示4：宪法违规频率（说明 AI 模型有结构性偏差）──────────────
    const allConstitutionViolations = cases.flatMap(c => c.constitution_violations || []);
    if (allConstitutionViolations.length > 0) {
      const vcCount = {};
      allConstitutionViolations.forEach(v => { vcCount[v] = (vcCount[v] || 0) + 1; });
      const topVC = Object.entries(vcCount).sort((a, b) => b[1] - a[1])[0];
      if (topVC && topVC[1] >= 3) {
        const vcNames = {
          no_terminal_verdict:    '直接下"适合/不适合"定论',
          no_template_steps:      '用模板化三步计划',
          must_show_constraints:  '推荐出国路径但忽略预算/语言约束',
          no_overconfidence:      '使用"一定/肯定成功"等绝对化表述',
          no_labeling:            '给孩子贴人格类型标签',
          must_include_uncertainty: '报告缺乏不确定性声明',
        };
        hints.push(
          `历史数据提示：过去报告中"${vcNames[topVC[0]] || topVC[0]}"问题出现${topVC[1]}次。`
          + `本次请特别注意避免此类表述。`
        );
      }
    }

    if (hints.length === 0) return '';
    return '\n\n【系统历史学习提示 — 请在本次报告中注意以下模式】\n' + hints.join('\n');

  } catch (e) {
    console.warn('[case_log] getSystemHints 失败:', e);
    return '';
  }
}

module.exports = {
  CASE_LOG_SCHEMA,
  initCaseLog,
  recordInitialPreference,
  writeCaseLog,
  exportCaseLog,
  analyzeCaseLogs,
  getSystemHints,
};
