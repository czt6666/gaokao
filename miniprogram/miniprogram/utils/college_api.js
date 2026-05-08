// utils/college_api.js
// 战略成长™ · College Scorecard API 直连封装（无需云函数）
// ═══════════════════════════════════════════════════════════════
//  直接调用 US Department of Education College Scorecard API
//  开发环境需在微信开发者工具中勾选"不校验合法域名"
//  正式上线需在小程序后台配置合法域名: api.data.gov
// ═══════════════════════════════════════════════════════════════

const API_KEY  = 'j5Tj3IH5XapJJ9VB1wr4rwORyMszclLXJqf2LW5X';
const BASE_URL = 'https://api.data.gov/ed/collegescorecard/v1/schools';
const CNY_RATE = 7.25; // USD→CNY

const CACHE_HOURS  = 24;
const CACHE_VER    = 'v3';          // 升版本 → 自动废弃旧缓存（含曾经缓存的空数组）
const CACHE_PREFIX = 'cs_' + CACHE_VER + '_';

// ── 常用字段集 ────────────────────────────────────────────────
const FIELDS_SUMMARY = [
  'id', 'school.name', 'school.city', 'school.state',
  'school.ownership', 'school.school_url',
  'latest.admissions.admission_rate.overall',
  'latest.admissions.sat_scores.average.overall',
  'latest.cost.tuition.out_of_state',
  'latest.cost.tuition.in_state',
  'latest.student.size',
].join(',');

const FIELDS_DETAIL = [
  // 基本信息
  'id', 'school.name', 'school.city', 'school.state',
  'school.ownership', 'school.locale', 'school.school_url',
  'school.carnegie_basic',
  // 录取
  'latest.admissions.admission_rate.overall',
  'latest.admissions.sat_scores.average.overall',
  'latest.admissions.sat_scores.25th_percentile.critical_reading',
  'latest.admissions.sat_scores.75th_percentile.critical_reading',
  'latest.admissions.sat_scores.25th_percentile.math',
  'latest.admissions.sat_scores.75th_percentile.math',
  'latest.admissions.act_scores.midpoint.cumulative',
  'latest.admissions.act_scores.25th_percentile.cumulative',
  'latest.admissions.act_scores.75th_percentile.cumulative',
  // 费用
  'latest.cost.tuition.out_of_state',
  'latest.cost.tuition.in_state',
  'latest.cost.attendance.academic_year',
  'latest.cost.avg_net_price.public',
  'latest.cost.avg_net_price.private',
  // 学生规模与构成
  'latest.student.size',
  'latest.student.grad_students',
  'latest.student.part_time_share',
  'latest.student.share_firstgeneration',
  'latest.student.retention_rate.four_year.full_time',
  'latest.student.demographics.men',
  'latest.student.demographics.women',
  // 族裔构成
  'latest.student.demographics.race_ethnicity.asian',
  'latest.student.demographics.race_ethnicity.white',
  'latest.student.demographics.race_ethnicity.black',
  'latest.student.demographics.race_ethnicity.hispanic',
  'latest.student.demographics.race_ethnicity.non_resident_alien',
  // 毕业与就业
  'latest.completion.rate_suppressed.overall',
  'latest.earnings.6_yrs_after_entry.median',
  'latest.earnings.8_yrs_after_entry.median',
  'latest.earnings.10_yrs_after_entry.median',
  // 助学金与债务
  'latest.aid.median_debt_suppressed.completers.overall',
  'latest.aid.pell_grant_rate',
  // 专业分布（大类占比）
  'latest.academics.program_percentage.computer',
  'latest.academics.program_percentage.engineering',
  'latest.academics.program_percentage.business_marketing',
  'latest.academics.program_percentage.biological',
  'latest.academics.program_percentage.mathematics',
  'latest.academics.program_percentage.health',
  'latest.academics.program_percentage.humanities',
  'latest.academics.program_percentage.social_science',
  'latest.academics.program_percentage.physical_science',
  // ⚠️ latest.programs.cip_4_digit 已移除：
  //    该字段返回数百行专业数据（通常 200-500KB），导致云函数超时（>3s）
  //    如需专业级薪资数据，应使用独立的云函数并异步加载
].join(',');

// 所有权类型中文化
const OWNERSHIP_MAP = { 1: '公立大学', 2: '私立非营利', 3: '私立营利' };

// ── 中文→英文名称映射 ─────────────────────────────────────────
const CN_NAME_MAP = {
  '麻省理工': 'Massachusetts Institute of Technology',
  'MIT': 'Massachusetts Institute of Technology',
  '哈佛': 'Harvard University',
  '哈佛大学': 'Harvard University',
  '斯坦福': 'Stanford University',
  '斯坦福大学': 'Stanford University',
  '耶鲁': 'Yale University',
  '耶鲁大学': 'Yale University',
  '普林斯顿': 'Princeton University',
  '普林斯顿大学': 'Princeton University',
  '哥伦比亚': 'Columbia University',
  '哥大': 'Columbia University',
  '宾大': 'University of Pennsylvania',
  '宾夕法尼亚大学': 'University of Pennsylvania',
  '芝加哥大学': 'University of Chicago',
  '西北大学': 'Northwestern University',
  '杜克': 'Duke University',
  '杜克大学': 'Duke University',
  '康奈尔': 'Cornell University',
  '加州理工': 'California Institute of Technology',
  'Caltech': 'California Institute of Technology',
  '约翰霍普金斯': 'Johns Hopkins University',
  '伯克利': 'University of California-Berkeley',
  '加州大学伯克利分校': 'University of California-Berkeley',
  'CMU': 'Carnegie Mellon University',
  '卡内基梅隆': 'Carnegie Mellon University',
  '纽约大学': 'New York University',
  'NYU': 'New York University',
  '布朗': 'Brown University',
  '达特茅斯': 'Dartmouth College',
  '范德堡': 'Vanderbilt University',
  '莱斯': 'Rice University',
  '埃默里': 'Emory University',
  '圣母大学': 'University of Notre Dame',
  '乔治城': 'Georgetown University',
  '塔夫茨': 'Tufts University',
  'UCLA': 'University of California-Los Angeles',
  '密歇根': 'University of Michigan-Ann Arbor',
};

// ── 缓存工具 ──────────────────────────────────────────────────
function getCached(key) {
  try {
    const raw = wx.getStorageSync(CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, expiry } = raw;
    if (Date.now() > expiry) { wx.removeStorageSync(CACHE_PREFIX + key); return null; }
    return data;
  } catch { return null; }
}

function setCache(key, data) {
  try {
    wx.setStorageSync(CACHE_PREFIX + key, {
      data,
      expiry: Date.now() + CACHE_HOURS * 3600 * 1000,
    });
  } catch {}
}

// ── 核心请求：通过云函数代理，绕过小程序合法域名限制 ─────
// college_api.js 保持原有接口不变，底层改为云函数转发
// 云函数 collegeSearch 在 Tencent 服务端调用 api.data.gov，无域名限制
function apiGet(params) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'collegeSearch',
      data: { action: 'proxyAPI', params },
      success: (res) => {
        const r = res.result;
        if (r && r.success && r.data) {
          resolve(r.data);
        } else {
          reject(new Error((r && r.error) || '云函数返回异常'));
        }
      },
      fail: (err) => reject(new Error(err.errMsg || '云函数调用失败')),
    });
  });
}

// ── 将 API 原始对象标准化 ──────────────────────────────────────
function pct(v) { return v != null ? Math.round(v * 100) : null; }
function pct1(v) { return v != null ? Math.round(v * 1000) / 10 : null; } // 一位小数

function normalize(r) {
  const admRate    = r['latest.admissions.admission_rate.overall'];
  const tuitionOut = r['latest.cost.tuition.out_of_state'];
  const tuitionIn  = r['latest.cost.tuition.in_state'];

  // SAT 25/75 合成分
  const sat25r = r['latest.admissions.sat_scores.25th_percentile.critical_reading'];
  const sat75r = r['latest.admissions.sat_scores.75th_percentile.critical_reading'];
  const sat25m = r['latest.admissions.sat_scores.25th_percentile.math'];
  const sat75m = r['latest.admissions.sat_scores.75th_percentile.math'];
  const sat25  = (sat25r && sat25m) ? sat25r + sat25m : null;
  const sat75  = (sat75r && sat75m) ? sat75r + sat75m : null;

  // 在校总费用（含住宿餐饮）
  const costAttend = r['latest.cost.attendance.academic_year'] || null;

  return {
    unitId:    r.id,
    name:      r['school.name'],
    city:      r['school.city']  || '',
    state:     r['school.state'] || '',
    ownership: OWNERSHIP_MAP[r['school.ownership']] || '—',
    website:   r['school.school_url'] || '',

    // ── 录取 ──
    admissionRate:    admRate != null ? Math.round(admRate * 1000) / 10 + '%' : null,
    admissionRateRaw: admRate,
    satAverage:       r['latest.admissions.sat_scores.average.overall'] || null,
    sat25, sat75,
    actMidpoint:      r['latest.admissions.act_scores.midpoint.cumulative']       || null,
    act25:            r['latest.admissions.act_scores.25th_percentile.cumulative'] || null,
    act75:            r['latest.admissions.act_scores.75th_percentile.cumulative'] || null,

    // ── 费用 ──
    tuitionOut,
    tuitionIn:  tuitionIn  || null,
    tuitionCNY: tuitionOut ? Math.round(tuitionOut * CNY_RATE) : null,
    costAttend,
    costAttendCNY: costAttend ? Math.round(costAttend * CNY_RATE) : null,
    avgNetPrice: r['latest.cost.avg_net_price.private'] || r['latest.cost.avg_net_price.public'] || null,

    // ── 学生规模与构成 ──
    studentSize:     r['latest.student.size']                           || null,
    retentionRate:   pct(r['latest.student.retention_rate.four_year.full_time']),
    firstGenShare:   pct(r['latest.student.share_firstgeneration']),
    partTimeShare:   pct(r['latest.student.part_time_share']),
    menPct:          pct(r['latest.student.demographics.men']),
    womenPct:        pct(r['latest.student.demographics.women']),

    // ── 族裔构成 ──
    raceAsian:    pct(r['latest.student.demographics.race_ethnicity.asian']),
    raceWhite:    pct(r['latest.student.demographics.race_ethnicity.white']),
    raceBlack:    pct(r['latest.student.demographics.race_ethnicity.black']),
    raceHispanic: pct(r['latest.student.demographics.race_ethnicity.hispanic']),
    raceIntl:     pct(r['latest.student.demographics.race_ethnicity.non_resident_alien']),

    // ── 毕业与就业 ──
    gradRate:           pct(r['latest.completion.rate_suppressed.overall']),
    medianEarnings6yr:  r['latest.earnings.6_yrs_after_entry.median']  || null,
    medianEarnings8yr:  r['latest.earnings.8_yrs_after_entry.median']  || null,
    medianEarnings10yr: r['latest.earnings.10_yrs_after_entry.median'] || null,
    medianDebt:         r['latest.aid.median_debt_suppressed.completers.overall'] || null,
    pellGrantRate:      r['latest.aid.pell_grant_rate'] != null
                          ? Math.round(r['latest.aid.pell_grant_rate'] * 100) + '%'
                          : null,

    // ── 专业分布（百分比，已乘100）──
    progCS:      pct1(r['latest.academics.program_percentage.computer']),
    progEng:     pct1(r['latest.academics.program_percentage.engineering']),
    progBiz:     pct1(r['latest.academics.program_percentage.business_marketing']),
    progBio:     pct1(r['latest.academics.program_percentage.biological']),
    progMath:    pct1(r['latest.academics.program_percentage.mathematics']),
    progHealth:  pct1(r['latest.academics.program_percentage.health']),
    progHum:     pct1(r['latest.academics.program_percentage.humanities']),
    progSoc:     pct1(r['latest.academics.program_percentage.social_science']),
    progPhys:    pct1(r['latest.academics.program_percentage.physical_science']),

    // ── 专业级薪资数据（已移除 cip_4_digit 字段避免超时，保留空对象兼容旧代码）
    programEarnings: {},

    // 兼容已有代码的原始字段
    costAttendRaw:  costAttend  || null,
    tuitionOutRaw:  tuitionOut  || null,

    _sourceUpdated: new Date().toLocaleDateString('zh-CN'),
  };
}

// ═══════════════════════════════════════════════════════════════
//  公开 API
// ═══════════════════════════════════════════════════════════════
const CollegeAPI = {

  /**
   * 获取美国 Top N 大学（按 SAT 均分排序）
   * 用于学校库"美国"区域的默认显示
   */
  async getTopUSSchools(perPage = 60) {
    const cacheKey = 'top_us_' + perPage;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const data = await apiGet({
      fields: FIELDS_SUMMARY,
      'school.degrees_awarded.predominant': 3,   // 本科为主
      'latest.student.size__range': '1000..',     // 至少1000人
      sort: 'latest.admissions.sat_scores.average.overall:desc',
      per_page: perPage,
      page: 0,
    });

    const results = (data.results || []).map(normalize);
    // ⚠️ 只缓存有效数据，防止空数组缓存后24小时一直返回0条
    if (results.length > 0) setCache(cacheKey, results);
    return results;
  },

  /**
   * 按名称搜索（支持中英文）
   */
  async searchByName(name) {
    const enName = CN_NAME_MAP[name] || name;
    const cacheKey = 'name_' + enName.toLowerCase().replace(/\s+/g, '_');
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const data = await apiGet({
      fields: FIELDS_SUMMARY,
      'school.name': enName,
      per_page: 5,
    });

    const results = (data.results || []).map(normalize);
    if (results.length > 0) {
      setCache(cacheKey, results[0]);
      return results[0];
    }
    return null;
  },

  /**
   * 扩展搜索：6400+ 美国大学关键词搜索
   */
  async searchExpand(keyword, page = 0) {
    const enKeyword = CN_NAME_MAP[keyword] || keyword;

    const data = await apiGet({
      fields: FIELDS_SUMMARY,
      'school.name': enKeyword,
      per_page: 15,
      page: page,
    });

    return (data.results || []).map(r => {
      const n = normalize(r);
      return {
        ...n,
        tuitionDisplay: n.tuitionOut ? `$${Math.round(n.tuitionOut / 1000)}k/年` : '费用待询',
        admissionDisplay: n.admissionRateRaw != null
          ? `${Math.round(n.admissionRateRaw * 100)}%录取`
          : '录取率未公开',
      };
    });
  },

  /**
   * 服务端条件过滤搜索（expandSearch 无关键词时使用）
   * 比 searchExpand('') 精确：直接用 API range 参数过滤，结果更相关
   */
  async searchByFilter({ usFilter_adm, usFilter_type, filterCollection, filterState } = {}) {
    const params = {
      fields: FIELDS_SUMMARY,
      'school.degrees_awarded.predominant': 3,  // 本科为主
      'latest.student.size__range': '500..',    // 排除微型学校
      per_page: 20,
      page: 0,
    };

    // 录取率范围（已知精英校不上报时也能检索到合适结果）
    const collection = filterCollection || '';
    const adm = usFilter_adm || 'all';

    if (adm === 'hard' || collection === 'hard') {
      params['latest.admissions.admission_rate.overall__range'] = '..0.149';
      params.sort = 'latest.admissions.sat_scores.average.overall:desc';
    } else if (adm === 'mid') {
      params['latest.admissions.admission_rate.overall__range'] = '0.15..0.40';
      params.sort = 'latest.admissions.sat_scores.average.overall:desc';
    } else if (adm === 'open' || collection === 'open') {
      params['latest.admissions.admission_rate.overall__range'] = '0.40..';
      params.sort = 'latest.admissions.admission_rate.overall:asc';
    } else if (collection === 'cheap') {
      params['latest.cost.tuition.out_of_state__range'] = '1000..25000';
      params.sort = 'latest.cost.tuition.out_of_state:asc';
    } else {
      // 无特定筛选：返回综合排名靠前的学校（SAT 降序）
      params.sort = 'latest.admissions.sat_scores.average.overall:desc';
    }

    if (usFilter_type === 'private') params['school.ownership'] = '2';
    if (usFilter_type === 'public')  params['school.ownership'] = '1';
    if (filterState) params['school.state'] = filterState;

    const data = await apiGet(params);
    return (data.results || []).map(normalize);
  },

  /**
   * 获取单校详情（学校详情页使用）
   */
  async getDetail(name, unitId) {
    const cacheKey = 'detail_' + (unitId || name.replace(/\s+/g, '_').toLowerCase());
    const cached = getCached(cacheKey);
    if (cached) return cached;

    let params = { fields: FIELDS_DETAIL };
    if (unitId) {
      params.id = unitId;
    } else {
      const enName = CN_NAME_MAP[name] || name;
      params['school.name'] = enName;
      params.per_page = 1;
    }

    const data = await apiGet(params);
    const results = (data.results || []).map(normalize);
    if (results.length > 0) {
      setCache(cacheKey, results[0]);
      return results[0];
    }
    return null;
  },

  /**
   * 格式化展示用数据（供 school-detail 页使用）
   */
  formatForDisplay(d) {
    if (!d) return null;
    const fmt$ = n => n ? '$' + n.toLocaleString() : null;
    const fmtW = n => n ? '约¥' + Math.round(n / 10000) + 'w' : null;
    const fmtPct = n => n != null ? n + '%' : null;

    // SAT 区间
    const satRange = (d.sat25 && d.sat75) ? `${d.sat25}–${d.sat75}` : null;
    // ACT 区间
    const actRange = (d.act25 && d.act75) ? `${d.act25}–${d.act75}` : null;
    // 男女比例
    const genderRatio = (d.menPct != null && d.womenPct != null)
      ? `男 ${d.menPct}% · 女 ${d.womenPct}%` : null;
    // 实际净费用
    const avgNetPrice = d.avgNetPrice
      ? `${fmt$(d.avgNetPrice)}/年（${fmtW(d.avgNetPrice * CNY_RATE)}）` : null;

    // 专业分布 — 过滤有值的，按占比降序，取前6
    const progMap = [
      { label: '计算机/IT',  val: d.progCS    },
      { label: '工程',        val: d.progEng   },
      { label: '商科',        val: d.progBiz   },
      { label: '生物/生命',   val: d.progBio   },
      { label: '数学/统计',   val: d.progMath  },
      { label: '医健',        val: d.progHealth },
      { label: '人文艺术',    val: d.progHum   },
      { label: '社会科学',    val: d.progSoc   },
      { label: '物理/化学',   val: d.progPhys  },
    ].filter(p => p.val > 0).sort((a, b) => b.val - a.val).slice(0, 6);

    // 族裔构成 — 过滤有值的
    const raceMap = [
      { label: '亚裔',   val: d.raceAsian,    color: '#FF9500' },
      { label: '白人',   val: d.raceWhite,    color: '#0071E3' },
      { label: '黑人',   val: d.raceBlack,    color: '#5AC8FA' },
      { label: '拉丁裔', val: d.raceHispanic, color: '#34C759' },
      { label: '国际生', val: d.raceIntl,     color: '#AF52DE' },
    ].filter(p => p.val > 0);

    return {
      // 录取
      admissionRateRaw: d.admissionRateRaw,
      admissionRate:    d.admissionRate || '—',
      satAverage:       d.satAverage    ? String(d.satAverage) : '—',
      satRange,
      actMidpoint:      d.actMidpoint   ? String(d.actMidpoint) : null,
      actRange,

      // 费用（raw 值供 4年总计算）
      costAttendRaw:   d.costAttend  || null,
      tuitionOutRaw:   d.tuitionOut  || null,
      tuitionDisplay:  d.tuitionOut ? fmt$(d.tuitionOut) + '/年' : '—',
      tuitionInState:  d.tuitionIn  ? fmt$(d.tuitionIn)  + '/年' : null,
      tuitionCNY:      d.tuitionCNY ? fmtW(d.tuitionCNY) + '/年' : '—',
      costAttend:      d.costAttend ? fmt$(d.costAttend) + '/年' : null,
      costAttendCNY:   d.costAttendCNY ? fmtW(d.costAttendCNY) + '/年' : null,
      // 生活费 = 总费用 - 学费（美国教育部官方数据推导）
      livingCost: (d.costAttend && d.tuitionOut && d.costAttend > d.tuitionOut)
        ? fmt$(d.costAttend - d.tuitionOut) + '/年'
        : null,
      livingCostCNY: (d.costAttend && d.tuitionOut && d.costAttend > d.tuitionOut)
        ? fmtW(Math.round((d.costAttend - d.tuitionOut) * CNY_RATE)) + '/年'
        : null,
      avgNetPrice,

      // 规模与构成
      studentSize:     d.studentSize    ? d.studentSize.toLocaleString() + '人' : '—',
      retentionRate:   d.retentionRate != null ? d.retentionRate + '%' : null,
      firstGenShare:   d.firstGenShare  != null ? d.firstGenShare  + '%' : null,
      partTimeShare:   d.partTimeShare  != null ? d.partTimeShare  + '%' : null,
      genderRatio,
      intlShare:       d.raceIntl != null ? d.raceIntl + '%' : null,
      ownership:       d.ownership || '—',

      // 毕业与就业
      graduationRate:    d.gradRate != null ? d.gradRate + '%' : '—',
      medianEarnings6yr: d.medianEarnings6yr  ? fmt$(d.medianEarnings6yr)  + '/年' : null,
      medianEarnings8yr: d.medianEarnings8yr  ? fmt$(d.medianEarnings8yr)  + '/年' : null,
      medianEarnings:    d.medianEarnings10yr ? fmt$(d.medianEarnings10yr) + '/年' : '—',
      medianDebt:        d.medianDebt ? fmt$(d.medianDebt) : null,

      // 助学金
      pellGrantRate: d.pellGrantRate || null,

      // 专业与族裔分布
      progMap,
      raceMap,

      website:       d.website       || '',
      dataFreshness: d._sourceUpdated || '',
    };
  },

  /**
   * 我们库中的美国大学列表
   */
  US_SCHOOLS_IN_DB: [
    { ourId: 'mit',          name: 'Massachusetts Institute of Technology' },
    { ourId: 'harvard',      name: 'Harvard University' },
    { ourId: 'stanford',     name: 'Stanford University' },
    { ourId: 'yale',         name: 'Yale University' },
    { ourId: 'princeton',    name: 'Princeton University' },
    { ourId: 'columbia',     name: 'Columbia University' },
    { ourId: 'upenn',        name: 'University of Pennsylvania' },
    { ourId: 'uchicago',     name: 'University of Chicago' },
    { ourId: 'northwestern', name: 'Northwestern University' },
    { ourId: 'duke',         name: 'Duke University' },
    { ourId: 'cornell',      name: 'Cornell University' },
    { ourId: 'caltech',      name: 'California Institute of Technology' },
    { ourId: 'jhu',          name: 'Johns Hopkins University' },
    { ourId: 'uc_berkeley',  name: 'University of California-Berkeley' },
    { ourId: 'cmu',          name: 'Carnegie Mellon University' },
    { ourId: 'nyu',          name: 'New York University' },
  ],
};

module.exports = CollegeAPI;
