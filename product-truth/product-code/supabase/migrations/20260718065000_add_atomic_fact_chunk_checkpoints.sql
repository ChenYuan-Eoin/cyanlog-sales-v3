set lock_timeout = '5s';
set statement_timeout = '60s';

-- A successful facts_v1 provider call and its resumable canonical output must
-- be one database fact. Keeping either side alone recreates the orphan gap
-- that caused whole-document reruns after a later chunk failed.
create table public.contract_review_fact_chunk_checkpoints (
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
  chunk_index integer not null,
  chunk_total integer not null,
  source_start integer not null,
  source_end integer not null,
  source_chunk_hash text not null,
  model_invocation_id uuid not null,
  provider text not null,
  model text not null,
  fallback_rank integer not null,
  attempt integer not null,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer not null,
  raw_output text not null,
  raw_output_hash text not null,
  provider_raw_output_hash text not null,
  checkpoint_hash text not null,
  created_at timestamptz not null default now(),
  constraint contract_review_fact_chunk_checkpoints_job_chunk_unique
    unique (analysis_job_id, chunk_index),
  constraint contract_review_fact_chunk_checkpoints_review_chunk_unique
    unique (review_id, chunk_index),
  constraint contract_review_fact_chunk_checkpoints_invocation_unique
    unique (model_invocation_id),
  constraint contract_review_fact_chunk_checkpoints_identity_check check (
    skill_bundle_version > 0
    and btrim(source_storage_path) <> ''
    and btrim(provider) <> ''
    and btrim(model) <> ''
    and chunk_index >= 1
    and chunk_total >= chunk_index
    and source_start >= 0
    and source_end > source_start
    and fallback_rank >= 0
    and attempt >= 0
  ),
  constraint contract_review_fact_chunk_checkpoints_tokens_check check (
    (input_tokens is null or input_tokens >= 0)
    and (output_tokens is null or output_tokens >= 0)
    and total_tokens > 0
    and (
      input_tokens is null
      or output_tokens is null
      or total_tokens = input_tokens + output_tokens
    )
  ),
  constraint contract_review_fact_chunk_checkpoints_hashes_check check (
    model_policy_hash ~ '^[0-9a-f]{64}$'
    and source_hash ~ '^[0-9a-f]{64}$'
    and source_text_hash ~ '^[0-9a-f]{64}$'
    and source_chunk_hash ~ '^[0-9a-f]{64}$'
    and raw_output_hash ~ '^[0-9a-f]{64}$'
    and provider_raw_output_hash ~ '^[0-9a-f]{64}$'
    and checkpoint_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint contract_review_fact_chunk_checkpoints_output_check check (
    btrim(raw_output) <> ''
  )
);

create index contract_review_fact_chunk_checkpoints_review
  on public.contract_review_fact_chunk_checkpoints(review_id, chunk_index);
create index contract_review_fact_chunk_checkpoints_source
  on public.contract_review_fact_chunk_checkpoints(
    contract_id, source_hash, source_text_hash, created_at desc
  );

alter table public.contract_review_fact_chunk_checkpoints enable row level security;
revoke all on table public.contract_review_fact_chunk_checkpoints
  from public, anon, authenticated, service_role;
grant select on table public.contract_review_fact_chunk_checkpoints to service_role;

create trigger trg_reject_contract_review_fact_chunk_checkpoints_mutation_v1
  before update or delete on public.contract_review_fact_chunk_checkpoints
  for each row execute function public.reject_contract_review_fact_audit_mutation_v1();

create or replace function public.checkpoint_contract_review_fact_chunk_v1(
  p_job_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_lock_token uuid,
  p_invocation_id uuid,
  p_provider text,
  p_provider_name text,
  p_model text,
  p_fallback_rank integer,
  p_attempt integer,
  p_latency_ms integer,
  p_request_id text,
  p_request_metadata jsonb,
  p_usage jsonb,
  p_response_metadata jsonb,
  p_raw_output text
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
  v_existing public.contract_review_fact_chunk_checkpoints%rowtype;
  v_checkpoint_id uuid;
  v_policy_hash text;
  v_raw_hash text;
  v_provider_raw_hash text;
  v_checkpoint_hash text;
  v_raw_json jsonb;
  v_chunk_index integer;
  v_chunk_total integer;
  v_chunk_start integer;
  v_chunk_end integer;
  v_chunk_hash text;
  v_chunk_text text;
  v_rule_count integer;
  v_input_tokens integer;
  v_output_tokens integer;
  v_total_tokens integer;
  v_keys text[];
  v_now timestamptz := pg_catalog.now();
begin
  if p_job_id is null or p_contract_id is null or p_review_id is null
     or p_lock_token is null or p_invocation_id is null then
    raise exception 'FACT_CHUNK_CHECKPOINT_IDENTITY_REQUIRED' using errcode = '23514';
  end if;
  if coalesce(btrim(p_provider), '') = ''
     or coalesce(btrim(p_model), '') = ''
     or p_fallback_rank is null or p_fallback_rank < 0
     or p_attempt is null or p_attempt < 0
     or p_latency_ms is null or p_latency_ms < 0
     or jsonb_typeof(p_request_metadata) <> 'object'
     or jsonb_typeof(p_usage) <> 'object'
     or jsonb_typeof(p_response_metadata) <> 'object'
     or coalesce(p_raw_output, '') = '' then
    raise exception 'FACT_CHUNK_CHECKPOINT_PAYLOAD_INVALID' using errcode = '23514';
  end if;
  if p_request_metadata->>'output_contract' <> 'facts_v1'
     or p_request_metadata->>'validation_valid' <> 'true'
     or coalesce(p_request_metadata->>'chunk_index', '') !~ '^[0-9]+$'
     or coalesce(p_request_metadata->>'chunk_total', '') !~ '^[0-9]+$'
     or coalesce(p_request_metadata->>'chunk_start', '') !~ '^[0-9]+$'
     or coalesce(p_request_metadata->>'chunk_end', '') !~ '^[0-9]+$'
     or coalesce(p_request_metadata->>'chunk_hash', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_request_metadata->>'config_id', '') = '' then
    raise exception 'FACT_CHUNK_CHECKPOINT_REQUEST_METADATA_INVALID' using errcode = '23514';
  end if;

  v_chunk_index := (p_request_metadata->>'chunk_index')::integer;
  v_chunk_total := (p_request_metadata->>'chunk_total')::integer;
  v_chunk_start := (p_request_metadata->>'chunk_start')::integer;
  v_chunk_end := (p_request_metadata->>'chunk_end')::integer;
  v_chunk_hash := p_request_metadata->>'chunk_hash';
  if v_chunk_index < 1 or v_chunk_total < v_chunk_index
     or v_chunk_start < 0 or v_chunk_end <= v_chunk_start then
    raise exception 'FACT_CHUNK_CHECKPOINT_RANGE_INVALID' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_job_id::text || ':facts:' || v_chunk_index::text,
    0
  ));

  select job.* into v_job
  from public.contract_analysis_jobs as job
  where job.id = p_job_id
    and job.contract_id = p_contract_id
    and job.review_id = p_review_id
  for update;
  if not found or v_job.status <> 'running'
     or v_job.lock_token is distinct from p_lock_token then
    raise exception 'FACT_CHUNK_CHECKPOINT_LEASE_INVALID' using errcode = '55000';
  end if;

  select review.* into v_review
  from public.contract_reviews as review
  where review.id = p_review_id and review.contract_id = p_contract_id
  for update;
  if not found or v_review.status <> 'ANALYZING'
     or v_review.review_trigger <> 'direct'
     or v_review.skill_bundle_id is null
     or v_review.rule_version is null
     or v_review.model_policy_id is null
     or v_review.source_storage_path is null
     or v_review.source_hash is null
     or v_review.source_text_hash is null then
    raise exception 'FACT_CHUNK_CHECKPOINT_REVIEW_INVALID' using errcode = '23514';
  end if;

  select contract.* into v_contract
  from public.contracts as contract
  where contract.id = p_contract_id
  for update;
  if not found or v_contract.org_id is null or v_contract.status <> 'ANALYZING'
     or v_contract.storage_path is distinct from v_review.source_storage_path
     or pg_catalog.encode(
       extensions.digest(
         pg_catalog.convert_to(coalesce(v_contract.parsed_text, ''), 'UTF8'),
         'sha256'
       ),
       'hex'
     ) is distinct from v_review.source_text_hash then
    raise exception 'FACT_CHUNK_CHECKPOINT_CONTRACT_SOURCE_INVALID' using errcode = '23514';
  end if;

  select page_map.* into v_page_map
  from public.contract_source_page_maps as page_map
  where page_map.contract_id = p_contract_id
    and page_map.storage_path = v_review.source_storage_path
    and page_map.source_hash = v_review.source_hash
    and page_map.source_text_hash = v_review.source_text_hash;
  if not found then
    raise exception 'FACT_CHUNK_CHECKPOINT_PAGE_MAP_INVALID' using errcode = '23514';
  end if;

  select bundle.* into v_bundle
  from public.contract_skill_bundles as bundle
  where bundle.id = v_review.skill_bundle_id
    and bundle.org_id = v_contract.org_id
    and bundle.key = 'CONTRACT_REVIEW_DEFAULT'
    and bundle.version = v_review.rule_version
    and bundle.status = 'published'
  for share;
  if not found or v_bundle.is_current
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
    raise exception 'FACT_CHUNK_CHECKPOINT_BUNDLE_INVALID' using errcode = '23514';
  end if;

  select policy.* into v_policy
  from public.model_policies as policy
  where policy.id = v_bundle.model_policy_id
    and policy.org_id = v_contract.org_id
    and policy.status = 'published'
  for share;
  if not found
     or p_request_metadata->>'frozen_model_policy_id' is distinct from v_policy.id::text
     or coalesce(p_request_metadata->>'frozen_model_policy_version', '') !~ '^[0-9]+$'
     or (p_request_metadata->>'frozen_model_policy_version')::integer <> v_policy.version
     or not exists (
       select 1
       from jsonb_array_elements(v_policy.provider_chain) as configured(entry)
       where configured.entry->>'profile' = p_provider
         and configured.entry->>'model' = p_model
         and configured.entry->>'source_config_id' = p_request_metadata->>'config_id'
         and jsonb_typeof(configured.entry->'stages') = 'array'
         and configured.entry->'stages' ? 'fact_extraction'
     ) then
    raise exception 'FACT_CHUNK_CHECKPOINT_MODEL_POLICY_INVALID' using errcode = '23514';
  end if;
  v_policy_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(to_jsonb(v_policy)::text, 'UTF8'), 'sha256'),
    'hex'
  );

  v_chunk_text := public.contract_utf16_slice(
    coalesce(v_contract.parsed_text, ''), v_chunk_start, v_chunk_end
  );
  if v_chunk_text is null
     or pg_catalog.encode(
       extensions.digest(pg_catalog.convert_to(v_chunk_text, 'UTF8'), 'sha256'), 'hex'
     ) <> v_chunk_hash then
    raise exception 'FACT_CHUNK_CHECKPOINT_SOURCE_HASH_INVALID' using errcode = '23514';
  end if;

  if coalesce(p_usage->>'totalTokens', '') !~ '^[0-9]+$'
     or (p_usage ? 'inputTokens' and coalesce(p_usage->>'inputTokens', '') !~ '^[0-9]+$')
     or (p_usage ? 'outputTokens' and coalesce(p_usage->>'outputTokens', '') !~ '^[0-9]+$') then
    raise exception 'FACT_CHUNK_CHECKPOINT_TOKEN_INVALID' using errcode = '23514';
  end if;
  v_total_tokens := (p_usage->>'totalTokens')::integer;
  v_input_tokens := case when p_usage ? 'inputTokens'
    then (p_usage->>'inputTokens')::integer else null end;
  v_output_tokens := case when p_usage ? 'outputTokens'
    then (p_usage->>'outputTokens')::integer else null end;
  if v_total_tokens <= 0
     or (v_input_tokens is not null and v_output_tokens is not null
         and v_total_tokens <> v_input_tokens + v_output_tokens) then
    raise exception 'FACT_CHUNK_CHECKPOINT_TOKEN_INVALID' using errcode = '23514';
  end if;

  v_raw_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_raw_output, 'UTF8'), 'sha256'), 'hex'
  );
  v_provider_raw_hash := p_response_metadata->>'provider_raw_output_sha256';
  if p_response_metadata->>'output_contract' <> 'facts_v1'
     or p_response_metadata->>'output_canonicalized' <> 'true'
     or p_response_metadata->>'raw_output_sha256' is distinct from v_raw_hash
     or p_response_metadata->>'staged_output_sha256' is distinct from v_raw_hash
     or p_response_metadata->>'chunk_hash' is distinct from v_chunk_hash
     or coalesce(v_provider_raw_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_response_metadata->>'facts_candidate_count', '') !~ '^[0-9]+$'
     or coalesce(p_response_metadata->>'trusted_context_normalization_count', '') !~ '^[0-9]+$'
     or jsonb_typeof(p_response_metadata->'trusted_context_normalizations') <> 'array' then
    raise exception 'FACT_CHUNK_CHECKPOINT_RESPONSE_METADATA_INVALID' using errcode = '23514';
  end if;

  begin
    v_raw_json := p_raw_output::jsonb;
  exception when others then
    raise exception 'FACT_CHUNK_CHECKPOINT_OUTPUT_JSON_INVALID' using errcode = '23514';
  end;
  select coalesce(array_agg(key order by key), '{}'::text[]) into v_keys
  from jsonb_object_keys(v_raw_json) as object_keys(key);
  if jsonb_typeof(v_raw_json) <> 'object'
     or v_keys <> array['candidates', 'coverage', 'summary']::text[]
     or jsonb_typeof(v_raw_json->'candidates') <> 'array'
     or jsonb_typeof(v_raw_json->'coverage') <> 'array'
     or jsonb_typeof(v_raw_json->'summary') <> 'string'
     or (p_response_metadata->>'facts_candidate_count')::integer
        <> jsonb_array_length(v_raw_json->'candidates') then
    raise exception 'FACT_CHUNK_CHECKPOINT_OUTPUT_CONTRACT_INVALID' using errcode = '23514';
  end if;

  select pg_catalog.count(*)::integer into v_rule_count
  from public.contract_rule_snapshots as snapshot
  where snapshot.id = any(v_bundle.rule_snapshot_ids)
    and snapshot.status = 'published'
    and snapshot.criteria_hash is not null
    and snapshot.config_snapshot->>'code' is not null;
  if v_rule_count = 0
     or v_rule_count <> cardinality(v_bundle.rule_snapshot_ids)
     or jsonb_array_length(v_raw_json->'coverage') <> v_rule_count then
    raise exception 'FACT_CHUNK_CHECKPOINT_RULE_CATALOG_INVALID' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_raw_json->'candidates') as candidate(item)
    cross join lateral (
      select coalesce(array_agg(key order by key), '{}'::text[]) as keys
      from jsonb_object_keys(candidate.item) as object_keys(key)
    ) as actual
    left join public.contract_rule_snapshots as snapshot
      on snapshot.id = any(v_bundle.rule_snapshot_ids)
     and snapshot.config_snapshot->>'code' = candidate.item->>'rule_code'
    where jsonb_typeof(candidate.item) <> 'object'
       or actual.keys <> array['facts', 'rule_code', 'source_quote']::text[]
       or snapshot.id is null
       or jsonb_typeof(candidate.item->'facts') <> 'object'
       or jsonb_typeof(candidate.item->'source_quote') <> 'string'
  ) or exists (
    select 1
    from jsonb_array_elements(v_raw_json->'candidates') as candidate(item)
    join public.contract_rule_snapshots as snapshot
      on snapshot.id = any(v_bundle.rule_snapshot_ids)
     and snapshot.config_snapshot->>'code' = candidate.item->>'rule_code'
    cross join lateral jsonb_each(
      snapshot.config_snapshot->'review_criteria'->'fact_schema'
    ) as fact(key, definition)
    where fact.definition->>'required' = 'true'
      and not (candidate.item->'facts' ? fact.key)
  ) or exists (
    select 1
    from jsonb_array_elements(v_raw_json->'candidates') as candidate(item)
    join public.contract_rule_snapshots as snapshot
      on snapshot.id = any(v_bundle.rule_snapshot_ids)
     and snapshot.config_snapshot->>'code' = candidate.item->>'rule_code'
    cross join lateral jsonb_each(
      snapshot.config_snapshot->'review_criteria'->'fact_schema'
    ) as fact(key, definition)
    where fact.definition->>'source' = 'trusted_context'
      and candidate.item->'facts' ? fact.key
      and candidate.item->'facts'->fact.key <> 'null'::jsonb
  ) then
    raise exception 'FACT_CHUNK_CHECKPOINT_CANDIDATE_INVALID' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_raw_json->'coverage') as coverage(item)
    cross join lateral (
      select coalesce(array_agg(key order by key), '{}'::text[]) as keys
      from jsonb_object_keys(coverage.item) as object_keys(key)
    ) as actual
    left join public.contract_rule_snapshots as snapshot
      on snapshot.id = any(v_bundle.rule_snapshot_ids)
     and snapshot.config_snapshot->>'code' = coverage.item->>'rule_code'
    where jsonb_typeof(coverage.item) <> 'object'
       or actual.keys <> array['rule_code', 'status']::text[]
       or snapshot.id is null
       or coverage.item->>'status' not in ('observed', 'not_observed', 'uncertain')
  ) or exists (
    select coverage.item->>'rule_code'
    from jsonb_array_elements(v_raw_json->'coverage') as coverage(item)
    group by coverage.item->>'rule_code'
    having pg_catalog.count(*) <> 1
  ) or exists (
    select 1
    from jsonb_array_elements(v_raw_json->'coverage') as coverage(item)
    where (coverage.item->>'status' = 'observed') is distinct from exists (
      select 1
      from jsonb_array_elements(v_raw_json->'candidates') as candidate(item)
      where candidate.item->>'rule_code' = coverage.item->>'rule_code'
    )
  ) then
    raise exception 'FACT_CHUNK_CHECKPOINT_COVERAGE_INVALID' using errcode = '23514';
  end if;

  v_checkpoint_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    jsonb_build_object(
      'job_id', p_job_id,
      'contract_id', p_contract_id,
      'review_id', p_review_id,
      'bundle_id', v_bundle.id,
      'bundle_version', v_bundle.version,
      'policy_id', v_policy.id,
      'policy_hash', v_policy_hash,
      'source_storage_path', v_review.source_storage_path,
      'source_hash', v_review.source_hash,
      'source_text_hash', v_review.source_text_hash,
      'chunk_index', v_chunk_index,
      'chunk_total', v_chunk_total,
      'chunk_start', v_chunk_start,
      'chunk_end', v_chunk_end,
      'chunk_hash', v_chunk_hash,
      'provider', p_provider,
      'model', p_model,
      'fallback_rank', p_fallback_rank,
      'attempt', p_attempt,
      'usage', p_usage,
      'raw_output_hash', v_raw_hash,
      'provider_raw_output_hash', v_provider_raw_hash
    )::text,
    'UTF8'
  ), 'sha256'), 'hex');

  select checkpoint.* into v_existing
  from public.contract_review_fact_chunk_checkpoints as checkpoint
  where checkpoint.analysis_job_id = p_job_id
    and checkpoint.chunk_index = v_chunk_index
  for share;
  if found then
    if v_existing.model_invocation_id = p_invocation_id
       and v_existing.checkpoint_hash = v_checkpoint_hash then
      return jsonb_build_object(
        'checkpoint_id', v_existing.id,
        'invocation_id', v_existing.model_invocation_id,
        'chunk_index', v_existing.chunk_index,
        'idempotent', true
      );
    end if;
    raise exception 'FACT_CHUNK_CHECKPOINT_CONFLICT' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.model_invocations as invocation
    where invocation.contract_id = p_contract_id
      and invocation.review_id = p_review_id
      and invocation.phase = 'fact_extraction'
      and invocation.status = 'completed'
      and invocation.request_meta->>'job_id' = p_job_id::text
      and invocation.request_meta->'metadata'->>'chunk_index' = v_chunk_index::text
  ) then
    raise exception 'FACT_CHUNK_COMPLETED_INVOCATION_WITHOUT_CHECKPOINT'
      using errcode = '55000';
  end if;

  insert into public.model_invocations (
    id, org_id, contract_id, review_id, skill_bundle_id, model_policy_id,
    provider, model, phase, status, degraded, fallback_reason, latency_ms,
    request_meta, response_meta, error_message, started_at, completed_at, created_at
  ) values (
    p_invocation_id, v_contract.org_id, p_contract_id, p_review_id,
    v_bundle.id, v_policy.id,
    p_provider, p_model, 'fact_extraction', 'completed', false, null, p_latency_ms,
    jsonb_build_object(
      'provider_key', p_provider,
      'provider_kind', 'openai_compatible',
      'provider_name', nullif(btrim(p_provider_name), ''),
      'fallback_rank', p_fallback_rank,
      'request_id', nullif(btrim(p_request_id), ''),
      'job_id', p_job_id,
      'metadata', p_request_metadata
    ),
    jsonb_build_object('usage', p_usage, 'metadata', p_response_metadata),
    null, v_now, v_now, v_now
  );

  insert into public.contract_review_fact_chunk_checkpoints (
    org_id, contract_id, review_id, analysis_job_id,
    skill_bundle_id, skill_bundle_version, model_policy_id, model_policy_hash,
    source_storage_path, source_hash, source_text_hash,
    chunk_index, chunk_total, source_start, source_end, source_chunk_hash,
    model_invocation_id, provider, model, fallback_rank, attempt,
    input_tokens, output_tokens, total_tokens,
    raw_output, raw_output_hash, provider_raw_output_hash, checkpoint_hash, created_at
  ) values (
    v_contract.org_id, p_contract_id, p_review_id, p_job_id,
    v_bundle.id, v_bundle.version, v_policy.id, v_policy_hash,
    v_review.source_storage_path, v_review.source_hash, v_review.source_text_hash,
    v_chunk_index, v_chunk_total, v_chunk_start, v_chunk_end, v_chunk_hash,
    p_invocation_id, p_provider, p_model, p_fallback_rank, p_attempt,
    v_input_tokens, v_output_tokens, v_total_tokens,
    p_raw_output, v_raw_hash, v_provider_raw_hash, v_checkpoint_hash, v_now
  ) returning id into v_checkpoint_id;

  return jsonb_build_object(
    'checkpoint_id', v_checkpoint_id,
    'invocation_id', p_invocation_id,
    'chunk_index', v_chunk_index,
    'idempotent', false
  );
end;
$function$;

revoke all on function public.checkpoint_contract_review_fact_chunk_v1(
  uuid, uuid, uuid, uuid, uuid, text, text, text, integer, integer, integer,
  text, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.checkpoint_contract_review_fact_chunk_v1(
  uuid, uuid, uuid, uuid, uuid, text, text, text, integer, integer, integer,
  text, jsonb, jsonb, jsonb, text
) to service_role;

-- A handled chunk failure gets one bounded resume. Setting attempts to two
-- consumes the retry budget before the next claim (which increments to three),
-- so a second failure or stale lease becomes terminal under the existing queue
-- ceiling instead of creating an automatic loop.
create or replace function public.requeue_contract_review_facts_once_v1(
  p_job_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_lock_token uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.contract_analysis_jobs%rowtype;
  v_checkpoint_count integer;
  v_affected integer;
begin
  select job.* into v_job
  from public.contract_analysis_jobs as job
  where job.id = p_job_id
    and job.contract_id = p_contract_id
    and job.review_id = p_review_id
  for update;
  if found
     and v_job.status = 'queued'
     and v_job.attempts = 2
     and v_job.lock_token is null
     and v_job.locked_by is null then
    return true;
  end if;
  if not found or v_job.status <> 'running'
     or v_job.lock_token is distinct from p_lock_token then
    raise exception 'FACTS_REQUEUE_LEASE_INVALID' using errcode = '55000';
  end if;
  if v_job.attempts <> 1 then
    return false;
  end if;
  if not exists (
    select 1 from public.contract_reviews as review
    where review.id = p_review_id
      and review.contract_id = p_contract_id
      and review.status = 'ANALYZING'
  ) or not exists (
    select 1 from public.contracts as contract
    where contract.id = p_contract_id and contract.status = 'ANALYZING'
  ) or exists (
    select 1 from public.contract_review_fact_runs as fact_run
    where fact_run.analysis_job_id = p_job_id or fact_run.review_id = p_review_id
  ) then
    raise exception 'FACTS_REQUEUE_STATE_INVALID' using errcode = '55000';
  end if;

  select pg_catalog.count(*)::integer into v_checkpoint_count
  from public.contract_review_fact_chunk_checkpoints as checkpoint
  where checkpoint.analysis_job_id = p_job_id
    and checkpoint.review_id = p_review_id
    and checkpoint.contract_id = p_contract_id;
  if v_checkpoint_count = 0 then
    return false;
  end if;
  if exists (
    select 1
    from public.model_invocations as invocation
    where invocation.contract_id = p_contract_id
      and invocation.review_id = p_review_id
      and invocation.phase = 'fact_extraction'
      and invocation.status = 'completed'
      and invocation.request_meta->>'job_id' = p_job_id::text
      and not exists (
        select 1
        from public.contract_review_fact_chunk_checkpoints as checkpoint
        where checkpoint.model_invocation_id = invocation.id
          and checkpoint.analysis_job_id = p_job_id
      )
  ) then
    raise exception 'FACTS_REQUEUE_AMBIGUOUS_COMPLETED_INVOCATION' using errcode = '55000';
  end if;

  update public.contract_analysis_jobs
  set status = 'queued',
      attempts = 2,
      last_error = left(coalesce(nullif(p_error, ''), 'facts chunk retry deferred'), 4000),
      locked_at = null,
      lock_token = null,
      locked_by = null,
      completed_at = null,
      updated_at = pg_catalog.now()
  where id = p_job_id
    and status = 'running'
    and attempts = 1
    and lock_token = p_lock_token;
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception 'FACTS_REQUEUE_CHANGED_CONCURRENTLY' using errcode = '40001';
  end if;
  return true;
end;
$function$;

revoke all on function public.requeue_contract_review_facts_once_v1(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.requeue_contract_review_facts_once_v1(
  uuid, uuid, uuid, uuid, text
) to service_role;

reset statement_timeout;
reset lock_timeout;
