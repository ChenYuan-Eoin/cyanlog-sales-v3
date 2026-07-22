set lock_timeout = '5s';
set statement_timeout = '60s';

-- Forward-only schema. Existing rule rows receive neutral defaults, while existing
-- immutable rule snapshots and the current skill bundle are intentionally untouched.
alter table public.contract_rules_v2
  add column if not exists review_criteria jsonb not null default '{}'::jsonb,
  add column if not exists conflict_group text,
  add column if not exists mutually_exclusive_with text[] not null default '{}'::text[],
  add column if not exists specificity integer not null default 0,
  add column if not exists default_unknown text not null default 'yellow_review',
  add column if not exists criteria_schema_version integer not null default 1;

alter table public.contract_rules_v2
  drop constraint if exists contract_rules_v2_review_criteria_object_check,
  add constraint contract_rules_v2_review_criteria_object_check
    check (jsonb_typeof(review_criteria) = 'object'),
  drop constraint if exists contract_rules_v2_conflict_group_check,
  add constraint contract_rules_v2_conflict_group_check
    check (conflict_group is null or btrim(conflict_group) <> ''),
  drop constraint if exists contract_rules_v2_mutual_exclusion_check,
  add constraint contract_rules_v2_mutual_exclusion_check
    check (
      cardinality(mutually_exclusive_with) <= 64
      and array_position(mutually_exclusive_with, null) is null
      and (cardinality(mutually_exclusive_with) = 0 or conflict_group is not null)
    ),
  drop constraint if exists contract_rules_v2_specificity_check,
  add constraint contract_rules_v2_specificity_check
    check (specificity between 0 and 1000000),
  drop constraint if exists contract_rules_v2_default_unknown_check,
  add constraint contract_rules_v2_default_unknown_check
    check (default_unknown in ('yellow_review', 'suppress', 'reject_finding')),
  drop constraint if exists contract_rules_v2_criteria_schema_version_check,
  add constraint contract_rules_v2_criteria_schema_version_check
    check (criteria_schema_version = 1);

create table if not exists public.contract_review_adjudications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  review_id uuid not null references public.contract_reviews(id) on delete cascade,
  analysis_job_id uuid references public.contract_analysis_jobs(id) on delete set null,
  model_invocation_id uuid references public.model_invocations(id) on delete set null,
  candidate_id text not null,
  skill_bundle_id uuid not null references public.contract_skill_bundles(id) on delete restrict,
  skill_bundle_version integer not null,
  rule_snapshot_id uuid not null references public.contract_rule_snapshots(id) on delete restrict,
  rule_code text not null,
  source_storage_path text not null,
  source_hash text not null,
  source_text_hash text not null,
  source_start integer not null,
  source_end integer not null,
  source_exact_text text not null,
  source_quote_hash text not null,
  source_chunk_index integer,
  source_chunk_total integer,
  source_chunk_start integer,
  source_chunk_end integer,
  source_chunk_hash text,
  raw_facts jsonb not null,
  normalized_facts jsonb not null,
  criteria_hash text not null,
  adjudicator_version text not null,
  level_results jsonb not null,
  matched_levels text[] not null default '{}'::text[],
  matched_level text,
  decision text not null,
  severity text,
  materialize boolean not null,
  reason_code text not null,
  errors jsonb not null default '[]'::jsonb,
  conflict_group text,
  specificity integer not null,
  suppressed_by_candidate_id text,
  suppressed_by_rule_snapshot_id uuid references public.contract_rule_snapshots(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint contract_review_adjudications_candidate_unique unique (review_id, candidate_id),
  constraint contract_review_adjudications_identity_check check (
    btrim(candidate_id) <> ''
    and btrim(rule_code) <> ''
    and skill_bundle_version > 0
    and btrim(source_storage_path) <> ''
    and btrim(adjudicator_version) <> ''
    and btrim(reason_code) <> ''
  ),
  constraint contract_review_adjudications_hashes_check check (
    source_hash ~ '^[0-9a-f]{64}$'
    and source_text_hash ~ '^[0-9a-f]{64}$'
    and source_quote_hash ~ '^[0-9a-f]{64}$'
    and criteria_hash ~ '^[0-9a-f]{64}$'
    and (source_chunk_hash is null or source_chunk_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint contract_review_adjudications_source_range_check check (
    source_start >= 0
    and source_end > source_start
    and btrim(source_exact_text) <> ''
  ),
  constraint contract_review_adjudications_chunk_check check (
    (
      source_chunk_index is null
      and source_chunk_total is null
      and source_chunk_start is null
      and source_chunk_end is null
      and source_chunk_hash is null
    ) or (
      source_chunk_index >= 0
      and source_chunk_total > 0
      and source_chunk_index < source_chunk_total
      and source_chunk_start >= 0
      and source_chunk_end > source_chunk_start
      and source_chunk_hash is not null
      and source_start >= source_chunk_start
      and source_end <= source_chunk_end
    )
  ),
  constraint contract_review_adjudications_facts_check check (
    jsonb_typeof(raw_facts) = 'object'
    and jsonb_typeof(normalized_facts) = 'object'
    and jsonb_typeof(level_results) = 'object'
    and level_results ?& array['A', 'B', 'C']
    and jsonb_typeof(errors) = 'array'
  ),
  constraint contract_review_adjudications_levels_check check (
    matched_levels <@ array['A', 'B', 'C']::text[]
    and cardinality(matched_levels) <= 3
    and (matched_level is null or matched_level = any(array['A', 'B', 'C']::text[]))
    and (matched_level is null or matched_level = any(matched_levels))
  ),
  constraint contract_review_adjudications_decision_check check (
    decision in ('no_risk', 'materialize', 'suppressed_unknown', 'reject', 'suppressed_conflict')
    and (severity is null or severity in ('yellow', 'red'))
    and (
      (decision = 'materialize' and materialize and severity in ('yellow', 'red'))
      or (decision <> 'materialize' and not materialize and severity is null)
    )
  ),
  constraint contract_review_adjudications_suppression_check check (
    (
      decision = 'suppressed_conflict'
      and conflict_group is not null
      and suppressed_by_candidate_id is not null
      and suppressed_by_rule_snapshot_id is not null
    ) or (
      decision <> 'suppressed_conflict'
      and suppressed_by_candidate_id is null
      and suppressed_by_rule_snapshot_id is null
    )
  ),
  constraint contract_review_adjudications_specificity_check check (specificity between 0 and 1000000)
);

create index if not exists idx_contract_review_adjudications_review
  on public.contract_review_adjudications(review_id, created_at, candidate_id);
create index if not exists idx_contract_review_adjudications_contract
  on public.contract_review_adjudications(contract_id, created_at desc);
create index if not exists idx_contract_review_adjudications_bundle
  on public.contract_review_adjudications(skill_bundle_id, skill_bundle_version);
create index if not exists idx_contract_review_adjudications_rule
  on public.contract_review_adjudications(rule_snapshot_id, created_at desc);

alter table public.contract_review_adjudications enable row level security;
revoke all on table public.contract_review_adjudications from public, anon, authenticated;
grant all on table public.contract_review_adjudications to service_role;

create or replace function public.validate_contract_review_adjudication_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.contract_reviews as review
    where review.id = new.review_id
      and review.contract_id = new.contract_id
      and review.skill_bundle_id is not distinct from new.skill_bundle_id
      and review.rule_version is not distinct from new.skill_bundle_version
      and new.rule_snapshot_id = any(coalesce(review.rule_snapshot_ids, '{}'::uuid[]))
      and review.source_storage_path is not distinct from new.source_storage_path
      and review.source_hash is not distinct from new.source_hash
      and review.source_text_hash is not distinct from new.source_text_hash
  ) then
    raise exception 'ADJUDICATION_FROZEN_REVIEW_MISMATCH' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.contracts as contract
    join public.contract_source_page_maps as page_map
      on page_map.contract_id = contract.id
    where contract.id = new.contract_id
      and contract.org_id = new.org_id
      and contract.storage_path is not distinct from new.source_storage_path
      and page_map.storage_path is not distinct from new.source_storage_path
      and page_map.source_hash is not distinct from new.source_hash
      and page_map.source_text_hash is not distinct from new.source_text_hash
      and pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(coalesce(contract.parsed_text, ''), 'UTF8'),
          'sha256'
        ),
        'hex'
      ) = new.source_text_hash
      and public.contract_utf16_slice(
        contract.parsed_text,
        new.source_start,
        new.source_end
      ) is not distinct from new.source_exact_text
      and pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(new.source_exact_text, 'UTF8'), 'sha256'),
        'hex'
      ) = new.source_quote_hash
  ) then
    raise exception 'ADJUDICATION_PAGE_MAP_PROVENANCE_INVALID' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.contract_skill_bundles as bundle
    join public.contract_rule_snapshots as snapshot
      on snapshot.id = new.rule_snapshot_id
     and snapshot.id = any(bundle.rule_snapshot_ids)
    where bundle.id = new.skill_bundle_id
      and bundle.org_id = new.org_id
      and bundle.version = new.skill_bundle_version
      and bundle.status = 'published'
      and snapshot.status = 'published'
      and snapshot.config_snapshot->>'code' = new.rule_code
      and pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to((snapshot.config_snapshot->'review_criteria')::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      ) = new.criteria_hash
  ) then
    raise exception 'ADJUDICATION_RULE_PROVENANCE_INVALID' using errcode = '23514';
  end if;

  if new.analysis_job_id is not null and not exists (
    select 1
    from public.contract_analysis_jobs as job
    where job.id = new.analysis_job_id
      and job.review_id = new.review_id
      and job.contract_id = new.contract_id
  ) then
    raise exception 'ADJUDICATION_JOB_PROVENANCE_INVALID' using errcode = '23514';
  end if;

  if new.model_invocation_id is not null and not exists (
    select 1
    from public.model_invocations as invocation
    where invocation.id = new.model_invocation_id
      and invocation.org_id = new.org_id
      and invocation.review_id = new.review_id
      and invocation.contract_id = new.contract_id
      and invocation.skill_bundle_id = new.skill_bundle_id
  ) then
    raise exception 'ADJUDICATION_INVOCATION_PROVENANCE_INVALID' using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_validate_contract_review_adjudication_v1
  on public.contract_review_adjudications;
create trigger trg_validate_contract_review_adjudication_v1
  before insert or update on public.contract_review_adjudications
  for each row execute function public.validate_contract_review_adjudication_v1();

revoke all on function public.validate_contract_review_adjudication_v1()
  from public, anon, authenticated;
grant execute on function public.validate_contract_review_adjudication_v1()
  to service_role;

create table if not exists public.contract_skill_bundle_channels (
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  channel text not null,
  bundle_id uuid not null references public.contract_skill_bundles(id) on delete restrict,
  bundle_version integer not null,
  updated_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (org_id, key, channel),
  constraint contract_skill_bundle_channels_key_check check (btrim(key) <> ''),
  constraint contract_skill_bundle_channels_channel_check
    check (channel in ('release_current', 'preview_candidate')),
  constraint contract_skill_bundle_channels_version_check check (bundle_version > 0)
);

-- release_current is a compatibility slot for a future promotion RPC. This
-- migration creates and moves only preview_candidate; it does not promote.

create unique index if not exists idx_contract_skill_bundle_channels_bundle
  on public.contract_skill_bundle_channels(org_id, key, channel, bundle_id, bundle_version);

alter table public.contract_skill_bundle_channels enable row level security;
revoke all on table public.contract_skill_bundle_channels from public, anon, authenticated;
grant all on table public.contract_skill_bundle_channels to service_role;

create or replace function public.validate_contract_skill_bundle_channel_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.contract_skill_bundles as bundle
    where bundle.id = new.bundle_id
      and bundle.org_id = new.org_id
      and bundle.key = new.key
      and bundle.version = new.bundle_version
      and bundle.status = 'published'
      and (
        (
          new.channel = 'release_current'
          and bundle.is_current
        ) or (
          new.channel = 'preview_candidate'
          and not bundle.is_current
          and bundle.release_meta->>'stage' = 'candidate'
          and bundle.release_meta->>'release_eligible' = 'false'
        )
      )
  ) then
    raise exception 'BUNDLE_CHANNEL_TARGET_INVALID' using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_validate_contract_skill_bundle_channel_v1
  on public.contract_skill_bundle_channels;
create trigger trg_validate_contract_skill_bundle_channel_v1
  before insert or update on public.contract_skill_bundle_channels
  for each row execute function public.validate_contract_skill_bundle_channel_v1();

revoke all on function public.validate_contract_skill_bundle_channel_v1()
  from public, anon, authenticated;
grant execute on function public.validate_contract_skill_bundle_channel_v1()
  to service_role;

create or replace function public.create_contract_review_candidate_bundle_v1(
  p_org_id uuid,
  p_user_id uuid,
  p_model_policy_id uuid,
  p_rule_snapshot_ids uuid[],
  p_rule_set_snapshot_ids uuid[],
  p_output_schema jsonb,
  p_release_note text default null,
  p_eval_case_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_base_bundle public.contract_skill_bundles%rowtype;
  v_bundle_id uuid;
  v_bundle_version integer;
  v_compiled_from jsonb;
  v_compiled_hash text;
  v_output_schema_hash text;
  v_now timestamptz := pg_catalog.now();
begin
  if not exists (
    select 1
    from public.users as creator
    join public.user_organizations as membership
      on membership.user_id = creator.id
     and membership.org_id = p_org_id
    where creator.id = p_user_id
      and creator.status = 'active'
  ) then
    raise exception 'CANDIDATE_CREATOR_FORBIDDEN' using errcode = '42501';
  end if;

  if p_rule_snapshot_ids is null
     or cardinality(p_rule_snapshot_ids) = 0
     or array_position(p_rule_snapshot_ids, null) is not null
     or cardinality(p_rule_snapshot_ids) <> (
       select pg_catalog.count(distinct candidate_id)
       from pg_catalog.unnest(p_rule_snapshot_ids) as candidate(candidate_id)
     ) then
    raise exception 'CANDIDATE_RULE_SNAPSHOTS_INVALID' using errcode = '23514';
  end if;

  if p_rule_set_snapshot_ids is null
     or cardinality(p_rule_set_snapshot_ids) = 0
     or array_position(p_rule_set_snapshot_ids, null) is not null
     or cardinality(p_rule_set_snapshot_ids) <> (
       select pg_catalog.count(distinct candidate_id)
       from pg_catalog.unnest(p_rule_set_snapshot_ids) as candidate(candidate_id)
     ) then
    raise exception 'CANDIDATE_RULE_SET_SNAPSHOTS_INVALID' using errcode = '23514';
  end if;

  if p_eval_case_ids is null or array_position(p_eval_case_ids, null) is not null then
    raise exception 'CANDIDATE_EVAL_CASES_INVALID' using errcode = '23514';
  end if;

  if jsonb_typeof(p_output_schema) <> 'object' or p_output_schema = '{}'::jsonb then
    raise exception 'CANDIDATE_OUTPUT_SCHEMA_INVALID' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.model_policies as policy
    where policy.id = p_model_policy_id
      and policy.org_id = p_org_id
      and policy.status = 'published'
  ) then
    raise exception 'CANDIDATE_MODEL_POLICY_INVALID' using errcode = '23514';
  end if;

  if (
    select pg_catalog.count(*)
    from public.contract_rule_snapshots as snapshot
    join public.contract_rules_v2 as rule on rule.id = snapshot.rule_id
    where snapshot.id = any(p_rule_snapshot_ids)
      and snapshot.status = 'published'
      and rule.org_id = p_org_id
      and jsonb_typeof(snapshot.config_snapshot->'review_criteria') = 'object'
      and snapshot.config_snapshot->'review_criteria' <> '{}'::jsonb
      and snapshot.config_snapshot->'review_criteria'->>'schema_version' = '1'
      and snapshot.config_snapshot->'review_criteria' ?& array['fact_schema', 'level_a', 'level_b', 'level_c']
      and snapshot.config_snapshot @> '{"criteria_schema_version":1}'::jsonb
      and jsonb_typeof(snapshot.config_snapshot->'mutually_exclusive_with') = 'array'
      and jsonb_typeof(snapshot.config_snapshot->'specificity') = 'number'
      and snapshot.config_snapshot->>'default_unknown' in ('yellow_review', 'suppress', 'reject_finding')
  ) <> cardinality(p_rule_snapshot_ids) then
    raise exception 'CANDIDATE_RULE_CRITERIA_INCOMPLETE' using errcode = '23514';
  end if;

  if exists (
    select snapshot.config_snapshot->>'code'
    from public.contract_rule_snapshots as snapshot
    where snapshot.id = any(p_rule_snapshot_ids)
    group by snapshot.config_snapshot->>'code'
    having snapshot.config_snapshot->>'code' is null
        or btrim(snapshot.config_snapshot->>'code') = ''
        or pg_catalog.count(*) > 1
  ) then
    raise exception 'CANDIDATE_RULE_CODES_NOT_UNIQUE' using errcode = '23514';
  end if;

  if (
    select pg_catalog.count(*)
    from public.contract_rule_set_snapshots as snapshot
    where snapshot.id = any(p_rule_set_snapshot_ids)
      and snapshot.org_id = p_org_id
      and snapshot.status = 'published'
  ) <> cardinality(p_rule_set_snapshot_ids) then
    raise exception 'CANDIDATE_RULE_SET_SNAPSHOT_PROVENANCE_INVALID' using errcode = '23514';
  end if;

  if exists (
    select supplied.rule_snapshot_id
    from pg_catalog.unnest(p_rule_snapshot_ids) as supplied(rule_snapshot_id)
    except
    select included.rule_snapshot_id
    from public.contract_rule_set_snapshots as rule_set_snapshot
    cross join lateral pg_catalog.unnest(rule_set_snapshot.rule_snapshot_ids) as included(rule_snapshot_id)
    where rule_set_snapshot.id = any(p_rule_set_snapshot_ids)
  ) or exists (
    select included.rule_snapshot_id
    from public.contract_rule_set_snapshots as rule_set_snapshot
    cross join lateral pg_catalog.unnest(rule_set_snapshot.rule_snapshot_ids) as included(rule_snapshot_id)
    where rule_set_snapshot.id = any(p_rule_set_snapshot_ids)
    except
    select supplied.rule_snapshot_id
    from pg_catalog.unnest(p_rule_snapshot_ids) as supplied(rule_snapshot_id)
  ) then
    raise exception 'CANDIDATE_RULE_SET_MEMBERSHIP_MISMATCH' using errcode = '23514';
  end if;

  select bundle.*
  into v_base_bundle
  from public.contract_skill_bundles as bundle
  where bundle.org_id = p_org_id
    and bundle.key = 'CONTRACT_REVIEW_DEFAULT'
    and bundle.status = 'published'
    and bundle.is_current
  order by bundle.version desc
  limit 1
  for share;

  if not found then
    raise exception 'CANDIDATE_BASE_BUNDLE_NOT_FOUND' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':CONTRACT_REVIEW_DEFAULT', 0)
  );

  select coalesce(pg_catalog.max(bundle.version), 0) + 1
  into v_bundle_version
  from public.contract_skill_bundles as bundle
  where bundle.org_id = p_org_id
    and bundle.key = 'CONTRACT_REVIEW_DEFAULT';

  v_output_schema_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_output_schema::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_compiled_from := jsonb_build_object(
    'source', 'deterministic_adjudication_candidate',
    'base_bundle_id', v_base_bundle.id,
    'base_bundle_version', v_base_bundle.version,
    'rule_snapshot_ids', p_rule_snapshot_ids,
    'rule_set_snapshot_ids', p_rule_set_snapshot_ids,
    'model_policy_id', p_model_policy_id,
    'output_schema', p_output_schema,
    'output_schema_hash', v_output_schema_hash,
    'eval_case_ids', p_eval_case_ids
  );
  v_compiled_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_compiled_from::text, 'UTF8'), 'sha256'),
    'hex'
  );

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
    false,
    p_rule_snapshot_ids,
    p_rule_set_snapshot_ids,
    coalesce(v_base_bundle.document_snapshot_ids, '{}'::uuid[]),
    coalesce(v_base_bundle.template_snapshot_ids, '{}'::uuid[]),
    p_output_schema,
    p_model_policy_id,
    p_eval_case_ids,
    jsonb_build_object(
      'stage', 'candidate',
      'release_eligible', false,
      'release_note', p_release_note,
      'created_by', p_user_id,
      'created_at', v_now,
      'base_bundle_id', v_base_bundle.id,
      'base_bundle_version', v_base_bundle.version,
      'adjudicator_version', 'deterministic-adjudicator.v1',
      'criteria_schema_version', 1,
      'output_schema_hash', v_output_schema_hash
    ),
    v_compiled_from,
    v_compiled_hash,
    p_user_id,
    p_user_id,
    v_now,
    v_now
  )
  returning id into v_bundle_id;

  insert into public.contract_skill_bundle_channels (
    org_id,
    key,
    channel,
    bundle_id,
    bundle_version,
    updated_by,
    updated_at
  ) values (
    p_org_id,
    'CONTRACT_REVIEW_DEFAULT',
    'preview_candidate',
    v_bundle_id,
    v_bundle_version,
    p_user_id,
    v_now
  )
  on conflict (org_id, key, channel) do update
  set bundle_id = excluded.bundle_id,
      bundle_version = excluded.bundle_version,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'skill_bundle_id', v_bundle_id,
    'skill_bundle_version', v_bundle_version,
    'channel', 'preview_candidate',
    'stage', 'candidate',
    'release_eligible', false,
    'base_bundle_id', v_base_bundle.id,
    'base_bundle_version', v_base_bundle.version
  );
end;
$function$;

revoke all on function public.create_contract_review_candidate_bundle_v1(
  uuid, uuid, uuid, uuid[], uuid[], jsonb, text, text[]
) from public, anon, authenticated;
grant execute on function public.create_contract_review_candidate_bundle_v1(
  uuid, uuid, uuid, uuid[], uuid[], jsonb, text, text[]
) to service_role;
