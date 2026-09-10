# 微信支付 API 速查手册

---

## 一、核心 API 端点

所有请求发往：`https://api.mch.weixin.qq.com`

| 接口 | 方法 | 路径 | 用途 |
|------|------|------|------|
| Native 下单 | POST | `/v3/pay/transactions/native` | 获取二维码 code_url |
| 查询订单 | GET | `/v3/pay/transactions/out-trade-no/{out_trade_no}` | 主动查询支付状态 |
| 关闭订单 | POST | `/v3/pay/transactions/out-trade-no/{out_trade_no}/close` | 关闭未支付订单 |
| 申请退款 | POST | `/v3/refund/domestic/refunds` | 发起退款 |

---

## 二、Native 下单 API 详解

**请求**：`POST /v3/pay/transactions/native`

```json
{
  "appid": "wx01d61e7a8726aa73",
  "mchid": "1651522093",
  "description": "LingoKids Plus 会员",
  "out_trade_no": "LK20260909AB12CD34",
  "notify_url": "https://你的域名/api/pay/notify",
  "amount": {
    "total": 1,
    "currency": "CNY"
  }
}
```

| 字段 | 类型 | 必须 | 说明 |
|------|------|------|------|
| `appid` | string | ✅ | 微信 AppID |
| `mchid` | string | ✅ | 商户号 |
| `description` | string | ✅ | 商品描述，显示在微信支付页面，最长 127 字符 |
| `out_trade_no` | string | ✅ | 商户单号，同一商户唯一，6-32 字符 |
| `notify_url` | string | ✅ | 回调地址，必须 HTTPS，不能带参数 |
| `amount.total` | int | ✅ | 金额，单位：分 |
| `amount.currency` | string | ✅ | 固定填 `CNY` |

**成功响应**：
```json
{
  "code_url": "weixin://wxpay/bizpayurl?pr=xxxxx"
}
```

将 `code_url` 转为二维码，用户扫码即可支付。

---

## 三、查询订单 API 详解

**请求**：`GET /v3/pay/transactions/out-trade-no/{out_trade_no}?mchid={mchid}`

**成功响应**（已支付）：
```json
{
  "appid": "wx01d61e7a8726aa73",
  "mchid": "1651522093",
  "out_trade_no": "LK20260909AB12CD34",
  "transaction_id": "4200002xxx...",
  "trade_type": "NATIVE",
  "trade_state": "SUCCESS",
  "trade_state_desc": "支付成功",
  "success_time": "2026-09-09T14:30:00+08:00",
  "amount": {
    "total": 1,
    "payer_total": 1,
    "currency": "CNY"
  }
}
```

`trade_state` 可能的值：

| 值 | 说明 |
|----|------|
| `SUCCESS` | 支付成功 |
| `REFUND` | 转入退款 |
| `NOTPAY` | 未支付 |
| `CLOSED` | 已关闭 |
| `PAYERROR` | 支付失败 |

---

## 四、回调通知结构

微信支付成功后会异步 POST 到 `notify_url`：

**请求 Headers**（验签用）：
```
Wechatpay-Timestamp: 1696000000
Wechatpay-Nonce: randomstr32chars
Wechatpay-Signature: Base64签名
Wechatpay-Serial: 微信平台证书序列号
```

**请求 Body**：
```json
{
  "id": "事件ID",
  "event_type": "TRANSACTION.SUCCESS",
  "resource_type": "encrypt-resource",
  "resource": {
    "algorithm": "AEAD_AES_256_GCM",
    "ciphertext": "Base64加密报文",
    "nonce": "12位随机串",
    "associated_data": "transaction"
  }
}
```

解密后明文（JSON）包含完整的订单信息，与查询订单接口响应格式相同。

**必须返回**（否则微信持续重试）：
```json
{ "code": "SUCCESS", "message": "成功" }
```

HTTP 状态码必须为 `200`。

---

## 五、签名算法完整实现

### 签名串格式（精确到每个 `\n`）

```
{HTTP方法大写}\n
{URL路径（含?之后的query string）}\n
{Unix时间戳（秒）}\n
{随机串（32位字母数字）}\n
{请求体（GET为空字符串，POST为JSON字符串）}\n
```

注意：最后一行也有 `\n`。

### JavaScript / Web Crypto API 实现

```typescript
// PEM 私钥转 ArrayBuffer（去掉头尾和换行）
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// 生成签名
async function sign(privateKeyPem: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const buf = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(message)
  );
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
```

### 回调验签（用微信公钥）

```typescript
async function verify(publicKeyPem: string, message: string, signature: string): Promise<boolean> {
  const base64 = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const key = await crypto.subtle.importKey(
    'spki',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  return crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    sigBytes,
    new TextEncoder().encode(message)
  );
}
```

### AES-256-GCM 解密

```typescript
async function decrypt(apiV3Key: string, ciphertext: string, nonce: string, associatedData: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiV3Key),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const cipherBytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new TextEncoder().encode(nonce),
      additionalData: new TextEncoder().encode(associatedData),
    },
    key,
    cipherBytes
  );
  return new TextDecoder().decode(plain);
}
```

---

## 六、常见错误码

| 错误码 | 含义 | 解决方案 |
|--------|------|---------|
| `SIGN_ERROR` | 签名错误 | 检查私钥是否正确、签名串格式是否精确（注意每行末尾的 `\n`） |
| `PARAM_ERROR` | 参数错误 | 检查必填字段，特别是 `mchid`、`amount.currency` |
| `APPID_MCHID_NOT_MATCH` | AppID 和商户号不匹配 | 确认 AppID 已在商户后台绑定 |
| `INVALID_REQUEST` | 请求非法 | 检查 `out_trade_no` 是否重复，或 `notify_url` 格式 |
| `FREQUENCY_LIMITED` | 请求频率超限 | 降低轮询频率，查单接口建议不低于 3 秒/次 |
| `ORDER_NOT_EXIST` | 订单不存在 | 商户单号错误，或订单已过期被关闭 |
| `TRADE_ERROR` | 交易错误 | 联系微信技术支持 |

---

## 七、环境变量速查

| 变量名 | 用于 | 获取位置 |
|--------|------|---------|
| `WXPAY_MCHID` | 下单、查单、所有请求 | 商户后台右上角 |
| `WXPAY_APPID` | 下单请求 body | 微信开放平台 / 公众号后台 |
| `WXPAY_API_V3_KEY` | 回调 AES 解密 | 商户后台 → API安全 → 设置APIv3密钥 |
| `WXPAY_PRIVATE_KEY` | 所有请求签名 | apiclient_key.pem 文件内容 |
| `WXPAY_SERIAL_NO` | Authorization Header | 商户后台 → API安全 → 证书序列号 |
| `WXPAY_NOTIFY_URL` | 下单请求 body | 自定义（你的 HTTPS 回调地址） |
| `WXPAY_PLATFORM_PUBLIC_KEY` | 回调验签 | 商户后台 → 账户中心 → 微信支付公钥 |
