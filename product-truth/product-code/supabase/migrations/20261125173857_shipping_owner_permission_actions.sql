-- Publish owner-only actions. The role projection retains the current owner defaults until explicitly overridden.
begin;

with action_definitions(action, label, description) as (
  values
    ('owner_view', '查看本人寄件记录', '查看本人提报的工单、回执和系统已保存的物流。'),
    ('owner_submit', '提交本人寄件', '在本人提报入口提交一票或批量寄件工单。'),
    ('owner_address_write', '保存本人常用地址', '更新本人快捷使用的寄件地址。'),
    ('owner_resubmit', '修改并重提本人退回工单', '修改已退回的本人提报后重新提交。'),
    ('owner_tracking_refresh', '同步本人运单物流', '向承运商查询本人运单状态并回写已验证的状态。'),
    ('owner_cancel', '取消本人工单或运单', '按本人单据的处理状态取消符合条件的工单或运单。'),
    ('owner_change', '本人运单在途转寄与退回', '对符合条件的本人运单发起在途转寄或退回。')
), inserted as (
  insert into public.permission_points (
    code, name, description, resource, action, kind, status, category,
    semantic_version, lifecycle_version, supported_scope_types, dependencies,
    conflicts, implied_by, enforcement_consumer, published_at
  )
  select
    'shipping:' || action, label, description, 'shipping', action, 'atomic', 'published', 'shipping',
    '1.0.0', 1, array['self']::text[],
    case
      when action = 'owner_view' then array[]::text[]
      else array['shipping:owner_view']::text[]
    end,
    array[]::text[], array[]::text[], 'lib/shipping/http.ts', now()
  from action_definitions
  on conflict (code) do nothing
  returning *
)
insert into public.permission_point_versions (
  permission_point_id, semantic_version, lifecycle_version, snapshot, status, published_at
)
select
  id, semantic_version, lifecycle_version,
  jsonb_build_object(
    'key', code, 'label', name, 'description', description,
    'resource', resource, 'action', action, 'kind', kind, 'category', category,
    'semanticVersion', semantic_version, 'scopeTypes', supported_scope_types,
    'dependencies', dependencies, 'conflicts', conflicts, 'enforcementConsumer', enforcement_consumer
  ),
  status, published_at
from inserted;

commit;
