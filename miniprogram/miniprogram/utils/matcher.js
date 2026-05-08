// utils/matcher.js — 袁希™ 院校匹配引擎 v4
// ═══════════════════════════════════════════════════════════════
//
//  v4 新增：欧洲隐藏路径系统
//  ── 核心洞察 ─────────────────────────────────────────────────
//  欧洲顶尖大学（ETH苏黎世QS#7、TU Munich QS#37）学费为英美的
//  1/10 甚至免费，对中等收入家庭是真正意义上的阶层跃升路径。
//  算法通过「语言能力信号 × 预算限制 × 地理开放度」三重条件
//  自动识别「欧洲路径候选家庭」并主动推荐，而非等待家长主动询问。
//
//  新增信号：
//    q_language → languageProfile → europeFeasible（boolean）
//    q_geography 新增 'europe' 偏好选项
//    school.languageRequirement（english_only/german_primary/french_primary）
//    school.hiddenGem（true → 激活性价比说明文案）
//    school.livingCostCNY（精确年化生活费）
//
//  专业六维评分体系（总分100，含地理偏好加成）
//
//
//  维度1  学术适配度  Academic Compatibility    [0-30]
//         → 学校录取难度 vs 多信号校准后的学生真实学术水平
//         → 含自我申报偏差修正（中国家庭平均高估约0.5档）
//
//  维度2  智能匹配度  Intellectual Fit          [0-25]
//         → 8维MI分数 × 学校MI强项 的加权余弦相似度
//         → 非二元Top-3，而是连续向量运算
//
//  维度3  志向专业匹配 Career-Major Alignment   [0-20]
//         → 职业目标 → 专业群组 → 学校专业强项 三级管道
//         → 结合MI优势推断最可能专业方向
//
//  维度4  现实可行度  Practical Feasibility     [0-15]
//         → 连续预算函数（含生活费）+ 奖学金调整
//         → 海外学校的语言可行性评估
//
//  维度5  环境文化契合 Culture-Environment Fit  [0-10]
//         → 从孩子MI特征 + 思维得分推断偏好风格
//         → 从学校已有数据推断学校文化（无需新增字段）
//
//  设计原则：宁低勿高 · 客观 · 透明 · 可解释
//
// ═══════════════════════════════════════════════════════════════

const { SCHOOLS } = require('./schools_data');

// ══════════════════════════════════════════════
//  常量：基础映射表
// ══════════════════════════════════════════════
const MI_NAMES = {
  linguistic:    '语言智能',
  logical:       '逻辑数学',
  spatial:       '空间视觉',
  musical:       '音乐节奏',
  bodily:        '身体运动',
  interpersonal: '人际交往',
  intrapersonal: '自我认知',
  naturalist:    '自然探索',
};

const MI_KEYS = ['linguistic', 'logical', 'spatial', 'musical', 'bodily', 'interpersonal', 'intrapersonal', 'naturalist'];

const GOAL_NAMES = {
  career_overseas:  '海外职业发展',
  academia:         '学术科研深造',
  entrepreneurship: '创业/商业',
  stable_china:     '国内精英路线',
  arts:             '艺术/体育专业',
};

// 录取难度 → 数值（用于差距运算）
const DIFFICULTY_NUM = {
  'very_high':  5,
  'high':       4,
  'medium':     3,
  'accessible': 2,
  'easy':       1,
};

// 学术水平自报 → 初始档位（1-5）
const ACADEMIC_TIER_MAP = {
  'top_5pct':       5,
  'top_10pct':      5,
  'top_20pct':      4,
  'top_30pct':      4,
  'top_50pct':      3,
  'average':        3,
  'below_average':  2,
  'struggling':     1,
};

// 三层院校元数据
const REACH_META = {
  reach:  { label: '冲刺',  labelEn: 'Reach',  color: '#C75B2A', bg: 'rgba(199,91,42,0.12)',  border: 'rgba(199,91,42,0.3)',  tip: '需要额外努力，但有可能性' },
  match:  { label: '目标',  labelEn: 'Match',  color: '#1B6CA8', bg: 'rgba(27,108,168,0.12)', border: 'rgba(27,108,168,0.3)', tip: '与当前学术水平高度匹配' },
  safety: { label: '稳妥',  labelEn: 'Safety', color: '#2A7A5A', bg: 'rgba(42,122,90,0.12)',  border: 'rgba(42,122,90,0.3)',  tip: '录取把握较大，可作为保底选择' },
};

const ACADEMIC_TIER_LABELS = {
  5: '拔尖优秀',
  4: '中上水平',
  3: '中等水平',
  2: '中下水平',
  1: '基础阶段',
};

// ══════════════════════════════════════════════
//  维度3 核心：职业方向 → MI特征 + 专业关键词
//  用于计算 goal_at_25 × 学校培养优势的匹配程度
// ══════════════════════════════════════════════
const CAREER_PROFILE = {
  career_overseas: {
    miBonus:      ['interpersonal', 'linguistic'],
    majorKeywords: ['international', '国际', '外语', '商科', '金融', '市场', '传媒'],
    pathFitBonus: ['highschool_abroad', 'university_abroad', 'international_school'],
  },
  academia: {
    miBonus:       ['logical', 'intrapersonal', 'naturalist'],
    majorKeywords: ['研究', '理学', '工程', '数学', '物理', '生命科学', '材料', 'research'],
    pathFitBonus:  ['gaokao', 'university_abroad'],
  },
  entrepreneurship: {
    miBonus:       ['interpersonal', 'logical', 'spatial'],
    majorKeywords: ['管理', '经济', '创业', '商学', '工商', '金融', '电商', 'business'],
    pathFitBonus:  ['university_abroad', 'international_school'],
  },
  stable_china: {
    miBonus:       ['logical', 'linguistic', 'intrapersonal'],
    majorKeywords: ['法律', '金融', '医学', '工程', '行政', '汉语', '经济', '会计'],
    pathFitBonus:  ['gaokao'],
  },
  arts: {
    miBonus:       ['musical', 'spatial', 'bodily', 'linguistic'],
    majorKeywords: ['艺术', '音乐', '设计', '表演', '影视', '舞蹈', '体育', 'art', 'design'],
    pathFitBonus:  ['international_school', 'university_abroad'],
  },
};

// ══════════════════════════════════════════════
//  主入口：matchSchools
//  输入：assessmentData
//  输出：{ universities, highschools, tiered, stage, scoreWeights, studentProfile }
// ══════════════════════════════════════════════
function matchSchools(assessmentData) {
  if (!assessmentData) return { universities: [], highschools: [], tiered: null, stage: null };

  const {
    miScores     = {},
    mindsetScore = 0,
    answers      = {},
    currentGrade = '',
    passportType = 'cn',
  } = assessmentData;

  // ── 构建结构化学生画像（一次计算，全程复用）──
  const student = buildStudentProfile({ miScores, mindsetScore, answers, currentGrade, passportType });

  // ── 硬过滤 ──
  const filtered = SCHOOLS.filter(s => hardFilter(s, student));

  // ── 五维打分 ──
  const scored = filtered.map(school => {
    const breakdown = calcScoreBreakdown(school, student);
    const total = Math.min(
      breakdown.academic + breakdown.intellectual + breakdown.career +
      breakdown.practical + breakdown.culture + breakdown.geo,
      100
    );
    const reachLabel = calcReachMatchSafety(school, student.academicTier);
    const reasons    = calcMatchReasons(school, student, breakdown);

    return {
      ...school,
      matchScore:     Math.round(total),
      breakdown,
      matchReasons:   reasons,
      fitBadge:       calcFitBadgeByScore(Math.round(total)),
      planningFlag:   calcPlanningFlag(school, currentGrade),
      reachLabel,
      reachMeta:      REACH_META[reachLabel],
      tuitionDisplay: formatTuition(school),
    };
  });

  // ── 按类型排序 ──
  const universities = scored
    .filter(s => s.type === 'university')
    .sort((a, b) => b.matchScore - a.matchScore);

  const highschools = scored
    .filter(s => s.type === 'highschool')
    .sort((a, b) => b.matchScore - a.matchScore);

  // ── 三层推荐（匹配分 ≥ 40，加地区多样性强制）──
  const qualified = scored.filter(s => s.matchScore >= 40);

  // 用户有地理偏好时，目标地区院校在 diversify 中不受单地区上限限制
  const _geoPref = (student.answers || {}).geo_preference || 'open';
  const _GEO_REGIONS = {
    us: ['us'], uk: ['uk'], canada: ['ca'], au_nz: ['au', 'nz'],
    asia_pacific: ['sg', 'jp', 'hk', 'kr'],
    europe: [],  // isEuropean 判断
    uk_us: ['uk', 'us'], commonwealth: ['au', 'ca', 'nz'],
  };
  const _targetRegs = _GEO_REGIONS[_geoPref] || [];

  const reachArr  = diversify(qualified.filter(s => s.reachLabel === 'reach'),  2, _targetRegs, _geoPref);
  const matchArr  = diversify(qualified.filter(s => s.reachLabel === 'match'),  3, _targetRegs, _geoPref);
  const safetyArr = diversify(qualified.filter(s => s.reachLabel === 'safety'), 2, _targetRegs, _geoPref);

  // 补位：如果某层为空，从相邻层借最高分者
  if (matchArr.length === 0 && reachArr.length > 0)  matchArr.push(...reachArr.slice(0, 1));
  if (matchArr.length === 0 && safetyArr.length > 0) matchArr.push(...safetyArr.slice(0, 1));

  // ── 地理偏好透明度说明 ──────────────────────────────────────────────
  const _GEO_FLAG_LABELS = {
    us: '🇺🇸 美国', uk: '🇬🇧 英国', canada: '🇨🇦 加拿大', au_nz: '🇦🇺 澳洲/新西兰',
    asia_pacific: '🌏 亚太地区', europe: '🇪🇺 欧洲大陆', uk_us: '🇬🇧🇺🇸 英美', commonwealth: '🌐 英联邦',
  };
  const _geoLabel = _GEO_FLAG_LABELS[_geoPref] || null;

  let geoPrefNote = null;
  if (_geoPref !== 'open' && _geoPref !== 'cn_only') {
    const allRec = [...reachArr, ...matchArr, ...safetyArr];
    const hitCount = allRec.filter(s => {
      const r = s.region || '';
      if (_geoPref === 'europe') return r.startsWith('eu_') || r === 'eu';
      return _targetRegs.includes(r);
    }).length;
    if (allRec.length === 0) {
      geoPrefNote = { type: 'empty', text: `${_geoLabel}方向院校匹配暂无结果，将在后续版本补充更多资源` };
    } else if (hitCount === allRec.length) {
      geoPrefNote = { type: 'respected', text: `已优先筛选${_geoLabel}方向院校` };
    } else if (hitCount >= Math.ceil(allRec.length / 2)) {
      // 目标方向占多数（≥50%）→ 基本遵从，少量补充
      geoPrefNote = { type: 'partial', text: `已优先${_geoLabel}方向，少量院校来自相近地区补充参考` };
    } else if (hitCount > 0) {
      // 目标方向有但是少数 → 数据库资源有限，需说明
      geoPrefNote = { type: 'expanded', text: `${_geoLabel}方向已有 ${hitCount} 所院校，其余来自相近英语圈地区补充。我们正持续丰富该方向的院校库` };
    } else {
      geoPrefNote = { type: 'expanded', text: `${_geoLabel}方向当前院校资源有限，以下为综合条件最优匹配。如需该方向专项推荐，欢迎预约袁希老师深度咨询` };
    }
  }

  const tiered = {
    reach:  reachArr,
    match:  matchArr,
    safety: safetyArr,
    academicTierLabel:   ACADEMIC_TIER_LABELS[student.academicTier]   || '综合评估',
    biasNote: student.biasCorrection > 0
      ? `已基于综合信号修正评估档位（修正量 ${student.biasCorrection.toFixed(1)} 档）`
      : '',
    geoLabel:    _geoLabel,
    geoPrefNote: geoPrefNote,
  };

  return {
    universities,
    highschools,
    tiered,
    stage: currentGrade,
    studentProfile: student,
    scoreWeights: {
      academic:      { label: '学术适配度',  max: 30, desc: '孩子学术水平与学校录取难度的现实匹配，含多信号偏差修正' },
      intellectual:  { label: '智能匹配度',  max: 25, desc: '8维MI分数与学校培养方向的加权余弦相似度' },
      career:        { label: '志向专业匹配', max: 20, desc: '职业目标→专业方向→学校专业强项 三级匹配管道' },
      practical:     { label: '现实可行度',  max: 15, desc: '连续预算函数（含生活费）+ 奖学金潜力 + 语言可行性' },
      culture:       { label: '环境文化契合', max: 10, desc: '孩子MI特征与学习风格偏好 vs 学校文化环境' },
    },
  };
}

// ══════════════════════════════════════════════
//  学生画像构建
//  所有维度的输入统一来自这里，避免重复计算
// ══════════════════════════════════════════════
function buildStudentProfile({ miScores, mindsetScore, answers, currentGrade, passportType }) {
  const rawTier        = ACADEMIC_TIER_MAP[answers.academicTier] || 3;
  const biasCorrection = calcBiasCorrection(answers, mindsetScore);
  const academicTier   = Math.max(1, Math.min(5, Math.round(rawTier - biasCorrection)));

  // 归一化MI向量（0-1，相对强度）
  const miMax = Math.max(...MI_KEYS.map(k => miScores[k] || 0), 1);
  const miNorm = {};
  MI_KEYS.forEach(k => { miNorm[k] = (miScores[k] || 0) / miMax; });

  // 前2 MI键
  const topMIKeys = MI_KEYS
    .filter(k => miScores[k])
    .sort((a, b) => (miScores[b] || 0) - (miScores[a] || 0))
    .slice(0, 3);

  // 风格偏好推断
  const creativeMI     = (miScores.musical || 0) + (miScores.spatial || 0) + (miScores.bodily || 0);
  const analyticalMI   = (miScores.logical || 0) + (miScores.intrapersonal || 0);
  const socialMI       = (miScores.interpersonal || 0) + (miScores.linguistic || 0);
  const prefersCreative   = creativeMI   > analyticalMI * 1.3;
  const prefersAnalytical = analyticalMI > creativeMI * 1.3;
  const prefersSocial     = socialMI > 7;

  // 竞争耐受度（0=低，1=高）
  const competitionTolerance = mindsetScore >= 3.5 ? 'high' : mindsetScore >= 2.5 ? 'medium' : 'low';

  // 语言能力画像（用于欧洲路径可行性评估）
  // linguistic MI ≥ 7 → 天然语言天赋
  // language_profile === 'multi_language' → 主动意愿
  // 两者叠加 → 非英语路径解锁
  const linguisticMI = miScores.linguistic || 0;
  const langProfile  = answers.language_profile || 'building_english';
  const languageAptitude =
    langProfile === 'strong_english'   ? 'high_english' :
    langProfile === 'multi_language'   ? 'multi' :
    langProfile === 'stem_focused'     ? 'low' :
    linguisticMI >= 7                  ? 'high_english' : 'medium';
  // 欧洲非英语路径可行性：linguistic高 OR 多语言意愿
  const europeFeasible = (languageAptitude === 'multi' ||
    (linguisticMI >= 6 && langProfile !== 'stem_focused'));

  return {
    answers,
    miScores,
    miNorm,
    mindsetScore,
    topMIKeys,
    academicTierRaw:  rawTier,
    academicTier,
    biasCorrection,
    currentGrade,
    passportType,
    prefersCreative,
    prefersAnalytical,
    prefersSocial,
    competitionTolerance,
    languageAptitude,
    europeFeasible,
  };
}

// ══════════════════════════════════════════════
//  偏差修正：中国家庭的学术水平自报倾向于高估
//  多信号综合，修正量 0-1.5 档
// ══════════════════════════════════════════════
function calcBiasCorrection(answers, mindsetScore) {
  let bias = 0;

  // 信号1: 国际学校的"前20%"与重点公立的"前20%"含金量不同
  // 国际学校内部竞争较弱 → 倾向高估
  if (answers.schoolType === 'international') bias += 0.4;

  // 信号2: 普通公立学校的"前5%"比重点学校含金量略低
  if (answers.schoolType === 'public_ordinary' && answers.academicTier === 'top_5pct') bias -= 0.2;

  // 信号3: 高成绩自报 + 低成长型思维 = 可疑信号
  // 真正的顶尖学生通常具备更强的元认知（即思维得分高）
  if (['top_5pct', 'top_10pct', 'top_20pct'].includes(answers.academicTier) && mindsetScore < 2.5) {
    bias += 0.6; // 成绩好但思维固化 → 可能依赖死记硬背，实际能力有限
  }

  // 信号4: 家长职业作为校准参考
  // 学术/医疗/法律等精英职业 → 家长更了解真实学术要求 → 报告更准确
  const accurateProfessions = ['academia', 'doctor', 'lawyer', 'engineer_senior'];
  if (accurateProfessions.some(p => (answers.parent_occupation || '').includes(p))) bias -= 0.2;

  // 信号5: 目标远大 + 资源有限 = 家庭系统性乐观偏差
  if (answers.goal_at_25 === 'career_overseas' && answers.education_budget === 'under_5w') bias += 0.3;
  if (answers.goal_at_25 === 'academia'        && answers.education_budget === 'under_5w') bias += 0.2;

  return Math.max(0, Math.min(1.5, bias));
}

// ══════════════════════════════════════════════
//  维度1：学术适配度 [0-30]
//  核心思路：gap = 学校难度 - 学生修正档位
//  用非对称的分段函数处理：
//    gap = 0   → 30分（完美适配，刚好能进）
//    gap = -1  → 26分（略微保守，仍是好选择）
//    gap = +1  → 22分（合理挑战，努力可达）
//    gap = -2  → 18分（孩子明显超配）
//    gap = +2  → 10分（明显高于当前水平）
//    |gap| > 2 → 快速衰减
// ══════════════════════════════════════════════
function calcAcademicCompatibility(school, student) {
  const schoolDiff = DIFFICULTY_NUM[school.admissionDifficulty] || 3;
  const gap = schoolDiff - student.academicTier;

  const gapScoreMap = {
    '-3': 10, '-2': 18, '-1': 26,
     '0': 30,
     '1': 22,  '2': 10,  '3': 4,  '4': 1,
  };

  const score = gapScoreMap[String(Math.max(-3, Math.min(4, gap)))] || 1;

  // 时间线调整：小学生的"当前学术档位"预测效力较低，轻微放宽
  const stageMultiplier = { primary: 1.08, middle: 1.02, high: 1.0 }[student.currentGrade] || 1.0;

  return Math.min(30, Math.round(score * stageMultiplier));
}

// ══════════════════════════════════════════════
//  维度2：智能匹配度 [0-25]
//  加权余弦相似度：student MI向量 · school MI向量
//  school向量：miStrengths内的维度=1.0，其余=0.05（非0，保留微弱相关性）
// ══════════════════════════════════════════════
function calcIntellectualFit(school, student) {
  if (!school.miStrengths || Object.keys(student.miNorm).length === 0) return 12;

  const schoolVec = {};
  MI_KEYS.forEach(k => {
    schoolVec[k] = school.miStrengths.includes(k) ? 1.0 : 0.05;
  });

  // 加权点积
  let dotProduct = 0;
  let schoolNorm = 0;
  MI_KEYS.forEach(k => {
    dotProduct += (student.miNorm[k] || 0) * schoolVec[k];
    schoolNorm += schoolVec[k] * schoolVec[k];
  });

  const similarity = schoolNorm > 0 ? dotProduct / Math.sqrt(schoolNorm) : 0;

  // 线性缩放到 [5, 25]，保证最低5分（任何学校都有基本相关性）
  return Math.round(5 + Math.min(similarity, 1) * 20);
}

// ══════════════════════════════════════════════
//  维度3：志向专业匹配 [0-20]
//  三级管道：goal_at_25 → MI bonus → 专业关键词
//  Sub-A(0-10): 学校的 goalFit 是否覆盖用户目标
//  Sub-B(0-6) : 职业方向所需的MI维度 × 学生MI是否匹配
//  Sub-C(0-4) : 学校 majors/专业 与职业关键词重合度
// ══════════════════════════════════════════════
function calcCareerMajorAlignment(school, student) {
  const goal         = student.answers.goal_at_25;
  const pathPref     = student.answers.education_path_preference;
  const careerProf   = goal ? CAREER_PROFILE[goal] : null;

  let score = 0;

  // Sub-A: goalFit
  if (school.goalFit && goal) {
    if (school.goalFit.includes(goal)) {
      score += 10;
    } else {
      // 部分相关：通过路径偏好间接推断
      const relatedGoals = { career_overseas: ['academia', 'entrepreneurship'], stable_china: ['entrepreneurship'] };
      const related = relatedGoals[goal] || [];
      if (school.goalFit.some(g => related.includes(g))) score += 5;
      else score += 2; // 无关但不为零
    }
  } else {
    score += 5; // 无数据→中性
  }

  if (!careerProf) return Math.min(score, 20);

  // Sub-B: MI × 职业方向 bonus
  const miMatch = careerProf.miBonus.filter(m => student.topMIKeys.includes(m)).length;
  if (miMatch >= 2)      score += 6;
  else if (miMatch === 1) score += 3;
  // else: 0（MI与职业方向不匹配）

  // Sub-C: 专业关键词
  const majorText  = (school.majors || []).join('|');
  const introText  = (school.intro  || '').toLowerCase();
  const searchStr  = (majorText + '|' + introText).toLowerCase();
  const kwMatches  = careerProf.majorKeywords.filter(kw => searchStr.includes(kw.toLowerCase())).length;
  if (kwMatches >= 3)      score += 4;
  else if (kwMatches >= 1) score += 2;

  // 路径偏好 bonus（选对路径加分）
  if (pathPref && careerProf.pathFitBonus.includes(pathPref)) score += 1;

  // Sub-D: 学科兴趣 (subject_interest) 与学校专业关键词匹配 [0-2 bonus]
  const SUBJECT_KEYWORDS = {
    stem:           ['计算机', '工程', '数学', '物理', '编程', '理工', 'STEM', 'Engineering', '人工智能'],
    natural_science:['生物', '医学', '生命', '环境', '化学', '药学', '医疗', '自然'],
    business:       ['商', '金融', '管理', '经济', '创业', 'business', '会计', '贸易'],
    humanities:     ['人文', '历史', '政治', '法律', '哲学', '文学', '社会', '语言'],
    arts_design:    ['艺术', '设计', '音乐', '建筑', '美术', '创意', 'art', 'design'],
    communication:  ['新闻', '传播', '营销', '媒体', '公关', '电影', '广告'],
  };
  const subjectKws = SUBJECT_KEYWORDS[student.answers.subject_interest] || [];
  if (subjectKws.length > 0) {
    const subjectHit = subjectKws.filter(kw => searchStr.includes(kw.toLowerCase())).length;
    if (subjectHit >= 2) score += 2;
    else if (subjectHit >= 1) score += 1;
  }

  return Math.min(score, 20);
}

// ══════════════════════════════════════════════
//  维度4：现实可行度 [0-15]
//  Sub-A(0-9) : 连续预算函数（年化学费+生活费 vs 家庭预算）
//  Sub-B(0-3) : 奖学金潜力（高学术档位 × 学校有奖学金）
//  Sub-C(0-3) : 语言可行性（区分英语/德语/法语路径，使用语言画像信号）
// ══════════════════════════════════════════════
function calcPracticalFeasibility(school, student) {
  let score = 0;

  // Sub-A: 预算适配（连续函数，非档位桶）
  score += calcContinuousBudgetScore(school, student) * 9;

  // Sub-B: 奖学金潜力
  if (school.scholarshipAvailable) {
    if (student.academicTierRaw >= 4)      score += 3;
    else if (student.academicTierRaw >= 3) score += 1.5;
    else                                   score += 0.5;
  }

  // Sub-C: 语言可行性（v2 — 区分语言路径）
  const region = school.region || 'cn';
  const isOverseas = !['cn', 'tw', 'hk', 'mo'].includes(region);
  const langReq    = school.languageRequirement || 'english_only';  // 新字段，旧学校默认英语
  const overseasPath = ['highschool_abroad', 'university_abroad', 'international_school'];
  const hasOverseasIntent = overseasPath.includes(student.answers.education_path_preference);
  const isIntlSchool      = student.answers.schoolType === 'international';

  if (!isOverseas) {
    score += 3; // 国内学校无语言障碍
  } else if (langReq === 'english_only' || langReq === 'english_available') {
    // 英语路径：与原逻辑一致
    if (hasOverseasIntent)   score += 3;
    else if (isIntlSchool)   score += 2;
    else                     score += 0.5;
  } else if (langReq === 'german_primary' || langReq === 'bilingual_en_de') {
    // 德语路径：需要额外语言能力
    if (student.europeFeasible && hasOverseasIntent)  score += 2.5;  // 有语言天赋 + 出国意愿
    else if (student.europeFeasible)                  score += 1.5;  // 语言天赋好但路径未定
    else if (school.englishMediumAvailable && hasOverseasIntent) score += 1.5; // 有英语硕士项目
    else                                              score += 0.3;  // 语言障碍大
  } else if (langReq === 'french_primary') {
    // 法语路径：类似德语逻辑
    if (student.europeFeasible && hasOverseasIntent)  score += 2;
    else if (school.englishMediumAvailable && hasOverseasIntent) score += 1.5;
    else                                              score += 0.3;
  } else {
    score += hasOverseasIntent ? 2 : 0.5;
  }

  return Math.min(Math.round(score), 15);
}

// 连续预算匹配函数（高斯衰减形态）
// 年度总成本/年度预算 = ratio
// ratio ≈ 0.7 时最优（花家庭预算的70%，留有余地）
function calcContinuousBudgetScore(school, student) {
  const budgetMap = {
    'under_5w':   50000,
    '5w_15w':    130000,
    '15w_30w':   250000,
    '30w_60w':   450000,
    '60w_100w':  800000,
    'over_100w': 1500000,
    // 向后兼容旧数据
    'over_30w':  450000,
  };
  const annualBudget = budgetMap[student.answers.education_budget] || 150000;

  // 分地区生活费估算（CNY/年）
  const LIVING_COST_BY_REGION = {
    cn:    25000,
    us:   165000,   // 约 $22,000/年
    uk:   130000,   // 约 £13,000/年
    sg:   110000,
    au:   110000,
    ca:    95000,
    nz:    85000,
    jp:    85000,   // 东京 ~¥100,000/月 = ~10万日元/月
    kr:    70000,   // 首尔 ~KRW 900,000/月
    hk:   140000,
    eu_ch:190000,   // 苏黎世生活费极高 ~CHF 2,000/月
    eu_de: 85000,   // 慕尼黑 ~€900/月
    eu_nl:115000,   // 荷兰 ~€1,200/月
    eu_fr:120000,   // 巴黎 ~€1,250/月
    eu_it: 90000,   // 米兰/博洛尼亚 ~€950/月
    eu_hu: 55000,   // 布达佩斯 ~€580/月
    eu_pl: 50000,   // 华沙/克拉科夫 ~€530/月
    eu_be: 90000,
    eu_dk:130000,
    eu_se:120000,
  };
  const living = school.livingCostCNY  // 学校数据中有精确值则优先使用
    || LIVING_COST_BY_REGION[school.region || 'cn']
    || 80000;

  // 年化总成本（学费 + 生活费）
  let annualCost = 0;
  if (school.tuitionCNY === 0) {
    // 免学费学校（德国等）：只计生活费
    annualCost = living;
  } else if (school.tuitionCNY) {
    annualCost = school.tuitionCNY + living;
  } else if (school.tuitionUSD) {
    annualCost = school.tuitionUSD * 7.3 + living;
  } else {
    annualCost = 120000 + living; // 未知学费 → 保守估计
  }

  const ratio = annualCost / annualBudget;

  // 分段函数：中间最优，两端衰减
  if (ratio <= 0.3)  return 0.75; // 远低于预算，可能选择了偏低档次
  if (ratio <= 0.6)  return 0.95; // 舒适区偏低
  if (ratio <= 0.85) return 1.0;  // 最优区间
  if (ratio <= 1.0)  return 0.88; // 刚好在预算内
  if (ratio <= 1.2)  return 0.65; // 轻微超支
  if (ratio <= 1.6)  return 0.35; // 明显超支
  if (ratio <= 2.2)  return 0.12; // 严重超支
  return 0;
}

// ══════════════════════════════════════════════
//  维度5：环境文化契合 [0-10]
//  学生偏好（由MI + 思维得分推断）× 学校文化（由已有数据推断）
// ══════════════════════════════════════════════
function calcCultureFit(school, student) {
  const culture = inferSchoolCulture(school);
  let score = 5; // 基础分

  // 竞争耐受度匹配
  if (student.competitionTolerance === 'high' && culture.competitiveness >= 4) score += 2;
  if (student.competitionTolerance === 'high' && culture.competitiveness <= 2) score -= 1; // 竞争型人格进轻松学校，可能没有充分激励
  if (student.competitionTolerance === 'low'  && culture.competitiveness <= 3) score += 2;
  if (student.competitionTolerance === 'low'  && culture.competitiveness >= 5) score -= 1;

  // 创意 vs 分析型偏好
  if (student.prefersCreative   && culture.creativity >= 4) score += 2;
  if (student.prefersAnalytical && culture.researchFocus >= 4) score += 2;

  // 国际化偏好
  const wantsOverseas = ['highschool_abroad', 'university_abroad', 'international_school']
    .includes(student.answers.education_path_preference);
  if (wantsOverseas && culture.internationalness >= 4) score += 1;

  return Math.min(Math.round(score), 10);
}

// 从学校已有数据推断文化画像（无需新增字段）
function inferSchoolCulture(school) {
  const c = { competitiveness: 3, creativity: 3, researchFocus: 3, internationalness: 3 };
  const tagStr = (school.tags || []).join('|').toLowerCase();
  const intro  = (school.intro || '').toLowerCase();
  const r = school.region || 'cn';

  // 竞争强度（中国顶尖大学竞争最高）
  if (r === 'cn') {
    c.competitiveness = school.tier === 1 ? 5 : school.tier === 2 ? 4 : 3;
  } else if (r === 'uk') {
    c.competitiveness = 4; c.researchFocus = 5;
  } else if (r === 'us') {
    c.competitiveness = school.tier === 1 ? 4 : 3;
    c.creativity = 5; c.internationalness = 5;
  } else if (r === 'sg') {
    c.competitiveness = 4; c.internationalness = 5;
  }

  // Tag-based overrides
  if (tagStr.includes('艺术') || tagStr.includes('创新') || intro.includes('创新')) c.creativity = 5;
  if (tagStr.includes('研究') || intro.includes('research'))                         c.researchFocus = 5;
  if (tagStr.includes('国际') || r !== 'cn')                                         c.internationalness = 5;
  if (tagStr.includes('寄宿') || tagStr.includes('boarding'))                        c.competitiveness += 1;

  return c;
}

// ══════════════════════════════════════════════
//  地理偏好匹配加分 [0-20]
//  当用户明确选择了目标地区时，匹配学校获得 +20 高权重加分；
//  不匹配学校归 0，确保偏好地区学校始终优先出现在推荐列表顶部。
//  仅 open/undecided 时给所有学校小额基础分。
// ══════════════════════════════════════════════
function calcGeoPrefBonus(school, student) {
  const geo = (student.answers || {}).geo_preference || 'open';
  const r   = school.region || 'cn';

  // 欧洲系：eu_de / eu_nl / eu_ch / eu_fr / eu_be / eu_dk / eu_se 等
  const isEuropean = r.startsWith('eu_') || r === 'eu';

  const GEO_REGIONS = {
    us:           ['us'],
    uk:           ['uk'],
    canada:       ['ca'],
    au_nz:        ['au', 'nz'],
    asia_pacific: ['sg', 'jp', 'hk', 'kr'],
    europe:       [], // 用 isEuropean 判断
    // 旧版兼容
    uk_us:        ['uk', 'us'],
    commonwealth: ['au', 'ca', 'nz'],
  };

  if (geo === 'open') {
    // 开放偏好：所有学校基础 +1，欧洲"隐藏路径"略高 +2
    return isEuropean ? 2 : 1;
  }
  if (geo === 'cn_only') return r === 'cn' ? 5 : 0;
  if (geo === 'europe')  return isEuropean ? 20 : 0;

  const targetRegions = GEO_REGIONS[geo] || [];
  // 完全匹配：+20（高权重，确保目标地区学校排在前面）
  if (targetRegions.includes(r)) return 20;
  // 国内学校：用户想出国，CN 学校地理分 0
  if (r === 'cn') return 0;
  // 其他海外地区：不匹配偏好，地理分 0（不再给默认 +1 托底）
  return 0;
}

// ══════════════════════════════════════════════
//  合并打分入口
// ══════════════════════════════════════════════
function calcScoreBreakdown(school, student) {
  return {
    academic:     calcAcademicCompatibility(school, student),
    intellectual: calcIntellectualFit(school, student),
    career:       calcCareerMajorAlignment(school, student),
    practical:    calcPracticalFeasibility(school, student),
    culture:      calcCultureFit(school, student),
    geo:          calcGeoPrefBonus(school, student),
  };
}

// ══════════════════════════════════════════════
//  硬过滤（保持原有逻辑，增加一条）
// ══════════════════════════════════════════════
function hardFilter(school, student) {
  const { education_budget, education_path_preference, geo_preference } = student.answers;

  // ① 护照限制
  if (school.passportRequired === 'foreign_only' && student.passportType === 'cn') return false;

  // ② 阶段过滤
  if (student.currentGrade === 'high' && school.type === 'highschool') return false;

  // ③ 极端预算：年总成本 > 4倍预算 → 直接剔除
  const budgetMax = {
    'under_5w':   50000,
    '5w_15w':    130000,
    '15w_30w':   250000,
    '30w_60w':   450000,
    '60w_100w':  800000,
    'over_100w': 9999999,
    'over_30w':  9999999,  // 向后兼容
  };
  const maxBudget = budgetMax[education_budget] || 999999;
  const approxCost = school.tuitionCNY
    ? school.tuitionCNY + 25000
    : school.tuitionUSD ? (school.tuitionUSD + 15000) * 7.3 : 120000;
  if (approxCost > maxBudget * 4) return false;

  // ④ 地理偏好硬过滤
  // cn_only → 仅保留中国大陆学校
  if (geo_preference === 'cn_only' && school.region !== 'cn') return false;
  // 德语学校：语言无可行性 + 不开放偏好 → 过滤掉（避免无意义推荐）
  const langReq = school.languageRequirement || 'english_only';
  const isGermanOnly = langReq === 'german_primary' && !school.englishMediumAvailable;
  if (isGermanOnly && !student.europeFeasible && geo_preference !== 'europe' && geo_preference !== 'open') {
    return false;
  }

  // ⑤ 路径明确过滤（但保留undecided和无选项）
  if (education_path_preference && education_path_preference !== 'undecided') {
    if (school.pathFit && school.pathFit.length > 0 && !school.pathFit.includes(education_path_preference)) {
      return false;
    }
  }

  return true;
}

// ══════════════════════════════════════════════
//  冲刺/目标/稳妥分层（使用修正后档位）
//  gap = 学校难度 - 学生修正档位
//  gap >= 2 → 冲刺   gap in [-1, 1] → 目标   gap < -1 → 稳妥
// ══════════════════════════════════════════════
function calcReachMatchSafety(school, academicTier) {
  const schoolDiff = DIFFICULTY_NUM[school.admissionDifficulty] || 3;
  const gap = schoolDiff - academicTier;
  if (gap >= 2)  return 'reach';
  if (gap >= -1) return 'match';
  return 'safety';
}

// ══════════════════════════════════════════════
//  丰富匹配理由（具体 + 可解释）
// ══════════════════════════════════════════════
function calcMatchReasons(school, student, breakdown) {
  const reasons = [];

  // 智能契合
  if (breakdown.intellectual >= 18 && school.miStrengths) {
    const matched = school.miStrengths.filter(m => student.topMIKeys.includes(m));
    if (matched.length > 0) {
      reasons.push(`${matched.slice(0, 2).map(m => MI_NAMES[m]).join('+')}方向契合`);
    }
  }

  // 职业方向
  if (breakdown.career >= 15) {
    const goalName = GOAL_NAMES[student.answers.goal_at_25] || '目标';
    reasons.push(`${goalName}强势项目`);
  } else if (breakdown.career >= 10 && school.goalFit) {
    reasons.push('培养方向契合');
  }

  // 学术层次
  if (breakdown.academic >= 26) {
    reasons.push('学术难度精准匹配');
  } else if (breakdown.academic >= 20) {
    reasons.push('合理挑战，努力可达');
  }

  // 奖学金
  if (school.scholarshipAvailable && student.academicTierRaw >= 4) {
    reasons.push('有资格申请奖学金');
  }

  // 推荐专业
  const topMI = student.topMIKeys[0];
  if (topMI && school.recommendedMajorsByMI && school.recommendedMajorsByMI[topMI]) {
    const major = school.recommendedMajorsByMI[topMI][0];
    if (major) reasons.push(`${major} 专业方向强`);
  }

  // 学科兴趣命中
  const subjectInterest = (student.answers || {}).subject_interest;
  if (subjectInterest && subjectInterest !== 'undecided') {
    const SUBJECT_LABEL = {
      stem:           'STEM理工',
      natural_science:'生命医学',
      business:       '商科金融',
      humanities:     '人文社科',
      arts_design:    '艺术设计',
      communication:  '传播媒体',
    };
    const SUBJECT_KWS = {
      stem:           ['计算机', '工程', '数学', '物理', '编程', '理工', 'stem', 'engineering', '人工智能'],
      natural_science:['生物', '医学', '生命', '环境', '化学', '药学'],
      business:       ['商', '金融', '管理', '经济', '创业', 'business', '会计'],
      humanities:     ['人文', '历史', '政治', '法律', '哲学', '文学', '社会'],
      arts_design:    ['艺术', '设计', '音乐', '建筑', '美术', 'art', 'design'],
      communication:  ['新闻', '传播', '营销', '媒体', '公关', '电影'],
    };
    const kws = SUBJECT_KWS[subjectInterest] || [];
    const searchStr2 = ((school.majors || []).join('|') + '|' + (school.intro || '')).toLowerCase();
    const hits = kws.filter(kw => searchStr2.includes(kw.toLowerCase())).length;
    if (hits >= 1) {
      const label = SUBJECT_LABEL[subjectInterest] || subjectInterest;
      reasons.push(`${label}专业方向覆盖`);
    }
  }

  // 地理偏好命中
  if (breakdown.geo >= 5) {
    const GEO_LABELS = {
      us: '美国', uk: '英国', canada: '加拿大', au_nz: '澳洲/新西兰',
      asia_pacific: '亚太地区', europe: '欧洲大陆',
      // 旧版兼容
      uk_us: '英美', commonwealth: '英联邦',
    };
    const geo = (student.answers || {}).geo_preference;
    if (geo && GEO_LABELS[geo]) reasons.push(`${GEO_LABELS[geo]}首选区域`);
  }

  // 隐藏路径：性价比极高 + 预算有限 → 主动提示
  if (school.hiddenGem) {
    const budgetKey = (student.answers || {}).education_budget;
    const budgetMap = {
      'under_5w': 50000, '5w_15w': 130000, '15w_30w': 250000,
      '30w_60w': 450000, '60w_100w': 800000, 'over_100w': 1500000,
    };
    const budget = budgetMap[budgetKey] || 300000;
    if (budget <= 450000) {  // 30-60w 及以下家庭 → 欧洲是真正划算的路径
      reasons.unshift('性价比极高，同等质量约节省英美60-90%费用');
    }
  }

  // 语言路径提示：德语/法语学校 + 学生有语言潜力
  if (school.languageRequirement === 'german_primary' && student.europeFeasible) {
    reasons.push('语言潜力匹配，德语路径可行');
  }

  return reasons.slice(0, 3);
}

// ══════════════════════════════════════════════
//  推荐多样性：同地区最多 N 所（避免推6所中国学校）
// ══════════════════════════════════════════════
function diversify(schools, maxCount, targetRegs, geoPref) {
  const sorted = [...schools].sort((a, b) => b.matchScore - a.matchScore);
  const regionCount = {};
  return sorted.filter(s => {
    const r = s.region || 'unknown';
    regionCount[r] = (regionCount[r] || 0) + 1;
    // 目标地区（用户偏好的国家/地区）最多展示 maxCount 所，不设额外上限
    const isTarget = targetRegs && targetRegs.length > 0 && targetRegs.includes(r);
    const isEuroTarget = geoPref === 'europe' && (r.startsWith('eu_') || r === 'eu');
    // 目标地区：上限 = maxCount（实际由 slice 控制）；其他地区：最多 2 所，避免霸屏
    const cap = (isTarget || isEuroTarget) ? maxCount : 2;
    return regionCount[r] <= cap;
  }).slice(0, maxCount);
}

// ══════════════════════════════════════════════
//  辅助函数
// ══════════════════════════════════════════════
function calcPlanningFlag(school, currentGrade) {
  if (currentGrade === 'high' || !currentGrade) return null;
  if (school.type === 'university') return { label: '📋 未来规划', color: '#6B7280', bg: '#F4F5F7' };
  return null;
}

function calcFitBadgeByScore(score) {
  if (score >= 80) return { label: '强烈推荐', color: '#2A7A5A', bg: '#E8F5EF' };
  if (score >= 65) return { label: '推荐',     color: '#1B6CA8', bg: '#EBF4FB' };
  if (score >= 50) return { label: '可考虑',   color: '#C49A22', bg: '#FBF6E8' };
  return             { label: '供参考',         color: '#6B7280', bg: '#F4F5F7' };
}

function calcFitBadge(schoolOrObj) {
  return calcFitBadgeByScore(schoolOrObj.matchScore || 0);
}

function formatTuition(school) {
  if (school.tuitionCNY === 0) return '几乎免学费（仅学期管理费）';
  if (school.tuitionCNY) {
    if (school.hiddenGem && school.region !== 'cn') {
      const total = school.tuitionCNY + (school.livingCostCNY || 80000);
      return `学费约${Math.round(school.tuitionCNY / 10000)}万+生活费${Math.round((school.livingCostCNY || 80000) / 10000)}万/年`;
    }
    return `约 ${Math.round(school.tuitionCNY / 10000)}万元/年`;
  }
  if (school.tuitionUSD) return `约 $${Math.round(school.tuitionUSD / 1000)}k/年`;
  return '费用咨询学校';
}

// 兼容旧版接口：旧版使用 academicTier 直接传入数字
function calcAcademicTier(answers, mindsetScore) {
  const raw  = ACADEMIC_TIER_MAP[answers.academicTier] || 3;
  const bias = calcBiasCorrection(answers, mindsetScore);
  return Math.max(1, Math.min(5, Math.round(raw - bias)));
}

module.exports = {
  matchSchools,
  formatTuition,
  calcFitBadge,
  calcFitBadgeByScore,
  calcReachMatchSafety,
  calcAcademicTier,
  MI_NAMES,
  GOAL_NAMES,
  REACH_META,
};
