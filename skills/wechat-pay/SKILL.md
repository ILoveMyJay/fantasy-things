---
name: wechat-pay
description: >-
  微信支付 Native 扫码支付完整接入方案。当用户需要在项目中集成微信支付（Native 扫码支付、
  支付回调处理、签名验签、AES-GCM 解密报文），或提及"微信支付"、"Native 支付"、
  "扫码支付"、"开通会员"、"收费功能"时激活此 Skill。
  适配 Cloudflare Workers/Pages Functions 运行时，零 npm 依赖，纯 Web Crypto API 实现签名与解密。
---

# 微信支付 Native 接入 Skill

## 激活时机

当用户说以下任意一种时激活本 Skill：
- "接入/集成微信支付"
- "Native 支付 / 扫码支付"
- "开通会员需要付款"
- "微信回调 / 支付通知"
- "签名 / 验签 / AES 解密"（微信支付上下文）

---

## 阅读顺序

1. 先读 `references/wxpay-concepts.md` — 理解核心概念（必读，避免理解偏差）
2. 再读 `references/wxpay-api-guide.md` — API 参数与错误码速查
3. 然后按照下方工作流执行，复用 `templates/` 中的代码模板

---

## 工作流：完整接入步骤

### Step 0：信息收集（开始前必须确认）

向用户收集以下信息，全部到位才能开始：

```
必须项（6个）：
□ WXPAY_MCHID        商户号（10位数字）
□ WXPAY_APPID        AppID（wx 开头的 16 位字符串）
□ WXPAY_API_V3_KEY   API v3 密钥（32位，商户后台设置）
□ WXPAY_PRIVATE_KEY  商户私钥 PEM（apiclient_key.pem 内容）
□ WXPAY_SERIAL_NO    商户证书序列号（40位十六进制）
□ WXPAY_NOTIFY_URL   回调地址（必须是 HTTPS 公网地址）

可选项：
□ WXPAY_PLATFORM_PUBLIC_KEY  微信平台公钥 PEM（用于回调验签，强烈推荐）
```

**获取指引**（告知用户）：
- 商户号、证书序列号：商户后台 → 账户中心 → API 安全
- API v3 密钥：商户后台 → 账户中心 → API 安全 → 设置 APIv3 密钥
- 私钥：申请 API 证书后下载，文件名 `apiclient_key.pem`
- AppID：微信开放平台 / 公众号后台 → 基本配置

---

### Step 1：确认技术栈

```
当前项目技术栈是什么？
├── Cloudflare Pages + Pages Functions（TypeScript）
│   └── → 直接使用 templates/ 中的代码（零修改即可运行）
├── Node.js / Express / Hono
│   └── → 将 crypto.subtle 替换为 Node.js crypto 模块
│         buildAuthHeader 中 importPrivateKey 改用 createPrivateKey()
└── 其他后端（Python / Go / Java）
    └── → 参考 references/wxpay-api-guide.md 中的签名算法
          用对应语言实现 RSA-SHA256 签名即可
```

---

### Step 2：数据库

复制 `templates/orders.sql` 到项目 migrations 目录：

```bash
# Cloudflare D1
wrangler d1 execute <数据库名> --file=migrations/orders.sql --remote

# PostgreSQL / MySQL
psql -U user -d dbname -f migrations/orders.sql
```

> `orders` 表字段说明见 `references/wxpay-concepts.md` § 数据模型

---

### Step 3：后端 API 文件

将 `templates/` 中 4 个文件复制到项目对应位置：

| 模板文件 | 放置位置（Cloudflare Pages） | 对应路由 |
|---------|---------------------------|--------|
| `_wxpay.ts` | `functions/api/pay/_wxpay.ts` | — 工具库 |
| `create.ts` | `functions/api/pay/create.ts` | `POST /api/pay/create` |
| `query.ts`  | `functions/api/pay/query.ts`  | `GET /api/pay/query`  |
| `notify.ts` | `functions/api/pay/notify.ts` | `POST /api/pay/notify` |

**必须修改的地方**（搜索 `TODO:` 标记）：
- `create.ts` → `TIER_AMOUNT` 对象：填入你的会员等级和对应金额（单位：分）
- `create.ts` → `TIER_DESCRIPTION` 对象：填入支付时显示的商品描述
- `query.ts` → `grantMembership` 函数：按你的业务逻辑实现开通会员的数据库写入
- 所有文件 → `Env` interface：按你的数据库 binding 名称调整

---

### Step 4：前端支付组件

需要实现的两个组件：

**① 定价页**（可参考 LingoKids 项目中的 `PricingPage.tsx`）
- 展示各会员等级的功能对比和价格
- 点击后触发下单

**② 支付弹窗**（可参考 LingoKids 项目中的 `PayQRModal.tsx`）
- 调用 `POST /api/pay/create` 获取 `codeUrl`
- 用 `qrcode` 库（`npm install qrcode`）在 Canvas 上渲染二维码
- 启动每 3 秒轮询 `GET /api/pay/query?orderId=xxx`
- 支付成功后回调更新用户状态

---

### Step 5：配置环境变量

```bash
# Cloudflare Pages（推荐，变量加密存储）
echo "值" | wrangler pages secret put WXPAY_MCHID --project-name <项目名>
echo "值" | wrangler pages secret put WXPAY_APPID --project-name <项目名>
echo "值" | wrangler pages secret put WXPAY_API_V3_KEY --project-name <项目名>
echo "值" | wrangler pages secret put WXPAY_SERIAL_NO --project-name <项目名>
echo "值" | wrangler pages secret put WXPAY_NOTIFY_URL --project-name <项目名>
# 私钥多行，用文件方式上传：
Get-Content apiclient_key.pem -Raw | wrangler pages secret put WXPAY_PRIVATE_KEY --project-name <项目名>

# 验证
wrangler pages secret list --project-name <项目名>
```

---

### Step 6：部署和验证

```bash
npm run build && npm run deploy
```

**测试清单**：
```
□ 打开网站，点击「支付/升级」入口
□ 弹出二维码，手机微信扫码
□ 确认支付金额正确
□ 支付后 3-10 秒内页面自动刷新显示成功
□ 检查 D1/数据库 orders 表：status = 'paid'
□ 检查 subscriptions 表：新记录已插入
□ 用 curl 测试 notify 接口是否可访问：
  curl -X POST https://你的域名/api/pay/notify -H "Content-Type: application/json" -d "{}"
  期望返回：{"code":"SUCCESS","message":"成功"}
```

---

## 关键技术说明

### 为什么不用微信官方 SDK？

Cloudflare Workers 运行在 V8 隔离环境，**不支持 Node.js `crypto` 模块**（`createSign`、`createDecipheriv` 等），所以无法使用官方 SDK 或 `wechatpay-node-v3` 等第三方库。

本 Skill 的所有加密操作均使用 **Web Crypto API**（`crypto.subtle`），这是 W3C 标准，在浏览器和所有现代 JavaScript 运行时中均可用。

### 双重支付确认机制

```
主路径：微信异步回调 notify → 立即开通
兜底路径：前端每 3 秒轮询 query → 后端主动调微信查单 API

两条路径均有幂等保护，重复触发不会重复开通。
```

---

## 参考文件索引

| 文件 | 内容 |
|------|------|
| `references/wxpay-concepts.md` | 核心概念：密钥体系、单号区别、完整流程、数据模型 |
| `references/wxpay-api-guide.md` | API 参数速查、错误码、签名算法详解 |
| `templates/_wxpay.ts` | Web Crypto API 工具库（签名/解密/验签/请求封装） |
| `templates/create.ts` | 下单接口模板 |
| `templates/query.ts` | 查单接口模板 + grantMembership 函数 |
| `templates/notify.ts` | 回调通知处理模板 |
| `templates/orders.sql` | 数据库订单表 DDL |
