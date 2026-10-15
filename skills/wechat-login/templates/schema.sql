-- templates/schema.sql
-- 数据库迁移：支持微信扫码登录字段扩展
-- 适用：Cloudflare D1 / SQLite / PostgreSQL / MySQL

-- 1. 为现有 users 表增加微信唯一标识字段
ALTER TABLE users ADD COLUMN wx_openid VARCHAR(64);
ALTER TABLE users ADD COLUMN wx_unionid VARCHAR(64);

-- 2. 创建唯一索引（防止同一个微信重复绑定或建号）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wx_openid ON users(wx_openid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wx_unionid ON users(wx_unionid);

-- 3. （可选参考）标准的 user_sessions 会话表结构
CREATE TABLE IF NOT EXISTS user_sessions (
  token VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
