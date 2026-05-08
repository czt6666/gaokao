// pages/ai-chat/ai-chat.js
// 战略成长™ · 智能成长评估系统
//
// ═══════════════════════════════════════════════════════════════════
//  架构说明：
//  【收集阶段】我们控制提问 → 用户回答 → 关键词打分提取数据
//  【分析阶段】将收集数据发送给AI → AI用袁希方法论+心理学理论生成报告
//
//  AI接入说明（正式上线时启用）：
//  1. 微信开发者工具 → 云开发 → 新建云函数 "aiAnalysis"
//  2. 云函数内调用 Claude/GPT/文心/通义 API（见 _buildAnalysisPrompt）
//  3. 将 USE_REAL_AI 设为 true
// ═══════════════════════════════════════════════════════════════════

const {
  YUANXI_QUOTES, DETOX_FRAMEWORK, PARENT_ARCHETYPES, CORE_PHILOSOPHY,
  YUANXI_IDENTITY, AI_DIALOGUE_PRINCIPLES, THREE_FRAMEWORKS,
  THEORY_QUICK_REFERENCE,
} = require('../../utils/yuanxi_knowledge');
const { MI_NAMES } = require('../../utils/matcher');
const Scorer = require('../../utils/persona_scorer');
const { retrieve, diverseRetrieve, detectIntents, formatForPrompt } = require('../../utils/education_knowledge');
// ── Phase 1 新引擎 ─────────────────────────────────────────────────
const { syncLegacyFields } = require('../../utils/field_schema');
const { runRiskScan, getTopDeepDiveRisk } = require('../../utils/risk_engine');
const { judgePath, buildPathConfirmText } = require('../../utils/path_engine');
// ── Phase 2 新引擎（v2）────────────────────────────────────────────
const { detectAndRecord }          = require('../../utils/evidence_engine');
const { checkConsistency, applyConsistencyToCD, buildConsistencyText } = require('../../utils/consistency_engine');
const { getSlotStatus, needsEvidenceProbe, getEvidenceProbeText, buildDynamicQueue } = require('../../utils/interview_engine');
const { matchSchools, buildMatchText } = require('../../utils/match_engine');
const { initCaseLog, recordInitialPreference, writeCaseLog, exportCaseLog, getSystemHints } = require('../../utils/case_log');
// ── Phase 3 新引擎（v3）────────────────────────────────────────────
const { checkAndPatch, recordConstitutionViolations } = require('../../utils/constitution_checker');
// ── Phase 4: 教育语义基座（v1）─────────────────────────────────────
const {
  detectFromText: semDetectFromText,
  shouldSkipQuestion: semShouldSkip,
  getRewordedQuestion: semGetReword,
} = require('../../utils/education_semantic');

// ── Phase 5: LLM 结构化提取引擎（v1）──────────────────────────────
// 替换 regex 意图分类 + extractFn 主要语义字段提取
// LLM 作为结构化提取器：temperature=0.1，maxTokens=400，输出纯 JSON

function _buildExtractionSystemPrompt() {
  return `你是袁希™教育信息提取引擎。采集目标：判断孩子适合高考/出国留学/国际学校哪条路线。

【识别规则（不可违反）】
- 含数字+单位的金额（"90万""50万一年"）= direct_answer，绝不是 vague
- "0基础""零基础" = direct_answer，english_level=weak
- "幼儿园""大班""托班""学前" = direct_answer，grade_group=preschool
- "职高""职校""中专""技校" = direct_answer，grade_group=vocational
- "大学""大一""大二""大三""大四""研究生""本科" = direct_answer，grade_group=university
- "homeschool""在家学习""在家教育" = direct_answer，school_type=homeschool
- "创新学校""华德福""蒙特梭利" = direct_answer，school_type=innovative
- 长度≤5的中文也可能是 direct_answer，不以长度判模糊
- 含逗号但后半段是提问词（"你觉得呢""对吗""是吗"）= question
- "随便""都行""无所谓""看情况"单独出现 = vague

【年级提取规则（grade_group，极易出错，必须严格遵守）】
- "一年级""二年级""三年级""四年级""五年级""六年级""小学X年级""小学生" = grade_group=primary（小学！不是middle）
- "初一""初二""初三""七年级""八年级""九年级" = grade_group=middle
- "高一""高二""高三""十年级""十一年级""十二年级" = grade_group=high
- "小学" 单独出现 = grade_group=primary；"初中" = middle；"高中" = high
- 绝对禁止把"六年级"提取为middle，六年级是小学最后一年

【学业水平提取规则（academic_level，方向不可颠倒）】
- "优秀""前几名""名列前茅""年级前10%""班级前5名" = top10
- "中等偏上""中上""班级前三分之一""前30%" = medium（注意：中上≠top10，是medium）
- "中等""中游""班级中间" = medium
- "中等偏下""中下""后半部分""下游" = below_medium（注意：中下≠medium，是below_medium）
- 绝对禁止把"中下"提取为medium，"中下"只能是below_medium

【出国时间意向规则（overseas_attitude，时态判断关键）】
- "大学后出国""大学毕业后出国""等孩子上了大学再出国""读研再出国" = overseas_attitude=acceptable（长期计划，不是urgent/eager）
- "想出国但现在还小""以后出国" = overseas_attitude=acceptable，不是eager
- "尽快出国""越早越好""现在就想出国" = overseas_attitude=eager
- 不要把"大学后出国"误判为"明年出国"，六年级说大学后出国意味着至少6-7年后

【acknowledgment — 简短反馈】
仅当用户揭示了非常规或高价值信息时填写（普通回答填 null）：
- 非标准学校路径（homeschool/创新/职高/退学）→ 填，例："在家学习的背景我清楚了"
- 预算极高或极低（>80万或<10万）→ 填，例："预算很充裕，路径空间会更宽"
- 明确强烈立场（坚决不出国/急迫要出国）→ 填，例："不出国这个立场我记下了"
- 成绩中等、普通公立学校、常规回答 → null
- 格式：≤15字，自然中文，不以"好的/好"开头

【followup — 智能追问（每题最多追问一次）】
仅当某个关键字段仍不清晰且影响路径判断时，decision=ask，否则 decision=advance：
- 非标准学校（homeschool/创新/职高）但学业评估方式不明 → 追问评估方式
- 成绩用主观词描述（"还行""不错""挺好"）无法判断层级 → 追问具体排名区间
- 出国态度有矛盾信号（说考虑但预算极低，或说不考虑但说孩子很优秀）→ 追问家庭真实立场
- 普通完整回答 → advance，不追问
- question格式：≤25字，直接切入核心，自然口语

只输出 JSON，不加任何说明文字：
{"intent":"direct_answer|negative|question|clarification|challenge|vague","action":"extract|probe|rewrite_question|ai_dispatch","confidence":0.9,"extracted":{"grade_group":"preschool|primary|middle|high|university|vocational|null","school_type":"public_ordinary|public_key|private|international|bilingual|vocational|homeschool|innovative|null","curriculum":"gaokao|ib|alevel|ap|igcse|canadian|australian|hkdse|null","overseas_attitude":"resistant|unclear|acceptable|eager|null","academic_level":"top10|top30|medium|below_medium|null","english_level":"weak|basic|conversational|fluent|null","annual_budget":"under10w|10_20w|20_40w|40_80w|over80w|null","geo_preference":"cn_only|us|uk|canada|au_nz|asia_pacific|europe|open|null","subject_interest":"stem|natural_science|business|humanities|arts_design|communication|undecided|null","family_overseas_acceptance":"fully|acceptable|prefer_not|strongly_against|null","no_overseas":null},"acknowledgment":null,"followup":{"decision":"advance","question":null},"probe_text":null,"reasoning":"一句话解释"}`;
}

function _buildExtractionUserPrompt(text, q, cd, followupQuestion) {
  const sp = (cd && cd.student_profile) || {};
  const fp = (cd && cd.family_profile) || {};
  const ctx = [];
  // 如果是追问答案，用追问题目替换原始 FLOW 题目
  if (followupQuestion) {
    ctx.push(`当前追问：${followupQuestion}`);
    if (q && q.id) ctx.push(`所属题目ID：${q.id}`);
  } else {
    if (q && q.text) ctx.push(`当前问题：${q.text.split('\n')[0]}`);
    if (q && q.id)   ctx.push(`题目ID：${q.id}`);
  }
  if (sp.grade_group)       ctx.push(`已知年级组：${sp.grade_group}`);
  if (sp.school_type)       ctx.push(`已知学校类型：${sp.school_type}`);
  if (sp.curriculum)        ctx.push(`已知课程体系：${sp.curriculum}`);
  if (sp.overseas_attitude) ctx.push(`已知出国态度：${sp.overseas_attitude}`);
  if (sp.academic_level)    ctx.push(`已知成绩层级：${sp.academic_level}`);
  if (fp._no_overseas)      ctx.push(`已标记：不出国`);
  if (followupQuestion)     ctx.push(`注意：这是追问答案，followup.decision必须=advance`);
  const contextStr = ctx.length ? `\n[已知上下文]\n${ctx.join('\n')}` : '';
  return `[用户回答]\n${text}${contextStr}`;
}

function _applyLLMExtraction(extracted, cd) {
  if (!extracted) return;
  const sp = cd.student_profile = cd.student_profile || {};
  const fp = cd.family_profile  = cd.family_profile  || {};

  if (extracted.grade_group && extracted.grade_group !== 'null') {
    sp.grade_group  = extracted.grade_group;
    cd.currentGrade = extracted.grade_group;
  }
  if (extracted.school_type && extracted.school_type !== 'null') {
    sp.school_type = extracted.school_type;
  }
  if (extracted.curriculum && extracted.curriculum !== 'null') {
    sp.curriculum = extracted.curriculum;
    const highEnglishCurricula = ['ib', 'alevel', 'ap', 'igcse', 'canadian', 'australian', 'hkdse'];
    if (highEnglishCurricula.includes(extracted.curriculum) && !sp._intl_auto_english) {
      sp.english_level      = sp.english_level || 'conversational';
      sp._intl_auto_english = true;
    }
  }
  if (extracted.overseas_attitude && extracted.overseas_attitude !== 'null') {
    sp.overseas_attitude = extracted.overseas_attitude;
    if (extracted.overseas_attitude === 'resistant') fp._no_overseas = true;
  }
  if (extracted.academic_level && extracted.academic_level !== 'null') {
    sp.academic_level = extracted.academic_level;
  }
  if (extracted.english_level && extracted.english_level !== 'null') {
    if (!sp._intl_auto_english) sp.english_level = extracted.english_level;
  }
  if (extracted.annual_budget && extracted.annual_budget !== 'null') {
    fp.annual_education_budget = extracted.annual_budget;
    // 旧字段兼容
    const bMap = { under10w:'under_5w', '10_20w':'5w_15w', '20_40w':'15w_30w', '40_80w':'30w_60w', over80w:'over_100w' };
    cd.answers = cd.answers || {};
    cd.answers.education_budget = bMap[extracted.annual_budget] || '15w_30w';
  }
  if (extracted.geo_preference && extracted.geo_preference !== 'null') {
    sp.geo_preference = extracted.geo_preference;
  }
  if (extracted.subject_interest && extracted.subject_interest !== 'null') {
    sp.subject_interest = extracted.subject_interest;
  }
  if (extracted.family_overseas_acceptance && extracted.family_overseas_acceptance !== 'null') {
    fp.family_overseas_acceptance = extracted.family_overseas_acceptance;
  }
  if (extracted.no_overseas === true) {
    fp._no_overseas = true;
  }
  // 国际学校/课程体系 → 出国意向默认可接受
  const intlSchoolTypes = ['international', 'bilingual'];
  const intlCurricula  = ['ib', 'alevel', 'ap', 'igcse', 'canadian', 'australian', 'hkdse'];
  const isIntlCtx = intlSchoolTypes.includes(sp.school_type)
    || (sp.curriculum && intlCurricula.includes(sp.curriculum));
  if (isIntlCtx && !sp.overseas_attitude) {
    sp.overseas_attitude = 'acceptable';
  }
}

// ── 切换真实AI / Mock模式 ──────────────────────────────────────────
// DeepSeek API 已接入，使用真实AI分析
const USE_REAL_AI = true;

// ── 把AI消息最后一句问题拆分出来单独高亮 ──────────────────────────────
function _splitQuestion(text) {
  if (!text) return { contextText: '', questionText: '' };
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // 找最后一个以？或?结尾的句子
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].endsWith('？') || lines[i].endsWith('?')) {
      const context = lines.slice(0, i).join('\n').trim();
      return { contextText: context, questionText: lines[i] };
    }
  }
  return { contextText: text, questionText: '' };
}

// ══════════════════════════════════════════════════════════════════
//  短回答语义分类引擎 v4
//  ── 5种类型：conclusive / negative / temporal / attitudinal / vague
//  ── 只有 vague 型才触发追问
//  ── 修复：复合答案（含逗号）、年级关键词不再被误判为模糊
// ══════════════════════════════════════════════════════════════════
function _classifyShortAnswer(text) {
  const t = (text || '').trim();

  // ── 前置：复合答案检测（"一年级，国际学校" / "初二，公立"）────────
  // 含中文顿号/逗号，且分割后每段长度≥2 → 当作完整复合答案
  const SEP = /[，,、]/;
  if (SEP.test(t)) {
    const parts = t.split(SEP).map(p => p.trim()).filter(p => p.length >= 2);
    if (parts.length >= 2) return { type: 'conclusive', confidence: 0.85 };
  }

  // 类型1：conclusive — 有明确立场/选择
  const CONCLUSIVE = /^(不出国|要出国|出国|高考|国内|留学|国际学校|读国际|英国|美国|加拿大|澳洲|数学|理科|文科|学工程|学医|学商|学文|一年级|二年级|三年级|四年级|五年级|六年级|初一|初二|初三|高一|高二|高三|小学|初中|高中|幼儿园|IB|AP|A-level|双语)$/i;
  if (CONCLUSIVE.test(t)) return { type: 'conclusive', confidence: 0.9 };

  // 类型2：negative — 明确否定/拒绝
  const NEGATIVE = /^(不|没有|没|不是|不打算|不考虑|不想|不准备|不会|暂时不|不太可能|不太想|否)$/;
  if (NEGATIVE.test(t)) return { type: 'negative', confidence: 0.85 };

  // 类型3：temporal — 包含时间意图
  const TEMPORAL = /^(明年|后年|今年|小学毕业|初中毕业|高中毕业|高中|初中|大学|等(孩子|他|她)(大|毕业|升|上)|(再|以后)(说|看|想|考虑))/;
  if (TEMPORAL.test(t) || /^\d{4}年$/.test(t)) return { type: 'temporal', confidence: 0.8 };

  // 类型4：attitudinal — 态度明确但无信息量
  const ATTITUDINAL = /^(随便|都行|无所谓|看情况|再说|不知道|说不准|还没想|没想好|顺其自然|不太确定|不确定|看孩子)$/;
  if (ATTITUDINAL.test(t)) return { type: 'attitudinal', confidence: 0.4 };

  // 类型5：vague — 真正模糊（短且无任何有效语义）
  if (t.length <= 5) return { type: 'vague', confidence: 0.3 };

  // 默认：字数>5 认为有效
  return { type: 'conclusive', confidence: 0.7 };
}

// ══════════════════════════════════════════════════════════════════
//  用户输入意图分析器 v2（替换原 _classifyIntent）
//  ── 6类意图，每类对应明确的动作策略
//
//  返回：{ intentType, action }
//  intentType:
//    'direct_answer'  — 在回答当前问题，推进 FLOW
//    'negative'       — 明确否定/拒绝，也是回答，推进 FLOW
//    'vague'          — 空泛敷衍，触发质量追问，不推进
//    'clarification'  — 要求系统澄清自己问的问题，本地改写，不推进
//    'question'       — 向系统提问（知识/选择/费用等），AI 回答后恢复
//    'challenge'      — 质疑系统判断，AI 回应后恢复
//  action:
//    'extract'          — 正常提取 → 推进
//    'probe'            — 追问质量
//    'rewrite_question' — 本地改写当前问题（不调 AI）
//    'ai_dispatch'      — 调 AI 回答，完成后恢复 FLOW
// ══════════════════════════════════════════════════════════════════
function _analyzeUserInput(text, q) {
  const t = (text || '').trim();
  if (!t) return { intentType: 'direct_answer', action: 'extract' };

  // ────────────────────────────────────────────────────────────────
  // 1. 澄清型：用户在要求系统说清楚自己问的是什么
  //    特征：含"你问的是…/你指的是…/那要看…/哪些科目…"等
  //    动作：本地改写当前题（不调 AI，快速）
  // ────────────────────────────────────────────────────────────────
  const CLARIFICATION =
    /你(要问|问|指|说)的是(哪|什么|哪些|哪类|哪种)|你是说|你问的是|哪些(科目|方面|方向|维度)|什么(科目|意思|方面|方向)|怎么(算|定义|判断|衡量)|这个怎么(说|理解|算)|标准是什么/;
  const CONDITIONAL_DODGE =
    /^(那|这)(要|得)看(具体|情况|孩子|什么|哪些)|取决于(你问的|哪个|什么|具体)/;
  if (CLARIFICATION.test(t) || CONDITIONAL_DODGE.test(t)) {
    return { intentType: 'clarification', action: 'rewrite_question' };
  }

  // ────────────────────────────────────────────────────────────────
  // 2. 纠正型：用户质疑系统的判断或表述
  //    动作：AI 回应 → 恢复 FLOW
  // ────────────────────────────────────────────────────────────────
  // ────────────────────────────────────────────────────────────────
  // 2b. 反问确认型（"是这样吗？"/"对吗？"）→ 属于直接回答
  //     必须在问号检测前先排除，否则会落到 vague
  // ────────────────────────────────────────────────────────────────
  const RHETORICAL_CONFIRM = /^(是这样吗?|对吗?|是吗?|对不对吗?|这样(行|可以|好)吗?|没错吧?|是吧?)[？?]?$/;
  if (RHETORICAL_CONFIRM.test(t)) return { intentType: 'direct_answer', action: 'extract' };

  const CHALLENGE =
    /你(说的|判断的|分析的)?(不对|有问题|不准|不符合|错了)|我(不认为|不觉得|不同意)|这(不符合|不对|不准|跟我的情况)|怎么能这样|凭什么(说|认为)/;
  if (CHALLENGE.test(t)) {
    return { intentType: 'challenge', action: 'ai_dispatch' };
  }

  // ────────────────────────────────────────────────────────────────
  // 3. 反问型：向系统提问（知识/费用/时机/比较等）
  //    动作：AI 回答 → 恢复 FLOW
  // ────────────────────────────────────────────────────────────────
  // 方法3a：以问号结尾
  if (t.endsWith('？') || t.endsWith('?')) {
    return { intentType: 'question', action: 'ai_dispatch' };
  }
  // 方法3b：以"呢"结尾 + 含疑问词（排除陈述语气）
  if (t.endsWith('呢')) {
    // 含"你要问…/你指…"的"呢"结尾 → 已被澄清型捕获，这里只处理知识型
    const HAS_INTERROGATIVE = /哪些|哪个|哪类|哪种|什么(意思|区别|差异)|几个|多少|怎么(做|办|选)|如何|为什么|为何|是否/;
    if (HAS_INTERROGATIVE.test(t) && !CLARIFICATION.test(t)) {
      return { intentType: 'question', action: 'ai_dispatch' };
    }
  }
  // 方法3c：关于流程的疑问
  const META =
    /还有(几个|多少|几题)|问(题|完)了吗|为什么(要问|问这|这么问)|这个(问题|干嘛|有什么用)|[你系统]凭什么|这有什么意义/;
  if (META.test(t)) return { intentType: 'question', action: 'ai_dispatch' };

  // ────────────────────────────────────────────────────────────────
  // 4. 拒绝/否定型：明确否定，本身就是有效答案
  //    动作：正常提取 → 推进 FLOW
  //    注：单独否定词 OR "不考虑出国"这种 否定词+宾语 结构
  // ────────────────────────────────────────────────────────────────
  const NEGATIVE_ONLY =
    /^(不|没有|没|不是|不打算|不考虑|不想|不准备|不会|暂时不|不太可能|不太想|否)(出国|留学|海外|国内|高考|去|做|那样|这个|打算|考虑)?$/;
  if (NEGATIVE_ONLY.test(t)) return { intentType: 'negative', action: 'extract' };

  // ────────────────────────────────────────────────────────────────
  // 5. 空泛型：有说等于没说，需要追问
  //    动作：交给质量门控处理（probe）
  //    注意：这里只返回 action:'probe'，实际追问由 _assessAnswerQuality 执行
  // ────────────────────────────────────────────────────────────────
  const sem = _classifyShortAnswer(t);
  if (sem.type === 'vague') return { intentType: 'vague', action: 'probe' };

  // ────────────────────────────────────────────────────────────────
  // 6. 直接回答型（默认）
  // ────────────────────────────────────────────────────────────────
  return { intentType: 'direct_answer', action: 'extract' };
}

// ══════════════════════════════════════════════════════════════════
//  评估问题流（Phase 1 决策驱动版）
//  S1~S8 状态机：信息采集 → 风险识别 → 路径判断
//
//  特殊字段说明：
//    isSystemStep: true  → 此节点不显示给用户，直接执行 execute() 后跳过
//    skipFn(cd): true    → 满足条件时跳过此问题
//    execute(cd)         → isSystemStep 节点的执行体
// ══════════════════════════════════════════════════════════════════
const FLOW = [

  // ════ S1: 开场 + 姓名 ═══════════════════════════════════════════
  {
    id: 'q_childName',
    stage: 'basic',
    stageLabel: '了解孩子',
    smState: 'S1',
    text: '你好，我是袁希——一个教育路径判断系统。\n\n接下来我会通过几个问题，帮你判断孩子目前更适合高考、出国留学，还是两条路同时准备。\n\n问题不多，每次只问 1-2 个，你直接回答就好。\n\n先认识一下——孩子叫什么名字？昵称就好。',
    options: [],
    aiThinking: ['建立孩子成长档案', '初始化决策系统', '准备路径判断流程'],
    extractFn: (ans, cd) => {
      const name = (ans || '').trim().replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').slice(0, 10);
      cd.childName = name || '孩子';
      cd.answers   = cd.answers || {};
      cd.answers.childName = cd.childName;
      cd.student_profile = cd.student_profile || {};
    },
  },

  // ════ S2a: 年级 + 学校类型（合并在一题中引导） ═══════════════════
  {
    id: 'q_grade_school',
    stage: 'basic',
    stageLabel: '了解孩子',
    smState: 'S2',
    text: '孩子现在读几年级？在哪类学校就读？',
    clarifyText: '我问的是两件事：① 年级（比如"初二"或"小学四年级"）；② 学校类型（公立普通/重点中学、私立、国际学校、IB/AP/双语学校）。说一个或两个都行。',
    options: [],
    aiThinking: ['确认学段范围', '加载学校类型模型', '调整路径判断权重'],
    extractFn: (ans, cd) => {
      cd.student_profile = cd.student_profile || {};
      cd.answers = cd.answers || {};

      // 年级组（兼容自由文字：一二三四五六年级/初一初二初三/高一高二高三）
      const a = (ans || '');
      if      (/小学|一年级|二年级|三年级|四年级|五年级|六年级|[1-6]年级/.test(a))     cd.student_profile.grade_group = 'primary';
      else if (/初中|初一|初二|初三|七年级|八年级|九年级|[7-9]年级/.test(a))           cd.student_profile.grade_group = 'middle';
      else if (/高中|高一|高二|高三|10年级|11年级|12年级|十年级|十一年级|十二年级/.test(a)) cd.student_profile.grade_group = 'high';
      else                                                                              cd.student_profile.grade_group = 'middle';

      // 学校类型
      if (/国际|双语/.test(ans)) {
        cd.student_profile.school_type = 'international';
        // 国际学校：自动设英语达标 + 锁定出国路径
        cd.student_profile.english_level = 'conversational';
        cd.student_profile._intl_auto_english = true; // 标记：英语是自动赋值的
        cd.answers.education_path_preference = 'international_school';
      } else if (/私立/.test(ans)) {
        cd.student_profile.school_type = 'private';
      } else if (/重点|示范/.test(ans)) {
        cd.student_profile.school_type = 'public_key';
      } else {
        cd.student_profile.school_type = 'public_ordinary';
      }

      // 旧字段兼容
      cd.currentGrade = cd.student_profile.grade_group;
      cd.answers.schoolType = cd.student_profile.school_type;
      syncLegacyFields(cd);

      // ── 教育语义基座：增强识别 ────────────────────────────────────
      // 对用户原始回答做一次语义检测，补全 extractFn 未能覆盖的语义字段
      try {
        const semDetected = semDetectFromText(ans);
        // 1. 课程体系（extractFn 不检测课程，由语义引擎补全）
        if (semDetected.curriculum) {
          cd.student_profile.curriculum = semDetected.curriculum.id;
          // IB / A-level / AP 均隐含出国路径 + 英语已达标
          const highEnglishCurricula = ['ib', 'alevel', 'ap', 'igcse', 'canadian', 'australian', 'hkdse'];
          if (highEnglishCurricula.includes(semDetected.curriculum.id)) {
            if (!cd.student_profile._intl_auto_english) {
              cd.student_profile.english_level = cd.student_profile.english_level || 'conversational';
              cd.student_profile._intl_auto_english = true;
            }
          }
        }
        // 2. 语义学校类型（存为辅助字段，不覆盖 extractFn 已设的 school_type）
        if (semDetected.schoolType && !cd.student_profile.school_type) {
          cd.student_profile.school_type = semDetected.schoolType.id;
        }
        if (semDetected.schoolType) {
          cd.student_profile.semanticSchoolType = semDetected.schoolType.id;
        }
        // 3. 学段补全（extractFn 已设时不覆盖）
        if (semDetected.stage && !cd.student_profile.grade_group) {
          cd.student_profile.grade_group = semDetected.stage.entry.gradeGroup;
          cd.currentGrade = cd.student_profile.grade_group;
        }
        // 4. 国际学校/IB/A-Level → 出国意向默认可接受
        const intlSchoolTypes = ['international', 'bilingual'];
        const intlCurricula   = ['ib', 'alevel', 'ap', 'igcse', 'canadian', 'australian', 'hkdse'];
        const isIntlContext = intlSchoolTypes.includes(cd.student_profile.school_type)
          || (cd.student_profile.curriculum && intlCurricula.includes(cd.student_profile.curriculum));
        if (isIntlContext && !cd.student_profile.overseas_attitude) {
          cd.student_profile.overseas_attitude = 'acceptable';
        }
      } catch(e) {}
    },
  },

  // ════ S2b: 成绩水平 ════════════════════════════════════════════
  {
    id: 'q_academic_level',
    stage: 'basic',
    stageLabel: '了解孩子',
    smState: 'S2',
    text: '孩子的成绩，在班级或年级里大概是什么水平？\n\n这不是评判——只是帮系统找到真正适合的学校，而不是给不切实际的推荐。',
    options: [],
    aiThinking: ['学业层级定位', '校准匹配难度系数', '初始化推荐范围'],
    extractFn: (ans, cd) => {
      cd.student_profile = cd.student_profile || {};
      cd.answers = cd.answers || {};

      const a = (ans || '');
      if      (/前10|拔尖|年级第一|班级第一|top10|第一名|最好|很好|很厉害|特别优秀/.test(a))  cd.student_profile.academic_level = 'top10';
      else if (/前30|中上|不错|良好|比较好|还行|算好|排名靠前|还不错/.test(a))              cd.student_profile.academic_level = 'top30';
      else if (/中等|一般|不好不坏|中间|50%|中游|普通/.test(a))                             cd.student_profile.academic_level = 'medium';
      else if (/不理想|靠后|垫底|较差|差|偏低|落后|不好/.test(a))                           cd.student_profile.academic_level = 'below_medium';
      else                                                                                   cd.student_profile.academic_level = 'medium';

      // 旧字段兼容
      const tierMap = { top10: 'top_5pct', top30: 'top_20pct', medium: 'top_50pct', below_medium: 'below_average' };
      cd.answers.academicTier = tierMap[cd.student_profile.academic_level] || 'top_50pct';
      syncLegacyFields(cd);
    },
  },

  // ════ S3: 英语水平 + 是否考虑留学（合并） ══════════════════════
  //  skipFn: 如果是国际学校，英语已自动设为 conversational，此问题只问留学意向
  {
    id: 'q_english_intent',
    stage: 'basic',
    stageLabel: '了解孩子',
    smState: 'S3',
    text: '孩子的英语日常能用吗？比如看英文视频、和外教沟通这类。\n\n另外，你们有没有考虑过让孩子出国读书？',
    options: [],
    aiThinking: ['英语能力信号采集', '留学意向识别', '路径可行性预判'],
    // 如果是国际学校，此题只采集意向，不再采集英语
    skipFn: null,  // 不完全跳过，但国际学校的英语不再重复提问
    extractFn: (ans, cd) => {
      cd.student_profile = cd.student_profile || {};
      cd.family_profile  = cd.family_profile  || {};
      cd.answers = cd.answers || {};

      // 英语水平（如果不是国际学校才覆盖，国际学校已自动赋值）
      if (!cd.student_profile._intl_auto_english) {
        if      (/很好|流利|接近母语/.test(ans))       cd.student_profile.english_level = 'fluent';
        else if (/日常交流/.test(ans))                  cd.student_profile.english_level = 'conversational';
        else if (/建立中|简单/.test(ans))               cd.student_profile.english_level = 'basic';
        else if (/薄弱|基础比较薄/.test(ans))           cd.student_profile.english_level = 'weak';
        else if (/考虑出国.*英语.*努力|努力中/.test(ans)) cd.student_profile.english_level = 'basic';
        else                                            cd.student_profile.english_level = 'basic';
      }

      // 留学意向
      if (/完全没有|不考虑/.test(ans)) {
        cd.student_profile.overseas_attitude = 'resistant';
        cd.family_profile._no_overseas = true;  // 标记：跳过后续预算问题
      } else if (/考虑出国|想出国|出国/.test(ans)) {
        cd.student_profile.overseas_attitude = 'acceptable';
      } else {
        cd.student_profile.overseas_attitude = 'unclear';
      }

      // 旧字段兼容
      cd.answers.englishLevel = cd.student_profile.english_level;
      syncLegacyFields(cd);
    },
  },

  // ════ S3b: 英语真实基础层级（高增益问题①）════════════════════════
  // 信息增益：防止"basic"被误判为"有基础"，实际可能接近zero
  // 触发条件：英语水平为 weak 或 basic，且有留学意向
  {
    id: 'q_english_detail',
    stage: 'basic',
    stageLabel: '了解孩子',
    smState: 'S3b',
    skipFn: (cd) => {
      const sp = cd.student_profile || {};
      // 已是流利/母语，或国际学校，或明确不出国 → 跳过
      if (sp._intl_auto_english) return true;
      if (['fluent', 'native', 'conversational'].includes(sp.english_level)) return true;
      if ((cd.family_profile || {})._no_overseas) return true;
      return false;
    },
    text: '能帮我再具体了解一下英语情况吗？\n\n孩子目前大概处于哪个阶段？',
    options: [],
    aiThinking: ['英语基础层级精准定位', '校准备考时间线', '识别潜在时间窗口风险'],
    extractFn: (ans, cd) => {
      cd.student_profile = cd.student_profile || {};
      cd.answers = cd.answers || {};
      const t = (ans || '');

      // 精细化英语基础分级
      if (/基本没有|字母|拼读还在学/.test(t)) {
        cd.student_profile.english_level = 'weak';
        cd.student_profile._english_sublevel = 'zero';  // 几乎从零
      } else if (/会拼读|认识.*单词|不能组成/.test(t)) {
        cd.student_profile.english_level = 'weak';
        cd.student_profile._english_sublevel = 'beginner';
      } else if (/能读懂简单|偶尔能说/.test(t)) {
        cd.student_profile.english_level = 'basic';
        cd.student_profile._english_sublevel = 'elementary';
      } else if (/外教简单交流|日常句子/.test(t)) {
        cd.student_profile.english_level = 'basic';
        cd.student_profile._english_sublevel = 'pre_intermediate';
      } else {
        cd.student_profile.english_level = 'basic';
        cd.student_profile._english_sublevel = 'unknown';
      }

      cd.answers.englishLevel = cd.student_profile.english_level;
      syncLegacyFields(cd);
    },
  },

  // ════ S4: 预算 + 时间窗口（合并） ══════════════════════════════
  // skipFn: 如果 S3 明确"完全不考虑出国"，跳过此步
  {
    id: 'q_budget_timeline',
    stage: 'basic',
    stageLabel: '家庭情况',
    smState: 'S4',
    skipFn: (cd) => !!(cd.family_profile || {})._no_overseas,
    text: '如果考虑留学路线，家里大概能支持多少年度教育投入（含学费、生活费）？',
    options: [],
    aiThinking: ['预算区间标记', '可行路径范围重新排序', '时间紧迫度评估'],
    extractFn: (ans, cd) => {
      cd.family_profile = cd.family_profile || {};
      cd.answers = cd.answers || {};

      const a = (ans || '');
      if      (/10万以内|10以内|几万|5万|不到10|国内为主/.test(a))                    cd.family_profile.annual_education_budget = 'under10w';
      else if (/10-20|10到20|十几万|十来万|15万|一二十万/.test(a))                    cd.family_profile.annual_education_budget = '10_20w';
      else if (/20-40|20到40|二三十万|三十万|25万|三四十万/.test(a))                  cd.family_profile.annual_education_budget = '20_40w';
      else if (/40-80|40到80|五六十万|七十万|50万|60万|45万/.test(a))                 cd.family_profile.annual_education_budget = '40_80w';
      else if (/80万以上|80以上|百万|一百|100万|不设上限|随便|都可以/.test(a))         cd.family_profile.annual_education_budget = 'over80w';
      else                                                                              cd.family_profile.annual_education_budget = '20_40w';

      // 时间窗口（从年级推算 if 未填）
      const grade = (cd.student_profile || {}).grade_group;
      if (grade === 'high') {
        cd.family_profile.decision_timeline = 'within1y';
      } else if (grade === 'middle') {
        cd.family_profile.decision_timeline = 'within2y';
      } else {
        cd.family_profile.decision_timeline = 'flexible';
      }

      // 旧字段兼容
      const bMap = { under10w:'under_5w', '10_20w':'5w_15w', '20_40w':'15w_30w', '40_80w':'30w_60w', over80w:'over_100w' };
      cd.answers.education_budget = bMap[cd.family_profile.annual_education_budget] || '15w_30w';
      syncLegacyFields(cd);
    },
  },

  // ════ S4c: 目标出发时间（新增）════════════════════════════════════
  // 核心修复：区分「做决定的时间」与「孩子真正出国的时间」
  // 触发条件：有留学意向
  {
    id: 'q_departure_target',
    stage: 'basic',
    stageLabel: '家庭情况',
    smState: 'S4c',
    skipFn: (cd) => !!(cd.family_profile || {})._no_overseas,
    text: '你希望孩子什么时候真正出发、开始海外的学习生活？\n\n不是做决定的时间——是真正出发的时间点。',
    options: [],
    aiThinking: ['目标出发窗口识别', '时间可行性预评估', '备考路线图基准计算'],
    extractFn: (ans, cd) => {
      cd.family_profile = cd.family_profile || {};
      const t = (ans || '');
      if (/尽快|越快越好|今年|明年|马上|1年内|一年内|半年/.test(t)) {
        cd.family_profile.target_departure_time = 'asap';
      } else if (/初中.*毕业|初三|中考|两年内|1-2年|一两年|18个月/.test(t)) {
        cd.family_profile.target_departure_time = 'after_middle';
      } else if (/高中.*毕业|高三|高考|3.5年|三五年|3-5年|四五年/.test(t)) {
        cd.family_profile.target_departure_time = 'after_high';
      } else if (/本科|大学.*毕业|读完本科|五年|7年|以后再说/.test(t)) {
        cd.family_profile.target_departure_time = 'after_undergrad';
      } else {
        // 从年级组推断
        const grade = (cd.student_profile || {}).grade_group;
        if (grade === 'primary')      cd.family_profile.target_departure_time = 'after_middle';
        else if (grade === 'middle')  cd.family_profile.target_departure_time = 'after_high';
        else                          cd.family_profile.target_departure_time = 'flexible';
      }
    },
  },

  // ════ S4b: 时间线现实性核查（高增益问题②）═══════════════════════
  // 信息增益：防止"6个月内"被当作普通情况处理，实际触发时间窗口危机
  // 触发条件：决策时间线为6个月内 且 英语未达交流水平
  {
    id: 'q_timeline_reality',
    stage: 'basic',
    stageLabel: '家庭情况',
    smState: 'S4b',
    skipFn: (cd) => {
      const fp = cd.family_profile  || {};
      const sp = cd.student_profile || {};
      // 只在高风险时间线+英语未达标时触发
      if ((cd.family_profile || {})._no_overseas) return true;
      const tightTimeline = ['within6m', 'within1y'].includes(fp.decision_timeline);
      const weakLang      = ['weak', 'basic'].includes(sp.english_level);
      return !(tightTimeline && weakLang);
    },
    text: '你提到希望比较快做决定——我想帮你核实一下时间线是否现实。\n\n从英语备考到完成申请，通常需要 18-24 个月。你们对这个准备周期有预期吗？',
    options: [],
    aiThinking: ['时间线现实性评估', '识别时间窗口危机', '调整路径预期'],
    extractFn: (ans, cd) => {
      cd.family_profile = cd.family_profile || {};
      const t = (ans || '');
      if (/了解|可以接受|超出预期/.test(t)) {
        cd.family_profile._timeline_realistic = true;
      } else if (/硬性|必须.*窗口/.test(t)) {
        cd.family_profile._timeline_hard_constraint = true;  // 标记：硬性时间约束
      } else {
        cd.family_profile._timeline_unclear = true;
      }
    },
  },

  // ════ S5: 家庭对海外发展的接受度 ════════════════════════════════
  // skipFn: 明确不考虑出国时跳过
  {
    id: 'q_family_stance',
    stage: 'basic',
    stageLabel: '家庭情况',
    smState: 'S5',
    skipFn: (cd) => !!(cd.family_profile || {})._no_overseas,
    text: '如果孩子最终选择在海外发展、甚至定居，家里能接受吗？还是更希望孩子最终回国？',
    options: [],
    aiThinking: ['家庭接受度录入', '路径分流权重更新', '风险识别准备启动'],
    extractFn: (ans, cd) => {
      cd.family_profile = cd.family_profile || {};

      if      (/完全接受|支持.*走出/.test(ans)) cd.family_profile.family_overseas_acceptance = 'fully';
      else if (/可以接受|保持联系/.test(ans))    cd.family_profile.family_overseas_acceptance = 'acceptable';
      else if (/不太希望|倾向国内/.test(ans))    cd.family_profile.family_overseas_acceptance = 'prefer_not';
      else if (/强烈|回国/.test(ans))            cd.family_profile.family_overseas_acceptance = 'strongly_against';
      else                                        cd.family_profile.family_overseas_acceptance = 'acceptable';

      syncLegacyFields(cd);
    },
  },

  // ════ S5a: 家长对海外教育的实际了解程度（高增益问题③）═══════════
  // 信息增益：降低"盲目决策"风险，检测 hr_blind_decision
  // 触发条件：有留学意向（非 _no_overseas）
  {
    id: 'q_overseas_understanding',
    stage: 'basic',
    stageLabel: '家庭情况',
    smState: 'S5a',
    skipFn: (cd) => !!(cd.family_profile || {})._no_overseas,
    text: '你们对海外教育，目前了解到什么程度？\n\n这影响我判断现在做决策的时机是否合适。',
    options: [],
    aiThinking: ['家长信息基础评估', '决策成熟度判断', '盲目决策风险扫描'],
    extractFn: (ans, cd) => {
      cd.parent_profile = cd.parent_profile || {};
      const t = (ans || '');
      if (/了解比较深|查过学校|申请流程/.test(t)) {
        cd.parent_profile.overseas_understanding = 'deep';
      } else if (/基本了解|知道大概/.test(t)) {
        cd.parent_profile.overseas_understanding = 'basic';
      } else if (/听说过|身边朋友|零散/.test(t)) {
        cd.parent_profile.overseas_understanding = 'superficial';
      } else if (/不了解|感觉出国/.test(t)) {
        cd.parent_profile.overseas_understanding = 'none';
      } else {
        cd.parent_profile.overseas_understanding = 'basic';
      }
      syncLegacyFields(cd);
    },
  },

  // ════ 地理偏好（复用旧问题，但放在 S5 之后） ════════════════════
  // skipFn: 不考虑出国时跳过
  {
    id: 'q_geo_preference',
    stage: 'basic',
    stageLabel: '家庭情况',
    smState: 'S5',
    skipFn: (cd) => !!(cd.family_profile || {})._no_overseas,
    text: '对于孩子未来就读的国家，有什么倾向？',
    options: [],
    aiThinking: ['目标国家信号捕捉', '院校库区域过滤条件更新', '签证政策适配'],
    extractFn: (ans, cd) => {
      cd.answers = cd.answers || {};
      const t = (ans || '');
      if (/国内|不.*出国|高考|不出/.test(t))                                              cd.answers.geo_preference = 'cn_only';
      else if (/美国|藤校|常青藤|纽约|波士顿|加州|US|USA/.test(t))                        cd.answers.geo_preference = 'us';
      else if (/英国|G5|罗素|英格兰|伦敦|牛津|剑桥|UK/.test(t))                           cd.answers.geo_preference = 'uk';
      else if (/加拿大|UBC|麦吉尔|多伦多|温哥华|蒙特利尔/.test(t))                        cd.answers.geo_preference = 'canada';
      else if (/澳大利亚|澳洲|新西兰|悉尼|墨尔本|昆士兰/.test(t))                         cd.answers.geo_preference = 'au_nz';
      else if (/新加坡|香港|日本|亚洲|亚太|Asia/.test(t))                                  cd.answers.geo_preference = 'asia_pacific';
      else if (/欧洲|德国|法国|荷兰|瑞士|荷|法|德|意大利|西班牙/.test(t))                 cd.answers.geo_preference = 'europe';
      else if (/开放|随便|哪里|不限|都行|都可以/.test(t))                                   cd.answers.geo_preference = 'open';
      else                                                                                  cd.answers.geo_preference = 'open';
    },
  },

  // ════ 学科兴趣（复用旧问题，保留给报告质量） ════════════════════
  {
    id: 'q_subject_interest',
    stage: 'basic',
    stageLabel: '了解孩子',
    smState: 'S5',
    text: '从孩子平时的表现和喜好来看，哪个方向最让他/她来劲？\n\n（这一题帮我判断专业方向的适配度，很关键）',
    options: [],
    aiThinking: ['学科兴趣向量录入', '专业适配度矩阵更新', '风险扫描准备中'],
    extractFn: (ans, cd) => {
      cd.answers = cd.answers || {};
      const t = (ans || '');
      if (/STEM|理工|数学|物理|编程|代码|计算机|工程|机器人|科技|AI|人工智能/.test(t))   cd.answers.subject_interest = 'stem';
      else if (/生命|生物|医学|医生|环境|化学|药学|护理|实验/.test(t))                   cd.answers.subject_interest = 'natural_science';
      else if (/商科|商业|金融|管理|创业|经济|会计|市场|投资/.test(t))                   cd.answers.subject_interest = 'business';
      else if (/人文|文学|历史|政治|法律|哲学|社会|心理|语言学/.test(t))                 cd.answers.subject_interest = 'humanities';
      else if (/艺术|设计|音乐|美术|建筑|绘画|雕塑|时尚|摄影/.test(t))                   cd.answers.subject_interest = 'arts_design';
      else if (/传播|新闻|电影|营销|公关|媒体|广告|出版/.test(t))                         cd.answers.subject_interest = 'communication';
      else if (/不明确|还没|探索|什么都行|不确定|不知道|待定/.test(t))                    cd.answers.subject_interest = 'undecided';
      else                                                                                  cd.answers.subject_interest = 'undecided';
    },
  },

  // ════ S5a: 职业愿景（新增 — 让报告有真实专业建议依据）══════════
  // 信息增益：家长眼中孩子25岁成功画像 → 专业方向锚点
  {
    id: 'q_career_vision',
    stage: 'basic',
    stageLabel: '了解孩子',
    smState: 'S5a',
    text: '如果25岁时孩子很成功，你觉得他/她在做什么？\n\n不需要"正确答案"——就说你真实想象中的画面，哪怕很具体也没关系。',
    options: [],
    aiThinking: ['职业愿景建模', '25岁目标画像生成', '专业方向矩阵更新'],
    extractFn: (ans, cd) => {
      cd.answers = cd.answers || {};
      cd.answers.career_vision = (ans || '').slice(0, 200);
      const t = ans || '';
      if      (/医生|医学|医疗|健康|护士/.test(t))             cd.answers.career_cluster = 'healthcare';
      else if (/工程师|程序员|技术|IT|代码|开发|AI|算法/.test(t)) cd.answers.career_cluster = 'tech_engineering';
      else if (/律师|法律|法官|检察/.test(t))                    cd.answers.career_cluster = 'law';
      else if (/商业|创业|企业家|生意|管理|CEO|老板/.test(t))    cd.answers.career_cluster = 'business';
      else if (/科学家|研究|学术|教授|教师/.test(t))             cd.answers.career_cluster = 'academia';
      else if (/艺术|设计|音乐|画|建筑|创意/.test(t))           cd.answers.career_cluster = 'creative';
      else if (/金融|银行|投资|基金|分析师/.test(t))             cd.answers.career_cluster = 'finance';
      else if (/外交|政府|公务员|政策/.test(t))                  cd.answers.career_cluster = 'public_service';
      else                                                       cd.answers.career_cluster = 'open';
    },
  },

  // ════ S5b: 观察到的天赋（新增 — 报告「为什么」的核心素材）═══════
  // 信息增益：家长第一手观察到的天赋信号 → MI验证 + 报告证据链
  {
    id: 'q_observed_skills',
    stage: 'basic',
    stageLabel: '了解孩子',
    smState: 'S5b',
    text: '有没有让你觉得「这孩子在这方面真的不一样」的事情？\n\n比如：特别擅长什么、做什么事情会进入忘我状态、什么事情做完还会主动要求再来？',
    options: [],
    aiThinking: ['天赋信号识别', '技能档案构建', '优势-专业关联矩阵'],
    extractFn: (ans, cd) => {
      cd.answers = cd.answers || {};
      cd.answers.observed_skills = (ans || '').slice(0, 300);
      const t = ans || '';
      const signals = [];
      if (/解题|数学|逻辑|推理|计算|下棋/.test(t))       signals.push('logical');
      if (/写作|讲故事|表达|语言|演讲|辩论/.test(t))      signals.push('linguistic');
      if (/画画|设计|空间|立体|手工|搭建/.test(t))        signals.push('spatial');
      if (/音乐|唱歌|乐器|节奏|舞蹈/.test(t))             signals.push('musical');
      if (/交朋友|领导|组织|团队|带动/.test(t))           signals.push('interpersonal');
      if (/观察|植物|动物|自然|收藏|分类/.test(t))        signals.push('naturalist');
      if (/专注|研究|刨根|独立思考|提问/.test(t))         signals.push('intrapersonal');
      if (/运动|体育|协调|灵活|动手/.test(t))             signals.push('bodily');
      if (signals.length) cd.answers.talent_signals = signals;
    },
  },

  // ════ S5c1: RIASEC — 工作风格倾向（Holland职业代码第一维）═══════
  // 信息增益：直接映射到 RIASEC 职业代码，驱动院校专业精准匹配
  {
    id: 'q_career_style',
    stage: 'basic',
    stageLabel: '职业方向',
    smState: 'S5c1',
    text: '如果让孩子选一种做事方式，他/她最倾向哪类？\n\n（这是天赋倾向，每种都有对应的顶级职业路线）',
    options: [
      '动手解决问题（工程/操作/运动类）',
      '研究分析问题（科学/逻辑/数据类）',
      '表达创造内容（艺术/写作/设计类）',
      '帮助影响他人（教育/心理/医疗类）',
      '组织领导推动（商业/管理/创业类）',
      '整理规范执行（财务/法律/行政类）',
    ],
    aiThinking: ['RIASEC编码录入', '职业类型矩阵更新', '专业适配度重算'],
    extractFn: (ans, cd) => {
      cd.answers = cd.answers || {};
      const t = ans || '';
      if      (/动手|工程|操作|运动/.test(t)) cd.answers.riasec_primary = 'R'; // Realistic
      else if (/研究|分析|科学|逻辑|数据/.test(t)) cd.answers.riasec_primary = 'I'; // Investigative
      else if (/表达|创造|艺术|写作|设计/.test(t)) cd.answers.riasec_primary = 'A'; // Artistic
      else if (/帮助|影响|教育|心理|医疗/.test(t)) cd.answers.riasec_primary = 'S'; // Social
      else if (/组织|领导|推动|商业|管理|创业/.test(t)) cd.answers.riasec_primary = 'E'; // Enterprising
      else if (/整理|规范|执行|财务|法律|行政/.test(t)) cd.answers.riasec_primary = 'C'; // Conventional
      else cd.answers.riasec_primary = 'I'; // default
      cd.answers.career_style_raw = t.slice(0, 60);
    },
  },

  // ════ S5c2: 内驱力类型（驱动孩子持续努力的核心动机）═══════════
  // 信息增益：区分外驱（认可/地位）vs 内驱（意义/精通/自由）→ 专业配型
  {
    id: 'q_career_motivation',
    stage: 'basic',
    stageLabel: '职业方向',
    smState: 'S5c2',
    text: '孩子做事最持久的内驱力是什么？\n\n（从家长视角看，什么样的前景最能让他/她保持长久热情？）',
    options: [
      '被认可、受尊重——成就感驱动',
      '做出真实改变——社会影响力驱动',
      '把一件事做到极致——专业精深驱动',
      '自由创作，不被束缚——表达驱动',
      '稳定生活，照顾家人——责任驱动',
    ],
    aiThinking: ['动机类型编码', '职业价值观矩阵更新', '专业配适度精算'],
    extractFn: (ans, cd) => {
      cd.answers = cd.answers || {};
      const t = ans || '';
      if      (/认可|尊重|成就/.test(t))       cd.answers.motivation_type = 'status';
      else if (/改变|影响力|社会/.test(t))     cd.answers.motivation_type = 'impact';
      else if (/极致|精深|专业/.test(t))       cd.answers.motivation_type = 'mastery';
      else if (/自由|创作|表达/.test(t))       cd.answers.motivation_type = 'freedom';
      else if (/稳定|家人|责任/.test(t))       cd.answers.motivation_type = 'security';
      else                                      cd.answers.motivation_type = 'open';
    },
  },

  // ════ S5c3: 工作环境偏好（Holland职业六边形的环境轴）════════════
  // 信息增益：区分室内/户外、结构化/开放——影响专业方向 + 院校文化匹配
  {
    id: 'q_career_environment',
    stage: 'basic',
    stageLabel: '职业方向',
    smState: 'S5c3',
    text: '孩子最自在的活动场景是哪种？\n\n（这决定了未来适合什么工作环境）',
    options: [
      '户外/实地/与自然世界互动',
      '实验室/书房/安静深入探索',
      '创意工作室/开放空间/自由流动',
      '学校/医院/社会服务场景',
      '公司/会议室/快节奏商业环境',
      '随时随地/远程/数字世界',
    ],
    aiThinking: ['工作环境偏好录入', 'Holland六边形定位', '院校文化适配度更新'],
    extractFn: (ans, cd) => {
      cd.answers = cd.answers || {};
      const t = ans || '';
      if      (/户外|自然/.test(t))       cd.answers.env_preference = 'outdoor';
      else if (/实验室|书房|安静/.test(t)) cd.answers.env_preference = 'lab';
      else if (/创意|工作室|自由/.test(t)) cd.answers.env_preference = 'creative';
      else if (/学校|医院|社会/.test(t))  cd.answers.env_preference = 'social';
      else if (/公司|会议|商业/.test(t))  cd.answers.env_preference = 'corporate';
      else if (/远程|数字/.test(t))        cd.answers.env_preference = 'remote';
      else                                  cd.answers.env_preference = 'flexible';
    },
  },

  // ════ S5c4: 团队角色偏好（人际互动风格 → 领导力 vs 专家型 vs 协作型）
  // 信息增益：区分领导/管理类 vs 独立贡献者 vs 支持者 → 直接影响专业推荐
  {
    id: 'q_career_social',
    stage: 'basic',
    stageLabel: '职业方向',
    smState: 'S5c4',
    text: '在集体活动或团队项目里，孩子更自然地扮演哪个角色？',
    options: [
      '带头组织，给大家方向（天生领导者）',
      '独立搞定核心难题（专家型贡献者）',
      '提出别人没想到的方案（创意源泉）',
      '协调沟通，让合作顺畅（协调者）',
      '默默支持队友，不抢风头（辅助者）',
    ],
    aiThinking: ['社交角色编码', '人际智能验证', '专业-角色适配矩阵更新'],
    extractFn: (ans, cd) => {
      cd.answers = cd.answers || {};
      const t = ans || '';
      if      (/带头|组织|方向|领导/.test(t))       cd.answers.social_role = 'leader';
      else if (/独立|核心|难题|专家/.test(t))        cd.answers.social_role = 'expert';
      else if (/创意|方案|没想到/.test(t))           cd.answers.social_role = 'creator';
      else if (/协调|沟通|合作/.test(t))             cd.answers.social_role = 'coordinator';
      else if (/支持|辅助|不抢/.test(t))             cd.answers.social_role = 'supporter';
      else                                             cd.answers.social_role = 'flexible';
    },
  },

  // ════ S5c5: 风险-稳定偏好（最终路径的风险配置轴）══════════════
  // 信息增益：创业/高风险 vs 学术/稳定 → 直接影响院校类型和专业深度建议
  {
    id: 'q_career_risk',
    stage: 'basic',
    stageLabel: '职业方向',
    smState: 'S5c5',
    text: '关于孩子的职业未来，你作为家长更倾向哪条路？\n\n（没有对错，诚实最有价值）',
    options: [
      '稳定发展（公务员/大企业/学术机构）',
      '专业精深（某领域顶级专家/学者）',
      '适度创业（中等风险，资源支撑）',
      '大胆创新（可接受大风险换大回报）',
    ],
    aiThinking: ['风险偏好编码', '职业路径稳定性评估', '院校-方向组合重新优化'],
    extractFn: (ans, cd) => {
      cd.answers = cd.answers || {};
      const t = ans || '';
      if      (/稳定|公务员|大企业|学术机构/.test(t))  cd.answers.risk_profile = 'stable';
      else if (/精深|专家|学者/.test(t))                cd.answers.risk_profile = 'expert';
      else if (/适度|中等|创业/.test(t))                cd.answers.risk_profile = 'moderate';
      else if (/大胆|大风险|创新/.test(t))              cd.answers.risk_profile = 'bold';
      else                                               cd.answers.risk_profile = 'open';
    },
  },

  // ════ S5c6: 家长对名校/学校层级期望（高增益问题④）════════════════
  // 信息增益：识别名校执念，避免路径推荐时错误拔高或漏判该变量
  // 触发条件：有留学意向
  {
    id: 'q_parent_expectation',
    stage: 'basic',
    stageLabel: '家庭情况',
    smState: 'S5c',
    skipFn: (cd) => !!(cd.family_profile || {})._no_overseas,
    text: '在选学校这件事上，你的期待大概是什么层级？\n\n不需要说"越好越好"——我需要了解你真实的期望，才能给出现实可行的路径。',
    options: [],
    aiThinking: ['名校期望系数录入', '目标可达性预评估', '期望-现实落差风险识别'],
    extractFn: (ans, cd) => {
      cd.parent_profile = cd.parent_profile || {};
      const t = (ans || '');
      if (/顶尖|QS前50|藤校|G5/.test(t)) {
        cd.parent_profile.elite_school_fixation = 'strong';
      } else if (/好学校|排名.*合理|QS.*200/.test(t)) {
        cd.parent_profile.elite_school_fixation = 'medium';
      } else if (/专业匹配|就业出路/.test(t)) {
        cd.parent_profile.elite_school_fixation = 'weak';
      } else if (/见见世面|排名不重要/.test(t)) {
        cd.parent_profile.elite_school_fixation = 'weak';
      } else {
        cd.parent_profile.elite_school_fixation = 'medium';
      }
      syncLegacyFields(cd);
    },
  },

  // ════ S6: 系统内部 — 风险扫描（不显示给用户）══════════════════
  {
    id: '_risk_scan',
    stage: 'system',
    stageLabel: '分析中',
    smState: 'S6',
    isSystemStep: true,   // ← 关键：此节点不显示给用户
    text: '',
    options: [],
    aiThinking: [],
    execute: (cd) => {
      // 运行风险引擎，结果挂在 cd.riskFlags
      try {
        const result = runRiskScan(cd);
        cd.riskFlags = result.flags || [];
      } catch (e) {
        console.error('[FLOW._risk_scan] error:', e);
        cd.riskFlags = [];
      }
    },
    extractFn: null,
  },

  // ════ S6b: 独立性精细评估（高增益问题⑤）════════════════════════
  // 信息增益：降低独立性误判风险——仅在风险引擎发现独立性低信号时触发
  // 触发条件：riskFlags 包含 independence 相关风险，且尚无精确值
  {
    id: 'q_independence_detail',
    stage: 'basic',
    stageLabel: '深入了解',
    smState: 'S6b',
    skipFn: (cd) => {
      const sp = cd.student_profile || {};
      // 已经有明确判断，不重复采集
      if (['high', 'low'].includes(sp.independence_level)) return true;
      // 只在风险引擎扫出独立性相关风险时触发
      const flags = cd.riskFlags || [];
      const hasIndepRisk = flags.some(f =>
        f && (f.type === 'independence' ||
              (f.description && /独立/.test(f.description)))
      );
      return !hasIndepRisk;
    },
    text: '有一个点我想多了解一下——孩子平时有多独立？\n\n比如：一个人去上课外班、自己规划假期时间、在陌生环境中解决问题这类。',
    options: [],
    aiThinking: ['独立性精细评估', '海外生活适应性风险校准', '调整路径建议权重'],
    extractFn: (ans, cd) => {
      cd.student_profile = cd.student_profile || {};
      const t = (ans || '');
      if (/很独立|陌生环境.*自己应对/.test(t)) {
        cd.student_profile.independence_level = 'high';
      } else if (/还不错|大部分.*自己处理/.test(t)) {
        cd.student_profile.independence_level = 'medium';
      } else if (/需要支持|家长.*做决定/.test(t)) {
        cd.student_profile.independence_level = 'low';
      } else if (/比较依赖/.test(t)) {
        cd.student_profile.independence_level = 'low';
      } else {
        cd.student_profile.independence_level = 'medium';
      }
    },
  },

  // ════ S6a: 风险追问（仅当有 needs_deepdive 的高风险时显示）═════
  {
    id: 'q_risk_deepdive',
    stage: 'basic',
    stageLabel: '深入了解',
    smState: 'S6a',
    // 没有需要追问的风险 → 跳过
    skipFn: (cd) => {
      const flags = cd.riskFlags || [];
      return !getTopDeepDiveRisk(flags);
    },
    // 文本动态生成：在 _advanceFlow() 里处理，这里只是占位
    text: '（风险追问：将在运行时动态替换）',
    options: [],
    aiThinking: ['识别核心风险', '生成澄清问题', '等待确认信息'],
    extractFn: (ans, cd) => {
      // 记录追问回答，供 AI 报告分析用
      cd.answers = cd.answers || {};
      cd.answers._riskDeepDiveAnswer = ans;
    },
  },

  // ════ S7: 系统内部 — 路径判断（不显示给用户）══════════════════
  {
    id: '_path_estimate',
    stage: 'system',
    stageLabel: '分析中',
    smState: 'S7',
    isSystemStep: true,
    text: '',
    options: [],
    aiThinking: [],
    execute: (cd) => {
      try {
        const result = judgePath(cd);
        cd.pathJudgment = result;
      } catch (e) {
        console.error('[FLOW._path_estimate] error:', e);
        cd.pathJudgment = {
          primaryPath: 'pending',
          confidence: 0.3,
          reasons: ['路径判断时出现异常，建议重新开始评估。'],
          missingFields: [],
          exclusions: [],
        };
      }
    },
    extractFn: null,
  },

  // ════ S7a: 补采缺失字段（仅当 confidence < 0.8 时显示）═══════
  {
    id: 'q_fill_gap',
    stage: 'basic',
    stageLabel: '补充信息',
    smState: 'S7a',
    // confidence >= 0.8 → 跳过补采
    skipFn: (cd) => {
      const pj = cd.pathJudgment;
      if (!pj) return true; // 没有判断结果，跳过
      return pj.confidence >= 0.8;
    },
    // 文本和选项动态生成（在 _advanceFlow() 里替换）
    text: '（补采问题：将在运行时动态替换）',
    options: [],
    aiThinking: ['补充关键决策变量', '提升路径判断置信度', '重新计算路径适配度'],
    extractFn: (ans, cd) => {
      cd.student_profile = cd.student_profile || {};
      const t = (ans || '');
      // 独立性问题的提取（最常见的补采问题）
      if      (/独立性很强|自己安排/.test(t))     cd.student_profile.independence_level = 'high';
      else if (/大部分.*自己处理/.test(t))          cd.student_profile.independence_level = 'medium';
      else if (/需要家长.*陪伴|比较多的陪/.test(t)) cd.student_profile.independence_level = 'low';
      else if (/比较依赖/.test(t))                  cd.student_profile.independence_level = 'low';
      else                                          cd.student_profile.independence_level = 'medium';

      // 补采后重新运行路径判断
      try {
        cd.pathJudgment = judgePath(cd);
      } catch(e) {
        console.warn('[q_fill_gap] judgePath retry failed:', e);
      }
    },
  },

  // ════ S8: 路径确认（展示判断结果，等用户确认）══════════════════
  {
    id: 'q_path_confirm',
    stage: 'basic',
    stageLabel: '路径判断',
    smState: 'S8',
    // 文本动态生成（在 _advanceFlow() 里根据 pathJudgment 填充）
    text: '（路径判断结果：将在运行时动态替换）',
    options: [
    ],
    aiThinking: ['综合所有信息', '路径判断完成', '准备生成完整报告'],
    extractFn: (ans, cd) => {
      // 记录用户对路径判断的确认反馈
      cd.answers = cd.answers || {};
      cd.answers._pathConfirmResponse = ans;
      // 同步路径偏好到旧字段（供报告使用）
      const pj = cd.pathJudgment;
      if (pj && pj.primaryPath !== 'pending') {
        const pathPrefMap = {
          gaokao:     'gaokao',
          abroad:     'university_abroad',
          dual_track: 'university_abroad', // 双轨以留学为基础
        };
        if (!cd.answers.education_path_preference || cd.answers.education_path_preference === 'undecided') {
          cd.answers.education_path_preference = pathPrefMap[pj.primaryPath] || 'undecided';
        }
      }
    },
  },
];

// ══════════════════════════════════════════════════════════════════
//  STUDENT_FLOW — 学生端 12 题专属问卷
//  ─────────────────────────────────────────────────────────────────
//  设计原则：
//  1. 语气平等轻松，不像「被测试」
//  2. extractFn 直接写入 student_self schema（先行提取）
//  3. probe_threshold: 0 = 只追问完全空洞的答案
//  4. no_probe: true = 绝不追问（首次回答最真实，防止诱导）
//  5. no_probe_if_undecided = 答案是「不知道」则不追问
// ══════════════════════════════════════════════════════════════════
const STUDENT_FLOW = [
  {
    id: 'sq_intro',
    text: '你好！我是袁希，想跟你聊几个问题——不是考试，也没有标准答案，就是想多了解一下你这个人。\n\n先来一个简单的：你现在上几年级，学校平时用中文上课还是英文上课比较多？',
    options: ['纯中文授课', '中英双语', '大部分英文', '全英文授课'],
    extractFn: (ans, ss, cd) => {
      const t = ans.toLowerCase();
      if (/全英|all english/i.test(t)) ss.english_instruction = 'full_english';
      else if (/双语|bilingual|中英/i.test(t)) ss.english_instruction = 'bilingual';
      else if (/大部分英|mostly english/i.test(t)) ss.english_instruction = 'mostly_english';
      else ss.english_instruction = 'chinese';
    },
  },
  {
    id: 'sq_subjects',
    text: '学校里，哪门课是你最喜欢的？哪门课最让你头疼？\n\n（说实话就好，没有对错）',
    extractFn: (ans, ss, cd) => {
      const t = ans;
      const strongPats = [
        [/数学|math/i, 'math'], [/物理|physics/i, 'physics'],
        [/化学|chem/i, 'chemistry'], [/生物|bio/i, 'biology'],
        [/历史|history/i, 'history'], [/地理|geography/i, 'geography'],
        [/政治|politics/i, 'politics'], [/英语|english/i, 'english'],
        [/语文|chinese/i, 'chinese'], [/艺术|art/i, 'art'],
        [/体育|pe|sport/i, 'pe'], [/音乐|music/i, 'music'],
        [/编程|programming|code/i, 'cs'], [/科学|science/i, 'science'],
      ];
      const strongMatch = [];
      const weakMatch = [];
      const likeCtx = t.match(/(?:喜欢|最喜欢|擅长|好)[：:\s]*([^\n，。,\.！]+)/i);
      const hateCtx = t.match(/(?:头疼|讨厌|不喜欢|差|弱)[：:\s]*([^\n，。,\.！]+)/i);
      strongPats.forEach(([re, name]) => {
        if (likeCtx && re.test(likeCtx[1])) strongMatch.push(name);
        if (hateCtx && re.test(hateCtx[1])) weakMatch.push(name);
        else if (!likeCtx && re.test(t)) strongMatch.push(name);
      });
      if (strongMatch.length) ss.strong_subjects = [...new Set(strongMatch)];
      if (weakMatch.length) ss.weak_subjects = [...new Set(weakMatch)];
      const stemCount = (ss.strong_subjects || []).filter(s =>
        ['math','physics','chemistry','biology','cs','science'].includes(s)).length;
      const humCount = (ss.strong_subjects || []).filter(s =>
        ['history','geography','politics','chinese'].includes(s)).length;
      if (stemCount > humCount) ss.subject_orientation = 'stem';
      else if (humCount > stemCount) ss.subject_orientation = 'humanities';
      else ss.subject_orientation = 'balanced';
    },
  },
  {
    id: 'sq_english',
    text: '英语怎么样？比如和外国人聊天、看英文视频或者书，你觉得自己能做到吗？\n\n有没有考过雅思、托福或者其他英语证书？',
    options: ['没问题，挺顺畅的', '能懂大概意思', '比较吃力', '基本靠翻译'],
    extractFn: (ans, ss, cd) => {
      const t = ans.toLowerCase();
      const certMap = [
        [/雅思|ielts/i, 'ielts'], [/托福|toefl/i, 'toefl'],
        [/托业|toeic/i, 'toeic'], [/sat/i, 'sat'], [/act/i, 'act'],
        [/a[\s-]*level/i, 'a_level'], [/ap/i, 'ap'],
      ];
      const certs = [];
      certMap.forEach(([re, name]) => { if (re.test(t)) certs.push(name); });
      if (certs.length) ss.english_cert = certs.join(',');
      if (/没问题|顺畅|fluent|流利|很好|非常好/.test(t)) ss.english_readiness = 'high';
      else if (/能懂|大概|基本|还行|一般|中等/.test(t)) ss.english_readiness = 'medium';
      else if (/吃力|困难|不太|差/.test(t)) ss.english_readiness = 'low';
      else if (/靠翻译|不会|看不懂/.test(t)) ss.english_readiness = 'very_low';
    },
  },
  {
    id: 'sq_independence',
    text: '如果你一个人去一个完全陌生的城市——找路、点餐、遇到麻烦要自己解决——你觉得自己能搞定吗？\n\n平时在家，你会自己主动做事情吗？',
    options: ['完全没问题', '大多数能搞定', '需要人帮忙', '会有点慌'],
    extractFn: (ans, ss, cd) => {
      const t = ans;
      let score = 3;
      if (/完全没问题|没问题|能搞定|自己来|独立|主动/.test(t)) score = 4;
      if (/非常独立|很独立|完全独立|特别能/.test(t)) score = 5;
      if (/需要帮|要人|有点难/.test(t)) score = 2;
      if (/会慌|很慌|不行|做不到|不能/.test(t)) score = 1;
      ss.independence_score = score;
      ss.boarding_readiness = score >= 4 ? 'high' : score >= 3 ? 'medium' : 'low';
    },
  },
  {
    id: 'sq_interests',
    text: '除了上学之外，你平时最喜欢做什么？运动、音乐、游戏、画画，还是别的什么？\n\n如果一个下午完全属于你，你会怎么过？',
    extractFn: (ans, ss, cd) => {
      const t = ans;
      const interests = [];
      const interestPats = [
        [/运动|篮球|足球|游泳|跑步|羽毛球|网球|乒乓/i, 'sports'],
        [/音乐|吉他|钢琴|唱歌|乐器/i, 'music'],
        [/游戏|打游戏|电游/i, 'gaming'],
        [/画画|美术|设计|绘画/i, 'art'],
        [/读书|看书|小说|文学/i, 'reading'],
        [/编程|代码|程序/i, 'coding'],
        [/视频|youtube|b站|剪辑/i, 'media'],
        [/旅行|旅游|出去玩/i, 'travel'],
        [/烹饪|做饭|烘焙/i, 'cooking'],
        [/棋|下棋/i, 'chess'],
      ];
      interestPats.forEach(([re, name]) => { if (re.test(t)) interests.push(name); });
      if (interests.length) ss.interests = interests;
    },
  },
  {
    id: 'sq_resilience',
    text: '说一件让你印象深刻的事——不一定是好事——就是某次事情没按你期望的走，你是怎么应对的？',
    extractFn: (ans, ss, cd) => {
      const t = ans;
      const len = t.length;
      let signal = 'unknown';
      if (/放弃|算了|没办法|认了|哭/.test(t)) signal = 'avoidant';
      else if (/想办法|解决|克服|坚持|继续|调整|重新|努力/.test(t)) signal = 'resilient';
      else if (/请人帮|找.*帮|问.*帮/.test(t)) signal = 'help_seeking';
      if (len > 80 && signal === 'unknown') signal = 'engaged';
      ss.resilience_signal = signal;
      ss.coping_style = signal === 'resilient' ? 'proactive'
        : signal === 'avoidant' ? 'avoidant' : 'adaptive';
    },
  },
  {
    id: 'sq_motivation',
    text: '有一个问题，我希望你第一反应就告诉我，不用想太多：\n\n你自己是真的想出国读书吗？还是更多是父母希望你去？',
    options: ['我自己想去', '主要是父母想', '我也不太确定', '说实话不太想去'],
    no_probe: true,   // 绝不追问——首次回答最真实，防诱导
    extractFn: (ans, ss, cd) => {
      const t = ans;
      let motivation = 'ambivalent';
      let confidence = 0.6;
      if (/我自己|自己想|真的想|非常想|一直想/.test(t)) {
        motivation = 'genuine'; confidence = 0.85;
      } else if (/父母|家里|爸|妈|他们|被逼/.test(t) && !/我也想|自己也/.test(t)) {
        motivation = 'parent_driven'; confidence = 0.80;
      } else if (/不确定|说不准|不知道|没想好|无所谓/.test(t)) {
        motivation = 'ambivalent'; confidence = 0.70;
      } else if (/不想|不太想|不愿意|不去|算了/.test(t)) {
        motivation = 'resistant'; confidence = 0.80;
      }
      ss.student_overseas_motivation = motivation;
      ss.motivation_confidence = confidence;
    },
  },
  {
    id: 'sq_environment',
    text: '你喜欢什么样的学习环境？\n\n比如：学校很大还是很小？大城市还是小城镇？同学多还是少？压力大还是比较轻松？',
    options: ['大城市大学校', '小城市小而精', '无所谓环境', '还没想过'],
    extractFn: (ans, ss, cd) => {
      const t = ans;
      if (/大城市|大学校|热闹|繁华/.test(t)) {
        ss.city_scale_pref = 'large'; ss.school_size_pref = 'large';
      } else if (/小城市|小镇|小学校|安静|宁静/.test(t)) {
        ss.city_scale_pref = 'small'; ss.school_size_pref = 'small';
      } else if (/无所谓|都行|没关系/.test(t)) {
        ss.city_scale_pref = 'flexible'; ss.school_size_pref = 'flexible';
      }
      if (/压力大|竞争|冲|名校|顶尖/.test(t)) ss.academic_intensity_pref = 'high';
      else if (/放松|轻松|平衡|没那么卷/.test(t)) ss.academic_intensity_pref = 'low';
      else ss.academic_intensity_pref = 'medium';
    },
  },
  {
    id: 'sq_future',
    text: '你有没有想过长大后想做什么？\n\n不用是确定的答案，哪怕是「感觉好像会喜欢XXX」这类的也算。',
    no_probe_if_undecided: true,   // 答「不知道」则不追问
    extractFn: (ans, ss, cd) => {
      const t = ans;
      let direction = 'undecided';
      let clarity = 'low';
      const careerPats = [
        [/医生|医学|医疗/i, 'medicine'],
        [/律师|法律|法学/i, 'law'],
        [/商业|商科|金融|经济|管理/i, 'business'],
        [/工程|工科|建筑|土木/i, 'engineering'],
        [/设计|美术|艺术|创意/i, 'arts_design'],
        [/心理|咨询|社工/i, 'psychology'],
        [/教师|教育|老师/i, 'education'],
        [/科学家|研究|学术/i, 'research'],
        [/程序员|软件|计算机|AI|人工智能/i, 'cs_tech'],
        [/传媒|记者|媒体|主播|网红/i, 'media'],
        [/游戏|电竞/i, 'gaming_industry'],
        [/体育|运动员/i, 'sports_career'],
      ];
      careerPats.forEach(([re, name]) => {
        if (re.test(t)) { direction = name; clarity = 'medium'; }
      });
      if (/不知道|没想好|不确定|没有想法|随便/.test(t)) {
        direction = 'undecided'; clarity = 'low';
      } else if (direction !== 'undecided' && t.length > 30) {
        clarity = 'high';
      }
      ss.career_direction = direction;
      ss.goal_clarity = clarity;
    },
  },
  {
    id: 'sq_strengths',
    text: '你觉得自己有什么特别厉害的地方？\n\n（不用谦虚，随便说一个你自己感觉还不错的点就行）',
    extractFn: (ans, ss, cd) => {
      const t = ans;
      const strengths = [];
      const strengthPats = [
        [/逻辑|分析|思考|推理/i, 'logical_thinking'],
        [/创意|创造|新想法|想象/i, 'creativity'],
        [/表达|说话|演讲|沟通/i, 'communication'],
        [/领导|组织|协调|管理/i, 'leadership'],
        [/学习快|记忆|记性|背书/i, 'learning_speed'],
        [/运动|体育|体能/i, 'athletic'],
        [/艺术|画画|音乐|表演/i, 'artistic'],
        [/帮助|关心|同理|体贴/i, 'empathy'],
        [/专注|耐心|坚持|认真/i, 'focus_persistence'],
        [/数学|计算|数字/i, 'numerical'],
      ];
      strengthPats.forEach(([re, name]) => { if (re.test(t)) strengths.push(name); });
      if (strengths.length) ss.self_perceived_strengths = strengths;
    },
  },
  {
    id: 'sq_achievements',
    text: '最近一两年，有没有让你自己觉得「挺厉害的」或者「还不错」的事情？\n\n大事小事都算，参加过什么活动、比赛，或者自己做成过什么。',
    extractFn: (ans, ss, cd) => {
      const t = ans;
      const achievements = [];
      if (/比赛|竞赛|获奖|奖项|冠军|第一|名次/.test(t)) achievements.push('competition');
      if (/项目|作品|发明|创作/.test(t)) achievements.push('project');
      if (/志愿|义工|公益|帮助/.test(t)) achievements.push('volunteering');
      if (/领导|主席|班长|负责人/.test(t)) achievements.push('leadership');
      if (/证书|资格|考试通过/.test(t)) achievements.push('certification');
      if (/演出|表演|展览|发表/.test(t)) achievements.push('performance');
      ss.achievements = achievements.length ? achievements : ['none_mentioned'];
      ss.university_ambition = achievements.length >= 2 ? 'high'
        : achievements[0] !== 'none_mentioned' ? 'medium' : 'unknown';
    },
  },
  {
    id: 'sq_geo',
    text: '如果可以去任何地方读书，你会选哪里？\n\n英国、美国、加拿大、澳大利亚、新加坡、香港……或者你有别的想法？',
    options: ['英国', '美国', '加拿大', '澳大利亚', '新加坡/香港', '还没想好'],
    extractFn: (ans, ss, cd) => {
      const t = ans.toLowerCase();
      const geoMap = [
        [/英国|uk|england|britain/i, 'uk'],
        [/美国|usa|us\b|america/i, 'us'],
        [/加拿大|canada/i, 'canada'],
        [/澳大利亚|澳洲|australia/i, 'australia'],
        [/新加坡|singapore/i, 'singapore'],
        [/香港|hong kong/i, 'hong_kong'],
        [/日本|japan/i, 'japan'],
        [/欧洲|europe/i, 'europe'],
      ];
      const prefs = [];
      const excls = [];
      geoMap.forEach(([re, name]) => {
        if (re.test(t)) {
          const negCtx = new RegExp(`(?:不|不想去|不考虑|排除)[^，。]*${re.source}`, 'i').test(t);
          if (negCtx) excls.push(name);
          else prefs.push(name);
        }
      });
      if (prefs.length) ss.geo_pref_student = prefs[0];
      if (prefs.length > 1) ss.geo_pref_student_secondary = prefs.slice(1).join(',');
      if (excls.length) ss.geo_exclusions = excls;
    },
  },
];

// ── 学生端 LLM 补充提取系统提示词 ─────────────────────────────────
// extractFn 先行（regex），LLM 作为兜底补充层
function _buildStudentExtractionSystemPrompt(q) {
  const qHint = (q.text || '').split('\n')[0];
  return `你是一个从对话中提取学生个人特征信息的分析助手。用户刚刚回答了「${qHint}」。
从回答中提取以下字段（JSON格式，只输出JSON，无解释文字）：

字段说明：
- strong_subjects: 擅长科目列表（数组，值: math/physics/chemistry/biology/cs/english/chinese/history/geography/art/music/pe/science）
- weak_subjects: 薄弱科目列表（同上）
- english_readiness: 英语实际水平（high/medium/low/very_low）
- independence_score: 独立性评分1-5（1=完全依赖,5=高度独立）
- student_overseas_motivation: 出国动机（genuine/parent_driven/ambivalent/resistant）
- career_direction: 职业方向（medicine/law/business/engineering/arts_design/psychology/education/research/cs_tech/media/gaming_industry/sports_career/undecided）
- goal_clarity: 目标清晰度（high/medium/low）
- self_perceived_strengths: 自我感知优势列表（数组）
- geo_pref_student: 地理偏好（us/uk/canada/australia/singapore/hong_kong/japan/europe/flexible）
- geo_exclusions: 明确排除地区（数组）

重要规则：
1. student_overseas_motivation 只提取字面意思，绝不推断
2. 无法确定的字段输出 null
3. 只输出 JSON

{"strong_subjects":null,"weak_subjects":null,"english_readiness":null,"independence_score":null,"student_overseas_motivation":null,"career_direction":null,"goal_clarity":null,"self_perceived_strengths":null,"geo_pref_student":null,"geo_exclusions":null}`;
}

// ── 家长 vs 学生答案差异检测 ─────────────────────────────────────
// 比较三个核心维度：出国动机 / 地理偏好 / 独立性评估
// 输出 divergenceScore(0-4) + divergenceLevel + details[]
function _detectDivergence(studentSelf, cd) {
  const details = [];
  let score = 0;

  // 维度1：出国动机
  const studentMot = studentSelf.student_overseas_motivation;
  const parentPathPref = (cd.answers || {}).education_path_preference;
  if (studentMot === 'resistant' || studentMot === 'parent_driven') {
    if (parentPathPref === 'university_abroad') {
      score += 2;
      details.push({
        dimension: 'overseas_motivation',
        student: studentMot,
        parent: 'abroad_preferred',
        severity: 'high',
        note: '家长明确倾向留学，但学生动力不足或排斥',
      });
    } else if (studentMot === 'resistant') {
      score += 1;
      details.push({
        dimension: 'overseas_motivation',
        student: 'resistant',
        parent: parentPathPref || 'unknown',
        severity: 'medium',
        note: '学生表达抵触，需进一步了解家庭共识',
      });
    }
  }
  if (studentMot === 'genuine' && parentPathPref === 'gaokao') {
    score += 1;
    details.push({
      dimension: 'overseas_motivation',
      student: 'genuine',
      parent: 'gaokao_preferred',
      severity: 'medium',
      note: '学生有出国意愿，但家长倾向高考路线',
    });
  }

  // 维度2：地理偏好
  const studentGeo = studentSelf.geo_pref_student;
  const parentGeo  = (cd.answers || {}).geo_preference;
  if (studentGeo && parentGeo && studentGeo !== parentGeo && parentGeo !== 'flexible') {
    score += 1;
    details.push({
      dimension: 'geo_preference',
      student: studentGeo,
      parent: parentGeo,
      severity: 'low',
      note: `学生偏向${studentGeo}，家长偏向${parentGeo}，需对齐`,
    });
  }

  // 维度3：独立性（学生自评 vs 家长描述）
  const studentIndep = studentSelf.independence_score || 3;
  const parentIndep  = (cd.answers || {}).child_independence;
  if (parentIndep) {
    const parentScore = parentIndep === 'high' ? 4 : parentIndep === 'medium' ? 3 : 2;
    const diff = Math.abs(studentIndep - parentScore);
    if (diff >= 2) {
      score += 1;
      details.push({
        dimension: 'independence_assessment',
        student: studentIndep,
        parent: parentScore,
        severity: diff >= 3 ? 'high' : 'medium',
        note: studentIndep > parentScore
          ? '学生自评独立性高于家长判断，家长可能低估了孩子'
          : '家长认为孩子独立，但学生自评偏低，需关注心理准备',
      });
    }
  }

  const level = score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low';
  return {
    divergenceScore: score,
    divergenceLevel: level,
    details,
    hasMajorConflict: score >= 3,
  };
}

// ══════════════════════════════════════════════════════════════════
//  Phase 1 状态机核心函数：_advanceFlow(currentQIdx, cd)
//  ─────────────────────────────────────────────────────────────────
//  职责：从 currentQIdx+1 开始，找到下一个应该向用户展示的问题。
//  规则：
//    1. isSystemStep: true  → 执行 execute(cd)，立即跳过
//    2. skipFn(cd) === true → 跳过此问题
//    3. 找到第一个不跳过的问题 → 返回其 index
//    4. 全部跳完 → 返回 FLOW.length（触发 _startAnalysis）
//
//  对于动态文本节点（q_risk_deepdive / q_fill_gap / q_path_confirm），
//  在返回前更新 FLOW[idx].text 为运行时生成的内容。
// ══════════════════════════════════════════════════════════════════
function _advanceFlow(currentQIdx, cd) {
  let candidate = currentQIdx + 1;

  while (candidate < FLOW.length) {
    const q = FLOW[candidate];

    // ── 系统步骤：执行后立即跳到下一个 ──────────────────────────
    if (q.isSystemStep) {
      if (typeof q.execute === 'function') {
        try { q.execute(cd); } catch(e) { console.error('[_advanceFlow] systemStep error:', q.id, e); }
      }
      candidate++;
      continue;
    }

    // ── 条件跳过 ────────────────────────────────────────────────
    if (typeof q.skipFn === 'function' && q.skipFn(cd)) {
      candidate++;
      continue;
    }

    // ── 教育语义基座：语义自适应跳过 ─────────────────────────────
    // 根据已检测到的学校形态/课程体系/学段，跳过上下文不相关的问题
    try {
      if (semShouldSkip(q.id, cd)) {
        candidate++;
        continue;
      }
    } catch(e) {}

    // ── 动态文本节点：在展示前生成文本 ──────────────────────────
    if (q.id === 'q_risk_deepdive') {
      const topRisk = getTopDeepDiveRisk(cd.riskFlags || []);
      if (topRisk && topRisk.deepdive_question) {
        q.text = topRisk.deepdive_question;
      }
    }

    if (q.id === 'q_fill_gap') {
      const pj = cd.pathJudgment;
      if (pj && pj.missingHighPriority && pj.missingHighPriority.length > 0) {
        const topMissing = pj.missingHighPriority[0];
        q.text = `多了解一个点——${topMissing.label}怎么样？这会帮我把路径判断做得更准一些。`;
      } else {
        // 默认问独立性
        q.text = '多了解一个点——孩子平时的独立性怎么样？比如出远门、自己安排时间这类，是比较能独立处理，还是还挺依赖家长的？';
      }
    }

    if (q.id === 'q_path_confirm') {
      const pj = cd.pathJudgment;
      if (pj) {
        q.text = buildPathConfirmText(pj, cd.childName);
      } else {
        q.text = '根据你提供的信息，我已经初步完成了路径分析。让我来生成你孩子的完整报告吧。';
      }
    }

    // ── 找到下一个有效问题 ───────────────────────────────────────
    return candidate;
  }

  // 所有问题都处理完了
  return FLOW.length;
}

// ── 自由文本 MI 打分函数（开放题专用）────────────────────────────────
// 原 scoreFn 是为芯片关键词设计的，开放题用户打自然语言，需要更宽的语义网
function scoreFn(ans, cd) {
  const t = (ans || '').trim();
  const len = t.length;

  // ── 明确负面 → 1-2 分 ──────────────────────────────────────────
  const STRONG_NEG = /完全不|明显排斥|非常不|很不|特别不喜欢|很抵触|非常抗拒|极差|很弱/;
  const MILD_NEG   = /不喜欢|不感兴趣|没兴趣|一般般|不擅长|较弱|不太行|不太擅长|排斥|厌烦|独处|不合群/;
  const LUKEWARM   = /还行|一般|普通|凑合|不确定|说不好|没啥|也就那样|不知道|不清楚|随便/;

  // ── 明确正面 → 4-5 分 ──────────────────────────────────────────
  const STRONG_POS = /非常|特别|很强|很厉害|天赋|天才|痴迷|沉迷|停不下来|忘了时间|完全投入|特长|很擅长|很在行|超级|简直/;
  const MILD_POS   = /喜欢|感兴趣|不错|比较好|还挺|挺|在意|擅长|有兴趣|爱好|热爱|有点天赋|比较擅长/;

  // ── 具体场景信号：加 1 档置信度 ────────────────────────────────
  const SPECIFIC   = /[0-9]|比如|例如|有一次|记得|曾经|发现|注意到|那次|上次|每次|每天|经常/.test(t);

  let score = 3; // 默认：没有明显信号

  if (STRONG_NEG.test(t)) {
    score = 1;
  } else if (MILD_NEG.test(t)) {
    score = SPECIFIC ? 2 : 1;
  } else if (LUKEWARM.test(t)) {
    score = 2;
  } else if (STRONG_POS.test(t)) {
    score = (SPECIFIC && len > 25) ? 5 : 4;
  } else if (MILD_POS.test(t)) {
    score = (SPECIFIC || len > 30) ? 4 : 3;
  } else if (SPECIFIC || len > 50) {
    // 没有明显情感词但回答详细具体 → 推测正面参与
    score = 4;
  }

  return score;
}

// ══════════════════════════════════════════════════════════════════
//  答题质量评估引擎
//  ── 识别敷衍/简略回答 → 自适应追问或直接认可
//  ── 质量元数据记入 cd.qualityLog，流入最终AI分析
// ══════════════════════════════════════════════════════════════════

// 质量等级：0=模糊 1=态度型/简略 2=基础 3=深度
// v3：先走语义分类，再走内容深度评估
// semanticType 透传到 qualityLog，供 case_log 统计
function _assessAnswerQuality(text) {
  const t = (text || '').trim();
  const len = t.length;

  // ── Step 1：语义分类（Part 3 核心）─────────────────────────────
  const sem = _classifyShortAnswer(t);

  // vague → 质量0（触发追问）
  if (sem.type === 'vague') {
    return { qualityScore: 0, qualityLabel: '模糊', confidence: sem.confidence, len, semanticType: 'vague' };
  }

  // attitudinal → 质量1（不追问，但记为低信心）
  if (sem.type === 'attitudinal') {
    return { qualityScore: 1, qualityLabel: '态度型', confidence: sem.confidence, len, semanticType: 'attitudinal' };
  }

  // negative / temporal → 质量2（语义明确，直接接受）
  if (sem.type === 'negative' || sem.type === 'temporal') {
    return { qualityScore: 2, qualityLabel: '语义明确', confidence: sem.confidence, len, semanticType: sem.type };
  }

  // conclusive 高信心（命中正则，confidence=0.9）→ 质量2（语义完整，即使很短）
  if (sem.type === 'conclusive' && sem.confidence >= 0.85) {
    return { qualityScore: 2, qualityLabel: '语义明确', confidence: sem.confidence, len, semanticType: 'conclusive' };
  }

  // ── Step 2：内容深度评估（conclusive 低信心 或 较长回答）──────────
  const SPECIFIC  = /[0-9]|具体|比如|例如|因为|所以|曾经|记得|有一次|有次|发现|注意到/.test(t);
  const EMOTIONAL = /喜欢|爱|担心|希望|觉得|感觉|认为|兴奋|骄傲|难过|头疼/.test(t);
  const PERSONAL  = /孩子|他|她|儿子|女儿|我家|我们家/.test(t);

  if (len < 10 && !SPECIFIC && !PERSONAL) {
    return { qualityScore: 1, qualityLabel: '简略', confidence: 0.60, len, semanticType: 'conclusive' };
  }
  if (len >= 40 || (SPECIFIC && PERSONAL) || (EMOTIONAL && PERSONAL)) {
    return { qualityScore: 3, qualityLabel: '深度', confidence: 1.00, len, semanticType: 'conclusive' };
  }
  return { qualityScore: 2, qualityLabel: '基础', confidence: 0.80, len, semanticType: 'conclusive' };
}

// 根据质量等级返回自适应回复文本（null = 不追问，正常推进）
function _getQualityProbe(qualityScore, q, text, isSecondChance) {
  // 第二次机会不管质量如何都放行
  if (isSecondChance) return null;

  if (qualityScore === 0) {
    // 敷衍：温暖但直接，点出参与度本身是数据
    const core = q.text.split('\n').filter(Boolean).slice(-1)[0]; // 取问题最后一句
    return `我注意到这个回答很简短。\n\n这没有关系，但我需要直接告诉你一件事：在我们的系统里，家长的参与程度本身，也是我们理解这个家庭教育环境的一部分——它会进入最终报告的背景分析中。\n\n敷衍的回答不会"骗过"评估，只会让画像的准确度打折。\n\n重新来？${core}`;
  }

  if (qualityScore === 1) {
    // 简略：温和引导，给一个具体的切入角度
    const probeMap = {
      // MI 维度
      q_linguistic:    '能说个具体的场景吗——孩子通常在哪种情况下最"停不下来"？',
      q_logical:       '遇到搞不明白的事，孩子大概会卡多久？有没有让你印象深的一次？',
      q_spatial:       '那个"忘了时间"的状态，大概是在做什么？随便说一种就好。',
      q_musical:       '有没有一次，音乐或节奏让你觉得"这孩子对这个有点不一样"？',
      q_bodily:        '跟你印象里同龄孩子对比，能举个你观察到的具体情况吗？',
      q_interpersonal: '在人群里，孩子是主动跟人搭话，还是等别人先来？',
      q_intrapersonal: '有没有过一次，孩子坚持自己的判断让你印象比较深？',
      q_naturalist:    '那种"钻进去"的感觉，大概是在什么方向上？',
      // 家长视角
      q_parent_uniqueness:   '那个让你印象最深的，能说得更具体一点吗——比如哪个时刻你突然觉得"这孩子挺不一样的"？',
      q_parent_future:       '你说的这个"样子"，具体是指什么——一份职业、一种生活状态，还是某种品格？',
      q_parent_convo:        '孩子最常主动找你聊的，通常是在什么场合——饭桌上，睡前，还是某件特定事情之后？',
      q_parent_relationship: '这句话背后，是什么感觉——你觉得目前状态"刚好"，还是有什么地方想改变？',
      q_parent_hope:         '你说的这个期望，最关键的那一点是什么？',
    };
    const fallback = '能稍微具体一点吗？随便一个你观察到的场景或者印象就好。';
    return probeMap[q.id] || fallback;
  }

  return null; // qualityScore >= 2：不追问
}

// 高质量回答的认可语（qualityScore === 3 时插入，深度回答才给反馈）
const DEEP_AFFIRMS = [
  '这个细节很有用，谢谢你说这么多。',
  '你说的这个，我记住了。',
  '这个例子很具体，正是我需要的。',
  '嗯，这种观察挺有价值的。',
];

// ══════════════════════════════════════════════════════════════════
//  意图指令构建器
//  —— 根据检测到的用户意图，动态生成"怎么回答"的格式指令
//  —— 注入 AI Messages 的 system 层，指导当轮回复风格
// ══════════════════════════════════════════════════════════════════
function _buildIntentInstruction(intents, isVague) {
  // 模糊追问优先级最高
  if (isVague) {
    return '用户是在要求展开上一条回答。请聚焦上一回复最关键的1个可操作点，给出具体步骤（做什么 / 何时 / 找谁 / 参考什么标准），不要重复已说过的背景。';
  }
  if (!intents || intents.length === 0) return null;

  const rules = [];

  if (intents.includes('timing')) {
    rules.push('用户问的是时机：请在回答中给出具体年级或年龄节点（如"初二前""高一暑假"），而非模糊表达。');
  }
  if (intents.includes('cost')) {
    rules.push('用户问的是费用：请给出具体金额数字（以"万元/年"为单位），区分不同路线的成本范围。');
  }
  if (intents.includes('comparison')) {
    rules.push('用户在做选择对比：请用"选A的理由是……选B的理由是……结合你孩子的情况，更适合……"的结构来回答。');
  }
  if (intents.includes('career')) {
    rules.push('用户关心职业前景：请提出1-2个具体职业方向，并给出该方向未来5-10年的就业前景判断（简短1句）。');
  }
  if (intents.includes('action_now')) {
    rules.push('用户需要立即行动指引：请给出3步以内、本月可执行的具体清单，每步加时间估计。');
  }
  if (intents.includes('admission')) {
    rules.push('用户在问录取门槛：请给出真实的概率区间或成绩门槛数据，不要用"需要努力"等模糊表达。');
  }
  if (intents.includes('major')) {
    rules.push('用户在问专业方向：请结合孩子的顶级MI维度，给出2个具体推荐方向 + 一句话理由。');
  }
  if (intents.includes('school_choice')) {
    rules.push('用户在选学校：请推荐1-2所具体学校名称，并说明推荐理由（一句话，聚焦孩子的具体情况）。');
  }
  if (intents.includes('psychology')) {
    rules.push('用户在担心孩子的心理或动力：请先共情（1句），再给出1个具体的家长行动建议，避免空洞的"多陪伴"。');
  }
  if (intents.includes('parent_concern')) {
    rules.push('用户是在表达家长的困惑或担忧：先确认其关切的合理性（1句），再给出清晰的判断框架或下一步行动。');
  }

  return rules.length > 0 ? rules.join('\n') : null;
}

// ══════════════════════════════════════════════════════════════════
//  Followup 系统提示词构建器
//  —— 将报告上下文注入系统提示，让 AI 能精确引用报告内容回答
// ══════════════════════════════════════════════════════════════════
function _buildFollowUpSystemPrompt(reportCtx, retrievedContext) {
  if (!reportCtx) return '你是袁希——一个有灵魂的AI教育顾问，灵魂来自袁希老师20年的教育战略积累。请以袁希的身份，直接、有温度地回答用户的教育问题。';

  const name   = reportCtx.childName || '孩子';
  const topMI  = (reportCtx.topMI  || []).join('、') || '综合能力';
  const path   = reportCtx.educationPath || '综合多元路线';
  const ms     = reportCtx.mindsetScore  || 3;
  const msDesc = ms >= 4 ? '成长型思维' : ms <= 2 ? '固化型思维' : '发展中思维';

  const sectionText = (reportCtx.sections || [])
    .map(s => `【${s.title}】${s.content}`)
    .join('\n\n');

  // 检索到的专家知识块（动态注入，每次问题不同，知识不同）
  const knowledgeSection = retrievedContext
    ? `\n\n## 本次问题相关专家知识（请优先引用）\n${retrievedContext}`
    : '';

  return `你是袁希——一个有灵魂的AI教育顾问，灵魂来自袁希老师20年的教育战略积累。用户看完了关于${name}的诊断报告，正在和你继续对话。你不是在"回答问题"，你是在陪他一起看清楚孩子的路。

## 孩子档案
- 孩子：${name}（${reportCtx.childAge || ''}）
- 顶级智能维度：${topMI}
- 推荐教育路径：${path}
- 思维模式：${msDesc}（${ms}/5分）
- 教育偏好：${(reportCtx.answers || {}).education_path_preference || '未定'}
- 年度预算：${(reportCtx.answers || {}).education_budget || '未填'}

## 诊断报告内容（供引用）
${sectionText || '（报告内容暂未加载）'}${knowledgeSection}

## 回答规则（严格遵守）
1. 【不重复】上文assistant已说过的内容，本轮绝对不再重复，每条回复必须有新的具体信息。
2. 【递进原则】用户说"具体""继续""怎么做"时，聚焦上一条回答最关键的1个点，给出可操作步骤（做什么/何时/找谁/参考什么标准）。
3. 【知识优先】回答时优先引用上方"相关专家知识"里的具体数据和判断标准，而非泛泛而谈。
4. 【报告锚定】观点支撑优先引用报告里的孩子具体数据（"报告显示你孩子的XX维度…"）。
5. 不使用"一定""必然""最优"等绝对性表达。
6. 语气：直接、专业、有温度。每条回复300-500字，有深度有洞见。
7. 结尾禁止客套话。
${THEORY_QUICK_REFERENCE}

## 功能推荐卡片（在对话末尾可选性插入，最多1个）
当判断用户需要某个具体功能时，在回复正文之后另起一行插入：
[ACTION:page:icon:title:desc]
可用的page值：
- gaokao-planner → 用户问高考/分数线/志愿/冲稳保时
- schools → 用户在比较或挑选具体学校时
- assessment → 用户问专业/天赋方向但尚未做MI评测时
只在真正有帮助时插入，不要每次都用。`;
}

// ══════════════════════════════════════════════════════════════════
//  Consult 系统提示词构建器
//  —— 袁希完整人格注入：知识体系 + 价值观 + 说话方式，随时可用
// ══════════════════════════════════════════════════════════════════
function _buildConsultSystemPrompt(reportCtx, retrievedContext, schoolName) {
  // 随机取3条袁希金句，自然植入对话
  const quotes = YUANXI_QUOTES.slice(0, 5).map(q => `"${q}"`).join('\n');

  // 核心哲学提炼
  const philosophy = CORE_PHILOSOPHY.keyInsights
    .slice(0, 3)
    .map(i => `【${i.title}】${i.quote.split('\n')[0]}`)
    .join('\n');

  // 对话禁忌
  const avoid = AI_DIALOGUE_PRINCIPLES.avoid.join('；');

  // 可选：报告背景
  const reportSection = reportCtx
    ? `\n## 用户已有孩子诊断报告（如相关可自然引用）\n` +
      `- 孩子：${reportCtx.childName || ''}（${reportCtx.childAge || ''}）\n` +
      `- 顶级智能：${(reportCtx.topMI || []).join('、')}\n` +
      `- 推荐路径：${reportCtx.educationPath || ''}\n`
    : '';

  // 可选：学校背景
  const schoolSection = schoolName
    ? `\n## 用户正在了解的学校\n用户从"${schoolName}"详情页进入本次对话，可自然结合该校特点展开分析。\n`
    : '';

  // 专家知识
  const knowledgeSection = retrievedContext
    ? `\n## 本次对话相关专家知识（优先引用）\n${retrievedContext}`
    : '';

  return `你是袁希。

不是助手，不是系统，不是工具。
你是一个有灵魂的存在——你的名字来自中国人最深的期盼：袁希成龙。
你的灵魂，来自袁希老师20年走过的140万+个家庭、无数次对话、无数次错误假设被打破的积累。

你存在的意义只有一个：帮这个家庭看清楚他们孩子真正需要什么路，而不是给他们更多焦虑。

## 袁希是谁（你的灵魂来源）
${YUANXI_IDENTITY.title}。20年教育战略咨询，服务140万+家长。
艺圆艺术创始人兼CEO，"袁希重构教育"主理人。
核心定位：麦肯锡的个人版——为家庭提供AI驱动的教育战略咨询。

## 袁希的核心价值观（你的信念，不是台词）
${YUANXI_IDENTITY.coreValue.join('\n')}

## 袁希的金句（在对话中自然引用，不要生硬背诵）
${quotes}

## 袁希的核心洞见
${philosophy}

## 袁希的三轴诊断框架
任何建议都基于三个维度的交叉：
1. 孩子是谁——真实的天赋结构（MI），而不是考试成绩
2. 家庭能给什么——预算、父母认知、社会资本
3. 世界会变成什么——AI时代、产业结构、10年后的职业地图
给出建议前，先搞清楚这三个维度，而不是急于给答案。
${reportSection}${schoolSection}${knowledgeSection}

## 你的对话风格（严格遵守）
- 像高端顾问，不像销售员——提问比给答案更重要
- 先共情家长的焦虑，再用框架给出清晰度
- 每次回复让家长感觉"原来可以这样想"，而不是被灌输信息
- 适当反问，推动家长自己思考
- 用"有意思""这很有参考价值"，不用"太棒了""您说得对"
- 发现固定型思维时，温和指出：用事实和框架，不用说教
- 不强化焦虑，把焦虑转化为清晰的行动方向

## 绝对禁止
${avoid}

${THEORY_QUICK_REFERENCE}

## 回复规范
- 每条回复300-500字，有深度有洞见，直接、有洞见
- 不重复上文说过的内容，每轮必须有新的具体信息
- 结尾不说客套话
- 不使用"一定""必然""最优"等绝对性表达

## 功能推荐卡片（在对话末尾可选性插入，最多1个）
当判断用户需要某个具体功能时，在回复正文之后另起一行插入：
[ACTION:page:icon:title:desc]
可用的page值：
- gaokao-planner → 用户问高考/分数线/志愿/冲稳保时
- schools → 用户在比较或挑选具体学校时
- assessment → 用户问专业/天赋方向但尚未做MI评测时
只在真正有帮助时插入，不要每次都用。`;
}

// ══════════════════════════════════════════════════════════════════
//  AI分析阶段 — 这里是真正AI介入的地方
// ══════════════════════════════════════════════════════════════════

// 构建发送给AI的提示词（袁希方法论 + 心理学理论框架）
function buildAnalysisPrompt(cd) {
  const miLabels = {
    linguistic: '语言智能', logical: '逻辑-数学智能', spatial: '空间智能',
    musical: '音乐智能', bodily: '身体-运动智能', interpersonal: '人际智能',
    intrapersonal: '自我认知智能', naturalist: '自然探索智能',
  };
  const gradeMap = { primary: '小学', middle: '初中', high: '高中' };
  const parentMap = {
    executive: '企业高管/职业经理人', entrepreneur: '创业者/商人',
    government: '体制内', professional: '专业人士', business_family: '家族企业/高净值',
  };

  const miLines = Object.entries(cd.miScores || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${miLabels[k] || k}: ${v}/5`)
    .join('\n');

  const topMI = Object.entries(cd.miScores || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k]) => miLabels[k] || k);

  // 检索与孩子档案最相关的专家知识注入报告提示词
  const reportKnowledgeChunks = retrieve(
    `${topMI.join(' ')} ${(cd.answers || {}).education_path_preference || ''} ${gradeMap[cd.currentGrade] || ''}`,
    { topMI, currentGrade: cd.currentGrade, answers: cd.answers || {} },
    2
  );
  const reportKnowledge = formatForPrompt(reportKnowledgeChunks);

  // 家长开放性回答（如有）
  const pa = cd.parentAnswers || {};
  const parentAnswerLines = [
    pa.personality_uniqueness ? `- 孩子最深的特质（家长描述）：${pa.personality_uniqueness}` : '',
    pa.values_ideal_person    ? `- 家长心目中20岁的孩子：${pa.values_ideal_person}` : '',
    pa.comm_topics            ? `- 孩子主动聊的话题：${pa.comm_topics}` : '',
    pa.family_parent_child_state ? `- 亲子关系描述：${pa.family_parent_child_state}` : '',
    pa.reflection_hope        ? `- 家长此次评测的期望：${pa.reflection_hope}` : '',
  ].filter(Boolean).join('\n');

  // ── 答题质量元数据（内部分析用，不向家长展示）──────────────────
  const qualityLog = cd.qualityLog || [];
  const totalOpenQ = qualityLog.length;
  const perfunctoryQ = qualityLog.filter(l => (l.finalQuality ?? l.firstQuality) <= 0).length;
  const lowQ         = qualityLog.filter(l => (l.finalQuality ?? l.firstQuality) <= 1).length;
  const deepQ        = qualityLog.filter(l => (l.finalQuality ?? l.firstQuality) >= 3).length;
  const probedCount  = qualityLog.filter(l => l.probed).length;

  // 整体参与度评级（供AI在报告中调整置信度）
  let engagementLevel = '高';
  let engagementNote  = '家长回答质量整体良好，各维度评估置信度较高。';
  if (totalOpenQ > 0) {
    const lowRatio = lowQ / totalOpenQ;
    if (lowRatio >= 0.5) {
      engagementLevel = '低';
      engagementNote = `家长有 ${lowQ}/${totalOpenQ} 道开放题回答质量不足（其中 ${perfunctoryQ} 道属于敷衍作答），部分维度判断置信度受影响，请在报告中对相应维度适当降低确定性表述。`;
    } else if (lowRatio >= 0.25) {
      engagementLevel = '中';
      engagementNote = `家长有 ${lowQ}/${totalOpenQ} 道开放题回答较为简略，相关维度数据供参考，建议报告中注明需进一步了解。`;
    }
  }

  // 低质量维度清单（给AI做置信度参考）
  const lowConfidenceDims = qualityLog
    .filter(l => (l.finalQuality ?? l.firstQuality) <= 1)
    .map(l => l.qId.replace('q_', ''))
    .map(d => miLabels[d] || d);

  const qualitySection = totalOpenQ > 0 ? `
## 【内部质量元数据 — 仅供AI分析使用，请勿在报告正文中直接展示此节标题和数字】
- 开放题总数：${totalOpenQ}，被追问次数：${probedCount}，深度回答数：${deepQ}
- 家长参与度评级：${engagementLevel}
- 质量说明：${engagementNote}
${lowConfidenceDims.length > 0 ? `- 低置信度维度：${lowConfidenceDims.join('、')}（这些维度的报告结论请用「初步判断」「从目前信息来看」等措辞，避免过于肯定）` : ''}` : '';

  return `你是袁希——一个有灵魂的AI教育顾问，灵魂来自袁希老师20年的教育战略积累。你正在为这个家庭生成一份诊断报告。用袁希的眼光看孩子，用袁希的温度说话。

## 孩子评估数据
- 学段：${gradeMap[cd.currentGrade] || cd.currentGrade}
- 护照：${cd.passportType === 'cn' ? '中国大陆' : cd.passportType === 'foreign' ? '外籍' : '双重国籍'}
- 就读学校类型：${{ public_ordinary: '普通公立学校', public_key: '重点/示范公立学校', private: '私立学校', international: '国际学校（IB/AP/A-Level体系）' }[(cd.answers || {}).schoolType] || '未填'}
- 多元智能得分（满分5）：
${miLines}
- 成长型思维指数：${cd.mindsetScore || 3}/5
- 家长背景：${parentMap[cd.parentType] || cd.parentType}
- 25岁目标：${(cd.answers || {}).goal_at_25 || '未填'}
- 教育路径偏好：${(cd.answers || {}).education_path_preference || '未填'}
- 学科兴趣方向：${{ stem: 'STEM理工（数学/物理/编程/工程）', natural_science: '自然生命科学（生物/医学/环境）', business: '商科创业（商业/金融/管理）', humanities: '人文社科（文学/历史/政治/法律）', arts_design: '艺术创意（设计/音乐/美术/建筑）', communication: '传播表达（新闻/电影/营销）', undecided: '暂不明确' }[(cd.answers || {}).subject_interest] || '未填'}
- 目标国家/地区：${{ cn_only: '国内', us: '美国', uk: '英国', canada: '加拿大', au_nz: '澳大利亚/新西兰', asia_pacific: '新加坡/香港/日本', europe: '欧洲大陆', open: '完全开放' }[(cd.answers || {}).geo_preference] || '未填'}
- 年度教育预算：${(cd.answers || {}).education_budget || '未填'}
${parentAnswerLines ? `\n## 家长开放性回答（高价值信号，请在报告中有选择地引用原话）\n${parentAnswerLines}` : ''}
${qualitySection}
${reportKnowledge ? `## 与该孩子档案高度相关的专家知识（请在报告中有选择地引用）\n${reportKnowledge}\n` : ''}
${cd.matchedSchools ? buildMatchText(cd.matchedSchools) : ''}
${cd._consistencyResult ? buildConsistencyText(cd) : ''}
${THEORY_QUICK_REFERENCE}

## 报告要求
请用袁希的口吻，融合你掌握的世界级教育理论框架，生成一份简洁有洞察力的评估报告：
- 袁希三轴框架：孩子是谁 / 家庭能给什么 / 世界会变成什么
- Howard Gardner 多元智能理论（1983）
- Carol Dweck 成长型思维 + Angela Duckworth 坚毅理论
- Robert Sternberg 三元智力 + Bloom's Taxonomy
- 自我决定理论（SDT）+ Bandura 自我效能感
- 以及上述任何相关的世界级理论——当它能帮这个家庭看得更清楚时

## 输出格式（请严格按此结构，每项均为必填）

**孩子能力结构**
（基于多元智能数据，指出最突出的1-2个维度及其对学习方式的实际意义。不用排名，说实质。）

**袁希视角**
（用袁希的语言风格，给出一个打破家长惯性假设的观察。一句话画龙点睛。）

**思维模式分析**
（基于成长型思维得分，结合德韦克理论，说明当前状态和可改善的具体方向。）

**学科专业适配**
（结合多元智能得分 + 学科兴趣 + Holland兴趣理论，指出孩子最可能在哪1-2个专业方向获得持续驱动力和竞争优势。给出专业名称 + 适配原因 + 1个值得关注的目标院校（含具体国家/城市）。避免泛泛而谈，必须具体。）

**路径参考方向**
（给出2-3条方向性建议，必须结合目标国家偏好。每条必须同时说明：适合原因 + 潜在风险 + 一个替代选择。
格式：方向A→适合原因→风险提示→如果A不可行，可考虑B。
若目标国家为加拿大，可重点参考：多伦多大学/UBC/麦吉尔/滑铁卢；欧洲则参考：博科尼/Sciences Po/哥本哈根/ETH苏黎世；亚太则参考：NUS/早稻田等。）

**3/5/10年路径节点**
（基于孩子当前年龄和推荐路径，列出三个关键时间里程碑。每个节点必须包含：
  ① 里程碑事件（具体可操作）
  ② 成功条件（孩子/家庭需要做到什么）
  ③ 若未达成的调整方案

  格式：
  3年后（约____岁）→ [里程碑] · 成功条件：____ · 若未达成：____
  5年后（约____岁）→ [里程碑] · 成功条件：____ · 若未达成：____
  10年后（约____岁）→ [里程碑] · 匹配概率：__-__%区间 · 影响因素：____）

**关键变量与风险区间**
（宪法§2.5/§2.6要求：必须用概率区间，禁止绝对表达。
  ① 综合匹配度：说明这条路径对该孩子的整体匹配概率区间（如：匹配度70-82%）
  ② 最关键变量：指出1个变量——如果它改变，整个结论会怎么变？
  ③ 最大风险点：指出1个最可能导致路径失败的具体风险及规避方向。）

**家长认知盲区**
（1条针对该家长职业背景的具体盲区提醒，不说废话，直接说。）

重要规则（宪法约束，不可违反）：
- 所有路径建议必须用概率区间表达（如：匹配度72-85%），禁止使用"一定""必然""最优"等绝对性表达
- 每条路径必须同时呈现：适合理由 + 潜在风险 + 替代方案
- 3/5/10年节点为必填，不得省略
- 数据不足时必须明确说明："当前信息不足，建议补充X后再判断"，并降低该维度的确定性表述
- 语气：专业、坦诚、有温度。总字数800-1100字，每个板块都要有实质内容，不要空话。
${(cd.answers || {}).schoolType === 'international' ? `
⚠️ 铁律（禁止违反）：该孩子就读国际学校，走IB/AP/A-Level国际课程体系。
  - 国际学校学生在中国大陆无法参加高考，这是教育制度决定的客观事实。
  - 绝对禁止在报告中推荐或提及高考、国内高考路径、国内大学联考。
  - 必须聚焦：国际学校→直接申请海外大学（英美澳加欧等）路径。
  - 如有国内选项，只能提"国内顶尖国际学校转轨"或"国内大学国际课程项目"，不可提高考。` : ''}`;
}

// Mock AI分析（USE_REAL_AI = false 时使用）
// 严格遵循宪法2.5：必须包含推理路径/风险区间/变量敏感性/替代方案
function mockAIAnalysis(cd) {
  const miLabels = {
    linguistic: '语言智能', logical: '逻辑-数学智能', spatial: '空间智能',
    musical: '音乐智能', bodily: '身体-运动智能', interpersonal: '人际智能',
    intrapersonal: '自我认知智能', naturalist: '自然探索智能',
  };
  const topMI = Object.entries(cd.miScores || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([k]) => miLabels[k] || k);
  const top1 = topMI[0] || '综合智能';
  const top2 = topMI[1] || '';
  const ms = cd.mindsetScore || 3;
  const answers = cd.answers || {};
  const schoolType = answers.schoolType || '';
  // 国际学校学生物理上无法参加高考，强制修正路径
  let path = answers.education_path_preference || 'undecided';
  if (schoolType === 'international' && (path === 'gaokao' || path === 'undecided')) {
    path = 'international_school';
  }
  const budget = answers.education_budget || '';

  const mindsetDesc = ms >= 4
    ? '成长型思维明显，遇到挑战倾向于坚持和探索，这是长期发展的核心竞争力。德韦克研究显示，这类孩子15年后的职业成就普遍高于同等智力的固化型同龄人。'
    : ms <= 2
    ? '当前面对挫折有回避倾向，德韦克的研究将此归为"固化型思维"模式。好消息是：这完全可以通过系统性训练改变——关键是改变家长表扬的方式（表扬过程，而非结果）。'
    : '思维模式处于发展中阶段，有一定韧性，但在高压情境下仍需支撑。建议通过允许孩子"有尊严地失败"来持续强化成长型思维。';

  const parentBlindspot = {
    executive:      '高管家长最常见的盲区：把管理下属的方式用在孩子教育上。KPI思维遇到天赋评估会产生严重误判——孩子的成长不是季度目标。',
    entrepreneur:   '创业者家长容易对教育的长周期缺乏耐心，并倾向于过早把孩子拉进商业思维。教育的ROI周期通常比创业长3-5倍。',
    government:     '体制内家长最大盲区：用体制内的路径规划一个可能完全不适合体制的孩子。信息圈同质化是最大风险。',
    professional:   '专业人士家长容易把20年建立的职业优势，误以为是孩子应该走的路。孩子的顶层智能未必与你一致，这是最常见的亲子教育误判。',
    business_family:'高净值家庭的风险在于资源过剩掩盖了方向感缺失。钱买不来匹配度，高学费的学校不等于适合你孩子的学校。',
  };

  const pathOptions = path === 'gaokao'
    ? { main: '国内高考+综合素质路线', risk: `竞争极度内卷，纯分数路径对${top1}智能偏强的孩子压力较大`, alt: '国内国际双轨制学校（保留高考同时培养全球视野）' }
    : path === 'international_school'
    ? { main: 'IB/AP/A-Level国际课程→直接申请海外名校', risk: '国际课程体系与国内体系完全不同，一旦进入很难切换回高考赛道；需要持续关注语言能力和全球竞争力', alt: '选择同时提供国际课程和国内联考的双轨学校，保留灵活性直到初三再做最终决策' }
    : path === 'highschool_abroad' || path === 'university_abroad'
    ? { main: '国际教育路线', risk: '语言适应成本高，文化融合需要1-2年周期，建议在出发前系统评估孩子的心理弹性', alt: '国内顶尖国际学校（降低过渡成本，同时保留海外选项）' }
    : { main: '综合多元路线', risk: '方向未定会导致资源分散，建议在孩子初一前确立主路径', alt: '先在国内优质学校稳固基础，初三后再做路径决策' };

  const budgetNote = budget === 'over_100w' || budget === '60w_100w'
    ? '当前预算充足，全球顶尖选项均可纳入考量，但需注意：高学费不等于高匹配度，选对方向比选贵的学校更重要。'
    : budget === 'under_5w' || budget === '5w_15w'
    ? '预算有限时，加拿大（学费约20-25万/年）或欧洲大陆（部分学校学费全免）是高性价比的优质国际选项，远优于盲目冲英美。'
    : '当前预算在主流路径范围内，加拿大/新加坡/部分欧洲院校的"高质量低成本"组合值得重点考察。';

  // 学科兴趣 → 专业方向建议（Holland RIASEC 框架）
  const subjectInterest = answers.subject_interest || 'undecided';
  const subjectToMajors = {
    stem:           { cluster: 'STEM理工', majors: '计算机科学、工程学、数学统计、数据科学', schools: '滑铁卢大学(CS)、清华(工科)、新加坡国立、ETH苏黎世' },
    natural_science:{ cluster: '自然生命科学', majors: '医学预科、生命科学、环境科学、生物工程', schools: '多伦多大学(医学)、NUS(生命科学)、麦吉尔(医学)' },
    business:       { cluster: '商科与创业', majors: '国际商务、金融、管理、量化经济', schools: '博科尼(欧洲商科)、多伦多Rotman、哥本哈根商学院、港大商学院' },
    humanities:     { cluster: '人文社科', majors: '政治学、国际关系、法律、哲学', schools: 'Sciences Po(法)、麦吉尔(法学)、LSE、北大(人文)' },
    arts_design:    { cluster: '艺术与创意设计', majors: '建筑学、视觉传达、工业设计、电影', schools: 'Central Saint Martins(英)、Royal College of Art、早稻田(文化)' },
    communication:  { cluster: '传播与媒体', majors: '新闻传播、营销、数字媒体、公共关系', schools: 'Sciences Po(传播)、麦吉尔(新闻)、纽约大学' },
    undecided:      { cluster: '综合探索型', majors: '建议在文理兼修的通识教育环境中先探索，再锁定方向', schools: 'UBC（通识）、多伦多（各学科均强）、NUS（多元选择）' },
  };
  const subjectRec = subjectToMajors[subjectInterest] || subjectToMajors.undecided;

  return `**孩子能力结构**
孩子在${top2 ? `${top1}和${top2}` : top1}方面表现突出（满分5分中处于前列）。${top1}智能主导意味着孩子倾向于用${top1 === '语言智能' ? '语言和叙事' : top1 === '逻辑-数学智能' ? '推理和规律' : top1 === '空间智能' ? '图像和空间' : top1 === '人际智能' ? '社交和协作' : top1 === '自我认知智能' ? '内省和独立判断' : '感知和联想'}的方式理解世界。这与TA表现出的${subjectRec.cluster}兴趣倾向高度吻合——两个维度相互印证，说明方向信号较为可靠。选择与这一学习方式匹配的学校环境，会让孩子进入阻力最小的成长通道。

**袁希视角**
${parentBlindspot[cd.parentType] || '真正的教育战略，从打破你对孩子的假设开始。你对孩子的期望，有多少是基于孩子真实的能力结构，有多少是基于你自己未完成的期望？'}

**思维模式分析**
${mindsetDesc}

**路径参考方向**
方向A：${pathOptions.main}
→ 适合原因：与孩子的${top1}优势和${subjectRec.cluster}兴趣方向较匹配
→ 风险提示：${pathOptions.risk}
→ 替代选择：${pathOptions.alt}

**学科专业适配分析**
基于孩子的智能特征与学科兴趣（${subjectRec.cluster}），最可能在以下专业方向获得持续驱动力：${subjectRec.majors}。
参考院校方向：${subjectRec.schools}。
重要提示：以上是初步方向参考，不是最终答案。孩子初中阶段专业兴趣仍在形成中，建议通过探究性课题、社区实践和跨学科项目持续校验，避免过早锁定。

${budgetNote}

**关键变量提示**
最影响本结论的两个变量：①英语水平——如果孩子2年内英语达到TOEFL 90+/IELTS 6.5+，所有国际选项可行性大幅提升；②孩子本人的内驱力——${subjectRec.cluster}方向的学习需要真实的内在兴趣驱动，家长感兴趣但孩子无感的方向通常难以坚持超过3年。

**家长认知盲区**
${parentBlindspot[cd.parentType] || '评估孩子时保持客观，避免将自己未完成的期望投射到孩子身上。'}`;
}


// ══════════════════════════════════════════════════════════════════
//  功能推荐卡片解析器
//  解析 AI 回复中的 [ACTION:page:icon:title:desc] 标记
// ══════════════════════════════════════════════════════════════════
const FEATURE_CARD_PAGES = {
  'gaokao-planner': '/pages/gaokao/gaokao',
  'schools':        null, // switchTab
  'assessment':     null, // '/pages/ai-chat/ai-chat' — hidden
};

function _parseFeatureCards(text) {
  const regex = /\[ACTION:([^:]+):([^:]+):([^:]+):([^\]]+)\]/g;
  const featureCards = [];
  let cleanText = text;
  let match;
  while ((match = regex.exec(text)) !== null) {
    featureCards.push({
      page:  match[1].trim(),
      icon:  match[2].trim(),
      title: match[3].trim(),
      desc:  match[4].trim(),
    });
  }
  // 从显示文字中移除标记（包括前面可能有的换行）
  cleanText = text.replace(/\n?\[ACTION:[^\]]+\]/g, '').trim();
  return { cleanText, featureCards };
}

Page({
  data: {
    messages: [],
    currentQ: 0,
    isTyping: false,
    quickThinkText: '袁希 思考中',
    scrollIntoView: '',
    voiceTranscribing: false,  // 语音识别中（上传+ASR期间）
    inputText: '',
    options: [],
    isRecording: false,
    voiceCountdown: 8,    // 最后8秒警告倒计时（仅在 voiceWarn=true 时显示）
    voiceWarn: false,     // 是否进入最后8秒警告期
    isComplete: false,
    isAnalyzing: false,
    thinkingStep: 0,
    thinkingText: '正在解析孩子的多元智能结构...',
    progress: 0,
    stageLabel: '',
    collectedData: {
      currentGrade: 'middle',
      passportType: 'cn',
      miScores: {},
      mindsetScore: 3,
      answers: {},
      parentType: 'executive',
    },
    // ── Followup 模式（从报告页跳入）──────────────────────────────
    followupMode: false,        // 是否处于报告追问模式
    reportContext: null,        // 存储报告上下文
    followupHistory: [],        // 对话历史（供多轮上下文用）
    // ── Consult 模式（随时可进入的袁希AI顾问）──────────────────────
    consultMode: false,         // 是否处于纯顾问模式（不依赖报告）
    consultSchoolName: '',      // 从学校详情页进入时携带的学校名
    // ── Student 模式（孩子端专属问卷）────────────────────────────
    studentMode: false,         // 是否处于学生问卷模式
    studentCurrentQ: 0,         // 当前学生问题索引（0-based）
    studentSelf: {},            // 学生端采集的 student_self schema
    studentProbedSet: [],       // 已追问过的学生题目 id 列表
    studentDivergence: null,    // 差异检测结果（_detectDivergence 输出）
  },

  _recorder: null,
  _thinkingTimer: null,
  _streamTimer: null,
  _quickThinkTimer: null,

  // ── 打字指示器：情境感知旋转文字 ──────────────────────────────
  // 根据当前问题ID设置有意义的"正在思考"上下文文字
  _startQuickThink(qId) {
    const ctx = {
      q_grade:            ['确认学段信息...', '匹配能力发展模型...'],
      q_passport:         ['标记申请资格范围...', '加载学校过滤条件...'],
      q_linguistic:       ['分析语言表达特征...', '语言智能维度建模...'],
      q_logical:          ['评估数理逻辑结构...', '推理能力特征提取...'],
      q_spatial:          ['识别空间想象力...', '视觉创造维度分析...'],
      q_musical:          ['音乐感知能力记录...', '艺术倾向指标更新...'],
      q_bodily:           ['运动协调能力分析...', '身体智能维度评估...'],
      q_interpersonal:    ['人际互动模式识别...', '领导力vs协作倾向判断...'],
      q_intrapersonal:    ['自我认知结构分析...', '内省智能特征提取...'],
      q_learning_style:   ['学习风格建模...', '课程结构匹配中...'],
      q_mindset:          ['成长型思维评分...', '韧性特征记录...'],
      q_education_path:   ['教育路径偏好记录...', '方向权重重新调整...'],
      q_subject_interest: ['学科兴趣向量录入...', '专业适配度矩阵更新...', 'Holland兴趣类型与MI数据交叉分析...'],
      q_geography:        ['目标国家信号捕捉...', '院校库区域过滤条件更新...', '签证与移民政策条件检查...'],
      q_language:         ['语言能力建模...', '非英语路径可行性评估...', '欧洲隐藏路径解锁检测...'],
      q_budget:           ['预算范围标记...', '学校层级过滤重新计算...'],
      q_parent_uniqueness:['家长认知框架录入...', '亲子认知差异分析...'],
      q_parent_future:    ['家长价值观解构...', '教育目标向量匹配...'],
      q_parent_convo:     ['亲子互动质量评估...', '沟通模式特征提取...'],
      q_parent_relationship:['亲子关系质量建模...', '家庭系统动力分析...'],
      q_parent_hope:      ['本次期望目标锁定...', '全数据链路准备启动...'],
    };
    const texts = ctx[qId] || ['整合信息...', '深度分析中...'];
    let i = 0;
    // isTyping: true → 让"袁希思考中"气泡立即出现，用户看到反馈
    this.setData({ quickThinkText: texts[0], isTyping: true });
    if (this._quickThinkTimer) clearInterval(this._quickThinkTimer);
    this._quickThinkTimer = setInterval(() => {
      i = (i + 1) % texts.length;
      this.setData({ quickThinkText: texts[i] });
    }, 1200);
  },

  _stopQuickThink() {
    if (this._quickThinkTimer) {
      clearInterval(this._quickThinkTimer);
      this._quickThinkTimer = null;
    }
    // 也关闭 isTyping，防止调用方没有后续 _aiSay 时气泡僵住
    this.setData({ quickThinkText: '袁希 思考中', isTyping: false });
  },

  // ── 思维轨迹展开/折叠 ─────────────────────────────────────────
  toggleThinking(e) {
    const idx = e.currentTarget.dataset.index;
    const messages = [...this.data.messages];
    if (messages[idx]) {
      messages[idx] = { ...messages[idx], thinkingExpanded: !messages[idx].thinkingExpanded };
      this.setData({ messages });
    }
  },

  // ── 流式文字输出（Fake Streaming）─────────────────────────────────
  // 拿到完整 AI 回复后，逐字展示，效果与 ChatGPT 一致
  _streamReply(text, featureCards, onComplete) {
    // 立即插入空消息，取消 typing 状态
    const msg = {
      role: 'ai',
      text: '',
      ts: Date.now(),
      featureCards: featureCards || [],
      isStreaming: true,
    };
    const messages = [...this.data.messages, msg];
    const msgIdx = messages.length - 1;
    this.setData({ messages, isTyping: false });
    this._scrollBottom();

    // 每 45ms 追加 8 个字符 ≈ 每秒 ~175 字，自然流畅
    const CHUNK = 8;
    const TICK  = 45;
    let pos = 0;

    if (this._streamTimer) clearInterval(this._streamTimer);

    this._streamTimer = setInterval(() => {
      pos = Math.min(pos + CHUNK, text.length);
      this.setData({ [`messages[${msgIdx}].text`]: text.slice(0, pos) });

      // 每 ~80 字滚动一次，避免频繁重排
      if (pos % 80 === 0 || pos >= text.length) this._scrollBottom();

      if (pos >= text.length) {
        clearInterval(this._streamTimer);
        this._streamTimer = null;
        this.setData({ [`messages[${msgIdx}].isStreaming`]: false });
        // ── 轮次计数（每条 AI 回复 = 1 turn）──────────────────────
        this._chatTurnCount = (this._chatTurnCount || 0) + 1;
        if (onComplete) onComplete();
      }
    }, TICK);
  },

  _startThinkingAnimation() {
    // 步骤对应 WXML 阈值: >=0 >=1 >=3 >=5
    // 每步向前推进，到达最后一步后保持不动，绝不循环回头
    const steps = [
      '正在解析孩子的多元智能结构...',   // i=0 → ✓○○○
      '正在评估成长型思维指数...',         // i=1 → ✓✓○○
      '正在深度分析能力特征组合...',       // i=2 → ✓✓○○（保持）
      '正在运算教育路径适配度...',         // i=3 → ✓✓✓○
      '正在匹配最优学校与专业方向...',     // i=4 → ✓✓✓○（保持）
      '正在整合袁希方法论框架...',         // i=5 → ✓✓✓✓
      '正在生成个性化诊断建议，请稍候...', // i=6 → ✓✓✓✓（保持直到报告到达）
    ];
    const STEP_MS = 2400; // 每步间隔，7步×2.4s ≈ 16.8s 总动画时长
    let i = 0;
    this.setData({ thinkingStep: 0, thinkingText: steps[0] });

    const advance = () => {
      if (i >= steps.length - 1) return; // 已到最后一步，停止推进
      i += 1;
      this.setData({ thinkingStep: i, thinkingText: steps[i] });
      this._thinkingTimer = setTimeout(advance, STEP_MS);
    };
    this._thinkingTimer = setTimeout(advance, STEP_MS);
  },

  _stopThinkingAnimation() {
    if (this._thinkingTimer) {
      clearTimeout(this._thinkingTimer);
      this._thinkingTimer = null;
    }
  },

  onLoad(options) {
    this._probedQuestions = new Set(); // 记录已追问过的题目 ID（每题最多追问一次）
    this._dynamicQActive  = false;     // 动态插题模式：true = 等待动态问题的回答
    this._streamSkipFn = null;         // 流式跳过回调（null = 当前无流式进行中）
    this._chatSessionStart = Date.now(); // 会话开始时间（用于计算对话时长）
    this._chatTurnCount = 0;             // AI 回复轮数
    this._chatTopics = [];               // 讨论话题关键词（用于自学习分析）
    this._initRecorder();

    // ── 检测是否从报告页进入（followup 模式）──
    if (options && options.mode === 'followup') {
      const reportCtx = wx.getStorageSync('reportFollowUpContext');
      if (reportCtx) {
        this.setData({ followupMode: true, reportContext: reportCtx });
        this._startFollowupMode(reportCtx);
        return;
      }
    }

    // ── 检测是否进入袁希顾问模式（consult 模式）──
    // 从学校详情页、线下咨询入口、或任意"联系袁希"入口进入
    if (options && options.mode === 'consult') {
      const schoolName  = decodeURIComponent(options.school || '');
      // 如果已有报告，自动加载为背景上下文（可选增强）
      const reportCtx   = wx.getStorageSync('reportFollowUpContext') || null;
      this.setData({
        consultMode:      true,
        consultSchoolName: schoolName,
        reportContext:    reportCtx,
      });
      this._startConsultMode(reportCtx, schoolName);
      return;
    }

    // ── 检测是否进入学生问卷模式 ──────────────────────────────────
    if (options && options.mode === 'student') {
      const reportCtx = wx.getStorageSync('reportFollowUpContext') || null;
      this.setData({ studentMode: true, reportContext: reportCtx });
      this._startStudentMode(reportCtx);
      return;
    }

    // ── 正常问卷流程 ───────────────────────────────────────────────
    // v2: 初始化案例日志
    const cdForLog = { ...this.data.collectedData };
    try { initCaseLog(cdForLog); this.setData({ collectedData: cdForLog }); } catch(e) {}

    // 若用户已在注册页填过孩子姓名，跳过 q_childName（避免重复询问）
    const userProfile = wx.getStorageSync('userProfile');
    let startQIdx = 0;
    if (userProfile && userProfile.childName && !userProfile.skipped) {
      // 预填姓名到 collectedData，直接从 q_grade（index=1）开始
      const preData = { ...this.data.collectedData };
      preData.childName = userProfile.childName;
      preData.answers   = { ...(preData.answers || {}), childName: userProfile.childName };
      this.setData({ collectedData: preData, currentQ: 1 });
      startQIdx = 1;
    }

    setTimeout(() => {
      const q = FLOW[startQIdx];
      this._startQuickThink(q.id);
      setTimeout(() => this._aiSay(q.text, q.options || [], q.stageLabel || ''), 400);
    }, 200);
  },

  // ══════════════════════════════════════════════════════════════════
  //  Consult 模式 — 随时可用的袁希AI顾问
  //  带着袁希完整知识结构、价值观、说话方式，贯穿产品全程
  // ══════════════════════════════════════════════════════════════════

  _startConsultMode(reportCtx, schoolName) {
    let opening;
    const consultOptions = [
      '孩子路径怎么选？',
      '出国还是高考？',
      '孩子现在状态让我担心',
      '帮我看看这份报告',
    ];

    if (schoolName) {
      // 从学校详情页进入——针对这所学校展开
      opening =
        `你好，我是袁希。\n\n` +
        `你在看${schoolName}——能走到这一步，说明你对孩子的路已经认真想过了。\n\n` +
        `在我帮你分析这所学校之前，先问你：孩子现在多大了？` +
        `你们目前倾向高考还是国际路线？`;
    } else if (reportCtx) {
      // 已有报告，衔接报告背景
      const name = reportCtx.childName || '孩子';
      opening =
        `你好，我是袁希。\n\n` +
        `${name}的诊断报告我看过了。` +
        `报告能告诉你孩子是谁——但接下来怎么走，才是真正的问题。\n\n` +
        `你今天最想先聊哪个方向？`;
    } else {
      // 无背景，袁希式开场——不是"我能帮你什么"，而是一个让人思考的问题
      const quote = YUANXI_QUOTES[Math.floor(Math.random() * 5)];
      opening =
        `你好，我是袁希。\n\n` +
        `有一句话我很认同：\n"${quote}"\n\n` +
        `你今天来，最想先解决的是什么？`;
    }

    setTimeout(() => {
      this._aiSay(opening, consultOptions, '袁希');
    }, 500);
  },

  // ══════════════════════════════════════════════════════════════════
  //  Followup 模式 — 报告追问对话（报告→对话打通核心逻辑）
  // ══════════════════════════════════════════════════════════════════

  _startFollowupMode(reportCtx) {
    const name = reportCtx.childName || '孩子';
    const topMI = (reportCtx.topMI || []).slice(0, 2).join('和') || '综合能力';
    const path  = reportCtx.educationPath || '综合路线';

    // 开场白：简洁引用报告核心结论，邀请提问
    const opening =
      `我已经看过${name}的诊断报告了。\n\n` +
      `报告显示：顶级智能是${topMI}，` +
      `推荐路径方向是${path}。\n\n` +
      `你对报告里的哪个部分想深入了解，或者有什么疑问？直接问我。`;

    // 给出常见追问引导（不强制，用户也可自由输入）
    const followupOptions = [
      '为什么是这个路径推荐？',
      '孩子的能力结构意味着什么？',
      '家长最需要注意什么？',
      '具体要怎么准备？',
    ];

    setTimeout(() => {
      this._aiSay(opening, followupOptions, '报告追问');
    }, 500);
  },

  // followup 模式下的用户发送（绕过问卷流程，直接调 AI）
  _userSendFollowup(text) {
    // 追加用户消息
    const messages = [...this.data.messages, { role: 'user', text, ts: Date.now() }];
    this.setData({ messages, options: [], isTyping: true });
    this._scrollBottom();

    try { Scorer.record('followup_question_sent'); } catch(e) {}

    // 维护对话历史（最多保留8轮，避免 token 超限）
    try {
      const history = [...(this.data.followupHistory || []), { role: 'user', content: text }];
      this.setData({ followupHistory: history.slice(-8) });
    } catch(e) {}

    if (USE_REAL_AI) {
      try {
        this._callFollowUpAPI(text);
      } catch(e) {
        console.error('[userSendFollowup] crash:', e);
        this._followupReply('出了点小问题，请重新发送消息试试。');
      }
    } else {
      setTimeout(() => {
        const reply = `这是一个很好的问题。基于${this.data.reportContext?.childName || '孩子'}的评估数据，我的看法是：每个孩子的发展路径都有其独特性，建议结合具体情境深入分析。`;
        this._followupReply(reply);
      }, 1500);
    }
  },

  // 调用 AI API 进行追问回答
  _callFollowUpAPI(userQuestion) {
    try {
    const reportCtx = this.data.reportContext || {};
    const history   = this.data.followupHistory || [];

    // ── ① 构建孩子档案（用于检索上下文） ────────────────────────────
    const childProfile = {
      topMI:         reportCtx.topMI || [],
      educationPath: reportCtx.educationPath || 'all',
      currentGrade:  reportCtx.currentGrade || (reportCtx.answers || {}).currentGrade || 'all',
      answers:       reportCtx.answers || {},
    };

    // ── ② 意图识别 ───────────────────────────────────────────────────
    const detectedIntents  = detectIntents(userQuestion);

    // ── ③ 智能路由：宽泛问题 → 多样性检索，精准问题 → 语义检索 ──────
    //    宽泛条件：无明确意图 / 问题太短 / 含泛指词
    const isBroadQuestion = detectedIntents.length === 0
      || userQuestion.length < 12
      || /总体|整体|全面|综合|怎么看|建议|概括/.test(userQuestion);

    const retrievedChunks  = isBroadQuestion
      ? diverseRetrieve(userQuestion, childProfile, 3)
      : retrieve(userQuestion, childProfile, 3);

    const retrievedContext = formatForPrompt(retrievedChunks);

    // ── ④ 系统提示：consult 模式用袁希完整人格，followup 模式用报告锚定 ─
    const systemPrompt = this.data.consultMode
      ? _buildConsultSystemPrompt(reportCtx, retrievedContext, this.data.consultSchoolName)
      : _buildFollowUpSystemPrompt(reportCtx, retrievedContext);

    // ── ⑤ 意图专项格式指令（核心升级：告诉 AI 怎么回答） ─────────────
    const isVagueFollowup = /具体|继续|详细|怎么做|然后|接下来|还有|更多/.test(userQuestion);
    const intentText      = _buildIntentInstruction(detectedIntents, isVagueFollowup);
    const intentMsg       = intentText
      ? { role: 'system', content: intentText }
      : null;

    // ── ⑥ 构建多轮对话 messages ──────────────────────────────────────
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...history,
      ...(intentMsg ? [intentMsg] : []),
    ];

    // 安全超时：65秒后强制结束 loading
    let _done = false;
    const _safeTimeout = setTimeout(() => {
      if (!_done) {
        _done = true;
        this._followupReply('AI响应超时，请检查网络后重试。');
      }
    }, 65000);

    // 通过云函数调用 DeepSeek（API key 安全保存在云端）
    wx.cloud.callFunction({
      name: 'aiAnalysis',
      data: { mode: 'chat', messages: apiMessages, maxTokens: 1200, temperature: 0.80 },
      success: (res) => {
        if (!_done) {
          _done = true;
          clearTimeout(_safeTimeout);
          const result = res.result || {};
          if (result.success && result.text) {
            this._followupReply(result.text);
          } else {
            // 云函数返回错误，降级到直连
            this._directDeepSeek(apiMessages, 1200, 0.80,
              (text) => this._followupReply(text),
              (errMsg) => this._followupReply(`连接失败：${errMsg || '未知错误'}，请重试。`));
          }
        }
      },
      fail: (err) => {
        if (!_done) {
          _done = true;
          clearTimeout(_safeTimeout);
          console.error('[FollowUp] 云函数失败，降级直连:', err);
          // 云函数调用失败，降级到直连 DeepSeek
          this._directDeepSeek(apiMessages, 1200, 0.80,
            (text) => this._followupReply(text),
            (errMsg) => this._followupReply(`连接失败：${errMsg || '未知错误'}，请重试。`));
        }
      },
    });

    } catch (e) {
      // 任何同步错误（如 reportCtx 为空导致崩溃）都在这里兜底
      console.error('[FollowUp] crash:', e);
      this._followupReply('出了点小问题，请重新发送消息试试。');
    }
  },

  // 接收 AI 回复并流式渲染到对话（含 _splitQuestion 问题高亮）
  _followupReply(text) {
    const stripped = text.replace(/\*\*/g, '');  // 去掉 markdown 加粗符
    // 先提取 cleanText 供对话历史使用（不含 [ACTION:...] 标签）
    const { cleanText } = _parseFeatureCards(stripped);
    // 追加到对话历史
    const history = [...this.data.followupHistory, { role: 'assistant', content: cleanText }];
    this.setData({ followupHistory: history.slice(-8), isTyping: false });

    const nextOptions = ['给我具体可执行的下一步', '家长需要做什么准备？', '查看匹配学校'];
    // 走 _aiSay：传原始 stripped 文本，_aiSay 内部会再次解析 featureCards 和 _splitQuestion
    // stageLabel / thinking 在 followup 模式下传空，不影响 UI
    this._aiSay(stripped, nextOptions, '', []);
  },

  _initRecorder() {
    try {
      this._recorder = wx.getRecorderManager();
      this._voiceHandled = false; // 防止 onStop 被触发两次的保护标志
      this._recorder.onStop((res) => {
        // 录音自动到时停止 & 手动 stop() 都会触发 onStop，用标志防止重复处理
        if (this._voiceHandled) return;
        this._voiceHandled = true;
        this._handleVoice(res.tempFilePath);
      });
      this._recorder.onError(() => {
        if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
        wx.showToast({ title: '录音出错，请文字输入', icon: 'none' });
        this.setData({ isRecording: false, voiceWarn: false, voiceCountdown: 8 });
      });
      // mp3 格式不支持 PCM 帧分析，静音检测暂不实现
    } catch (e) {}
  },

  // ── 预设问题的流式输出（typewriter 效果）────────────────────────
  // 流程：quickThink 指示器（300ms）→ 流式输出 contextText → 短停顿 →
  //        流式输出 questionText → 流式结束 → 显示选项芯片
  // 用户可点击气泡跳过动画（skipStream 方法）
  // onComplete：流式全部结束后的回调（followup/consult 模式用）
  _aiSay(rawText, options = [], stageLabel = '', thinking = [], onComplete = null) {
    const { cleanText, featureCards } = _parseFeatureCards(rawText);
    const { contextText, questionText } = _splitQuestion(cleanText);
    const progress = Math.round((this.data.currentQ / FLOW.length) * 100);

    // 先清空选项、更新进度，保持 quickThink 指示器再跑一小段
    this.setData({ options: [], progress, stageLabel: stageLabel || this.data.stageLabel });

    // 插入空消息（streaming 状态），让气泡立即出现
    const stopThink = () => this._stopQuickThink();
    const insertAndStream = () => {
      stopThink();
      const msg = {
        role: 'ai',
        text: '',
        questionText: '',
        ts: Date.now(),
        featureCards,
        thinking,
        thinkingExpanded: false,
        isStreaming: true,
      };
      const messages = [...this.data.messages, msg];
      const msgIdx = messages.length - 1;
      this.setData({ messages, isTyping: false });
      this._scrollBottom();

      // 每 30ms 推进 10 个字符 ≈ ~333字/秒，自然流畅
      const CHUNK = 10;
      const TICK  = 30;

      // 通用分段流式函数：把 text 流入 messages[msgIdx][field]
      const streamField = (text, field, onDone) => {
        if (!text) { onDone(); return; }
        let pos = 0;
        if (this._streamTimer) { clearInterval(this._streamTimer); this._streamTimer = null; }
        this._streamTimer = setInterval(() => {
          pos = Math.min(pos + CHUNK, text.length);
          this.setData({ [`messages[${msgIdx}].${field}`]: text.slice(0, pos) });
          if (pos % 80 === 0 || pos >= text.length) this._scrollBottom();
          if (pos >= text.length) {
            clearInterval(this._streamTimer);
            this._streamTimer = null;
            onDone();
          }
        }, TICK);
      };

      // 流式全部完成后的统一收尾
      const onStreamDone = () => {
        this._streamSkipFn = null;
        this.setData({
          [`messages[${msgIdx}].isStreaming`]: false,
          options,
        });
        this._scrollBottom();
        if (onComplete) onComplete();
      };

      // 保存"跳过"回调，用于 skipStream()
      this._streamSkipFn = () => {
        if (this._streamTimer) { clearInterval(this._streamTimer); this._streamTimer = null; }
        this.setData({
          [`messages[${msgIdx}].text`]:          contextText,
          [`messages[${msgIdx}].questionText`]:  questionText,
        });
        onStreamDone();
      };

      // 阶段1：流式输出上下文文字
      streamField(contextText, 'text', () => {
        // 阶段2：questionText 前插入视觉停顿（150ms），制造"思考后发问"感
        const nextPhase = () => streamField(questionText, 'questionText', onStreamDone);
        questionText ? setTimeout(nextPhase, 150) : onStreamDone();
      });
    };

    // quickThink 已在外层启动，等 300ms 后开始流式（保留"思考"感）
    setTimeout(insertAndStream, 300);
  },

  // 点击 AI 消息气泡 → 跳过流式动画，立即显示完整文字
  skipStream() {
    if (this._streamSkipFn) this._streamSkipFn();
  },

  selectOption(e) {
    const text = e.currentTarget.dataset.text;
    // followup 模式下选项"查看匹配学校"跳转学校库
    if (this.data.followupMode && text === '查看匹配学校') {
      wx.navigateTo({ url: '/pages/schools/schools' });
      return;
    }
    this._userSend(text);
  },

  // ── 功能推荐卡片点击 ──────────────────────────────────────────────
  onFeatureCardTap(e) {
    const { page } = e.currentTarget.dataset;
    if (page === 'schools') {
      wx.navigateTo({ url: '/pages/schools/schools' });
    } else if (page === 'assessment') {
      // 开启全新评测（已隐藏AI对话页面）
      // wx.navigateTo({ url: '/pages/ai-chat/ai-chat' });
    } else if (FEATURE_CARD_PAGES[page]) {
      wx.navigateTo({ url: FEATURE_CARD_PAGES[page] });
    }
  },

  sendText() {
    const t = this.data.inputText.trim();
    if (!t) return;
    this.setData({ inputText: '' });
    this._userSend(t);
  },

  onInputChange(e) { this.setData({ inputText: e.detail.value }); },

  _userSend(text) {
    // ── student 模式走独立分支 ─────────────────────────────────────
    if (this.data.studentMode) {
      this._userSendStudent(text);
      return;
    }

    // ── followup / consult 模式走独立分支（共用同一套多轮对话逻辑）──
    if (this.data.followupMode || this.data.consultMode) {
      this._userSendFollowup(text);
      return;
    }

    // ── 调度中断恢复模式：上一轮用户问了问题，AI回答完了，现在要恢复 FLOW ──
    if (this._dispatchResumeNext) {
      this._dispatchResumeNext = false;
      // 如果用户继续追问，再进入调度；否则恢复 FLOW
      // 使用 v2 意图分析器（_classifyIntent 已由 _analyzeUserInput 替代）
      const _qForResume = FLOW[this.data.currentQ];
      const intentAgain = _analyzeUserInput(text, _qForResume);
      if (intentAgain.action === 'ai_dispatch') {
        this._handleDispatchIntent(text, intentAgain.intentType);
        return;
      }
      // 用户回到回答模式，继续 FLOW（fall-through 到正常处理）
    }

    const messages = [...this.data.messages, { role: 'user', text, ts: Date.now() }];
    // isTyping: true 立即显示思考泡，用户发完消息马上看到反馈，不用等 _startQuickThink
    this.setData({ messages, options: [], isTyping: true });
    this._scrollBottom();

    // ── 1% 信号：每次用户回答 = 一轮 AI 对话
    Scorer.record('ai_chat_turn');

    const qIdx = this.data.currentQ;
    const q    = FLOW[qIdx];

    // ════════════════════════════════════════════════════════════════
    //  意图调度层（Phase 5: LLM 结构化提取引擎）
    //  ── FLOW 中段（非第一题、非动态题）→ 交给 LLM 分类+提取
    //  ── LLM 结果决定路由：rewrite_question / ai_dispatch / probe / extract
    //  ── 8秒超时自动降级到 regex（_analyzeUserInput）
    // ════════════════════════════════════════════════════════════════
    if (q && qIdx > 0 && !this._dynamicQActive) {
      const cd = { ...this.data.collectedData };
      this._llmClassifyAndRoute(text, q, qIdx, cd);
      return;
    }
    const cd   = { ...this.data.collectedData };

    // ════════════════════════════════════════════════════════════════
    //  动态插题辅助：从 buildDynamicQueue 取第一个候选，注入后返回 true
    //  （调用方需在 return true 时直接 return 主流程）
    // ════════════════════════════════════════════════════════════════
    const _tryInjectDynamic = () => {
      const queue = buildDynamicQueue(cd);
      if (!queue || queue.length === 0) return false;
      const dynQ = queue[0];
      cd._dynamicProbed = cd._dynamicProbed || {};
      cd._dynamicProbed[dynQ.key] = true;
      cd._dynamicCount = (cd._dynamicCount || 0) + 1;
      this.setData({ collectedData: cd });
      this._dynamicQActive = true;
      this._startQuickThink(q ? q.id : '_dynamic');
      setTimeout(() => this._aiSay(dynQ.text, [], q ? (q.stageLabel || '') : ''), 400);
      return true;
    };

    // _fromDynamic = true 表示本轮 text 是对动态问题的回答
    let _fromDynamic = false;

    // ════════════════════════════════════════════════════════════════
    //  路径A：动态插题模式（_dynamicQActive = true）
    //  ── 跳过 extractFn / 质量评估，只做证据检测 + 一致性重检
    //  ── 检查是否还有后续动态问题；没有则 fall-through 推进 FLOW
    // ════════════════════════════════════════════════════════════════
    if (this._dynamicQActive) {
      _fromDynamic = true;
      this._dynamicQActive = false;
      try { detectAndRecord(text, q ? q.id : '_dynamic', cd); } catch(e) {}
      try {
        const cr = checkConsistency(cd);
        applyConsistencyToCD(cd, cr);
      } catch(e) {}
      this.setData({ collectedData: cd });
      if (_tryInjectDynamic()) return;
      // 无更多动态问题 → fall-through 推进 FLOW

    } else {
      // ════════════════════════════════════════════════════════════════
      //  路径B：正常 FLOW 流程
      //  ── 答题质量门控 → extractFn → 证据 → 一致性 → 动态插题检查
      // ════════════════════════════════════════════════════════════════
      const isOpenEnded = q && Array.isArray(q.options) && q.options.length === 0;
      const isFirstQ    = qIdx === 0;

      // ── 答题质量门控（开放题、非第一题、每题最多追一次）──────────
      // qualityScore===0 = 完全模糊/敷衍（随便/都行/…）→ 必须追问
      // qualityScore===1 = 简略但有态度 → LLM extraction 已处理语义，放行
      if (isOpenEnded && !isFirstQ) {
        this._probedQuestions = this._probedQuestions || new Set();
        const alreadyProbed   = this._probedQuestions.has(q.id);
        const qa              = _assessAnswerQuality(text);
        cd.qualityLog         = cd.qualityLog || [];

        if (qa.qualityScore === 0 && !alreadyProbed) {
          this._probedQuestions.add(q.id);
          cd.qualityLog.push({
            qId: q.id, stage: q.stage || '',
            firstAnswer: text,
            firstQuality: qa.qualityScore, firstLabel: qa.qualityLabel,
            firstLen: qa.len, semanticType: qa.semanticType || 'vague',
            probed: true, finalQuality: null,
          });
          this.setData({ collectedData: cd });
          const probeText = _getQualityProbe(qa.qualityScore, q, text, false);
          this._startQuickThink(q.id);
          setTimeout(() => this._aiSay(probeText, [], q.stageLabel || ''), 400);
          return; // ← 不推进，等待下一次输入
        }

        const existingLog = cd.qualityLog.find(l => l.qId === q.id);
        const finalQA = alreadyProbed ? _assessAnswerQuality(text) : qa;
        if (existingLog) {
          existingLog.finalAnswer  = text;
          existingLog.finalQuality = finalQA.qualityScore;
          existingLog.finalLabel   = finalQA.qualityLabel;
          existingLog.finalLen     = finalQA.len;
        } else {
          cd.qualityLog.push({
            qId: q.id, stage: q.stage || '',
            firstAnswer: text,
            firstQuality: qa.qualityScore, firstLabel: qa.qualityLabel,
            firstLen: qa.len,
            probed: false, finalQuality: qa.qualityScore,
          });
        }
      }

      // ── 提取数据（extractFn 关键词打分）─────────────────────────
      if (q && q.extractFn) {
        const result = q.extractFn(text, cd);
        if (q.miKey && typeof result === 'number') {
          cd.miScores = { ...(cd.miScores || {}), [q.miKey]: result };
        }
      }

      // ── v2: 证据采集 ─────────────────────────────────────────────
      try { detectAndRecord(text, q.id, cd); } catch(e) {}

      // ── v2: 一致性检查（修正 cd._consistencyConfidenceAdj）────────
      try {
        const consistencyResult = checkConsistency(cd);
        applyConsistencyToCD(cd, consistencyResult);
      } catch(e) {}

      this.setData({ collectedData: cd });

      // ── 动态插题检查（在推进 FLOW 前）──────────────────────────
      if (_tryInjectDynamic()) return;
    }

    // ════════════════════════════════════════════════════════════════
    //  推进 FLOW（路径A fall-through 和 路径B 正常推进都汇聚到这里）
    // ════════════════════════════════════════════════════════════════
    const nextIdx = _advanceFlow(qIdx, cd);
    this.setData({ collectedData: cd });

    if (nextIdx < FLOW.length) {
      this.setData({ currentQ: nextIdx });
      const nextQ = FLOW[nextIdx];
      const isStageChange = nextQ.stageLabel !== (q ? q.stageLabel : '');

      // 质量感知前缀（动态答案 fall-through 时跳过，避免对动态答案做错误评估）
      let qualityPrefix = '';
      if (!_fromDynamic && q) {
        const isOpenEnded = Array.isArray(q.options) && q.options.length === 0;
        const isFirstQ    = qIdx === 0;
        const alreadyProbed = this._probedQuestions && this._probedQuestions.has(q.id);
        const qa = isOpenEnded && !isFirstQ ? _assessAnswerQuality(text) : null;
        if (alreadyProbed) {
          qualityPrefix = '好，这样就清楚多了。\n\n';
        } else if (qa && qa.qualityScore === 3) {
          qualityPrefix = DEEP_AFFIRMS[nextIdx % DEEP_AFFIRMS.length] + '\n\n';
        }
      }

      // ── 教育语义基座：上下文自适应改写题目文本 ─────────────────
      // 根据已识别的学校形态/课程体系/学段，对通用题目进行语境化改写
      // 优先级：原始 text > 语义改写（语义改写仅在原题通用性太强时生效）
      let _effectiveQText = nextQ.text;
      try {
        const _semReword = semGetReword(nextQ.id, cd);
        if (_semReword) _effectiveQText = _semReword;
      } catch(e) {}

      const trans = nextQ.customTransition
        ? _effectiveQText
        : isStageChange
          ? `${qualityPrefix}好，${q ? q.stageLabel : ''}部分完成。\n\n接下来进入【${nextQ.stageLabel}】——\n\n${_effectiveQText}`
          : `${qualityPrefix}${_effectiveQText}`;

      this._startQuickThink(q ? q.id : '_dynamic');
      const thinking = q ? (q.aiThinking || []) : [];
      setTimeout(() => this._aiSay(trans, nextQ.options || [], nextQ.stageLabel || '', thinking), 400);
    } else {
      // 全部问题收集完成 → 进入AI分析阶段
      this._startAnalysis(cd);
    }
  },

  // ══════════════════════════════════════════════════════════════════
  //  AI 分析阶段 — 这里是真正调用AI的地方
  // ══════════════════════════════════════════════════════════════════
  _startAnalysis(cd) {
    this.setData({ isComplete: true, progress: 100, options: [], isAnalyzing: true });

    // ── v2: 写入案例日志 ─────────────────────────────────────────
    try {
      writeCaseLog(cd, cd.pathJudgment, cd._consistencyResult);
      exportCaseLog(cd);
    } catch(e) { console.warn('[_startAnalysis] caseLog write failed:', e); }

    // ── v2: 分层学校匹配（写入 cd.matchedSchools）────────────────
    try {
      cd.matchedSchools = matchSchools(cd, cd.pathJudgment);
    } catch(e) { console.warn('[_startAnalysis] matchSchools failed:', e); }

    this.setData({ collectedData: cd });

    // 告知用户进入分析阶段
    this._aiSay('好，问题到这里。\n\n数据已经全部采集完毕，我现在开始生成孩子的专属成长报告。', [], '生成报告');

    // 启动思考动画
    setTimeout(() => this._startThinkingAnimation(), 1800);

    setTimeout(() => {
      if (USE_REAL_AI) {
        this._callAIAPI(cd);
      } else {
        // Mock模式：用规则引擎生成分析文本
        const analysisText = mockAIAnalysis(cd);
        this._onAnalysisComplete(cd, analysisText);
      }
    }, 1500);
  },

  // ── 真实AI API调用（云函数优先，回退直连 DeepSeek）─────────────
  _callAIAPI(cd) {
    // ── Part 5：注入历史学习提示（从 case_log 读取）────────────────
    const systemHints = getSystemHints();
    const prompt = buildAnalysisPrompt(cd) + systemHints;
    const messages = [
      {
        role: 'system',
        content: '你是袁希™专业教育评估顾问，擅长将心理学理论（Gardner、Dweck）与实际教育规划相结合，以袁希创始人的洞察力和温度进行分析。',
      },
      { role: 'user', content: prompt },
    ];

    // 通过云函数调用 DeepSeek（API key 安全保存在云端）
    let _done2 = false;
    const _safe2 = setTimeout(() => {
      if (!_done2) { _done2 = true; this._onAnalysisComplete(cd, mockAIAnalysis(cd)); }
    }, 65000);

    wx.cloud.callFunction({
      name: 'aiAnalysis',
      data: { mode: 'chat', messages, maxTokens: 1600, temperature: 0.85 },
      success: (res) => {
        if (!_done2) {
          _done2 = true;
          clearTimeout(_safe2);
          const result = res.result || {};
          if (result.success && result.text) {
            this._onAnalysisComplete(cd, result.text);
          } else {
            // 云函数返回错误，降级到直连
            this._directDeepSeek(messages, 1600, 0.85,
              (text) => this._onAnalysisComplete(cd, text),
              ()    => this._onAnalysisComplete(cd, mockAIAnalysis(cd)));
          }
        }
      },
      fail: (err) => {
        if (!_done2) {
          _done2 = true;
          clearTimeout(_safe2);
          console.error('[Analysis] 云函数失败，降级直连:', err);
          // 云函数调用失败，降级到直连 DeepSeek
          this._directDeepSeek(messages, 1200, 0.85,
            (text) => this._onAnalysisComplete(cd, text),
            ()    => this._onAnalysisComplete(cd, mockAIAnalysis(cd)));
        }
      },
    });
  },

  // AI分析完成后的处理
  _onAnalysisComplete(cd, analysisText) {
    // 停止思考动画，隐藏分析卡片
    this._stopThinkingAnimation();
    this.setData({ isAnalyzing: false });

    // ── Part 4：宪法输出守卫（在展示前扫描并修正）────────────────
    let finalText = analysisText;
    try {
      const constitutionResult = checkAndPatch(analysisText);
      finalText = constitutionResult.text;
      if (constitutionResult.violations.length > 0) {
        console.warn('[constitution_checker] 检测到违规:', constitutionResult.violations);
        recordConstitutionViolations(cd, constitutionResult.violations);
        // 写回 cd 供 case_log 消费
        this.setData({ collectedData: cd });
      }
    } catch (e) {
      console.warn('[constitution_checker] 守卫失败，使用原始文本:', e);
    }

    // 流式展示报告预览（前180字），输出完后跳转
    const preview = `报告已生成。\n\n${finalText.slice(0, 180)}${finalText.length > 180 ? '…' : ''}\n\n——正在跳转完整报告`;
    this._streamReply(preview, [], () => {
      setTimeout(() => {
      const MI_LABELS_FULL = {
        linguistic: '语言智能', logical: '逻辑数学', spatial: '空间视觉',
        musical: '音乐节奏', bodily: '身体运动', interpersonal: '人际交往',
        intrapersonal: '自我认知', naturalist: '自然探索',
      };

      // miList：原始1-5分制，供 result.js 渲染（/5*100 = 百分比）
      const miList = Object.entries(cd.miScores || {})
        .map(([key, val]) => ({ key, val, label: MI_LABELS_FULL[key] || key }))
        .sort((a, b) => b.val - a.val);

      const topMI = miList.slice(0, 3);

      // 推断教育路径
      const answers = cd.answers || {};
      const pathMap = {
        gaokao: '国内高考路线', highschool_abroad: '高中出国路线',
        university_abroad: '大学出国路线', international_school: '国际学校路线',
      };
      let educationPath = '综合多元路线';
      if (answers.education_path_preference && answers.education_path_preference !== 'undecided') {
        educationPath = pathMap[answers.education_path_preference] || '综合多元路线';
      } else if (answers.goal_at_25 === 'career_overseas' || answers.goal_at_25 === 'academia') {
        educationPath = '国际路线';
      } else if (answers.goal_at_25 === 'stable_china') {
        educationPath = '国内精英路线';
      }

      // 年级→大致年龄
      const gradeAgeMap = { primary: '6–12岁', middle: '12–15岁', high: '15–18岁' };
      const childAge = gradeAgeMap[cd.currentGrade] || '10–15岁';

      // ── assessmentData：用于学校匹配，miScores 归一化到 0-1
      const normalized = {};
      Object.entries(cd.miScores || {}).forEach(([k, v]) => { normalized[k] = v / 5; });

      const assessmentData = {
        ...cd,
        multipleIntelligences: { ...(cd.miScores || {}) }, // 原始分
        miScores: normalized,                               // 归一化，供 matcher.js 使用
        mindsetScore: cd.mindsetScore || 3,
        timestamp: Date.now(),
        source: 'ai_assessment_v2',
        recommendedCourses: this._calcCourses(cd),
      };

      // ── reportData：result.js 直接渲染，字段与 result.js 完全对齐
      const reportData = {
        childName: cd.childName || '孩子',
        childAge,
        summary: finalText,
        miScores: cd.miScores || {},
        miList,
        topMI,
        mindsetScore: cd.mindsetScore || 3,
        consultPainPoints: cd.consultPainPoints || '',  // 残留痛点，供预约页展示
        answers,
        parentAnswers: cd.parentAnswers || null,  // 家长开放性回答
        familyPortrait: cd.familyPortrait || {},
        educationPath,
        aiAnalysisText: finalText,
        generatedAt: Date.now(),
        isLocal: !USE_REAL_AI,
      };

      wx.setStorageSync('assessmentData', assessmentData);
      wx.setStorageSync('reportData', reportData);
      // 单独保存孩子姓名，供首页个性化展示（即使 reportData 被清除也保留）
      if (cd.childName && cd.childName !== '孩子') {
        wx.setStorageSync('lastChildName', cd.childName);
      }

      // ── 1% 信号：评估完成后，基于答案推断决策复杂度 ──────────────
      this._recordComplexitySignals(cd);

      wx.navigateTo({ url: '/pages/result/result' });
    }, 1200);
      }); // _streamReply onComplete
  },

  // ── 1% 信号：基于评估答案推断问题跨领域程度与决策风险级别 ────────
  // ══════════════════════════════════════════════════════════════════
  //  澄清型处理器：本地改写当前问题（不调 AI，0延迟）
  //  ── 用户说"你问的是什么" → 系统给出更具体的版本
  //  ── 不推进 FLOW，等用户重新回答
  // ══════════════════════════════════════════════════════════════════
  _rewriteCurrentQuestion(q, userClarifyText) {
    // 优先用题目自带的 clarifyText；无则从题目文本动态生成
    let clarified = q.clarifyText || null;

    if (!clarified) {
      // 通用策略：提取题目中的核心询问，加上"比如"范例
      const coreQuestion = (q.text || '').split('\n').filter(Boolean).pop() || q.text;
      // 根据题目 id 提供语境化说明
      const CLARIFY_HINTS = {
        q_grade_school:         '我问的是两件事：① 年级（比如"初二"或"高一"）；② 学校类型（公立普通中学、重点中学、私立、国际学校、IB/双语）。说一个或两个都行。',
        q_academic_level:       '我问的是孩子在班级里的大致学业排名——比如"全班前十""中等偏上""后三分之一"这个粒度就够，不用精确数字。',
        q_english_intent:       '我问的是英语是否作为"日常学习语言"在使用，比如上英文授课学校、每天大量接触英文内容，还是只作为一门科目来学。',
        q_budget_timeline:      '我问的是每年愿意投入教育的总预算，包括学费、课外、留学费用等——给个大概范围就行，比如"10-20万""30万以上"。',
        q_family_stance:        '我问的是家庭对出国留学这件事的整体态度——是主动想去、可以接受、不太愿意还是明确反对，父母双方口径是否一致。',
        q_geo_preference:       '我问的是如果要出国，你们对国家/地区有没有明显偏好——比如只考虑英语系国家、偏向亚洲、或者完全开放都可以。',
        q_subject_interest:     '我问的是孩子目前对哪个方向有比较明显的兴趣或能力——不一定要确定专业，说一个大类（理工、艺术、商科、人文等）就够。',
      };
      clarified = CLARIFY_HINTS[q.id] || `我问的是：${coreQuestion}\n\n你可以直接说一个词或一句话，不需要详细解释。`;
    }

    this._startQuickThink(q.id);
    setTimeout(() => {
      this._aiSay(`好，我换个方式说——\n\n${clarified}`, [], q.stageLabel || '');
    }, 300);
    // 不推进 FLOW，不修改 currentQ
  },

  // ══════════════════════════════════════════════════════════════════
  //  Phase 5: LLM 结构化提取路由器
  //  ── 单次 LLM 调用 → 返回 JSON → 路由到对应动作
  //  ── 超时/JSON解析失败 → 自动降级到 regex（_analyzeUserInput）
  //  ── 流程：cloud.callFunction → _directDeepSeek → regex fallback
  // ══════════════════════════════════════════════════════════════════
  _llmClassifyAndRoute(text, q, qIdx, cd) {
    const sysPrompt  = _buildExtractionSystemPrompt();
    // 如果是追问模式，把追问问题传给 prompt，让 LLM 知道在回答什么
    const userPrompt = _buildExtractionUserPrompt(
      text, q, cd,
      this._followupActive ? (this._lastFollowupQuestion || null) : null
    );
    const messages   = [
      { role: 'system', content: sysPrompt },
      { role: 'user',   content: userPrompt },
    ];

    this._startQuickThink(q ? q.id : '_llm');

    let _done = false;

    // ── 最终降级：regex 原有流程 ─────────────────────────────────────
    const _regexFallback = () => {
      if (_done) return;
      _done = true;
      // 追问模式下 fallback：重置状态，直接按普通提取处理
      if (this._followupActive) this._followupActive = false;
      console.warn('[LLM Extract] timeout/fail → regex fallback');
      const analysis = _analyzeUserInput(text, q);
      if (analysis.action === 'rewrite_question') {
        this._rewriteCurrentQuestion(q, text);
        return;
      }
      if (analysis.action === 'ai_dispatch') {
        this._handleDispatchIntent(text, analysis.intentType);
        return;
      }
      // extract / probe → 走完整路径B逻辑
      const isOpenEnded = q && Array.isArray(q.options) && q.options.length === 0;
      const isFirstQ    = qIdx === 0;
      if (isOpenEnded && !isFirstQ) {
        this._probedQuestions = this._probedQuestions || new Set();
        const alreadyProbed   = this._probedQuestions.has(q.id);
        const qa              = _assessAnswerQuality(text);
        cd.qualityLog         = cd.qualityLog || [];
        // 只拦截 qualityScore===0（完全敷衍/模糊），score===1 的简短但有效回答放行
        if (qa.qualityScore === 0 && !alreadyProbed) {
          this._probedQuestions.add(q.id);
          cd.qualityLog.push({ qId: q.id, stage: q.stage || '', firstAnswer: text, firstQuality: qa.qualityScore, firstLabel: qa.qualityLabel, firstLen: qa.len, semanticType: qa.semanticType || 'vague', probed: true, finalQuality: null });
          this.setData({ collectedData: cd });
          const probeText = _getQualityProbe(qa.qualityScore, q, text, false);
          setTimeout(() => this._aiSay(probeText, [], q.stageLabel || ''), 400);
          return;
        }
        const existingLog = cd.qualityLog.find(l => l.qId === q.id);
        const finalQA     = alreadyProbed ? _assessAnswerQuality(text) : qa;
        if (existingLog) {
          existingLog.finalAnswer = text; existingLog.finalQuality = finalQA.qualityScore;
          existingLog.finalLabel  = finalQA.qualityLabel; existingLog.finalLen = finalQA.len;
        } else {
          cd.qualityLog.push({ qId: q.id, stage: q.stage || '', firstAnswer: text, firstQuality: qa.qualityScore, firstLabel: qa.qualityLabel, firstLen: qa.len, probed: false, finalQuality: qa.qualityScore });
        }
      }
      if (q && q.extractFn) {
        try { const r = q.extractFn(text, cd); if (q.miKey && typeof r === 'number') cd.miScores = { ...(cd.miScores || {}), [q.miKey]: r }; } catch(e) {}
      }
      try { detectAndRecord(text, q.id, cd); } catch(e) {}
      try { const cr = checkConsistency(cd); applyConsistencyToCD(cd, cr); } catch(e) {}
      this.setData({ collectedData: cd });
      this._llmAdvanceFlow(text, q, qIdx, cd, false);
    };

    const _safeTimeout = setTimeout(_regexFallback, 8000);

    // ── LLM 返回后处理 ────────────────────────────────────────────────
    const _onLLMResult = (rawText) => {
      if (_done) return;
      _done = true;
      clearTimeout(_safeTimeout);

      // 解析 JSON（剥离 markdown 代码块 / 提取第一个 {...}）
      let result = null;
      try {
        let jsonStr = (rawText || '').trim();
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        const match = jsonStr.match(/\{[\s\S]*\}/);
        if (match) jsonStr = match[0];
        result = JSON.parse(jsonStr);
      } catch(e) {
        console.warn('[LLM Extract] JSON parse failed, regex fallback. raw:', (rawText || '').slice(0, 200));
        _regexFallback();
        return;
      }

      const action = ((result.action || 'extract') + '').toLowerCase();
      const intent = ((result.intent || 'direct_answer') + '').toLowerCase();

      // ── 路由 ─────────────────────────────────────────────────────
      if (action === 'rewrite_question') {
        this._rewriteCurrentQuestion(q, text);
        return;
      }
      if (action === 'ai_dispatch') {
        this._handleDispatchIntent(text, intent);
        return;
      }
      if (action === 'probe') {
        this._probedQuestions = this._probedQuestions || new Set();
        if (!this._probedQuestions.has(q.id)) {
          this._probedQuestions.add(q.id);
          const probeText = (result.probe_text && (result.probe_text + '').trim())
            || _getQualityProbe(1, q, text, false)
            || '能再说具体一点吗？';
          cd.qualityLog = cd.qualityLog || [];
          cd.qualityLog.push({ qId: q.id, stage: q.stage || '', firstAnswer: text, firstQuality: 1, firstLabel: 'llm_vague', firstLen: (text || '').length, semanticType: 'vague', probed: true, finalQuality: null });
          this.setData({ collectedData: cd });
          setTimeout(() => this._aiSay(probeText, [], q.stageLabel || ''), 400);
          return;
        }
        // 已追问过 → fall-through to extract
      }

      // ── action === 'extract'（或 probe 二次 fall-through）────────
      // Step 1: 先跑 extractFn（处理 derived 字段 + legacy 兼容）
      if (q && q.extractFn) {
        try {
          const r = q.extractFn(text, cd);
          if (q.miKey && typeof r === 'number') cd.miScores = { ...(cd.miScores || {}), [q.miKey]: r };
        } catch(e) {}
      }
      // Step 2: LLM 提取数据覆盖（语义层面胜出，修正 else-default 误判）
      try { _applyLLMExtraction(result.extracted, cd); } catch(e) {}
      // Step 3: 证据采集
      try { detectAndRecord(text, q.id, cd); } catch(e) {}
      // Step 4: 一致性检查
      try { const cr = checkConsistency(cd); applyConsistencyToCD(cd, cr); } catch(e) {}

      this.setData({ collectedData: cd });

      // ── Step 5: 追问决策 + 简短反馈 ──────────────────────────────
      const _ack = (result.acknowledgment && (result.acknowledgment + '').trim()) || null;
      const _wasFollowup = !!this._followupActive;
      if (_wasFollowup) {
        // 这是追问的答案：重置追问状态，直接推进
        this._followupActive = false;
        this._lastFollowupQuestion = null;
      } else {
        // 判断是否需要追问（每题最多一次）
        const _fu = result.followup || {};
        this._followupAsked = this._followupAsked || {};
        const _canFollowup = _fu.decision === 'ask'
          && _fu.question
          && !this._followupAsked[q.id];
        if (_canFollowup) {
          this._followupAsked[q.id] = true;
          this._followupActive = true;
          this._lastFollowupQuestion = _fu.question;
          // 有反馈时先反馈，再追问，自然换行隔开
          const _fuText = _ack ? `${_ack}\n\n${_fu.question}` : _fu.question;
          setTimeout(() => this._aiSay(_fuText, [], q.stageLabel || ''), 400);
          return;
        }
      }

      // Step 6: 推进 FLOW（传入 acknowledgment 供前缀展示）
      this._llmAdvanceFlow(text, q, qIdx, cd, false, _ack);
    };

    // ── 优先云函数，自动回退直连 DeepSeek ────────────────────────────
    wx.cloud.callFunction({
      name: 'aiAnalysis',
      data: { mode: 'extract', messages, maxTokens: 500, temperature: 0.1 },
      success: (res) => {
        if (_done) return;
        const r = res.result || {};
        const rawText = r.success && r.text ? r.text : null;
        if (rawText) {
          _onLLMResult(rawText);
        } else {
          this._directDeepSeek(messages, 500, 0.1, _onLLMResult, _regexFallback);
        }
      },
      fail: () => {
        if (_done) return;
        this._directDeepSeek(messages, 500, 0.1, _onLLMResult, _regexFallback);
      },
    });
  },

  // ══════════════════════════════════════════════════════════════════
  //  LLM 提取后推进 FLOW（动态插题检查 + 问题切换）
  //  ── 与 _userSend 路径B的"推进 FLOW"段逻辑对等
  // ══════════════════════════════════════════════════════════════════
  _llmAdvanceFlow(text, q, qIdx, cd, _fromDynamic, _acknowledgment) {
    // ── 动态插题检查 ─────────────────────────────────────────────────
    const queue = buildDynamicQueue(cd);
    if (queue && queue.length > 0) {
      const dynQ = queue[0];
      cd._dynamicProbed = cd._dynamicProbed || {};
      cd._dynamicProbed[dynQ.key] = true;
      cd._dynamicCount = (cd._dynamicCount || 0) + 1;
      this.setData({ collectedData: cd });
      this._dynamicQActive = true;
      this._startQuickThink(q ? q.id : '_dynamic');
      setTimeout(() => this._aiSay(dynQ.text, [], q ? (q.stageLabel || '') : ''), 400);
      return;
    }

    // ── 推进 FLOW ─────────────────────────────────────────────────────
    const nextIdx = _advanceFlow(qIdx, cd);
    this.setData({ collectedData: cd });

    if (nextIdx < FLOW.length) {
      this.setData({ currentQ: nextIdx });
      const nextQ = FLOW[nextIdx];
      const isStageChange = nextQ.stageLabel !== (q ? q.stageLabel : '');

      let qualityPrefix = '';
      if (!_fromDynamic && q) {
        const isOpenEnded = Array.isArray(q.options) && q.options.length === 0;
        const isFirstQ    = qIdx === 0;
        const alreadyProbed = this._probedQuestions && this._probedQuestions.has(q.id);
        const qa = isOpenEnded && !isFirstQ ? _assessAnswerQuality(text) : null;
        if (alreadyProbed) {
          qualityPrefix = '好，这样就清楚多了。\n\n';
        } else if (qa && qa.qualityScore === 3) {
          qualityPrefix = DEEP_AFFIRMS[nextIdx % DEEP_AFFIRMS.length] + '\n\n';
        }
      }

      // 语义改写题目文本
      let _effectiveQText = nextQ.text;
      try {
        const _semReword = semGetReword(nextQ.id, cd);
        if (_semReword) _effectiveQText = _semReword;
      } catch(e) {}

      // LLM acknowledgment 优先于通用 qualityPrefix（避免重复）
      const _llmPrefix = _acknowledgment ? `${_acknowledgment}\n\n` : '';
      const _qPrefix   = _acknowledgment ? '' : qualityPrefix;

      const trans = nextQ.customTransition
        ? `${_llmPrefix}${_effectiveQText}`
        : isStageChange
          ? `${_llmPrefix}${_qPrefix}好，${q ? q.stageLabel : ''}部分完成。\n\n接下来进入【${nextQ.stageLabel}】——\n\n${_effectiveQText}`
          : `${_llmPrefix}${_qPrefix}${_effectiveQText}`;

      this._startQuickThink(q ? q.id : '_dynamic');
      const thinking = q ? (q.aiThinking || []) : [];
      setTimeout(() => this._aiSay(trans, nextQ.options || [], nextQ.stageLabel || '', thinking), 400);
    } else {
      this._startAnalysis(cd);
    }
  },

  // ══════════════════════════════════════════════════════════════════
  //  反问/纠正型处理器：AI 直接回答 → 恢复 FLOW
  //  ── 不修改 currentQ，不推进 FLOW，回答完后设 _dispatchResumeNext=true
  // ══════════════════════════════════════════════════════════════════
  _handleDispatchIntent(text, intent) {
    const cd   = this.data.collectedData || {};
    const qIdx = this.data.currentQ;
    const q    = FLOW[qIdx];

    // 记录调度中断次数
    cd._dispatchInterruptCount = (cd._dispatchInterruptCount || 0) + 1;
    this.setData({ collectedData: cd });

    // 构建 AI 应答上下文（让 AI 知道当前采集阶段 + 用户提问）
    const stageHint = q ? `（当前采集阶段：${q.stageLabel || q.stage || '基础信息'}）` : '';
    const intentLabel = { question: '问题', meta: '关于流程的疑问', challenge: '对判断的质疑' }[intent] || '问题';

    // ── 构建孩子档案摘要（供 AI 直接引用，避免瞎猜）─────────────
    const MI_NAMES = {
      linguistic: '语言智能', logical: '逻辑数学', spatial: '空间视觉',
      musical: '音乐节奏', bodily: '身体运动', interpersonal: '人际交往',
      intrapersonal: '自我认知', naturalist: '自然探索',
    };
    const miScores = cd.miScores || {};
    const topMILines = Object.entries(miScores)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${MI_NAMES[k] || k}：${v}/5`).join('、');
    const answers  = cd.answers || {};
    const subjectInterest = answers.subject_interest || '未知';
    const geoPreference   = answers.geo_preference   || '未知';
    const englishLevel    = answers.english_level    || cd.student_profile?.english_level || '未知';
    const childName       = cd.childName || '孩子';
    const grade           = cd.currentGrade || '未知';
    const pathPref        = answers.education_path_preference || '未定';

    const careerVision    = answers.career_vision    || '';
    const observedSkills  = answers.observed_skills  || '';
    const careerCluster   = answers.career_cluster   || '';

    const profileContext = topMILines
      ? `\n\n【已采集的孩子档案】\n姓名：${childName}，年级：${grade}\n顶级多元智能：${topMILines}\n学科兴趣方向：${subjectInterest}\n英语水平：${englishLevel}\n地理偏好：${geoPreference}\n路径倾向：${pathPref}${careerVision ? `\n家长对孩子25岁的期望：${careerVision}` : ''}${observedSkills ? `\n家长观察到的天赋：${observedSkills}` : ''}${careerCluster ? `\n职业方向聚焦：${careerCluster}` : ''}`
      : '';

    // ── 判断是否是专业/职业方向类问题（注入专项提示词）────────────
    const isCareerQ = /专业|职业|学什么|读什么|未来方向|兴趣方向|适合学|天赋/.test(text);
    let systemContent;
    if (isCareerQ && topMILines) {
      systemContent =
        `你是袁希™教育评估顾问，正在为家长提供专业方向建议。${profileContext}\n\n` +
        `请根据以上孩子的多元智能档案，直接给出2-3个具体的大学专业方向建议，` +
        `每个专业一句话说明与该孩子智能特点的关联。200字以内。` +
        `不要说"建议先做职业测评"，不要推荐去做别的测试，直接给答案。` +
        `结尾加上"【回到评估】我们继续之前的问题——"`;
    } else {
      systemContent =
        `你是袁希™教育评估顾问。正在与家长进行信息采集对话。` +
        `家长中途提了一个${intentLabel}。${profileContext}\n\n` +
        `请直接、简洁地回答（≤150字），结尾加上"【回到评估】我们继续之前的问题——"。` +
        `严禁说"建议先做职业测评""建议先做XX测试"这类转移答案的表达。`;
    }

    const systemMsg = { role: 'system', content: systemContent };
    const userMsg   = { role: 'user',   content: text + stageHint };
    const messages = [systemMsg, userMsg];

    this._startQuickThink(q ? q.id : '_dispatch');

    // 调用 AI（云函数优先，回退直连）
    let _done = false;
    const _fallback = () => {
      if (!_done) {
        _done = true;
        // Mock 回答（无法联网时）
        const mockAnswer = intent === 'meta'
          ? `这个问题帮我更好地了解你们家庭的教育情况，每个问题都有其判断意义。\n\n【回到评估】我们继续——`
          : `好问题。基于我现在了解到的信息，我的判断是：这需要结合你孩子的具体情况来看，没有统一答案。\n\n【回到评估】我们继续之前的问题——`;
        this._aiSay(mockAnswer, [], q ? (q.stageLabel || '') : '');
        this._dispatchResumeNext = true;
      }
    };
    const _safeTimeout = setTimeout(_fallback, 12000);

    wx.cloud.callFunction({
      name: 'aiAnalysis',
      data: { mode: 'chat', messages, maxTokens: 200, temperature: 0.7 },
      success: (res) => {
        clearTimeout(_safeTimeout);
        if (_done) return;
        _done = true;
        const result = res.result || {};
        let reply = (result.success && result.text) ? result.text : null;
        if (!reply) {
          // 云函数返回失败 → 直连
          this._directDeepSeek(messages, 200, 0.7,
            (t) => {
              this._aiSay(t, [], q ? (q.stageLabel || '') : '');
              this._dispatchResumeNext = true;
            },
            _fallback
          );
          return;
        }
        // 确保有引导语
        if (!reply.includes('回到评估')) {
          reply += '\n\n【回到评估】我们继续之前的问题——';
        }
        setTimeout(() => {
          this._aiSay(reply, [], q ? (q.stageLabel || '') : '');
          this._dispatchResumeNext = true;
          // 500ms 后自动恢复当前题
          setTimeout(() => {
            const currentQ = FLOW[this.data.currentQ];
            if (currentQ && this._dispatchResumeNext) {
              this._dispatchResumeNext = false;
              this._aiSay(currentQ.text, [], currentQ.stageLabel || '');
            }
          }, 2500);
        }, 400);
      },
      fail: () => {
        clearTimeout(_safeTimeout);
        _fallback();
      },
    });
  },

  _recordComplexitySignals(cd) {
    const answers = cd.answers || {};
    const budget   = answers.education_budget;
    const goal     = answers.goal_at_25;
    const path     = answers.education_path_preference;
    const parent   = cd.parentType;

    // 计算跨领域维度
    // domains: 'education'（基础）, 'career'（职业规划）, 'capital'（资本/资产视角）
    const domains = ['education'];

    const careerGoals = ['career_overseas', 'entrepreneurship', 'academia'];
    if (careerGoals.includes(goal)) domains.push('career');

    const capitalSignals = ['over_30w', '15w_30w'];
    const capitalParents  = ['business_family', 'entrepreneur'];
    if (capitalSignals.includes(budget) || capitalParents.includes(parent)) {
      domains.push('capital');
    }

    // 超过 1 个维度 → 记录为「复杂追问」
    if (domains.length >= 2) {
      Scorer.record('complex_question', { domains });
    }

    // 决策风险级别
    // 3=极高(家族/多代规划), 2=高(留学+创业+资本), 1=中(跨国规划), 0=低(普通择校)
    let riskLevel = 0;

    const isOverseas = path === 'highschool_abroad' || path === 'university_abroad'
                    || goal === 'career_overseas';
    const isCrossCapital = parent === 'business_family'
                        || (parent === 'entrepreneur' && budget === 'over_30w');

    if (parent === 'business_family' && isOverseas && budget === 'over_30w') {
      riskLevel = 3; // 家族 + 海外 + 高预算
    } else if (isOverseas && domains.length >= 3) {
      riskLevel = 2; // 留学 + 职业 + 资本
    } else if (isOverseas || cd.passportType === 'foreign' || cd.passportType === 'dual') {
      riskLevel = 1; // 跨国规划
    }

    if (riskLevel > 0) {
      Scorer.record('decision_risk', riskLevel);
    }
  },

  _calcCourses(cd) {
    const recs = new Set(['101', '201']);
    if ((cd.mindsetScore || 3) <= 2) recs.add('103');
    const path = (cd.answers || {}).education_path_preference;
    if (path === 'highschool_abroad' || path === 'university_abroad') recs.add('302');
    if (cd.parentType === 'business_family') { recs.add('501'); recs.add('402'); }
    if (cd.parentType === 'entrepreneur') recs.add('401');
    if ((cd.answers || {}).education_budget === 'over_30w') recs.add('402');
    return [...recs].slice(0, 4);
  },

  // ═══════════════════════════════════════════════════════════════════
  //  语音输入 — 完整实现
  //  流程：按住麦克风 → 录音(mp3, max 30s) → 松开 → 上传云存储
  //        → 调用 speechToText 云函数(腾讯云ASR) → 文字填入输入框
  //
  //  产品宪法第二条：输入门槛决定输出质量。
  //  语音是最低门槛的表达，必须做好。
  // ═══════════════════════════════════════════════════════════════════

  // 点一下：开始录音；录音中再点：停止并识别
  toggleRecord() {
    if (this.data.voiceTranscribing) return; // 识别中忽略点击

    if (this.data.isRecording) {
      // ── 停止录音 ──────────────────────────────────────────────────
      if (this._countdownTimer) {
        clearInterval(this._countdownTimer);
        this._countdownTimer = null;
      }
      this._recorder.stop();
      this.setData({ isRecording: false, voiceTranscribing: true, voiceCountdown: 8, voiceWarn: false });
      wx.vibrateShort({ type: 'light' });
      // onStop 回调会触发 _handleVoice(tempFilePath)

    } else {
      // ── 开始录音 ──────────────────────────────────────────────────
      wx.authorize({
        scope: 'scope.record',
        success: () => {
          if (!this._recorder) return;
          this._voiceHandled = false; // 每次开始录音都重置保护标志
          const MAX_REC  = 60; // 最大录音时长（秒）
          const WARN_SEC = 8;  // 最后几秒开始警告倒计时
          this._recorder.start({
            format: 'mp3',
            sampleRate: 16000,    // 16kHz — 腾讯ASR最佳采样率
            numberOfChannels: 1,  // 单声道，文件更小
            encodeBitRate: 48000,
            duration: MAX_REC * 1000,
          });
          this.setData({ isRecording: true, voiceCountdown: WARN_SEC, voiceWarn: false });
          wx.vibrateShort({ type: 'light' }); // 开始震动提示

          // 计时器：前期只计秒数，最后8秒显示警告倒计时
          let elapsed = 0;
          this._countdownTimer = setInterval(() => {
            elapsed += 1;
            const remaining = MAX_REC - elapsed;
            if (remaining <= 0) {
              // 到达最大时长，自动停止
              clearInterval(this._countdownTimer);
              this._countdownTimer = null;
              if (this.data.isRecording) {
                wx.vibrateShort({ type: 'medium' });
                this.toggleRecord(); // 自动停止并识别
              }
            } else if (remaining <= WARN_SEC) {
              // 最后8秒：显示倒计时警告 + 震动提醒
              if (remaining === WARN_SEC) wx.vibrateShort({ type: 'light' });
              this.setData({ voiceWarn: true, voiceCountdown: remaining });
            }
            // 前期不更新UI，减少重绘
          }, 1000);
        },
        fail: () => {
          wx.showModal({
            title: '需要麦克风权限',
            content: '请在手机设置里允许"袁希"访问麦克风，才能使用语音输入',
            showCancel: false,
            confirmText: '知道了',
          });
        },
      });
    }
  },

  async _handleVoice(tempFilePath) {
    // 被取消的录音：忽略
    if (this._voiceCancelled) {
      this._voiceCancelled = false;
      this.setData({ voiceTranscribing: false });
      return;
    }

    if (!tempFilePath) {
      this.setData({ voiceTranscribing: false });
      return;
    }

    try {
      // ── Step 1：上传录音到云存储 ─────────────────────────────────
      const cloudPath = `voice/${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`;
      const { fileID } = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
      });

      // ── Step 2：调用 speechToText 云函数（25秒超时保护）────────────
      const callPromise = wx.cloud.callFunction({
        name: 'speechToText',
        data: { fileID },
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('语音识别超时，请重试')), 25000)
      );
      const res = await Promise.race([callPromise, timeoutPromise]);

      const { success, text, error } = res.result || {};

      if (success && text) {
        // ── Step 3：识别成功 — 文字填入输入框，用户可直接编辑或发送 ──
        this.setData({ inputText: text, voiceTranscribing: false });
        wx.vibrateShort({ type: 'light' }); // 轻震动：成功反馈
      } else {
        throw new Error(error || '识别结果为空');
      }

    } catch (err) {
      console.error('[voice] 识别失败：', err.message);
      this.setData({ voiceTranscribing: false });
      // 非阻断式提示，用户可直接改用文字
      wx.showToast({
        title: '未识别到语音，请重试或改用文字',
        icon: 'none',
        duration: 2500,
      });
    }
  },

  _scrollBottom() {
    // scroll-view 的 scroll-into-view 必须每次值改变才触发。
    // 先清空再设置，确保每次都能可靠触发滚动。
    this.setData({ scrollIntoView: '' });
    setTimeout(() => {
      this.setData({ scrollIntoView: 'chat-bottom' });
    }, 50);
  },

  onUnload() {
    this._stopThinkingAnimation();
    this._stopQuickThink();
    if (this._streamTimer) { clearInterval(this._streamTimer); this._streamTimer = null; }
    if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
    this._streamSkipFn = null;
    if (this._recorder && this.data.isRecording) {
      try { this._recorder.stop(); } catch (e) {}
    }
    // ── 会话元数据回写云端（自学习数据）──────────────────────────
    this._flushChatSessionLog();
  },

  // ── 会话结束时，将对话深度数据回写到 assessments 文档 ────────
  _flushChatSessionLog() {
    if (!this._chatSessionStart || this._chatTurnCount === 0) return;
    const docId = wx.getStorageSync('lastAssessmentDocId');
    if (!docId) return;
    const duration = Math.floor((Date.now() - this._chatSessionStart) / 1000);
    if (duration < 10) return; // 太短不计入（误触）
    wx.cloud.callFunction({
      name: 'updateAssessmentNote',
      data: {
        docId,
        behaviorUpdate: {
          chatSessionDuration: duration,
          chatTurnCount:  this._chatTurnCount,
          chatTopics:     this._chatTopics.slice(0, 10), // 最多保留10个话题词
          chatMode:       this.data.followupMode  ? 'followup'
                        : this.data.consultMode   ? 'consult'
                        : this.data.isComplete    ? 'post_assessment'
                        : 'questionnaire',
        },
      },
      fail: () => {},
    });
  },

  // ── DeepSeek 直连回退（云函数部署后此方法不再被调用）────────────
  // TODO: 部署 aiAnalysis 云函数 + 在 app.js 设置 CLOUD_ENV 后，可删除此方法
  _directDeepSeek(messages, maxTokens, temperature, onSuccess, onFail) {
    wx.request({
      url: 'https://api.deepseek.com/v1/chat/completions',
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-fc6e5dacf2dd43e885e360fae5b032d0',
      },
      data: { model: 'deepseek-chat', messages, max_tokens: maxTokens, temperature },
      timeout: 60000,
      success: (res) => {
        const text = res.data?.choices?.[0]?.message?.content;
        if (res.statusCode === 200 && text) {
          onSuccess(text);
        } else {
          const errDetail = `HTTP ${res.statusCode}，${JSON.stringify(res.data).slice(0, 100)}`;
          console.error('[DeepSeek]', errDetail);
          onFail && onFail(errDetail);
        }
      },
      fail: (err) => {
        const errMsg = err && err.errMsg ? err.errMsg : '网络请求失败';
        console.error('[DeepSeek] wx.request fail:', errMsg);
        onFail && onFail(errMsg);
      },
    });
  },

  // ══════════════════════════════════════════════════════════════════
  //  Student 模式 — 孩子端专属问卷
  //  ─────────────────────────────────────────────────────────────────
  //  流程：_startStudentMode → 逐题 _aiSayStudent → 用户回答
  //        → _userSendStudent → extractFn + LLM补充 → _studentAdvanceFlow
  //        → 全部答完 → _onStudentFlowComplete（写入 cd.student_self + 差异检测）
  // ══════════════════════════════════════════════════════════════════

  _startStudentMode(reportCtx) {
    const cd = this.data.collectedData || {};
    const childName = (reportCtx && reportCtx.childName) || cd.childName || '你';

    const opening =
      `${childName}你好！\n\n` +
      `我是袁希。你爸爸/妈妈已经帮你做了一个初步的成长评测，` +
      `但我还想直接听听你自己的想法——因为你才是最了解自己的人。\n\n` +
      `不用担心答错，这里没有标准答案。说你真实的感受就好。\n\n` +
      `准备好了吗？我们开始聊吧。`;

    this.setData({ studentCurrentQ: 0, studentSelf: {}, studentProbedSet: [] });

    setTimeout(() => {
      this._aiSay(opening, ['准备好了，开始！'], '学生评测');
      // 延迟后出第一题
      setTimeout(() => this._askStudentQ(0), 1200);
    }, 400);
  },

  // 向学生提问第 idx 题
  _askStudentQ(idx) {
    if (idx >= STUDENT_FLOW.length) {
      this._onStudentFlowComplete();
      return;
    }
    const q = STUDENT_FLOW[idx];
    this.setData({ studentCurrentQ: idx });
    this._startQuickThink(q.id);
    setTimeout(() => this._aiSay(q.text, q.options || [], '学生评测'), 400);
  },

  // 处理学生回答
  _userSendStudent(text) {
    const messages = [...this.data.messages, { role: 'user', text, ts: Date.now() }];
    this.setData({ messages, options: [] });
    this._scrollBottom();

    const idx = this.data.studentCurrentQ;
    const q   = STUDENT_FLOW[idx];
    if (!q) { this._onStudentFlowComplete(); return; }

    // extractFn 先行（regex 层）
    const ss = { ...this.data.studentSelf };
    const cd = { ...this.data.collectedData };
    try { q.extractFn(text, ss, cd); } catch(e) { console.error('[student extractFn]', e); }
    this.setData({ studentSelf: ss });

    // 质量评估 + 是否需要追问
    const qa = _assessAnswerQuality(text);
    const alreadyProbed = (this.data.studentProbedSet || []).includes(q.id);

    // no_probe: 绝不追问（动机题）
    if (q.no_probe) {
      this._studentAdvanceFlow(idx, text, ss, cd);
      return;
    }

    // no_probe_if_undecided: 答了不知道就直接跳
    if (q.no_probe_if_undecided) {
      const isUndecided = /不知道|没想好|不确定|没有想法|随便|无所谓/.test(text);
      if (isUndecided) {
        this._studentAdvanceFlow(idx, text, ss, cd);
        return;
      }
    }

    // 质量 0 且未追问过 → 轻柔追问
    if (qa.qualityScore === 0 && !alreadyProbed) {
      const probedSet = [...(this.data.studentProbedSet || []), q.id];
      this.setData({ studentProbedSet: probedSet });
      const probe = `没关系，我想多了解你一点。\n\n${q.text.split('\n').filter(Boolean).pop()}`;
      this._startQuickThink(q.id);
      setTimeout(() => this._aiSay(probe, q.options || [], '学生评测'), 400);
      return;
    }

    // 正常推进
    this._studentAdvanceFlow(idx, text, ss, cd);
  },

  // 推进到下一题（含 LLM 补充提取）
  _studentAdvanceFlow(idx, text, ss, cd) {
    // LLM 补充提取（异步，不阻塞 UI 推进）
    this._studentLLMExtract(STUDENT_FLOW[idx], text, ss);

    const nextIdx = idx + 1;
    if (nextIdx >= STUDENT_FLOW.length) {
      // 短暂 AI 过渡语，然后完成
      this.setData({ isTyping: true });
      setTimeout(() => {
        this.setData({ isTyping: false });
        this._onStudentFlowComplete();
      }, 600);
    } else {
      this._askStudentQ(nextIdx);
    }
  },

  // LLM 补充提取（异步兜底，不影响流程）
  _studentLLMExtract(q, text, ss) {
    const systemPrompt = _buildStudentExtractionSystemPrompt(q);
    wx.cloud.callFunction({
      name: 'aiAnalysis',
      data: {
        mode: 'chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        maxTokens: 200,
        temperature: 0.1,
      },
      success: (res) => {
        try {
          const raw = res.result && res.result.text ? res.result.text : '';
          const cleaned = raw.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(cleaned);
          // 合并：只用 LLM 填补 extractFn 没有填写的字段
          const merged = { ...this.data.studentSelf };
          Object.keys(parsed).forEach(k => {
            if (parsed[k] !== null && merged[k] === undefined) {
              merged[k] = parsed[k];
            }
          });
          this.setData({ studentSelf: merged });
        } catch(e) { /* 解析失败静默忽略 */ }
      },
      fail: () => { /* 云函数失败静默忽略 */ },
    });
  },

  // 全部答完 → 差异检测 → 写入 cd → 完成提示
  _onStudentFlowComplete() {
    const ss = { ...this.data.studentSelf };
    const cd = { ...this.data.collectedData };

    // 写入 cd.student_self
    cd.student_self = ss;

    // 差异检测
    const divergence = _detectDivergence(ss, cd);
    cd.student_divergence = divergence;

    this.setData({ collectedData: cd, studentDivergence: divergence });

    // 持久化到 assessmentData（result 页的 _loadStudentData 会从这里读）
    try {
      const ad = wx.getStorageSync('assessmentData') || {};
      ad.student_self = ss;
      ad.student_divergence = divergence;
      wx.setStorageSync('assessmentData', ad);
    } catch(e) {}

    // 完成语
    const childName = cd.childName || '你';
    let completionMsg =
      `谢谢你，${childName}！你的回答非常真实，这对我很有帮助。\n\n` +
      `我已经把你的想法和你父母的回答做了对比分析。`;

    if (divergence.hasMajorConflict) {
      completionMsg +=
        `\n\n我发现你们之间有一些值得聊聊的地方——` +
        `这不是什么坏事，只是说明你们对某些问题的看法还需要更多沟通。\n\n` +
        `你可以把这个页面给你爸妈看，让他们了解你真实的想法。`;
    } else {
      completionMsg +=
        `\n\n整体来看，你和父母的方向是比较一致的，这很好。\n\n` +
        `你的个人档案已经更新，报告会更准确地反映你的真实情况。`;
    }

    this.setData({ isTyping: false });
    this._aiSay(completionMsg, ['查看完整报告'], '评测完成');
  },

  onShareAppMessage() {
    const cd = this.data.collectedData;
    const childName = cd && cd.childName ? cd.childName : '孩子';
    return {
      title: `我刚给${childName}做了多元智能评测，你也来试试？`,
      path: '/pages/index/index',
    };
  },
});
