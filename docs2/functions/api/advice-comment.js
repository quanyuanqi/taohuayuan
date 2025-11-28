// functions/api/advice-comment.js - Public endpoint to add comments to an advice
export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const body = await request.json();
    const { adviceId, author, content, phoneNumber, verifyCode } = body || {};

    if (!adviceId || !content || !content.trim()) {
      return new Response(JSON.stringify({ error: '缺少必要参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // 验证短信验证码
    if (!phoneNumber || !verifyCode) {
      return new Response(JSON.stringify({ error: '请先完成短信验证' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // 直接验证验证码（避免内部HTTP调用）
    try {
      const phoneRegex = /^1[3-9]\d{9}$/;
      const trimmedPhone = phoneNumber.trim();
      const trimmedCode = verifyCode.trim();

      if (!phoneRegex.test(trimmedPhone)) {
        return new Response(JSON.stringify({ error: '手机号格式不正确' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      if (!trimmedCode) {
        return new Response(JSON.stringify({ error: '验证码不能为空' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      // 从KV读取验证码
      const kvKey = `sms-verify:${trimmedPhone}`;
      const stored = await env.ADVICES_KV.get(kvKey, 'json');

      if (!stored) {
        return new Response(JSON.stringify({ error: '验证码不存在或已过期' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      if (Date.now() > stored.expiresAt) {
        await env.ADVICES_KV.delete(kvKey);
        return new Response(JSON.stringify({ error: '验证码已过期' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      if (stored.code !== trimmedCode) {
        return new Response(JSON.stringify({ error: '验证码错误' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      // 验证成功后删除验证码（防止重复使用）
      await env.ADVICES_KV.delete(kvKey);
    } catch (verifyErr) {
      console.error('[ADVICE-COMMENT] Verify code check failed:', verifyErr);
      return new Response(JSON.stringify({ error: '验证码验证服务异常' }), {
        status: 500,
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

