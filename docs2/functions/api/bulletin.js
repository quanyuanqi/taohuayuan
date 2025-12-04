// functions/api/bulletin.js
export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const method = request.method;
  const pathParts = url.pathname.split('/');
  const bulletinId = pathParts[pathParts.length - 1]; // 获取 URL 最后一部分作为 ID
  
  console.log('[API] Request received:', {
    method,
    pathname: url.pathname,
    pathParts,
    bulletinId,
    hasAuth: !!request.headers.get('Authorization')
  });

  // CORS 预检
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  // 检查管理员权限（对于非 GET 请求）
  if (method !== 'GET' && method !== 'HEAD') {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: '未授权访问' }), {
        status: 401,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const sessionData = await env.ADMIN_SESSIONS.get(token);
    
    // 检查会话是否存在且有效
    if (!sessionData) {
      return new Response(JSON.stringify({ error: '会话已过期，请重新登录' }), {
        status: 401,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }

    // 检查会话是否为超级管理员或已授权的手机号码
    try {
      const parsedSession = JSON.parse(sessionData);
      if (!parsedSession.authenticated && sessionData !== 'authenticated') {
        return new Response(JSON.stringify({ error: '无效的会话类型' }), {
          status: 401,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        });
      }
    } catch (parseErr) {
      // 兼容旧的字符串格式会话
      if (sessionData !== 'authenticated') {
        return new Response(JSON.stringify({ error: '会话验证失败，请重新登录' }), {
          status: 401,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        });
      }
    }
  }

  try {
    if (method === 'GET') {
      // 获取所有公告
      const list = await env.BULLETIN_KV.list();
      const bulletins = [];

      for (const key of list.keys) {
        const bulletin = await env.BULLETIN_KV.get(key.name, 'json');
        if (bulletin) {
          bulletins.push({ id: key.name, ...bulletin });
        }
      }

      // 按时间倒序排列
      bulletins.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      return new Response(JSON.stringify(bulletins), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=30',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });

    } else if (method === 'POST') {
      // 创建新公告
      const body = await request.json();
      const { title, content, attachments = [] } = body;

      if (!title || !content) {
        return new Response(JSON.stringify({ error: '标题和内容不能为空' }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        });
      }

      const newBulletin = {
        id: `bulletin-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title,
        content,
        attachments,
        date: new Date().toISOString(),
        createdAt: Date.now()
      };

      await env.BULLETIN_KV.put(newBulletin.id, JSON.stringify(newBulletin));
      
      return new Response(JSON.stringify({ success: true, id: newBulletin.id }), {
        status: 201,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });

    } else if (method === 'PUT' && bulletinId && bulletinId !== 'bulletin') {
      // 更新公告
      const existing = await env.BULLETIN_KV.get(bulletinId, 'json');
      
      if (!existing) {
        return new Response(JSON.stringify({ error: '公告不存在' }), {
          status: 404,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        });
      }

      const body = await request.json();
      const { title, content, attachments = [] } = body;
      
      if (!title || !content) {
        return new Response(JSON.stringify({ error: '标题和内容不能为空' }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        });
      }

      const updatedBulletin = {
        ...existing,
        title,
        content,
        attachments,
        updatedAt: Date.now()
      };

      await env.BULLETIN_KV.put(bulletinId, JSON.stringify(updatedBulletin));
      
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });

    } else if (method === 'DELETE' && bulletinId && bulletinId !== 'bulletin') {
      // 删除公告
      console.log('[DELETE] Received delete request for bulletinId:', bulletinId);
      console.log('[DELETE] URL pathname:', url.pathname);
      console.log('[DELETE] Path parts:', pathParts);
      
      const existing = await env.BULLETIN_KV.get(bulletinId);
      console.log('[DELETE] Existing bulletin found:', existing ? 'yes' : 'no');
      
      if (!existing) {
        console.log('[DELETE] Bulletin not found, returning 404');
        return new Response(JSON.stringify({ error: '公告不存在', debug: { bulletinId, pathname: url.pathname } }), {
          status: 404,
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        });
      }

      console.log('[DELETE] Attempting to delete bulletin:', bulletinId);
      await env.BULLETIN_KV.delete(bulletinId);
      console.log('[DELETE] Bulletin deleted successfully');
      
      return new Response(JSON.stringify({ success: true, debug: { bulletinId } }), {
        status: 200,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });

    } else {
      console.log('[API] Method not supported or route mismatch:', {
        method,
        bulletinId,
        condition: `method === 'DELETE': ${method === 'DELETE'}, bulletinId: ${bulletinId}, bulletinId !== 'bulletin': ${bulletinId !== 'bulletin'}`
      });
      return new Response(JSON.stringify({ 
        error: '方法不支持',
        debug: { method, bulletinId, pathname: url.pathname }
      }), {
        status: 405,
        headers: { 
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }
  } catch (error) {
    console.error('[ERROR] Bulletin API error:', error);
    console.error('[ERROR] Method:', method);
    console.error('[ERROR] BulletinId:', bulletinId);
    console.error('[ERROR] Pathname:', url.pathname);
    console.error('[ERROR] Error stack:', error.stack);
    return new Response(JSON.stringify({ 
      error: '操作失败',
      debug: {
        message: error.message,
        method,
        bulletinId,
        pathname: url.pathname
      }
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }
}


