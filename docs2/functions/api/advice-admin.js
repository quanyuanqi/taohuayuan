// functions/api/advice-admin.js
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const password = url.searchParams.get('password');

  const adminPassword = env.ADMIN_PASSWORD || 'admin123';
  if (password !== adminPassword) {
    return new Response('Invalid password', { status: 401 });
  }

  try {
    const list = await env.ADVICES_KV.list();
    const advices = [];

    for (const key of list.keys) {
      const advice = await env.ADVICES_KV.get(key.name, 'json');
      if (advice) {
        advices.push({ id: key.name, ...advice });
      }
    }

    advices.sort((a, b) => new Date(b.date) - new Date(a.date));

    return new Response(JSON.stringify(advices), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch (error) {
    console.error('[ADVICE-ADMIN][GET] Error', error);
    return new Response(JSON.stringify({ error: '获取失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await request.json();
  const { id, password, action, reply, commentIndex, attachmentIndex } = body;

  const adminPassword = env.ADMIN_PASSWORD || 'admin123';
  if (password !== adminPassword) {
    return new Response('Invalid password', { status: 401 });
  }

  try {
    if (action === 'approve') {
      const existing = await env.ADVICES_KV.get(id, 'json');
      if (!existing) {
        return new Response('建言不存在', { status: 404 });
      }

      const updated = {
        ...existing,
        updatedAt: Date.now()
      };

      await env.ADVICES_KV.put(id, JSON.stringify(updated));
      return new Response('审核通过', { status: 200 });
    } else if (action === 'delete') {
      await env.ADVICES_KV.delete(id);
      return new Response('删除成功', { status: 200 });
    } else if (action === 'reply') {
      const existing = await env.ADVICES_KV.get(id, 'json');
      if (!existing) {
        return new Response('建言不存在', { status: 404 });
      }
      if (!reply || typeof reply !== 'string' || !reply.trim()) {
        return new Response('回复内容不能为空', { status: 400 });
      }
      const replies = Array.isArray(existing.replies) ? existing.replies : [];
      replies.push({
        content: reply.trim(),
        date: new Date().toISOString()
      });
      const updated = {
        ...existing,
        replies,
        updatedAt: Date.now()
      };
      console.log('[ADVICE-ADMIN][REPLY]', { id, replyLength: replies.length });
      await env.ADVICES_KV.put(id, JSON.stringify(updated));
      return new Response('回复已保存', { status: 200 });
    } else if (action === 'deleteComment') {
      const existing = await env.ADVICES_KV.get(id, 'json');
      if (!existing) {
        return new Response('建言不存在', { status: 404 });
      }
      const comments = Array.isArray(existing.comments) ? existing.comments : [];
      const idx = Number.isInteger(commentIndex) ? commentIndex : parseInt(commentIndex, 10);
      if (isNaN(idx) || idx < 0 || idx >= comments.length) {
        console.warn('[ADVICE-ADMIN][COMMENT] Invalid index', { id, commentIndex });
        return new Response('无效的评论索引', { status: 400 });
      }
      comments.splice(idx, 1);
      await env.ADVICES_KV.put(id, JSON.stringify({ ...existing, comments, updatedAt: Date.now() }));
      return new Response('评论已删除', { status: 200 });
    } else if (action === 'approveContent') {
      const existing = await env.ADVICES_KV.get(id, 'json');
      if (!existing) {
        return new Response('建言不存在', { status: 404 });
      }
      await env.ADVICES_KV.put(id, JSON.stringify({
        ...existing,
        contentApproved: true,
        updatedAt: Date.now()
      }));
      console.log('[ADVICE-ADMIN][CONTENT] Approved', { id });
      return new Response('内容已通过审核', { status: 200 });
    } else if (action === 'approveAttachment') {
      const existing = await env.ADVICES_KV.get(id, 'json');
      if (!existing) {
        return new Response('建言不存在', { status: 404 });
      }
      const pending = Array.isArray(existing.pendingAttachments) ? existing.pendingAttachments : [];
      const idx = Number.isInteger(attachmentIndex) ? attachmentIndex : parseInt(attachmentIndex, 10);
      if (isNaN(idx) || idx < 0 || idx >= pending.length) {
        console.warn('[ADVICE-ADMIN][ATTACH] Invalid index (approve)', { id, attachmentIndex, pendingCount: pending.length });
        return new Response('无效的附件索引', { status: 400 });
      }
      const attachments = Array.isArray(existing.attachments) ? existing.attachments : [];
      const [approvedAttachment] = pending.splice(idx, 1);
      attachments.push(approvedAttachment);
      console.log('[ADVICE-ADMIN][ATTACH] Approve', {
        id,
        approved: approvedAttachment.name,
        remainingPending: pending.length,
        approvedCount: attachments.length
      });
      await env.ADVICES_KV.put(id, JSON.stringify({
        ...existing,
        attachments,
        pendingAttachments: pending,
        updatedAt: Date.now()
      }));
      return new Response('附件已通过审核', { status: 200 });
    } else if (action === 'deletePendingAttachment') {
      const existing = await env.ADVICES_KV.get(id, 'json');
      if (!existing) {
        return new Response('建言不存在', { status: 404 });
      }
      const pending = Array.isArray(existing.pendingAttachments) ? existing.pendingAttachments : [];
      const idx = Number.isInteger(attachmentIndex) ? attachmentIndex : parseInt(attachmentIndex, 10);
      if (isNaN(idx) || idx < 0 || idx >= pending.length) {
        console.warn('[ADVICE-ADMIN][ATTACH] Invalid index (delete)', { id, attachmentIndex, pendingCount: pending.length });
        return new Response('无效的附件索引', { status: 400 });
      }
      const removed = pending.splice(idx, 1);
      console.log('[ADVICE-ADMIN][ATTACH] Delete pending', {
        id,
        removed: removed[0]?.name,
        remainingPending: pending.length
      });
      await env.ADVICES_KV.put(id, JSON.stringify({
        ...existing,
        pendingAttachments: pending,
        updatedAt: Date.now()
      }));
      return new Response('附件已删除', { status: 200 });
    } else {
      return new Response('无效操作', { status: 400 });
    }
  } catch (error) {
    console.error('[ADVICE-ADMIN][POST] Error', { action, id, error });
    return new Response('操作失败', { status: 500 });
  }
}

