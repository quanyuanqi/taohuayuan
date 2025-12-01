// functions/api/sms-verify.js - 阿里云短信认证服务API (正确实现)

// --- 短信服务配置 ---
const SERVICE_HOST = 'dysmsapi.aliyuncs.com';
const API_VERSION = '2017-05-25';
const API_ACTION = 'SendSms';

/**
 * 计算签名
 */
function computeSignature(params, accessKeySecret) {
  // 1. 参数排序
  const sortedParams = Object.keys(params).sort().map(key => [key, params[key]]);
  
  // 2. 构建规范请求字符串
  const canonicalString = sortedParams
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  
  // 3. 构建待签名字符串
  const stringToSign = `POST&%2F&${encodeURIComponent(canonicalString)}`;
  
  // 4. 使用HMAC-SHA1计算签名
  const crypto = require('crypto');
  const signature = crypto
    .createHmac('sha1', accessKeySecret + '&')
    .update(stringToSign)
    .digest('base64');
    
  return signature;
}

/**
 * 发送短信验证码
 */
async function sendVerifyCode(phoneNumber, env) {
  const accessKeyId = env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = env.ALIYUN_ACCESS_KEY_SECRET;
  const signName = env.ALIYUN_SMS_SIGN_NAME;
  const templateCode = env.ALIYUN_SMS_TEMPLATE_CODE;

  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    throw new Error('短信服务配置不完整');
  }

  const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
  
  // KV 存储逻辑...
  const kvKey = `sms-verify:${phoneNumber}`;
  await env.ADVICES_KV.put(kvKey, JSON.stringify({
    code: verifyCode,
    phoneNumber: phoneNumber,
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000
  }), { expirationTtl: 300 });

  // 当前时间戳
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  
  // 构建请求参数
  const params = {
    'AccessKeyId': accessKeyId,
    'Action': API_ACTION,
    'Format': 'JSON',
    'OutId': `verify-${Date.now()}`,
    'PhoneNumbers': phoneNumber,
    'RegionId': 'cn-hangzhou',
    'SignName': signName,
    'TemplateCode': templateCode,
    'TemplateParam': JSON.stringify({ code: verifyCode }),
    'Timestamp': timestamp,
    'Version': API_VERSION
  };

  // 计算签名
  const signature = computeSignature(params, accessKeySecret);
  params.Signature = signature;

  // 构建请求体
  const requestBody = Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  const endpoint = `https://${SERVICE_HOST}/`;

  console.log('[SMS] Request URL:', endpoint);
  console.log('[SMS] Request Body:', requestBody);

  // 发送请求到阿里云
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': requestBody.length.toString()
    },
    body: requestBody
  });

  const result = await response.json();
  
  if (response.status === 200 && result.Code === 'OK') {
    return { success: true, message: '验证码已发送' };
  } else {
    console.error('[SMS] Send failed:', result);
    throw new Error(result.Message || result.Code || '发送验证码失败');
  }
}

/**
 * 验证短信验证码
 */
async function checkVerifyCode(phoneNumber, code, env) {
  if (!phoneNumber || !code) {
    throw new Error('手机号和验证码不能为空');
  }

  const kvKey = `sms-verify:${phoneNumber}`;
  const stored = await env.ADVICES_KV.get(kvKey, 'json');
  
  if (!stored) {
    throw new Error('验证码不存在或已过期');
  }

  if (Date.now() > stored.expiresAt) {
    await env.ADVICES_KV.delete(kvKey);
    throw new Error('验证码已过期');
  }

  if (stored.code !== code) {
    throw new Error('验证码错误');
  }

  // 验证成功后删除验证码（防止重复使用）
  await env.ADVICES_KV.delete(kvKey);
  
  return { success: true, message: '验证成功' };
}

/**
 * 主处理函数
 */
export async function onRequestPost(context) {
  const { env, request } = context;
  
  try {
    const body = await request.json();
    const { action, phoneNumber, code } = body || {};

    // 验证手机号格式（11位数字）
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (phoneNumber && !phoneRegex.test(phoneNumber)) {
      return new Response(JSON.stringify({ error: '手机号格式不正确' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    if (action === 'send') {
      if (!phoneNumber) {
        return new Response(JSON.stringify({ error: '手机号不能为空' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      // 检查发送频率限制（同一手机号1分钟内只能发送1次）
      const rateLimitKey = `sms-rate:${phoneNumber}`;
      const lastSend = await env.ADVICES_KV.get(rateLimitKey);
      if (lastSend) {
        const lastSendTime = parseInt(lastSend);
        if (Date.now() - lastSendTime < 60000) {
          return new Response(JSON.stringify({ error: '发送过于频繁，请稍后再试' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
      }

      const result = await sendVerifyCode(phoneNumber, env);
      
      // 记录发送时间
      await env.ADVICES_KV.put(rateLimitKey, Date.now().toString(), { expirationTtl: 60 });
      
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });

    } else if (action === 'check') {
      if (!phoneNumber || !code) {
        return new Response(JSON.stringify({ error: '手机号和验证码不能为空' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      const result = await checkVerifyCode(phoneNumber, code, env);
      
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });

    } else {
      return new Response(JSON.stringify({ error: '无效的操作类型' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

  } catch (err) {
    console.error('[SMS-VERIFY] Error:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    
    // 返回详细的错误信息（便于调试）
    return new Response(JSON.stringify({ 
      error: err.message || '操作失败',
      type: err.name || 'Error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}
