export async function onRequestPost({ request, env }) {
  try {
    const { title, content } = await request.json();

    if (!title || !content) {
      console.error("Missing title or content", { title, content });
      return new Response(JSON.stringify({ error: "Missing title or content" }), { status: 400 });
    }

    const id = crypto.randomUUID();
    const post = { id, title, content, date: new Date().toISOString(), status: "pending" };

    await env.ADVICES_KV.put(id, JSON.stringify(post));

    console.log("Post saved", post);
    return new Response(JSON.stringify({ success: true, post }), { status: 200 });
  } catch (err) {
    console.error("Error in POST /api/post:", err);
    return new Response(JSON.stringify({ error: err.message || err.toString() }), { status: 500 });
  }
}
