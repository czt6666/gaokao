// 云函数: getPhoneNumber
// 作用: 通过 code 获取用户真实手机号（新版手机号 API，code 有效期5分钟）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const { code } = event;
  if (!code) return { success: false, errMsg: 'code 缺失' };

  try {
    const result = await cloud.openapi.phonenumber.getPhoneNumber({ code });
    const phoneInfo = result.phone_info;
    return {
      success:     true,
      phone:       phoneInfo.phoneNumber,        // 带区号: +8613812345678
      purePhone:   phoneInfo.purePhoneNumber,    // 不带区号: 13812345678
      countryCode: phoneInfo.countryCode,        // 86
    };
  } catch (e) {
    console.error('[getPhoneNumber] 失败', e);
    return { success: false, errMsg: e.errMsg || String(e) };
  }
};
