// utils/evidence_engine.js
// 袁希™ — 证据采集层 v1
// ─────────────────────────────────────────────────────────────────────
// 职责：
//   1. 定义 8 类证据类型，每类有置信度提升系数
//   2. 从自由文本中识别证据类型（detectEvidenceType）
//   3. 将证据写入 cd.evidence_log（recordEvidence）
//   4. 计算某个判断维度的证据置信度修正值（getEvidenceConfidence）
//
// 设计原则：
//   - 不判断"真假"，只判断"有无依据"和"依据强度"
//   - 家长主观印象有效，但权重最低；成绩记录权重最高
//   - evidence_log 是扁平数组，每条记录 { slot, evidenceType, raw, ts }
// ─────────────────────────────────────────────────────────────────────

// ══ 8 类证据类型 ══════════════════════════════════════════════════════
const EVIDENCE_TYPES = {
  grade_report: {
    label: '成绩单/考试记录',
    confidenceBoost: 0.30,
    // 提问方式：Ask for specific numbers, rankings, test results
    howToAsk: '孩子有没有具体的成绩记录——比如年级排名、某次期末分数、或者英语测试成绩？',
    // 如何影响判断：直接提升 academic_reality / english_reality 置信度
    pathImpact: '提升学校层级判断准确率，降低拔高或低估风险',
  },
  teacher_feedback: {
    label: '老师反馈',
    confidenceBoost: 0.20,
    howToAsk: '孩子的老师有没有给过什么反馈——学业上或者性格上的？',
    pathImpact: '补充家长观察视角，降低主观偏差',
  },
  behavior_observation: {
    label: '行为表现观察',
    confidenceBoost: 0.15,
    howToAsk: '你能举个孩子日常的具体行为吗？比如怎么处理陌生问题，或者面对困难时的反应？',
    pathImpact: '独立性/心理弹性的可靠指标',
  },
  project_portfolio: {
    label: '项目/作品/竞赛',
    confidenceBoost: 0.20,
    howToAsk: '孩子有没有做过什么项目、参加过竞赛，或者有什么作品？',
    pathImpact: '兴趣深度和能力水平的具体依据，直接影响专业匹配',
  },
  child_self_report: {
    label: '孩子自述',
    confidenceBoost: 0.10,
    howToAsk: '孩子自己怎么说？对出国或者某个方向，TA 说过什么？',
    pathImpact: '孩子意愿的直接信号；家长转述有衰减，但仍有参考价值',
  },
  parent_impression: {
    label: '家长主观印象',
    confidenceBoost: 0.05,
    howToAsk: '（默认类型，无需主动追问）',
    pathImpact: '权重最低，但仍计入；多条印象可积累',
  },
  third_party_observation: {
    label: '第三方观察',
    confidenceBoost: 0.15,
    howToAsk: '除了家长，还有没有别人观察到过孩子的什么特点？比如亲戚、课外班老师？',
    pathImpact: '降低"父母滤镜"偏差，独立性、能力的佐证',
  },
  no_evidence: {
    label: '无明确依据',
    confidenceBoost: -0.10,
    howToAsk: '（当检测到无具体依据时，自动标记）',
    pathImpact: '降低置信度，触发追问建议',
  },
};

// ══ 从自由文本中识别证据类型 ══════════════════════════════════════════
// 返回最匹配的证据类型 ID（字符串）
function detectEvidenceType(ans) {
  const t = (ans || '').trim();
  if (!t || t.length < 3) return 'no_evidence';

  // 优先级从高到低
  if (/成绩单|排名|分数|卷子|考了|得了|年级第|班级第|均分|GPA|IELTS|雅思|托福|TOEFL|SAT|竞赛|奖|certificate|证书/.test(t)) {
    return 'grade_report';
  }
  if (/老师说|老师反馈|班主任|任课老师|教练说|导师/.test(t)) {
    return 'teacher_feedback';
  }
  if (/作品|项目|比赛|参赛|竞赛|获奖|展览|表演|作曲|画了|写了|做了/.test(t)) {
    return 'project_portfolio';
  }
  if (/孩子说|他说|她说|孩子自己|孩子觉得|孩子想|孩子表示/.test(t)) {
    return 'child_self_report';
  }
  if (/亲戚|邻居|其他家长|课外班老师|朋友说|同学家长|第三方/.test(t)) {
    return 'third_party_observation';
  }
  // 行为观察：有具体场景 + 动词
  if (/有一次|那次|经常|每次|上次|发现|注意到|观察到/.test(t) && t.length > 20) {
    return 'behavior_observation';
  }
  // 短且无具体信号 → 家长主观印象
  if (t.length < 30 && /感觉|觉得|认为|应该|可能|好像|好的|挺好|不错/.test(t)) {
    return 'parent_impression';
  }
  // 否则：有文字 → 家长主观印象（不是无依据）
  return t.length >= 15 ? 'parent_impression' : 'no_evidence';
}

// ══ 记录证据到 cd.evidence_log ════════════════════════════════════════
// slot: 对应的 judgment slot id（来自 interview_engine.js）
// evidenceType: 来自 detectEvidenceType()
// raw: 原始回答文本（截断到 200 字）
function recordEvidence(cd, slot, evidenceType, raw) {
  cd.evidence_log = cd.evidence_log || [];
  cd.evidence_log.push({
    slot,
    evidenceType,
    label: (EVIDENCE_TYPES[evidenceType] || {}).label || evidenceType,
    confidenceBoost: (EVIDENCE_TYPES[evidenceType] || {}).confidenceBoost || 0,
    raw: (raw || '').slice(0, 200),
    ts: Date.now(),
  });
}

// ══ 计算某个槽位的证据置信度修正 ═════════════════════════════════════
// 多条证据叠加，上限 +0.40，下限 -0.10
function getEvidenceConfidence(cd, slot) {
  const entries = (cd.evidence_log || []).filter(e => e.slot === slot);
  if (entries.length === 0) return 0; // 无记录：不加也不扣

  const total = entries.reduce((sum, e) => sum + (e.confidenceBoost || 0), 0);
  return Math.max(-0.10, Math.min(0.40, total));
}

// ══ 生成证据摘要（用于决策日志 + 报告提示词注入）════════════════════
// 返回 [{ slot, strongestEvidence, confidenceBoost }]
function buildEvidenceSummary(cd) {
  const log = cd.evidence_log || [];
  const slotMap = {};

  log.forEach(e => {
    if (!slotMap[e.slot]) {
      slotMap[e.slot] = { slot: e.slot, entries: [], totalBoost: 0 };
    }
    slotMap[e.slot].entries.push(e);
    slotMap[e.slot].totalBoost += (e.confidenceBoost || 0);
  });

  return Object.values(slotMap).map(s => {
    const strongest = s.entries.reduce((a, b) =>
      (b.confidenceBoost || 0) > (a.confidenceBoost || 0) ? b : a,
    s.entries[0]);
    return {
      slot: s.slot,
      strongestEvidence: strongest.evidenceType,
      strongestLabel:    strongest.label,
      totalBoost: Math.max(-0.10, Math.min(0.40, s.totalBoost)),
      count: s.entries.length,
    };
  });
}

// ══ 构建证据摘要文本（供 buildAnalysisPrompt 注入）════════════════════
function buildEvidenceText(cd) {
  const summary = buildEvidenceSummary(cd);
  if (summary.length === 0) return '';
  const lines = summary.map(s =>
    `- ${s.slot}：最强证据类型「${s.strongestLabel}」（置信度修正 ${s.totalBoost >= 0 ? '+' : ''}${(s.totalBoost * 100).toFixed(0)}%）`
  );
  return `## 证据采集摘要\n${lines.join('\n')}`;
}

// ══ SLOT_TO_QIDS 映射：哪个问题触发哪个槽位的证据采集 ════════════════
// 用于在 _userSend() 中知道"对当前问题，应该记录哪个 slot 的证据"
const SLOT_TO_QIDS = {
  academic_reality:       ['q_academic_level', 'q_fill_gap'],
  english_reality:        ['q_english_intent', 'q_english_detail'],
  overseas_intent:        ['q_english_intent', 'q_family_stance'],
  family_alignment:       ['q_family_stance'],
  budget_reality:         ['q_budget_timeline'],
  timeline_commitment:    ['q_budget_timeline', 'q_timeline_reality'],
  overseas_depth:         ['q_overseas_understanding'],
  independence_capacity:  ['q_independence_detail', 'q_fill_gap'],
  child_motivation:       ['q_english_intent'],
  parent_expectation_calibration: ['q_parent_expectation'],
  subject_interest_depth: ['q_subject_interest'],
  geo_preference_firmness:['q_geo_preference'],
};

// 反向映射：question ID → slot ID
const QIDS_TO_SLOT = {};
Object.entries(SLOT_TO_QIDS).forEach(([slot, qids]) => {
  qids.forEach(qid => {
    if (!QIDS_TO_SLOT[qid]) QIDS_TO_SLOT[qid] = [];
    QIDS_TO_SLOT[qid].push(slot);
  });
});

// ══ 主接口：在 _userSend() 中调用 ═════════════════════════════════════
// 根据当前 question ID，检测并记录证据
function detectAndRecord(ans, qId, cd) {
  const slots = QIDS_TO_SLOT[qId];
  if (!slots || slots.length === 0) return;
  const evidenceType = detectEvidenceType(ans);
  slots.forEach(slot => recordEvidence(cd, slot, evidenceType, ans));
}

module.exports = {
  EVIDENCE_TYPES,
  detectEvidenceType,
  recordEvidence,
  getEvidenceConfidence,
  buildEvidenceSummary,
  buildEvidenceText,
  detectAndRecord,
  SLOT_TO_QIDS,
  QIDS_TO_SLOT,
};
