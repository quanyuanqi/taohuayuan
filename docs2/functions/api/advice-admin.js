// functions/api/advice-admin.js
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const password = url.searchParams.get('password');

  // 简单的密码验证（保持与原有 admin.html 兼容）
  const adminPassword = env.ADMIN_PASSWORD || 'admin123';
  if (password !== adminPassword) {
    return new Response('Invalid password', { status: 401 });
  }

  try {
    const list = await env.ADVICE_KV.list();
    const advices = [];

    for (const key of list.keys) {
      const advice = await env.ADVICE_KV.get(key.name, 'json');
      if (advice) {
        advices.push({ id: key.name, ...advice });
      }
    }

    // 按时间倒序排列
    advices.sort((a, b) => new Date(b.date) - new Date(a.date));

    return new Response(JSON.stringify(advices), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch (error) {
    console.error('[ERROR] Advice admin list error:', error);
    return new Response(JSON.stringify({ error: '获取失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await request.json();
  const { id, password, action } = body;

  // 简单的密码验证
  const adminPassword = env.ADMIN_PASSWORD || 'admin123';
  if (password !== adminPassword) {
    return new Response('Invalid password', { status: 401 });
  }

  try {
    if (action === 'approve') {
      // 审核通过
      const existing = await env.ADVICE_KV.get(id, 'json');
      if (!existing) {
        return new Response('建言不存在', { status: 404 });
      }

      const updated = {
        ...existing,
        approved: true,
        updatedAt: Date.now()
      };

      await env.ADVICE_KV.put(id, JSON.stringify(updated));
      return new Response('审核通过', { status: 200 });
    } else if (action === 'delete') {
      // 删除
      await env.ADVICE_KV.delete(id);
      return new Response('删除成功', { status: 200 });
    } else {
      return new Response('无效操作', { status: 400 });
    }
  } catch (error) {
    console.error('[ERROR] Advice admin action error:', error);
    return new Response('操作失败', { status: 500 });
  }
}

