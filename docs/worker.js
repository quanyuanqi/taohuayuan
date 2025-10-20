/*
CLOUDFLARE WORKER FOR GITEE-BASED ADVICE BOARD
Handles pending/approved posts stored as JSON files on Gitee.

Set these Environment Variables:
  - ADMIN_PASSWORD  (for admin login)
  - GITEE_TOKEN     (Personal access token from https://gitee.com/profile/personal_access_tokens)
  - GITEE_OWNER     (your Gitee username)
  - GITEE_REPO      (your repository name)
*/

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    console.log(`[Request] ${method} ${path}`);

    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    try {
      // Public routes
      if (path === "/posts" && method === "GET") return await handleGetApproved(env);
      if (path === "/posts" && method === "POST") return await handleCreatePending(request, env);

      // Admin routes
      if (path === "/admin/test" && method === "GET") return testAdmin(env, request);
      if (path === "/admin/pending" && method === "GET") return await handleGetPending(request, env);
      if (path === "/admin/approve" && method === "POST") return await handleApprove(request, env);
      if (path === "/admin/delete" && method === "POST") return await handleDelete(request, env);

      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      console.error("[Worker error]", err);
      return jsonResponse({ error: err.message }, 500);
    }
  },
};

/* ========== AUTH ========== */
function checkAuth(request, env) {
  const password = request.headers.get("Authorization")?.replace("Bearer ", "").trim();
  console.log("[Auth] Provided:", password ? "(hidden)" : "(missing)");
  if (password !== env.ADMIN_PASSWORD) throw new Error("Unauthorized");
}

function testAdmin(env, request) {
  const password = request.headers.get("Authorization")?.replace("Bearer ", "").trim();
  const ok = password === env.ADMIN_PASSWORD;
  console.log(`[Test] /admin/test => ${ok ? "OK" : "FAIL"}`);
  return jsonResponse({ success: ok, message: ok ? "Authorized" : "Unauthorized" }, ok ? 200 : 401);
}

/* ========== PUBLIC GET /posts ========== */
async function handleGetApproved(env) {
  const folder = "docs/_posts/approved";
  const posts = await listFilesFromGitee(env, folder);
  return jsonResponse(posts);
}

/* ========== PUBLIC POST /posts ========== */
async function handleCreatePending(request, env) {
  const { title, content } = await request.json();
  if (!title || !content) return jsonResponse({ error: "Missing title/content" }, 400);

  const folder = "docs/_posts/pending";
  const id = crypto.randomUUID();
  const post = { id, title, content, date: new Date().toISOString() };

  await uploadFileToGitee(env, `${folder}/${id}.json`, JSON.stringify(post, null, 2), `New post: ${title}`);
  return jsonResponse({ success: true, post });
}

/* ========== ADMIN GET /admin/pending ========== */
async function handleGetPending(request, env) {
  checkAuth(request, env);
  const folder = "docs/_posts/pending";
  const posts = await listFilesFromGitee(env, folder);
  return jsonResponse(posts);
}

/* ========== ADMIN POST /admin/approve ========== */
async function handleApprove(request, env) {
  checkAuth(request, env);
  const { id } = await request.json();
  if (!id) return jsonResponse({ error: "Missing id" }, 400);

  const pendingPath = `docs/_posts/pending/${id}.json`;
  const approvedPath = `docs/_posts/approved/${id}.json`;

  const { content, sha } = await getGiteeFile(env, pendingPath);
  await uploadFileToGitee(env, approvedPath, atob(content), `Approve post ${id}`);
  await deleteGiteeFile(env, pendingPath, sha, `Remove pending post ${id}`);

  return jsonResponse({ success: true });
}

/* ========== ADMIN POST /admin/delete ========== */
async function handleDelete(request, env) {
  checkAuth(request, env);
  const { id } = await request.json();
  if (!id) return jsonResponse({ error: "Missing id" }, 400);

  const pendingPath = `docs/_posts/pending/${id}.json`;
  const { sha } = await getGiteeFile(env, pendingPath);
  await deleteGiteeFile(env, pendingPath, sha, `Delete pending post ${id}`);

  return jsonResponse({ success: true });
}

/* ========== GITEE HELPERS ========== */
async function listFilesFromGitee(env, folder) {
  const { GITEE_OWNER, GITEE_REPO, GITEE_TOKEN } = env;
  const url = `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${folder}?access_token=${GITEE_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const files = await res.json();
  const posts = [];

  for (const f of files) {
    if (f.type === "file" && f.name.endsWith(".json")) {
      const fileRes = await fetch(f.download_url);
      if (fileRes.ok) {
        try {
          const text = await fileRes.text();
          posts.push(JSON.parse(text));
        } catch {}
      }
    }
  }
  return posts;
}

async function uploadFileToGitee(env, path, content, message) {
  const { GITEE_OWNER, GITEE_REPO, GITEE_TOKEN } = env;
  const url = `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${path}`;
  const body = {
    access_token: GITEE_TOKEN,
    content: btoa(unescape(encodeURIComponent(content))),
    message,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error("Gitee upload failed: " + err);
  }
}

async function getGiteeFile(env, path) {
  const { GITEE_OWNER, GITEE_REPO, GITEE_TOKEN } = env;
  const url = `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${path}?access_token=${GITEE_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("File not found: " + path);
  return await res.json();
}

async function deleteGiteeFile(env, path, sha, message) {
  const { GITEE_OWNER, GITEE_REPO, GITEE_TOKEN } = env;
  const url = `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${path}`;
  const body = {
    access_token: GITEE_TOKEN,
    sha,
    message,
  };
  const res = await fetch(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error("Gitee delete failed: " + err);
  }
}

/* ========== HELPERS ========== */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
