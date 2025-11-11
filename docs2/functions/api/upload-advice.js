// functions/api/upload-advice.js - 公开上传端点，用于用户提交建言时的附件上传
export async function onRequestPost(context) {
  const { env, request } = context;

  const accessKey = env.QINIU_ACCESS_KEY || env.KODO_ACCESS;
  const secretKey = env.QINIU_SECRET_KEY || env.KODO_SECRET;
  const bucket = env.QINIU_BUCKET || env.KODO_BUCKET;
  const publicBase = env.QINIU_PUBLIC_BASE || env.KODO_PUBLIC_BASE;

  if (!accessKey || !secretKey || !bucket || !publicBase) {
    return new Response(JSON.stringify({ error: '服务端未配置存储参数' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
  }

  try {
    const formData = await request.formData();
    const key = formData.get('key');
    const file = formData.get('file');

    if (!key || !file) {
      return new Response(JSON.stringify({ error: '缺少文件或目标路径' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 确保只能上传到 advice-attachments 目录
    if (!key.startsWith('advice-attachments/')) {
      return new Response(JSON.stringify({ error: '无效的上传路径' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 检查文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (!allowedTypes.includes(file.type) && file.type !== '') {
      return new Response(JSON.stringify({ error: '不支持的文件类型' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const uploadToken = await createQiniuUploadToken({
      accessKey,
      secretKey,
      bucket,
      key
    });

    const publicUrl = `${publicBase.replace(/\/$/, '')}/${key}`;

    return new Response(JSON.stringify({
      uploadToken,
      key,
      url: publicUrl,
      size: file.size ?? undefined
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: '生成上传凭证失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
  }
}

// Preflight support
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}

async function createQiniuUploadToken({ accessKey, secretKey, bucket, key }) {
  const putPolicy = {
    scope: `${bucket}:${key}`,
    deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    insertOnly: 1
  };

  const putPolicyJson = JSON.stringify(putPolicy);
  const encodedPutPolicy = base64UrlEncode(new TextEncoder().encode(putPolicyJson));

  const signingKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(encodedPutPolicy));
  const encodedSignature = base64UrlEncode(new Uint8Array(signature));

  return `${accessKey}:${encodedSignature}:${encodedPutPolicy}`;
}

function base64UrlEncode(bytes) {
  let str = '';
  if (bytes instanceof Uint8Array) {
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
  } else {
    str = bytes;
  }
  let b64 = btoa(str);
  return b64.replace(/\+/g, '-').replace(/\//g, '_');
}

