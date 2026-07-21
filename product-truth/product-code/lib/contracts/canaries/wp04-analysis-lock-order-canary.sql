-- WP04 Preview-only single-session analysis lock-order canary.
-- Target: isolated project vsfropnfsmnonkotywsx. Never run against Production.
-- Run only after 20260721241000_wp04_analysis_lock_order.sql.
-- Expected result: one status=passed JSON object, followed by ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $canary$
declare
  target_org_id constant uuid := '24100000-0000-4000-8000-000000000001';
  target_user_id constant uuid := '24100000-0000-4000-8000-000000000002';
  target_contract_id constant uuid := '24100000-0000-4000-8000-000000000003';
  target_version_id constant uuid := '24100000-0000-4000-8000-000000000004';
  target_lock_token constant uuid := '24100000-0000-4000-8000-000000000005';
  source_text constant text := 'WP04 lock order canary source';
  source_file_hash constant text := repeat('2', 64);
  source_text_hash text;
  source_upload_id uuid;
  source_path text;
  first_start record;
  replay_start record;
  completed_replay record;
  claimed_rows integer;
  running_rows integer;
  published_rows integer;
  review_count integer;
  job_count integer;
begin
  if exists (select 1 from public.organizations where id = target_org_id)
     or exists (select 1 from public.users where id = target_user_id)
     or exists (select 1 from public.contracts where id = target_contract_id)
     or exists (select 1 from public.contract_versions where id = target_version_id) then
    raise exception 'WP04 analysis lock-order fixture already exists';
  end if;

  source_text_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(source_text, 'UTF8'), 'sha256'),
    'hex'
  );
  source_upload_id := private.wp04_expected_source_upload_id(
    target_contract_id,
    source_file_hash
  );
  source_path := target_contract_id::text || '/' || source_upload_id::text || '/source';

  insert into public.organizations (id, name, slug)
  values (target_org_id, 'WP04 lock order canary', 'wp04-analysis-lock-order-2410');

  insert into public.users (id, org_id, display_name)
  values (target_user_id, target_org_id, 'WP04 lock order canary user');

  insert into public.user_organizations (user_id, org_id, is_default)
  values (target_user_id, target_org_id, true);

  insert into public.contracts (
    id, filename, storage_path, size, mime_type, status, parsed_text,
    created_by, org_id
  ) values (
    target_contract_id,
    'wp04-analysis-lock-order.docx',
    source_path,
    241,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'PENDING',
    source_text,
    target_user_id,
    target_org_id
  );

  insert into public.contract_versions (
    id, contract_id, version_number, source, storage_path, file_size, mime_type,
    uploaded_by, upload_id, file_sha256, text_sha256, parsed_text, ingest_status
  ) values (
    target_version_id,
    target_contract_id,
    1,
    'original',
    source_path,
    241,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    target_user_id,
    source_upload_id,
    source_file_hash,
    source_text_hash,
    source_text,
    'SOURCE_READY'
  );

  update public.contracts
     set current_version_id = target_version_id
   where id = target_contract_id;

  insert into public.contract_source_page_maps (
    contract_id, contract_version_id, storage_path, source_hash,
    source_text_hash, render_mode, page_count, locator, page_map
  ) values (
    target_contract_id,
    target_version_id,
    source_path,
    source_file_hash,
    source_text_hash,
    'browser-ooxml',
    1,
    'provisional',
    '[{"page":1,"start":0,"end":31,"locator":"provisional"}]'::jsonb
  );

  select *
    into first_start
    from public.start_initial_contract_review_fenced(
      target_org_id,
      target_contract_id,
      target_version_id,
      target_user_id,
      'PENDING',
      null,
      source_upload_id,
      source_file_hash
    );

  if first_start.review_id is null
     or first_start.job_id is null
     or not first_start.should_process
     or first_start.recovered then
    raise exception 'first start did not create exactly one processable aggregate';
  end if;

  select *
    into replay_start
    from public.start_initial_contract_review_fenced(
      target_org_id,
      target_contract_id,
      target_version_id,
      target_user_id,
      'PARSING',
      null,
      source_upload_id,
      source_file_hash
    );

  if replay_start.review_id is distinct from first_start.review_id
     or replay_start.job_id is distinct from first_start.job_id
     or replay_start.should_process
     or not replay_start.recovered then
    raise exception 'start replay changed the ReviewRun/job identity';
  end if;

  select count(*)::integer
    into claimed_rows
    from public.claim_contract_analysis_job_by_id(
      first_start.job_id,
      'wp04-analysis-lock-order-canary',
      target_lock_token
    );
  if claimed_rows <> 1 then
    raise exception 'analysis job was not claimed exactly once';
  end if;

  select count(*)::integer
    into running_rows
    from public.mark_contract_analysis_job_running(
      first_start.job_id,
      target_lock_token,
      'wp04-analysis-lock-order-canary'
    );
  if running_rows <> 1 then
    raise exception 'analysis job did not enter running exactly once';
  end if;

  select count(*)::integer
    into published_rows
    from public.publish_contract_analysis_artifacts_fenced(
      first_start.job_id,
      target_lock_token,
      target_contract_id,
      first_start.review_id,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      '{"review_trigger":"initial_upload"}'::jsonb,
      'wp04-analysis-lock-order-canary',
      false,
      '{"status":"ok","canary":"wp04-analysis-lock-order"}'::jsonb
    );
  if published_rows <> 1 then
    raise exception 'analysis publication did not complete exactly once';
  end if;

  select *
    into completed_replay
    from public.start_initial_contract_review_fenced(
      target_org_id,
      target_contract_id,
      target_version_id,
      target_user_id,
      'COMPLETED',
      null,
      source_upload_id,
      source_file_hash
    );
  if completed_replay.review_id is distinct from first_start.review_id
     or completed_replay.job_id is distinct from first_start.job_id
     or completed_replay.should_process then
    raise exception 'completed replay created a duplicate analysis aggregate';
  end if;

  select count(*)::integer
    into review_count
    from public.contract_reviews
   where contract_id = target_contract_id;
  select count(*)::integer
    into job_count
    from public.contract_analysis_jobs
   where contract_id = target_contract_id;

  if review_count <> 1 or job_count <> 1 then
    raise exception 'analysis aggregate contains duplicate ReviewRun/job rows';
  end if;
  if not exists (
    select 1
      from public.contracts as contract
      join public.contract_reviews as review
        on review.id = first_start.review_id
       and review.contract_id = contract.id
      join public.contract_analysis_jobs as job
        on job.id = first_start.job_id
       and job.contract_id = contract.id
       and job.review_id = review.id
     where contract.id = target_contract_id
       and contract.current_version_id = target_version_id
       and contract.status = 'COMPLETED'
       and review.contract_version_id = target_version_id
       and review.review_trigger = 'initial_upload'
       and review.status = 'COMPLETED'
       and job.status = 'completed'
       and job.lock_token is null
  ) then
    raise exception 'analysis aggregate did not finish in one canonical final state';
  end if;
end
$canary$;

select pg_catalog.jsonb_build_object(
  'status', 'passed',
  'project', 'vsfropnfsmnonkotywsx',
  'rolled_back', true,
  'lock_order', 'contract-version-review-job',
  'review_runs', 1,
  'analysis_jobs', 1,
  'final_state', 'COMPLETED'
) as wp04_analysis_lock_order_canary;

rollback;
