-- Migration: 添加性能优化索引
-- Purpose: 优化组织架构页面的查询性能
-- Date: 2026-06-15

-- 1. users 表索引优化
-- 加速按组织查询用户
CREATE INDEX IF NOT EXISTS idx_users_org_id_created_at
  ON users(org_id, created_at DESC);

-- 加速按主部门查询用户
CREATE INDEX IF NOT EXISTS idx_users_org_primary_dept
  ON users(org_id, primary_dept_id)
  WHERE primary_dept_id IS NOT NULL;

-- 2. user_roles 表索引优化
-- 加速按组织和作用域查询角色
CREATE INDEX IF NOT EXISTS idx_user_roles_scope
  ON user_roles(scope_type, scope_id)
  WHERE scope_type = 'org';

-- 加速按用户查询角色
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id
  ON user_roles(user_id, scope_type, scope_id);

-- 3. departments 表索引优化
-- 加速按组织和层级查询部门
CREATE INDEX IF NOT EXISTS idx_departments_org_depth_sort
  ON departments(org_id, depth, sort_order);

-- 加速按父部门查询
CREATE INDEX IF NOT EXISTS idx_departments_parent_id
  ON departments(parent_id)
  WHERE parent_id IS NOT NULL;

-- 4. sales_spaces 表索引优化
-- 加速按组织和部门查询销售空间
CREATE INDEX IF NOT EXISTS idx_sales_spaces_org_dept
  ON sales_spaces(org_id, department_id);

-- 5. auth_tokens 表索引优化（如果存在且未创建）
-- 加速 token 验证查询
CREATE INDEX IF NOT EXISTS idx_auth_tokens_token
  ON auth_tokens(token, expires_at);

-- 6. user_organizations 表索引优化
-- 加速用户默认组织查询
CREATE INDEX IF NOT EXISTS idx_user_orgs_user_default
  ON user_organizations(user_id, is_default)
  WHERE is_default = true;

-- 添加注释
COMMENT ON INDEX idx_users_org_id_created_at IS '优化组织架构页面用户列表查询';
COMMENT ON INDEX idx_user_roles_scope IS '优化组织级角色权限查询';
COMMENT ON INDEX idx_departments_org_depth_sort IS '优化部门树结构查询';
COMMENT ON INDEX idx_auth_tokens_token IS '优化中间件 token 验证性能';
