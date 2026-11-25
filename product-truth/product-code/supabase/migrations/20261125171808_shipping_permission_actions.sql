-- Publish the separately enforced shipping role actions. Legacy grants continue to resolve in code.
begin;

with action_definitions(action, label, description) as (
  values
    ('ledger_view', '查看收寄台账', '查看当前组织的寄件工单和系统已保存的物流。'),
    ('record_create', '录入寄件工单', '在工作台录入或批量提报工单。'),
    ('record_review', '核对与处理工单', '分配归属、修改、退回或重新核对工单。'),
    ('order_confirm', '确认并下单', '确认审核后的工单并向顺丰下单。'),
    ('order_reconcile', '查回下单结果', '从承运商核实并回写下单结果。'),
    ('tracking_refresh', '同步运单物流', '向承运商查询运单轨迹并在有依据时更新平台记录。'),
    ('order_cancel', '取消运单', '按承运商与运单状态校验取消符合条件的运单。'),
    ('order_change', '在途转寄与退回', '对符合条件的运单发起在途转寄或退回。'),
    ('settings_view', '查看寄件设置', '查看脱敏后的顺丰连接、月结与寄件规则。'),
    ('connection_write', '维护顺丰连接', '更新顺丰连接凭据或执行连接验证。'),
    ('billing_write', '维护月结与可提报服务', '维护月结账号和可提报服务产品。'),
    ('intake_write', '维护默认寄方与提报规则', '维护公司默认寄件资料和提报规则。'),
    ('intercept_enable', '启用在途转寄与退回', '为本组织的顺丰连接启用在途处理能力。')
), inserted as (
  insert into public.permission_points (
    code, name, description, resource, action, kind, status, category,
    semantic_version, lifecycle_version, supported_scope_types, dependencies,
    conflicts, implied_by, enforcement_consumer, published_at
  )
  select
    'shipping:' || action, label, description, 'shipping', action, 'atomic', 'published', 'shipping',
    '1.0.0', 1, array['org']::text[],
    case
      when action in ('ledger_view', 'settings_view') then array[]::text[]
      when action in ('connection_write', 'billing_write', 'intake_write', 'intercept_enable')
        then array['shipping:settings_view']::text[]
      else array['shipping:ledger_view']::text[]
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
