begin;

create table private.fxiaoke_directory_primary_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  source_id uuid not null,
  plan_id uuid not null references public.organization_directory_cutover_plans(id) on delete restrict,
  external_user_id text not null,
  user_id uuid not null references public.users(id) on delete restrict,
  current_department_id uuid,
  incoming_department_external_id text not null,
  choice text not null check (choice in ('keep_local', 'adopt_source')),
  decided_by uuid not null references public.users(id) on delete restrict,
  decided_at timestamptz not null default clock_timestamp(),
  foreign key (source_id, org_id) references public.organization_sources(id, system_org_id) on delete restrict,
  unique (plan_id, external_user_id)
);

alter table private.fxiaoke_directory_primary_reviews enable row level security;
revoke all on table private.fxiaoke_directory_primary_reviews from public, anon, authenticated, service_role;
create index fxiaoke_directory_primary_reviews_source on private.fxiaoke_directory_primary_reviews
  (org_id, source_id, external_user_id, decided_at desc, id desc);

create function private.fxiaoke_primary_review_json_v1(row_value private.fxiaoke_directory_primary_reviews)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'externalUserId', row_value.external_user_id,
    'userId', row_value.user_id,
    'currentDepartmentId', row_value.current_department_id,
    'incomingDepartmentExternalId', row_value.incoming_department_external_id,
    'choice', row_value.choice,
    'decidedAt', row_value.decided_at
  );
$$;

create function public.list_fxiaoke_directory_primary_reviews_v1(p_system_org_id uuid, p_source_id uuid)
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select private.fxiaoke_primary_review_json_v1(latest)
  from (
    select distinct on (review.external_user_id) review.*
    from private.fxiaoke_directory_primary_reviews as review
    join public.organization_sources as source on source.id = review.source_id and source.system_org_id = review.org_id
    where review.org_id = p_system_org_id and review.source_id = p_source_id and source.provider = 'fxiaoke'
    order by review.external_user_id, review.decided_at desc, review.id desc
  ) as latest;
$$;

create function public.save_fxiaoke_directory_primary_review_v1(
  p_system_org_id uuid, p_plan_id uuid, p_plan_hash text,
  p_external_user_id text, p_choice text, p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.organization_directory_cutover_plans%rowtype;
  v_source public.organization_sources%rowtype;
  v_saved private.fxiaoke_directory_primary_reviews%rowtype;
  v_selected jsonb;
  v_match_count integer;
  v_user_id uuid;
  v_department_id uuid;
  v_incoming text;
begin
  if p_system_org_id is null or p_plan_id is null or p_actor_id is null
    or p_plan_hash is null or p_plan_hash !~ '^[a-f0-9]{64}$'
    or p_external_user_id is null or btrim(p_external_user_id) = '' or length(p_external_user_id) > 300
    or p_choice is null or p_choice not in ('keep_local', 'adopt_source') then
    raise exception 'invalid directory review input' using errcode = '22023';
  end if;

  perform private.personnel_lock_org_v1(p_system_org_id);
  perform 1 from public.organizations where id = p_system_org_id for no key update;
  if not exists (
    select 1 from public.user_organizations as actor
    where actor.org_id = p_system_org_id and actor.user_id = p_actor_id
      and actor.status = 'active' and actor.employment_status = 'active'
  ) then
    raise exception 'directory reviewer does not have an active organization membership' using errcode = '42501';
  end if;

  select * into v_plan from public.organization_directory_cutover_plans
    where id = p_plan_id and system_org_id = p_system_org_id for update;
  if not found then raise exception 'directory cutover plan not found' using errcode = 'P0002'; end if;
  if v_plan.plan_hash is distinct from p_plan_hash then
    raise exception 'directory review plan changed' using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;

  select * into v_saved from private.fxiaoke_directory_primary_reviews
    where plan_id = p_plan_id and org_id = p_system_org_id and external_user_id = p_external_user_id;
  if found then
    if v_saved.choice = p_choice and v_saved.decided_by = p_actor_id then
      return private.fxiaoke_primary_review_json_v1(v_saved);
    end if;
    raise exception 'directory review already recorded' using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;

  if v_plan.status <> 'planned' or v_plan.expires_at <= clock_timestamp() then
    raise exception 'directory review expired' using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;
  if v_plan.plan_payload #> '{snapshot,scopeVerified}' is distinct from 'true'::jsonb
    or jsonb_typeof(v_plan.plan_payload #> '{snapshot,scopeEvidence}') is distinct from 'string'
    or coalesce(v_plan.plan_payload #>> '{snapshot,scopeEvidence}', '') !~ '[^[:space:]]'
    or v_plan.plan_payload #> '{snapshot,connectionVerified}' is distinct from 'true'::jsonb
    or v_plan.plan_payload #> '{snapshot,complete}' is distinct from 'true'::jsonb
    or v_plan.plan_payload->'conflicts' is distinct from '[]'::jsonb then
    raise exception 'directory review scope is unverified' using errcode = '23514', detail = 'DIRECTORY_SCOPE_UNVERIFIED';
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
    or not coalesce(v_source.authority_scope->>'directory' in ('authoritative', 'true'), false)
    or not private.organization_source_revisions_match_v1(p_system_org_id, v_plan.plan_payload->'sourceRevisions') then
    raise exception 'directory review source changed' using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;

  if jsonb_typeof(v_plan.plan_payload->'reviewConflicts') is distinct from 'array' then
    raise exception 'directory conflict is missing' using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;
  select count(*)::integer, (jsonb_agg(item->'primaryReview')->0)
    into v_match_count, v_selected
    from jsonb_array_elements(v_plan.plan_payload->'reviewConflicts') as item
    where item->>'kind' = 'employee_primary_review' and item->>'externalId' = p_external_user_id;
  if v_match_count <> 1 or jsonb_typeof(v_selected) is distinct from 'object'
    or not coalesce(pg_input_is_valid(v_selected->>'userId', 'uuid'), false)
    or jsonb_typeof(v_selected->'currentDepartmentId') is null
    or (v_selected->>'currentDepartmentId' is not null
      and not pg_input_is_valid(v_selected->>'currentDepartmentId', 'uuid'))
    or jsonb_typeof(v_selected->'incomingDepartmentExternalId') is distinct from 'string'
    or coalesce(v_selected->>'incomingDepartmentExternalId', '') !~ '[^[:space:]]' then
    raise exception 'directory conflict is stale or ambiguous' using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;
  v_user_id := (v_selected->>'userId')::uuid;
  v_department_id := (v_selected->>'currentDepartmentId')::uuid;
  v_incoming := v_selected->>'incomingDepartmentExternalId';

  perform 1 from public.external_identities as identity
    where identity.system_org_id = p_system_org_id and identity.source_id = v_source.id
      and identity.external_user_id = p_external_user_id and identity.match_status = 'matched'
      and identity.canonical_user_id = v_user_id
    for update;
  if not found then
    raise exception 'directory employee binding changed' using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;
  perform 1 from public.user_organizations as member
    where member.org_id = p_system_org_id and member.user_id = v_user_id
      and member.status in ('active', 'invited') and member.employment_status = 'active'
      and member.primary_department_id is not distinct from v_department_id
    for update;
  if not found then
    raise exception 'employee department changed' using errcode = '40001', detail = 'DIRECTORY_REVIEW_STALE';
  end if;

  insert into private.fxiaoke_directory_primary_reviews (
    org_id, source_id, plan_id, external_user_id, user_id, current_department_id,
    incoming_department_external_id, choice, decided_by
  ) values (
    p_system_org_id, v_source.id, p_plan_id, p_external_user_id, v_user_id, v_department_id,
    v_incoming, p_choice, p_actor_id
  ) returning * into v_saved;
  return private.fxiaoke_primary_review_json_v1(v_saved);
end;
$$;

revoke all on function private.fxiaoke_primary_review_json_v1(private.fxiaoke_directory_primary_reviews)
  from public, anon, authenticated, service_role;
revoke all on function public.list_fxiaoke_directory_primary_reviews_v1(uuid, uuid),
  public.save_fxiaoke_directory_primary_review_v1(uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_fxiaoke_directory_primary_reviews_v1(uuid, uuid),
  public.save_fxiaoke_directory_primary_review_v1(uuid, uuid, text, text, text, uuid)
  to service_role;

commit;
