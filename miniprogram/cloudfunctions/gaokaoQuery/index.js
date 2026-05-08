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
function fetchJSON(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL, port: 443, path,
      method: 'GET', agent: _agent,
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': 'WeChatMiniProgram/gaokaoQuery',
      },
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
function trimSchool(item) {
  const prob = typeof item.probability === 'number'
    ? Math.round(item.probability) / 100
    : null;
  return {
    school_name:         item.school_name,
    major_name:          item.major_name,
    city:                item.city,
    is_985:              item.is_985,
    is_211:              item.is_211,
    probability:         prob,
    avg_min_rank_3yr:    item.avg_min_rank_3yr,
    rank_diff:           item.rank_diff,
    employment:          item.employment ? { avg_salary: item.employment.avg_salary } : null,
    big_small_year:      item.big_small_year
      ? { prediction: buildYearPrediction(item.big_small_year) } : null,
    is_hidden_gem:       item.is_hidden_gem,
    top_gem:             item.top_gem ? {
      gem_type_label:  item.top_gem.gem_type_label,
      gem_description: item.top_gem.gem_description,
    } : null,
    swarm_discovery:     item.swarm_discovery,
    locked:              item.locked              || false,
    reason:              item.reason              || null,
    opportunity_signals: item.opportunity_signals || [],
    is_top_pick:         item.is_top_pick         || false,
    top_pick_headline:   item.top_pick_headline   || null,
    flagship_majors:     item.flagship_majors     || '',
    city_level:          item.city_level          || '',
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

    } else {
      return { success: false, error: `未知 type: ${type}` };
    }

  } catch (err) {
    console.error('[gaokaoQuery] error:', err.message);
    return { success: false, error: err.message };
  }
};
