// cloudfunctions/miniLogin/index.js
// 艺圆智探 · 小程序登录代理云函数
//
// 流程：小程序调用 → 云函数获取 openid → 调后端登录接口 → 返回 JWT token
// 用途：让小程序用户在后端也有账户，支付时可以关联订单到用户

const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const API_HOST = 'www.theyuanxi.cn';

function postJSON(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: API_HOST,
      port: 443,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'WeChatMiniProgram/miniLogin',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', chunk => { chunks += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(chunks);
          if (res.statusCode !== 200) {
            return reject(new Error(`API ${res.statusCode}: ${parsed.detail || chunks.slice(0, 200)}`));
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error('JSON parse error: ' + chunks.slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Timeout 20s')));
    req.write(data);
    req.end();
  });
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  console.log('[miniLogin] openid:', OPENID);

  if (!OPENID) {
    return { success: false, error: '无法获取用户身份' };
  }

  try {
    const result = await postJSON('/api/auth/wechat/mini/login', {
      openid: OPENID,
    });

    return {
      success: true,
      token: result.token,
      user_id: result.user_id,
      is_new: result.is_new,
      is_paid: result.is_paid,
    };
  } catch (err) {
    console.error('[miniLogin] error:', err.message);
    return { success: false, error: err.message };
  }
};
