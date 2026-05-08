// utils/education_semantic.js
// 袁希™ — 教育语义基座 v1
// ─────────────────────────────────────────────────────────────────────
// 职责：让系统先知道"用户在说什么"，再决定问什么
//
// 四个模块：
//   1. SCHOOL_TYPE_MAP   — 学校形态语义表
//   2. CURRICULUM_MAP    — 课程体系语义表
//   3. STAGE_MAP         — 年龄与阶段映射表
//   4. QUESTION_ADAPT    — 问题适配规则表
//
// 静态基座（写入本文件）：
//   类别、别名、路径关联信号、应问/不应问的问题
//
// 动态检索（不写入本文件，由 education_knowledge.js 处理）：
//   具体学校名称（世青、耀中、领科等）、新兴教育机构、地区政策细节
// ─────────────────────────────────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════
//  模块 1：学校形态语义表
//  ── 每条记录定义：
//     id           — 内部 key
//     label        — 中文展示名
//     aliases      — 用户可能说的词，用于检测
//     pathSignal   — 对出国路径的倾向信号（0=高考倾向，1=出国倾向，0.5=中性）
//     englishBase  — 默认英语水平推断
//     shouldAsk    — 对这类学校，系统必须问的关键点
//     skipOrReword — 对这类学校，不应原文问或需改问法的题目 id
//     notes        — 系统判断时的背景提示
// ══════════════════════════════════════════════════════════════════════
const SCHOOL_TYPE_MAP = {

  public_ordinary: {
    id: 'public_ordinary',
    label: '公立普通学校',
    aliases: ['公立', '普通公立', '区立', '市立', '镇里的学校', '普通中学', '普通小学', '家门口的学校'],
    pathSignal: 0.2,
    englishBase: 'weak_to_basic',
    shouldAsk: ['academic_level', 'english_intent', 'overseas_attitude', 'family_stance', 'budget'],
    skipOrReword: {},
    notes: '高考路径概率较高；出国需额外评估英语和家庭资源准备度',
  },

  public_key: {
    id: 'public_key',
    label: '公立重点/示范学校',
    aliases: ['重点中学', '示范高中', '重点小学', '重点学校', '市重点', '省重点', '重点', '示范学校', '顶级公立', '顶尖公立'],
    pathSignal: 0.35,
    englishBase: 'basic_to_conversational',
    shouldAsk: ['academic_level', 'english_intent', 'overseas_attitude', 'family_stance', 'budget'],
    skipOrReword: {},
    notes: '学业竞争激烈；留学路径需确认是否在重点内部高考竞争还是转轨出国',
  },

  private: {
    id: 'private',
    label: '私立学校',
    aliases: ['私立', '私校', '民办学校', '民办中学', '民办小学', '贵族学校', '寄宿学校'],
    pathSignal: 0.45,
    englishBase: 'basic_to_conversational',
    shouldAsk: ['curriculum_type', 'academic_level', 'overseas_attitude', 'family_stance', 'budget'],
    skipOrReword: {
      // 私立学校分高考私立和国际私立，需先确认课程体系
      q_english_intent: '孩子在学校上的是中文授课还是有大量英文课程？',
    },
    notes: '私立学校差异极大，需先确认走高考还是国际课程路线',
  },

  international: {
    id: 'international',
    label: '国际学校',
    aliases: ['国际学校', '国际部', '国际班', 'international school', '外籍子女学校', '外国人学校'],
    pathSignal: 0.90,
    englishBase: 'conversational_to_fluent',
    shouldAsk: ['curriculum_type', 'academic_level_intl', 'target_country', 'budget'],
    skipOrReword: {
      // 在国际学校就读，出国意向默认明确，不必再问是否考虑出国
      q_overseas_understanding: null, // skip
      q_english_intent:         null, // skip，英语已是学习语言
      // 学业水平需改问法
      q_academic_level: '孩子目前在国际学校的成绩大概处于什么水平？有没有IB预测分、AP考试成绩，或者老师的评语可以参考？',
    },
    notes: '出国路径几乎确定；重点判断目标国家、课程体系、学术竞争力',
  },

  bilingual: {
    id: 'bilingual',
    label: '双语学校',
    aliases: ['双语学校', '双语班', '双语课程', '中英双语', '中英文学校', '双语实验'],
    pathSignal: 0.65,
    englishBase: 'basic_to_conversational',
    shouldAsk: ['curriculum_type', 'academic_level', 'overseas_attitude', 'budget'],
    skipOrReword: {
      q_english_intent: '孩子在双语学校的英语课比例大概是多少？主要科目是英文授课吗？',
    },
    notes: '双语学校英语基础通常好于公立，但出国意向仍需确认；课程体系需明确',
  },

  homeschool: {
    id: 'homeschool',
    label: '在家上学 / 自主学习',
    aliases: ['在家上学', '家庭教育', '自主学习', 'homeschool', '不上学校', '脱学', '非学校教育'],
    pathSignal: 0.60,
    englishBase: 'unknown',
    shouldAsk: ['curriculum_type', 'academic_level', 'overseas_attitude', 'english_actual', 'family_stance', 'legal_compliance'],
    skipOrReword: {
      q_grade_school: '孩子目前采用什么方式学习？有没有跟随某个课程体系（比如IB、美国在线课程），还是完全自定课程？',
      q_academic_level: '在自主学习体系里，有没有什么标准化评估参考——比如竞赛成绩、外部考试、或者线上课程的成绩单？',
    },
    notes: '在家上学评估难度高；需了解是否有外部证明材料；出国路径可行但需要特别规划',
  },

  innovative: {
    id: 'innovative',
    label: '创新学校 / 新型教育机构',
    aliases: ['创新学校', '新学校', '项目制学校', '实验学校', '森林学校', '华德福', 'Waldorf', '蒙台梭利', 'Montessori', '日日新', '先锋', '未来学校'],
    pathSignal: 0.55,
    englishBase: 'unknown',
    shouldAsk: ['curriculum_type', 'academic_level', 'certification_status', 'overseas_attitude', 'budget'],
    skipOrReword: {
      q_academic_level: '在这类学校通常没有传统成绩排名，孩子有没有参加过外部标准化考试，或者老师有没有正式的学业评估报告？',
    },
    notes: '课程认可度是关键风险点；出国申请可能需要额外标化成绩',
  },

  vocational: {
    id: 'vocational',
    label: '职高 / 技校 / 高职',
    aliases: ['职高', '技校', '中专', '职业技术学校', '职业高中', '高职', '职业学院', '技术学院', '中等职业'],
    pathSignal: 0.15,
    englishBase: 'weak',
    shouldAsk: ['academic_level', 'overseas_attitude', 'budget', 'special_skills'],
    skipOrReword: {
      q_geo_preference: null, // 职高背景出国路径受限，地区偏好暂不问
      q_subject_interest: '孩子目前学的是哪个方向的职业技能？这是他自己喜欢的还是家长建议的？',
    },
    notes: '出国路径受限但并非不可能；需评估是否有转读普通高中意愿；可能更适合部分职业类移民路径',
  },

  university: {
    id: 'university',
    label: '大学（本科/研究生阶段）',
    aliases: ['大学', '本科', '研究生', '985', '211', '双一流', '普通本科', '专科', '大专', '二本', '三本', '一本'],
    pathSignal: 0.50,
    englishBase: 'basic_to_conversational',
    shouldAsk: ['degree_level', 'academic_level', 'overseas_attitude', 'target_degree', 'budget', 'language_test'],
    skipOrReword: {
      q_grade_school:          null, // 已是大学，不问年级/学校类型
      q_academic_level:        '孩子目前大学的成绩怎么样——GPA大概多少，或者在年级里大概什么位置？',
      q_english_intent:        '孩子英语目前到什么水平了，有没有托福/雅思成绩，或者参加过语言考试？',
    },
    notes: '路径判断转向研究生/工作签证/移民方向；本科阶段则判断是否转学或申请交换',
  },
};


// ══════════════════════════════════════════════════════════════════════
//  模块 2：课程体系语义表
//  ── 每条记录定义：
//     id           — 内部 key
//     label        — 完整名称
//     aliases      — 用户常用表达
//     origin       — 发源地/主要使用地区
//     assessStyle  — 评估方式（exam/portfolio/mixed）
//     pathRelevance — 对出国路径的关联
//     gradeRange   — 适用年级区间（中国标准）
//     shouldAsk    — 需要额外询问的内容
//     skipOrReword — 需要调整的问题
//     notes        — 系统判断提示
// ══════════════════════════════════════════════════════════════════════
const CURRICULUM_MAP = {

  gaokao: {
    id: 'gaokao',
    label: '中国高考体系（人教/北师大/地方教材）',
    aliases: ['高考', '人教版', '北师大版', '国内课程', '中国课程', '部编', '高考体系', '普通高中课程'],
    origin: 'CN',
    assessStyle: 'exam',
    pathRelevance: 'gaokao_primary',
    gradeRange: { start: 'primary', end: 'high' },
    pathSignal: 0.10,
    shouldAsk: ['academic_rank', 'subject_strength', 'overseas_attitude'],
    skipOrReword: {},
    notes: '纯高考路径；出国需要额外语言准备和课程转轨；判断重点是学业竞争力和家庭意愿',
  },

  ib: {
    id: 'ib',
    label: 'IB（国际文凭课程）',
    aliases: ['IB', 'IB课程', 'International Baccalaureate', 'ibo', 'IB体系', 'IB学校', 'PYP', 'MYP', 'DP', 'CP',
              'IB小学', 'IB初中', 'IB高中', 'IBDP', 'IBMYP', 'IBPYP'],
    origin: 'International',
    assessStyle: 'mixed', // 内部评估 + 外部考试
    pathRelevance: 'abroad_primary',
    gradeRange: { start: 'primary', end: 'high' },
    pathSignal: 0.88,
    shouldAsk: ['ib_level', 'predicted_score', 'hl_subjects', 'target_country'],
    skipOrReword: {
      q_english_intent:  null, // IB学校英语已是教学语言，skip
      q_academic_level:  '孩子IB的预测分大概多少，或者目前MYP/DP的成绩区间？HL选了哪些科目？',
    },
    notes: 'IB体系出国路径明确；需了解阶段（PYP/MYP/DP）和预期分数来判断目标院校层级',
    subSystems: {
      PYP: { gradeRange: 'primary',    notes: '小学阶段，判断重点是家庭规划方向' },
      MYP: { gradeRange: 'middle',     notes: '初中阶段，关键决策窗口期' },
      DP:  { gradeRange: 'high',       notes: '高中阶段，直接对接大学申请；预测分至关重要' },
    },
  },

  alevel: {
    id: 'alevel',
    label: 'A-Level（英国高考体系）',
    aliases: ['A-Level', 'A Level', 'Alevel', 'AS Level', 'A2', '英国课程', '英式课程', 'Cambridge A Level'],
    origin: 'UK',
    assessStyle: 'exam',
    pathRelevance: 'abroad_primary',
    gradeRange: { start: 'high', end: 'high' }, // 主要高中阶段
    pathSignal: 0.90,
    shouldAsk: ['subject_selection', 'predicted_grades', 'target_country', 'budget'],
    skipOrReword: {
      q_english_intent:  null,
      q_academic_level:  '孩子A-Level选了哪几个科目？预计成绩大概在哪个区间（A*/A/B）？',
    },
    notes: 'A-Level主要对接英联邦国家大学；需确认目标是英国、港澳还是其他英联邦；科目选择影响专业方向',
  },

  ap: {
    id: 'ap',
    label: 'AP（美国大学先修课程）',
    aliases: ['AP', 'AP课程', 'Advanced Placement', 'AP考试', 'AP体系'],
    origin: 'US',
    assessStyle: 'exam',
    pathRelevance: 'abroad_primary',
    gradeRange: { start: 'high', end: 'high' },
    pathSignal: 0.82,
    shouldAsk: ['ap_subjects', 'ap_scores', 'sat_act', 'target_country', 'budget'],
    skipOrReword: {
      q_english_intent:  null,
      q_academic_level:  '孩子修了几门AP课？考过的成绩大概什么水平（满分5分）？有没有SAT/ACT成绩？',
    },
    notes: 'AP主要对接美国/加拿大大学申请；AP成绩本身和GPA/SAT共同构成申请材料',
  },

  igcse: {
    id: 'igcse',
    label: 'IGCSE（剑桥初中课程）',
    aliases: ['IGCSE', 'Cambridge IGCSE', 'iGCSE', 'GCSE', '剑桥课程', '剑桥初中'],
    origin: 'UK/International',
    assessStyle: 'exam',
    pathRelevance: 'abroad_strong_indicator',
    gradeRange: { start: 'middle', end: 'middle' }, // 主要初中阶段
    pathSignal: 0.80,
    shouldAsk: ['subjects', 'grades', 'next_step_curriculum', 'budget'],
    skipOrReword: {
      q_english_intent:  null,
      q_academic_level:  '孩子IGCSE考了哪些科目？成绩大概在什么区间（A*/A/B/C）？',
    },
    notes: 'IGCSE通常是A-Level的前置；需确认是否会继续走A-Level还是转AP/IB路线',
  },

  canadian: {
    id: 'canadian',
    label: '加拿大课程体系',
    aliases: ['加拿大课程', '加拿大体系', '加拿大高中', 'BC省课程', 'Ontario课程', '安省课程', '不列颠哥伦比亚'],
    origin: 'CA',
    assessStyle: 'mixed',
    pathRelevance: 'abroad_canada_focus',
    gradeRange: { start: 'primary', end: 'high' },
    pathSignal: 0.75,
    shouldAsk: ['province', 'grade_level', 'target_university', 'budget'],
    skipOrReword: {
      q_english_intent: null,
      q_academic_level: '孩子在加拿大体系里的成绩大概什么水平？有没有具体的百分制或字母成绩？',
    },
    notes: '加拿大体系各省差异大；BC省和安省最常见；主要对接加拿大和部分美国大学',
  },

  australian: {
    id: 'australian',
    label: '澳洲课程体系',
    aliases: ['澳洲课程', '澳大利亚课程', 'VCE', 'HSC', 'ATAR', 'QCE', '澳洲体系', '澳大利亚体系'],
    origin: 'AU',
    assessStyle: 'mixed',
    pathRelevance: 'abroad_australia_focus',
    gradeRange: { start: 'primary', end: 'high' },
    pathSignal: 0.75,
    shouldAsk: ['state', 'atar_target', 'budget'],
    skipOrReword: {
      q_english_intent: null,
      q_academic_level: '孩子目前的ATAR预测分大概在什么区间，或者各科目成绩怎么样？',
    },
    notes: '澳洲各州课程和评分体系不同（VCE/HSC/ATAR等）；ATAR是关键升学指标',
  },

  hkdse: {
    id: 'hkdse',
    label: '香港DSE课程',
    aliases: ['DSE', 'HKDSE', '香港课程', '香港高中', '香港体系'],
    origin: 'HK',
    assessStyle: 'exam',
    pathRelevance: 'abroad_hk_focus',
    gradeRange: { start: 'high', end: 'high' },
    pathSignal: 0.70,
    shouldAsk: ['dse_subjects', 'predicted_level', 'target_university', 'budget'],
    skipOrReword: {
      q_english_intent: null,
      q_academic_level: '孩子DSE的预计成绩是多少，核心科目（中英数+X）大概几级？',
    },
    notes: '香港DSE主要对接香港和部分内地大学；也被部分英联邦国家认可',
  },
};


// ══════════════════════════════════════════════════════════════════════
//  模块 3：年龄与阶段映射表
//  ── 每条记录定义：
//     id            — 内部 key
//     label         — 中文名
//     aliases       — 用户常说的词（含 K/年级/年龄表达）
//     ageRange      — [最小年龄, 最大年龄]
//     gradeGroup    — 对应系统内部分组
//     decisionUrgency — 路径决策紧迫度（low/medium/high/critical）
//     windowNote    — 决策窗口说明
//     shouldAsk     — 这个阶段最关键的问题
//     skipOrReword  — 可以跳过或需要调整的问题
// ══════════════════════════════════════════════════════════════════════
const STAGE_MAP = {

  preschool: {
    id: 'preschool',
    label: '学前 / 幼儿园',
    aliases: ['幼儿园', '学前', '学前班', '大班', '中班', '小班', 'Pre-K', 'PreK', 'K', '托班', '托育', '3岁', '4岁', '5岁', '6岁'],
    ageRange: [3, 6],
    gradeGroup: 'preschool',
    decisionUrgency: 'low',
    windowNote: '时间充裕，无需现在锁定路径；重点是了解家庭方向意向',
    shouldAsk: ['family_direction', 'overseas_attitude', 'budget_range', 'language_exposure'],
    skipOrReword: {
      q_academic_level:  null, // 学前无学业排名，skip
      q_english_intent:  '孩子目前有没有英语启蒙？主要是中文环境还是有大量英文接触？',
      q_timeline_reality: '你们希望孩子在几岁开始正式的国际教育路径？',
    },
  },

  primary: {
    id: 'primary',
    label: '小学',
    aliases: [
      '小学', '小学生', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级',
      '1年级', '2年级', '3年级', '4年级', '5年级', '6年级',
      'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6',
      'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6',
      '7岁', '8岁', '9岁', '10岁', '11岁', '12岁',
    ],
    ageRange: [6, 12],
    gradeGroup: 'primary',
    decisionUrgency: 'medium',
    windowNote: '高回报投资期；路径方向在小学高年级（四五六年级）需要开始规划',
    shouldAsk: ['overseas_attitude', 'school_type', 'english_exposure', 'budget', 'family_stance'],
    skipOrReword: {
      q_academic_level:  '孩子在班级里成绩大概什么水平？有没有老师的评语或学校的综合评价？',
      q_english_intent:  '孩子目前英语学习到什么程度了——是课外培训、还是学校有英语课程，有没有接触英文阅读？',
    },
  },

  middle: {
    id: 'middle',
    label: '初中',
    aliases: [
      '初中', '初一', '初二', '初三', '初中生',
      '七年级', '八年级', '九年级', '7年级', '8年级', '9年级',
      'Grade 7', 'Grade 8', 'Grade 9', 'G7', 'G8', 'G9',
      'Middle School', '中学',
      '13岁', '14岁', '15岁',
    ],
    ageRange: [12, 15],
    gradeGroup: 'middle',
    decisionUrgency: 'high',
    windowNote: '黄金决策窗口期；初二前完成路径判断最佳；初三则需立即行动',
    shouldAsk: ['academic_level', 'english_level', 'overseas_attitude', 'family_stance', 'budget', 'departure_timeline'],
    skipOrReword: {},
  },

  high: {
    id: 'high',
    label: '高中',
    aliases: [
      '高中', '高一', '高二', '高三', '高中生',
      '十年级', '十一年级', '十二年级', '10年级', '11年级', '12年级',
      'Grade 10', 'Grade 11', 'Grade 12', 'G10', 'G11', 'G12',
      'High School', 'Senior', '16岁', '17岁', '18岁',
    ],
    ageRange: [15, 18],
    gradeGroup: 'high',
    decisionUrgency: 'critical',
    windowNote: '决策窗口临近；高一需立即规划；高二行动；高三基本定型',
    shouldAsk: ['academic_level', 'english_level', 'overseas_attitude', 'family_stance', 'budget', 'departure_timeline', 'curriculum_type'],
    skipOrReword: {},
  },

  university: {
    id: 'university',
    label: '大学',
    aliases: [
      '大学', '本科', '大一', '大二', '大三', '大四',
      '研究生', '硕士', '博士', '研一', '研二',
      '985', '211', '双一流', '普通本科', 'C9', '专科', '大专',
      'University', 'College', 'Undergraduate', 'Graduate',
      '18岁以上', '19岁', '20岁', '21岁', '22岁',
    ],
    ageRange: [18, 30],
    gradeGroup: 'university',
    decisionUrgency: 'high',
    windowNote: '路径判断转向研究生/工作签证/海外深造方向',
    shouldAsk: ['current_degree', 'academic_level', 'english_level', 'target_degree', 'overseas_attitude', 'budget'],
    skipOrReword: {
      q_grade_school:   null, // 已是大学，skip
      q_family_stance:  '家里对你继续深造（国内读研 vs 出国）这件事，态度是什么？',
    },
  },
};


// ══════════════════════════════════════════════════════════════════════
//  模块 4：问题适配规则表
//  ── 每条规则：
//     id         — 规则标识
//     condition  — (cd) => boolean，满足时激活
//     adaptations:
//       skip: [q_id, ...]                   — 这些题直接跳过
//       reword: { q_id: newText }            — 这些题用新文字提问
//       addContext: string                   — 在下一题前加上下文说明
//       prioritize: [q_id, ...]             — 这些题优先问（提前）
// ══════════════════════════════════════════════════════════════════════
const QUESTION_ADAPT = [

  // ── 规则1：国际学校 → 跳过"是否考虑出国"类问题 ──────────────────
  {
    id: 'adapt_intl_school',
    condition: (cd) => (cd.student_profile || {}).school_type === 'international',
    adaptations: {
      skip: ['q_overseas_understanding', 'q_english_intent'],
      reword: {
        q_academic_level:   '孩子目前在学校的成绩怎么样？有没有预测分（IB Predicted/AP score）或者老师最近的评估反馈？',
        q_family_stance:    '家里对孩子将来去哪个国家上大学，目前有没有明确倾向，还是还在比较？',
      },
      addContext: null,
    },
  },

  // ── 规则2：IB课程体系 → 改写学业问题 ─────────────────────────────
  {
    id: 'adapt_ib_curriculum',
    condition: (cd) => (cd.student_profile || {}).curriculum === 'ib',
    adaptations: {
      skip: ['q_english_intent'],
      reword: {
        q_academic_level:   '孩子IB目前的预测分大概多少分（满分45分）？HL选了哪些科目？',
      },
      addContext: null,
    },
  },

  // ── 规则3：高中阶段 → 时间紧迫，优先问出发时间 ────────────────────
  {
    id: 'adapt_high_urgency',
    condition: (cd) => (cd.student_profile || {}).grade_group === 'high',
    adaptations: {
      skip: [],
      reword: {},
      addContext: '高中阶段是路径选择的关键窗口期。',
      prioritize: ['q_departure_target'],
    },
  },

  // ── 规则4：小学阶段 → 学业问题降优先级，重点问家庭方向 ────────────
  {
    id: 'adapt_primary_stage',
    condition: (cd) => (cd.student_profile || {}).grade_group === 'primary',
    adaptations: {
      skip: [],
      reword: {
        q_academic_level:   '孩子在班级里成绩大概什么水平？不用很精确，老师的总体评价是积极的还是有明显短板？',
        q_english_intent:   '孩子目前英语接触多不多？课外有没有英语培训，或者在家有没有英文阅读的习惯？',
        q_timeline_reality: '你们希望孩子在什么时候开始走国际教育路线——是希望初中就转，还是等到高中或者大学？',
      },
      addContext: null,
    },
  },

  // ── 规则5：学前阶段 → 跳过几乎所有学业题，只问家庭方向 ──────────
  {
    id: 'adapt_preschool_stage',
    condition: (cd) => (cd.student_profile || {}).grade_group === 'preschool',
    adaptations: {
      skip: ['q_academic_level', 'q_timeline_reality', 'q_independence_detail', 'q_fill_gap'],
      reword: {
        q_english_intent:   '孩子目前有没有英语启蒙？主要是中文环境还是已经有大量英文接触？',
        q_overseas_understanding: '你们对孩子未来的教育路径，大方向是怎么想的——是希望在国内一路读下去，还是希望在某个阶段走国际路线？',
      },
      addContext: null,
    },
  },

  // ── 规则6：大学阶段 → 重新定向所有问题 ──────────────────────────
  {
    id: 'adapt_university_stage',
    condition: (cd) => (cd.student_profile || {}).grade_group === 'university',
    adaptations: {
      skip: ['q_grade_school'],
      reword: {
        q_academic_level:        '孩子目前大学的GPA大概多少，或者在年级里处于什么位置？',
        q_english_intent:        '孩子英语目前到什么程度——有没有托福/雅思成绩，日常能不能用英语读写学术材料？',
        q_family_stance:         '家里对孩子继续深造的方向（国内保研 vs 出国读研），有没有倾向？',
        q_overseas_understanding: '孩子自己对出国读研这件事了解多少——是有过认真调研，还是还在初步考虑阶段？',
      },
      addContext: null,
    },
  },

  // ── 规则7：职高/技校 → 调整出国问题框架 ────────────────────────
  {
    id: 'adapt_vocational',
    condition: (cd) => (cd.student_profile || {}).school_type === 'vocational',
    adaptations: {
      skip: ['q_geo_preference'],
      reword: {
        q_overseas_understanding: '你们有没有了解过职业技能类的出国路径，比如通过技术移民或海外职业培训项目？',
        q_academic_level:         '孩子在学校的专业课成绩怎么样，或者有没有考取什么职业证书？',
      },
      addContext: null,
    },
  },

  // ── 规则8：在家上学 → 调整所有涉及学校的问题 ─────────────────
  {
    id: 'adapt_homeschool',
    condition: (cd) => (cd.student_profile || {}).school_type === 'homeschool',
    adaptations: {
      skip: [],
      reword: {
        q_academic_level:  '孩子有没有参加过标准化测试或外部评估——比如竞赛、在线课程成绩，或者某个课程体系的考试？',
        q_english_intent:  '孩子英语学习是什么方式——自学、线上课、还是跟外教？日常用英语交流、阅读的频率怎么样？',
      },
      addContext: null,
    },
  },
];


// ══════════════════════════════════════════════════════════════════════
//  检测函数：从用户输入文本中识别学校形态、课程体系、学段
//  ── 返回：{ schoolType, curriculum, stage, confidence }
//  ── 供 extractFn 和意图分析调用
//  ── 只识别"用户说了什么"，不做路径判断（判断在 path_engine 里）
// ══════════════════════════════════════════════════════════════════════

function detectSchoolType(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const [key, entry] of Object.entries(SCHOOL_TYPE_MAP)) {
    for (const alias of entry.aliases) {
      if (t.includes(alias.toLowerCase())) {
        return { id: key, confidence: 0.85, entry };
      }
    }
  }
  return null;
}

function detectCurriculum(text) {
  if (!text) return null;
  const t = text;
  for (const [key, entry] of Object.entries(CURRICULUM_MAP)) {
    for (const alias of entry.aliases) {
      // 大小写不敏感匹配
      if (t.toLowerCase().includes(alias.toLowerCase())) {
        return { id: key, confidence: 0.85, entry };
      }
    }
  }
  return null;
}

function detectStage(text) {
  if (!text) return null;
  const t = text;
  for (const [key, entry] of Object.entries(STAGE_MAP)) {
    for (const alias of entry.aliases) {
      if (t.includes(alias)) {
        return { id: key, confidence: 0.85, entry };
      }
    }
  }
  return null;
}

// 综合检测：对一段文本一次性提取所有语义
function detectFromText(text) {
  return {
    schoolType: detectSchoolType(text),
    curriculum: detectCurriculum(text),
    stage:      detectStage(text),
  };
}


// ══════════════════════════════════════════════════════════════════════
//  适配查询：给定当前 cd，返回合并后的适配规则
//  ── 返回：{ skip: Set<string>, reword: Map<qId, string>, addContext: string|null }
// ══════════════════════════════════════════════════════════════════════
function getQuestionAdaptations(cd) {
  const skip      = new Set();
  const reword    = {};
  const prioritize = [];
  let   addContext = null;

  for (const rule of QUESTION_ADAPT) {
    try {
      if (!rule.condition(cd)) continue;
      const a = rule.adaptations;
      (a.skip || []).forEach(qId => skip.add(qId));
      Object.assign(reword, a.reword || {});
      if (a.addContext) addContext = a.addContext;
      (a.prioritize || []).forEach(qId => prioritize.push(qId));
    } catch (e) {
      // 单条规则 condition 出错不影响其他规则
    }
  }

  return { skip, reword, prioritize, addContext };
}

// ── 快捷查询：某题是否应该跳过 ────────────────────────────────────
function shouldSkipQuestion(qId, cd) {
  const { skip } = getQuestionAdaptations(cd);
  return skip.has(qId);
}

// ── 快捷查询：某题是否有改写文本 ─────────────────────────────────
function getRewordedQuestion(qId, cd) {
  const { reword } = getQuestionAdaptations(cd);
  return reword[qId] || null;
}


// ══════════════════════════════════════════════════════════════════════
//  静态 vs 动态边界说明（工程文档，不执行）
//
//  写入本文件（静态基座）：
//    ✓ 学校形态分类（8种）+ 每种的路径信号和问题适配
//    ✓ 课程体系分类（8种）+ 评估方式和申请关联
//    ✓ 学段映射（6段）+ 决策紧迫度和问题重点
//    ✓ 问题适配规则（8条）+ 跳过/改写逻辑
//
//  不写入，改用动态检索（education_knowledge.js / 云端）：
//    ✗ 具体学校名称（世青、耀中、领科、WISS 等 → 检索）
//    ✗ 各国具体大学排名和录取数据（→ match_engine）
//    ✗ 各地政策细节（上海/深圳/北京 国际学校招生限制等 → 检索）
//    ✗ 课程体系最新考试难度变化（IB 2025大纲调整等 → 检索）
//    ✗ 新兴教育机构（近2年新出现的学校模式 → 检索）
// ══════════════════════════════════════════════════════════════════════

module.exports = {
  SCHOOL_TYPE_MAP,
  CURRICULUM_MAP,
  STAGE_MAP,
  QUESTION_ADAPT,
  detectSchoolType,
  detectCurriculum,
  detectStage,
  detectFromText,
  getQuestionAdaptations,
  shouldSkipQuestion,
  getRewordedQuestion,
};
