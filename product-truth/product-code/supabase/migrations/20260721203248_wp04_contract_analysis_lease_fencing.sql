begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A request may recover a queued job or a genuinely stale running lease.  The
-- old lock token is replaced under the row lock, so the old worker can no
-- longer publish running/completed/failed state through the fenced RPCs below.
create or replace function public.claim_contract_analysis_job_by_id(
  p_job_id uuid,
  p_worker_id text,
  p_lock_token uuid
)
returns setof public.contract_analysis_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_job_id is null or coalesce(pg_catalog.btrim(p_worker_id), '') = '' or p_lock_token is null then
    raise exception 'complete job lease identity is required' using errcode = '23514';
  end if;

  return query
  update public.contract_analysis_jobs as job
     set status = 'running',
         attempts = job.attempts + 1,
         locked_at = pg_catalog.clock_timestamp(),
         lock_token = p_lock_token,
         locked_by = p_worker_id,
         started_at = coalesce(job.started_at, pg_catalog.clock_timestamp()),
         last_error = case
           when job.status = 'running'
             then coalesce(job.last_error, 'Recovered from stale analysis lease')
           else null
         end,
         provider = coalesce(job.provider, p_worker_id),
         updated_at = pg_catalog.clock_timestamp()
   where job.id = p_job_id
     and (
       job.status = 'queued'
       or (
         job.status = 'running'
         and (
           job.lock_token is null
           or job.locked_at is null
           or job.locked_at < pg_catalog.clock_timestamp() - interval '15 minutes'
         )
       )
     )
  returning job.*;
end;
$$;

revoke all on function public.claim_contract_analysis_job_by_id(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_contract_analysis_job_by_id(uuid, text, uuid)
  to service_role;

-- The periodic worker uses the same lease token contract.  Stale recovery is
-- still bounded at fifteen minutes, but a user retry can now invoke the exact
-- job claim above instead of waiting for the daily cron.
create or replace function public.claim_contract_analysis_job(
  p_worker_id text,
  p_stale_after interval default interval '15 minutes'
)
returns setof public.contract_analysis_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  leased_job public.contract_analysis_jobs%rowtype;
begin
  if coalesce(pg_catalog.btrim(p_worker_id), '') = ''
     or p_stale_after is null
     or p_stale_after <= interval '0 seconds' then
    raise exception 'valid worker and stale interval are required' using errcode = '23514';
  end if;

  update public.contract_analysis_jobs as stale_job
     set status = 'queued',
         locked_at = null,
         lock_token = null,
         locked_by = null,
         last_error = coalesce(stale_job.last_error, 'Recovered from stale analysis lease'),
         updated_at = pg_catalog.clock_timestamp()
   where stale_job.status = 'running'
     and (
       stale_job.lock_token is null
       or stale_job.locked_at is null
       or stale_job.locked_at < pg_catalog.clock_timestamp() - p_stale_after
     );

  select job.*
    into leased_job
    from public.contract_analysis_jobs as job
   where job.status = 'queued'
   order by job.created_at asc
   for update skip locked
   limit 1;

  if not found then
    return;
  end if;

  update public.contract_analysis_jobs as job
     set status = 'running',
         attempts = job.attempts + 1,
         locked_at = pg_catalog.clock_timestamp(),
         lock_token = extensions.gen_random_uuid(),
         locked_by = p_worker_id,
         started_at = coalesce(job.started_at, pg_catalog.clock_timestamp()),
         last_error = null,
         provider = coalesce(job.provider, p_worker_id),
         updated_at = pg_catalog.clock_timestamp()
   where job.id = leased_job.id
     and job.status = 'queued'
  returning job.* into leased_job;

  if not found then
    return;
  end if;

  return next leased_job;
end;
$$;

revoke all on function public.claim_contract_analysis_job(text, interval)
  from public, anon, authenticated;
grant execute on function public.claim_contract_analysis_job(text, interval)
  to service_role;

-- Backward-compatible wrapper: existing callers may continue to use the old
-- six-argument start RPC.  The upload page uses this fenced entry and can bind
-- its READY response to the exact upload UUID and byte hash.  Locking the
-- contract row keeps source replacement and ReviewRun creation in one database
-- transaction even though the existing start function is called internally.
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
as $$
declare
  current_version public.contract_versions%rowtype;
begin
  if p_org_id is null or p_contract_id is null or p_contract_version_id is null or p_requested_by is null then
    raise exception 'complete initial review identity is required' using errcode = '23514';
  end if;
  if p_expected_file_sha256 is not null
     and p_expected_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'expected file hash is invalid' using errcode = '23514';
  end if;

  -- Match the lock order of start_initial_contract_review before taking row
  -- locks. This keeps the backward-compatible wrapper from deadlocking an old
  -- six-argument caller that already holds the same version advisory lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_contract_version_id::text, 0)
  );

  select version.*
    into current_version
    from public.contracts as contract
    join public.contract_versions as version
      on version.id = contract.current_version_id
     and version.contract_id = contract.id
   where contract.id = p_contract_id
     and contract.org_id = p_org_id
     and version.id = p_contract_version_id
   for update of contract, version;

  if not found then
    raise exception 'review source version is not current' using errcode = '40001';
  end if;
  if p_expected_upload_id is not null
     and current_version.upload_id is distinct from p_expected_upload_id then
    raise exception 'review source upload identity changed' using errcode = '40001';
  end if;
  if p_expected_file_sha256 is not null
     and current_version.file_sha256 is distinct from p_expected_file_sha256 then
    raise exception 'review source file hash changed' using errcode = '40001';
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
end;
$$;

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
as $$
declare
  leased_job public.contract_analysis_jobs%rowtype;
  updated_job public.contract_analysis_jobs%rowtype;
  affected_rows integer;
  now_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_job_id is null or p_lock_token is null then
    raise exception 'complete job lease identity is required' using errcode = '23514';
  end if;

  select job.*
    into leased_job
    from public.contract_analysis_jobs as job
   where job.id = p_job_id
     and job.status = 'running'
     and job.lock_token = p_lock_token
   for update;
  if not found then
    return;
  end if;

  update public.contracts as contract
     set status = 'ANALYZING', updated_at = now_value
   where contract.id = leased_job.contract_id
     and contract.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract state changed outside the active analysis lease' using errcode = '40001';
  end if;

  update public.contract_reviews as review
     set status = 'ANALYZING'
   where review.id = leased_job.review_id
     and review.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'review state changed outside the active analysis lease' using errcode = '40001';
  end if;

  update public.contract_analysis_jobs as job
     set provider = coalesce(nullif(pg_catalog.btrim(p_provider), ''), job.provider, job.locked_by, 'inline-request'),
         last_error = null,
         locked_at = now_value,
         updated_at = now_value
   where job.id = leased_job.id
     and job.status = 'running'
     and job.lock_token = p_lock_token
  returning job.* into updated_job;
  if not found then
    return;
  end if;

  return next updated_job;
end;
$$;

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
as $$
declare
  leased_job public.contract_analysis_jobs%rowtype;
  updated_job public.contract_analysis_jobs%rowtype;
  affected_rows integer;
  now_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_job_id is null or p_lock_token is null or p_degraded is null
     or p_result is null or pg_catalog.jsonb_typeof(p_result) <> 'object' then
    raise exception 'complete analysis result and lease identity are required' using errcode = '23514';
  end if;

  select job.*
    into leased_job
    from public.contract_analysis_jobs as job
   where job.id = p_job_id
     and job.status = 'running'
     and job.lock_token = p_lock_token
   for update;
  if not found then
    return;
  end if;

  update public.contracts as contract
     set status = 'COMPLETED', updated_at = now_value
   where contract.id = leased_job.contract_id
     and contract.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract state changed outside the active analysis lease' using errcode = '40001';
  end if;

  update public.contract_reviews as review
     set status = case when p_degraded then 'DEGRADED' else 'COMPLETED' end,
         results = p_result,
         completed_at = now_value
   where review.id = leased_job.review_id
     and review.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'review state changed outside the active analysis lease' using errcode = '40001';
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
   where job.id = leased_job.id
     and job.status = 'running'
     and job.lock_token = p_lock_token
  returning job.* into updated_job;
  if not found then
    return;
  end if;

  return next updated_job;
end;
$$;

revoke all on function public.mark_contract_analysis_job_completed(uuid, uuid, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.mark_contract_analysis_job_completed(uuid, uuid, text, boolean, jsonb)
  to service_role;

create or replace function public.mark_contract_analysis_job_failed(
  p_job_id uuid,
  p_lock_token uuid,
  p_last_error text
)
returns setof public.contract_analysis_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  leased_job public.contract_analysis_jobs%rowtype;
  updated_job public.contract_analysis_jobs%rowtype;
  affected_rows integer;
  now_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_job_id is null or p_lock_token is null or coalesce(pg_catalog.btrim(p_last_error), '') = '' then
    raise exception 'complete analysis failure and lease identity are required' using errcode = '23514';
  end if;

  select job.*
    into leased_job
    from public.contract_analysis_jobs as job
   where job.id = p_job_id
     and job.status = 'running'
     and job.lock_token = p_lock_token
   for update;
  if not found then
    return;
  end if;

  update public.contracts as contract
     set status = 'FAILED', updated_at = now_value
   where contract.id = leased_job.contract_id
     and contract.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract state changed outside the active analysis lease' using errcode = '40001';
  end if;

  update public.contract_reviews as review
     set status = 'FAILED',
         results = pg_catalog.jsonb_build_object('error', p_last_error),
         completed_at = now_value
   where review.id = leased_job.review_id
     and review.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'review state changed outside the active analysis lease' using errcode = '40001';
  end if;

  update public.contract_analysis_jobs as job
     set status = 'failed',
         last_error = p_last_error,
         completed_at = now_value,
         locked_at = null,
         lock_token = null,
         locked_by = null,
         updated_at = now_value
   where job.id = leased_job.id
     and job.status = 'running'
     and job.lock_token = p_lock_token
  returning job.* into updated_job;
  if not found then
    return;
  end if;

  return next updated_job;
end;
$$;

revoke all on function public.mark_contract_analysis_job_failed(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_contract_analysis_job_failed(uuid, uuid, text)
  to service_role;

commit;
