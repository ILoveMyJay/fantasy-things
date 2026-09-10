/**
 * 微信支付 v3 工具库模板
 * 适用于：Cloudflare Workers / Pages Functions
 * 依赖：零（纯 Web Crypto API，无需任何 npm 包）
 *
 * TODO: 按你的项目调整 Env interface 中的 binding 名称
 */

// =========================================================
// 环境变量类型声明
// TODO: 调整为你的项目实际 binding 名称
// =========================================================
export interface Env {
  DB: D1Database;                         // Cloudflare D1 数据库
  WXPAY_MCHID: string;                   // 商户号
  WXPAY_APPID: string;                   // AppID
  WXPAY_API_V3_KEY: string;             // API v3 密钥（32位）
  WXPAY_PRIVATE_KEY: string;            // 商户私钥 PEM
  WXPAY_SERIAL_NO: string;              // 商户证书序列号
  WXPAY_NOTIFY_URL: string;             // 回调地址
  WXPAY_PLATFORM_PUBLIC_KEY?: string;   // 微信平台公钥（可选，用于回调验签）
}

// =========================================================
// PEM 格式转换工具
// =========================================================

/** 私钥 PEM 转 ArrayBuffer（PKCS8 格式） */
function privateKeyPemToBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}

/** 公钥 PEM 转 ArrayBuffer（SPKI 格式） */
function publicKeyPemToBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}

/** Base64 字符串转 ArrayBuffer */
function base64ToBuffer(b64: string): ArrayBuffer {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}

// =========================================================
// 核心：构造 Authorization Header（RSA-SHA256 签名）
// =========================================================
export async function buildAuthHeader(
  env: Env,
  method: 'GET' | 'POST',
  urlPath: string,    // 含 query string，如 /v3/pay/transactions/out-trade-no/xxx?mchid=yyy
  body: string        // GET 请求传空字符串 ''
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, '').toUpperCase().slice(0, 32);

  // 构造签名串（每行末尾必须有 \n，包括最后一行）
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;

  // 导入私钥
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyPemToBuffer(env.WXPAY_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // 签名
  const sigBuffer = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(message)
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));

  return [
    `WECHATPAY2-SHA256-RSA2048`,
    `mchid="${env.WXPAY_MCHID}",`,
    `nonce_str="${nonce}",`,
    `timestamp="${timestamp}",`,
    `serial_no="${env.WXPAY_SERIAL_NO}",`,
    `signature="${signature}"`,
  ].join(' ');
}

// =========================================================
// 回调验签（验证通知确实来自微信，防伪造）
// =========================================================
export async function verifyNotifySignature(
  env: Env,
  timestamp: string,
  nonce: string,
  body: string,
  signature: string
): Promise<boolean> {
  if (!env.WXPAY_PLATFORM_PUBLIC_KEY) {
    console.warn('[wxpay] 未配置 WXPAY_PLATFORM_PUBLIC_KEY，跳过回调验签');
    return true; // 无公钥时跳过验签（测试阶段可接受，生产建议配置）
  }

  try {
    const message = `${timestamp}\n${nonce}\n${body}\n`;
    const key = await crypto.subtle.importKey(
      'spki',
      publicKeyPemToBuffer(env.WXPAY_PLATFORM_PUBLIC_KEY),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    return await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      base64ToBuffer(signature),
      new TextEncoder().encode(message)
    );
  } catch (e) {
    console.error('[wxpay] 验签异常:', e);
    return false;
  }
}

// =========================================================
// AES-256-GCM 解密回调报文
// =========================================================
export async function decryptNotify(
  env: Env,
  ciphertext: string,
  nonce: string,
  associatedData: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.WXPAY_API_V3_KEY),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const plainBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new TextEncoder().encode(nonce),
      additionalData: new TextEncoder().encode(associatedData),
    },
    key,
    base64ToBuffer(ciphertext)
  );

  return new TextDecoder().decode(plainBuffer);
}

// =========================================================
// 统一微信 API 请求封装
// =========================================================
export async function wxRequest<T>(
  env: Env,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const bodyStr = body ? JSON.stringify(body) : '';
  const authorization = await buildAuthHeader(env, method, path, bodyStr);

  const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
    method,
    headers: {
      'Authorization': authorization,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'WxPayCloudflareWorker/1.0',
    },
    ...(body ? { body: bodyStr } : {}),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`微信API错误 ${response.status}: ${text}`);
  }

  return JSON.parse(text) as T;
}

// =========================================================
// 工具函数
// =========================================================

/** 生成商户订单号（可自定义前缀） */
export function generateOrderId(prefix = 'LK'): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-T:.Z]/g, '').slice(0, 14); // yyyyMMddHHmmss
  const random = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `${prefix}${date}${random}`;
}

/** 统一 JSON 响应（带 CORS） */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/** 处理 OPTIONS 预检请求 */
export function handleOptions(): Response {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
