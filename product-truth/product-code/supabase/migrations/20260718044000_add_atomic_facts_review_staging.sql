set lock_timeout = '5s';
set statement_timeout = '60s';

-- facts_v1 evidence is staged independently from ReviewRun completion. This
-- migration does not create a candidate, materialize risk cards, promote a
-- bundle, or mark a ReviewRun complete.
do $guard$
begin
  if exists (select 1 from public.contract_review_adjudications) then
    raise exception 'FACTS_STAGING_REQUIRES_EMPTY_ADJUDICATION_TRACE' using errcode = '55000';
  end if;
end;
$guard$;

create table public.contract_review_fact_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  contract_id uuid not null,
  review_id uuid not null,
  analysis_job_id uuid not null,
  skill_bundle_id uuid not null references public.contract_skill_bundles(id) on delete restrict,
  skill_bundle_version integer not null,
  model_policy_id uuid not null,
  model_policy_hash text not null,
  source_storage_path text not null,
  source_hash text not null,
  source_text_hash text not null,
  output_contract text not null default 'facts_v1',
  chunk_total integer not null,
  run_hash text not null,
  created_at timestamptz not null default now(),
  constraint contract_review_fact_runs_review_unique unique (review_id),
  constraint contract_review_fact_runs_job_unique unique (analysis_job_id),
  constraint contract_review_fact_runs_identity_check check (
    skill_bundle_version > 0
    and btrim(source_storage_path) <> ''
    and output_contract = 'facts_v1'
    and chunk_total > 0
  ),
  constraint contract_review_fact_runs_hashes_check check (
    source_hash ~ '^[0-9a-f]{64}$'
    and source_text_hash ~ '^[0-9a-f]{64}$'
    and model_policy_hash ~ '^[0-9a-f]{64}$'
    and run_hash ~ '^[0-9a-f]{64}$'
  )
);

create table public.contract_review_fact_chunks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.contract_review_fact_runs(id) on delete restrict,
  model_invocation_id uuid not null,
  chunk_index integer not null,
  chunk_total integer not null,
  source_start integer not null,
  source_end integer not null,
  source_chunk_hash text not null,
  provider text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer not null,
  raw_output text not null,
  raw_output_hash text not null,
  created_at timestamptz not null default now(),
  constraint contract_review_fact_chunks_run_index_unique unique (run_id, chunk_index),
  constraint contract_review_fact_chunks_invocation_unique unique (model_invocation_id),
  constraint contract_review_fact_chunks_id_run_unique unique (id, run_id),
  constraint contract_review_fact_chunks_range_check check (
    chunk_index >= 1
    and chunk_total >= chunk_index
    and source_start >= 0
    and source_end > source_start
  ),
  constraint contract_review_fact_chunks_tokens_check check (
    (input_tokens is null or input_tokens >= 0)
    and (output_tokens is null or output_tokens >= 0)
    and total_tokens > 0
    and (
      input_tokens is null
      or output_tokens is null
      or total_tokens = input_tokens + output_tokens
    )
  ),
  constraint contract_review_fact_chunks_hashes_check check (
    source_chunk_hash ~ '^[0-9a-f]{64}$'
    and raw_output_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint contract_review_fact_chunks_text_check check (
    btrim(provider) <> '' and btrim(model) <> '' and btrim(raw_output) <> ''
  )
);

create table public.contract_review_rule_coverages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.contract_review_fact_runs(id) on delete restrict,
  fact_chunk_id uuid not null,
  rule_snapshot_id uuid not null references public.contract_rule_snapshots(id) on delete restrict,
  rule_code text not null,
  criteria_hash text not null,
  status text not null,
  created_at timestamptz not null default now(),
  constraint contract_review_rule_coverages_chunk_run_fkey
    foreign key (fact_chunk_id, run_id)
    references public.contract_review_fact_chunks(id, run_id) on delete restrict,
  constraint contract_review_rule_coverages_snapshot_unique unique (fact_chunk_id, rule_snapshot_id),
  constraint contract_review_rule_coverages_code_unique unique (fact_chunk_id, rule_code),
  constraint contract_review_rule_coverages_status_check
    check (status in ('observed', 'not_observed', 'uncertain')),
  constraint contract_review_rule_coverages_identity_check
    check (btrim(rule_code) <> '' and criteria_hash ~ '^[0-9a-f]{64}$')
);

-- The audit log must not be changed by deletion of operational rows. Frozen
-- UUIDs remain in the evidence record; bundle and rule assets keep RESTRICT.
alter table public.contract_review_adjudications
  drop constraint if exists contract_review_adjudications_org_id_fkey,
  drop constraint if exists contract_review_adjudications_contract_id_fkey,
  drop constraint if exists contract_review_adjudications_review_id_fkey,
  drop constraint if exists contract_review_adjudications_analysis_job_id_fkey,
  drop constraint if exists contract_review_adjudications_model_invocation_id_fkey,
  add column fact_run_id uuid,
  add column fact_chunk_id uuid;

alter table public.contract_review_adjudications
  alter column analysis_job_id set not null,
  alter column model_invocation_id set not null,
  alter column source_chunk_index set not null,
  alter column source_chunk_total set not null,
  alter column source_chunk_start set not null,
  alter column source_chunk_end set not null,
  alter column source_chunk_hash set not null,
  alter column fact_run_id set not null,
  alter column fact_chunk_id set not null,
  add constraint contract_review_adjudications_fact_run_fkey
    foreign key (fact_run_id)
    references public.contract_review_fact_runs(id) on delete restrict,
  add constraint contract_review_adjudications_fact_chunk_run_fkey
    foreign key (fact_chunk_id, fact_run_id)
    references public.contract_review_fact_chunks(id, run_id) on delete restrict;

create index idx_contract_review_fact_runs_contract
  on public.contract_review_fact_runs(contract_id, created_at desc);
create index idx_contract_review_fact_runs_bundle
  on public.contract_review_fact_runs(skill_bundle_id, skill_bundle_version);
create index idx_contract_review_fact_chunks_run
  on public.contract_review_fact_chunks(run_id, chunk_index);
create index idx_contract_review_rule_coverages_run
  on public.contract_review_rule_coverages(run_id, rule_code, status);
create index idx_contract_review_rule_coverages_rule
  on public.contract_review_rule_coverages(rule_snapshot_id, created_at desc);
create index if not exists idx_contract_review_adjudications_analysis_job
  on public.contract_review_adjudications(analysis_job_id);
create index if not exists idx_contract_review_adjudications_model_invocation
  on public.contract_review_adjudications(model_invocation_id);
create index if not exists idx_contract_review_adjudications_fact_run
  on public.contract_review_adjudications(fact_run_id, candidate_id);
create index if not exists idx_contract_review_adjudications_fact_chunk
  on public.contract_review_adjudications(fact_chunk_id);

alter table public.contract_review_fact_runs enable row level security;
alter table public.contract_review_fact_chunks enable row level security;
alter table public.contract_review_rule_coverages enable row level security;

revoke all on table public.contract_review_fact_runs from public, anon, authenticated, service_role;
revoke all on table public.contract_review_fact_chunks from public, anon, authenticated, service_role;
revoke all on table public.contract_review_rule_coverages from public, anon, authenticated, service_role;
revoke all on table public.contract_review_adjudications from public, anon, authenticated, service_role;
grant select on table public.contract_review_fact_runs to service_role;
grant select on table public.contract_review_fact_chunks to service_role;
grant select on table public.contract_review_rule_coverages to service_role;
grant select on table public.contract_review_adjudications to service_role;

create or replace function public.reject_contract_review_fact_audit_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'CONTRACT_REVIEW_FACT_AUDIT_IMMUTABLE' using errcode = '55000';
end;
$function$;

create trigger trg_reject_contract_review_fact_runs_mutation_v1
  before update or delete on public.contract_review_fact_runs
  for each row execute function public.reject_contract_review_fact_audit_mutation_v1();
create trigger trg_reject_contract_review_fact_chunks_mutation_v1
  before update or delete on public.contract_review_fact_chunks
  for each row execute function public.reject_contract_review_fact_audit_mutation_v1();
create trigger trg_reject_contract_review_rule_coverages_mutation_v1
  before update or delete on public.contract_review_rule_coverages
  for each row execute function public.reject_contract_review_fact_audit_mutation_v1();

revoke all on function public.reject_contract_review_fact_audit_mutation_v1()
  from public, anon, authenticated;
grant execute on function public.reject_contract_review_fact_audit_mutation_v1()
  to service_role;

-- Application payload:
--   p_chunks: [{"model_invocation_id":"uuid","raw_output":"exact provider JSON"}]
--   p_adjudications: [{"model_invocation_id":"uuid","candidate_id":"...",
--     "rule_code":"...","candidate_source_quote":"...","source_start":0,
--     "source_end":1,"raw_facts":{},"normalized_facts":{},
--     "level_results":{"A":false,"B":true,"C":false},
--     "matched_levels":["B"],"decision":"materialize",
--     "reason_code":"level_b","suppressed_by_candidate_id":null}]
-- All organization, source, bundle, policy, chunk, token, criteria and conflict
-- provenance is derived again inside PostgreSQL.
create or replace function public.stage_contract_review_facts_v1(
  p_job_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_lock_token uuid,
  p_chunks jsonb,
  p_adjudications jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.contract_analysis_jobs%rowtype;
  v_review public.contract_reviews%rowtype;
  v_contract public.contracts%rowtype;
  v_page_map public.contract_source_page_maps%rowtype;
  v_bundle public.contract_skill_bundles%rowtype;
  v_policy public.model_policies%rowtype;
  v_invocation public.model_invocations%rowtype;
  v_existing_run public.contract_review_fact_runs%rowtype;
  v_run_id uuid;
  v_chunk_id uuid;
  v_run_hash text;
  v_policy_hash text;
  v_source_utf16_length integer;
  v_rule_count integer;
  v_chunk_count integer;
  v_trace_count integer;
  v_input_tokens integer;
  v_output_tokens integer;
  v_total_tokens integer;
  v_chunk_index integer;
  v_chunk_total integer;
  v_chunk_start integer;
  v_chunk_end integer;
  v_chunk_hash text;
  v_raw_hash text;
  v_raw_json jsonb;
  v_chunk_text text;
  v_keys text[];
  v_chunk record;
  v_coverage jsonb;
  v_now timestamptz := pg_catalog.now();
begin
  if p_job_id is null or p_contract_id is null or p_review_id is null or p_lock_token is null then
    raise exception 'FACTS_STAGE_IDENTITY_REQUIRED' using errcode = '23514';
  end if;
  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then
    raise exception 'FACTS_STAGE_CHUNKS_INVALID' using errcode = '23514';
  end if;
  if jsonb_typeof(p_adjudications) <> 'array' then
    raise exception 'FACTS_STAGE_ADJUDICATIONS_INVALID' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_chunks) as supplied(item)
    cross join lateral (
      select coalesce(array_agg(key order by key), '{}'::text[]) as keys
      from jsonb_object_keys(supplied.item) as object_keys(key)
    ) as actual
    where jsonb_typeof(supplied.item) <> 'object'
       or actual.keys <> array['model_invocation_id', 'raw_output']::text[]
  ) then
    raise exception 'FACTS_STAGE_CHUNK_FIELDS_INVALID' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_adjudications) as supplied(item)
    cross join lateral (
      select coalesce(array_agg(key order by key), '{}'::text[]) as keys
      from jsonb_object_keys(supplied.item) as object_keys(key)
    ) as actual
    where jsonb_typeof(supplied.item) <> 'object'
       or actual.keys <> array[
         'candidate_id', 'candidate_source_quote', 'decision', 'level_results',
         'matched_levels', 'model_invocation_id', 'normalized_facts', 'raw_facts',
         'reason_code', 'rule_code', 'source_end', 'source_start',
         'suppressed_by_candidate_id'
       ]::text[]
  ) then
    raise exception 'FACTS_STAGE_ADJUDICATION_FIELDS_INVALID' using errcode = '23514';
  end if;

  select job.* into v_job
  from public.contract_analysis_jobs as job
  where job.id = p_job_id
    and job.contract_id = p_contract_id
    and job.review_id = p_review_id
  for update;
  if not found
     or v_job.status <> 'running'
     or v_job.lock_token is distinct from p_lock_token then
    raise exception 'FACTS_STAGE_LEASE_INVALID' using errcode = '55000';
  end if;

  select review.* into v_review
  from public.contract_reviews as review
  where review.id = p_review_id and review.contract_id = p_contract_id
  for update;
  if not found
     or v_review.status <> 'ANALYZING'
     or v_review.review_trigger <> 'direct'
     or v_review.skill_bundle_id is null
     or v_review.rule_version is null
     or v_review.model_policy_id is null
     or v_review.source_storage_path is null
     or v_review.source_hash is null
     or v_review.source_text_hash is null then
    raise exception 'FACTS_STAGE_REVIEW_INVALID' using errcode = '23514';
  end if;

  select contract.* into v_contract
  from public.contracts as contract
  where contract.id = p_contract_id
  for update;
  if not found
     or v_contract.org_id is null
     or v_contract.status <> 'ANALYZING'
     or v_contract.storage_path is distinct from v_review.source_storage_path
     or pg_catalog.encode(
       extensions.digest(pg_catalog.convert_to(coalesce(v_contract.parsed_text, ''), 'UTF8'), 'sha256'),
       'hex'
     ) is distinct from v_review.source_text_hash then
    raise exception 'FACTS_STAGE_CONTRACT_SOURCE_INVALID' using errcode = '23514';
  end if;

  select page_map.* into v_page_map
  from public.contract_source_page_maps as page_map
  where page_map.contract_id = p_contract_id
    and page_map.storage_path = v_review.source_storage_path
    and page_map.source_hash = v_review.source_hash
    and page_map.source_text_hash = v_review.source_text_hash;
  if not found then
    raise exception 'FACTS_STAGE_PAGE_MAP_INVALID' using errcode = '23514';
  end if;

  select bundle.* into v_bundle
  from public.contract_skill_bundles as bundle
  where bundle.id = v_review.skill_bundle_id
    and bundle.org_id = v_contract.org_id
    and bundle.key = 'CONTRACT_REVIEW_DEFAULT'
    and bundle.version = v_review.rule_version
    and bundle.status = 'published'
  for share;
  if not found
     or v_bundle.is_current
     or v_bundle.model_policy_id is distinct from v_review.model_policy_id
     or v_bundle.rule_snapshot_ids is distinct from v_review.rule_snapshot_ids
     or v_bundle.rule_set_snapshot_ids is distinct from v_review.rule_set_snapshot_ids
     or not (v_bundle.output_schema @> '{"contract":"contract_review_facts_v1","version":1}'::jsonb)
     or v_bundle.release_meta->>'stage' <> 'candidate'
     or v_bundle.release_meta->>'release_eligible' <> 'false'
     or not exists (
       select 1 from public.contract_skill_bundle_channels as channel
       where channel.org_id = v_contract.org_id
         and channel.key = v_bundle.key
         and channel.channel = 'preview_candidate'
         and channel.bundle_id = v_bundle.id
         and channel.bundle_version = v_bundle.version
     ) then
    raise exception 'FACTS_STAGE_CANDIDATE_BUNDLE_INVALID' using errcode = '23514';
  end if;

  select policy.* into v_policy
  from public.model_policies as policy
  where policy.id = v_bundle.model_policy_id
    and policy.org_id = v_contract.org_id
    and policy.status = 'published'
  for share;
  if not found then
    raise exception 'FACTS_STAGE_MODEL_POLICY_INVALID' using errcode = '23514';
  end if;
  v_policy_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(to_jsonb(v_policy)::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select pg_catalog.count(*)::integer into v_rule_count
  from public.contract_rule_snapshots as snapshot
  where snapshot.id = any(v_bundle.rule_snapshot_ids)
    and snapshot.status = 'published'
    and snapshot.criteria_hash is not null
    and snapshot.config_snapshot->>'code' is not null;
  if v_rule_count = 0
     or v_rule_count <> cardinality(v_bundle.rule_snapshot_ids)
     or exists (
       select snapshot.config_snapshot->>'code'
       from public.contract_rule_snapshots as snapshot
       where snapshot.id = any(v_bundle.rule_snapshot_ids)
       group by snapshot.config_snapshot->>'code'
       having count(*) <> 1
     ) then
    raise exception 'FACTS_STAGE_RULE_CATALOG_INVALID' using errcode = '23514';
  end if;

  v_chunk_count := jsonb_array_length(p_chunks);
  v_source_utf16_length := public.contract_utf16_codeunit_length(coalesce(v_contract.parsed_text, ''));
  v_run_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    jsonb_build_object(
      'job_id', p_job_id,
      'contract_id', p_contract_id,
      'review_id', p_review_id,
      'bundle_id', v_bundle.id,
      'bundle_version', v_bundle.version,
      'chunks', p_chunks,
      'adjudications', p_adjudications
    )::text,
    'UTF8'
  ), 'sha256'), 'hex');

  select fact_run.* into v_existing_run
  from public.contract_review_fact_runs as fact_run
  where fact_run.review_id = p_review_id;
  if found then
    if v_existing_run.analysis_job_id = p_job_id and v_existing_run.run_hash = v_run_hash then
      return jsonb_build_object(
        'run_id', v_existing_run.id,
        'idempotent', true,
        'chunk_count', v_existing_run.chunk_total,
        'coverage_count', (
          select count(*) from public.contract_review_rule_coverages as coverage
          where coverage.run_id = v_existing_run.id
        ),
        'adjudication_count', (
          select count(*) from public.contract_review_adjudications as adjudication
          where adjudication.fact_run_id = v_existing_run.id
        )
      );
    end if;
    raise exception 'FACTS_STAGE_REVIEW_ALREADY_STAGED' using errcode = '55000';
  end if;

  insert into public.contract_review_fact_runs (
    org_id, contract_id, review_id, analysis_job_id,
    skill_bundle_id, skill_bundle_version, model_policy_id, model_policy_hash,
    source_storage_path, source_hash, source_text_hash,
    output_contract, chunk_total, run_hash, created_at
  ) values (
    v_contract.org_id, p_contract_id, p_review_id, p_job_id,
    v_bundle.id, v_bundle.version, v_bundle.model_policy_id, v_policy_hash,
    v_review.source_storage_path, v_review.source_hash, v_review.source_text_hash,
    'facts_v1', v_chunk_count, v_run_hash, v_now
  ) returning id into v_run_id;

  for v_chunk in
    select supplied.model_invocation_id, supplied.raw_output
    from jsonb_to_recordset(p_chunks) as supplied(
      model_invocation_id uuid,
      raw_output text
    )
  loop
    if v_chunk.model_invocation_id is null or coalesce(v_chunk.raw_output, '') = '' then
      raise exception 'FACTS_STAGE_CHUNK_PAYLOAD_INVALID' using errcode = '23514';
    end if;
    select invocation.* into v_invocation
    from public.model_invocations as invocation
    where invocation.id = v_chunk.model_invocation_id
    for share;
    if not found
       or v_invocation.org_id is distinct from v_contract.org_id
       or v_invocation.contract_id is distinct from p_contract_id
       or v_invocation.review_id is distinct from p_review_id
       or v_invocation.skill_bundle_id is distinct from v_bundle.id
       or v_invocation.model_policy_id is distinct from v_bundle.model_policy_id
       or v_invocation.request_meta->>'job_id' is distinct from p_job_id::text
       or v_invocation.phase <> 'fact_extraction'
       or v_invocation.status <> 'completed'
       or v_invocation.degraded
       or v_invocation.error_message is not null
       or v_invocation.completed_at is null then
      raise exception 'FACTS_STAGE_INVOCATION_INVALID' using errcode = '23514';
    end if;

    if v_invocation.request_meta->'metadata'->>'output_contract' <> 'facts_v1'
       or coalesce(v_invocation.request_meta->'metadata'->>'chunk_index', '') !~ '^[0-9]+$'
       or coalesce(v_invocation.request_meta->'metadata'->>'chunk_total', '') !~ '^[0-9]+$'
       or coalesce(v_invocation.request_meta->'metadata'->>'chunk_start', '') !~ '^[0-9]+$'
       or coalesce(v_invocation.request_meta->'metadata'->>'chunk_end', '') !~ '^[0-9]+$'
       or coalesce(v_invocation.request_meta->'metadata'->>'chunk_hash', '') !~ '^[0-9a-f]{64}$'
       or v_invocation.response_meta->'metadata'->>'output_contract' <> 'facts_v1'
       or v_invocation.response_meta->'metadata'->>'chunk_hash'
          is distinct from v_invocation.request_meta->'metadata'->>'chunk_hash' then
      raise exception 'FACTS_STAGE_INVOCATION_CHUNK_METADATA_INVALID' using errcode = '23514';
    end if;

    v_chunk_index := (v_invocation.request_meta->'metadata'->>'chunk_index')::integer;
    v_chunk_total := (v_invocation.request_meta->'metadata'->>'chunk_total')::integer;
    v_chunk_start := (v_invocation.request_meta->'metadata'->>'chunk_start')::integer;
    v_chunk_end := (v_invocation.request_meta->'metadata'->>'chunk_end')::integer;
    v_chunk_hash := v_invocation.request_meta->'metadata'->>'chunk_hash';
    if v_chunk_total <> v_chunk_count
       or v_chunk_index < 1 or v_chunk_index > v_chunk_total
       or v_chunk_start < 0 or v_chunk_end <= v_chunk_start
       or v_chunk_end > v_source_utf16_length then
      raise exception 'FACTS_STAGE_CHUNK_RANGE_INVALID' using errcode = '23514';
    end if;
    v_chunk_text := public.contract_utf16_slice(v_contract.parsed_text, v_chunk_start, v_chunk_end);
    if v_chunk_text is null
       or pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(v_chunk_text, 'UTF8'), 'sha256'), 'hex'
       ) <> v_chunk_hash then
      raise exception 'FACTS_STAGE_CHUNK_HASH_INVALID' using errcode = '23514';
    end if;

    if coalesce(v_invocation.response_meta->'usage'->>'totalTokens', '') !~ '^[0-9]+$'
       or (
         v_invocation.response_meta->'usage' ? 'inputTokens'
         and coalesce(v_invocation.response_meta->'usage'->>'inputTokens', '') !~ '^[0-9]+$'
       )
       or (
         v_invocation.response_meta->'usage' ? 'outputTokens'
         and coalesce(v_invocation.response_meta->'usage'->>'outputTokens', '') !~ '^[0-9]+$'
       ) then
      raise exception 'FACTS_STAGE_TOKEN_EVIDENCE_INVALID' using errcode = '23514';
    end if;
    v_total_tokens := (v_invocation.response_meta->'usage'->>'totalTokens')::integer;
    v_input_tokens := case when v_invocation.response_meta->'usage' ? 'inputTokens'
      then (v_invocation.response_meta->'usage'->>'inputTokens')::integer else null end;
    v_output_tokens := case when v_invocation.response_meta->'usage' ? 'outputTokens'
      then (v_invocation.response_meta->'usage'->>'outputTokens')::integer else null end;
    if v_total_tokens <= 0
       or (v_input_tokens is not null and v_output_tokens is not null
           and v_total_tokens <> v_input_tokens + v_output_tokens) then
      raise exception 'FACTS_STAGE_TOKEN_EVIDENCE_INVALID' using errcode = '23514';
    end if;

    v_raw_hash := pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_chunk.raw_output, 'UTF8'), 'sha256'), 'hex'
    );
    if v_raw_hash is distinct from v_invocation.response_meta->'metadata'->>'raw_output_sha256' then
      raise exception 'FACTS_STAGE_RAW_OUTPUT_HASH_INVALID' using errcode = '23514';
    end if;
    begin
      v_raw_json := v_chunk.raw_output::jsonb;
    exception when others then
      raise exception 'FACTS_STAGE_RAW_OUTPUT_JSON_INVALID' using errcode = '23514';
    end;
    select coalesce(array_agg(key order by key), '{}'::text[]) into v_keys
    from jsonb_object_keys(v_raw_json) as object_keys(key);
    if jsonb_typeof(v_raw_json) <> 'object'
       or v_keys <> array['candidates', 'coverage', 'summary']::text[]
       or jsonb_typeof(v_raw_json->'candidates') <> 'array'
       or jsonb_typeof(v_raw_json->'coverage') <> 'array'
       or jsonb_typeof(v_raw_json->'summary') <> 'string'
       or jsonb_array_length(v_raw_json->'coverage') <> v_rule_count
       or coalesce(v_invocation.response_meta->'metadata'->>'facts_candidate_count', '') !~ '^[0-9]+$'
       or (v_invocation.response_meta->'metadata'->>'facts_candidate_count')::integer
          <> jsonb_array_length(v_raw_json->'candidates') then
      raise exception 'FACTS_STAGE_RAW_OUTPUT_CONTRACT_INVALID' using errcode = '23514';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_raw_json->'candidates') as candidate(item)
      cross join lateral (
        select coalesce(array_agg(key order by key), '{}'::text[]) as keys
        from jsonb_object_keys(candidate.item) as object_keys(key)
      ) as actual
      where jsonb_typeof(candidate.item) <> 'object'
         or actual.keys <> array['facts', 'rule_code', 'source_quote']::text[]
         or jsonb_typeof(candidate.item->'facts') <> 'object'
         or jsonb_typeof(candidate.item->'rule_code') <> 'string'
         or jsonb_typeof(candidate.item->'source_quote') <> 'string'
         or not exists (
           select 1 from public.contract_rule_snapshots as snapshot
           where snapshot.id = any(v_bundle.rule_snapshot_ids)
             and snapshot.config_snapshot->>'code' = candidate.item->>'rule_code'
         )
    ) then
      raise exception 'FACTS_STAGE_RAW_CANDIDATE_INVALID' using errcode = '23514';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_raw_json->'coverage') as coverage(item)
      cross join lateral (
        select coalesce(array_agg(key order by key), '{}'::text[]) as keys
        from jsonb_object_keys(coverage.item) as object_keys(key)
      ) as actual
      where jsonb_typeof(coverage.item) <> 'object'
         or actual.keys <> array['rule_code', 'status']::text[]
         or coverage.item->>'status' not in ('observed', 'not_observed', 'uncertain')
         or not exists (
           select 1 from public.contract_rule_snapshots as snapshot
           where snapshot.id = any(v_bundle.rule_snapshot_ids)
             and snapshot.config_snapshot->>'code' = coverage.item->>'rule_code'
         )
         or ((coverage.item->>'status' = 'observed') is distinct from exists (
           select 1 from jsonb_array_elements(v_raw_json->'candidates') as candidate(item)
           where candidate.item->>'rule_code' = coverage.item->>'rule_code'
         ))
    ) or exists (
      select coverage.item->>'rule_code'
      from jsonb_array_elements(v_raw_json->'coverage') as coverage(item)
      group by coverage.item->>'rule_code'
      having count(*) <> 1
    ) then
      raise exception 'FACTS_STAGE_COVERAGE_INVALID' using errcode = '23514';
    end if;

    insert into public.contract_review_fact_chunks (
      run_id, model_invocation_id, chunk_index, chunk_total,
      source_start, source_end, source_chunk_hash,
      provider, model, input_tokens, output_tokens, total_tokens,
      raw_output, raw_output_hash, created_at
    ) values (
      v_run_id, v_invocation.id, v_chunk_index, v_chunk_total,
      v_chunk_start, v_chunk_end, v_chunk_hash,
      v_invocation.provider, v_invocation.model,
      v_input_tokens, v_output_tokens, v_total_tokens,
      v_chunk.raw_output, v_raw_hash, v_now
    ) returning id into v_chunk_id;

    insert into public.contract_review_rule_coverages (
      run_id, fact_chunk_id, rule_snapshot_id, rule_code, criteria_hash, status, created_at
    )
    select
      v_run_id,
      v_chunk_id,
      snapshot.id,
      snapshot.config_snapshot->>'code',
      snapshot.criteria_hash,
      coverage.item->>'status',
      v_now
    from jsonb_array_elements(v_raw_json->'coverage') as coverage(item)
    join public.contract_rule_snapshots as snapshot
      on snapshot.id = any(v_bundle.rule_snapshot_ids)
     and snapshot.config_snapshot->>'code' = coverage.item->>'rule_code';
  end loop;

  if (
    select count(*) from public.contract_review_fact_chunks as chunk where chunk.run_id = v_run_id
  ) <> v_chunk_count
     or exists (
       select 1
       from (
         select
           chunk.*,
           row_number() over (order by chunk.chunk_index) as expected_index,
           lag(chunk.source_end) over (order by chunk.chunk_index) as prior_end
         from public.contract_review_fact_chunks as chunk
         where chunk.run_id = v_run_id
       ) as ordered
       where ordered.chunk_index <> ordered.expected_index
          or ordered.chunk_total <> v_chunk_count
          or (ordered.chunk_index = 1 and ordered.source_start <> 0)
          or (ordered.chunk_index > 1 and ordered.source_start > ordered.prior_end)
          or (ordered.chunk_index > 1 and ordered.source_end <= ordered.prior_end)
          or (ordered.chunk_index = v_chunk_count and ordered.source_end <> v_source_utf16_length)
     ) then
    raise exception 'FACTS_STAGE_SOURCE_COVERAGE_INVALID' using errcode = '23514';
  end if;
  if (
    select count(*) from public.contract_review_rule_coverages as coverage
    where coverage.run_id = v_run_id
  ) <> v_chunk_count * v_rule_count then
    raise exception 'FACTS_STAGE_COVERAGE_MATRIX_INCOMPLETE' using errcode = '23514';
  end if;

  if exists (
    select supplied.item->>'candidate_id'
    from jsonb_array_elements(p_adjudications) as supplied(item)
    group by supplied.item->>'candidate_id'
    having supplied.item->>'candidate_id' is null
        or btrim(supplied.item->>'candidate_id') = ''
        or count(*) <> 1
  ) then
    raise exception 'FACTS_STAGE_CANDIDATE_IDENTITIES_INVALID' using errcode = '23514';
  end if;

  for v_chunk in
    select supplied.*
    from jsonb_to_recordset(p_adjudications) as supplied(
      model_invocation_id uuid,
      candidate_id text,
      rule_code text,
      candidate_source_quote text,
      source_start integer,
      source_end integer,
      raw_facts jsonb,
      normalized_facts jsonb,
      level_results jsonb,
      matched_levels text[],
      decision text,
      reason_code text,
      suppressed_by_candidate_id text
    )
  loop
    declare
      v_fact_chunk public.contract_review_fact_chunks%rowtype;
      v_rule_snapshot public.contract_rule_snapshots%rowtype;
      v_source_exact_text text;
      v_matched_level text;
      v_severity text;
      v_materialize boolean;
      v_conflict_group text;
      v_specificity integer;
      v_suppressed_rule_snapshot_id uuid;
    begin
      if v_chunk.model_invocation_id is null
         or coalesce(v_chunk.candidate_id, '') !~ '^fact-[0-9a-f]{24}$'
         or coalesce(btrim(v_chunk.rule_code), '') = ''
         or coalesce(btrim(v_chunk.candidate_source_quote), '') = ''
         or v_chunk.source_start is null
         or v_chunk.source_end is null
         or v_chunk.source_start < 0
         or v_chunk.source_end <= v_chunk.source_start
         or jsonb_typeof(v_chunk.raw_facts) <> 'object'
         or jsonb_typeof(v_chunk.normalized_facts) <> 'object'
         or v_chunk.raw_facts is distinct from v_chunk.normalized_facts
         or jsonb_typeof(v_chunk.level_results) <> 'object'
         or v_chunk.matched_levels is null
         or cardinality(v_chunk.matched_levels) > 1
         or not (v_chunk.matched_levels <@ array['A', 'B', 'C']::text[])
         or cardinality(v_chunk.matched_levels) <> (
           select count(distinct level) from unnest(v_chunk.matched_levels) as levels(level)
         ) then
        raise exception 'FACTS_STAGE_ADJUDICATION_PAYLOAD_INVALID' using errcode = '23514';
      end if;
      select coalesce(array_agg(key order by key), '{}'::text[]) into v_keys
      from jsonb_object_keys(v_chunk.level_results) as object_keys(key);
      if v_keys <> array['A', 'B', 'C']::text[]
         or jsonb_typeof(v_chunk.level_results->'A') <> 'boolean'
         or jsonb_typeof(v_chunk.level_results->'B') <> 'boolean'
         or jsonb_typeof(v_chunk.level_results->'C') <> 'boolean' then
        raise exception 'FACTS_STAGE_LEVEL_RESULTS_INVALID' using errcode = '23514';
      end if;

      select fact_chunk.* into v_fact_chunk
      from public.contract_review_fact_chunks as fact_chunk
      where fact_chunk.run_id = v_run_id
        and fact_chunk.model_invocation_id = v_chunk.model_invocation_id;
      if not found
         or v_chunk.source_start < v_fact_chunk.source_start
         or v_chunk.source_end > v_fact_chunk.source_end then
        raise exception 'FACTS_STAGE_ADJUDICATION_CHUNK_INVALID' using errcode = '23514';
      end if;
      select snapshot.* into v_rule_snapshot
      from public.contract_rule_snapshots as snapshot
      where snapshot.id = any(v_bundle.rule_snapshot_ids)
        and snapshot.status = 'published'
        and snapshot.criteria_hash is not null
        and snapshot.config_snapshot->>'code' = v_chunk.rule_code;
      if not found then
        raise exception 'FACTS_STAGE_ADJUDICATION_RULE_INVALID' using errcode = '23514';
      end if;

      if not exists (
        select 1
        from jsonb_array_elements((v_fact_chunk.raw_output::jsonb)->'candidates') as candidate(item)
        where candidate.item->>'rule_code' = v_chunk.rule_code
          and candidate.item->>'source_quote' = v_chunk.candidate_source_quote
          and candidate.item->'facts' = v_chunk.raw_facts
      ) then
        raise exception 'FACTS_STAGE_ADJUDICATION_NOT_IN_RAW_OUTPUT' using errcode = '23514';
      end if;
      v_source_exact_text := public.contract_utf16_slice(
        v_contract.parsed_text,
        v_chunk.source_start,
        v_chunk.source_end
      );
      if v_source_exact_text is null
         or btrim(v_source_exact_text) = ''
         or regexp_replace(btrim(v_source_exact_text), '[[:space:]]+', ' ', 'g')
            <> regexp_replace(btrim(v_chunk.candidate_source_quote), '[[:space:]]+', ' ', 'g') then
        raise exception 'FACTS_STAGE_ADJUDICATION_SOURCE_INVALID' using errcode = '23514';
      end if;

      v_matched_level := case when cardinality(v_chunk.matched_levels) = 1
        then v_chunk.matched_levels[1] else null end;
      if (v_chunk.level_results->>'A')::boolean is distinct from (v_matched_level = 'A')
         or (v_chunk.level_results->>'B')::boolean is distinct from (v_matched_level = 'B')
         or (v_chunk.level_results->>'C')::boolean is distinct from (v_matched_level = 'C') then
        raise exception 'FACTS_STAGE_MATCHED_LEVELS_INVALID' using errcode = '23514';
      end if;

      if not (
        (v_chunk.decision = 'no_risk' and v_matched_level = 'A' and v_chunk.reason_code = 'level_a')
        or (v_chunk.decision = 'materialize' and v_matched_level = 'B' and v_chunk.reason_code = 'level_b')
        or (v_chunk.decision = 'materialize' and v_matched_level = 'C' and v_chunk.reason_code = 'level_c')
        or (v_chunk.decision = 'materialize' and v_matched_level is null and v_chunk.reason_code = 'default_unknown_yellow')
        or (v_chunk.decision = 'suppressed_unknown' and v_matched_level is null and v_chunk.reason_code = 'default_unknown_suppress')
        or (v_chunk.decision = 'suppressed_conflict' and v_chunk.reason_code = 'lower_specificity')
      ) then
        raise exception 'FACTS_STAGE_DECISION_INVALID' using errcode = '23514';
      end if;

      v_conflict_group := nullif(btrim(v_rule_snapshot.config_snapshot->>'conflict_group'), '');
      v_specificity := coalesce((v_rule_snapshot.config_snapshot->>'specificity')::integer, 0);
      v_suppressed_rule_snapshot_id := null;
      if v_chunk.decision = 'suppressed_conflict' then
        if v_conflict_group is null or coalesce(v_chunk.suppressed_by_candidate_id, '') = '' then
          raise exception 'FACTS_STAGE_SUPPRESSION_INVALID' using errcode = '23514';
        end if;
        select snapshot.id into v_suppressed_rule_snapshot_id
        from jsonb_array_elements(p_adjudications) as winner(item)
        join public.contract_rule_snapshots as snapshot
          on snapshot.id = any(v_bundle.rule_snapshot_ids)
         and snapshot.config_snapshot->>'code' = winner.item->>'rule_code'
        where winner.item->>'candidate_id' = v_chunk.suppressed_by_candidate_id;
        if not found then
          raise exception 'FACTS_STAGE_SUPPRESSION_WINNER_MISSING' using errcode = '23514';
        end if;
      elsif v_chunk.suppressed_by_candidate_id is not null then
        raise exception 'FACTS_STAGE_UNEXPECTED_SUPPRESSOR' using errcode = '23514';
      end if;

      v_materialize := v_chunk.decision = 'materialize';
      v_severity := case
        when not v_materialize then null
        when v_matched_level = 'C' then 'red'
        else 'yellow'
      end;

      insert into public.contract_review_adjudications (
        org_id, contract_id, review_id, analysis_job_id, model_invocation_id,
        candidate_id, skill_bundle_id, skill_bundle_version,
        rule_snapshot_id, rule_code,
        source_storage_path, source_hash, source_text_hash,
        source_start, source_end, source_exact_text, source_quote_hash,
        source_chunk_index, source_chunk_total, source_chunk_start, source_chunk_end, source_chunk_hash,
        raw_facts, normalized_facts, criteria_hash, adjudicator_version,
        level_results, matched_levels, matched_level,
        decision, severity, materialize, reason_code, errors,
        conflict_group, specificity,
        suppressed_by_candidate_id, suppressed_by_rule_snapshot_id,
        fact_run_id, fact_chunk_id, created_at
      ) values (
        v_contract.org_id, p_contract_id, p_review_id, p_job_id, v_fact_chunk.model_invocation_id,
        v_chunk.candidate_id, v_bundle.id, v_bundle.version,
        v_rule_snapshot.id, v_chunk.rule_code,
        v_review.source_storage_path, v_review.source_hash, v_review.source_text_hash,
        v_chunk.source_start, v_chunk.source_end, v_source_exact_text,
        pg_catalog.encode(
          extensions.digest(pg_catalog.convert_to(v_source_exact_text, 'UTF8'), 'sha256'), 'hex'
        ),
        v_fact_chunk.chunk_index, v_fact_chunk.chunk_total,
        v_fact_chunk.source_start, v_fact_chunk.source_end, v_fact_chunk.source_chunk_hash,
        v_chunk.raw_facts, v_chunk.normalized_facts, v_rule_snapshot.criteria_hash,
        'deterministic-adjudicator.v1',
        v_chunk.level_results, v_chunk.matched_levels, v_matched_level,
        v_chunk.decision, v_severity, v_materialize, v_chunk.reason_code, '[]'::jsonb,
        v_conflict_group, v_specificity,
        v_chunk.suppressed_by_candidate_id, v_suppressed_rule_snapshot_id,
        v_run_id, v_fact_chunk.id, v_now
      );
    end;
  end loop;

  if exists (
    select 1
    from public.contract_review_adjudications as loser
    join public.contract_rule_snapshots as loser_snapshot on loser_snapshot.id = loser.rule_snapshot_id
    where loser.fact_run_id = v_run_id
      and loser.decision = 'suppressed_conflict'
      and not exists (
        select 1
        from public.contract_review_adjudications as winner
        join public.contract_rule_snapshots as winner_snapshot on winner_snapshot.id = winner.rule_snapshot_id
        where winner.fact_run_id = v_run_id
          and winner.candidate_id = loser.suppressed_by_candidate_id
          and winner.rule_snapshot_id = loser.suppressed_by_rule_snapshot_id
          and winner.conflict_group = loser.conflict_group
          and winner.specificity > loser.specificity
          and winner.source_start < loser.source_end
          and loser.source_start < winner.source_end
          and loser_snapshot.config_snapshot->'mutually_exclusive_with' ? winner.rule_code
          and winner_snapshot.config_snapshot->'mutually_exclusive_with' ? loser.rule_code
      )
  ) then
    raise exception 'FACTS_STAGE_SUPPRESSION_PROVENANCE_INVALID' using errcode = '23514';
  end if;

  select count(*)::integer into v_trace_count
  from public.contract_review_adjudications as adjudication
  where adjudication.fact_run_id = v_run_id;

  return jsonb_build_object(
    'run_id', v_run_id,
    'idempotent', false,
    'chunk_count', v_chunk_count,
    'coverage_count', v_chunk_count * v_rule_count,
    'adjudication_count', v_trace_count,
    'review_completed', false
  );
end;
$function$;

revoke all on function public.stage_contract_review_facts_v1(
  uuid, uuid, uuid, uuid, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.stage_contract_review_facts_v1(
  uuid, uuid, uuid, uuid, jsonb, jsonb
) to service_role;
