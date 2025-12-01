// functions/api/sms-verify.js - 阿里云短信认证服务API (含SignatureNonce)

// --- 短信服务配置 ---
const SERVICE_HOST = 'dysmsapi.aliyuncs.com';
const API_VERSION = '2017-05-25';
const API_ACTION = 'SendSms';

/**
 * URL编码函数（符合阿里云要求）
 */
function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 生成随机数作为SignatureNonce
 */
function generateSignatureNonce() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

/**
 * 计算阿里云API签名
 */
async function computeSignature(params, accessKeySecret) {
  // 1. 参数排序
  const sortedKeys = Object.keys(params).sort();
  
  // 2. 构建规范请求字符串
  const canonicalString = sortedKeys
    .map(key => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
  
  // 3. 构建待签名字符串 (格式: HTTP_METHOD&URL_ENCODED(/)&URL_ENCODED(CANONICAL_STRING))
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalString)}`;
  
  // 4. 使用HMAC-SHA1计算签名
  const encoder = new TextEncoder();
  const keyData = encoder.encode(accessKeySecret + '&'); // 阿里云要求在密钥后加 &
  const messageData = encoder.encode(stringToSign);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const signatureArray = Array.from(new Uint8Array(signature));
  const signatureBase64 = btoa(String.fromCharCode.apply(null, signatureArray));
  
  return signatureBase64;
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

  // 生成6位数字验证码
  const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
  
  // 存储验证码到 KV（5分钟过期）
  const kvKey = `sms-verify:${phoneNumber}`;
  await env.ADVICES_KV.put(kvKey, JSON.stringify({
    code: verifyCode,
    phoneNumber: phoneNumber,
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000 // 5分钟过期
  }), { 
    expirationTtl: 300 // 5分钟
  });

  // 当前时间戳（ISO格式，阿里云要求）
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  
  // 生成随机数作为SignatureNonce
  const signatureNonce = generateSignatureNonce();
  
  // 构建请求参数
  const params = {
    'AccessKeyId': accessKeyId,
    'Action': API_ACTION,
    'Format': 'JSON',
    'OutId': `verify-${Date.now()}`, // 可选：外部流水号
    'PhoneNumbers': phoneNumber,
    'RegionId': 'cn-hangzhou', // 阿里云区域ID
    'SignName': signName,
    'TemplateCode': templateCode,
    'TemplateParam': JSON.stringify({ code: verifyCode }),
    'Timestamp': timestamp, // 阿里云要求的时间戳格式
    'SignatureMethod': 'HMAC-SHA1', // 指定签名方法
    'SignatureNonce': signatureNonce, // 防重放攻击的随机数
    'SignatureVersion': '1.0', // 签名版本
    'Version': API_VERSION
  };

  // 计算签名
  const signature = await computeSignature(params, accessKeySecret);
  params.Signature = signature;

  // 构建请求体
  const requestBody = Object.keys(params)
    .map(key => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');

  const endpoint = `https://${SERVICE_HOST}/`;

  console.log('[SMS] Request URL:', endpoint);
  console.log('[SMS] Request Params:', params);

  // 发送请求到阿里云
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: requestBody
  });

  const result = await response.json();
  
  if (response.status === 200 && result.Code === 'OK') {
    console.log('[SMS] Send success:', result);
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

    // 验证手机号格式（11位数字，以1开头）
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (phoneNumber && !phoneRegex.test(phoneNumber)) {
      return new Response(JSON.stringify({ error: '手机号格式不正确' }), {
        status: 400,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (action === 'send') {
      if (!phoneNumber) {
        return new Response(JSON.stringify({ error: '手机号不能为空' }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // 检查发送频率限制（同一手机号1分钟内只能发送1次）
      const rateLimitKey = `sms-rate:${phoneNumber}`;
      const lastSend = await env.ADVICES_KV.get(rateLimitKey);
      if (lastSend) {
        const lastSendTime = parseInt(lastSend);
        if (Date.now() - lastSendTime < 60000) { // 1分钟内
          return new Response(JSON.stringify({ error: '发送过于频繁，请稍后再试' }), {
            status: 429,
            headers: { 
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      }

      const result = await sendVerifyCode(phoneNumber, env);
      
      // 记录发送时间（1分钟后自动过期）
      await env.ADVICES_KV.put(rateLimitKey, Date.now().toString(), { 
        expirationTtl: 60 
      });
      
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });

    } else if (action === 'check') {
      if (!phoneNumber || !code) {
        return new Response(JSON.stringify({ error: '手机号和验证码不能为空' }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      const result = await checkVerifyCode(phoneNumber, code, env);
      
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });

    } else {
      return new Response(JSON.stringify({ error: '无效的操作类型' }), {
        status: 400,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
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
      headers: { 
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// 处理预检请求
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
