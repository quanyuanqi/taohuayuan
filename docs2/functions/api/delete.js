export async function onRequestPost({ request, env }) {
  try {
    const { id } = await request.json();
    if (!id) return new Response("Missing id", { status: 400 });

    await env.ADVICES_KV.delete(id);
    return new Response(JSON.stringify({ ok: true }));
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
