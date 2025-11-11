// functions/api/advice-comment.js - Public endpoint to add comments to an advice
export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const body = await request.json();
    const { adviceId, author, content } = body || {};

    if (!adviceId || !content || !content.trim()) {
      return new Response(JSON.stringify({ error: '缺少必要参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const existing = await env.ADVICES_KV.get(adviceId, 'json');
    if (!existing) {
      return new Response(JSON.stringify({ error: '建言不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const comments = Array.isArray(existing.comments) ? existing.comments : [];
    comments.push({
      author: author && author.trim() ? author.trim() : '匿名',
      content: content.trim(),
      date: new Date().toISOString()
    });

    await env.ADVICES_KV.put(adviceId, JSON.stringify({ ...existing, comments, updatedAt: Date.now() }));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '提交失败' }), {
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

