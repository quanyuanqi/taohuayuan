export async function onRequestPost(context) {
  const { env, request } = context;
  const { id, password } = await request.json();

  if (password !== env.ADMIN_PASSWORD)
    return new Response('Unauthorized', { status: 401 });

  await env.ADVICES_KV.delete(id);
  return new Response('Deleted', { status: 200 });
}
