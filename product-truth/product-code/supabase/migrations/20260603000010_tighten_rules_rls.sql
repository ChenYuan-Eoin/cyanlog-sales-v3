-- Migration: 20260603000010_tighten_rules_rls.sql
-- PURPOSE: 收紧 rules 表 RLS 策略，从全员全权限改为基于角色的细粒度控制

-- 1. 先清理旧策略（如果存在）
DO $$
DECLARE
  policy_name TEXT;
BEGIN
  FOR policy_name IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rules'
      AND policyname LIKE 'Allow authenticated%'
  LOOP
    EXECUTE format('DROP POLICY %I ON rules', policy_name);
  END LOOP;
END
$$;

-- 2. 创建基于角色的严格策略
-- 读取：所有认证用户可读（规则列表展示）
CREATE POLICY "Rules read for authenticated" ON rules
  FOR SELECT TO authenticated USING (true);

-- 创建：仅限管理员和配置管理员（SUPER_ADMIN, SALES_OPS）
CREATE POLICY "Rules create for admin" ON rules
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE u.id = auth.uid() AND r.code IN ('SUPER_ADMIN', 'SALES_OPS')
    )
  );

-- 更新：仅限管理员和配置管理员
CREATE POLICY "Rules update for admin" ON rules
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE u.id = auth.uid() AND r.code IN ('SUPER_ADMIN', 'SALES_OPS')
    )
  );

-- 删除：仅限管理员和配置管理员
CREATE POLICY "Rules delete for admin" ON rules
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE u.id = auth.uid() AND r.code IN ('SUPER_ADMIN', 'SALES_OPS')
    )
  );

-- 3. 注释说明
COMMENT ON TABLE rules IS '合同审核规则表。RLS策略：SELECT 对所有认证用户开放，CUD 仅限 SUPER_ADMIN 和 SALES_OPS 角色';
