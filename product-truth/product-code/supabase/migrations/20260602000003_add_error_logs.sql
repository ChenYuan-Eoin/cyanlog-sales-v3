-- Migration: 20260602000003_add_error_logs.sql
-- PURPOSE: Add error_logs table for self-hosted error tracking (no external SaaS)
-- Refs: lib/error-log.ts

CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT NOT NULL DEFAULT 'error',  -- 'error' | 'warn' | 'info'
  source TEXT,                          -- 'api' | 'client' | 'worker'
  path TEXT,                            -- 请求路径 / 页面 URL
  method TEXT,                          -- HTTP method
  status_code INTEGER,                  -- HTTP status
  message TEXT NOT NULL,                -- 错误消息
  stack TEXT,                           -- 错误堆栈（截断 4KB）
  context JSONB,                        -- 任意上下文（user_id / request_id / params）
  user_id UUID,                         -- 触发错误的用户
  ip_address TEXT,                      -- 客户端 IP
  user_agent TEXT,                      -- 浏览器 UA
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引：按时间倒序查询（错误列表）
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs (created_at DESC);

-- 索引：按 level 过滤
CREATE INDEX IF NOT EXISTS idx_error_logs_level ON error_logs (level, created_at DESC);

-- 索引：按 path 聚合
CREATE INDEX IF NOT EXISTS idx_error_logs_path ON error_logs (path, created_at DESC);

-- 注释
COMMENT ON TABLE error_logs IS '错误日志表，自托管替代 Sentry/LogRocket';
COMMENT ON COLUMN error_logs.context IS 'JSONB 上下文：user_id / request_id / params';
COMMENT ON COLUMN error_logs.stack IS '错误堆栈（最大 4KB）';

-- RLS: 不对外暴露，仅 service_role 可访问
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- 清理策略：保留 30 天
-- 建议通过 cron job 定期执行：
-- DELETE FROM error_logs WHERE created_at < NOW() - INTERVAL '30 days';
