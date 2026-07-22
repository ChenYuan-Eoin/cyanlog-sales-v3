set lock_timeout = '5s';
set statement_timeout = '60s';

-- The application already persists this projection in Preview. Keep a clean
-- migration replay reproducible and make the completion writer derive it only
-- from immutable fact chunks, never from a caller-supplied array.
alter table public.contract_reviews
  add column if not exists model_invocation_ids uuid[] not null default '{}'::uuid[];

-- One append-only receipt binds the immutable facts/document evidence to the
-- exact risk-card projection and terminal ReviewRun write. Operational rows do
-- not own the copied UUIDs: deleting an operational row must not rewrite the
-- historical receipt. The two evidence roots remain RESTRICT references.
create table public.contract_review_facts_completion_receipts (
  id uuid primary key default gen_random_uuid(),
  fact_run_id uuid not null
    references public.contract_review_fact_runs(id) on delete restrict,
  document_run_id uuid not null,
  org_id uuid not null,
  contract_id uuid not null,
  review_id uuid not null,
  analysis_job_id uuid not null,
  lease_attempt integer not null,
  lease_owner text not null,
  lease_token_hash text not null,
  model_invocation_ids uuid[] not null,
  invocation_manifest jsonb not null,
  raw_candidate_occurrence_count integer not null,
  raw_distinct_candidate_count integer not null,
  source_trace_count integer not null,
  document_outcome_count integer not null,
  source_risk_count integer not null,
  document_risk_count integer not null,
  risk_card_count integer not null,
  total_tokens integer not null,
  provider text not null,
  degraded boolean not null,
  risk_card_ids uuid[] not null,
  risk_manifest jsonb not null,
  terminal_payload jsonb not null,
  risk_manifest_hash text not null,
  terminal_payload_hash text not null,
  receipt_hash text not null,
  completed_at timestamptz not null,
  constraint contract_review_facts_completion_receipts_fact_unique unique (fact_run_id),
  constraint contract_review_facts_completion_receipts_document_unique unique (document_run_id),
  constraint contract_review_facts_completion_receipts_review_unique unique (review_id),
  constraint contract_review_facts_completion_receipts_job_unique unique (analysis_job_id),
  constraint contract_review_facts_completion_receipts_document_fact_fkey
    foreign key (document_run_id, fact_run_id)
    references public.contract_review_document_runs(id, fact_run_id)
    on delete restrict,
  constraint contract_review_facts_completion_receipts_lease_check check (
    lease_attempt > 0
    and btrim(lease_owner) <> ''
    and lease_token_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint contract_review_facts_completion_receipts_invocation_check check (
    cardinality(model_invocation_ids) > 0
    and array_position(model_invocation_ids, null) is null
    and jsonb_typeof(invocation_manifest) = 'array'
    and jsonb_array_length(invocation_manifest) = cardinality(model_invocation_ids)
  ),
  constraint contract_review_facts_completion_receipts_counts_check check (
    raw_candidate_occurrence_count >= 0
    and raw_distinct_candidate_count >= 0
    and source_trace_count >= 0
    and raw_distinct_candidate_count <= source_trace_count
    and source_trace_count <= raw_candidate_occurrence_count
    and document_outcome_count >= 0
    and source_risk_count >= 0
    and document_risk_count >= 0
    and risk_card_count = source_risk_count + document_risk_count
    and total_tokens > 0
  ),
  constraint contract_review_facts_completion_receipts_projection_check check (
    array_position(risk_card_ids, null) is null
    and cardinality(risk_card_ids) = risk_card_count
    and jsonb_typeof(risk_manifest) = 'array'
    and jsonb_array_length(risk_manifest) = risk_card_count
    and jsonb_typeof(terminal_payload) = 'object'
  ),
  constraint contract_review_facts_completion_receipts_runtime_check check (
    btrim(provider) <> '' and not degraded
  ),
  constraint contract_review_facts_completion_receipts_hashes_check check (
    risk_manifest_hash ~ '^[0-9a-f]{64}$'
    and terminal_payload_hash ~ '^[0-9a-f]{64}$'
    and receipt_hash ~ '^[0-9a-f]{64}$'
  )
);

create index idx_contract_review_facts_completion_receipts_contract
  on public.contract_review_facts_completion_receipts(contract_id, completed_at desc);

alter table public.contract_review_facts_completion_receipts enable row level security;
revoke all on table public.contract_review_facts_completion_receipts
  from public, anon, authenticated, service_role;
grant select on table public.contract_review_facts_completion_receipts to service_role;

create trigger trg_reject_contract_review_facts_completion_receipts_mutation_v1
  before update or delete on public.contract_review_facts_completion_receipts
  for each row execute function public.reject_contract_review_fact_audit_mutation_v1();

-- Once the receipt exists, the customer-visible card core is an immutable
-- projection of that receipt. Decision workflows may still move status/fix
-- fields, but may not rewrite evidence, source positions or rule identity.
create or replace function public.fence_contract_review_facts_risk_projection_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if exists (
      select 1
      from public.contract_review_facts_completion_receipts as receipt
      where receipt.review_id = new.review_id
    ) and not exists (
      select 1
      from public.contract_review_facts_completion_receipts as receipt
      where receipt.review_id = new.review_id
        and new.id = any(receipt.risk_card_ids)
    ) then
      raise exception 'FACTS_COMPLETION_EXTRA_RISK_CARD_FORBIDDEN' using errcode = '55000';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if exists (
      select 1
      from public.contract_review_facts_completion_receipts as receipt
      where receipt.review_id = old.review_id
        and old.id = any(receipt.risk_card_ids)
    ) then
      raise exception 'FACTS_COMPLETION_RISK_CORE_IMMUTABLE' using errcode = '55000';
    end if;
    return old;
  end if;

  if exists (
    select 1
    from public.contract_review_facts_completion_receipts as receipt
    where (receipt.review_id = old.review_id and old.id = any(receipt.risk_card_ids))
       or (receipt.review_id = new.review_id and new.id = any(receipt.risk_card_ids))
  ) and (
    pg_catalog.to_jsonb(new) - array['status', 'fixed_by', 'fixed_at', 'updated_at']::text[]
      is distinct from
    pg_catalog.to_jsonb(old) - array['status', 'fixed_by', 'fixed_at', 'updated_at']::text[]
  ) then
    raise exception 'FACTS_COMPLETION_RISK_CORE_IMMUTABLE' using errcode = '55000';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_fence_contract_review_facts_risk_projection_v1
  on public.contract_risk_cards;
create trigger trg_fence_contract_review_facts_risk_projection_v1
  before insert or update or delete on public.contract_risk_cards
  for each row execute function public.fence_contract_review_facts_risk_projection_v1();

revoke all on function public.fence_contract_review_facts_risk_projection_v1()
  from public, anon, authenticated, service_role;

-- Legacy completion remains available for legacy ReviewRuns. Once a facts run
-- exists, however, no writer may move one member of the terminal state triple
-- to completed until the atomic facts receipt has been inserted.
create or replace function public.fence_contract_review_facts_completion_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if tg_table_name = 'contract_reviews' and new.status = 'COMPLETED' then
    if exists (
      select 1
      from public.contract_review_fact_runs as fact_run
      where fact_run.review_id = new.id
        and not exists (
          select 1
          from public.contract_review_facts_completion_receipts as receipt
          where receipt.fact_run_id = fact_run.id
            and receipt.review_id = new.id
        )
    ) then
      raise exception 'FACTS_COMPLETION_RECEIPT_REQUIRED' using errcode = '55000';
    end if;
  elsif tg_table_name = 'contract_analysis_jobs' and new.status = 'completed' then
    if exists (
      select 1
      from public.contract_review_fact_runs as fact_run
      where fact_run.analysis_job_id = new.id
        and not exists (
          select 1
          from public.contract_review_facts_completion_receipts as receipt
          where receipt.fact_run_id = fact_run.id
            and receipt.analysis_job_id = new.id
        )
    ) then
      raise exception 'FACTS_COMPLETION_RECEIPT_REQUIRED' using errcode = '55000';
    end if;
  elsif tg_table_name = 'contracts' and new.status = 'COMPLETED' then
    if exists (
      select 1
      from public.contract_review_fact_runs as fact_run
      where fact_run.contract_id = new.id
    ) and (
      not exists (
        select 1
        from public.contract_review_facts_completion_receipts as receipt
        where receipt.contract_id = new.id
      )
      or exists (
      select 1
      from public.contract_review_fact_runs as fact_run
      join public.contract_reviews as review
        on review.id = fact_run.review_id
       and review.contract_id = fact_run.contract_id
      join public.contract_analysis_jobs as job
        on job.id = fact_run.analysis_job_id
       and job.review_id = fact_run.review_id
       and job.contract_id = fact_run.contract_id
      where fact_run.contract_id = new.id
        and (
          review.status = 'ANALYZING'
          or job.status in ('queued', 'running')
        )
        and not exists (
          select 1
          from public.contract_review_facts_completion_receipts as receipt
          where receipt.fact_run_id = fact_run.id
            and receipt.contract_id = new.id
        )
      )
    ) then
      raise exception 'FACTS_COMPLETION_RECEIPT_REQUIRED' using errcode = '55000';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_fence_contract_review_facts_review_completion_v1
  on public.contract_reviews;
create trigger trg_fence_contract_review_facts_review_completion_v1
  before update of status on public.contract_reviews
  for each row execute function public.fence_contract_review_facts_completion_v1();

drop trigger if exists trg_fence_contract_review_facts_job_completion_v1
  on public.contract_analysis_jobs;
create trigger trg_fence_contract_review_facts_job_completion_v1
  before update of status on public.contract_analysis_jobs
  for each row execute function public.fence_contract_review_facts_completion_v1();

drop trigger if exists trg_fence_contract_review_facts_contract_completion_v1
  on public.contracts;
create trigger trg_fence_contract_review_facts_contract_completion_v1
  before update of status on public.contracts
  for each row execute function public.fence_contract_review_facts_completion_v1();

revoke all on function public.fence_contract_review_facts_completion_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.fence_contract_review_facts_completion_v1()
  to service_role;

-- Terminalization accepts identities and the current worker lease only. Risk
-- rows, provider, tokens, summaries and ReviewRun fields are all re-derived
-- from the immutable facts/document evidence and frozen rule snapshots.
create or replace function public.complete_contract_review_facts_v1(
  p_job_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_lock_token uuid,
  p_fact_run_id uuid,
  p_document_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $function$
declare
  v_job public.contract_analysis_jobs%rowtype;
  v_contract public.contracts%rowtype;
  v_review public.contract_reviews%rowtype;
  v_page_map public.contract_source_page_maps%rowtype;
  v_fact_run public.contract_review_fact_runs%rowtype;
  v_document_run public.contract_review_document_runs%rowtype;
  v_bundle public.contract_skill_bundles%rowtype;
  v_policy public.model_policies%rowtype;
  v_existing_receipt public.contract_review_facts_completion_receipts%rowtype;
  v_receipt_id uuid := gen_random_uuid();
  v_rule_count integer;
  v_chunk_count integer;
  v_coverage_count integer;
  v_raw_candidate_occurrence_count integer;
  v_raw_distinct_candidate_count integer;
  v_source_trace_count integer;
  v_document_outcome_count integer;
  v_source_risk_count integer;
  v_document_risk_count integer;
  v_risk_card_count integer;
  v_red_count integer;
  v_yellow_count integer;
  v_total_tokens integer;
  v_input_tokens integer;
  v_output_tokens integer;
  v_provider_count integer;
  v_provider text;
  v_model_invocation_ids uuid[];
  v_actual_risk_card_ids uuid[];
  v_expected_risk_card_ids uuid[];
  v_invocation_manifest jsonb;
  v_risk_manifest jsonb;
  v_result_risks jsonb;
  v_results jsonb;
  v_risk_summary jsonb;
  v_compliance_check jsonb;
  v_effectiveness_analysis text;
  v_terminal_payload jsonb;
  v_missing_required_clauses jsonb;
  v_dangerous_clauses jsonb;
  v_ambiguous_clauses jsonb;
  v_issue_titles jsonb;
  v_lease_token_hash text;
  v_risk_manifest_hash text;
  v_terminal_payload_hash text;
  v_receipt_hash text;
  v_policy_hash text;
  v_affected_rows integer;
  v_now timestamptz := pg_catalog.now();
begin
  if p_job_id is null
     or p_contract_id is null
     or p_review_id is null
     or p_fact_run_id is null
     or p_document_run_id is null then
    raise exception 'FACTS_COMPLETE_IDENTITY_REQUIRED' using errcode = '23514';
  end if;

  select job.*
  into v_job
  from public.contract_analysis_jobs as job
  where job.id = p_job_id
    and job.contract_id = p_contract_id
    and job.review_id = p_review_id
  for update;
  if not found then
    raise exception 'FACTS_COMPLETE_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Response-loss retry: the cleared lease is no longer compared after a
  -- complete triple exists. The immutable receipt is the idempotency key.
  if v_job.status = 'completed' then
    select receipt.*
    into v_existing_receipt
    from public.contract_review_facts_completion_receipts as receipt
    where receipt.analysis_job_id = p_job_id
      and receipt.contract_id = p_contract_id
      and receipt.review_id = p_review_id
      and receipt.fact_run_id = p_fact_run_id
      and receipt.document_run_id = p_document_run_id;
    if not found then
      raise exception 'FACTS_COMPLETE_TERMINAL_RECEIPT_INVALID' using errcode = '23514';
    end if;

    select contract.*
    into v_contract
    from public.contracts as contract
    where contract.id = p_contract_id
      and contract.status = 'COMPLETED'
    for share;
    if not found then
      raise exception 'FACTS_COMPLETE_TERMINAL_RECEIPT_INVALID' using errcode = '23514';
    end if;

    select review.*
    into v_review
    from public.contract_reviews as review
    where review.id = p_review_id
      and review.contract_id = p_contract_id
      and review.status = 'COMPLETED'
    for share;
    if not found then
      raise exception 'FACTS_COMPLETE_TERMINAL_RECEIPT_INVALID' using errcode = '23514';
    end if;

    v_terminal_payload := jsonb_build_object(
      'status', v_review.status,
      'results', v_review.results,
      'risk_summary', v_review.risk_summary,
      'compliance_check', v_review.compliance_check,
      'effectiveness_analysis', v_review.effectiveness_analysis,
      'report_version', v_review.report_version,
      'model_invocation_ids', v_review.model_invocation_ids
    );
    v_risk_manifest_hash := pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_existing_receipt.risk_manifest::text, 'UTF8'),
      'sha256'
    ), 'hex');
    v_terminal_payload_hash := pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_terminal_payload::text, 'UTF8'),
      'sha256'
    ), 'hex');
    v_receipt_hash := pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(jsonb_build_object(
        'receipt_id', v_existing_receipt.id,
        'fact_run_id', v_existing_receipt.fact_run_id,
        'document_run_id', v_existing_receipt.document_run_id,
        'org_id', v_existing_receipt.org_id,
        'contract_id', v_existing_receipt.contract_id,
        'review_id', v_existing_receipt.review_id,
        'analysis_job_id', v_existing_receipt.analysis_job_id,
        'lease_attempt', v_existing_receipt.lease_attempt,
        'lease_owner', v_existing_receipt.lease_owner,
        'lease_token_hash', v_existing_receipt.lease_token_hash,
        'model_invocation_ids', v_existing_receipt.model_invocation_ids,
        'invocation_manifest', v_existing_receipt.invocation_manifest,
        'raw_candidate_occurrence_count', v_existing_receipt.raw_candidate_occurrence_count,
        'raw_distinct_candidate_count', v_existing_receipt.raw_distinct_candidate_count,
        'source_trace_count', v_existing_receipt.source_trace_count,
        'document_outcome_count', v_existing_receipt.document_outcome_count,
        'source_risk_count', v_existing_receipt.source_risk_count,
        'document_risk_count', v_existing_receipt.document_risk_count,
        'risk_card_ids', v_existing_receipt.risk_card_ids,
        'total_tokens', v_existing_receipt.total_tokens,
        'provider', v_existing_receipt.provider,
        'degraded', v_existing_receipt.degraded,
        'risk_manifest_hash', v_existing_receipt.risk_manifest_hash,
        'terminal_payload_hash', v_existing_receipt.terminal_payload_hash,
        'completed_at', v_existing_receipt.completed_at
      )::text, 'UTF8'),
      'sha256'
    ), 'hex');
    if v_risk_manifest_hash is distinct from v_existing_receipt.risk_manifest_hash
       or v_terminal_payload is distinct from v_existing_receipt.terminal_payload
       or v_terminal_payload_hash is distinct from v_existing_receipt.terminal_payload_hash
       or v_receipt_hash is distinct from v_existing_receipt.receipt_hash then
      raise exception 'FACTS_COMPLETE_TERMINAL_PROJECTION_CHANGED' using errcode = '55000';
    end if;

    select coalesce(array_agg(card.id order by card.id), '{}'::uuid[])
    into v_actual_risk_card_ids
    from public.contract_risk_cards as card
    where card.review_id = p_review_id;
    select coalesce(array_agg(persisted.id order by persisted.id), '{}'::uuid[])
    into v_expected_risk_card_ids
    from unnest(v_existing_receipt.risk_card_ids) as persisted(id);
    if v_actual_risk_card_ids is distinct from v_expected_risk_card_ids
       or exists (
         select 1
         from jsonb_to_recordset(v_existing_receipt.risk_manifest) as expected(
           risk_card_id uuid,
           level text,
           title text,
           description text,
           suggestion text,
           clause_ref text,
           position_start integer,
           position_end integer,
           rule_id uuid,
           rule_code text,
           rule_version integer,
           evidence jsonb
         )
         left join public.contract_risk_cards as card
           on card.id = expected.risk_card_id
          and card.review_id = p_review_id
         where card.id is null
            or card.contract_id is distinct from p_contract_id
            or card.level is distinct from expected.level
            or card.title is distinct from expected.title
            or card.description is distinct from expected.description
            or card.suggestion is distinct from expected.suggestion
            or card.auto_fixable is distinct from false
            or card.fix_action is not null
            or card.clause_ref is distinct from expected.clause_ref
            or card.position_start is distinct from expected.position_start
            or card.position_end is distinct from expected.position_end
            or card.detected_by is distinct from 'rule'
            or card.confidence is not null
            or card.created_at is distinct from v_existing_receipt.completed_at
            or card.rule_id is distinct from expected.rule_id
            or card.rule_code is distinct from expected.rule_code
            or card.rule_version is distinct from expected.rule_version
            or card.evidence is distinct from expected.evidence
       ) then
      raise exception 'FACTS_COMPLETE_RISK_PROJECTION_CHANGED' using errcode = '55000';
    end if;

    return jsonb_build_object(
      'receipt_id', v_existing_receipt.id,
      'fact_run_id', v_existing_receipt.fact_run_id,
      'document_run_id', v_existing_receipt.document_run_id,
      'risk_card_ids', v_existing_receipt.risk_card_ids,
      'model_invocation_ids', v_existing_receipt.model_invocation_ids,
      'total_tokens', v_existing_receipt.total_tokens,
      'provider', v_existing_receipt.provider,
      'degraded', v_existing_receipt.degraded,
      'review_result', v_existing_receipt.terminal_payload->'results',
      'idempotent', true,
      'review_completed', true
    );
  end if;

  if v_job.status <> 'running'
     or p_lock_token is null
     or v_job.lock_token is distinct from p_lock_token
     or coalesce(btrim(v_job.locked_by), '') = ''
     or v_job.attempts <= 0 then
    raise exception 'FACTS_COMPLETE_LEASE_INVALID' using errcode = '55000';
  end if;

  -- Every completion writer takes the global projection locks before it takes
  -- contract/review rows. The bounded runtime lock timeout fails closed rather
  -- than leaving unrelated contracts waiting behind a legacy writer.
  lock table public.contract_risk_cards, public.contract_clauses
    in share row exclusive mode;

  select contract.*
  into v_contract
  from public.contracts as contract
  where contract.id = p_contract_id
  for update;
  if not found
     or v_contract.org_id is null
     or v_contract.status <> 'ANALYZING' then
    raise exception 'FACTS_COMPLETE_CONTRACT_INVALID' using errcode = '23514';
  end if;

  select page_map.*
  into v_page_map
  from public.contract_source_page_maps as page_map
  where page_map.contract_id = p_contract_id
    and page_map.storage_path = v_contract.storage_path
  for share;
  if not found then
    raise exception 'FACTS_COMPLETE_PAGE_MAP_MISSING' using errcode = '23514';
  end if;

  select review.*
  into v_review
  from public.contract_reviews as review
  where review.id = p_review_id
    and review.contract_id = p_contract_id
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
    raise exception 'FACTS_COMPLETE_REVIEW_INVALID' using errcode = '23514';
  end if;

  select fact_run.*
  into v_fact_run
  from public.contract_review_fact_runs as fact_run
  where fact_run.id = p_fact_run_id
    and fact_run.analysis_job_id = p_job_id
    and fact_run.contract_id = p_contract_id
    and fact_run.review_id = p_review_id
    and fact_run.org_id = v_contract.org_id
    and fact_run.output_contract = 'facts_v1'
  for share;
  if not found then
    raise exception 'FACTS_COMPLETE_FACT_RUN_INVALID' using errcode = '23514';
  end if;

  select document_run.*
  into v_document_run
  from public.contract_review_document_runs as document_run
  where document_run.id = p_document_run_id
    and document_run.fact_run_id = p_fact_run_id
  for share;
  if not found then
    raise exception 'FACTS_COMPLETE_DOCUMENT_RUN_INVALID' using errcode = '23514';
  end if;

  select bundle.*
  into v_bundle
  from public.contract_skill_bundles as bundle
  where bundle.id = v_fact_run.skill_bundle_id
    and bundle.org_id = v_contract.org_id
    and bundle.key = 'CONTRACT_REVIEW_DEFAULT'
    and bundle.version = v_fact_run.skill_bundle_version
    and bundle.status = 'published'
    and not bundle.is_current
    and bundle.model_policy_id = v_fact_run.model_policy_id
    and bundle.output_schema = '{
      "contract":"contract_review_facts_v1",
      "version":1,
      "manifest_hash":"da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7"
    }'::jsonb
    and bundle.release_meta->>'stage' = 'candidate'
    and bundle.release_meta->>'release_eligible' = 'false'
    and bundle.release_meta->>'criteria_schema_version' = '1'
    and bundle.release_meta->>'adjudicator_version' = 'deterministic-adjudicator.v1'
    and exists (
      select 1
      from public.contract_skill_bundle_channels as channel
      where channel.org_id = bundle.org_id
        and channel.key = bundle.key
        and channel.channel = 'preview_candidate'
        and channel.bundle_id = bundle.id
        and channel.bundle_version = bundle.version
    )
  for share;
  if not found
     or v_review.skill_bundle_id is distinct from v_bundle.id
     or v_review.rule_version is distinct from v_bundle.version
     or v_review.model_policy_id is distinct from v_bundle.model_policy_id
     or v_review.rule_snapshot_ids is distinct from v_bundle.rule_snapshot_ids
     or v_review.rule_set_snapshot_ids is distinct from v_bundle.rule_set_snapshot_ids then
    raise exception 'FACTS_COMPLETE_CANDIDATE_BUNDLE_INVALID' using errcode = '23514';
  end if;

  select policy.*
  into v_policy
  from public.model_policies as policy
  where policy.id = v_bundle.model_policy_id
    and policy.org_id = v_contract.org_id
    and policy.key = 'CONTRACT_REVIEW_DEFAULT'
    and policy.status = 'published'
    and not policy.is_current
    and policy.routing_policy->>'policy_version'
      = 'g5.deterministic-preview-model-policy.v1'
  for share;
  if not found then
    raise exception 'FACTS_COMPLETE_MODEL_POLICY_INVALID' using errcode = '23514';
  end if;
  v_policy_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(pg_catalog.to_jsonb(v_policy)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  if v_fact_run.model_policy_hash is distinct from v_policy_hash then
    raise exception 'FACTS_COMPLETE_MODEL_POLICY_CHANGED' using errcode = '40001';
  end if;

  if v_contract.storage_path is distinct from v_fact_run.source_storage_path
     or v_review.source_storage_path is distinct from v_fact_run.source_storage_path
     or v_review.source_hash is distinct from v_fact_run.source_hash
     or v_review.source_text_hash is distinct from v_fact_run.source_text_hash
     or v_page_map.storage_path is distinct from v_fact_run.source_storage_path
     or v_page_map.source_hash is distinct from v_fact_run.source_hash
     or v_page_map.source_text_hash is distinct from v_fact_run.source_text_hash
     or pg_catalog.encode(
       extensions.digest(
         pg_catalog.convert_to(coalesce(v_contract.parsed_text, ''), 'UTF8'),
         'sha256'
       ),
       'hex'
     ) is distinct from v_fact_run.source_text_hash then
    raise exception 'FACTS_COMPLETE_SOURCE_IDENTITY_CHANGED' using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.contract_review_facts_completion_receipts as receipt
    where receipt.fact_run_id = p_fact_run_id
       or receipt.document_run_id = p_document_run_id
       or receipt.review_id = p_review_id
       or receipt.analysis_job_id = p_job_id
  ) then
    raise exception 'FACTS_COMPLETE_PARTIAL_RECEIPT_CONFLICT' using errcode = '55000';
  end if;

  -- The global locks above serialize against the legacy structured-report
  -- writer and direct service writes while this projection is checked.
  if exists (
    select 1 from public.contract_risk_cards as card where card.review_id = p_review_id
  )
     or exists (
       select 1 from public.contract_clauses as clause where clause.review_id = p_review_id
     )
     or v_review.results is not null
     or coalesce(v_review.report_version, 1) <> 1 then
    raise exception 'FACTS_COMPLETE_LEGACY_REPORT_CONFLICT' using errcode = '55000';
  end if;

  v_rule_count := coalesce(cardinality(v_bundle.rule_snapshot_ids), 0);
  if v_rule_count = 0
     or v_document_run.frozen_rule_count <> v_rule_count then
    raise exception 'FACTS_COMPLETE_RULE_CATALOG_INVALID' using errcode = '23514';
  end if;

  select
    count(*)::integer,
    coalesce(sum(chunk.total_tokens), 0)::integer,
    case when count(chunk.input_tokens) = count(*)
      then coalesce(sum(chunk.input_tokens), 0)::integer else null end,
    case when count(chunk.output_tokens) = count(*)
      then coalesce(sum(chunk.output_tokens), 0)::integer else null end,
    coalesce(array_agg(chunk.model_invocation_id order by chunk.chunk_index), '{}'::uuid[]),
    coalesce(jsonb_agg(jsonb_build_object(
      'fact_chunk_id', chunk.id,
      'model_invocation_id', chunk.model_invocation_id,
      'chunk_index', chunk.chunk_index,
      'chunk_total', chunk.chunk_total,
      'provider', chunk.provider,
      'model', chunk.model,
      'input_tokens', chunk.input_tokens,
      'output_tokens', chunk.output_tokens,
      'total_tokens', chunk.total_tokens,
      'raw_output_hash', chunk.raw_output_hash,
      'source_chunk_hash', chunk.source_chunk_hash
    ) order by chunk.chunk_index), '[]'::jsonb)
  into
    v_chunk_count,
    v_total_tokens,
    v_input_tokens,
    v_output_tokens,
    v_model_invocation_ids,
    v_invocation_manifest
  from public.contract_review_fact_chunks as chunk
  where chunk.run_id = p_fact_run_id;

  select count(*)::integer,
         case when count(*) = 1
           then min(provider)
           else 'multi:' || string_agg(provider, ',' order by provider)
         end
  into v_provider_count, v_provider
  from (
    select distinct chunk.provider
    from public.contract_review_fact_chunks as chunk
    where chunk.run_id = p_fact_run_id
  ) as providers;

  select count(*)::integer
  into v_coverage_count
  from public.contract_review_rule_coverages as coverage
  where coverage.run_id = p_fact_run_id;

  select coalesce(sum(
    jsonb_array_length((chunk.raw_output::jsonb)->'candidates')
  ), 0)::integer
  into v_raw_candidate_occurrence_count
  from public.contract_review_fact_chunks as chunk
  where chunk.run_id = p_fact_run_id;

  select count(*)::integer
  into v_raw_distinct_candidate_count
  from (
    select distinct
      candidate.item->>'rule_code' as rule_code,
      regexp_replace(btrim(candidate.item->>'source_quote'), '[[:space:]]+', ' ', 'g')
        as normalized_source_quote,
      candidate.item->'facts' as facts
    from public.contract_review_fact_chunks as chunk
    cross join lateral jsonb_array_elements(
      (chunk.raw_output::jsonb)->'candidates'
    ) as candidate(item)
    where chunk.run_id = p_fact_run_id
  ) as distinct_candidate;

  select count(*)::integer
  into v_source_trace_count
  from public.contract_review_adjudications as adjudication
  where adjudication.fact_run_id = p_fact_run_id;

  select count(*)::integer,
         count(*) filter (where outcome.materialize)::integer
  into v_document_outcome_count, v_document_risk_count
  from public.contract_review_document_adjudications as outcome
  where outcome.document_run_id = p_document_run_id
    and outcome.fact_run_id = p_fact_run_id;

  select count(*) filter (where adjudication.materialize)::integer
  into v_source_risk_count
  from public.contract_review_adjudications as adjudication
  where adjudication.fact_run_id = p_fact_run_id;

  if v_chunk_count <> v_fact_run.chunk_total
     or v_chunk_count <= 0
     or cardinality(v_model_invocation_ids) <> v_chunk_count
     or v_total_tokens <= 0
     or v_provider_count <= 0
     or coalesce(btrim(v_provider), '') = ''
     or v_coverage_count <> v_rule_count * v_chunk_count
     or v_document_outcome_count <> v_document_run.outcome_count
     or v_raw_distinct_candidate_count > v_source_trace_count
     or v_source_trace_count > v_raw_candidate_occurrence_count then
    raise exception 'FACTS_COMPLETE_EVIDENCE_COUNTS_INVALID' using errcode = '23514';
  end if;

  -- The raw contract has no source offsets. Compare the complete distinct
  -- (rule, normalized quote, facts) sets in both directions so intentional
  -- overlap duplicates may collapse, while an omitted distinct candidate may
  -- never reach terminal state.
  if exists (
    with raw_candidates as (
      select distinct
        candidate.item->>'rule_code' as rule_code,
        regexp_replace(btrim(candidate.item->>'source_quote'), '[[:space:]]+', ' ', 'g')
          as normalized_source_quote,
        candidate.item->'facts' as facts
      from public.contract_review_fact_chunks as chunk
      cross join lateral jsonb_array_elements(
        (chunk.raw_output::jsonb)->'candidates'
      ) as candidate(item)
      where chunk.run_id = p_fact_run_id
    ),
    trace_candidates as (
      select distinct
        adjudication.rule_code,
        regexp_replace(btrim(adjudication.source_exact_text), '[[:space:]]+', ' ', 'g')
          as normalized_source_quote,
        adjudication.raw_facts as facts
      from public.contract_review_adjudications as adjudication
      where adjudication.fact_run_id = p_fact_run_id
    )
    select 1
    from (
      (
        select raw.rule_code, raw.normalized_source_quote, raw.facts
        from raw_candidates as raw
        except
        select trace.rule_code, trace.normalized_source_quote, trace.facts
        from trace_candidates as trace
      )
      union all
      (
        select trace.rule_code, trace.normalized_source_quote, trace.facts
        from trace_candidates as trace
        except
        select raw.rule_code, raw.normalized_source_quote, raw.facts
        from raw_candidates as raw
      )
    ) as difference
  ) then
    raise exception 'FACTS_COMPLETE_DISTINCT_CANDIDATE_TRACE_MISMATCH' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.contract_review_rule_coverages as coverage
    where coverage.run_id = p_fact_run_id
    group by coverage.rule_snapshot_id
    having bool_or(coverage.status = 'observed') is distinct from exists (
      select 1
      from public.contract_review_adjudications as adjudication
      where adjudication.fact_run_id = p_fact_run_id
        and adjudication.rule_snapshot_id = coverage.rule_snapshot_id
    )
  ) then
    raise exception 'FACTS_COMPLETE_SOURCE_TRACE_MATRIX_INVALID' using errcode = '23514';
  end if;

  with source_risks as (
    select
      1 as scope_order,
      adjudication.id as evidence_id,
      jsonb_build_object(
        'risk_card_id', gen_random_uuid(),
        'evidence_scope', 'source_span',
        'evidence_id', adjudication.id,
        'level', adjudication.severity,
        'title', nullif(btrim(snapshot.config_snapshot->'message_template'->>'risk_title'), ''),
        'description', case adjudication.matched_level
          when 'B' then nullif(btrim(snapshot.config_snapshot->'message_template'->>'level_b_description'), '')
          when 'C' then nullif(btrim(snapshot.config_snapshot->'message_template'->>'level_c_description'), '')
          else nullif(btrim(snapshot.config_snapshot->'message_template'->>'unknown_description'), '')
        end,
        'suggestion', nullif(btrim(snapshot.config_snapshot->'message_template'->>'comment_template'), ''),
        'clause_ref', null,
        'position_start', adjudication.source_start,
        'position_end', adjudication.source_end,
        'rule_id', snapshot.rule_id,
        'rule_code', adjudication.rule_code,
        'rule_version', snapshot.version,
        'evidence', jsonb_build_object(
          'receipt_id', v_receipt_id,
          'fact_run_id', p_fact_run_id,
          'fact_chunk_id', adjudication.fact_chunk_id,
          'adjudication_id', adjudication.id,
          'analysis_job_id', p_job_id,
          'model_invocation_id', adjudication.model_invocation_id,
          'skill_bundle_id', v_bundle.id,
          'skill_bundle_version', v_bundle.version,
          'model_policy_id', v_bundle.model_policy_id,
          'rule_snapshot_id', adjudication.rule_snapshot_id,
          'criteria_hash', adjudication.criteria_hash,
          'binding_status', 'frozen_rule_snapshot',
          'decision', adjudication.decision,
          'severity', adjudication.severity,
          'reason_code', adjudication.reason_code,
          'matched_level', adjudication.matched_level,
          'matched_levels', adjudication.matched_levels,
          'level_results', adjudication.level_results,
          'raw_facts', adjudication.raw_facts,
          'normalized_facts', adjudication.normalized_facts,
          'adjudicator_version', adjudication.adjudicator_version,
          'source_anchor_status', 'exact_frozen_chunk',
          'source_anchor_match_field', 'source_quote',
          'source_storage_path', adjudication.source_storage_path,
          'source_hash', adjudication.source_hash,
          'source_text_hash', adjudication.source_text_hash,
          'source_start', adjudication.source_start,
          'source_end', adjudication.source_end,
          'source_exact_text', adjudication.source_exact_text,
          'source_quote_hash', adjudication.source_quote_hash,
          'source_chunk_index', adjudication.source_chunk_index,
          'source_chunk_total', adjudication.source_chunk_total,
          'source_chunk_start', adjudication.source_chunk_start,
          'source_chunk_end', adjudication.source_chunk_end,
          'source_chunk_hash', adjudication.source_chunk_hash,
          'customer_output_eligible', true
        )
      ) as risk
    from public.contract_review_adjudications as adjudication
    join public.contract_rule_snapshots as snapshot
      on snapshot.id = adjudication.rule_snapshot_id
     and snapshot.id = any(v_bundle.rule_snapshot_ids)
     and snapshot.status = 'published'
     and snapshot.criteria_hash = adjudication.criteria_hash
    where adjudication.fact_run_id = p_fact_run_id
      and adjudication.materialize
      and adjudication.decision = 'materialize'
  ),
  document_risks as (
    select
      2 as scope_order,
      outcome.id as evidence_id,
      jsonb_build_object(
        'risk_card_id', gen_random_uuid(),
        'evidence_scope', 'document_coverage',
        'evidence_id', outcome.id,
        'level', outcome.severity,
        'title', nullif(btrim(snapshot.config_snapshot->'message_template'->>'risk_title'), ''),
        'description', case outcome.evidence_basis
          when 'uncertain_coverage'
            then nullif(btrim(snapshot.config_snapshot->'message_template'->>'unknown_description'), '')
          else nullif(btrim(snapshot.config_snapshot->'message_template'->>'absence_description'), '')
        end,
        'suggestion', nullif(btrim(snapshot.config_snapshot->'message_template'->>'comment_template'), ''),
        'clause_ref', null,
        'position_start', null,
        'position_end', null,
        'rule_id', snapshot.rule_id,
        'rule_code', outcome.rule_code,
        'rule_version', snapshot.version,
        'evidence', jsonb_build_object(
          'receipt_id', v_receipt_id,
          'fact_run_id', p_fact_run_id,
          'document_run_id', p_document_run_id,
          'document_adjudication_id', outcome.id,
          'analysis_job_id', p_job_id,
          'model_invocation_ids', v_model_invocation_ids,
          'skill_bundle_id', v_bundle.id,
          'skill_bundle_version', v_bundle.version,
          'model_policy_id', v_bundle.model_policy_id,
          'rule_snapshot_id', outcome.rule_snapshot_id,
          'criteria_hash', outcome.criteria_hash,
          'binding_status', 'frozen_rule_snapshot',
          'configured_absence_decision', outcome.configured_absence_decision,
          'evidence_basis', outcome.evidence_basis,
          'decision', outcome.decision,
          'severity', outcome.severity,
          'reason_code', outcome.reason_code,
          'coverage_chunk_count', outcome.coverage_chunk_count,
          'observed_chunk_count', outcome.observed_chunk_count,
          'uncertain_chunk_count', outcome.uncertain_chunk_count,
          'not_observed_chunk_count', outcome.not_observed_chunk_count,
          'source_anchor_status', 'unresolved',
          'source_storage_path', v_fact_run.source_storage_path,
          'source_hash', v_fact_run.source_hash,
          'source_text_hash', v_fact_run.source_text_hash,
          'customer_output_eligible', false
        )
      ) as risk
    from public.contract_review_document_adjudications as outcome
    join public.contract_rule_snapshots as snapshot
      on snapshot.id = outcome.rule_snapshot_id
     and snapshot.id = any(v_bundle.rule_snapshot_ids)
     and snapshot.status = 'published'
     and snapshot.criteria_hash = outcome.criteria_hash
    where outcome.document_run_id = p_document_run_id
      and outcome.fact_run_id = p_fact_run_id
      and outcome.materialize
      and outcome.decision = 'materialize'
  )
  select coalesce(jsonb_agg(risk order by scope_order, evidence_id), '[]'::jsonb)
  into v_risk_manifest
  from (
    select * from source_risks
    union all
    select * from document_risks
  ) as materialized;

  v_risk_card_count := jsonb_array_length(v_risk_manifest);
  if v_risk_card_count <> v_source_risk_count + v_document_risk_count
     or exists (
       select 1
       from jsonb_to_recordset(v_risk_manifest) as risk(
         risk_card_id uuid,
         evidence_scope text,
         level text,
         title text,
         description text,
         suggestion text,
         rule_id uuid,
         rule_code text,
         rule_version integer,
         evidence jsonb
       )
       where risk.risk_card_id is null
          or risk.evidence_scope not in ('source_span', 'document_coverage')
          or risk.level not in ('red', 'yellow')
          or coalesce(btrim(risk.title), '') = ''
          or coalesce(btrim(risk.description), '') = ''
          or coalesce(btrim(risk.suggestion), '') = ''
          or risk.rule_id is null
          or coalesce(btrim(risk.rule_code), '') = ''
          or risk.rule_version is null
          or jsonb_typeof(risk.evidence) <> 'object'
     ) then
    raise exception 'FACTS_COMPLETE_RISK_TEMPLATE_INVALID' using errcode = '23514';
  end if;

  select coalesce(array_agg((item.value->>'risk_card_id')::uuid order by item.ordinality), '{}'::uuid[])
  into v_expected_risk_card_ids
  from jsonb_array_elements(v_risk_manifest) with ordinality as item(value, ordinality);

  select count(*) filter (where item.value->>'level' = 'red')::integer,
         count(*) filter (where item.value->>'level' = 'yellow')::integer
  into v_red_count, v_yellow_count
  from jsonb_array_elements(v_risk_manifest) as item(value);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'level', risk.value->>'level',
      'title', risk.value->>'title',
      'description', risk.value->>'description',
      'suggestion', risk.value->>'suggestion',
      'source_quote', risk.value->'evidence'->>'source_exact_text',
      'candidate_source_quote', risk.value->'evidence'->>'source_exact_text',
      'source_quote_normalization', case
        when risk.value->>'evidence_scope' = 'source_span' then 'exact' else null
      end,
      'rule_code', risk.value->>'rule_code',
      'rule_snapshot_id', risk.value->'evidence'->>'rule_snapshot_id',
      'source_start', (risk.value->>'position_start')::integer,
      'source_end', (risk.value->>'position_end')::integer,
      'source_chunk', case
        when risk.value->>'evidence_scope' = 'source_span' then jsonb_build_object(
          'index', (risk.value->'evidence'->>'source_chunk_index')::integer,
          'total', (risk.value->'evidence'->>'source_chunk_total')::integer,
          'start', (risk.value->'evidence'->>'source_chunk_start')::integer,
          'end', (risk.value->'evidence'->>'source_chunk_end')::integer,
          'hash', risk.value->'evidence'->>'source_chunk_hash'
        ) else null
      end,
      'evidence_scope', risk.value->>'evidence_scope',
      'customer_output_eligible',
        (risk.value->'evidence'->>'customer_output_eligible')::boolean
    ) order by risk.ordinality
  ), '[]'::jsonb)
  into v_result_risks
  from jsonb_array_elements(v_risk_manifest) with ordinality as risk(value, ordinality);

  select coalesce(jsonb_agg(item.value->>'title' order by item.value->>'rule_code'), '[]'::jsonb)
  into v_missing_required_clauses
  from jsonb_array_elements(v_risk_manifest) as item(value)
  where item.value->>'evidence_scope' = 'document_coverage'
    and item.value->'evidence'->>'evidence_basis' = 'complete_not_observed_coverage';

  select coalesce(jsonb_agg(item.value->>'title' order by item.value->>'rule_code'), '[]'::jsonb)
  into v_dangerous_clauses
  from jsonb_array_elements(v_risk_manifest) as item(value)
  where item.value->>'evidence_scope' = 'source_span'
    and item.value->>'level' = 'red';

  select coalesce(jsonb_agg(item.value->>'title' order by item.value->>'rule_code'), '[]'::jsonb)
  into v_ambiguous_clauses
  from jsonb_array_elements(v_risk_manifest) as item(value)
  where (
    item.value->>'evidence_scope' = 'document_coverage'
    and item.value->'evidence'->>'evidence_basis' = 'uncertain_coverage'
  ) or item.value->'evidence'->>'reason_code' = 'default_unknown_yellow';

  select coalesce(jsonb_agg(item.value->>'title' order by item.ordinality), '[]'::jsonb)
  into v_issue_titles
  from jsonb_array_elements(v_risk_manifest) with ordinality as item(value, ordinality);

  v_results := jsonb_build_object(
    'risks', v_result_risks,
    'summary', pg_catalog.format(
      '确定性事实审核完成：红色风险 %s 项，黄色待复核 %s 项。',
      v_red_count,
      v_yellow_count
    ),
    'appliedRules', v_rule_count,
    'matchedRules', v_risk_card_count,
    'provider', v_provider,
    'degraded', false,
    'usage', jsonb_strip_nulls(jsonb_build_object(
      'inputTokens', v_input_tokens,
      'outputTokens', v_output_tokens,
      'totalTokens', v_total_tokens
    )),
    'evidence_contract', 'facts_v1',
    'fact_run_id', p_fact_run_id,
    'document_run_id', p_document_run_id,
    'completion_receipt_id', v_receipt_id
  );
  v_risk_summary := jsonb_build_object(
    'total_clauses', 0,
    'critical_risks', v_red_count,
    'high_risks', v_yellow_count,
    'medium_risks', 0,
    'low_risks', 0,
    'compliance_score', greatest(0, 100 - v_red_count * 25 - v_yellow_count * 10),
    'evaluated_rule_count', v_rule_count,
    'source_risk_count', v_source_risk_count,
    'document_risk_count', v_document_risk_count,
    'evidence_contract', 'facts_v1'
  );
  v_compliance_check := jsonb_build_object(
    'missing_required_clauses', v_missing_required_clauses,
    'dangerous_clauses', v_dangerous_clauses,
    'ambiguous_clauses', v_ambiguous_clauses,
    'unbalanced_clauses', '[]'::jsonb,
    'party_a_consistency', 'unknown',
    'party_b_consistency', 'unknown',
    'issues', v_issue_titles
  );
  v_effectiveness_analysis := pg_catalog.format(
    'facts_v1 已按 %s 条冻结规则完成确定性裁决；形成 %s 条原文风险与 %s 条文档级风险。',
    v_rule_count,
    v_source_risk_count,
    v_document_risk_count
  );
  v_terminal_payload := jsonb_build_object(
    'status', 'COMPLETED',
    'results', v_results,
    'risk_summary', v_risk_summary,
    'compliance_check', v_compliance_check,
    'effectiveness_analysis', v_effectiveness_analysis,
    'report_version', 3,
    'model_invocation_ids', v_model_invocation_ids
  );

  v_lease_token_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(p_lock_token::text, 'UTF8'), 'sha256'
  ), 'hex');
  v_risk_manifest_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_risk_manifest::text, 'UTF8'), 'sha256'
  ), 'hex');
  v_terminal_payload_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_terminal_payload::text, 'UTF8'), 'sha256'
  ), 'hex');
  v_receipt_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(jsonb_build_object(
      'receipt_id', v_receipt_id,
      'fact_run_id', p_fact_run_id,
      'document_run_id', p_document_run_id,
      'org_id', v_contract.org_id,
      'contract_id', p_contract_id,
      'review_id', p_review_id,
      'analysis_job_id', p_job_id,
      'lease_attempt', v_job.attempts,
      'lease_owner', v_job.locked_by,
      'lease_token_hash', v_lease_token_hash,
      'model_invocation_ids', v_model_invocation_ids,
      'invocation_manifest', v_invocation_manifest,
      'raw_candidate_occurrence_count', v_raw_candidate_occurrence_count,
      'raw_distinct_candidate_count', v_raw_distinct_candidate_count,
      'source_trace_count', v_source_trace_count,
      'document_outcome_count', v_document_outcome_count,
      'source_risk_count', v_source_risk_count,
      'document_risk_count', v_document_risk_count,
      'risk_card_ids', v_expected_risk_card_ids,
      'total_tokens', v_total_tokens,
      'provider', v_provider,
      'degraded', false,
      'risk_manifest_hash', v_risk_manifest_hash,
      'terminal_payload_hash', v_terminal_payload_hash,
      'completed_at', v_now
    )::text, 'UTF8'),
    'sha256'
  ), 'hex');

  insert into public.contract_review_facts_completion_receipts (
    id,
    fact_run_id,
    document_run_id,
    org_id,
    contract_id,
    review_id,
    analysis_job_id,
    lease_attempt,
    lease_owner,
    lease_token_hash,
    model_invocation_ids,
    invocation_manifest,
    raw_candidate_occurrence_count,
    raw_distinct_candidate_count,
    source_trace_count,
    document_outcome_count,
    source_risk_count,
    document_risk_count,
    risk_card_count,
    total_tokens,
    provider,
    degraded,
    risk_card_ids,
    risk_manifest,
    terminal_payload,
    risk_manifest_hash,
    terminal_payload_hash,
    receipt_hash,
    completed_at
  ) values (
    v_receipt_id,
    p_fact_run_id,
    p_document_run_id,
    v_contract.org_id,
    p_contract_id,
    p_review_id,
    p_job_id,
    v_job.attempts,
    v_job.locked_by,
    v_lease_token_hash,
    v_model_invocation_ids,
    v_invocation_manifest,
    v_raw_candidate_occurrence_count,
    v_raw_distinct_candidate_count,
    v_source_trace_count,
    v_document_outcome_count,
    v_source_risk_count,
    v_document_risk_count,
    v_risk_card_count,
    v_total_tokens,
    v_provider,
    false,
    v_expected_risk_card_ids,
    v_risk_manifest,
    v_terminal_payload,
    v_risk_manifest_hash,
    v_terminal_payload_hash,
    v_receipt_hash,
    v_now
  );

  insert into public.contract_risk_cards (
    id,
    contract_id,
    review_id,
    level,
    title,
    description,
    suggestion,
    auto_fixable,
    fix_action,
    clause_ref,
    position_start,
    position_end,
    detected_by,
    confidence,
    status,
    fixed_by,
    fixed_at,
    created_at,
    updated_at,
    rule_id,
    rule_code,
    rule_version,
    evidence
  )
  select
    risk.risk_card_id,
    p_contract_id,
    p_review_id,
    risk.level,
    risk.title,
    risk.description,
    risk.suggestion,
    false,
    null,
    risk.clause_ref,
    risk.position_start,
    risk.position_end,
    'rule',
    null,
    'open',
    null,
    null,
    v_now,
    v_now,
    risk.rule_id,
    risk.rule_code,
    risk.rule_version,
    risk.evidence
  from jsonb_to_recordset(v_risk_manifest) as risk(
    risk_card_id uuid,
    level text,
    title text,
    description text,
    suggestion text,
    clause_ref text,
    position_start integer,
    position_end integer,
    rule_id uuid,
    rule_code text,
    rule_version integer,
    evidence jsonb
  );
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> v_risk_card_count then
    raise exception 'FACTS_COMPLETE_RISK_PROJECTION_INCOMPLETE' using errcode = '23514';
  end if;

  update public.contracts
  set status = 'COMPLETED',
      updated_at = v_now
  where id = p_contract_id
    and status = 'ANALYZING';
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception 'FACTS_COMPLETE_CONTRACT_STATE_CHANGED' using errcode = '40001';
  end if;

  update public.contract_reviews
  set status = 'COMPLETED',
      results = v_results,
      risk_summary = v_risk_summary,
      compliance_check = v_compliance_check,
      effectiveness_analysis = v_effectiveness_analysis,
      report_version = 3,
      model_invocation_ids = v_model_invocation_ids,
      completed_at = v_now,
      updated_at = v_now
  where id = p_review_id
    and contract_id = p_contract_id
    and status = 'ANALYZING';
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception 'FACTS_COMPLETE_REVIEW_STATE_CHANGED' using errcode = '40001';
  end if;

  update public.contract_analysis_jobs
  set status = 'completed',
      provider = v_provider,
      degraded = false,
      last_error = null,
      completed_at = v_now,
      locked_at = null,
      lock_token = null,
      locked_by = null,
      updated_at = v_now
  where id = p_job_id
    and contract_id = p_contract_id
    and review_id = p_review_id
    and status = 'running'
    and lock_token = p_lock_token;
  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception 'FACTS_COMPLETE_JOB_LEASE_CHANGED' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'receipt_id', v_receipt_id,
    'fact_run_id', p_fact_run_id,
    'document_run_id', p_document_run_id,
    'risk_card_ids', v_expected_risk_card_ids,
    'model_invocation_ids', v_model_invocation_ids,
    'total_tokens', v_total_tokens,
    'provider', v_provider,
    'degraded', false,
    'review_result', v_results,
    'idempotent', false,
    'review_completed', true
  );
end;
$function$;

revoke all on function public.complete_contract_review_facts_v1(
  uuid, uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.complete_contract_review_facts_v1(
  uuid, uuid, uuid, uuid, uuid, uuid
) to service_role;

reset statement_timeout;
reset lock_timeout;
