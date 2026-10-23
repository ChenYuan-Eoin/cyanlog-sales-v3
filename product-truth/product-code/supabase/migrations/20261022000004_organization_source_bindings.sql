-- WP62 v4: tenant-managed organization source binding lifecycle.
-- Rebind is atomic so a failed activation does not leave the tenant without
-- its previous authoritative source.

begin;

create or replace function public.bind_organization_source(
  p_system_org_id uuid,
  p_provider text,
  p_external_tenant_id text,
  p_priority integer,
  p_status text,
  p_sync_mode text,
  p_authority_scope jsonb,
  p_actor_id uuid
) returns setof public.organization_sources
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_system_org_id is null
    or nullif(btrim(p_provider), '') is null
    or nullif(btrim(p_external_tenant_id), '') is null
    or p_priority < 1
    or p_priority > 100
    or p_status not in ('draft', 'active', 'disabled')
    or p_sync_mode not in ('read_only', 'authoritative', 'enrichment')
    or p_authority_scope is null
    or jsonb_typeof(p_authority_scope) <> 'object' then
    raise exception 'invalid organization source binding' using errcode = '22023';
  end if;

  if p_status = 'active' and p_priority = 1 then
    update public.organization_sources
       set status = 'disabled',
           updated_by = p_actor_id,
           updated_at = now()
     where system_org_id = p_system_org_id
       and priority = 1
       and status = 'active'
       and not (provider = btrim(p_provider) and external_tenant_id = btrim(p_external_tenant_id));
  end if;

  return query
  insert into public.organization_sources(
    system_org_id,
    provider,
    external_tenant_id,
    priority,
    status,
    authority_scope,
    sync_mode,
    created_by,
    updated_by
  ) values (
    p_system_org_id,
    btrim(p_provider),
    btrim(p_external_tenant_id),
    p_priority,
    p_status,
    p_authority_scope,
    p_sync_mode,
    p_actor_id,
    p_actor_id
  )
  on conflict (system_org_id, provider, external_tenant_id)
  do update set
    priority = excluded.priority,
    status = excluded.status,
    authority_scope = excluded.authority_scope,
    sync_mode = excluded.sync_mode,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning *;
end;
$$;

create or replace function public.unbind_organization_source(
  p_system_org_id uuid,
  p_source_id uuid,
  p_actor_id uuid
) returns setof public.organization_sources
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.organization_sources
     set status = 'disabled',
         updated_by = p_actor_id,
         updated_at = now()
   where id = p_source_id
     and system_org_id = p_system_org_id
  returning *;
end;
$$;

revoke all on function public.bind_organization_source(uuid,text,text,integer,text,text,jsonb,uuid)
  from public, anon, authenticated;
revoke all on function public.unbind_organization_source(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.bind_organization_source(uuid,text,text,integer,text,text,jsonb,uuid)
  to service_role;
grant execute on function public.unbind_organization_source(uuid,uuid,uuid)
  to service_role;

comment on function public.bind_organization_source(uuid,text,text,integer,text,text,jsonb,uuid) is
  'Atomically bind or replace a tenant organization source; priority 1 remains unique among active sources.';
comment on function public.unbind_organization_source(uuid,uuid,uuid) is
  'Disable one tenant source without deleting its historical identity evidence.';

commit;
