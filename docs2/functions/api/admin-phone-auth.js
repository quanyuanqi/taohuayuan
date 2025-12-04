// functions/api/admin-phone-auth.js - 管理员手机号码授权验证
export async function onRequestPost(context) {
  const { env, request } = context;
  
  try {
    const body = await request.json();
    const { phoneNumber, action } = body;

    if (!phoneNumber) {
      return new Response(JSON.stringify({ error: '手机号不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // 验证手机号格式
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return new Response(JSON.stringify({ error: '手机号格式不正确' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    if (action === 'check') {
      // 检查手机号是否在授权管理员列表中
      // 优先从 KV 存储读取，如果没有则从环境变量读取
      let authorizedPhones = '';
      try {
        authorizedPhones = await env.ADMIN_CONFIG.get('AUTHORIZED_PHONES') || '';
      } catch (err) {
        // 如果 KV 不存在，使用环境变量
        authorizedPhones = env.ADMIN_AUTHORIZED_PHONES || '';
      }
      
      const phoneList = authorizedPhones.split(',').map(phone => phone.trim()).filter(phone => phone);
      
      const isAuthorized = phoneList.includes(phoneNumber);
      
      if (!isAuthorized) {
        return new Response(JSON.stringify({ 
          error: '该手机号未授权访问管理后台',
          code: 'UNAUTHORIZED_PHONE'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      // 检查是否已经通过短信验证
      const smsVerifyKey = `admin-sms-verified:${phoneNumber}`;
      const verified = await env.ADMIN_SESSIONS.get(smsVerifyKey);
      
      if (!verified) {
        return new Response(JSON.stringify({ 
          error: '请先完成短信验证',
          code: 'SMS_NOT_VERIFIED'
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      // 生成管理员会话
      const sessionId = `admin-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await env.ADMIN_SESSIONS.put(sessionId, JSON.stringify({
        phoneNumber: phoneNumber,
        authenticated: true,
        createdAt: Date.now()
      }), { expirationTtl: 7200 }); // 2小时过期
      
      return new Response(JSON.stringify({ 
        success: true, 
        sessionId,
        message: '管理员身份验证成功'
      }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });

    } else if (action === 'verify-sms') {
      // 标记该手机号已通过短信验证（由sms-verify.js验证成功后调用）
      const smsVerifyKey = `admin-sms-verified:${phoneNumber}`;
      await env.ADMIN_SESSIONS.put(smsVerifyKey, 'verified', { expirationTtl: 300 }); // 5分钟有效期
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: '短信验证状态已记录'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });

    } else {
      return new Response(JSON.stringify({ error: '无效的操作类型' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

  } catch (error) {
    console.error('Admin phone auth error:', error);
    return new Response(JSON.stringify({ error: '验证失败' }), {
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
