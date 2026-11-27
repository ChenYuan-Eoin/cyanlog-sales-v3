-- Configured department role rules supply additional scoped sources. They never
-- insert, update, or remove an employee's explicit user_roles bindings.
begin;

create table private.department_automatic_role_rules (
  org_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  include_subdepartments boolean not null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, department_id, role_id)
);
create index department_automatic_role_rules_by_role
  on private.department_automatic_role_rules(org_id, role_id);

create table private.department_automatic_role_rule_previews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  proposed_rules jsonb not null,
  snapshot_hash bytea not null,
  expires_at timestamptz not null,
  unique (org_id, actor_id, department_id)
);
create index department_auto_role_preview_org_expiry
  on private.department_automatic_role_rule_previews(org_id, expires_at);

create table private.department_automatic_role_rule_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid not null,
  actor_id uuid not null,
  before_rules jsonb not null,
  after_rules jsonb not null,
  impact jsonb not null,
  effective_at timestamptz not null default clock_timestamp()
);
create index department_auto_role_rule_audit_department
  on private.department_automatic_role_rule_audit(org_id, department_id, effective_at desc);

alter table private.department_automatic_role_rules enable row level security;
alter table private.department_automatic_role_rule_previews enable row level security;
alter table private.department_automatic_role_rule_audit enable row level security;
revoke all on private.department_automatic_role_rules, private.department_automatic_role_rule_previews,
  private.department_automatic_role_rule_audit from public, anon, authenticated, service_role;

create or replace function private.org_role_is_referenced_v1(p_org_id uuid, p_role_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.user_roles as binding where binding.org_id = p_org_id and binding.role_id = p_role_id)
    or exists (select 1 from public.fxiaoke_pending_org_roles as pending
      where pending.org_id = p_org_id and pending.role_id = p_role_id)
    or exists (select 1 from public.personnel_invitations as invitation
      where invitation.org_id = p_org_id and invitation.status = 'pending' and p_role_id = any(invitation.role_ids))
    or exists (select 1 from private.department_automatic_role_rules as rule
      where rule.org_id = p_org_id and rule.role_id = p_role_id);
$$;

create function private.department_automatic_role_catalog_v1(p_org_id uuid)
returns table(role_id uuid, role_code text, role_name text, permissions text[])
language sql stable set search_path = '' as $$
  select role.id, role.code, role.name, supported.permissions
  from private.org_role_catalog_v1(p_org_id, false) as role
  join public.organizations as org on org.id = p_org_id
  cross join lateral (
    select array(
      select candidate.code
      from (values ('dept:view'), ('report:dept'), ('shipping:ledger_view'), ('shipping:record_return')) as candidate(code)
      where private.shipping_role_effective_scope_permissions_v1(role.code, role.id, org.settings, role.permissions) ? candidate.code
        and (candidate.code in ('dept:view', 'report:dept') or (
          exists (select 1 from private.shipping_role_scope_catalog_v1() as point
            where point.code = candidate.code and 'department' = any(point.supported_scope_types))
          and (candidate.code <> 'shipping:record_return' or (
            exists (select 1 from private.shipping_role_scope_catalog_v1() as point
              where point.code = 'shipping:ledger_view' and 'department' = any(point.supported_scope_types))
            and private.shipping_role_effective_scope_permissions_v1(role.code, role.id, org.settings, role.permissions)
              ? 'shipping:ledger_view'
          ))
        ))
      order by candidate.code
    ) as permissions
  ) as supported
  where role.code not in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE') and cardinality(supported.permissions) > 0;
$$;

create function private.department_automatic_role_ancestors_v1(p_org_id uuid, p_department_ids uuid[], p_tree jsonb)
returns table(affiliation_department_id uuid, ancestor_id uuid)
language sql stable set search_path = '' as $$
  with recursive active_tree as (
    select department.id, department.parent_id from public.departments as department
    where p_tree is null and department.org_id = p_org_id and department.status = 'active'
    union all
    select snapshot.id, snapshot.parent_id
    from jsonb_to_recordset(coalesce(p_tree, '[]'::jsonb)) as snapshot(id uuid, parent_id uuid, status text)
    where p_tree is not null and snapshot.status = 'active'
  ), ancestors(affiliation_id, ancestor_id) as (
    select department.id, department.id from active_tree as department
    where p_department_ids is null or department.id = any(p_department_ids)
    union
    select branch.affiliation_id, parent.id
    from ancestors as branch
    join active_tree as department on department.id = branch.ancestor_id
    join active_tree as parent on parent.id = department.parent_id
  )
  select affiliation_id, ancestor_id from ancestors;
$$;

create function private.department_automatic_role_sources_for_affiliations_v1(
  p_org_id uuid, p_department_ids uuid[], p_tree jsonb default null
)
returns table(rule_department_id uuid, affiliation_department_id uuid, role_id uuid, role_code text, role_name text, permissions text[])
language sql stable set search_path = '' as $$
  select rule.department_id, path.affiliation_department_id, role.role_id, role.role_code, role.role_name, role.permissions
  from private.department_automatic_role_ancestors_v1(p_org_id, coalesce(p_department_ids, array[]::uuid[]), p_tree) as path
  join private.department_automatic_role_rules as rule on rule.org_id = p_org_id and rule.department_id = path.ancestor_id
    and (path.ancestor_id = path.affiliation_department_id or rule.include_subdepartments)
  join private.department_automatic_role_catalog_v1(p_org_id) as role on role.role_id = rule.role_id
  order by rule.department_id, path.affiliation_department_id, role.role_id;
$$;

create function private.department_automatic_role_member_affiliations_v1(p_org_id uuid, p_user_id uuid default null)
returns table(user_id uuid, department_id uuid)
language sql stable set search_path = '' as $$
  with eligible as (
    select membership.user_id, membership.primary_department_id
    from public.user_organizations as membership
    join public.users as person on person.id = membership.user_id
    where membership.org_id = p_org_id and (p_user_id is null or membership.user_id = p_user_id)
      and membership.is_default and membership.status = 'active' and membership.employment_status = 'active'
      and membership.left_at is null and person.status = 'active' and person.login_enabled is true
  )
  select eligible.user_id, primary_department_id from eligible where primary_department_id is not null
  union
  select eligible.user_id, affiliation.department_id
  from eligible join public.user_departments as affiliation
    on affiliation.user_id = eligible.user_id and affiliation.org_id = p_org_id;
$$;

create function public.department_automatic_role_sources_v1(p_org_id uuid, p_user_id uuid)
returns table(rule_department_id uuid, affiliation_department_id uuid, role_id uuid, role_code text, role_name text, permissions text[])
language sql stable security definer set search_path = '' as $$
  select source.*
  from private.department_automatic_role_sources_for_affiliations_v1(p_org_id, array(
    select affiliation.department_id from private.department_automatic_role_member_affiliations_v1(p_org_id, p_user_id) as affiliation
    where p_user_id is not null
  )) as source;
$$;

create function public.department_automatic_role_directory_sources_v1(p_org_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with affiliations as (
    select * from private.department_automatic_role_member_affiliations_v1(p_org_id)
  ), sources as (
    select affiliation.user_id, source.*
    from private.department_automatic_role_sources_for_affiliations_v1(p_org_id,
      array(select distinct department_id from affiliations)) as source
    join affiliations as affiliation on affiliation.department_id = source.affiliation_department_id
  )
  select coalesce(jsonb_agg(to_jsonb(source)
    order by user_id, role_id, affiliation_department_id, rule_department_id), '[]'::jsonb)
  from sources as source;
$$;

create function private.department_automatic_role_rules_state_v1(p_org_id uuid, p_department_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'org_id', p_org_id, 'department_id', p_department_id,
    'rules', coalesce((select jsonb_agg(jsonb_build_object(
      'role_id', rule.role_id, 'role_name', coalesce(definition.name, '已停用角色'),
      'include_subdepartments', rule.include_subdepartments) order by rule.role_id)
      from private.department_automatic_role_rules as rule
      left join private.org_role_catalog_v1(p_org_id, true) as definition on definition.id = rule.role_id
      where rule.org_id = p_org_id and rule.department_id = p_department_id), '[]'::jsonb),
    'available_roles', coalesce((select jsonb_agg(jsonb_build_object(
      'role_id', role.role_id, 'role_name', role.role_name, 'permissions', role.permissions)
      order by role.role_name, role.role_id)
      from private.department_automatic_role_catalog_v1(p_org_id) as role), '[]'::jsonb)
  );
$$;

create function public.admin_get_department_role_rules_v1(p_org_id uuid, p_actor_id uuid, p_department_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id) then
    raise exception 'department role rules require system authorization' using errcode = '42501';
  end if;
  if not exists (select 1 from public.departments where org_id = p_org_id and id = p_department_id and status = 'active') then
    raise exception 'active department not found' using errcode = 'P0002';
  end if;
  return private.department_automatic_role_rules_state_v1(p_org_id, p_department_id);
end;
$$;

create function private.department_automatic_role_rule_snapshot_v1(p_org_id uuid, p_department_id uuid, p_proposed jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_changes jsonb;
begin
  -- Ordinary department-tree editing may use a standalone row update.
  -- Stabilize the existing hierarchy while computing the confirmed effect.
  perform 1 from public.departments where org_id = p_org_id order by id for share;
  if not exists (select 1 from public.departments where org_id = p_org_id and id = p_department_id and status = 'active') then
    raise exception 'active department not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_proposed) is distinct from 'array' then
    raise exception 'invalid role rules list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_proposed) > 100 then
    raise exception 'invalid role rules list' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_proposed) as item(value) where
    jsonb_typeof(item.value) is distinct from 'object'
    or jsonb_typeof(item.value->'role_id') is distinct from 'string'
    or jsonb_typeof(item.value->'include_subdepartments') is distinct from 'boolean') then
    raise exception 'invalid role rules item' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('role_id', rule.role_id,
    'include_subdepartments', rule.include_subdepartments) order by rule.role_id), '[]'::jsonb)
  into v_before from private.department_automatic_role_rules as rule
  where rule.org_id = p_org_id and rule.department_id = p_department_id;
  select coalesce(jsonb_agg(to_jsonb(incoming) order by incoming.role_id), '[]'::jsonb) into v_after
  from (select distinct role_id, include_subdepartments
    from jsonb_to_recordset(p_proposed) as requested(role_id uuid, include_subdepartments boolean)) as incoming;
  if jsonb_array_length(v_after) <> jsonb_array_length(p_proposed) or exists (
    select 1 from jsonb_to_recordset(v_after) as item(role_id uuid) group by item.role_id having count(*) > 1
  ) then raise exception 'duplicate role rules' using errcode = '22023'; end if;
  if v_before = v_after then raise exception 'role rules have not changed' using errcode = '22023', detail = 'ROLE_RULES_NO_CHANGE'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_after) as rule(value)
    where not (v_before @> jsonb_build_array(rule.value))
      and not exists (select 1 from private.department_automatic_role_catalog_v1(p_org_id) as role
        where role.role_id = (rule.value->>'role_id')::uuid)
  ) then raise exception 'role is unavailable for department scope' using errcode = '23514'; end if;

  with affiliations as (
    select affiliation.user_id, path.affiliation_department_id,
      path.affiliation_department_id = p_department_id as direct
    from private.department_automatic_role_member_affiliations_v1(p_org_id) as affiliation
    join private.department_automatic_role_ancestors_v1(p_org_id, null, null) as path
      on path.affiliation_department_id = affiliation.department_id and path.ancestor_id = p_department_id
  ), sources as (
    select stages.phase, affiliation.user_id, affiliation.affiliation_department_id, role.role_id, role.permissions
    from (values ('before', v_before), ('after', v_after)) as stages(phase, rules)
    cross join lateral jsonb_to_recordset(stages.rules) as rule(role_id uuid, include_subdepartments boolean)
    join private.department_automatic_role_catalog_v1(p_org_id) as role on role.role_id = rule.role_id
    cross join affiliations as affiliation
    where affiliation.direct or rule.include_subdepartments
  ), added as (
    select user_id, affiliation_department_id, role_id, permissions from sources where phase = 'after'
    except select user_id, affiliation_department_id, role_id, permissions from sources where phase = 'before'
  ), removed as (
    select user_id, affiliation_department_id, role_id, permissions from sources where phase = 'before'
    except select user_id, affiliation_department_id, role_id, permissions from sources where phase = 'after'
  ), affected_people as (select user_id from added union select user_id from removed)
  select jsonb_build_object(
    'added_sources', (select count(*) from added), 'removed_sources', (select count(*) from removed),
    'affected_members', (select count(*) from affected_people),
    'source_revision', (select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(source)
      order by phase, user_id, affiliation_department_id, role_id), '[]'::jsonb)::text, 'UTF8')), 'hex') from sources as source),
    'role_revision', (select coalesce(jsonb_agg(to_jsonb(role) order by role.role_id), '[]'::jsonb)
      from private.department_automatic_role_catalog_v1(p_org_id) as role
      where exists (
        select 1 from jsonb_to_recordset(v_before || v_after) as rule(role_id uuid)
        where rule.role_id = role.role_id
      )),
    'manual_revision', (select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(binding)
      order by binding.user_id, binding.role_id, binding.scope_type, binding.scope_id), '[]'::jsonb)::text, 'UTF8')), 'hex')
      from public.user_roles as binding join affected_people as person on person.user_id = binding.user_id
      where binding.org_id = p_org_id
        and exists (select 1 from jsonb_to_recordset(v_before || v_after) as rule(role_id uuid) where rule.role_id = binding.role_id))
  ) into v_changes;
  return jsonb_build_object('before', v_before, 'after', v_after, 'impact', v_changes);
end;
$$;

create function public.admin_preview_department_role_rules_v1(
  p_org_id uuid, p_actor_id uuid, p_department_id uuid, p_rules jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_snapshot jsonb;
  v_preview private.department_automatic_role_rule_previews%rowtype;
begin
  perform private.assert_member_department_transfer_actor_v1(p_org_id, p_actor_id);
  v_snapshot := private.department_automatic_role_rule_snapshot_v1(p_org_id, p_department_id, p_rules);
  delete from private.department_automatic_role_rule_previews where org_id = p_org_id and expires_at <= clock_timestamp();
  insert into private.department_automatic_role_rule_previews(org_id, actor_id, department_id, proposed_rules, snapshot_hash, expires_at)
  values (p_org_id, p_actor_id, p_department_id, v_snapshot->'after',
    sha256(convert_to(v_snapshot::text, 'UTF8')), clock_timestamp() + interval '10 minutes')
  on conflict (org_id, actor_id, department_id) do update
    set id = gen_random_uuid(), proposed_rules = excluded.proposed_rules, snapshot_hash = excluded.snapshot_hash,
      expires_at = excluded.expires_at
  returning * into v_preview;
  return ((v_snapshot->'impact') - array['source_revision', 'role_revision', 'manual_revision'])
    || jsonb_build_object('preview_id', v_preview.id, 'expires_at', v_preview.expires_at);
end;
$$;

create function public.admin_confirm_department_role_rules_v1(
  p_org_id uuid, p_actor_id uuid, p_department_id uuid, p_preview_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_snapshot jsonb;
  v_preview private.department_automatic_role_rule_previews%rowtype;
begin
  perform private.assert_member_department_transfer_actor_v1(p_org_id, p_actor_id);
  select * into v_preview from private.department_automatic_role_rule_previews
  where org_id = p_org_id and actor_id = p_actor_id and department_id = p_department_id
    and id = p_preview_id and expires_at > clock_timestamp() for update;
  if not found then raise exception 'role rule preview expired' using errcode = '40001'; end if;
  begin
    v_snapshot := private.department_automatic_role_rule_snapshot_v1(p_org_id, p_department_id, v_preview.proposed_rules);
  exception when sqlstate '22023' or sqlstate '23514' or sqlstate 'P0002' then
    raise exception 'role rule changes need a new preview' using errcode = '40001';
  end;
  if v_preview.expires_at <= clock_timestamp()
    or v_preview.snapshot_hash <> sha256(convert_to(v_snapshot::text, 'UTF8')) then
    raise exception 'role rule changes need a new preview' using errcode = '40001';
  end if;

  delete from private.department_automatic_role_rules as rule
  where rule.org_id = p_org_id and rule.department_id = p_department_id and not exists (
    select 1 from jsonb_to_recordset(v_snapshot->'after') as next_rule(role_id uuid) where next_rule.role_id = rule.role_id
  );
  insert into private.department_automatic_role_rules as current_rule(org_id, department_id, role_id, include_subdepartments, updated_by)
  select p_org_id, p_department_id, rule.role_id, rule.include_subdepartments, p_actor_id
  from jsonb_to_recordset(v_snapshot->'after') as rule(role_id uuid, include_subdepartments boolean)
  on conflict (org_id, department_id, role_id) do update
    set include_subdepartments = excluded.include_subdepartments, updated_by = excluded.updated_by, updated_at = now()
    where current_rule.include_subdepartments is distinct from excluded.include_subdepartments;
  insert into private.department_automatic_role_rule_audit(org_id, department_id, actor_id, before_rules, after_rules, impact)
  values (p_org_id, p_department_id, p_actor_id, v_snapshot->'before', v_snapshot->'after',
    (v_snapshot->'impact') - array['source_revision', 'role_revision', 'manual_revision']);
  delete from private.department_automatic_role_rule_previews where id = p_preview_id;
  return private.department_automatic_role_rules_state_v1(p_org_id, p_department_id);
end;
$$;

revoke all on function private.department_automatic_role_catalog_v1(uuid),
  private.department_automatic_role_ancestors_v1(uuid, uuid[], jsonb),
  private.department_automatic_role_sources_for_affiliations_v1(uuid, uuid[], jsonb),
  private.department_automatic_role_member_affiliations_v1(uuid, uuid),
  private.department_automatic_role_rules_state_v1(uuid, uuid),
  private.department_automatic_role_rule_snapshot_v1(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.department_automatic_role_sources_v1(uuid, uuid),
  public.department_automatic_role_directory_sources_v1(uuid),
  public.admin_get_department_role_rules_v1(uuid, uuid, uuid),
  public.admin_preview_department_role_rules_v1(uuid, uuid, uuid, jsonb),
  public.admin_confirm_department_role_rules_v1(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.department_automatic_role_sources_v1(uuid, uuid),
  public.department_automatic_role_directory_sources_v1(uuid),
  public.admin_get_department_role_rules_v1(uuid, uuid, uuid),
  public.admin_preview_department_role_rules_v1(uuid, uuid, uuid, jsonb),
  public.admin_confirm_department_role_rules_v1(uuid, uuid, uuid, uuid)
  to service_role;

commit;
