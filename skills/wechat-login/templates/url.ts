// templates/url.ts
// Cloudflare Pages Function: 获取微信开放平台扫码登录授权链接
// 路由路径建议：GET /api/auth/wechat/url

interface Env {
  WECHAT_LOGIN_APPID?: string;
  WECHAT_AUTH_CALLBACK_HOST?: string; // 例如: www.example.com
}

// 辅助方法：生成随机防 CSRF state
function generateState(len = 16): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// 辅助方法：统一 JSON 响应
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
};

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  try {
    const { request, env } = context;
    const url = new URL(request.url);

    // 1. 微信开放平台网站应用 AppID（优先读取环境变量，回退至项目默认值）
    const appId = env.WECHAT_LOGIN_APPID || 'YOUR_WECHAT_APPID';

    // 2. 授权回调域名（必须与微信开放平台设置的【授权回调域】严格一致，带 www 或裸域名必须严格匹配）
    const targetHost = env.WECHAT_AUTH_CALLBACK_HOST || (url.hostname === 'localhost' ? 'www.example.com' : url.hostname);
    const redirectUri = `https://${targetHost}/api/auth/wechat/callback`;

    // 3. 生成随机防 CSRF 令牌
    const state = generateState(16);

    // 4. 自定义 CSS 样式（隐藏微信 iframe 中的应用名称“雨沐春林”等，消除顶部多余 margin 确保 100% 完整展示）
    const customCss =
      `.impowerBox .qrcode{margin-top:0!important;border-radius:8px!important;}` +
      `.impowerBox .title,.impowerBox .info,.web_qrcode_panel_normal_login p,.web_qrcode_panel_wrp p,.web_qrcode_app_wrp,.web_qrcode_app,p{display:none!important;visibility:hidden!important;height:0!important;font-size:0!important;}` +
      `.web_qrcode_panel_normal_login,.impowerBox .waiting,.impowerBox .panelContent{padding:0!important;margin:0!important;}`;
    const hrefParam = `data:text/css;base64,${btoa(customCss)}`;

    // 5. 构造微信开放平台 PC 扫码登录链接
    // 内嵌 iframe 模式（带 login_type=jssdk, self_redirect=true 以及 href 自定义样式）
    const wechatAuthUrl =
      `https://open.weixin.qq.com/connect/qrconnect?` +
      `appid=${encodeURIComponent(appId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=snsapi_login&` +
      `state=${encodeURIComponent(state)}&` +
      `login_type=jssdk&` +
      `self_redirect=true&` +
      `href=${encodeURIComponent(hrefParam)}` +
      `#wechat_redirect`;

    // 全页重定向兜底模式链接
    const directAuthUrl =
      `https://open.weixin.qq.com/connect/qrconnect?` +
      `appid=${encodeURIComponent(appId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=snsapi_login&` +
      `state=${encodeURIComponent(state)}` +
      `#wechat_redirect`;

    return jsonResponse({
      success: true,
      url: wechatAuthUrl, // 默认提供内嵌 iframe 链接
      embedUrl: wechatAuthUrl,
      directUrl: directAuthUrl,
      state,
      redirectUri,
      appId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: '生成微信登录链接失败: ' + message }, 500);
  }
};
