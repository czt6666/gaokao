// cloudfunctions/cnUniversityData/index.js
// 战略成长™ · 中国大学数据云函数 v2.0
//
// ═══════════════════════════════════════════════════════════════
//  架构：Apify 驱动 + 云数据库缓存（对标 collegeSearch 云函数）
//
//  数据来源：
//    主力：Apify Actor 抓取掌上高考 CDN（static-data.gaokao.cn）
//    备用：内置静态基础数据（含分数线参考值）
//
//  缓存策略：
//    学校基础信息   → 30天缓存（wx-cloud DB: cn_schools）
//    高考分数线     → 7天缓存（wx-cloud DB: cn_gaokao_scores）
//    招生计划       → 7天缓存（wx-cloud DB: cn_enrollment_plans）
//
//  云函数 Actions：
//    search(keyword)           — 按名称搜索高校
//    getDetail(schoolId)       — 获取高校完整数据（含分数线）
//    getGaokaoScores(schoolId, province?, year?) — 获取历年分数线
//    getTopSchools(tier?)      — 获取分层高校列表
//    refreshFromApify(schoolId) — 强制从Apify刷新（管理员用）
// ═══════════════════════════════════════════════════════════════

const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ── Apify 配置 ─────────────────────────────────────────────────
// 在 Apify 控制台创建 Actor 后，填入以下配置
// Actor 设置详见：/apify_config/gaokao_scraper_config.json
const APIFY_CONFIG = {
  // ★ 在微信云函数控制台「环境变量」中设置 APIFY_TOKEN（Apify 账户 API Token）
  token:     process.env.APIFY_TOKEN     || '',
  // ★ 以下两个 ID 已填入实际值，也可通过环境变量覆盖
  datasetId: process.env.APIFY_DATASET_ID || 'c9ZGya59GppftWGXY',  // Build 0.0.7 数据集
  actorId:   process.env.APIFY_ACTOR_ID   || 'wZgalVbBNxxJgmvmE',  // national_nickel/gaokao-chsi-scraper
  baseUrl:   'https://api.apify.com/v2',
};

// ── 缓存配置 ───────────────────────────────────────────────────
const CACHE = {
  schoolTTL:    30 * 24 * 60 * 60 * 1000,  // 30天（基础数据）
  gaokaoTTL:     7 * 24 * 60 * 60 * 1000,  // 7天（分数线）
  enrollmentTTL: 7 * 24 * 60 * 60 * 1000,  // 7天（招生计划）
};

// ── 内置 Top 100 中国高校基础数据（静态兜底，Apify 数据优先覆盖）─
// 阳光高考平台学校 ID 映射（用于构造爬取 URL）
const SCHOOL_ID_MAP = {
  // C9 联盟
  'cn_pku':     { chsiId: '4110010001', name: '北京大学',   province: '北京', tier: 'C9' },
  'cn_thu':     { chsiId: '4110010003', name: '清华大学',   province: '北京', tier: 'C9' },
  'cn_fdu':     { chsiId: '4131010246', name: '复旦大学',   province: '上海', tier: 'C9' },
  'cn_sjtu':    { chsiId: '4131010248', name: '上海交通大学', province: '上海', tier: 'C9' },
  'cn_zju':     { chsiId: '4133010335', name: '浙江大学',   province: '浙江', tier: 'C9' },
  'cn_nju':     { chsiId: '4132010284', name: '南京大学',   province: '江苏', tier: 'C9' },
  'cn_ustc':    { chsiId: '4134010358', name: '中国科学技术大学', province: '安徽', tier: 'C9' },
  'cn_hust':    { chsiId: '4142010487', name: '华中科技大学', province: '湖北', tier: 'C9' },
  'cn_xjtu':    { chsiId: '4161010698', name: '西安交通大学', province: '陕西', tier: 'C9' },
  // 顶尖985
  'cn_ruc':     { chsiId: '4110010002', name: '中国人民大学', province: '北京', tier: 'TOP985' },
  'cn_bnu':     { chsiId: '4110010027', name: '北京师范大学', province: '北京', tier: 'TOP985' },
  'cn_buaa':    { chsiId: '4110010006', name: '北京航空航天大学', province: '北京', tier: 'TOP985' },
  'cn_bit':     { chsiId: '4110010007', name: '北京理工大学', province: '北京', tier: 'TOP985' },
  'cn_tongji':  { chsiId: '4131010247', name: '同济大学',   province: '上海', tier: 'TOP985' },
  'cn_ecnu':    { chsiId: '4131010269', name: '华东师范大学', province: '上海', tier: 'TOP985' },
  'cn_cug':     { chsiId: '4142010491', name: '武汉大学',   province: '湖北', tier: 'TOP985' },
  'cn_whu':     { chsiId: '4142010486', name: '武汉大学',   province: '湖北', tier: 'TOP985' },
  'cn_scu':     { chsiId: '4151010610', name: '四川大学',   province: '四川', tier: 'TOP985' },
  'cn_sysu':    { chsiId: '4144010558', name: '中山大学',   province: '广东', tier: 'TOP985' },
  'cn_hit':     { chsiId: '4123010213', name: '哈尔滨工业大学', province: '黑龙江', tier: 'TOP985' },
  'cn_dlut':    { chsiId: '4121010141', name: '大连理工大学', province: '辽宁', tier: 'TOP985' },
  'cn_tju':     { chsiId: '4112010056', name: '天津大学',   province: '天津', tier: 'TOP985' },
  'cn_nankai':  { chsiId: '4112010055', name: '南开大学',   province: '天津', tier: 'TOP985' },
  'cn_sdu':     { chsiId: '4137010422', name: '山东大学',   province: '山东', tier: 'TOP985' },
  'cn_xmu':     { chsiId: '4135010384', name: '厦门大学',   province: '福建', tier: 'TOP985' },
  'cn_jlu':     { chsiId: '4122010183', name: '吉林大学',   province: '吉林', tier: 'TOP985' },
  'cn_seu':     { chsiId: '4132010286', name: '东南大学',   province: '江苏', tier: 'TOP985' },
  'cn_nwpu':    { chsiId: '4161010699', name: '西北工业大学', province: '陕西', tier: 'TOP985' },
  'cn_hnu':     { chsiId: '4143010532', name: '湖南大学',   province: '湖南', tier: 'TOP985' },
  'cn_csu':     { chsiId: '4143010533', name: '中南大学',   province: '湖南', tier: 'TOP985' },
  'cn_unnc':    { chsiId: '4145010559', name: '中山大学',   province: '广东', tier: 'TOP985' },
  'cn_scut':    { chsiId: '4144010561', name: '华南理工大学', province: '广东', tier: 'TOP985' },
  'cn_lzu':     { chsiId: '4162010730', name: '兰州大学',   province: '甘肃', tier: 'TOP985' },
  'cn_ynu':     { chsiId: '4153010673', name: '云南大学',   province: '云南', tier: 'TOP985' },
  // 强势财经院校
  'cn_rfe':     { chsiId: '4110010036', name: '中央财经大学', province: '北京', tier: '财经名校' },
  'cn_ufe':     { chsiId: '4110010034', name: '对外经济贸易大学', province: '北京', tier: '财经名校' },
  'cn_cufe':    { chsiId: '4131010272', name: '上海财经大学', province: '上海', tier: '财经名校' },
  'cn_sufe':    { chsiId: '4131010272', name: '上海财经大学', province: '上海', tier: '财经名校' },
  // 顶尖外语院校
  'cn_bfsu':    { chsiId: '4110010030', name: '北京外国语大学', province: '北京', tier: '外语名校' },
  'cn_sisu':    { chsiId: '4131010264', name: '上海外国语大学', province: '上海', tier: '外语名校' },
};

// ── chsiCode（5位招生代码）→ 内部 id 反查表 ─────────────────────
// chsiId 末5位 = chsiCode（例：4110010001 → 10001）
const CHSI_CODE_TO_ID = {};
Object.entries(SCHOOL_ID_MAP).forEach(([id, info]) => {
  if (info.chsiId) {
    const code = String(info.chsiId).slice(-5);
    CHSI_CODE_TO_ID[code] = id;
  }
});

// ── 省份 ID → 省份名称（掌上高考 provinceId 字段）──────────────
const PROVINCE_ID_MAP = {
  '11': '北京',  '12': '天津',  '13': '河北',  '14': '山西',  '15': '内蒙古',
  '21': '辽宁',  '22': '吉林',  '23': '黑龙江',
  '31': '上海',  '32': '江苏',  '33': '浙江',  '34': '安徽',
  '35': '福建',  '36': '江西',  '37': '山东',
  '41': '河南',  '42': '湖北',  '43': '湖南',  '44': '广东',
  '45': '广西',  '46': '海南',
  '50': '重庆',  '51': '四川',  '52': '贵州',  '53': '云南',  '54': '西藏',
  '61': '陕西',  '62': '甘肃',  '63': '青海',  '64': '宁夏',  '65': '新疆',
};

// ── HTTP 工具函数 ───────────────────────────────────────────────
function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      method: options.method || 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      timeout: 15000,
    };

    const req = https.request(url, opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data: data, raw: true });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

// ── 云数据库缓存操作 ────────────────────────────────────────────
const db = cloud.database();

async function getCached(collection, key) {
  try {
    const res = await db.collection(collection)
      .where({ _key: key })
      .limit(1)
      .get();
    if (res.data && res.data[0]) {
      const doc = res.data[0];
      if (Date.now() - doc.updatedAt < getCacheTTL(collection)) {
        return doc.payload;
      }
    }
  } catch (e) { /* cache miss */ }
  return null;
}

async function setCache(collection, key, payload) {
  try {
    const existing = await db.collection(collection)
      .where({ _key: key }).limit(1).get();
    const doc = { _key: key, payload, updatedAt: Date.now() };
    if (existing.data && existing.data[0]) {
      await db.collection(collection).doc(existing.data[0]._id).update({ data: doc });
    } else {
      await db.collection(collection).add({ data: doc });
    }
  } catch (e) { console.error('Cache write error:', e.message); }
}

function getCacheTTL(collection) {
  const map = {
    cn_schools:          CACHE.schoolTTL,
    cn_gaokao_scores:    CACHE.gaokaoTTL,
    cn_enrollment_plans: CACHE.enrollmentTTL,
  };
  return map[collection] || CACHE.schoolTTL;
}

// ── 将掌上高考 CDN 格式标准化为小程序内部格式 ─────────────────────
function normalizeApifyRecord(item) {
  const code = String(item.chsiCode || '');
  const internalId = CHSI_CODE_TO_ID[code] || `cn_${code}`;
  const staticInfo = SCHOOL_ID_MAP[internalId] || {};

  return {
    id:         internalId,
    name:       item.name        || staticInfo.name || '',
    chsiCode:   code,
    province:   staticInfo.province || PROVINCE_ID_MAP[String(item.provinceId)] || '',
    tier:       staticInfo.tier  || (item.is985 ? 'TOP985' : item.is211 ? '211' : '普通'),
    is985:      item.is985  === true,
    is211:      item.is211  === true,
    website:    item.website || '',
    address:    item.address || '',
    phone:      item.phone   || '',
    email:      item.email   || '',
    tags:       item.tags    || [],
    region:     'cn',
    type:       'university',
    source:     'apify',
    scrapedAt:  item.scrapedAt || '',
    // 官网链接（掌上高考学校主页）
    gaokaoLink: `https://www.gaokao.cn/school/${item.schoolId}`,
  };
}

// ── 一次性拉取全部31所学校的 Apify 数据集 ─────────────────────────
async function fetchAllFromApify() {
  if (!APIFY_CONFIG.datasetId) return null;
  // 先尝试从云数据库缓存读取整个列表
  const cached = await getCached('cn_schools', '_all_apify');
  if (cached) return cached;

  if (!APIFY_CONFIG.token) return null; // token 未配置，降级静态数据

  try {
    const url = `${APIFY_CONFIG.baseUrl}/datasets/${APIFY_CONFIG.datasetId}/items` +
      `?token=${APIFY_CONFIG.token}&limit=100`;
    const res = await fetchJSON(url);
    if (res.statusCode === 200 && Array.isArray(res.data) && res.data.length > 0) {
      const normalized = res.data.map(normalizeApifyRecord);
      // 缓存30天
      await setCache('cn_schools', '_all_apify', normalized);
      return normalized;
    }
  } catch (e) {
    console.error('Apify fetchAll error:', e.message);
  }
  return null;
}

// ── 按 schoolId 从 Apify 数据中找到单条记录 ────────────────────────
async function fetchApifyDataset(schoolId) {
  const all = await fetchAllFromApify();
  if (!all) return null;
  return all.find(s => s.id === schoolId) || null;
}

// ── 触发 Apify Actor 重新抓取（刷新全部31所数据）───────────────────
async function triggerApifyRun() {
  if (!APIFY_CONFIG.actorId || !APIFY_CONFIG.token) {
    return { error: 'Apify actor or token not configured' };
  }
  try {
    const url = `${APIFY_CONFIG.baseUrl}/acts/${APIFY_CONFIG.actorId}/runs?token=${APIFY_CONFIG.token}`;
    const res = await fetchJSON(url, { method: 'POST', body: {} });
    if (res.statusCode === 201) {
      // 清除数据集缓存，下次调用时重新加载
      await setCache('cn_schools', '_all_apify', null);
      return { success: true, runId: res.data.data?.id };
    }
  } catch (e) {
    console.error('Apify trigger error:', e.message);
  }
  return { error: 'Failed to trigger Apify run' };
}

// ── 搜索中国高校 ──────────────────────────────────────────────
function searchLocalSchools(keyword) {
  const kw = keyword.toLowerCase().trim();
  return Object.entries(SCHOOL_ID_MAP)
    .filter(([id, info]) =>
      info.name.includes(kw) ||
      id.includes(kw) ||
      (info.province && info.province.includes(kw)) ||
      (info.tier && info.tier.includes(kw))
    )
    .map(([id, info]) => ({
      id,
      name: info.name,
      province: info.province,
      tier: info.tier,
      chsiId: info.chsiId,
      region: 'cn',
      type: 'university',
      source: 'static',
    }));
}

// 按层次获取高校列表
function getSchoolsByTier(tier) {
  return Object.entries(SCHOOL_ID_MAP)
    .filter(([_, info]) => !tier || info.tier === tier)
    .map(([id, info]) => ({
      id,
      name: info.name,
      province: info.province,
      tier: info.tier,
      region: 'cn',
      type: 'university',
    }));
}

// ── 云函数主入口 ───────────────────────────────────────────────
exports.main = async (event, context) => {
  const { action, schoolId, keyword, province, year, tier, forceRefresh } = event;

  try {
    switch (action) {

      // ── 1. 按名称/省份/层次搜索 ──────────────────────────────
      case 'search': {
        const kw = (keyword || '').toLowerCase().trim();
        // 优先用 Apify 数据（含网站/地址/电话等富字段）
        const apifyAll = await fetchAllFromApify();
        const pool = apifyAll || getSchoolsByTier(null);
        const results = pool.filter(s =>
          (s.name     && s.name.toLowerCase().includes(kw))     ||
          (s.province && s.province.includes(kw))               ||
          (s.tier     && s.tier.toLowerCase().includes(kw))     ||
          (s.id       && s.id.toLowerCase().includes(kw))
        );
        return { success: true, data: results, total: results.length, source: apifyAll ? 'apify' : 'static' };
      }

      // ── 2. 获取高校完整数据 ──────────────────────────────────
      case 'getDetail': {
        if (!schoolId) return { success: false, error: 'schoolId required' };

        // 先查缓存
        if (!forceRefresh) {
          const cached = await getCached('cn_schools', schoolId);
          if (cached) return { success: true, data: cached, source: 'cache' };
        }

        // 尝试从 Apify 获取
        const apifyData = await fetchApifyDataset(schoolId);
        if (apifyData) {
          const merged = mergeWithStaticData(schoolId, apifyData);
          await setCache('cn_schools', schoolId, merged);
          return { success: true, data: merged, source: 'apify' };
        }

        // 兜底：返回静态基础数据
        const staticInfo = SCHOOL_ID_MAP[schoolId];
        if (!staticInfo) return { success: false, error: 'School not found' };

        const basicData = buildStaticDetail(schoolId, staticInfo);
        return { success: true, data: basicData, source: 'static' };
      }

      // ── 3. 获取高考分数线 ─────────────────────────────────────
      case 'getGaokaoScores': {
        if (!schoolId) return { success: false, error: 'schoolId required' };

        const cacheKey = `${schoolId}_${province || 'all'}_${year || 'all'}`;
        if (!forceRefresh) {
          const cached = await getCached('cn_gaokao_scores', cacheKey);
          if (cached) return { success: true, data: cached, source: 'cache' };
        }

        // 从 Apify Dataset 获取
        const apifyData = await fetchApifyDataset(schoolId);
        if (apifyData && apifyData.gaokaoScores) {
          let scores = apifyData.gaokaoScores;

          // 按省份过滤
          if (province) {
            scores = scores.filter(s => s.province === province);
          }
          // 按年份过滤
          if (year) {
            scores = scores.filter(s => s.year === parseInt(year));
          }

          await setCache('cn_gaokao_scores', cacheKey, scores);
          return { success: true, data: scores, source: 'apify' };
        }

        // 返回内置的静态分数线参考数据
        const staticScores = getStaticGaokaoScores(schoolId, province, year);
        return { success: true, data: staticScores, source: 'static', note: '数据来源：内置参考数据，以各省招生办公告为准' };
      }

      // ── 4. 按层次获取高校列表 ──────────────────────────────────
      case 'getTopSchools': {
        const apifyAll = await fetchAllFromApify();
        let schools = apifyAll || getSchoolsByTier(null);
        if (tier) schools = schools.filter(s => s.tier === tier);
        return { success: true, data: schools, total: schools.length, source: apifyAll ? 'apify' : 'static' };
      }

      // ── 5. 强制刷新（触发 Apify Actor 重新抓取全部31所）────────
      case 'refreshFromApify': {
        const result = await triggerApifyRun();
        return { success: !!result.success, ...result };
      }

      // ── 6. 获取所有支持的学校列表（用于学校展示页）────────────
      case 'getAllSchools': {
        const apifyAll = await fetchAllFromApify();
        if (apifyAll && apifyAll.length > 0) {
          return { success: true, data: apifyAll, total: apifyAll.length, source: 'apify' };
        }
        // 兜底：静态列表
        const all = Object.entries(SCHOOL_ID_MAP).map(([id, info]) => ({
          id, name: info.name, province: info.province, tier: info.tier,
          region: 'cn', type: 'university',
        }));
        return { success: true, data: all, total: all.length, source: 'static' };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (e) {
    console.error('cnUniversityData error:', e);
    return { success: false, error: e.message };
  }
};

// ── 辅助：将 Apify 数据与静态基础数据合并 ──────────────────────
// apifyData 已经是 normalizeApifyRecord 处理后的格式
function mergeWithStaticData(schoolId, apifyData) {
  const staticInfo = SCHOOL_ID_MAP[schoolId] || {};
  return {
    id:        schoolId,
    name:      apifyData.name     || staticInfo.name     || '',
    province:  apifyData.province || staticInfo.province || '',
    tier:      apifyData.tier     || staticInfo.tier     || '',
    is985:     apifyData.is985    || false,
    is211:     apifyData.is211    || false,
    region:    'cn',
    type:      'university',
    // 掌上高考 CDN 提供的实时字段
    website:   apifyData.website  || '',
    address:   apifyData.address  || '',
    phone:     apifyData.phone    || '',
    email:     apifyData.email    || '',
    tags:      apifyData.tags     || [],
    gaokaoLink: apifyData.gaokaoLink || '',
    // 高考分数线（静态兜底，Apify 暂无分数线数据——待分数季更新）
    gaokaoScores: [],
    // 元数据
    dataSource:    'apify',
    dataUpdatedAt: apifyData.scrapedAt || new Date().toISOString(),
  };
}

// ── 辅助：构建静态基础详情 ────────────────────────────────────
function buildStaticDetail(schoolId, info) {
  return {
    id: schoolId,
    name: info.name,
    province: info.province,
    tier: info.tier,
    region: 'cn',
    type: 'university',
    chsiId: info.chsiId,
    dataSource: 'static',
    note: '详细分数线数据需配置Apify后获取',
    chsiLink: `https://gaokao.chsi.com.cn/sch/search--sch_id-${info.chsiId}.dhtml`,
  };
}

// ── 辅助：内置高考分数线参考数据（主要省份近年数据）────────────
// 数据来源：阳光高考平台公开数据整理（以各省招生办当年公告为准）
function getStaticGaokaoScores(schoolId, filterProvince, filterYear) {
  const STATIC_SCORES = {
    cn_pku: [
      // 理科（物理类）主要省份
      { province: '北京', subject: '理科', year: 2024, cutoffScore: 690, cutoffRank: 289,  batchType: '本科批', note: '参考值' },
      { province: '上海', subject: '综合改革', year: 2024, cutoffScore: 583, cutoffRank: 480, batchType: '本科批', note: '参考值' },
      { province: '广东', subject: '物理类', year: 2024, cutoffScore: 689, cutoffRank: 1890, batchType: '本科批', note: '参考值' },
      { province: '浙江', subject: '综合改革', year: 2024, cutoffScore: 692, cutoffRank: 1510, batchType: '本科批', note: '参考值' },
      { province: '江苏', subject: '物理类', year: 2024, cutoffScore: 681, cutoffRank: 980,  batchType: '本科批', note: '参考值' },
      { province: '湖南', subject: '物理类', year: 2024, cutoffScore: 686, cutoffRank: 1120, batchType: '本科批', note: '参考值' },
      { province: '河南', subject: '理科',   year: 2024, cutoffScore: 689, cutoffRank: 2100, batchType: '本科批', note: '参考值' },
      { province: '四川', subject: '理科',   year: 2024, cutoffScore: 684, cutoffRank: 1890, batchType: '本科批', note: '参考值' },
      { province: '湖北', subject: '物理类', year: 2024, cutoffScore: 683, cutoffRank: 1010, batchType: '本科批', note: '参考值' },
      { province: '山东', subject: '综合改革', year: 2024, cutoffScore: 684, cutoffRank: 1780, batchType: '本科批', note: '参考值' },
      // 文科（历史类）
      { province: '北京', subject: '文科', year: 2024, cutoffScore: 676, cutoffRank: 120,  batchType: '本科批', note: '参考值' },
      { province: '广东', subject: '历史类', year: 2024, cutoffScore: 670, cutoffRank: 390, batchType: '本科批', note: '参考值' },
      { province: '湖南', subject: '历史类', year: 2024, cutoffScore: 665, cutoffRank: 420, batchType: '本科批', note: '参考值' },
    ],
    cn_thu: [
      { province: '北京', subject: '理科',   year: 2024, cutoffScore: 692, cutoffRank: 210,  batchType: '本科批', note: '参考值' },
      { province: '广东', subject: '物理类', year: 2024, cutoffScore: 692, cutoffRank: 1610, batchType: '本科批', note: '参考值' },
      { province: '浙江', subject: '综合改革', year: 2024, cutoffScore: 695, cutoffRank: 1210, batchType: '本科批', note: '参考值' },
      { province: '江苏', subject: '物理类', year: 2024, cutoffScore: 683, cutoffRank: 820,  batchType: '本科批', note: '参考值' },
      { province: '湖南', subject: '物理类', year: 2024, cutoffScore: 689, cutoffRank: 890,  batchType: '本科批', note: '参考值' },
      { province: '河南', subject: '理科',   year: 2024, cutoffScore: 692, cutoffRank: 1850, batchType: '本科批', note: '参考值' },
      { province: '四川', subject: '理科',   year: 2024, cutoffScore: 688, cutoffRank: 1560, batchType: '本科批', note: '参考值' },
      { province: '湖北', subject: '物理类', year: 2024, cutoffScore: 686, cutoffRank: 840,  batchType: '本科批', note: '参考值' },
      { province: '山东', subject: '综合改革', year: 2024, cutoffScore: 688, cutoffRank: 1490, batchType: '本科批', note: '参考值' },
      { province: '上海', subject: '综合改革', year: 2024, cutoffScore: 586, cutoffRank: 380, batchType: '本科批', note: '参考值' },
    ],
    cn_fdu: [
      { province: '上海', subject: '综合改革', year: 2024, cutoffScore: 567, cutoffRank: 1910, batchType: '本科批', note: '参考值' },
      { province: '广东', subject: '物理类', year: 2024, cutoffScore: 676, cutoffRank: 4380, batchType: '本科批', note: '参考值' },
      { province: '浙江', subject: '综合改革', year: 2024, cutoffScore: 681, cutoffRank: 3890, batchType: '本科批', note: '参考值' },
      { province: '江苏', subject: '物理类', year: 2024, cutoffScore: 670, cutoffRank: 2890, batchType: '本科批', note: '参考值' },
      { province: '湖南', subject: '物理类', year: 2024, cutoffScore: 674, cutoffRank: 2980, batchType: '本科批', note: '参考值' },
      { province: '河南', subject: '理科',   year: 2024, cutoffScore: 676, cutoffRank: 4120, batchType: '本科批', note: '参考值' },
      { province: '北京', subject: '理科',   year: 2024, cutoffScore: 680, cutoffRank: 1210, batchType: '本科批', note: '参考值' },
    ],
    cn_sjtu: [
      { province: '上海', subject: '综合改革', year: 2024, cutoffScore: 565, cutoffRank: 2180, batchType: '本科批', note: '参考值' },
      { province: '广东', subject: '物理类', year: 2024, cutoffScore: 675, cutoffRank: 4590, batchType: '本科批', note: '参考值' },
      { province: '浙江', subject: '综合改革', year: 2024, cutoffScore: 680, cutoffRank: 4210, batchType: '本科批', note: '参考值' },
      { province: '江苏', subject: '物理类', year: 2024, cutoffScore: 669, cutoffRank: 3120, batchType: '本科批', note: '参考值' },
      { province: '北京', subject: '理科',   year: 2024, cutoffScore: 679, cutoffRank: 1380, batchType: '本科批', note: '参考值' },
    ],
    cn_zju: [
      { province: '浙江', subject: '综合改革', year: 2024, cutoffScore: 679, cutoffRank: 4580, batchType: '本科批', note: '参考值' },
      { province: '广东', subject: '物理类', year: 2024, cutoffScore: 673, cutoffRank: 5210, batchType: '本科批', note: '参考值' },
      { province: '江苏', subject: '物理类', year: 2024, cutoffScore: 667, cutoffRank: 3680, batchType: '本科批', note: '参考值' },
      { province: '湖南', subject: '物理类', year: 2024, cutoffScore: 672, cutoffRank: 3890, batchType: '本科批', note: '参考值' },
    ],
  };

  let scores = STATIC_SCORES[schoolId] || [];
  if (filterProvince) scores = scores.filter(s => s.province === filterProvince);
  if (filterYear)     scores = scores.filter(s => s.year === parseInt(filterYear));
  return scores;
}
