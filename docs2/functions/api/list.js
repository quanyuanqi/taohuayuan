export async function onRequestGet(context) {
  const { env } = context;
  const list = await env.ADVICES_KV.list();
  const posts = [];

  for (const key of list.keys) {
    const post = await env.ADVICES_KV.get(key.name, 'json');
    if (post && post.approved) posts.push({ id: key.name, title: post.title });
  }

  return new Response(JSON.stringify(posts.reverse()), {
    headers: { 'Content-Type': 'application/json' }
  });
}
