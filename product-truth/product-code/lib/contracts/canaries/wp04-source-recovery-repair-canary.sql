-- WP04 Preview-only source recovery repair canary.
-- Target: isolated project vsfropnfsmnonkotywsx. Never run against Production.
-- Run only after 20260721240000_wp04_source_recovery_repair.sql.
-- Expected result: one JSON object with status=passed, followed by ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

insert into public.organizations (id, name, slug)
values (
  'f0000000-0000-4000-8000-000000000001',
  'WP04 Source Recovery Canary',
  'wp04-source-recovery-canary'
);

insert into public.users (
  id, org_id, email, display_name, password_hash, status, login_enabled
)
values (
  'f1000000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000001',
  'wp04-source-recovery@example.invalid',
  'WP04 Source Recovery',
  null,
  'active',
  true
);

insert into public.user_organizations (user_id, org_id, is_default)
values (
  'f1000000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000001',
  true
);

do $canary$
declare
  target_contract_id constant uuid := 'f2000000-0000-4000-8000-000000000001';
  target_version_id constant uuid := 'f3000000-0000-4000-8000-000000000001';
  historical_version_id constant uuid := 'f3000000-0000-4000-8000-000000000002';
  invalid_review_id constant uuid := 'f4000000-0000-4000-8000-000000000001';
  invalid_job_id constant uuid := 'f5000000-0000-4000-8000-000000000001';
  invalid_ask_id constant uuid := 'f6000000-0000-4000-8000-000000000001';
  invalid_report_id constant uuid := 'f7000000-0000-4000-8000-000000000001';
  invalid_annotation_id constant uuid := 'f8000000-0000-4000-8000-000000000001';
  source_file_hash constant text := repeat('a', 64);
  mismatched_file_hash constant text := repeat('b', 64);
  mismatched_text_hash constant text := repeat('c', 64);
  historical_file_hash constant text := repeat('d', 64);
  source_text constant text := 'WP04 同一原文件只在完整身份重新通过后恢复审核。';
  historical_text constant text := 'WP04 合法历史定位证据必须保留。';
  source_text_hash text;
  historical_text_hash text;
  source_upload_id uuid;
  historical_upload_id uuid;
  source_path text;
  historical_path text;
  expected_updated_at timestamptz;
  reconcile_result jsonb;
  recovered_source record;
  first_start record;
  replay_start record;
begin
  source_text_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(source_text, 'UTF8'), 'sha256'),
    'hex'
  );
  historical_text_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(historical_text, 'UTF8'), 'sha256'),
    'hex'
  );
  source_upload_id := private.wp04_expected_source_upload_id(
    target_contract_id,
    source_file_hash
  );
  source_path := target_contract_id::text || '/' || source_upload_id::text || '/source';
  historical_upload_id := private.wp04_expected_source_upload_id(
    target_contract_id,
    historical_file_hash
  );
  historical_path := target_contract_id::text || '/' || historical_upload_id::text || '/source';

  insert into public.contracts (
    id, filename, storage_path, size, mime_type, status, parsed_text,
    created_by, org_id
  ) values (
    target_contract_id,
    'wp04-source-recovery.docx',
    source_path,
    256,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'COMPLETED',
    source_text,
    'f1000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000001'
  );

  insert into public.contract_versions (
    id, contract_id, version_number, source, storage_path, file_size, mime_type,
    uploaded_by, upload_id, file_sha256, text_sha256, parsed_text,
    ingest_status, ingest_error
  ) values (
    target_version_id,
    target_contract_id,
    1,
    'original',
    source_path,
    256,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'f1000000-0000-4000-8000-000000000001',
    source_upload_id,
    source_file_hash,
    source_text_hash,
    source_text,
    'FAILED',
    'LEGACY_SOURCE_EVIDENCE_INCOMPLETE'
  );

  update public.contracts
     set current_version_id = target_version_id
   where id = target_contract_id;

  -- Reproduce the real mismatch class without copying any real identifier or
  -- source content: ContractVersion path/contract match, both hashes disagree.
  insert into public.contract_source_page_map_evidence (
    contract_version_id, contract_id, storage_path, source_hash,
    source_text_hash, render_mode, page_count, locator, page_map, generated_at
  ) values (
    target_version_id,
    target_contract_id,
    source_path,
    mismatched_file_hash,
    mismatched_text_hash,
    'browser-ooxml',
    1,
    'provisional',
    '[{"page":1,"start":0,"end":25,"locator":"provisional"}]'::jsonb,
    '2026-07-21T16:00:00Z'::timestamptz
  );

  -- Positive control: a non-current historical version with exact immutable
  -- evidence must survive reconciliation byte-for-byte.
  insert into public.contract_versions (
    id, contract_id, version_number, source, storage_path, file_size, mime_type,
    parent_version_id, uploaded_by, upload_id, file_sha256, text_sha256,
    parsed_text, ingest_status, ingest_error
  ) values (
    historical_version_id,
    target_contract_id,
    2,
    'manual_revision',
    historical_path,
    192,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    target_version_id,
    'f1000000-0000-4000-8000-000000000001',
    historical_upload_id,
    historical_file_hash,
    historical_text_hash,
    historical_text,
    'SOURCE_READY',
    null
  );

  insert into public.contract_source_page_map_evidence (
    contract_version_id, contract_id, storage_path, source_hash,
    source_text_hash, render_mode, page_count, locator, page_map, generated_at
  ) values (
    historical_version_id,
    target_contract_id,
    historical_path,
    historical_file_hash,
    historical_text_hash,
    'browser-ooxml',
    1,
    'provisional',
    '[{"page":1,"start":0,"end":16,"locator":"provisional"}]'::jsonb,
    '2026-07-21T15:59:00Z'::timestamptz
  );

  -- New inserts cannot create this stale ReviewRun, so the canary temporarily
  -- disables only the source-identity insert guard to reproduce legacy state.
  alter table public.contract_reviews
    disable trigger trg_contract_review_run_source_identity;
  insert into public.contract_reviews (
    id, contract_id, contract_version_id, status, review_trigger,
    source_storage_path, source_hash, source_text_hash, created_at, completed_at
  ) values (
    invalid_review_id,
    target_contract_id,
    target_version_id,
    'COMPLETED',
    'initial_upload',
    source_path,
    mismatched_file_hash,
    mismatched_text_hash,
    '2026-07-21T16:01:00Z'::timestamptz,
    '2026-07-21T16:02:00Z'::timestamptz
  );
  alter table public.contract_reviews
    enable trigger trg_contract_review_run_source_identity;

  insert into public.contract_analysis_jobs (
    id, contract_id, review_id, requested_by, start_request_id, status,
    attempts, degraded, completed_at
  ) values (
    invalid_job_id,
    target_contract_id,
    invalid_review_id,
    'f1000000-0000-4000-8000-000000000001',
    source_upload_id,
    'completed',
    1,
    false,
    '2026-07-21T16:02:00Z'::timestamptz
  );

  insert into public.contract_annotations (
    id, contract_id, review_id, contract_version_id, binding_state,
    start_offset, end_offset, selected_text, comment, category, priority,
    status, author_id
  ) values (
    invalid_annotation_id,
    target_contract_id,
    invalid_review_id,
    target_version_id,
    'bound',
    0,
    4,
    'WP04',
    'Invalid source annotation remains auditable.',
    'risk_finding',
    'high',
    'open',
    null
  );

  insert into public.ask_items (
    id, contract_id, ask_code, risk_name, initial_level, question_type,
    required_roles, question_text, qualified_std, status, trigger_user_id,
    review_id, contract_version_id, binding_state
  ) values (
    invalid_ask_id,
    target_contract_id,
    'ASK-WP04-2400',
    'Source identity recovery',
    'yellow',
    'legal',
    array['legal'],
    'Can a false-ready ReviewRun be used?',
    'Only exact SOURCE_READY identity is reviewable.',
    'pending',
    'f1000000-0000-4000-8000-000000000001',
    invalid_review_id,
    target_version_id,
    'bound'
  );

  insert into public.report_versions (
    id, contract_id, version, trigger_event, trigger_ask_id, trigger_user_id,
    report_data, is_current, review_id, contract_version_id, binding_state
  ) values (
    invalid_report_id,
    target_contract_id,
    1,
    'initial_generate',
    invalid_ask_id,
    'f1000000-0000-4000-8000-000000000001',
    '{"canary":true}'::jsonb,
    true,
    invalid_review_id,
    target_version_id,
    'bound'
  );

  select private.wp04_reconcile_invalid_source_evidence()
    into reconcile_result;

  if coalesce((reconcile_result->>'deleted_evidence')::integer, 0) <> 1
     or exists (
       select 1
         from public.contract_source_page_map_evidence
        where contract_version_id = target_version_id
     ) then
    raise exception 'mismatched derived evidence was not removed exactly once';
  end if;

  if not exists (
    select 1
      from public.contract_source_page_map_evidence as evidence
     where evidence.contract_version_id = historical_version_id
       and evidence.contract_id = target_contract_id
       and evidence.storage_path = historical_path
       and evidence.source_hash = historical_file_hash
       and evidence.source_text_hash = historical_text_hash
       and evidence.generated_at = '2026-07-21T15:59:00Z'::timestamptz
  ) then
    raise exception 'valid historical evidence was not preserved';
  end if;

  if not exists (
    select 1
      from public.contract_reviews
     where id = invalid_review_id
       and status = 'FAILED'
       and review_trigger = 'source_recovery_invalidated'
  ) or not exists (
    select 1
      from public.contract_analysis_jobs
     where id = invalid_job_id
       and status = 'failed'
       and start_request_id is null
       and invalidated_start_request_id = source_upload_id
       and last_error = 'SOURCE_IDENTITY_INVALIDATED'
  ) then
    raise exception 'false-ready ReviewRun or job was not safely invalidated';
  end if;

  if not exists (
    select 1
      from public.contract_annotations
     where id = invalid_annotation_id
       and review_id = invalid_review_id
       and contract_version_id = target_version_id
       and binding_state = 'source_invalidated'
  ) or not exists (
    select 1
      from public.ask_items
     where id = invalid_ask_id
       and review_id = invalid_review_id
       and contract_version_id = target_version_id
       and binding_state = 'source_invalidated'
  ) or not exists (
    select 1
      from public.report_versions
     where id = invalid_report_id
       and review_id = invalid_review_id
       and contract_version_id = target_version_id
       and trigger_ask_id = invalid_ask_id
       and binding_state = 'source_invalidated'
  ) then
    raise exception 'invalidated artifacts lost audit identity or remained live';
  end if;

  select updated_at
    into expected_updated_at
    from public.contracts
   where id = target_contract_id;

  select *
    into recovered_source
    from public.finalize_contract_source_version(
      'f0000000-0000-4000-8000-000000000001',
      target_contract_id,
      'f1000000-0000-4000-8000-000000000001',
      source_upload_id,
      expected_updated_at,
      source_path,
      source_path,
      'wp04-source-recovery.docx',
      256,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      source_file_hash,
      source_text,
      source_text_hash,
      'SOURCE_READY',
      null,
      'browser-ooxml',
      'provisional',
      1,
      '[{"page":1,"start":0,"end":25,"locator":"provisional"}]'::jsonb
    );

  set constraints all immediate;
  if recovered_source.contract_version_id is distinct from target_version_id
     or recovered_source.ingest_status is distinct from 'SOURCE_READY'
     or recovered_source.recovered is distinct from true
     or not private.wp04_contract_source_version_ready_truth(target_version_id) then
    raise exception 'same source recovery did not become truthful SOURCE_READY';
  end if;
  set constraints all deferred;

  begin
    update public.contract_source_page_maps
       set source_hash = mismatched_file_hash
     where contract_id = target_contract_id;
    raise exception 'mismatched page-map evidence capture unexpectedly succeeded';
  exception
    when check_violation then null;
  end;

  select *
    into first_start
    from public.start_initial_contract_review(
      'f0000000-0000-4000-8000-000000000001',
      target_contract_id,
      target_version_id,
      'f1000000-0000-4000-8000-000000000001',
      'PENDING',
      null
    );

  if first_start.review_id is null
     or first_start.review_id = invalid_review_id
     or first_start.job_id is null
     or first_start.should_process is distinct from true
     or first_start.recovered is distinct from false then
    raise exception 'recovered source did not create one new initial ReviewRun';
  end if;

  select *
    into replay_start
    from public.start_initial_contract_review(
      'f0000000-0000-4000-8000-000000000001',
      target_contract_id,
      target_version_id,
      'f1000000-0000-4000-8000-000000000001',
      'PENDING',
      null
    );

  if replay_start.review_id is distinct from first_start.review_id
     or replay_start.job_id is distinct from first_start.job_id
     or replay_start.should_process is distinct from false
     or replay_start.recovered is distinct from true
     or (
       select count(*)
         from public.contract_reviews
        where contract_id = target_contract_id
          and review_trigger = 'initial_upload'
     ) <> 1 then
    raise exception 'existing-review replay created duplicate work';
  end if;
end
$canary$;

select pg_catalog.jsonb_build_object(
  'status', 'passed',
  'project', 'vsfropnfsmnonkotywsx',
  'rolled_back', true,
  'known_mismatch_class', 'file_and_text_hash',
  'source_rows_deleted', false,
  'review_rows_deleted', false,
  'same_source_recovered', true,
  'valid_historical_evidence_preserved', true,
  'initial_review_idempotent', true
) as wp04_source_recovery_repair_canary;

rollback;
