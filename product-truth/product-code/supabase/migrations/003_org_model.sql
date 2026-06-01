-- =====================================================
-- Migration 003: 组织级数据模型
-- 设计原则：组织 → 部门树 → 用户（多部门）→ 角色
-- 支持：导入组织架构后所有人员自动到位
-- =====================================================

-- 1. 组织（顶级租户）
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  logo_url TEXT,
  settings JSONB DEFAULT '{}',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 角色（全局字典）
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  permissions JSONB DEFAULT '[]',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 部门（树形，物化路径）
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  path TEXT,                       -- 物化路径: /root-id/parent-id/this-id/
  depth INT DEFAULT 0,
  leader_id UUID,                  -- 见 users 表
  external_id TEXT,                -- 飞书/钉钉部门 ID
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'feishu', 'dingtalk', 'csv')),
  member_count INT DEFAULT 0,
  status TEXT DEFAULT 'active',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_departments_org ON departments(org_id);
CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_id);
CREATE INDEX IF NOT EXISTS idx_departments_path ON departments(path);

-- 4. 用户
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT,
  phone TEXT,
  employee_id TEXT,                -- 工号
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  title TEXT,                      -- 职位：销售代表 / 销售总监
  password_hash TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  primary_dept_id UUID REFERENCES departments(id),
  email_verified BOOLEAN DEFAULT false,
  phone_verified BOOLEAN DEFAULT false,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_dept ON users(primary_dept_id);

-- 5. 用户-部门关联（多部门支持）
CREATE TABLE IF NOT EXISTS user_departments (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, department_id)
);

-- 6. 用户-角色关联（多角色支持）
CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  scope_type TEXT DEFAULT 'org' CHECK (scope_type IN ('org', 'department', 'space')),
  scope_id UUID,                  -- 当 scope_type='department' 时存 dept_id
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id, scope_type, scope_id)
);

-- 7. 销售空间（按部门划分的工作空间）
CREATE TABLE IF NOT EXISTS sales_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES users(id),
  active_opportunities INT DEFAULT 0,
  pending_milestones INT DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_spaces_org ON sales_spaces(org_id);
CREATE INDEX IF NOT EXISTS idx_sales_spaces_dept ON sales_spaces(department_id);

-- 8. 销售空间-成员
CREATE TABLE IF NOT EXISTS sales_space_members (
  space_id UUID NOT NULL REFERENCES sales_spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_role TEXT DEFAULT 'MEMBER' CHECK (space_role IN ('OWNER', 'MEMBER', 'VIEWER')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (space_id, user_id)
);

-- 9. 客户
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  short_name TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  industry TEXT,
  region TEXT,
  tier TEXT CHECK (tier IN ('A', 'B', 'C', 'D')),
  source TEXT,                    -- 'manual' | 'referral' | 'event' | ...
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_org ON customers(org_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- 10. 机会
CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id UUID REFERENCES sales_spaces(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  name TEXT NOT NULL,
  amount DECIMAL(15, 2) DEFAULT 0,
  currency TEXT DEFAULT 'CNY',
  status TEXT DEFAULT 'LEAD' CHECK (status IN ('LEAD', 'QUALIFIED', 'QUOTING', 'CONTRACTING', 'WON', 'LOST')),
  stage TEXT,                     -- 当前阶段
  probability INT DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  owner_id UUID NOT NULL REFERENCES users(id),
  collaborator_ids UUID[] DEFAULT '{}',
  expected_close_date DATE,
  actual_close_date DATE,
  source TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_org ON opportunities(org_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_space ON opportunities(space_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_owner ON opportunities(owner_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);

-- 11. 节点（关键节点）
CREATE TABLE IF NOT EXISTS milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('DEADLINE', 'REVIEW', 'SIGN', 'DELIVERY', 'PAYMENT', 'RENEWAL')),
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'OVERDUE')),
  priority TEXT DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  owner_id UUID NOT NULL REFERENCES users(id),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestones_opp ON milestones(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_milestones_due ON milestones(due_date);
CREATE INDEX IF NOT EXISTS idx_milestones_owner ON milestones(owner_id);

-- 12. 提醒
CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('INFO', 'TODO', 'MILESTONE', 'APPROVAL', 'FOLLOWUP', 'OVERDUE')),
  title TEXT NOT NULL,
  description TEXT,
  link_type TEXT,                 -- 'OPPORTUNITY' | 'CONTRACT' | 'QUOTE' | ...
  link_id UUID,
  priority TEXT DEFAULT 'NORMAL',
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id, read_at);

-- 13. 日程
CREATE TABLE IF NOT EXISTS agenda_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  agenda_date DATE NOT NULL,       -- 冗余便于按天查询
  related_type TEXT,
  related_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agenda_user_date ON agenda_items(user_id, agenda_date);

-- =====================================================
-- RLS 策略
-- =====================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_space_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_items ENABLE ROW LEVEL SECURITY;

-- 策略：所有人可以读全局字典（角色、组织）
CREATE POLICY "Anyone reads orgs" ON organizations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone reads roles" ON roles FOR SELECT TO authenticated USING (true);

-- 部门：同组织可读
CREATE POLICY "Same org reads departments" ON departments
  FOR SELECT TO authenticated USING (
    org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

-- 用户：同组织可读
CREATE POLICY "Same org reads users" ON users
  FOR SELECT TO authenticated USING (
    org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Same org reads user_departments" ON user_departments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Same org reads user_roles" ON user_roles
  FOR SELECT TO authenticated USING (true);

-- 销售空间：成员可读
CREATE POLICY "Members read sales_spaces" ON sales_spaces
  FOR SELECT TO authenticated USING (
    id IN (SELECT space_id FROM sales_space_members WHERE user_id = auth.uid())
    OR owner_id = auth.uid()
  );

CREATE POLICY "Members read space_members" ON sales_space_members
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 客户/机会/节点/提醒/日程：owner 可读
CREATE POLICY "Owner reads customers" ON customers
  FOR SELECT TO authenticated USING (
    created_by = auth.uid()
    OR org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Owner reads opportunities" ON opportunities
  FOR SELECT TO authenticated USING (
    owner_id = auth.uid()
    OR auth.uid() = ANY(collaborator_ids)
    OR org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Owner reads milestones" ON milestones
  FOR SELECT TO authenticated USING (
    owner_id = auth.uid()
    OR org_id::text = (SELECT org_id::text FROM users WHERE id = auth.uid())
  );

CREATE POLICY "User reads own reminders" ON reminders
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "User reads own agenda" ON agenda_items
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 触发器：自动更新物化路径
CREATE OR REPLACE FUNCTION update_department_path()
RETURNS TRIGGER AS $$
DECLARE
  parent_path TEXT;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path := '/' || NEW.id::text || '/';
    NEW.depth := 0;
  ELSE
    SELECT path, depth INTO parent_path, NEW.depth
    FROM departments WHERE id = NEW.parent_id;
    NEW.path := parent_path || NEW.id::text || '/';
    NEW.depth := NEW.depth + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_departments_path ON departments;
CREATE TRIGGER trg_departments_path
  BEFORE INSERT OR UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION update_department_path();

-- 触发器：更新部门成员数
CREATE OR REPLACE FUNCTION update_dept_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE departments SET member_count = member_count + 1 WHERE id = NEW.department_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE departments SET member_count = GREATEST(member_count - 1, 0) WHERE id = OLD.department_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_dept_count ON user_departments;
CREATE TRIGGER trg_user_dept_count
  AFTER INSERT OR DELETE ON user_departments
  FOR EACH ROW EXECUTE FUNCTION update_dept_member_count();
