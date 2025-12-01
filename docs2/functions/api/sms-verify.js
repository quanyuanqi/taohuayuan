// functions/api/sms-verify.js - 阿里云短信认证服务API (V3 签名 ACS3-HMAC-SHA256)

// --- V3 签名配置 ---
const REGION_ID = 'cn-hangzhou'; // V3 签名需要一个 Region ID
const SERVICE_HOST = 'dysmsapi.aliyuncs.com';
const API_VERSION = '2017-05-25';
const API_ACTION = 'SendSms';
const SIGNATURE_ALGORITHM = 'ACS3-HMAC-SHA256';

// --- V3 签名辅助函数 ---

/**
 * SHA256 散列函数
 */
async function hashSha256(data) {
    const encoder = new TextEncoder();
    const buffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    
    // Convert ArrayBuffer to hex string
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
}

/**
 * 阿里云API V3 专用编码函数 (RFC 3986 规范)
 */
function percentEncodeV3(str) {
    let encoded = encodeURIComponent(str);
    encoded = encoded.replace(/\+/g, '%20'); // 替换 + 为 %20 (空格)
    encoded = encoded.replace(/\*/g, '%2A'); // 替换 * 为 %2A
    encoded = encoded.replace(/%7E/g, '~'); // 替换 %7E 回 ~
    return encoded;
}

/**
 * V3 签名日期格式 (YYYYMMDDTHHMMSSZ)
 */
function formatV3Date(date) {
    const year = date.getUTCFullYear().toString();
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    const hour = date.getUTCHours().toString().padStart(2, '0');
    const minute = date.getUTCMinutes().toString().padStart(2, '0');
    const second = date.getUTCSeconds().toString().padStart(2, '0');
    return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

/**
 * 阿里云API V3 签名函数 (ACS3-HMAC-SHA256)
 */
async function signV3Request(accessKeyId, accessKeySecret, bodyParams, date) {
    const httpMethod = 'POST';
    const canonicalUri = '/';
    
    // V3: CanonicalQueryString (此 RPC 风格 API 的核心参数在 Body/Header 中，QueryString 为空)
    const canonicalQueryString = '';
    
    // V3: CanonicalBodyHash (SHA256 of the JSON body)
    const bodyString = JSON.stringify(bodyParams);
    const contentHash = await hashSha256(bodyString);

    // V3: CanonicalHeaders (所有参与签名的 Header，必须小写并排序)
    const headers = {
        'x-acs-action': API_ACTION.toLowerCase(),
        'x-acs-version': API_VERSION.toLowerCase(),
        'x-acs-region-id': REGION_ID.toLowerCase(),
        // x-acs-date 格式必须为 YYYYMMDDTHHMMSSZ
        'x-acs-date': formatV3Date(date).toLowerCase(), 
        'content-type': 'application/json'.toLowerCase(),
        'host': SERVICE_HOST.toLowerCase(),
        'x-acs-request-id': (Date.now().toString() + Math.random().toString(36).substr(2, 9)).toLowerCase() // Nonce
    };
    
    // 排序 Header 键
    const signedHeadersKeys = Object.keys(headers).sort();
    
    let canonicalHeaders = '';
    for (const key of signedHeadersKeys) {
        canonicalHeaders += `${key}:${headers[key]}\n`;
    }
    const signedHeaders = signedHeadersKeys.join(';');

    // V3: CanonicalRequest
    const canonicalRequest = [
        httpMethod,
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders,
        signedHeaders,
        contentHash
    ].join('\n');
    
    console.log('[SMS-V3] Canonical Request:\n', canonicalRequest);
    
    // V3: StringToSign
    const canonicalRequestHash = await hashSha256(canonicalRequest);
    
    const stringToSign = [
        SIGNATURE_ALGORITHM,
        headers['x-acs-date'],
        canonicalRequestHash
    ].join('\n');
    
    console.log('[SMS-V3] String To Sign:\n', stringToSign);

    // V3: Signature (HMAC-SHA256)
    const encoder = new TextEncoder();
    // 签名密钥是 'ACS3' 加上 AccessKeySecret
    const keyData = encoder.encode(`ACS3${accessKeySecret}`);
    const messageData = encoder.encode(stringToSign);
    
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const signatureHex = Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
        
    // V3: Authorization Header
    const authorization = `${SIGNATURE_ALGORITHM} AccessKeyId=${accessKeyId},SignedHeaders=${signedHeaders},Signature=${signatureHex}`;

    // 返回最终请求所需的头部和 JSON 请求体
    return {
        headers: {
            ...headers,
            'Authorization': authorization,
            // 确保 Content-Type 为 JSON
            'Content-Type': 'application/json',
            'Accept': 'application/json' 
        },
        body: bodyString,
    };
}


// --- 业务函数 ---

/**
 * 发送短信验证码 (V3 签名)
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

  // V3 Request Body (业务参数通过 JSON Body 传递)
  const requestBody = {
    SignName: signName, 
    TemplateCode: templateCode,
    PhoneNumbers: phoneNumber,
    TemplateParam: JSON.stringify({ code: verifyCode }),
  };
  
  const now = new Date();
  
  // 签名 V3 请求
  const signedRequest = await signV3Request(accessKeyId, accessKeySecret, requestBody, now);
  
  // V3 的 RPC 风格 API 通常将 Action 和 Version 放在 Query String 中，以保持兼容性
  const endpoint = `https://${SERVICE_HOST}/?Action=${API_ACTION}&Version=${API_VERSION}&Format=JSON`;

  console.log('[SMS-V3] Fetch URL:', endpoint);
  console.log('[SMS-V3] Request Headers:', signedRequest.headers);
  console.log('[SMS-V3] Request Body:', signedRequest.body);


  // 发送请求到阿里云
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: signedRequest.headers,
    body: signedRequest.body
  });

  const result = await response.json();
  
  if (response.status === 200 && result.Code === 'OK') {
    return { success: true, message: '验证码已发送' };
  } else {
    console.error('[SMS-V3] Send failed:', result);
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
