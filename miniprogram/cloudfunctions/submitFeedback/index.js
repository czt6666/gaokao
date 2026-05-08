// cloudfunctions/submitFeedback/index.js
// 艺圆智探 · 用户反馈收集
//
// 接收用户提交的问题/建议，存入 gaokao_feedback 集合
// 支持类型：data_error | bad_recommendation | ui_bug | question | praise

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db       = cloud.database();
const feedback = db.collection('gaokao_feedback');
const sessions = db.collection('gaokao_sessions');

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid    = wxContext.OPENID;

  const {
    type,           // 反馈类型
    targetSchool,   // 涉及的学校（可选）
    targetMajor,    // 涉及的专业（可选）
    userRank,       // 用户位次
    userProvince,   // 用户省份
    description,    // 反馈正文（必填）
    sessionId,      // 关联会话 ID
  } = event;

  if (!description || !description.trim()) {
    return { success: false, error: '反馈内容不能为空' };
  }
  if (description.trim().length < 5) {
    return { success: false, error: '反馈内容太短，请详细描述问题' };
  }

  const VALID_TYPES = ['data_error', 'bad_recommendation', 'ui_bug', 'question', 'praise'];
  const safeType = VALID_TYPES.includes(type) ? type : 'question';

  try {
    const record = {
      openid,
      sessionId:    sessionId || '',
      type:         safeType,
      targetSchool: (targetSchool || '').slice(0, 50),
      targetMajor:  (targetMajor  || '').slice(0, 50),
      userRank:     Number(userRank)    || 0,
      userProvince: userProvince || '',
      description:  description.trim().slice(0, 500),
      status:       'open',     // open | resolved | wontfix
      adminReply:   '',
      createdAt:    db.serverDate(),
    };

    const res = await feedback.add({ data: record });

    // 同步更新关联会话的 feedbackCount
    if (sessionId) {
      try {
        await sessions.doc(sessionId).update({
          data: { feedbackCount: db.command.inc(1) },
        });
      } catch (e) { /* 不阻断主流程 */ }
    }

    return { success: true, feedbackId: res._id };

  } catch (e) {
    console.error('[submitFeedback]', e.message);
    return { success: false, error: e.message };
  }
};
