// functions/api/sms-verify.js - 阿里云号码认证服务API (V2/RPC 风格 HMAC-SHA1)
// 修正：将参数名 PhoneNumbers 修正为 PhoneNumber 以符合 PNS 接口要求

const API_ENDPOINT = 'https://dypnsapi.aliyuncs.com/'; 

/**
 * 阿里云API签名专用编码函数 (RPC V2 风格 RFC 3986 规范)
 */
function percentEncode(str) {
  let encoded = encodeURIComponent(str);
  
  encoded = encoded.replace(/\+/g, '%20'); // 替换 + 为 %20 (空格)
  encoded = encoded.replace(/\*/g, '%2A'); // 替换 * 为 %2A
  encoded = encoded.replace(/%7E/g, '~'); // 替换 %7E 回 ~
  
  return encoded;
}

/**
 * 阿里云API签名函数
 */
async function signRequest(accessKeyId, accessKeySecret, params) {
  const sortedKeys = Object.keys(params)
    .filter(key => key !== 'Signature')
    .sort();
  
  // 构建规范化查询字符串 (Canonical Query String)
  const canonicalQueryString = sortedKeys
    .map(key => {
      const value = String(params[key]);
      
      const encodedKey = percentEncode(key);
      const encodedValue = percentEncode(value);
      
      return `${encodedKey}=${encodedValue}`;
    })
    .join('&');

  // 构建待签名字符串 (String To Sign)
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalQueryString)}`;

  console.log('[PNS-SMS] String to sign:', stringToSign);

  // 使用HMAC-SHA1签名
  const encoder = new TextEncoder();
  const keyData = encoder.encode(accessKeySecret + '&'); 
  const messageData = encoder.encode(stringToSign);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  
  return percentEncode(signatureBase64);
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

  // 生成6位随机验证码
  const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
  
  // 将验证码存储到KV，有效期5分钟
  const kvKey = `sms-verify:${phoneNumber}`;
  await env.ADVICES_KV.put(kvKey, JSON.stringify({
    code: verifyCode,
    phoneNumber: phoneNumber,
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000 // 5分钟有效期
  }), { expirationTtl: 300 }); // 5分钟TTL

  // 构建阿里云短信API请求参数
  const now = new Date();
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  
  const params = {
    AccessKeyId: accessKeyId,
    Action: 'SendSmsVerifyCode', 
    Format: 'JSON',
    // <<< 关键修正：参数名从 PhoneNumbers 改为 PhoneNumber >>>
    PhoneNumber: phoneNumber, 
    SignName: signName, 
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code: verifyCode }), 
    Timestamp: timestamp,
    Version: '2017-05-25',
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: Date.now().toString() + Math.random().toString(36).substr(2, 9)
  };

  // 添加签名
  params.Signature = await signRequest(accessKeyId, accessKeySecret, params);

  // 构建请求体
  const requestBody = Object.keys(params)
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  console.log('[PNS-SMS] Request body (full, URL-encoded):', requestBody);

  // 发送请求到阿里云
  const response = await fetch(API_ENDPOINT, { 
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: requestBody
  });

  const result = await response.json();
  
  if (result.Code === 'OK') {
    return { success: true, message: '验证码已发送' };
  } else {
    console.error('[PNS-SMS] Send failed:', result);
    throw new Error(result.Message || '发送验证码失败');
  }
}

/**
 * 验证短信验证码 (此部分保持不变)
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
    console.error('[PNS-SMS] Error:', {
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
