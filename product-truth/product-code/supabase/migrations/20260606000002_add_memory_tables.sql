-- supabase/migrations/20260606000002_add_memory_tables.sql
-- Phase 1.2: 记忆系统表 — SessionMemory + UserProfileMemory

-- ============================================
-- 1. Session 记忆表（HTTP 会话级上下文）
-- ============================================
CREATE TABLE IF NOT EXISTS memory_sessions (
    session_id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    messages JSONB DEFAULT '[]',           -- 存储 MemoryMessage[]
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ DEFAULT (now() + interval '30 minutes'),

    -- TTL 自动清理（可选，Supabase 不支持原生 TTL，应用层处理）
    CONSTRAINT memory_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 按用户和时间查询
CREATE INDEX IF NOT EXISTS idx_memory_sessions_user ON memory_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_memory_sessions_expires ON memory_sessions (expires_at);

-- ============================================
-- 2. 用户画像表（长期记忆）
-- ============================================
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    role_tags TEXT[] DEFAULT '{}',         -- 角色标签
    frequent_actions JSONB DEFAULT '[]',   -- 常用操作统计
    risk_sensitivity FLOAT DEFAULT 0.5,    -- 风险敏感度 0-1
    preferences JSONB DEFAULT '{}',        -- 偏好设置
    behavior_summary TEXT DEFAULT '',      -- 行为摘要
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 3. RLS 策略
-- ============================================
ALTER TABLE memory_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- 用户只能访问自己的 Session
CREATE POLICY "Users can manage own sessions"
    ON memory_sessions
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid()::UUID)
    WITH CHECK (user_id = auth.uid()::UUID);

-- 用户只能访问自己的画像
CREATE POLICY "Users can manage own profile"
    ON user_profiles
    FOR ALL
    TO authenticated
    USING (user_id = auth.uid()::UUID)
    WITH CHECK (user_id = auth.uid()::UUID);

-- 管理员可查看所有
CREATE POLICY "Admins can view all profiles"
    ON user_profiles
    FOR SELECT
    TO authenticated
    USING (EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = auth.uid()::UUID
          AND r.code IN ('SUPER_ADMIN', 'ADMIN')
    ));
