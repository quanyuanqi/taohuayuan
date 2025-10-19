export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    console.log(`[Request] ${request.method} ${url.pathname}`);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    try {
      if (url.pathname === '/posts' && request.method === 'GET') {
        return await handleGetPosts(env);
      } else if (url.pathname === '/posts' && request.method === 'POST') {
        return await handleCreatePost(request, env);
      } else {
        console.log(`[Default] Path not matched: ${url.pathname}`);
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: corsHeaders(),
        });
      }
    } catch (err) {
      console.error('[Error]', err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders(),
      });
    }
  },
};

/* =========================
   HANDLER: GET /posts
========================= */
async function handleGetPosts(env) {
  const { GITHUB_OWNER, GITHUB_REPO, GITHUB_FOLDER, GITHUB_TOKEN } = env;

  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FOLDER}`;
  console.log('[GET] Fetching from GitHub:', apiUrl);

  const res = await fetch(apiUrl, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'cloudflare-worker',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error: ${res.status} - ${text}`);
  }

  const files = await res.json();
  const posts = [];

  for (const file of files) {
    if (file.type === 'file' && file.name.endsWith('.json')) {
      const fileRes = await fetch(file.download_url);
      const content = await fileRes.text();
      try {
        const post = JSON.parse(content);
        posts.push(post);
      } catch {
        console.warn('Invalid JSON in:', file.name);
      }
    }
  }

  return new Response(JSON.stringify(posts), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

/* =========================
   HANDLER: POST /posts
========================= */
async function handleCreatePost(request, env) {
  const { GITHUB_OWNER, GITHUB_REPO, GITHUB_FOLDER, GITHUB_TOKEN } = env;

  const body = await request.json();
  if (!body.title || !body.content) {
    return new Response(JSON.stringify({ error: 'Missing title or content' }), {
      status: 400,
      headers: corsHeaders(),
    });
  }

  const postId = crypto.randomUUID();
  const postData = {
    id: postId,
    title: body.title,
    content: body.content,
    date: new Date().toISOString(),
  };

  const fileName = `${postId}.json`;
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FOLDER}/${fileName}`;

  console.log('[POST] Creating file at:', apiUrl);

  const githubResponse = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'cloudflare-worker',
    },
    body: JSON.stringify({
      message: `Add new post: ${postData.title}`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(postData, null, 2)))),
    }),
  });

  if (!githubResponse.ok) {
    const errorText = await githubResponse.text();
    console.error('[GitHub Error]', errorText);
    return new Response(JSON.stringify({ error: 'GitHub API failed', details: errorText }), {
      status: 500,
      headers: corsHeaders(),
    });
  }

  return new Response(JSON.stringify({ success: true, post: postData }), {
    status: 201,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

/* =========================
   HELPERS
========================= */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
