export async function onRequestGet({ env }) {
  try {
    const posts = [];
    const iterator = await env.ADVICES_KV.list({ limit: 100 });
    for (const { name } of iterator.keys || iterator) {
      const data = await env.ADVICES_KV.get(name);
      if (!data) continue;
      try {
        const post = JSON.parse(data);
        posts.push(post);
      } catch {
        continue;
      }
    }

    return new Response(JSON.stringify(posts), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
