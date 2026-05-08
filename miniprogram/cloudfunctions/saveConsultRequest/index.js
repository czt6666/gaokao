// cloudfunctions/saveConsultRequest/index.js
// 袁希™ · 保存1对1咨询预约请求
// ═══════════════════════════════════════════════════════════════
//  用户在预约页提交手机号后调用
//  写入 consulting_requests 集合，供袁希助理跟进
//
//  字段设计原则：
//   - 包含报告摘要（方便助理在联系前了解孩子情况）
//   - 保留用户自述痛点（核心价值，咨询切入点）
//   - 标记预约状态（new → contacted → scheduled → completed）
// ═══════════════════════════════════════════════════════════════

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  try {
    const {
      phone,
      childName,
      painPoints,
      overallScore,
      primaryPath,
      bookingWay,   // 'wechat' | 'pay'
      source,       // 'report_cta'
    } = event;

    // ── 手机号基础校验（服务端二次验证）──────────────────────
    if (!phone || !/^1[3-9]\d{9}$/.test(String(phone).trim())) {
      return { success: false, error: '手机号格式不正确' };
    }

    const docData = {
      // ── 身份 ──────────────────────────────────────────────────
      _openid:   OPENID,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),

      // ── 联系方式 ──────────────────────────────────────────────
      phone:     String(phone).trim(),

      // ── 孩子 & 报告摘要（助理联系前快速了解）──────────────────
      childName:    childName    || '孩子',
      overallScore: overallScore || null,
      primaryPath:  primaryPath  || null,

      // ── 核心：用户自述痛点 ────────────────────────────────────
      // 这是最宝贵的数据——用户主动说出了他们真正在意的问题
      // 助理第一句话就应该回应这个痛点，而不是套路化开场
      painPoints:   painPoints   || '',
      hasPainPoints: !!(painPoints && painPoints.trim().length > 0),

      // ── 预约方式 ──────────────────────────────────────────────
      bookingWay:   bookingWay   || 'wechat',   // wechat=加助理微信 pay=微信支付

      // ── 来源追踪 ──────────────────────────────────────────────
      source:       source       || 'report_cta',

      // ── 跟进状态（助理操作） ──────────────────────────────────
      // new → contacted（已联系） → scheduled（已排期） → completed（已完成）→ closed（关闭）
      status:       'new',
      isRead:       false,         // 助理是否已查看
      adminNote:    '',            // 助理跟进备注
      adminTags:    [],            // 例如：['高意向', '已成交', 'VIP']
      scheduledAt:  null,          // 预约咨询时间（助理填写）
      completedAt:  null,          // 咨询完成时间

      // ── 数据质量标记 ──────────────────────────────────────────
      // 供 adminAnalytics 聚合：哪些用户质量最高（有报告分数 + 有痛点 = 强意向）
      signalScore: (() => {
        let score = 1; // 基础分：提交了手机号
        if (overallScore && overallScore >= 70) score += 1;  // 高匹配度
        if (painPoints && painPoints.trim().length > 20) score += 2; // 有实质痛点描述
        if (bookingWay === 'pay') score += 1; // 愿意付款 = 意向更强
        return score;
      })(),
    };

    const result = await db.collection('consulting_requests').add({ data: docData });

    return {
      success: true,
      docId: result._id,
    };

  } catch (err) {
    console.error('[saveConsultRequest]', err);
    return { success: false, error: err.message };
  }
};
