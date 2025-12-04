// functions/api/admin-debug.js - 调试API，用于检查环境配置
export async function onRequestGet(context) {
  const { env } = context;
  
  try {
    const debugInfo = {
      timestamp: new Date().toISOString(),
      environment: {},
      kvStatus: 'unknown',
      currentPhones: '',
      sessionsStatus: 'unknown'
    };

    // 检查环境变量
    debugInfo.environment = {
      ADMIN_PASSWORD: env.ADMIN_PASSWORD ? '已设置' : '未设置',
      ADMIN_AUTHORIZED_PHONES: env.ADMIN_AUTHORIZED_PHONES || '未设置',
      ALIYUN_ACCESS_KEY_ID: env.ALIYUN_ACCESS_KEY_ID ? '已设置' : '未设置',
      ALIYUN_ACCESS_KEY_SECRET: env.ALIYUN_ACCESS_KEY_SECRET ? '已设置' : '未设置',
      ALIYUN_SMS_SIGN_NAME: env.ALIYUN_SMS_SIGN_NAME || '未设置',
      ALIYUN_SMS_TEMPLATE_CODE: env.ALIYUN_SMS_TEMPLATE_CODE || '未设置'
    };

    // 检查KV存储
    try {
      if (env.ADMIN_CONFIG) {
        debugInfo.kvStatus = '已绑定';
        const phones = await env.ADMIN_CONFIG.get('AUTHORIZED_PHONES');
        debugInfo.currentPhones = phones || '空值';
      } else {
        debugInfo.kvStatus = '未绑定';
      }
    } catch (kvError) {
      debugInfo.kvStatus = '错误: ' + kvError.message;
    }

    // 检查会话存储
    try {
      if (env.ADMIN_SESSIONS) {
        debugInfo.sessionsStatus = '已绑定';
        const sessions = await env.ADMIN_SESSIONS.list();
        debugInfo.activeSessions = sessions.keys.length;
      } else {
        debugInfo.sessionsStatus = '未绑定';
      }
    } catch (sessionError) {
      debugInfo.sessionsStatus = '错误: ' + sessionError.message;
    }

    // 测试KV写入
    try {
      if (env.ADMIN_CONFIG) {
        const testKey = 'test-' + Date.now();
        await env.ADMIN_CONFIG.put(testKey, 'test-value');
        await env.ADMIN_CONFIG.delete(testKey);
        debugInfo.kvWriteTest = '成功';
      } else {
        debugInfo.kvWriteTest = '跳过（KV未绑定）';
      }
    } catch (writeError) {
      debugInfo.kvWriteTest = '失败: ' + writeError.message;
    }

    return new Response(JSON.stringify(debugInfo, null, 2), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: '调试信息获取失败',
      details: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  
  try {
    const body = await request.json();
    const { sessionId } = body;

    const debugInfo = {
      timestamp: new Date().toISOString(),
      sessionId: sessionId || '未提供',
      sessionValid: false,
      sessionData: null
    };

    if (sessionId && env.ADMIN_SESSIONS) {
      try {
        const sessionData = await env.ADMIN_SESSIONS.get(sessionId);
        debugInfo.sessionValid = !!sessionData;
        debugInfo.sessionData = sessionData;
      } catch (sessionError) {
        debugInfo.sessionError = sessionError.message;
      }
    }

    return new Response(JSON.stringify(debugInfo, null, 2), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: '会话调试失败',
      details: error.message,
      stack: error.stack
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}
