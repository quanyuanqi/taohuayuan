// functions/api/advice.js
export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const method = request.method;
  const pathParts = url.pathname.split('/');
  const adviceId = pathParts[pathParts.length - 1];

  console.log('[ADVICE][REQUEST]', { method, pathname: url.pathname, adviceId });

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders()
    });
  }

  if (method === 'PUT' || method === 'DELETE') {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return unauthorized('未授权访问');
    }
    const token = authHeader.replace('Bearer ', '');
    const session = await env.ADMIN_SESSIONS.get(token);
    if (session !== 'authenticated') {
      return unauthorized('操作失败，请尝试重新登录，或刷新页面，以确保安全。');
    }
  }

  try {
    if (method === 'GET') {
      const list = await env.ADVICES_KV.list();
      const advices = [];
      for (const key of list.keys) {
        const advice = await env.ADVICES_KV.get(key.name, 'json');
        if (advice) {
          advices.push({ id: key.name, ...advice });
          console.log('[ADVICE][GET] Loaded', key.name, {
            name: advice.name,
            building: advice.building,
            attachments: Array.isArray(advice.attachments) ? advice.attachments.length : 0,
            pending: Array.isArray(advice.pendingAttachments) ? advice.pendingAttachments.length : 0
          });
        }
      }
      advices.sort((a, b) => new Date(b.date) - new Date(a.date));
      return jsonResponse(advices, 200, { 'Cache-Control': 'public, max-age=30' });
    }

    if (method === 'POST') {
      const body = await request.json();
      const name = body.name ?? body.author;
      const building = body.building;
      const contact = body.contact ?? body.title;
      const description = body.description ?? body.content ?? '';
      const attachments = Array.isArray(body.attachments) ? body.attachments : (body.attachments ? [body.attachments] : []);

      if (!name || !name.trim()) return badRequest('姓名不能为空');
      if (!building || !building.trim()) return badRequest('楼栋号不能为空');
      if (!contact || !contact.trim()) return badRequest('联系方式不能为空');

      const newAdvice = {
        id: `advice-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: name.trim(),
        building: building.trim(),
        contact: contact.trim(),
        description: description ? description.trim() : '',
        attachments: [],
        pendingAttachments: attachments,
        comments: [],
        replies: [],
        date: new Date().toISOString(),
        createdAt: Date.now()
      };

      console.log('[ADVICE][POST] Created', {
        id: newAdvice.id,
        pendingAttachments: newAdvice.pendingAttachments.length
      });

      await env.ADVICES_KV.put(newAdvice.id, JSON.stringify(newAdvice));
      return jsonResponse({ success: true, id: newAdvice.id }, 201);
    }

    if (method === 'PUT' && adviceId && adviceId !== 'advice') {
      const existing = await env.ADVICES_KV.get(adviceId, 'json');
      if (!existing) {
        return jsonResponse({ error: '建言不存在' }, 404);
      }

      const body = await request.json();
      const updatedAdvice = { ...existing };
      let changed = false;

      if (body.name !== undefined) {
        if (!body.name || !body.name.trim()) return badRequest('姓名不能为空');
        updatedAdvice.name = body.name.trim();
        changed = true;
      }
      if (body.building !== undefined) {
        if (!body.building || !body.building.trim()) return badRequest('楼栋号不能为空');
        updatedAdvice.building = body.building.trim();
        changed = true;
      }
      if (body.contact !== undefined) {
        if (!body.contact || !body.contact.trim()) return badRequest('联系方式不能为空');
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
      if (body.pendingAttachments !== undefined) {
        updatedAdvice.pendingAttachments = Array.isArray(body.pendingAttachments) ? body.pendingAttachments : [];
        changed = true;
      }
      if (body.comments !== undefined) {
        updatedAdvice.comments = Array.isArray(body.comments) ? body.comments : [];
        changed = true;
      }
      if (body.replies !== undefined) {
        updatedAdvice.replies = Array.isArray(body.replies) ? body.replies : [];
        changed = true;
      }
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
        return badRequest('未提交任何可更新的字段');
      }

      updatedAdvice.updatedAt = Date.now();

      console.log('[ADVICE][PUT] Update', {
        id: adviceId,
        attachments: Array.isArray(updatedAdvice.attachments) ? updatedAdvice.attachments.length : 0,
        pending: Array.isArray(updatedAdvice.pendingAttachments) ? updatedAdvice.pendingAttachments.length : 0
      });

      await env.ADVICES_KV.put(adviceId, JSON.stringify(updatedAdvice));
      return jsonResponse({ success: true }, 200);
    }

    if (method === 'DELETE' && adviceId && adviceId !== 'advice') {
      const existing = await env.ADVICES_KV.get(adviceId);
      if (!existing) {
        return jsonResponse({ error: '建言不存在' }, 404);
      }
      await env.ADVICES_KV.delete(adviceId);
      return jsonResponse({ success: true }, 200);
    }

    return jsonResponse({ error: '方法不支持', debug: { method, adviceId, pathname: url.pathname } }, 405);
  } catch (error) {
    console.error('[ADVICE][ERROR]', error);
    return jsonResponse({
      error: '操作失败',
      debug: {
        message: error.message,
        method,
        adviceId,
        pathname: url.pathname
      }
    }, 500);
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function commonHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...extra
  };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: commonHeaders(extraHeaders)
  });
}

function badRequest(message) {
  return jsonResponse({ error: message }, 400);
}

function unauthorized(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: commonHeaders()
  });
}

