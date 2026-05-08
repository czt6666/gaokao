// utils/match_engine.js
// 袁希™ — 顾问式分层匹配引擎 v1
// ─────────────────────────────────────────────────────────────────────
// 匹配顺序：路径 → 国家范围（约束+解释）→ 专业簇 → 学校梯度
//
// 输出梯度：
//   冲刺（reach）:   最多 2 所 — 当前条件达到概率 < 30%
//   匹配（target）:  3-5 所   — 当前条件达到概率 50-80%
//   保底（safety）:  2-3 所   — 当前条件达到概率 > 85%
//
// 设计原则：
//   ① 国家偏好是"约束"，不是"加权"：用户说英国优先，则英国占比 60-80%
//   ② 超高拒绝率院校（acceptance < 8%）不铺满推荐，最多 1 所冲刺
//   ③ 数据库不足时必须明确说明，不静默替换
//   ④ 推荐列表中每所学校都要给出理由
// ─────────────────────────────────────────────────────────────────────

// ══ 学校数据库（代表性样本，可持续扩充） ════════════════════════════
const SCHOOL_DB = [
  // ── 美国 (us) ──────────────────────────────────────────────────
  { id:'harvard',   name:'哈佛大学',      country:'us', qs_rank:4,   tier:'elite',    acceptance:0.035, ann_cny:360000, subjects:['humanities','business','law','natural_science','stem'] },
  { id:'mit',       name:'麻省理工学院',  country:'us', qs_rank:1,   tier:'elite',    acceptance:0.04,  ann_cny:380000, subjects:['stem','engineering'] },
  { id:'stanford',  name:'斯坦福大学',    country:'us', qs_rank:5,   tier:'elite',    acceptance:0.04,  ann_cny:370000, subjects:['stem','business','humanities','engineering'] },
  { id:'columbia',    name:'哥伦比亚大学',     country:'us', qs_rank:22,  tier:'strong',   acceptance:0.07,  ann_cny:340000, subjects:['humanities','business','stem','communication'] },
  { id:'umich',       name:'密歇根大学',       country:'us', qs_rank:23,  tier:'strong',   acceptance:0.20,  ann_cny:310000, subjects:['stem','business','humanities','engineering'] },
  { id:'ucb',         name:'加州大学伯克利',   country:'us', qs_rank:28,  tier:'strong',   acceptance:0.14,  ann_cny:300000, subjects:['stem','business','humanities','natural_science'] },
  { id:'northwestern',name:'西北大学',         country:'us', qs_rank:32,  tier:'strong',   acceptance:0.07,  ann_cny:350000, subjects:['stem','business','humanities','engineering'] },
  { id:'cmu',         name:'卡内基梅隆大学',   country:'us', qs_rank:65,  tier:'strong',   acceptance:0.15,  ann_cny:350000, subjects:['stem','engineering','business'] },
  { id:'usc_la',      name:'南加州大学',       country:'us', qs_rank:101, tier:'strong',   acceptance:0.13,  ann_cny:340000, subjects:['business','communication','arts_design','stem'] },
  { id:'nyu',         name:'纽约大学',         country:'us', qs_rank:58,  tier:'good',     acceptance:0.20,  ann_cny:290000, subjects:['business','arts_design','communication','humanities'] },
  { id:'purdue',      name:'普渡大学',         country:'us', qs_rank:109, tier:'good',     acceptance:0.67,  ann_cny:200000, subjects:['stem','engineering','natural_science'] },
  { id:'bu',          name:'波士顿大学',       country:'us', qs_rank:112, tier:'good',     acceptance:0.25,  ann_cny:270000, subjects:['stem','business','communication','arts_design'] },
  { id:'ohio_state',  name:'俄亥俄州立大学',   country:'us', qs_rank:171, tier:'good',     acceptance:0.57,  ann_cny:190000, subjects:['stem','business','humanities'] },
  { id:'uc_davis',    name:'加州大学戴维斯',   country:'us', qs_rank:143, tier:'good',     acceptance:0.39,  ann_cny:250000, subjects:['natural_science','stem','business'] },
  { id:'northeastern',name:'东北大学',         country:'us', qs_rank:364, tier:'good',     acceptance:0.18,  ann_cny:300000, subjects:['stem','business','communication'] },
  { id:'uarizona',    name:'亚利桑那大学',     country:'us', qs_rank:300, tier:'access',   acceptance:0.85,  ann_cny:170000, subjects:['stem','business','arts_design'] },
  { id:'asu',         name:'亚利桑那州立大学', country:'us', qs_rank:350, tier:'access',   acceptance:0.88,  ann_cny:150000, subjects:['stem','business','communication'] },

  // ── 英国 (uk) ──────────────────────────────────────────────────
  { id:'oxford',    name:'牛津大学',      country:'uk', qs_rank:3,   tier:'elite',    acceptance:0.17,  ann_cny:270000, subjects:['humanities','stem','law','natural_science'] },
  { id:'cambridge', name:'剑桥大学',      country:'uk', qs_rank:2,   tier:'elite',    acceptance:0.21,  ann_cny:270000, subjects:['stem','humanities','law','engineering'] },
  { id:'imperial',  name:'帝国理工学院',  country:'uk', qs_rank:8,   tier:'elite',    acceptance:0.14,  ann_cny:260000, subjects:['stem','engineering','business'] },
  { id:'ucl',       name:'伦敦大学学院',  country:'uk', qs_rank:9,   tier:'strong',   acceptance:0.63,  ann_cny:250000, subjects:['stem','humanities','arts_design','natural_science'] },
  { id:'lse',       name:'伦敦政治经济学院', country:'uk', qs_rank:45, tier:'strong',  acceptance:0.16,  ann_cny:230000, subjects:['business','humanities','law'] },
  { id:'edinburgh', name:'爱丁堡大学',    country:'uk', qs_rank:27,  tier:'strong',   acceptance:0.43,  ann_cny:220000, subjects:['humanities','stem','arts_design','business'] },
  { id:'manchester',name:'曼彻斯特大学',  country:'uk', qs_rank:34,  tier:'strong',   acceptance:0.50,  ann_cny:200000, subjects:['stem','business','humanities','natural_science'] },
  { id:'kcl',       name:'伦敦国王学院',  country:'uk', qs_rank:40,  tier:'strong',   acceptance:0.55,  ann_cny:220000, subjects:['law','humanities','natural_science','business'] },
  { id:'sheffield', name:'谢菲尔德大学',  country:'uk', qs_rank:105, tier:'good',     acceptance:0.65,  ann_cny:160000, subjects:['stem','humanities','arts_design','engineering'] },
  { id:'exeter',    name:'埃克塞特大学',  country:'uk', qs_rank:173, tier:'good',     acceptance:0.70,  ann_cny:150000, subjects:['business','humanities','natural_science'] },
  { id:'bath',      name:'巴斯大学',      country:'uk', qs_rank:301, tier:'access',   acceptance:0.80,  ann_cny:150000, subjects:['business','stem','arts_design'] },

  // ── 加拿大 (canada) ──────────────────────────────────────────────
  { id:'toronto',   name:'多伦多大学',    country:'canada', qs_rank:25,  tier:'strong',  acceptance:0.43, ann_cny:200000, subjects:['stem','humanities','business','law','natural_science'] },
  { id:'mcgill',    name:'麦吉尔大学',    country:'canada', qs_rank:30,  tier:'strong',  acceptance:0.37, ann_cny:180000, subjects:['stem','humanities','natural_science','law'] },
  { id:'ubc',       name:'英属哥伦比亚大学', country:'canada', qs_rank:40, tier:'strong', acceptance:0.52, ann_cny:200000, subjects:['stem','business','arts_design','natural_science'] },
  { id:'waterloo',  name:'滑铁卢大学',    country:'canada', qs_rank:154, tier:'good',    acceptance:0.53, ann_cny:180000, subjects:['stem','engineering','business'] },
  { id:'mcmaster',  name:'麦克马斯特大学', country:'canada', qs_rank:200, tier:'good',   acceptance:0.58, ann_cny:160000, subjects:['natural_science','stem','business'] },
  { id:'calgary',   name:'卡尔加里大学',  country:'canada', qs_rank:242, tier:'access',  acceptance:0.78, ann_cny:130000, subjects:['stem','business','humanities'] },

  // ── 澳洲/新西兰 (au_nz) ──────────────────────────────────────────
  { id:'melbourne', name:'墨尔本大学',    country:'au_nz', qs_rank:14,  tier:'strong',  acceptance:0.70, ann_cny:220000, subjects:['stem','business','humanities','law','natural_science'] },
  { id:'anu',       name:'澳大利亚国立大学', country:'au_nz', qs_rank:34, tier:'strong', acceptance:0.35, ann_cny:200000, subjects:['humanities','stem','law'] },
  { id:'sydney',    name:'悉尼大学',      country:'au_nz', qs_rank:19,  tier:'strong',  acceptance:0.35, ann_cny:210000, subjects:['stem','business','arts_design','law','humanities'] },
  { id:'unsw',      name:'新南威尔士大学', country:'au_nz', qs_rank:45, tier:'strong',  acceptance:0.40, ann_cny:200000, subjects:['stem','engineering','business','law'] },
  { id:'queensland',name:'昆士兰大学',    country:'au_nz', qs_rank:50,  tier:'good',    acceptance:0.65, ann_cny:180000, subjects:['stem','business','natural_science'] },
  { id:'monash',    name:'莫纳什大学',    country:'au_nz', qs_rank:57,  tier:'good',    acceptance:0.70, ann_cny:170000, subjects:['business','stem','arts_design','law'] },

  // ── 新加坡/香港 (asia_pacific) ────────────────────────────────────
  { id:'nus',       name:'新加坡国立大学', country:'asia_pacific', qs_rank:8,  tier:'elite',  acceptance:0.17, ann_cny:150000, subjects:['stem','business','humanities','law'] },
  { id:'ntu',       name:'南洋理工大学',  country:'asia_pacific', qs_rank:26, tier:'strong', acceptance:0.30, ann_cny:140000, subjects:['stem','engineering','business'] },
  { id:'hku',       name:'香港大学',      country:'asia_pacific', qs_rank:26, tier:'strong', acceptance:0.25, ann_cny:130000, subjects:['law','business','humanities','natural_science'] },
  { id:'hkust',     name:'香港科技大学',  country:'asia_pacific', qs_rank:47, tier:'strong', acceptance:0.28, ann_cny:130000, subjects:['stem','business','engineering'] },
  { id:'cuhk',      name:'香港中文大学',  country:'asia_pacific', qs_rank:56, tier:'good',   acceptance:0.35, ann_cny:120000, subjects:['business','humanities','stem'] },

  // ── 欧洲大陆 (europe) ─────────────────────────────────────────────
  { id:'eth',       name:'苏黎世联邦理工', country:'europe', qs_rank:7,   tier:'elite',  acceptance:0.27, ann_cny:80000,  subjects:['stem','engineering','natural_science'] },
  { id:'tu_delft',  name:'代尔夫特理工',  country:'europe', qs_rank:59,  tier:'good',   acceptance:0.45, ann_cny:120000, subjects:['stem','engineering','arts_design'] },
  { id:'bocconi',   name:'博科尼大学',    country:'europe', qs_rank:164, tier:'strong', acceptance:0.30, ann_cny:150000, subjects:['business'] },
  { id:'sciencespo',name:'巴黎政治学院',  country:'europe', qs_rank:260, tier:'strong', acceptance:0.35, ann_cny:180000, subjects:['humanities','law','communication','business'] },
  { id:'kopenhagen',name:'哥本哈根大学',  country:'europe', qs_rank:121, tier:'good',   acceptance:0.50, ann_cny:100000, subjects:['humanities','natural_science','stem'] },
];

// ══ 学业等级 → 可达 tier 映射 ════════════════════════════════════════
// 该映射决定"冲刺/匹配/保底"如何分配
const ACADEMIC_TIER_MAP = {
  top10:        { reach: ['elite'], target: ['strong'], safety: ['good', 'access'] },
  top30:        { reach: ['strong'], target: ['good'], safety: ['access'] },
  medium:       { reach: ['good'],  target: ['access'], safety: ['access'] },
  below_medium: { reach: ['access'], target: ['access'], safety: ['access'] },
};

// ══ 预算 → 最高可承受 ann_cny ════════════════════════════════════════
const BUDGET_MAX = {
  under10w: 100000,
  '10_20w': 200000,
  '20_40w': 350000,
  '40_80w': 700000,
  over80w:  9999999,
};

// ══ 主函数：matchSchools(cd, pathResult) ═════════════════════════════
// 返回：{ reach:[], target:[], safety:[], geoExplanation:string, resourceWarning:string|null }
function matchSchools(cd, pathResult) {
  const path     = (pathResult || {}).primaryPath || (cd.pathJudgment || {}).primaryPath;
  const sp       = cd.student_profile || {};
  const fp       = cd.family_profile  || {};
  const answers  = cd.answers || {};

  const academic = sp.academic_level || 'medium';
  const budget   = fp.annual_education_budget || '20_40w';
  const geo      = answers.geo_preference || 'open';
  const subjects = answers.subject_interest ? [answers.subject_interest] : null;

  // ── 高考路径：不推荐海外学校 ──────────────────────────────────────
  if (path === 'gaokao') {
    return {
      reach: [], target: [], safety: [],
      geoExplanation: '当前路径为高考主路径，本次不推荐海外院校。',
      resourceWarning: null,
    };
  }

  const maxBudget = BUDGET_MAX[budget] || 350000;
  const tierMap   = ACADEMIC_TIER_MAP[academic] || ACADEMIC_TIER_MAP.medium;

  // ── 步骤1：按国家约束过滤候选库 ───────────────────────────────────
  const { candidates, geoExplanation } = filterByGeo(SCHOOL_DB, geo);

  // ── 步骤2：按预算过滤 ─────────────────────────────────────────────
  const budgetFiltered = candidates.filter(s => s.ann_cny <= maxBudget);
  const budgetWarning  = budgetFiltered.length < candidates.length
    ? `${candidates.length - budgetFiltered.length} 所院校因超出年度预算上限（${maxBudget / 10000}万）已被过滤。`
    : null;

  // ── 步骤3：按专业筛选 ─────────────────────────────────────────────
  let subjectFiltered = budgetFiltered;
  if (subjects && subjects[0] !== 'undecided') {
    const withSubject = budgetFiltered.filter(s =>
      s.subjects.some(sub => subjects.includes(sub))
    );
    subjectFiltered = withSubject.length >= 5 ? withSubject : budgetFiltered;
  }

  // ── 步骤4：按学业层级分 reach/target/safety ───────────────────────
  const reachTiers  = tierMap.reach  || [];
  const targetTiers = tierMap.target || [];
  const safetyTiers = tierMap.safety || [];

  const reachPool  = subjectFiltered.filter(s => reachTiers.includes(s.tier));
  const targetPool = subjectFiltered.filter(s => targetTiers.includes(s.tier));
  const safetyPool = subjectFiltered.filter(s => safetyTiers.includes(s.tier));

  // 排序：geo 优先（用户指定国家排前），同 geo 内按 QS 排名升序
  const sortedReach  = geoSort(reachPool, geo);
  const sortedTarget = geoSort(targetPool, geo);
  const sortedSafety = geoSort(safetyPool, geo);

  // 超高拒绝率学校（acceptance < 8%）冲刺最多1所
  const reachSelected  = pickReach(sortedReach);
  const targetSelected = sortedTarget.slice(0, 5);
  const safetySelected = sortedSafety.slice(0, 3);

  // ── 资源不足提示 ──────────────────────────────────────────────────
  let resourceWarning = null;
  if (reachSelected.length === 0 && targetSelected.length < 3) {
    resourceWarning = '当前筛选条件下可推荐院校不足，已扩大范围匹配。建议与顾问进一步探讨院校选择。';
  }
  if (budgetWarning) {
    resourceWarning = (resourceWarning ? resourceWarning + '\n' : '') + budgetWarning;
  }

  // ── 为每所学校添加推荐理由 ────────────────────────────────────────
  const annotate = (school, grade) => ({
    ...school,
    grade,
    reason: buildReason(school, academic, subjects, geo),
  });

  return {
    reach:          reachSelected.map(s => annotate(s, 'reach')),
    target:         targetSelected.map(s => annotate(s, 'target')),
    safety:         safetySelected.map(s => annotate(s, 'safety')),
    geoExplanation,
    resourceWarning,
  };
}

// ── 地理约束过滤 ───────────────────────────────────────────────────────
function filterByGeo(db, geo) {
  if (geo === 'open') {
    return {
      candidates: db,
      geoExplanation: '地理偏好开放，全球院校纳入匹配范围。',
    };
  }
  if (geo === 'cn_only') {
    return { candidates: [], geoExplanation: '目标为国内路线，不纳入海外院校。' };
  }

  // 明确指定国家：该国占比 60-80%，其余为补充
  const primaryCountry = db.filter(s => s.country === geo);
  const supplementary  = db.filter(s => s.country !== geo && s.country !== 'cn_only');

  // 如果该国院校不足（< 4所），说明数据库不足，补充其他国家
  const primary = primaryCountry.length >= 4
    ? primaryCountry
    : primaryCountry; // 即使不足也保持原来

  const GEO_LABELS = {
    us: '美国', uk: '英国', canada: '加拿大',
    au_nz: '澳大利亚/新西兰', asia_pacific: '新加坡/香港',
    europe: '欧洲大陆',
  };
  const label = GEO_LABELS[geo] || geo;

  // 合并：primary 在前，supplementary 在后（供后续截取时主要用 primary）
  const candidates = [...primary, ...supplementary];

  const explanation = primaryCountry.length < 4
    ? `你首选 ${label}，但当前数据库该地区院校不足（仅 ${primaryCountry.length} 所），已补充其他地区院校作为参考。建议向专业顾问补充 ${label} 更多院校数据。`
    : `你首选 ${label}，推荐结果以 ${label} 院校为主（约占 60-80%），其余为同质量补充选项，供灵活参考。`;

  return { candidates, geoExplanation: explanation };
}

// ── 地理优先排序：primary geo 优先，同 geo 内按 QS 排名升序 ──────────────
// 解决"美国优先时出现英国学校混入 reach"的问题
function geoSort(pool, primaryGeo) {
  const byRank = (a, b) => a.qs_rank - b.qs_rank;
  if (!primaryGeo || primaryGeo === 'open') return pool.sort(byRank);
  const primary = pool.filter(s => s.country === primaryGeo).sort(byRank);
  const rest    = pool.filter(s => s.country !== primaryGeo).sort(byRank);
  return [...primary, ...rest];
}

// ── 冲刺选校：超高拒绝率最多 1 所 ────────────────────────────────────
function pickReach(pool) {
  if (pool.length === 0) return [];
  const ultraHard = pool.filter(s => s.acceptance < 0.08); // <8%
  const normal    = pool.filter(s => s.acceptance >= 0.08);
  const result    = [];
  if (ultraHard.length > 0) result.push(ultraHard[0]); // 最多1所超难
  // 总冲刺不超过2所
  const remaining = 2 - result.length;
  result.push(...normal.slice(0, remaining));
  return result;
}

// ── 为每所学校生成推荐理由 ────────────────────────────────────────────
function buildReason(school, academic, subjects, geo) {
  const parts = [];

  // 国家说明
  if (geo !== 'open' && school.country !== geo) {
    const GEO_LABELS = { us:'美国', uk:'英国', canada:'加拿大', au_nz:'澳洲', asia_pacific:'亚太', europe:'欧洲' };
    parts.push(`作为 ${GEO_LABELS[geo] || ''} 优先偏好的补充选项`);
  }

  // 专业匹配
  if (subjects && subjects[0] !== 'undecided') {
    const subjectLabels = {
      stem:'理工', natural_science:'自然科学', business:'商科',
      humanities:'人文社科', arts_design:'艺术设计', communication:'传播',
    };
    const matched = school.subjects.filter(s => subjects.includes(s));
    if (matched.length > 0) {
      parts.push(`${subjectLabels[matched[0]] || matched[0]}方向有实力`);
    }
  }

  // 录取难度
  const acc = (school.acceptance * 100).toFixed(0);
  if (school.tier === 'elite') parts.push(`顶级学术声誉（录取率约 ${acc}%）`);
  else if (school.tier === 'strong') parts.push(`综合实力强劲（录取率约 ${acc}%）`);
  else parts.push(`录取相对可行（录取率约 ${acc}%）`);

  return parts.join('，') || '综合条件匹配';
}

// ══ 将匹配结果格式化为 prompt 注入文本 ══════════════════════════════
function buildMatchText(matchResult) {
  if (!matchResult) return '';
  const lines = ['## 分层院校匹配结果（请在报告中引用，不要自行另外推荐院校）'];

  if (matchResult.geoExplanation) {
    lines.push(`\n地理说明：${matchResult.geoExplanation}`);
  }

  const format = (school) =>
    `  - ${school.name}（QS #${school.qs_rank}，录取率 ${(school.acceptance*100).toFixed(0)}%，年费约${(school.ann_cny/10000).toFixed(0)}万）：${school.reason}`;

  if ((matchResult.reach || []).length > 0) {
    lines.push('\n【冲刺（reach）】');
    matchResult.reach.forEach(s => lines.push(format(s)));
  }
  if ((matchResult.target || []).length > 0) {
    lines.push('\n【匹配（target）】');
    matchResult.target.forEach(s => lines.push(format(s)));
  }
  if ((matchResult.safety || []).length > 0) {
    lines.push('\n【保底（safety）】');
    matchResult.safety.forEach(s => lines.push(format(s)));
  }
  if (matchResult.resourceWarning) {
    lines.push(`\n⚠️ 资源提示：${matchResult.resourceWarning}`);
  }

  lines.push('\n铁律：报告中的院校推荐必须严格来自以上列表，不能自行添加或替换。若认为列表不足，请在"关键变量提示"中说明需要补充数据。');

  return lines.join('\n');
}

module.exports = { matchSchools, buildMatchText, SCHOOL_DB };
