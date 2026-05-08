// cloudfunctions/updateAssessmentNote/index.js
// 袁希™ · 更新线索数据（管理员操作 + 用户行为回写）
// ═══════════════════════════════════════════════════════════════
// 双用途：
//   1. 管理员写备注 / 更改阶段 / 补充AI洞察（需要 adminCode 验证）
//   2. 用户端行为数据回写（visitCount、readDuration等）— 不需要 adminCode，
//      因为用户只能更新自己 _openid 对应的文档（cloud数据库行级权限）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ADMIN_CODE = process.env.ADMIN_CODE || 'wangzi@YX2024';

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const isAdmin = event.adminCode === ADMIN_CODE;

  const { docId } = event;
  if (!docId) return { success: false, error: 'docId缺失' };

  try {
    const updateData = { updatedAt: db.serverDate() };

    // ── 管理员专属字段（需要验证码）────────────────────────────
    if (isAdmin) {
      if (event.note       !== undefined) updateData.adminNote  = event.note;
      if (event.tags       !== undefined) updateData.adminTags  = event.tags;
      if (event.adminStage !== undefined) updateData.adminStage = event.adminStage;
      if (event.aiInsight  !== undefined) updateData.aiInsight  = event.aiInsight;
    }

    // ── 行为数据回写（用户端调用，无需验证码）────────────────────
    // 安全校验：非管理员调用时，必须验证文档 _openid 与当前用户一致
    // 防止用户 A 拿到用户 B 的 docId 后篡改行为数据
    const bh = event.behaviorUpdate || {};
    if (!isAdmin && Object.keys(bh).length > 0) {
      try {
        const docSnap = await db.collection('assessments').doc(docId).get();
        if (!docSnap.data || docSnap.data._openid !== OPENID) {
          return { success: false, error: '无权更新此文档' };
        }
      } catch (_) {
        return { success: false, error: '文档不存在或无访问权限' };
      }
    }

    // 访问次数（只增不减）
    if (bh.visitCount !== undefined) {
      updateData['behavior.visitCount']    = bh.visitCount;
      updateData['behavior.lastVisitAt']   = db.serverDate();
      // 记录首次复访时间（如果是第二次访问）
      if (bh.visitCount === 2) {
        updateData['behavior.firstRevisitAt'] = db.serverDate();
      }
    }

    // 报告停留时长（客户端已做"只在 > 历史最大值时上报"的控制，此处直接覆盖）
    if (bh.readDuration !== undefined) {
      updateData['behavior.maxReadDuration'] = bh.readDuration;  // 客户端保证只上报最大值
      updateData['behavior.readTier']        = bh.readTier;      // '浅读' / '细读' / '深度阅读'
    }

    // 家长问卷放弃点
    if (bh.parentAbandonedAt !== undefined) {
      updateData['behavior.parentAbandonedAt']      = bh.parentAbandonedAt;
      updateData['behavior.parentCompletionRate']   = bh.parentCompletionRate;
      updateData['behavior.parentAbandonedAtLabel'] = bh.parentAbandonedAtLabel;
    }

    // 其他行为事件（布尔型）
    if (bh.ctaTapped      === true) updateData['behavior.ctaTapped']      = true;
    if (bh.shareGenerated === true) updateData['behavior.shareGenerated'] = true;
    if (bh.aiChatStarted  === true) updateData['behavior.aiChatStarted']  = true;

    // ── AI 对话会话深度数据（每次离开 ai-chat 页时上报）────────
    if (bh.chatSessionDuration !== undefined) {
      updateData['chatSession.duration']  = bh.chatSessionDuration;   // 秒
      updateData['chatSession.turnCount'] = bh.chatTurnCount  || 0;   // AI回复轮数
      updateData['chatSession.topics']    = bh.chatTopics     || [];   // 话题词
      updateData['chatSession.mode']      = bh.chatMode       || 'questionnaire';
      updateData['chatSession.recordedAt']= db.serverDate();
    }

    // ── 学校浏览记录（school-detail 页访问时上报）────────────────
    if (bh.viewedSchoolId) {
      // 使用数组追加操作，避免覆盖（cloud db array union）
      updateData['behavior.viewedSchools'] = _.push([{
        id:         bh.viewedSchoolId,
        name:       bh.viewedSchoolName || '',
        region:     bh.viewedSchoolRegion || '',
        viewedAt:   db.serverDate(),
      }]);
    }

    // 至少要有一个更新字段才执行
    if (Object.keys(updateData).length <= 1) {
      return { success: false, error: '无有效更新字段' };
    }

    await db.collection('assessments').doc(docId).update({ data: updateData });
    return { success: true };

  } catch (err) {
    console.error('[updateAssessmentNote]', err);
    return { success: false, error: err.message };
  }
};
