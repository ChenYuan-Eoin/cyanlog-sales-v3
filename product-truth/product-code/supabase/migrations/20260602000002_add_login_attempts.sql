-- Migration: 20260602000002_add_login_attempts.sql
-- PURPOSE: Add login_attempts table for rate limiting (anti-brute-force)
-- Refs: lib/rate-limit.ts

CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,           -- email or phone used in login
  ip_address TEXT NOT NULL,           -- client IP
  success BOOLEAN NOT NULL DEFAULT FALSE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引：快速查询账号/IP 维度的失败记录
CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier
  ON login_attempts (identifier, attempted_at DESC)
  WHERE success = FALSE;

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip
  ON login_attempts (ip_address, attempted_at DESC)
  WHERE success = FALSE;

-- 索引：清理旧数据
CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at
  ON login_attempts (attempted_at);

-- 注释
COMMENT ON TABLE login_attempts IS '登录尝试记录，用于防爆破检测';
COMMENT ON COLUMN login_attempts.identifier IS '登录标识：邮箱或手机号';
COMMENT ON COLUMN login_attempts.ip_address IS '客户端 IP';
COMMENT ON COLUMN login_attempts.success IS '登录是否成功';

-- RLS: 不对外暴露，仅 service_role 可访问
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;

-- 清理策略：保留 90 天内的记录
-- 建议通过 cron job 定期执行：
-- DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '90 days';
