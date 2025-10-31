// functions/api/bulletin.js
export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const method = request.method;
  const pathParts = url.pathname.split('/');
  const bulletinId = pathParts[pathParts.length - 1]; // 获取 URL 最后一部分作为 ID

  // 检查管理员权限（对于非 GET 请求）
  if (method !== 'GET' && method !== 'HEAD') {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: '未授权访问' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const session = await env.ADMIN_SESSIONS.get(token);
    if (session !== 'authenticated') {
      return new Response(JSON.stringify({ error: '发布失败，请尝试重新登录，或刷新页面，以确保安全。' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
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
          'Content-Type': 'application/json',
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
          headers: { 'Content-Type': 'application/json' }
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
        headers: { 'Content-Type': 'application/json' }
      });

    } else if (method === 'PUT' && bulletinId && bulletinId !== 'bulletin') {
      // 更新公告
      const existing = await env.BULLETIN_KV.get(bulletinId, 'json');
      
      if (!existing) {
        return new Response(JSON.stringify({ error: '公告不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const body = await request.json();
      const { title, content, attachments = [] } = body;
      
      if (!title || !content) {
        return new Response(JSON.stringify({ error: '标题和内容不能为空' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
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
        headers: { 'Content-Type': 'application/json' }
      });

    } else if (method === 'DELETE' && bulletinId && bulletinId !== 'bulletin') {
      // 删除公告
      const existing = await env.BULLETIN_KV.get(bulletinId);
      
      if (!existing) {
        return new Response(JSON.stringify({ error: '公告不存在' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      await env.BULLETIN_KV.delete(bulletinId);
      
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } else {
      return new Response(JSON.stringify({ error: '方法不支持' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('Bulletin error:', error);
    return new Response(JSON.stringify({ error: '操作失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}


