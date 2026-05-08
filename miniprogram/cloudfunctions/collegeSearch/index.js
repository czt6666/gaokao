// cloudfunctions/collegeSearch/index.js
// 战略成长™ · College Scorecard API 云函数
//
// ═══════════════════════════════════════════════════════════
//  功能：
//  1. searchByName(name)       — 按学校名搜索（支持中英文）
//  2. getByIds(ids[])          — 批量获取多所学校详情
//  3. enrichOurSchools()       — 批量更新我们库中所有美国学校
//  4. searchExpand(keyword)    — 扩展搜索（全量6400+美国学校）
// ═══════════════════════════════════════════════════════════

const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ── API 配置 ─────────────────────────────────────────────────
const API_KEY = 'j5Tj3IH5XapJJ9VB1wr4rwORyMszclLXJqf2LW5X';
const BASE_URL = 'https://api.data.gov/ed/collegescorecard/v1/schools';

// 我们需要的字段（精心筛选，避免浪费请求配额）
const FIELDS = [
  'id',
  'school.name',
  'school.city',
  'school.state',
  'school.school_url',
  'school.ownership',           // 1=公立, 2=私立非营利, 3=私立营利
  'school.locale',              // 城市规模
  'school.carnegie_basic',      // 学校分类

  // 录取
  'latest.admissions.admission_rate.overall',
  'latest.admissions.sat_scores.average.overall',
  'latest.admissions.sat_scores.25th_percentile.critical_reading',
  'latest.admissions.sat_scores.75th_percentile.critical_reading',
  'latest.admissions.act_scores.midpoint.cumulative',

  // 规模
  'latest.student.size',
  'latest.student.demographics.race_ethnicity.white',
  'latest.student.demographics.race_ethnicity.asian',
  'latest.student.demographics.race_ethnicity.hispanic',
  'latest.student.demographics.men',
  'latest.student.demographics.women',

  // 费用
  'latest.cost.tuition.in_state',
  'latest.cost.tuition.out_of_state',
  'latest.cost.avg_net_price.public',
  'latest.cost.avg_net_price.private',

  // 奖学金/助学金
  'latest.aid.pell_grant_rate',
  'latest.aid.federal_loan_rate',
  'latest.aid.median_debt.completers.overall',

  // 毕业率
  'latest.completion.completion_rate_4yr_150nt',
  'latest.completion.completion_rate_less_than_4yr_150nt',

  // 毕业后收入（10年）
  'latest.earnings.10_yrs_after_entry.median',
  'latest.earnings.6_yrs_after_entry.median',

  // 热门专业
  'latest.programs.cip_4_digit.code',
  'latest.programs.cip_4_digit.title',
].join(',');

// 中英文学校名映射（方便中文搜索）
const NAME_MAP = {
  '麻省理工': 'Massachusetts Institute of Technology',
  'MIT': 'Massachusetts Institute of Technology',
  '哈佛': 'Harvard University',
  '斯坦福': 'Stanford University',
  '耶鲁': 'Yale University',
  '普林斯顿': 'Princeton University',
  '哥伦比亚': 'Columbia University',
  '宾大': 'University of Pennsylvania',
  '芝加哥大学': 'University of Chicago',
  'UChicago': 'University of Chicago',
  '西北大学': 'Northwestern University',
  '杜克': 'Duke University',
  '康奈尔': 'Cornell University',
  '达特茅斯': 'Dartmouth College',
  '布朗': 'Brown University',
  '伯克利': 'University of California-Berkeley',
  'UCLA': 'University of California-Los Angeles',
  '密歇根': 'University of Michigan-Ann Arbor',
  '卡内基梅隆': 'Carnegie Mellon University',
  'CMU': 'Carnegie Mellon University',
  '约翰斯霍普金斯': 'Johns Hopkins University',
  'JHU': 'Johns Hopkins University',
  'Caltech': 'California Institute of Technology',
  '加州理工': 'California Institute of Technology',
  'NYU': 'New York University',
  '纽约大学': 'New York University',
  '乔治城': 'Georgetown University',
  '圣母': 'University of Notre Dame',
  '范德比尔特': 'Vanderbilt University',
  '埃默里': 'Emory University',
  'WashU': 'Washington University in St Louis',
  '华盛顿大学': 'University of Washington-Seattle Campus',
  '莱斯': 'Rice University',
};

// ── HTTP 请求封装（含状态码检查）──────────────────────────
function fetchAPI(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // College Scorecard API 正常响应一定含 metadata 字段
          // 若状态码非 200 则视为错误
          if (res.statusCode !== 200) {
            const errMsg = (parsed && (parsed.message || parsed.error)) || `HTTP ${res.statusCode}`;
            console.error('[fetchAPI] API error:', res.statusCode, errMsg, url.slice(0, 120));
            return reject(new Error(`API ${res.statusCode}: ${errMsg}`));
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error('JSON parse error: ' + data.slice(0, 200)));
        }
      });
    }).on('error', reject);
  });
}

// ── 数据标准化：将 API 字段映射为我们的格式 ──────────────
function normalizeSchool(raw) {
  const s = raw;
  const admissionRate = s['latest.admissions.admission_rate.overall'];
  const tuitionOut = s['latest.cost.tuition.out_of_state'];
  const tuitionIn = s['latest.cost.tuition.in_state'];
  const earnings10y = s['latest.earnings.10_yrs_after_entry.median'];
  const satAvg = s['latest.admissions.sat_scores.average.overall'];
  const gradRate = s['latest.completion.completion_rate_4yr_150nt'];
  const studentSize = s['latest.student.size'];

  // 录取难度判断
  let admissionDifficulty = 'medium';
  if (admissionRate !== null && admissionRate !== undefined) {
    if (admissionRate < 0.07)      admissionDifficulty = 'very_high';
    else if (admissionRate < 0.20) admissionDifficulty = 'high';
    else if (admissionRate < 0.50) admissionDifficulty = 'medium';
    else                           admissionDifficulty = 'low';
  }

  // 学校性质
  const ownershipMap = { 1: '公立', 2: '私立', 3: '私立营利' };
  const ownership = ownershipMap[s['school.ownership']] || '未知';

  // 折算人民币（粗算 1 USD ≈ 7.2 CNY）
  const tuitionCNY = tuitionOut ? Math.round(tuitionOut * 7.2) : null;

  return {
    // 基本信息
    _sourceId: s.id,                              // College Scorecard ID
    _sourceUpdated: new Date().toISOString().slice(0, 10),
    name_official: s['school.name'],              // 官方英文名
    city: s['school.city'],
    state: s['school.state'],
    website: s['school.school_url'] ? 'https://' + s['school.school_url'] : null,
    ownership,

    // 录取数据（官方数据，实时更新）
    admissionRate: admissionRate ? (admissionRate * 100).toFixed(1) + '%' : null,
    admissionRateRaw: admissionRate,
    admissionDifficulty,
    satAverage: satAvg ? Math.round(satAvg) : null,
    actMidpoint: s['latest.admissions.act_scores.midpoint.cumulative'] || null,

    // 费用（官方数据）
    tuitionOutOfState: tuitionOut || null,
    tuitionInState: tuitionIn || null,
    tuitionCNY,
    avgNetPrice: s['latest.cost.avg_net_price.private'] || s['latest.cost.avg_net_price.public'] || null,
    pellGrantRate: s['latest.aid.pell_grant_rate']
      ? (s['latest.aid.pell_grant_rate'] * 100).toFixed(0) + '%' : null,

    // 规模
    studentSize: studentSize || null,
    genderRatio: {
      men: s['latest.student.demographics.men']
        ? (s['latest.student.demographics.men'] * 100).toFixed(0) + '%' : null,
      women: s['latest.student.demographics.women']
        ? (s['latest.student.demographics.women'] * 100).toFixed(0) + '%' : null,
    },

    // 成果
    graduationRate: gradRate ? (gradRate * 100).toFixed(0) + '%' : null,
    graduationRateRaw: gradRate,
    medianEarnings10yr: earnings10y ? '$' + earnings10y.toLocaleString() : null,
    medianEarnings10yrRaw: earnings10y,
    medianEarnings6yr: s['latest.earnings.6_yrs_after_entry.median'] || null,
    medianDebt: s['latest.aid.median_debt.completers.overall'] || null,
  };
}

// ── 主处理函数 ──────────────────────────────────────────────
exports.main = async (event, context) => {
  const { action, name, ids, keyword, page = 0, perPage = 10, unitId } = event;

  try {
    switch (action) {

      // ─────────────────────────────────────────────────────
      // 1. 按名称搜索（支持中英文）
      // ─────────────────────────────────────────────────────
      case 'searchByName': {
        // 先查中文映射
        const searchName = NAME_MAP[name] || name;
        const url = `${BASE_URL}?api_key=${API_KEY}&school.name=${encodeURIComponent(searchName)}&fields=${FIELDS}&per_page=5`;
        const data = await fetchAPI(url);
        const results = (data.results || []).map(normalizeSchool);
        return { success: true, results, total: data.metadata?.total || results.length };
      }

      // ─────────────────────────────────────────────────────
      // 2. 批量获取（用于更新我们库中已有学校）
      //    ids 格式：[{ ourId: 'harvard', name: 'Harvard University' }, ...]
      // ─────────────────────────────────────────────────────
      case 'getByIds': {
        const enriched = {};
        for (const school of ids) {
          const searchName = NAME_MAP[school.name] || school.name;
          const url = `${BASE_URL}?api_key=${API_KEY}&school.name=${encodeURIComponent(searchName)}&fields=${FIELDS}&per_page=1`;
          const data = await fetchAPI(url);
          if (data.results && data.results.length > 0) {
            enriched[school.ourId] = normalizeSchool(data.results[0]);
          }
          // 避免触发速率限制
          await new Promise(r => setTimeout(r, 100));
        }
        return { success: true, enriched };
      }

      // ─────────────────────────────────────────────────────
      // 3. 扩展搜索（全量6400+美国学校）
      //    用户在学校库搜索时，我们的库没有的也能找到
      // ─────────────────────────────────────────────────────
      case 'searchExpand': {
        const searchKw = NAME_MAP[keyword] || keyword;
        const url = `${BASE_URL}?api_key=${API_KEY}&school.name=${encodeURIComponent(searchKw)}&fields=${FIELDS}&per_page=${perPage}&page=${page}&school.degrees_awarded.predominant=3`; // 3=本科为主
        const data = await fetchAPI(url);
        const results = (data.results || []).map(r => ({
          ...normalizeSchool(r),
          unitId: r.id,        // College Scorecard unit ID，供详情页精确查询
          // 扩展搜索结果额外标记
          _isExpanded: true,
          _notInOurDB: true,
        }));
        return {
          success: true,
          results,
          total: data.metadata?.total || 0,
          page,
          hasMore: (data.metadata?.total || 0) > (page + 1) * perPage,
        };
      }

      // ─────────────────────────────────────────────────────
      // 4. 获取单所学校完整详情（用于学校详情页）
      //    支持按 unitId 精确查询，或按名称模糊匹配
      // ─────────────────────────────────────────────────────
      case 'getDetail': {
        let url;
        if (unitId) {
          // 精确查询：直接用 College Scorecard unit ID
          url = `${BASE_URL}?api_key=${API_KEY}&id=${unitId}&fields=${FIELDS}&per_page=1`;
        } else {
          const searchName = NAME_MAP[name] || name;
          url = `${BASE_URL}?api_key=${API_KEY}&school.name=${encodeURIComponent(searchName)}&fields=${FIELDS}&per_page=1`;
        }
        const data = await fetchAPI(url);
        if (!data.results || data.results.length === 0) {
          return { success: false, error: 'School not found' };
        }
        return { success: true, detail: normalizeSchool(data.results[0]) };
      }

      // ─────────────────────────────────────────────────────
      // 5. 获取某州所有大学（用于地区浏览）
      // ─────────────────────────────────────────────────────
      case 'getByState': {
        const { state } = event;
        const url = `${BASE_URL}?api_key=${API_KEY}&school.state=${state}&fields=${FIELDS}&per_page=20&page=${page}&school.degrees_awarded.predominant=3&_sort=latest.admissions.admission_rate.overall:asc`;
        const data = await fetchAPI(url);
        const results = (data.results || []).map(r => ({
          ...normalizeSchool(r),
          _isExpanded: true,
        }));
        return { success: true, results, total: data.metadata?.total || 0 };
      }

      // ─────────────────────────────────────────────────────
      // 6. 通用 API 代理（college_api.js 转发用）
      //    接收任意查询参数，在服务端调用 College Scorecard API
      //    绕过小程序合法域名限制
      // ─────────────────────────────────────────────────────
      case 'proxyAPI': {
        const { params } = event;
        // ⚠️ 关键修复：College Scorecard 的 fields 参数使用逗号分隔字段名
        //    encodeURIComponent 会把逗号编码成 %2C，某些 API 版本不能正确解码
        //    因此 fields 参数的值直接拼接（逗号保持原样），其他参数正常编码
        const parts = [];
        for (const [k, v] of Object.entries(params)) {
          if (k === 'fields') {
            // fields 值：保留原始逗号，不做 encode
            parts.push(`fields=${String(v)}`);
          } else {
            parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
          }
        }
        const url = `${BASE_URL}?api_key=${API_KEY}&${parts.join('&')}`;
        console.log('[proxyAPI] URL prefix:', url.slice(0, 150));
        const data = await fetchAPI(url);
        if (!data.results && !data.metadata) {
          // API 返回了 JSON 但不是正常数据格式（可能是错误体）
          console.error('[proxyAPI] unexpected response:', JSON.stringify(data).slice(0, 200));
          return { success: false, error: 'Unexpected API response format', raw: data };
        }
        return { success: true, data };
      }

      // ─────────────────────────────────────────────────────
      // 7. 获取美国 Top 大学（按 SAT 均分，用于学校库默认展示）
      // ─────────────────────────────────────────────────────
      case 'getTopSchools': {
        const { perPage = 60 } = event;
        const url = `${BASE_URL}?api_key=${API_KEY}`
          + `&fields=${encodeURIComponent(FIELDS)}`
          + `&school.degrees_awarded.predominant=3`
          + `&latest.student.size__range=1000..`
          + `&sort=latest.admissions.sat_scores.average.overall%3Adesc`
          + `&per_page=${perPage}&page=0`;
        const data = await fetchAPI(url);
        const results = (data.results || []).map(normalizeSchool);
        return { success: true, results, total: results.length };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (err) {
    console.error('[collegeSearch]', err);
    return { success: false, error: err.message };
  }
};
