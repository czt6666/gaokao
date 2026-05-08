// 云函数: getOpenId
// 作用: 返回调用者的 openid（微信自动注入，无需传参）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  return { openid: OPENID };
};
