-- F054: carry forward eligible legacy grants and publish their exact org scope.
begin;

set local lock_timeout = '5s';
lock table public.organizations, public.users, public.user_organizations in share mode;
lock table public.permission_points, public.roles, public.user_roles,
  public.user_permission_assignments in share row exclusive mode;

insert into public.roles (code, name, description, permissions, sort_order)
values (
  'SHIPPING_OPERATOR', '顺丰寄件操作员',
  '在获授权的组织内办理顺丰寄件业务。', '["shipping:operate"]'::jsonb, 90
)
on conflict (code) do nothing;

with definitions as (
  update public.permission_points
  set description = '允许在当前组织执行获授权的顺丰寄件业务操作。',
      lifecycle_version = 2,
      supported_scope_types = array['org']::text[],
      published_at = now(),
      updated_at = now()
  where code = 'shipping:operate' and status = 'published' and lifecycle_version = 1
    and resource = 'shipping' and action = 'operate' and kind = 'atomic' and category = 'shipping'
    and supported_scope_types = array['org', 'department']::text[]
    and cardinality(dependencies) = 0 and cardinality(conflicts) = 0 and cardinality(implied_by) = 0
    and enforcement_consumer = 'lib/shipping/operator-access.ts#requireShippingOperator'
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
from definitions;

-- Membership identifies the tenant even when another active tenant is currently selected.
-- Runtime authorization still requires the exact current active organization.
create temporary table shipping_operator_eligible_grants on commit drop as
select direct.id, direct.user_id, direct.org_id, direct.assigned_by, direct.assigned_at
from public.user_permission_assignments as direct
join public.permission_points as point on point.id = direct.permission_point_id and point.code = 'shipping:operate'
join public.organizations as org on org.id = direct.org_id and org.status = 'active'
join public.users as person on person.id = direct.user_id and person.status = 'active' and person.login_enabled is true
join public.user_organizations as member on member.user_id = direct.user_id and member.org_id = direct.org_id
  and member.status = 'active' and member.employment_status = 'active' and member.left_at is null;

do $$
declare
  operator_role public.roles%rowtype;
  eligible_count bigint;
  removed_count bigint;
begin
  -- The new runtime requires this definition even when no grants need conversion.
  if not exists (
    select 1 from public.permission_points
    where code = 'shipping:operate' and status = 'published'
      and resource = 'shipping' and action = 'operate' and kind = 'atomic' and category = 'shipping'
      and supported_scope_types = array['org']::text[]
      and cardinality(dependencies) = 0 and cardinality(conflicts) = 0 and cardinality(implied_by) = 0
      and enforcement_consumer = 'lib/shipping/operator-access.ts#requireShippingOperator'
  ) then
    raise exception 'shipping operator parity requires the published organization-only permission definition' using errcode = '23514';
  end if;

  select count(*) into eligible_count from pg_temp.shipping_operator_eligible_grants;
  if eligible_count = 0 then return; end if;

  select * into strict operator_role from public.roles where code = 'SHIPPING_OPERATOR';
  if operator_role.permissions is distinct from '["shipping:operate"]'::jsonb
    or nullif(btrim(operator_role.name), '') is null then
    raise exception 'shipping operator parity requires the dedicated role to contain only shipping:operate' using errcode = '23514';
  end if;

  -- Match resolveRolePermissions for the dedicated role. An explicit, malformed or
  -- broader override cannot be replaced or silently worked around by this migration.
  if exists (
    select 1
    from public.organizations as org
    where exists (select 1 from pg_temp.shipping_operator_eligible_grants as eligible where eligible.org_id = org.id)
      and case
        when org.settings is null or org.settings = 'null'::jsonb then operator_role.permissions
        when jsonb_typeof(org.settings) <> 'object' then null
        when not (org.settings ? 'role_permission_overrides') then operator_role.permissions
        when jsonb_typeof(org.settings->'role_permission_overrides') <> 'object' then null
        when not (org.settings->'role_permission_overrides' ? operator_role.id::text) then operator_role.permissions
        else org.settings->'role_permission_overrides'->operator_role.id::text
      end is distinct from '["shipping:operate"]'::jsonb
  ) then
    raise exception 'shipping operator parity conflicts with an organization role override' using errcode = '23514';
  end if;

  insert into public.user_roles (user_id, role_id, org_id, scope_type, scope_id, granted_by, granted_at)
  select user_id, operator_role.id, org_id, 'org', org_id, assigned_by, coalesce(assigned_at, now())
  from pg_temp.shipping_operator_eligible_grants
  on conflict (user_id, role_id, scope_type, scope_id) do nothing;

  if exists (
    select 1 from pg_temp.shipping_operator_eligible_grants as eligible
    where not exists (
      select 1 from public.user_roles as assigned
      where assigned.user_id = eligible.user_id and assigned.org_id = eligible.org_id
        and assigned.role_id = operator_role.id and assigned.scope_type = 'org' and assigned.scope_id = eligible.org_id
    )
  ) then
    raise exception 'shipping operator parity could not verify every exact organization role' using errcode = '23514';
  end if;

  -- Remove only verified source rows. Other permissions and unverified historical rows
  -- are retained. The central operator evaluator does not read legacy direct grants.
  delete from public.user_permission_assignments as direct
  using pg_temp.shipping_operator_eligible_grants as eligible
  where direct.id = eligible.id and direct.user_id = eligible.user_id and direct.org_id = eligible.org_id;
  get diagnostics removed_count = row_count;
  if removed_count <> eligible_count then
    raise exception 'shipping operator parity could not remove every verified legacy grant' using errcode = '23514';
  end if;
  raise notice 'Converted % verified legacy shipping operator grants', removed_count;
end;
$$;

commit;
