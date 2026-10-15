// templates/callback.ts
// Cloudflare Pages Function: 微信开放平台扫码登录回调处理
// 路由路径建议：GET /api/auth/wechat/callback?code=CODE&state=STATE

interface Env {
  DB: D1Database;
  WECHAT_LOGIN_APPID?: string;
  WECHAT_LOGIN_SECRET?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateToken(len = 32): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error') || url.searchParams.get('state_error');

  // 用户在手机上点击了取消或授权异常
  if (error || !code) {
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>登录取消</title></head>
       <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:80vh;">
         <div style="text-align:center;">
           <h2>⚠️ 微信扫码登录已取消或授权失败</h2>
           <p style="color:#666;">${error || '未获取到授权凭证'}</p>
           <a href="/" style="color:#10b981;font-weight:bold;text-decoration:none;">返回首页重试</a>
         </div>
       </body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 400 }
    );
  }

  try {
    if (!env.DB) {
      throw new Error('数据库服务不可用');
    }

    const appId = env.WECHAT_LOGIN_APPID || 'YOUR_WECHAT_APPID';
    const appSecret = env.WECHAT_LOGIN_SECRET || 'YOUR_WECHAT_APPSECRET';

    // ── 1. 用 code 换取 access_token 与 openid ──────────────────────────────
    const tokenUrl =
      `https://api.weixin.qq.com/sns/oauth2/access_token?` +
      `appid=${encodeURIComponent(appId)}&` +
      `secret=${encodeURIComponent(appSecret)}&` +
      `code=${encodeURIComponent(code)}&` +
      `grant_type=authorization_code`;

    const tokenRes = await fetch(tokenUrl);
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      openid?: string;
      unionid?: string;
      errcode?: number;
      errmsg?: string;
    };

    if (tokenData.errcode || !tokenData.access_token || !tokenData.openid) {
      throw new Error(`微信换取 Token 失败: ${tokenData.errmsg || '未知错误'} (${tokenData.errcode})`);
    }

    const { access_token, openid, unionid } = tokenData;

    // ── 2. 获取微信用户公开资料 (昵称与头像) ──────────────────────────────────
    let nickname = '微信用户';
    let avatarUrl = '';

    try {
      const userInfoUrl =
        `https://api.weixin.qq.com/sns/userinfo?` +
        `access_token=${encodeURIComponent(access_token)}&` +
        `openid=${encodeURIComponent(openid)}&` +
        `lang=zh_CN`;

      const userRes = await fetch(userInfoUrl);
      const userData = (await userRes.json()) as {
        nickname?: string;
        headimgurl?: string;
        errcode?: number;
      };

      if (!userData.errcode && userData.nickname) {
        nickname = userData.nickname.trim();
      }
      if (userData.headimgurl) {
        avatarUrl = userData.headimgurl;
      }
    } catch (e) {
      console.warn('[WeChat Login] 拉取用户资料降级:', e);
    }

    // ── 3. 检索用户是否已存在 (优先 unionid, 兼容 openid) ───────────────────
    let existingUser = await env.DB.prepare(
      `SELECT id, username, display_name, avatar, status 
       FROM users 
       WHERE (wx_unionid IS NOT NULL AND wx_unionid = ?) 
          OR (wx_openid IS NOT NULL AND wx_openid = ?)
       LIMIT 1`
    ).bind(unionid || '', openid).first<{
      id: string;
      username: string;
      display_name: string;
      avatar: string;
      status: string;
    }>();

    let userId = existingUser?.id;

    if (!existingUser) {
      // ── 4. 新用户自动建档：采用形态 B（纯标准 UUID）作为用户主键 ID ──────────────
      userId = crypto.randomUUID();
      const generatedUsername = `wx_${userId.replace(/-/g, '').substring(0, 8)}`;

      await env.DB.prepare(
        `INSERT INTO users (id, username, display_name, avatar, status, wx_openid, wx_unionid)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`
      ).bind(
        userId,
        generatedUsername,
        nickname,
        avatarUrl,
        openid,
        unionid || null
      ).run();

      existingUser = {
        id: userId,
        username: generatedUsername,
        display_name: nickname,
        avatar: avatarUrl,
        status: 'active',
      };
    } else {
      // 老用户：更新最近头像与 openid/unionid
      if (avatarUrl && avatarUrl !== existingUser.avatar) {
        await env.DB.prepare(
          `UPDATE users SET avatar = ?, display_name = ?, wx_openid = COALESCE(wx_openid, ?), wx_unionid = COALESCE(wx_unionid, ?) WHERE id = ?`
        ).bind(avatarUrl, nickname, openid, unionid || null, existingUser.id).run();
        existingUser.avatar = avatarUrl;
        existingUser.display_name = nickname;
      }
    }

    const userPayload = {
      id: existingUser.id,
      username: existingUser.username,
      displayName: existingUser.display_name,
      avatar: existingUser.avatar,
    };

    // ── 5. 颁发 Session Token ────────────────────────────────────────────────
    const sessionToken = generateToken(32);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const userAgent = request.headers.get('User-Agent') || 'wechat-login';

    await env.DB.prepare(
      `INSERT INTO user_sessions (token, user_id, expires_at, user_agent)
       VALUES (?, ?, ?, ?)`
    ).bind(sessionToken, userId, expiresAt, userAgent).run();

    // ── 6. 返回写入 LocalStorage 并通过 postMessage 通知父页面的 HTML ────────
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>微信登录成功</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: #f8fafc;
      color: #334155;
    }
    .card {
      background: white;
      padding: 24px;
      border-radius: 16px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
      text-align: center;
      max-width: 320px;
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid #e2e8f0;
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h3 style="margin: 0 0 6px; color: #0f172a; font-size: 16px;">🎉 登录成功！</h3>
    <p style="margin: 0; font-size: 13px; color: #64748b;">欢迎用户 ${escapeHtml(userPayload.displayName || userPayload.username)}</p>
  </div>
  <script>
    try {
      const token = ${JSON.stringify(sessionToken)};
      const user = ${JSON.stringify(userPayload)};
      const userStr = JSON.stringify(user);

      // 同源写入 LocalStorage（与前端项目读取 key 对齐）
      localStorage.setItem('auth_token', token);
      localStorage.setItem('auth_user', userStr);

      // 如果处于弹窗 iframe 内嵌模式，通知父页面直接无刷新更新状态并平滑关闭弹窗
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'WECHAT_LOGIN_SUCCESS',
          token: token,
          user: user
        }, '*');
      } else {
        window.location.replace('/');
      }
    } catch(e) {
      console.error('Storage save error:', e);
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'WECHAT_LOGIN_SUCCESS',
          token: ${JSON.stringify(sessionToken)},
          user: ${JSON.stringify(userPayload)}
        }, '*');
      } else {
        window.location.replace('/');
      }
    }
  </script>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[WeChat Login Error]', message);
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>登录失败</title></head>
       <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:80vh;">
         <div style="text-align:center;padding:24px;border:1px solid #fee2e2;background:#fef2f2;border-radius:12px;">
           <h3 style="color:#b91c1c;">微信登录处理异常</h3>
           <p style="color:#4b5563;font-size:14px;">${escapeHtml(message)}</p>
           <a href="/" style="display:inline-block;margin-top:12px;color:#10b981;font-weight:bold;text-decoration:none;">返回首页</a>
         </div>
       </body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 500 }
    );
  }
};
