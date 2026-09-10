# 微信支付核心概念手册

> 阅读本文档后，你将完整理解微信支付的密钥体系、单号体系、支付流程和数据模型。

---

## 一、密钥体系（最重要）

微信支付整个安全体系由**两套独立的密钥对**构成，各司其职：

### 第一套：商户密钥对（你持有）

```
私钥（apiclient_key.pem）
  ├── 持有者：商户自己（绝对不能泄露）
  ├── 用途：对每一个发给微信的 API 请求进行 RSA-SHA256 签名
  └── 证明：这个请求是"我商户"发出的，不是伪造的

公钥（包含在 apiclient_cert.pem 证书中）
  ├── 持有者：微信平台（你上传给微信的）
  ├── 用途：微信用它验证你发来的请求签名是否合法
  └── 对应序列号：WXPAY_SERIAL_NO（放在 Authorization Header 里告诉微信用哪个证书）
```

### 第二套：微信平台密钥对（微信持有）

```
私钥
  ├── 持有者：微信官方（商户永远拿不到）
  ├── 用途：微信对每一个回调通知进行签名
  └── 证明：这个回调通知是"微信官方"发出的，不是伪造的

公钥（WXPAY_PLATFORM_PUBLIC_KEY）
  ├── 持有者：商户（从微信平台下载）
  ├── 用途：验证收到的回调通知确实来自微信
  └── 获取：商户后台 → 账户中心 → 微信支付公钥
```

### 密钥使用方向总结

```
方向：我们 → 微信（下单请求）
  我们用：商户私钥 签名
  微信用：商户公钥 验签

方向：微信 → 我们（支付回调）
  微信用：微信私钥 签名
  我们用：微信公钥 验签
  加密：用 WXPAY_API_V3_KEY（32位对称密钥）AES-GCM 加密报文体
  解密：我们用相同的 WXPAY_API_V3_KEY 解密
```

> **规律**：谁发消息，谁用自己的私钥签；接收方用发送方的公钥验。

---

## 二、单号体系

微信支付涉及两个不同来源的订单号：

| 单号 | 名称 | 谁生成 | 何时产生 | 格式示例 |
|------|------|--------|---------|---------|
| `out_trade_no` | 商户单号 | **我们自己** | 调用下单 API **之前** | `LK20260909AB12CD34` |
| `transaction_id` | 交易单号 | **微信官方** | 用户付款**之后** | `4200002xxx...`（28位） |

**关键理解**：
- 必须先有商户单号，才能调微信下单 API
- 调完下单 API 得到二维码，用户扫码付款后，微信才生成交易单号
- 微信通过回调通知把交易单号告诉我们
- 两个号都存入数据库，退款时两个号都能用来查询

**为什么要自己生成商户单号？**
1. 微信下单 API 要求必须传（否则报错）
2. 可以在号里编码业务信息（日期、用户ID等）方便排查
3. 同一个商户单号只能下单一次（天然幂等保护）
4. 财务对账时两个号互相印证

---

## 三、完整支付流程

```
【第一阶段：创建订单】

用户点击「购买/升级」
    ↓
前端 POST /api/pay/create { tier: 'plus' }
    ↓
后端验证用户身份（Session Token）
    ↓
后端生成商户单号（LKxxxxxxxxxx）
    ↓
后端写入 orders 表（status = 'pending'）
    ↓
后端构造签名：
  签名串 = "POST\n/v3/pay/transactions/native\n{时间戳}\n{随机串}\n{请求体}\n"
  签名 = RSA-SHA256(商户私钥, 签名串)
  Authorization Header = "WECHATPAY2-SHA256-RSA2048 mchid=...,signature=..."
    ↓
后端 POST https://api.mch.weixin.qq.com/v3/pay/transactions/native
    ↓
微信返回 { code_url: "weixin://wxpay/..." }
    ↓
后端更新 orders.code_url，返回给前端 { orderId, codeUrl }

【第二阶段：展示二维码】

前端用 qrcode 库将 codeUrl 渲染为二维码图片
启动 2 小时倒计时（code_url 有效期为 2 小时）
启动每 3 秒轮询（查询支付状态）
用户用微信扫码 → 调起微信收银台 → 确认支付

【第三阶段：支付确认（双重保险）】

路径 A（主路径）：微信主动回调
  微信 POST {WXPAY_NOTIFY_URL}
      ↓
  验证回调签名（防伪造）
      ↓
  AES-256-GCM 解密 resource.ciphertext
      ↓
  核对金额、商户单号
      ↓
  更新 orders.status = 'paid'
  写入 subscriptions 表（开通会员）
      ↓
  返回 { "code": "SUCCESS" }

路径 B（兜底）：前端轮询
  前端每 3 秒 GET /api/pay/query?orderId=xxx
      ↓
  后端查 orders 表
      ↓
  若仍 pending，额外调微信查单 API 主动询问
      ↓
  微信说已支付 → 我们自己触发开通会员
      ↓
  返回 { status: 'paid' }

【第四阶段：完成】

前端收到 paid → 关闭弹窗 → 显示成功动画
重新请求用户信息（tier 已更新）
解锁对应功能
```

---

## 四、API 签名算法（详细）

微信 API v3 使用 `WECHATPAY2-SHA256-RSA2048` 签名方案：

### 签名串构造规则

```
{HTTP方法}\n
{URL路径（含query string）}\n
{时间戳（Unix秒）}\n
{随机串（32位字母数字）}\n
{请求体（GET请求为空字符串）}\n
```

### 完整 Authorization Header 格式

```
WECHATPAY2-SHA256-RSA2048
  mchid="{商户号}",
  nonce_str="{随机串}",
  timestamp="{时间戳}",
  serial_no="{证书序列号}",
  signature="{Base64(RSA-SHA256(私钥, 签名串))}"
```

---

## 五、回调通知结构

微信发来的回调 POST 请求：

```
Headers:
  Wechatpay-Timestamp: 1696000000
  Wechatpay-Nonce: abc123...
  Wechatpay-Signature: Base64编码的签名
  Wechatpay-Serial: 微信平台证书序列号

Body（JSON）:
{
  "event_type": "TRANSACTION.SUCCESS",
  "resource": {
    "algorithm": "AEAD_AES_256_GCM",
    "ciphertext": "Base64加密报文",
    "nonce": "12位随机串",
    "associated_data": "transaction"
  }
}
```

解密后得到的明文包含：
- `out_trade_no`：商户单号
- `transaction_id`：微信交易单号
- `trade_state`：`SUCCESS` 表示支付成功
- `success_time`：支付完成时间
- `amount.total`：实际支付金额（分）

---

## 六、数据模型

### orders 表（订单）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | 商户单号（我们生成） |
| `user_id` | TEXT | 关联用户 |
| `tier` | TEXT | 购买的会员等级 |
| `amount` | INTEGER | 金额（分，1分=¥0.01） |
| `status` | TEXT | `pending/paid/expired/closed` |
| `code_url` | TEXT | 微信二维码链接（2小时有效） |
| `wx_trade_no` | TEXT | 微信交易号（付款后填入） |
| `created_at` | TEXT | 创建时间 |
| `paid_at` | TEXT | 支付完成时间 |
| `expires_at` | TEXT | 二维码过期时间 |

### subscriptions 表（会员订阅）

付款成功后写入：

| 字段 | 说明 |
|------|------|
| `user_id` | 关联用户 |
| `tier` | `plus / pro / lifetime` |
| `status` | `active / cancelled / expired` |
| `expires_at` | 有效期（月度会员=30天后） |

---

## 七、常见问题

**Q: code_url 用一次就失效吗？**
A: 不是。code_url 有效期 2 小时，用户可以在这 2 小时内重复扫码（只要没付款）。超过 2 小时需要重新下单获取新的 code_url。

**Q: 用户扫码后关掉了微信，还能支付吗？**
A: 可以，二维码还在有效期内就能再扫。

**Q: 微信回调失败会重试吗？**
A: 会。如果你的 notify 接口没有返回 `{ "code": "SUCCESS" }`，微信会在一定时间内（最多 24 小时）多次重试，间隔逐渐增大。所以 notify 必须实现幂等处理。

**Q: 金额单位是什么？**
A: 分（fen）。¥0.01 = 1分，¥1 = 100分，¥10 = 1000分。

**Q: 测试时如何避免真实扣款？**
A: 微信没有沙盒模式（或沙盒功能有限），建议直接用真实环境测试，金额设为最小值 ¥0.01。
