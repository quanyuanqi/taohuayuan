export async function onRequestGet({ env }) {
  try {
    const list = [];

    const iterator = await env.ADVICES_KV.list({ limit: 100 });
    for (const { name: key } of iterator.keys || iterator) {
      const postText = await env.ADVICES_KV.get(key);
      if (!postText) continue;

      let post;
      try {
        post = JSON.parse(postText);
      } catch (e) {
        console.error("Invalid JSON in KV:", key, e);
        continue;
      }

      const title = post.title || post.name || "(no title)";
      const content = post.content || post.body || post.text || "";
      const status = post.status || "";
      const approved = post.approved === true;

      // ✅ accept posts with either status='approved' or approved:true
      if (status === "approved" || approved) {
        list.push({
          id: post.id || key,
          title,
          content,
          date: post.date || "",
          status: "approved"
        });
      }
    }

    console.log("Approved posts count:", list.length);
    return new Response(JSON.stringify(list), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("Error in GET /api/list:", err);
    return new Response(
      JSON.stringify({ error: err.message || err.toString() }),
      { status: 500 }
    );
  }
}
