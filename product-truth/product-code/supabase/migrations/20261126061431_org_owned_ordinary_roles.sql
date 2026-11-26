-- Keep role identity stable while making ordinary role definitions organization-local.
begin;

alter table public.roles add column owner_org_id uuid references public.organizations(id) on delete cascade;
create index roles_owner_org_idx on public.roles(owner_org_id) where owner_org_id is not null;

create table private.org_role_metadata (
  org_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  name text not null,
  description text,
  role_revision bigint not null check (role_revision > 0),
  archived_at timestamptz,
  updated_by uuid references public.users(id) on delete set null,
  primary key (org_id, role_id)
);
revoke all on private.org_role_metadata from public, anon, authenticated, service_role;

create index user_roles_org_role_idx on public.user_roles(org_id, role_id);
create index fxiaoke_pending_org_roles_org_role_idx on public.fxiaoke_pending_org_roles(org_id, role_id);
create index personnel_invitations_pending_org_idx on public.personnel_invitations(org_id) where status = 'pending';

-- The existing client-facing dictionary can still return global templates.
-- Owned roles and their bindings are only exposed through tenant-aware server reads.
drop policy if exists "Anyone reads roles" on public.roles;
create policy "Anyone reads global roles" on public.roles for select to authenticated using (owner_org_id is null);
create policy "Only readable roles are exposed in bindings" on public.user_roles as restrictive
  for select to authenticated using (exists (select 1 from public.roles as definition where definition.id = role_id));

create function private.org_role_catalog_v1(p_org_id uuid, p_include_archived boolean)
returns table (
  id uuid, code text, name text, description text, permissions jsonb, sort_order integer,
  owner_org_id uuid, archived_at timestamptz, created_at timestamptz, role_revision bigint
)
language sql stable set search_path = ''
as $$
  select definition.id, definition.code, coalesce(metadata.name, definition.name),
    case when metadata.role_id is null then definition.description else metadata.description end,
    definition.permissions, definition.sort_order, definition.owner_org_id, metadata.archived_at,
    definition.created_at, coalesce(metadata.role_revision, 0)
  from public.organizations as organization
  join public.roles as definition on definition.owner_org_id is null or definition.owner_org_id = organization.id
  left join private.org_role_metadata as metadata on metadata.org_id = organization.id and metadata.role_id = definition.id
  where organization.id = p_org_id and organization.status = 'active'
    and (p_include_archived or metadata.archived_at is null);
$$;

-- A dormant membership or pending reservation can become effective later.
create function private.org_role_is_referenced_v1(p_org_id uuid, p_role_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select exists (select 1 from public.user_roles as binding where binding.org_id = p_org_id and binding.role_id = p_role_id)
    or exists (select 1 from public.fxiaoke_pending_org_roles as pending
      where pending.org_id = p_org_id and pending.role_id = p_role_id)
    or exists (select 1 from public.personnel_invitations as invitation
      where invitation.org_id = p_org_id and invitation.status = 'pending' and p_role_id = any(invitation.role_ids));
$$;

create function public.admin_list_org_roles_v1(p_org_id uuid)
returns table (
  id uuid, code text, name text, description text, permissions jsonb, sort_order integer,
  owner_org_id uuid, archived_at timestamptz, created_at timestamptz, role_revision bigint
)
language sql stable security definer set search_path = ''
as $$
  select catalog.* from private.org_role_catalog_v1(p_org_id, false) as catalog
  where catalog.code not in ('ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE')
    or private.org_role_is_referenced_v1(p_org_id, catalog.id)
  order by coalesce(catalog.sort_order, 0), catalog.name, catalog.id;
$$;

create function public.admin_mutate_org_role_v1(
  p_org_id uuid, p_actor_id uuid, p_operation text, p_role_id uuid,
  p_name text, p_description text, p_expected_revision bigint
)
returns table (
  id uuid, code text, name text, description text, permissions jsonb, sort_order integer,
  owner_org_id uuid, archived_at timestamptz, created_at timestamptz, role_revision bigint
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_role_id uuid := p_role_id;
  v_name text := btrim(p_name);
  v_description text := nullif(btrim(p_description), '');
  v_validate_name boolean := p_operation = 'create';
  v_current record;
begin
  if p_org_id is null or p_actor_id is null or p_operation is null
    or p_operation not in ('create', 'rename', 'archive')
    or (p_operation = 'create' and (p_role_id is not null or p_expected_revision is not null))
    or (p_operation <> 'create' and (p_role_id is null or p_expected_revision is null or p_expected_revision < 0))
    or (p_operation = 'archive' and (p_name is not null or p_description is not null))
    or (p_operation <> 'archive' and (
      v_name is null or char_length(v_name) not between 1 and 80 or v_name ~ '[[:cntrl:]]'
      or char_length(v_description) > 300
    )) then
    raise exception 'invalid organization role metadata' using errcode = '22023';
  end if;

  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);

  if p_operation <> 'create' then
    select catalog.* into v_current
    from private.org_role_catalog_v1(p_org_id, true) as catalog where catalog.id = v_role_id;
    if not found then
      raise exception 'organization role does not exist' using errcode = '23503', detail = 'ORG_ROLE_NOT_FOUND';
    end if;
    if v_current.code in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE') then
      raise exception 'protected role metadata cannot be changed' using errcode = '42501', detail = 'ROLE_METADATA_FIXED';
    end if;
    if v_current.role_revision <> p_expected_revision then
      raise exception 'organization role metadata has changed' using errcode = '40001', detail = 'ORG_ROLE_METADATA_CONFLICT';
    end if;
    if v_current.archived_at is not null then
      raise exception 'organization role does not exist' using errcode = '23503', detail = 'ORG_ROLE_NOT_FOUND';
    end if;
    v_validate_name := p_operation = 'rename' and v_name is distinct from v_current.name;
  end if;

  if v_validate_name then
    if exists (select 1 from private.org_role_catalog_v1(p_org_id, false) as catalog
      where catalog.id is distinct from v_role_id and lower(catalog.name) = lower(v_name)) then
      raise exception 'organization role name already exists' using errcode = '23505', detail = 'ORG_ROLE_NAME_CONFLICT';
    end if;
  end if;

  if p_operation = 'create' then
    v_role_id := gen_random_uuid();
    insert into public.roles (id, code, name, description, permissions, owner_org_id)
    values (v_role_id, 'CUSTOM_' || replace(v_role_id::text, '-', ''), v_name, v_description, '[]'::jsonb, p_org_id);
  elsif p_operation = 'rename' then
    if v_name is distinct from v_current.name or v_description is distinct from v_current.description then
      insert into private.org_role_metadata (org_id, role_id, name, description, role_revision, updated_by)
      values (p_org_id, v_role_id, v_name, v_description, v_current.role_revision + 1, p_actor_id)
      on conflict (org_id, role_id) do update
      set name = excluded.name, description = excluded.description, role_revision = excluded.role_revision,
        updated_by = excluded.updated_by;
    end if;
  else
    if private.org_role_is_referenced_v1(p_org_id, v_role_id) then
      raise exception 'organization role still has assignments or reservations'
        using errcode = '23514', detail = 'ORG_ROLE_IN_USE';
    end if;

    insert into private.org_role_metadata (org_id, role_id, name, description, role_revision, archived_at, updated_by)
    values (p_org_id, v_role_id, v_current.name, v_current.description, v_current.role_revision + 1, clock_timestamp(), p_actor_id)
    on conflict (org_id, role_id) do update
    set role_revision = excluded.role_revision, archived_at = excluded.archived_at, updated_by = excluded.updated_by;
  end if;

  return query select catalog.* from private.org_role_catalog_v1(p_org_id, true) as catalog where catalog.id = v_role_id;
end;
$$;

create function private.assert_org_role_references_v1(p_org_id uuid, p_role_ids uuid[])
returns void language plpgsql set search_path = ''
as $$
begin
  perform private.personnel_lock_org_v1(p_org_id);
  if exists (
    select 1 from unnest(p_role_ids) as requested(role_id)
    where not exists (select 1 from private.org_role_catalog_v1(p_org_id, false) as catalog where catalog.id = requested.role_id)
  ) then
    raise exception 'organization role does not exist' using errcode = '23503', detail = 'ORG_ROLE_NOT_FOUND';
  end if;
end;
$$;

-- Check the stored reference so active, prelogin, and identity merge paths all
-- share the same ownership and archival boundary, including during activation.
create function private.validate_org_role_binding_v1()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_org_role_references_v1(new.org_id, array[new.role_id]);
  return new;
end;
$$;

create trigger validate_org_role_binding before insert or update of org_id, role_id on public.user_roles
  for each row execute function private.validate_org_role_binding_v1();
create trigger validate_org_role_binding before insert or update of org_id, role_id on public.fxiaoke_pending_org_roles
  for each row execute function private.validate_org_role_binding_v1();

create function private.validate_org_personnel_invitation_roles_v1()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'pending' or cardinality(new.role_ids) = 0 then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
    and new.org_id is not distinct from old.org_id and new.role_ids is not distinct from old.role_ids then
    return new;
  end if;
  perform private.assert_org_role_references_v1(new.org_id, new.role_ids);
  return new;
end;
$$;

create trigger validate_org_personnel_invitation_roles before insert or update of org_id, role_ids, status
  on public.personnel_invitations for each row execute function private.validate_org_personnel_invitation_roles_v1();

create or replace function public.admin_save_org_role_permissions_v1(
  p_actor_id uuid, p_org_id uuid, p_role_id uuid, p_expected_settings jsonb, p_expected_role_code text,
  p_expected_role_template jsonb, p_permissions text[], p_owner_permissions text[]
)
returns text language plpgsql security definer set search_path = ''
as $$
begin
  if p_actor_id is null or p_org_id is null or p_role_id is null then
    raise exception 'role authorization requires an exact actor, organization and role' using errcode = '22023';
  end if;
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
  if not exists (select 1 from private.org_role_catalog_v1(p_org_id, false) as catalog where catalog.id = p_role_id) then
    return 'not_found';
  end if;
  if exists (select 1 from public.roles where id = p_role_id and code = 'FXIAOKE_BASELINE') then
    return 'fixed_role';
  end if;
  if '*' = any(p_permissions)
    and not coalesce((p_expected_settings->'role_permission_overrides'->p_role_id::text) ? '*',
      p_expected_role_template ? '*', false) then
    raise exception 'an ordinary role cannot be newly granted platform-wide permissions' using errcode = '22023';
  end if;
  return private.admin_save_org_role_permissions_before_baseline_retirement_v1(
    p_actor_id, p_org_id, p_role_id, p_expected_settings, p_expected_role_code,
    p_expected_role_template, p_permissions, p_owner_permissions
  );
end;
$$;

revoke all on function private.org_role_catalog_v1(uuid, boolean), private.org_role_is_referenced_v1(uuid, uuid),
  private.assert_org_role_references_v1(uuid, uuid[]),
  private.validate_org_role_binding_v1(), private.validate_org_personnel_invitation_roles_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_org_roles_v1(uuid),
  public.admin_mutate_org_role_v1(uuid, uuid, text, uuid, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.admin_list_org_roles_v1(uuid),
  public.admin_mutate_org_role_v1(uuid, uuid, text, uuid, text, text, bigint) to service_role;

-- Keep older server consumers of the organization aggregate tenant-local and
-- use the same role names as the assignment and permission editor views.
alter function public.get_org_admin_payload_v1(uuid) rename to get_org_admin_before_owned_roles_v1;
alter function public.get_org_admin_before_owned_roles_v1(uuid) set schema private;
alter function private.get_org_admin_before_owned_roles_v1(uuid) set search_path = public, pg_temp;
revoke all on function private.get_org_admin_before_owned_roles_v1(uuid) from public, anon, authenticated, service_role;

create function public.get_org_admin_payload_v1(p_org_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with base as (select private.get_org_admin_before_owned_roles_v1(p_org_id) as payload),
  catalog as materialized (select * from public.admin_list_org_roles_v1(p_org_id))
  select base.payload || jsonb_build_object(
    'roles', coalesce((select jsonb_agg(jsonb_build_object('id', role.id, 'code', role.code, 'name', role.name)
      order by coalesce(role.sort_order, 0), role.name, role.id) from catalog as role), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(person.value || jsonb_build_object(
      'role_names', coalesce(bindings.role_names, ''),
      'role_ids', coalesce(bindings.role_ids, '[]'::jsonb),
      'role_codes', coalesce(bindings.role_codes, '[]'::jsonb),
      'scoped_roles', coalesce(bindings.scoped_roles, '[]'::jsonb)
    ) order by person.ordinality)
    from jsonb_array_elements(base.payload->'users') with ordinality as person(value, ordinality)
    cross join lateral (
      select string_agg(case when assignment.value->>'scopeType' = 'org' then role.name
        else role.name || '(' || (assignment.value->>'scopeName') || ')' end, ', ' order by assignment.ordinality) as role_names,
        jsonb_agg(role.id order by assignment.ordinality) filter (where assignment.value->>'scopeType' = 'org') as role_ids,
        jsonb_agg(role.code order by assignment.ordinality) filter (where assignment.value->>'scopeType' = 'org') as role_codes,
        jsonb_agg(assignment.value || jsonb_build_object('roleName', role.name) order by assignment.ordinality) as scoped_roles
      from jsonb_array_elements(person.value->'scoped_roles') with ordinality as assignment(value, ordinality)
      join catalog as role on role.id = (assignment.value->>'roleId')::uuid
    ) as bindings), '[]'::jsonb)
  ) from base;
$$;
revoke all on function public.get_org_admin_payload_v1(uuid) from public, anon, authenticated;
grant execute on function public.get_org_admin_payload_v1(uuid) to service_role;

create or replace function public.get_org_admin_directory_payload_v2(p_org_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  with base as (select public.get_org_admin_directory_payload_v1(p_org_id) as payload),
  targets as (select * from public.fxiaoke_prelogin_role_targets_v1(p_org_id)),
  pending as (
    select grant_row.user_id, jsonb_agg(jsonb_build_object('id', role.id, 'code', role.code, 'name', role.name)
      order by role.name, role.id) as roles
    from public.fxiaoke_pending_org_roles as grant_row
    join public.admin_list_org_roles_v1(p_org_id) as role on role.id = grant_row.role_id
    join targets on targets.user_id = grant_row.user_id and targets.source_id = grant_row.source_id
      and targets.identity_id = grant_row.external_identity_id and targets.external_user_id = grant_row.external_user_id
    where grant_row.org_id = p_org_id group by grant_row.user_id
  )
  select base.payload || jsonb_build_object('users', coalesce((
    select jsonb_agg(member.value || jsonb_build_object(
      'can_preassign_org_roles', targets.user_id is not null,
      'pending_org_roles', coalesce(pending.roles, '[]'::jsonb)
    ) order by member.ordinality)
    from jsonb_array_elements(base.payload->'users') with ordinality as member(value, ordinality)
    left join targets on targets.user_id = (member.value->>'id')::uuid
    left join pending on pending.user_id = targets.user_id
  ), '[]'::jsonb)) from base;
$$;

commit;
