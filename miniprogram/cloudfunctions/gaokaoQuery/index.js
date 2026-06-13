// cloudfunctions/gaokaoQuery/index.js
// 艺圆智探 · 水卢冷门高报引擎 云函数代理
// v3 — PDF云代理、报告幂等存储、推荐裂变系统

const cloud  = require('wx-server-sdk');
const https  = require('https');
const zlib   = require('zlib');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const BASE_URL = 'www.theyuanxi.cn';

// ── 全局复用 HTTPS Agent ─────────────────────────────────────────
const _agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  maxSockets: 4,
});

// ── HTTP GET → JSON ──────────────────────────────────────────────
function fetchJSON(path, authToken) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': 'WeChatMiniProgram/gaokaoQuery',
    };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const options = {
      hostname: BASE_URL, port: 443, path,
      method: 'GET', agent: _agent,
      headers,
    };
    const req = https.request(options, (res) => {
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (enc === 'gzip')    stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => {
        try {
          const txt    = Buffer.concat(chunks).toString('utf8');
          const parsed = JSON.parse(txt);
          if (res.statusCode !== 200) {
            return reject(new Error(`API ${res.statusCode}: ${(parsed && (parsed.message || parsed.error)) || 'error'}`));
          }
          resolve(parsed);
        } catch (e) { reject(new Error('JSON parse: ' + Buffer.concat(chunks).toString('utf8').slice(0, 200))); }
      });
      stream.on('error', reject);
    });
    req.on('error', err => { console.error('[fetchJSON] err:', err.message); reject(err); });
    req.setTimeout(25000, () => req.destroy(new Error('fetchJSON timeout 25s')));
    req.end();
  });
}

// ── HTTP POST → JSON ─────────────────────────────────────────────
function fetchPostJSON(path, authToken) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': 'WeChatMiniProgram/gaokaoQuery',
    };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const options = {
      hostname: BASE_URL, port: 443, path,
      method: 'POST', agent: _agent,
      headers,
    };
    const req = https.request(options, (res) => {
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => {
        try {
          const txt = Buffer.concat(chunks).toString('utf8');
          const parsed = JSON.parse(txt);
          if (res.statusCode !== 200) {
            return reject(new Error(`API ${res.statusCode}: ${(parsed && (parsed.message || parsed.error)) || 'error'}`));
          }
          resolve(parsed);
        } catch (e) { reject(new Error('JSON parse: ' + Buffer.concat(chunks).toString('utf8').slice(0, 200))); }
      });
      stream.on('error', reject);
    });
    req.on('error', err => { console.error('[fetchPostJSON] err:', err.message); reject(err); });
    req.setTimeout(25000, () => req.destroy(new Error('fetchPostJSON timeout 25s')));
    req.end();
  });
}

// ── HTTP GET → Binary Buffer（单次请求，55s 超时）──────────────────
// Part1(69所) 首次 PDF 渲染约 47s，加算法约 50s。
// 缓存命中后 <4s。留 5s 给云存储上传。
function fetchBinary(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL, port: 443, path,
      method: 'GET', agent: _agent,
      headers: {
        'Accept': 'application/pdf,*/*',
        'User-Agent': 'WeChatMiniProgram/gaokaoQuery',
      },
    };
    const req = https.request(options, (res) => {
      if (res.statusCode === 403) {
        res.resume();
        return reject(new Error('PDF_403'));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('PDF_HTTP_' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', err => reject(err));
    req.setTimeout(55000, () => req.destroy(new Error('fetchBinary timeout')));
    req.end();
  });
}

// ── 大年小年预测 ─────────────────────────────────────────────────
function buildYearPrediction(bsy) {
  if (!bsy) return '';
  if (bsy.is_big_year)   return '今年可能大年，竞争加剧';
  if (bsy.is_small_year) return '今年可能小年，竞争减弱';
  return '';
}

// ── 把约束参数拼接到 URL ─────────────────────────────────────────
function appendConstraints(path, event) {
  const keys = ['c_major', 'c_city', 'c_nature', 'c_tier'];
  for (const k of keys) {
    if (event[k]) path += `&${k}=${encodeURIComponent(event[k])}`;
  }
  return path;
}

// ── 精简学校字段 ─────────────────────────────────────────────────
// 字段必须与小程序前端 WXML / enrichList 引用对齐，缺一个就少显示一块。
// 估算的总载荷约 ~150KB（4 类 × 50 所），在 cloudFunction 1MB 限制内。
function trimSchool(item) {
  const prob = typeof item.probability === 'number'
    ? Math.round(item.probability) / 100
    : null;
  const emp = item.employment || null;
  const bsy = item.big_small_year || null;
  return {
    // ── 基础信息 ──────────────────────────────────────────────
    school_name:         item.school_name,
    major_name:          item.major_name,
    city:                item.city,
    tier:                item.tier              || '',     // 985 / 211 / 双一流 / 普通
    is_985:              item.is_985,
    is_211:              item.is_211,
    city_level:          item.city_level        || '',
    rank_2025:           item.rank_2025         || 0,      // 软科排名
    flagship_majors:     item.flagship_majors   || '',

    // ── 概率与置信度 ──────────────────────────────────────────
    probability:         prob,
    prob_low:            item.prob_low,
    prob_high:           item.prob_high,
    confidence:          item.confidence         || '',

    // ── 录取分数与位次（关键：last_year_min_score 用于分数差/估算用户分） ──
    last_year_min_score: item.last_year_min_score || 0,
    last_year_min_rank:  item.last_year_min_rank  || 0,
    avg_min_rank_3yr:    item.avg_min_rank_3yr   || 0,
    rank_diff:           item.rank_diff,
    recent_data:         Array.isArray(item.recent_data)
      ? item.recent_data.map(function(r) {
          return { year: r.year, min_rank: r.min_rank, min_score: r.min_score };
        })
      : [],

    // ── 大小年 / 波动 / 建议 ──────────────────────────────────
    big_small_year:      bsy ? {
      prediction: buildYearPrediction(bsy),
      status:     bsy.status     || '',
      heat_trend: bsy.heat_trend || '',
      reason:     bsy.reason     || '',
    } : null,
    volatility_warning:  item.volatility_warning || '',
    suggested_action:    item.suggested_action   || '',

    // ── 标签 / 推荐高亮 ───────────────────────────────────────
    is_hidden_gem:       item.is_hidden_gem,
    top_gem:             item.top_gem ? {
      gem_type:        item.top_gem.gem_type        || '',
      gem_type_label:  item.top_gem.gem_type_label  || '',
      gem_description: item.top_gem.gem_description || '',
    } : null,
    swarm_discovery:     item.swarm_discovery,
    is_top_pick:         item.is_top_pick       || false,
    top_pick_rank:       item.top_pick_rank     || 0,      // 1 = 本档首选；2-3 = 智能精选
    top_pick_headline:   item.top_pick_headline || null,
    feature_tags:        Array.isArray(item.feature_tags) ? item.feature_tags : [],

    // ── 就业（用于卡片底部三栏） ──────────────────────────────
    employment: emp ? {
      avg_salary:              emp.avg_salary              || 0,
      school_employment_rate:  emp.school_employment_rate  || 0,
      school_postgrad_rate:    emp.school_postgrad_rate    || 0,
    } : null,

    // ── 控制字段 ──────────────────────────────────────────────
    locked:              item.locked              || false,
    reason:              item.reason              || null,
    opportunity_signals: item.opportunity_signals || [],
    quality_score:       item.quality_score       || 0,
  };
}

// ── 主处理函数 ───────────────────────────────────────────────────
exports.main = async (event, context) => {
  const { type, rank, mockScore, province, subject, order_no } = event;
  const openid = (context && context.OPENID) || '';

  console.log('[gaokaoQuery] type=%s', type);

  if (type === 'ping') {
    return { success: true, ping: 'pong', timestamp: Date.now() };
  }

  try {

    // ── simulate ───────────────────────────────────────────────
    if (type === 'simulate') {
      if (!mockScore || !province) return { success: false, error: '缺少 mockScore/province' };
      const path = `/api/simulate?mock_score=${encodeURIComponent(String(mockScore))}&province=${encodeURIComponent(province)}&subject=${encodeURIComponent(subject || '')}`;
      const data = await fetchJSON(path);
      return { success: true, data };

    // ── recommend ──────────────────────────────────────────────
    } else if (type === 'recommend') {
      if (!rank || !province) return { success: false, error: '缺少 rank/province' };
      const orderParam = order_no ? `&order_no=${encodeURIComponent(order_no)}` : '';
      let path = `/api/recommend?rank=${encodeURIComponent(String(rank))}&province=${encodeURIComponent(province)}&subject=${encodeURIComponent(subject || '')}${orderParam}`;
      if (event.score) path += `&score=${encodeURIComponent(String(event.score))}`;
      path = appendConstraints(path, event);
      const raw  = await fetchJSON(path);
      const trimList = (arr) => (arr || []).map(trimSchool);
      return {
        success: true,
        data: {
          surge:         trimList(raw.surge),
          stable:        trimList(raw.stable),
          safe:          trimList(raw.safe),
          hidden_gems:   trimList(raw.hidden_gems),
          total_matched: raw.total_matched || 0,
          is_paid:       raw.is_paid || false,
          is_trial:      raw.is_trial || false,
          trial_limit:   raw.trial_limit || null,
        },
      };

    // ── fetchPDF：服务端代理 → 上传云存储 → 返回 fileID ───────────
    } else if (type === 'fetchPDF') {
      const { province: prov, rank: r, subject: sub, order_no: ono } = event;
      if (!ono) return { success: false, error: '缺少 order_no' };

      let path = `/api/report/generate`
        + `?province=${encodeURIComponent(prov || '')}`
        + `&rank=${encodeURIComponent(String(r || 0))}`
        + `&subject=${encodeURIComponent(sub || '')}`
        + `&order_no=${encodeURIComponent(ono)}`;
      path = appendConstraints(path, event);

      console.log('[fetchPDF] start, order_no=%s', ono.slice(0, 8) + '…');

      let pdfBuffer;
      try {
        pdfBuffer = await fetchBinary(path);
      } catch (e) {
        if (e.message === 'PDF_403') {
          return { success: false, error: '支付核验中，请稍等片刻再试' };
        }
        return { success: false, error: 'PDF下载失败：' + e.message };
      }

      const cloudPath = `pdf_reports/${openid || 'anon'}/${ono}.pdf`;
      const uploadResult = await cloud.uploadFile({
        cloudPath,
        fileContent: pdfBuffer,
      });

      console.log('[fetchPDF] uploaded fileID=%s', uploadResult.fileID);
      return { success: true, fileID: uploadResult.fileID };

    // ── saveReport（幂等：orderNo 已存则跳过）──────────────────
    } else if (type === 'saveReport') {
      const db         = cloud.database();
      const reportData = event.reportData || {};
      const orderNo    = reportData.orderNo || '';

      try {
        // 幂等检查（内层独立 try-catch：集合不存在时跳过检查，继续 add）
        if (orderNo) {
          try {
            const existing = await db.collection('gaokao_reports')
              .where({ orderNo })
              .limit(1)
              .get();
            if (existing.data && existing.data.length > 0) {
              console.log('[saveReport] skip dup orderNo=%s', orderNo);
              return { success: true, skipped: true };
            }
          } catch (queryErr) {
            // 集合首次不存在时查询会报错，忽略该错误，继续执行 add()
            console.log('[saveReport] idempotency query skipped:', queryErr.message);
          }
        }
        await db.collection('gaokao_reports').add({
          data: {
            _openid:      openid,
            orderNo,
            rank:         reportData.rank         || 0,
            province:     reportData.province     || '',
            subject:      reportData.subject      || '',
            queryMode:    reportData.queryMode    || 'rank',
            totalMatched: reportData.totalMatched || 0,
            surgeCount:   reportData.surgeCount   || 0,
            stableCount:  reportData.stableCount  || 0,
            safeCount:    reportData.safeCount     || 0,
            gemsCount:    reportData.gemsCount     || 0,
            createdAt:    db.serverDate(),
          },
        });
        console.log('[saveReport] saved openid=%s orderNo=%s', openid, orderNo);
        return { success: true };
      } catch (e) {
        console.error('[saveReport] fail:', e.message);
        return { success: false, error: e.message };
      }

    // ── getReports ─────────────────────────────────────────────
    } else if (type === 'getReports') {
      const db = cloud.database();
      try {
        const res = await db.collection('gaokao_reports')
          .where({ _openid: openid })
          .orderBy('createdAt', 'desc')
          .limit(30)
          .get();
        return { success: true, data: res.data || [] };
      } catch (e) {
        console.error('[getReports] fail:', e.message);
        return { success: false, error: e.message, data: [] };
      }

    // ── createReferral：生成裂变分享 token ─────────────────────
    } else if (type === 'createReferral') {
      if (!openid) return { success: false, error: '未登录' };
      const db = cloud.database();
      try {
        // 复用已有的 pending token（内层 try-catch：集合不存在时跳过，继续 add）
        try {
          const existing = await db.collection('gaokao_referrals')
            .where({ _openid: openid, status: 'pending' })
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
          if (existing.data && existing.data.length > 0) {
            return { success: true, token: existing.data[0].token };
          }
        } catch (queryErr) {
          console.log('[createReferral] idempotency query skipped:', queryErr.message);
        }
        const token = crypto.randomBytes(6).toString('hex');
        await db.collection('gaokao_referrals').add({
          data: {
            _openid:        openid,
            token,
            status:         'pending',
            referee_openid: '',
            reward_used:    false,
            createdAt:      db.serverDate(),
          },
        });
        console.log('[createReferral] token=%s openid=%s', token, openid.slice(0, 8));
        return { success: true, token };
      } catch (e) {
        console.error('[createReferral] fail:', e.message);
        return { success: false, error: e.message };
      }

    // ── redeemReferral：新用户首次付费后调用，激活分享者奖励 ────
    } else if (type === 'redeemReferral') {
      const { referral_token } = event;
      if (!referral_token || !openid) return { success: false, error: '缺少参数' };
      const db = cloud.database();
      try {
        const res = await db.collection('gaokao_referrals')
          .where({ token: referral_token, status: 'pending' })
          .limit(1)
          .get();
        if (!res.data || res.data.length === 0) {
          return { success: false, error: '链接已失效' };
        }
        const record = res.data[0];
        if (record._openid === openid) {
          return { success: false, error: '不能兑换自己的分享' };
        }
        await db.collection('gaokao_referrals').doc(record._id).update({
          data: {
            status:          'completed',
            referee_openid:  openid,
            completedAt:     db.serverDate(),
          },
        });
        console.log('[redeemReferral] token=%s referee=%s referrer=%s', referral_token, openid.slice(0, 8), record._openid.slice(0, 8));
        return { success: true };
      } catch (e) {
        console.error('[redeemReferral] fail:', e.message);
        return { success: false, error: e.message };
      }

    // ── checkReferralCredit：查询当前用户是否有可用免费次数 ─────
    } else if (type === 'checkReferralCredit') {
      if (!openid) return { success: true, hasCredit: false };
      const db = cloud.database();
      try {
        const res = await db.collection('gaokao_referrals')
          .where({ _openid: openid, status: 'completed', reward_used: false })
          .limit(1)
          .get();
        const hasCredit = !!(res.data && res.data.length > 0);
        const creditId  = hasCredit ? res.data[0]._id : null;
        return { success: true, hasCredit, creditId };
      } catch (e) {
        return { success: true, hasCredit: false };
      }

    // ── consumeReferralCredit：使用一次免费次数 ─────────────────
    } else if (type === 'consumeReferralCredit') {
      const { creditId } = event;
      if (!creditId) return { success: false, error: '缺少 creditId' };
      const db = cloud.database();
      try {
        await db.collection('gaokao_referrals').doc(creditId).update({
          data: { reward_used: true, rewardUsedAt: db.serverDate() },
        });
        console.log('[consumeReferralCredit] creditId=%s', creditId);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }

    // ── getUserStatus：查询用户会员状态（订阅类型、到期时间等）────────
    } else if (type === 'getUserStatus') {
      const { auth_token } = event;
      if (!auth_token) return { success: false, error: '缺少 auth_token' };
      try {
        const data = await fetchJSON('/api/auth/me', auth_token);
        return {
          success: true,
          user_id:            data.user_id            || null,
          is_paid:            data.is_paid            || false,
          subscription_type:  data.subscription_type  || '',
          subscription_label: data.subscription_label || '',
          subscription_end_at: data.subscription_end_at || null,
          days_remaining:     data.days_remaining,
          referral_code:      data.referral_code      || '',
          referral_count:     data.referral_count     || 0,
          referral_reward_days: data.referral_reward_days || 0,
        };
      } catch (e) {
        if (e.message && e.message.includes('401')) {
          return { success: false, error: '登录已过期', code: 401 };
        }
        return { success: false, error: e.message };
      }

    // ── getCommission：查询佣金余额与明细 ───────────────────────────
    } else if (type === 'getCommission') {
      const { auth_token } = event;
      if (!auth_token) return { success: false, error: '缺少 auth_token' };
      try {
        const data = await fetchJSON('/api/commission/me', auth_token);
        return { success: true, ...data };
      } catch (e) {
        return { success: false, error: e.message };
      }

    // ── withdrawCommission：申请提现 ────────────────────────────────
    } else if (type === 'withdrawCommission') {
      const { auth_token, amount_fen } = event;
      if (!auth_token) return { success: false, error: '缺少 auth_token' };
      try {
        const data = await fetchPostJSON(`/api/commission/withdraw?amount_fen=${amount_fen || 0}`, auth_token);
        return { success: true, ...data };
      } catch (e) {
        return { success: false, error: e.message };
      }

    } else {
      return { success: false, error: `未知 type: ${type}` };
    }

  } catch (err) {
    console.error('[gaokaoQuery] error:', err.message);
    return { success: false, error: err.message };
  }
};
