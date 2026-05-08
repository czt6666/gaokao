// cloudfunctions/getAssessments/index.js
// 袁希™ · 管理员评估数据读取
// ═══════════════════════════════════════════════════════════════
//  仅授权管理员可访问
//  支持：列表、详情、更新已读状态、统计数据
// ═══════════════════════════════════════════════════════════════

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// ── 管理员密码（建议在云端环境变量配置，此为默认值）──────────
// 在微信开发者工具 → 云开发 → 云函数 → 环境变量中设置 ADMIN_CODE
const ADMIN_CODE = process.env.ADMIN_CODE || 'wangzi@YX2024';

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  // ── 验证管理员密码 ────────────────────────────────────────────
  if (event.adminCode !== ADMIN_CODE) {
    return { success: false, error: 'unauthorized', message: '访问密码错误' };
  }

  try {

    // ── mode: 'stats' — 仪表盘统计数据 ──────────────────────────
    if (event.mode === 'stats') {
      const total = await db.collection('assessments').count();

      // 本周新增
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const thisWeek = await db.collection('assessments')
        .where({ createdAt: _.gt(weekAgo) }).count();

      // 高适配度（overallScore >= 68）
      const highFit = await db.collection('assessments')
        .where({ overallScore: _.gte(68) }).count();

      // CTA点击
      const ctaTapped = await db.collection('assessments')
        .where({ 'behavior.ctaTapped': true }).count();

      // 填了家长问卷
      const hasParent = await db.collection('assessments')
        .where({ hasParentAnswers: true }).count();

      // 未读
      const unread = await db.collection('assessments')
        .where({ isRead: false }).count();

      // 各路径分布
      const pathCounts = {};
      const paths = ['abroad_high', 'abroad_uni', 'hybrid', 'gaokao'];
      for (const p of paths) {
        const r = await db.collection('assessments').where({ primaryPath: p }).count();
        pathCounts[p] = r.total;
      }

      // 各学段分布
      const stageCounts = {};
      const stages = ['primary', 'middle', 'high'];
      for (const s of stages) {
        const r = await db.collection('assessments').where({ schoolStage: s }).count();
        stageCounts[s] = r.total;
      }

      return {
        success: true,
        stats: {
          total: total.total,
          thisWeek: thisWeek.total,
          highFit: highFit.total,
          ctaTapped: ctaTapped.total,
          ctaRate: total.total > 0 ? Math.round(ctaTapped.total / total.total * 100) : 0,
          hasParent: hasParent.total,
          parentRate: total.total > 0 ? Math.round(hasParent.total / total.total * 100) : 0,
          unread: unread.total,
          pathCounts,
          stageCounts,
        },
      };
    }

    // ── mode: 'list' — 评估列表（分页 + 过滤）────────────────────
    if (event.mode === 'list' || !event.mode) {
      const page  = event.page  || 1;
      const limit = event.limit || 20;
      const skip  = (page - 1) * limit;

      // 构建过滤条件
      let where = {};
      if (event.filter?.schoolStage) where.schoolStage = event.filter.schoolStage;
      if (event.filter?.primaryPath) where.primaryPath = event.filter.primaryPath;
      if (event.filter?.adminStage)  where.adminStage  = event.filter.adminStage;
      if (event.filter?.isRead === false) where.isRead = false;
      if (event.filter?.ctaTapped)   where['behavior.ctaTapped'] = true;
      if (event.filter?.hasParent)   where.hasParentAnswers = true;
      if (event.filter?.minScore)    where.overallScore = _.gte(event.filter.minScore);

      const query = db.collection('assessments').where(where)
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(limit);

      // 只取列表需要的字段（轻量版）
      const res = await query.field({
        _id: true, createdAt: true,
        childName: true, childAge: true, schoolStage: true, schoolType: true,
        englishLevel: true, academicTier: true,
        overallScore: true, overallLabel: true, overallColor: true,
        primaryPath: true, primaryPathLabel: true, pathConfidence: true,
        hasParentAnswers: true, parentAnswerCount: true,
        hasAiInsight: true,
        topIntelligences: true,
        mindsetLabel: true, mindsetScore: true,
        parentingLabel: true, commLabel: true, valueConsensus: true, engagementLabel: true,
        behavior: true,
        adminNote: true, adminTags: true, adminStage: true, isRead: true,
        // AI洞察摘要（关键字段，不含全文）
        'aiInsight.blindspot': true,
        'aiInsight.strengthSignal': true,
        'aiInsight.riskSignal': true,
        'aiInsight.keyQuote': true,
        'aiInsight.parentingStyle': true,
        'aiInsight.commQuality': true,
      }).get();

      const countRes = await db.collection('assessments').where(where).count();

      return {
        success: true,
        list: res.data,
        total: countRes.total,
        page, limit,
        hasMore: skip + limit < countRes.total,
      };
    }

    // ── mode: 'detail' — 单条完整详情 ───────────────────────────
    if (event.mode === 'detail') {
      if (!event.docId) return { success: false, error: 'docId缺失' };

      const res = await db.collection('assessments').doc(event.docId).get();
      if (!res.data) return { success: false, error: '记录不存在' };

      // 标记为已读
      await db.collection('assessments').doc(event.docId).update({
        data: { isRead: true, updatedAt: db.serverDate() },
      });

      return { success: true, assessment: res.data };
    }

    // ── mode: 'markRead' — 批量标记已读 ─────────────────────────
    if (event.mode === 'markRead') {
      const ids = event.docIds || [];
      const tasks = ids.map(id =>
        db.collection('assessments').doc(id).update({
          data: { isRead: true, updatedAt: db.serverDate() },
        })
      );
      await Promise.all(tasks);
      return { success: true };
    }

    return { success: false, error: '未知mode' };

  } catch (err) {
    console.error('[getAssessments]', err);
    return { success: false, error: err.message };
  }
};
