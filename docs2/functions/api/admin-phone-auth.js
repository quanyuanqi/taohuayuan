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

    if (action === 'verify') {
      // 直接验证短信验证码和授权（一步完成）
      if (!code) {
        return new Response(JSON.stringify({ error: '验证码不能为空' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      console.log('[ADMIN-PHONE-AUTH] 开始统一验证:', { phoneNumber, code: code.substring(0, 2) + '****' });

      // 第一步：验证短信验证码
      const kvKey = `sms-verify:${phoneNumber}`;
      const stored = await env.ADVICES_KV.get(kvKey, 'json');
      
      if (!stored) {
        console.log('[ADMIN-PHONE-AUTH] 验证码不存在');
        return new Response(JSON.stringify({ error: '验证码不存在或已过期' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      if (Date.now() > stored.expiresAt) {
        console.log('[ADMIN-PHONE-AUTH] 验证码已过期');
        await env.ADVICES_KV.delete(kvKey);
        return new Response(JSON.stringify({ error: '验证码已过期' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      if (stored.code !== code) {
        console.log('[ADMIN-PHONE-AUTH] 验证码错误');
        return new Response(JSON.stringify({ error: '验证码错误' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      console.log('[ADMIN-PHONE-AUTH] 短信验证成功，开始检查授权');

      // 第二步：检查管理员授权
      const phoneList = authorizedPhones.split(',').map(phone => phone.trim()).filter(phone => phone);
      const isAuthorized = phoneList.includes(phoneNumber);
      
      console.log('[ADMIN-PHONE-AUTH] 授权检查:', { 
        authorizedPhones, 
        phoneList, 
        phoneNumber, 
        isAuthorized 
      });

      if (!isAuthorized) {
        // 验证成功但删除验证码（防止重复使用）
        await env.ADVICES_KV.delete(kvKey);
        return new Response(JSON.stringify({ 
          error: '该手机号未授权访问管理后台',
          code: 'UNAUTHORIZED_PHONE'
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      // 第三步：验证成功，生成会话
      const sessionId = `admin-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      await env.ADMIN_SESSIONS.put(sessionId, JSON.stringify({
        phoneNumber: phoneNumber,
        authenticated: true,
        createdAt: Date.now()
      }), { expirationTtl: 7200 }); // 2小时过期

      // 验证成功后删除验证码（防止重复使用）
      await env.ADVICES_KV.delete(kvKey);

      console.log('[ADMIN-PHONE-AUTH] 验证成功，生成会话:', sessionId);

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

    } else if (action === 'check') {
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
