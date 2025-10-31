// functions/api/upload.js
export async function onRequestPost(context) {
  const { env, request } = context;
  
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const key = formData.get('key') || `bulletin-attachments/${Date.now()}-${file.name}`;

    if (!file) {
      return new Response(JSON.stringify({ error: '未找到文件' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 检查文件类型
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif',
      'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];

    if (!allowedTypes.includes(file.type)) {
      return new Response(JSON.stringify({ 
        error: '文件类型不支持',
        allowedTypes: allowedTypes.join(', ')
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 检查文件大小（限制 10MB）
    if (file.size > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: '文件大小不能超过 10MB' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 获取七牛云配置
    const accessKey = env.KODO_ACCESS;
    const secretKey = env.KODO_SECRET;
    const bucket = 'your-bucket-name'; // 你的七牛云存储桶名称

    if (!accessKey || !secretKey) {
      return new Response(JSON.stringify({ error: '七牛云配置错误' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 生成上传 token
    const putPolicy = {
      scope: `${bucket}:${key}`,
      deadline: Math.floor(Date.now() / 1000) + 3600 // 1小时过期
    };

    const encodedPutPolicy = btoa(JSON.stringify(putPolicy));
    const encodedSign = await hmacSha1(secretKey, encodedPutPolicy);
    const uploadToken = `${accessKey}:${encodedSign}:${encodedPutPolicy}`;

    // ✅ 使用自定义域名生成访问 URL
    return new Response(JSON.stringify({ 
      success: true,
      uploadToken,
      key: key,
      bucket: bucket,
      // ✅ 使用自定义域名
      url: `http://7n.xiongwei.net/${key}`, // 自定义域名
      size: file.size
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// HMAC-SHA1 实现
async function hmacSha1(secret, data) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  );
  
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
