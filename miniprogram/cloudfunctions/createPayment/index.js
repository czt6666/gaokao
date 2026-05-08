// cloudfunctions/createPayment/index.js
// 艺圆智探 · 小程序支付代理云函数
//
// 流程：小程序调用 → 云函数获取 openid → 调后端 JSAPI 接口 → 返回支付参数
// 小程序端拿到参数后直接调 wx.requestPayment()

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
        'User-Agent': 'WeChatMiniProgram/createPayment',
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
            return reject(new Error(`API ${res.statusCode}: ${parsed.detail || parsed.error || chunks.slice(0, 200)}`));
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error('JSON parse error: ' + chunks.slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(new Error('Timeout 25s')));
    req.write(data);
    req.end();
  });
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { product_type, province, rank_input, subject } = event;

  console.log('[createPayment] openid:', OPENID, 'product:', product_type, 'subject:', subject);

  if (!OPENID) {
    return { success: false, error: '无法获取用户身份' };
  }

  try {
    const result = await postJSON('/api/payment/wechat/jsapi', {
      openid: OPENID,
      product_type: product_type || 'single_report',
      province: province || '',
      rank_input: rank_input || 0,
      subject: subject || '',
    });

    if (result.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      order_no: result.order_no,
      amount: result.amount,
      pay_params: result.pay_params,
    };
  } catch (err) {
    console.error('[createPayment] error:', err.message);
    return { success: false, error: err.message };
  }
};
