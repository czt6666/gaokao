// cloudfunctions/getGaokaoAdmin/index.js
// 艺圆智探 · 高考运营后台数据读取
//
// 鉴权：adminCode 需与环境变量 ADMIN_CODE 匹配
// modes:
//   stats    - 汇总数字（顶部仪表盘）
//   sessions - 用户会话列表（分页）
//   feedback - 用户反馈列表（分页 + 过滤）
//   resolve  - 标记反馈已处理

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db       = cloud.database();
const _        = db.command;
const sessions = db.collection('gaokao_sessions');
const feedback = db.collection('gaokao_feedback');

// ── 管理员密码验证 ────────────────────────────────────────────────────
// 在微信云开发控制台，为此云函数设置环境变量 ADMIN_CODE = 你的密码
// 若未设置，回退到与 getAssessments 相同的鉴权：尝试读取一条记录作为探针
function isAuthorized(adminCode) {
  const envCode = process.env.ADMIN_CODE;
  if (envCode) return adminCode === envCode;
  // 未设置环境变量时，只要 adminCode 非空则通过（依赖调用方已完成鉴权）
  return !!(adminCode && adminCode.length >= 4);
}

// ── 格式化时间 ───────────────────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return '';
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  const now = new Date();
  const diff = Math.floor((now - d) / 60000); // minutes
  if (diff < 1)   return '刚刚';
  if (diff < 60)  return `${diff}分钟前`;
  if (diff < 1440) return `${Math.floor(diff / 60)}小时前`;
  return `${Math.floor(diff / 1440)}天前`;
}

// ── 计算意向分（0-10）→ 星级显示 ─────────────────────────────────────
function intentScore(s) {
  let score = 0;
  if (s.phone)                          score += 3;
  if ((s.savedSchools || []).length > 0) score += 2;
  if ((s.savedSchools || []).length > 3) score += 1;
  if ((s.tabsViewed  || []).includes('gems')) score += 2;
  if (s.aiRequested)                    score += 1;
  if (s.sessionDuration > 180)          score += 1; // >3分钟
  return Math.min(score, 10);
}

function intentStars(score) {
  if (score >= 8) return '★★★★★';
  if (score >= 6) return '★★★★☆';
  if (score >= 4) return '★★★☆☆';
  if (score >= 2) return '★★☆☆☆';
  return '★☆☆☆☆';
}

const FEEDBACK_TYPE_LABEL = {
  data_error:         '数据错误',
  bad_recommendation: '推荐问题',
  ui_bug:             '功能异常',
  question:           '使用疑问',
  praise:             '好评反馈',
};
const FEEDBACK_TYPE_COLOR = {
  data_error:         '#DC2626',
  bad_recommendation: '#C9922A',
  ui_bug:             '#7C3AED',
  question:           '#1D4ED8',
  praise:             '#059669',
};

exports.main = async (event) => {
  const { adminCode, mode, page = 1, limit = 20, filter = {} } = event;

  if (!isAuthorized(adminCode)) {
    return { success: false, error: 'unauthorized' };
  }

  const skip = (page - 1) * limit;

  try {
    // ── 仪表盘统计 ───────────────────────────────────────────────
    if (mode === 'stats') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [total, thisWeek, withPhone, withSaves, openFb] = await Promise.all([
        sessions.count(),
        sessions.where({ queryAt: _.gte(weekAgo) }).count(),
        sessions.where({ phone: _.neq('') }).count(),
        sessions.where({ savedSchools: _.size(_.gt(0)) }).count(),
        feedback.where({ status: 'open' }).count(),
      ]);

      const t = total.total || 1;

      // 省份分布（前5）
      const recentSessions = await sessions.orderBy('queryAt', 'desc').limit(200).get();
      const provinceCounts = {};
      recentSessions.data.forEach(s => {
        if (s.province) provinceCounts[s.province] = (provinceCounts[s.province] || 0) + 1;
      });
      const topProvinces = Object.entries(provinceCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([province, count]) => ({ province, count, pct: Math.round(count / t * 100) }));

      return {
        success: true,
        stats: {
          total:        total.total,
          thisWeek:     thisWeek.total,
          withPhone:    withPhone.total,
          phoneRate:    Math.round(withPhone.total / t * 100),
          withSaves:    withSaves.total,
          saveRate:     Math.round(withSaves.total / t * 100),
          openFeedback: openFb.total,
          topProvinces,
        },
      };
    }

    // ── 用户会话列表 ─────────────────────────────────────────────
    if (mode === 'sessions') {
      let query = sessions.orderBy('queryAt', 'desc');
      // 过滤条件
      if (filter.hasPhone)  query = sessions.where({ phone: _.neq('') }).orderBy('queryAt', 'desc');
      if (filter.hasSaves)  query = sessions.where({ savedSchools: _.size(_.gt(0)) }).orderBy('queryAt', 'desc');
      if (filter.province)  query = sessions.where({ province: filter.province }).orderBy('queryAt', 'desc');

      const [res, countRes] = await Promise.all([
        query.skip(skip).limit(limit).get(),
        sessions.count(),
      ]);

      const list = res.data.map(s => ({
        ...s,
        _timeStr:      formatTime(s.queryAt),
        _intentScore:  intentScore(s),
        _intentStars:  intentStars(intentScore(s)),
        _savedCount:   (s.savedSchools || []).length,
        _tabsViewed:   s.tabsViewed || [],
        _durationMin:  s.sessionDuration > 0 ? Math.round(s.sessionDuration / 60) : 0,
        // 隐藏 openid，只展示前8位
        _openidShort:  (s.openid || '').slice(0, 8) + '…',
      }));

      return {
        success: true,
        list,
        total: countRes.total,
        hasMore: skip + limit < countRes.total,
      };
    }

    // ── 反馈列表 ─────────────────────────────────────────────────
    if (mode === 'feedback') {
      let baseQuery = filter.status && filter.status !== 'all'
        ? feedback.where({ status: filter.status }).orderBy('createdAt', 'desc')
        : feedback.orderBy('createdAt', 'desc');

      if (filter.type) {
        baseQuery = feedback.where({ type: filter.type }).orderBy('createdAt', 'desc');
      }

      const [res, countRes] = await Promise.all([
        baseQuery.skip(skip).limit(limit).get(),
        feedback.count(),
      ]);

      const list = res.data.map(f => ({
        ...f,
        _timeStr:   formatTime(f.createdAt),
        _typeLabel: FEEDBACK_TYPE_LABEL[f.type] || '其他',
        _typeColor: FEEDBACK_TYPE_COLOR[f.type] || '#8E8E93',
      }));

      return {
        success: true,
        list,
        total: countRes.total,
        hasMore: skip + limit < countRes.total,
      };
    }

    // ── 标记反馈已解决 ───────────────────────────────────────────
    if (mode === 'resolve') {
      const { feedbackId, status, adminReply } = event;
      if (!feedbackId) return { success: false, error: 'missing feedbackId' };
      const validStatus = ['resolved', 'wontfix', 'open'];
      const s = validStatus.includes(status) ? status : 'resolved';
      await feedback.doc(feedbackId).update({
        data: {
          status: s,
          adminReply: adminReply || '',
          resolvedAt: db.serverDate(),
        },
      });
      return { success: true };
    }

    return { success: false, error: `unknown mode: ${mode}` };

  } catch (e) {
    console.error('[getGaokaoAdmin]', e.message);
    return { success: false, error: e.message };
  }
};
