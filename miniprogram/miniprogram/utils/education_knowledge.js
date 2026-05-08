// utils/education_knowledge.js  v2.0
// 战略成长™ 核心知识库 — 语义增强检索引擎
//
// v2.0 升级内容：
//   - 每个知识块新增 intentTags / questionPatterns / semanticConcepts 三层语义信号
//   - 检索算法升级：问题模式匹配(×20) + 意图标签(×15) + 语义概念(×8) + 关键词(×10)
//   - 新增 detectIntents() 查询意图分类器
//   - 新增 diverseRetrieve() 多样性检索（避免返回同类块）
//
// 每个知识块字段说明：
//   id               唯一标识
//   title            标题
//   category         类别（用于多样性过滤）
//   intentTags       用户意图标签（来自 INTENT_TYPES）
//   questionPatterns 常见问题的正则模式（命中 ×20）
//   semanticConcepts 语义概念词（命中 ×8，比关键词更宽泛）
//   tags             精确关键词（命中 ×10，保留兼容）
//   pathMatch        适用教育路径
//   gradeMatch       适用学段
//   miBoost          对哪些 MI 维度高分孩子特别相关
//   priority         基础优先级（1-5）
//   content          注入 AI 提示词的知识内容

// ══════════════════════════════════════════════════════
//  意图分类系统
// ══════════════════════════════════════════════════════

const INTENT_TYPES = {
  TIMING:         'timing',         // 什么时候、几年级、时机
  COMPARISON:     'comparison',     // 哪个好、对比、选哪个
  CAREER:         'career',         // 就业、职业、收入
  COST:           'cost',           // 费用、预算、学费
  ADMISSION:      'admission',      // 录取、申请、进入
  MAJOR:          'major',          // 专业、方向、学什么
  SCHOOL_CHOICE:  'school_choice',  // 选学校
  PATH_DECISION:  'path_decision',  // 走哪条路、高考 vs 出国
  MI_STRATEGY:    'mi_strategy',    // 孩子特点与适配策略
  PARENT_CONCERN: 'parent_concern', // 家长担心、不知道怎么做
  ACTION_NOW:     'action_now',     // 具体行动、下一步、现在做什么
  PSYCHOLOGY:     'psychology',     // 孩子状态、心理、动力
};

/**
 * 查询意图分类器
 * 从用户问题中识别一个或多个意图标签
 */
function detectIntents(question) {
  const q = question;
  const intents = [];

  if (/什么时候|几年级|几岁|早.*还是.*晚|何时|时机|时间.*规划|窗口/.test(q))
    intents.push(INTENT_TYPES.TIMING);

  if (/哪个.*好|还是.*选|对比|区别|vs|比较|选.*还是|两个|两种/.test(q))
    intents.push(INTENT_TYPES.COMPARISON);

  if (/就业|工作|赚钱|薪|收入|职业|行业|出路|前景|毕业.*做/.test(q))
    intents.push(INTENT_TYPES.CAREER);

  if (/钱|费用|预算|学费|多少.*花|成本|性价比|省钱|奖学金|贵不贵/.test(q))
    intents.push(INTENT_TYPES.COST);

  if (/录取|申请|怎么进|机会|概率|通过率|面试|考试|入学/.test(q))
    intents.push(INTENT_TYPES.ADMISSION);

  if (/专业|学什么|方向|填志愿|选专业|读什么|什么领域/.test(q))
    intents.push(INTENT_TYPES.MAJOR);

  if (/哪所学校|选学校|推荐.*学校|哪个大学|上哪个学校/.test(q))
    intents.push(INTENT_TYPES.SCHOOL_CHOICE);

  if (/高考.*出国|出国.*高考|走.*路|哪条路|路线怎么选|要不要出国/.test(q))
    intents.push(INTENT_TYPES.PATH_DECISION);

  if (/孩子.*特点|智能|优势|擅长|适合|性格|孩子.*类型|根据孩子/.test(q))
    intents.push(INTENT_TYPES.MI_STRATEGY);

  if (/家长|父母|我们.*怎么|担心|焦虑|不知道|该怎么做|我该/.test(q))
    intents.push(INTENT_TYPES.PARENT_CONCERN);

  if (/现在|下一步|接下来|具体|怎么做|行动|马上|从哪里开始|第一步/.test(q))
    intents.push(INTENT_TYPES.ACTION_NOW);

  if (/心理|状态|压力|动力|积极性|愿不愿|厌学|开心|情绪|内驱/.test(q))
    intents.push(INTENT_TYPES.PSYCHOLOGY);

  return intents;
}

// ══════════════════════════════════════════════════════
//  知识块库
// ══════════════════════════════════════════════════════

const KNOWLEDGE_CHUNKS = [

  // ──────────────────────────────────────────────────
  //  路径决策 — 高考路线
  // ──────────────────────────────────────────────────

  {
    id: 'k_gaokao_timeline',
    title: '高考路线真实时间线与关键窗口',
    category: 'gaokao_path',
    intentTags: [INTENT_TYPES.TIMING, INTENT_TYPES.ACTION_NOW, INTENT_TYPES.PATH_DECISION],
    questionPatterns: [
      /什么时候.*开始.*高考/,
      /高考.*怎么规划/,
      /几年级.*准备.*高考/,
      /高考.*时间线/,
      /初中.*高考.*布局/,
      /高考路线.*关键/,
    ],
    semanticConcepts: ['时机', '节点', '阶段', '窗口期', '赛道', '选科', '布局', '竞赛'],
    tags: ['高考', '时间线', '规划', '路径', '什么时候', '几年级', '准备'],
    pathMatch: ['gaokao'],
    gradeMatch: ['middle', 'high', 'all'],
    miBoost: [],
    priority: 5,
    content: `【高考路线关键窗口期】
初三（中考前）：选高中=选赛道。省重点/实验班 vs 普通高中，直接决定高考基准位。这是第一个不可逆决定。
高一-高二上：课内成绩打基础，同时布局"第二赛道"——竞赛（数学/物理/化学/生物）、学科特长、社会实践，这些影响强基计划和综合评价录取。
高二下：选科定方向（新高考省份）。物理方向 vs 历史方向影响可报专业范围，选错代价极高。
高三：纯备考，策略空间很小。
核心判断：高考路线的竞争烈度持续上升，"只靠分数"赢的时代正在收窄，综合素质+特定特长的组合打法开始出现溢价。`,
  },

  {
    id: 'k_gaokao_jiangji',
    title: '强基计划与综合评价录取真相',
    category: 'gaokao_path',
    intentTags: [INTENT_TYPES.ADMISSION, INTENT_TYPES.COMPARISON, INTENT_TYPES.SCHOOL_CHOICE],
    questionPatterns: [
      /强基.*怎么.*申请/,
      /强基计划.*适合/,
      /竞赛.*有没有用/,
      /综合评价.*录取/,
      /破格.*入围/,
      /985.*特殊通道/,
    ],
    semanticConcepts: ['破格', '入围', '特长', '拔尖', '基础学科', '竞赛', '校测', '面试'],
    tags: ['强基', '综合评价', '竞赛', '特长', '985', '破格'],
    pathMatch: ['gaokao'],
    gradeMatch: ['middle', 'high', 'all'],
    miBoost: ['logical', 'naturalist'],
    priority: 4,
    content: `【强基计划与综合评价：真实门槛】
强基计划：39所高校参与，招收"基础学科拔尖人才"。实际要求：高考成绩达本校录取线85%分位 + 高校校测（笔试+面试）过关。竞赛获奖（省级二等奖以上）可破格入围。不适合"均衡型"学生，适合某一学科有极致热情的孩子。
综合评价（部分省市）：高考成绩60%+学业水平测试20%+综合素质评价20%，入围后参加高校考核。对综合能力要求高，适合成绩中等偏上+多维能力突出的孩子。
关键误区：强基≠容易进名校，入围率通常在5-15%之间，竞争并不比裸分容易。`,
  },

  {
    id: 'k_gaokao_major',
    title: '高考路线专业选择策略',
    category: 'major_career',
    intentTags: [INTENT_TYPES.MAJOR, INTENT_TYPES.CAREER, INTENT_TYPES.ACTION_NOW],
    questionPatterns: [
      /选什么专业/,
      /填什么志愿/,
      /学.*专业.*就业/,
      /专业.*哪个.*好/,
      /高考.*学什么/,
      /未来.*读.*专业/,
      /孩子.*适合.*什么.*专业/,
    ],
    semanticConcepts: ['志愿', '方向', '就业', '前景', '赛道', '热门', '填报', '专业匹配'],
    tags: ['专业', '选专业', '填志愿', '就业', '学什么'],
    pathMatch: ['gaokao'],
    gradeMatch: ['high', 'all'],
    miBoost: [],
    priority: 4,
    content: `【高考志愿填报核心逻辑】
常见误区：先选学校再看专业。正确顺序：先确定职业方向→找对应专业→找开设该专业的院校。
新兴高价值专业方向（2024-2030年窗口）：计算机+X复合（AI、生物信息、金融科技）、半导体/集成电路、新能源材料、临床医学（含口腔）。
传统选择的风险：纯金融、法学、新闻传媒类在本科层面就业竞争激烈，需要名校背书+研究生学历才有优势。
给家长的建议：避免"热门=好"的逻辑，看的是10年后的就业结构，而非当下招聘市场。`,
  },

  // ──────────────────────────────────────────────────
  //  路径决策 — 国际/出国路线
  // ──────────────────────────────────────────────────

  {
    id: 'k_intl_timing',
    title: '出国留学时机选择：高中 vs 本科',
    category: 'intl_path',
    intentTags: [INTENT_TYPES.TIMING, INTENT_TYPES.COMPARISON, INTENT_TYPES.PATH_DECISION],
    questionPatterns: [
      /什么时候.*出国/,
      /几年级.*出国/,
      /高中出国.*还是.*大学/,
      /出国.*早.*好.*晚/,
      /留学.*时机/,
      /要不要高中就出去/,
    ],
    semanticConcepts: ['时机', '适龄', '语言融入', '心理成熟', '自律', '风险', '成本'],
    tags: ['出国', '留学', '几年级', '什么时候', '高中出国', '本科出国', '时机'],
    pathMatch: ['highschool_abroad', 'university_abroad', 'all'],
    gradeMatch: ['middle', 'high', 'all'],
    miBoost: [],
    priority: 5,
    content: `【出国时机的真实权衡】
高中出国（14-16岁）：优势——语言和文化融入更彻底，申请美国顶尖大学竞争力更强（有本地高中背景加分）。风险——孩子心理成熟度要求高，家长"看不见"的4年需要孩子有强自律和内驱力，失败率（退学/转学/心理问题）在未做好准备的情况下约15-25%。
本科直接出国（18岁）：优势——有国内高中完整基础，心理更成熟，中文思维更完整。风险——语言适应要多花1年，融入感相对浅。
判断标准：孩子的自我认知智能（Intrapersonal MI）得分是关键变量。自律性强+情绪管理好→适合高中出国；依赖性强+需要结构性环境→建议本科出国。`,
  },

  {
    id: 'k_us_admission',
    title: '美国大学申请真实逻辑（2024-2025）',
    category: 'intl_path',
    intentTags: [INTENT_TYPES.ADMISSION, INTENT_TYPES.SCHOOL_CHOICE, INTENT_TYPES.ACTION_NOW],
    questionPatterns: [
      /美国.*大学.*申请/,
      /申请.*藤校/,
      /common app.*怎么/,
      /美国.*怎么.*录取/,
      /文书.*怎么写/,
      /SAT.*重要吗/,
      /美国.*课外活动/,
    ],
    semanticConcepts: ['文书', '活动', '标化', '差异化', 'GPA', '录取官', '深度', '竞争'],
    tags: ['美国', '申请', '藤校', 'common app', '标化', 'SAT', '文书', '活动'],
    pathMatch: ['highschool_abroad', 'university_abroad'],
    gradeMatch: ['middle', 'high', 'all'],
    miBoost: [],
    priority: 4,
    content: `【美国大学申请：录取官真正看什么】
标化成绩：SAT/ACT已被大多数学校改为Test-Optional，但TOP30学校递交高分依然有优势（SAT 1500+有帮助）。
课外活动：质量>>数量。1-2个有深度、有故事的长期活动，比10个浅尝辄止的活动价值高10倍。
文书：是整个申请中最能拉开差距的部分。好文书的标准：真实、具体、有独特视角。AI写的文书录取官能识别，后果是直接拒。
GPA：非美高学生的GPA换算方式复杂，中国学生通常需要90分以上（满分100）才相当于美国高中的3.9+。
Chinese applicant特殊挑战：中国学生竞争极为激烈，同质化申请材料是最大风险。差异化是关键词。`,
  },

  {
    id: 'k_uk_admission',
    title: '英国大学申请逻辑（UCAS体系）',
    category: 'intl_path',
    intentTags: [INTENT_TYPES.ADMISSION, INTENT_TYPES.COMPARISON, INTENT_TYPES.SCHOOL_CHOICE],
    questionPatterns: [
      /英国.*申请/,
      /ucas.*怎么/,
      /牛津.*剑桥.*怎么考/,
      /英国.*大学.*录取/,
      /a-level.*申请.*大学/,
      /个人陈述.*英国/,
    ],
    semanticConcepts: ['UCAS', '个人陈述', '学术热情', '面试', 'A-Level', '硬门槛', '精选'],
    tags: ['英国', 'ucas', '申请', 'a-level', '个人陈述', '牛津', '剑桥', '医学'],
    pathMatch: ['highschool_abroad', 'university_abroad'],
    gradeMatch: ['high', 'all'],
    miBoost: ['linguistic', 'logical'],
    priority: 3,
    content: `【英国大学申请核心逻辑】
UCAS最多填5所，选校策略要精准（不像美国可以广撒网）。
A-Level成绩是硬门槛：G5（牛津剑桥+伦敦三校）要求A*AA至A*A*A不等，没有条件不建议申G5。
个人陈述（Personal Statement）：英国PS是学术导向，要展示"为什么对这个学科有热情"，需要引用具体书目、研究、思考过程。
Oxbridge特殊性：需要参加额外入学考试（MAT/LNAT/BMAT等）+面试，面试考的是"在压力下的实时推理能力"，不是背了多少知识。
优势：3年学制费用比美国4年低，就业认可度在英联邦国家极高。`,
  },

  {
    id: 'k_sg_hk_option',
    title: '新加坡/香港路线：被低估的选项',
    category: 'intl_path',
    intentTags: [INTENT_TYPES.SCHOOL_CHOICE, INTENT_TYPES.COMPARISON, INTENT_TYPES.COST],
    questionPatterns: [
      /新加坡.*大学/,
      /香港.*大学/,
      /NUS.*NTU/,
      /亚洲.*出国/,
      /去.*新加坡.*香港/,
      /港大.*怎么样/,
    ],
    semanticConcepts: ['性价比', '亚洲就业', '华人环境', '奖学金', '认可度', '语言适应'],
    tags: ['新加坡', '香港', '南洋', 'NUS', 'NTU', 'HKU', '亚洲'],
    pathMatch: ['university_abroad', 'highschool_abroad'],
    gradeMatch: ['middle', 'high', 'all'],
    miBoost: [],
    priority: 3,
    content: `【新加坡/香港：性价比最高的顶尖选项】
NUS/NTU（新加坡）：QS全球前15，亚洲就业市场认可度极高，学费约14-18万人民币/年（含奖学金可更低），英文授课。录取竞争激烈但可预测（成绩导向，不需要像美国一样靠"故事"）。
港大/港中文/港科大：返回内地就业认可度近年回升，部分专业（商科/金融/法律）在内地一线城市与国内顶尖985相当。学费约18-22万/年。
适合人群：希望有国际视野+亚洲就业市场+中文生活圈的家庭。不适合：想最终在欧美发展的孩子（品牌在欧美不够响）。
关键优势：文化适应成本极低，华人比例高，家长更放心。`,
  },

  // ──────────────────────────────────────────────────
  //  课程体系对比
  // ──────────────────────────────────────────────────

  {
    id: 'k_ib_vs_alevel',
    title: 'IB vs A-Level：应该选哪个？',
    category: 'curriculum',
    intentTags: [INTENT_TYPES.COMPARISON, INTENT_TYPES.SCHOOL_CHOICE, INTENT_TYPES.MI_STRATEGY],
    questionPatterns: [
      /IB.*A.?level.*哪个/,
      /选.*IB.*还是/,
      /A.?level.*好.*IB/,
      /国际学校.*课程/,
      /IB.*适合.*孩子/,
      /课程.*怎么选/,
    ],
    semanticConcepts: ['广度', '深度', '均衡', '专注', '课业量', '全科', '压力', '偏科'],
    tags: ['IB', 'A-level', '课程', '国际学校', '哪个好', '选择'],
    pathMatch: ['international_school', 'highschool_abroad', 'university_abroad'],
    gradeMatch: ['middle', 'high', 'all'],
    miBoost: [],
    priority: 4,
    content: `【IB vs A-Level 真实对比】
IB（国际文凭）：要求广度，6门课+ToK+EE+CAS，总分45分。适合：全科均衡、喜欢探究、有较强时间管理能力的孩子。风险：课业量极重，某一科短板会拖累整体GPA。
A-Level：专注3-4门，深度优先。适合：有明确学科热情、擅长某几个领域的孩子。申请英国/新加坡的首选。
选择建议：如果孩子有1-2门极突出学科+其他科目中等 → A-Level。如果孩子各科均衡+适应多任务压力 → IB。
重要：IB学校在中国收费通常比A-Level学校高20-30%，但申请美国大学时IB更受认可。`,
  },

  {
    id: 'k_ap_curriculum',
    title: 'AP课程：在国内高中走AP路线',
    category: 'curriculum',
    intentTags: [INTENT_TYPES.ADMISSION, INTENT_TYPES.ACTION_NOW, INTENT_TYPES.COMPARISON],
    questionPatterns: [
      /AP.*课程.*怎么选/,
      /AP.*有没有用/,
      /国内.*高中.*美国.*大学/,
      /先修课.*大学学分/,
      /AP.*几门/,
    ],
    semanticConcepts: ['先修课', '大学学分', '证明能力', '国内高中', '考试', '刷分'],
    tags: ['AP', '课程', '国内', '美国大学', '先修课', '大学学分'],
    pathMatch: ['university_abroad'],
    gradeMatch: ['high', 'all'],
    miBoost: ['logical', 'linguistic'],
    priority: 3,
    content: `【AP课程的真实价值与风险】
AP（Advanced Placement）是在国内高中期间修美国大学预修课程并参加考试，4-5分可在大学换学分。
实际作用：① 证明"有能力完成大学难度课程" ② 部分学校认可换学分减少修课年数。
中国学生的AP策略：选择与强项MI相符的AP科目，比全面铺开更有效。数学/科学MI强的孩子选AP Calculus BC/Physics C；语言MI强的选AP English Language/Literature。
数量建议：5-7门AP是合理范围。超过10门以上、每门只求4分，不如选5门认真备考拿5分。
注意：AP考试在中国的考场较少，需提前1年预约。`,
  },

  // ──────────────────────────────────────────────────
  //  多元智能 × 路径匹配
  // ──────────────────────────────────────────────────

  {
    id: 'k_mi_linguistic',
    title: '语言智能突出孩子的路径策略',
    category: 'mi_strategy',
    intentTags: [INTENT_TYPES.MI_STRATEGY, INTENT_TYPES.CAREER, INTENT_TYPES.MAJOR],
    questionPatterns: [
      /孩子.*语言.*强/,
      /擅长.*写作.*读书/,
      /语言智能.*适合/,
      /喜欢.*阅读.*表达/,
      /文科.*孩子.*未来/,
      /语言.*孩子.*方向/,
    ],
    semanticConcepts: ['表达', '写作', '阅读', '故事化', '文科', '语言优势', '沟通', '叙述'],
    tags: ['语言', '写作', '阅读', '表达', '文学', '传媒', '法律'],
    pathMatch: ['all'],
    gradeMatch: ['all'],
    miBoost: ['linguistic'],
    priority: 4,
    content: `【语言MI高分孩子：真正的优势与适合方向】
语言智能突出意味着：学习效率依赖阅读和表达，记忆通过故事化更有效，在需要写作和演讲的环境中如鱼得水。
高价值方向（10年视角）：法律（尤其国际法/知识产权）、传媒与内容（但需要有平台）、教育（高端教培/国际化教育）、公共政策/外交、高端销售与咨询。
容易踩的坑：纯文学/纯新闻专业就业面窄，语言智能优势要和一个"硬领域"结合才有竞争力（例如：语言+法律=国际仲裁，语言+商业=战略咨询）。
在不同路径中的表现：国际路线中文书写作优势明显；高考路线在语文/外语科目有先天优势。`,
  },

  {
    id: 'k_mi_logical',
    title: '逻辑-数学智能突出孩子的路径策略',
    category: 'mi_strategy',
    intentTags: [INTENT_TYPES.MI_STRATEGY, INTENT_TYPES.CAREER, INTENT_TYPES.MAJOR],
    questionPatterns: [
      /孩子.*数学.*好/,
      /逻辑.*强.*孩子/,
      /理科.*孩子.*未来/,
      /数学.*智能.*适合/,
      /孩子.*喜欢.*编程.*数学/,
      /STEM.*孩子/,
    ],
    semanticConcepts: ['规律', '抽象', '系统化', '竞赛', '理工', '数学思维', '工程', '计算'],
    tags: ['逻辑', '数学', '编程', '理科', '竞赛', '工程', 'STEM'],
    pathMatch: ['all'],
    gradeMatch: ['all'],
    miBoost: ['logical'],
    priority: 4,
    content: `【逻辑-数学MI高分孩子：竞争优势在哪里】
逻辑MI突出意味着：喜欢找规律、对抽象概念接受快、面对开放性问题时倾向系统化拆解。
高价值方向：计算机科学/AI、量化金融、精算、工程类（电子/机械/化学工程）、数学本身（学术+工业界两条路）。
竞争优势放大器：数学竞赛（联赛/CMO级别）是进顶尖大学最有含金量的单一活动，数学MI高的孩子值得从初一就系统投入。
高考路线：理科高考有天然优势，适合冲击C9/985理工院校。
国际路线：STEM领域是全球顶尖大学录取中国学生最多的方向，竞争激烈但赛道宽。关键是要有"做过真实项目"的经历（实验室、竞赛成绩），而不只是高分。`,
  },

  {
    id: 'k_mi_interpersonal',
    title: '人际智能突出孩子的路径策略',
    category: 'mi_strategy',
    intentTags: [INTENT_TYPES.MI_STRATEGY, INTENT_TYPES.SCHOOL_CHOICE, INTENT_TYPES.MAJOR],
    questionPatterns: [
      /孩子.*人际.*强/,
      /擅长.*社交.*团队/,
      /喜欢.*跟人.*交流/,
      /领导力.*孩子/,
      /人际智能.*适合/,
      /孩子.*很会.*交朋友/,
    ],
    semanticConcepts: ['领导力', '社群', '协作', '团队', '沟通', '人际关系', '商科', '影响力'],
    tags: ['人际', '领导力', '社交', '团队', '商业', '管理'],
    pathMatch: ['all'],
    gradeMatch: ['all'],
    miBoost: ['interpersonal'],
    priority: 3,
    content: `【人际MI高分孩子：学校选择的关键维度】
人际MI突出的孩子在高度协作的环境中学习效率最高，独立学习/纯刷题环境会严重压制其优势。
最需要主动寻找的机会：学生会/社团领导职位、辩论/模拟联合国、创业类竞赛、社会实践项目。这些活动在申请国际大学时的含金量远高于学科竞赛。
高价值方向：商科（尤其战略管理/市场营销）、医疗/公共卫生（需要患者沟通）、教育、政治与公共政策。
选校建议：文化活跃、课外活动丰富的学校比纯学术导向的学校更适合人际MI高的孩子。走国际路线时，美国Liberal Arts College是特别好的选项（小班制，强社群）。`,
  },

  {
    id: 'k_mi_bodily',
    title: '身体-运动智能突出孩子的路径策略',
    category: 'mi_strategy',
    intentTags: [INTENT_TYPES.MI_STRATEGY, INTENT_TYPES.CAREER, INTENT_TYPES.PATH_DECISION],
    questionPatterns: [
      /孩子.*运动.*好/,
      /体育.*孩子.*未来/,
      /动手.*能力.*强/,
      /孩子.*不喜欢.*坐着/,
      /身体运动.*智能/,
      /体育.*高考/,
    ],
    semanticConcepts: ['动手', '实践', '运动', '体育特招', '运动医学', '表演', '身体感知'],
    tags: ['运动', '体育', '动手', '实践', '艺术', '表演'],
    pathMatch: ['all'],
    gradeMatch: ['all'],
    miBoost: ['bodily'],
    priority: 3,
    content: `【身体-运动MI高分孩子：容易被误判的类型】
最大误区：很多家长把身体-运动MI高的孩子当成"学习能力差"——这是严重的错误归因。这类孩子只是需要"动起来"才能真正学进去。
真实优势领域：体育专业（体育管理/运动医学/运动科学，就业前景好于传统认知）、医学/外科（动手能力强）、建筑/工程设计（空间感好）、表演艺术。
高考特殊路径：体育高考生进入985/211的分数线显著低于普通生，且职业发展路径清晰。如果孩子有真实体育专长，这是值得严肃考虑的赛道。
国际路线：美国大学的体育特招（Athletic Scholarship）对能代表大学参加NCAA赛事的学生有极大优惠，但竞争标准也高。`,
  },

  {
    id: 'k_mi_intrapersonal',
    title: '自我认知智能突出孩子的路径策略',
    category: 'mi_strategy',
    intentTags: [INTENT_TYPES.MI_STRATEGY, INTENT_TYPES.SCHOOL_CHOICE, INTENT_TYPES.PSYCHOLOGY],
    questionPatterns: [
      /孩子.*独立.*强/,
      /自我认知.*智能/,
      /孩子.*有主见/,
      /内省.*孩子/,
      /孩子.*不喜欢.*竞争/,
      /自驱力.*强.*孩子/,
    ],
    semanticConcepts: ['内驱力', '价值观', '自主', '内省', '创业', '独立性', '自我叙述', '深度'],
    tags: ['自我认知', '内省', '独立', '心理', '创业', '写作'],
    pathMatch: ['all'],
    gradeMatch: ['all'],
    miBoost: ['intrapersonal'],
    priority: 3,
    content: `【自我认知MI高分孩子：独特优势与风险】
自我认知MI高意味着：有强烈的内在驱动力和价值观，不容易被群体压力左右，在有自主空间的环境中表现最好。
天然优势：国际路线的文书写作（能写出真实、有深度的自我叙述）、创业（有清晰自我认知是创始人核心素质）、学术研究（能坚持在没有即时反馈的长周期工作中）。
风险：在高度竞争/高度结构化的应试环境（如纯高考赛道）中可能感到窒息，容易出现动力问题。
选校建议：避免极度竞争文化浓厚的学校，寻找尊重个体差异的学校环境。PBL（项目式学习）或苏格拉底教学法的学校是最好的匹配。`,
  },

  {
    id: 'k_mi_spatial',
    title: '空间智能突出孩子的路径策略',
    category: 'mi_strategy',
    intentTags: [INTENT_TYPES.MI_STRATEGY, INTENT_TYPES.MAJOR, INTENT_TYPES.CAREER],
    questionPatterns: [
      /孩子.*空间.*好/,
      /视觉.*思维.*孩子/,
      /喜欢.*设计|喜欢.*画画|喜欢.*画/,
      /空间智能.*适合/,
      /孩子.*艺术.*感.*强/,
      /建筑.*设计.*孩子/,
      /孩子.*美术|美术.*孩子.*方向/,
      /画画.*能.*做什么/,
      /孩子.*喜欢.*艺术/,
    ],
    semanticConcepts: ['视觉化', '设计', '建筑', '空间想象', '模型', '艺术联考', '图形', '画画', '美术', '绘画', '艺术'],
    tags: ['空间', '视觉', '设计', '艺术', '建筑', '工程', '画画', '美术'],
    pathMatch: ['all'],
    gradeMatch: ['all'],
    miBoost: ['spatial'],
    priority: 3,
    content: `【空间MI高分孩子：高价值但被低估的智能】
空间MI强的孩子思维是视觉化的，天然擅长：图形化记忆、模型构建、空间想象、设计思维。
高价值方向：建筑设计（国内外就业面广）、工业/产品设计（Apple、华为设计部门薪酬顶尖）、影视/游戏艺术设计、医学影像、计算机图形学/VR/AR。
容易被忽视的路径：医学影像科医生（需要极强空间感，AI时代需求反而在上升）。
高考路线：艺术联考（美术/设计类）+文化课，进入顶尖艺术院校（央美/国美/清华美院）或综合院校设计学院。分数要求比理工科低，但艺术联考竞争同样激烈，需要从初中开始系统训练。`,
  },

  // ──────────────────────────────────────────────────
  //  预算与学费真相
  // ──────────────────────────────────────────────────

  {
    id: 'k_budget_truth',
    title: '教育投入的真实成本结构',
    category: 'cost',
    intentTags: [INTENT_TYPES.COST, INTENT_TYPES.COMPARISON, INTENT_TYPES.PATH_DECISION],
    questionPatterns: [
      /要.*花.*多少.*钱/,
      /出国.*费用.*多少/,
      /国际学校.*学费/,
      /教育.*成本/,
      /总共.*要.*多少/,
      /预算.*够不够/,
      /高考.*vs.*出国.*钱/,
    ],
    semanticConcepts: ['总成本', '年花销', '性价比', '回报率', '资金规划', '匹配度'],
    tags: ['费用', '学费', '预算', '多少钱', '成本', '性价比'],
    pathMatch: ['all'],
    gradeMatch: ['all'],
    miBoost: [],
    priority: 4,
    content: `【教育总成本的真实结构（2024数据）】
国际学校（国内）：学费15-35万/年，加上配套培训（语言班/竞赛/夏令营），实际总支出20-50万/年。
高中出国（美国）：学费+住宿约30-45万美元/4年，折合人民币约220-320万，加上机票/零花/假期回国，总计约250-350万。
本科出国（美国）：同上，4年约220-320万人民币。
英国：3年约100-150万人民币。新加坡/香港：4年约70-100万人民币。
高考路线：4年985大学约10-15万人民币（含住宿），即使加上高中培训班，总投入约30-60万，是国际路线的1/10-1/5。
关键思考：高投入≠高回报。关键是匹配度，而非绝对金额。`,
  },

  {
    id: 'k_scholarship',
    title: '奖学金与助学金：哪些可以拿到',
    category: 'cost',
    intentTags: [INTENT_TYPES.COST, INTENT_TYPES.ADMISSION, INTENT_TYPES.SCHOOL_CHOICE],
    questionPatterns: [
      /奖学金.*怎么申请/,
      /有没有.*奖学金/,
      /学费.*能不能.*减免/,
      /新加坡.*奖学金/,
      /哈佛.*助学金/,
      /出国.*省钱/,
    ],
    semanticConcepts: ['减免', '资助', 'Need-Based', 'Merit', '全额', '工作年限', '财务证明'],
    tags: ['奖学金', '助学金', '减免', '省钱', '费用'],
    pathMatch: ['highschool_abroad', 'university_abroad'],
    gradeMatch: ['all'],
    miBoost: [],
    priority: 3,
    content: `【海外奖学金的真实情况】
美国Need-Based Aid：普林斯顿/哈佛/耶鲁等对国际学生也开放Need-Based奖学金，家庭年收入低于特定额度可申请，实际减免可达学费的50-100%。但中国家庭申请时需提交财务证明，审核严格。
Merit Scholarship：以学术成就为基础，部分学校对优秀国际学生提供，但TOP30学校几乎不给Merit奖。T50以下的学校反而奖学金更好谈。
英国：谢菲尔德等学校对国际生有成绩奖学金，约1-3万英镑/年减免。
新加坡：NUS/NTU对成绩优秀的国际生有全额奖学金（含住宿），但毕业后需在新加坡工作3年。这是中国家庭最值得关注的选项之一。
寄宿高中：10-15%的学校提供Need-Based Aid，与家庭收入挂钩，极少有纯Merit奖。`,
  },

  // ──────────────────────────────────────────────────
  //  家长认知升级
  // ──────────────────────────────────────────────────

  {
    id: 'k_parent_bias_rank',
    title: '排名崇拜：最常见的家长误区',
    category: 'parent_mindset',
    intentTags: [INTENT_TYPES.PARENT_CONCERN, INTENT_TYPES.SCHOOL_CHOICE, INTENT_TYPES.COMPARISON],
    questionPatterns: [
      /排名.*重要吗/,
      /一定要.*名校吗/,
      /985.*211.*必须/,
      /藤校.*才算.*好/,
      /排名.*越高.*越好/,
      /学校.*排名.*怎么看/,
    ],
    semanticConcepts: ['排名迷信', '品牌', '声誉', '匹配度', '真实价值', '文理学院', '一维信息'],
    tags: ['排名', '名校', '985', '藤校', '误区', '迷信'],
    pathMatch: ['all'],
    gradeMatch: ['all'],
    miBoost: [],
    priority: 5,
    content: `【排名崇拜：为什么它是决策的最大敌人】
QS/THE/US News排名衡量的是学校的科研产出和学术声誉，与"你孩子在这里能发展好"的相关性低于大多数家长认为的程度。
真实的匹配维度：①教学风格是否与孩子学习方式匹配 ②专业强度（同一所学校不同专业差异可达10个排名位） ③同学质量和文化氛围 ④就业网络（地域性很强，在英国读书最终想在美国工作会很吃力）。
一个具体的例子：美国文理学院（如Williams, Amherst）QS排名不入前200，但培养的学者比例和进顶尖研究生院的比例，超过多数TOP50综合大学。排名只是一维信息。
建议：评估学校时，问"这所学校培养出了什么样的人？他们在哪里工作？"而不是只看数字。`,
  },

  {
    id: 'k_parent_bias_hotmajor',
    title: '热门专业陷阱：追风险还是追自己',
    category: 'parent_mindset',
    intentTags: [INTENT_TYPES.MAJOR, INTENT_TYPES.CAREER, INTENT_TYPES.PARENT_CONCERN],
    questionPatterns: [
      /热门专业.*值得.*吗/,
      /AI.*计算机.*一定要学吗/,
      /专业.*跟风/,
      /金融.*还值钱吗/,
      /什么专业.*最稳/,
      /未来.*不被.*淘汰/,
    ],
    semanticConcepts: ['追风', '内卷', '淘汰', 'AI替代', '两极分化', '匹配优先', '10年视角'],
    tags: ['热门专业', '就业', 'AI', '计算机', '金融', '陷阱'],
    pathMatch: ['all'],
    gradeMatch: ['all'],
    miBoost: [],
    priority: 4,
    content: `【热门专业陷阱：为什么今天的热门可能是明天的坑】
2000年代热门：土木工程、建筑、法学→今天内卷严重。
2010年代热门：金融、互联网→薪酬两极分化，中间层消失。
2020年代当前热门：AI/计算机、新能源→竞争已在快速激烈化。
判断原则：孩子的顶级MI维度与专业的核心能力要求是否匹配，比追热门重要10倍。一个逻辑MI中等、人际MI极强的孩子去学纯计算机，大概率前1/3的水平，换到商业管理可能是前5%。
对于AI时代：真正不被AI替代的是：需要高度情商和人际判断的工作（医生/治疗师/领导者）、创造性+情感连接的工作、需要极复杂物理操作的工作。纯信息处理类岗位风险高。`,
  },

  {
    id: 'k_child_pressure',
    title: '孩子的心理状态：被忽视的核心变量',
    category: 'parent_mindset',
    intentTags: [INTENT_TYPES.PSYCHOLOGY, INTENT_TYPES.PARENT_CONCERN, INTENT_TYPES.ACTION_NOW],
    questionPatterns: [
      /孩子.*压力.*大/,
      /孩子.*不想.*学/,
      /孩子.*动力.*不足/,
      /心理.*状态.*差/,
      /孩子.*厌学/,
      /孩子.*焦虑/,
      /内驱力.*怎么培养/,
    ],
    semanticConcepts: ['内驱力', '心理压力', '躯体化', '成长型思维', '固化思维', '动力', '表扬方式'],
    tags: ['心理', '压力', '焦虑', '动力', '内驱力', '状态'],
    pathMatch: ['all'],
    gradeMatch: ['all'],
    miBoost: ['intrapersonal'],
    priority: 4,
    content: `【孩子心理状态：最被低估的决策变量】
中国教育家庭的最大盲区：把孩子的"能不能做到"和"愿不愿意做到"混为一谈。能力问题可以培训，动力问题无法外力强加。
警示信号（需要优先处理的，先于所有路径规划）：持续睡眠问题、对曾经喜欢的事物失去兴趣、频繁身体症状（头疼/胃疼）但检查无异常、成绩突然明显下滑。这些是心理压力的躯体化信号。
成长型思维vs固化型思维：德韦克研究显示，家长的表扬方式直接塑造思维模式。"你真聪明"→固化；"你这次努力得很好"→成长。这个差异在孩子遇到挑战时决定其韧性。
实际建议：路径规划之前，先评估孩子现在的心理状态和学习动力。一个动力不足的孩子放在任何名校路径里，效果都会打折扣。`,
  },

  // ──────────────────────────────────────────────────
  //  年级特定行动建议
  // ──────────────────────────────────────────────────

  {
    id: 'k_action_primary',
    title: '小学阶段的正确投资方向',
    category: 'grade_action',
    intentTags: [INTENT_TYPES.ACTION_NOW, INTENT_TYPES.TIMING, INTENT_TYPES.PARENT_CONCERN],
    questionPatterns: [
      /小学.*现在.*做什么/,
      /小学生.*怎么.*培养/,
      /孩子.*几岁.*开始/,
      /小学.*应该.*学什么/,
      /现在.*小学.*规划/,
      /低年级.*孩子.*投资/,
    ],
    semanticConcepts: ['阅读习惯', '兴趣培养', '英语启蒙', '数学思维', '自主探索', '运动习惯'],
    tags: ['小学', '现在做什么', '几岁', '培养', '习惯', '兴趣'],
    pathMatch: ['all'],
    gradeMatch: ['primary'],
    miBoost: [],
    priority: 5,
    content: `【小学阶段：不要在错的事情上发力】
这个阶段ROI最高的投资：① 阅读习惯（中文+英文，质量>数量） ② 数学思维（奥数启蒙，但不要超前刷题） ③ 找到1-2个真正热爱的兴趣（不是为了升学，是为了建立内驱力的载体） ④ 运动习惯（身体素质是长期学习效率的基础）。
应该避免的：过早报大量培训班（孩子没有时间在"无聊"中自主探索，而自主探索是创造力的根源）；过度关注成绩排名（小学成绩与高中/大学表现的相关性低于大多数家长认为的程度）。
英语投入时机：6-10岁是语言吸收的黄金期，但要通过沉浸式输入（英文绘本/动画/儿歌），不是死背单词。`,
  },

  {
    id: 'k_action_middle',
    title: '初中阶段的关键布局',
    category: 'grade_action',
    intentTags: [INTENT_TYPES.ACTION_NOW, INTENT_TYPES.TIMING, INTENT_TYPES.PATH_DECISION],
    questionPatterns: [
      /初中.*现在.*做什么/,
      /初中生.*怎么规划/,
      /初一初二.*应该/,
      /初三.*准备/,
      /中学生.*路径/,
      /初中.*布局/,
    ],
    semanticConcepts: ['分叉', '路径确定', '英语水平', '竞赛布局', '中考', '高中选择', '双线'],
    tags: ['初中', '初一', '初二', '初三', '现在做什么', '规划', '中考'],
    pathMatch: ['all'],
    gradeMatch: ['middle'],
    miBoost: [],
    priority: 5,
    content: `【初中阶段：最影响后续的3年】
初中是路径分叉最密集的阶段，几乎所有重要的教育路径选择都在这3年奠定基础。
最重要的3件事：① 中考目标明确（要上哪类高中？这决定高考还是国际路线） ② 英语尽快达到流利水平（任何国际路线都需要） ③ 找到1个有深度的兴趣领域（竞赛/艺术/体育任选其一深入发展）。
初一-初二的布局余地还很大：可以同时试探竞赛+英语双线，初三再聚焦。
初三的关注重点：中考冲刺，同时做好高中选择的信息调研（提前参观心仪高中/国际学校的开放日）。
数据参考：想走国际路线的孩子，初中毕业时英语听说读写应达到托福70-80分的水平（不需要考，自测即可）。`,
  },

  {
    id: 'k_action_high',
    title: '高中阶段：可操作的关键行动清单',
    category: 'grade_action',
    intentTags: [INTENT_TYPES.ACTION_NOW, INTENT_TYPES.ADMISSION, INTENT_TYPES.TIMING],
    questionPatterns: [
      /高中.*现在.*做什么/,
      /高一.*怎么规划/,
      /高二.*需要.*做/,
      /高三.*准备/,
      /高中生.*行动/,
      /高中.*申请.*时间线/,
    ],
    semanticConcepts: ['高一布局', '标化考试', '文书素材', '竞赛冲刺', '夏校', '院校调研'],
    tags: ['高中', '高一', '高二', '高三', '现在做什么', '申请', '备考'],
    pathMatch: ['all'],
    gradeMatch: ['high'],
    miBoost: [],
    priority: 5,
    content: `【高中阶段分年级行动清单】
高一（最重要的战略布局期）：明确路径（高考/国际/双轨）→ 开始标化备考（SAT或高考双线）→ 找到1个核心活动深度参与（而非广撒网）→ 维护GPA（高一成绩影响大学申请）。
高二：标化考试首考（托福/SAT/雅思）→ 竞赛冲刺（AMC/数学竞赛等）→ 暑期活动/实习/夏校（这是文书素材的核心来源）→ 院校调研和校园参观。
高三上：完成申请文书→ EA/ED申请冲刺→ 托福/SAT刷分（如需）→ 高考班的同学同步备考。
高三下（收到录取后）：做Gap Year规划OR开学前准备（语言/生活能力/心理准备）。
最常见的错误：高一就把所有时间用于刷题，到高二发现文书没有素材。`,
  },

];

// ══════════════════════════════════════════════════════
//  v2.0 语义增强检索引擎
// ══════════════════════════════════════════════════════

/**
 * 核心检索函数 v2.0
 * 5层语义信号叠加打分
 *
 * @param {string} userQuestion  用户当前问题
 * @param {object} childProfile  {topMI, educationPath, currentGrade, answers}
 * @param {number} topN          返回最多N条知识块（默认3）
 * @returns {Array}              按相关度排序的知识块数组
 */
function retrieve(userQuestion, childProfile, topN) {
  if (!userQuestion || !childProfile) return [];
  topN = topN || 3;

  const q   = userQuestion;
  const qLow = q.toLowerCase();

  // 从 childProfile 解析上下文
  const path  = (childProfile.answers && childProfile.answers.education_path_preference)
    || childProfile.educationPath
    || 'all';
  const grade = childProfile.currentGrade || 'all';
  const topMI = childProfile.topMI || [];

  // 第一步：识别用户意图
  const detectedIntents = detectIntents(q);

  const scored = KNOWLEDGE_CHUNKS.map(chunk => {
    let score = 0;

    // ① 问题模式匹配（最高权重 ×20）
    //    正则模式精准命中"这个问题属于哪个知识块"
    if (chunk.questionPatterns) {
      const patternHits = chunk.questionPatterns.filter(p => p.test(q)).length;
      score += patternHits * 20;
    }

    // ② 意图标签匹配（×15）
    //    用户意图与知识块意图重叠
    if (chunk.intentTags && detectedIntents.length > 0) {
      const intentHits = chunk.intentTags.filter(i => detectedIntents.includes(i)).length;
      score += intentHits * 15;
    }

    // ③ 精确关键词匹配（×10）
    //    直接命中专业术语
    const keywordHits = chunk.tags.filter(tag =>
      qLow.includes(tag.toLowerCase()) || tag.toLowerCase().includes(qLow.slice(0, 4))
    ).length;
    score += keywordHits * 10;

    // ④ 语义概念匹配（×8）
    //    更宽泛的概念词，捕捉同义表达
    if (chunk.semanticConcepts) {
      const conceptHits = chunk.semanticConcepts.filter(c =>
        q.includes(c) || c.includes(q.slice(0, 3))
      ).length;
      score += conceptHits * 8;
    }

    // ⑤ 路径匹配（×5）
    if (chunk.pathMatch.includes('all') || chunk.pathMatch.includes(path)) {
      score += 5;
    }

    // ⑥ 学段匹配（×3）
    if (chunk.gradeMatch.includes('all') || chunk.gradeMatch.includes(grade)) {
      score += 3;
    }

    // ⑦ MI 相关度加分（×4）
    if (chunk.miBoost.length === 0) {
      score += 1; // 通用知识基础分
    } else {
      const miHits = chunk.miBoost.filter(mi => topMI.includes(mi)).length;
      score += miHits * 4;
    }

    // ⑧ 基础优先级
    score += chunk.priority;

    return { chunk, score };
  });

  // 过滤低相关度（阈值提升到 15，减少噪音）
  return scored
    .filter(s => s.score >= 15)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(s => s.chunk);
}

/**
 * 多样性检索：确保返回结果跨越不同 category
 * 适合需要"全面视角"的宽泛问题
 *
 * @param {string} userQuestion
 * @param {object} childProfile
 * @param {number} topN
 * @returns {Array}
 */
function diverseRetrieve(userQuestion, childProfile, topN) {
  if (!userQuestion || !childProfile) return [];
  topN = topN || 3;

  const q    = userQuestion;
  const qLow = q.toLowerCase();
  const path  = (childProfile.answers && childProfile.answers.education_path_preference)
    || childProfile.educationPath || 'all';
  const grade = childProfile.currentGrade || 'all';
  const topMI = childProfile.topMI || [];
  const detectedIntents = detectIntents(q);

  const scored = KNOWLEDGE_CHUNKS.map(chunk => {
    let score = 0;

    if (chunk.questionPatterns) {
      score += chunk.questionPatterns.filter(p => p.test(q)).length * 20;
    }
    if (chunk.intentTags && detectedIntents.length > 0) {
      score += chunk.intentTags.filter(i => detectedIntents.includes(i)).length * 15;
    }
    score += chunk.tags.filter(t => qLow.includes(t.toLowerCase())).length * 10;
    if (chunk.semanticConcepts) {
      score += chunk.semanticConcepts.filter(c => q.includes(c)).length * 8;
    }
    if (chunk.pathMatch.includes('all') || chunk.pathMatch.includes(path)) score += 5;
    if (chunk.gradeMatch.includes('all') || chunk.gradeMatch.includes(grade)) score += 3;
    if (chunk.miBoost.length === 0) {
      score += 1;
    } else {
      score += chunk.miBoost.filter(mi => topMI.includes(mi)).length * 4;
    }
    score += chunk.priority;

    return { chunk, score };
  });

  // 按分数排序后，按 category 去重，确保多样性
  const sorted = scored.filter(s => s.score >= 10).sort((a, b) => b.score - a.score);
  const seen = new Set();
  const results = [];

  for (const item of sorted) {
    if (results.length >= topN) break;
    const cat = item.chunk.category;
    if (!seen.has(cat)) {
      seen.add(cat);
      results.push(item.chunk);
    } else if (results.length < topN - 1) {
      // 允许同类的最多1个重复（当topN>3时）
      results.push(item.chunk);
    }
  }

  return results;
}

/**
 * 将检索结果格式化为可注入提示词的文本
 * @param {Array} chunks
 * @returns {string}
 */
function formatForPrompt(chunks) {
  if (!chunks || chunks.length === 0) return '';
  return chunks
    .map(c => `--- ${c.title} ---\n${c.content}`)
    .join('\n\n');
}

module.exports = {
  retrieve,
  diverseRetrieve,
  formatForPrompt,
  detectIntents,
  KNOWLEDGE_CHUNKS,
  INTENT_TYPES,
};
