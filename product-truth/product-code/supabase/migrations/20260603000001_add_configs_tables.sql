-- Migration: 配置中心表结构
-- Date: 2026-06-03
-- REQ: F009, F010, F011, F012

-- 配置类型枚举
create type config_type as enum (
  'CONTRACT_RULE',    -- 合同审核规则 (F009)
  'TAX_RULE',         -- 税率规则 (F010)
  'APPROVAL_RULE',    -- 审批权限配置 (F011)
  'AI_CONFIG'         -- AI 模型配置 (F012)
);

-- 配置状态枚举
create type config_status as enum (
  'DRAFT',            -- 草稿
  'PUBLISHED',        -- 已发布
  'ARCHIVED'          -- 已归档
);

-- 主配置表
create table configs (
  id uuid primary key default gen_random_uuid(),
  key text not null,                   -- 配置键，如 TAX_STANDARD
  name text not null,                  -- 显示名称
  value jsonb not null default '{}',   -- 配置值 JSON
  type config_type not null,           -- 配置类型
  status config_status not null default 'DRAFT',
  version int not null default 1,      -- 版本号
  description text,
  org_id uuid references organizations(id) on delete cascade,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 同一组织内 key 唯一
  unique(key, org_id)
);

-- 配置版本历史表
create table config_versions (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references configs(id) on delete cascade,
  version int not null,
  value jsonb not null,
  status config_status not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),

  -- 同一配置的版本号唯一
  unique(config_id, version)
);

-- 索引
create index idx_configs_type on configs(type);
create index idx_configs_status on configs(status);
create index idx_configs_org on configs(org_id);
create index idx_configs_type_status on configs(type, status);
create index idx_config_versions_config on config_versions(config_id);

-- 更新时间触发器
create or replace function update_configs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trigger_configs_updated_at
  before update on configs
  for each row
  execute function update_configs_updated_at();

-- 版本历史自动记录触发器
create or replace function record_config_version()
returns trigger as $$
begin
  -- 只在值或状态变化时创建版本记录
  if old.value is distinct from new.value or old.status is distinct from new.status then
    insert into config_versions (config_id, version, value, status, created_by, created_at)
    values (new.id, new.version, new.value, new.status, new.created_by, new.updated_at);

    -- 增加版本号
    new.version = new.version + 1;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trigger_record_config_version
  before update on configs
  for each row
  execute function record_config_version();

-- 初始数据：默认税率规则
insert into configs (key, name, value, type, status, description) values
('TAX_STANDARD', '标准增值税', '{"rate": 0.13, "category": "货物销售", "enabled": true}'::jsonb, 'TAX_RULE', 'PUBLISHED', '标准增值税率 13%'),
('TAX_SERVICE', '现代服务业增值税', '{"rate": 0.06, "category": "服务", "enabled": true}'::jsonb, 'TAX_RULE', 'PUBLISHED', '服务类增值税率 6%'),
('TAX_TRANSPORT', '运输服务增值税', '{"rate": 0.09, "category": "运输服务", "enabled": true}'::jsonb, 'TAX_RULE', 'PUBLISHED', '运输服务增值税率 9%'),
('TAX_SMALL', '小规模纳税人', '{"rate": 0.03, "category": "通用", "enabled": false}'::jsonb, 'TAX_RULE', 'DRAFT', '小规模纳税人 3%'),
('TAX_EXEMPT', '免税', '{"rate": 0, "category": "通用", "enabled": true}'::jsonb, 'TAX_RULE', 'PUBLISHED', '免税');

-- 初始数据：审批权限配置
insert into configs (key, name, value, type, status, description) values
('APPROVAL_DISCOUNT', '折扣审批权限', jsonb_build_object(
  'rule_type', 'discount',
  'thresholds', jsonb_build_array(
    jsonb_build_object('limit', 5, 'approver_role', 'auto', 'enabled', true),
    jsonb_build_object('limit', 10, 'approver_role', 'sales_manager', 'enabled', true),
    jsonb_build_object('limit', 20, 'approver_role', 'sales_director', 'enabled', true),
    jsonb_build_object('limit', 100, 'approver_role', 'ceo', 'enabled', true)
  )
), 'APPROVAL_RULE', 'PUBLISHED', '折扣审批的三级权限配置'),
('APPROVAL_CONTRACT', '合同审批权限', jsonb_build_object(
  'rule_type', 'contract',
  'thresholds', jsonb_build_array(
    jsonb_build_object('limit', 50000, 'approver_role', 'sales_manager', 'enabled', true),
    jsonb_build_object('limit', 200000, 'approver_role', 'sales_director', 'enabled', true),
    jsonb_build_object('limit', 1000000, 'approver_role', 'ceo', 'enabled', true)
  )
), 'APPROVAL_RULE', 'PUBLISHED', '合同审批的金额权限配置');

-- 初始数据：AI 模型配置（3级降级链）
insert into configs (key, name, value, type, status, description) values
('AI_LEVEL_1', '本地模型 (LM Studio)', jsonb_build_object(
  'level', 1,
  'name', '本地模型',
  'base_url', 'http://localhost:1234/v1',
  'model', 'local-model',
  'timeout_ms', 45000,
  'enabled', true,
  'routing', jsonb_build_object('max_pages', 15, 'strategy', 'full')
), 'AI_CONFIG', 'PUBLISHED', '本地 LM Studio 模型配置'),
('AI_LEVEL_2', '云端模型 (中转)', jsonb_build_object(
  'level', 2,
  'name', '云端模型',
  'base_url', 'https://api.yiyong.ai/v1',
  'model', 'claude-sonnet',
  'timeout_ms', 45000,
  'enabled', true,
  'routing', jsonb_build_object('max_pages', 40, 'strategy', 'chunked')
), 'AI_CONFIG', 'PUBLISHED', '云端中转模型配置'),
('AI_LEVEL_3', '规则引擎 (兜底)', jsonb_build_object(
  'level', 3,
  'name', '规则引擎',
  'base_url', '',
  'model', 'rule-engine',
  'timeout_ms', 1000,
  'enabled', true,
  'routing', jsonb_build_object('max_pages', 999, 'strategy', 'rule')
), 'AI_CONFIG', 'PUBLISHED', '规则引擎兜底配置');

-- RLS 策略
alter table configs enable row level security;
alter table config_versions enable row level security;

-- configs: 用户只能看到自己组织的配置
create policy "configs_org_access" on configs
  for all
  using (org_id in (
    select org_id from user_organizations where user_id = auth.uid()
  ));

-- config_versions: 通过 configs 的访问控制
create policy "config_versions_org_access" on config_versions
  for all
  using (config_id in (
    select id from configs where org_id in (
      select org_id from user_organizations where user_id = auth.uid()
    )
  ));
