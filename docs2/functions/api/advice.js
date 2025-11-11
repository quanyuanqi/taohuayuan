// functions/api/advice.js
export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const method = request.method;
  const pathParts = url.pathname.split('/');
  const adviceId = pathParts[pathParts.length - 1]; // 获取 URL 最后一部分作为 ID
  
  console.log('[API] Advice request received:', {
    method,
    pathname: url.pathname,
    pathParts,
    adviceId
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
    const session = await env.ADMIN_SESSIONS.get(token);
    if (session !== 'authenticated') {
      return new Response(JSON.stringify({ error: '操作失败，请尝试重新登录，或刷新页面，以确保安全。' }), {
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
    if (method === 'GET') {
      // 获取所有建言（只返回已审核通过的）
      const list = await env.ADVICE_KV.list();
      const advices = [];

      for (const key of list.keys) {
        const advice = await env.ADVICE_KV.get(key.name, 'json');
        if (advice && advice.approved) {
          advices.push({ id: key.name, ...advice });
        }
      }

      // 按时间倒序排列
      advices.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      return new Response(JSON.stringify(advices), {
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
      // 创建新建言（用户提交，默认未审核）
      const body = await request.json();
      const { title, content, author, attachments = [] } = body;

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

      const newAdvice = {
        id: `advice-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title,
        content,
        author: author || '匿名',
        attachments,
        approved: false, // 默认未审核
        date: new Date().toISOString(),
        createdAt: Date.now()
      };

      await env.ADVICE_KV.put(newAdvice.id, JSON.stringify(newAdvice));
      
      return new Response(JSON.stringify({ success: true, id: newAdvice.id }), {
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

    } else if (method === 'PUT' && adviceId && adviceId !== 'advice') {
      // 更新建言（管理员审核或编辑）
      const existing = await env.ADVICE_KV.get(adviceId, 'json');
      
      if (!existing) {
        return new Response(JSON.stringify({ error: '建言不存在' }), {
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
      const { title, content, author, attachments = [], approved } = body;
      
      if (title !== undefined && content !== undefined && !title && !content) {
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

      const updatedAdvice = {
        ...existing,
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(author !== undefined && { author }),
        ...(attachments !== undefined && { attachments }),
        ...(approved !== undefined && { approved }),
        updatedAt: Date.now()
      };

      await env.ADVICE_KV.put(adviceId, JSON.stringify(updatedAdvice));
      
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

    } else if (method === 'DELETE' && adviceId && adviceId !== 'advice') {
      // 删除建言
      const existing = await env.ADVICE_KV.get(adviceId);
      
      if (!existing) {
        return new Response(JSON.stringify({ error: '建言不存在' }), {
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

      await env.ADVICE_KV.delete(adviceId);
      
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

    } else {
      return new Response(JSON.stringify({ 
        error: '方法不支持',
        debug: { method, adviceId, pathname: url.pathname }
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
    console.error('[ERROR] Advice API error:', error);
    return new Response(JSON.stringify({ 
      error: '操作失败',
      debug: {
        message: error.message,
        method,
        adviceId,
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

