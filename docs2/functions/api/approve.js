export async function onRequestPost(context) {
  const { env, request } = context;
  const { id, password } = await request.json();

  if (password !== env.ADMIN_PASSWORD)
    return new Response('Unauthorized', { status: 401 });

  const post = await env.ADVICES_KV.get(id, 'json');
  if (!post) return new Response('Not found', { status: 404 });

  post.approved = true;
  await env.ADVICES_KV.put(id, JSON.stringify(post));
  return new Response('Approved', { status: 200 });
}
