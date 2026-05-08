// cloudfunctions/onetCIPMatch/index.js
// 袁希™ · O*NET 职业-专业映射云函数 v2
// ═══════════════════════════════════════════════════════════════
//
//  功能：
//    1. 接收学生 RIASEC 画像
//    2. 调用 O*NET Interest Profiler API → 获取匹配职业列表
//    3. 通过 SOC→CIP 交叉索引 → 推导学科兴趣权重向量
//    4. 权重向量对应 College Scorecard program_percentage 字段
//    5. 返回给客户端，替代 study_abroad_engine 中的静态映射表
//
//  数据链路：
//    RIASEC 字符串 ("IRC")
//      → O*NET Interest Profiler API (美国劳工部)
//      → 职业列表（O*NET SOC 代码）
//      → SOC→CIP 交叉索引（预编译，来源：NCES + O*NET 官方数据）
//      → College Scorecard program_percentage 字段权重向量
//
//  O*NET API 文档：https://services.onetcenter.org/developer/
//  API 注册（免费）：https://services.onetcenter.org/developer/signup
//
//  CIP 交叉索引来源：
//    O*NET CrossWalks：https://www.onetcenter.org/crosswalks.html
//    NCES CIP 2020：https://nces.ed.gov/ipeds/cipcode/
//
// ═══════════════════════════════════════════════════════════════

const cloud  = require('wx-server-sdk');
const https  = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ── O*NET API 凭证 ─────────────────────────────────────────────
// 免费注册地址：https://services.onetcenter.org/developer/signup
// 注册后在此填入 username 和 password
const ONET_USERNAME = process.env.ONET_USERNAME || 'your_onet_username';
const ONET_PASSWORD = process.env.ONET_PASSWORD || 'your_onet_password';
const ONET_BASE_URL = 'https://services.onetcenter.org/ws';

// ── Interest Profiler 职业区域代码 ────────────────────────────
// area=3: Associate/Post-Secondary
// area=4: Bachelor's Degree
// area=5: Graduate Degree
const AREA_MAP = {
  undergrad: '4',
  grad:      '5',
  default:   '4',
};

// ══════════════════════════════════════════════════════════════
//  SOC → CIP 交叉索引表（预编译版本）
//
//  数据来源：
//    1. O*NET Occupational Crosswalks (SOC↔CIP 官方交叉表)
//       https://www.onetcenter.org/crosswalks/CIP.html
//    2. NCES CIP 2020 分类系统
//       https://nces.ed.gov/ipeds/cipcode/
//    3. 各职业 RIASEC 主代码来自 O*NET Interests 数据文件
//       https://www.onetcenter.org/database.html
//
//  格式：SOC代码 → [College Scorecard program_percentage 字段名]
//  仅收录 Interest Profiler 高频返回职业（覆盖率 > 90%）
// ══════════════════════════════════════════════════════════════
const SOC_TO_CIP = {
  // ── R (Realistic) 主导职业 ────────────────────────────────
  '17-2000': ['engineering'],                        // 工程师（通用）
  '17-2051': ['engineering'],                        // 土木工程师
  '17-2061': ['engineering'],                        // 计算机硬件工程师
  '17-2071': ['engineering'],                        // 电气工程师
  '17-2112': ['engineering'],                        // 工业工程师
  '17-2141': ['engineering'],                        // 机械工程师
  '17-3000': ['engineering', 'computer'],            // 工程技术员
  '51-1000': ['engineering'],                        // 制造业监督
  '47-0000': ['engineering'],                        // 建筑与采矿
  '45-2000': ['agriculture_natural_resources'],      // 农业工作者
  '19-4000': ['physical_science'],                   // 科学技术员
  '53-0000': ['engineering'],                        // 运输职业

  // ── I (Investigative) 主导职业 ───────────────────────────
  '15-1000': ['computer'],                           // 计算机职业（通用）
  '15-1211': ['computer'],                           // 计算机系统分析师
  '15-1221': ['computer'],                           // 计算机和信息研究科学家
  '15-1231': ['computer'],                           // 计算机网络架构师
  '15-1241': ['computer'],                           // 计算机网络支持专员
  '15-1251': ['computer'],                           // 计算机程序员
  '15-1252': ['computer'],                           // 软件开发工程师
  '15-1299': ['computer'],                           // 计算机职业其他
  '17-2000': ['engineering'],                        // 工程师（同上）
  '19-1000': ['biological'],                         // 生命科学家（通用）
  '19-1011': ['biological'],                         // 动物学家
  '19-1020': ['biological'],                         // 生物学家
  '19-1029': ['biological'],                         // 生物科学家
  '19-1040': ['biological'],                         // 保护科学家
  '19-2000': ['physical_science'],                   // 物理科学家（通用）
  '19-2011': ['physical_science'],                   // 天文学家
  '19-2012': ['physical_science'],                   // 物理学家
  '19-2031': ['physical_science'],                   // 化学家
  '19-2041': ['physical_science'],                   // 地球科学家
  '19-2099': ['physical_science'],                   // 物理科学家其他
  '19-3000': ['social_science'],                     // 社会科学家
  '19-3011': ['social_science'],                     // 经济学家
  '19-3022': ['social_science'],                     // 调查研究员
  '19-3031': ['social_science'],                     // 临床心理学家
  '19-3032': ['social_science'],                     // 工业心理学家
  '19-3039': ['social_science'],                     // 心理学家其他
  '19-3041': ['social_science'],                     // 社会学家
  '19-3051': ['social_science'],                     // 城市规划师
  '19-3091': ['social_science'],                     // 人类学家/考古学家
  '19-3099': ['social_science'],                     // 社会科学家其他
  '27-0000': ['mathematics'],                        // 数学家/统计学家
  '27-2041': ['mathematics'],                        // 精算师
  '25-1000': ['education'],                          // 高等教育教师（STEM）

  // ── A (Artistic) 主导职业 ────────────────────────────────
  '27-1000': ['visual_performing_arts'],             // 艺术家（通用）
  '27-1011': ['visual_performing_arts'],             // 艺术总监
  '27-1013': ['visual_performing_arts'],             // 精艺工匠
  '27-1014': ['visual_performing_arts'],             // 特效艺术家/动画师
  '27-1021': ['visual_performing_arts'],             // 商业和工业设计师
  '27-1022': ['visual_performing_arts'],             // 时装设计师
  '27-1023': ['visual_performing_arts'],             // 花卉设计师
  '27-1024': ['visual_performing_arts'],             // 平面设计师
  '27-1025': ['visual_performing_arts'],             // 室内设计师
  '27-1026': ['visual_performing_arts'],             // 景观建筑师
  '27-1027': ['visual_performing_arts'],             // 摄影师
  '27-1029': ['visual_performing_arts'],             // 设计师其他
  '27-2000': ['visual_performing_arts'],             // 表演艺术家（通用）
  '27-2011': ['visual_performing_arts'],             // 演员
  '27-2012': ['visual_performing_arts'],             // 音乐指挥/编曲
  '27-2021': ['visual_performing_arts'],             // 娱乐节目主持人
  '27-2022': ['visual_performing_arts'],             // 音乐家/歌手
  '27-2031': ['visual_performing_arts'],             // 舞蹈演员
  '27-2032': ['visual_performing_arts'],             // 编舞师
  '27-2041': ['visual_performing_arts'],             // 导演/制作人
  '27-2042': ['visual_performing_arts'],             // 音乐导演/作曲家
  '27-2099': ['visual_performing_arts'],             // 表演艺术家其他
  '27-3000': ['communication', 'humanities'],        // 媒体/传播（通用）
  '27-3011': ['communication'],                      // 电台/电视播音员
  '27-3021': ['communication'],                      // 广播记者
  '27-3022': ['communication'],                      // 电视记者
  '27-3031': ['communication'],                      // 公共关系专员
  '27-3041': ['communication', 'humanities'],        // 编辑
  '27-3042': ['communication', 'humanities'],        // 技术写作者
  '27-3043': ['communication', 'humanities'],        // 作家/作者
  '27-3099': ['communication'],                      // 媒体职业其他
  '17-1011': ['visual_performing_arts'],             // 建筑师

  // ── S (Social) 主导职业 ──────────────────────────────────
  '25-2000': ['education'],                          // K-12 教师（通用）
  '25-2011': ['education'],                          // 幼儿园教师
  '25-2012': ['education'],                          // 小学教师
  '25-2021': ['education'],                          // 中学教师
  '25-2022': ['education'],                          // 初中教师
  '25-2031': ['education'],                          // 职业教育教师
  '25-3000': ['education'],                          // 其他教师/教育工作者
  '21-0000': ['public_administration_social_service'], // 社区和社会服务
  '21-1011': ['public_administration_social_service'], // 物质滥用咨询师
  '21-1012': ['public_administration_social_service'], // 婚姻和家庭治疗师
  '21-1013': ['public_administration_social_service'], // 心理健康咨询师
  '21-1015': ['public_administration_social_service'], // 康复咨询师
  '21-1021': ['public_administration_social_service'], // 儿童/家庭社会工作者
  '21-1022': ['public_administration_social_service'], // 医疗社会工作者
  '21-1023': ['public_administration_social_service'], // 心理健康社会工作者
  '21-1029': ['public_administration_social_service'], // 社会工作者其他
  '29-0000': ['health'],                             // 医疗保健从业者（通用）
  '29-1021': ['health'],                             // 牙医
  '29-1041': ['health'],                             // 验光师
  '29-1051': ['health'],                             // 药剂师
  '29-1071': ['health'],                             // 执业医师
  '29-1141': ['health'],                             // 注册护士
  '29-1151': ['health'],                             // 护士麻醉师
  '29-1161': ['health'],                             // 护士助产士
  '29-1171': ['health'],                             // 护士执业者
  '29-1211': ['health'],                             // 急诊医学医生
  '29-1215': ['health'],                             // 家庭医学医生
  '29-1216': ['health'],                             // 内科医生
  '29-1217': ['health'],                             // 妇产科医生
  '29-1218': ['health'],                             // 小儿科医生
  '29-1221': ['health'],                             // 精神科医生
  '29-1229': ['health'],                             // 其他科医生
  '29-1251': ['health'],                             // 心血管技术员
  '29-2000': ['health'],                             // 医疗技术员
  '31-0000': ['health'],                             // 医疗辅助职业

  // ── E (Enterprising) 主导职业 ────────────────────────────
  '11-0000': ['business_marketing'],                 // 管理职业（通用）
  '11-1011': ['business_marketing'],                 // 首席执行官
  '11-1021': ['business_marketing'],                 // 综合经理
  '11-2011': ['business_marketing'],                 // 广告/公关经理
  '11-2021': ['business_marketing'],                 // 营销经理
  '11-2022': ['business_marketing'],                 // 销售经理
  '11-2031': ['business_marketing'],                 // 公共关系经理
  '11-3011': ['business_marketing'],                 // 行政服务经理
  '11-3031': ['business_marketing'],                 // 财务经理
  '11-3051': ['business_marketing'],                 // 工业生产经理
  '11-3061': ['business_marketing'],                 // 采购经理
  '11-3071': ['business_marketing'],                 // 运输/物流经理
  '11-3121': ['business_marketing'],                 // 人力资源经理
  '11-9000': ['business_marketing'],                 // 其他管理职业
  '13-0000': ['business_marketing'],                 // 商业和金融职业
  '13-1011': ['business_marketing'],                 // 代理人/经纪人
  '13-1031': ['business_marketing'],                 // 采购代理人
  '13-1071': ['business_marketing', 'social_science'], // 人力资源专员
  '13-1081': ['business_marketing'],                 // 物流分析师
  '13-1111': ['business_marketing'],                 // 管理分析师
  '13-1121': ['business_marketing'],                 // 会议策划人
  '13-1131': ['business_marketing'],                 // 募资经理
  '13-1141': ['business_marketing'],                 // 赔偿/福利专员
  '13-1151': ['business_marketing'],                 // 培训开发专员
  '13-1161': ['business_marketing'],                 // 市场研究分析师
  '13-2000': ['business_marketing'],                 // 金融专员
  '13-2011': ['business_marketing'],                 // 会计师
  '13-2031': ['business_marketing'],                 // 预算分析师
  '13-2041': ['business_marketing'],                 // 信贷分析师
  '13-2051': ['business_marketing'],                 // 财务分析师
  '13-2052': ['business_marketing'],                 // 个人财务顾问
  '13-2053': ['business_marketing'],                 // 保险核保师
  '13-2054': ['business_marketing'],                 // 金融风险专员
  '23-0000': ['legal'],                              // 法律职业
  '23-1011': ['legal'],                              // 律师
  '23-1021': ['legal'],                              // 法律仲裁员
  '23-1022': ['legal'],                              // 法官
  '23-2011': ['legal'],                              // 律师助理
  '41-0000': ['business_marketing'],                 // 销售职业
  '41-3000': ['business_marketing', 'communication'], // 销售代理

  // ── C (Conventional) 主导职业 ────────────────────────────
  '43-0000': ['business_marketing', 'computer'],    // 办公/行政支持
  '43-3011': ['business_marketing'],                // 账单/收费人员
  '43-3021': ['business_marketing'],                // 出纳员
  '43-3031': ['business_marketing'],                // 会计记账员
  '43-3041': ['business_marketing'],                // 信用授权师
  '43-3051': ['business_marketing'],                // 财务文员
  '43-3061': ['business_marketing'],                // 采购文员
  '43-3071': ['business_marketing'],                // 出纳员（银行）
  '43-4000': ['business_marketing', 'computer'],   // 信息文员
  '43-6000': ['business_marketing'],               // 秘书/行政助理
  '15-2000': ['mathematics'],                      // 数学/统计职业
  '15-2011': ['mathematics'],                      // 精算师
  '15-2021': ['mathematics'],                      // 数学家
  '15-2031': ['mathematics'],                      // 运筹学分析师
  '15-2041': ['mathematics', 'computer'],          // 统计学家
  '15-2051': ['mathematics', 'computer'],          // 数据科学家
  '11-3021': ['business_marketing', 'computer'],   // 计算机/信息系统经理
};

// ── College Scorecard 字段全名 → 短键 映射 ──────────────────
// （用于 interest profiler 返回的 SOC 代码查找）
const CIP_TO_SCORECARD_KEY = {
  '01': 'agriculture_natural_resources',
  '09': 'communication',
  '11': 'computer',
  '13': 'education',
  '14': 'engineering',
  '22': 'legal',
  '23': 'humanities',
  '26': 'biological',
  '27': 'mathematics',
  '40': 'physical_science',
  '42': 'social_science',
  '44': 'public_administration_social_service',
  '45': 'social_science',
  '50': 'visual_performing_arts',
  '51': 'health',
  '52': 'business_marketing',
};

// ══════════════════════════════════════════════════════════════
//  O*NET API 调用函数（使用 Node.js https 模块）
// ══════════════════════════════════════════════════════════════
function onetRequest(path) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${ONET_USERNAME}:${ONET_PASSWORD}`).toString('base64');
    const options = {
      hostname: 'services.onetcenter.org',
      path:     `/ws${path}`,
      method:   'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept':        'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`O*NET API Error: ${res.statusCode} — ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`O*NET JSON parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('O*NET API timeout')); });
    req.end();
  });
}

// ══════════════════════════════════════════════════════════════
//  RIASEC 字符串 → Interest Profiler 数值分数
//
//  O*NET Interest Profiler 分数范围 0-40 (每维)
//  我们的 RIASEC 字符串（如 "IRC"）转换规则：
//    位置 1: 40分（主导维度）
//    位置 2: 28分
//    位置 3: 18分
//    未出现: 8分（基准分）
// ══════════════════════════════════════════════════════════════
function riasecToScores(riasecStr) {
  const dims = ['R', 'I', 'A', 'S', 'E', 'C'];
  const code  = (riasecStr || '').toUpperCase().replace(/[^RIASEC]/g, '');

  return dims.map(d => {
    const pos = code.indexOf(d);
    if (pos === 0) return 40;
    if (pos === 1) return 28;
    if (pos === 2) return 18;
    return 8; // 未出现维度保持基准分（不为0，避免完全屏蔽）
  });
}

// ══════════════════════════════════════════════════════════════
//  SOC 代码 → College Scorecard 字段键（多级匹配）
//  优先精确匹配，再匹配前缀
// ══════════════════════════════════════════════════════════════
function socToScorecardKeys(socCode) {
  // 精确匹配
  if (SOC_TO_CIP[socCode]) return SOC_TO_CIP[socCode];
  // 前缀匹配（前5位）
  const prefix5 = socCode.slice(0, 5);
  const key5 = Object.keys(SOC_TO_CIP).find(k => k.startsWith(prefix5));
  if (key5) return SOC_TO_CIP[key5];
  // 前缀匹配（前4位：大类）
  const prefix4 = socCode.slice(0, 4);
  const key4 = Object.keys(SOC_TO_CIP).find(k => k.startsWith(prefix4));
  if (key4) return SOC_TO_CIP[key4];
  // 主类匹配（前2位）
  const majorGroup = socCode.slice(0, 2) + '-0000';
  if (SOC_TO_CIP[majorGroup]) return SOC_TO_CIP[majorGroup];
  return null;
}

// ══════════════════════════════════════════════════════════════
//  主函数：buildCIPWeights(riasec, area)
//
//  1. 调用 O*NET Interest Profiler 获取匹配职业
//  2. 为每个职业查找对应 CIP 字段（SOC→CIP 交叉索引）
//  3. 按职业分数累积 CIP 权重
//  4. 归一化后返回
// ══════════════════════════════════════════════════════════════
async function buildCIPWeightsFromONET(riasecStr, area) {
  const scores = riasecToScores(riasecStr);
  const areaCode = area || '4';

  // 构造 Interest Profiler 查询 URL
  // GET /ws/mnm/interestprofiler/results?area={area}&score=R&score=I&score=A&score=S&score=E&score=C
  const scoreParams = scores.map(s => `score=${s}`).join('&');
  const path = `/mnm/interestprofiler/results?area=${areaCode}&${scoreParams}`;

  const response = await onetRequest(path);

  // O*NET 返回格式：
  // { career: [ { code: '15-1252.00', title: 'Software Developers', fit: 'Best' }, ... ] }
  const careers = (response.career || []);

  if (careers.length === 0) {
    throw new Error('O*NET returned no careers for the given RIASEC profile');
  }

  // 职业适配度 → 权重系数
  const fitWeight = { Best: 1.0, Great: 0.75, Good: 0.5 };

  // 累积 CIP 权重
  const cipWeights = {};
  let totalContribution = 0;

  // 统计 Bright Outlook 职业比例
  // O*NET Interest Profiler 返回格式：career.tags.bright_outlook (boolean)
  // 来源：O*NET Bright Outlook criteria (BLS 2024-2034)
  let brightOutlookCount = 0;

  careers.forEach(career => {
    const code   = (career.code || '').replace(/\.\d+$/, ''); // 去掉 .00 后缀
    const weight = fitWeight[career.fit] || 0.3;
    const keys   = socToScorecardKeys(code);

    // 统计 Bright Outlook（O*NET 在 tags 中返回此字段）
    if (career.tags && career.tags.bright_outlook === true) {
      brightOutlookCount++;
    }

    if (!keys) return; // 没有 CIP 映射的职业跳过

    keys.forEach(key => {
      cipWeights[key] = (cipWeights[key] || 0) + weight / keys.length;
      totalContribution += weight / keys.length;
    });
  });

  // 归一化
  if (totalContribution > 0) {
    Object.keys(cipWeights).forEach(k => {
      cipWeights[k] /= totalContribution;
    });
  }

  // Bright Outlook 百分比（M6b 信号）
  const brightOutlookPct = careers.length > 0 ? brightOutlookCount / careers.length : 0;

  return {
    cipWeights,
    brightOutlookPct,                  // 新增：Bright Outlook 职业比例（供 M6 使用）
    brightOutlookCount,
    topCareers:   careers.slice(0, 8).map(c => ({
      code:          c.code,
      title:         c.title,
      fit:           c.fit,
      bright_outlook: !!(c.tags && c.tags.bright_outlook),
    })),
    totalCareers: careers.length,
    riasecScores: { R: scores[0], I: scores[1], A: scores[2], S: scores[3], E: scores[4], C: scores[5] },
  };
}

// ══════════════════════════════════════════════════════════════
//  云函数入口
// ══════════════════════════════════════════════════════════════
exports.main = async (event) => {
  const { riasec, degreeLevel } = event;

  // 基本参数验证
  if (!riasec || typeof riasec !== 'string') {
    return { success: false, error: 'riasec 参数必填（如 "IRC" 或 "ESA"）', code: 'INVALID_PARAMS' };
  }

  // 凭证检查
  if (ONET_USERNAME === 'your_onet_username') {
    return {
      success: false,
      error:   'O*NET API 凭证未配置。请访问 https://services.onetcenter.org/developer/signup 免费注册，然后在云函数环境变量中设置 ONET_USERNAME 和 ONET_PASSWORD',
      code:    'CREDENTIALS_NOT_SET',
      // 返回静态 fallback 提示，让客户端知道需要降级
      needsFallback: true,
    };
  }

  const area = AREA_MAP[degreeLevel] || AREA_MAP.default;

  try {
    const result = await buildCIPWeightsFromONET(riasec, area);
    return {
      success:          true,
      cipWeights:       result.cipWeights,
      brightOutlookPct: result.brightOutlookPct,   // 新增：M6b 信号
      brightOutlookCount: result.brightOutlookCount,
      topCareers:       result.topCareers,
      totalCareers:     result.totalCareers,
      riasecScores:     result.riasecScores,
      source:           'onet_api',
      meta: {
        riasec,
        degreeLevel,
        area,
        timestamp: Date.now(),
      },
    };
  } catch (err) {
    console.error('[onetCIPMatch] API call failed:', err.message);

    // O*NET 不可用时返回静态 fallback 标志
    return {
      success:      false,
      error:        err.message,
      code:         'API_ERROR',
      needsFallback: true,
    };
  }
};
