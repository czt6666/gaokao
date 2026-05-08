// cloudfunctions/aiAnalysis/index.js
// 袁希™ · AI 分析云函数
//
// ═══════════════════════════════════════════════════════════════
//  功能：接收评估数据，调用 DeepSeek API，返回结构化分析报告
//
//  接入说明：
//  1. 在微信开发者工具 → 云开发 → 云函数 → 新建 "aiAnalysis"
//  2. 将此文件上传并部署
//  3. 在 ai-chat.js 中将 USE_REAL_AI 改为 true
//
//  API 选择：DeepSeek（推荐，国内可用，性价比高）
//  官网：https://platform.deepseek.com
//  价格：输入 ¥0.001/千tokens，输出 ¥0.002/千tokens
// ═══════════════════════════════════════════════════════════════

const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ── DeepSeek API 配置 ──────────────────────────────────────────
// 在此填入你的 DeepSeek API Key
// 获取地址：https://platform.deepseek.com/api_keys
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-fc6e5dacf2dd43e885e360fae5b032d0';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';   // deepseek-chat (通用) | deepseek-reasoner (深度推理)

// ── MI 维度中文名 ──────────────────────────────────────────────
const MI_LABELS = {
  linguistic:    '语言智能',
  logical:       '逻辑数学智能',
  spatial:       '空间视觉智能',
  musical:       '音乐节奏智能',
  bodily:        '身体运动智能',
  interpersonal: '人际交往智能',
  intrapersonal: '自我认知智能',
  naturalist:    '自然探索智能',
};

const GRADE_LABELS = {
  primary: '小学阶段', middle: '初中阶段', high: '高中阶段',
};

const PATH_LABELS = {
  gaokao:             '国内高考路线',
  highschool_abroad:  '高中出国路线',
  university_abroad:  '大学出国路线',
  international_school: '国际学校路线',
  undecided:          '尚未决定',
};

const PARENT_LABELS = {
  traditional:     '传统型家长（注重稳定和成绩）',
  progressive:     '进步型家长（注重兴趣和创造力）',
  business_family: '商业世家（重视人脉与国际视野）',
  entrepreneur:    '创业者家庭（重视冒险与自主创新）',
  academic:        '学术型家庭（重视学术深度）',
};

// ── 构建分析提示词 ─────────────────────────────────────────────
function buildPrompt(event) {
  const cd = event.assessmentData || {};
  const miScores = cd.miScores || {};
  const answers  = cd.answers  || {};

  // 整理 MI 数据
  const miLines = Object.entries(miScores)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  · ${MI_LABELS[k] || k}：${v}/5 分`)
    .join('\n');

  const topMI = Object.entries(miScores)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k]) => MI_LABELS[k] || k).join('、');

  const mindset = cd.mindsetScore || 3;
  const mindsetDesc = mindset >= 4 ? '成长型思维（优秀）'
    : mindset >= 3 ? '思维模式发展中（良好基础）'
    : '固化型思维倾向（需要重点培养）';

  const grade     = GRADE_LABELS[cd.currentGrade]    || '未知年级';
  const passport  = cd.passportType === 'cn' ? '中国大陆护照' : cd.passportType === 'foreign' ? '外国护照' :🤡 '双重国籍';
  const path      = PATH_LABELS[answers.education_path_preference]  || '综合多元路线';
  const goal      = answers.goal_at_25 || '未填写';
  const budget    = answers.education_budget || '未填写';
  const parentType = PARENT_LABELS[cd.parentType] || '未知类型';

  const prompt = event.customPrompt || `你是袁希™教育顾问系统，由袁希创始人的教育哲学驱动。

## 你的分析框架（必须体现）
1. **袁希三轴框架**：孩子天赋特质（MI维度）× 家庭教育资源（预算、价值观）× 社会机遇窗口（路径选择）
2. **Gardner多元智能理论**：8个维度全面解读，避免单一智商评价
3. **Carol Dweck成长型思维**：思维模式是所有成就的底层支撑，比智力更重要

## 孩子评估数据
- **姓名**：${cd.childName || '孩子'}
- **年级阶段**：${grade}
- **护照类型**：${passport}

**多元智能评估结果（1-5分制）**：
${miLines}
→ 突出优势智能：**${topMI}**

**思维模式**：${mindsetDesc}（${mindset}/5分）

**家庭背景**：
- 家长类型：${parentType}
- 教育预算：${budget}

**教育规划**：
- 倾向路径：${path}
- 25岁目标：${goal}

## 输出要求
请用**袁希的口吻**（温暖、专业、有洞察力，像一位真正了解这个孩子的导师），生成一份600-800字的个性化分析报告，包含：

1. **开篇洞察**（2-3句）：用一个具体的角度切入，让家长感受到"被看见"
2. **天赋密码解读**（核心部分）：结合MI数据，深入分析这个孩子最独特的智能组合，不要泛泛而谈
3. **思维模式评估**：基于Dweck理论，具体说明当前思维模式的表现和培养方向
4. **三轴交叉分析**：天赋 × 家庭资源 × 路径选择，提出1-2个具体的战略性建议
5. **结语**（1-2句）：给家长一句有力量的话

**语言风格**：
- 专业但不学术，温暖但不失洞察
- 具体而非抽象（要说"你孩子的空间视觉让他/她天然适合..."而非"这个孩子有潜力"）
- 适度引用理论，但重点是对这个孩子的独特分析
- 请用中文输出`;

  return prompt;
}

// ── HTTPS 请求封装（支持 DeepSeek / OpenAI 格式）────────────────
function callDeepSeek(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: '你是袁希™专业教育评估顾问，擅长将心理学理论（Gardner、Dweck）与实际教育规划相结合，以袁希创始人的洞察力和温度进行分析。',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1200,
      temperature: 0.85,
      stream: false,
    });

    const options = {
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(`DeepSeek API Error: ${json.error.message}`));
          } else {
            const text = json.choices?.[0]?.message?.content || '';
            resolve(text);
          }
        } catch (e) {
          reject(new Error('JSON parse failed: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout (30s)'));
    });

    req.write(body);
    req.end();
  });
}

// ── 聊天模式：直接接受messages数组 ───────────────────────────────
function callDeepSeekChat(messages, maxTokens, temperature) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: messages,
      max_tokens: maxTokens || 1200,
      temperature: temperature || 0.80,
      stream: false,
    });

    const options = {
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(`DeepSeek API Error: ${json.error.message}`));
          } else {
            const text = json.choices?.[0]?.message?.content || '';
            resolve(text);
          }
        } catch (e) {
          reject(new Error('JSON parse failed: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout (30s)'));
    });

    req.write(body);
    req.end();
  });
}

// ── 真实数据库查询（由数据管道采集，替代AI编造）───────────────
// 格式：{ schoolId: { province: { subjectType: { 2024:{min_score,min_rank}, 2025:{...} }}}}
// 初始内置部分核心数据作为种子，运行 data_pipeline/main.py 后自动覆盖此文件
let _realDB = null;
function getRealDB() {
  if (_realDB) return _realDB;
  try {
    // 数据管道生成的真实数据（运行 data_pipeline/main.py 后生效）
    _realDB = require('./cn_admission_real.js').REAL_ADMISSION_DB;
  } catch (e) {
    // 尚未采集：使用内置种子数据（2024已知数据，仅核心学校×广东）
    _realDB = SEED_DATA;
  }
  return _realDB;
}

// ── 种子数据（核心985学校×广东·物理类·2024真实录取分）──────
// 来源：各校2024年招生数据（持续更新中，以数据管道采集结果为准）
const SEED_DATA = {
  pku:    { '广东': { '物理类': { 2024: { min_score: 686, min_rank: 312,  source: 'seed' }}}},
  thu:    { '广东': { '物理类': { 2024: { min_score: 691, min_rank: 198,  source: 'seed' }}}},
  fdu:    { '广东': { '物理类': { 2024: { min_score: 671, min_rank: 762,  source: 'seed' }}}},
  sjtu:   { '广东': { '物理类': { 2024: { min_score: 668, min_rank: 942,  source: 'seed' }}}},
  zju:    { '广东': { '物理类': { 2024: { min_score: 657, min_rank: 1820, source: 'seed' }}}},
  nju:    { '广东': { '物理类': { 2024: { min_score: 651, min_rank: 2510, source: 'seed' }}}},
  ustc:   { '广东': { '物理类': { 2024: { min_score: 653, min_rank: 2284, source: 'seed' }}}},
  ruc:    { '广东': { '物理类': { 2024: { min_score: 649, min_rank: 2841, source: 'seed' }}}},
  whu:    { '广东': { '物理类': { 2024: { min_score: 641, min_rank: 3901, source: 'seed' }}}},
  hust:   { '广东': { '物理类': { 2024: { min_score: 637, min_rank: 4620, source: 'seed' }}}},
  sysu:   { '广东': { '物理类': { 2024: { min_score: 638, min_rank: 4440, source: 'seed' }}}},
  scut:   { '广东': { '物理类': { 2024: { min_score: 618, min_rank: 8120, source: 'seed' }}}},
  hit:    { '广东': { '物理类': { 2024: { min_score: 635, min_rank: 5012, source: 'seed' }}}},
  xjtu:   { '广东': { '物理类': { 2024: { min_score: 633, min_rank: 5380, source: 'seed' }}}},
  scu:    { '广东': { '物理类': { 2024: { min_score: 627, min_rank: 6740, source: 'seed' }}}},
  buaa:   { '广东': { '物理类': { 2024: { min_score: 640, min_rank: 4020, source: 'seed' }}}},
  tongji: { '广东': { '物理类': { 2024: { min_score: 630, min_rank: 6080, source: 'seed' }}}},
  seu:    { '广东': { '物理类': { 2024: { min_score: 626, min_rank: 6980, source: 'seed' }}}},
  xmu:    { '广东': { '物理类': { 2024: { min_score: 620, min_rank: 7980, source: 'seed' }}}},
  uibe:   { '广东': { '物理类': { 2024: { min_score: 627, min_rank: 6700, source: 'seed' }}}},
  cufe:   { '广东': { '物理类': { 2024: { min_score: 631, min_rank: 5810, source: 'seed' }}}},
  bfsu:   { '广东': { '物理类': { 2024: { min_score: 618, min_rank: 8230, source: 'seed' }}}},
};

// ── 查询真实分数线（注入到AI提示词中）────────────────────────
function queryRealScores(score, province, subjectType) {
  const db = getRealDB();
  const results = [];

  // 根据分数段筛选：冲(-20到-5)、稳(-5到+10)、保(+10到+30)
  for (const [schoolId, provData] of Object.entries(db)) {
    const subjData = provData?.[province]?.[subjectType];
    if (!subjData) continue;

    // 取最新年份数据
    const years = Object.keys(subjData).map(Number).sort((a, b) => b - a);
    const latestYear = years[0];
    const entry = subjData[latestYear];
    if (!entry || !entry.min_score) continue;

    const delta = score - entry.min_score;
    let tier = null;
    if (delta >= -20 && delta < -5)  tier = '冲';
    else if (delta >= -5 && delta <= 10) tier = '稳';
    else if (delta > 10 && delta <= 30)  tier = '保';
    if (!tier) continue;

    // 获取2026预测（如有）
    const pred2026 = subjData[2026];
    const scoreDisplay = pred2026 && pred2026.source === 'predicted'
      ? `${latestYear}年实录${entry.min_score}分，预测2026约${pred2026.min_score}±${pred2026.min_score - pred2026.min_score_low}分`
      : `${latestYear}年实录${entry.min_score}分`;

    results.push({
      schoolId,
      tier,
      min_score: entry.min_score,
      min_rank: entry.min_rank,
      year: latestYear,
      scoreDisplay,
      source: entry.source,
      isRealData: entry.source !== 'predicted',
    });
  }

  // 按分数排序，每档最多3所
  const tierGroups = { '冲': [], '稳': [], '保': [] };
  for (const r of results) tierGroups[r.tier].push(r);
  for (const t of ['冲', '稳', '保']) {
    tierGroups[t].sort((a, b) => b.min_score - a.min_score);
    tierGroups[t] = tierGroups[t].slice(0, 3);
  }
  return tierGroups;
}

// ── 学校名称映射 ──────────────────────────────────────────────
const SCHOOL_NAMES = {
  pku: '北京大学', thu: '清华大学', fdu: '复旦大学', sjtu: '上海交通大学',
  zju: '浙江大学', nju: '南京大学', ustc: '中国科学技术大学', ruc: '中国人民大学',
  whu: '武汉大学', hust: '华中科技大学', hit: '哈尔滨工业大学', xjtu: '西安交通大学',
  scu: '四川大学', sysu: '中山大学', scut: '华南理工大学', buaa: '北京航空航天大学',
  tongji: '同济大学', seu: '东南大学', xmu: '厦门大学', uibe: '对外经济贸易大学',
  cufe: '中央财经大学', bfsu: '北京外国语大学', sisu: '上海外国语大学',
  neu: '东北大学', bit: '北京理工大学', bnu: '北京师范大学', cau: '中国农业大学',
  lzu: '兰州大学', nwpu: '西北工业大学', csu: '中南大学', sdu: '山东大学',
  dut: '大连理工大学', uestc: '电子科技大学', jlu: '吉林大学',
};

// ── 高考志愿规划提示词构建器（数据驱动版）───────────────────
// 融合：张雪峰（实战直接）× 马斯克（真实数据+概率）× 乔布斯（极简最优解）
function buildGaokaoPrompt(params) {
  const { score, province, subjectType, miStrengths, goal, city } = params;
  const miText = miStrengths && miStrengths.length
    ? miStrengths.join('、')
    : '未提供（按综合方向推荐）';
  const goalText = goal === 'academia' ? '保研/学术深造' :
    goal === 'career' ? '就业导向' :
    goal === 'abroad' ? '出国升学' : '综合最优';
  const cityText = city ? `偏好${city}` : '不限城市';

  // ── 查询真实数据，注入提示词 ──────────────────────────────
  const realScores = queryRealScores(Number(score), province, subjectType);
  const hasRealData = Object.values(realScores).some(arr => arr.length > 0);

  // 生成真实分数参考表（给AI用）
  let realDataContext = '';
  if (hasRealData) {
    const lines = ['以下是真实录取数据库查询结果（数据来源：阳光高考官方数据，请直接使用这些数字）：'];
    for (const [tier, schools] of Object.entries(realScores)) {
      if (!schools.length) continue;
      lines.push(`\n${tier}档（${tier === '冲' ? '进线概率25-35%' : tier === '稳' ? '进线概率65-75%' : '进线概率90%+'}）：`);
      for (const s of schools) {
        const name = SCHOOL_NAMES[s.schoolId] || s.schoolId;
        const rankStr = s.min_rank ? `，全省位次约${s.min_rank}` : '';
        const verified = s.isRealData ? '✓真实' : '预测';
        lines.push(`  - ${name}：${s.scoreDisplay}${rankStr}（${verified}）`);
      }
    }
    realDataContext = lines.join('\n');
  } else {
    realDataContext = `注意：当前数据库暂无${province}·${subjectType}的实录数据，请基于你对该省历年录取规律的了解给出合理参考，并明确标注"参考值，以官方公告为准"。`;
  }

  return [
    {
      role: 'system',
      content: `你是中国最懂高考志愿填报的实战顾问，你的分析融合了三种思维：

张雪峰思维：直接说实话，专业选择比学校名字更重要，就业第一，保护家庭不走弯路
马斯克思维：数据驱动，给出真实数字，不回避困难事实，科学分配志愿风险
乔布斯思维：化繁为简，直击最优解，让人一眼明白该怎么做

数据使用铁律：
1. 分数线数字必须来自上方提供的真实数据库，不得自行编造
2. 若提供了真实数据，必须标注数据来源年份（如"2025年实录"）
3. 专业建议必须说明具体就业方向，不能泛泛说"前景好"
4. 每条推荐必须是具体学校全称+具体专业名称，拒绝模糊建议
5. 若数据库无数据，给出参考值并明确标注"参考值"`,
    },
    {
      role: 'user',
      content: `请为以下考生生成高考志愿规划报告：

省份：${province}，科类：${subjectType}
高考分数：${score}分
多元智能优势：${miText}（用于精准匹配专业）
升学目标：${goalText}
城市偏好：${cityText}

${realDataContext}

请严格按以下格式输出，不要增减任何章节标题：

【分数定位】
（100-150字。直接说这分数在${province}是什么层次，大约排在全省什么位置，能进哪个梯队。张雪峰风格：实话实说，不回避，不粉饰。）

【冲一冲】进线概率约25-35%
学校：（学校全称，城市）
专业：（具体专业名称）
数据来源：（如"2025年实录XXX分"或"参考值"）
推荐理由：（50字内，说清楚这个学校+专业组合为什么值得冲）
张雪峰提示：（一句话实战建议或风险提示）

【稳一稳】进线概率约65-75%
学校：（学校全称，城市）
专业：（具体专业名称）
数据来源：（如"2025年实录XXX分"或"参考值"）
推荐理由：（50字内）
张雪峰提示：（一句话）

【保一保】进线概率约90%+
学校：（学校全称，城市）
专业：（具体专业名称）
数据来源：（如"2025年实录XXX分"或"参考值"）
推荐理由：（50字内）
张雪峰提示：（一句话）

【张雪峰直说】
（2-3条最关键的判断，要敢说，可以打破惯性。例如：这个专业千万不要选，因为...；这个城市的选择比你想象的更值钱，因为...；你这个分段最聪明的组合是...）

【最关键的一个决定】
（一句话，现在你最应该做的是什么。）`,
    },
  ];
}

// ── 报告文字增强提示词构建器（mode: reportEnrich）──────────────
// 用LLM替换report_engine.js中所有规则生成的硬编码文字
// 输入：孩子实际答案 + 评分结果 → 输出：evidence/rationale/risks/actions文字
function buildReportEnrichPrompt(d) {
  const childName   = d.childName   || '孩子';
  const schoolStage = d.schoolStage || '未知学段';
  const pathKey     = d.pathKey     || 'hybrid';
  const overall     = d.overallScore || 50;
  const dimensions  = d.dimensions  || [];

  // 各维度分数摘要
  const dimLines = dimensions.map(dim =>
    `${dim.label}：${dim.score}分（${dim.level}）`
  ).join('\n');

  // 家长真实回答（用于生成evidence文字）
  const pa = d.parentAnswers || {};
  const paLines = Object.entries(pa)
    .filter(([,v]) => v && String(v).trim().length > 2)
    .map(([k,v]) => `[${k}] ${String(v).slice(0,80)}`)
    .join('\n');

  // MI分数
  const MI_MAP = { linguistic:'语言智能', logical:'逻辑数学', spatial:'空间视觉',
    musical:'音乐节奏', bodily:'身体运动', interpersonal:'人际交往',
    intrapersonal:'自我认知', naturalist:'自然探索' };
  const miScores = d.miScores || {};
  const topMI = Object.entries(miScores).sort((a,b)=>b[1]-a[1]).slice(0,2)
    .map(([k,v])=>`${MI_MAP[k]||k}(${v}/5)`).join('、');

  const PATH_LABELS = {
    gaokao: '国内高考', abroad_high: '高中出国', abroad_uni: '大学出国',
    hybrid: '国内国际化过渡', abroad_prep: '出国备战', international_school: '国际学校',
  };
  const pathLabel = PATH_LABELS[pathKey] || pathKey;

  return [
    {
      role: 'system',
      content: `你是袁希™报告文字引擎。根据家长真实问卷和评估数据，生成个性化的报告文字。
要求：直接基于用户填写的内容，不编造没有根据的特质，每句话必须有数据或原话支撑。
输出严格JSON，不加任何说明文字。`,
    },
    {
      role: 'user',
      content: `为${childName}（${schoolStage}）生成报告文字。

评分结果：
综合适配度：${overall}分
${dimLines}

推荐路径：${pathLabel}

优势智能：${topMI || '暂无评估'}

家长问卷原话（重要：文字必须基于这些真实回答，不得编造）：
${paLines || '（家长暂未完成问卷）'}

请生成以下JSON，每段文字必须具体、有数据支撑、不使用模板化废话：
{
  "evidence": {
    "resilience": "（1-2句。基于家长描述孩子面对压力、自我管理的原话，说清楚韧性表现的真实依据。若无数据：只说'暂无直接观察数据，韧性评估基于综合指标'，不要伪造）",
    "ability": "（1-2句。基于MI评分最高维度+英语水平+学业层次，具体说明能力优势方向）",
    "motivation": "（1-2句。基于家长描述兴趣/热情的原话，判断兴趣驱动类型。无数据时如实说明）",
    "family": "（1-2句。基于亲子沟通、价值观一致性的实际回答，不要用'您已开始思考'这种废话）"
  },
  "rationale": [
    "（路径推荐理由1：结合孩子实际情况，一句话说明为什么推荐${pathLabel}）",
    "（路径推荐理由2：补充一个具体依据，数字或实际表现）",
    "（路径推荐理由3：时间窗口或准备建议，具体到学段）"
  ],
  "risks": [
    "（主要风险1：诚实指出最需要补强的项，不要回避）",
    "（主要风险2：可选，若无实质性第二风险则输出null）"
  ],
  "actionHints": {
    "weakestDimLabel": "（分数最低的维度中文名）",
    "pathSpecificHint": "（针对${pathLabel}路径，家长本周最应做的一件具体事，20字内）"
  }
}`,
    },
  ];
}

// ── 报告深度分析提示词构建器 ──────────────────────────────────
// 真正"读懂"家长写的话，识别隐藏的家庭教育信号
function buildReportAnalysisPrompt(d) {
  const childName  = d.childName  || '孩子';
  const schoolStage = d.schoolStage || '未知学段';
  const childAge   = d.childAge   || '';

  // 整理多元智能前3
  const miScores = d.miScores || {};
  const MI_MAP = { linguistic:'语言智能', logical:'逻辑数学', spatial:'空间视觉',
    musical:'音乐节奏', bodily:'身体运动', interpersonal:'人际交往',
    intrapersonal:'自我认知', naturalist:'自然探索' };
  const topMI = Object.entries(miScores)
    .sort((a,b) => b[1]-a[1]).slice(0,3)
    .map(([k,v]) => `${MI_MAP[k]||k}(${v}/5)`).join('、');
  const mindsetScore = d.mindsetScore || 3;
  const mindsetDesc = mindsetScore >= 4 ? '成长型思维' : mindsetScore >= 3 ? '思维模式发展中' : '固化型思维倾向';
  const pathPref = d.pathPreference || '未知';

  // 整理家长问卷原文
  const pa = d.parentAnswers || {};
  const qaLines = Object.entries(pa)
    .filter(([,v]) => v && String(v).trim().length > 3)
    .map(([k,v]) => `[${k}] ${String(v).trim()}`).join('\n');

  if (!qaLines) return null;  // 无家长数据，跳过

  return [
    {
      role: 'system',
      content: `你是袁希™高级教育策略师，擅长通过家长的真实文字发现深层家庭教育信号。
你的分析结合：袁希"三轴框架"（孩子特质×家庭资源×路径选择）+ 心理学洞察 + 真实教育案例经验。
你的输出必须严格遵守JSON格式，不添加任何额外文字。`,
    },
    {
      role: 'user',
      content: `请分析以下家长问卷，为${childName}（${childAge ? childAge+'岁，' : ''}${schoolStage}）生成深度家庭画像。

孩子核心数据：
- 优势智能：${topMI || '未评估'}
- 思维模式：${mindsetDesc}（${mindsetScore}/5）
- 倾向路径：${pathPref}

家长开放性问答原文（真实作答）：
${qaLines}

请输出严格的JSON对象（不加代码块标记），包含以下字段：
{
  "parentingStyle": "权威型|权威主义型|放任型|混合型",
  "parentingEvidence": "一句话说明判断依据，直接引用原文关键词",
  "commQuality": "优质|良好|一般|有障碍",
  "commEvidence": "一句话说明",
  "keyQuote": "从原文中提取最能反映家庭价值观的一句话（10-20字，原文原句）",
  "valueConsensus": "对齐|分歧|模糊",
  "blindspot": "家长最明显的认知盲区（15-25字，具体不泛泛）",
  "strengthSignal": "这个家庭最值得关注的优势信号（15-25字）",
  "riskSignal": "最需要注意的风险信号（15-25字）",
  "yuanxiPerspective": "袁希的专业视角：基于这个家庭实际情况的核心洞察（80-120字。温暖、专业、有针对性，直接对家长说话，不要泛泛而谈）"
}`,
    },
  ];
}

// ── 智能报告全量生成提示词构建器（mode: reportFullGenerate）─────────
// 核心升级：接收全部评估数据，生成每个章节的个性化内容+原因解释
// 彻底替代 report_engine.js 的规则文字，让每一句话都有真实依据
function buildReportFullGeneratePrompt(d) {
  const MI_MAP = {
    linguistic:'语言智能', logical:'逻辑数学智能', spatial:'空间视觉智能',
    musical:'音乐节奏智能', bodily:'身体运动智能', interpersonal:'人际交往智能',
    intrapersonal:'自我认知智能', naturalist:'自然探索智能',
  };
  const miScores = d.miScores || {};
  const allMILines = Object.entries(miScores)
    .sort((a,b) => b[1]-a[1])
    .map(([k,v]) => `  ${MI_MAP[k]||k}：${v}/5`)
    .join('\n');
  const topMI = Object.entries(miScores)
    .sort((a,b) => b[1]-a[1]).slice(0,3)
    .map(([k,v]) => `${MI_MAP[k]||k}(${v}/5)`).join('、');
  const bottomMI = Object.entries(miScores)
    .sort((a,b) => a[1]-b[1]).slice(0,2)
    .map(([k]) => MI_MAP[k]||k).join('、');

  const childName    = d.childName    || '孩子';
  const schoolStage  = d.schoolStage  || '未知学段';
  const pathKey      = d.pathKey      || 'hybrid';
  const overall      = d.overallScore || 50;
  const careerVision = d.careerVision || '（家长未填写）';
  const observedSkills = d.observedSkills || '（家长未填写）';
  const subjectInterest = d.subjectInterest || 'undecided';
  const careerCluster = d.careerCluster || 'open';
  const academicLevel = d.academicLevel || 'medium';
  const englishLevel  = d.englishLevel  || 'basic';
  const budget        = d.budget        || '未知';
  const mindsetScore  = d.mindsetScore  || 3;
  const talentSignals = (d.talentSignals || []).join('、') || '（未特别标注）';

  // RIASEC 五轴职业性格数据（S5c1-S5c5）
  const RIASEC_LABEL = { R:'现实型(动手)', I:'研究型(探索)', A:'艺术型(创造)', S:'社会型(助人)', E:'企业型(领导)', C:'常规型(执行)' };
  const MOTIV_LABEL  = { status:'地位认可型', impact:'社会影响型', mastery:'精通卓越型', freedom:'自主独立型', security:'稳定安全型' };
  const ENV_LABEL    = { outdoor:'户外/操作', lab:'实验室/研究室', creative:'创意工坊', social:'社交/服务', corporate:'企业办公', remote:'自由远程' };
  const ROLE_LABEL   = { leader:'领导者', expert:'独立专家', creator:'创意者', coordinator:'协调者', supporter:'支持者' };
  const RISK_LABEL   = { stable:'稳定优先', expert:'专业深耕', moderate:'均衡发展', bold:'高挑战冒险' };

  const riasecLine   = d.riasecPrimary  ? `RIASEC主型：${RIASEC_LABEL[d.riasecPrimary]||d.riasecPrimary}` : '';
  const motivLine    = d.motivationType ? `内驱力类型：${MOTIV_LABEL[d.motivationType]||d.motivationType}` : '';
  const envLine      = d.envPreference  ? `环境偏好：${ENV_LABEL[d.envPreference]||d.envPreference}` : '';
  const roleLine     = d.socialRole     ? `团队角色：${ROLE_LABEL[d.socialRole]||d.socialRole}` : '';
  const riskLine     = d.riskProfile    ? `风险偏好：${RISK_LABEL[d.riskProfile]||d.riskProfile}` : '';
  const riasecBlock  = [riasecLine, motivLine, envLine, roleLine, riskLine].filter(Boolean).join('\n') || '（本次未完成职业性格评测）';

  const PATH_CN = {
    gaokao: '国内高考', highschool_abroad: '高中出国',
    university_abroad: '大学出国', international_school: '国际学校过渡',
    hybrid: '国内国际化双轨', abroad_prep: '出国备战期',
  };
  const pathCn = PATH_CN[pathKey] || pathKey;

  const CAREER_CN = {
    healthcare: '医疗健康', tech_engineering: '科技工程', law: '法律',
    business: '商业创业', academia: '学术研究', creative: '艺术创意',
    finance: '金融投资', public_service: '公共服务', open: '尚未聚焦',
  };
  const SUBJECT_CN = {
    stem: '理工科方向', natural_science: '自然科学', business: '商科',
    humanities: '人文社科', arts_design: '艺术设计', communication: '传媒传播',
    undecided: '待定',
  };

  // 家长开放性问答原文
  const pa = d.parentAnswers || {};
  const paLines = Object.entries(pa)
    .filter(([,v]) => v && String(v).trim().length > 3)
    .map(([k,v]) => `[${k}] ${String(v).trim().slice(0,100)}`)
    .join('\n') || '（暂无家长开放题数据）';

  return [
    {
      role: 'system',
      content: `你是袁希™高级教育战略分析师。你的任务是：根据孩子的真实评估数据，生成一份有真实智能的个性化报告。

核心原则（违反则报告无效）：
1. 每一段分析必须直接引用孩子的具体数据（MI分数、家长原话、具体答案），不允许说"这个孩子有潜力"这类空话
2. 每个推荐都必须给出"为什么针对这个孩子"的具体理由，不是通用描述
3. 专业方向必须与MI最高维度+RIASEC主型形成双重逻辑链条，不允许割裂推荐
4. 当RIASEC数据存在时，careerMajorRecs的whyThisChild字段必须同时引用MI分数和RIASEC主型
5. 输出严格JSON格式，不加任何代码块标记或说明文字
6. 所有文字字段严禁使用任何Markdown符号：不得出现*、**、#、##、-列表符、>引用符、_下划线_等。用中文标点和自然语言表达层次，不用符号加粗或强调`,
    },
    {
      role: 'user',
      content: `请为${childName}（${schoolStage}，综合适配度${overall}分）生成智能报告全量内容。

━━ 核心评估数据 ━━
多元智能评分（全8维度）：
${allMILines}
→ 优势智能：${topMI}
→ 相对薄弱：${bottomMI}
思维模式评分：${mindsetScore}/5

━━ 家长填写的真实信息 ━━
孩子25岁成功画像（家长原话）：${careerVision}
观察到的天赋/特长（家长原话）：${observedSkills}
天赋信号标记：${talentSignals}
学科兴趣方向：${SUBJECT_CN[subjectInterest]||subjectInterest}
职业方向聚焦：${CAREER_CN[careerCluster]||careerCluster}
学术水平：${academicLevel}
英语水平：${englishLevel}
年度预算：${budget}

━━ 职业性格评测结果（RIASEC五轴）━━
${riasecBlock}

━━ 系统推荐路径 ━━
推荐路径：${pathCn}

━━ 家长问卷原文 ━━
${paLines}

━━ 输出要求 ━━
请输出以下JSON对象（不加代码块标记），每个字段必须具体、有据可查：

{
  "openingInsight": "（开篇洞察：2-3句。用一个具体角度切入，让家长感受到'被真正看见'。必须引用孩子的具体MI数据或家长原话，不是通用表扬。）",

  "giftNarrative": "（天赋密码：3-4句。深入解读这个孩子最独特的智能组合——不是逐条列举MI分数，而是说这个组合意味着什么、在什么情境下会爆发、与普通孩子有什么本质不同。必须基于评分数据，不编造。）",

  "mindsetAnalysis": "（思维模式分析：2句。基于${mindsetScore}/5分，具体说明当前表现，并给出一个可操作的培养建议。）",

  "careerMajorRecs": [
    {
      "majorName": "（专业1，具体到二级学科，如'计算机科学与技术'而非'IT'）",
      "whyThisChild": "（为什么适合这个孩子：1-2句，必须引用具体MI维度分数或家长原话，例如：'你孩子逻辑数学4/5+家长描述的解题热情，正是该专业核心素养的天然匹配'）",
      "careerPath": "（具体职业方向：20字内）",
      "schoolExamples": "（国内外各1所代表性院校名称）"
    },
    {
      "majorName": "（专业2，不同于专业1的领域）",
      "whyThisChild": "（为什么适合这个孩子：1-2句，必须有具体数据依据）",
      "careerPath": "（具体职业方向：20字内）",
      "schoolExamples": "（国内外各1所代表性院校名称）"
    },
    {
      "majorName": "（专业3，覆盖不同维度或作为跨学科选项）",
      "whyThisChild": "（为什么适合这个孩子：1-2句，必须有具体数据依据）",
      "careerPath": "（具体职业方向：20字内）",
      "schoolExamples": "（国内外各1所代表性院校名称）"
    }
  ],

  "pathReasoning": "（路径推荐理由：2-3句。为什么${pathCn}最适合这个孩子？必须结合MI数据+学术水平+家庭情况，给出有说服力的论证，不是简单重复评分结论。）",

  "keyRisks": [
    "（风险1：诚实指出最需要补强的具体短板，必须说明为什么是风险以及如何应对，30字内）",
    "（风险2：可选，若无实质性第二风险则返回null）"
  ],

  "topPriorityAction": "（这周最应做的一件事：必须具体到可执行，如'本周安排孩子参加一次XXX类型的活动，观察XXX反应'，不是泛泛建议。25字内。）",

  "yuanxiSignature": "（袁希结语：给家长一句有力量的话，温暖且具体，基于这个孩子的独特性，不是通用鸡汤。30字内。）"
}`,
    },
  ];
}

// ══════════════════════════════════════════════════════════════
//  全球院校数据库（65所，基于QS+US News+Times Higher Education）
//  字段说明：
//   programs: 优势专业方向（对应 subject_interest 值）
//   miStrengths: 最适合的 MI 维度（用于个性化理由生成）
//   riasec: 最适合的 RIASEC 职业类型
//   difficulty: extreme（前1%）/ high（前5%）/ medium（前20%）/ accessible
//   budget: 对应年费档位（同 annual_budget 字段）
//   specialty: 一句话核心特色
// ══════════════════════════════════════════════════════════════
const SCHOOLS_DB = [
  // ── 美国顶尖（T1: QS前20）────────────────────────────────────
  { id:'mit',     name:'MIT',                       nameCn:'麻省理工学院',          country:'US', qsRank:1,  type:'university', difficulty:'extreme', budget:'over80w', programs:['stem','natural_science'],           miStrengths:['logical','spatial'],            riasec:['I','R'], specialty:'全球理工No.1，课程极具挑战性，学生均为顶尖创新者' },
  { id:'stanford',name:'Stanford University',        nameCn:'斯坦福大学',            country:'US', qsRank:5,  type:'university', difficulty:'extreme', budget:'over80w', programs:['stem','business','communication'],  miStrengths:['logical','interpersonal'],       riasec:['I','E'], specialty:'硅谷创业生态中心，文理工商跨学科强' },
  { id:'harvard', name:'Harvard University',         nameCn:'哈佛大学',              country:'US', qsRank:4,  type:'university', difficulty:'extreme', budget:'over80w', programs:['business','humanities','natural_science'], miStrengths:['linguistic','interpersonal'], riasec:['E','S'], specialty:'综合学术声誉最高，法律/医学/政治精英摇篮' },
  { id:'caltech', name:'Caltech',                    nameCn:'加州理工学院',          country:'US', qsRank:15, type:'university', difficulty:'extreme', budget:'over80w', programs:['stem','natural_science'],           miStrengths:['logical','intrapersonal'],       riasec:['I'],    specialty:'规模最小的顶级理工，科研强度极高，诺奖密度世界第一' },
  { id:'uchicago',name:'University of Chicago',      nameCn:'芝加哥大学',            country:'US', qsRank:21, type:'university', difficulty:'extreme', budget:'over80w', programs:['business','humanities','natural_science'], miStrengths:['logical','linguistic'],     riasec:['I','C'], specialty:'经济学诺奖摇篮，批判性思维训练极强' },
  { id:'columbia',name:'Columbia University',        nameCn:'哥伦比亚大学',          country:'US', qsRank:12, type:'university', difficulty:'extreme', budget:'over80w', programs:['business','humanities','communication'], miStrengths:['linguistic','interpersonal'],riasec:['E','S'], specialty:'纽约核心地带，传媒/金融/法律资源无可比拟' },
  { id:'upenn',   name:'University of Pennsylvania', nameCn:'宾夕法尼亚大学',        country:'US', qsRank:12, type:'university', difficulty:'extreme', budget:'over80w', programs:['business','natural_science'],       miStrengths:['interpersonal','logical'],       riasec:['E','I'], specialty:'沃顿商学院所在地，本科商科全美第一' },
  // ── 美国优秀（T2: QS 20-100）────────────────────────────────
  { id:'cmu',     name:'Carnegie Mellon University', nameCn:'卡内基梅隆大学',        country:'US', qsRank:52, type:'university', difficulty:'high',    budget:'over80w', programs:['stem','arts_design','communication'], miStrengths:['logical','spatial'],          riasec:['I','A'], specialty:'CS+艺术+戏剧三强并存，AI研究全球顶级' },
  { id:'nyu',     name:'New York University',        nameCn:'纽约大学',              country:'US', qsRank:56, type:'university', difficulty:'high',    budget:'over80w', programs:['arts_design','business','communication'], miStrengths:['interpersonal','linguistic'], riasec:['A','E'], specialty:'纽约心脏地带，艺术/传媒/金融行业资源直连' },
  { id:'usc',     name:'Univ. of Southern California',nameCn:'南加州大学',           country:'US', qsRank:113,type:'university', difficulty:'high',    budget:'over80w', programs:['communication','arts_design','business'], miStrengths:['interpersonal','linguistic'],riasec:['A','S'], specialty:'好莱坞最近的大学，传媒/电影/音乐业界人脉极强' },
  { id:'uclaus',  name:'UCLA',                       nameCn:'加州大学洛杉矶分校',    country:'US', qsRank:44, type:'university', difficulty:'high',    budget:'over80w', programs:['stem','arts_design','natural_science'], miStrengths:['logical','interpersonal'],   riasec:['I','A'], specialty:'公立顶尖，影视/科技/医学三强，生活质量极佳' },
  { id:'ucberkeley',name:'UC Berkeley',              nameCn:'加州大学伯克利分校',    country:'US', qsRank:28, type:'university', difficulty:'high',    budget:'over80w', programs:['stem','business','natural_science'], miStrengths:['logical','intrapersonal'],   riasec:['I','E'], specialty:'顶级公立大学No.1，STEM+创业生态极强' },
  { id:'umich',   name:'Univ. of Michigan',          nameCn:'密歇根大学安娜堡',      country:'US', qsRank:23, type:'university', difficulty:'medium',  budget:'40_80w',  programs:['stem','business','natural_science'], miStrengths:['logical','interpersonal'],   riasec:['I','E'], specialty:'综合实力极强，工科/商科/医学三位一体' },
  { id:'purdue',  name:'Purdue University',           nameCn:'普渡大学',              country:'US', qsRank:105,type:'university', difficulty:'medium',  budget:'40_80w',  programs:['stem'],                             miStrengths:['logical','bodily'],             riasec:['R','I'], specialty:'航空航天工程全美顶尖，工科性价比最高之一' },
  // ── 英国（T1+T2）────────────────────────────────────────────
  { id:'oxford',  name:'University of Oxford',       nameCn:'牛津大学',              country:'UK', qsRank:3,  type:'university', difficulty:'extreme', budget:'over80w', programs:['humanities','natural_science','business'], miStrengths:['linguistic','logical'],    riasec:['I','S'], specialty:'全球最古老顶级大学，哲学/法律/文学殿堂' },
  { id:'cambridge',name:'University of Cambridge',   nameCn:'剑桥大学',              country:'UK', qsRank:2,  type:'university', difficulty:'extreme', budget:'over80w', programs:['stem','natural_science','humanities'], miStrengths:['logical','intrapersonal'],  riasec:['I'],    specialty:'自然科学和数学皇冠，诺贝尔奖100+' },
  { id:'imperial',name:'Imperial College London',    nameCn:'帝国理工学院',          country:'UK', qsRank:8,  type:'university', difficulty:'extreme', budget:'over80w', programs:['stem','natural_science'],           miStrengths:['logical','spatial'],            riasec:['I','R'], specialty:'纯理工顶尖，毕业生起薪英国第一' },
  { id:'ucl',     name:'University College London',  nameCn:'伦敦大学学院',          country:'UK', qsRank:9,  type:'university', difficulty:'high',    budget:'over80w', programs:['humanities','stem','arts_design'], miStrengths:['linguistic','logical'],         riasec:['I','A'], specialty:'多学科顶尖，伦敦核心，国际化程度极高' },
  { id:'lse',     name:'London School of Economics', nameCn:'伦敦政治经济学院',      country:'UK', qsRank:45, type:'university', difficulty:'high',    budget:'over80w', programs:['business','humanities'],            miStrengths:['logical','interpersonal'],       riasec:['E','I'], specialty:'经济/政治/社会科学全球顶尖，精英政商校友网' },
  { id:'edinburgh',name:'University of Edinburgh',   nameCn:'爱丁堡大学',            country:'UK', qsRank:27, type:'university', difficulty:'high',    budget:'40_80w',  programs:['stem','humanities','natural_science'], miStrengths:['linguistic','logical'],     riasec:['I','S'], specialty:'苏格兰古典名校，医学/计算机/文学均强' },
  { id:'manchester',name:'Univ. of Manchester',      nameCn:'曼彻斯特大学',          country:'UK', qsRank:34, type:'university', difficulty:'medium',  budget:'40_80w',  programs:['stem','business','natural_science'], miStrengths:['logical','interpersonal'],   riasec:['I','E'], specialty:'工业研究重镇，商科+理工双强，留英签证友好' },
  // ── 加拿大 ────────────────────────────────────────────────
  { id:'uoft',    name:'University of Toronto',      nameCn:'多伦多大学',            country:'Canada', qsRank:25, type:'university', difficulty:'high', budget:'20_40w', programs:['stem','natural_science','humanities'], miStrengths:['logical','intrapersonal'],  riasec:['I'],    specialty:'加拿大第一，移民友好，AI/医学研究顶尖' },
  { id:'mcgill',  name:'McGill University',          nameCn:'麦吉尔大学',            country:'Canada', qsRank:46, type:'university', difficulty:'high', budget:'20_40w', programs:['natural_science','humanities','business'], miStrengths:['logical','linguistic'],  riasec:['I','S'], specialty:'加拿大牛津，双语环境，医学/法学名校' },
  { id:'ubc',     name:'Univ. of British Columbia',  nameCn:'不列颠哥伦比亚大学',    country:'Canada', qsRank:38, type:'university', difficulty:'medium',budget:'20_40w', programs:['stem','natural_science','arts_design'], miStrengths:['naturalist','logical'],   riasec:['I','R'], specialty:'太平洋海岸，环境科学+林业世界顶级，生活质量极高' },
  { id:'waterloo',name:'University of Waterloo',     nameCn:'滑铁卢大学',            country:'Canada', qsRank:149,type:'university', difficulty:'medium',budget:'20_40w', programs:['stem'],                             miStrengths:['logical','intrapersonal'],       riasec:['I','R'], specialty:'Co-op制度全球最强，CS毕业生直入谷歌微软' },
  // ── 澳大利亚 ─────────────────────────────────────────────
  { id:'melb',    name:'University of Melbourne',    nameCn:'墨尔本大学',            country:'Australia', qsRank:33, type:'university', difficulty:'high',   budget:'20_40w', programs:['natural_science','business','humanities'], miStrengths:['logical','interpersonal'], riasec:['I','E'], specialty:'澳洲第一，法律/医学/商科全澳最强' },
  { id:'anu',     name:'Australian National University',nameCn:'澳大利亚国立大学',   country:'Australia', qsRank:30, type:'university', difficulty:'high',   budget:'20_40w', programs:['humanities','natural_science'],     miStrengths:['intrapersonal','logical'],      riasec:['I','S'], specialty:'首都精英学府，政策/外交/研究生态极强' },
  { id:'usyd',    name:'University of Sydney',       nameCn:'悉尼大学',              country:'Australia', qsRank:18, type:'university', difficulty:'medium', budget:'20_40w', programs:['business','humanities','arts_design'], miStrengths:['interpersonal','linguistic'],riasec:['E','S'], specialty:'建筑最美大学，商科/法律/传媒业界资源强' },
  { id:'unsw',    name:'UNSW Sydney',                nameCn:'新南威尔士大学',        country:'Australia', qsRank:19, type:'university', difficulty:'medium', budget:'20_40w', programs:['stem','business'],                  miStrengths:['logical','interpersonal'],       riasec:['I','E'], specialty:'工程/商科双强，硅谷-悉尼创业圈核心' },
  // ── 新加坡 ────────────────────────────────────────────────
  { id:'nus',     name:'National University of Singapore',nameCn:'新加坡国立大学',   country:'Singapore', qsRank:8,  type:'university', difficulty:'high',   budget:'20_40w', programs:['stem','business','natural_science'], miStrengths:['logical','interpersonal'],  riasec:['I','E'], specialty:'亚洲第一，双语双文化，直连东盟经济圈' },
  { id:'ntu',     name:'Nanyang Technological University',nameCn:'南洋理工大学',     country:'Singapore', qsRank:26, type:'university', difficulty:'high',   budget:'20_40w', programs:['stem','business','arts_design'],    miStrengths:['logical','spatial'],           riasec:['I','R'], specialty:'亚洲理工+商科双强，中英双语环境对华人家庭极友好' },
  // ── 中国内地顶尖 ─────────────────────────────────────────
  { id:'pku',     name:'Peking University',          nameCn:'北京大学',              country:'China', qsRank:17, type:'university', difficulty:'extreme', budget:'under10w', programs:['humanities','natural_science','business'], miStrengths:['linguistic','logical'],  riasec:['I','S'], specialty:'中国最高学府，文科/社科/哲学顶峰，北大精神' },
  { id:'thu',     name:'Tsinghua University',        nameCn:'清华大学',              country:'China', qsRank:20, type:'university', difficulty:'extreme', budget:'under10w', programs:['stem','business','arts_design'],    miStrengths:['logical','spatial'],           riasec:['I','R'], specialty:'工科No.1，建筑/CS/工程殿堂，政商精英摇篮' },
  { id:'fdu',     name:'Fudan University',           nameCn:'复旦大学',              country:'China', qsRank:62, type:'university', difficulty:'high',    budget:'under10w', programs:['business','humanities','natural_science'], miStrengths:['linguistic','interpersonal'],riasec:['E','I'], specialty:'上海综合名校，国际化程度最高的国内大学之一' },
  { id:'sjtu',    name:'Shanghai Jiao Tong University',nameCn:'上海交通大学',        country:'China', qsRank:51, type:'university', difficulty:'high',    budget:'under10w', programs:['stem','natural_science','business'], miStrengths:['logical','bodily'],           riasec:['I','R'], specialty:'工科强校，医学院中国最好，创业氛围浓厚' },
  { id:'zju',     name:'Zhejiang University',        nameCn:'浙江大学',              country:'China', qsRank:47, type:'university', difficulty:'high',    budget:'under10w', programs:['stem','natural_science'],           miStrengths:['logical','naturalist'],         riasec:['I','R'], specialty:'杭州互联网经济圈核心，阿里系校友最多' },
  { id:'sysu',    name:'Sun Yat-sen University',     nameCn:'中山大学',              country:'China', qsRank:275,type:'university', difficulty:'medium',  budget:'under10w', programs:['natural_science','humanities'],      miStrengths:['naturalist','logical'],         riasec:['I','S'], specialty:'华南第一，医学+生命科学实力强，大湾区资源丰富' },
  // ── 香港 ─────────────────────────────────────────────────
  { id:'hku',     name:'University of Hong Kong',    nameCn:'香港大学',              country:'HK', qsRank:17, type:'university', difficulty:'high', budget:'20_40w', programs:['business','natural_science','humanities'], miStrengths:['interpersonal','logical'], riasec:['E','I'], specialty:'亚太金融法律中心，国际化最高，双语教育' },
  { id:'hkust',   name:'HKUST',                      nameCn:'香港科技大学',          country:'HK', qsRank:40, type:'university', difficulty:'high', budget:'20_40w', programs:['stem','business'],                  miStrengths:['logical','interpersonal'],       riasec:['I','E'], specialty:'亚洲商科+科技双冠，创业孵化器全亚洲最活跃' },
  { id:'cuhk',    name:'Chinese University of Hong Kong',nameCn:'香港中文大学',      country:'HK', qsRank:36, type:'university', difficulty:'high', budget:'20_40w', programs:['business','humanities','natural_science'], miStrengths:['linguistic','logical'],   riasec:['I','E'], specialty:'中西兼具，书院制培养，金融+翻译顶尖' },
  // ── 欧陆 ─────────────────────────────────────────────────
  { id:'eth',     name:'ETH Zurich',                 nameCn:'苏黎世联邦理工',        country:'Switzerland', qsRank:7, type:'university', difficulty:'extreme', budget:'10_20w', programs:['stem','natural_science'], miStrengths:['logical','spatial'],   riasec:['I','R'], specialty:'欧洲最强理工，学费极低，爱因斯坦母校' },
  { id:'epfl',    name:'EPFL',                       nameCn:'洛桑联邦理工',          country:'Switzerland', qsRank:36, type:'university', difficulty:'high',   budget:'10_20w', programs:['stem','arts_design'],     miStrengths:['logical','spatial'],   riasec:['I','A'], specialty:'科技+设计融合，学费极低，瑞士创业生态强' },
  { id:'tum',     name:'Technical Univ. of Munich',  nameCn:'慕尼黑工业大学',        country:'Germany', qsRank:37,  type:'university', difficulty:'high',    budget:'under10w', programs:['stem'],                  miStrengths:['logical','bodily'],    riasec:['I','R'], specialty:'德国工程顶尖，学费极低，宝马/西门子校企直连' },
  { id:'lmu',     name:'Ludwig Maximilian Univ. Munich',nameCn:'慕尼黑大学',        country:'Germany', qsRank:54,  type:'university', difficulty:'medium',  budget:'under10w', programs:['natural_science','humanities'], miStrengths:['logical','linguistic'],riasec:['I','S'], specialty:'德国综合第一，医学/哲学历史深厚，学费极低' },
  { id:'kaist',   name:'KAIST',                      nameCn:'韩国科学技术院',        country:'Korea', qsRank:56, type:'university', difficulty:'high',    budget:'10_20w', programs:['stem'],                           miStrengths:['logical','intrapersonal'],riasec:['I','R'], specialty:'韩国理工No.1，半导体/AI研究全球前列' },
  // ── 高中（国际路线）────────────────────────────────────────
  { id:'exeter_uk', name:'Exeter School',             nameCn:'埃克塞特公学',        country:'UK', qsRank:null, type:'highschool', difficulty:'high',   budget:'40_80w', programs:['humanities','stem'],  miStrengths:['linguistic','logical'],  riasec:['I','S'], specialty:'英国顶级寄宿公学，牛津剑桥送生率前五' },
  { id:'eton',      name:'Eton College',              nameCn:'伊顿公学',            country:'UK', qsRank:null, type:'highschool', difficulty:'extreme', budget:'over80w', programs:['humanities'],          miStrengths:['interpersonal','linguistic'],riasec:['E','S'], specialty:'英国精英政治领袖摇篮，19位首相出身地' },
  { id:'harrow',    name:'Harrow School',             nameCn:'哈罗公学',            country:'UK', qsRank:null, type:'highschool', difficulty:'high',   budget:'over80w', programs:['humanities','arts_design'],miStrengths:['interpersonal','musical'],riasec:['A','S'], specialty:'艺术/体育/传统教育融合，全球领袖网络' },
  { id:'uis_sg',    name:'United World College SEA',  nameCn:'东南亚联合世界学院',  country:'Singapore', qsRank:null, type:'highschool', difficulty:'medium', budget:'20_40w', programs:['humanities','stem'], miStrengths:['interpersonal','naturalist'],riasec:['S','I'], specialty:'IB教育+国际社区，全球UWC网络，包容多元' },
  { id:'dulwich',   name:'Dulwich College Beijing',   nameCn:'北京德威国际学校',    country:'China', qsRank:null, type:'highschool', difficulty:'medium', budget:'20_40w', programs:['arts_design','humanities','stem'], miStrengths:['spatial','interpersonal'],riasec:['A','S'], specialty:'北京顶级国际学校，英式教育+创意艺术强' },
  { id:'wab',       name:'Western Academy of Beijing',nameCn:'北京京西学校',        country:'China', qsRank:null, type:'highschool', difficulty:'medium', budget:'20_40w', programs:['stem','humanities'],  miStrengths:['logical','interpersonal'], riasec:['I','S'], specialty:'北京最好的国际学校之一，IB成绩优秀' },
  { id:'yew_chung', name:'Yew Chung International',   nameCn:'耀中国际学校',        country:'China', qsRank:null, type:'highschool', difficulty:'accessible',budget:'20_40w',programs:['stem','business'],   miStrengths:['interpersonal','logical'], riasec:['E','I'], specialty:'中英双语+国际课程，上海/北京/广州均有校区' },
  { id:'harrowbeijing',name:'Harrow International Beijing',nameCn:'哈罗北京',       country:'China', qsRank:null, type:'highschool', difficulty:'medium', budget:'40_80w', programs:['humanities','arts_design'],miStrengths:['interpersonal','linguistic'],riasec:['A','E'], specialty:'哈罗品牌+北京资源，精英社交网络本地化' },
  // ── 日本 ─────────────────────────────────────────────────
  { id:'todai',   name:'University of Tokyo',        nameCn:'东京大学',              country:'Japan', qsRank:28, type:'university', difficulty:'extreme', budget:'10_20w', programs:['stem','natural_science','humanities'], miStrengths:['logical','intrapersonal'],riasec:['I'],  specialty:'亚洲学术最强，日本就业市场直通车，学费极低' },
  { id:'kyoto',   name:'Kyoto University',           nameCn:'京都大学',              country:'Japan', qsRank:46, type:'university', difficulty:'high',    budget:'10_20w', programs:['natural_science','humanities'], miStrengths:['intrapersonal','naturalist'],riasec:['I'], specialty:'日本学术自由圣地，诺奖传统深厚' },
  // ── 补充中等竞争力院校（确保覆盖所有预算段）─────────────────
  { id:'qut',     name:'Queensland Univ. of Technology',nameCn:'昆士兰科技大学',    country:'Australia', qsRank:244,type:'university', difficulty:'accessible',budget:'20_40w', programs:['stem','arts_design','business'], miStrengths:['spatial','logical'],     riasec:['I','A'], specialty:'创意产业+科技双轨，布里斯班生活成本低' },
  { id:'rmit',    name:'RMIT University',            nameCn:'皇家墨尔本理工大学',    country:'Australia', qsRank:130,type:'university', difficulty:'accessible',budget:'20_40w', programs:['arts_design','stem'],           miStrengths:['spatial','bodily'],             riasec:['R','A'], specialty:'设计/建筑/时尚顶尖应用型大学' },
  { id:'nottingham',name:'Univ. of Nottingham',      nameCn:'诺丁汉大学',            country:'UK', qsRank:99, type:'university', difficulty:'medium',  budget:'20_40w', programs:['business','natural_science'],  miStrengths:['logical','interpersonal'],      riasec:['I','E'], specialty:'在华设立分校，对国人高度友好，就业质量强' },
  { id:'leicester',name:'University of Leicester',   nameCn:'莱斯特大学',            country:'UK', qsRank:201,type:'university', difficulty:'accessible',budget:'20_40w', programs:['natural_science','humanities'], miStrengths:['naturalist','linguistic'],     riasec:['I','S'], specialty:'天体物理/考古顶尖，英国最包容的学生城' },
  { id:'unbc',    name:'Univ. of Northern British Columbia',nameCn:'北英属哥伦比亚大学',country:'Canada', qsRank:401,type:'university',difficulty:'accessible',budget:'10_20w', programs:['natural_science'],            miStrengths:['naturalist','intrapersonal'],  riasec:['R','I'], specialty:'加拿大留学捷径，自然环境壮观，移民路径友好' },
];

// ── 院校动态筛选函数 ──────────────────────────────────────────
// 根据孩子档案过滤数据库，给LLM一个精准候选池（而非盲目让AI编造）
function filterSchoolsForProfile(d) {
  const budget   = d.budget   || '20_40w';
  const geoRaw   = d.geoPreference || 'open';
  const pathKey  = d.pathKey  || 'hybrid';
  const academic = d.academicLevel || 'medium';
  const subject  = d.subjectInterest || 'undecided';
  const riasec   = d.riasecPrimary || '';
  const topMIKeys= Object.entries(d.miScores || {})
    .sort((a,b) => b[1]-a[1]).slice(0,3).map(([k]) => k);

  // 预算上限过滤（排除超出预算的）
  const budgetOrder = ['under10w','10_20w','20_40w','40_80w','over80w'];
  const budgetIdx = budgetOrder.indexOf(budget);
  let candidates = SCHOOLS_DB.filter(s => {
    const sIdx = budgetOrder.indexOf(s.budget);
    return sIdx <= budgetIdx + 1; // 允许略高一档（可冲刺）
  });

  // 路径过滤（高考 → 只看国内；出国 → 排除纯国内）
  if (pathKey === 'gaokao') {
    candidates = candidates.filter(s => s.country === 'China');
  } else if (['abroad','highschool_abroad','university_abroad'].includes(pathKey)) {
    candidates = candidates.filter(s => s.country !== 'China');
  }

  // 地理偏好过滤
  const GEO_MAP = {
    us: ['US'], uk: ['UK'], canada: ['Canada'], au_nz: ['Australia'],
    asia_pacific: ['Singapore','Japan','Korea','HK'],
    europe: ['Switzerland','Germany','France'],
    cn_only: ['China'],
  };
  if (geoRaw !== 'open' && GEO_MAP[geoRaw]) {
    const preferred = GEO_MAP[geoRaw];
    const geoCandidates = candidates.filter(s => preferred.includes(s.country));
    if (geoCandidates.length >= 8) candidates = geoCandidates; // 只在有足够候选时限制
  }

  // 学术水平过滤（below_medium学生不展示extreme难度院校）
  if (academic === 'below_medium') {
    candidates = candidates.filter(s => s.difficulty !== 'extreme');
  }

  // 专业方向加权排序（将匹配的排前面）
  candidates.sort((a, b) => {
    const aMatch = (a.programs || []).includes(subject) ? 1 : 0;
    const bMatch = (b.programs || []).includes(subject) ? 1 : 0;
    const aMI = topMIKeys.filter(mi => (a.miStrengths||[]).includes(mi)).length;
    const bMI = topMIKeys.filter(mi => (b.miStrengths||[]).includes(mi)).length;
    const aRiasec = riasec && (a.riasec||[]).includes(riasec) ? 1 : 0;
    const bRiasec = riasec && (b.riasec||[]).includes(riasec) ? 1 : 0;
    return (bMatch + bMI + bRiasec) - (aMatch + aMI + aRiasec);
  });

  return candidates.slice(0, 20); // 给LLM最多20所候选
}

// ── 院校 LLM 智能推荐提示词构建器（mode: schoolRec）────────────────
// 升级版：从65所真实学校数据库中动态筛选候选，LLM负责个性化理由
function buildSchoolRecPrompt(d) {
  const MI_MAP = {
    linguistic:'语言智能', logical:'逻辑数学', spatial:'空间视觉',
    musical:'音乐节奏', bodily:'身体运动', interpersonal:'人际交往',
    intrapersonal:'自我认知', naturalist:'自然探索',
  };
  const topMIText = Object.entries(d.miScores || {})
    .sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([k,v])=>`${MI_MAP[k]||k}(${v}/5)`).join('、') || '未知';

  // ── 动态筛选候选院校 ─────────────────────────────────────
  const candidates = filterSchoolsForProfile(d);
  const candidateLines = candidates.map(s =>
    `• ${s.nameCn}（${s.name}）| ${s.country} | QS${s.qsRank ? '#'+s.qsRank : 'N/A'} | 难度:${s.difficulty} | 优势专业:${(s.programs||[]).join('/')} | 特色:${s.specialty}`
  ).join('\n');

  const RIASEC_LABELS = { R:'Realistic动手型', I:'Investigative研究型', A:'Artistic创意型', S:'Social助人型', E:'Enterprising领导型', C:'Conventional执行型' };
  const riasecLabel = d.riasecPrimary ? (RIASEC_LABELS[d.riasecPrimary] || d.riasecPrimary) : '未知';

  const systemPrompt = `你是袁希™国际教育顾问，拥有20年院校匹配经验。
你的任务：从下方候选院校列表中，为${d.childName || '该孩子'}精选5所学校，每所都必须给出专门针对这个孩子的个性化推荐理由。

铁律：
1. 只能从候选列表中选，不能推荐列表外的学校
2. 每所学校的whyFit必须：① 引用该孩子的具体MI维度分数或家长原话 ② 说明与该校specialty的具体连接
3. 覆盖reach/match/safety三个录取层次，给家长真实的选择空间
4. 只输出JSON数组，不加任何解释
5. 所有文字字段严禁使用任何Markdown符号：不得出现*、**、#、-列表符等。只用纯中文文字和标点`;

  const userPrompt =
    `孩子档案：\n` +
    `- 姓名：${d.childName || '孩子'}\n` +
    `- 年级阶段：${d.schoolStage || '初中/高中'}\n` +
    `- 多元智能TOP3：${topMIText}\n` +
    `- 学科兴趣：${d.subjectInterest || '未知'}\n` +
    `- RIASEC职业类型：${riasecLabel}\n` +
    `- 英语水平：${d.englishLevel || '基础'}\n` +
    `- 学术水平：${d.academicLevel || '中等'}\n` +
    `- 家庭年度预算：${d.budget || '未知'}\n` +
    `- 路径倾向：${d.pathKey || '海外大学'}\n` +
    `- 家长观察到的天赋：${d.observedSkills || '（未填）'}\n\n` +
    `候选院校列表（必须从这里选）：\n${candidateLines}\n\n` +
    `请输出5所推荐院校的JSON数组，每项包含：\n` +
    `{name, nameCn, country, type, tier(reach/match/safety), whyFit(1-2句个性化理由，必须引用MI数据或家长原话), feature(该校特色一句话)}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ];
}

// ── Markdown 清洗工具 ──────────────────────────────────────────
// DeepSeek 偶尔会在 JSON 字段中插入 **加粗** 或 *斜体* 等标记
// 在微信中这些符号会原样显示，必须全部去除
function stripMarkdown(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold** → bold
    .replace(/\*(.+?)\*/g,   '$1')     // *italic* → italic
    .replace(/#{1,6}\s*/g,   '')       // ## 标题符 → 删除
    .replace(/`{1,3}/g,      '')       // `code` → 删除反引号
    .replace(/^\s*[-*>]\s+/gm, '')     // 行首列表/引用符 → 删除
    .replace(/__(.+?)__/g,   '$1')     // __bold__ → bold
    .trim();
}

// 递归遍历对象/数组，对所有字符串字段执行 stripMarkdown
function sanitizeMarkdown(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      if (typeof item === 'string') obj[i] = stripMarkdown(item);
      else sanitizeMarkdown(item);
    });
  } else {
    Object.keys(obj).forEach(k => {
      if (typeof obj[k] === 'string') obj[k] = stripMarkdown(obj[k]);
      else if (typeof obj[k] === 'object') sanitizeMarkdown(obj[k]);
    });
  }
}

// ── 主函数 ────────────────────────────────────────────────────
exports.main = async (event, context) => {
  try {
    // ── 智能报告全量生成模式（mode: 'reportFullGenerate'）────────────
    // 真正的智能报告：每个章节都有具体理由，替代所有规则文字
    if (event.mode === 'reportFullGenerate') {
      const messages = buildReportFullGeneratePrompt(event.data || {});
      const rawText  = await callDeepSeekChat(messages, 3000, 0.80);
      if (!rawText) return { success: false, error: 'AI返回内容为空' };
      const cleaned  = rawText.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
      try {
        const fullReport = JSON.parse(cleaned);
        // ── 后处理：去除所有字段中的Markdown符号（防止LLM偶尔违规）
        sanitizeMarkdown(fullReport);
        return { success: true, fullReport, model: MODEL };
      } catch (e) {
        // JSON解析失败 → 返回原始文本（降级展示）
        const fallbackText = stripMarkdown(cleaned.slice(0, 400));
        return { success: true, fullReport: { openingInsight: fallbackText }, raw: cleaned.slice(0,500), model: MODEL };
      }
    }

    // ── 院校 LLM 智能推荐模式（mode: 'schoolRec'）──────────────────
    if (event.mode === 'schoolRec') {
      const messages = buildSchoolRecPrompt(event.data || {});
      const rawText  = await callDeepSeekChat(messages, 900, 0.7);
      if (!rawText) return { success: false, error: 'AI返回内容为空' };
      const cleaned  = rawText.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
      try {
        const schools = JSON.parse(cleaned);
        const list = Array.isArray(schools) ? schools : [];
        list.forEach(s => sanitizeMarkdown(s));
        return { success: true, schools: list, model: MODEL };
      } catch (e) {
        return { success: false, error: 'JSON解析失败', raw: cleaned.slice(0,300) };
      }
    }

    // ── 报告文字增强模式（mode: 'reportEnrich'）────────────────────
    // 用LLM替换report_engine硬编码evidence/rationale/risks/actions文字
    if (event.mode === 'reportEnrich') {
      const messages = buildReportEnrichPrompt(event.data || {});
      const rawText  = await callDeepSeekChat(messages, 900, 0.75);
      if (!rawText) return { success: false, error: 'AI返回内容为空' };
      const cleaned  = rawText.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
      try {
        const enriched = JSON.parse(cleaned);
        return { success: true, enriched, model: MODEL };
      } catch (e) {
        return { success: false, error: 'JSON解析失败', raw: cleaned.slice(0,200) };
      }
    }

    // ── 报告深度分析模式（mode: 'reportAnalysis'）─────────────────
    if (event.mode === 'reportAnalysis') {
      const messages = buildReportAnalysisPrompt(event.data || {});
      if (!messages) return { success: false, error: 'no_parent_data' };
      const rawText = await callDeepSeekChat(messages, 800, 0.70);
      if (!rawText) return { success: false, error: 'AI返回内容为空' };
      // 解析JSON（AI可能加了```json```标记，清理后解析）
      const cleaned = rawText.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
      try {
        const insight = JSON.parse(cleaned);
        return { success: true, insight, model: MODEL };
      } catch (e) {
        // JSON解析失败 → 返回原始文本供降级展示
        return { success: true, insight: { yuanxiPerspective: cleaned }, model: MODEL };
      }
    }

    // ── 聊天模式（mode: 'chat'）：接收完整messages数组 ──────────
    if (event.mode === 'chat') {
      const messages = event.messages || [];
      if (!messages.length) {
        return { success: false, error: 'messages不能为空' };
      }
      const replyText = await callDeepSeekChat(
        messages,
        event.maxTokens || 1200,
        event.temperature || 0.80
      );
      if (!replyText) {
        return { success: false, error: 'AI 返回内容为空' };
      }
      return { success: true, text: replyText, model: MODEL };
    }

    // ── 结构化提取模式（mode: 'extract'）：LLM意图分类 + 字段提取 ──
    // temperature=0.1 保证JSON输出稳定，maxTokens=400 足够一个JSON对象
    if (event.mode === 'extract') {
      const messages = event.messages || [];
      if (!messages.length) {
        return { success: false, error: 'messages不能为空' };
      }
      const rawText = await callDeepSeekChat(
        messages,
        event.maxTokens || 400,
        event.temperature || 0.1
      );
      if (!rawText) {
        return { success: false, error: 'AI 返回内容为空' };
      }
      return { success: true, text: rawText, model: MODEL };
    }

    // ── 高考志愿模式（mode: 'gaokao'）────────────────────────────
    if (event.mode === 'gaokao') {
      const messages = buildGaokaoPrompt(event.params || {});
      const text = await callDeepSeekChat(messages, 1600, 0.75);
      if (!text) return { success: false, error: 'AI返回内容为空' };
      return { success: true, text, model: MODEL };
    }

    // ── 分析模式（默认）：构建Prompt ─────────────────────────────
    const prompt = buildPrompt(event);
    const analysisText = await callDeepSeek(prompt);

    if (!analysisText) {
      return { success: false, error: 'AI 返回内容为空' };
    }

    return {
      success: true,
      analysisText,
      model: MODEL,
      tokenCount: analysisText.length,  // 估算
    };

  } catch (err) {
    console.error('[aiAnalysis]', err);
    return {
      success: false,
      error: err.message,
    };
  }
};
