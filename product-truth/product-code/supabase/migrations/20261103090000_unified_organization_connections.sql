-- F003 / WP50. organization_sources is the only runtime connection record.
-- This migration prepares shared draft/effective lifecycle fields and imports the
-- former Fxiaoke-specific table as a one-time input. It does not activate a draft,
-- synchronize a directory, change the primary source, or delete historical rows.

begin;

alter table public.organization_sources
  add column if not exists configuration_revision uuid not null default gen_random_uuid(),
  add column if not exists draft_credentials_ciphertext text,
  add column if not exists draft_credential_envelope text not null default 'shared-v1',
  add column if not exists draft_credential_schema_version integer not null default 1,
  add column if not exists draft_metadata jsonb not null default '{}'::jsonb,
  add column if not exists draft_check_status text not null default 'not_checked',
  add column if not exists draft_checked_at timestamptz,
  add column if not exists verification_started_at timestamptz,
  add column if not exists effective_revision uuid,
  add column if not exists effective_credentials_ciphertext text,
  add column if not exists effective_credential_envelope text,
  add column if not exists effective_metadata jsonb not null default '{}'::jsonb,
  add column if not exists connection_state text not null default 'unconfigured',
  add column if not exists last_verified_at timestamptz,
  add column if not exists last_error_at timestamptz,
  add column if not exists previous_effective_revision uuid,
  add column if not exists previous_effective_credentials_ciphertext text,
  add column if not exists previous_effective_credential_envelope text,
  add column if not exists previous_effective_metadata jsonb not null default '{}'::jsonb,
  add column if not exists previous_effective_connection_state text,
  add column if not exists lifecycle_audit jsonb not null default '[]'::jsonb;

alter table public.organization_sources
  drop constraint if exists organization_sources_connection_state_check,
  drop constraint if exists organization_sources_draft_check_status_check,
  drop constraint if exists organization_sources_draft_envelope_check,
  drop constraint if exists organization_sources_effective_envelope_check,
  drop constraint if exists organization_sources_previous_envelope_check,
  drop constraint if exists organization_sources_draft_metadata_check,
  drop constraint if exists organization_sources_effective_metadata_check,
  drop constraint if exists organization_sources_previous_metadata_check,
  drop constraint if exists organization_sources_lifecycle_audit_check;

alter table public.organization_sources
  add constraint organization_sources_connection_state_check
    check (connection_state in ('unconfigured', 'configured', 'verified', 'failed', 'disabled')),
  add constraint organization_sources_draft_check_status_check
    check (draft_check_status in ('not_checked', 'preview_ready', 'failed')),
  add constraint organization_sources_draft_envelope_check
    check (draft_credential_envelope in ('shared-v1', 'legacy-fxiaoke-v1')),
  add constraint organization_sources_effective_envelope_check
    check (effective_credential_envelope is null or effective_credential_envelope in ('shared-v1', 'legacy-fxiaoke-v1')),
  add constraint organization_sources_previous_envelope_check
    check (previous_effective_credential_envelope is null or previous_effective_credential_envelope in ('shared-v1', 'legacy-fxiaoke-v1')),
  add constraint organization_sources_draft_metadata_check
    check (jsonb_typeof(draft_metadata) = 'object'),
  add constraint organization_sources_effective_metadata_check
    check (jsonb_typeof(effective_metadata) = 'object'),
  add constraint organization_sources_previous_metadata_check
    check (jsonb_typeof(previous_effective_metadata) = 'object'),
  add constraint organization_sources_lifecycle_audit_check
    check (jsonb_typeof(lifecycle_audit) = 'array');

update public.organization_sources
set connection_state = 'disabled'
where status = 'disabled'
  and connection_state <> 'disabled';

create unique index if not exists organization_sources_one_connection_per_provider
  on public.organization_sources (system_org_id, provider)
  where draft_credentials_ciphertext is not null or effective_credentials_ciphertext is not null;

do $migration$
declare
  legacy record;
  source_count integer;
  matching_source_count integer;
begin
  if to_regclass('public.organization_fxiaoke_connections') is null then
    return;
  end if;

  for legacy in
    select * from public.organization_fxiaoke_connections order by system_org_id
  loop
    select count(*)::integer,
           count(*) filter (where external_tenant_id = legacy.expected_ea
             or (external_tenant_id like 'FSCID\_%' escape '\'
               and legacy.expected_ea <> ''
               and legacy.expected_ea not like 'FSCID\_%' escape '\'
               and legacy.expected_ea not like 'pending-%'))::integer
      into source_count, matching_source_count
      from public.organization_sources
     where system_org_id = legacy.system_org_id
       and provider = 'fxiaoke';

    if source_count > 1 or (source_count > 0 and matching_source_count = 0) then
      raise exception 'legacy Fxiaoke enterprise does not match the existing organization source'
        using errcode = '23514';
    end if;

    if matching_source_count > 0 then
      update public.organization_sources as source
         set configuration_revision = legacy.revision,
             draft_credentials_ciphertext = legacy.credentials_ciphertext,
             draft_credential_envelope = 'legacy-fxiaoke-v1',
             draft_credential_schema_version = 1,
             draft_metadata = jsonb_build_object(
               'appId', legacy.app_id,
               'apiUserId', legacy.api_user_id,
               'expectedEa', legacy.expected_ea
             ),
             draft_check_status = case
               when source.external_tenant_id <> legacy.expected_ea then 'not_checked'
               when legacy.last_check_status = 'preview_ready' then 'preview_ready'
               when legacy.last_check_status = 'failed' then 'failed'
               else 'not_checked'
             end,
             draft_checked_at = legacy.last_checked_at,
             verification_started_at = legacy.preview_started_at,
             effective_revision = case when source.external_tenant_id = legacy.expected_ea then legacy.revision else null end,
             effective_credentials_ciphertext = case when source.external_tenant_id = legacy.expected_ea then legacy.credentials_ciphertext else null end,
             effective_credential_envelope = case when source.external_tenant_id = legacy.expected_ea then 'legacy-fxiaoke-v1' else null end,
             effective_metadata = case when source.external_tenant_id = legacy.expected_ea then jsonb_build_object(
               'appId', legacy.app_id,
               'apiUserId', legacy.api_user_id,
               'expectedEa', legacy.expected_ea
             ) else '{}'::jsonb end,
             connection_state = case
               when source.status = 'disabled' then 'disabled'
               when source.external_tenant_id <> legacy.expected_ea then 'configured'
               when legacy.last_check_status = 'preview_ready' then 'verified'
               when legacy.last_check_status = 'failed' then 'failed'
               else 'configured'
             end,
             last_verified_at = case
               when source.external_tenant_id = legacy.expected_ea and legacy.last_check_status = 'preview_ready' then legacy.last_checked_at
               else null
             end,
             last_error = legacy.last_error,
             lifecycle_audit = lifecycle_audit || jsonb_build_array(jsonb_build_object(
               'command', 'configured',
               'actorId', legacy.updated_by,
               'occurredAt', legacy.updated_at,
               'configurationRevision', legacy.revision,
               'effectiveRevision', case when source.external_tenant_id = legacy.expected_ea then legacy.revision else null end,
               'state', case
                 when source.status = 'disabled' then 'disabled'
                 when source.external_tenant_id <> legacy.expected_ea then 'configured'
                 when legacy.last_check_status = 'preview_ready' then 'verified'
                 when legacy.last_check_status = 'failed' then 'failed'
                 else 'configured'
               end,
               'detail', 'legacy_fxiaoke_import'
             )),
             updated_by = legacy.updated_by,
             updated_at = greatest(source.updated_at, legacy.updated_at)
       where source.system_org_id = legacy.system_org_id
         and source.provider = 'fxiaoke'
         and (source.external_tenant_id = legacy.expected_ea or matching_source_count = 1);
    else
      insert into public.organization_sources(
        system_org_id,
        provider,
        external_tenant_id,
        priority,
        status,
        authority_scope,
        sync_mode,
        configuration_revision,
        draft_credentials_ciphertext,
        draft_credential_envelope,
        draft_credential_schema_version,
        draft_metadata,
        draft_check_status,
        draft_checked_at,
        verification_started_at,
        effective_revision,
        effective_credentials_ciphertext,
        effective_credential_envelope,
        effective_metadata,
        connection_state,
        last_verified_at,
        last_error,
        lifecycle_audit,
        created_by,
        updated_by,
        updated_at
      ) values (
        legacy.system_org_id,
        'fxiaoke',
        legacy.expected_ea,
        100,
        'draft',
        jsonb_build_object('identity', 'evidence', 'organization', 'evidence'),
        'read_only',
        legacy.revision,
        legacy.credentials_ciphertext,
        'legacy-fxiaoke-v1',
        1,
        jsonb_build_object(
          'appId', legacy.app_id,
          'apiUserId', legacy.api_user_id,
          'expectedEa', legacy.expected_ea
        ),
        case
          when legacy.last_check_status = 'preview_ready' then 'preview_ready'
          when legacy.last_check_status = 'failed' then 'failed'
          else 'not_checked'
        end,
        legacy.last_checked_at,
        legacy.preview_started_at,
        legacy.revision,
        legacy.credentials_ciphertext,
        'legacy-fxiaoke-v1',
        jsonb_build_object(
          'appId', legacy.app_id,
          'apiUserId', legacy.api_user_id,
          'expectedEa', legacy.expected_ea
        ),
        case
          when legacy.last_check_status = 'preview_ready' then 'verified'
          when legacy.last_check_status = 'failed' then 'failed'
          else 'configured'
        end,
        case when legacy.last_check_status = 'preview_ready' then legacy.last_checked_at else null end,
        legacy.last_error,
        jsonb_build_array(jsonb_build_object(
          'command', 'configured',
          'actorId', legacy.updated_by,
          'occurredAt', legacy.updated_at,
          'configurationRevision', legacy.revision,
          'effectiveRevision', legacy.revision,
          'state', case
            when legacy.last_check_status = 'preview_ready' then 'verified'
            when legacy.last_check_status = 'failed' then 'failed'
            else 'configured'
          end,
          'detail', 'legacy_fxiaoke_import'
        )),
        legacy.updated_by,
        legacy.updated_by,
        legacy.updated_at
      );
    end if;
  end loop;

  revoke insert, update on public.organization_fxiaoke_connections from service_role;
  revoke insert, update on public.organization_fxiaoke_connections from public, anon, authenticated;
  comment on table public.organization_fxiaoke_connections is
    'Deprecated read-only migration input. Runtime connection truth is public.organization_sources.';
end
$migration$;

-- Direct binding may only create a draft or disable a connection. Activation is a
-- separate WP92 cutover operation after directory diff and explicit confirmation.
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
    or p_status not in ('draft', 'disabled')
    or p_sync_mode not in ('read_only', 'authoritative', 'enrichment')
    or p_authority_scope is null
    or jsonb_typeof(p_authority_scope) <> 'object' then
    raise exception 'organization source configuration may only save a draft or disable a source'
      using errcode = '22023';
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
    connection_state,
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
    case when p_status = 'disabled' then 'disabled' else 'unconfigured' end,
    p_actor_id,
    p_actor_id
  )
  on conflict (system_org_id, provider, external_tenant_id)
  do update set
    status = excluded.status,
    connection_state = case
      when excluded.status = 'disabled' then 'disabled'
      when organization_sources.status = 'disabled' then organization_sources.connection_state
      else organization_sources.connection_state
    end,
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
         connection_state = 'disabled',
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

comment on column public.organization_sources.connection_state is
  'Effective connection capability: unconfigured/configured/verified/failed/disabled. Draft verification is tracked separately.';
comment on column public.organization_sources.lifecycle_audit is
  'Recent secret-free connection lifecycle events stored with the single connection row.';

commit;
