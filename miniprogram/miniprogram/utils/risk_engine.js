// utils/risk_engine.js
// 袁希™ Phase 1 — 风险识别引擎
// ─────────────────────────────────────────────────────────────────────
// 职责：纯函数，读取 cd（collectedData），输出风险标签列表
// 零 UI，零云调用，零副作用
// 对应设计文档：第六部分《风险识别规则表》
// ─────────────────────────────────────────────────────────────────────

// ══ 辅助函数 ═══════════════════════════════════════════════════════
function sp(cd) { return cd.student_profile || {}; }
function pp(cd) { return cd.parent_profile  || {}; }
function fp(cd) { return cd.family_profile  || {}; }
function ans(cd){ return cd.answers         || {}; }

// 判断当前是否有留学意向（综合多个字段）
function hasOverseasIntent(cd) {
  const s = sp(cd);
  const f = fp(cd);
  const a = ans(cd);

  // 明确拒绝出国
  if (f.family_overseas_acceptance === 'strongly_against') return false;
  if (a.geo_preference === 'cn_only') return false;
  if (a.education_path_preference === 'gaokao') return false;

  // 有留学意向的信号
  const hasGeo = a.geo_preference && a.geo_preference !== 'cn_only' && a.geo_preference !== 'open';
  const hasPath = ['international_school','highschool_abroad','university_abroad'].includes(a.education_path_preference);
  const isIntl = s.school_type === 'international';
  const familyOk = ['fully','acceptable'].includes(f.family_overseas_acceptance);
  const kidOk    = ['eager','acceptable'].includes(s.overseas_attitude);

  return hasGeo || hasPath || isIntl || (familyOk && kidOk);
}

// ══ 风险规则（每条独立函数，互不依赖） ════════════════════════════════

// R1: 时间窗口风险 — 高三 + 6个月内 + 留学意向
function risk_time_window(cd) {
  const s = sp(cd);
  const f = fp(cd);
  if (!s.grade_group || !f.decision_timeline) return null;
  if (s.grade_group === 'high' && f.decision_timeline === 'within6m' && hasOverseasIntent(cd)) {
    return {
      type:  'risk_time_window',
      level: 'high',
      description: '当前时间窗口已进入高压期，部分留学路径在此节点启动成本极高。高三阶段启动出国申请，通常需要在标化成绩、文书、活动记录方面同时冲刺，压力叠加风险明显。',
      needs_deepdive: false,
      deepdive_question: null,
    };
  }
  return null;
}

// R2: 盲目留学风险 — 对留学不了解 + 孩子未表态
function risk_blind_overseas(cd) {
  const s = sp(cd);
  const p = pp(cd);
  if (!p.overseas_understanding || !s.overseas_attitude) return null;
  if (p.overseas_understanding === 'none' && s.overseas_attitude === 'unclear' && hasOverseasIntent(cd)) {
    return {
      type:  'risk_blind_overseas',
      level: 'high',
      description: '家庭对留学的理解和预期存在明显缺口，孩子本人也尚未表达明确意愿。在这种情况下做的留学决策，往往是被外部环境驱动，而非来自真实的家庭判断。',
      needs_deepdive: true,
      deepdive_question: '你提到想让孩子出国，能说说当时是怎么想的吗？是孩子主动想去，还是家里觉得这条路更好？',
    };
  }
  return null;
}

// R3: 亲子决策冲突风险 — 孩子抗拒 + 家长主导
function risk_parent_child_conflict(cd) {
  const s = sp(cd);
  const p = pp(cd);
  if (!s.overseas_attitude || !p.control_level) return null;
  if (s.overseas_attitude === 'resistant' && p.control_level === 'dominant') {
    return {
      type:  'risk_parent_child_conflict',
      level: 'high',
      description: '孩子与家长在出国方向上存在明显分歧，同时家长倾向主导决策。这是留学路径的核心风险之一——被动执行的孩子在异国独立生活中失败率显著更高。',
      needs_deepdive: true,
      deepdive_question: '孩子自己对出国这件事，平时是怎么说的？有没有说过为什么不想去，或者对什么担心？',
    };
  }
  return null;
}

// R4: 预算错配风险 — 预算不足但有英美留学意向
function risk_budget_mismatch(cd) {
  const f = fp(cd);
  const a = ans(cd);
  if (!f.annual_education_budget) return null;

  const lowBudget = ['under10w', '10_20w'].includes(f.annual_education_budget);
  const highCostTarget = ['us', 'uk'].includes(a.geo_preference) ||
    ['highschool_abroad', 'university_abroad'].includes(a.education_path_preference);

  if (lowBudget && highCostTarget) {
    return {
      type:  'risk_budget_mismatch',
      level: 'high',
      description: '目标路径（英美留学）的实际年费用通常在 40-80 万以上，与家庭填报的预算区间存在较大缺口。这是一个需要在决策前正视的现实约束，建议重新评估目标国家或路径。',
      needs_deepdive: false,
      deepdive_question: null,
    };
  }
  return null;
}

// R5: 英语准备不足风险 — 英语弱/基础 + 时间紧 + 有留学意向
function risk_english_gap(cd) {
  const s = sp(cd);
  const f = fp(cd);
  if (!s.english_level || !f.decision_timeline) return null;

  const weakEnglish = ['weak', 'basic'].includes(s.english_level);
  const tightTimeline = ['within6m', 'within1y'].includes(f.decision_timeline);

  if (weakEnglish && tightTimeline && hasOverseasIntent(cd)) {
    return {
      type:  'risk_english_gap',
      level: 'high',
      description: `英语能力是留学路径的基础门槛，当前水平（${s.english_level === 'weak' ? '较弱' : '基础阶段'}）与 ${f.decision_timeline === 'within6m' ? '6个月' : '1年'} 内的决策时间窗口之间存在明显张力。语言类考试（IELTS/TOEFL）通常需要 12-18 个月的系统备考。`,
      needs_deepdive: false,
      deepdive_question: null,
    };
  }
  return null;
}

// R6: 学业基础风险 — 留学路径 + 成绩偏低
function risk_academic_base(cd) {
  const s = sp(cd);
  if (!s.academic_level) return null;
  if (s.academic_level === 'below_medium' && hasOverseasIntent(cd)) {
    return {
      type:  'risk_academic_base',
      level: 'medium',
      description: '孩子当前学业基础与部分目标学校的申请要求存在差距。不同国家的院校对成绩要求不同——部分加拿大、澳洲院校门槛相对宽松，可作为调整方向的参考。',
      needs_deepdive: false,
      deepdive_question: null,
    };
  }
  return null;
}

// R7: 独立性不足风险 — 独立性低 + 英美留学
function risk_low_independence(cd) {
  const s = sp(cd);
  const a = ans(cd);
  if (!s.independence_level) return null;  // 字段未采集时跳过

  const lowIndep = s.independence_level === 'low';
  const farTarget = ['us', 'uk', 'europe', 'au_nz'].includes(a.geo_preference);

  if (lowIndep && farTarget) {
    return {
      type:  'risk_low_independence',
      level: 'medium',
      description: '独立生活能力是海外适应的前提条件。孩子目前的独立性信号偏弱，建议在出发前做 1-2 年的专项培养（短期游学、夏校、住宿体验等）。',
      needs_deepdive: true,
      deepdive_question: '孩子独自处理事情的能力，比如出远门、自己安排时间、和陌生人打交道，大概处于什么水平？',
    };
  }
  return null;
}

// R8: 学业耗竭风险 — 有疲态或回避信号
function risk_burnout(cd) {
  const s = sp(cd);
  if (!s.current_stress_signal) return null;
  if (['fatigued', 'avoidant'].includes(s.current_stress_signal)) {
    return {
      type:  'risk_burnout',
      level: 'medium',
      description: '孩子当前学习状态显示有一定耗竭信号。在这种状态下叠加大量升学压力，可能进一步加剧问题。建议在路径决策中纳入节奏调整空间，不要只看路径，也要看孩子当下的承受能力。',
      needs_deepdive: true,
      deepdive_question: '孩子现在对学习的状态，是哪种感觉——主动投入、疲惫应付，还是有些在逃避？',
    };
  }
  return null;
}

// R9: 名校执念风险 — 执念强 + 成绩中等/偏低
function risk_elite_fixation(cd) {
  const s = sp(cd);
  const p = pp(cd);
  if (!p.elite_school_fixation || !s.academic_level) return null;

  const hasFixation = p.elite_school_fixation === 'strong';
  const weakAcademic = ['medium', 'below_medium'].includes(s.academic_level);

  if (hasFixation && weakAcademic) {
    return {
      type:  'risk_elite_fixation',
      level: 'medium',
      description: '家庭对名校的期望与孩子当前学业基础之间可能存在认知落差。名校申请竞争极度激烈，以 QS 前 50 为硬性目标但成绩处于中等区间，会产生"目标倒置"——为了目标改变孩子，而不是找到适合孩子的目标。',
      needs_deepdive: false,
      deepdive_question: null,
    };
  }
  return null;
}

// R10: 国际学校 + 低预算（课程体系与预算不符）
function risk_intl_school_budget(cd) {
  const s = sp(cd);
  const f = fp(cd);
  if (s.school_type !== 'international') return null;
  if (['under10w', '10_20w'].includes(f.annual_education_budget)) {
    return {
      type:  'risk_intl_school_budget',
      level: 'high',
      description: '孩子在国际学校就读，采用 IB/AP/A-Level 课程体系，毕业后需直接申请海外大学。但填报的年度预算偏低，与国际学校及海外大学的实际费用存在明显缺口，请确认是否有其他资金来源。',
      needs_deepdive: false,
      deepdive_question: null,
    };
  }
  return null;
}

// ══ 主函数：runRiskScan(cd) ════════════════════════════════════════════
// 输入：collectedData 对象
// 输出：{ flags: [ {type, level, description, needs_deepdive, deepdive_question} ] }
function runRiskScan(cd) {
  const rules = [
    risk_time_window,
    risk_blind_overseas,
    risk_parent_child_conflict,
    risk_budget_mismatch,
    risk_english_gap,
    risk_academic_base,
    risk_low_independence,
    risk_burnout,
    risk_elite_fixation,
    risk_intl_school_budget,
  ];

  const flags = [];

  rules.forEach(ruleFn => {
    try {
      const result = ruleFn(cd);
      if (result) flags.push(result);
    } catch (e) {
      // 单条规则报错不影响其他规则
      console.warn('[risk_engine] rule error:', ruleFn.name, e);
    }
  });

  // 按风险级别排序：high > medium > low
  const levelOrder = { high: 0, medium: 1, low: 2 };
  flags.sort((a, b) => (levelOrder[a.level] || 2) - (levelOrder[b.level] || 2));

  return { flags };
}

// 获取最高优先级的需要深挖的风险
function getTopDeepDiveRisk(flags) {
  return flags.find(f => f.needs_deepdive) || null;
}

module.exports = {
  runRiskScan,
  getTopDeepDiveRisk,
};
