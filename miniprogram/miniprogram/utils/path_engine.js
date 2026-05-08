// utils/path_engine.js
// 袁希™ v1 — 路径判断引擎（升级版）
// ─────────────────────────────────────────────────────────────────────
// 职责：纯函数，输入 cd，输出5字段路径判断
// 变更：整合 hard_rules.js 硬门槛 + timeline_engine.js + explain_engine.js
// 路径类型：gaokao / abroad / abroad_prep / dual_track / pending（共4+1）
// ─────────────────────────────────────────────────────────────────────

const { getSessionStatus, FIELD_DEFAULTS, writeDecisionLog } = require('./field_schema');

// ── 原 hard_rules / timeline_engine / explain_engine 已移除（国内高考内容）──
// 以下存根保持 path_engine 接口不变，同时让出国为主的逻辑正常运行

function checkHardRules(_cd) {
  return { hasHardBlock: false, triggeredIds: [], explanations: [], primaryRedirect: null };
}
function isPathBlocked(_path, _hardResult) {
  return false;
}
function calcTimeline(_cd) {
  return { reassessAt: '建议一年内根据孩子发展情况定期复评' };
}
function buildExplanations(_cd, _result, _hardResult) {
  return [];
}

// ══ 辅助函数 ═══════════════════════════════════════════════════════
function sp(cd) { return cd.student_profile || {}; }
function pp(cd) { return cd.parent_profile  || {}; }
function fp(cd) { return cd.family_profile  || {}; }
function ans(cd){ return cd.answers         || {}; }

// 安全读取字段（如果缺失，用默认值）
function get(cd, profile, key) {
  const val = (cd[profile] || {})[key];
  if (val !== null && val !== undefined && val !== '') return val;
  return (FIELD_DEFAULTS[profile] || {})[key] || null;
}

// ══ 高考主路径信号 ════════════════════════════════════════════════════
// 满足 4 项及以上 → 偏高考
function calcGaokaoScore(cd) {
  const s = sp(cd), f = fp(cd), p = pp(cd), a = ans(cd);
  let score = 0;
  const signals = [];

  // 1. 学业成绩优秀
  if (['top10','top30'].includes(s.academic_level)) {
    score++;
    signals.push('成绩优秀，高考路径竞争力强');
  }

  // 2. 英语基础薄弱
  if (['weak','basic'].includes(s.english_level)) {
    score++;
    signals.push('英语基础尚薄，留学路径语言准备成本高');
  }

  // 3. 预算有限
  if (['under10w','10_20w'].includes(f.annual_education_budget)) {
    score++;
    signals.push('年度预算在国内高考范围内，留学费用压力较大');
  }

  // 4. 家庭不接受海外定居
  if (['prefer_not','strongly_against'].includes(f.family_overseas_acceptance)) {
    score++;
    signals.push('家庭倾向孩子在国内发展');
  }

  // 5. 孩子抗拒出国
  if (s.overseas_attitude === 'resistant') {
    score++;
    signals.push('孩子本人对出国表达了抗拒');
  }

  // 6. 时间窗口极紧（高三 + 6个月内）
  if (s.grade_group === 'high' && f.decision_timeline === 'within6m') {
    score++;
    signals.push('当前处于高三，决策时间窗口极短');
  }

  // 7. 对留学完全不了解
  if (p.overseas_understanding === 'none') {
    score++;
    signals.push('家庭对留学体系了解有限，准备成本高');
  }

  // 8. 明确选择国内
  if (a.geo_preference === 'cn_only' || a.education_path_preference === 'gaokao') {
    score += 2; // 明确意向双倍计分
    signals.push('家庭明确表达了国内路径意向');
  }

  return { score, signals };
}

// ══ 排除条件：高考路径 ════════════════════════════════════════════════
function checkGaokaoExclusions(cd) {
  const s = sp(cd), a = ans(cd);
  const exclusions = [];

  if (s.school_type === 'international') {
    exclusions.push('就读国际学校（IB/AP/A-Level课程体系），无法参加高考');
  }
  if (
    ['fully'].includes((cd.family_profile || {}).family_overseas_acceptance) &&
    s.overseas_attitude === 'eager' &&
    ['conversational','fluent','native'].includes(s.english_level)
  ) {
    exclusions.push('家庭完全接受海外发展 + 孩子主动想出国 + 英语已达标，留学条件成熟');
  }

  return exclusions;
}

// ══ 留学主路径信号 ════════════════════════════════════════════════════
// 满足 4 项及以上 → 偏留学
function calcAbroadScore(cd) {
  const s = sp(cd), f = fp(cd), a = ans(cd);
  let score = 0;
  const signals = [];

  // 1. 英语达标
  if (['conversational','fluent','native'].includes(s.english_level)) {
    score++;
    signals.push('英语能力已具备留学基础门槛');
  }

  // 2. 预算充足
  if (['40_80w','over80w'].includes(f.annual_education_budget)) {
    score++;
    signals.push('年度预算能覆盖海外大学费用');
  }

  // 3. 家庭接受海外发展
  if (['fully','acceptable'].includes(f.family_overseas_acceptance)) {
    score++;
    signals.push('家庭对孩子海外发展持开放态度');
  }

  // 4. 孩子主动想出国或可以接受
  if (['eager','acceptable'].includes(s.overseas_attitude)) {
    score++;
    signals.push('孩子本人对出国持开放或主动态度');
  }

  // 5. 独立性较强（如果有数据）
  if (s.independence_level && ['high','medium'].includes(s.independence_level)) {
    score++;
    signals.push('孩子独立性较强，适应海外生活能力具备');
  }

  // 6. 国际学校或双语学校
  if (['international','bilingual'].includes(s.school_type)) {
    score++;
    signals.push('已在国际化学校就读，留学路径衔接顺畅');
  }

  // 7. 时间窗口充足（初中及以下，或高一高二）
  if (s.grade_group === 'primary' || s.grade_group === 'middle') {
    score++;
    signals.push('时间窗口充裕，有充足准备空间');
  }

  // 8. 明确海外目标
  const ABROAD_GEOS = ['us','uk','canada','au_nz','asia_pacific','europe'];
  if (ABROAD_GEOS.includes(a.geo_preference)) {
    score += 2;
    signals.push('家庭明确表达了海外目标国家/地区意向');
  }

  return { score, signals };
}

// ══ 排除条件：留学路径 ════════════════════════════════════════════════
function checkAbroadExclusions(cd) {
  const s = sp(cd), f = fp(cd);
  const exclusions = [];

  if (s.english_level === 'weak' && f.decision_timeline === 'within6m') {
    exclusions.push('英语基础薄弱 + 决策时间仅6个月，时间不够弥补语言差距');
  }
  if (f.family_overseas_acceptance === 'strongly_against') {
    exclusions.push('家庭强烈反对孩子海外发展');
  }
  if (s.overseas_attitude === 'resistant' && s.motivation_source === 'external') {
    exclusions.push('孩子明确抗拒出国，且驱动力主要来自外部压力，强行推动风险极高');
  }

  return exclusions;
}

// ══ 双轨并行信号 ════════════════════════════════════════════════════
// 满足 3 项及以上 → 偏双轨
function calcDualTrackScore(cd) {
  const s = sp(cd), f = fp(cd);
  let score = 0;
  const signals = [];

  // 1. 学业中等偏上
  if (['top30','medium'].includes(s.academic_level)) {
    score++;
    signals.push('学业中等偏上，高考和留学均有一定竞争力');
  }

  // 2. 英语有基础但未达标
  if (['basic','conversational'].includes(s.english_level)) {
    score++;
    signals.push('英语有基础，留学条件尚在发展中');
  }

  // 3. 预算中等（能支撑双轨）
  if (['20_40w','40_80w'].includes(f.annual_education_budget)) {
    score++;
    signals.push('预算在可支撑双轨的合理区间');
  }

  // 4. 家庭态度可以接受留学
  if (f.family_overseas_acceptance === 'acceptable') {
    score++;
    signals.push('家庭对留学持开放态度，但尚未完全确定');
  }

  // 5. 时间窗口充裕（初中/高一，有准备空间）
  if (s.grade_group === 'middle' ||
     (s.grade_group === 'high' && !['within6m'].includes(f.decision_timeline))) {
    score++;
    signals.push('时间窗口有一定余量，双轨路径准备成本可控');
  }

  // 6. 孩子态度未定或可以接受
  if (['acceptable','unclear'].includes(s.overseas_attitude)) {
    score++;
    signals.push('孩子对出国方向尚在观望，双轨给予最大灵活性');
  }

  return { score, signals };
}

// ══ 延迟判断条件检查 ════════════════════════════════════════════════
function checkPendingConditions(cd) {
  const s = sp(cd), f = fp(cd), a = ans(cd);
  const { missing } = getSessionStatus(cd);
  const reasons = [];

  // 核心字段缺失 3 项以上
  if (missing.length >= 3) {
    reasons.push(`关键信息尚未采集完整（缺少：${missing.slice(0, 3).join('、')}等）`);
  }

  // 预算 < 10万 但有英美留学意向（严重矛盾）
  if (
    f.annual_education_budget === 'under10w' &&
    ['us','uk'].includes(a.geo_preference)
  ) {
    reasons.push('预算与目标国家存在严重缺口（英美留学年费 40-80 万，预算不足 10 万）');
  }

  // 孩子抗拒 but 家庭完全支持（需深入澄清）
  if (s.overseas_attitude === 'resistant' && f.family_overseas_acceptance === 'fully') {
    reasons.push('孩子与家长在出国方向上存在明显冲突，建议先对齐内部意见再做决策');
  }

  return reasons;
}

// ══ 主函数：judgePath(cd) v1 ══════════════════════════════════════════
// 输入：collectedData 对象
// 输出：{
//   primaryPath:         'gaokao' | 'abroad' | 'abroad_prep' | 'dual_track' | 'pending'
//   confidence:          0.0 ~ 1.0
//   reasons:             string[]   当前路径的判断依据（3条以内）
//   alternativeBlocked:  string[]   为什么暂时不能走备选路径
//   transitionConditions:string[]   要切换路径，需要先做什么
//   reassessAt:          string     建议何时重新评估
//   missingFields:       string[]
//   missingHighPriority: [{field, label}]
//   hardResult:          object     硬门槛扫描结果
//   timeline:            object     准备时间线（timeline_engine输出）
//   explanations:        object[]   透明解释层输出
//   exclusions:          string[]
//   debugInfo:           object
// }
function judgePath(cd) {
  const { missing } = getSessionStatus(cd);

  // ── Step 1: 硬门槛检查（最高优先级，覆盖所有软评分）────────────
  const hardResult = checkHardRules(cd);

  // ── Step 2: 检查是否应该延迟判断 ──────────────────────────────────
  const pendingReasons = checkPendingConditions(cd);
  if (pendingReasons.length > 0 && missing.length >= 3) {
    const tl = calcTimeline(cd);
    const result = {
      primaryPath:          'pending',
      confidence:           0.2,
      reasons:              ['目前收集到的信息还不足以给出可靠的路径判断。'],
      alternativeBlocked:   [],
      transitionConditions: missing.slice(0, 3).map(f => `补充字段：${f}`),
      reassessAt:           '补充关键信息后立即重新评估',
      missingFields:        missing,
      missingHighPriority:  [],
      hardResult,
      timeline:             tl,
      explanations:         [],
      exclusions:           [],
      debugInfo:            { pendingReasons },
    };
    writeDecisionLog(cd, result, hardResult, tl);
    return result;
  }

  // ── Step 3: 计算三条路径得分 ──────────────────────────────────────
  const gaokao = calcGaokaoScore(cd);
  const abroad = calcAbroadScore(cd);
  const dual   = calcDualTrackScore(cd);

  const gaokaoExcl = checkGaokaoExclusions(cd);
  const abroadExcl = checkAbroadExclusions(cd);

  // ── Step 4: 整合硬门槛 → 确定主路径 ──────────────────────────────
  // 硬门槛阻断优先于软评分
  const hardBlocksAbroad    = isPathBlocked('abroad',      hardResult);
  const hardBlocksDual      = isPathBlocked('dual_track',  hardResult);
  const hardBlocksAbroadPrep = isPathBlocked('abroad_prep', hardResult);

  let primaryPath, reasons, exclusions, rawScore, maxPossibleScore;
  let alternativeBlocked   = [];
  let transitionConditions = [];

  // 情况A：硬门槛强制进入高考
  if (hardResult.hasHardBlock && hardResult.primaryRedirect === 'gaokao') {
    primaryPath = 'gaokao';
    reasons     = gaokao.signals.slice(0, 3);
    if (reasons.length === 0) reasons = ['当前硬性条件约束，高考是最可执行的路径'];
    exclusions  = hardResult.explanations.slice(0, 2);
    alternativeBlocked = hardResult.explanations.slice(0, 2);
    transitionConditions = _buildTransitionConditions(cd, 'gaokao', hardResult);
    rawScore    = gaokao.score;
    maxPossibleScore = 10;

  // 情况B：硬门槛强制进入阶段性备战
  } else if (hardResult.hasHardBlock && hardResult.primaryRedirect === 'abroad_prep') {
    primaryPath = 'abroad_prep';
    reasons     = [
      '当前条件暂不支持直接申请，阶段性备战是最现实的推进方式',
      ...gaokao.signals.slice(0, 1),
    ].slice(0, 3);
    exclusions  = hardResult.explanations.slice(0, 2);
    alternativeBlocked = hardResult.explanations.slice(0, 2);
    transitionConditions = _buildTransitionConditions(cd, 'abroad_prep', hardResult);
    rawScore    = Math.max(abroad.score, dual.score);
    maxPossibleScore = 10;

  // 情况C：软排除 — 高考不可行，国际学校等
  } else if (gaokaoExcl.length > 0 && !hardBlocksAbroad) {
    primaryPath = 'abroad';
    reasons     = abroad.signals.slice(0, 3);
    exclusions  = gaokaoExcl;
    alternativeBlocked = gaokaoExcl.slice(0, 2);
    transitionConditions = ['当前走国际课程体系，直接申请海外大学是自然延续'];
    rawScore    = abroad.score;
    maxPossibleScore = 10;

  // 情况D：留学软排除
  } else if (abroadExcl.length > 0 && !hardBlocksAbroad) {
    primaryPath = 'gaokao';
    reasons     = gaokao.signals.slice(0, 3);
    exclusions  = abroadExcl;
    alternativeBlocked = abroadExcl.slice(0, 2);
    transitionConditions = _buildTransitionConditions(cd, 'gaokao', hardResult);
    rawScore    = gaokao.score;
    maxPossibleScore = 10;

  // 情况E：留学信号强
  } else if (!hardBlocksAbroad && abroad.score >= 4 && abroad.score >= gaokao.score) {
    primaryPath = 'abroad';
    reasons     = abroad.signals.slice(0, 3);
    exclusions  = gaokaoExcl;
    alternativeBlocked = [];
    transitionConditions = [];
    rawScore    = abroad.score;
    maxPossibleScore = 10;

  // 情况F：高考信号强
  } else if (gaokao.score >= 4 && gaokao.score >= abroad.score) {
    primaryPath = 'gaokao';
    reasons     = gaokao.signals.slice(0, 3);
    exclusions  = abroadExcl;
    alternativeBlocked = abroadExcl.slice(0, 1);
    transitionConditions = _buildTransitionConditions(cd, 'gaokao', hardResult);
    rawScore    = gaokao.score;
    maxPossibleScore = 10;

  // 情况G：双轨
  } else if (!hardBlocksDual && dual.score >= 3) {
    primaryPath = 'dual_track';
    reasons     = dual.signals.slice(0, 3);
    exclusions  = [];
    alternativeBlocked = [];
    transitionConditions = ['保持双轨，根据孩子发展情况逐步收敛到单一路径'];
    rawScore    = dual.score;
    maxPossibleScore = 7;

  // 情况H：信号不足 → abroad_prep作为保守推荐
  } else if (!hardBlocksAbroadPrep) {
    primaryPath = 'abroad_prep';
    reasons     = ['各方向信号尚不明确，阶段性备战是最保守且最可行的方案'];
    exclusions  = [];
    alternativeBlocked = [];
    transitionConditions = _buildTransitionConditions(cd, 'abroad_prep', hardResult);
    rawScore    = 2;
    maxPossibleScore = 10;

  } else {
    primaryPath = 'pending';
    reasons     = ['信息不足以给出判断，请补充关键信息'];
    exclusions  = [];
    alternativeBlocked = [];
    transitionConditions = [];
    rawScore    = 0;
    maxPossibleScore = 1;
  }

  // ── Step 5: 置信度计算（含 consistency_engine 修正）─────────────
  let confidence = Math.min(rawScore / maxPossibleScore, 1.0);
  const missingPenalty = missing.length * 0.07;
  confidence = Math.max(0.1, confidence - missingPenalty);
  if (exclusions.length > 0 || hardResult.hasHardBlock) {
    confidence = Math.min(1.0, confidence + 0.15);
  }
  // 一致性检查修正（从 cd._consistencyConfidenceAdj 读取，由 consistency_engine 写入）
  const consistencyAdj = cd._consistencyConfidenceAdj || 0;
  confidence = Math.max(0.1, confidence + consistencyAdj);
  confidence = Math.round(confidence * 100) / 100;

  // ── Step 6: 优先补采字段 ──────────────────────────────────────────
  const FILL_GAP_PRIORITY = [
    { field: 'student_profile.independence_level',  label: '孩子的独立生活能力' },
    { field: 'student_profile.resilience_level',    label: '孩子的抗压能力' },
    { field: 'student_profile.overseas_attitude',   label: '孩子对出国的真实态度' },
    { field: 'student_profile.motivation_source',   label: '孩子的学习驱动来源' },
    { field: 'parent_profile.control_level',        label: '家长的决策参与方式' },
    { field: 'parent_profile.overseas_understanding', label: '家长对留学的了解程度' },
  ];
  const missingHighPriority = FILL_GAP_PRIORITY.filter(item => {
    const [profile, key] = item.field.split('.');
    const val = (cd[profile] || {})[key];
    return val === null || val === undefined || val === '';
  }).slice(0, 2);

  // ── Step 7: 时间线估算 ────────────────────────────────────────────
  const timeline = calcTimeline(cd);

  // ── Step 8: 解释透明层 ────────────────────────────────────────────
  const partialResult = { primaryPath, confidence };
  const explanations = buildExplanations(cd, partialResult, hardResult);

  // ── Step 9: 建议重评时间点 ────────────────────────────────────────
  const reassessAt = timeline.reassessAt;

  // ── Step 10: 写入 decision_log ────────────────────────────────────
  const finalResult = {
    primaryPath,
    confidence,
    reasons,
    alternativeBlocked,
    transitionConditions,
    reassessAt,
    missingFields:       missing,
    missingHighPriority,
    hardResult,
    timeline,
    explanations,
    exclusions,
    debugInfo: {
      gaokaoScore:   gaokao.score,
      abroadScore:   abroad.score,
      dualScore:     dual.score,
      pendingReasons,
      hardTriggered: hardResult.triggeredIds,
    },
  };

  writeDecisionLog(cd, finalResult, hardResult, timeline);
  return finalResult;
}

// ── 辅助：生成切换路径的前提条件 ─────────────────────────────────────
function _buildTransitionConditions(cd, currentPath, hardResult) {
  const s = cd.student_profile || {};
  const conditions = [];

  if (currentPath === 'gaokao') {
    if (['weak', 'basic'].includes(s.english_level)) {
      conditions.push('将英语提升至日常交流水平（雅思 5.5+）');
    }
    if (s.independence_level === 'low') {
      conditions.push('系统性培养独立生活能力（建议9-18个月）');
    }
    if (hardResult.maxPrepMonths > 0) {
      conditions.push(`完成阶段性准备（预计${hardResult.maxPrepMonths}个月以上）`);
    }
    if (conditions.length === 0) {
      conditions.push('当前高考路径已完成后，可重新评估留学研究生阶段');
    }
  } else if (currentPath === 'abroad_prep') {
    if (['weak', 'basic'].includes(s.english_level)) {
      conditions.push('语言达标（雅思 6.0+）后立即可转入正式申请');
    }
    if (s.independence_level === 'low') {
      conditions.push('独立性培养完成后，直接申请可行性大幅提升');
    }
    if (conditions.length === 0) {
      conditions.push('完成准备阶段后，路径可以直接升级为留学主路径');
    }
  }

  return conditions.slice(0, 3);
}

// ══ 路径标签（4类 + pending）════════════════════════════════════════
const PATH_LABELS = {
  gaokao:      { label: '国内高考主路径',       icon: '📚', color: '#1a6ee8' },
  abroad:      { label: '海外留学主路径',       icon: '🌍', color: '#0a8a4a' },
  abroad_prep: { label: '阶段性备战留学路径',   icon: '🌱', color: '#d97706' },
  dual_track:  { label: '高考与留学双轨并行',   icon: '🔀', color: '#b06000' },
  pending:     { label: '信息补充中',           icon: '🔍', color: '#666666' },
};

// 生成展示给用户的路径确认文本（S8 用）
// v1 升级：包含5字段结构 — 主路径/依据/暂时不能走另一路的原因/转向条件/重评时间
function buildPathConfirmText(pathJudgment, childName) {
  const name = childName || '孩子';
  const pj   = pathJudgment;
  const pl   = PATH_LABELS[pj.primaryPath] || PATH_LABELS.pending;
  const conf = Math.round(pj.confidence * 100);

  if (pj.primaryPath === 'pending') {
    return `根据目前信息，我还需要多了解一些才能做出可靠判断。\n\n${(pj.reasons || []).join('\n')}`;
  }

  // ① 主路径 + 置信度
  let text = `根据你告诉我的信息，我目前的判断是：\n\n`;
  text += `${pl.icon} ${name} 当前更适合【${pl.label}】\n`;
  text += `判断置信度：${conf}%\n\n`;

  // ② 为什么推这条路径
  const reasonLines = (pj.reasons || [])
    .slice(0, 3)
    .map((r, i) => `${['①','②','③'][i]} ${r}`)
    .join('\n');
  text += `主要依据：\n${reasonLines}\n`;

  // ③ 为什么暂时不能直接走备选路径（仅当有阻断原因时展示）
  const blocked = pj.alternativeBlocked || [];
  if (blocked.length > 0) {
    text += `\n暂时不能直接走留学/出国路径的原因：\n`;
    text += blocked.slice(0, 2).map(b => `• ${b}`).join('\n') + '\n';
  }

  // ④ 如果未来想转向，需要先做什么
  const transitions = pj.transitionConditions || [];
  if (transitions.length > 0) {
    text += `\n如果后续想调整方向，需要先完成：\n`;
    text += transitions.slice(0, 3).map(t => `→ ${t}`).join('\n') + '\n';
  }

  // ⑤ 建议重评时间
  if (pj.reassessAt) {
    text += `\n📅 ${pj.reassessAt}\n`;
  }

  text += `\n这个判断方向和你的预期一致吗？`;
  return text;
}

module.exports = {
  judgePath,
  buildPathConfirmText,
  PATH_LABELS,
};
