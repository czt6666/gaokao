// cloudfunctions/speechToText/index.js
// 袁希™ · 语音转文字云函数（base64 直传模式，绕过 URL 访问限制）
// ═══════════════════════════════════════════════════════════════════

const cloud = require('wx-server-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs-asr');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const AsrClient = tencentcloud.asr.v20190614.Client;

exports.main = async (event) => {
  const { fileID } = event;

  if (!fileID) {
    return { success: false, error: '缺少 fileID 参数' };
  }

  const secretId  = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    console.error('[speechToText] 未配置腾讯云密钥');
    return { success: false, error: '语音服务未配置，请联系管理员' };
  }

  try {
    // ── Step 1：从云存储下载音频文件内容（比 URL 模式更可靠）──────────
    const res = await cloud.downloadFile({ fileID });
    // 兼容 Buffer 和 ArrayBuffer 两种返回类型
    const raw = res.fileContent;
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

    if (!buf || buf.length === 0) {
      throw new Error('音频文件为空（模拟器不支持录音，请用真机测试）');
    }

    // ── Step 2：转 base64，调用 ASR（SourceType=1 直传数据）──────────
    const base64Audio = buf.toString('base64');
    const dataLen     = buf.length;

    const client = new AsrClient({
      credential: { secretId, secretKey },
      region: 'ap-guangzhou',
      profile: {
        httpProfile: {
          endpoint:   'asr.tencentcloudapi.com',
          reqTimeout: 12,  // 12秒，小于20秒函数超时，确保能正常返回错误
        },
      },
    });

    const result = await client.SentenceRecognition({
      ProjectId:      0,
      SubServiceType: 2,
      EngSerViceType: '16k_zh',
      SourceType:     1,          // 1 = 直传 base64 数据（0 = URL模式）
      Data:           base64Audio,
      DataLen:        dataLen,
      VoiceFormat:    'mp3',
      UsrAudioKey:    Date.now().toString(),
    });

    const text = result?.Result?.trim();
    console.log('[speechToText] 识别结果：', text || '(空)');

    // ── Step 3：异步清理云存储 ──────────────────────────────────────
    cloud.deleteFile({ fileList: [fileID] }).catch(() => {});

    if (!text) {
      return { success: false, error: '未识别到语音内容，请重试' };
    }

    return { success: true, text };

  } catch (err) {
    console.error('[speechToText] 识别失败：', err.code, err.message);
    cloud.deleteFile({ fileList: [fileID] }).catch(() => {});
    return {
      success: false,
      error: err.message || '识别服务暂时不可用',
    };
  }
};
