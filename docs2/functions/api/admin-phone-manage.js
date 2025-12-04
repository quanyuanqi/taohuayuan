// functions/api/admin-phone-manage.js - 管理授权手机号码
export async function onRequestPost(context) {
  const { env, request } = context;
  
  try {
    const body = await request.json();
    const { action, phoneNumber, sessionId } = body;

    console.log('[ADMIN-PHONE-MANAGE] 收到请求:', { action, phoneNumber, sessionId: sessionId ? '已提供' : '未提供' });

    // 验证会话
    if (!sessionId) {
      console.log('[ADMIN-PHONE-MANAGE] 错误: 会话ID未提供');
      return new Response(JSON.stringify({ error: '会话无效，请重新登录' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // 验证超级管理员会话
    let sessionData = null;
    try {
      sessionData = await env.ADMIN_SESSIONS.get(sessionId);
      console.log('[ADMIN-PHONE-MANAGE] 会话数据:', sessionData);
    } catch (sessionError) {
      console.error('[ADMIN-PHONE-MANAGE] 会话查询失败:', sessionError);
      return new Response(JSON.stringify({ error: '会话查询失败: ' + sessionError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    if (!sessionData) {
      console.log('[ADMIN-PHONE-MANAGE] 错误: 会话不存在或已过期');
      return new Response(JSON.stringify({ error: '会话已过期，请重新登录' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // 验证手机号
    if (!phoneNumber) {
      console.log('[ADMIN-PHONE-MANAGE] 错误: 手机号未提供');
      return new Response(JSON.stringify({ error: '手机号不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // 验证手机号格式
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phoneNumber)) {
      console.log('[ADMIN-PHONE-MANAGE] 错误: 手机号格式不正确:', phoneNumber);
      return new Response(JSON.stringify({ error: '手机号格式不正确' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // 获取当前授权手机号码列表
    let currentPhones = '';
    let useKvStorage = false;
    
    try {
      // 尝试从KV存储读取
      if (env.ADMIN_CONFIG) {
        currentPhones = await env.ADMIN_CONFIG.get('AUTHORIZED_PHONES') || '';
        useKvStorage = true;
        console.log('[ADMIN-PHONE-MANAGE] 从KV存储读取手机号列表:', currentPhones);
      }
    } catch (kvError) {
      console.log('[ADMIN-PHONE-MANAGE] KV存储不可用:', kvError.message);
      useKvStorage = false;
    }

    // 如果KV不可用，尝试从环境变量读取
    if (!useKvStorage || !currentPhones) {
      currentPhones = env.ADMIN_AUTHORIZED_PHONES || '';
      console.log('[ADMIN-PHONE-MANAGE] 从环境变量读取手机号列表:', currentPhones);
    }
    
    const phoneList = currentPhones.split(',')
      .map(phone => phone.trim())
      .filter(phone => phone && phoneRegex.test(phone));

    console.log('[ADMIN-PHONE-MANAGE] 解析后的手机号列表:', phoneList);

    if (action === 'add') {
      // 检查是否已存在
      if (phoneList.includes(phoneNumber)) {
        console.log('[ADMIN-PHONE-MANAGE] 错误: 手机号已存在:', phoneNumber);
        return new Response(JSON.stringify({ error: '该手机号码已存在' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      // 添加新手机号码
      phoneList.push(phoneNumber);
      const newPhonesStr = phoneList.join(',');

      console.log('[ADMIN-PHONE-MANAGE] 准备保存的新手机号列表:', newPhonesStr);

      // 保存更新后的列表
      try {
        if (useKvStorage && env.ADMIN_CONFIG) {
          await env.ADMIN_CONFIG.put('AUTHORIZED_PHONES', newPhonesStr);
          console.log('[ADMIN-PHONE-MANAGE] KV存储更新成功');
        } else {
          console.log('[ADMIN-PHONE-MANAGE] KV存储不可用，无法持久化保存');
          return new Response(JSON.stringify({ 
            error: 'KV存储未配置，无法保存手机号码。请配置ADMIN_CONFIG KV命名空间。',
            debug: {
              currentList: phoneList,
              newList: newPhonesStr,
              instruction: '请将此字符串设置为环境变量ADMIN_AUTHORIZED_PHONES: ' + newPhonesStr
            }
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }

        return new Response(JSON.stringify({ 
          success: true, 
          message: '手机号码添加成功',
          phoneNumber: phoneNumber,
          currentList: phoneList,
          storage: useKvStorage ? 'KV存储' : '环境变量'
        }), {
          status: 200,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });

      } catch (saveError) {
        console.error('[ADMIN-PHONE-MANAGE] 保存失败:', saveError);
        return new Response(JSON.stringify({ 
          error: '保存手机号码失败: ' + saveError.message,
          debug: {
            attemptedList: newPhonesStr,
            storageMethod: useKvStorage ? 'KV存储' : '环境变量'
          }
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

    } else if (action === 'delete') {
      // 检查是否存在
      if (!phoneList.includes(phoneNumber)) {
        console.log('[ADMIN-PHONE-MANAGE] 错误: 手机号不存在:', phoneNumber);
        return new Response(JSON.stringify({ error: '该手机号码不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      // 删除手机号码
      const updatedList = phoneList.filter(phone => phone !== phoneNumber);
      const newPhonesStr = updatedList.join(',');

      console.log('[ADMIN-PHONE-MANAGE] 准备删除后的手机号列表:', newPhonesStr);

      // 保存更新后的列表
      try {
        if (useKvStorage && env.ADMIN_CONFIG) {
          await env.ADMIN_CONFIG.put('AUTHORIZED_PHONES', newPhonesStr);
          console.log('[ADMIN-PHONE-MANAGE] KV存储更新成功');
        } else {
          console.log('[ADMIN-PHONE-MANAGE] KV存储不可用，无法持久化保存');
          return new Response(JSON.stringify({ 
            error: 'KV存储未配置，无法删除手机号码。请配置ADMIN_CONFIG KV命名空间。',
            debug: {
              currentList: updatedList,
              newList: newPhonesStr,
              instruction: '请将此字符串设置为环境变量ADMIN_AUTHORIZED_PHONES: ' + newPhonesStr
            }
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }

        return new Response(JSON.stringify({ 
          success: true, 
          message: '手机号码删除成功',
          phoneNumber: phoneNumber,
          currentList: updatedList,
          storage: useKvStorage ? 'KV存储' : '环境变量'
        }), {
          status: 200,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          }
        });

      } catch (saveError) {
        console.error('[ADMIN-PHONE-MANAGE] 删除失败:', saveError);
        return new Response(JSON.stringify({ 
          error: '删除手机号码失败: ' + saveError.message,
          debug: {
            attemptedList: newPhonesStr,
            storageMethod: useKvStorage ? 'KV存储' : '环境变量'
          }
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

    } else {
      console.log('[ADMIN-PHONE-MANAGE] 错误: 无效的操作类型:', action);
      return new Response(JSON.stringify({ error: '无效的操作类型' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

  } catch (error) {
    console.error('[ADMIN-PHONE-MANAGE] 未知错误:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    return new Response(JSON.stringify({ 
      error: '操作失败: ' + error.message,
      details: {
        name: error.name,
        stack: error.stack
      }
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
