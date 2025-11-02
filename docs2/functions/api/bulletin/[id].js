// functions/api/bulletin/[id].js
// This handles /api/bulletin/{id} for PUT and DELETE methods
export async function onRequest(context) {
  const { env, request, params } = context;
  const { id: bulletinId } = params;
  const url = new URL(request.url);
  const method = request.method;

  console.log('[API] [id] Request received:', {
    method,
    pathname: url.pathname,
    bulletinId,
    params,
    hasAuth: !!request.headers.get('Authorization')
  });

  // CORS preflight
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

  // Check admin auth for non-GET requests
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
    const session = await env.ADMIN_SESSIONS.get(token);
    if (session !== 'authenticated') {
      return new Response(JSON.stringify({ error: '发布失败，请尝试重新登录，或刷新页面，以确保安全。' }), {
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

  try {
    if (method === 'PUT') {
      // Update bulletin
      console.log('[PUT] [id] Updating bulletin:', bulletinId);
      const existing = await env.BULLETIN_KV.get(bulletinId, 'json');
      
      if (!existing) {
        console.log('[PUT] [id] Bulletin not found');
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
      console.log('[PUT] [id] Bulletin updated successfully');
      
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

    } else if (method === 'DELETE') {
      // Delete bulletin
      console.log('[DELETE] [id] Received delete request for bulletinId:', bulletinId);
      
      const existing = await env.BULLETIN_KV.get(bulletinId);
      console.log('[DELETE] [id] Existing bulletin found:', existing ? 'yes' : 'no');
      
      if (!existing) {
        console.log('[DELETE] [id] Bulletin not found, returning 404');
        return new Response(JSON.stringify({ error: '公告不存在', debug: { bulletinId } }), {
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

      console.log('[DELETE] [id] Attempting to delete bulletin:', bulletinId);
      await env.BULLETIN_KV.delete(bulletinId);
      console.log('[DELETE] [id] Bulletin deleted successfully');
      
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
      console.log('[API] [id] Method not supported:', method);
      return new Response(JSON.stringify({ 
        error: '方法不支持',
        debug: { method, bulletinId }
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
    console.error('[ERROR] [id] API error:', error);
    console.error('[ERROR] [id] Error details:', {
      message: error.message,
      stack: error.stack,
      method,
      bulletinId
    });
    return new Response(JSON.stringify({ 
      error: '操作失败',
      debug: {
        message: error.message,
        method,
        bulletinId
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


