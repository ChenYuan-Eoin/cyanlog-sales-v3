-- WP04 Preview-only review artifact reconciliation canary.
-- Target: isolated project vsfropnfsmnonkotywsx. Never run against Production.
-- Run only after 20260721238000_wp04_review_artifact_reconciliation.sql.
-- Expected result: one JSON object with status=passed, followed by ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temporary table wp04_artifact_reconciliation_baseline
on commit drop
as
with review_counts as (
  select review.contract_id,
         count(*)::integer as all_reviews,
         count(*) filter (
           where review.contract_version_id is not null
         )::integer as bound_reviews,
         (
           array_agg(review.id order by review.created_at nulls last, review.id)
           filter (where review.contract_version_id is not null)
         )[1] as sole_bound_review_id,
         (
           array_agg(
             review.contract_version_id
             order by review.created_at nulls last, review.id
           ) filter (where review.contract_version_id is not null)
         )[1] as sole_bound_version_id,
         min(review.created_at) as review_created_at_min,
         max(review.created_at) as review_created_at_max
    from public.contract_reviews as review
   where review.contract_id is not null
   group by review.contract_id
), candidate_contracts as (
  select *
    from review_counts
   where all_reviews > 1
     and bound_reviews = 1
), candidate_asks as (
  select ask.*
    from public.ask_items as ask
    join candidate_contracts as candidate
      on candidate.contract_id = ask.contract_id
     and candidate.sole_bound_review_id = ask.review_id
     and candidate.sole_bound_version_id = ask.contract_version_id
   where ask.binding_state = 'bound'
), candidate_reports as (
  select report.*
    from public.report_versions as report
    join candidate_contracts as candidate
      on candidate.contract_id = report.contract_id
     and candidate.sole_bound_review_id = report.review_id
     and candidate.sole_bound_version_id = report.contract_version_id
   where report.binding_state = 'bound'
)
select
  (select count(*)::integer from candidate_contracts) as candidate_contracts,
  (select min(review_created_at_min) from candidate_contracts)
    as review_created_at_min,
  (select max(review_created_at_max) from candidate_contracts)
    as review_created_at_max,
  (select count(*)::integer from candidate_asks) as candidate_asks,
  (select min(created_at) from candidate_asks) as ask_created_at_min,
  (select max(created_at) from candidate_asks) as ask_created_at_max,
  (select count(*)::integer from candidate_reports) as candidate_reports,
  (select min(created_at) from candidate_reports) as report_created_at_min,
  (select max(created_at) from candidate_reports) as report_created_at_max;

insert into public.organizations (id, name, slug)
values (
  'e0000000-0000-4000-8000-000000000001',
  'WP04 Artifact Reconciliation Canary',
  'wp04-artifact-reconciliation-canary'
);

insert into public.users (
  id, org_id, email, display_name, password_hash, status, login_enabled
)
values (
  'e1000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'wp04-artifact-reconciliation@example.invalid',
  'WP04 Artifact Reconciliation',
  null,
  'active',
  true
);

insert into public.user_organizations (user_id, org_id, is_default)
values (
  'e1000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  true
);

do $canary$
declare
  target_contract_id constant uuid := 'e2000000-0000-4000-8000-000000000001';
  target_version_id constant uuid := 'e3000000-0000-4000-8000-000000000001';
  target_review_id constant uuid := 'e4000000-0000-4000-8000-000000000001';
  legacy_review_id constant uuid := 'e4000000-0000-4000-8000-000000000002';
  target_job_id constant uuid := 'e5000000-0000-4000-8000-000000000001';
  target_lock_token constant uuid := 'e6000000-0000-4000-8000-000000000001';
  target_ask_id constant uuid := 'e7000000-0000-4000-8000-000000000001';
  target_report_id constant uuid := 'e8000000-0000-4000-8000-000000000001';
  old_clause_id constant uuid := 'e9000000-0000-4000-8000-000000000001';
  manual_annotation_id constant uuid := 'ea000000-0000-4000-8000-000000000001';
  manual_risk_annotation_id constant uuid := 'ea000000-0000-4000-8000-000000000002';
  old_generated_annotation_id constant uuid := 'ea000000-0000-4000-8000-000000000003';
  new_generated_annotation_id constant uuid := 'ea000000-0000-4000-8000-000000000004';
  new_clause_id constant uuid := 'eb000000-0000-4000-8000-000000000001';
  source_text constant text := 'WP04 人工批注不得被分析重跑删除。';
  source_file_hash constant text := repeat('e', 64);
  source_text_hash text;
  source_upload_id uuid;
  source_path text;
  all_reviews integer;
  bound_reviews integer;
  published_rows integer;
begin
  source_text_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(source_text, 'UTF8'), 'sha256'),
    'hex'
  );
  source_upload_id := private.wp04_expected_source_upload_id(
    target_contract_id,
    source_file_hash
  );
  source_path := target_contract_id::text || '/' || source_upload_id::text || '/source';

  insert into public.contracts (
    id, filename, storage_path, size, mime_type, status, parsed_text,
    created_by, org_id
  ) values (
    target_contract_id,
    'wp04-artifact-reconciliation.docx',
    source_path,
    256,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'PENDING',
    source_text,
    'e1000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000001'
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
    256,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'e1000000-0000-4000-8000-000000000001',
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
    '[{"page":1,"start":0,"end":19,"locator":"provisional"}]'::jsonb
  );

  set constraints all immediate;
  set constraints all deferred;

  update public.contracts
     set status = 'ANALYZING'
   where id = target_contract_id;

  insert into public.contract_reviews (
    id, contract_id, contract_version_id, status, review_trigger,
    source_storage_path, source_hash, source_text_hash, created_at
  ) values (
    target_review_id,
    target_contract_id,
    target_version_id,
    'ANALYZING',
    'initial_upload',
    source_path,
    source_file_hash,
    source_text_hash,
    '2026-07-21T15:10:00Z'::timestamptz
  );

  insert into public.contract_analysis_jobs (
    id, contract_id, review_id, requested_by, status
  ) values (
    target_job_id,
    target_contract_id,
    target_review_id,
    'e1000000-0000-4000-8000-000000000001',
    'queued'
  );

  update public.contract_analysis_jobs
     set status = 'running',
         attempts = 1,
         lock_token = target_lock_token,
         locked_by = 'wp04-artifact-reconciliation-canary',
         locked_at = pg_catalog.clock_timestamp(),
         started_at = pg_catalog.clock_timestamp()
   where id = target_job_id;

  -- These two rows represent the exact state produced by the unsafe 230000
  -- singleton fallback before its unversioned historical ReviewRun is counted.
  insert into public.ask_items (
    id, contract_id, ask_code, risk_name, initial_level, question_type,
    required_roles, question_text, qualified_std, status, trigger_user_id,
    review_id, contract_version_id, binding_state
  ) values (
    target_ask_id,
    target_contract_id,
    'ASK-WP04-2380',
    'WP04 singleton reconciliation',
    'yellow',
    'legal',
    array['legal'],
    'Which ReviewRun owns this legacy ASK?',
    'Only a contract with exactly one ReviewRun may infer ownership.',
    'pending',
    'e1000000-0000-4000-8000-000000000001',
    target_review_id,
    target_version_id,
    'bound'
  );

  insert into public.report_versions (
    id, contract_id, version, trigger_event, trigger_ask_id, trigger_user_id,
    report_data, is_current, review_id, contract_version_id, binding_state
  ) values (
    target_report_id,
    target_contract_id,
    1,
    'initial_generate',
    target_ask_id,
    'e1000000-0000-4000-8000-000000000001',
    '{"canary":true}'::jsonb,
    true,
    target_review_id,
    target_version_id,
    'bound'
  );

  -- New reviews must carry complete source identity. Temporarily disabling the
  -- insert guard is only a rollback-fixture technique for a historical row that
  -- legitimately predates source-version binding.
  alter table public.contract_reviews
    disable trigger trg_contract_review_run_source_identity;
  insert into public.contract_reviews (
    id, contract_id, status, created_at
  ) values (
    legacy_review_id,
    target_contract_id,
    'COMPLETED',
    '2026-07-21T15:00:00Z'::timestamptz
  );
  alter table public.contract_reviews
    enable trigger trg_contract_review_run_source_identity;

  select count(*)::integer,
         count(*) filter (where contract_version_id is not null)::integer
    into all_reviews, bound_reviews
    from public.contract_reviews
   where contract_id = target_contract_id;

  if all_reviews <> 2 or bound_reviews <> 1 then
    raise exception 'all_reviews > 1 and bound_reviews = 1 fixture is invalid';
  end if;

  -- Replay the migration's one-time forward DML inside this rollback fixture.
  -- Static contract tests keep these predicates aligned with 238000.
  with review_counts as (
    select review.contract_id,
           count(*)::integer as all_reviews,
           count(*) filter (
             where review.contract_version_id is not null
           )::integer as bound_reviews,
           (
             array_agg(review.id order by review.created_at nulls last, review.id)
             filter (where review.contract_version_id is not null)
           )[1] as sole_bound_review_id,
           (
             array_agg(
               review.contract_version_id
               order by review.created_at nulls last, review.id
             ) filter (where review.contract_version_id is not null)
           )[1] as sole_bound_version_id
      from public.contract_reviews as review
     where review.contract_id = target_contract_id
     group by review.contract_id
  )
  update public.report_versions as report
     set review_id = null,
         contract_version_id = null,
         binding_state = 'legacy_unbound',
         -- The canary replays this DML after the stricter 238000 trigger has
         -- already been installed. Detach the ASK in the same statement so no
         -- transient cross-binding reference is presented to that trigger.
         trigger_ask_id = null
    from review_counts as counts
   where counts.all_reviews > 1
     and counts.bound_reviews = 1
     and report.contract_id = counts.contract_id
     and report.review_id = counts.sole_bound_review_id
     and report.contract_version_id = counts.sole_bound_version_id
     and report.binding_state = 'bound';

  with review_counts as (
    select review.contract_id,
           count(*)::integer as all_reviews,
           count(*) filter (
             where review.contract_version_id is not null
           )::integer as bound_reviews,
           (
             array_agg(review.id order by review.created_at nulls last, review.id)
             filter (where review.contract_version_id is not null)
           )[1] as sole_bound_review_id,
           (
             array_agg(
               review.contract_version_id
               order by review.created_at nulls last, review.id
             ) filter (where review.contract_version_id is not null)
           )[1] as sole_bound_version_id
      from public.contract_reviews as review
     where review.contract_id = target_contract_id
     group by review.contract_id
  )
  update public.ask_items as ask
     set review_id = null,
         contract_version_id = null,
         binding_state = 'legacy_unbound'
    from review_counts as counts
   where counts.all_reviews > 1
     and counts.bound_reviews = 1
     and ask.contract_id = counts.contract_id
     and ask.review_id = counts.sole_bound_review_id
     and ask.contract_version_id = counts.sole_bound_version_id
     and ask.binding_state = 'bound';

  if not exists (
    select 1
      from public.ask_items
     where id = target_ask_id
       and binding_state = 'legacy_unbound'
       and review_id is null
       and contract_version_id is null
  ) or not exists (
    select 1
      from public.report_versions
     where id = target_report_id
       and binding_state = 'legacy_unbound'
       and review_id is null
       and contract_version_id is null
       and trigger_ask_id is null
  ) then
    raise exception 'unsafe singleton ASK/report ownership was not released';
  end if;

  begin
    update public.report_versions
       set trigger_ask_id = target_ask_id
     where id = target_report_id;
    raise exception 'cross-binding report trigger ASK unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when check_violation then null;
  end;

  insert into public.contract_clauses (
    id, review_id, contract_id, clause_number, clause_title, clause_text,
    risk_level, position, start_offset, end_offset
  ) values (
    old_clause_id,
    target_review_id,
    target_contract_id,
    '1',
    'Old generated clause',
    source_text,
    'medium',
    1,
    0,
    19
  );

  insert into public.contract_clauses (
    id, review_id, contract_id, clause_number, clause_title, clause_text,
    risk_level, position, start_offset, end_offset
  ) values (
    'ec000000-0000-4000-8000-000000000001',
    legacy_review_id,
    target_contract_id,
    'legacy',
    'Clause from another ReviewRun',
    source_text,
    'low',
    2,
    0,
    19
  );

  insert into public.contract_annotations (
    id, contract_id, clause_id, review_id, contract_version_id, binding_state,
    start_offset, end_offset, selected_text, comment, category, priority,
    status, author_id
  ) values
  (
    manual_annotation_id,
    target_contract_id,
    old_clause_id,
    target_review_id,
    target_version_id,
    'bound',
    0,
    4,
    'WP04',
    'Manual comment must survive.',
    'comment',
    'normal',
    'open',
    'e1000000-0000-4000-8000-000000000001'
  ),
  (
    manual_risk_annotation_id,
    target_contract_id,
    old_clause_id,
    target_review_id,
    target_version_id,
    'bound',
    5,
    9,
    '人工批注',
    'Human-authored risk comment must survive.',
    'risk_finding',
    'high',
    'open',
    'e1000000-0000-4000-8000-000000000001'
  ),
  (
    old_generated_annotation_id,
    target_contract_id,
    old_clause_id,
    target_review_id,
    target_version_id,
    'bound',
    10,
    14,
    '重跑删除',
    'Old generated risk comment.',
    'risk_finding',
    'high',
    'open',
    null
  );

  begin
    update public.contract_annotations
       set clause_id = 'ec000000-0000-4000-8000-000000000001'
     where id = manual_annotation_id;
    raise exception 'cross-ReviewRun annotation clause unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when check_violation then null;
  end;

  select count(*)::integer
    into published_rows
    from public.publish_contract_analysis_artifacts_fenced(
      target_job_id,
      target_lock_token,
      target_contract_id,
      target_review_id,
      '[]'::jsonb,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', new_generated_annotation_id,
        'start_offset', 0,
        'end_offset', 4,
        'selected_text', 'WP04',
        'comment', 'New generated risk comment.',
        'category', 'risk_finding',
        'priority', 'high',
        'status', 'open',
        'author_id', null
      )),
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', new_clause_id,
        'clause_number', '1',
        'clause_title', 'New generated clause',
        'clause_text', source_text,
        'risk_level', 'low',
        'risk_category', null,
        'risk_description', null,
        'legal_basis', null,
        'suggestion', null,
        'suggested_text', null,
        'matched_library_clause_id', null,
        'position', 1,
        'start_offset', 0,
        'end_offset', 19
      )),
      '{}'::jsonb,
      'wp04-artifact-reconciliation-canary',
      false,
      '{"status":"ok"}'::jsonb
    );

  if published_rows <> 1 then
    raise exception 'fenced artifact publication did not complete exactly once';
  end if;

  if not exists (
    select 1
      from public.contract_annotations
     where id = manual_annotation_id
       and clause_id is null
       and comment = 'Manual comment must survive.'
  ) or not exists (
    select 1
      from public.contract_annotations
     where id = manual_risk_annotation_id
       and clause_id is null
       and author_id = 'e1000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'manual annotation was cascade-deleted';
  end if;

  if exists (
    select 1 from public.contract_annotations
     where id = old_generated_annotation_id
  ) or not exists (
    select 1
      from public.contract_annotations
     where id = new_generated_annotation_id
       and category = 'risk_finding'
       and author_id is null
  ) then
    raise exception 'generated annotation replacement failed';
  end if;

  if exists (
    select 1 from public.contract_clauses where id = old_clause_id
  ) or not exists (
    select 1 from public.contract_clauses where id = new_clause_id
  ) then
    raise exception 'generated clause replacement failed';
  end if;
end
$canary$;

select pg_catalog.jsonb_build_object(
  'status', 'passed',
  'project', 'vsfropnfsmnonkotywsx',
  'rolled_back', true,
  'preview_candidates_before_fixture', pg_catalog.jsonb_build_object(
    'contracts', baseline.candidate_contracts,
    'review_created_at', pg_catalog.jsonb_build_array(
      baseline.review_created_at_min,
      baseline.review_created_at_max
    ),
    'asks', baseline.candidate_asks,
    'ask_created_at', pg_catalog.jsonb_build_array(
      baseline.ask_created_at_min,
      baseline.ask_created_at_max
    ),
    'reports', baseline.candidate_reports,
    'report_created_at', pg_catalog.jsonb_build_array(
      baseline.report_created_at_min,
      baseline.report_created_at_max
    )
  ),
  'unsafe_singleton_released', true,
  'cross_binding_references_rejected', true,
  'manual_annotations_preserved', true,
  'generated_annotations_replaced', true
) as wp04_review_artifact_reconciliation_canary
from pg_temp.wp04_artifact_reconciliation_baseline as baseline;

rollback;
