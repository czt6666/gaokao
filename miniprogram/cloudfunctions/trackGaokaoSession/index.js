// cloudfunctions/trackGaokaoSession/index.js
// 艺圆智探 · 高考用户行为追踪
//
// actions:
//   create       - 查询完成后创建会话记录
//   update       - 用户离开结果页时批量刷新行为数据
//   resolvePhone - 解码微信手机号并绑定到会话

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db      = cloud.database();
const _       = db.command;
const sessions = db.collection('gaokao_sessions');

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid    = wxContext.OPENID;
  const { action, sessionId } = event;

  console.log('[trackGaokaoSession]', action, sessionId ? sessionId.slice(0, 8) : '-');

  try {
    // ── 创建会话 ─────────────────────────────────────────────────
    if (action === 'create') {
      const record = {
        openid,
        phone:          '',
        queryAt:        db.serverDate(),
        mode:           event.mode      || 'rank',
        rank:           event.rank      || 0,
        province:       event.province  || '',
        subject:        event.subject   || '',
        resultCounts:   event.resultCounts || {},
        tabsViewed:     ['surge'],   // 首tab默认计入
        savedSchools:   [],
        aiRequested:    false,
        sessionDuration: 0,
        feedbackCount:  0,
      };
      const res = await sessions.add({ data: record });
      return { success: true, sessionId: res._id };
    }

    // ── 批量更新（用户离开结果页时调用）───────────────────────────
    if (action === 'update') {
      if (!sessionId) return { success: false, error: 'missing sessionId' };
      const update = {};
      if (Array.isArray(event.tabsViewed))   update.tabsViewed    = event.tabsViewed;
      if (Array.isArray(event.savedSchools)) update.savedSchools  = event.savedSchools;
      if (event.aiRequested !== undefined)   update.aiRequested   = event.aiRequested;
      if (event.sessionDuration > 0)         update.sessionDuration = event.sessionDuration;
      await sessions.doc(sessionId).update({ data: update });
      return { success: true };
    }

    // ── 解码手机号并绑定 ─────────────────────────────────────────
    if (action === 'resolvePhone') {
      const { code } = event;
      if (!code) return { success: false, error: 'missing code' };

      // 通过云开发 openapi 解码手机号（无需 session_key）
      // 需在云函数配置中开启 wx.openapi.phonenumber.getPhoneNumber 权限
      let phone = '';
      try {
        const phoneRes = await cloud.openapi.phonenumber.getPhoneNumber({ code });
        phone = phoneRes.phone_info?.phoneNumber || phoneRes.phone_info?.purePhoneNumber || '';
      } catch (e) {
        console.error('[resolvePhone] decode failed:', e.message);
        return { success: false, error: '手机号解码失败，请重试' };
      }

      if (!phone) return { success: false, error: '未能获取手机号' };

      // 更新当前会话
      if (sessionId) {
        await sessions.doc(sessionId).update({ data: { phone } });
      }
      // 同步更新此 openid 下所有未留号的会话
      await sessions.where({ openid, phone: '' }).update({ data: { phone } });

      return { success: true, phone };
    }

    return { success: false, error: `unknown action: ${action}` };

  } catch (e) {
    console.error('[trackGaokaoSession]', e.message);
    return { success: false, error: e.message };
  }
};
