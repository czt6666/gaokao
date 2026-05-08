// cloudfunctions/serverPatch/index.js
// 通过腾讯云 TAT RunCommand 在服务器上执行 shell 命令
// 凭证：直接读取 SCF 运行时内置 TENCENTCLOUD_SECRETID/SECRETKEY/SESSIONTOKEN

const crypto = require('crypto');
const https  = require('https');

// ── TC3-HMAC-SHA256 签名实现 ────────────────────────────────────────────
function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function hmac256(key, data, encoding) {
  return crypto.createHmac('sha256', key).update(data).digest(encoding || undefined);
}

function callTencentAPI(service, action, version, region, payload, secretId, secretKey, token) {
  return new Promise((resolve, reject) => {
    const host      = `${service}.tencentcloudapi.com`;
    const timestamp = Math.floor(Date.now() / 1000);
    const date      = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const body      = JSON.stringify(payload);
    const bodyHash  = sha256hex(body);

    const canonicalHeaders = `content-type:application/json\nhost:${host}\n`;
    const signedHeaders    = 'content-type;host';
    const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, bodyHash].join('\n');

    const credentialScope = `${date}/${service}/tc3_request`;
    const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256hex(canonicalRequest)].join('\n');

    const secretDate    = hmac256('TC3' + secretKey, date);
    const secretService = hmac256(secretDate, service);
    const secretSigning = hmac256(secretService, 'tc3_request');
    const signature     = hmac256(secretSigning, stringToSign, 'hex');

    const authorization = [
      `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ');

    const headers = {
      'Content-Type':   'application/json',
      'Host':           host,
      'X-TC-Action':    action,
      'X-TC-Version':   version,
      'X-TC-Region':    region,
      'X-TC-Timestamp': String(timestamp),
      'Authorization':  authorization,
    };
    if (token) headers['X-TC-Token'] = token;

    const options = { hostname: host, port: 443, path: '/', method: 'POST', headers };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.Response && parsed.Response.Error) {
            return reject(new Error(`[${parsed.Response.Error.Code}] ${parsed.Response.Error.Message}`));
          }
          resolve(parsed.Response || parsed);
        } catch (e) {
          reject(new Error('JSON parse error: ' + raw.slice(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timeout 30s')));
    req.write(body);
    req.end();
  });
}

// ── 轮询等待 TAT 任务完成 ─────────────────────────────────────────────
async function waitForInvocation(invocationId, region, secretId, secretKey, token) {
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const resp = await callTencentAPI(
        'tat', 'DescribeInvocationTasks', '2020-10-28', region,
        { InvocationId: invocationId, Limit: 1 },
        secretId, secretKey, token,
      );
      const task = (resp.InvocationTaskSet || [])[0];
      if (!task) continue;
      console.log('[serverPatch] poll %d/%d status=%s', i + 1, 24, task.TaskStatus);
      if (['SUCCESS', 'FAILED', 'TIMEOUT', 'TERMINATED'].includes(task.TaskStatus)) {
        return {
          success:   task.TaskStatus === 'SUCCESS',
          taskStatus: task.TaskStatus,
          exitCode:   task.TaskResult && task.TaskResult.ExitCode,
          output:     task.TaskResult && Buffer.from(task.TaskResult.Output    || '', 'base64').toString('utf8'),
          errOutput:  task.TaskResult && Buffer.from(task.TaskResult.ErrOutput || '', 'base64').toString('utf8'),
        };
      }
    } catch (e) {
      console.log('[serverPatch] poll error:', e.message);
    }
  }
  return { success: false, taskStatus: 'TIMEOUT_POLL' };
}

// ── 轮询等待 Lighthouse 任务完成 ─────────────────────────────────────────
async function waitForLighthouseTask(taskId, region, secretId, secretKey, token) {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const resp = await callTencentAPI(
        'lighthouse', 'DescribeTaskResult', '2020-03-24', region,
        { TaskId: taskId },
        secretId, secretKey, token,
      );
      const status = resp.TaskStatus;
      console.log('[serverPatch] Lighthouse task %s status=%s', taskId, status);
      if (status === 'SUCCESS') return { success: true, taskStatus: status };
      if (status === 'FAILED') return { success: false, taskStatus: status };
    } catch (e) {
      console.log('[serverPatch] task poll error:', e.message);
    }
  }
  return { success: false, taskStatus: 'TIMEOUT_POLL' };
}

// ── 主函数 ───────────────────────────────────────────────────────────────
exports.main = async (event) => {
  const secretId  = process.env.TENCENTCLOUD_SECRETID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY;
  const token     = process.env.TENCENTCLOUD_SESSIONTOKEN;

  if (!secretId || !secretKey) {
    return { success: false, error: '未找到 TENCENTCLOUD 凭证环境变量' };
  }

  const commandContent = event.commandContent ||
    'aWYgZ3JlcCAtcSAiV0VDSEFUX01JTklfQVBQX0lEIiAvYXBwL2JhY2tlbmQvLmVudjsgdGhlbiBzZWQgLWkgInMvV0VDSEFUX01JTklfQVBQX0lEPS4qL1dFQ0hBVF9NSU5JX0FQUF9JRD13eGFkZTIwYTViMDdiMTEzNDEvIiAvYXBwL2JhY2tlbmQvLmVudjsgZWxzZSBlY2hvICJXRUNIQVRfTUlOSV9BUFBfSUQ9d3hhZGUyMGE1YjA3YjExMzQxIiA+PiAvYXBwL2JhY2tlbmQvLmVudjsgZmk7IGdyZXAgV0VDSEFUX01JTklfQVBQX0lEIC9hcHAvYmFja2VuZC8uZW52OyBzdWRvIC11IHVidW50dSBwbTIgcmVzdGFydCBnYW9rYW8tYmFja2VuZCAtLXVwZGF0ZS1lbnY7IHNsZWVwIDU7IGN1cmwgLXMgaHR0cDovL2xvY2FsaG9zdDo4MDAwL2FwaS9oZWFsdGg=';

  // ── 如果指定了 instanceId，直接使用；否则先查找 ──────────────────────
  const providedInstanceId = event.instanceId;
  const providedRegion     = event.region;
  const username           = event.username || 'root';

  // 支持的区域列表（优先尝试广州）
  const REGIONS = providedRegion
    ? [providedRegion]
    : ['ap-guangzhou', 'ap-shanghai', 'ap-beijing', 'ap-chengdu', 'ap-nanjing'];

  // ── Step 1: 找到实例所在区域 ──────────────────────────────────────────
  let foundInstanceId = providedInstanceId;
  let foundRegion     = providedRegion;
  const debugErrors   = [];

  if (!foundInstanceId || !foundRegion) {
    console.log('[serverPatch] Discovering instance across regions...');
    for (const r of REGIONS) {
      try {
        // 先尝试 Lighthouse
        const lhResp = await callTencentAPI(
          'lighthouse', 'DescribeInstances', '2020-03-24', r,
          { Limit: 20 },
          secretId, secretKey, token,
        );
        const instances = lhResp.InstanceSet || [];
        console.log('[serverPatch] lighthouse %s: %d instances', r, instances.length);
        debugErrors.push({ region: r, count: instances.length, ids: instances.map(i => i.InstanceId) });
        for (const inst of instances) {
          const ip = (inst.PublicAddresses || []).join(',');
          console.log('[serverPatch]   %s ip=%s', inst.InstanceId, ip);
          if (ip.includes('43.143.206.19') || inst.InstanceId === 'lhins-8drqxxhg') {
            foundInstanceId = inst.InstanceId;
            foundRegion     = r;
            console.log('[serverPatch] Found instance %s in %s', foundInstanceId, foundRegion);
            break;
          }
        }
        if (foundInstanceId && foundRegion) break;
      } catch (e) {
        console.log('[serverPatch] lighthouse %s error: %s', r, e.message);
        debugErrors.push({ region: r, error: e.message });
      }
    }
  }

  if (!foundInstanceId || !foundRegion) {
    return { success: false, error: 'Instance not found in any region. Check instance ID/region.', debugErrors };
  }

  // ── resetPassword 模式：重置 SSH root 密码 ────────────────────────────
  if (event.action === 'resetPassword') {
    const newPassword = event.password || 'OrcaPass#2026!';
    const targetUser  = event.targetUser || 'root';
    console.log('[serverPatch] Resetting password for instance %s in %s user=%s', foundInstanceId, foundRegion, targetUser);
    try {
      const resp = await callTencentAPI(
        'lighthouse', 'ResetInstancesPassword', '2020-03-24', foundRegion,
        { InstanceIds: [foundInstanceId], Password: newPassword, UserName: targetUser },
        secretId, secretKey, token,
      );
      console.log('[serverPatch] ResetInstancesPassword resp:', JSON.stringify(resp));
      if (resp.TaskId) {
        const taskResult = await waitForLighthouseTask(resp.TaskId, foundRegion, secretId, secretKey, token);
        return { ...taskResult, password: newPassword, instanceId: foundInstanceId, region: foundRegion };
      }
      return { success: true, password: newPassword, instanceId: foundInstanceId, region: foundRegion, resp };
    } catch (err) {
      return { success: false, error: err.message, instanceId: foundInstanceId };
    }
  }

  // ── Step 2: 检查 TAT agent 状态 ──────────────────────────────────────
  let tatWorking = false;
  try {
    const agentResp = await callTencentAPI(
      'tat', 'DescribeAutomationAgentStatus', '2020-10-28', foundRegion,
      { InstanceIds: [foundInstanceId] },
      secretId, secretKey, token,
    );
    const agents = agentResp.AutomationAgentSet || [];
    console.log('[serverPatch] TAT agent status:', JSON.stringify(agents));
    tatWorking = agents.some(a => a.AgentStatus === 'Online');
  } catch (e) {
    console.log('[serverPatch] TAT agent check error:', e.message);
  }

  if (!tatWorking) {
    return {
      success: false,
      error: 'TAT agent is not Online on the instance. Please install/start it via the Tencent Cloud Lighthouse console (Terminal button).',
      instanceId: foundInstanceId,
      region: foundRegion,
      hint: 'Open https://console.cloud.tencent.com/lighthouse/instance/index, click the instance, click "Terminal" to auto-install the TAT agent, then call serverPatch again.',
    };
  }

  // ── Step 3: 执行命令 ──────────────────────────────────────────────────
  console.log('[serverPatch] Running command on %s (%s)', foundInstanceId, foundRegion);
  try {
    const runResp = await callTencentAPI(
      'tat', 'RunCommand', '2020-10-28', foundRegion,
      {
        Content:     commandContent,
        InstanceIds: [foundInstanceId],
        CommandType: 'SHELL',
        Timeout:     120,
        Username:    username,
      },
      secretId, secretKey, token,
    );

    const invocationId = runResp.InvocationId;
    console.log('[serverPatch] InvocationId:', invocationId);
    if (!invocationId) {
      return { success: false, error: 'No InvocationId', raw: runResp };
    }

    const taskResult = await waitForInvocation(invocationId, foundRegion, secretId, secretKey, token);
    return { ...taskResult, invocationId, instanceId: foundInstanceId, region: foundRegion };

  } catch (err) {
    console.error('[serverPatch] RunCommand error:', err.message);
    return { success: false, error: err.message };
  }
};
