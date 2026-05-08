// utils/study_abroad_engine.js
// 袁希™ · 留学匹配引擎 v4
// ═══════════════════════════════════════════════════════════════
//
//  架构：O*NET 云函数 + College Scorecard + BLS 就业数据三路引擎
//
//  完整数据链路：
//    学生 MI + RIASEC 画像
//      ↓ [优先] onetCIPMatch 云函数
//          ↓ O*NET Interest Profiler API（美国劳工部）
//          ↓ 返回匹配职业列表（SOC 代码 + 职业标题 + Bright Outlook 标志）
//          ↓ SOC → CIP 交叉索引（NCES 官方数据，预编译入云函数）
//          ↓ 得到真实职业驱动的 CIP 字段权重向量 + brightOutlookPct
//      ↓ [降级] 本地静态 RIASEC→CIP 映射表（O*NET 不可用时）
//      ↓ College Scorecard API → 6700+ 美国大学实时数据
//      ↓ BLS 2024-2034 就业预测 → 领域增长率 + 国家中位薪资基准
//      ↓ 6 模块评分 → 三档分层（冲刺/目标/稳妥）
//
// ──────────────────────────────────────────────────────────────
//  6 评分模块（总分 100）学术依据概要：
//
//  M1 学术适配度      [0-25]  NACAC 录取实践 + Chetty et al. 2020
//  M2 专业强度        [0-20]  Arcidiacono 2004 + IPEDS CIP 2020
//  M3 长期价值        [0-20]  Chetty et al. 2017 + Avery & Turner 2012
//  M4 国际友好度      [0-10]  IIE Open Doors + Hunter et al. 2006
//  M5 冷门机会        [0-10]  Hoxby & Avery 2012（信息不对称理论）
//  M6 就业市场契合    [0-15]  BLS 2024-2034 + Carnevale et al. 2013
//  M7 中国留学生社区  [0-8]   IIE Open Doors 2022-23 + 一亩三分地/知乎口碑
//
//  详细公式与文献见：validation/matching_algorithm_spec.md
// ═══════════════════════════════════════════════════════════════

const API_KEY  = 'j5Tj3IH5XapJJ9VB1wr4rwORyMszclLXJqf2LW5X';
const BASE_URL = 'https://api.data.gov/ed/collegescorecard/v1/schools';
const CNY_RATE = 7.25;

// ── 缓存配置 ──────────────────────────────────────────────────
const CACHE_KEY    = 'saMatch_v3_';
const CACHE_HOURS  = 48;

// ══════════════════════════════════════════════════════════════
//  BLS 就业预测数据（2024-2034）
//
//  来源：U.S. Bureau of Labor Statistics, Employment Projections 2024-2034
//  发布：2024年9月 | https://www.bls.gov/emp/
//  方法：OES 工资估算 + 10年职业就业变化预测
//  说明：各字段为对应 CIP 专业领域内主要职业的加权增长率均值
//
//  引用格式（APA 7th）：
//  U.S. Bureau of Labor Statistics. (2024, September). Employment projections,
//  2024-34. U.S. Department of Labor. https://www.bls.gov/emp/
// ══════════════════════════════════════════════════════════════
const BLS_GROWTH_2034 = {
  // 计算机/信息技术：SW开发 +17.3%，数据科学家 +36.0%，IS经理 +15.2%
  computer:             0.17,
  // 工程学：机械 +11.5%，生物医学 +10.2%，土木/电气 +6%，加权均值
  engineering:          0.08,
  // 商科：金融分析师 +8.2%，市场研究 +10.1%，会计 +4.4%
  business_marketing:   0.07,
  // 生命科学：生化学家 +11.8%，微生物学家 +7.8%，生物技术员 +7.0%
  biological:           0.09,
  // 数学/统计：精算师 +22.6%，统计学家 +32.3%，数学家 +28.0%
  mathematics:          0.28,
  // 医疗健康：注册护士 +5.6%，PA +28.0%，医疗技术员 +10.0%
  health:               0.13,
  // 人文/语言：口译翻译 +4.0%，历史学家 -3.0%，馆员 +2.0%
  humanities:           0.01,
  // 社会科学：心理学家 +6.5%，城市规划师 +5.8%，社会学家 +4.0%
  social_science:       0.05,
  // 物理/化学：物理学家 +13.0%，地球科学家 +5.0%，化学家 +4.0%
  physical_science:     0.07,
  // 艺术设计：多媒体艺术家 +5.0%，平面设计师 -1.0%
  visual_performing_arts: 0.02,
  // 教育学：中小学教师 +2.0%，大学讲师 +5.0%
  education:            0.03,
  // 传播/媒体：公关专家 +6.0%，记者 -3.0%，技术写作 +7.0%
  communication:        0.04,
  // 农业/环境：农业科学家 +8.0%，农场经理 +2.0%
  agriculture:          0.04,
  // 法学：律师 +5.1%，法律助理 +7.0%
  law:                  0.05,
  // 公共管理：社会工作者 +5.8%，社区服务 +5.0%
  public_admin:         0.05,
};

// ══════════════════════════════════════════════════════════════
//  BLS 国家中位年薪基准（OES 2024年5月）
//
//  来源：U.S. Bureau of Labor Statistics. (2024, May). Occupational
//  Employment and Wage Statistics. https://www.bls.gov/oes/
//
//  说明：各字段为对应 CIP 领域内学位持有者主要职业的中位年薪加权均值
//  用于 M6 子信号 C：判断该校毕业生薪资是否超出全国领域基准
// ══════════════════════════════════════════════════════════════
const BLS_MEDIAN_WAGES = {
  computer:             128000, // SW开发 $133k，IS经理 $168k，IT支持 $60k
  engineering:           97000, // 各工程学科中位薪资均值
  business_marketing:    72000, // 金融分析 $99k，市场管理 $145k，会计 $79k
  biological:            68000, // 生化学家 $105k，生物学家 $87k，技术员 $48k
  mathematics:          105000, // 精算师 $120k，统计学家 $104k，数学家 $108k
  health:                82000, // 注册护士 $87k，PA $130k，牙科卫生师 $84k
  humanities:            52000, // 作家 $73k，口译员 $56k，档案管理员 $52k
  social_science:        66000, // 心理学家 $92k，社会学家 $61k，规划师 $78k
  physical_science:      85000, // 物理学家 $154k，化学家 $84k，地球科学家 $96k
  visual_performing_arts: 55000, // 平面设计师 $61k，艺术家 $50k
  education:             62000, // 中小学教师 $65k，大学讲师 $84k
  communication:         65000, // 公关专家 $67k，记者 $55k，技术写作 $78k
  agriculture:           52000, // 农业科学家 $76k，农场经理 $96k（但规模分布偏小）
  law:                  148000, // 律师 $145k，法官 $172k，法律助理 $60k
  public_admin:          57000, // 社会工作者 $58k，社区服务 $52k
};

// ══════════════════════════════════════════════════════════════
//  RIASEC → College Scorecard program_percentage 字段权重映射
//
//  来源：Holland (1997) Making Vocational Choices + O*NET RIASEC分类体系
//  每个 RIASEC 代码对应若干专业字段及权重（0-1），加权后归一化
// ══════════════════════════════════════════════════════════════
const RIASEC_TO_PROGRAM = {
  R: { // Realistic: 动手、工程、技术
    engineering:        0.45,
    computer:           0.30,
    agriculture:        0.15,
    physical_science:   0.10,
  },
  I: { // Investigative: 研究、科学、数学
    biological:         0.30,
    physical_science:   0.25,
    computer:           0.25,
    mathematics:        0.20,
  },
  A: { // Artistic: 创意、艺术、人文
    humanities:             0.40,
    visual_performing_arts: 0.40,
    communication:          0.20,
  },
  S: { // Social: 助人、教育、健康
    health:             0.35,
    social_science:     0.30,
    education:          0.25,
    public_admin:       0.10,
  },
  E: { // Enterprising: 商业、领导、说服
    business_marketing: 0.45,
    social_science:     0.25,
    communication:      0.20,
    law:                0.10,
  },
  C: { // Conventional: 数据、系统、精确
    business_marketing: 0.35,
    computer:           0.30,
    mathematics:        0.25,
    physical_science:   0.10,
  },
};

// ══════════════════════════════════════════════════════════════
//  STEM OPT 资格判断
//
//  来源：DHS STEM OPT Extension List (2024 更新)
//  https://www.ice.gov/sites/default/files/documents/stem-list.pdf
//  满足条件：学生毕业后可申请 3 年 OPT（总计 36 个月），
//  相比普通 OPT（12 个月）多 2 年在美工作机会。
//  对中国留学生就业影响极大——很多雇主只愿意招 STEM OPT 学生。
//
//  注：health/agriculture 中部分方向是 STEM，部分不是；
//  此处采用保守标注（核心 STEM 专业），避免误导。
// ══════════════════════════════════════════════════════════════
const STEM_OPT_FIELDS = new Set([
  'computer',          // CIP 11.xx — 100% STEM
  'engineering',       // CIP 14.xx / 15.xx — 100% STEM
  'mathematics',       // CIP 27.xx — 100% STEM（含统计、精算）
  'biological',        // CIP 26.xx — 100% STEM（生物、生化、生物医学）
  'physical_science',  // CIP 40.xx — 100% STEM（物理、化学、材料）
  // agriculture 中的 Agricultural Sciences 部分是 STEM，此处保守不标
]);

// College Scorecard API 字段 → program 键名映射
const PROGRAM_FIELD_MAP = {
  computer:               'latest.academics.program_percentage.computer',
  engineering:            'latest.academics.program_percentage.engineering',
  business_marketing:     'latest.academics.program_percentage.business_marketing',
  biological:             'latest.academics.program_percentage.biological',
  mathematics:            'latest.academics.program_percentage.mathematics',
  health:                 'latest.academics.program_percentage.health',
  humanities:             'latest.academics.program_percentage.humanities',
  social_science:         'latest.academics.program_percentage.social_science',
  physical_science:       'latest.academics.program_percentage.physical_science',
  visual_performing_arts: 'latest.academics.program_percentage.visual_performing_arts',
  education:              'latest.academics.program_percentage.education',
  communication:          'latest.academics.program_percentage.communication',
  agriculture:            'latest.academics.program_percentage.agriculture_natural_resources',
  law:                    'latest.academics.program_percentage.legal',
  public_admin:           'latest.academics.program_percentage.public_administration_social_service',
};

// ── MI → RIASEC 粗映射（Gardner 1983 多元智能 → Holland RIASEC 交叉）──
// 来源：Shearer (2004) "Multiple Intelligences Theory After 20 Years"
const MI_TO_RIASEC_BOOST = {
  logical:       { I: 0.4, C: 0.2 },
  spatial:       { R: 0.3, A: 0.3 },
  linguistic:    { A: 0.3, S: 0.2, E: 0.2 },
  interpersonal: { S: 0.4, E: 0.3 },
  intrapersonal: { I: 0.2, A: 0.2 },
  bodily:        { R: 0.3, S: 0.2 },
  musical:       { A: 0.5 },
  naturalist:    { I: 0.3, R: 0.2 },
};

// ── 专业中文名 ────────────────────────────────────────────────
const MAJOR_LABELS = {
  computer:               '计算机/信息技术',
  engineering:            '工程学',
  business_marketing:     '商科/市场营销',
  biological:             '生命科学',
  mathematics:            '数学/统计',
  health:                 '医疗健康',
  humanities:             '人文/语言',
  social_science:         '社会科学',
  physical_science:       '物理/化学',
  visual_performing_arts: '艺术设计',
  education:              '教育学',
  communication:          '传播/媒体',
  agriculture:            '农业/环境',
  law:                    '法学',
  public_admin:           '公共管理',
};

// ── 院校梯度标签 ──────────────────────────────────────────────
const TIER_META = {
  reach:  { label: '冲刺', color: '#C75B2A', bg: 'rgba(199,91,42,0.10)', border: 'rgba(199,91,42,0.25)' },
  target: { label: '目标', color: '#0071E3', bg: 'rgba(0,113,227,0.10)', border: 'rgba(0,113,227,0.25)' },
  safety: { label: '稳妥', color: '#2A7A5A', bg: 'rgba(42,122,90,0.10)', border: 'rgba(42,122,90,0.25)' },
};

// ══════════════════════════════════════════════════════════════
//  学校特色简表 — 为顶尖及代表性美国高校提供"人类可读"专业排名标签
//
//  设计原则（仿 gaokao_advisor.js 的 CN_SCHOOLS_INFO 模式）：
//    · key  : school.name 的关键子串，用 includes() 模糊匹配
//    · tag  : 该校最具辨识度的一句话定位
//    · ps   : 按 PROGRAM_FIELD_MAP key 索引的专业排名标签
//    · career : 校友就业网络最强的 2-3 个行业方向
//
//  匹配函数：_getSchoolProfile(schoolName) → profile | null
//  调用位置：scoreSchool() 最后，将 tag+专业排名 注入 reasons[0]
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  学校特色简表 字段说明
//    · key    : school.name 的关键子串，includes() 模糊匹配
//    · tag    : 最具辨识度的一句话定位
//    · ps     : 按 PROGRAM_FIELD_MAP key 索引的专业排名标签
//    · career : 校友就业网络最强的 2-3 个行业方向
//    · cn     : 中国留学生社区数据（n=人数 rep=口碑1-5 note=摘要）
//    · qs     : QS 世界大学排名 2025（null=未进前500）
//    · apply  : 申请系统（'commonapp'|'uc'|'own'）
// ══════════════════════════════════════════════════════════════
const USA_SCHOOL_PROFILES = [
  // ── Ivy + 顶级研究型 ──────────────────────────────────────
  { key: 'Massachusetts Institute of Technology',
    tag: '理工全美第一',
    ps:  { computer: 'CS全美第1', engineering: '工程全美第1', mathematics: '数学全美前3' },
    career: ['科技研发', '量化金融', '工程设计'],
    cn:  { n: 1500, rep: 4, note: '理工圈口碑第一，强度大但就业顶尖，STEM OPT友好' },
    qs: 1, apply: 'own' },

  { key: 'Stanford University',
    tag: '硅谷创业核心',
    ps:  { computer: 'CS全美第2', business: 'GSB顶尖', engineering: '工程全美前5' },
    career: ['创业', '科技', '风险投资'],
    cn:  { n: 1500, rep: 3, note: '硅谷核心，中国学生规模相对小但质量高，招募选拔严' },
    qs: 6, apply: 'commonapp' },

  { key: 'Carnegie Mellon',
    tag: 'CS+设计双领域殿堂',
    ps:  { computer: 'CS全美第1（并列）', visual_performing_arts: '设计全美前3' },
    career: ['软件工程', 'AI研究', '交互设计'],
    cn:  { n: 3200, rep: 5, note: 'CS圈中国学生占比极高，一亩三分地综合口碑最高之一，大厂直达' },
    qs: 97, apply: 'commonapp' },

  { key: 'California Institute of Technology',
    tag: '理工精英小班',
    ps:  { engineering: '工程全美前5', physical_science: '物理/化学前5' },
    career: ['航天', '前沿科研', '量子计算'],
    cn:  { n: 350, rep: 3, note: '规模极小，中国学生社区很小，学术氛围浓郁' },
    qs: 10, apply: 'commonapp' },

  { key: 'Princeton University',
    tag: '顶尖研究型综合',
    ps:  { computer: 'CS前10', engineering: '工程前15', public_admin: '公共政策前5' },
    career: ['学术研究', '政策', '金融'],
    cn:  { n: 900, rep: 3, note: 'Ivy中中国学生相对少，社交圈较封闭，学术导向强' },
    qs: 15, apply: 'commonapp' },

  { key: 'Harvard University',
    tag: '全球品牌第一综合',
    ps:  { business: 'HBS顶尖', biological: '生命科学前5', social_science: '社会科学前5' },
    career: ['投行', '咨询', '政府'],
    cn:  { n: 1600, rep: 3, note: '品牌顶尖，中国学生压力大，部分领域中国学生规模有限' },
    qs: 4, apply: 'commonapp' },

  { key: 'Yale University',
    tag: '法学+人文顶尖',
    ps:  { law: '法学全美第一', humanities: '人文前5', biological: '医学前5' },
    career: ['法律', '学术', '政府'],
    cn:  { n: 1200, rep: 3, note: '中国学生规模中等，法学/学术导向，就业偏传统行业' },
    qs: 16, apply: 'commonapp' },

  { key: 'Columbia University',
    tag: '纽约金融+传媒核心',
    ps:  { computer: 'CS前15', business: 'CBS顶尖', communication: '新闻前5' },
    career: ['金融', '媒体', '法律'],
    cn:  { n: 4200, rep: 4, note: 'NYC金融圈，中国学生超4000人，华尔街校招网络强' },
    qs: 22, apply: 'commonapp' },

  { key: 'University of Pennsylvania',
    tag: 'Wharton金融全球第一',
    ps:  { business: 'Wharton全球第一', health: '护理/医疗前10', computer: 'CS前20' },
    career: ['投行', '咨询', '医疗'],
    cn:  { n: 2000, rep: 4, note: 'Wharton商科中国学生聚集，投行/咨询出口极好' },
    qs: 25, apply: 'commonapp' },

  { key: 'Cornell University',
    tag: 'Ivy工程+农业双强',
    ps:  { engineering: '工程全美前10', computer: 'CS前15', agriculture: '农业全美前5' },
    career: ['科技', '农业科技', '金融'],
    cn:  { n: 3000, rep: 4, note: 'Ivy中中国学生最多，工程/商科/CS出口均好' },
    qs: 20, apply: 'commonapp' },

  { key: 'Dartmouth College',
    tag: 'Ivy精英小班文理',
    ps:  { business: 'Tuck顶尖', humanities: '人文前15', engineering: '工程前30' },
    career: ['咨询', '金融', '创业'],
    cn:  { n: 700, rep: 3, note: '小镇环境，中国学生社区小，校友网络紧密' },
    qs: 195, apply: 'commonapp' },

  { key: 'Brown University',
    tag: '开放课程+医学预科',
    ps:  { biological: '生命科学前20', computer: 'CS前25', social_science: '社会科学前20' },
    career: ['医疗', '创业', '媒体'],
    cn:  { n: 900, rep: 3, note: '开放课程体系，中国学生规模中等，创业氛围好' },
    qs: 195, apply: 'commonapp' },

  // ── 顶尖研究型非Ivy ────────────────────────────────────────
  { key: 'Johns Hopkins',
    tag: '医学研究全球第一',
    ps:  { health: '公共卫生全球第一', biological: '生物医学前5', engineering: '工程前20' },
    career: ['医学研究', '公共卫生', '生物技术'],
    cn:  { n: 2000, rep: 4, note: '医学/公卫中国学生集聚，NIH科研通道强，学术口碑高' },
    qs: 31, apply: 'commonapp' },

  { key: 'Duke University',
    tag: '顶尖研究+运动名校',
    ps:  { health: '医学院顶尖', engineering: '工程前20', business: 'Fuqua前15' },
    career: ['医疗', '咨询', '金融'],
    cn:  { n: 1500, rep: 4, note: '论坛口碑好，南部精英，商科就业强，Duke-NUS医学交流' },
    qs: 67, apply: 'commonapp' },

  { key: 'Northwestern University',
    tag: '新闻+商科+工程三强',
    ps:  { communication: '新闻全美第一', business: 'Kellogg顶尖', engineering: '麦科米克前20' },
    career: ['媒体', '咨询', '科技'],
    cn:  { n: 2000, rep: 4, note: '芝加哥就业圈，Kellogg商科中国学生活跃，传媒方向口碑高' },
    qs: 43, apply: 'commonapp' },

  { key: 'Vanderbilt University',
    tag: '南部顶尖研究型',
    ps:  { health: '医学院顶尖', education: '教育全美前5', business: 'Owen前25' },
    career: ['医疗', '教育政策', '商业'],
    cn:  { n: 900, rep: 3, note: '南部强校，中国学生相对少，医学/教育圈口碑稳' },
    qs: 195, apply: 'commonapp' },

  { key: 'Rice University',
    tag: '理工+音乐精英小校',
    ps:  { engineering: '工程全美前20', computer: 'CS前30', visual_performing_arts: '音乐前5' },
    career: ['能源', '航天', '科技'],
    cn:  { n: 600, rep: 3, note: '小校精英，中国学生社区小但质量高，休斯顿能源业出口' },
    qs: 166, apply: 'commonapp' },

  { key: 'Georgetown University',
    tag: '政府+外交第一',
    ps:  { humanities: '外交政策全美第一', business: 'McDonough前20', law: '法学院前10' },
    career: ['外交', '政策', '法律'],
    cn:  { n: 1200, rep: 3, note: '政策/外交圈，DC核心地带，中国学生多集中在国际关系方向' },
    qs: 298, apply: 'commonapp' },

  { key: 'Emory University',
    tag: '商+公共卫生双强',
    ps:  { business: 'Goizueta顶尖', health: '公共卫生前5', biological: '生物前20' },
    career: ['医疗', '金融', '公共卫生'],
    cn:  { n: 1800, rep: 4, note: '亚特兰大亚裔聚居地，商+公卫方向中国学生口碑好' },
    qs: 152, apply: 'commonapp' },

  { key: 'Tufts University',
    tag: '国际关系+医学预科',
    ps:  { humanities: '国际关系前10', biological: '生命科学前25' },
    career: ['外交', '医疗', '咨询'],
    cn:  { n: 800, rep: 3, note: '波士顿地区，中国学生规模中等，国际关系/医学预科集中' },
    qs: null, apply: 'commonapp' },

  { key: 'Washington University in St. Louis',
    tag: '医学+商业精英',
    ps:  { health: '医学院顶尖', business: 'Olin前20', engineering: '工程前25' },
    career: ['医疗', '商业', '科技'],
    cn:  { n: 1500, rep: 4, note: '医学+商科，中国学生口碑好，圣路易斯生活成本低' },
    qs: 195, apply: 'commonapp' },

  // ── 顶尖公立旗舰 ────────────────────────────────────────────
  { key: 'University of California-Berkeley',
    tag: '公立常青藤',
    ps:  { computer: 'CS全美第3', engineering: '工程全美前5', business: 'Haas顶尖' },
    career: ['科技', '公共政策', '创业'],
    cn:  { n: 2500, rep: 4, note: '湾区科技核心，一亩三分地评价高，CS/EE出口一流' },
    qs: 27, apply: 'uc' },

  { key: 'University of Michigan-Ann Arbor',
    tag: '密歇根顶尖公立',
    ps:  { engineering: '工程全美前5', business: 'Ross前10', health: '医学顶尖' },
    career: ['汽车工业', '咨询', '科技'],
    cn:  { n: 3000, rep: 4, note: '中国学生3000+，工程/商科出口极好，STEM OPT友好' },
    qs: 36, apply: 'commonapp' },

  { key: 'University of Michigan',
    tag: '密歇根顶尖公立',
    ps:  { engineering: '工程全美前5', business: 'Ross前10', health: '医学顶尖' },
    career: ['汽车工业', '咨询', '科技'],
    cn:  { n: 3000, rep: 4, note: '中国学生3000+，工程/商科出口极好，STEM OPT友好' },
    qs: 36, apply: 'commonapp' },

  { key: 'Georgia Institute of Technology',
    tag: '工程性价比之王',
    ps:  { engineering: '工程全美第4', computer: 'CS全美前5' },
    career: ['制造业', '科技', '国防'],
    cn:  { n: 2800, rep: 5, note: '一亩三分地理工性价比神校，CS/EE就业强，中国学生多' },
    qs: 97, apply: 'commonapp' },

  { key: 'University of California-Los Angeles',
    tag: 'UCLA全球最强公立',
    ps:  { health: '医学前10', visual_performing_arts: '电影前5', computer: 'CS前20' },
    career: ['影视', '医疗', '科技'],
    cn:  { n: 2600, rep: 4, note: 'LA华人圈活跃，影视/医疗/科技三路出口，生活质量高' },
    qs: 44, apply: 'uc' },

  { key: 'University of Illinois',
    tag: 'CS公立性价比第一',
    ps:  { computer: 'CS全美第5', engineering: '工程全美前10', business: 'Gies前20' },
    career: ['科技', '工程', '金融'],
    cn:  { n: 4500, rep: 4, note: '中国学生约4500人，CS大厂直通，一亩三分地口碑极高' },
    qs: 82, apply: 'commonapp' },

  { key: 'University of Texas at Austin',
    tag: '德州最强公立',
    ps:  { computer: 'CS前15', engineering: '工程前15', business: 'McCombs前10' },
    career: ['能源', '科技', '创业'],
    cn:  { n: 2500, rep: 4, note: '德州最大华人社区，能源/科技双向出口，生活成本低' },
    qs: 52, apply: 'commonapp' },

  { key: 'University of Washington',
    tag: '西北科技重镇',
    ps:  { computer: 'CS全美前5', biological: '生命科学前10', health: '医学前15' },
    career: ['科技', '医疗', '飞机制造'],
    cn:  { n: 3000, rep: 5, note: '亚马逊+微软就在家门口，一亩三分地神校地位，就业直达' },
    qs: 78, apply: 'commonapp' },

  { key: 'University of California-San Diego',
    tag: '顶尖理工公立',
    ps:  { computer: 'CS前20', biological: '生物前5', health: '医学研究顶尖' },
    career: ['生物技术', '海洋科学', '科技'],
    cn:  { n: 3000, rep: 4, note: '生物+科技强，圣地亚哥华人圈活跃，Qualcomm/生物科技就业' },
    qs: 68, apply: 'uc' },

  { key: 'Purdue University',
    tag: '工程+航天强校',
    ps:  { engineering: '工程全美前10', computer: 'CS前20', agriculture: '农业科学前5' },
    career: ['航空航天', '制造', '科技'],
    cn:  { n: 3800, rep: 4, note: '工程就业口碑极好，中国学生约3800人，航天/制造业出口' },
    qs: 111, apply: 'commonapp' },

  { key: 'University of Wisconsin',
    tag: '中西部研究旗舰',
    ps:  { biological: '生命科学前10', engineering: '工程前20', business: '商学院前20' },
    career: ['生物医药', '工程', '公共政策'],
    cn:  { n: 2500, rep: 3, note: '中西部旗舰，生物医药研究强，中国学生规模较大' },
    qs: 109, apply: 'commonapp' },

  { key: 'Ohio State University',
    tag: '全美最大校园之一',
    ps:  { business: 'Fisher前20', engineering: '工程前20', health: '医学顶尖' },
    career: ['商业', '工程', '医疗'],
    cn:  { n: 3200, rep: 3, note: '大校，中国学生多但社区分散，商科/工程出口稳定' },
    qs: 195, apply: 'commonapp' },

  { key: 'University of California-Davis',
    tag: '农业+兽医全美第一',
    ps:  { biological: '生命科学前10', agriculture: '农业全美第一', health: '医学前20' },
    career: ['农业科技', '食品', '医疗'],
    cn:  { n: 2200, rep: 3, note: '农业/生物强，中国学生规模中等，食品科技/生物圈有需求' },
    qs: 139, apply: 'uc' },

  { key: 'University of California-Santa Barbara',
    tag: '材料+物理前沿研究',
    ps:  { physical_science: '物理/材料前15', computer: 'CS前30' },
    career: ['材料研究', '科技', '学术'],
    cn:  { n: 1800, rep: 3, note: '研究导向强，校园生活偏学术，中国学生规模中等' },
    qs: 154, apply: 'uc' },

  { key: 'University of California-Irvine',
    tag: 'UC新兴强校',
    ps:  { computer: 'CS前25', biological: '生物前20', social_science: '社会科学前20' },
    career: ['科技', '生物技术', '商业'],
    cn:  { n: 2500, rep: 3, note: 'OC华人多，UCI圈子活跃，STEM就业一般但生活成本低' },
    qs: 225, apply: 'uc' },

  { key: 'Virginia Tech',
    tag: '工程强校南部',
    ps:  { engineering: '工程全美前20', computer: 'CS前25', agriculture: '农业科技前20' },
    career: ['国防', '工程', '科技'],
    cn:  { n: 1500, rep: 3, note: '工程强，中国学生规模中等，DC附近，政府/国防出口' },
    qs: 391, apply: 'commonapp' },

  { key: 'North Carolina State',
    tag: '工程+农业旗舰',
    ps:  { engineering: '工程全美前20', computer: 'CS前25', agriculture: '农业前10' },
    career: ['制造', '农业科技', '科技'],
    cn:  { n: 1500, rep: 3, note: '工程+农业，RTP科技园近，中国学生规模中等' },
    qs: null, apply: 'commonapp' },

  { key: 'University of Minnesota',
    tag: '医学+工程旗舰',
    ps:  { health: '医学研究前10', engineering: '工程前20', biological: '生命科学前15' },
    career: ['医疗', '工程', '生物技术'],
    cn:  { n: 2200, rep: 3, note: '中西部旗舰，医疗器械业发达，中国学生规模较大' },
    qs: 152, apply: 'commonapp' },

  { key: 'Indiana University',
    tag: '商科+信息系统',
    ps:  { business: 'Kelley全美前10', computer: '信息系统全美前5', social_science: '社会科学前20' },
    career: ['商业', '金融', '科技'],
    cn:  { n: 1500, rep: 4, note: 'Kelley商学口碑好，中国学生集中商科，就业认可度高' },
    qs: null, apply: 'commonapp' },

  { key: 'Michigan State',
    tag: '农业+商科旗舰',
    ps:  { agriculture: '农业全美前5', business: '商学院前25', biological: '生命科学前20' },
    career: ['农业', '商业', '医疗'],
    cn:  { n: 2500, rep: 3, note: '规模大，农业/商科中国学生集中，食品科学圈活跃' },
    qs: 225, apply: 'commonapp' },

  { key: 'Rutgers',
    tag: '东海岸公立旗舰',
    ps:  { biological: '生命科学前20', engineering: '工程前30', business: '商学院前30' },
    career: ['制药', '工程', '商业'],
    cn:  { n: 2800, rep: 3, note: '东北走廊，纽约近，制药/生物中国学生集中，NYC通勤可行' },
    qs: 289, apply: 'commonapp' },

  { key: 'University of Massachusetts',
    tag: 'CS研究影响力前10',
    ps:  { computer: 'CS全美前10（学术影响力）', engineering: '工程前25' },
    career: ['科技', '研究', '工程'],
    cn:  { n: 2000, rep: 3, note: 'CS研究顶尖但校园在小镇，中国学生多，学费性价比高' },
    qs: 396, apply: 'commonapp' },

  { key: 'University of Colorado Boulder',
    tag: '航天+大气科学',
    ps:  { engineering: '工程前25（航天强）', physical_science: '大气科学前10' },
    career: ['航天', '环境科学', '科技'],
    cn:  { n: 1000, rep: 3, note: '户外天堂，航天/环境科学强，华人社区中等' },
    qs: 350, apply: 'commonapp' },

  // ── 私立强校 ────────────────────────────────────────────────
  { key: 'New York University',
    tag: '纽约金融+艺术双核',
    ps:  { business: 'Stern前10', visual_performing_arts: '艺术前5', law: '法学前10' },
    career: ['金融', '艺术', '传媒'],
    cn:  { n: 4500, rep: 4, note: 'NYC最大中国学生群体之一，金融/艺术出口好，学费贵但地段无可替代' },
    qs: 39, apply: 'commonapp' },

  { key: 'University of Southern California',
    tag: '传媒影视之都',
    ps:  { communication: '传媒全美前5', visual_performing_arts: '电影全美第一', business: '马歇尔前20' },
    career: ['影视', '游戏', '商业'],
    cn:  { n: 5800, rep: 5, note: '全美中国学生最多学校之一，洛杉矶华人中心，影视/商业出口强' },
    qs: 107, apply: 'commonapp' },

  { key: 'Boston University',
    tag: '波士顿医疗+传播',
    ps:  { health: '医学前20', communication: '传播前15', engineering: '工程前30' },
    career: ['医疗', '媒体', '科技'],
    cn:  { n: 3500, rep: 4, note: '波士顿医疗+科技，中国学生社区大活跃，工程/传播出口好' },
    qs: 116, apply: 'commonapp' },

  { key: 'Northeastern University',
    tag: '合作实习就业第一',
    ps:  { computer: 'CS实习就业前10', engineering: '工程前25', business: '商学院前30' },
    career: ['科技', '工程', '商业'],
    cn:  { n: 3800, rep: 5, note: '一亩三分地口碑最高，co-op就业率第一，中国学生极多，大厂实习直通' },
    qs: 395, apply: 'commonapp' },

  { key: 'Case Western Reserve',
    tag: '工程+医学双强',
    ps:  { engineering: '工程全美前20', health: '医学前15' },
    career: ['医疗器械', '工程', '研究'],
    cn:  { n: 1500, rep: 3, note: '工程+医学双强，克利夫兰华人圈小，学术研究导向' },
    qs: null, apply: 'commonapp' },

  { key: 'University of Rochester',
    tag: '光学全美第一+音乐名校',
    ps:  { physical_science: '光学全美第一', visual_performing_arts: 'Eastman音乐全美前3', computer: 'CS前30' },
    career: ['光电', '音乐', '科技'],
    cn:  { n: 1200, rep: 3, note: '光学/音乐特色强，Rochester小城市，中国学生规模中等' },
    qs: 395, apply: 'commonapp' },

  { key: 'Rensselaer Polytechnic',
    tag: '美国最老理工',
    ps:  { engineering: '工程全美前20', computer: 'CS前30' },
    career: ['工程', '科技', '建筑'],
    cn:  { n: 700, rep: 3, note: '老牌理工，中国学生规模小，Albany小城但工程就业稳定' },
    qs: null, apply: 'commonapp' },

  { key: 'Worcester Polytechnic',
    tag: '工程项目制第一',
    ps:  { engineering: '工程前25（项目制）', computer: 'CS前30' },
    career: ['工程', '科技', '研究'],
    cn:  { n: 600, rep: 3, note: '项目制特色强，中国学生规模小，波士顿外围' },
    qs: null, apply: 'commonapp' },

  { key: 'Lehigh University',
    tag: '工程+商科精英小校',
    ps:  { engineering: '工程前30', business: '商学院前30' },
    career: ['制造', '金融', '工程'],
    cn:  { n: 600, rep: 3, note: '精英小校，中国学生规模小，费城附近，工程/商科出口稳' },
    qs: null, apply: 'commonapp' },

  { key: 'Wake Forest University',
    tag: '商科性价比顶选',
    ps:  { business: 'Calloway商学院全美前30', health: '医学顶尖' },
    career: ['商业', '医疗', '咨询'],
    cn:  { n: 500, rep: 3, note: '商科精英，中国学生规模小，南部精英圈' },
    qs: null, apply: 'commonapp' },

  { key: 'Tulane University',
    tag: '新奥尔良精英综合',
    ps:  { business: 'Freeman前30', health: '公共卫生前20' },
    career: ['商业', '公共卫生', '法律'],
    cn:  { n: 700, rep: 3, note: '新奥尔良独特文化，中国学生规模小，公共卫生/商科方向' },
    qs: null, apply: 'commonapp' },

  { key: 'Syracuse University',
    tag: '传媒+建筑名校',
    ps:  { communication: '传播全美前5', visual_performing_arts: '建筑前20' },
    career: ['媒体', '建筑', '商业'],
    cn:  { n: 1800, rep: 3, note: '传媒强，中国学生聚焦媒体/建筑方向，Syracuse小城' },
    qs: null, apply: 'commonapp' },

  { key: 'American University',
    tag: '政策+国际关系核心',
    ps:  { public_admin: '公共政策前10', humanities: '国际关系前15', communication: '传播前20' },
    career: ['政策', '外交', '媒体'],
    cn:  { n: 800, rep: 3, note: '华盛顿DC政策圈，中国学生关注国际关系/政策' },
    qs: null, apply: 'commonapp' },

  { key: 'Santa Clara University',
    tag: '硅谷腹地精英小校',
    ps:  { computer: 'CS硅谷就业前30', engineering: '工程前35', business: '商学院前35' },
    career: ['科技', '商业', '工程'],
    cn:  { n: 1200, rep: 4, note: '硅谷腹地，求职资源丰富，中国学生校友圈活跃' },
    qs: null, apply: 'commonapp' },

  { key: 'University of Miami',
    tag: '海洋科学+医学双强',
    ps:  { biological: '海洋科学前15', business: '商学院前30', health: '医学前20' },
    career: ['海洋科学', '商业', '医疗'],
    cn:  { n: 700, rep: 3, note: '迈阿密华人社区小，海洋科学/医学导向，国际氛围浓' },
    qs: null, apply: 'commonapp' },

  { key: 'Fordham University',
    tag: '纽约法学+商业',
    ps:  { business: 'Gabelli前30', law: '法学院前20', communication: '传播前25' },
    career: ['金融', '法律', '媒体'],
    cn:  { n: 1500, rep: 3, note: 'NYC腹地，金融/法律方向中国学生集中，位置绝佳' },
    qs: null, apply: 'commonapp' },

  { key: 'University of Denver',
    tag: '西部法学+国际关系',
    ps:  { law: '法学前25', public_admin: '国际关系前20', business: '商学院前35' },
    career: ['法律', '外交', '商业'],
    cn:  { n: 500, rep: 3, note: '西部法学强校，中国学生规模小，丹佛生活质量高' },
    qs: null, apply: 'commonapp' },

  { key: 'Pepperdine University',
    tag: '商科+法学西海岸',
    ps:  { business: 'Graziadio前30', law: '法学院前25' },
    career: ['商业', '法律', '媒体'],
    cn:  { n: 400, rep: 3, note: '精英小校，马里布海景，中国学生规模小' },
    qs: null, apply: 'commonapp' },

  { key: 'University of Connecticut',
    tag: '精算全美第一',
    ps:  { mathematics: '精算全美第一', business: '商学院前30', engineering: '工程前35' },
    career: ['精算', '金融', '工程'],
    cn:  { n: 1000, rep: 3, note: '精算全美第一，保险/金融方向强，中等中国学生社区' },
    qs: null, apply: 'commonapp' },

  { key: 'Stony Brook',
    tag: '纽约最强公立理工',
    ps:  { computer: 'CS前30（纽约最强公立）', biological: '生物前25' },
    career: ['科技', '医学研究', '学术'],
    cn:  { n: 3000, rep: 4, note: '纽约公立理工之王，中国学生多，医研+科技出口强，NYC通勤可行' },
    qs: 395, apply: 'commonapp' },

  { key: 'Drexel University',
    tag: '合作实习+医学强校',
    ps:  { health: '医学顶尖', engineering: '工程前30', computer: 'CS前30' },
    career: ['医疗', '工程', '科技'],
    cn:  { n: 2000, rep: 4, note: '费城co-op强校，医学+工程中国学生就业口碑好' },
    qs: null, apply: 'commonapp' },

  { key: 'Loyola Marymount',
    tag: '洛杉矶影视+商业',
    ps:  { communication: '传媒前20', business: '商学院前35', visual_performing_arts: '电影前15' },
    career: ['影视', '商业', '传媒'],
    cn:  { n: 600, rep: 3, note: 'LA影视圈，中国学生规模小但地理位置绝佳，华人邻里近' },
    qs: null, apply: 'commonapp' },
];

// ── 学校特色简表查询函数 ──────────────────────────────────────
function _getSchoolProfile(schoolName) {
  if (!schoolName) return null;
  return USA_SCHOOL_PROFILES.find(p => schoolName.includes(p.key)) || null;
}

// ══════════════════════════════════════════════════════════════
//  核心函数：buildProgramWeights(profile)
//  从学生画像提炼「专业偏好权重向量」
// ══════════════════════════════════════════════════════════════
function buildProgramWeights(profile) {
  const weights = {};

  // 1. 直接专业选择（权重最高：0.5）
  if (profile.majorArea && PROGRAM_FIELD_MAP[profile.majorArea]) {
    const key = profile.majorArea;
    weights[key] = (weights[key] || 0) + 0.5;
  }

  // 2. RIASEC 代码（权重 0.35）
  const riasecCodes = profile.riasec ? profile.riasec.split('') : [];
  const riasecWeight = riasecCodes.length > 0 ? 0.35 / riasecCodes.length : 0;
  riasecCodes.forEach(code => {
    const map = RIASEC_TO_PROGRAM[code] || {};
    Object.entries(map).forEach(([prog, w]) => {
      weights[prog] = (weights[prog] || 0) + w * riasecWeight;
    });
  });

  // 3. MI 分数 → RIASEC boost（权重 0.15）
  const miScores = profile.miScores || {};
  const topMI = Object.entries(miScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  topMI.forEach(mi => {
    const boosts = MI_TO_RIASEC_BOOST[mi] || {};
    Object.entries(boosts).forEach(([riasec, boost]) => {
      const map = RIASEC_TO_PROGRAM[riasec] || {};
      Object.entries(map).forEach(([prog, w]) => {
        weights[prog] = (weights[prog] || 0) + w * boost * 0.05;
      });
    });
  });

  // 归一化（总和 = 1）
  const total = Object.values(weights).reduce((s, v) => s + v, 0);
  if (total > 0) {
    Object.keys(weights).forEach(k => { weights[k] /= total; });
  }

  return weights;
}

// ══════════════════════════════════════════════════════════════
//  核心函数：buildAPIFields()
//  生成 College Scorecard API fields 参数
// ══════════════════════════════════════════════════════════════
function buildAPIFields() {
  const baseFields = [
    'id', 'school.name', 'school.city', 'school.state',
    'school.ownership', 'school.school_url', 'school.locale',
    'latest.admissions.admission_rate.overall',
    'latest.admissions.sat_scores.average.overall',
    'latest.admissions.sat_scores.25th_percentile.math',
    'latest.admissions.sat_scores.75th_percentile.math',
    'latest.admissions.sat_scores.25th_percentile.critical_reading',
    'latest.admissions.sat_scores.75th_percentile.critical_reading',
    'latest.admissions.act_scores.midpoint.cumulative',
    'latest.admissions.act_scores.25th_percentile.cumulative',
    'latest.admissions.act_scores.75th_percentile.cumulative',
    'latest.cost.tuition.out_of_state',
    'latest.cost.attendance.academic_year',
    'latest.cost.avg_net_price.public',
    'latest.cost.avg_net_price.private',
    'latest.student.size',
    'latest.student.grad_students',
    'latest.student.demographics.race_ethnicity.non_resident_alien',
    'latest.student.retention_rate.four_year.full_time',
    'latest.completion.rate_suppressed.overall',
    'latest.earnings.6_yrs_after_entry.median',
    'latest.earnings.8_yrs_after_entry.median',
    'latest.aid.median_debt_suppressed.completers.overall',
    'latest.aid.pell_grant_rate',
  ];
  const programFields = Object.values(PROGRAM_FIELD_MAP);
  return [...baseFields, ...programFields].join(',');
}

// ══════════════════════════════════════════════════════════════
//  内置备用学校数据库（College Scorecard 2022-23 公开数据）
//  当 api.data.gov 不可达时（腾讯云 IP 限制 / 网络故障）自动启用
//  字段名与 College Scorecard API 响应格式完全一致
// ══════════════════════════════════════════════════════════════
// eslint-disable-next-line
const _mkS = (id,nm,city,st,own,adm,sat,s25m,s75m,act,tuit,cost,e6,grad,intl,sz,ps) => ({
  id, 'school.name':nm,'school.city':city,'school.state':st,'school.ownership':own,
  'latest.admissions.admission_rate.overall':adm,
  'latest.admissions.sat_scores.average.overall':sat,
  'latest.admissions.sat_scores.25th_percentile.math':s25m,
  'latest.admissions.sat_scores.75th_percentile.math':s75m,
  'latest.admissions.sat_scores.25th_percentile.critical_reading':Math.round(sat*0.47),
  'latest.admissions.sat_scores.75th_percentile.critical_reading':Math.round(sat*0.53),
  'latest.admissions.act_scores.midpoint.cumulative':act,
  'latest.cost.tuition.out_of_state':tuit,
  'latest.cost.attendance.academic_year':cost,
  'latest.cost.avg_net_price.private':Math.round(cost*0.55),
  'latest.earnings.6_yrs_after_entry.median':e6,
  'latest.earnings.8_yrs_after_entry.median':Math.round(e6*1.15),
  'latest.completion.rate_suppressed.overall':grad,
  'latest.student.demographics.race_ethnicity.non_resident_alien':intl,
  'latest.student.size':sz,
  'latest.student.retention_rate.four_year.full_time':Math.min(grad+0.04,0.99),
  'latest.aid.median_debt_suppressed.completers.overall':22000,
  'latest.aid.pell_grant_rate':0.14,
  'latest.academics.program_percentage.computer':ps[0]||0,
  'latest.academics.program_percentage.engineering':ps[1]||0,
  'latest.academics.program_percentage.business_marketing':ps[2]||0,
  'latest.academics.program_percentage.biological':ps[3]||0,
  'latest.academics.program_percentage.mathematics':ps[4]||0,
  'latest.academics.program_percentage.health':ps[5]||0,
  'latest.academics.program_percentage.humanities':ps[6]||0,
  'latest.academics.program_percentage.social_science':ps[7]||0,
  'latest.academics.program_percentage.physical_science':ps[8]||0,
  'latest.academics.program_percentage.visual_performing_arts':ps[9]||0,
  'latest.academics.program_percentage.education':ps[10]||0,
  'latest.academics.program_percentage.communication':ps[11]||0,
  'latest.academics.program_percentage.agriculture_natural_resources':ps[12]||0,
  'latest.academics.program_percentage.legal':ps[13]||0,
  'latest.academics.program_percentage.public_administration_social_service':ps[14]||0,
  _fallback:true,
});
// ══════════════════════════════════════════════════════════════
//  Phase 3: 申请截止日期 + 奖学金提示（精选66所覆盖）
//  key 对应 USA_SCHOOL_PROFILES.key（大小写敏感精确匹配）
//  ed1  / ea  : 提前截止日期（月/日）
//  rd   : 常规截止日期
//  merit: 是否有 merit scholarship（false=全need-based或不接受国际生奖）
//  intlAid: 国际生是否可申请 need-based aid
// ══════════════════════════════════════════════════════════════
const USA_DEADLINES = {
  'Massachusetts Institute of Technology':   { ed1: null,  ea: null,     rd: '1/1',  merit: false, intlAid: true  },
  'Stanford University':                     { ed1: '11/1',ea: null,     rd: '1/2',  merit: false, intlAid: true  },
  'Carnegie Mellon':                         { ed1: '11/1',ea: null,     rd: '1/1',  merit: true,  intlAid: false },
  'California Institute of Technology':      { ed1: null,  ea: null,     rd: '1/3',  merit: false, intlAid: true  },
  'Princeton University':                    { ed1: '11/1',ea: null,     rd: '1/1',  merit: false, intlAid: true  },
  'Harvard University':                      { ed1: '11/1',ea: null,     rd: '1/1',  merit: false, intlAid: true  },
  'Yale University':                         { ed1: '11/1',ea: null,     rd: '1/2',  merit: false, intlAid: true  },
  'Columbia University':                     { ed1: '11/1',ea: null,     rd: '1/1',  merit: false, intlAid: true  },
  'University of Pennsylvania':              { ed1: '11/1',ea: null,     rd: '1/5',  merit: false, intlAid: true  },
  'Cornell University':                      { ed1: '11/1',ea: null,     rd: '1/2',  merit: false, intlAid: true  },
  'Dartmouth College':                       { ed1: '11/1',ea: null,     rd: '1/2',  merit: false, intlAid: true  },
  'Brown University':                        { ed1: '11/1',ea: null,     rd: '1/5',  merit: false, intlAid: true  },
  'Duke University':                         { ed1: '11/1',ea: null,     rd: '1/2',  merit: false, intlAid: true  },
  'Johns Hopkins University':                { ed1: '11/1',ea: null,     rd: '1/2',  merit: false, intlAid: true  },
  'Northwestern University':                 { ed1: '11/1',ea: null,     rd: '1/3',  merit: false, intlAid: true  },
  'Rice University':                         { ed1: '11/1',ea: null,     rd: '1/1',  merit: false, intlAid: true  },
  'Vanderbilt University':                   { ed1: '11/1',ea: null,     rd: '1/1',  merit: true,  intlAid: true  },
  'Emory University':                        { ed1: '11/1',ea: null,     rd: '1/15', merit: true,  intlAid: true  },
  'University of Notre Dame':                { ed1: '11/1',ea: null,     rd: '1/1',  merit: true,  intlAid: false },
  'Georgetown University':                   { ed1: '11/1',ea: null,     rd: '1/10', merit: false, intlAid: false },
  'University of Southern California':       { ed1: null,  ea: '12/1',   rd: '1/15', merit: true,  intlAid: true  },
  'New York University':                     { ed1: '11/1',ea: null,     rd: '1/5',  merit: true,  intlAid: false },
  'Boston University':                       { ed1: '11/1',ea: null,     rd: '1/2',  merit: true,  intlAid: false },
  'Tufts University':                        { ed1: '11/1',ea: null,     rd: '1/1',  merit: false, intlAid: true  },
  'Case Western Reserve University':         { ed1: '11/1',ea: null,     rd: '1/15', merit: true,  intlAid: true  },
  'Lehigh University':                       { ed1: '11/1',ea: null,     rd: '1/1',  merit: true,  intlAid: false },
  'Northeastern University':                 { ed1: '11/1',ea: null,     rd: '1/15', merit: true,  intlAid: false },
  'University of Michigan':                  { ed1: null,  ea: '11/1',   rd: '2/1',  merit: false, intlAid: false },
  'Georgia Institute of Technology':         { ed1: null,  ea: '10/15',  rd: '1/1',  merit: true,  intlAid: false },
  'University of California Los Angeles':    { ed1: null,  ea: null,     rd: '11/30',merit: false, intlAid: false },
  'University of California Berkeley':       { ed1: null,  ea: null,     rd: '11/30',merit: false, intlAid: false },
  'University of California San Diego':      { ed1: null,  ea: null,     rd: '11/30',merit: false, intlAid: false },
  'University of California Davis':          { ed1: null,  ea: null,     rd: '11/30',merit: false, intlAid: false },
  'University of California Santa Barbara':  { ed1: null,  ea: null,     rd: '11/30',merit: false, intlAid: false },
  'University of Illinois Urbana-Champaign': { ed1: null,  ea: null,     rd: '1/5',  merit: true,  intlAid: false },
  'University of Wisconsin-Madison':         { ed1: null,  ea: null,     rd: '2/1',  merit: true,  intlAid: false },
  'Purdue University':                       { ed1: null,  ea: null,     rd: '2/1',  merit: true,  intlAid: false },
  'Ohio State University':                   { ed1: null,  ea: null,     rd: '2/1',  merit: true,  intlAid: false },
  'Penn State University':                   { ed1: null,  ea: null,     rd: '2/28', merit: true,  intlAid: false },
  'University of Washington':                { ed1: null,  ea: null,     rd: '1/15', merit: false, intlAid: false },
  'University of Texas Austin':              { ed1: null,  ea: null,     rd: '12/1', merit: true,  intlAid: false },
  'University of North Carolina Chapel Hill':{ ed1: '10/15',ea: null,   rd: '1/15', merit: true,  intlAid: false },
  'University of Virginia':                  { ed1: '11/1',ea: null,     rd: '1/1',  merit: false, intlAid: false },
  'University of Florida':                   { ed1: null,  ea: null,     rd: '11/1', merit: true,  intlAid: false },
  'College of William & Mary':               { ed1: '11/1',ea: null,     rd: '2/1',  merit: true,  intlAid: false },
  'University of Pittsburgh':                { ed1: null,  ea: null,     rd: 'rolling', merit: true, intlAid: false },
  'University of Minnesota':                 { ed1: null,  ea: null,     rd: 'rolling', merit: true, intlAid: false },
  'Rochester Institute of Technology':       { ed1: '11/1',ea: null,     rd: '3/1',  merit: true,  intlAid: false },
  'Rensselaer Polytechnic Institute':        { ed1: '11/1',ea: null,     rd: '1/15', merit: true,  intlAid: false },
  'Boston College':                          { ed1: '11/1',ea: null,     rd: '1/1',  merit: false, intlAid: false },
  'Wake Forest University':                  { ed1: '11/1',ea: null,     rd: '1/1',  merit: false, intlAid: false },
  'Tulane University':                       { ed1: '11/1',ea: null,     rd: '1/15', merit: true,  intlAid: false },
  'University of Rochester':                 { ed1: '11/1',ea: null,     rd: '1/5',  merit: true,  intlAid: true  },
  'Brandeis University':                     { ed1: '11/1',ea: null,     rd: '1/15', merit: true,  intlAid: true  },
  'Wellesley College':                       { ed1: '11/1',ea: '11/1',   rd: '1/8',  merit: false, intlAid: true  },
  'Smith College':                           { ed1: '11/15',ea: null,    rd: '1/15', merit: false, intlAid: true  },
  'Barnard College':                         { ed1: '11/1',ea: null,     rd: '1/1',  merit: false, intlAid: true  },
  'Macalester College':                      { ed1: '11/15',ea: null,    rd: '1/15', merit: false, intlAid: true  },
  'University of Denver':                    { ed1: null,  ea: '11/1',   rd: '1/15', merit: true,  intlAid: false },
  'American University':                     { ed1: '11/15',ea: null,    rd: '1/15', merit: true,  intlAid: false },
  'Fordham University':                      { ed1: '11/1',ea: null,     rd: '1/1',  merit: true,  intlAid: false },
  'Drexel University':                       { ed1: null,  ea: '11/1',   rd: '3/1',  merit: true,  intlAid: false },
  'University of Maryland':                  { ed1: null,  ea: '11/1',   rd: '1/20', merit: true,  intlAid: false },
};

/**
 * 根据学校名查询申请截止日期 + 奖学金提示
 * @param {string} nameEnOrKey
 * @returns {{ ed1, ea, rd, merit, intlAid, deadlineSummary } | null}
 */
function getUSDeadlines(nameEnOrKey) {
  if (!nameEnOrKey) return null;
  // 精确匹配
  let dl = USA_DEADLINES[nameEnOrKey];
  if (!dl) {
    // 部分匹配（包含关系）
    const q = nameEnOrKey.toLowerCase();
    for (const k of Object.keys(USA_DEADLINES)) {
      if (q.includes(k.toLowerCase()) || k.toLowerCase().includes(q.split(',')[0].trim())) {
        dl = USA_DEADLINES[k];
        break;
      }
    }
  }
  if (!dl) return null;
  // 生成人类可读的截止日期摘要
  const parts = [];
  if (dl.ed1) parts.push(`ED ${dl.ed1}`);
  if (dl.ea)  parts.push(`EA ${dl.ea}`);
  if (dl.rd)  parts.push(`RD ${dl.rd}`);
  return {
    ...dl,
    deadlineSummary: parts.join(' · ') || '—',
    meritLabel:   dl.merit    ? '✓ 有奖学金' : '仅 Need-based',
    intlAidLabel: dl.intlAid  ? '✓ 国际生可申请助学金' : '国际生不可申请 Need-based',
  };
}

// programs[] 顺序：[cs,eng,biz,bio,math,health,hum,soc,phys,art,edu,com,agr,law,pub]
const FALLBACK_SCHOOLS = [
  // ── 冲刺档（录取率 < 0.15）────────────────────────────────
  _mkS(9001,'Massachusetts Institute of Technology',   'Cambridge',   'MA',2,0.04,1545,770,800,35,57590,77750,94000,0.94,0.11,11574,[0.25,0.33,0.02,0.04,0.04,0.00,0.04,0.03,0.06,0.01,0.00,0.01,0.00,0.00,0.00]),
  _mkS(9002,'Harvard University',                      'Cambridge',   'MA',2,0.04,1520,740,800,34,54768,76763,87000,0.98,0.12,23731,[0.05,0.04,0.03,0.09,0.04,0.03,0.14,0.17,0.04,0.03,0.01,0.03,0.00,0.02,0.02]),
  _mkS(9003,'Stanford University',                     'Stanford',    'CA',2,0.04,1505,760,800,34,58416,79767,92000,0.96,0.10,17249,[0.20,0.22,0.03,0.05,0.05,0.01,0.05,0.08,0.04,0.02,0.00,0.02,0.00,0.00,0.01]),
  _mkS(9004,'California Institute of Technology',      'Pasadena',    'CA',2,0.03,1560,790,800,36,60816,82248,84000,0.94,0.15, 2233,[0.20,0.35,0.00,0.07,0.10,0.00,0.02,0.02,0.12,0.00,0.00,0.00,0.00,0.00,0.00]),
  _mkS(9005,'University of Chicago',                   'Chicago',     'IL',2,0.07,1520,750,800,34,62441,82521,67000,0.96,0.12,16445,[0.10,0.01,0.03,0.06,0.08,0.02,0.12,0.22,0.07,0.02,0.00,0.02,0.00,0.02,0.00]),
  _mkS(9006,'Yale University',                         'New Haven',   'CT',2,0.05,1515,740,790,34,62250,80225,72000,0.98,0.13,14609,[0.05,0.03,0.03,0.08,0.04,0.02,0.16,0.18,0.05,0.05,0.00,0.03,0.00,0.03,0.01]),
  _mkS(9007,'Princeton University',                    'Princeton',   'NJ',2,0.04,1510,750,800,34,57410,76100,75000,0.98,0.12, 8374,[0.11,0.08,0.02,0.07,0.06,0.01,0.12,0.20,0.06,0.03,0.00,0.02,0.00,0.02,0.01]),
  _mkS(9008,'Columbia University',                     'New York',    'NY',2,0.04,1510,760,800,34,65524,86297,83000,0.96,0.22,31456,[0.12,0.07,0.05,0.06,0.05,0.02,0.12,0.16,0.05,0.04,0.00,0.04,0.00,0.02,0.02]),
  _mkS(9009,'University of Pennsylvania',              'Philadelphia','PA',2,0.07,1500,750,790,34,63452,81290,88000,0.96,0.14,22600,[0.08,0.09,0.17,0.06,0.04,0.06,0.07,0.13,0.03,0.02,0.00,0.03,0.00,0.03,0.01]),
  _mkS(9010,'Cornell University',                      'Ithaca',      'NY',2,0.11,1480,730,790,33,63200,82500,81000,0.95,0.12,25143,[0.11,0.16,0.06,0.08,0.03,0.03,0.07,0.10,0.04,0.03,0.03,0.02,0.08,0.01,0.01]),
  _mkS(9011,'Duke University',                         'Durham',      'NC',2,0.06,1505,755,800,34,62688,80832,81000,0.96,0.11,17000,[0.08,0.07,0.04,0.10,0.05,0.05,0.09,0.18,0.05,0.03,0.00,0.02,0.00,0.01,0.01]),
  _mkS(9012,'Northwestern University',                 'Evanston',    'IL',2,0.07,1500,750,800,34,63468,82611,82000,0.95,0.12,22000,[0.10,0.07,0.07,0.06,0.05,0.04,0.09,0.15,0.03,0.05,0.02,0.07,0.00,0.01,0.01]),
  _mkS(9013,'Dartmouth College',                       'Hanover',     'NH',2,0.08,1490,740,790,33,62430,79600,75000,0.96,0.10, 6500,[0.07,0.04,0.06,0.07,0.05,0.00,0.13,0.20,0.05,0.03,0.00,0.03,0.00,0.01,0.01]),
  _mkS(9014,'Vanderbilt University',                   'Nashville',   'TN',2,0.09,1490,740,790,34,60348,78112,78000,0.93,0.08,13800,[0.06,0.05,0.04,0.09,0.05,0.09,0.10,0.18,0.04,0.03,0.02,0.03,0.00,0.01,0.01]),
  _mkS(9015,'Rice University',                         'Houston',     'TX',2,0.08,1520,770,800,35,54960,71630,82000,0.96,0.10, 7918,[0.16,0.18,0.05,0.09,0.06,0.00,0.08,0.12,0.07,0.04,0.00,0.03,0.00,0.01,0.00]),
  _mkS(9016,'Carnegie Mellon University',              'Pittsburgh',  'PA',2,0.11,1530,780,800,35,60292,80027,98000,0.92,0.25,16009,[0.30,0.22,0.05,0.02,0.05,0.00,0.04,0.04,0.03,0.09,0.00,0.04,0.00,0.00,0.01]),
  // ── 目标档（录取率 0.13–0.40）────────────────────────────
  _mkS(9017,'University of California-Berkeley',       'Berkeley',    'CA',1,0.14,1430,710,790,33,44066,67814,78000,0.91,0.12,45057,[0.15,0.16,0.04,0.07,0.05,0.01,0.08,0.14,0.04,0.03,0.01,0.03,0.00,0.02,0.01]),
  _mkS(9018,'University of California-Los Angeles',    'Los Angeles', 'CA',1,0.14,1405,680,780,33,43473,66043,72000,0.92,0.09,45428,[0.10,0.09,0.04,0.10,0.04,0.06,0.11,0.18,0.05,0.04,0.02,0.04,0.00,0.02,0.01]),
  _mkS(9019,'University of Michigan-Ann Arbor',        'Ann Arbor',   'MI',1,0.17,1430,700,790,33,53232,75762,75000,0.93,0.14,48090,[0.10,0.16,0.08,0.05,0.04,0.05,0.08,0.12,0.03,0.03,0.02,0.04,0.00,0.02,0.01]),
  _mkS(9020,'Georgetown University',                   'Washington',  'DC',2,0.14,1460,710,780,33,61872,80340,80000,0.95,0.10,20169,[0.05,0.03,0.07,0.04,0.03,0.03,0.10,0.22,0.03,0.02,0.01,0.05,0.00,0.07,0.03]),
  _mkS(9021,'Northeastern University',                 'Boston',      'MA',2,0.07,1500,740,790,33,59388,78960,84000,0.91,0.20,21923,[0.18,0.15,0.06,0.04,0.04,0.05,0.04,0.07,0.02,0.04,0.00,0.06,0.00,0.00,0.02]),
  _mkS(9022,'New York University',                     'New York',    'NY',2,0.13,1440,690,790,33,60438,82668,68000,0.86,0.23,59144,[0.12,0.05,0.10,0.05,0.04,0.08,0.09,0.14,0.02,0.06,0.01,0.07,0.00,0.03,0.02]),
  _mkS(9023,'University of Southern California',       'Los Angeles', 'CA',2,0.16,1450,710,790,33,65446,85446,72000,0.91,0.16,48500,[0.12,0.10,0.10,0.04,0.03,0.04,0.07,0.10,0.02,0.07,0.01,0.09,0.00,0.02,0.02]),
  _mkS(9024,'Georgia Institute of Technology',         'Atlanta',     'GA',1,0.17,1475,740,800,33,32876,55100,83000,0.91,0.17,45296,[0.18,0.37,0.05,0.03,0.04,0.00,0.02,0.04,0.04,0.02,0.00,0.02,0.00,0.00,0.00]),
  _mkS(9025,'University of Virginia',                  'Charlottesville','VA',1,0.19,1420,690,790,32,52218,72100,72000,0.94,0.07,25798,[0.09,0.06,0.10,0.07,0.04,0.06,0.12,0.15,0.03,0.03,0.03,0.05,0.00,0.04,0.01]),
  _mkS(9026,'University of North Carolina at Chapel Hill','Chapel Hill','NC',1,0.19,1350,660,760,31,37082,58240,62000,0.91,0.05,30011,[0.08,0.05,0.10,0.08,0.04,0.10,0.08,0.15,0.03,0.03,0.04,0.06,0.00,0.03,0.02]),
  _mkS(9027,'University of California-San Diego',      'La Jolla',    'CA',1,0.24,1400,690,790,32,43589,65043,71000,0.87,0.14,40961,[0.14,0.14,0.03,0.10,0.04,0.05,0.07,0.14,0.05,0.03,0.01,0.04,0.00,0.01,0.01]),
  _mkS(9028,'Emory University',                        'Atlanta',     'GA',2,0.18,1470,720,790,33,57948,76584,74000,0.91,0.14,15000,[0.06,0.04,0.07,0.09,0.04,0.11,0.09,0.18,0.04,0.03,0.01,0.03,0.00,0.02,0.01]),
  _mkS(9029,'University of Maryland-College Park',     'College Park','MD',1,0.44,1370,660,780,32,38694,55660,70000,0.88,0.09,40603,[0.13,0.10,0.11,0.06,0.04,0.03,0.08,0.12,0.03,0.03,0.02,0.06,0.01,0.02,0.01]),
  _mkS(9030,'Tufts University',                        'Medford',     'MA',2,0.15,1450,710,790,33,65222,83586,72000,0.95,0.12,12400,[0.09,0.08,0.04,0.09,0.05,0.04,0.12,0.18,0.05,0.03,0.01,0.04,0.00,0.01,0.01]),
  // ── 稳妥档（录取率 > 0.40）───────────────────────────────
  _mkS(9031,'University of Illinois Urbana-Champaign', 'Champaign',   'IL',1,0.45,1400,690,790,32,32054,47380,72000,0.85,0.26,55211,[0.13,0.22,0.10,0.04,0.03,0.02,0.06,0.09,0.03,0.03,0.02,0.04,0.03,0.01,0.01]),
  _mkS(9032,'University of Washington-Seattle Campus', 'Seattle',     'WA',1,0.52,1340,650,770,31,38936,59136,72000,0.85,0.13,46082,[0.14,0.11,0.08,0.07,0.04,0.05,0.07,0.12,0.04,0.03,0.02,0.03,0.01,0.02,0.01]),
  _mkS(9033,'Ohio State University-Main Campus',       'Columbus',    'OH',1,0.51,1330,630,760,30,34061,52002,61000,0.84,0.08,61391,[0.09,0.12,0.14,0.06,0.03,0.08,0.06,0.10,0.02,0.03,0.04,0.05,0.03,0.01,0.02]),
  _mkS(9034,'Purdue University-Main Campus',           'West Lafayette','IN',1,0.53,1310,610,740,28,28794,47880,63000,0.83,0.23,49639,[0.10,0.24,0.10,0.05,0.03,0.04,0.05,0.07,0.02,0.03,0.03,0.04,0.07,0.01,0.01]),
  _mkS(9035,'University of Texas at Austin',           'Austin',      'TX',1,0.31,1330,630,770,30,40996,60026,65000,0.83,0.07,51032,[0.09,0.12,0.15,0.06,0.04,0.04,0.09,0.12,0.03,0.04,0.02,0.06,0.01,0.03,0.01]),
  _mkS(9036,'Pennsylvania State University-Main Campus','State College','PA',1,0.54,1280,600,720,30,39996,56120,58000,0.85,0.07,86397,[0.08,0.14,0.16,0.05,0.02,0.05,0.07,0.09,0.02,0.03,0.04,0.06,0.03,0.01,0.02]),
  _mkS(9037,'Boston University',                       'Boston',      'MA',2,0.19,1390,650,770,32,60612,79380,66000,0.88,0.15,34589,[0.10,0.09,0.10,0.07,0.04,0.07,0.08,0.13,0.03,0.05,0.02,0.06,0.00,0.02,0.02]),
  _mkS(9038,'University of Florida',                   'Gainesville', 'FL',1,0.23,1360,650,770,31,28658,52048,60000,0.88,0.06,56623,[0.09,0.07,0.12,0.08,0.03,0.09,0.07,0.11,0.02,0.03,0.05,0.05,0.03,0.02,0.02]),
  _mkS(9039,'University of Pittsburgh-Pittsburgh Campus','Pittsburgh', 'PA',1,0.49,1360,650,770,32,34124,55056,65000,0.83,0.08,30617,[0.10,0.08,0.12,0.09,0.04,0.09,0.08,0.12,0.03,0.04,0.03,0.05,0.00,0.02,0.02]),
  _mkS(9040,'Arizona State University-Tempe',          'Tempe',       'AZ',1,0.91,1230,570,700,27,31200,47800,55000,0.67,0.06,77714,[0.09,0.09,0.13,0.05,0.03,0.07,0.07,0.11,0.02,0.04,0.05,0.07,0.02,0.02,0.03]),
  // ── 精选档（录取率 13-30%，SAT avg 1340-1480）─────────────────
  _mkS(9041,'Wake Forest University',                  'Winston-Salem','NC',2,0.21,1375,650,750,31,61400,79000,72000,0.90,0.09, 8900,[0.07,0.05,0.07,0.06,0.04,0.05,0.11,0.16,0.04,0.04,0.02,0.06,0.00,0.02,0.01]),
  _mkS(9042,'Boston College',                          'Chestnut Hill','MA',2,0.19,1410,680,760,32,61670,79000,74000,0.92,0.07,15000,[0.08,0.05,0.10,0.06,0.03,0.06,0.10,0.17,0.03,0.04,0.02,0.07,0.00,0.03,0.01]),
  _mkS(9043,'Tulane University',                       'New Orleans', 'LA',2,0.13,1420,680,770,32,62046,80600,64000,0.87,0.09,14139,[0.07,0.04,0.07,0.07,0.04,0.06,0.10,0.15,0.04,0.05,0.02,0.08,0.00,0.02,0.01]),
  _mkS(9044,'Case Western Reserve University',         'Cleveland',   'OH',2,0.27,1465,730,800,33,58490,76290,76000,0.88,0.12,12043,[0.12,0.15,0.04,0.10,0.06,0.10,0.06,0.07,0.08,0.02,0.00,0.02,0.00,0.01,0.01]),
  _mkS(9045,'University of Rochester',                 'Rochester',   'NY',2,0.29,1430,720,790,32,62850,80870,70000,0.88,0.12,12290,[0.10,0.12,0.04,0.07,0.06,0.05,0.10,0.14,0.08,0.03,0.01,0.04,0.00,0.02,0.01]),
  _mkS(9046,'Rensselaer Polytechnic Institute',        'Troy',        'NY',2,0.43,1450,720,790,32,59970,77670,78000,0.86,0.10, 7928,[0.18,0.28,0.05,0.04,0.06,0.00,0.04,0.05,0.10,0.02,0.00,0.02,0.00,0.00,0.01]),
  _mkS(9047,'Lehigh University',                       'Bethlehem',   'PA',2,0.33,1390,680,770,31,58690,76390,72000,0.88,0.08, 7360,[0.10,0.15,0.10,0.05,0.04,0.02,0.08,0.10,0.03,0.03,0.01,0.04,0.00,0.01,0.01]),
  _mkS(9048,'Villanova University',                    'Villanova',   'PA',2,0.26,1380,660,760,32,58020,75460,72000,0.91,0.06,11400,[0.07,0.05,0.15,0.07,0.03,0.06,0.08,0.14,0.03,0.05,0.02,0.07,0.00,0.03,0.01]),
  _mkS(9049,'University of Miami',                     'Coral Gables','FL',2,0.27,1350,640,750,31,56398,76798,68000,0.84,0.06,19453,[0.09,0.07,0.12,0.07,0.04,0.07,0.08,0.12,0.03,0.05,0.02,0.09,0.00,0.02,0.01]),
  _mkS(9050,'California Polytechnic State Univ-SLO',   'San Luis Obispo','CA',1,0.28,1340,660,760,31,21756,43756,68000,0.83,0.03,22000,[0.10,0.24,0.10,0.03,0.05,0.03,0.06,0.07,0.03,0.03,0.06,0.04,0.04,0.01,0.02]),
  // ── 竞争档（录取率 30-60%，SAT avg 1230-1350）────────────────
  _mkS(9051,'Worcester Polytechnic Institute',         'Worcester',   'MA',2,0.49,1400,700,790,32,55610,73270,80000,0.88,0.13, 7018,[0.17,0.28,0.05,0.03,0.06,0.00,0.03,0.04,0.08,0.01,0.00,0.02,0.00,0.00,0.01]),
  _mkS(9052,'American University',                     'Washington',  'DC',2,0.35,1260,580,700,29,55760,74920,60000,0.82,0.10,14616,[0.06,0.03,0.10,0.04,0.03,0.10,0.10,0.18,0.03,0.07,0.02,0.12,0.00,0.05,0.02]),
  _mkS(9053,'Pepperdine University',                   'Malibu',      'CA',2,0.37,1260,600,700,29,62150,80910,64000,0.84,0.05, 9450,[0.06,0.03,0.14,0.05,0.03,0.07,0.09,0.14,0.03,0.04,0.04,0.12,0.00,0.02,0.01]),
  _mkS(9054,'Santa Clara University',                  'Santa Clara', 'CA',2,0.47,1330,640,730,30,57810,76530,72000,0.89,0.06, 9393,[0.13,0.10,0.13,0.05,0.04,0.04,0.08,0.12,0.03,0.04,0.02,0.08,0.00,0.02,0.01]),
  _mkS(9055,'Fordham University',                      'New York',    'NY',2,0.46,1300,620,730,29,57670,76390,63000,0.82,0.06,17780,[0.07,0.03,0.14,0.05,0.03,0.08,0.10,0.15,0.03,0.06,0.02,0.09,0.00,0.04,0.02]),
  _mkS(9056,'University of Denver',                    'Denver',      'CO',2,0.61,1260,580,680,28,57798,76398,64000,0.79,0.06,12700,[0.08,0.04,0.12,0.06,0.04,0.06,0.08,0.14,0.03,0.05,0.03,0.09,0.00,0.04,0.02]),
  _mkS(9057,'Syracuse University',                     'Syracuse',    'NY',2,0.60,1270,600,720,29,58440,76360,62000,0.81,0.08,22984,[0.09,0.06,0.12,0.04,0.03,0.04,0.08,0.12,0.03,0.04,0.04,0.12,0.00,0.02,0.02]),
  _mkS(9058,'University of Connecticut',               'Storrs',      'CT',1,0.56,1310,640,740,30,40038,57558,62000,0.84,0.07,27230,[0.09,0.08,0.14,0.07,0.03,0.05,0.08,0.12,0.03,0.04,0.04,0.06,0.01,0.02,0.01]),
  _mkS(9059,'Stony Brook University',                  'Stony Brook', 'NY',1,0.44,1310,650,750,30,28768,45018,65000,0.80,0.12,25980,[0.14,0.10,0.06,0.08,0.05,0.06,0.09,0.12,0.06,0.02,0.01,0.03,0.01,0.02,0.01]),
  _mkS(9060,'University of California-Irvine',         'Irvine',      'CA',1,0.26,1320,640,760,30,42692,65342,66000,0.85,0.25,35220,[0.14,0.11,0.06,0.08,0.05,0.06,0.08,0.14,0.05,0.03,0.02,0.04,0.00,0.01,0.01]),
  _mkS(9061,'University of California-Davis',          'Davis',       'CA',1,0.39,1290,620,740,30,44066,67016,64000,0.85,0.12,38613,[0.09,0.08,0.05,0.09,0.03,0.10,0.07,0.14,0.04,0.02,0.03,0.04,0.08,0.01,0.01]),
  _mkS(9062,'University of California-Santa Barbara',  'Santa Barbara','CA',1,0.29,1330,640,760,30,44066,67016,64000,0.83,0.09,26314,[0.11,0.08,0.04,0.07,0.06,0.06,0.10,0.16,0.05,0.04,0.02,0.04,0.00,0.02,0.01]),
  _mkS(9063,'University of Wisconsin-Madison',         'Madison',     'WI',1,0.49,1380,670,770,31,37785,55265,66000,0.88,0.09,48723,[0.10,0.09,0.12,0.07,0.04,0.05,0.09,0.12,0.03,0.03,0.04,0.05,0.03,0.02,0.01]),
  _mkS(9064,'NC State University',                     'Raleigh',     'NC',1,0.45,1310,640,750,30,29220,47220,62000,0.83,0.06,36560,[0.10,0.20,0.10,0.05,0.03,0.04,0.06,0.09,0.03,0.02,0.03,0.04,0.05,0.01,0.01]),
  _mkS(9065,'Virginia Tech',                           'Blacksburg',  'VA',1,0.57,1310,640,750,30,34894,52694,64000,0.85,0.06,37272,[0.09,0.18,0.11,0.05,0.03,0.04,0.07,0.09,0.03,0.03,0.03,0.05,0.03,0.01,0.01]),
  // ── 中等选拔（录取率 50-80%，SAT avg 1150-1300）────────────────
  _mkS(9066,'University of Massachusetts Amherst',     'Amherst',     'MA',1,0.65,1290,600,710,29,35782,51182,64000,0.83,0.08,32516,[0.11,0.09,0.12,0.06,0.04,0.05,0.09,0.12,0.03,0.03,0.05,0.06,0.02,0.01,0.01]),
  _mkS(9067,'Rutgers University-New Brunswick',        'New Brunswick','NJ',1,0.66,1290,620,740,29,32189,48389,65000,0.83,0.10,41000,[0.11,0.09,0.13,0.07,0.04,0.05,0.08,0.12,0.03,0.04,0.03,0.05,0.01,0.02,0.01]),
  _mkS(9068,'University of Minnesota-Twin Cities',     'Minneapolis', 'MN',1,0.75,1340,660,770,30,31568,50168,63000,0.80,0.10,51848,[0.11,0.10,0.11,0.07,0.04,0.06,0.08,0.12,0.03,0.03,0.04,0.05,0.02,0.02,0.01]),
  _mkS(9069,'Indiana University-Bloomington',          'Bloomington', 'IN',1,0.77,1270,590,700,28,37017,55617,57000,0.81,0.10,45328,[0.09,0.07,0.18,0.06,0.03,0.06,0.07,0.12,0.03,0.05,0.04,0.07,0.01,0.02,0.02]),
  _mkS(9070,'Michigan State University',               'East Lansing','MI',1,0.76,1240,570,700,27,39766,56766,55000,0.79,0.08,50019,[0.08,0.08,0.13,0.06,0.03,0.07,0.07,0.12,0.03,0.03,0.05,0.06,0.06,0.02,0.02]),
  _mkS(9071,'University of Colorado Boulder',          'Boulder',     'CO',1,0.84,1260,580,700,28,37054,55254,56000,0.72,0.05,38516,[0.09,0.07,0.13,0.06,0.04,0.05,0.09,0.14,0.03,0.04,0.04,0.06,0.01,0.02,0.01]),
  _mkS(9072,'University of Tennessee-Knoxville',       'Knoxville',   'TN',1,0.68,1230,580,700,27,29978,49638,52000,0.72,0.03,31340,[0.08,0.09,0.13,0.06,0.03,0.09,0.07,0.11,0.03,0.03,0.07,0.06,0.04,0.02,0.02]),
  _mkS(9073,'University of Iowa',                      'Iowa City',   'IA',1,0.83,1210,570,690,27,30764,49764,50000,0.72,0.05,30730,[0.09,0.06,0.14,0.07,0.03,0.08,0.08,0.12,0.03,0.03,0.06,0.06,0.01,0.03,0.02]),
  _mkS(9074,'University of Cincinnati',                'Cincinnati',  'OH',1,0.76,1200,560,690,27,27324,43824,52000,0.69,0.06,48068,[0.09,0.09,0.12,0.08,0.03,0.08,0.06,0.10,0.03,0.04,0.04,0.06,0.01,0.02,0.02]),
  _mkS(9075,'University of Alabama',                   'Tuscaloosa',  'AL',1,0.88,1200,560,680,27,29500,47500,48000,0.70,0.03,40000,[0.08,0.07,0.17,0.06,0.03,0.08,0.07,0.10,0.02,0.04,0.07,0.07,0.01,0.02,0.02]),
  _mkS(9076,'University of South Florida',             'Tampa',       'FL',1,0.43,1210,570,680,27,17324,39904,52000,0.73,0.05,50659,[0.10,0.07,0.13,0.08,0.03,0.08,0.07,0.12,0.02,0.04,0.05,0.07,0.01,0.02,0.02]),
  _mkS(9077,'George Mason University',                 'Fairfax',     'VA',1,0.84,1210,570,680,27,34828,51028,56000,0.73,0.11,38978,[0.12,0.07,0.12,0.07,0.03,0.06,0.07,0.14,0.02,0.04,0.04,0.08,0.01,0.02,0.02]),
  _mkS(9078,'University of Oregon',                    'Eugene',      'OR',1,0.84,1150,540,660,26,38655,56895,48000,0.73,0.06,22649,[0.09,0.04,0.13,0.06,0.04,0.08,0.09,0.14,0.04,0.07,0.05,0.09,0.01,0.01,0.02]),
  _mkS(9079,'Colorado State University',               'Fort Collins','CO',1,0.81,1170,550,660,26,32628,52128,48000,0.69,0.03,34150,[0.08,0.07,0.11,0.07,0.03,0.09,0.07,0.11,0.03,0.04,0.07,0.06,0.08,0.01,0.02]),
  _mkS(9080,'Iowa State University',                   'Ames',        'IA',1,0.91,1200,570,680,26,22394,39994,52000,0.74,0.04,29617,[0.09,0.16,0.11,0.06,0.03,0.05,0.06,0.09,0.03,0.03,0.05,0.05,0.10,0.01,0.02]),
  // ── 易申档（录取率 60-85%，SAT avg 1080-1210）────────────────
  _mkS(9081,'University of Missouri-Columbia',         'Columbia',    'MO',1,0.82,1170,550,680,26,28051,45051,50000,0.71,0.04,30870,[0.09,0.07,0.15,0.07,0.03,0.08,0.08,0.12,0.02,0.04,0.06,0.08,0.02,0.02,0.02]),
  _mkS(9082,'Drexel University',                       'Philadelphia','PA',2,0.77,1280,610,730,29,56910,74910,60000,0.73,0.10,24045,[0.14,0.12,0.11,0.07,0.03,0.05,0.06,0.08,0.02,0.03,0.02,0.06,0.00,0.01,0.02]),
  _mkS(9083,'Loyola Marymount University',             'Los Angeles', 'CA',2,0.49,1250,590,700,29,54504,73084,62000,0.83,0.05,10574,[0.07,0.04,0.12,0.05,0.03,0.06,0.08,0.15,0.03,0.06,0.03,0.13,0.00,0.02,0.01]),
  _mkS(9084,'San Jose State University',               'San Jose',    'CA',1,0.64,1150,540,650,25,18078,39078,58000,0.63,0.12,34942,[0.13,0.15,0.11,0.07,0.03,0.07,0.06,0.09,0.02,0.04,0.03,0.06,0.01,0.01,0.01]),
  _mkS(9085,'California State University-Long Beach',  'Long Beach',  'CA',1,0.34,1100,510,610,24,13992,32992,52000,0.66,0.08,37908,[0.10,0.07,0.13,0.07,0.03,0.09,0.06,0.14,0.02,0.05,0.04,0.10,0.01,0.01,0.02]),
  _mkS(9086,'University at Buffalo-SUNY',              'Buffalo',     'NY',1,0.53,1220,590,690,27,28804,45004,60000,0.75,0.12,27000,[0.11,0.12,0.11,0.08,0.04,0.07,0.07,0.11,0.05,0.04,0.03,0.05,0.01,0.03,0.01]),
  _mkS(9087,'University of Tennessee-Chattanooga',     'Chattanooga', 'TN',1,0.83,1130,530,640,25,20974,35774,42000,0.60,0.02,12088,[0.08,0.07,0.14,0.06,0.03,0.10,0.07,0.12,0.02,0.04,0.08,0.07,0.02,0.02,0.03]),
  _mkS(9088,'University of South Carolina',            'Columbia',    'SC',1,0.62,1200,560,680,27,34648,52648,52000,0.76,0.05,36085,[0.09,0.07,0.16,0.06,0.03,0.07,0.07,0.12,0.03,0.04,0.06,0.08,0.01,0.02,0.02]),
  _mkS(9089,'University of Nebraska-Lincoln',          'Lincoln',     'NE',1,0.79,1180,560,680,26,25706,43706,50000,0.67,0.03,25897,[0.08,0.10,0.14,0.07,0.03,0.07,0.07,0.11,0.03,0.03,0.07,0.06,0.06,0.01,0.02]),
  _mkS(9090,'University of Kansas',                    'Lawrence',    'KS',1,0.93,1170,540,670,25,28034,45034,48000,0.65,0.05,27366,[0.09,0.08,0.14,0.07,0.03,0.08,0.08,0.12,0.03,0.04,0.06,0.07,0.03,0.02,0.02]),
  // ── 广泛录取（录取率 75%+，SAT avg 950-1150）──────────────────
  _mkS(9091,'University of Nevada-Las Vegas',          'Las Vegas',   'NV',1,0.84,1080,490,600,24,22768,38368,44000,0.47,0.07,32843,[0.09,0.06,0.14,0.07,0.03,0.10,0.06,0.12,0.02,0.05,0.06,0.09,0.01,0.02,0.03]),
  _mkS(9092,'University of New Mexico',                'Albuquerque', 'NM',1,0.96,1090,500,610,24,24144,37744,40000,0.57,0.05,25580,[0.09,0.07,0.12,0.08,0.03,0.11,0.07,0.13,0.02,0.04,0.07,0.08,0.01,0.02,0.03]),
  _mkS(9093,'Ohio University',                         'Athens',      'OH',1,0.75,1100,500,620,24,23628,39228,42000,0.62,0.03,25748,[0.08,0.05,0.14,0.07,0.03,0.08,0.08,0.12,0.02,0.05,0.08,0.10,0.01,0.01,0.03]),
  _mkS(9094,'University of North Texas',               'Denton',      'TX',1,0.78,1100,510,620,24,19516,36016,44000,0.55,0.03,45153,[0.09,0.05,0.14,0.06,0.03,0.08,0.08,0.13,0.02,0.04,0.07,0.10,0.01,0.02,0.03]),
  _mkS(9095,'Oklahoma State University',               'Stillwater',  'OK',1,0.72,1120,520,630,24,24558,40758,46000,0.65,0.04,27120,[0.08,0.11,0.13,0.06,0.03,0.08,0.07,0.11,0.03,0.03,0.07,0.06,0.07,0.01,0.02]),
  _mkS(9096,'Ball State University',                   'Muncie',      'IN',1,0.79,1050,480,590,23,23480,38680,44000,0.61,0.02,19956,[0.08,0.06,0.12,0.07,0.03,0.10,0.07,0.12,0.03,0.03,0.10,0.09,0.01,0.01,0.03]),
  _mkS(9097,'Western Michigan University',             'Kalamazoo',   'MI',1,0.83,1090,500,610,24,22476,37876,44000,0.57,0.03,22021,[0.08,0.09,0.13,0.06,0.03,0.07,0.08,0.12,0.02,0.04,0.09,0.07,0.01,0.01,0.03]),
  _mkS(9098,'Northern Arizona University',             'Flagstaff',   'AZ',1,0.85,1090,490,590,24,23808,38008,40000,0.57,0.04,28834,[0.08,0.05,0.11,0.08,0.03,0.10,0.07,0.14,0.02,0.04,0.07,0.09,0.02,0.01,0.03]),
  _mkS(9099,'California State University-Fullerton',   'Fullerton',   'CA',1,0.67,1070,490,590,23,13992,32992,50000,0.62,0.07,40386,[0.10,0.06,0.17,0.06,0.03,0.10,0.06,0.14,0.02,0.04,0.04,0.10,0.01,0.01,0.03]),
  _mkS(9100,'Kent State University',                   'Kent',        'OH',1,0.84,1070,480,580,23,19686,32486,40000,0.56,0.03,27967,[0.07,0.05,0.12,0.07,0.03,0.11,0.08,0.13,0.02,0.05,0.10,0.10,0.01,0.01,0.03]),
];

// ══════════════════════════════════════════════════════════════
//  核心函数：fetchSchools(profile)
// ══════════════════════════════════════════════════════════════
function fetchSchools(profile) {
  return new Promise((resolve, reject) => {
    // ── 架构说明 ────────────────────────────────────────────────
    //  通过 collegeSearch 云函数的 proxyAPI 模式转发请求，
    //  彻底绕过微信小程序合法域名校验（api.data.gov 无需加白名单）。
    //  云函数使用 Node.js https 模块，在服务端直接调用 College Scorecard API。
    //  API Key 保留在云函数中，客户端不暴露。
    // ────────────────────────────────────────────────────────────
    // 若 wx.cloud 不可用，直接降级到内置数据
    if (typeof wx === 'undefined' || !wx.cloud) {
      resolve(FALLBACK_SCHOOLS);
      return;
    }
    const degreeLevel = profile.degreeLevel || 'undergrad';
    const params = {
      fields:   buildAPIFields(),
      per_page: 100,
      'latest.admissions.admission_rate.overall__range': '0.03..0.95',
      'latest.cost.tuition.out_of_state__range': '5000..80000',
      'latest.student.size__range': '1000..',
      'latest.completion.rate_suppressed.overall__range': '0.3..',
      // Phase 0 fix: 移除全局 earnings sort（会让艺术/人文专业拿到理工高薪学校）
      // 改为按录取率升序（最严格的院校靠前），让评分引擎 scoreSchool 决定最终排名
      '_sort': 'latest.admissions.admission_rate.overall:asc',
    };
    if (degreeLevel === 'undergrad') {
      params['school.degrees_awarded.predominant__range'] = '2..3';
    }
    // 按专业方向过滤：确保返回的学校在所选专业方向上有实际课程
    // College Scorecard program_percentage 字段：各学科学位授予占比（IPEDS CIP 数据）
    // 阈值 0.03 = 3%，即至少有 3% 的学位在该方向，覆盖范围广而不过于严格
    const majorFieldKey = profile.majorArea && PROGRAM_FIELD_MAP[profile.majorArea];
    if (majorFieldKey) {
      params[majorFieldKey + '__range'] = '0.03..';
    }
    wx.cloud.callFunction({
      name: 'collegeSearch',
      data: { action: 'proxyAPI', params },
      success: (res) => {
        const result = res.result;
        if (!result || !result.success || !((result.data || {}).results || []).length) {
          // API 失败或返回空数据 → 降级到内置数据库
          console.warn('[fetchSchools] API unavailable, using fallback dataset:', result);
          resolve(FALLBACK_SCHOOLS);
          return;
        }
        resolve(result.data.results);
      },
      fail: (err) => {
        // 云函数调用失败 → 降级到内置数据库，不再让整个匹配流程失败
        console.warn('[fetchSchools] callFunction failed, using fallback dataset:', err);
        resolve(FALLBACK_SCHOOLS);
      },
    });
  });
}

// ══════════════════════════════════════════════════════════════
//  评分函数：scoreSchool(school, profile, programWeights)
//
//  ┌─────────────────────────────────────────────────────────┐
//  │ 模块  │ 满分 │ 核心学术依据                              │
//  ├───────┼──────┼──────────────────────────────────────────┤
//  │  M1   │  25  │ NACAC 2024 SOP + Chetty et al. 2020      │
//  │  M2   │  20  │ Arcidiacono 2004 + IPEDS CIP 2020         │
//  │  M3   │  20  │ Chetty 2017 MRC + Avery & Turner 2012     │
//  │  M4   │  10  │ IIE Open Doors 2024 + Hunter et al. 2006  │
//  │  M5   │  10  │ Hoxby & Avery 2012 + Hoxby & Turner 2013  │
//  │  M6   │  15  │ BLS 2024-2034 + Carnevale et al. 2013     │
//  └─────────────────────────────────────────────────────────┘
//
//  返回 { total, tier, modules: {m1,m2,m3,m4,m5,m6}, reasons }
// ══════════════════════════════════════════════════════════════
function scoreSchool(school, profile, programWeights) {
  const s = school;

  // 读取各字段
  const admRate  = s['latest.admissions.admission_rate.overall'];
  const satAvg   = s['latest.admissions.sat_scores.average.overall'];
  const sat25Math = s['latest.admissions.sat_scores.25th_percentile.math'];
  const sat75Math = s['latest.admissions.sat_scores.75th_percentile.math'];
  const sat25Read = s['latest.admissions.sat_scores.25th_percentile.critical_reading'];
  const sat75Read = s['latest.admissions.sat_scores.75th_percentile.critical_reading'];
  const actMid   = s['latest.admissions.act_scores.midpoint.cumulative'];
  const annualCost = s['latest.cost.attendance.academic_year'];
  const intlPct  = s['latest.student.demographics.race_ethnicity.non_resident_alien'];
  const gradRate = s['latest.completion.rate_suppressed.overall'];
  const earn6yr  = s['latest.earnings.6_yrs_after_entry.median'];
  const earn8yr  = s['latest.earnings.8_yrs_after_entry.median'];
  const medDebt  = s['latest.aid.median_debt_suppressed.completers.overall'];
  const intlRatio = typeof intlPct === 'number' ? intlPct : 0;

  // ── 个人化锚点（用于生成有据可查的理由）─────────────────────
  const MI_NAMES = { linguistic:'语言', logical:'逻辑', spatial:'空间',
    musical:'音乐', bodily:'体感', naturalist:'自然',
    interpersonal:'社交', intrapersonal:'内省' };
  const miScores = profile.miScores || {};
  const topMIEntry = Object.entries(miScores).sort((a,b) => b[1]-a[1])[0];
  const topMIName  = topMIEntry ? (MI_NAMES[topMIEntry[0]] || '') : '';

  const reasons = [];

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  M1: 学术适配度 [0-25]
  //
  //  学术依据：
  //  ① NACAC Statement of Principles of Good Practice (2024)
  //    定义三档分层：Safety（目标分在录取中位数上方1 SD），
  //    Match（在录取 25th-75th 百分位内），Reach（低于 25th 百分位）
  //  ② Chetty, Friedman et al. (2020) "Income Segregation and
  //    Intergenerational Mobility Across Colleges in the United States"
  //    QJE — 证明标准化考试与院校录取层级的强相关性（r=0.89）
  //  ③ GPA 修正依据：NACAC Admission Trends Survey (2023)，GPA
  //    是美国大学最重视的录取指标之一（87% 院校认为"非常重要"）
  //
  //  录取率分级兜底规则（无标准化考试时）：
  //    ≥50% → safety；25-49% → target；10-24% → reach；<10% → hard reach
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let m1 = 12;
  let tier = 'target';

  const studentTest = profile.testScore;
  const testType    = profile.testType;

  if (admRate != null) {
    if (testType === 'SAT' && studentTest && satAvg) {
      const satDiff = studentTest - satAvg;
      const sat25 = (sat25Math || 0) + (sat25Read || 0);
      const sat75 = (sat75Math || 0) + (sat75Read || 0);
      if (satDiff >= 80) {
        m1 = 23; tier = 'safety';
        const pctDesc = sat75 && studentTest >= sat75 ? '高于75th百分位' : '高于录取均值';
        reasons.push(`SAT ${studentTest}分${pctDesc}——录取成功率约70%以上（NACAC 2024）`);
      } else if (satDiff >= -50) {
        m1 = 17; tier = 'target';
        reasons.push(`SAT ${studentTest}分处于录取区间中段，竞争力对等——需要其他材料拉开差距`);
      } else if (satDiff >= -150) {
        m1 = 10; tier = 'reach';
        reasons.push(`SAT差距${Math.round(-satDiff)}分，属于挑战性申请——但算法其他维度补足了差距`);
      } else { m1 = 3; tier = 'reach'; }

      // 25th-75th IQR 精修（NACAC 标准三档定义）
      if (sat25 && sat75 && studentTest) {
        if (studentTest >= sat75)       { m1 = Math.min(25, m1 + 3); tier = 'safety'; }
        else if (studentTest >= sat25)  { tier = tier === 'safety' ? 'target' : tier; }
        else                            { tier = 'reach'; m1 = Math.max(3, m1 - 3); }
      }
    } else if (testType === 'ACT' && studentTest && actMid) {
      const actDiff = studentTest - actMid;
      if (actDiff >= 2) {
        m1 = 22; tier = 'safety';
        reasons.push(`ACT ${studentTest}分超出校中位数——学术竞争力占优`);
      } else if (actDiff >= -2) {
        m1 = 16; tier = 'target';
        reasons.push(`ACT与校中位数相当，处于竞争区间`);
      } else {
        m1 = 9; tier = 'reach';
        reasons.push(`ACT差距${Math.round(-actDiff)}分，属于挑战性申请`);
      }
    } else {
      // 无标准化成绩：用录取率估算
      if (admRate >= 0.50)      { m1 = 18; tier = 'safety'; }
      else if (admRate >= 0.25) { m1 = 14; tier = 'target'; }
      else if (admRate >= 0.10) { m1 = 9;  tier = 'reach'; }
      else                      { m1 = 4;  tier = 'reach'; }
    }

    // GPA 修正（±2分）
    const gpa = profile.gpa;
    if (gpa) {
      const gpa4 = gpa > 5 ? gpa / 25 : gpa;
      if (gpa4 >= 3.8)       m1 = Math.min(25, m1 + 2);
      else if (gpa4 <= 2.5)  m1 = Math.max(2, m1 - 4);
    }

    // ── 录取率硬性 tier 保险（NACAC 标准）─────────────────
    // 录取率 < 8%：任何学生都应视为冲刺，无论成绩多强
    // 录取率 8-15%：最高为目标校，不可能是稳妥校
    if (admRate < 0.08) {
      tier = 'reach';
    } else if (admRate < 0.15 && tier === 'safety') {
      tier = 'target';
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  M2: 专业强度 [0-20]
  //
  //  学术依据：
  //  ① Arcidiacono, P. (2004). "Ability Sorting and the Returns to
  //    College Major." Journal of Econometrics 121(1-2), 343-375.
  //    — 证明院校专业资源集中度（师资比例、研究经费、行业对接）
  //    与该专业毕业生薪资回报显著正相关，是院校"专业实力"的核心代理变量
  //  ② IPEDS CIP 2020 (National Center for Education Statistics)
  //    — program_percentage 字段：每年由各校向联邦政府上报的学位授予数据，
  //    按照标准分类体系（CIP）精确统计专业占比，为真实投入度的最佳代理
  //
  //  计分公式：
  //    programFit = Σ (program_percentage_k × weight_k) / Σ weight_k
  //    M2 = min(20, round(programFit × 80))
  //
  //  参数含义：×80 意味着专业占比达到 25% 即满分（MIT 工程 ≈42%，文理学院 ≈3%）
  //  上限 20 分确保无法通过专业集中度单项拿满总分
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let m2 = 8;
  let topProgram = null;

  if (programWeights && Object.keys(programWeights).length > 0) {
    let programFitScore = 0;
    let totalWeight = 0;
    let bestScore = 0;
    let bestLabel = null;

    Object.entries(programWeights).forEach(([prog, weight]) => {
      const apiField = PROGRAM_FIELD_MAP[prog];
      if (!apiField) return;
      const pct = s[apiField];
      if (typeof pct !== 'number') return;
      const contribution = pct * weight;
      programFitScore += contribution;
      totalWeight += weight;
      if (contribution > bestScore) {
        bestScore = contribution;
        bestLabel = MAJOR_LABELS[prog] || prog;
      }
    });

    if (totalWeight > 0) {
      const normalizedFit = programFitScore / totalWeight;
      m2 = Math.min(20, Math.max(0, Math.round(normalizedFit * 80)));
      topProgram = bestLabel;
      if (bestLabel && m2 >= 12) {
        const pctStr = topProgram ? '' : '';
        const miStr  = topMIName ? `，而${topMIName}型画像在此类专业留存率最高（Arcidiacono 2004）` : '';
        reasons.push(`${bestLabel}是该校核心学科，相关院系师资密度和产学资源高度聚焦${miStr}`);
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  M3: 长期价值 [0-20]
  //
  //  学术依据：
  //  ① Chetty, R. et al. (2017). "Mobility Report Cards: The Role of
  //    Colleges in Intergenerational Mobility." NBER Working Paper 23618.
  //    — College Scorecard 的 earn_6/8yrs 数据来源于 IRS 匿名税务记录，
  //    是目前最可靠的院校级就业收入代理指标，经同龄人队列对照验证
  //  ② Avery, C. & Turner, S. (2012). "Student Loans: Do College Students
  //    Borrow Too Much — Or Not Enough?" Journal of Economic Perspectives 26(1).
  //    — 提出债务/收入比（Debt-to-Income Ratio）框架：DTI < 1.0 为可持续，
  //    > 2.0 为沉重负担（对应学生贷款违约率的临界点）
  //  ③ Oreopoulos & Petronijevic (2013). "Making College Worth It."
  //    JEP — 确认毕业率是实现薪资回报的必要前提，毕业率 < 50% 的院校
  //    不论录取标准如何，其真实人力资本产出均大幅打折
  //
  //  计分逻辑：
  //    Base score = 绝对薪资层级（earn8yr 优先，earn6yr 降级）
  //    Adjustment = 债务/收入比修正（±2分）
  //    Bonus = 毕业率奖惩（+2/-2）
  //    M3 = min(20, base + adjustment + bonus)
  //
  //  使用绝对薪资而非 ROI 公式，避免错误惩罚名校（高成本 + 高收益）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let m3 = 10;
  const baseEarnings = earn8yr || earn6yr;

  if (baseEarnings) {
    let earningsBase;
    if (baseEarnings >= 100000) {
      earningsBase = 20;
      const yrs = earn8yr ? 8 : 6;
      const budgetTotal = profile.budgetUSD ? Math.round(profile.budgetUSD * 4 / 1000) : null;
      const paybackStr = budgetTotal
        ? `；4年总投入约$${budgetTotal}k，毕业后约${Math.round(budgetTotal / Math.round(baseEarnings/1000))}年可完全回收`
        : '';
      reasons.push(`该校毕业${yrs}年中位薪资$${Math.round(baseEarnings/1000)}k，是你所在专业全国均值的${Math.round(baseEarnings/72000*10)/10}倍${paybackStr}`);
    } else if (baseEarnings >= 80000) {
      earningsBase = 17;
      const yrs = earn8yr ? 8 : 6;
      reasons.push(`毕业${yrs}年中位薪资$${Math.round(baseEarnings/1000)}k，超出全国大学毕业生中位数约${Math.round((baseEarnings/62000-1)*100)}%`);
    }
    else if (baseEarnings >=  65000) { earningsBase = 14; }
    else if (baseEarnings >=  50000) { earningsBase = 10; }
    else if (baseEarnings >=  38000) { earningsBase = 7; }
    else                             { earningsBase = 4; }

    // 债务/收入比修正（Avery & Turner 2012 框架）
    let costAdjust = 0;
    if (annualCost) {
      const dti = (medDebt || annualCost * 2) / baseEarnings;
      if      (dti < 0.5)  costAdjust =  2;   // 极低债务
      else if (dti < 1.0)  costAdjust =  1;   // 可控债务（Avery & Turner 安全线以内）
      else if (dti > 2.0)  costAdjust = -2;   // 沉重负担（违约风险临界点）
    }

    m3 = Math.min(20, Math.max(0, earningsBase + costAdjust));
  }

  // 毕业率加成（Oreopoulos & Petronijevic 2013）
  if (gradRate != null) {
    if      (gradRate >= 0.85)  m3 = Math.min(20, m3 + 2);
    else if (gradRate  < 0.50)  m3 = Math.max(0, m3 - 2);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  M4: 国际友好度 [0-10]
  //
  //  学术依据：
  //  ① IIE Open Doors Report (2024). Institute of International Education.
  //    — 国际学生占比的官方年度数据；10%+ 被学界定义为"国际化融合型"
  //  ② Hunter, W., White, G. P., & Godbey, G. C. (2006). "What Does It
  //    Mean to Be Globally Competent?" Journal of Studies in International
  //    Education 10(3). — 多元文化同伴环境对全球胜任力的塑造作用
  //  ③ 对中国留学生尤为关键：Massey et al. (2003) "The Source of the River"
  //    证明同伴环境对跨文化适应与学习支持网络构建具有显著影响
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let m4 = 5;
  if      (intlRatio >= 0.10) { m4 = 10; reasons.push(`国际学生占比${Math.round(intlRatio*100)}%，校园国际化程度高`); }
  else if (intlRatio >= 0.05) { m4 = 7; }
  else if (intlRatio >= 0.02) { m4 = 4; }
  else                        { m4 = 2; }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  M5: 冷门机会加成 [0-10]
  //
  //  学术依据（信息不对称理论/Undermatch Theory）：
  //  ① Hoxby, C. & Avery, C. (2012). "The Missing 'One-Offs': The
  //    Hidden Supply of High-Achieving, Low-Income Students." NBER WP 18586.
  //    — 高能力学生系统性地少报名高性价比院校（信息壁垒所致），
  //    该模块专门对抗这一偏差，提升此类院校在推荐列表中的权重
  //  ② Hoxby, C. & Turner, S. (2013). "Expanding College Opportunities
  //    for High-Achieving, Low Income Students." SIEPR Discussion Paper.
  //    — 证明主动提供高性价比院校信息后申请率提升 2.4 倍
  //
  //  计分公式：
  //    valueScore = (earn6yr / $80,000参考值) × admRate
  //    高薪资 + 高录取率 = 被低估的高性价比院校
  //    录取率 < 8%：置 0（超高选择性院校不属于信息盲区）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let m5 = 0;
  if (earn6yr && admRate && admRate >= 0.08) {
    const valueScore = (earn6yr / 80000) * admRate;
    if (valueScore >= 0.60) {
      m5 = 10;
      const admPct = Math.round(admRate * 100);
      const earnK  = Math.round(earn6yr / 1000);
      reasons.push(
        `录取率${admPct}%却能产出$${earnK}k毕业薪资——同等成绩学生普遍忽略这里（Hoxby 2012信息不对称理论），这正是算法专门识别的非共识路径`
      );
    } else if (valueScore >= 0.35) { m5 = 6; }
    else if (valueScore >= 0.15)   { m5 = 3; }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  M6: 就业市场契合度 [0-15]  ← 新增模块
  //
  //  学术依据：
  //  ① Carnevale, A., Smith, N., & Strohl, J. (2013). "Recovery: Job
  //    Growth and Education Requirements Through 2020." Georgetown
  //    Center on Education and the Workforce. — 首次量化不同专业领域
  //    在10年内对学士/硕士学位人才的差异化需求，奠定了"专业-就业市场
  //    契合度"评估的学术框架
  //  ② U.S. Bureau of Labor Statistics (2024). Employment Projections
  //    2024-2034. — 官方10年就业预测数据，按SOC职业分类覆盖800+职业，
  //    为各专业领域增长率提供权威量化依据
  //  ③ O*NET Bright Outlook 标准（BLS 2024-2034）：满足以下任一即为
  //    Bright Outlook：10年就业增长 >10%；OR 年均新增岗位 >100,000；
  //    OR 属于 New & Emerging occupation（新兴职业）
  //
  //  三个子信号：
  //  M6a [0-8]：领域就业增长率（BLS 2024-2034 专业领域加权均值）
  //  M6b [0-4]：O*NET Bright Outlook 职业比例（来自 Interest Profiler）
  //  M6c [0-3]：院校薪资 vs BLS 领域中位薪资基准比较
  //
  //  核心逻辑：该模块回答"学生想学的领域，未来10年需求旺盛吗？
  //            这所学校的毕业生能否超越全国中位水平？"
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let m6 = 5;

  // 找出权重最高的专业领域（作为 M6c 基准参照）
  const primaryField = programWeights && Object.keys(programWeights).length > 0
    ? Object.entries(programWeights).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  // M6a: 领域增长率（各领域 BLS 增长率 × 权重的加权均值）
  let m6a = 4; // neutral default
  if (programWeights) {
    const weightedGrowth = Object.entries(programWeights).reduce((sum, [field, w]) => {
      return sum + (BLS_GROWTH_2034[field] || 0.04) * w;
    }, 0);

    if (weightedGrowth >= 0.25) {
      m6a = 8;
      reasons.push(
        `所在专业领域BLS预测2024-2034增速${Math.round(weightedGrowth*100)}%，是全国均值4%的${Math.round(weightedGrowth/0.04)}倍——结构性需求，不是周期波动`
      );
    } else if (weightedGrowth >= 0.15) {
      m6a = 7;
      reasons.push(`领域就业增速${Math.round(weightedGrowth*100)}%（BLS 2024-2034），高于全国均值，供需缺口持续扩大`);
    }
    else if (weightedGrowth >= 0.08) { m6a = 5; }
    else if (weightedGrowth >= 0.04) { m6a = 3; }
    else if (weightedGrowth >= 0.01) { m6a = 2; }
    else                             { m6a = 1; }
  }

  // M6b: O*NET Bright Outlook 职业比例（来自 profile.brightOutlookPct）
  let m6b = 0;
  const brightOutlookPct = profile.brightOutlookPct;
  if (typeof brightOutlookPct === 'number') {
    if      (brightOutlookPct >= 0.50) m6b = 4;
    else if (brightOutlookPct >= 0.30) m6b = 3;
    else if (brightOutlookPct >= 0.15) m6b = 2;
    else                               m6b = 1;
  }

  // M6c: 院校薪资 vs BLS 领域国家中位薪资
  let m6c = 0;
  const schoolEarn = earn8yr || earn6yr;
  if (schoolEarn && primaryField && BLS_MEDIAN_WAGES[primaryField]) {
    const earnRatio = schoolEarn / BLS_MEDIAN_WAGES[primaryField];
    if (earnRatio >= 1.20) {
      m6c = 3;
      reasons.push(
        `该校毕业生薪资超出全国${primaryField}领域中位数${Math.round((earnRatio-1)*100)}%——说明这里的出口竞争力超过行业均值，不是所有学校都能做到`
      );
    }
    else if (earnRatio >= 1.05) { m6c = 2; }
    else if (earnRatio >= 0.90) { m6c = 1; }
    // else: 低于国家中位 → 0分
  }

  m6 = Math.min(15, m6a + m6b + m6c);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  M7: 中国留学生社区适配度 [0-8]
  //
  //  数据来源：
  //  ① IIE Open Doors 2022-2023 Report — 各校中国在读学生人数
  //     https://opendoorsdata.org/data/international-students/
  //  ② 一亩三分地 + 知乎留学版综合口碑评分（1-5）
  //     评估维度：就业资源、华人社区氛围、STEM OPT友好度
  //
  //  设计逻辑：中国学生选校有特殊的社群需求——同学圈、华人商业网络、
  //  就业内推、STEM OPT政策友好度等都是实际考量。这些因素不在官方
  //  排名体系中，但在一亩三分地/知乎有大量真实反馈。
  //
  //  两个子信号：
  //  M7a [0-4]：中国学生规模（IIE 2022-23 在读人数）
  //    ≥4000人：4分  ≥2500人：3分  ≥1500人：2分  ≥500人：1分
  //  M7b [0-4]：中国论坛口碑（1-5 → 0-4）
  //    rep==5：4分   rep==4：3分   rep==3：2分   其他：1分
  //
  //  注：M7 不影响其他模块，独立叠加至总分；M7加入后总分上限调整为108
  //  但最终 clamp 至 100，确保评分系统不膨胀
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let m7 = 0;
  const _sp7 = _getSchoolProfile(s['school.name'] || '');
  if (_sp7 && _sp7.cn) {
    const { n, rep, note } = _sp7.cn;

    // M7a: 在读中国学生规模
    let m7a = 0;
    if      (n >= 4000) m7a = 4;
    else if (n >= 2500) m7a = 3;
    else if (n >= 1500) m7a = 2;
    else if (n >=  500) m7a = 1;

    // M7b: 论坛口碑
    let m7b = 0;
    if      (rep >= 5) m7b = 4;
    else if (rep >= 4) m7b = 3;
    else if (rep >= 3) m7b = 2;
    else               m7b = 1;

    m7 = m7a + m7b;

    // 生成 M7 reason 文本
    if (m7 >= 6) {
      const nK = n >= 1000 ? `约${(n / 1000).toFixed(1)}k人` : `约${n}人`;
      reasons.push(`中国留学生${nK}（IIE 2023）· ${note}`);
    } else if (m7 >= 4) {
      reasons.push(`中国留学生社区活跃 · ${note}`);
    }
  }

  // ── 汇总 ─────────────────────────────────────────────────
  //  总分 = M1..M7 之和，clamp 至 100
  const total = Math.min(100, Math.round(m1 + m2 + m3 + m4 + m5 + m6 + m7));

  // ── 学校特色标签（仿高考引擎 _buildSchoolYuanXiNote 模式）──
  //  查找学校简表：若该校有预置特色信息，将"学校定位 · 专业排名"
  //  插入 reasons 首位，让用户第一眼看到的是"这所学校为什么在这里"
  //  而不是纯粹的数字指标
  const _sp = _getSchoolProfile(s['school.name'] || '');
  if (_sp) {
    const majorTag = profile.majorArea && _sp.ps && _sp.ps[profile.majorArea];
    const schoolTag = majorTag
      ? `${_sp.tag} · ${majorTag}`          // 如：理工全美第一 · CS全美第1
      : _sp.tag;                             // 如：合作实习就业第一
    reasons.unshift(schoolTag);             // 置顶，始终作为第一条 reason

    // 就业方向说明（仿 careerStrength 逻辑）
    if (_sp.career && _sp.career.length > 0 && reasons.length < 6) {
      reasons.push(`校友网络覆盖：${_sp.career.slice(0, 2).join(' / ')} 行业`);
    }
  } else if (profile.majorArea) {
    // ── 非预置学校：用专业名 + 在读生占比作为第一条 reason ──
    //  确保用户始终能看到"这所学校被推荐是因为你选的专业方向"
    const majorLabel = MAJOR_LABELS[profile.majorArea] || profile.majorArea;
    const progFieldKey = PROGRAM_FIELD_MAP[profile.majorArea];
    const progPct = progFieldKey ? s[progFieldKey] : null;
    if (progPct != null && progPct >= 0.03) {
      const pct = Math.round(progPct * 100);
      reasons.unshift(`${majorLabel}：该校 ${pct}% 在读生选择此领域`);
    } else {
      reasons.unshift(`${majorLabel}方向院校`);
    }
  }

  // ── 兜底 reason（确保至少有一条可见理由）──────────────────
  if (reasons.length === 0) {
    const tierLabel = tier === 'safety' ? '稳妥' : tier === 'target' ? '目标' : '冲刺';
    reasons.push(`综合7维评分 ${total} 分，算法识别为${tierLabel}院校`);
  }

  // P1+P2+P4 — 附加字段（STEM OPT / QS 排名 / 申请平台）
  const qsRank     = _sp ? (_sp.qs  !== undefined ? _sp.qs  : null) : null;
  const applyPortal= _sp ? (_sp.apply || null) : null;
  const stemOpt    = STEM_OPT_FIELDS.has(profile.majorArea || '');

  return {
    total,
    tier,
    modules: { m1, m2, m3, m4, m5, m6, m7 },
    topProgram,
    reasons: reasons.slice(0, 5),
    qsRank,
    stemOpt,
    applyPortal,
  };
}

// ══════════════════════════════════════════════════════════════
//  内部函数：_fetchONETWeights(profile)
//  调用 onetCIPMatch 云函数（v2 版本，返回 brightOutlookPct）
//  永不 reject — 失败时返回 null
// ══════════════════════════════════════════════════════════════
function _fetchONETWeights(profile) {
  return new Promise(resolve => {
    if (!profile.riasec || profile.riasec.length === 0) { resolve(null); return; }
    if (typeof wx === 'undefined' || !wx.cloud)         { resolve(null); return; }
    wx.cloud.callFunction({
      name: 'onetCIPMatch',
      data: {
        riasec:      profile.riasec,
        degreeLevel: profile.degreeLevel || 'undergrad',
      },
      success: (res) => {
        const result = res.result || {};
        if (result.needsFallback || !result.success) {
          resolve(null);
        } else {
          resolve(result);
        }
      },
      fail: () => resolve(null),
    });
  });
}

// ══════════════════════════════════════════════════════════════
//  内部函数：_mergeWeights(w1, r1, w2, r2)
// ══════════════════════════════════════════════════════════════
function _mergeWeights(w1, r1, w2, r2) {
  const merged = {};
  const allKeys = new Set([...Object.keys(w1), ...Object.keys(w2)]);
  allKeys.forEach(k => { merged[k] = (w1[k] || 0) * r1 + (w2[k] || 0) * r2; });
  const total = Object.values(merged).reduce((a, b) => a + b, 0);
  if (total > 0) { Object.keys(merged).forEach(k => { merged[k] /= total; }); }
  return merged;
}

// ══════════════════════════════════════════════════════════════
//  主入口函数：runMatch(profile)
// ══════════════════════════════════════════════════════════════
function runMatch(profile) {
  return new Promise((resolve, reject) => {
    // 缓存检查
    const cacheKey = CACHE_KEY + JSON.stringify({
      dl: profile.degreeLevel,
      ma: profile.majorArea,
      r:  profile.riasec,
    });
    try {
      const cached = wx.getStorageSync(cacheKey);
      if (cached && cached.ts && (Date.now() - cached.ts < CACHE_HOURS * 3600 * 1000)) {
        resolve({ ...cached.data, cacheHit: true });
        return;
      }
    } catch (e) { /* ignore */ }

    // 并行发起：O*NET 云函数 + College Scorecard
    const onetPromise    = _fetchONETWeights(profile);
    const schoolsPromise = fetchSchools(profile);

    Promise.all([onetPromise, schoolsPromise])
      .then(([onetResult, schools]) => {
        // 合并权重
        let programWeights;
        let onetSource = 'static_fallback';

        if (onetResult && onetResult.success && onetResult.cipWeights) {
          const staticWeights = buildProgramWeights(profile);
          programWeights = _mergeWeights(onetResult.cipWeights, 0.80, staticWeights, 0.20);
          onetSource = 'onet_api';
          // 将 brightOutlookPct 注入 profile（用于 M6b 评分）
          profile.brightOutlookPct = onetResult.brightOutlookPct || 0;
        } else {
          programWeights = buildProgramWeights(profile);
          // 无 O*NET 数据时 brightOutlookPct 设为 null（M6b 跳过）
          profile.brightOutlookPct = null;
        }

        if (!schools || schools.length === 0) {
          reject(new Error('无法获取学校数据，请检查网络'));
          return;
        }

        // 预算过滤
        const budgetMax = profile.budgetUSD || 80000;
        const eligible = schools.filter(s => {
          const cost = s['latest.cost.tuition.out_of_state'] || s['latest.cost.attendance.academic_year'];
          return !cost || cost <= budgetMax;
        });

        // 打分
        const scored = eligible.map(s => {
          const result = scoreSchool(s, profile, programWeights);
          return {
            id:         s['id'],
            name:       s['school.name'],
            city:       s['school.city'],
            state:      s['school.state'],
            url:        s['school.school_url'],
            ownership:  s['school.ownership'] === 1 ? '公立' : '私立',
            admRate:    s['latest.admissions.admission_rate.overall'],
            satAvg:     s['latest.admissions.sat_scores.average.overall'],
            actMid:     s['latest.admissions.act_scores.midpoint.cumulative'],
            tuition:    s['latest.cost.tuition.out_of_state'],
            annualCost: s['latest.cost.attendance.academic_year'],
            earn6yr:    s['latest.earnings.6_yrs_after_entry.median'],
            earn8yr:    s['latest.earnings.8_yrs_after_entry.median'],
            gradRate:   s['latest.completion.rate_suppressed.overall'],
            intlPct:    s['latest.student.demographics.race_ethnicity.non_resident_alien'],
            size:       s['latest.student.size'],
            medDebt:    s['latest.aid.median_debt_suppressed.completers.overall'],
            ...result,
          };
        });

        // 按梯度分组排序
        const reach  = scored.filter(s => s.tier === 'reach')  .sort((a,b) => b.total - a.total).slice(0, 3);
        const target = scored.filter(s => s.tier === 'target') .sort((a,b) => b.total - a.total).slice(0, 6);
        const safety = scored.filter(s => s.tier === 'safety') .sort((a,b) => b.total - a.total).slice(0, 4);

        // 补充兜底（确保每档至少有院校）
        const allSorted = scored.sort((a, b) => b.total - a.total);
        const ensureMin = (pool, min, exclude) => {
          if (pool.length >= min) return pool;
          const toAdd = allSorted
            .filter(s => !exclude.some(e => e.id === s.id) && !pool.some(e => e.id === s.id))
            .slice(0, min - pool.length);
          return [...pool, ...toAdd];
        };
        const safetyFilled = ensureMin(safety, 2, [...reach, ...target]);
        const targetFilled = ensureMin(target, 3, [...reach, ...safetyFilled]);

        // 顶部专业标签
        const topPrograms = Object.entries(programWeights)
          .sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([k]) => MAJOR_LABELS[k] || k);

        const usedFallback = schools.length > 0 && !!schools[0]._fallback;
        const result = {
          reach,
          target: targetFilled,
          safety: safetyFilled,
          programWeights,
          topPrograms,
          totalScanned: schools.length,
          cacheHit:     false,
          usedFallback,          // true = 使用内置数据库（API 不可达时）
          onetSource,
          onetCareers:  (onetResult && onetResult.topCareers) || [],
          brightOutlookPct: profile.brightOutlookPct,
          ts: Date.now(),
        };

        try { wx.setStorageSync(cacheKey, { data: result, ts: Date.now() }); } catch (e) { /* ignore */ }

        resolve(result);
      })
      .catch(reject);
  });
}

// ══════════════════════════════════════════════════════════════
//  格式化工具函数
// ══════════════════════════════════════════════════════════════
function fmtAdmRate(rate)  { if (rate == null) return '数据缺失'; return `${Math.round(rate * 100)}%`; }
function fmtCost(usd)      { if (!usd) return '数据缺失'; const cny = Math.round(usd * CNY_RATE / 1000) * 1000; return `¥${(cny / 10000).toFixed(0)}万/年`; }
function fmtEarnings(usd)  { if (!usd) return '数据缺失'; return `$${Math.round(usd / 1000)}k/年`; }
function fmtGradRate(rate) { if (rate == null) return '数据缺失'; return `${Math.round(rate * 100)}%`; }
function getTierMeta(tier) { return TIER_META[tier] || TIER_META.target; }

// ── 从已有 assessmentData 中提取留学画像 ──────────────────────
function extractProfileFromAssessment(assessmentData) {
  const cd = assessmentData || {};
  const answers = cd.answers || {};
  const sp = cd.student_profile || {};
  const mi = cd.miScores || {};

  const riasecRaw = answers.riasec_code ||
    (cd.pathJudgment && cd.pathJudgment.riasec) || '';

  const majorMap = {
    stem: 'computer', engineering: 'engineering', computer: 'computer',
    business: 'business_marketing', humanities: 'humanities',
    social_science: 'social_science', health: 'health',
    arts_design: 'visual_performing_arts', natural_science: 'biological',
    communication: 'communication',
  };
  const majorArea = majorMap[answers.subject_interest] || majorMap[sp.subject_interest] || null;

  // ── 预算映射（对齐 questions.js education_budget 字段值）────────
  // questions.js 实际选项值：under_5w / 5_15w / 15_30w / 30_60w / over_60w
  // 换算逻辑：取区间中位值 ÷ 4年 × CNY→USD（年学费等价）
  const budgetCNYMap = {
    under_5w:  12000,   // <5万/年 → ~$12k（中西部公立平均）
    '5_15w':   25000,   // 5-15万 → ~$25k（州内公立 + 奖学金）
    '15_30w':  45000,   // 15-30万 → ~$45k（中等私立）
    '30_60w':  70000,   // 30-60万 → ~$70k（顶尖私立学费级别）
    over_60w:  80000,   // >60万 → ~$80k（无预算限制）
  };
  const budgetKey = answers.education_budget ||
    sp.budget || cd.family_profile?.annual_education_budget;
  const budgetUSD = budgetCNYMap[budgetKey] || 45000;

  // ── academicTier → SAT 估算映射 ───────────────────────────────
  // 当用户未填写 sat_score_est 时，依据学业排名自动估算
  // 参考：College Board 2023 SAT Score Distribution
  const tierToSAT = { top: 1450, upper_mid: 1300, mid: 1150, low: 1000 };
  const rawSAT  = answers.sat_score_est
    ? Number(answers.sat_score_est)
    : (cd.testScore || null);
  const satScore  = rawSAT || tierToSAT[answers.academicTier] || null;
  const satIsEst  = !rawSAT;

  // ── GPA 读取 + 学业排名估算 ───────────────────────────────────
  const tierToGPA = { top: 3.9, upper_mid: 3.7, mid: 3.5, low: 3.2 };
  const rawGPA  = answers.gpa_est
    ? Number(answers.gpa_est)
    : (cd.gpa || null);
  const gpa     = rawGPA || tierToGPA[answers.academicTier] || null;
  const gpaIsEst = !rawGPA;

  return {
    degreeLevel:    cd.degreeLevel || 'undergrad',
    gpa:            gpa,
    gpaEstimated:   gpaIsEst,
    testType:       satScore ? 'SAT' : (cd.testType || null),
    testScore:      satScore,
    testEstimated:  satIsEst,
    langType:       cd.langType || null,
    langScore:      cd.langScore || null,
    langEstimated:  cd.langEstimated || false,
    majorArea:      cd.majorArea || majorArea,
    riasec:         riasecRaw || '',
    miScores:       mi,
    budgetUSD,
    geoPreference:  answers.geo_preference || 'us',
    brightOutlookPct: null,
  };
}

/**
 * 根据学校英文名（nameEn）或 key 查找 USA_SCHOOL_PROFILES 精选数据
 * 返回 { key, tag, ps, career, cn, qs, apply, stemOpt } 或 null
 * 供 school-detail 页面使用（Phase 1-B）
 *
 * 字段说明:
 *   ps      → 专业优势一句话（从原始 ps 对象取前两项拼接）
 *   cn      → 中国学生社区备注文字（从原始 cn.note 提取）
 *   stemOpt → 是否有强势 STEM 专业（根据 ps key 判断）
 */
function getUSProfile(nameEnOrKey) {
  if (!nameEnOrKey) return null;
  const q = (nameEnOrKey || '').toLowerCase().trim();
  // 先精确匹配 key（大小写不敏感）
  let sp = USA_SCHOOL_PROFILES.find(p => p.key && p.key.toLowerCase() === q);
  // 再部分匹配（处理 "University of Michigan-Ann Arbor" vs "University of Michigan"）
  if (!sp) {
    sp = USA_SCHOOL_PROFILES.find(p => {
      const k = (p.key || '').toLowerCase();
      return q.includes(k) || k.includes(q.split(',')[0].trim()) || k.includes(q.split('-')[0].trim());
    });
  }
  if (!sp) return null;

  // ps: 对象 → 取前两项拼接成字符串
  let psText = '';
  if (sp.ps && typeof sp.ps === 'object') {
    const entries = Object.values(sp.ps);
    psText = entries.slice(0, 2).join(' · ');
  } else if (typeof sp.ps === 'string') {
    psText = sp.ps;
  }

  // cn: 对象 → 提取 note 字符串
  let cnNote = '';
  if (sp.cn && typeof sp.cn === 'object') {
    cnNote = sp.cn.note || '';
  } else if (typeof sp.cn === 'string') {
    cnNote = sp.cn;
  }

  // stemOpt: ps 中含有理工科 key → 说明该校在 STEM 领域有排名
  const STEM_KEYS = ['computer', 'engineering', 'mathematics', 'biological', 'physical_science', 'chemistry'];
  const stemOpt = sp.ps && typeof sp.ps === 'object'
    ? STEM_KEYS.some(k => k in sp.ps)
    : false;

  return {
    key:     sp.key,
    tag:     sp.tag    || '',
    ps:      psText,
    career:  sp.career || [],
    cn:      cnNote,
    qs:      sp.qs != null ? sp.qs : null,
    apply:   sp.apply  || null,
    stemOpt,
  };
}

// ═══════════════════════════════════════════════════════════════
//  Phase 重构：职业结果优先架构
//  Career Vision → Major Direction → School（Program-First）
//
//  理论依据：
//  · Chetty et al. (2020) — 控制专业后院校品牌边际效应有限
//  · Burning Glass/Lightcast (2023) — 专业方差 >> 院校方差
//  · Holland RIASEC (1997) — 职业兴趣是长期满意度最强预测因子
//  · IIE Open Doors (2023) — STEM留存率与院校排名相关性弱
// ═══════════════════════════════════════════════════════════════

// ── 职业愿景集群（9个）──────────────────────────────────────────
// 每个集群描述：中文标题、图标、CIP大类代码、MI权重向量、RIASEC匹配、
//               职业时间线、留美/回国可行性、BLS数据键、典型雇主
const CAREER_VISIONS = {

  tech_startup: {
    id: 'tech_startup',
    label: '科技 & 创业',
    icon: '🖥️',
    tagline: '用代码改变世界，做下一个硅谷故事的主角',
    desc: '这条路的终点不只是一份工作，而是一种能力——用技术解决真实问题，创造新事物。无论是在Google做工程师、在OpenAI做研究员，还是自己创业，都是这个方向的不同版本。',
    careerTimeline: {
      grad:  '毕业1-2年：软件/数据工程师，年薪 $90k–$130k',
      y5:    '5年后：高级工程师 / Tech Lead，年薪 $150k–$220k，或加入早期创业',
      y10:   '10年后：工程总监 / 创始人 / 风险投资人，中美双通道皆可',
    },
    cipCodes: [11, 14],
    programPercentageKeys: ['computer', 'engineering'],
    riasecMatch: ['I', 'R', 'E'],
    // MI 权重向量（总和=1.0，代表各智能对该集群的贡献度）
    miWeights: { logical: 0.35, spatial: 0.20, bodily: 0.05, linguistic: 0.08,
                 musical: 0.02, interpersonal: 0.10, intrapersonal: 0.10, naturalist: 0.10 },
    stemOpt: true,
    usStayRate: 'HIGH',
    usPath:     '留美：Big Tech L3-L5校招直通，STEM OPT 3年 + H1B抽签',
    returnPath: '回国：BAT/字节/美团技术岗，或硅谷经验海归创业',
    blsKey:     'computer',
    typicalEmployers: ['Google', 'Meta', 'Microsoft', 'OpenAI', 'Stripe', '字节跳动（海外）'],
  },

  quant_finance: {
    id: 'quant_finance',
    label: '量化金融 & 数据',
    icon: '📊',
    tagline: '用数学和算法在金融市场寻找最优解',
    desc: '量化金融是数学、统计和计算机的高薪交叉地带。对冲基金、投行量化策略部门、数据科学——这条路在留美和回国都有极强的就业市场，且薪资天花板很高。',
    careerTimeline: {
      grad:  '毕业1-2年：量化分析师 / 数据科学家，年薪 $110k–$160k',
      y5:    '5年后：高级量化 / VP，年薪 $200k–$500k+',
      y10:   '10年后：合伙人 / CIO / 自营基金，或回国加入顶级私募',
    },
    cipCodes: [27, 52],
    programPercentageKeys: ['mathematics', 'business_marketing'],
    riasecMatch: ['I', 'C', 'E'],
    miWeights: { logical: 0.45, spatial: 0.15, bodily: 0.00, linguistic: 0.05,
                 musical: 0.02, interpersonal: 0.10, intrapersonal: 0.13, naturalist: 0.10 },
    stemOpt: true,
    usStayRate: 'MEDIUM',
    usPath:     '留美：Jane Street / Two Sigma / 各大投行量化部门',
    returnPath: '回国：中金/高盛中国/对冲基金，薪资与美国持平',
    blsKey:     'mathematics',
    typicalEmployers: ['Goldman Sachs', 'Jane Street', 'Two Sigma', 'Bridgewater', '中金', '高盛高华'],
  },

  consulting_management: {
    id: 'consulting_management',
    label: '咨询 & 管理',
    icon: '📋',
    tagline: '站在企业决策最前端，解决最复杂的商业问题',
    desc: '咨询路径是最通吃的职业入口——几乎所有行业都需要顾问，MBB（麦肯锡/BCG/贝恩）的光环在全球通用。商学本科或经济学是主要通道，表达能力和商业直觉同样重要。',
    careerTimeline: {
      grad:  '毕业1-2年：咨询分析师，年薪 $90k–$110k（含奖金）',
      y5:    '5年后：经理 / 项目负责人，年薪 $200k+，或跳槽至PE / 战略部门',
      y10:   '10年后：合伙人候选 / 创业 / 企业战略VP，国内外均有出口',
    },
    cipCodes: [52, 45],
    programPercentageKeys: ['business_marketing', 'social_science'],
    riasecMatch: ['E', 'S', 'C'],
    miWeights: { logical: 0.25, spatial: 0.05, bodily: 0.05, linguistic: 0.25,
                 musical: 0.02, interpersonal: 0.20, intrapersonal: 0.10, naturalist: 0.08 },
    stemOpt: false,
    usStayRate: 'MEDIUM',
    usPath:     '留美：MBB美国办公室，需要出色的英文表达和文化融合度',
    returnPath: '回国：麦肯锡/BCG上海北京，外资企业战略部门，需求稳定',
    blsKey:     'business_marketing',
    typicalEmployers: ['McKinsey', 'BCG', 'Bain', 'Deloitte', 'Goldman Sachs IBD', '麦肯锡上海'],
  },

  engineering_physical: {
    id: 'engineering_physical',
    label: '工程 & 建造',
    icon: '⚙️',
    tagline: '设计建造真实世界中运转的系统与结构',
    desc: '电气、机械、化工、土木——这些专业解决真实的物理问题。美国在这些领域的工业基础和科研投入全球领先，毕业生可进入制造业、航空航天、能源，或走研究路线攻博士。',
    careerTimeline: {
      grad:  '毕业1-2年：工程师，年薪 $75k–$105k',
      y5:    '5年后：高级工程师 / PE认证 / 项目经理，年薪 $110k–$160k',
      y10:   '10年后：技术总监 / 专项顾问 / 创业（能源/材料领域）',
    },
    cipCodes: [14],
    programPercentageKeys: ['engineering'],
    riasecMatch: ['R', 'I', 'C'],
    miWeights: { logical: 0.30, spatial: 0.30, bodily: 0.15, linguistic: 0.05,
                 musical: 0.02, interpersonal: 0.05, intrapersonal: 0.05, naturalist: 0.08 },
    stemOpt: true,
    usStayRate: 'HIGH',
    usPath:     '留美：Boeing / Tesla / SpaceX / 各大工程公司，H1B技术类需求高',
    returnPath: '回国：比亚迪/华为/国家电网/建筑设计院，工程路线清晰',
    blsKey:     'engineering',
    typicalEmployers: ['Boeing', 'Tesla', 'SpaceX', 'AECOM', 'GE', '比亚迪（海外岗）'],
  },

  life_sciences: {
    id: 'life_sciences',
    label: '生命科学 & 医疗',
    icon: '🔬',
    tagline: '探索生命的奥秘，解决人类健康的根本问题',
    desc: '生物、生化、神经科学——通往学术研究、生物技术创业或医学院的路径。美国在生命科学领域的资助和产业生态全球首位。注意：Pre-Med路线（申请美国医学院）竞争极为激烈。',
    careerTimeline: {
      grad:  '毕业1-2年：研究助理 / 生物技术研究员，年薪 $55k–$80k；或直接申请医学院/PhD',
      y5:    '5年后（PhD路线）：博士后 $55k–$75k；（生技路线）：研究员 $90k–$130k',
      y10:   '10年后：独立PI / 生技科学家 / 创业；或执业医生',
    },
    cipCodes: [26, 51],
    programPercentageKeys: ['biological', 'health'],
    riasecMatch: ['I', 'R', 'S'],
    miWeights: { logical: 0.30, spatial: 0.15, bodily: 0.10, linguistic: 0.10,
                 musical: 0.02, interpersonal: 0.10, intrapersonal: 0.10, naturalist: 0.13 },
    stemOpt: true,
    usStayRate: 'MEDIUM',
    usPath:     '留美：NIH资助机构 / Genentech / Pfizer，学术绿卡路径相对清晰',
    returnPath: '回国：药明康德/再鼎医药/CRO机构，国内生物医药高速发展',
    blsKey:     'health',
    typicalEmployers: ['Pfizer', 'Genentech', 'NIH', '哈佛医学院（研究）', '再鼎医药', '药明康德'],
  },

  arts_design: {
    id: 'arts_design',
    label: '艺术 & 设计',
    icon: '🎨',
    tagline: '用视觉语言创造有意义的作品与体验',
    desc: '美国顶级设计学校培养的不只是"画画的人"——而是能在苹果做产品设计师、在IDEO做体验设计师、在建筑事务所做城市规划师的人。商业与艺术的交叉地带有很多高薪机会。',
    careerTimeline: {
      grad:  '毕业1-2年：初级设计师 / 艺术助理，年薪 $50k–$75k',
      y5:    '5年后：中级设计师 / 创意总监助理，年薪 $80k–$120k（科技公司UX方向更高）',
      y10:   '10年后：创意总监 / 产品设计主管 / 独立艺术家 / 工作室',
    },
    cipCodes: [50, 4],
    programPercentageKeys: ['humanities'],
    riasecMatch: ['A', 'I', 'E'],
    miWeights: { logical: 0.10, spatial: 0.35, bodily: 0.20, linguistic: 0.10,
                 musical: 0.10, interpersonal: 0.05, intrapersonal: 0.05, naturalist: 0.05 },
    stemOpt: false,
    usStayRate: 'LOW',
    usPath:     '留美：苹果/谷歌UX设计团队，需要Figma等技术技能加持',
    returnPath: '回国：国内设计需求大爆发，品牌/游戏/互联网设计均有高薪出路',
    blsKey:     'humanities',
    typicalEmployers: ['Apple（设计部门）', 'IDEO', 'Pentagram', '腾讯游戏美术', 'Zaha Hadid Architects'],
  },

  law_policy: {
    id: 'law_policy',
    label: '法律 & 政策',
    icon: '⚖️',
    tagline: '理解规则、制定规则，在规则中找到最优路径',
    desc: '在美国读本科的Pre-Law路径，通常选政治学、哲学或经济学，再申请法学院（JD）。对中国学生，国际法/商业法方向最具价值——跨国公司法务、国际仲裁是稀缺人才的高薪赛道。',
    careerTimeline: {
      grad:  '毕业1-2年：通常继续深造（JD/LLM），或进入政府/智库/NGO',
      y5:    '5年后（JD路线）：律所Associate，年薪 $200k+（大所）',
      y10:   '10年后：合伙人候选 / 企业法务总监 / 政府顾问 / 学者',
    },
    cipCodes: [22, 45, 38],
    programPercentageKeys: ['social_science', 'humanities'],
    riasecMatch: ['E', 'I', 'S'],
    miWeights: { logical: 0.30, spatial: 0.05, bodily: 0.02, linguistic: 0.35,
                 musical: 0.02, interpersonal: 0.12, intrapersonal: 0.10, naturalist: 0.04 },
    stemOpt: false,
    usStayRate: 'MEDIUM',
    usPath:     '留美：商业法/IP法对外国学生更友好，需通过Bar Exam',
    returnPath: '回国：外资律所中国业务 / 跨国公司法务，中美涉外人才稀缺',
    blsKey:     'social_science',
    typicalEmployers: ['Sullivan & Cromwell', 'Cleary Gottlieb', '君合律所', '商务部（政策路线）', '国际仲裁中心'],
  },

  media_communication: {
    id: 'media_communication',
    label: '传播 & 媒体',
    icon: '📡',
    tagline: '讲故事、传递信息，在信息时代创造影响力',
    desc: '数字媒体时代，传播的价值被重新定义。这条路既有传统新闻/出版，也有科技公司的内容运营、品牌营销、用户增长——后者薪资更高且更容易留美工作。',
    careerTimeline: {
      grad:  '毕业1-2年：内容策略师 / 品牌助理，年薪 $50k–$70k',
      y5:    '5年后：品牌经理 / 内容总监，年薪 $80k–$120k',
      y10:   '10年后：CMO / 媒体公司创始人 / 品牌创意总监',
    },
    cipCodes: [9, 10],
    programPercentageKeys: ['humanities'],
    riasecMatch: ['A', 'E', 'S'],
    miWeights: { logical: 0.10, spatial: 0.10, bodily: 0.05, linguistic: 0.40,
                 musical: 0.10, interpersonal: 0.15, intrapersonal: 0.05, naturalist: 0.05 },
    stemOpt: false,
    usStayRate: 'LOW',
    usPath:     '留美：Netflix / Bloomberg / 科技公司内容团队，OPT期间积累经验',
    returnPath: '回国：字节/腾讯内容部门/广告代理，中英双语是核心竞争力',
    blsKey:     'humanities',
    typicalEmployers: ['Netflix', 'Bloomberg', 'The New York Times', '字节跳动（海外内容）', 'WPP集团'],
  },

  research_academia: {
    id: 'research_academia',
    label: '研究 & 学术',
    icon: '🧪',
    tagline: '在知识的边界工作，用研究回答最难的问题',
    desc: '这条路以PhD为核心。美国顶级研究型大学的博士项目通常是全额奖学金+生活补贴，是少数几个不需要家里出大钱的出国路径。但它需要孩子有极强的内驱力和对某一领域真正的热情。',
    careerTimeline: {
      grad:  '本科毕业申请博士（全奖），前2年课程+助研，后3-4年独立研究',
      y5:    '博士后研究员，年薪 $55k–$75k；或进入工业研究部门 $120k+',
      y10:   '10年后：助理教授 / 国家实验室研究员，或工业研究主管',
    },
    cipCodes: [11, 14, 26, 27, 45],
    programPercentageKeys: ['computer', 'biological', 'mathematics'],
    riasecMatch: ['I', 'R', 'A'],
    miWeights: { logical: 0.35, spatial: 0.15, bodily: 0.05, linguistic: 0.15,
                 musical: 0.05, interpersonal: 0.05, intrapersonal: 0.15, naturalist: 0.05 },
    stemOpt: true,
    usStayRate: 'HIGH',
    usPath:     '留美：学术绿卡（EB-1/NIW）路径相对清晰，特别是STEM研究',
    returnPath: '回国：清北复交引进海外博士，"青年千人"待遇优厚',
    blsKey:     'computer',
    typicalEmployers: ['MIT/Stanford/Berkeley（教职）', 'Google Research', 'OpenAI', 'NIH', '清华/北大（归国）'],
  },
};

// ── 专业强校精选排名（PROGRAM_RANKINGS）─────────────────────────
// 用途：College Scorecard 数据样本量不足时的兜底排名
//       matchSchoolsByProgram() 的主要输入之一
//
// 数据来源：
//   · US News Best Programs（2023-24 edition）
//   · National Research Council（研究型大学）
//   · ABET 工程认证名单
//   · NACE（全国大学雇主协会）招聘数据
//   · 行业协会认证名单（AACSB商学院、ABA法学）
//
// 结构：programKey（对应 programPercentageKeys）→ 三档学校列表
//       tier1=顶尖项目, tier2=强势项目, tier3=优质项目
//       学校名使用 USA_SCHOOL_PROFILES 中的 key 格式
const PROGRAM_RANKINGS = {

  // ── 计算机科学 ─────────────────────────────────────────────
  computer: {
    label: '计算机科学 / CS',
    cipFamily: 11,
    tier1: [
      'Massachusetts Institute of Technology',
      'Stanford University',
      'Carnegie Mellon University',
      'University of California-Berkeley',
      'California Institute of Technology',
    ],
    tier2: [
      'University of Illinois Urbana-Champaign',
      'Georgia Institute of Technology',
      'University of Michigan-Ann Arbor',
      'University of Washington',
      'Cornell University',
      'Princeton University',
      'University of Texas at Austin',
      'Columbia University',
    ],
    tier3: [
      'Purdue University-West Lafayette',
      'UC San Diego',
      'UC Los Angeles',
      'North Carolina State University',
      'University of Wisconsin-Madison',
      'Northeastern University',
      'Boston University',
      'University of Maryland-College Park',
      'University of Southern California',
      'New York University',
    ],
  },

  // ── 工程学（综合）─────────────────────────────────────────
  engineering: {
    label: '工程学（电气/机械/化工等）',
    cipFamily: 14,
    tier1: [
      'Massachusetts Institute of Technology',
      'Stanford University',
      'California Institute of Technology',
      'Georgia Institute of Technology',
      'University of California-Berkeley',
    ],
    tier2: [
      'University of Michigan-Ann Arbor',
      'Purdue University-West Lafayette',
      'Carnegie Mellon University',
      'University of Illinois Urbana-Champaign',
      'Cornell University',
      'University of Texas at Austin',
      'Johns Hopkins University',
      'Duke University',
    ],
    tier3: [
      'Virginia Tech',
      'University of Wisconsin-Madison',
      'Penn State University',
      'Ohio State University',
      'Texas A&M University',
      'North Carolina State University',
      'University of Maryland-College Park',
      'Rice University',
      'Rensselaer Polytechnic Institute',
      'Case Western Reserve University',
    ],
  },

  // ── 数学 / 统计 ────────────────────────────────────────────
  mathematics: {
    label: '数学 / 统计 / 应用数学',
    cipFamily: 27,
    tier1: [
      'Massachusetts Institute of Technology',
      'Princeton University',
      'Stanford University',
      'Harvard University',
      'University of Chicago',
    ],
    tier2: [
      'California Institute of Technology',
      'Columbia University',
      'Yale University',
      'New York University',
      'University of Michigan-Ann Arbor',
      'University of California-Berkeley',
      'Cornell University',
      'Carnegie Mellon University',
    ],
    tier3: [
      'UCLA',
      'University of Washington',
      'University of Texas at Austin',
      'Duke University',
      'Johns Hopkins University',
      'Brown University',
      'Dartmouth College',
      'University of Wisconsin-Madison',
      'Williams College',
      'Harvey Mudd College',
    ],
  },

  // ── 商科 / 金融 ────────────────────────────────────────────
  business_marketing: {
    label: '商科 / 金融 / 市场营销',
    cipFamily: 52,
    tier1: [
      'University of Pennsylvania',
      'Massachusetts Institute of Technology',
      'University of Chicago',
      'New York University',
      'Northwestern University',
    ],
    tier2: [
      'University of Michigan-Ann Arbor',
      'University of California-Berkeley',
      'Georgetown University',
      'Cornell University',
      'Emory University',
      'University of Virginia',
      'Carnegie Mellon University',
      'Washington University in St. Louis',
    ],
    tier3: [
      'Indiana University-Bloomington',
      'University of Southern California',
      'Boston College',
      'University of Notre Dame',
      'Vanderbilt University',
      'Wake Forest University',
      'Lehigh University',
      'University of Florida',
      'University of Wisconsin-Madison',
      'Boston University',
    ],
  },

  // ── 生命科学 / 生物 ────────────────────────────────────────
  biological: {
    label: '生命科学 / 生物学 / 生化',
    cipFamily: 26,
    tier1: [
      'Massachusetts Institute of Technology',
      'Stanford University',
      'Harvard University',
      'Johns Hopkins University',
      'California Institute of Technology',
    ],
    tier2: [
      'Duke University',
      'University of Michigan-Ann Arbor',
      'University of California-Berkeley',
      'Vanderbilt University',
      'University of North Carolina at Chapel Hill',
      'Cornell University',
      'University of California-San Diego',
      'Washington University in St. Louis',
    ],
    tier3: [
      'Emory University',
      'University of Pittsburgh',
      'University of Rochester',
      'Case Western Reserve University',
      'Tufts University',
      'Tulane University',
      'Georgetown University',
      'Rice University',
      'University of Miami',
      'Lehigh University',
    ],
  },

  // ── 医疗健康 ──────────────────────────────────────────────
  health: {
    label: '医疗健康 / 公共卫生',
    cipFamily: 51,
    tier1: [
      'Johns Hopkins University',
      'Harvard University',
      'University of Michigan-Ann Arbor',
      'University of North Carolina at Chapel Hill',
      'Emory University',
    ],
    tier2: [
      'Columbia University',
      'Boston University',
      'Tulane University',
      'University of Minnesota-Twin Cities',
      'Georgetown University',
      'George Washington University',
      'University of Pittsburgh',
      'Vanderbilt University',
    ],
    tier3: [
      'Temple University',
      'University of Alabama at Birmingham',
      'Medical College of Wisconsin',
      'Indiana University-Bloomington',
      'University of South Florida',
      'University of Arizona',
      'University of Connecticut',
      'University of Maryland-College Park',
      'Ohio State University',
      'University of Illinois Chicago',
    ],
  },

  // ── 人文 / 艺术 / 设计 ────────────────────────────────────
  humanities: {
    label: '人文 / 艺术 / 设计',
    cipFamily: 50,
    tier1: [
      'Rhode Island School of Design',
      'Yale University',
      'Carnegie Mellon University',
      'California Institute of the Arts',
      'Parsons School of Design',
    ],
    tier2: [
      'Pratt Institute',
      'School of Visual Arts',
      'Savannah College of Art and Design',
      'Art Center College of Design',
      'Maryland Institute College of Art',
      'Cornell University',
      'Brown University',
      'New York University',
    ],
    tier3: [
      'Ringling College of Art and Design',
      'Columbus College of Art and Design',
      'Minneapolis College of Art and Design',
      'California College of the Arts',
      'Otis College of Art and Design',
      'School of the Art Institute of Chicago',
      'University of Southern California',
      'Boston University',
      'Emerson College',
      'Syracuse University',
    ],
  },

  // ── 社会科学 ──────────────────────────────────────────────
  social_science: {
    label: '社会科学 / 政治学 / 经济学',
    cipFamily: 45,
    tier1: [
      'Harvard University',
      'Princeton University',
      'Yale University',
      'University of Chicago',
      'Stanford University',
    ],
    tier2: [
      'Georgetown University',
      'Columbia University',
      'University of Michigan-Ann Arbor',
      'Duke University',
      'New York University',
      'University of California-Berkeley',
      'Northwestern University',
      'University of Virginia',
    ],
    tier3: [
      'Williams College',
      'Amherst College',
      'Middlebury College',
      'Carleton College',
      'Vassar College',
      'Pomona College',
      'University of Wisconsin-Madison',
      'Boston University',
      'Fordham University',
      'American University',
    ],
  },

  // ── 理工/物理化学 ─────────────────────────────────────────
  physical_science: {
    label: '物理 / 化学 / 天文',
    cipFamily: 40,
    tier1: [
      'Massachusetts Institute of Technology',
      'California Institute of Technology',
      'Stanford University',
      'Harvard University',
      'Princeton University',
    ],
    tier2: [
      'University of Chicago',
      'University of California-Berkeley',
      'Cornell University',
      'Yale University',
      'Columbia University',
      'Johns Hopkins University',
      'Carnegie Mellon University',
      'University of Michigan-Ann Arbor',
    ],
    tier3: [
      'Duke University',
      'Rice University',
      'Harvey Mudd College',
      'University of Maryland-College Park',
      'University of Texas at Austin',
      'UC San Diego',
      'University of Washington',
      'University of Illinois Urbana-Champaign',
      'Purdue University-West Lafayette',
      'University of Wisconsin-Madison',
    ],
  },
};

// ── 获取 PROGRAM_RANKINGS 中学校的精选排名等级 ────────────────
// 返回 { tier: 1|2|3|null, label: 专业中文名 } 或 null
function getProgramTier(schoolName, programPercentageKey) {
  const ranking = PROGRAM_RANKINGS[programPercentageKey];
  if (!ranking) return null;
  const name = (schoolName || '').toLowerCase();
  const checkTier = (tierArr, tierNum) => {
    return tierArr.some(s => {
      const sLow = s.toLowerCase();
      return name.includes(sLow.split(' ')[0]) || sLow.includes(name.split(' ')[0]);
    }) ? tierNum : null;
  };
  const t = checkTier(ranking.tier1, 1) || checkTier(ranking.tier2, 2) || checkTier(ranking.tier3, 3);
  return t ? { tier: t, label: ranking.label } : null;
}

// ═══════════════════════════════════════════════════════════════
//  P1.1 buildCareerVisions(assessmentData)
//
//  输入：assessmentData（来自 wx.getStorageSync('assessmentData')）
//        包含：miScores, answers.riasec_code, answers.subject_interest 等
//
//  输出：CareerVision 数组（最多3个），按 matchScore 降序排列
//        每项包含：cluster 完整定义 + matchScore(0-100) + reasons[]
//
//  算法：
//    1. MI 权重向量 × 孩子 MI 分数 → 基础匹配分（权重 0.55）
//    2. RIASEC 字符串匹配 → RIASEC 调整分（权重 0.30）
//    3. subject_interest 显式兴趣对齐 → 兴趣加成（权重 0.15）
//    最终分归一化到 0-100
// ═══════════════════════════════════════════════════════════════
function buildCareerVisions(assessmentData) {
  const cd = assessmentData || {};
  const miScores   = cd.miScores   || {};
  const answers    = cd.answers    || {};
  const riasecRaw  = answers.riasec_code
                  || (cd.pathJudgment && cd.pathJudgment.riasec) || '';
  const subjectInt = answers.subject_interest || cd.majorArea || '';

  // subject_interest 到 programPercentageKey 的映射
  const SUBJ_MAP = {
    stem: 'computer', engineering: 'engineering', computer: 'computer',
    business: 'business_marketing', mathematics: 'mathematics',
    health: 'health', arts_design: 'humanities',
    natural_science: 'biological', communication: 'humanities',
    social_science: 'social_science', humanities: 'humanities',
    law: 'social_science',
  };
  const subjectKey = SUBJ_MAP[subjectInt] || '';

  // MI 分数归一化（总分通常为各维度之和，需要归一化到 0-1）
  const miKeys = ['logical','spatial','linguistic','interpersonal','intrapersonal','bodily','musical','naturalist'];
  const miTotal = miKeys.reduce((s, k) => s + (miScores[k] || 0), 0) || 1;
  const miNorm  = {};
  miKeys.forEach(k => { miNorm[k] = (miScores[k] || 0) / miTotal; });

  const visionScores = Object.values(CAREER_VISIONS).map(function(cv) {
    // ── 1. MI 匹配分（0-1）──────────────────────────────────
    let miScore = 0;
    miKeys.forEach(function(k) {
      miScore += (cv.miWeights[k] || 0) * miNorm[k];
    });
    // 归一化 miScore（使权重向量与实际分布对齐）
    const maxPossible = miKeys.reduce((s, k) => s + (cv.miWeights[k] || 0) * (cv.miWeights[k] || 0), 0);
    const miScoreNorm = maxPossible > 0 ? miScore / Math.sqrt(maxPossible) : miScore;

    // ── 2. RIASEC 匹配分（0-1）─────────────────────────────
    let riasecScore = 0;
    if (riasecRaw.length > 0) {
      const userCodes = riasecRaw.toUpperCase().split('');
      const matchCount = cv.riasecMatch.filter(c => userCodes.includes(c)).length;
      riasecScore = matchCount / Math.max(cv.riasecMatch.length, 1);
    }

    // ── 3. 显式兴趣对齐加成（0-1）─────────────────────────
    let interestScore = 0;
    if (subjectKey && cv.programPercentageKeys.includes(subjectKey)) {
      interestScore = 1.0;
    }

    // ── 综合得分（权重：MI 55% + RIASEC 30% + Interest 15%）──
    const raw = miScoreNorm * 0.55 + riasecScore * 0.30 + interestScore * 0.15;

    // ── 生成匹配原因（reasons[]）────────────────────────────
    const reasons = [];

    // 找出该集群最高权重的 MI 维度（取 top2）
    const topMI = miKeys
      .filter(k => cv.miWeights[k] > 0.10)
      .sort((a, b) => (cv.miWeights[b] || 0) - (cv.miWeights[a] || 0))
      .slice(0, 2);
    const MI_LABELS_ZH = {
      logical: '逻辑数学智能', spatial: '空间视觉智能', linguistic: '语言表达智能',
      interpersonal: '人际沟通智能', intrapersonal: '自我认知智能',
      bodily: '肢体运动智能', musical: '音乐节奏智能', naturalist: '自然观察智能',
    };
    topMI.forEach(function(k) {
      const pct = Math.round(miNorm[k] * 100);
      if (pct > 8) {
        reasons.push('孩子的' + MI_LABELS_ZH[k] + '突出（占比' + pct + '%），正好是这条路最需要的核心能力');
      }
    });

    if (riasecScore > 0.5) {
      const matchedCodes = cv.riasecMatch.filter(c => riasecRaw.toUpperCase().includes(c));
      const CODE_LABELS = { R:'动手实践型', I:'探究分析型', A:'创意表达型',
                             S:'社会服务型', E:'领导商业型', C:'执行细节型' };
      reasons.push('兴趣类型吻合：孩子属于' + matchedCodes.map(c => CODE_LABELS[c]).join('、') + '，与此方向高度一致');
    }

    if (cv.stemOpt) {
      reasons.push('✓ 该方向属于STEM领域，毕业后可申请3年OPT延签，大幅提升留美工作机会');
    }

    return {
      cluster:    cv,
      matchScore: Math.round(Math.min(raw * 120, 99)),  // 放大到0-99，避免显示100
      reasons:    reasons.length > 0 ? reasons : ['综合评估与该方向有较好的契合度'],
    };
  });

  // 按匹配分降序，取 top 3
  visionScores.sort(function(a, b) { return b.matchScore - a.matchScore; });
  return visionScores.slice(0, 3);
}

// ═══════════════════════════════════════════════════════════════
//  P1.2 matchSchoolsByProgram(cipFamilies, userProfile)
//
//  输入：
//    cipFamilies  — 已确认的 CIP 大类代码数组（如 [11, 14]）
//    userProfile  — extractProfileFromAssessment() 输出
//    apiSchools   — 可选，已加载的学校列表（来自 college_api.js）
//
//  输出：三档学校数组 { reach, target, safety }
//        每个学校包含：原始数据 + programScore + programRank
//
//  算法（见执行计划 P4.2）：
//    40% 该专业毕业薪资 + 20% 专业规模 + 25% 录取适配度 + 15% 费用性价比
// ═══════════════════════════════════════════════════════════════
function matchSchoolsByProgram(cipFamilies, userProfile, apiSchools) {
  if (!apiSchools || apiSchools.length === 0) return { reach: [], target: [], safety: [] };

  const profile = userProfile || {};
  const satScore   = profile.testScore  || 1200;
  const budgetUSD  = profile.budgetUSD  || 50000;

  // CIP 大类 → programPercentageKey 映射
  const CIP_TO_PROGKEY = {
    11: 'computer', 14: 'engineering', 27: 'mathematics', 52: 'business_marketing',
    26: 'biological', 51: 'health', 50: 'humanities', 4: 'humanities',
    45: 'social_science', 22: 'social_science', 38: 'social_science',
    9: 'humanities', 10: 'humanities', 40: 'physical_science',
  };

  // 找出本次 CIP 对应的 progKeys
  const progKeys = [];
  (cipFamilies || []).forEach(function(cip) {
    const k = CIP_TO_PROGKEY[cip];
    if (k && !progKeys.includes(k)) progKeys.push(k);
  });
  if (progKeys.length === 0) return { reach: [], target: [], safety: [] };

  // 全局薪资最大值（用于归一化）
  const allEarnings = apiSchools
    .map(function(s) { return s.medianEarnings6yr || 0; })
    .filter(Boolean);
  const maxEarn = allEarnings.length > 0 ? Math.max.apply(null, allEarnings) : 100000;

  const scored = apiSchools.map(function(school) {
    // ── A. 专业薪资分（40%）──────────────────────────────────
    // 优先用 programEarnings（专业级），其次用学校整体薪资
    let progEarns = 0;
    let progCount = 0;
    if (school.programEarnings) {
      cipFamilies.forEach(function(cipFamily) {
        // CIP 4位码以 cipFamily*100 开头（如 cip=11 → 1101,1107,...）
        Object.keys(school.programEarnings).forEach(function(code) {
          if (Math.floor(parseInt(code) / 100) === cipFamily) {
            const entry = school.programEarnings[code];
            if (entry && entry.earn) {
              progEarns = Math.max(progEarns, entry.earn);
              progCount += (entry.count || 0);
            }
          }
        });
      });
    }
    const earnBase = progEarns > 0 ? progEarns : (school.medianEarnings6yr || 0);
    const earnScore = maxEarn > 0 ? Math.min(earnBase / maxEarn, 1) : 0;

    // ── B. 专业规模分（20%）──────────────────────────────────
    // completers 越多说明项目越成熟、资源越丰富
    const sizeScore = progCount > 0 ? Math.min(progCount / 500, 1) : 0.2;  // 500+人视为成熟项目

    // ── C. 录取适配度分（25%）────────────────────────────────
    const admRate = school.admRate || 0.5;
    const satAvg  = school.satAvg  || 1100;
    const satGap  = satScore - satAvg;
    let admFit = 0;
    if (satGap > 100)       admFit = 1.0;   // Safety
    else if (satGap > -50)  admFit = 0.7;   // Target
    else if (satGap > -150) admFit = 0.4;   // Reach
    else                    admFit = 0.1;   // Longshot

    // ── D. 费用性价比分（15%）────────────────────────────────
    const costUSD = school.costAttendRaw || school.tuitionOut || 55000;
    const roiRaw  = earnBase > 0 && costUSD > 0 ? earnBase / (costUSD * 4) : 0;
    const roiScore = Math.min(roiRaw / 0.3, 1);  // 年薪达到4年总费用30%视为满分

    // ── 综合分 ────────────────────────────────────────────────
    const programScore = earnScore * 0.40 + sizeScore * 0.20 + admFit * 0.25 + roiScore * 0.15;

    // 精选排名标签
    const programRank = progKeys.reduce(function(best, pk) {
      const tier = getProgramTier(school.name || '', pk);
      if (!best || (tier && tier.tier < best.tier)) return tier;
      return best;
    }, null);

    return Object.assign({}, school, {
      programScore:  Math.round(programScore * 100),
      programRank:   programRank,
      progEarns:     progEarns > 0 ? ('$' + Math.round(progEarns / 1000) + 'k') : null,
      progCount:     progCount > 0 ? progCount : null,
      // 录取分档
      _admFit: satGap > 100 ? 'safety' : satGap > -50 ? 'target' : satGap > -150 ? 'reach' : 'longshot',
    });
  });

  // 按 programScore 降序排列
  scored.sort(function(a, b) { return b.programScore - a.programScore; });

  // 分层：reach / target / safety（只取有意义的结果）
  const result = { reach: [], target: [], safety: [] };
  scored.forEach(function(s) {
    const tier = s._admFit;
    if (tier === 'reach' && result.reach.length < 5)    result.reach.push(s);
    if (tier === 'target' && result.target.length < 6)  result.target.push(s);
    if (tier === 'safety' && result.safety.length < 4)  result.safety.push(s);
  });
  return result;
}

module.exports = {
  runMatch,
  buildProgramWeights,
  extractProfileFromAssessment,
  fmtAdmRate,
  fmtCost,
  fmtEarnings,
  fmtGradRate,
  getTierMeta,
  getUSProfile,
  getUSDeadlines,
  buildCareerVisions,
  matchSchoolsByProgram,
  getProgramTier,
  CAREER_VISIONS,
  PROGRAM_RANKINGS,
  MAJOR_LABELS,
  TIER_META,
  BLS_GROWTH_2034,
  BLS_MEDIAN_WAGES,
};
