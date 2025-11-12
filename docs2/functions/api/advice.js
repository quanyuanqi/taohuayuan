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

  // 检查管理员权限（对于 PUT 和 DELETE 请求，POST 允许公开提交）
  if (method === 'PUT' || method === 'DELETE') {
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
      const list = await env.ADVICES_KV.list();
      const advices = [];

      for (const key of list.keys) {
        const advice = await env.ADVICES_KV.get(key.name, 'json');
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
      const name = body.name ?? body.author;
      const building = body.building;
      const contact = body.contact ?? body.title;
      const description = body.description ?? body.content ?? '';
      const attachments = Array.isArray(body.attachments) ? body.attachments : (body.attachments ? [body.attachments] : []);

      if (!name || !name.trim()) {
        return new Response(JSON.stringify({ error: '姓名不能为空' }), {
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

      if (!building || !building.trim()) {
        return new Response(JSON.stringify({ error: '楼栋号不能为空' }), {
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

      if (!contact || !contact.trim()) {
        return new Response(JSON.stringify({ error: '联系方式不能为空' }), {
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
        name: name.trim(),
        building: building.trim(),
        contact: contact.trim(),
        description: description ? description.trim() : '',
        attachments,
        approved: false, // 默认未审核
        date: new Date().toISOString(),
        createdAt: Date.now()
      };

      await env.ADVICES_KV.put(newAdvice.id, JSON.stringify(newAdvice));
      
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
      const existing = await env.ADVICES_KV.get(adviceId, 'json');
      
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
      const updatedAdvice = { ...existing };
      let changed = false;

      if (body.name !== undefined) {
        if (!body.name || !body.name.trim()) {
          return new Response(JSON.stringify({ error: '姓名不能为空' }), {
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
        updatedAdvice.name = body.name.trim();
        changed = true;
      }

      if (body.building !== undefined) {
        if (!body.building || !body.building.trim()) {
          return new Response(JSON.stringify({ error: '楼栋号不能为空' }), {
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
        updatedAdvice.building = body.building.trim();
        changed = true;
      }

      if (body.contact !== undefined) {
        if (!body.contact || !body.contact.trim()) {
          return new Response(JSON.stringify({ error: '联系方式不能为空' }), {
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
        updatedAdvice.contact = body.contact.trim();
        changed = true;
      }

      if (body.description !== undefined) {
        updatedAdvice.description = body.description ? body.description.trim() : '';
        changed = true;
      }

      if (body.attachments !== undefined) {
        updatedAdvice.attachments = Array.isArray(body.attachments) ? body.attachments : [];
        changed = true;
      }

      if (body.approved !== undefined) {
        updatedAdvice.approved = body.approved;
        changed = true;
      }

      // 兼容旧字段
      if (body.title !== undefined) {
        updatedAdvice.contact = body.title;
        changed = true;
      }
      if (body.content !== undefined) {
        updatedAdvice.description = body.content;
        changed = true;
      }
      if (body.author !== undefined) {
        updatedAdvice.name = body.author;
        changed = true;
      }

      if (!changed) {
        return new Response(JSON.stringify({ error: '未提交任何可更新的字段' }), {
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

      updatedAdvice.updatedAt = Date.now();

      await env.ADVICES_KV.put(adviceId, JSON.stringify(updatedAdvice));
      
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
      const existing = await env.ADVICES_KV.get(adviceId);
      
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

      await env.ADVICES_KV.delete(adviceId);
      
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

