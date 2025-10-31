// functions/api/admin-auth.js
export async function onRequestPost(context) {
  const { env, request } = context;
  
  try {
    const body = await request.json();
    const { password } = body;

    if (!password) {
      return new Response(JSON.stringify({ error: '密码不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (password !== env.BULLETIN_PASS) {
      return new Response(JSON.stringify({ error: '密码错误' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 设置临时会话（可选：使用 KV 存储会话）
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await env.ADMIN_SESSIONS.put(sessionId, 'authenticated', { expirationTtl: 3600 }); // 1小时过期
    
    return new Response(JSON.stringify({ 
      success: true, 
      sessionId 
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  } catch (error) {
    console.error('Auth error:', error);
    return new Response(JSON.stringify({ error: '验证失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
