set lock_timeout = '5s';
set statement_timeout = '30s';

-- Legacy Preview fixtures may contain a whitespace-normalized Word projection
-- even though the immutable source object is correct. Never weaken source
-- verification to accept that ambiguity. This narrow, service-only repair
-- preserves the exact prior projection and page-map snapshot before replacing
-- both identities atomically with a freshly extracted current-body projection.
create table public.contract_source_text_repair_audits (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  contract_id uuid not null,
  org_id uuid not null,
  source_storage_path text not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  source_size_bytes bigint not null check (source_size_bytes > 0),
  source_filename text not null,
  source_mime_type text not null,
  old_source_text_hash text not null check (old_source_text_hash ~ '^[0-9a-f]{64}$'),
  new_source_text_hash text not null check (new_source_text_hash ~ '^[0-9a-f]{64}$'),
  whitespace_stripped_content_hash text not null check (whitespace_stripped_content_hash ~ '^[0-9a-f]{64}$'),
  old_parsed_text text not null,
  old_text_utf16_length integer not null check (old_text_utf16_length >= 0),
  new_text_utf16_length integer not null check (new_text_utf16_length > 0),
  old_page_map jsonb not null,
  old_page_map_hash text not null check (old_page_map_hash ~ '^[0-9a-f]{64}$'),
  new_page_map_hash text not null check (new_page_map_hash ~ '^[0-9a-f]{64}$'),
  projection_version text not null check (
    projection_version = 'word_current_body_v1_whitespace_reconciliation'
  ),
  repair_reason text not null check (
    pg_catalog.char_length(pg_catalog.btrim(repair_reason)) between 1 and 500
  ),
  actor_id uuid not null,
  failed_review_id uuid,
  created_at timestamptz not null default now(),
  unique (contract_id, source_hash, old_source_text_hash, new_source_text_hash)
);

alter table public.contract_source_text_repair_audits enable row level security;
revoke all on table public.contract_source_text_repair_audits
  from public, anon, authenticated, service_role;
grant select on table public.contract_source_text_repair_audits to service_role;

create index contract_source_text_repair_audits_contract_created_idx
  on public.contract_source_text_repair_audits (contract_id, created_at desc);

create or replace function public.reject_contract_source_text_repair_audit_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'CONTRACT_SOURCE_TEXT_REPAIR_AUDIT_IMMUTABLE' using errcode = '55000';
end;
$function$;

create trigger trg_reject_contract_source_text_repair_audit_mutation_v1
  before update or delete on public.contract_source_text_repair_audits
  for each row execute function public.reject_contract_source_text_repair_audit_mutation_v1();

revoke all on function public.reject_contract_source_text_repair_audit_mutation_v1()
  from public, anon, authenticated;
grant execute on function public.reject_contract_source_text_repair_audit_mutation_v1()
  to service_role;

create or replace function public.reconcile_word_source_text_projection_v1(
  p_request_id uuid,
  p_contract_id uuid,
  p_expected_storage_path text,
  p_expected_source_hash text,
  p_expected_old_source_text_hash text,
  p_new_parsed_text text,
  p_expected_new_source_text_hash text,
  p_projection_version text,
  p_repair_reason text,
  p_actor_id uuid,
  p_failed_review_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_contract public.contracts%rowtype;
  v_page_map public.contract_source_page_maps%rowtype;
  v_existing_audit public.contract_source_text_repair_audits%rowtype;
  v_old_source_text_hash text;
  v_new_source_text_hash text;
  v_old_non_whitespace_hash text;
  v_new_non_whitespace_hash text;
  v_old_text_utf16_length integer;
  v_new_text_utf16_length integer;
  v_new_page_map jsonb;
  v_old_page_map_hash text;
  v_new_page_map_hash text;
  v_audit_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_request_id is null then
    raise exception 'SOURCE_TEXT_REPAIR_REQUEST_ID_REQUIRED' using errcode = '23514';
  end if;
  if p_projection_version is distinct from 'word_current_body_v1_whitespace_reconciliation' then
    raise exception 'SOURCE_TEXT_REPAIR_PROJECTION_VERSION_INVALID' using errcode = '23514';
  end if;
  if p_expected_storage_path is null
     or p_expected_source_hash !~ '^[0-9a-f]{64}$'
     or p_expected_old_source_text_hash !~ '^[0-9a-f]{64}$'
     or p_expected_new_source_text_hash !~ '^[0-9a-f]{64}$'
     or p_new_parsed_text is null
     or not pg_catalog.length(pg_catalog.btrim(p_new_parsed_text)) > 0
     or p_actor_id is null
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_repair_reason, ''))) not between 1 and 500 then
    raise exception 'SOURCE_TEXT_REPAIR_ARGUMENT_INVALID' using errcode = '23514';
  end if;

  select contract.*
    into v_contract
    from public.contracts as contract
   where contract.id = p_contract_id
   for update of contract;
  if not found then
    raise exception 'SOURCE_TEXT_REPAIR_CONTRACT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if pg_catalog.lower(v_contract.filename) !~ '[.](docx|docm)$' then
    raise exception 'SOURCE_TEXT_REPAIR_WORD_FORMAT_REQUIRED' using errcode = '23514';
  end if;

  select page_map.*
    into v_page_map
    from public.contract_source_page_maps as page_map
   where page_map.contract_id = p_contract_id
   for update of page_map;
  if not found then
    raise exception 'SOURCE_TEXT_REPAIR_PAGE_MAP_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_old_source_text_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(coalesce(v_contract.parsed_text, ''), 'UTF8'), 'sha256'),
    'hex'
  );
  v_new_source_text_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_new_parsed_text, 'UTF8'), 'sha256'),
    'hex'
  );

  -- A lost RPC response is safe to retry only with the same request and CAS tuple.
  select audit.*
    into v_existing_audit
    from public.contract_source_text_repair_audits as audit
   where audit.request_id = p_request_id;
  if found then
    if v_existing_audit.contract_id is distinct from p_contract_id
       or v_existing_audit.source_storage_path is distinct from p_expected_storage_path
       or v_existing_audit.source_hash is distinct from p_expected_source_hash
       or v_existing_audit.old_source_text_hash is distinct from p_expected_old_source_text_hash
       or v_existing_audit.new_source_text_hash is distinct from p_expected_new_source_text_hash
       or v_old_source_text_hash is distinct from p_expected_new_source_text_hash
       or v_page_map.source_text_hash is distinct from p_expected_new_source_text_hash then
      raise exception 'SOURCE_TEXT_REPAIR_REQUEST_REUSE_INVALID' using errcode = '40001';
    end if;
      return pg_catalog.jsonb_build_object(
        'audit_id', v_existing_audit.id,
        'request_id', p_request_id,
        'contract_id', p_contract_id,
        'source_hash', p_expected_source_hash,
        'old_source_text_hash', p_expected_old_source_text_hash,
        'new_source_text_hash', p_expected_new_source_text_hash,
        'idempotent', true
      );
  end if;

  if v_contract.storage_path is distinct from p_expected_storage_path
     or v_page_map.storage_path is distinct from p_expected_storage_path
     or v_page_map.source_hash is distinct from p_expected_source_hash
     or v_page_map.render_mode is distinct from 'browser-ooxml'
     or v_page_map.locator is distinct from 'provisional'
     or v_old_source_text_hash is distinct from p_expected_old_source_text_hash
     or v_page_map.source_text_hash is distinct from p_expected_old_source_text_hash
     or v_new_source_text_hash is distinct from p_expected_new_source_text_hash then
    raise exception 'SOURCE_TEXT_REPAIR_COMPARE_AND_SET_FAILED' using errcode = '40001';
  end if;

  if not exists (
    select 1
      from public.organization_members as member
     where member.org_id = v_contract.org_id
       and member.user_id = p_actor_id
       and member.status = 'active'
  ) then
    raise exception 'SOURCE_TEXT_REPAIR_ACTOR_INVALID' using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.contract_analysis_jobs as job
     where job.contract_id = p_contract_id
       and job.status in ('preparing', 'queued', 'running')
  ) or exists (
    select 1
      from public.contract_reviews as review
     where review.contract_id = p_contract_id
       and review.status in ('PARSING', 'ANALYZING')
  ) or exists (
    select 1
      from public.contract_review_submission_batches as batch
     where batch.contract_id = p_contract_id
       and batch.status in ('checking', 'review_running')
  ) then
    raise exception 'SOURCE_TEXT_REPAIR_ACTIVE_REVIEW' using errcode = '55000';
  end if;

  -- Offset-bearing mutable user work must never be silently hidden by a text
  -- identity change. Historical completed ReviewRuns remain immutable evidence.
  if exists (
    select 1
      from public.contract_annotations as annotation
     where annotation.contract_id = p_contract_id
       and annotation.source_storage_path = p_expected_storage_path
       and annotation.source_hash = p_expected_source_hash
       and annotation.source_text_hash = p_expected_old_source_text_hash
  ) or exists (
    select 1
      from public.contract_review_decision_drafts as draft
     where draft.contract_id = p_contract_id
       and draft.status = 'draft_selected'
       and draft.source_storage_path = p_expected_storage_path
       and draft.source_hash = p_expected_source_hash
       and draft.source_text_hash = p_expected_old_source_text_hash
  ) then
    raise exception 'SOURCE_TEXT_REPAIR_MUTABLE_ASSETS_EXIST' using errcode = '55000';
  end if;

  if p_failed_review_id is not null and not exists (
    select 1
      from public.contract_reviews as failed_review
     where failed_review.id = p_failed_review_id
       and failed_review.contract_id = p_contract_id
       and failed_review.status = 'FAILED'
       and failed_review.source_storage_path = p_expected_storage_path
       and failed_review.source_hash = p_expected_source_hash
       and failed_review.source_text_hash = p_expected_old_source_text_hash
       and pg_catalog.cardinality(failed_review.model_invocation_ids) = 0
       and failed_review.ai_result is null
  ) then
    raise exception 'SOURCE_TEXT_REPAIR_FAILED_REVIEW_INVALID' using errcode = '23514';
  end if;

  v_old_non_whitespace_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.regexp_replace(
          pg_catalog.replace(
            pg_catalog.replace(
              pg_catalog.replace(coalesce(v_contract.parsed_text, ''), pg_catalog.chr(160), ''),
              pg_catalog.chr(8239), ''
            ),
            pg_catalog.chr(12288), ''
          ),
          '[[:space:]]+', '', 'g'
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_new_non_whitespace_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.regexp_replace(
          pg_catalog.replace(
            pg_catalog.replace(
              pg_catalog.replace(p_new_parsed_text, pg_catalog.chr(160), ''),
              pg_catalog.chr(8239), ''
            ),
            pg_catalog.chr(12288), ''
          ),
          '[[:space:]]+', '', 'g'
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if v_old_non_whitespace_hash is distinct from v_new_non_whitespace_hash then
    raise exception 'SOURCE_TEXT_REPAIR_CONTENT_CHANGED' using errcode = '23514';
  end if;

  v_old_text_utf16_length := public.contract_utf16_codeunit_length(coalesce(v_contract.parsed_text, ''));
  v_new_text_utf16_length := public.contract_utf16_codeunit_length(p_new_parsed_text);
  v_new_page_map := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'page', 1,
    'start', 0,
    'end', pg_catalog.greatest(0, v_new_text_utf16_length - 1),
    'locator', 'provisional'
  ));
  v_old_page_map_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(pg_catalog.to_jsonb(v_page_map)::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_new_page_map_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_new_page_map::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.contract_source_text_repair_audits (
    request_id,
    contract_id,
    org_id,
    source_storage_path,
    source_hash,
    source_size_bytes,
    source_filename,
    source_mime_type,
    old_source_text_hash,
    new_source_text_hash,
    whitespace_stripped_content_hash,
    old_parsed_text,
    old_text_utf16_length,
    new_text_utf16_length,
    old_page_map,
    old_page_map_hash,
    new_page_map_hash,
    projection_version,
    repair_reason,
    actor_id,
    failed_review_id,
    created_at
  ) values (
    p_request_id,
    p_contract_id,
    v_contract.org_id,
    p_expected_storage_path,
    p_expected_source_hash,
    v_contract.size,
    v_contract.filename,
    v_contract.mime_type,
    p_expected_old_source_text_hash,
    p_expected_new_source_text_hash,
    v_new_non_whitespace_hash,
    v_contract.parsed_text,
    v_old_text_utf16_length,
    v_new_text_utf16_length,
    pg_catalog.to_jsonb(v_page_map),
    v_old_page_map_hash,
    v_new_page_map_hash,
    p_projection_version,
    pg_catalog.btrim(p_repair_reason),
    p_actor_id,
    p_failed_review_id,
    v_now
  ) returning id into v_audit_id;

  update public.contracts
     set parsed_text = p_new_parsed_text,
         updated_at = v_now
   where id = p_contract_id;

  update public.contract_source_page_maps
     set source_text_hash = p_expected_new_source_text_hash,
         render_mode = 'browser-ooxml',
         page_count = 1,
         locator = 'provisional',
         page_map = v_new_page_map,
         generated_at = v_now
   where contract_id = p_contract_id;

  return pg_catalog.jsonb_build_object(
    'audit_id', v_audit_id,
    'request_id', p_request_id,
    'contract_id', p_contract_id,
    'source_hash', p_expected_source_hash,
    'old_source_text_hash', p_expected_old_source_text_hash,
    'new_source_text_hash', p_expected_new_source_text_hash,
    'old_text_utf16_length', v_old_text_utf16_length,
    'new_text_utf16_length', v_new_text_utf16_length,
    'idempotent', false
  );
end;
$function$;

revoke all on function public.reconcile_word_source_text_projection_v1(
  uuid, uuid, text, text, text, text, text, text, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.reconcile_word_source_text_projection_v1(
  uuid, uuid, text, text, text, text, text, text, text, uuid, uuid
) to service_role;

comment on table public.contract_source_text_repair_audits is
  'Append-only rollback and provenance evidence for exact Word source-text projection repairs.';
