---
name: wechat-login
description: >-
  微信开放平台 PC 网页扫码登录全流程集成方案。当用户需要在项目中集成微信扫码登录、
  配置微信网站应用 OAuth2 授权回调、排查 redirect_uri 错误、解决弹窗内嵌二维码被截断或去除第三方应用名、
  处理已部署 Nginx 服务器反代共存，或提及"微信扫码登录"、"微信登录"、"开放平台网站应用"时激活此 Skill。
  提供弹窗 iframe 内嵌扫码、postMessage 无刷新登录态通信、纯标准 UUID 用户落库规范及零依赖后端 Functions 实现。
---

# 微信开放平台 PC 网页扫码登录接入 Skill

本 Skill 沉淀了**微信开放平台 PC 网页扫码登录**从资质审核、Nginx 反代共存、OAuth2 票据流转、弹窗内嵌二维码、样式注入防截断，到父子通信无刷新更新用户态的全链路工程化方案。

---

## 一、激活时机

当用户提及以下任意内容时，立即激活本 Skill：
- "接入/集成微信扫码登录"、"微信网页登录"
- "微信开放平台网站应用"
- "扫码登录弹窗内嵌二维码"
- "微信二维码显示不全 / 被切断 / 显示靠上"
- "微信登录去除二维码下方的第三方应用名称"
- "微信扫码 redirect_uri 参数错误"
- "已有 Nginx 服务器接入微信登录接口 404"

---

## 二、阅读与执行顺序

1. **必读概念**：先读 `references/wechat-oauth-concepts.md`（理解 OpenID 与 UnionID 差异、OAuth2 时序与资质门槛）；
2. **反代必读**：若借用已有备案服务器，必读 `references/nginx-proxy-guide.md`（防范 Tomcat 404 截流）；
3. **按步执行**：按下方 Step 0 ~ Step 5 执行，直接复用 `templates/` 中的生产级代码模板。

---

## 三、接入完整工作流

### Step 0：参数与资质确认（开始前核对）

向用户核对以下 3 项必要信息：

```
必须项：
□ WECHAT_LOGIN_APPID    微信开放平台【网站应用】分配的 AppID（wx 开头）
□ WECHAT_LOGIN_SECRET   微信开放平台【网站应用】分配的 AppSecret
□ 授权回调域名           后台【开发配置】中填写的【授权回调域】（如 www.example.com）
```

> [!IMPORTANT]
> **授权回调域的“全字匹配”避坑法则**：
> 微信开放平台校验回调域名为**严格全字匹配**！
> - 若后台填写 `www.example.com`，授权请求传 `example.com`（缺 www）或 `pages.dev` 微信直接报错 `redirect_uri 错误`，二维码无法生成；
> - 必须确保代码中生成的 `redirect_uri` 的 host 与微信后台登记的域名严格完全一致。

---

### Step 1：Nginx 反向代理与已有业务共存（若适用）

如果借用已有公司的备案服务器：
1. **检查旧路由**：确认原有 Nginx 配置中是否已有 `location /api/`（如旧小程序、旧 Java/Tomcat 后台）；
2. **实施共存规则**：切勿盲目删除已有 `/api/`！利用最长前缀原则，在老 `location /api/` **上方**新增新项目的专属路由：

```nginx
# 1. 优先匹配：新项目专属接口（转发给 Cloudflare Pages / 实际云服务）
location /api/auth/ {
    proxy_pass https://your-project.pages.dev/api/auth/;
    proxy_set_header Host your-project.pages.dev;
    proxy_ssl_server_name on; # 必开！否则无法通过 SNI 握手
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# 2. 次级匹配：老系统/小程序业务（原封不动保留）
location /api/ {
    proxy_pass http://127.0.0.1:8080/api/;
}

# 3. 页面根路径转发
location / {
    proxy_pass https://your-project.pages.dev;
    proxy_set_header Host your-project.pages.dev;
    proxy_ssl_server_name on;
}
```

修改后执行 `nginx -t && nginx -s reload`。

---

### Step 2：数据库结构扩容

执行 `templates/schema.sql`，为系统 `users` 用户表扩容微信专属唯一索引：

```sql
ALTER TABLE users ADD COLUMN wx_openid VARCHAR(64);
ALTER TABLE users ADD COLUMN wx_unionid VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wx_openid ON users(wx_openid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wx_unionid ON users(wx_unionid);
```

---

### Step 3：后端 Functions 接口复制

将 `templates/` 中的后端代码复制到项目对应路径：

| 模板文件 | 目标路径 | 功能说明 |
| :--- | :--- | :--- |
| `url.ts` | `functions/api/auth/wechat/url.ts` | 生成包含 `login_type=jssdk`、`self_redirect=true`、防 CSRF state 及 base64 CSS 注入的微信授权链接 |
| `callback.ts` | `functions/api/auth/wechat/callback.ts` | 接收微信 code 换票、拉取公开资料、形态 B（纯标准 UUID）自动建档、同源写入 LocalStorage 并发送 `postMessage` 通知父页面 |

---

### Step 4：微信 iframe 自定义 CSS 与消除第三方应用名

微信官方在 `login_type=jssdk` 模式下，允许通过 `href` 参数注入自定义 CSS。

1. **部署静态样式表**：将 `templates/wechat-login.css` 放置于项目的 `public/wechat-login.css`；
2. **base64 内联注入（双重保险）**：在 `url.ts` 中通过 `btoa()` 动态注入核心规则：
   - 彻底隐藏第三方应用名称（如“雨沐春林”）：`.web_qrcode_panel_normal_login p, .impowerBox .info, p { display: none !important; }`
   - 消除二维码自身顶部多余间隙：`.impowerBox .qrcode { margin-top: 0 !important; }`

---

### Step 5：前端弹窗集成（防止二维码截断的核心尺寸公式）

参考 `templates/LoginModal.snippet.tsx`，在弹窗中嵌入微信二维码：

> [!CAUTION]
> **二维码底部截断问题排查与核心公式**：
> 微信官方二维码图片物理尺寸为 **`280px × 280px`**（带 1px 细灰边框与 15px 顶部间距）。
> - **错误做法**：将 iframe 设为 `240px` 并加负边距 `-mt-xx`，会导致二维码底部回字定位方块被直接截断横切！
> - **黄金标准公式**：
>   - 外层卡片容器：`w-[280px] h-[270px] overflow-hidden rounded-2xl flex items-center justify-center`
>   - 内部 iframe：`w-[300px] h-[300px] shrink-0 scale-[0.82] origin-center`
>   - **效果**：等比微缩至 246px，正处于卡片正中心，**上下留白 12px、左右留白 17px，四个定位角与四条外边线 100% 完整显示，绝不切除任何点阵**！

#### postMessage 自动更新机制
在前端登录弹窗挂载时添加监听：
```typescript
useEffect(() => {
  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === 'WECHAT_LOGIN_SUCCESS') {
      const { token, user } = event.data;
      // 1. 同步保存到前端 storage
      localStorage.setItem('auth_token', token);
      localStorage.setItem('auth_user', JSON.stringify(user));
      // 2. 更新 React 状态
      onLoginSuccess(user);
      // 3. 关闭弹窗（无刷新完成登录）
      onClose();
    }
  };
  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}, []);
```

---

## 四、经典排查与故障速查手册

| 现象 | 根因定位 | 解决方案 |
| :--- | :--- | :--- |
| **微信返回页面提示：`redirect_uri 参数错误`** | 微信开放平台后台填写的授权域名与请求中的 `redirect_uri` 不一致（例如缺少 `www.` 或协议头不匹配）。 | 严格核对开放平台后台，确保代码中写死的域名与后台一致。 |
| **请求 `/api/auth/...` 返回 404（带 Tomcat 页面）** | Nginx 原配置中包含优先级更高的 `location /api/`，将请求打到了本地不存在该路由的 Tomcat。 | 参考 `references/nginx-proxy-guide.md` 配置最长匹配 `location /api/auth/` 优先转发。 |
| **扫码授权成功，返回首页后依然显示未登录** | 回调 HTML 写入 LocalStorage 的 Key 与前端 `authService` 读取的 Key 存在拼写差异（例如 `token` 与 `auth_token`）。 | 统一检查前后端使用的 LocalStorage 键名保持一致。 |
| **二维码左下角或底部回字方块被切掉一半** | iframe 高度不足（如设为 242px），切断了 280px 的二维码底部。 | 按照 Step 5 采用 `300x300` 视口配合 `scale-0.82` 缩放，完整展示全部方块。 |
| **二维码正下方出现无关的第三方应用名文字** | 微信 iframe 默认附带了开放平台登记的应用名称标签。 | 在 `url.ts` 与 `wechat-login.css` 中注入隐藏样式。 |
