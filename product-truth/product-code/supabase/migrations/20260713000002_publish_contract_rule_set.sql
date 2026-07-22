create table if not exists public.contract_rule_eval_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rule_id uuid not null references public.contract_rules_v2(id) on delete cascade,
  mode text not null check (mode in ('deterministic', 'model')),
  status text not null check (status in ('passed', 'failed', 'error')),
  input_snapshot jsonb not null default '{}'::jsonb,
  expected_snapshot jsonb not null default '{}'::jsonb,
  actual_snapshot jsonb not null default '{}'::jsonb,
  provider text,
  degraded boolean not null default false,
  token_usage jsonb,
  latency_ms integer,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_contract_rule_eval_runs_release_gate
  on public.contract_rule_eval_runs(org_id, rule_id, status, created_at desc);

alter table public.contract_rule_eval_runs enable row level security;

revoke all on table public.contract_rule_eval_runs from public;
revoke all on table public.contract_rule_eval_runs from anon;
revoke all on table public.contract_rule_eval_runs from authenticated;
grant all on table public.contract_rule_eval_runs to service_role;

create or replace function public.publish_contract_rule_set_v1(
  p_org_id uuid,
  p_rule_set_id uuid,
  p_user_id uuid,
  p_release_note text default null,
  p_test_results jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule_set public.contract_rule_sets%rowtype;
  v_rule public.contract_rules_v2%rowtype;
  v_previous_bundle public.contract_skill_bundles%rowtype;
  v_rule_snapshot_ids uuid[] := '{}'::uuid[];
  v_rule_set_snapshot_ids uuid[] := '{}'::uuid[];
  v_document_snapshot_ids uuid[] := '{}'::uuid[];
  v_template_snapshot_ids uuid[] := '{}'::uuid[];
  v_eval_case_ids text[] := '{}'::text[];
  v_rule_snapshot_id uuid;
  v_rule_set_snapshot_id uuid;
  v_bundle_id uuid;
  v_rule_set_version integer;
  v_bundle_version integer;
  v_now timestamptz := now();
  v_output_schema jsonb := '{}'::jsonb;
  v_model_policy_id uuid;
begin
  select *
  into v_rule_set
  from public.contract_rule_sets
  where id = p_rule_set_id
    and org_id = p_org_id
    and coalesce(is_active, true)
  for update;

  if not found then
    raise exception 'RULE_SET_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.contract_rules_v2
    where org_id = p_org_id
      and rule_set_id = p_rule_set_id
      and coalesce(is_active, true)
  ) then
    raise exception 'RULE_SET_EMPTY';
  end if;

  if exists (
    select 1
    from public.contract_rules_v2 rule
    where rule.org_id = p_org_id
      and rule.rule_set_id = p_rule_set_id
      and coalesce(rule.is_active, true)
      and not exists (
        select 1
        from public.contract_rule_eval_runs eval
        where eval.org_id = p_org_id
          and eval.rule_id = rule.id
          and eval.status = 'passed'
          and eval.created_at >= rule.updated_at
      )
  ) then
    raise exception 'RULE_SET_EVAL_REQUIRED';
  end if;

  v_rule_set_version := coalesce(v_rule_set.version, 0) + 1;

  for v_rule in
    select *
    from public.contract_rules_v2
    where org_id = p_org_id
      and rule_set_id = p_rule_set_id
      and coalesce(is_active, true)
    order by priority desc nulls last, code
  loop
    insert into public.contract_rule_snapshots (
      rule_id,
      version,
      config_snapshot,
      released_by,
      released_at,
      release_note,
      status
    ) values (
      v_rule.id,
      coalesce(v_rule.version, 1),
      to_jsonb(v_rule),
      p_user_id,
      v_now,
      p_release_note,
      'published'
    )
    returning id into v_rule_snapshot_id;

    v_rule_snapshot_ids := array_append(v_rule_snapshot_ids, v_rule_snapshot_id);
  end loop;

  insert into public.contract_rule_set_snapshots (
    org_id,
    rule_set_id,
    version,
    status,
    rule_snapshot_ids,
    document_snapshot_ids,
    config_snapshot,
    test_results,
    released_by,
    released_at,
    release_note
  ) values (
    p_org_id,
    p_rule_set_id,
    v_rule_set_version,
    'published',
    v_rule_snapshot_ids,
    '{}'::uuid[],
    jsonb_build_object(
      'rule_set', to_jsonb(v_rule_set),
      'published_rule_count', cardinality(v_rule_snapshot_ids)
    ),
    coalesce(p_test_results, '{}'::jsonb),
    p_user_id,
    v_now,
    p_release_note
  )
  returning id into v_rule_set_snapshot_id;

  update public.contract_rules_v2
  set lifecycle_status = 'published',
      translation_status = 'ready',
      published_at = v_now,
      published_by = p_user_id,
      updated_at = v_now
  where org_id = p_org_id
    and rule_set_id = p_rule_set_id
    and coalesce(is_active, true);

  update public.contract_rule_sets
  set version = v_rule_set_version,
      lifecycle_status = 'published',
      translation_status = 'ready',
      published_at = v_now,
      published_by = p_user_id,
      release_note = p_release_note,
      updated_at = v_now
  where id = p_rule_set_id
    and org_id = p_org_id;

  select *
  into v_previous_bundle
  from public.contract_skill_bundles
  where org_id = p_org_id
    and key = 'CONTRACT_REVIEW_DEFAULT'
    and status = 'published'
    and is_current
  order by version desc
  limit 1
  for update;

  if found then
    v_template_snapshot_ids := coalesce(v_previous_bundle.template_snapshot_ids, '{}'::uuid[]);
    v_eval_case_ids := coalesce(v_previous_bundle.eval_case_ids, '{}'::text[]);
    v_output_schema := coalesce(v_previous_bundle.output_schema, '{}'::jsonb);
    v_model_policy_id := v_previous_bundle.model_policy_id;
  end if;

  select coalesce(array_agg(latest.id order by latest.priority desc, latest.code), '{}'::uuid[])
  into v_rule_set_snapshot_ids
  from (
    select distinct on (snapshot.rule_set_id)
      snapshot.id,
      rule_set.priority,
      rule_set.code
    from public.contract_rule_set_snapshots snapshot
    join public.contract_rule_sets rule_set on rule_set.id = snapshot.rule_set_id
    where snapshot.org_id = p_org_id
      and snapshot.status = 'published'
      and coalesce(rule_set.is_active, true)
    order by snapshot.rule_set_id, snapshot.version desc, snapshot.released_at desc nulls last
  ) latest;

  select coalesce(array_agg(distinct rule_snapshot_id), '{}'::uuid[])
  into v_rule_snapshot_ids
  from public.contract_rule_set_snapshots snapshot
  cross join lateral unnest(coalesce(snapshot.rule_snapshot_ids, '{}'::uuid[])) rule_snapshot_id
  where snapshot.id = any(v_rule_set_snapshot_ids);

  select coalesce(array_agg(distinct document_snapshot_id), '{}'::uuid[])
  into v_document_snapshot_ids
  from public.contract_rule_set_snapshots snapshot
  cross join lateral unnest(coalesce(snapshot.document_snapshot_ids, '{}'::uuid[])) document_snapshot_id
  where snapshot.id = any(v_rule_set_snapshot_ids);

  select coalesce(max(version), 0) + 1
  into v_bundle_version
  from public.contract_skill_bundles
  where org_id = p_org_id
    and key = 'CONTRACT_REVIEW_DEFAULT';

  update public.contract_skill_bundles
  set is_current = false,
      updated_at = v_now
  where org_id = p_org_id
    and key = 'CONTRACT_REVIEW_DEFAULT'
    and is_current;

  insert into public.contract_skill_bundles (
    org_id,
    key,
    version,
    status,
    is_current,
    rule_snapshot_ids,
    rule_set_snapshot_ids,
    document_snapshot_ids,
    template_snapshot_ids,
    output_schema,
    model_policy_id,
    eval_case_ids,
    release_meta,
    compiled_from,
    compiled_hash,
    created_by,
    published_by,
    compiled_at,
    published_at
  ) values (
    p_org_id,
    'CONTRACT_REVIEW_DEFAULT',
    v_bundle_version,
    'published',
    true,
    v_rule_snapshot_ids,
    v_rule_set_snapshot_ids,
    v_document_snapshot_ids,
    v_template_snapshot_ids,
    v_output_schema,
    v_model_policy_id,
    v_eval_case_ids,
    jsonb_build_object(
      'release_note', p_release_note,
      'published_rule_set_id', p_rule_set_id,
      'published_rule_set_snapshot_id', v_rule_set_snapshot_id,
      'published_at', v_now
    ),
    jsonb_build_object(
      'rule_set_snapshot_ids', v_rule_set_snapshot_ids,
      'rule_snapshot_ids', v_rule_snapshot_ids,
      'source', 'configuration_center'
    ),
    md5(concat_ws('|', p_org_id::text, v_bundle_version::text, v_rule_set_snapshot_ids::text, v_rule_snapshot_ids::text)),
    p_user_id,
    p_user_id,
    v_now,
    v_now
  )
  returning id into v_bundle_id;

  return jsonb_build_object(
    'rule_set_id', p_rule_set_id,
    'rule_set_version', v_rule_set_version,
    'rule_set_snapshot_id', v_rule_set_snapshot_id,
    'rule_snapshot_ids', v_rule_snapshot_ids,
    'skill_bundle_id', v_bundle_id,
    'skill_bundle_version', v_bundle_version,
    'rule_set_snapshot_ids', v_rule_set_snapshot_ids
  );
end;
$$;

revoke all on function public.publish_contract_rule_set_v1(uuid, uuid, uuid, text, jsonb) from public;
revoke all on function public.publish_contract_rule_set_v1(uuid, uuid, uuid, text, jsonb) from anon;
revoke all on function public.publish_contract_rule_set_v1(uuid, uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.publish_contract_rule_set_v1(uuid, uuid, uuid, text, jsonb) to service_role;

create or replace function public.archive_contract_rule_set_v1(
  p_org_id uuid,
  p_rule_set_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule_count integer;
begin
  if not exists (
    select 1
    from public.contract_rule_sets
    where id = p_rule_set_id
      and org_id = p_org_id
  ) then
    raise exception 'RULE_SET_NOT_FOUND';
  end if;

  update public.contract_rules_v2
  set is_active = false,
      lifecycle_status = 'archived',
      version = coalesce(version, 0) + 1,
      updated_at = now()
  where org_id = p_org_id
    and rule_set_id = p_rule_set_id
    and lifecycle_status <> 'archived';

  get diagnostics v_rule_count = row_count;

  update public.contract_rule_sets
  set is_active = false,
      lifecycle_status = 'archived',
      updated_at = now()
  where id = p_rule_set_id
    and org_id = p_org_id;

  return jsonb_build_object(
    'id', p_rule_set_id,
    'lifecycle_status', 'archived',
    'archived_rule_count', v_rule_count
  );
end;
$$;

revoke all on function public.archive_contract_rule_set_v1(uuid, uuid) from public;
revoke all on function public.archive_contract_rule_set_v1(uuid, uuid) from anon;
revoke all on function public.archive_contract_rule_set_v1(uuid, uuid) from authenticated;
grant execute on function public.archive_contract_rule_set_v1(uuid, uuid) to service_role;
