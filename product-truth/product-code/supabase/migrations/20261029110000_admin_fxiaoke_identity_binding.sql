-- F003 / WP94. Audited administrator pre-binding for an existing identity.
-- This does not infer a user from phone, name or employee number.
begin;

create or replace function public.admin_bind_fxiaoke_identity_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_external_tenant_id text,
  p_external_subject text,
  p_request_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.organization_sources%rowtype;
  v_source_count integer;
  v_source_id uuid;
  v_mapping_id uuid;
  v_existing_user_id uuid;
  v_existing_status text;
begin
  if p_actor_id is null or p_org_id is null or p_user_id is null
    or p_external_tenant_id !~ '^FSCID_[A-Za-z0-9_-]{1,128}$'
    or p_external_subject !~ '^[A-Za-z0-9_-]{1,255}$' then
    raise exception 'invalid Fxiaoke identity binding input'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.users as actor
      join public.user_organizations as membership
        on membership.user_id = actor.id
       and membership.org_id = p_org_id
       and membership.status = 'active'
       and membership.employment_status = 'active'
      join public.user_roles as assignment
        on assignment.user_id = actor.id
       and assignment.org_id = p_org_id
       and assignment.scope_type = 'org'
       and assignment.scope_id = p_org_id
      join public.roles as role
        on role.id = assignment.role_id
     where actor.id = p_actor_id
       and actor.org_id = p_org_id
       and actor.status = 'active'
       and actor.login_enabled = true
       and role.code = 'SUPER_ADMIN'
  ) then
    raise exception 'only an active organization SUPER_ADMIN may bind external identities'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.users as target
      join public.user_organizations as membership
        on membership.user_id = target.id
       and membership.org_id = p_org_id
       and membership.status = 'active'
       and membership.employment_status = 'active'
     where target.id = p_user_id
       and target.org_id = p_org_id
       and target.status = 'active'
  ) then
    raise exception 'identity binding target must be an active tenant member'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('fxiaoke-identity:' || p_org_id::text || ':' || p_external_subject, 0)
  );

  select count(*), min(id)
  into v_source_count, v_source_id
  from public.organization_sources
  where system_org_id = p_org_id
    and provider = 'fxiaoke';

  if v_source_count > 1 then
    raise exception 'multiple Fxiaoke identity sources exist'
      using errcode = '23505';
  end if;

  if v_source_count = 0 then
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
      p_org_id,
      'fxiaoke',
      p_external_tenant_id,
      100,
      'draft',
      jsonb_build_object('identity', 'evidence'),
      'enrichment',
      p_actor_id,
      p_actor_id
    ) returning id into v_source_id;
  else
    select *
    into v_source
    from public.organization_sources
    where id = v_source_id
      and system_org_id = p_org_id
    for update;

    if v_source.external_tenant_id <> p_external_tenant_id then
      raise exception 'Fxiaoke enterprise does not match the tenant identity source'
        using errcode = '23514';
    end if;
  end if;

  select canonical_user_id, match_status
  into v_existing_user_id, v_existing_status
  from public.external_identities
  where source_id = v_source_id
    and system_org_id = p_org_id
    and external_user_id = p_external_subject
  for update;

  if v_existing_status in ('conflict', 'ignored') then
    raise exception 'external identity is already conflicted or ignored'
      using errcode = '23514';
  end if;
  if v_existing_status = 'matched' and v_existing_user_id <> p_user_id then
    raise exception 'external identity is already bound to another canonical user'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.external_identities
    where source_id = v_source_id
      and system_org_id = p_org_id
      and canonical_user_id = p_user_id
      and match_status = 'matched'
      and external_user_id <> p_external_subject
  ) then
    raise exception 'canonical user already has another Fxiaoke identity'
      using errcode = '23505';
  end if;

  insert into public.external_identities(
    source_id,
    system_org_id,
    external_user_id,
    canonical_user_id,
    match_status,
    match_method,
    match_confidence,
    profile_snapshot,
    observed_at,
    updated_at
  ) values (
    v_source_id,
    p_org_id,
    p_external_subject,
    p_user_id,
    'matched',
    'manual',
    1,
    jsonb_build_object(
      'provider', 'fxiaoke',
      'enterpriseCorpId', p_external_tenant_id,
      'bindingMode', 'admin_prebinding',
      'boundBy', p_actor_id
    ),
    now(),
    now()
  )
  on conflict (source_id, external_user_id)
  do update set
    canonical_user_id = excluded.canonical_user_id,
    match_status = 'matched',
    match_method = 'manual',
    match_confidence = 1,
    profile_snapshot = excluded.profile_snapshot,
    observed_at = now(),
    updated_at = now()
  where public.external_identities.match_status = 'unresolved'
  returning id into v_mapping_id;

  if v_mapping_id is null then
    select id
    into v_mapping_id
    from public.external_identities
    where source_id = v_source_id
      and system_org_id = p_org_id
      and external_user_id = p_external_subject;
  end if;

  if v_mapping_id is null then
    raise exception 'identity binding was not persisted'
      using errcode = '23514';
  end if;

  perform private.personnel_insert_event_v1(
    p_org_id,
    p_user_id,
    p_actor_id,
    'bind_external_identity',
    '{}'::jsonb,
    jsonb_build_object(
      'provider', 'fxiaoke',
      'source_id', v_source_id,
      'external_subject', p_external_subject,
      'match_status', 'matched',
      'match_method', 'manual'
    ),
    'administrator pre-bound a stable Fxiaoke identity',
    p_request_id
  );

  return jsonb_build_object(
    'mapping_id', v_mapping_id,
    'source_id', v_source_id,
    'user_id', p_user_id,
    'org_id', p_org_id,
    'provider', 'fxiaoke',
    'external_subject', p_external_subject,
    'match_status', 'matched'
  );
end;
$$;

revoke all on function public.admin_bind_fxiaoke_identity_v1(uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.admin_bind_fxiaoke_identity_v1(uuid,uuid,uuid,text,text,text)
  to service_role;

comment on function public.admin_bind_fxiaoke_identity_v1(uuid,uuid,uuid,text,text,text) is
  'Service-role-only audited pre-binding of one Fxiaoke subject to an existing active tenant member.';

commit;
