begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 235000 correctly failed closed when a reconstructed source did not have a
-- complete immutable identity, but its initial page-map evidence backfill only
-- checked the JSON shape. A row whose contract/path/file/text identity did not
-- match ContractVersion could therefore become immutable and block a later,
-- truthful recovery of the same stored source. This forward repair removes
-- only that derived mismatch, invalidates outputs produced from false-ready
-- sources, and preserves every source file, ContractVersion and ReviewRun.

alter table public.contract_analysis_jobs
  add column if not exists invalidated_start_request_id uuid;

comment on column public.contract_analysis_jobs.invalidated_start_request_id is
  'Original idempotency key retained when a job is invalidated because its ReviewRun source identity was false-ready.';

alter table public.contract_reviews
  drop constraint if exists contract_reviews_review_trigger_check;
alter table public.contract_reviews
  add constraint contract_reviews_review_trigger_check
  check (
    review_trigger is null
    or review_trigger in (
      'direct',
      'decision_batch',
      'initial_upload',
      'source_recovery_invalidated'
    )
  ) not valid;

-- Keep invalid artifacts joined to their historical ReviewRun for audit, but
-- make them ineligible for all business queries, which consume only `bound`.
-- This is safer than erasing review/version identity into legacy_unbound.
alter table public.contract_annotations
  drop constraint if exists contract_annotations_review_binding_check;
alter table public.contract_annotations
  add constraint contract_annotations_review_binding_check
  check (
    (
      binding_state in ('bound', 'source_invalidated')
      and review_id is not null
      and contract_version_id is not null
    )
    or
    (
      binding_state = 'legacy_unbound'
      and review_id is null
      and contract_version_id is null
    )
  ) not valid;

alter table public.ask_items
  drop constraint if exists ask_items_review_binding_check;
alter table public.ask_items
  add constraint ask_items_review_binding_check
  check (
    (
      binding_state in ('bound', 'source_invalidated')
      and review_id is not null
      and contract_version_id is not null
    )
    or
    (
      binding_state = 'legacy_unbound'
      and review_id is null
      and contract_version_id is null
    )
  ) not valid;

alter table public.report_versions
  drop constraint if exists report_versions_review_binding_check;
alter table public.report_versions
  add constraint report_versions_review_binding_check
  check (
    (
      binding_state in ('bound', 'source_invalidated')
      and review_id is not null
      and contract_version_id is not null
    )
    or
    (
      binding_state = 'legacy_unbound'
      and review_id is null
      and contract_version_id is null
    )
  ) not valid;

create or replace function public.enforce_review_artifact_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  owner_contract_id uuid;
  owner_version_id uuid;
  artifact_reference_id uuid;
  referenced_binding_state text;
begin
  if new.binding_state = 'legacy_unbound' then
    if new.review_id is not null or new.contract_version_id is not null then
      raise exception 'legacy review artifact must remain unbound'
        using errcode = '23514';
    end if;
  elsif new.binding_state in ('bound', 'source_invalidated') then
    if new.review_id is null or new.contract_version_id is null then
      raise exception 'review artifact identity is required'
        using errcode = '23514';
    end if;

    select review.contract_id, review.contract_version_id
      into owner_contract_id, owner_version_id
      from public.contract_reviews as review
     where review.id = new.review_id;

    if not found
       or owner_contract_id is distinct from new.contract_id
       or owner_version_id is distinct from new.contract_version_id then
      raise exception 'review artifact identity crosses contract or source version'
        using errcode = '23514';
    end if;
  else
    raise exception 'review artifact identity is required'
      using errcode = '23514';
  end if;

  if tg_table_schema = 'public'
     and tg_table_name = 'contract_annotations' then
    artifact_reference_id := nullif(
      pg_catalog.to_jsonb(new)->>'clause_id',
      ''
    )::uuid;
  else
    artifact_reference_id := null;
  end if;

  if artifact_reference_id is not null then
    perform 1
      from public.contract_clauses as clause
     where clause.id = artifact_reference_id
       and clause.contract_id = new.contract_id
       and clause.review_id = new.review_id;
    if not found then
      raise exception 'annotation clause must belong to the same contract and ReviewRun'
        using errcode = '23514';
    end if;
  end if;

  if tg_table_schema = 'public'
     and tg_table_name = 'report_versions' then
    artifact_reference_id := nullif(
      pg_catalog.to_jsonb(new)->>'trigger_ask_id',
      ''
    )::uuid;
  else
    artifact_reference_id := null;
  end if;

  if artifact_reference_id is not null then
    select ask.binding_state
      into referenced_binding_state
      from public.ask_items as ask
     where ask.id = artifact_reference_id
       and ask.contract_id = new.contract_id
       and ask.review_id is not distinct from new.review_id
       and ask.contract_version_id is not distinct from new.contract_version_id;
    if not found
       or referenced_binding_state is distinct from new.binding_state then
      raise exception 'report trigger ASK must share the artifact binding and source identity'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$function$;

revoke all on function public.enforce_review_artifact_binding()
  from public, anon, authenticated;
grant execute on function public.enforce_review_artifact_binding()
  to service_role;

-- Invalidated reports retain the fact that they were current in their old
-- ReviewRun. They must not participate in either bound or legacy current-row
-- rotation when their binding state changes during reconciliation.
create or replace function public.update_report_version_current()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.is_current is true and new.binding_state = 'bound' then
    update public.report_versions
       set is_current = false
     where review_id = new.review_id
       and binding_state = 'bound'
       and id <> new.id
       and is_current = true;
  elsif new.is_current is true and new.binding_state = 'legacy_unbound' then
    update public.report_versions
       set is_current = false
     where contract_id = new.contract_id
       and binding_state = 'legacy_unbound'
       and id <> new.id
       and is_current = true;
  end if;
  return new;
end
$function$;

revoke all on function public.update_report_version_current()
  from public, anon, authenticated;
grant execute on function public.update_report_version_current()
  to service_role;

-- New immutable evidence can only be captured when every identity field agrees
-- with the exact ContractVersion. The 235000 shape-only insertion path is not
-- repeated. The current-source constraint remains responsible for proving that
-- this version is also the contract's current projection.
create or replace function public.capture_contract_source_page_map_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_version public.contract_versions%rowtype;
  captured public.contract_source_page_map_evidence%rowtype;
begin
  if new.contract_version_id is null then
    raise exception 'source page map requires a contract version identity'
      using errcode = '23514';
  end if;

  select version.*
    into source_version
    from public.contract_versions as version
   where version.id = new.contract_version_id
   for share;

  if not found
     or source_version.contract_id is distinct from new.contract_id
     or source_version.storage_path is distinct from new.storage_path
     or source_version.file_sha256 is distinct from new.source_hash
     or source_version.text_sha256 is distinct from new.source_text_hash
     or source_version.ingest_status is distinct from 'SOURCE_READY'
     or source_version.source not in ('original', 'manual_revision')
     or new.render_mode is distinct from (
       case
         when source_version.mime_type = 'application/pdf' then 'native-pdf'
         when source_version.mime_type in (
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'application/vnd.ms-word.document.macroEnabled.12'
         ) then 'browser-ooxml'
         else null
       end
     ) then
    raise exception 'page map evidence does not match its exact source version'
      using errcode = '23514';
  end if;

  insert into public.contract_source_page_map_evidence (
    contract_version_id,
    contract_id,
    storage_path,
    source_hash,
    source_text_hash,
    render_mode,
    page_count,
    locator,
    page_map,
    generated_at
  ) values (
    new.contract_version_id,
    new.contract_id,
    new.storage_path,
    new.source_hash,
    new.source_text_hash,
    new.render_mode,
    new.page_count,
    new.locator,
    new.page_map,
    new.generated_at
  )
  on conflict (contract_version_id) do nothing;

  select evidence.*
    into captured
    from public.contract_source_page_map_evidence as evidence
   where evidence.contract_version_id = new.contract_version_id;

  if not found
     or captured.contract_id is distinct from new.contract_id
     or captured.storage_path is distinct from new.storage_path
     or captured.source_hash is distinct from new.source_hash
     or captured.source_text_hash is distinct from new.source_text_hash
     or captured.render_mode is distinct from new.render_mode
     or captured.page_count is distinct from new.page_count
     or captured.locator is distinct from new.locator
     or captured.page_map is distinct from new.page_map
     or captured.generated_at is distinct from new.generated_at then
    raise exception 'version-bound source page map evidence is immutable'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

revoke all on function public.capture_contract_source_page_map_evidence()
  from public, anon, authenticated;
grant execute on function public.capture_contract_source_page_map_evidence()
  to service_role;

-- The reconciliation is a private, idempotent maintenance routine so the
-- rollback-only Preview canary can exercise the exact production data path.
-- It never deletes sources, current page maps, versions or ReviewRuns.
create or replace function private.wp04_reconcile_invalid_source_evidence()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  downgraded_versions integer := 0;
  invalidated_contracts integer := 0;
  invalidated_reviews integer := 0;
  invalidated_jobs integer := 0;
  invalidated_annotations integer := 0;
  invalidated_asks integer := 0;
  invalidated_reports integer := 0;
  deleted_evidence integer := 0;
  now_value timestamptz := pg_catalog.clock_timestamp();
begin
  update public.contract_versions as version
     set ingest_status = 'FAILED',
         ingest_error = 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE'
   where version.ingest_status = 'SOURCE_READY'
     and exists (
       select 1
         from public.contract_source_page_map_evidence as evidence
        where evidence.contract_version_id = version.id
          and (
            evidence.contract_id is distinct from version.contract_id
            or evidence.storage_path is distinct from version.storage_path
            or evidence.source_hash is distinct from version.file_sha256
            or evidence.source_text_hash is distinct from version.text_sha256
          )
     );
  get diagnostics downgraded_versions = row_count;

  update public.contracts as contract
     set status = 'FAILED',
         updated_at = now_value
   where exists (
     select 1
       from public.contract_versions as version
      where version.id = contract.current_version_id
        and version.ingest_status = 'FAILED'
        and version.ingest_error = 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE'
   )
     and contract.status is distinct from 'FAILED';
  get diagnostics invalidated_contracts = row_count;

  update public.contract_reviews as review
     set status = 'FAILED',
         review_trigger = case
           when review.review_trigger = 'initial_upload'
             then 'source_recovery_invalidated'
           else review.review_trigger
         end,
         ai_degradation = pg_catalog.jsonb_set(
           coalesce(review.ai_degradation, '{}'::jsonb),
           '{source_identity}',
           pg_catalog.jsonb_build_object(
             'valid', false,
             'reason', 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE',
             'invalidated_at', now_value
           ),
           true
         ),
         completed_at = coalesce(review.completed_at, now_value)
   where exists (
     select 1
       from public.contract_versions as version
      where version.id = review.contract_version_id
        and version.ingest_status = 'FAILED'
        and version.ingest_error = 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE'
   )
     and (
       review.status is distinct from 'FAILED'
       or review.review_trigger = 'initial_upload'
       or coalesce(review.ai_degradation->'source_identity'->>'valid', '') is distinct from 'false'
     );
  get diagnostics invalidated_reviews = row_count;

  update public.contract_analysis_jobs as job
     set status = 'failed',
         invalidated_start_request_id = coalesce(
           job.invalidated_start_request_id,
           job.start_request_id
         ),
         start_request_id = null,
         degraded = true,
         last_error = 'SOURCE_IDENTITY_INVALIDATED',
         locked_at = null,
         lock_token = null,
         locked_by = null,
         completed_at = coalesce(job.completed_at, now_value),
         updated_at = now_value
   where exists (
     select 1
       from public.contract_reviews as review
       join public.contract_versions as version
         on version.id = review.contract_version_id
      where review.id = job.review_id
        and version.ingest_status = 'FAILED'
        and version.ingest_error = 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE'
   )
     and (
       job.status is distinct from 'failed'
       or job.start_request_id is not null
       or job.last_error is distinct from 'SOURCE_IDENTITY_INVALIDATED'
     );
  get diagnostics invalidated_jobs = row_count;

  update public.contract_annotations as annotation
     set binding_state = 'source_invalidated',
         updated_at = now_value
   where annotation.binding_state = 'bound'
     and exists (
       select 1
         from public.contract_versions as version
        where version.id = annotation.contract_version_id
          and version.ingest_status = 'FAILED'
          and version.ingest_error = 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE'
     );
  get diagnostics invalidated_annotations = row_count;

  update public.ask_items as ask
     set binding_state = 'source_invalidated'
   where ask.binding_state = 'bound'
     and exists (
       select 1
         from public.contract_versions as version
        where version.id = ask.contract_version_id
          and version.ingest_status = 'FAILED'
          and version.ingest_error = 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE'
     );
  get diagnostics invalidated_asks = row_count;

  update public.report_versions as report
     set binding_state = 'source_invalidated'
   where report.binding_state = 'bound'
     and exists (
       select 1
         from public.contract_versions as version
        where version.id = report.contract_version_id
          and version.ingest_status = 'FAILED'
          and version.ingest_error = 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE'
     );
  get diagnostics invalidated_reports = row_count;

  delete from public.contract_source_page_map_evidence as evidence
   using public.contract_versions as version
   where version.id = evidence.contract_version_id
     and (
       evidence.contract_id is distinct from version.contract_id
       or evidence.storage_path is distinct from version.storage_path
       or evidence.source_hash is distinct from version.file_sha256
       or evidence.source_text_hash is distinct from version.text_sha256
     );
  get diagnostics deleted_evidence = row_count;

  return pg_catalog.jsonb_build_object(
    'downgraded_versions', downgraded_versions,
    'invalidated_contracts', invalidated_contracts,
    'invalidated_reviews', invalidated_reviews,
    'invalidated_jobs', invalidated_jobs,
    'invalidated_annotations', invalidated_annotations,
    'invalidated_asks', invalidated_asks,
    'invalidated_reports', invalidated_reports,
    'deleted_evidence', deleted_evidence
  );
end
$function$;

revoke all on function private.wp04_reconcile_invalid_source_evidence()
  from public, anon, authenticated, service_role;

select private.wp04_reconcile_invalid_source_evidence();

-- Preserve the validated 194500 implementation as a private fallback. The
-- public wrapper handles only the narrowly proven recovery case: the exact
-- current immutable source already matches all supplied bytes/text, and only
-- false page-map evidence caused the old FAILED state.
alter function public.finalize_contract_source_version(
  uuid, uuid, uuid, uuid, timestamptz, text, text, text, bigint, text,
  text, text, text, text, text, text, text, integer, jsonb
) set schema private;

alter function private.finalize_contract_source_version(
  uuid, uuid, uuid, uuid, timestamptz, text, text, text, bigint, text,
  text, text, text, text, text, text, text, integer, jsonb
) rename to wp04_finalize_contract_source_version_base;

revoke all on function private.wp04_finalize_contract_source_version_base(
  uuid, uuid, uuid, uuid, timestamptz, text, text, text, bigint, text,
  text, text, text, text, text, text, text, integer, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.finalize_contract_source_version(
  p_org_id uuid,
  p_contract_id uuid,
  p_uploaded_by uuid,
  p_upload_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_storage_path text,
  p_storage_path text,
  p_filename text,
  p_file_size bigint,
  p_mime_type text,
  p_file_sha256 text,
  p_parsed_text text,
  p_text_sha256 text,
  p_ingest_status text,
  p_ingest_error text,
  p_render_mode text,
  p_locator text,
  p_page_count integer,
  p_page_map jsonb
)
returns table(
  contract_version_id uuid,
  ingest_status text,
  version_number integer,
  version_source text,
  recovered boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing_version public.contract_versions%rowtype;
  current_contract public.contracts%rowtype;
  expected_upload_id uuid;
  active_submission_batch boolean := false;
  now_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_org_id is null
     or p_contract_id is null
     or p_uploaded_by is null
     or p_upload_id is null then
    raise exception 'complete upload identity is required' using errcode = '23514';
  end if;
  if coalesce(p_file_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid finalized source metadata' using errcode = '23514';
  end if;

  expected_upload_id := private.wp04_expected_source_upload_id(
    p_contract_id,
    p_file_sha256
  );
  if p_upload_id is distinct from expected_upload_id
     or p_storage_path is distinct from (
       p_contract_id::text || '/' || p_upload_id::text || '/source'
     ) then
    raise exception 'upload id is not bound to contract and file hash'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_upload_id::text, 0)
  );

  select version.*
    into existing_version
    from public.contract_versions as version
   where version.upload_id = p_upload_id;

  if not found
     or existing_version.ingest_status is distinct from 'FAILED'
     or existing_version.ingest_error is distinct from 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE'
     or p_ingest_status is distinct from 'SOURCE_READY' then
    return query
    select finalized.contract_version_id,
           finalized.ingest_status,
           finalized.version_number,
           finalized.version_source,
           finalized.recovered
      from private.wp04_finalize_contract_source_version_base(
        p_org_id,
        p_contract_id,
        p_uploaded_by,
        p_upload_id,
        p_expected_updated_at,
        p_expected_storage_path,
        p_storage_path,
        p_filename,
        p_file_size,
        p_mime_type,
        p_file_sha256,
        p_parsed_text,
        p_text_sha256,
        p_ingest_status,
        p_ingest_error,
        p_render_mode,
        p_locator,
        p_page_count,
        p_page_map
      ) as finalized;
    return;
  end if;

  if coalesce(p_filename, '') = ''
     or p_file_size is null
     or p_file_size < 1
     or p_file_size > 52428800
     or p_mime_type not in (
       'application/pdf',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.ms-word.document.macroEnabled.12'
     )
     or coalesce(p_parsed_text, '') = ''
     or coalesce(p_text_sha256, '') !~ '^[0-9a-f]{64}$'
     or p_text_sha256 is distinct from pg_catalog.encode(
       extensions.digest(pg_catalog.convert_to(p_parsed_text, 'UTF8'), 'sha256'),
       'hex'
     )
     or p_ingest_error is not null
     or p_render_mode is distinct from (
       case
         when p_mime_type = 'application/pdf' then 'native-pdf'
         else 'browser-ooxml'
       end
     )
     or p_locator not in ('rendered', 'provisional')
     or coalesce(p_page_count, 0) < 1
     or pg_catalog.jsonb_typeof(coalesce(p_page_map, 'null'::jsonb)) <> 'array'
     or pg_catalog.jsonb_array_length(p_page_map) <> p_page_count then
    raise exception 'ready source requires matching text hash and page map'
      using errcode = '23514';
  end if;

  -- Canonical lock order is contract -> version -> review -> job. The first
  -- version read above discovers the aggregate only; all recovery predicates
  -- are revalidated after both canonical row locks are held.
  select contract.*
    into current_contract
    from public.contracts as contract
   where contract.id = p_contract_id
     and contract.org_id = p_org_id
     and exists (
       select 1
         from public.user_organizations as membership
        where membership.user_id = p_uploaded_by
          and membership.org_id = p_org_id
     )
   for update;

  if not found then
    raise exception 'contract was not found for this uploader' using errcode = 'P0002';
  end if;

  select version.*
    into existing_version
    from public.contract_versions as version
   where version.id = existing_version.id
     and version.upload_id = p_upload_id
   for update;
  if not found
     or existing_version.ingest_status is distinct from 'FAILED'
     or existing_version.ingest_error is distinct from 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE' then
    raise exception 'failed source recovery state changed while acquiring locks'
      using errcode = '23514';
  end if;

  if current_contract.updated_at is distinct from p_expected_updated_at
     or current_contract.storage_path is distinct from p_expected_storage_path then
    raise exception 'contract source changed during recovery' using errcode = '23514';
  end if;
  if current_contract.current_version_id is distinct from existing_version.id
     or current_contract.storage_path is distinct from existing_version.storage_path
     or current_contract.size::bigint is distinct from existing_version.file_size
     or current_contract.mime_type is distinct from existing_version.mime_type
     or current_contract.parsed_text is distinct from existing_version.parsed_text then
    raise exception 'failed source is no longer the exact current projection'
      using errcode = '23514';
  end if;
  if existing_version.contract_id is distinct from p_contract_id
     or existing_version.source not in ('original', 'manual_revision')
     or existing_version.storage_path is distinct from p_storage_path
     or existing_version.file_size is distinct from p_file_size
     or existing_version.mime_type is distinct from p_mime_type
     or existing_version.file_sha256 is distinct from p_file_sha256
     or existing_version.text_sha256 is distinct from p_text_sha256
     or existing_version.parsed_text is distinct from p_parsed_text
     or existing_version.upload_id is distinct from p_upload_id
     or existing_version.uploaded_by is null then
    raise exception 'failed source recovery cannot rewrite immutable source facts'
      using errcode = '23514';
  end if;
  -- This table is optional in the clean release lineage. Dynamic SQL after a
  -- to_regclass guard avoids a parse-time dependency while preserving the lock
  -- whenever the richer submission-batch schema is present.
  if pg_catalog.to_regclass('public.contract_review_submission_batches') is not null then
    execute $sql$
      select exists (
        select 1
          from public.contract_review_submission_batches as batch
         where batch.contract_id = $1
           and batch.status in ('checking', 'review_running')
      )
    $sql$
      into active_submission_batch
      using p_contract_id;
  end if;

  if current_contract.status in ('PARSING', 'ANALYZING')
     or exists (
       select 1
         from public.contract_analysis_jobs as job
         join public.contract_reviews as review on review.id = job.review_id
        where review.contract_version_id = existing_version.id
          and job.status in ('preparing', 'queued', 'running')
     )
     or active_submission_batch then
    raise exception 'failed source is locked by an active review'
      using errcode = '55000';
  end if;

  -- A mismatch created by 235000 is derived and replaceable. Matching evidence
  -- remains immutable; this delete cannot erase a valid page-map snapshot.
  delete from public.contract_source_page_map_evidence as evidence
   where evidence.contract_version_id = existing_version.id
     and (
       evidence.contract_id is distinct from existing_version.contract_id
       or evidence.storage_path is distinct from existing_version.storage_path
       or evidence.source_hash is distinct from existing_version.file_sha256
       or evidence.source_text_hash is distinct from existing_version.text_sha256
     );

  update public.contract_versions
     set ingest_status = 'SOURCE_READY',
         ingest_error = null
   where id = existing_version.id;

  update public.contracts
     set status = 'PENDING',
         ocr_status = 'COMPLETED',
         ocr_result = pg_catalog.jsonb_build_object(
           'raw_text', p_parsed_text,
           'source', case when p_mime_type = 'application/pdf'
             then 'provisional-pdf-text'
             else 'ooxml-current-body'
           end,
           'source_hash', p_file_sha256,
           'source_text_hash', p_text_sha256,
           'completed_at', now_value
         ),
         updated_at = now_value
   where id = p_contract_id;

  insert into public.contract_source_page_maps (
    contract_id,
    contract_version_id,
    storage_path,
    source_hash,
    source_text_hash,
    render_mode,
    page_count,
    locator,
    page_map,
    generated_at
  ) values (
    p_contract_id,
    existing_version.id,
    p_storage_path,
    p_file_sha256,
    p_text_sha256,
    p_render_mode,
    p_page_count,
    p_locator,
    p_page_map,
    now_value
  )
  on conflict (contract_id) do update
    set contract_version_id = excluded.contract_version_id,
        storage_path = excluded.storage_path,
        source_hash = excluded.source_hash,
        source_text_hash = excluded.source_text_hash,
        render_mode = excluded.render_mode,
        page_count = excluded.page_count,
        locator = excluded.locator,
        page_map = excluded.page_map,
        generated_at = excluded.generated_at;

  return query select existing_version.id,
                      'SOURCE_READY'::text,
                      existing_version.version_number,
                      existing_version.source,
                      true;
end
$function$;

revoke all on function public.finalize_contract_source_version(
  uuid, uuid, uuid, uuid, timestamptz, text, text, text, bigint, text,
  text, text, text, text, text, text, text, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_contract_source_version(
  uuid, uuid, uuid, uuid, timestamptz, text, text, text, bigint, text,
  text, text, text, text, text, text, text, integer, jsonb
) to service_role;

-- Validate source truth before every existing-review return path. Invalidated
-- legacy initial runs no longer occupy the initial_upload uniqueness slot, so
-- a recovered source gets a new ReviewRun instead of rewriting old evidence.
create or replace function public.start_initial_contract_review(
  p_org_id uuid,
  p_contract_id uuid,
  p_contract_version_id uuid,
  p_requested_by uuid,
  p_expected_contract_status text,
  p_strategy_id uuid
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
  current_page_map public.contract_source_page_maps%rowtype;
  existing_review public.contract_reviews%rowtype;
  existing_job public.contract_analysis_jobs%rowtype;
  created_review_id uuid;
  created_job_id uuid;
  stable_start_request_id uuid;
  now_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_org_id is null
     or p_contract_id is null
     or p_contract_version_id is null
     or p_requested_by is null then
    raise exception 'complete initial review identity is required' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_contract_version_id::text, 0)
  );

  select contract.*
    into current_contract
    from public.contracts as contract
   where contract.id = p_contract_id
     and contract.org_id = p_org_id
   for update;
  if not found then
    raise exception 'contract was not found in the organization' using errcode = 'P0002';
  end if;

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
  stable_start_request_id := coalesce(current_version.upload_id, current_version.id);

  -- This common validation deliberately precedes the existing ReviewRun lookup.
  if not private.wp04_contract_source_version_ready_truth(current_version.id) then
    raise exception 'current source version is not ready for review'
      using errcode = '23514';
  end if;

  select page_map.*
    into current_page_map
    from public.contract_source_page_maps as page_map
   where page_map.contract_id = p_contract_id
     and page_map.contract_version_id = current_version.id
     and page_map.storage_path = current_version.storage_path
     and page_map.source_hash = current_version.file_sha256
     and page_map.source_text_hash = current_version.text_sha256
   for share;
  if not found then
    raise exception 'current source page map is not ready for review'
      using errcode = '23514';
  end if;

  if p_strategy_id is not null and not exists (
    select 1
      from public.review_strategies as strategy
     where strategy.id = p_strategy_id
       and (strategy.org_id is null or strategy.org_id = p_org_id)
  ) then
    raise exception 'review strategy does not belong to the organization'
      using errcode = '23514';
  end if;

  select review.*
    into existing_review
    from public.contract_reviews as review
   where review.contract_version_id = current_version.id
     and review.review_trigger = 'initial_upload'
   order by review.created_at desc nulls last, review.id desc
   limit 1
   for update;

  if found then
    if existing_review.source_storage_path is distinct from current_version.storage_path
       or existing_review.source_hash is distinct from current_version.file_sha256
       or existing_review.source_text_hash is distinct from current_version.text_sha256 then
      raise exception 'existing initial review source identity is stale'
        using errcode = '23514';
    end if;

    select job.*
      into existing_job
      from public.contract_analysis_jobs as job
     where job.review_id = existing_review.id
     limit 1
     for update;

    if not found or existing_job.status = 'failed' then
      if current_contract.status is distinct from p_expected_contract_status
         or current_contract.status not in ('PENDING', 'FAILED') then
        raise exception 'contract status changed before initial review recovery'
          using errcode = '23514';
      end if;
    end if;

    if not found then
      insert into public.contract_analysis_jobs (
        contract_id,
        review_id,
        requested_by,
        start_request_id,
        status,
        updated_at
      ) values (
        p_contract_id,
        existing_review.id,
        p_requested_by,
        stable_start_request_id,
        'queued',
        now_value
      ) returning id into created_job_id;
      update public.contracts
         set status = 'PARSING', updated_at = now_value
       where id = p_contract_id;
      update public.contract_reviews
         set status = 'PARSING', completed_at = null
       where id = existing_review.id;
      return query select existing_review.id,
                          created_job_id,
                          'PARSING'::text,
                          'queued'::text,
                          true,
                          true;
      return;
    end if;

    if existing_job.status = 'failed' then
      update public.contract_analysis_jobs
         set status = 'queued',
             requested_by = p_requested_by,
             start_request_id = coalesce(
               existing_job.start_request_id,
               stable_start_request_id
             ),
             last_error = null,
             degraded = false,
             locked_at = null,
             lock_token = null,
             locked_by = null,
             started_at = null,
             completed_at = null,
             updated_at = now_value
       where id = existing_job.id;
      update public.contract_reviews
         set status = 'PARSING', results = null, completed_at = null
       where id = existing_review.id;
      update public.contracts
         set status = 'PARSING', updated_at = now_value
       where id = p_contract_id;
      return query select existing_review.id,
                          existing_job.id,
                          'PARSING'::text,
                          'queued'::text,
                          true,
                          true;
      return;
    end if;

    return query select existing_review.id,
                        existing_job.id,
                        existing_review.status,
                        existing_job.status,
                        false,
                        true;
    return;
  end if;

  if current_contract.status is distinct from p_expected_contract_status
     or current_contract.status not in ('PENDING', 'FAILED') then
    raise exception 'contract status changed before initial review setup'
      using errcode = '23514';
  end if;

  insert into public.contract_reviews (
    contract_id,
    contract_version_id,
    status,
    started_at,
    strategy_id,
    review_trigger,
    source_storage_path,
    source_hash,
    source_text_hash
  ) values (
    p_contract_id,
    current_version.id,
    'PARSING',
    now_value,
    p_strategy_id,
    'initial_upload',
    current_version.storage_path,
    current_version.file_sha256,
    current_version.text_sha256
  ) returning id into created_review_id;

  insert into public.contract_analysis_jobs (
    contract_id,
    review_id,
    requested_by,
    start_request_id,
    status,
    updated_at
  ) values (
    p_contract_id,
    created_review_id,
    p_requested_by,
    stable_start_request_id,
    'queued',
    now_value
  ) returning id into created_job_id;

  update public.contracts
     set status = 'PARSING', updated_at = now_value
   where id = p_contract_id;

  return query select created_review_id,
                      created_job_id,
                      'PARSING'::text,
                      'queued'::text,
                      true,
                      false;
end
$function$;

revoke all on function public.start_initial_contract_review(
  uuid, uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.start_initial_contract_review(
  uuid, uuid, uuid, uuid, text, uuid
) to service_role;

commit;
