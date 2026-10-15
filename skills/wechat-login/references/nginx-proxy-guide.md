# Nginx 反向代理配置与已有业务无缝共存指南

在许多实际落地项目中，开发者可能会借助已有公司的备案域名（如 `www.example.com`）与服务器，将部署在 Cloudflare Pages / Vercel 或其他云服务的项目流量代理进来。

本文档专门总结 Nginx 反向代理中的核心匹配机制、避坑清单与共存方案。

---

## 一、核心匹配机制：最长前缀原则

Nginx 在处理 HTTP 请求时，遵循**最长前缀匹配优先**的原则：
- 若配置文件中同时存在 `location /` 和 `location /api/`：
- 访问 `/about` 会命中 `location /`；
- 访问 `/api/auth/wechat/url` 会优先命中更长、更精确的 `location /api/`！

### 典型避坑案例：Tomcat 404 截胡
- **现场表现**：前端静态页面（`/`）可以正常打开，但点击登录时后端接口报错 `HTTP Status 404 – Not Found`，且页面带有 Apache Tomcat 标志性的紫灰色样式。
- **根本原因**：原有服务器上曾经部署过旧的 Java/微信小程序后端，Nginx 配置文件中遗留了 `location /api/` 指向本机的 `http://127.0.0.1:8080/api/`。当新系统的前端请求 `/api/auth/...` 时，Nginx 没有走 `location /` 的反向代理，而是直接把请求送进了本地 Tomcat，导致 404。

---

## 二、双业务完美共存解决方案

如果服务器上原有的微信小程序/旧后台**还在正常运营、不能删除**，切勿盲目删除 `location /api/`！
利用最长前缀匹配原则，在原有的 `location /api/` **上方**新增更细分的专属路由：

```nginx
server {
    listen 443 ssl http2;
    server_name www.example.com;

    # SSL 证书配置省略...

    # ========================================================
    # 1. 优先匹配：新项目的专属 API 路径（精准转发至云端服务）
    # ========================================================
    location /api/auth/ {
        proxy_pass https://your-pages-project.pages.dev/api/auth/;
        proxy_set_header Host your-pages-project.pages.dev;
        proxy_ssl_server_name on;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 如有支付业务，一并精准转发
    location /api/pay/ {
        proxy_pass https://your-pages-project.pages.dev/api/pay/;
        proxy_set_header Host your-pages-project.pages.dev;
        proxy_ssl_server_name on;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ========================================================
    # 2. 次级匹配：原小程序/老系统的其他 /api/ 请求（原封不动保留！）
    # ========================================================
    location /api/ {
        proxy_pass http://127.0.0.1:8080/api/;
        # 原有旧配置保持不变，继续服务老业务
    }

    # ========================================================
    # 3. 兜底匹配：网站前端页面及静态资源
    # ========================================================
    location / {
        proxy_pass https://your-pages-project.pages.dev;
        proxy_set_header Host your-pages-project.pages.dev;
        proxy_ssl_server_name on;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 三、关键指令说明（必开选项）

1. **`proxy_ssl_server_name on;`**
   - **至关重要**！当 `proxy_pass` 为 HTTPS 且目标是 Cloudflare / CDN 等基于 SNI（Server Name Indication）路由的服务时，如果不开启此项，Nginx 在 TLS 握手时不会发送 Host 头，Cloudflare 会直接拒绝握手返回 520 / SSL 握手失败。
2. **`proxy_set_header Host your-target-domain.com;`**
   - 告诉上游 CDN 目标虚拟主机名称，确保请求正确落入 Pages / Workers 项目。

---

## 四、生效与验证命令

在服务器上执行以下命令测试并平滑重载：

```bash
# 1. 测试配置语法是否正确
nginx -t

# 2. 平滑重新加载配置（不中断现有连接）
nginx -s reload
```
