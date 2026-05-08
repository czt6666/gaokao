// utils/interview_engine.js
// 袁希™ — 教练型访谈引擎 v1
// ─────────────────────────────────────────────────────────────────────
// 职责：
//   1. 定义 12 个关键判断槽位（Judgment Slots）
//   2. 追踪每个槽位的填充状态和置信度
//   3. 返回"当前最影响判断的未填槽位"，供 _advanceFlow 参考
//   4. 提供槽位级别的追问文本（不替换 _getQualityProbe，而是补充）
//
// 设计原则：
//   - 不替换现有 FLOW 状态机；本引擎是"上层槽位监控层"
//   - 每个槽位有 fillCheck(cd) 函数：返回 true = 已填；false = 未填
//   - evidenceSensitive = true 的槽位，即使填了也会检查证据强度
// ─────────────────────────────────────────────────────────────────────

// ══ 12 个关键判断槽位 ══════════════════════════════════════════════════
const JUDGMENT_SLOTS = [
  {
    id: 'academic_reality',
    label: '学业真实水平',
    priority: 1,
    required: true,
    evidenceSensitive: true,
    missingImpact: '无法判断冲刺/匹配/保底学校层级',
    fillCheck: (cd) => !!(cd.student_profile || {}).academic_level,
    probeText: '孩子的学业成绩，有没有什么具体数据，比如年级排名或某次期末成绩？',
  },
  {
    id: 'english_reality',
    label: '英语真实基础',
    priority: 2,
    required: true,
    evidenceSensitive: true,
    missingImpact: '准备时间线估算严重失准',
    fillCheck: (cd) => !!(cd.student_profile || {}).english_level,
    probeText: '孩子英语能举个具体场景吗？做过什么测试，或者在什么情况下用过英语？',
  },
  {
    id: 'overseas_intent',
    label: '留学意向明确性',
    priority: 3,
    required: true,
    evidenceSensitive: false,
    missingImpact: '高考/留学分支无法分流',
    fillCheck: (cd) => !!(cd.student_profile || {}).overseas_attitude,
    probeText: '关于出国，孩子自己和你们是什么态度——是真的在认真考虑，还是还在观望？',
  },
  {
    id: 'family_alignment',
    label: '家庭内部一致性',
    priority: 4,
    required: true,
    evidenceSensitive: false,
    missingImpact: '漏判家庭冲突风险，路径执行力失准',
    fillCheck: (cd) => !!(cd.family_profile || {}).family_overseas_acceptance,
    probeText: '你们家里对这件事意见统一吗？孩子的另一方家长，或者长辈，有没有不同看法？',
  },
  {
    id: 'budget_reality',
    label: '预算真实承受力',
    priority: 5,
    required: true,
    evidenceSensitive: false,
    missingImpact: '错误推荐超出能力范围的路径',
    fillCheck: (cd) => !!(cd.family_profile || {}).annual_education_budget,
    probeText: '年度教育投入这个数字，是比较宽裕的，还是已经是上限？',
  },
  {
    id: 'timeline_commitment',
    label: '时间线硬性程度',
    priority: 6,
    required: true,
    evidenceSensitive: false,
    missingImpact: '无法识别时间窗口危机',
    fillCheck: (cd) => !!(cd.family_profile || {}).decision_timeline,
    probeText: '你们希望什么时候做最终决定——这个时间点是硬性的，还是有弹性？',
  },
  {
    id: 'overseas_depth',
    label: '对留学流程的了解深度',
    priority: 7,
    required: false,
    evidenceSensitive: false,
    missingImpact: '漏判盲目决策风险',
    fillCheck: (cd) => !!(cd.parent_profile || {}).overseas_understanding,
    probeText: '你们了解申请流程、考试要求这些具体操作吗，还是还在比较宏观的了解阶段？',
  },
  {
    id: 'independence_capacity',
    label: '孩子独立生活能力',
    priority: 8,
    required: false,
    evidenceSensitive: false,
    missingImpact: '独立性风险漏判，留学路径被高估',
    fillCheck: (cd) => !!(cd.student_profile || {}).independence_level,
    probeText: '孩子平时自己处理事情的能力怎么样？出远门、安排时间这类，是比较独立还是需要人帮？',
  },
  {
    id: 'child_motivation',
    label: '孩子自身意愿',
    priority: 9,
    required: false,
    evidenceSensitive: false,
    missingImpact: '孩子抗拒信号被漏判',
    fillCheck: (cd) => (cd.student_profile || {}).overseas_attitude !== undefined,
    probeText: '孩子自己对出国这件事是什么态度——是期待的，还是无所谓，还是有点抗拒？',
  },
  {
    id: 'parent_expectation_calibration',
    label: '家长期望与现实匹配度',
    priority: 10,
    required: false,
    evidenceSensitive: false,
    missingImpact: '名校执念风险漏判，学校推荐失焦',
    fillCheck: (cd) => !!(cd.parent_profile || {}).elite_school_fixation,
    probeText: '对于学校层级，你真实的期望是什么——顶尖名校，还是合适就好？',
  },
  {
    id: 'subject_interest_depth',
    label: '孩子专业兴趣真实性',
    priority: 11,
    required: false,
    evidenceSensitive: false,
    missingImpact: '专业匹配失焦，学校推荐失准',
    fillCheck: (cd) => !!(cd.answers || {}).subject_interest,
    probeText: '孩子对某个方向的兴趣，是真的停不下来的那种，还是说还在探索？',
  },
  {
    id: 'geo_preference_firmness',
    label: '目标国家偏好坚定性',
    priority: 12,
    required: false,
    evidenceSensitive: false,
    missingImpact: '地理约束不明，学校匹配无法精准聚焦',
    fillCheck: (cd) => !!(cd.answers || {}).geo_preference,
    probeText: '对目标国家，你们有什么特定倾向，还是完全开放？',
  },
];

// ══ 槽位状态计算 ══════════════════════════════════════════════════════
// 返回：{ filled, unfilled, completionRate, requiredUnfilled }
function getSlotStatus(cd) {
  const filled   = [];
  const unfilled = [];

  JUDGMENT_SLOTS.forEach(slot => {
    if (slot.fillCheck(cd)) {
      filled.push(slot.id);
    } else {
      unfilled.push(slot.id);
    }
  });

  const requiredSlots   = JUDGMENT_SLOTS.filter(s => s.required);
  const requiredUnfilled = requiredSlots.filter(s => !s.fillCheck(cd)).map(s => s.id);
  const completionRate  = filled.length / JUDGMENT_SLOTS.length;

  return { filled, unfilled, completionRate, requiredUnfilled };
}

// ══ 取"当前最高优先级的未填槽位" ═════════════════════════════════════
// 用于在报告前检查是否有关键信息缺失
function getTopUnfilledSlot(cd) {
  return JUDGMENT_SLOTS
    .filter(s => !s.fillCheck(cd))
    .sort((a, b) => a.priority - b.priority)[0] || null;
}

// ══ 对特定槽位：生成"证据追问"文本 ══════════════════════════════════
// 仅对 evidenceSensitive=true 的槽位，当证据强度低时调用
function getEvidenceProbeText(slotId) {
  const slot = JUDGMENT_SLOTS.find(s => s.id === slotId);
  return slot ? slot.probeText : null;
}

// ══ 计算槽位完整度对路径置信度的修正 ════════════════════════════════
// 缺少必须槽位：每缺1个扣 0.15；缺可选槽位：每缺1个扣 0.05
function getSlotConfidenceAdjustment(cd) {
  let adjustment = 0;
  JUDGMENT_SLOTS.forEach(slot => {
    if (!slot.fillCheck(cd)) {
      adjustment -= slot.required ? 0.15 : 0.05;
    }
  });
  return Math.max(adjustment, -0.60); // 最多扣 60%
}

// ══ 判断某个答案是否需要证据追问（主动）════════════════════════════
// 当 slotId 是 evidenceSensitive 且答案中无具体证据信号时返回 true
function needsEvidenceProbe(slotId, ans, cd) {
  const slot = JUDGMENT_SLOTS.find(s => s.id === slotId);
  if (!slot || !slot.evidenceSensitive) return false;

  // 已填且有佐证证据（evidence_log 中有非 parent_impression / no_evidence）
  const evidenceLog = (cd.evidence_log || []).filter(e => e.slot === slotId);
  const hasStrongEvidence = evidenceLog.some(e =>
    !['parent_impression', 'no_evidence'].includes(e.evidenceType)
  );
  if (hasStrongEvidence) return false;

  // 检查答案文本中有无佐证信号
  const t = (ans || '');
  const hasConcreteSignal = /\d|排名|成绩|考试|分数|证书|老师|学校说|报告|测试|competition|竞赛|作品/.test(t);
  return !hasConcreteSignal;
}

// ══ 动态插题引擎 ══════════════════════════════════════════════════════
// 每次用户回答后调用，返回下一个应动态插入的问题（最多3条/session）
//
// 触发优先级（高→低）：
//   1. 一致性违规 hard severity + shouldFollowUp  → 插一致性澄清
//   2. evidenceSensitive 槽位已填 + 缺乏强证据   → 插证据追问
//
// 防无限追问机制：
//   - cd._dynamicProbed: { key: true }  已追问过的规则/槽位（不重复）
//   - cd._dynamicCount: number          本session已动态追问总次数
//   - MAX_DYNAMIC_QUESTIONS = 3          硬性上限，绝不超过
const MAX_DYNAMIC_QUESTIONS = 3;

function buildDynamicQueue(cd) {
  const probed = cd._dynamicProbed || {};
  const count  = cd._dynamicCount  || 0;
  if (count >= MAX_DYNAMIC_QUESTIONS) return [];

  const candidates = [];

  // ── 优先级1：一致性违规追问（仅 hard + shouldFollowUp）──────────
  const consistencyResult = cd._consistencyResult || {};
  const violations   = consistencyResult.violations    || [];
  const followUpTexts = consistencyResult.followUpTexts || [];

  followUpTexts.forEach(item => {
    if (probed[item.ruleId]) return;
    const isHard = violations.some(v => v.ruleId === item.ruleId && v.severity === 'hard');
    if (isHard) {
      candidates.push({
        priority: 1,
        key:  item.ruleId,
        type: 'consistency',
        text: item.text,
      });
    }
  });

  // ── 优先级2：证据追问（evidenceSensitive 槽位已填但仅有弱证据）──
  JUDGMENT_SLOTS.filter(s => s.evidenceSensitive && s.fillCheck(cd)).forEach(slot => {
    const evKey = 'ev_' + slot.id;
    if (probed[evKey]) return;
    const evidenceLog = (cd.evidence_log || []).filter(e => e.slot === slot.id);
    const hasStrong = evidenceLog.some(e =>
      !['parent_impression', 'no_evidence'].includes(e.evidenceType)
    );
    if (!hasStrong) {
      candidates.push({
        priority: 2,
        key:  evKey,
        type: 'evidence',
        text: slot.probeText,
      });
    }
  });

  // 按优先级排序，只返回本次配额内的候选（最多 MAX - count 个）
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates.slice(0, MAX_DYNAMIC_QUESTIONS - count);
}

module.exports = {
  JUDGMENT_SLOTS,
  getSlotStatus,
  getTopUnfilledSlot,
  getEvidenceProbeText,
  getSlotConfidenceAdjustment,
  needsEvidenceProbe,
  buildDynamicQueue,
  MAX_DYNAMIC_QUESTIONS,
};
