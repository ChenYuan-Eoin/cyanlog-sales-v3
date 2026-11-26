-- Classify existing authorization points without changing grant enforcement or lifecycle state.
begin;

alter table public.permission_points
  add column module_key text,
  add column capability_level text,
  add column grant_subject_types text[] not null default array[]::text[],
  add constraint permission_points_dictionary_location_check check (
    (module_key is null and capability_level is null and cardinality(grant_subject_types) = 0)
    or (module_key is not null and capability_level is not null
      and module_key ~ '^[a-z][a-z0-9_-]{0,62}$' and capability_level in ('L1', 'L2', 'L3', 'L4'))
  ),
  add constraint permission_points_dictionary_subjects_check check (grant_subject_types in (
    array[]::text[], array['role'], array['department'], array['role', 'department'], array['department', 'role']
  ));

-- These organization actions already have server-side checks and directory entries.
-- Register them on databases that did not yet include them in the dictionary.
with definitions(code, label, description, capability_level, dependency, consumer) as (
  values
    ('role:view', '查看角色及成员', '查看当前组织的角色、有效成员和权限配置。', 'L4', 'user:view', 'lib/permissions.ts#canReadRoleDirectory'),
    ('dept:directory_view', '查看部门树', '查看当前组织的部门层级。', 'L3', null, 'lib/admin/department-actions.ts'),
    ('dept:edit_structure', '维护部门', '新增部门以及修改部门名称、上级和负责人。', 'L4', 'dept:directory_view', 'lib/admin/department-actions.ts'),
    ('dept:delete_structure', '删除部门', '删除符合条件的部门。', 'L4', 'dept:directory_view', 'lib/admin/department-actions.ts'),
    ('user:edit_profile', '编辑成员', '修改当前组织内成员的资料和部门归属。', 'L3', 'user:view', 'lib/admin/member-actions.ts'),
    ('user:invite', '添加或邀请成员', '创建邀请、重发或撤销待激活邀请。', 'L3', 'user:view', 'lib/admin/member-actions.ts'),
    ('user:manage_login', '管理成员登录', '启用或停用本组织成员登录。', 'L3', 'user:view', 'lib/admin/member-actions.ts'),
    ('user:manage_employment', '办理离职或复职', '更新本组织成员的在职状态。', 'L3', 'user:view', 'lib/admin/member-actions.ts'),
    ('user:remove_membership', '移出组织', '结束成员在当前组织的成员关系。', 'L3', 'user:view', 'lib/admin/member-actions.ts'),
    ('org:source_view', '查看连接与同步状态', '查看本组织的外部连接和目录同步状态。', 'L4', null, 'lib/admin/organization-source-access.ts'),
    ('org:source_connect', '维护与验证连接', '保存或验证本组织的外部连接。', 'L4', null, 'lib/admin/organization-source-access.ts'),
    ('org:source_preview', '预览目录同步', '预览部门与成员的目录变更。', 'L4', null, 'lib/admin/organization-source-access.ts'),
    ('org:source_apply', '应用或回滚目录同步', '应用已核对的同步、切换目录来源或回滚切换。', 'L4', null, 'lib/admin/organization-source-access.ts')
), inserted as (
  insert into public.permission_points (
    code, name, description, resource, action, kind, status, category,
    semantic_version, lifecycle_version, supported_scope_types,
    dependencies, conflicts, implied_by, enforcement_consumer,
    module_key, capability_level, grant_subject_types, published_at
  )
  select code, label, description, split_part(code, ':', 1), split_part(code, ':', 2),
    'atomic', 'published', 'org', '1.0.0', 1, array['org'],
    case when dependency is null then array[]::text[] else array[dependency] end,
    array[]::text[], array[]::text[], consumer, 'config', capability_level, array['role'], now()
  from definitions
  on conflict (code) do nothing
  returning *
), revised_review as (
  -- The new return action has its own permission; retain the prior review
  -- description in its historical version.
  update public.permission_points
  set description = '分配归属、修改或重新核对工单。',
      module_key = 'shipping', capability_level = 'L3', grant_subject_types = array['role'],
      lifecycle_version = lifecycle_version + 1, updated_at = now()
  where code = 'shipping:record_review'
    and description is distinct from '分配归属、修改或重新核对工单。'
    and exists (select 1 from public.permission_points where code = 'shipping:record_return')
  returning *
)
insert into public.permission_point_versions (
  permission_point_id, semantic_version, lifecycle_version, snapshot, status, published_at
)
select
  id, semantic_version, lifecycle_version,
  jsonb_build_object(
    'key', code, 'label', name, 'description', description, 'resource', resource, 'action', action,
    'kind', kind, 'category', category, 'semanticVersion', semantic_version, 'scopeTypes', supported_scope_types,
    'dependencies', dependencies, 'conflicts', conflicts, 'enforcementConsumer', enforcement_consumer,
    'moduleKey', module_key, 'capabilityLevel', capability_level, 'grantSubjectTypes', grant_subject_types
  ),
  status, published_at
from (select * from inserted union all select * from revised_review) as definitions;

with dictionary(code, module_key, capability_level, grant_subject_types) as (
  values
    ('shipping:owner_view', 'shipping', 'L2', array['role']::text[]),
    ('shipping:owner_submit', 'shipping', 'L2', array['role']::text[]),
    ('shipping:owner_address_write', 'shipping', 'L2', array['role']::text[]),
    ('shipping:owner_resubmit', 'shipping', 'L2', array['role']::text[]),
    ('shipping:owner_tracking_refresh', 'shipping', 'L2', array['role']::text[]),
    ('shipping:owner_cancel', 'shipping', 'L2', array['role']::text[]),
    ('shipping:owner_change', 'shipping', 'L2', array['role']::text[]),
    ('shipping:ledger_view', 'shipping', 'L3', array['role', 'department']::text[]),
    ('shipping:record_create', 'shipping', 'L3', array['role']::text[]),
    ('shipping:record_review', 'shipping', 'L3', array['role']::text[]),
    ('shipping:record_return', 'shipping', 'L3', array['role']::text[]),
    ('shipping:order_confirm', 'shipping', 'L3', array['role']::text[]),
    ('shipping:order_reconcile', 'shipping', 'L3', array['role']::text[]),
    ('shipping:tracking_refresh', 'shipping', 'L3', array['role']::text[]),
    ('shipping:order_cancel', 'shipping', 'L3', array['role']::text[]),
    ('shipping:order_change', 'shipping', 'L3', array['role']::text[]),
    ('shipping:settings_view', 'shipping-settings', 'L4', array['role']::text[]),
    ('shipping:connection_write', 'shipping-settings', 'L4', array['role']::text[]),
    ('shipping:billing_write', 'shipping-settings', 'L4', array['role']::text[]),
    ('shipping:intake_write', 'shipping-settings', 'L4', array['role']::text[]),
    ('shipping:intercept_enable', 'shipping-settings', 'L4', array['role']::text[]),
    ('role:view', 'config', 'L4', array['role']::text[]),
    ('dept:directory_view', 'config', 'L3', array['role']::text[]),
    ('dept:edit_structure', 'config', 'L4', array['role']::text[]),
    ('dept:delete_structure', 'config', 'L4', array['role']::text[]),
    ('user:edit_profile', 'config', 'L3', array['role']::text[]),
    ('user:invite', 'config', 'L3', array['role']::text[]),
    ('user:manage_login', 'config', 'L3', array['role']::text[]),
    ('user:manage_employment', 'config', 'L3', array['role']::text[]),
    ('user:remove_membership', 'config', 'L3', array['role']::text[]),
    ('org:source_view', 'config', 'L4', array['role']::text[]),
    ('org:source_connect', 'config', 'L4', array['role']::text[]),
    ('org:source_preview', 'config', 'L4', array['role']::text[]),
    ('org:source_apply', 'config', 'L4', array['role']::text[]),
    ('config:read', 'config', 'L4', array['role']::text[]),
    ('config:write', 'config', 'L4', array['role']::text[]),
    ('config:publish', 'config', 'L4', array['role']::text[]),
    ('user:view', 'config', 'L3', array['role']::text[]),
    ('role:manage', 'config', 'L4', array[]::text[]),
    ('user:assign_roles', 'config', 'L4', array[]::text[])
)
update public.permission_points point
set module_key = dictionary.module_key,
    capability_level = dictionary.capability_level,
    grant_subject_types = dictionary.grant_subject_types
from dictionary
where point.code = dictionary.code
  and (point.module_key, point.capability_level, point.grant_subject_types)
    is distinct from (dictionary.module_key, dictionary.capability_level, dictionary.grant_subject_types);

commit;
