export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const password = url.searchParams.get('password');

  if (password !== env.ADMIN_PASSWORD)
    return new Response('Unauthorized', { status: 401 });

  const list = await env.ADVICES_KV.list();
  const posts = [];

  for (const key of list.keys) {
    const post = await env.ADVICES_KV.get(key.name, 'json');
    if (post) posts.push({ id: key.name, ...post });
  }

  return new Response(JSON.stringify(posts.reverse()), {
    headers: { 'Content-Type': 'application/json' }
  });
}
