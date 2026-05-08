// cloudfunctions/generateReport/index.js
// 云函数：调用 AI API 生成诊断报告
//
// 📌 设置说明：
//   1. 在微信云开发控制台 -> 云函数 -> generateReport -> 函数配置
//   2. 添加环境变量：OPENAI_API_KEY = 你的API Key
//   3. 如果使用 Claude API，改成：ANTHROPIC_API_KEY
//
// 💡 本函数支持两种模式：
//   - AI 模式：调用 GPT-4 / Claude 生成丰富报告
//   - 降级模式：AI 不可用时自动用规则引擎生成简版

const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// ── 多元智能中文标签 ──
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

// ── 主入口 ──
exports.main = async (event, context) => {
  const { assessmentData } = event;

  if (!assessmentData) {
    return { success: false, error: '缺少评估数据' };
  }

  try {
    // 优先使用 AI 生成
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      const report = await generateWithAI(assessmentData, apiKey);
      await saveReportToDB(report, context);
      return { success: true, report };
    } else {
      // 没有 API Key，使用规则引擎
      const report = generateWithRules(assessmentData);
      await saveReportToDB(report, context);
      return { success: true, report };
    }
  } catch (err) {
    console.error('报告生成失败：', err);
    // 出错时降级为规则引擎
    const report = generateWithRules(assessmentData);
    return { success: true, report, fallback: true };
  }
};

// ════════════════════════════════════════
// ── AI 生成（调用 OpenAI GPT-4）──
// ════════════════════════════════════════
async function generateWithAI(data, apiKey) {
  const prompt = buildPrompt(data);

  const response = await callOpenAI(apiKey, [
    {
      role: 'system',
      content: `你是"战略成长™"的首席教育战略顾问，融合加德纳多元智能理论、卡罗尔·德韦克成长型思维框架和保罗-埃尔德批判性思维模型。

你的任务是根据父母填写的评估数据，为孩子生成一份深刻、个性化、有战略价值的成长诊断报告。
报告语气：专业但温暖，像一位值得信赖的顾问，不是冷冰冰的测评系统。
语言：中文。
输出格式：纯 JSON，按照指定的结构输出。`
    },
    {
      role: 'user',
      content: prompt,
    }
  ]);

  // 解析 AI 返回
  const content = response.choices[0].message.content;
  let aiData;
  try {
    // 提取 JSON 部分（AI 可能会加前后文）
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    aiData = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
  } catch (e) {
    console.warn('AI 返回 JSON 解析失败，使用规则引擎', e);
    return generateWithRules(data);
  }

  return {
    ...generateWithRules(data),  // 确保基础字段存在
    ...aiData,                    // AI 生成的内容覆盖
    generatedAt: Date.now(),
    generatedBy: 'ai',
  };
}

// ── 构建 AI Prompt ──
function buildPrompt(data) {
  const { answers, miScores, mindsetScore, childName, childAge } = data;

  // 整理 MI 数据
  const miList = Object.entries(miScores || {})
    .map(([key, val]) => `${MI_LABELS[key] || key}: ${val}/4`)
    .join('，');

  // 整理关键答案
  const context = {
    孩子名字: childName,
    年龄: `${childAge}岁`,
    学段: answers.schoolStage,
    学校类型: answers.schoolType,
    多元智能得分: miList,
    成长型思维得分: `${mindsetScore}/4`,
    面对挑战的反应: answers.mindset_challenge_response,
    父母职业背景: answers.parent_occupation,
    城市层级: answers.city_tier,
    年教育投入: answers.education_budget,
    海外经历: answers.overseas_experience,
    孩子25岁目标: answers.goal_at_25,
    教育路径倾向: answers.education_path_preference,
    最大担忧: answers.biggest_concern,
  };

  return `
以下是一个家庭的评估数据，请生成诊断报告：

${JSON.stringify(context, null, 2)}

请按以下 JSON 结构输出（不要有其他文字）：
{
  "childName": "孩子名字",
  "childAge": 数字,
  "summary": "2-3句话的核心摘要，指出孩子最突出的特质和最重要的发展方向",
  "miScores": { 同输入的 miScores },
  "miList": [按得分降序排列的数组，每项包含 key/val/label],
  "topMI": [最高3项，每项包含 key/val/label],
  "mindsetScore": 数字,
  "miInsight": "100字以内：对孩子多元智能分布的深度解读，指出优势与潜力",
  "mindsetInsight": "80字以内：对思维模式的解读，以及如何培养",
  "familyProfile": "60字以内：基于家庭背景的资源优势分析",
  "educationPath": "推荐路径名称（短，4-8字）",
  "pathReason": "80字以内：为什么推荐这条路径",
  "decisionWindows": [
    {
      "stage": "近期窗口名称（如：小升初准备）",
      "timeframe": "时间范围（如：1-2年内）",
      "keyAction": "核心建议（30字内）"
    }
  ],
  "watchOutFor": "最需要注意的1个风险点（40字内）"
}`;
}

// ── 调用 OpenAI API ──
function callOpenAI(apiKey, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-4o',
      messages,
      temperature: 0.7,
      max_tokens: 1500,
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ════════════════════════════════════════
// ── 规则引擎（离线/降级版本）──
// ════════════════════════════════════════
function generateWithRules(data) {
  const { answers, miScores, mindsetScore, childName, childAge } = data;

  // MI 排序
  const miList = Object.entries(miScores || {})
    .map(([key, val]) => ({ key, val, label: MI_LABELS[key] || key }))
    .sort((a, b) => b.val - a.val);

  const topMI = miList.slice(0, 3);
  const topNames = topMI.map(m => m.label).join('、');

  // 成长型思维等级
  const ms = mindsetScore || 0;
  const mindsetLevel = ms >= 3.5 ? '成长型' : ms >= 2.5 ? '发展中' : '固化型';

  // 教育路径推荐
  const path = recommendPath(answers);

  // 生成摘要
  const summary = `${childName}在${topNames}方面展现出突出天赋（得分均在${topMI[0]?.val || '—'}分）。` +
    `成长型思维处于${mindsetLevel}阶段（${ms}/4），` +
    `结合家庭背景与目标，我们建议优先考虑${path}。`;

  return {
    childName: childName || '孩子',
    childAge: childAge || 0,
    summary,
    miScores: miScores || {},
    miList,
    topMI,
    mindsetScore: ms,
    mindsetLevel,
    educationPath: path,
    answers,
    generatedAt: Date.now(),
    generatedBy: 'rules',
  };
}

function recommendPath(answers) {
  const { education_path_preference, goal_at_25, education_budget } = answers;
  if (education_path_preference && education_path_preference !== 'undecided') {
    const map = {
      gaokao: '国内高考路线',
      highschool_abroad: '高中出国路线',
      university_abroad: '大学出国路线',
      international_school: '国际学校路线',
    };
    return map[education_path_preference] || '综合路线';
  }
  if (goal_at_25 === 'career_overseas') return '国际精英路线';
  if (goal_at_25 === 'academia') return '学术深造路线';
  if (goal_at_25 === 'entrepreneurship') return '创业者培养路线';
  if (goal_at_25 === 'stable_china') return '国内顶尖路线';
  return '综合多元路线';
}

// ── 保存报告到云数据库 ──
async function saveReportToDB(report, context) {
  try {
    await db.collection('reports').add({
      data: {
        ...report,
        _openid: context.OPENID,
        createdAt: db.serverDate(),
      }
    });
  } catch (e) {
    console.warn('保存报告到数据库失败（不影响用户）', e);
  }
}
