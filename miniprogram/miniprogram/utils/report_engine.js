// utils/report_engine.js
// 袁希™ 适配性评估引擎 — 袁希方法论 v1
// ─────────────────────────────────────────────────────────────
// 五层输出：孩子画像 → 家庭画像 → 适配性评分 → 路径建议 → 三个行动
// v2 新增：matchSchools 分层推荐 + consistency + evidence 注入
// ─────────────────────────────────────────────────────────────
const { matchSchools, buildMatchText } = require('./match_engine');
const { buildConsistencyText }         = require('./consistency_engine');
const { buildEvidenceText }            = require('./evidence_engine');

// ── 常量 ─────────────────────────────────────────────────────
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

const MI_ABROAD_WEIGHT = {
  linguistic:    1.4,   // 语言能力是出国最关键的
  interpersonal: 1.2,   // 人际适应也很关键
  intrapersonal: 1.1,   // 自我认知帮助独立生活
  logical:       1.0,
  spatial:       0.9,
  bodily:        0.8,
  musical:       0.8,
  naturalist:    0.8,
};

const SCHOOL_STAGE_LABELS = {
  preschool: '学前阶段',
  primary:   '小学阶段',
  middle:    '初中阶段',
  high:      '高中阶段',
};

const SCHOOL_STAGE_WINDOW = {
  preschool: '尚有充裕时间窗口，底层能力培养是现阶段核心',
  primary:   '仍处于高回报投资期，探索兴趣与学习方法是关键',
  middle:    '路径选择的黄金窗口期，方向判断需要在未来1-2年内完成',
  high:      '决策窗口已临近，需要在近期锁定路径并启动执行',
};

// ── 关键词库（用于开放答案的轻量分析）────────────────────────
const KW = {
  // 教养方式
  authoritative: ['沟通', '商量', '讲道理', '理解', '倾听', '一起', '讨论', '引导'],
  authoritarian:  ['必须', '规定', '不可以', '不行', '严格', '要求', '纪律'],
  permissive:     ['随他', '不管', '算了', '无所谓', '自己决定', '自由'],
  // 独立性信号
  independent:    ['自觉', '自己', '主动', '不需要', '自律', '独立'],
  dependent:      ['总是催', '反复提醒', '才肯', '不催不动', '需要督促', '要盯'],
  // 抗压信号
  resilient:      ['调整', '克服', '坚持', '很快', '努力', '没关系', '接受'],
  fragile:        ['崩溃', '哭', '放弃', '逃避', '焦虑', '很久', '难过'],
  // 亲子关系
  close:          ['很好', '亲密', '信任', '开心', '愿意说', '主动来', '分享'],
  strained:       ['较少', '不说', '沉默', '紧张', '回避', '不理解', '矛盾'],
  // 价值观一致性
  aligned:        ['一致', '相同', '共识', '认同', '同意', '都觉得', '我们都'],
  diverged:       ['不同', '分歧', '争执', '他不想', '我觉得但', '我希望但'],
  // 兴趣真实性
  genuine:        ['自己要求', '主动学', '一直', '多年', '停不下来', '享受', '热爱'],
  passive:        ['我让他', '报名了', '试试', '不太', '勉强', '坚持不住'],
};

function kw_score(text, positives, negatives) {
  if (!text || typeof text !== 'string') return 0.5;
  const t = text;
  let score = 0.5;
  positives.forEach(w => { if (t.includes(w)) score += 0.08; });
  negatives.forEach(w => { if (t.includes(w)) score -= 0.08; });
  return Math.max(0.1, Math.min(0.9, score));
}

// 答案有效长度（简单代理：回答越详尽 = 思考越认真）
function answerDepth(text) {
  if (!text || typeof text !== 'string') return 0;
  const len = text.trim().length;
  if (len < 10) return 0.2;
  if (len < 30) return 0.4;
  if (len < 80) return 0.6;
  if (len < 150) return 0.8;
  return 1.0;
}

// ── Layer 1：孩子画像 ─────────────────────────────────────────
function buildChildPortrait(answers, miScores, mindsetScore) {
  // 排序多元智能
  const miList = Object.entries(miScores || {})
    .map(([key, val]) => ({ key, label: MI_LABELS[key] || key, score: Number(val) || 0 }))
    .sort((a, b) => b.score - a.score);

  const topIntelligences = miList.slice(0, 3).map(m => ({
    ...m,
    pct: Math.round((m.score / 5) * 100),
    description: MI_DESCRIPTIONS[m.key] || '',
  }));

  const ms = Number(mindsetScore) || 3;
  let mindsetLevel = 'developing';
  let mindsetLabel = '发展中';
  let mindsetDesc = '孩子展现出一定的学习弹性，仍有较大成长空间';
  if (ms >= 4.2) {
    mindsetLevel = 'growth'; mindsetLabel = '成长型';
    mindsetDesc = '孩子面对挑战时具备较强的坚韧性，这是应对陌生环境的重要底层能力';
  } else if (ms < 2.8) {
    mindsetLevel = 'fixed'; mindsetLabel = '待激活';
    mindsetDesc = '孩子目前倾向回避困难，建议在选择路径时优先选择支持性强的环境';
  }

  const stage = answers.schoolStage || 'middle';

  return {
    childName: answers.childName || '孩子',
    childAge: answers.childAge || '',
    schoolStage: stage,
    schoolStageLabel: SCHOOL_STAGE_LABELS[stage] || stage,
    stageWindow: SCHOOL_STAGE_WINDOW[stage] || '',
    topIntelligences,
    miList,
    mindsetScore: ms,
    mindsetLevel,
    mindsetLabel,
    mindsetDesc,
  };
}

const MI_DESCRIPTIONS = {
  linguistic:    '善于文字表达与语言学习，在国际化环境中具备天然优势',
  logical:       '分析推理能力强，适合理工科或需要结构性思维的专业方向',
  spatial:       '视觉空间想象力突出，设计、工程、艺术方向均有潜力',
  musical:       '对节奏与音调敏感，音乐学习可能是重要的情感出口',
  bodily:        '肢体协调与动手实践能力强，适合体育、工程、职业技术方向',
  interpersonal: '理解他人、建立关系的能力强，在多元文化环境中较易适应',
  intrapersonal: '自我认知能力强，善于反思，独立生活能力通常较好',
  naturalist:    '对自然规律与分类有天赋，生命科学、环境、农业方向值得关注',
};

// ── Layer 2：家庭画像 ─────────────────────────────────────────
function buildFamilyPortrait(parentAnswers) {
  if (!parentAnswers || Object.keys(parentAnswers).length === 0) {
    return { complete: false, summary: '家长评估尚未完成，以下分析仅基于孩子问卷。' };
  }

  const pa = parentAnswers;

  // 教养风格判断
  const rulesText = (pa.home_rules_response || '') + ' ' + (pa.home_mistake_handling || '');
  const aScore = KW.authoritative.filter(w => rulesText.includes(w)).length;
  const bScore = KW.authoritarian.filter(w => rulesText.includes(w)).length;
  const cScore = KW.permissive.filter(w => rulesText.includes(w)).length;

  let parentingStyle = 'authoritative';
  let parentingLabel = '权威型';
  let parentingNote = '民主沟通与适度规则并重，是研究证明最有利于孩子自主发展的教养方式';
  if (bScore > aScore && bScore > cScore) {
    parentingStyle = 'authoritarian'; parentingLabel = '权威控制型';
    parentingNote = '规则清晰但弹性空间有限，建议在出国准备阶段逐步放开孩子的自主决策空间';
  } else if (cScore > aScore && cScore >= bScore) {
    parentingStyle = 'permissive'; parentingLabel = '宽松型';
    parentingNote = '孩子自主空间较大，但在关键节点需要家长更多结构性引导';
  }

  // 亲子沟通质量
  const commText = (pa.comm_topics || '') + ' ' + (pa.comm_openness || '') + ' ' + (pa.comm_emotion_reading || '');
  const commPositive = KW.close.filter(w => commText.includes(w)).length;
  const commNegative = KW.strained.filter(w => commText.includes(w)).length;
  const commScore = (commPositive - commNegative + 3) / 6; // 归一化到0-1
  let commQuality = commScore > 0.6 ? 'high' : commScore > 0.35 ? 'medium' : 'low';
  let commLabel = { high: '良好', medium: '一般', low: '需要关注' }[commQuality];

  // 价值观一致性
  const valText = (pa.values_future_alignment || '');
  const valAligned = KW.aligned.filter(w => valText.includes(w)).length;
  const valDiverged = KW.diverged.filter(w => valText.includes(w)).length;
  const valueConsensus = valAligned > valDiverged ? 'aligned' : valDiverged > valAligned ? 'diverged' : 'neutral';

  // 家长参与深度（基于答案长度的平均值）
  const depthScores = Object.values(pa).map(v => answerDepth(v));
  const avgDepth = depthScores.length ? depthScores.reduce((a, b) => a + b, 0) / depthScores.length : 0.5;
  let engagementLabel = avgDepth > 0.7 ? '深度参与' : avgDepth > 0.4 ? '中度参与' : '浅度参与';

  // 家长对孩子认知准确度
  const selfAwareText = pa.personality_self_awareness || '';
  const parentAwareness = answerDepth(selfAwareText) > 0.5 ? 'reflective' : 'surface';

  return {
    complete: true,
    parentingStyle, parentingLabel, parentingNote,
    commQuality, commLabel,
    valueConsensus,
    engagementLabel, avgDepth,
    parentAwareness,
    // 保留原始回答片段用于报告引用
    keyQuotes: {
      idealPerson:       pa.values_ideal_person    ? pa.values_ideal_person.slice(0, 60)    : '',
      hopeFromAssessment:pa.reflection_hope        ? pa.reflection_hope.slice(0, 60)        : '',
      childRelationState:pa.family_parent_child_state ? pa.family_parent_child_state.slice(0, 60) : '',
      childPassion:      pa.interest_passion       ? pa.interest_passion.slice(0, 60)       : '',
    },
  };
}

// ── Layer 3：适配性评分 ───────────────────────────────────────
function scoreCompatibility(childPortrait, familyPortrait, answers, miScores, mindsetScore, parentAnswers) {
  const pa = parentAnswers || {};
  const ms = Number(mindsetScore) || 3;

  // ── 维度一：性格韧性（出国最需要的底层能力）
  const interScore = (miScores.interpersonal || 3) / 5;
  const intraScore = (miScores.intrapersonal || 3) / 5;
  const mindsetNorm = (ms - 1) / 4;
  const stressRaw = kw_score(pa.emotion_stress_response, KW.resilient, KW.fragile);
  const autoRaw   = kw_score(pa.autonomy_self_manage, KW.independent, KW.dependent);
  const resilience = (interScore * 0.2 + intraScore * 0.15 + mindsetNorm * 0.3 + stressRaw * 0.2 + autoRaw * 0.15);

  // ── 维度二：能力基础（加权：语言是出国核心 + 英语实际水平 + 学业层次）
  const weightedMI = Object.entries(miScores || {}).reduce((sum, [k, v]) => {
    return sum + (Number(v) || 0) * (MI_ABROAD_WEIGHT[k] || 1.0);
  }, 0);
  const maxWeightedMI = 5 * Object.values(MI_ABROAD_WEIGHT).reduce((a, b) => a + b, 0);
  const lingScore = (miScores.linguistic || 3) / 5;
  const abilityBase = weightedMI / maxWeightedMI;
  // 英语实际水平（weak=0.1 / basic=0.4 / good=0.7 / native=1.0）
  const englishScoreMap = { weak: 0.10, basic: 0.40, good: 0.70, native: 1.00 };
  const englishNorm = englishScoreMap[answers.englishLevel] ?? 0.45;
  // 学业层次（low=0.2 / mid=0.5 / upper_mid=0.75 / top=1.0）
  const academicScoreMap = { low: 0.20, mid: 0.50, upper_mid: 0.75, top: 1.00 };
  const academicNorm = academicScoreMap[answers.academicTier] ?? 0.50;
  // 能力基础：MI权重减小，加入英语和学业的实测数据
  const ability = abilityBase * 0.50 + lingScore * 0.15 + englishNorm * 0.20 + academicNorm * 0.15;

  // ── 维度三：兴趣驱动力
  const interestRaw = kw_score(pa.interest_passion, KW.genuine, KW.passive);
  const academicRaw = kw_score(pa.academic_motivation, KW.independent, KW.dependent);
  const topMIScore = (childPortrait.topIntelligences[0]?.score || 3) / 5;
  const motivation = interestRaw * 0.4 + academicRaw * 0.3 + topMIScore * 0.3;

  // ── 维度四：家庭支持度
  const commNorm = familyPortrait.complete
    ? (familyPortrait.commQuality === 'high' ? 0.85 : familyPortrait.commQuality === 'medium' ? 0.55 : 0.3)
    : 0.5;
  const consensusNorm = familyPortrait.valueConsensus === 'aligned' ? 0.85
    : familyPortrait.valueConsensus === 'diverged' ? 0.3 : 0.55;
  const engagementNorm = familyPortrait.complete ? familyPortrait.avgDepth : 0.5;
  // 教养方式加分（权威型加分，控制型减分，宽松型中性）
  const parentingBonus = familyPortrait.parentingStyle === 'authoritative' ? 0.1
    : familyPortrait.parentingStyle === 'authoritarian' ? -0.05 : 0;
  const familySupport = commNorm * 0.35 + consensusNorm * 0.30 + engagementNorm * 0.25 + 0.1 + parentingBonus;

  // ── 加权总分（与袁希矩阵权重一致）
  const overall = resilience * 0.30 + ability * 0.30 + motivation * 0.20 + Math.min(1, familySupport) * 0.20;
  const overallPct = Math.round(overall * 100);

  const level = (s) => s > 0.68 ? 'high' : s > 0.42 ? 'medium' : 'low';
  // 成长型思维框架：低分 = 成长空间大，而非能力不足；颜色从红色改为温暖琥珀色
  const levelLabel = (s) => ({ high: '优势突出', medium: '稳步成长', low: '潜力充足' })[level(s)];
  const levelColor = (s) => ({ high: '#2A7A5A', medium: '#C49A22', low: '#8B6914' })[level(s)];

  // 每个维度附上"证据句"——让报告有依据感
  const evidences = {
    resilience: _evidenceResilience(pa, childPortrait, ms),
    ability:    _evidenceAbility(childPortrait, miScores, answers),
    motivation: _evidenceMotivation(pa, childPortrait),
    family:     _evidenceFamily(familyPortrait, pa),
  };

  return {
    dimensions: [
      { id: 'resilience', label: '性格韧性', icon: '💪', score: Math.round(resilience * 100),
        level: level(resilience), levelLabel: levelLabel(resilience), levelColor: levelColor(resilience),
        evidence: evidences.resilience },
      { id: 'ability',    label: '能力基础', icon: '🧠', score: Math.round(ability * 100),
        level: level(ability),    levelLabel: levelLabel(ability),    levelColor: levelColor(ability),
        evidence: evidences.ability },
      { id: 'motivation', label: '兴趣驱动', icon: '✨', score: Math.round(motivation * 100),
        level: level(motivation), levelLabel: levelLabel(motivation), levelColor: levelColor(motivation),
        evidence: evidences.motivation },
      { id: 'family',     label: '家庭支持', icon: '🏠', score: Math.round(Math.min(1, familySupport) * 100),
        level: level(familySupport), levelLabel: levelLabel(familySupport), levelColor: levelColor(familySupport),
        evidence: evidences.family },
    ],
    overall: overallPct,
    overallLevel: level(overall),
    overallLabel: overallPct >= 68 ? '综合基础扎实' : overallPct >= 42 ? '成长势头良好' : '成长空间充沛',
    overallColor: levelColor(overall),
    // ── 情绪价值：分数背景说明（低分用温暖语言稳定家长情绪）──────
    scoreContext: _buildScoreContext(overallPct),
  };
}

// ── 情绪价值：分数背景说明 ────────────────────────────────────────
// 来源：成长型思维（Dweck, 2006）、自我决定论（Deci & Ryan）
// 目的：帮助家长理解分数含义，消除焦虑，提供希望感
function _buildScoreContext(overallPct) {
  if (overallPct >= 68) {
    return {
      headline: '孩子已经具备了很好的出发基础',
      body: '这份评估反映出孩子在独立性、能力和驱动力上已有扎实的积累。您作为家长在背后的观察与陪伴，是这一切的重要底色。',
      tone: 'positive',
    };
  }
  if (overallPct >= 42) {
    return {
      headline: '孩子正处在加速成长的黄金期',
      body: '评分处于中间区间，说明基础已有、方向已明，接下来是把能量集中在最关键的几个点上。这个阶段的孩子往往进步最快。',
      tone: 'encouraging',
    };
  }
  // 低分：最需要情绪价值的场景
  return {
    headline: '分数低，不代表孩子的上限低',
    body: '我们发现，很多认真负责的家长在回答问题时习惯谦虚低估——这是一种文化上对孩子的保护，而非孩子真实能力的反映。这份评估测量的是当下的起点，而起点低恰恰意味着成长空间最大。很多后来表现出色的孩子，都从这里出发。',
    tone: 'warm',
  };
}

function _evidenceResilience(pa, childPortrait, ms) {
  const lines = [];
  if (ms >= 4) lines.push('成长型思维得分较高，面对挑战时具备很好的心理弹性');
  else if (ms < 3) lines.push('目前孩子遇到困难时可能倾向绕开，这在这个年龄段很常见——有意识地创造小挑战场景，会加速这一能力的发展');
  const auto = pa.autonomy_self_manage || '';
  if (KW.independent.some(w => auto.includes(w))) lines.push('家长观察到孩子具备较好的自我管理能力，这是一个重要信号');
  else if (KW.dependent.some(w => auto.includes(w))) lines.push('孩子目前在家长陪伴下成长，这是很正常的阶段——独立能力往往在有意识的练习中快速提升');
  const stress = pa.emotion_stress_response || '';
  if (KW.fragile.some(w => stress.includes(w))) lines.push('对压力比较敏感，这种细腻的感受力是很多有创造力孩子的特质，引导得当会成为优势');
  return lines.length ? lines.join('；') : '在现有信息下，性格韧性有进一步挖掘的空间，很多孩子在真实环境中表现会超出家长预期';
}

function _evidenceAbility(childPortrait, miScores, answers) {
  const top = childPortrait.topIntelligences[0];
  const lingScore = miScores.linguistic || 3;
  const lines = [];
  if (top) lines.push(`${top.label}是孩子最突出的能力方向（${top.pct}%），这是一个值得重点培养的优势`);
  if (lingScore >= 4) lines.push('语言类智能较强，这是在国际化环境中建立自信的重要优势');
  else if (lingScore <= 2) lines.push('语言类智能尚在发展中，这类能力在合适的语言环境浸泡下往往进步很快');
  // 英语实测
  const engLvl = answers?.englishLevel;
  if (engLvl === 'native') lines.push('英语接近母语水平，在国际环境中完全没有适应期');
  else if (engLvl === 'good')  lines.push('英语已能流畅表达，可以无障碍进入全英文课程环境');
  else if (engLvl === 'basic') lines.push('英语正处于打基础阶段，系统备考后提升空间很大');
  else if (engLvl === 'weak')  lines.push('英语目前是首要突破口——好消息是，英语是所有技能里最能靠时间和方法弥补的');
  // 学业层次
  const acadTier = answers?.academicTier;
  if (acadTier === 'top')       lines.push('学业表现出色（年级前列），具备申请优质学校的有力基础');
  else if (acadTier === 'upper_mid') lines.push('学业表现中上，有竞争主流目标学校的真实实力');
  else if (acadTier === 'low')  lines.push('当前学业分数偏低，但很多优秀的出国路径并不只看成绩——特长、个人陈述和标化成绩都是机会窗口');
  return lines.join('；') || '能力结构尚在全面发展中，多元智能的评估往往比单一成绩更能反映孩子真实的潜力';
}

function _evidenceMotivation(pa, childPortrait) {
  const lines = [];
  const passion = pa.interest_passion || '';
  if (KW.genuine.some(w => passion.includes(w))) {
    lines.push('孩子有真正发自内心的兴趣驱动，这种内在动力是外部压力无法替代的宝贵资源');
  } else if (KW.passive.some(w => passion.includes(w))) {
    lines.push('孩子目前的兴趣更多来自外部安排，这在很多孩子的成长初期都是正常状态——找到那个让他/她"忘记时间"的事情，是接下来很值得做的一件事');
  }
  if (passion.trim().length > 20) lines.push(`家长描述："${passion.slice(0, 30)}…"`);
  return lines.join('；') || '兴趣方向还在探索中——这不是问题，有很多孩子在中学后期才找到真正的热情方向，而那种"晚发现"往往反而更持久';
}

function _evidenceFamily(familyPortrait, pa) {
  if (!familyPortrait.complete) return '您已经开始思考孩子的成长路径——这本身就是一个积极的信号。补充家长问卷后，我们可以给出更贴近您家庭实际的建议';
  const lines = [];
  lines.push(`亲子沟通质量：${familyPortrait.commLabel}`);
  if (familyPortrait.valueConsensus === 'diverged') lines.push('家长与孩子在未来方向上存在一定分歧，建议在路径确认前充分对话');
  else if (familyPortrait.valueConsensus === 'aligned') lines.push('家长与孩子在教育目标上方向一致，这是推进规划的重要基础');
  if (familyPortrait.engagementLabel === '深度参与') lines.push('家长对孩子的观察细致入微，问卷回答质量高');
  return lines.join('；');
}

// ── Layer 4：路径建议 ─────────────────────────────────────────
// rawCd 是完整的 collectedData，用于读取 Phase 1 引擎的输出（向后兼容，可为 null）
function recommendPath(compatibility, answers, parentAnswers, childPortrait, rawCd) {
  const pa = parentAnswers || {};
  const compat = compatibility;
  const overall = compat.overall;
  const resScore = compat.dimensions.find(d => d.id === 'resilience')?.score || 50;
  const abilScore = compat.dimensions.find(d => d.id === 'ability')?.score || 50;
  const stage     = (answers || {}).schoolStage || 'middle';
  const geoPref   = (answers || {}).geo_preference || 'open';
  const pathPref  = (answers || {}).education_path_preference || 'undecided';
  const schoolType = (answers || {}).schoolType || '';

  // ── Phase 1 引擎输出读取（最小适配层） ──────────────────────────
  // 如果 path_engine 已经判断且置信度足够，用它的结论覆盖路径字段
  // 如果没有（旧数据流），完全走下面的原有逻辑
  const pj = (rawCd || {}).pathJudgment;
  const _phase1Override = pj && pj.primaryPath && pj.primaryPath !== 'pending' && pj.confidence >= 0.5;

  // ── Phase 1 风险标签读取 ──────────────────────────────────────────
  const _riskFlags = ((rawCd || {}).riskFlags || []);
  const _highRisks = _riskFlags.filter(f => f.level === 'high');
  const _medRisks  = _riskFlags.filter(f => f.level === 'medium');

  // 判断逻辑：优先尊重用户明确意向，再按袁希四象限 + 加权适配度
  let primaryPath, primaryLabel, primaryIcon, rationale = [], risks = [], alt;

  const idealPerson = pa.values_ideal_person || '';
  const alignment = pa.values_future_alignment || '';
  const wantsAbroad = KW.aligned.some(w => idealPerson.includes(w)) ||
    ['国际', '出国', '海外', '留学', '国外', '英美', 'abroad'].some(w => idealPerson.includes(w) || alignment.includes(w));

  // ── 优先尊重用户明确表达的方向意向 ──────────────────────────────────
  // 明确选择了海外地区 / 海外路径 / 就读国际学校 → 绝不推荐高考
  const ABROAD_GEOS  = ['us', 'uk', 'canada', 'au_nz', 'asia_pacific', 'europe', 'uk_us', 'commonwealth'];
  const ABROAD_PATHS = ['international_school', 'highschool_abroad', 'university_abroad'];
  const mustGoAbroad = ABROAD_GEOS.includes(geoPref) || ABROAD_PATHS.includes(pathPref) || schoolType === 'international';
  // 明确只要国内 → 绝不推荐出国
  const mustStayCN   = geoPref === 'cn_only' || pathPref === 'gaokao';

  if (mustGoAbroad && !mustStayCN) {
    // ── 判断孩子是否已具备出国的基础条件 ──────────────────────────────
    const engLvlRaw = (answers || {}).englishLevel || 'basic';
    const ENG_NUM = { weak: 0, basic: 1, conversational: 2, fluent: 3, native: 4 };
    const engNum  = ENG_NUM[engLvlRaw] || 1;

    const motivScore  = compat.dimensions.find(d => d.id === 'motivation')?.score || 50;
    const familyScore = compat.dimensions.find(d => d.id === 'family')?.score || 50;

    // 综合适配 >= 52 且英语达到日常交流 → 认为已具备出国基础
    const isReadyNow = overall >= 52 && engNum >= 2;

    const preferHighSchoolAbroad = pathPref === 'highschool_abroad' ||
      (pathPref === 'international_school' && stage !== 'high');

    const GEO_CN = { us:'美国', uk:'英国', canada:'加拿大', au_nz:'澳洲/新西兰', asia_pacific:'亚太地区', europe:'欧洲大陆', uk_us:'英美', commonwealth:'英联邦' };
    const geoLabel = GEO_CN[geoPref] || '海外';

    if (isReadyNow) {
      // ── 具备基础，直接走出国路径 ─────────────────────────────────
      if (preferHighSchoolAbroad) {
        primaryPath = 'abroad_high'; primaryLabel = '高中出国路线'; primaryIcon = '✈️';
        rationale = [
          `出国方向明确，目标是${geoLabel}，孩子现有基础可以支撑这个路径`,
          '目前学段正是布局的好时机，时间窗口充足',
          '建议先锁定目标国家的具体学校层级，再反推语言和学业准备时间线',
        ];
        risks = ['需要系统规划英语路径，尽早做一次正式测试了解真实起点', '建议评估具体学校层级，找到真正匹配孩子能力的选项'];
        alt = '国际学校过渡路线';
      } else {
        primaryPath = 'abroad_uni'; primaryLabel = '大学出国路线'; primaryIcon = '🌏';
        rationale = [
          `出国方向明确，目标是${geoLabel}，大学阶段是最具性价比的出发点`,
          '高中阶段可在国内国际化环境中夯实基础，降低适应风险，两手准备',
          '孩子的英语基础和综合适配度已达到出发条件',
        ];
        risks = ['需尽快启动标化考试准备（TOEFL / IELTS / SAT）', '大学选校策略需结合孩子实际能力水平，避免全冲高风险'];
        alt = '国内精英院校（高考路线）';
      }

    } else {
      // ── 想出国但还差一段路：出国备战路线 ────────────────────────────
      // 分析具体短板，计算备战时间线
      const gaps = [];
      let maxMonths = 0;

      // 英语短板（最常见的硬性门槛）
      if (engNum === 0) {
        gaps.push({ label: '英语能力', detail: '目前英语基础薄弱，达到日常交流水平约需 15-18 个月系统学习', months: 18 });
        maxMonths = Math.max(maxMonths, 18);
      } else if (engNum === 1) {
        gaps.push({ label: '英语能力', detail: '英语处于基础阶段，提升至出国所需的交流水平约需 9-12 个月', months: 12 });
        maxMonths = Math.max(maxMonths, 12);
      }

      // 独立韧性短板
      if (resScore < 40) {
        gaps.push({ label: '独立与韧性', detail: '独立生活能力和情绪韧性仍需专项培养，建议 12-15 个月结构化练习', months: 15 });
        maxMonths = Math.max(maxMonths, 15);
      } else if (resScore < 52) {
        gaps.push({ label: '独立韧性', detail: '韧性基础已有，还需 6-9 个月持续锻炼，让孩子能真正面对陌生环境', months: 9 });
        maxMonths = Math.max(maxMonths, 9);
      }

      // 学业能力短板
      if (abilScore < 38) {
        gaps.push({ label: '学业基础', detail: '学业成绩与目标学校的要求仍有差距，需要 9-12 个月针对性补强', months: 12 });
        maxMonths = Math.max(maxMonths, 12);
      }

      if (maxMonths === 0) maxMonths = 9;
      const timelineMonths = maxMonths;
      const timelineLabel = timelineMonths <= 9 ? '约9个月' : timelineMonths <= 12 ? '约12个月' : timelineMonths <= 18 ? '约18个月' : '约24个月';

      // 挖掘孩子身上真正适合出国的优势
      const strengths = [];
      if (motivScore >= 58) strengths.push('有内在的好奇心和探索欲，这类孩子到了新环境往往反而如鱼得水');
      if (schoolType === 'international') strengths.push('已在国际化学校就读，具备跨文化适应的初步基础');
      if (engNum >= 2) strengths.push('英语交流能力已具备，语言最难的那一关已经迈过');
      if (familyScore >= 58) strengths.push('家庭支持力强且方向一致，这是出国路径最关键的外部条件');
      if (resScore >= 50) strengths.push('具备一定的韧性底子，不容易在压力下崩塌');
      // MI 特质加成
      const topMI = (childPortrait?.topIntelligences || [])[0];
      const MI_ABROAD_FIT = {
        linguistic: '语言类智能突出，非常适合融入语言浸润式的海外学习环境',
        spatial:    '空间视觉型思维在设计/建筑/艺术等领域有国际竞争力',
        musical:    '音乐艺术类才能在欧美有丰富的专业发展路径',
        naturalist: '对自然和科学的兴趣与欧美强调探究式学习的教育风格高度契合',
        interpersonal: '人际感知力强，这是在海外快速建立社交网络的天然优势',
        logical:    '逻辑分析型思维在理工科领域具备国际竞争潜力',
      };
      if (topMI && MI_ABROAD_FIT[topMI.key]) strengths.push(MI_ABROAD_FIT[topMI.key]);

      if (strengths.length === 0) strengths.push('家庭对国际化有清晰的目标，这本身是出国路径成功的重要前提');

      primaryPath = 'abroad_prep';
      primaryLabel = '出国备战路线';
      primaryIcon = '🌱';
      rationale = [
        `孩子有真实的出国潜力：${strengths.slice(0, 2).join('；')}`,
        `当前距离出国条件还差${gaps.length > 0 ? gaps.map(g => g.label).join('、') : '一些准备'}，专项突破后完全可以实现`,
        `我们的判断：经过 ${timelineLabel} 针对性准备，孩子出发${geoLabel}${preferHighSchoolAbroad ? '高中' : '大学'}的条件基本成熟`,
      ];
      risks = gaps.map(g => `${g.label}：${g.detail}`);
      if (risks.length === 0) risks = ['建议做一次全面的能力评估，精确定位具体短板再制定计划'];
      alt = `${timelineLabel}后正式启动${geoLabel}${preferHighSchoolAbroad ? '高中' : '大学'}申请`;

      // 把 timeline 信息也挂在返回对象上，供 UI 单独渲染
      const confidence = overall >= 45 ? 'medium' : 'low';
      const confidenceLabel = { high: '高置信度', medium: '中置信度', low: '建议深度咨询后确认' }[confidence];
      return {
        primaryPath, primaryLabel, primaryIcon,
        confidence, confidenceLabel,
        rationale, risks, alternativePath: alt, pathKey: primaryPath,
        timeline: timelineLabel,
        timelineMonths,
        gapDetails: gaps,
        strengths,
      };
    }

  } else if (mustStayCN) {
    // 用户明确选择国内路线
    primaryPath = 'gaokao'; primaryLabel = '国内高考路线'; primaryIcon = '📚';
    rationale = ['您选择了以国内发展为主的路径', '高考是通往国内顶尖院校的主要通道', '建议结合孩子的优势科目制定针对性的备考策略'];
    risks = ['高考赛道竞争激烈，要选好具有差异化优势的方向', '建议定期重新评估，适配度提升后可拓展国际化选项'];
    alt = '国内顶尖院校 + 海外研究生路线';

  } else {
    // undecided / open → 按适配度分数决策（原有逻辑）
    if (overall >= 68 && resScore >= 60) {
      // 高适配 + 韧性足够 → 出国路径
      if (stage === 'high') {
        primaryPath = 'abroad_uni'; primaryLabel = '大学出国路线'; primaryIcon = '🌏';
        rationale = ['孩子综合适配度高，能力与韧性基础具备', '高中阶段出国时间窗口紧迫，大学出国是现实最优解', '可同步保留高考选项作为备选'];
        risks = ['需尽快启动语言准备（TOEFL/SAT）', '大学选校策略需结合孩子实际能力水平'];
        alt = '国内精英院校（高考路线）';
      } else {
        primaryPath = 'abroad_high'; primaryLabel = '高中出国路线'; primaryIcon = '✈️';
        rationale = ['综合适配度高，出国时间窗口充足', '提前进入国际环境有助于真正融入而非仅拿文凭', '孩子的性格韧性适合面对文化适应挑战'];
        risks = ['需要评估具体目标国家和学校层级', '语言准备需要系统规划，建议现在开始'];
        alt = '国际学校过渡路线';
      }
    } else if (overall >= 45) {
      // 中等适配 → 建议混合或国际学校过渡
      primaryPath = 'hybrid'; primaryLabel = '混合过渡路线'; primaryIcon = '🔄';
      rationale = ['孩子具备一定基础，但某些维度仍需加强', '建议先在国内国际化环境中适应，逐步向出国路径迁移', '降低"直接出海"的风险，同时保持国际化目标'];
      risks = ['过渡期需要清晰的阶段目标，避免走一步算一步', '家长需要与孩子对齐期望，避免方向摇摆'];
      alt = '高考+出国研究生路线';
    } else {
      // 低适配 → 国内路线为主，出国可作长期备选
      primaryPath = 'gaokao'; primaryLabel = '国内高考路线'; primaryIcon = '📚';
      rationale = ['孩子目前在独立性或能力基础方面仍需加强', '在熟悉的环境中建立自信是当前最优先的事', '高考路线不是放弃国际化，而是打好地基再起高楼'];
      risks = ['建议密切关注孩子的成长变化，适配度提升后可重新评估', '高考赛道竞争激烈，要选好具有差异化优势的方向'];
      alt = '职业技术/国际研究生路线';
    }
  }

  // ── 英语水平和学业层次的额外风险标注 ──────────────────────────
  const engLvl = (answers || {}).englishLevel;
  const acadTier = (answers || {}).academicTier;

  if (primaryPath !== 'gaokao') {
    if (engLvl === 'weak') {
      risks.push('⚠️ 英语基础薄弱是当前最关键的风险，出国路径必须先解决英语问题');
    } else if (engLvl === 'basic') {
      risks.push('英语仍处于日常交流水平，需要系统提升至学术水平（雅思6.5+）');
    }
  }
  if (acadTier === 'low' && primaryPath !== 'gaokao') {
    risks.push('学业成绩偏低，申请优质学校时需要通过其他维度（特长/标化成绩）弥补');
  }
  if (acadTier === 'top' && primaryPath === 'gaokao') {
    rationale.push('学业表现优秀，具备冲击顶尖高校的实力');
  }

  const confidence = overall >= 70 ? 'high' : overall >= 45 ? 'medium' : 'low';
  const confidenceLabel = { high: '高置信度', medium: '中置信度', low: '建议深度咨询后确认' }[confidence];

  // ── 暴露地理偏好信息，供 UI 做透明度说明 ──────────────────────
  const GEO_FLAG_LABELS = {
    us: '🇺🇸 美国', uk: '🇬🇧 英国', canada: '🇨🇦 加拿大', au_nz: '🇦🇺 澳洲/新西兰',
    asia_pacific: '🌏 亚太地区', europe: '🇪🇺 欧洲大陆', uk_us: '🇬🇧🇺🇸 英美', commonwealth: '🌐 英联邦',
    cn_only: '🇨🇳 国内', open: null,
  };
  const geoPreference = geoPref;                    // 'uk' / 'au_nz' / 'open' 等
  const geoFlagLabel  = GEO_FLAG_LABELS[geoPref] || null;   // '🇬🇧 英国' 等（open时为null）

  // ── v1: Phase 1 新引擎置信度足够时，将判断理由注入 rationale ─────
  if (_phase1Override) {
    const p1Reasons = (pj.reasons || []).map(r => `[决策引擎] ${r}`);
    if (p1Reasons.length > 0) {
      rationale = [...p1Reasons, ...rationale].slice(0, 5);
    }
  }

  // ── v1: 硬门槛说明注入 rationale（如触发了硬门槛）─────────────
  const _hardResult = pj ? pj.hardResult : null;
  if (_hardResult && _hardResult.hasHardBlock) {
    const hardExpl = (_hardResult.explanations || []).slice(0, 1);
    if (hardExpl.length > 0) {
      risks = [...risks, ...hardExpl.map(e => `⚠️ ${e}`)];
    }
  }

  // ── v1: 风险摘要 ──────────────────────────────────────────────────
  const riskSection = _riskFlags.length > 0 ? {
    total:  _riskFlags.length,
    high:   _highRisks.length,
    medium: _medRisks.length,
    items:  _riskFlags.map(f => ({ level: f.level, description: f.description })),
  } : null;

  // ── v1: 时间线摘要 ─────────────────────────────────────────────────
  const _timeline = pj ? pj.timeline : null;
  const timelineSection = _timeline ? {
    totalRange:    _timeline.totalRange.label,
    bottleneck:    _timeline.bottleneck.name + '：' + _timeline.bottleneck.label,
    reassessAt:    _timeline.reassessAt,
    isCritical:    _timeline.isCritical,
    isReadyNow:    _timeline.isReadyNow,
    stageLabel:    _timeline.stageLabel,
  } : null;

  // ── v1: 透明解释摘要 ────────────────────────────────────────────────
  const _explanations = pj ? (pj.explanations || []) : [];
  const transparencySection = _explanations.length > 0 ? {
    count:   _explanations.length,
    primary: _explanations[0] || null,
  } : null;

  // ── v1: 决策日志（来自 cd.decision_log）────────────────────────────
  const decisionLog = (rawCd || {}).decision_log || null;

  // ── v1: 5字段路径结构（来自 path_engine v1 输出）────────────────────
  const structuredPath = pj ? {
    primaryPath:          pj.primaryPath,
    alternativeBlocked:   pj.alternativeBlocked   || [],
    transitionConditions: pj.transitionConditions || [],
    reassessAt:           pj.reassessAt           || null,
  } : null;

  // ── v2: 分层学校匹配（reach/target/safety）────────────────────────
  let matchedSchools = null;
  try {
    matchedSchools = matchSchools(rawCd || {}, pj || {});
  } catch (e) {
    console.warn('[report_engine] matchSchools failed:', e);
  }

  // ── v2: 一致性摘要文本（注入 AI 提示词，不直接显示）──────────────
  const consistencyText = buildConsistencyText(rawCd || {});

  // ── v2: 证据摘要文本（注入 AI 提示词，不直接显示）────────────────
  const evidenceText = buildEvidenceText(rawCd || {});

  return {
    primaryPath, primaryLabel, primaryIcon,
    confidence, confidenceLabel, rationale, risks, alternativePath: alt, pathKey: primaryPath,
    geoPreference,
    geoFlagLabel,
    // ── 以下为 v1 新增字段 ─────────────────────────────────────────
    phase1PathJudgment:  pj              || null,
    riskSection,
    timelineSection,
    transparencySection,
    structuredPath,
    decisionLog,
    phase1Confidence:    pj ? pj.confidence : null,
    hardRulesTriggered:  _hardResult ? _hardResult.triggeredIds : [],
    // ── 以下为 v2 新增字段 ─────────────────────────────────────────
    matchedSchools,      // { reach:[], target:[], safety:[], geoExplanation, resourceWarning }
    consistencyText,     // 注入 buildAnalysisPrompt
    evidenceText,        // 注入 buildAnalysisPrompt
  };
}

// ── Layer 5：三个行动 ─────────────────────────────────────────
function deriveActions(compatibility, pathRec, answers, parentAnswers, childPortrait) {
  const pa = parentAnswers || {};
  const path = pathRec.primaryPath;
  const resScore = compatibility.dimensions.find(d => d.id === 'resilience')?.score || 50;
  const stage = (answers || {}).schoolStage || 'middle';
  const actions = [];

  // 行动1：最紧迫的一步（基于最弱维度）
  const weakest = [...compatibility.dimensions].sort((a, b) => a.score - b.score)[0];
  const action1Map = {
    resilience: { title: '从现在起每周给孩子一个独立决策的机会', timeframe: '立即开始', icon: '💪',
      description: '比如让孩子自己规划一次周末、自己解决一个小问题。不干预、不救场，让孩子真实体验"我能做到"的感觉。独立性是出国生活的第一门课。' },
    ability:    { title: '系统启动英语能力评估与规划', timeframe: '本月内', icon: '🗣️',
      description: '请做一次正式的英语水平测试（雅思/托福诊断卷），了解真实起点。语言是国际化路径上唯一没有捷径的能力，越早开始越从容。' },
    motivation: { title: '和孩子做一次不带结论的兴趣对话', timeframe: '本周内', icon: '✨',
      description: '不是"你要好好学xxx"，而是问：你觉得什么事情让你完全忘记时间？只听，不评判，不引导。真实兴趣是最持久的动力来源。' },
    family:     { title: '全家坐下来做一次教育方向的价值观对齐', timeframe: '本月内', icon: '🏠',
      description: '父母和孩子各自说出自己心目中"成功"的定义，然后找交集。方向分歧越早解决，代价越小。方向一致的家庭，规划效率是分歧家庭的3倍。' },
  };
  const a1base = action1Map[weakest.id] || action1Map.resilience;
  actions.push({ priority: 1, ...a1base });

  // 行动2：路径方向的具体准备动作
  const action2Map = {
    abroad_high: { title: '启动高中出国学校选校研究', timeframe: '1-3个月内', icon: '🔍',
      description: '重点调研加拿大/澳洲/英国的公立寄宿高中——这些是性价比最高的起点。建议列出5所候选学校，了解申请时间线和要求。' },
    abroad_uni:  { title: '开始规划大学申请路线图', timeframe: '1-3个月内', icon: '🗺️',
      description: '明确目标国（美国/英国/加拿大/香港），了解申请时间线。如果目标美国，需要同步规划TOEFL和SAT的备考节奏。' },
    hybrid:      { title: '考察1-2所国际学校/双语学校', timeframe: '1-3个月内', icon: '🏫',
      description: '实地参观，让孩子感受一下国际化环境是否适合自己。感受到"舒适且有挑战"的环境才是真正适配的环境，不要只看排名和学费。' },
    gaokao:      { title: '确定孩子的核心优势科目，制定差异化策略', timeframe: '1-3个月内', icon: '📊',
      description: '高考赛道的关键是找到孩子的差异化优势，而不是全面平均发力。与老师谈一次，了解孩子真实的学科潜力排序。' },
    abroad_prep: { title: `制定 ${pathRec.timeline || '12个月'} 出国备战计划`, timeframe: '本月内启动', icon: '🗓️',
      description: `出国路径不是现在走不了，而是需要先把短板补齐。建议这周把三件事排进日程：① 英语测试摸底，② 和孩子谈出国的真实期待，③ 联系1-2所目标学校了解申请要求，让目标变得具体。` },
  };
  actions.push({ priority: 2, ...(action2Map[path] || action2Map.gaokao) });

  // 行动3：家长端需要做的一件事
  const commQuality = compatibility.dimensions.find(d => d.id === 'family')?.level || 'medium';
  const parentingStyle = (childPortrait?.parentingStyle) || 'unknown';
  let a3;
  if (commQuality === 'low') {
    a3 = { title: '重建亲子沟通渠道', timeframe: '持续进行', icon: '💬',
      description: '从每天10分钟的非评判对话开始。规则是：你说的时候我只听，不建议、不评价。孩子愿意说话，是所有规划成功的前提。' };
  } else if (path === 'abroad_prep') {
    a3 = { title: '和孩子一起研究目标国的真实留学生活', timeframe: '本月内', icon: '🌍',
      description: '不是看宣传片，而是找1-2个真实在那边生活的孩子聊聊，或者看纪录片/Vlog。让孩子对"出国"有真实的认知后再问：你还想去吗？孩子自己说"想"，比家长推更有持续动力。' };
  } else if (path === 'abroad_high' || path === 'abroad_uni') {
    a3 = { title: '和孩子一起研究目标国家的真实生活', timeframe: '1个月内', icon: '🌍',
      description: '不是看宣传片，而是找1-2个真实在那边生活的孩子聊聊。让孩子对"出国"有真实的、祛魅的认知，然后再问他：你还想去吗？' };
  } else {
    a3 = { title: '阅读一本关于教育路径决策的书', timeframe: '1个月内', icon: '📖',
      description: '推荐：《学习之道》（芭芭拉·奥克利）或《养育的选择》。家长的认知边界，直接决定了孩子选项的边界。' };
  }
  actions.push({ priority: 3, ...a3 });

  return actions;
}

// ── 主入口 ────────────────────────────────────────────────────
function generateReport(assessmentData) {
  const {
    answers = {},
    miScores = {},
    mindsetScore = 3,
    parentAnswers = {},
  } = assessmentData || {};

  // ── Phase 1 引擎输出（如果存在，优先使用新引擎的结果） ──────────
  // pathJudgment 和 riskFlags 由 path_engine / risk_engine 在对话流结束时写入 cd
  // 如果是旧数据（没有新字段），完全走原有逻辑，向后兼容
  const rawCd = assessmentData || {};

  const childPortrait   = buildChildPortrait(answers, miScores, mindsetScore);
  const familyPortrait  = buildFamilyPortrait(parentAnswers);
  const compatibility   = scoreCompatibility(childPortrait, familyPortrait, answers, miScores, mindsetScore, parentAnswers);
  const pathRec         = recommendPath(compatibility, answers, parentAnswers, childPortrait, rawCd);
  const actions         = deriveActions(compatibility, pathRec, answers, parentAnswers, childPortrait);

  return {
    meta: {
      childName:   childPortrait.childName,
      childAge:    childPortrait.childAge,
      schoolStage: childPortrait.schoolStageLabel,
      generatedAt: Date.now(),
      hasParentData: familyPortrait.complete,
    },
    childPortrait,
    familyPortrait,
    compatibility,
    pathRecommendation: pathRec,
    actions,
  };
}

module.exports = { generateReport, MI_LABELS };
