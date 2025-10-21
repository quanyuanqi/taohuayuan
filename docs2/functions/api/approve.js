export async function onRequestPost({ request, env }) {
  try {
    const { id } = await request.json();
    if (!id) return new Response("Missing id", { status: 400 });

    const data = await env.ADVICES_KV.get(id);
    if (!data) return new Response("Post not found", { status: 404 });

    const post = JSON.parse(data);
    post.status = "approved";
    post.approved = true;

    await env.ADVICES_KV.put(id, JSON.stringify(post));
    return new Response(JSON.stringify({ ok: true }));
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
