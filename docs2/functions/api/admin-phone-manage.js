// functions/api/admin-phone-manage.js - 管理授权手机号码
export async function onRequestPost(context) {
  const { env, request } = context;
  
  try {
    const body = await request.json();
    const { action, phoneNumber, sessionId } = body;

    if (!sessionId) {
      return new Response(JSON.stringify({ error: '会话无效' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // 验证超级管理员会话
    const sessionData = await env.ADMIN_SESSIONS.get(sessionId);
    if (!sessionData) {
      return new Response(JSON.stringify({ error: '会话已过期，请重新登录' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

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

    // 获取当前授权手机号码列表
    // 优先从 KV 存储读取，如果没有则从环境变量读取
    let currentPhones = '';
    try {
      currentPhones = await env.ADMIN_CONFIG.get('AUTHORIZED_PHONES') || '';
    } catch (err) {
      // 如果 KV 不存在，使用环境变量
      currentPhones = env.ADMIN_AUTHORIZED_PHONES || '';
    }
    
    const phoneList = currentPhones.split(',')
      .map(phone => phone.trim())
      .filter(phone => phone && phoneRegex.test(phone));

    if (action === 'add') {
      // 检查是否已存在
      if (phoneList.includes(phoneNumber)) {
        return new Response(JSON.stringify({ error: '该手机号码已存在' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      // 添加新手机号码
      phoneList.push(phoneNumber);
      const newPhonesStr = phoneList.join(',');

      // 注意：在实际部署中，环境变量通常不能直接修改
      // 这里假设使用 KV 存储来管理手机号码列表
      await env.ADMIN_CONFIG.put('AUTHORIZED_PHONES', newPhonesStr);

      return new Response(JSON.stringify({ 
        success: true, 
        message: '手机号码添加成功',
        phoneNumber: phoneNumber
      }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });

    } else if (action === 'delete') {
      // 检查是否存在
      if (!phoneList.includes(phoneNumber)) {
        return new Response(JSON.stringify({ error: '该手机号码不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      // 删除手机号码
      const updatedList = phoneList.filter(phone => phone !== phoneNumber);
      const newPhonesStr = updatedList.join(',');

      // 更新存储
      await env.ADMIN_CONFIG.put('AUTHORIZED_PHONES', newPhonesStr);

      return new Response(JSON.stringify({ 
        success: true, 
        message: '手机号码删除成功',
        phoneNumber: phoneNumber
      }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });

    } else {
      return new Response(JSON.stringify({ error: '无效的操作类型' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

  } catch (error) {
    console.error('Phone manage error:', error);
    return new Response(JSON.stringify({ error: '操作失败' }), {
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
