// cloudfunctions/getUserLatestAssessment/index.js
// 袁希™ · 获取当前用户最近一次评估（用于本地存储丢失后的数据恢复）
// ═══════════════════════════════════════════════════════════════
//  调用方：miniprogram/pages/result/result.js
//          miniprogram/pages/index/index.js
//  策略：通过 openid 查询最近一次评估记录，返回重建 assessmentData 所需的所有字段
// ═══════════════════════════════════════════════════════════════

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { success: false, error: 'no_openid', found: false };

  try {
    const res = await db.collection('assessments')
      .where({ _openid: OPENID })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (!res.data || res.data.length === 0) {
      return { success: true, found: false };
    }

    const doc = res.data[0];

    return {
      success: true,
      found:   true,
      docId:   doc._id,

      // ── 重建 assessmentData 所需的原始数据 ────────────────────
      answers:      doc.childAnswers  || {},
      miScores:     doc.miScores      || {},   // 归一化 0-1（与 assessmentData.miScores 一致）
      mindsetScore: doc.mindsetScore  || 3,
      parentAnswers:doc.parentAnswers || {},

      // ── 首页卡片展示所需字段（不用重跑报告引擎）──────────────
      childName:        doc.childName        || '孩子',
      overallScore:     doc.overallScore     || 0,
      primaryPath:      doc.primaryPath      || '',
      primaryPathLabel: doc.primaryPathLabel || '报告已生成',
    };

  } catch (err) {
    console.error('[getUserLatestAssessment]', err);
    return { success: false, error: err.message, found: false };
  }
};
