export async function onRequestGet({ env }) {
  try {
    const list = [];

    for await (const { key } of env.ADVICES_KV.list({ limit: 100 })) {
      const postText = await env.ADVICES_KV.get(key);
      if (!postText) continue;

      let post;
      try {
        post = JSON.parse(postText);
      } catch (e) {
        console.error("Bad JSON in KV:", key, e);
        continue;
      }

      // 兼容旧字段
      const title = post.title || post.name || "(no title)";
      const content = post.content || post.body || post.text || "";
      const status = post.status || "approved";

      if (status === "approved") {
        list.push({
          id: post.id || key,
          title,
          content,
          date: post.date || "",
          status
        });
      }
    }

    console.log("Listing posts", list.length);
    return new Response(JSON.stringify(list), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error in GET /api/list:", err);
    return new Response(JSON.stringify({ error: err.message || err.toString() }), { status: 500 });
  }
}
