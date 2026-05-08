/**
 * persona_scorer.js — 1% 用户势能识别引擎
 *
 * 【宪法依据·第三章 3.3】
 * AI 在后台对每个用户进行动态认知评估，输出内部评分。
 * 这个评分永远不展示给用户，只用于：
 *   1. 识别 1% 高势能候选人
 *   2. 决定产品给予该用户的体验深度
 *   3. 为线下邀请机制提供决策依据
 *
 * 四个评分维度（总分100）：
 *   - 认知密度  Cognitive Density    (0–40)
 *   - 行动意愿  Action Willingness   (0–30)
 *   - 结构责任感 Structural Accountability (0–20)
 *   - 数据战略价值 Strategic Data Value (0–10)
 *
 * 分层结果：
 *   80–100 → TIER_1  进入 1% 候选池
 *   60–79  → TIER_2  重点培育用户
 *   40–59  → TIER_3  标准工具用户
 *   0–39   → TIER_4  轻度用户
 */

// ─── 分层定义 ──────────────────────────────────────────────
const TIERS = {
  TIER_1: { min: 80, label: '1%候选',   action: 'invite_offline',  desc: '进入线下邀请流程' },
  TIER_2: { min: 60, label: '重点用户', action: 'deepen_product',  desc: '提供更深产品体验' },
  TIER_3: { min: 40, label: '标准用户', action: 'standard_service',desc: '完整工具价值服务' },
  TIER_4: { min: 0,  label: '轻度用户', action: 'basic_service',   desc: '基础服务维持' },
};

// ─── 行为信号键（存储在 wx.storage）─────────────────────────
const SIGNAL_KEY   = '__1pct_signals__';
const SCORE_KEY    = '__1pct_score__';
const HISTORY_KEY  = '__1pct_history__';

// ─── 默认信号结构 ──────────────────────────────────────────
function _defaultSignals() {
  return {
    // 【认知密度信号】
    assessmentCompleted:    false,   // 完成了完整评估
    aiChatDepth:            0,       // AI 对话轮次（越多=认知越深）
    schoolDetailReadCount:  0,       // 查看学校详情次数
    avgDetailDwellSec:      0,       // 平均停留时间（秒）
    complexQuestionsAsked:  0,       // 提出复杂追问次数
    resourceLayerViewed:    0,       // 查看"第二层资源"次数（实战资源/隐藏机会）
    dataFieldsRead:         0,       // 查看数据字段数（高考分/就业率/薪资等）
    multiRegionExplored:    false,   // 是否探索了多个地区的学校（中/美/英/新）

    // 【行动意愿信号】
    applicationsCreated:    0,       // 创建了几所学校的申请追踪
    applicationUpdated:     false,   // 是否更新过申请状态
    firstVisitDate:         null,    // 首次使用日期
    lastVisitDate:          null,    // 最近使用日期
    activeDays:             0,       // 累计活跃天数
    revisitCount:           0,       // 回访次数（每天算一次）
    reportShared:           false,   // 是否分享过报告（行动力信号）

    // 【结构责任感信号】
    planningHorizon:        0,       // 规划时间跨度（年，从问卷提取）
    budgetDeclared:         null,    // 声明的教育预算（null=未填）
    familyProfileComplete:  false,   // 家庭背景是否完整填写
    multiChildTracked:      false,   // 是否追踪了多个孩子
    decisionRiskLevel:      0,       // 决策风险评级（0–3，从问题复杂度推断）

    // 【数据战略价值信号】
    problemSpanScore:       0,       // 问题跨领域程度（教育+职业+资本=高分）
    referralBehavior:       false,   // 是否有转介绍行为
    uniquenessScore:        0,       // 画像独特性（稀有路径组合）
    feedbackProvided:       false,   // 是否主动提供过反馈

    // 【元数据】
    _createdAt:             null,
    _updatedAt:             null,
    _version:               2,
  };
}

// ─── 读 / 写 信号 ─────────────────────────────────────────
function _readSignals() {
  try {
    const raw = wx.getStorageSync(SIGNAL_KEY);
    if (raw && raw._version === 2) return raw;
    // 版本迁移：保留兼容性
    const base = _defaultSignals();
    if (raw) Object.assign(base, raw);
    return base;
  } catch(e) {
    return _defaultSignals();
  }
}

function _writeSignals(signals) {
  try {
    signals._updatedAt = new Date().toISOString();
    wx.setStorageSync(SIGNAL_KEY, signals);
  } catch(e) {
    console.warn('[PersonaScorer] 写入信号失败', e);
  }
}

// ─── 核心评分算法 ─────────────────────────────────────────
function _compute(s) {

  // ──────────────────────────────
  // 维度一：认知密度（0–40分）
  // ──────────────────────────────
  let cognitive = 0;

  // 完成完整评估（基础门槛）
  if (s.assessmentCompleted) cognitive += 8;

  // AI 对话深度（每4轮+2分，上限12）
  cognitive += Math.min(12, Math.floor(s.aiChatDepth / 4) * 2);

  // 学校详情阅读深度（每5所+3分，上限9）
  cognitive += Math.min(9, Math.floor(s.schoolDetailReadCount / 5) * 3);

  // 平均停留时间（>60秒+3，>120秒+3，>180秒+3，上限9分）
  if (s.avgDetailDwellSec > 180) cognitive += 9;
  else if (s.avgDetailDwellSec > 120) cognitive += 6;
  else if (s.avgDetailDwellSec > 60)  cognitive += 3;

  // 查看实战资源第二层（每次+2，上限6）
  cognitive += Math.min(6, s.resourceLayerViewed * 2);

  // 多地区探索（跨越不同国家/地区）
  if (s.multiRegionExplored) cognitive += 4;

  // 提出复杂追问（每次+2，上限6）
  cognitive += Math.min(6, s.complexQuestionsAsked * 2);

  cognitive = Math.min(40, cognitive);

  // ──────────────────────────────
  // 维度二：行动意愿（0–30分）
  // ──────────────────────────────
  let action = 0;

  // 创建申请追踪（每所+4，上限12）
  action += Math.min(12, s.applicationsCreated * 4);

  // 更新过申请状态（说明有后续跟进）
  if (s.applicationUpdated) action += 4;

  // 活跃天数（>7天+4，>30天+4，>90天+4，上限12）
  if (s.activeDays >= 90) action += 12;
  else if (s.activeDays >= 30) action += 8;
  else if (s.activeDays >= 7)  action += 4;

  // 回访行为（每次回访+1，上限6）
  action += Math.min(6, s.revisitCount);

  // 分享报告（最强行动信号之一）
  if (s.reportShared) action += 4;

  action = Math.min(30, action);

  // ──────────────────────────────
  // 维度三：结构责任感（0–20分）
  // ──────────────────────────────
  let accountability = 0;

  // 规划时间跨度（>3年+5，>5年+5）
  if (s.planningHorizon >= 5) accountability += 10;
  else if (s.planningHorizon >= 3) accountability += 5;

  // 声明了教育预算（说明决策严肃性）
  if (s.budgetDeclared !== null) accountability += 3;

  // 完整填写家庭背景（认真程度高）
  if (s.familyProfileComplete) accountability += 4;

  // 追踪了多个孩子（复杂家庭决策）
  if (s.multiChildTracked) accountability += 3;

  // 决策风险级别（0–3级，每级+2分，上限6）
  accountability += Math.min(6, s.decisionRiskLevel * 2);

  accountability = Math.min(20, accountability);

  // ──────────────────────────────
  // 维度四：数据战略价值（0–10分）
  // ──────────────────────────────
  let dataValue = 0;

  // 问题跨领域（教育+职业+资本，每个维度+2）
  dataValue += Math.min(6, s.problemSpanScore * 2);

  // 转介绍行为（极高战略价值）
  if (s.referralBehavior) dataValue += 3;

  // 主动提供反馈
  if (s.feedbackProvided) dataValue += 1;

  dataValue = Math.min(10, dataValue);

  // ──────────────────────────────
  // 合计
  // ──────────────────────────────
  const total = cognitive + action + accountability + dataValue;

  return {
    total,
    breakdown: { cognitive, action, accountability, dataValue },
    tier: _getTier(total),
    computedAt: new Date().toISOString(),
  };
}

function _getTier(score) {
  if (score >= 80) return { ...TIERS.TIER_1, score };
  if (score >= 60) return { ...TIERS.TIER_2, score };
  if (score >= 40) return { ...TIERS.TIER_3, score };
  return { ...TIERS.TIER_4, score };
}

// ─── 公开 API ─────────────────────────────────────────────

/**
 * 记录行为信号（在各页面调用）
 * @param {string} event - 事件名（见下方事件字典）
 * @param {any} value    - 事件值（可选）
 */
function record(event, value) {
  const s = _readSignals();

  // 元数据更新
  const today = new Date().toDateString();
  if (!s._createdAt) s._createdAt = new Date().toISOString();
  if (s.lastVisitDate !== today) {
    s.activeDays += 1;
    s.revisitCount = (s.lastVisitDate ? s.revisitCount + 1 : 0);
    s.lastVisitDate = today;
  }
  if (!s.firstVisitDate) s.firstVisitDate = today;

  // 事件处理
  switch (event) {
    // 评估完成
    case 'assessment_completed':
      s.assessmentCompleted = true;
      if (value && value.planningHorizon) s.planningHorizon = value.planningHorizon;
      if (value && value.budget !== undefined) s.budgetDeclared = value.budget;
      if (value && value.familyComplete) s.familyProfileComplete = true;
      break;

    // AI 对话轮次增加
    case 'ai_chat_turn':
      s.aiChatDepth += 1;
      break;

    // 提出复杂追问（AI 判断触发）
    case 'complex_question':
      s.complexQuestionsAsked += 1;
      // 问题跨越多领域
      if (value && value.domains) {
        s.problemSpanScore = Math.max(s.problemSpanScore, value.domains.length - 1);
      }
      break;

    // 查看学校详情
    case 'school_detail_viewed':
      s.schoolDetailReadCount += 1;
      // 更新平均停留时长
      if (value && value.dwellSec) {
        s.avgDetailDwellSec = s.schoolDetailReadCount === 1
          ? value.dwellSec
          : Math.round((s.avgDetailDwellSec * (s.schoolDetailReadCount - 1) + value.dwellSec) / s.schoolDetailReadCount);
      }
      // 探索了不同地区
      if (value && value.region) {
        s._regionsExplored = s._regionsExplored || new Set();
        // Set 无法直接存储，用数组代替
        s._regionsArray = s._regionsArray || [];
        if (!s._regionsArray.includes(value.region)) {
          s._regionsArray.push(value.region);
        }
        s.multiRegionExplored = s._regionsArray.length >= 2;
      }
      break;

    // 查看第二层实战资源
    case 'resource_layer_viewed':
      s.resourceLayerViewed += 1;
      break;

    // 查看数据字段（高考分/就业率/薪资等）
    case 'data_fields_read':
      s.dataFieldsRead += (value || 1);
      break;

    // 申请追踪创建
    case 'application_created':
      s.applicationsCreated += 1;
      // 多孩子追踪
      if (value && value.multiChild) s.multiChildTracked = true;
      break;

    // 申请状态更新
    case 'application_updated':
      s.applicationUpdated = true;
      break;

    // 报告被分享
    case 'report_shared':
      s.reportShared = true;
      break;

    // 转介绍行为（邀请新用户）
    case 'referral':
      s.referralBehavior = true;
      break;

    // 主动提供反馈
    case 'feedback_given':
      s.feedbackProvided = true;
      break;

    // 决策风险评级（由 AI 对话内容判断）
    case 'decision_risk':
      // 0=低(普通择校), 1=中(跨国规划), 2=高(留学+创业+资本), 3=极高(家族/多代规划)
      s.decisionRiskLevel = Math.max(s.decisionRiskLevel, value || 0);
      break;

    // 报告追问入口被点击 = 深度参与信号（高于普通对话轮次）
    case 'report_followup_tapped':
      s.reportFollowupTapped = (s.reportFollowupTapped || 0) + 1;
      s.aiChatDepth += 2;   // 追问权重比普通对话轮次高
      break;

    // 报告追问实际发出问题（每轮+1，累计衡量对话深度）
    case 'followup_question_sent':
      s.followupQuestionCount = (s.followupQuestionCount || 0) + 1;
      s.aiChatDepth += 1;
      break;

    default:
      console.warn('[PersonaScorer] 未知事件:', event);
  }

  _writeSignals(s);
}

/**
 * 计算当前用户分数
 * 返回完整评分结果（仅供后台/管理视图使用）
 */
function score() {
  const s = _readSignals();
  const result = _compute(s);
  // 缓存最新分数
  try { wx.setStorageSync(SCORE_KEY, result); } catch(e) {}
  return result;
}

/**
 * 获取当前用户分层（仅返回 tier，不暴露分数细节）
 * 供产品内部决策使用，例如：是否展示更深的功能
 */
function getTier() {
  try {
    const cached = wx.getStorageSync(SCORE_KEY);
    if (cached && cached.computedAt) {
      // 超过1小时重算
      const ageMs = Date.now() - new Date(cached.computedAt).getTime();
      if (ageMs < 3600000) return cached.tier;
    }
  } catch(e) {}
  return score().tier;
}

/**
 * 是否是 1% 候选人（给产品决策用，不给用户看）
 */
function isTopTier() {
  return getTier().min >= 80;
}

/**
 * 重置所有信号（测试用）
 */
function reset() {
  try {
    wx.removeStorageSync(SIGNAL_KEY);
    wx.removeStorageSync(SCORE_KEY);
  } catch(e) {}
}

/**
 * 获取完整信号快照（调试/后台查看用）
 */
function getSignals() {
  return _readSignals();
}

/**
 * 获取完整评分历史（每次评估后追加）
 */
function getScoreHistory() {
  try { return wx.getStorageSync(HISTORY_KEY) || []; } catch(e) { return []; }
}

// 每次计算后追加历史
const _originalScore = score;
function scoreWithHistory() {
  const result = _compute(_readSignals());
  try {
    const history = getScoreHistory();
    history.push({ ...result, snapshot: getSignals() });
    if (history.length > 30) history.shift(); // 保留最近30条
    wx.setStorageSync(HISTORY_KEY, history);
    wx.setStorageSync(SCORE_KEY, result);
  } catch(e) {}
  return result;
}

module.exports = {
  record,
  score: scoreWithHistory,
  getTier,
  isTopTier,
  reset,
  getSignals,
  getScoreHistory,
  TIERS,
};
