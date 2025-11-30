// functions/api/sms-verify.js - 阿里云短信认证服务API
// 支持发送验证码和验证验证码

/**
 * 阿里云API签名专用编码函数 (RFC 3986 规范)
 * 确保 '+' 被替换为 '%20', '*' 被替换为 '%2A', '~' 不被编码 (即 %7E 替换为 ~)
 */
function percentEncode(str) {
  // 1. 使用标准的 encodeURIComponent
  let encoded = encodeURIComponent(str);
  
  // 2. 替换特定的字符以符合阿里云的 RFC 3986 规范
  encoded = encoded.replace(/\+/g, '%20');
  encoded = encoded.replace(/\*/g, '%2A');
  encoded = encoded.replace(/%7E/g, '~');
  
  return encoded;
}

/**
 * 阿里云API签名函数
 */
async function signRequest(accessKeyId, accessKeySecret, params) {
  // 对参数进行排序（不包括 Signature）
  const sortedKeys = Object.keys(params)
    .filter(key => key !== 'Signature')
    .sort();
  
  // 构建查询字符串：键和值都需要 URL 编码
  const queryString = sortedKeys
    .map(key => {
      const value = String(params[key]);
      
      // 对参数键和参数值进行 URL 编码
      const encodedKey = percentEncode(key);
      const encodedValue = percentEncode(value);
      
      return `${encodedKey}=${encodedValue}`;
    })
    .join('&');

  // 构建待签名字符串：METHOD&encode('/')&QUERY_STRING
  // 关键修正：queryString (包含所有已编码的键值对) 必须直接拼接，不能再次编码
  const stringToSign = `POST&${percentEncode('/')}&${queryString}`;

  console.log('[SMS-VERIFY] Sorted keys:', sortedKeys);
  console.log('[SMS-VERIFY] Query string (after encoding):', queryString);
  console.log('[SMS-VERIFY] String to sign:', stringToSign);

  // 使用HMAC-SHA1签名
  const encoder = new TextEncoder();
  // 签名密钥是 AccessKeySecret 加上一个 '&' 字符
  const keyData = encoder.encode(accessKeySecret + '&'); 
  const messageData = encoder.encode(stringToSign);
  
  // 确保 crypto.subtle 是可用的环境 (例如 Cloudflare Workers)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  // ArrayBuffer 转换为 Base64
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  
  // 签名值也需要进行 URL 编码 (用于放入请求参数 Signature 中)
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

  console.log('[SMS-VERIFY] Config check:', {
    hasAccessKeyId: !!accessKeyId,
    hasAccessKeySecret: !!accessKeySecret,
    signName: signName,
    templateCode: templateCode,
    templateCodeLength: templateCode ? templateCode.length : 0
  });
  
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    console.error('[SMS-VERIFY] Missing config:', {
      accessKeyId: !!accessKeyId,
      accessKeySecret: !!accessKeySecret,
      signName: !!signName,
      templateCode: !!templateCode
    });
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
  // 阿里云 API 需要 UTC 时间，且毫秒部分必须去除
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  
  const params = {
    AccessKeyId: accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phoneNumber,
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
  // params.Signature 是一个经过 percentEncode 后的值
  params.Signature = await signRequest(accessKeyId, accessKeySecret, params);

  // 构建请求体（URL编码）
  // 修正：手动构建请求体，将所有参数以 key=value&key2=value2 形式拼接。
  // 注意：params[key] 中的 Signature 已经是经过编码的，不能再次编码。
  const requestBody = Object.keys(params)
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  console.log('[SMS-VERIFY] Request params (without signature):', {
    AccessKeyId: params.AccessKeyId,
    Action: params.Action,
    PhoneNumbers: params.PhoneNumbers,
    SignName: params.SignName,
    TemplateCode: params.TemplateCode,
    TemplateParam: params.TemplateParam,
    Timestamp: params.Timestamp
  });
  console.log('[SMS-VERIFY] Request body (full, URL-encoded):', requestBody);

  // 发送请求到阿里云
  const response = await fetch('https://dysmsapi.aliyuncs.com/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: requestBody
  });

  const result = await response.json();
  
  console.log('[SMS-VERIFY] Aliyun API response:', {
    Code: result.Code,
    Message: result.Message,
    RequestId: result.RequestId
  });
  
  if (result.Code === 'OK') {
    return { success: true, message: '验证码已发送' };
  } else {
    console.error('[SMS-VERIFY] Send failed:', result);
    throw new Error(result.Message || '发送验证码失败');
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
      // 发送验证码
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
      // 验证验证码
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
