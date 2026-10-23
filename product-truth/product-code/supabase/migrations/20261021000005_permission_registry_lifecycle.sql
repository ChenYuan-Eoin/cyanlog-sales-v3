-- WP48: versioned permission definitions, lifecycle history and audit.
-- permission_points remains the stable grant identity used by existing assignments.

begin;

alter table public.permission_points
  add column if not exists resource text,
  add column if not exists action text,
  add column if not exists kind text,
  add column if not exists status text,
  add column if not exists category text,
  add column if not exists semantic_version text,
  add column if not exists lifecycle_version integer,
  add column if not exists supported_scope_types text[],
  add column if not exists dependencies text[],
  add column if not exists conflicts text[],
  add column if not exists implied_by text[],
  add column if not exists enforcement_consumer text,
  add column if not exists created_by uuid references public.users(id),
  add column if not exists updated_by uuid references public.users(id),
  add column if not exists published_at timestamptz,
  add column if not exists deprecated_at timestamptz,
  add column if not exists disabled_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

update public.permission_points
set
  resource = coalesce(resource, split_part(code, ':', 1)),
  action = coalesce(action, nullif(split_part(code, ':', 2), '')),
  kind = coalesce(kind, case when code like '%:*' then 'bundle' else 'atomic' end),
  status = coalesce(status, 'published'),
  category = coalesce(category, 'shipping'),
  semantic_version = coalesce(semantic_version, '1.0.0'),
  lifecycle_version = coalesce(lifecycle_version, 1),
  supported_scope_types = coalesce(supported_scope_types, array['org','department','space','self']::text[]),
  dependencies = coalesce(dependencies, array[]::text[]),
  conflicts = coalesce(conflicts, array[]::text[]),
  implied_by = coalesce(implied_by, array[]::text[]),
  published_at = coalesce(published_at, now());

alter table public.permission_points
  alter column resource set not null,
  alter column action set not null,
  alter column kind set not null,
  alter column status set not null,
  alter column category set not null,
  alter column semantic_version set not null,
  alter column lifecycle_version set not null,
  alter column supported_scope_types set not null,
  alter column dependencies set not null,
  alter column conflicts set not null,
  alter column implied_by set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.permission_points'::regclass
      and conname = 'permission_points_kind_check'
  ) then
    alter table public.permission_points
      add constraint permission_points_kind_check check (kind in ('atomic', 'bundle'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.permission_points'::regclass
      and conname = 'permission_points_status_check'
  ) then
    alter table public.permission_points
      add constraint permission_points_status_check
      check (status in ('draft', 'reviewed', 'published', 'deprecated', 'disabled', 'deleted'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.permission_points'::regclass
      and conname = 'permission_points_lifecycle_version_check'
  ) then
    alter table public.permission_points
      add constraint permission_points_lifecycle_version_check check (lifecycle_version > 0);
  end if;
end
$$;

create index if not exists idx_permission_points_status_category
  on public.permission_points(status, category, code);

create table if not exists public.permission_point_versions (
  id uuid primary key default gen_random_uuid(),
  permission_point_id uuid not null references public.permission_points(id) on delete restrict,
  semantic_version text not null,
  lifecycle_version integer not null,
  snapshot jsonb not null,
  status text not null check (status in ('draft', 'reviewed', 'published', 'deprecated', 'disabled', 'deleted')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (permission_point_id, lifecycle_version)
);

create index if not exists idx_permission_point_versions_status
  on public.permission_point_versions(permission_point_id, status, created_at desc);

create table if not exists public.permission_point_audit_logs (
  id uuid primary key default gen_random_uuid(),
  permission_point_id uuid not null references public.permission_points(id) on delete restrict,
  actor_id uuid references public.users(id),
  action text not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_permission_point_audit_logs_permission
  on public.permission_point_audit_logs(permission_point_id, created_at desc);

alter table public.permission_point_versions enable row level security;
alter table public.permission_point_audit_logs enable row level security;

insert into public.permission_points (
  code, name, description, resource, action, kind, status, category,
  semantic_version, lifecycle_version, supported_scope_types,
  dependencies, conflicts, implied_by, enforcement_consumer
) values
  ('*', '平台全部权限', '仅供平台根角色恢复和兼容使用。', '*', '*', 'bundle', 'published', 'console', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/permissions.ts#hasPermission'),
  ('admin:access', '管理后台访问', '允许进入组织管理与后台入口。', 'admin', 'access', 'atomic', 'published', 'console', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array['org:write','user:view','user:write']::text[], 'lib/permissions.ts#canAccessOrgAdmin'),
  ('config:*', '配置中心组合权限', '包含配置读取、修改与发布。', 'config', '*', 'bundle', 'published', 'console', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/configs/access.ts'),
  ('config:read', '配置中心查看', '允许读取当前组织配置。', 'config', 'read', 'atomic', 'published', 'console', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array['config:write','config:publish']::text[], 'lib/configs/access.ts'),
  ('config:write', '配置中心修改', '允许修改当前组织配置。', 'config', 'write', 'atomic', 'published', 'console', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/configs/access.ts'),
  ('config:publish', '配置发布', '允许发布当前组织配置。', 'config', 'publish', 'atomic', 'published', 'console', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/configs/access.ts'),
  ('role:manage', '角色权限管理', '允许维护当前组织角色和权限。', 'role', 'manage', 'atomic', 'published', 'console', '1.0.0', 1, array['org']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/org-role-permissions.ts#canEditRolePermissions'),
  ('report:*', '经营报表组合权限', '经营报表资源通配能力。', 'report', '*', 'bundle', 'draft', 'console', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], null),
  ('report:dept', '部门报表访问', '请求查看部门经营数据的保留权限。', 'report', 'dept', 'atomic', 'draft', 'console', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], null),
  ('report:finance', '财务报表访问', '请求查看财务口径数据的保留权限。', 'report', 'finance', 'atomic', 'draft', 'console', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], null),
  ('org:*', '组织管理组合权限', '包含组织设置维护能力。', 'org', '*', 'bundle', 'published', 'org', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/scoped-access.ts#canManageOrg'),
  ('org:write', '组织设置修改', '允许修改组织级管理项。', 'org', 'write', 'atomic', 'published', 'org', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array['user:write','dept:write']::text[], 'lib/scoped-access.ts#canMutateOrgUsers'),
  ('dept:*', '部门组合权限', '部门查看与编辑资源通配能力。', 'dept', '*', 'bundle', 'draft', 'org', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], null),
  ('dept:view', '部门查看', '请求查看部门树和成员归属的保留权限。', 'dept', 'view', 'atomic', 'draft', 'org', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], null),
  ('dept:write', '部门编辑', '允许调整当前组织部门结构。', 'dept', 'write', 'atomic', 'published', 'org', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array['org:write']::text[], 'lib/scoped-access.ts#canMutateOrgDepartments'),
  ('user:*', '成员组合权限', '包含成员查看与编辑。', 'user', '*', 'bundle', 'published', 'org', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/permissions.ts#canAccessOrgAdmin'),
  ('user:view', '成员查看', '允许查看当前组织成员档案和角色绑定。', 'user', 'view', 'atomic', 'published', 'org', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/permissions.ts#canAccessOrgAdmin'),
  ('user:write', '成员编辑', '允许调整当前组织成员状态、部门和角色。', 'user', 'write', 'atomic', 'published', 'org', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array['org:write']::text[], 'lib/scoped-access.ts#canMutateOrgUsers'),
  ('feishu:sync', '外部通讯录同步', '请求刷新已验证外部来源部门与成员的保留权限。', 'feishu', 'sync', 'atomic', 'draft', 'org', '1.0.0', 1, array['org']::text[], array[]::text[], array[]::text[], array[]::text[], null),
  ('opportunity:*', '机会组合权限', '机会资源通配能力。', 'opportunity', '*', 'bundle', 'draft', 'quote', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], null),
  ('opportunity:own', '本人机会管理', '请求维护本人负责机会的保留权限。', 'opportunity', 'own', 'atomic', 'draft', 'quote', '1.0.0', 1, array['self']::text[], array[]::text[], array[]::text[], array[]::text[], null),
  ('quote:*', '报价组合权限', '报价资源通配能力。', 'quote', '*', 'bundle', 'published', 'quote', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/permissions.ts#hasPermission'),
  ('quote:create', '创建报价', '允许新建报价单。', 'quote', 'create', 'atomic', 'published', 'quote', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/permissions.ts#hasPermission'),
  ('quote:update_own', '编辑本人报价', '允许编辑本人创建的报价。', 'quote', 'update_own', 'atomic', 'published', 'quote', '1.0.0', 1, array['self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/permissions.ts#hasPermission'),
  ('quote:approve', '报价审批', '请求执行报价审批的保留权限。', 'quote', 'approve', 'atomic', 'draft', 'quote', '1.0.0', 1, array['org','department']::text[], array[]::text[], array[]::text[], array[]::text[], null),
  ('quote:view', '报价查看', '允许查看报价结果。', 'quote', 'view', 'atomic', 'published', 'quote', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/permissions.ts#hasPermission'),
  ('customer:*', '客户组合权限', '客户资源通配能力。', 'customer', '*', 'bundle', 'published', 'quote', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/permissions.ts#hasPermission'),
  ('customer:view', '客户查看', '允许查看客户资料。', 'customer', 'view', 'atomic', 'published', 'quote', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/permissions.ts#hasPermission'),
  ('customer:create', '客户创建', '允许录入客户。', 'customer', 'create', 'atomic', 'published', 'quote', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/permissions.ts#hasPermission'),
  ('contract:*', '合同组合权限', '合同资源通配能力。', 'contract', '*', 'bundle', 'published', 'contract', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/permissions.ts#canReviewContracts'),
  ('contract:view', '合同查看', '允许查看合同记录与审核结果。', 'contract', 'view', 'atomic', 'published', 'contract', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array['contract:read','contract:upload','contract:review','contract:write']::text[], 'lib/scoped-access.ts#canAccessContractAction'),
  ('contract:upload', '合同上传', '允许上传待审核合同。', 'contract', 'upload', 'atomic', 'published', 'contract', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array['contract:create','contract:write']::text[], 'lib/scoped-access.ts#canAccessContractAction'),
  ('contract:create', '合同创建', '允许创建合同记录。', 'contract', 'create', 'atomic', 'published', 'contract', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array['contract:upload','contract:write']::text[], 'lib/scoped-access.ts#canAccessContractAction'),
  ('contract:write', '合同编辑', '允许编辑合同相关记录。', 'contract', 'write', 'atomic', 'published', 'contract', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/scoped-access.ts#canAccessContractAction'),
  ('contract:review', '合同审核执行', '允许执行规则与模型审核。', 'contract', 'review', 'atomic', 'published', 'contract', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array['contract:write']::text[], 'lib/permissions.ts#canReviewContracts'),
  ('contract:approve', '合同审批', '请求执行合同审批的保留权限。', 'contract', 'approve', 'atomic', 'draft', 'contract', '1.0.0', 1, array['org','department']::text[], array[]::text[], array[]::text[], array[]::text[], null),
  ('contract:read', '合同结果读取', '兼容旧接口的合同读取权限。', 'contract', 'read', 'atomic', 'published', 'contract', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/scoped-access.ts#canAccessContractAction'),
  ('template:view', '模板查看', '请求查看合同模板的保留权限。', 'template', 'view', 'atomic', 'draft', 'contract', '1.0.0', 1, array['org','department']::text[], array[]::text[], array[]::text[], array[]::text[], null),
  ('payment:*', '财务与回款组合权限', '支付与回款资源通配能力。', 'payment', '*', 'bundle', 'published', 'payment', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/permissions.ts#hasPermission'),
  ('shipping:*', '寄件组合权限', '包含寄件操作与连接管理。', 'shipping', '*', 'bundle', 'published', 'shipping', '1.0.0', 1, array['org','department','space','self']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/permissions.ts#hasPermission'),
  ('shipping:operate', '寄件操作', '允许执行获授权的寄件业务操作。', 'shipping', 'operate', 'atomic', 'published', 'shipping', '1.0.0', 1, array['org','department']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/shipping/operator-access.ts#requireShippingOperator'),
  ('shipping:manage_connections', '寄件连接管理', '允许维护承运商与企业接入配置。', 'shipping', 'manage_connections', 'atomic', 'published', 'shipping', '1.0.0', 1, array['org']::text[], array[]::text[], array[]::text[], array[]::text[], 'lib/shipping/connection-authorization.ts')
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  resource = excluded.resource,
  action = excluded.action,
  kind = excluded.kind,
  status = excluded.status,
  category = excluded.category,
  semantic_version = excluded.semantic_version,
  lifecycle_version = excluded.lifecycle_version,
  supported_scope_types = excluded.supported_scope_types,
  dependencies = excluded.dependencies,
  conflicts = excluded.conflicts,
  implied_by = excluded.implied_by,
  enforcement_consumer = excluded.enforcement_consumer,
  updated_at = now();

insert into public.permission_point_versions (
  permission_point_id, semantic_version, lifecycle_version, snapshot, status, published_at
)
select
  id,
  semantic_version,
  lifecycle_version,
  jsonb_build_object(
    'key', code,
    'label', name,
    'description', description,
    'resource', resource,
    'action', action,
    'kind', kind,
    'category', category,
    'semanticVersion', semantic_version,
    'scopeTypes', supported_scope_types,
    'dependencies', dependencies,
    'conflicts', conflicts,
    'enforcementConsumer', enforcement_consumer
  ),
  status,
  published_at
from public.permission_points
on conflict (permission_point_id, lifecycle_version) do nothing;

comment on table public.permission_points is
  'Platform-owned permission family and current lifecycle state. Tenant roles reference the stable code.';
comment on table public.permission_point_versions is
  'Immutable snapshots of published or reviewed permission semantics.';
comment on table public.permission_point_audit_logs is
  'Append-only permission registry lifecycle audit.';

commit;
