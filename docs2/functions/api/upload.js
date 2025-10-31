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
    const bucket = 'tomsimgs'; // 你的存储桶名称

    if (!accessKey || !secretKey) {
      return new Response(JSON.stringify({ error: '七牛云配置错误' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 读取文件内容
    const fileBuffer = await file.arrayBuffer();
    
    // 生成上传策略
    const putPolicy = {
      scope: `${bucket}:${key}`,
      deadline: Math.floor(Date.now() / 1000) + 3600 // 1小时过期
    };

    // 使用标准的 Base64 URL 安全编码
    const encodedPutPolicy = base64UrlEncode(JSON.stringify(putPolicy));
    
    // 生成 HMAC-SHA1 签名
    const signature = await hmacSha1(secretKey, encodedPutPolicy);
    
    // 生成上传 token
    const uploadToken = `${accessKey}:${signature}:${encodedPutPolicy}`;

    // 直接上传到七牛云
    const uploadUrl = 'https://upload.qiniup.com/';
    const uploadFormData = new FormData();
    uploadFormData.append('token', uploadToken);
    uploadFormData.append('file', new Blob([fileBuffer]), file.name);
    uploadFormData.append('key', key);

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: uploadFormData
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('Upload to Qiniu failed:', errorText);
      throw new Error(`上传失败: ${errorText}`);
    }

    const result = await uploadResponse.json();
    
    // 返回自定义域名的访问链接
    return new Response(JSON.stringify({ 
      success: true,
      key: key,
      bucket: bucket,
      url: `http://7n.xiongwei.net/${key}`, // 自定义域名
      size: file.size,
      originalName: file.name
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

// Base64 URL 安全编码
function base64UrlEncode(str) {
  return btoa(str)
    .replace(/\+/g, '-')  // 将 + 替换为 -
    .replace(/\//g, '_')  // 将 / 替换为 _
    .replace(/=/g, '');   // 移除填充 =
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
  
  // 将签名转换为十六进制字符串
  const byteArray = new Uint8Array(signature);
  return Array.from(byteArray)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}
