-- 微信支付订单表
-- 适用于：Cloudflare D1 / SQLite
-- 如使用 PostgreSQL/MySQL，将 TEXT 改为 VARCHAR，datetime() 改为 NOW()

CREATE TABLE IF NOT EXISTS orders (
  -- 商户单号（我们自己生成，格式 LKyyyyMMddHHmmssXXXXXXXX）
  id          TEXT PRIMARY KEY,

  -- 关联用户 ID（引用你的 users 表）
  -- TODO: 修改 REFERENCES users(id) 为你实际的用户表引用
  user_id     TEXT NOT NULL,

  -- 购买的会员等级，根据你的业务调整 CHECK 约束
  -- TODO: 修改为你实际的等级值，如 ('basic','premium') 或 ('vip','svip')
  tier        TEXT NOT NULL CHECK(tier IN ('plus', 'pro')),

  -- 支付金额，单位：分（¥0.01 = 1分，¥1 = 100分）
  amount      INTEGER NOT NULL,

  -- 订单状态
  -- pending:  已下单，等待用户付款
  -- paid:     用户已成功付款
  -- expired:  二维码超过 2 小时未支付，已过期
  -- closed:   主动关闭（如下单失败）
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'paid', 'expired', 'closed')),

  -- 微信返回的二维码链接（有效期 2 小时）
  code_url    TEXT,

  -- 微信交易号（用户付款后，从回调通知中获得）
  wx_trade_no TEXT,

  -- 时间字段
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at     TEXT,       -- 支付完成时间（从微信回调中获取）
  expires_at  TEXT        -- 二维码过期时间（下单时设为 created_at + 2小时）
);

-- 索引（加速查询）
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
