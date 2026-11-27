begin;

create table private.fxiaoke_directory_identity_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  source_id uuid not null,
  external_tenant_id text not null,
  plan_id uuid not null references public.organization_directory_cutover_plans(id) on delete restrict,
  external_user_id text not null,
  conflict_kind text not null,
  identity_status_before text,
  canonical_user_id_before uuid,
  facts_hash text not null check (facts_hash ~ '^[a-f0-9]{64}$'),
  choice text not null check (choice in ('keep_binding', 'link_existing', 'create')),
  user_id uuid references public.users(id) on delete restrict,
  evidence text not null check (length(evidence) between 4 and 500),
  decided_by uuid not null references public.users(id) on delete restrict,
  decided_at timestamptz not null default clock_timestamp(),
  foreign key (source_id, org_id) references public.organization_sources(id, system_org_id) on delete restrict,
  unique (plan_id, external_user_id),
  check ((choice = 'create') = (user_id is null))
);

alter table private.fxiaoke_directory_identity_reviews enable row level security;
revoke all on table private.fxiaoke_directory_identity_reviews from public, anon, authenticated, service_role;
create index fxiaoke_directory_identity_reviews_source on private.fxiaoke_directory_identity_reviews
  (org_id, source_id, external_tenant_id, external_user_id, decided_at desc, id desc);

create function private.fxiaoke_identity_review_json_v1(row_value private.fxiaoke_directory_identity_reviews)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'externalUserId', row_value.external_user_id,
    'choice', row_value.choice,
    'userId', row_value.user_id,
    'factsHash', row_value.facts_hash,
    'decidedAt', row_value.decided_at
  );
$$;

create function public.list_fxiaoke_directory_identity_reviews_v1(p_system_org_id uuid, p_source_id uuid)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select private.fxiaoke_identity_review_json_v1(latest)
  from (
    select distinct on (review.external_user_id) review.*
    from private.fxiaoke_directory_identity_reviews as review
    join public.organization_sources as source
      on source.id = review.source_id and source.system_org_id = review.org_id
      and source.external_tenant_id = review.external_tenant_id
    where review.org_id = p_system_org_id and review.source_id = p_source_id and source.provider = 'fxiaoke'
    order by review.external_user_id, review.decided_at desc, review.id desc
  ) as latest;
$$;

create function public.save_fxiaoke_directory_identity_review_v1(
  p_system_org_id uuid, p_plan_id uuid, p_plan_hash text, p_external_user_id text,
  p_choice text, p_user_id uuid, p_evidence text, p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.organization_directory_cutover_plans%rowtype;
  v_source public.organization_sources%rowtype;
  v_identity public.external_identities%rowtype;
  v_saved private.fxiaoke_directory_identity_reviews%rowtype;
  v_selected jsonb;
  v_review jsonb;
  v_match_count integer;
  v_evidence text;
begin
  if p_system_org_id is null or p_plan_id is null or p_actor_id is null
    or p_plan_hash is null or p_plan_hash !~ '^[a-f0-9]{64}$'
    or p_external_user_id is null or btrim(p_external_user_id) = '' or length(p_external_user_id) > 300
    or p_choice is null or p_choice not in ('keep_binding', 'link_existing', 'create')
    or (p_choice = 'create') <> (p_user_id is null) then
    raise exception 'invalid directory identity review input' using errcode = '22023';
  end if;

  v_evidence := regexp_replace(coalesce(p_evidence, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if length(v_evidence) not between 4 and 500 then
    raise exception 'invalid directory identity review evidence' using errcode = '22023';
  end if;
  v_evidence := regexp_replace(v_evidence, '[^[:space:]<>(),;:]+@[^[:space:]<>(),;:]+', '[邮箱已遮盖]', 'g');
  v_evidence := regexp_replace(v_evidence, '[+]?[0-9]([[:space:]().-]*[0-9]){6,}', '[号码已遮盖]', 'g');
  if length(v_evidence) > 500
    or length(btrim(replace(replace(v_evidence, '[邮箱已遮盖]', ''), '[号码已遮盖]', ''))) < 4
    or replace(replace(v_evidence, '[邮箱已遮盖]', ''), '[号码已遮盖]', '') !~ '[^[:space:][:punct:]]' then
    raise exception 'directory identity review requires an evidence description' using errcode = '22023';
  end if;

  perform private.personnel_lock_org_v1(p_system_org_id);
  perform 1 from public.organizations where id = p_system_org_id for no key update;
  if not private.personnel_is_org_control_admin_v1(p_actor_id, p_system_org_id) then
    raise exception 'directory identity review requires current system administrator authority'
      using errcode = '42501', detail = 'DIRECTORY_IDENTITY_REVIEW_FORBIDDEN';
  end if;

  select * into v_plan from public.organization_directory_cutover_plans
    where id = p_plan_id and system_org_id = p_system_org_id for update;
  if not found then raise exception 'directory cutover plan not found' using errcode = 'P0002'; end if;
  if v_plan.plan_hash is distinct from p_plan_hash then
    raise exception 'directory identity review plan changed' using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;

  select * into v_saved from private.fxiaoke_directory_identity_reviews
    where plan_id = p_plan_id and org_id = p_system_org_id and external_user_id = p_external_user_id;
  if found then
    if v_saved.choice = p_choice and v_saved.user_id is not distinct from p_user_id
      and v_saved.evidence = v_evidence and v_saved.decided_by = p_actor_id then
      return private.fxiaoke_identity_review_json_v1(v_saved);
    end if;
    raise exception 'directory identity review already recorded' using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;

  if v_plan.status <> 'planned' or v_plan.expires_at <= clock_timestamp() then
    raise exception 'directory identity review expired' using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;
  if v_plan.plan_payload #> '{snapshot,scopeVerified}' is distinct from 'true'::jsonb
    or jsonb_typeof(v_plan.plan_payload #> '{snapshot,scopeEvidence}') is distinct from 'string'
    or coalesce(v_plan.plan_payload #>> '{snapshot,scopeEvidence}', '') !~ '[^[:space:]]'
    or v_plan.plan_payload #> '{snapshot,connectionVerified}' is distinct from 'true'::jsonb
    or v_plan.plan_payload #> '{snapshot,complete}' is distinct from 'true'::jsonb
    or v_plan.plan_payload->'conflicts' is distinct from '[]'::jsonb then
    raise exception 'directory identity review scope is unverified'
      using errcode = '23514', detail = 'DIRECTORY_SCOPE_UNVERIFIED';
  end if;

  perform 1 from public.organization_sources where system_org_id = p_system_org_id order by id for update;
  select * into v_source from public.organization_sources
    where id = v_plan.target_source_id and system_org_id = p_system_org_id and provider = 'fxiaoke';
  if not found or v_source.status <> 'active' or v_source.connection_state <> 'verified'
    or v_source.effective_revision is distinct from v_plan.connection_revision
    or v_plan.plan_payload->>'version' is distinct from 'f003-directory-cutover-v2'
    or v_plan.plan_payload->>'connectionRevision' is distinct from v_plan.connection_revision::text
    or v_plan.plan_payload->>'targetProvider' is distinct from v_source.provider
    or v_plan.plan_payload->>'organizationId' is distinct from p_system_org_id::text
    or v_plan.plan_payload->>'targetSourceId' is distinct from v_source.id::text
    or v_plan.plan_payload->>'targetExternalTenantId' is distinct from v_source.external_tenant_id
    or not private.organization_source_revisions_match_v1(p_system_org_id, v_plan.plan_payload->'sourceRevisions') then
    raise exception 'directory identity review source changed' using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;

  if jsonb_typeof(v_plan.plan_payload->'reviewConflicts') is distinct from 'array' then
    raise exception 'directory identity conflict is missing' using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;
  select count(*)::integer, jsonb_agg(item)->0
    into v_match_count, v_selected
    from jsonb_array_elements(v_plan.plan_payload->'reviewConflicts') as item
    where item->>'externalId' = p_external_user_id and jsonb_typeof(item->'identityReview') = 'object';
  v_review := v_selected->'identityReview';
  if v_match_count <> 1 or coalesce(v_review->>'factsHash', '') !~ '^[a-f0-9]{64}$'
    or coalesce(v_selected->>'kind', '') !~ '^[a-z0-9_]{1,80}$'
    or jsonb_typeof(v_review->'keepUserId') is null
    or (v_review->>'keepUserId' is not null and not pg_input_is_valid(v_review->>'keepUserId', 'uuid'))
    or jsonb_typeof(v_review->'linkUserIds') is distinct from 'array'
    or jsonb_typeof(v_review->'canCreate') is distinct from 'boolean'
    or (p_choice = 'keep_binding' and v_review->>'keepUserId' is distinct from p_user_id::text)
    or (p_choice = 'link_existing' and not (v_review->'linkUserIds' ? p_user_id::text))
    or (p_choice = 'create' and v_review->'canCreate' is distinct from 'true'::jsonb) then
    raise exception 'selected directory identity review option is unavailable'
      using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;

  select * into v_identity from public.external_identities
    where system_org_id = p_system_org_id and source_id = v_source.id and external_user_id = p_external_user_id
    for update;
  if v_identity.match_status = 'ignored'
    or (p_choice = 'keep_binding' and (
      v_identity.match_status is distinct from 'matched' or v_identity.canonical_user_id is distinct from p_user_id
    ))
    or (p_choice in ('link_existing', 'create') and (
      v_review->>'keepUserId' is not null or v_identity.canonical_user_id is not null
    )) then
    raise exception 'existing directory identity binding changed'
      using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;

  if p_user_id is not null then
    perform 1 from public.user_organizations as member
      join public.users as person on person.id = member.user_id and person.org_id = member.org_id
      where member.org_id = p_system_org_id and member.user_id = p_user_id
        and member.status in ('active', 'invited') and member.employment_status = 'active' and member.left_at is null
      for update of member, person;
    if not found or exists (
      select 1 from public.external_identities
      where system_org_id = p_system_org_id and source_id = v_source.id and canonical_user_id = p_user_id
        and external_user_id <> p_external_user_id and match_status in ('matched', 'conflict')
    ) then
      raise exception 'directory review target member or source binding changed'
        using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
    end if;
  end if;

  insert into private.fxiaoke_directory_identity_reviews (
    org_id, source_id, external_tenant_id, plan_id, external_user_id, conflict_kind,
    identity_status_before, canonical_user_id_before, facts_hash, choice, user_id, evidence, decided_by
  ) values (
    p_system_org_id, v_source.id, v_source.external_tenant_id, p_plan_id, p_external_user_id, v_selected->>'kind',
    v_identity.match_status, v_identity.canonical_user_id, v_review->>'factsHash', p_choice, p_user_id, v_evidence, p_actor_id
  ) returning * into v_saved;
  return private.fxiaoke_identity_review_json_v1(v_saved);
end;
$$;

revoke all on function private.fxiaoke_identity_review_json_v1(private.fxiaoke_directory_identity_reviews)
  from public, anon, authenticated, service_role;
revoke all on function public.list_fxiaoke_directory_identity_reviews_v1(uuid, uuid),
  public.save_fxiaoke_directory_identity_review_v1(uuid, uuid, text, text, text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_fxiaoke_directory_identity_reviews_v1(uuid, uuid),
  public.save_fxiaoke_directory_identity_review_v1(uuid, uuid, text, text, text, uuid, text, uuid)
  to service_role;

commit;
