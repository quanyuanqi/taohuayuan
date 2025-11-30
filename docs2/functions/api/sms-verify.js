// functions/api/sms-verify.js - 阿里云短信认证服务API
// 支持发送验证码和验证验证码

/**
 * 阿里云API签名函数
 * 参考：https://help.aliyun.com/document_detail/315526.html
 * 签名算法：
 * 1. 对参数按字典序排序（不包括Signature）
 * 2. 构建查询字符串：key1=value1&key2=value2（值需要URL编码）
 * 3. 构建待签名字符串：METHOD&URL_ENCODED('/')&URL_ENCODED(QUERY_STRING)
 * 4. 使用HMAC-SHA1签名
 */
async function signRequest(accessKeyId, accessKeySecret, params) {
  // 对参数进行排序（不包括 Signature）
  const sortedKeys = Object.keys(params)
    .filter(key => key !== 'Signature')
    .sort();
  
  // 构建查询字符串（参数值需要URL编码）
  const queryString = sortedKeys
    .map(key => {
      const value = params[key];
      // 对参数值进行URL编码
      const encodedValue = encodeURIComponent(value);
      return `${key}=${encodedValue}`;
    })
    .join('&');

  // 构建待签名字符串：METHOD&URL_ENCODED('/')&URL_ENCODED(QUERY_STRING)
  const stringToSign = `POST&${encodeURIComponent('/')}&${encodeURIComponent(queryString)}`;

  console.log('[SMS-VERIFY] String to sign:', stringToSign);

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
  
  return encodeURIComponent(signatureBase64);
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
  // 时间戳格式：ISO 8601，例如：2023-11-27T10:30:00Z
  const now = new Date();
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
  params.Signature = await signRequest(accessKeyId, accessKeySecret, params);

  // 构建请求体（URL编码）
  const requestBody = new URLSearchParams(params).toString();
  
  console.log('[SMS-VERIFY] Request params (without signature):', {
    AccessKeyId: params.AccessKeyId,
    Action: params.Action,
    PhoneNumbers: params.PhoneNumbers,
    SignName: params.SignName,
    TemplateCode: params.TemplateCode,
    TemplateParam: params.TemplateParam,
    Timestamp: params.Timestamp
  });

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

