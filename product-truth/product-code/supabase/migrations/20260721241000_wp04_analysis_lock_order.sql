-- WP04 forward repair: every analysis write path acquires the aggregate in
-- one order.  An unlocked identity lookup is allowed, but all identities are
-- revalidated after contract -> version -> review -> job has been locked.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Refuse to create accidental overloads if the tracked lineage has drifted.
do $signature_guard$
declare
  required_signature text;
  required_signatures constant text[] := array[
    'public.start_initial_contract_review(uuid,uuid,uuid,uuid,text,uuid)',
    'public.start_initial_contract_review_fenced(uuid,uuid,uuid,uuid,text,uuid,uuid,text)',
    'public.mark_contract_analysis_job_running(uuid,uuid,text)',
    'public.mark_contract_analysis_job_completed(uuid,uuid,text,boolean,jsonb)',
    'public.mark_contract_analysis_job_failed(uuid,uuid,text)',
    'public.publish_contract_analysis_artifacts_fenced(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,boolean,jsonb)'
  ];
  start_definition text;
  contract_lock integer;
  version_lock integer;
  review_lock integer;
  job_lock integer;
begin
  foreach required_signature in array required_signatures
  loop
    if pg_catalog.to_regprocedure(required_signature) is null then
      raise exception 'required WP04 routine signature is missing: %', required_signature
        using errcode = '42704';
    end if;
  end loop;

  start_definition := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.start_initial_contract_review(uuid,uuid,uuid,uuid,text,uuid)'
    )
  );
  contract_lock := pg_catalog.strpos(
    start_definition, 'from public.contracts as contract'
  );
  version_lock := pg_catalog.strpos(
    start_definition, 'from public.contract_versions as version'
  );
  review_lock := pg_catalog.strpos(
    start_definition, 'from public.contract_reviews as review'
  );
  job_lock := pg_catalog.strpos(
    start_definition, 'from public.contract_analysis_jobs as job'
  );

  if contract_lock = 0 or version_lock = 0 or review_lock = 0 or job_lock = 0
     or not (contract_lock < version_lock and version_lock < review_lock and review_lock < job_lock) then
    raise exception 'start_initial_contract_review no longer follows contract-version-review-job order'
      using errcode = '55000';
  end if;
end
$signature_guard$;

-- Internal-only lock coordinator.  The first SELECT is intentionally unlocked:
-- it discovers the aggregate identity without holding a row that can oppose
-- start_initial_contract_review.  The second phase locks and then rechecks the
-- lease and every relationship before returning to a writer.
create or replace function private.wp04_lock_analysis_chain(
  p_job_id uuid,
  p_lock_token uuid,
  p_expected_contract_id uuid,
  p_expected_review_id uuid,
  p_require_page_map boolean
)
returns table(
  locked_contract_id uuid,
  locked_contract_version_id uuid,
  locked_review_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  chain_contract_id uuid;
  chain_contract_version_id uuid;
  chain_review_id uuid;
  current_contract public.contracts%rowtype;
  current_version public.contract_versions%rowtype;
  current_page_map public.contract_source_page_maps%rowtype;
  current_review public.contract_reviews%rowtype;
  leased_job public.contract_analysis_jobs%rowtype;
  contract_locked boolean;
  version_locked boolean;
  page_map_locked boolean := true;
  review_locked boolean;
  job_locked boolean;
begin
  if p_job_id is null or p_lock_token is null or p_require_page_map is null then
    raise exception 'complete analysis lock identity is required'
      using errcode = '23514';
  end if;

  -- Discovery only: do not retain a job/review row lock while waiting for the
  -- contract head.  Every value read here is checked again below.
  select job.contract_id,
         review.contract_version_id,
         job.review_id
    into chain_contract_id,
         chain_contract_version_id,
         chain_review_id
    from public.contract_analysis_jobs as job
    join public.contract_reviews as review
      on review.id = job.review_id
     and review.contract_id = job.contract_id
   where job.id = p_job_id
     and job.status = 'running'
     and job.lock_token = p_lock_token
     and (p_expected_contract_id is null or job.contract_id = p_expected_contract_id)
     and (p_expected_review_id is null or job.review_id = p_expected_review_id);
  if not found then
    return;
  end if;
  if chain_contract_version_id is null then
    raise exception 'active analysis lease is not bound to a source version'
      using errcode = '23514';
  end if;

  -- LOCK ORDER 1/4: contract aggregate head.
  select contract.*
    into current_contract
    from public.contracts as contract
   where contract.id = chain_contract_id
   for update;
  contract_locked := found;

  -- LOCK ORDER 2/4: immutable source version.
  select version.*
    into current_version
    from public.contract_versions as version
   where version.id = chain_contract_version_id
     and version.contract_id = chain_contract_id
   for share;
  version_locked := found;

  -- Page-map truth belongs to the version.  When publication needs it, acquire
  -- its read lock before the review/job write-owned rows.
  if p_require_page_map then
    select page_map.*
      into current_page_map
      from public.contract_source_page_maps as page_map
     where page_map.contract_id = chain_contract_id
       and page_map.contract_version_id = chain_contract_version_id
     for share;
    page_map_locked := found;
  end if;

  -- LOCK ORDER 3/4: ReviewRun.
  select review.*
    into current_review
    from public.contract_reviews as review
   where review.id = chain_review_id
     and review.contract_id = chain_contract_id
     and review.contract_version_id = chain_contract_version_id
   for update;
  review_locked := found;

  -- LOCK ORDER 4/4: worker lease.  No code above holds this row while waiting
  -- for the contract, which removes the old job -> contract inversion.
  select job.*
    into leased_job
    from public.contract_analysis_jobs as job
   where job.id = p_job_id
   for update;
  job_locked := found;

  -- A lost lease remains an idempotent no-op, matching the existing fenced RPC
  -- contract.  Structural drift under a still-valid lease fails closed.
  if not job_locked
     or leased_job.status <> 'running'
     or leased_job.lock_token is distinct from p_lock_token then
    return;
  end if;

  if not contract_locked
     or not version_locked
     or not review_locked
     or not page_map_locked
     or leased_job.contract_id is distinct from chain_contract_id
     or leased_job.review_id is distinct from chain_review_id
     or current_contract.current_version_id is distinct from chain_contract_version_id
     or current_review.contract_id is distinct from chain_contract_id
     or current_review.contract_version_id is distinct from chain_contract_version_id
     or (p_expected_contract_id is not null
         and chain_contract_id is distinct from p_expected_contract_id)
     or (p_expected_review_id is not null
         and chain_review_id is distinct from p_expected_review_id) then
    raise exception 'analysis aggregate identity changed outside the active lease'
      using errcode = '23514';
  end if;

  return query
  select chain_contract_id, chain_contract_version_id, chain_review_id;
end
$function$;

revoke all on function private.wp04_lock_analysis_chain(
  uuid, uuid, uuid, uuid, boolean
) from public, anon, authenticated, service_role;

-- The public upload entry previously locked contract and version through one
-- joined SELECT, whose physical row-lock order is planner-dependent.  Acquire
-- them explicitly before delegating to the already-canonical base routine.
create or replace function public.start_initial_contract_review_fenced(
  p_org_id uuid,
  p_contract_id uuid,
  p_contract_version_id uuid,
  p_requested_by uuid,
  p_expected_contract_status text,
  p_strategy_id uuid,
  p_expected_upload_id uuid,
  p_expected_file_sha256 text
)
returns table(
  review_id uuid,
  job_id uuid,
  review_status text,
  job_status text,
  should_process boolean,
  recovered boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_contract public.contracts%rowtype;
  current_version public.contract_versions%rowtype;
begin
  if p_org_id is null or p_contract_id is null or p_contract_version_id is null or p_requested_by is null then
    raise exception 'complete initial review identity is required' using errcode = '23514';
  end if;
  if p_expected_file_sha256 is not null
     and p_expected_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'expected file hash is invalid' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_contract_version_id::text, 0)
  );

  -- LOCK ORDER 1/4: contract aggregate head.
  select contract.*
    into current_contract
    from public.contracts as contract
   where contract.id = p_contract_id
     and contract.org_id = p_org_id
   for update;
  if not found then
    raise exception 'review source version is not current' using errcode = '23514';
  end if;

  -- LOCK ORDER 2/4: source version.  The base routine continues with
  -- ReviewRun -> job in this same transaction.
  select version.*
    into current_version
    from public.contract_versions as version
   where version.id = p_contract_version_id
     and version.contract_id = p_contract_id
   for update;
  if not found
     or current_contract.current_version_id is distinct from current_version.id then
    raise exception 'review source version is not current' using errcode = '23514';
  end if;
  if p_expected_upload_id is not null
     and current_version.upload_id is distinct from p_expected_upload_id then
    raise exception 'review source upload identity changed' using errcode = '23514';
  end if;
  if p_expected_file_sha256 is not null
     and current_version.file_sha256 is distinct from p_expected_file_sha256 then
    raise exception 'review source file hash changed' using errcode = '23514';
  end if;

  return query
  select started.review_id,
         started.job_id,
         started.review_status,
         started.job_status,
         started.should_process,
         started.recovered
    from public.start_initial_contract_review(
      p_org_id,
      p_contract_id,
      p_contract_version_id,
      p_requested_by,
      p_expected_contract_status,
      p_strategy_id
    ) as started;
end
$function$;

revoke all on function public.start_initial_contract_review_fenced(
  uuid, uuid, uuid, uuid, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.start_initial_contract_review_fenced(
  uuid, uuid, uuid, uuid, text, uuid, uuid, text
) to service_role;

create or replace function public.mark_contract_analysis_job_running(
  p_job_id uuid,
  p_lock_token uuid,
  p_provider text
)
returns setof public.contract_analysis_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  chain_contract_id uuid;
  chain_contract_version_id uuid;
  chain_review_id uuid;
  updated_job public.contract_analysis_jobs%rowtype;
  affected_rows integer;
  now_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_job_id is null or p_lock_token is null then
    raise exception 'complete job lease identity is required' using errcode = '23514';
  end if;

  select chain.locked_contract_id,
         chain.locked_contract_version_id,
         chain.locked_review_id
    into chain_contract_id, chain_contract_version_id, chain_review_id
    from private.wp04_lock_analysis_chain(
      p_job_id, p_lock_token, null, null, false
    ) as chain;
  if not found then
    return;
  end if;

  update public.contracts as contract
     set status = 'ANALYZING', updated_at = now_value
   where contract.id = chain_contract_id
     and contract.current_version_id = chain_contract_version_id
     and contract.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract state changed outside the active analysis lease' using errcode = '23514';
  end if;

  update public.contract_reviews as review
     set status = 'ANALYZING'
   where review.id = chain_review_id
     and review.contract_id = chain_contract_id
     and review.contract_version_id = chain_contract_version_id
     and review.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'review state changed outside the active analysis lease' using errcode = '23514';
  end if;

  update public.contract_analysis_jobs as job
     set provider = coalesce(nullif(pg_catalog.btrim(p_provider), ''), job.provider, job.locked_by, 'inline-request'),
         last_error = null,
         locked_at = now_value,
         updated_at = now_value
   where job.id = p_job_id
     and job.contract_id = chain_contract_id
     and job.review_id = chain_review_id
     and job.status = 'running'
     and job.lock_token = p_lock_token
  returning job.* into updated_job;
  if not found then
    return;
  end if;

  return next updated_job;
end
$function$;

revoke all on function public.mark_contract_analysis_job_running(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_contract_analysis_job_running(uuid, uuid, text)
  to service_role;

create or replace function public.mark_contract_analysis_job_completed(
  p_job_id uuid,
  p_lock_token uuid,
  p_provider text,
  p_degraded boolean,
  p_result jsonb
)
returns setof public.contract_analysis_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  chain_contract_id uuid;
  chain_contract_version_id uuid;
  chain_review_id uuid;
  updated_job public.contract_analysis_jobs%rowtype;
  affected_rows integer;
  now_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_job_id is null or p_lock_token is null or p_degraded is null
     or p_result is null or pg_catalog.jsonb_typeof(p_result) <> 'object' then
    raise exception 'complete analysis result and lease identity are required' using errcode = '23514';
  end if;

  select chain.locked_contract_id,
         chain.locked_contract_version_id,
         chain.locked_review_id
    into chain_contract_id, chain_contract_version_id, chain_review_id
    from private.wp04_lock_analysis_chain(
      p_job_id, p_lock_token, null, null, false
    ) as chain;
  if not found then
    return;
  end if;

  update public.contracts as contract
     set status = 'COMPLETED', updated_at = now_value
   where contract.id = chain_contract_id
     and contract.current_version_id = chain_contract_version_id
     and contract.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract state changed outside the active analysis lease' using errcode = '23514';
  end if;

  update public.contract_reviews as review
     set status = case when p_degraded then 'DEGRADED' else 'COMPLETED' end,
         results = p_result,
         completed_at = now_value
   where review.id = chain_review_id
     and review.contract_id = chain_contract_id
     and review.contract_version_id = chain_contract_version_id
     and review.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'review state changed outside the active analysis lease' using errcode = '23514';
  end if;

  update public.contract_analysis_jobs as job
     set status = 'completed',
         provider = coalesce(nullif(pg_catalog.btrim(p_provider), ''), job.provider),
         degraded = p_degraded,
         last_error = null,
         completed_at = now_value,
         locked_at = null,
         lock_token = null,
         locked_by = null,
         updated_at = now_value
   where job.id = p_job_id
     and job.contract_id = chain_contract_id
     and job.review_id = chain_review_id
     and job.status = 'running'
     and job.lock_token = p_lock_token
  returning job.* into updated_job;
  if not found then
    return;
  end if;

  return next updated_job;
end
$function$;

revoke all on function public.mark_contract_analysis_job_completed(
  uuid, uuid, text, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.mark_contract_analysis_job_completed(
  uuid, uuid, text, boolean, jsonb
) to service_role;

create or replace function public.mark_contract_analysis_job_failed(
  p_job_id uuid,
  p_lock_token uuid,
  p_last_error text
)
returns setof public.contract_analysis_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  chain_contract_id uuid;
  chain_contract_version_id uuid;
  chain_review_id uuid;
  updated_job public.contract_analysis_jobs%rowtype;
  affected_rows integer;
  now_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_job_id is null or p_lock_token is null or coalesce(pg_catalog.btrim(p_last_error), '') = '' then
    raise exception 'complete analysis failure and lease identity are required' using errcode = '23514';
  end if;

  select chain.locked_contract_id,
         chain.locked_contract_version_id,
         chain.locked_review_id
    into chain_contract_id, chain_contract_version_id, chain_review_id
    from private.wp04_lock_analysis_chain(
      p_job_id, p_lock_token, null, null, false
    ) as chain;
  if not found then
    return;
  end if;

  update public.contracts as contract
     set status = 'FAILED', updated_at = now_value
   where contract.id = chain_contract_id
     and contract.current_version_id = chain_contract_version_id
     and contract.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract state changed outside the active analysis lease' using errcode = '23514';
  end if;

  update public.contract_reviews as review
     set status = 'FAILED',
         results = pg_catalog.jsonb_build_object('error', p_last_error),
         completed_at = now_value
   where review.id = chain_review_id
     and review.contract_id = chain_contract_id
     and review.contract_version_id = chain_contract_version_id
     and review.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'review state changed outside the active analysis lease' using errcode = '23514';
  end if;

  update public.contract_analysis_jobs as job
     set status = 'failed',
         last_error = p_last_error,
         completed_at = now_value,
         locked_at = null,
         lock_token = null,
         locked_by = null,
         updated_at = now_value
   where job.id = p_job_id
     and job.contract_id = chain_contract_id
     and job.review_id = chain_review_id
     and job.status = 'running'
     and job.lock_token = p_lock_token
  returning job.* into updated_job;
  if not found then
    return;
  end if;

  return next updated_job;
end
$function$;

revoke all on function public.mark_contract_analysis_job_failed(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_contract_analysis_job_failed(uuid, uuid, text)
  to service_role;

-- Replace the latest 238000 publisher without changing its artifact contract.
-- The coordinator locks contract -> version -> page map -> review -> job before
-- any generated artifact or aggregate state is mutated.
create or replace function public.publish_contract_analysis_artifacts_fenced(
  p_job_id uuid,
  p_lock_token uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_risk_rows jsonb,
  p_annotation_rows jsonb,
  p_clause_rows jsonb,
  p_review_patch jsonb,
  p_provider text,
  p_degraded boolean,
  p_result jsonb
)
returns setof public.contract_analysis_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_contract public.contracts%rowtype;
  current_review public.contract_reviews%rowtype;
  current_version public.contract_versions%rowtype;
  current_page_map public.contract_source_page_maps%rowtype;
  updated_job public.contract_analysis_jobs%rowtype;
  artifact_version_id uuid;
  locked_contract_id uuid;
  locked_review_id uuid;
  affected_rows integer;
  now_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_job_id is null or p_lock_token is null or p_contract_id is null
     or p_review_id is null
     or p_degraded is null
     or p_result is null or pg_catalog.jsonb_typeof(p_result) <> 'object'
     or p_review_patch is null or pg_catalog.jsonb_typeof(p_review_patch) <> 'object'
     or coalesce(pg_catalog.jsonb_typeof(p_risk_rows), 'array') <> 'array'
     or coalesce(pg_catalog.jsonb_typeof(p_annotation_rows), 'array') <> 'array'
     or coalesce(pg_catalog.jsonb_typeof(p_clause_rows), 'array') <> 'array' then
    raise exception 'complete fenced analysis artifact payload is required'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_to_recordset(
        coalesce(p_annotation_rows, '[]'::jsonb)
      ) as annotation(category text, author_id uuid)
     where annotation.category is distinct from 'risk_finding'
        or annotation.author_id is not null
  ) then
    raise exception 'analysis publication accepts only generated risk_finding annotations'
      using errcode = '23514';
  end if;

  select chain.locked_contract_id,
         chain.locked_contract_version_id,
         chain.locked_review_id
    into locked_contract_id, artifact_version_id, locked_review_id
    from private.wp04_lock_analysis_chain(
      p_job_id, p_lock_token, p_contract_id, p_review_id, true
    ) as chain;
  if not found then
    return;
  end if;

  -- These are stable reads: the coordinator already holds all four aggregate
  -- row locks and the source page-map share lock.
  select contract.*
    into current_contract
    from public.contracts as contract
   where contract.id = locked_contract_id;
  select version.*
    into current_version
    from public.contract_versions as version
   where version.id = artifact_version_id
     and version.contract_id = locked_contract_id;
  select review.*
    into current_review
    from public.contract_reviews as review
   where review.id = locked_review_id
     and review.contract_id = locked_contract_id;
  select page_map.*
    into current_page_map
    from public.contract_source_page_maps as page_map
   where page_map.contract_id = locked_contract_id
     and page_map.contract_version_id = artifact_version_id;

  if current_review.id is null
     or current_review.contract_version_id is distinct from artifact_version_id
     or current_review.status not in ('PARSING', 'ANALYZING') then
    raise exception 'review source or state changed outside the active analysis lease'
      using errcode = '55000';
  end if;
  if current_contract.id is null
     or current_contract.current_version_id is distinct from artifact_version_id
     or current_contract.status not in ('PARSING', 'ANALYZING') then
    raise exception 'contract source or state changed outside the active analysis lease'
      using errcode = '55000';
  end if;
  if current_version.id is null
     or current_version.ingest_status <> 'SOURCE_READY'
     or current_version.storage_path is distinct from current_review.source_storage_path
     or current_version.file_sha256 is distinct from current_review.source_hash
     or current_version.text_sha256 is distinct from current_review.source_text_hash then
    raise exception 'review source identity no longer matches its source version'
      using errcode = '23514';
  end if;
  if current_page_map.contract_id is null
     or current_page_map.storage_path is distinct from current_version.storage_path
     or current_page_map.source_hash is distinct from current_version.file_sha256
     or current_page_map.source_text_hash is distinct from current_version.text_sha256 then
    raise exception 'review source page map is missing or stale'
      using errcode = '23514';
  end if;

  update public.contract_annotations as annotation
     set clause_id = null,
         updated_at = now_value
   where annotation.review_id = p_review_id
     and annotation.contract_version_id = artifact_version_id
     and annotation.clause_id is not null
     and (
       annotation.category is distinct from 'risk_finding'
       or annotation.author_id is not null
     );

  delete from public.contract_annotations as annotation
   where annotation.review_id = p_review_id
     and annotation.contract_version_id = artifact_version_id
     and annotation.category = 'risk_finding'
     and annotation.author_id is null;
  delete from public.contract_risk_cards where review_id = p_review_id;
  delete from public.contract_clauses where review_id = p_review_id;

  insert into public.contract_risk_cards (
    id, review_id, contract_id, rule_id, rule_code, rule_version, level,
    title, description, suggestion, auto_fixable, detected_by, confidence,
    evidence, status, clause_ref, position_start, position_end
  )
  select row.id, p_review_id, p_contract_id, row.rule_id, row.rule_code,
         row.rule_version, row.level, row.title, row.description,
         row.suggestion, row.auto_fixable, row.detected_by, row.confidence,
         row.evidence, row.status, row.clause_ref, row.position_start,
         row.position_end
    from pg_catalog.jsonb_to_recordset(coalesce(p_risk_rows, '[]'::jsonb)) as row(
      id uuid,
      rule_id uuid,
      rule_code text,
      rule_version integer,
      level text,
      title text,
      description text,
      suggestion text,
      auto_fixable boolean,
      detected_by text,
      confidence numeric,
      evidence jsonb,
      status text,
      clause_ref text,
      position_start integer,
      position_end integer
    );

  insert into public.contract_annotations (
    id, contract_id, review_id, contract_version_id, binding_state,
    start_offset, end_offset, selected_text, comment, category, priority,
    status, author_id
  )
  select row.id, p_contract_id, p_review_id, artifact_version_id, 'bound',
         row.start_offset, row.end_offset, row.selected_text, row.comment,
         row.category, row.priority, row.status, row.author_id
    from pg_catalog.jsonb_to_recordset(coalesce(p_annotation_rows, '[]'::jsonb)) as row(
      id uuid,
      start_offset integer,
      end_offset integer,
      selected_text text,
      comment text,
      category text,
      priority text,
      status text,
      author_id uuid
    )
   where row.category = 'risk_finding'
     and row.author_id is null;

  insert into public.contract_clauses (
    id, review_id, contract_id, clause_number, clause_title, clause_text,
    risk_level, risk_category, risk_description, legal_basis, suggestion,
    suggested_text, matched_library_clause_id, position, start_offset,
    end_offset
  )
  select row.id, p_review_id, p_contract_id, row.clause_number,
         row.clause_title, row.clause_text, row.risk_level,
         row.risk_category, row.risk_description, row.legal_basis,
         row.suggestion, row.suggested_text, row.matched_library_clause_id,
         row.position, row.start_offset, row.end_offset
    from pg_catalog.jsonb_to_recordset(coalesce(p_clause_rows, '[]'::jsonb)) as row(
      id uuid,
      clause_number text,
      clause_title text,
      clause_text text,
      risk_level text,
      risk_category text,
      risk_description text,
      legal_basis text,
      suggestion text,
      suggested_text text,
      matched_library_clause_id uuid,
      position integer,
      start_offset integer,
      end_offset integer
    );

  update public.contract_reviews as review
     set strategy_id = nullif(p_review_patch->>'strategy_id', '')::uuid,
         risk_summary = p_review_patch->'risk_summary',
         compliance_check = p_review_patch->'compliance_check',
         effectiveness_analysis = p_review_patch->>'effectiveness_analysis',
         report_version = coalesce((p_review_patch->>'report_version')::integer, 2),
         skill_bundle_id = nullif(p_review_patch->>'skill_bundle_id', '')::uuid,
         model_policy_id = nullif(p_review_patch->>'model_policy_id', '')::uuid,
         plan_snapshot_id = nullif(p_review_patch->>'plan_snapshot_id', '')::uuid,
         rule_snapshot_ids = coalesce(
           array(select value::uuid from pg_catalog.jsonb_array_elements_text(
             coalesce(p_review_patch->'rule_snapshot_ids', '[]'::jsonb)
           ) as value),
           '{}'::uuid[]
         ),
         rule_set_snapshot_ids = coalesce(
           array(select value::uuid from pg_catalog.jsonb_array_elements_text(
             coalesce(p_review_patch->'rule_set_snapshot_ids', '[]'::jsonb)
           ) as value),
           '{}'::uuid[]
         ),
         rule_set_document_ids = coalesce(
           array(select value::uuid from pg_catalog.jsonb_array_elements_text(
             coalesce(p_review_patch->'rule_set_document_ids', '[]'::jsonb)
           ) as value),
           '{}'::uuid[]
         ),
         model_invocation_ids = coalesce(
           array(select value::uuid from pg_catalog.jsonb_array_elements_text(
             coalesce(p_review_patch->'model_invocation_ids', '[]'::jsonb)
           ) as value),
           '{}'::uuid[]
         ),
         review_trigger = nullif(p_review_patch->>'review_trigger', ''),
         status = case when p_degraded then 'DEGRADED' else 'COMPLETED' end,
         results = p_result,
         completed_at = now_value,
         updated_at = now_value
   where review.id = p_review_id
     and review.contract_id = p_contract_id
     and review.contract_version_id = artifact_version_id
     and review.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'review state changed during artifact publication'
      using errcode = '55000';
  end if;

  update public.contracts as contract
     set status = 'COMPLETED', updated_at = now_value
   where contract.id = p_contract_id
     and contract.current_version_id = artifact_version_id
     and contract.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract state changed during artifact publication'
      using errcode = '55000';
  end if;

  update public.contract_analysis_jobs as job
     set status = 'completed',
         provider = coalesce(nullif(pg_catalog.btrim(p_provider), ''), job.provider),
         degraded = p_degraded,
         last_error = null,
         completed_at = now_value,
         locked_at = null,
         lock_token = null,
         locked_by = null,
         updated_at = now_value
   where job.id = p_job_id
     and job.contract_id = p_contract_id
     and job.review_id = p_review_id
     and job.status = 'running'
     and job.lock_token = p_lock_token
  returning job.* into updated_job;
  if not found then
    raise exception 'analysis lease changed during artifact publication'
      using errcode = '55000';
  end if;

  return next updated_job;
end
$function$;

revoke all on function public.publish_contract_analysis_artifacts_fenced(
  uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.publish_contract_analysis_artifacts_fenced(
  uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, boolean, jsonb
) to service_role;

commit;
