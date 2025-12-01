// functions/api/sms-verify.js - 阿里云短信认证服务API (V3 签名 ACS3-HMAC-SHA256)
// 修正版：修复 V3 签名流程（包含 CanonicalQueryString / Credential scope / 正确的 HMAC 派生）
// 主要问题导致 "Specified time stamp or date value is not well formatted." 的原因：
// - Authorization 中缺少 credential scope（含 YYYYMMDD/region/service/acs_request）
// - 未按 ACS3 要求派生签名密钥（直接用 accessKeySecret 做 HMAC 是错误的）
// - canonicalQueryString 未包含实际的 query params (Action/Version 等) — 导致 CanonicalRequest 与实际请求不一致
// 另：请确认运行环境时间为 UTC 且系统时间准确，否则服务器也会报时间相关错误

// --- V3 签名配置 ---
const REGION_ID = 'cn-hangzhou'; // V3 签名需要一个 Region ID
const SERVICE_HOST = 'dysmsapi.aliyuncs.com';
const API_VERSION = '2017-05-25';
const API_ACTION = 'SendSms';
const SIGNATURE_ALGORITHM = 'ACS3-HMAC-SHA256';
const SERVICE_NAME = 'dysmsapi'; // 用于签名 scope 中的 service 部分

// --- 辅助函数 ---
async function hashSha256Hex(data) {
    const encoder = new TextEncoder();
    const buffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function formatV3Date(date) {
    // 目标格式: YYYYMMDDTHHMMSSZ
    // 使用 toISOString() 可得到 UTC 时间：YYYY-MM-DDTHH:MM:SS.sssZ
    const iso = date.toISOString(); // e.g. 2025-11-30T20:22:15.123Z
    return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // => 20251130T202215Z
}

function formatShortDate(date) {
    // YYYYMMDD (用于 credential scope)
    const d = formatV3Date(date); // YYYYMMDDTHHMMSSZ
    return d.slice(0, 8);
}

function rfc3986EncodeURIComponent(str) {
    // encodeURIComponent 已接近 RFC3986，额外替换 !'()* 等
    return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

async function hmacSha256Raw(keyData, message) {
    // keyData: ArrayBuffer | Uint8Array
    // message: string
    const encoder = new TextEncoder();
    const keyBuffer = (keyData instanceof ArrayBuffer) ? keyData : keyData.buffer || keyData;
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBuffer,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
    return sig; // ArrayBuffer
}

function arrayBufferToHex(ab) {
    return Array.from(new Uint8Array(ab)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- V3 签名函数（完整实现：CanonicalRequest, StringToSign, 派生签名密钥） ---
async function signV3Request(accessKeyId, accessKeySecret, bodyParams, date) {
    const httpMethod = 'POST';
    const canonicalUri = '/';

    // 构造 canonical query string：Action, Version, Format (按 key 排序并进行 RFC3986 编码)
    const queryParams = {
        Action: API_ACTION,
        Version: API_VERSION,
        Format: 'JSON'
    };
    const sortedQueryKeys = Object.keys(queryParams).sort();
    const canonicalQueryString = sortedQueryKeys
        .map(k => `${rfc3986EncodeURIComponent(k)}=${rfc3986EncodeURIComponent(String(queryParams[k]))}`)
        .join('&');

    // CanonicalBodyHash (SHA256 of JSON body)
    const bodyString = JSON.stringify(bodyParams);
    const contentHash = await hashSha256Hex(bodyString);

    const formattedDate = formatV3Date(date); // YYYYMMDDTHHMMSSZ
    const shortDate = formatShortDate(date); // YYYYMMDD

    // 构造需要加入到签名的 headers（全部小写，值需要 trim）
    const headers = {
        'content-type': 'application/json',
        'host': SERVICE_HOST,
        'x-acs-action': API_ACTION,
        'x-acs-date': formattedDate,
        'x-acs-region-id': REGION_ID,
        'x-acs-version': API_VERSION,
        // x-acs-request-id 作为 nonce 可选；不影响 signature 参数，只要加入签名头数组保持一致即可
        'x-acs-request-id': (Date.now().toString() + Math.random().toString(36).substr(2, 9))
    };

    const signedHeadersKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
    let canonicalHeaders = '';
    for (const k of signedHeadersKeys) {
        // header values should be trimmed and duplicate spaces compressed (basic)
        const v = String(headers[k]).trim();
        canonicalHeaders += `${k}:${v}\n`;
    }
    const signedHeaders = signedHeadersKeys.join(';');

    // CanonicalRequest
    const canonicalRequest = [
        httpMethod,
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders,
        signedHeaders,
        contentHash
    ].join('\n');

    // StringToSign
    const canonicalRequestHash = await hashSha256Hex(canonicalRequest);
    const stringToSign = [
        SIGNATURE_ALGORITHM,
        formattedDate,
        canonicalRequestHash
    ].join('\n');

    // Derive signing key per ACS3:
    // kSecret = "ACS3" + accessKeySecret
    // kDate = HMAC_SHA256(kSecret, shortDate)
    // kRegion = HMAC_SHA256(kDate, region)
    // kService = HMAC_SHA256(kRegion, service)
    // kSigning = HMAC_SHA256(kService, "acs_request")
    const encoder = new TextEncoder();
    const kSecret = encoder.encode('ACS3' + accessKeySecret);

    const kDateBuf = await hmacSha256Raw(kSecret, shortDate);
    const kRegionBuf = await hmacSha256Raw(kDateBuf, REGION_ID);
    const kServiceBuf = await hmacSha256Raw(kRegionBuf, SERVICE_NAME);
    const kSigningBuf = await hmacSha256Raw(kServiceBuf, 'acs_request');

    const signatureBuf = await hmacSha256Raw(kSigningBuf, stringToSign);
    const signatureHex = arrayBufferToHex(signatureBuf);

    // Authorization header must include credential scope: accessKeyId/shortDate/region/service/acs_request
    const credentialScope = `${shortDate}/${REGION_ID}/${SERVICE_NAME}/acs_request`;
    const authorization = `${SIGNATURE_ALGORITHM} Credential=${accessKeyId}/${credentialScope},SignedHeaders=${signedHeaders},Signature=${signatureHex}`;

    // 返回最终请求所需的头部和 JSON 请求体
    // 注意：不要把 Authorization 包含到 canonicalHeaders / signedHeaders 内（签名时没包含 authorization）
    const outHeaders = {
        ...headers,
        Authorization: authorization,
        Accept: 'application/json',
        // Content-Type 在 headers 已经存在，保持一致
    };

    return {
        headers: outHeaders,
        body: bodyString,
        endpointQuery: canonicalQueryString // 方便调用者拼接请求 URL
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
  
  // 签名 V3 请求（修正后）
  const signedRequest = await signV3Request(accessKeyId, accessKeySecret, requestBody, now);
  
  // 拼接 endpoint（包含 canonicalQueryString）
  const endpoint = `https://${SERVICE_HOST}/?${signedRequest.endpointQuery}`;

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
    throw new Error(result.Message || JSON.stringify(result) || '发送验证码失败');
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


