// functions/api/admin-phone-list.js - 获取授权手机号码列表
export async function onRequestGet(context) {
  const { env } = context;
  
  try {
    // 优先从 KV 存储读取，如果没有则从环境变量读取
    let authorizedPhones = '';
    try {
      authorizedPhones = await env.ADMIN_CONFIG.get('AUTHORIZED_PHONES') || '';
    } catch (err) {
      // 如果 KV 不存在，使用环境变量
      authorizedPhones = env.ADMIN_AUTHORIZED_PHONES || '';
    }
    
    const phoneList = authorizedPhones.split(',')
      .map(phone => phone.trim())
      .filter(phone => phone && /^1[3-9]\d{9}$/.test(phone));
    
    return new Response(JSON.stringify({
      success: true,
      phones: phoneList,
      count: phoneList.length
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('Get phone list error:', error);
    return new Response(JSON.stringify({ 
      error: '获取手机号码列表失败' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}
