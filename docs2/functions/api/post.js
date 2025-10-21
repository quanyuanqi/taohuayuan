export async function onRequestPost(context) {
  const { request, env } = context;
  const data = await request.json();

  const title = (data.title || '').trim();
  const content = (data.content || '').trim();

  if (!title || !content) return new Response('Missing title or content', { status: 400 });
  if (title.length > 100 || content.length > 2000)
    return new Response('Title or content too long', { status: 400 });

  const key = Date.now().toString();
  const post = { title, content, time: new Date().toISOString(), approved: false };

  await env.ADVICES_KV.put(key, JSON.stringify(post));
  return new Response(JSON.stringify({ success: true, key }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
