begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Contract sources are immutable private objects. Application users upload and
-- download through organization-scoped API routes; they never receive direct
-- bucket-wide CRUD. Legacy DOC is accepted only for original preservation and
-- is finalized as AWAITING_CONVERSION, never as a reviewable source.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contracts',
  'contracts',
  false,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-word.document.macroEnabled.12'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets
   set public = false
 where id = 'contract-chunks';

-- Remove the historical policies that granted every authenticated user all
-- operations across both buckets. The server-side service role is the only
-- Storage actor in the current product code and continues to bypass RLS.
drop policy if exists "contract buckets read" on storage.objects;
drop policy if exists "contract buckets insert" on storage.objects;
drop policy if exists "contract buckets update" on storage.objects;
drop policy if exists "contract buckets delete" on storage.objects;

-- WP04 treats ContractVersion as the source-ingestion aggregate.  Storage is
-- committed before this transaction, but one upload UUID can finalize exactly
-- one version and can be recovered safely after an ambiguous HTTP response.
alter table public.contract_versions
  add column if not exists upload_id uuid,
  add column if not exists file_sha256 text,
  add column if not exists text_sha256 text,
  add column if not exists parsed_text text,
  add column if not exists ingest_status text,
  add column if not exists ingest_error text;

-- The table existed in the protected G5 snapshot but was absent from the clean
-- recovery lineage.  Recreate only the current-source identity contract here
-- before using it for legacy status reconciliation.
create table if not exists public.contract_source_page_maps (
  contract_id uuid primary key references public.contracts(id) on delete cascade,
  storage_path text not null,
  source_hash text not null,
  source_text_hash text,
  render_mode text not null,
  page_count integer not null,
  locator text not null,
  page_map jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now()
);

alter table public.contract_source_page_maps
  add column if not exists source_text_hash text;

update public.contract_versions as version
   set ingest_status = case
     when version.source = 'review_revision' then 'SOURCE_READY'
     when lower(coalesce(version.mime_type, '')) = 'application/msword'
       then 'AWAITING_CONVERSION'
     when exists (
       select 1
         from public.contract_source_page_maps as page_map
        where page_map.contract_id = version.contract_id
          and page_map.storage_path = version.storage_path
          and coalesce(page_map.source_text_hash, '') ~ '^[0-9a-f]{64}$'
     ) then 'SOURCE_READY'
     else 'FILE_STORED'
   end
 where version.ingest_status is null;

update public.contract_versions
   set ingest_error = 'LEGACY_DOC_REQUIRES_CONVERSION'
 where ingest_status = 'AWAITING_CONVERSION'
   and ingest_error is null;

alter table public.contract_versions
  alter column ingest_status set default 'FILE_STORED',
  alter column ingest_status set not null;

alter table public.contract_versions
  drop constraint if exists contract_versions_ingest_status_check;
alter table public.contract_versions
  add constraint contract_versions_ingest_status_check
  check (ingest_status in (
    'UPLOADING',
    'FILE_STORED',
    'READING_SOURCE',
    'AWAITING_OCR',
    'AWAITING_CONVERSION',
    'SOURCE_READY',
    'FAILED'
  ));

alter table public.contract_versions
  drop constraint if exists contract_versions_file_sha256_check;
alter table public.contract_versions
  add constraint contract_versions_file_sha256_check
  check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$');

alter table public.contract_versions
  drop constraint if exists contract_versions_text_sha256_check;
alter table public.contract_versions
  add constraint contract_versions_text_sha256_check
  check (text_sha256 is null or text_sha256 ~ '^[0-9a-f]{64}$');

create unique index if not exists uq_contract_versions_upload_id
  on public.contract_versions(upload_id)
  where upload_id is not null;

create unique index if not exists uq_contract_versions_contract_storage_path
  on public.contract_versions(contract_id, storage_path);

alter table public.contracts
  add column if not exists current_version_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.contracts'::regclass
       and conname = 'contracts_current_version_id_fkey'
  ) then
    alter table public.contracts
      add constraint contracts_current_version_id_fkey
      foreign key (current_version_id)
      references public.contract_versions(id)
      on delete set null;
  end if;
end
$$;

update public.contracts as contract
   set current_version_id = (
     select version.id
       from public.contract_versions as version
      where version.contract_id = contract.id
        and version.source <> 'review_revision'
      order by
        (version.storage_path = contract.storage_path) desc,
        version.version_number desc,
        version.created_at desc nulls last
      limit 1
   )
 where contract.current_version_id is null
   and exists (
     select 1
       from public.contract_versions as version
      where version.contract_id = contract.id
        and version.source <> 'review_revision'
   );

alter table public.contract_source_page_maps
  add column if not exists source_text_hash text,
  add column if not exists contract_version_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.contract_source_page_maps'::regclass
       and conname = 'contract_source_page_maps_contract_version_id_fkey'
  ) then
    alter table public.contract_source_page_maps
      add constraint contract_source_page_maps_contract_version_id_fkey
      foreign key (contract_version_id)
      references public.contract_versions(id)
      on delete cascade;
  end if;
end
$$;

update public.contract_source_page_maps as page_map
   set contract_version_id = version.id
  from public.contract_versions as version
 where page_map.contract_version_id is null
   and version.contract_id = page_map.contract_id
   and version.storage_path = page_map.storage_path;

alter table public.contract_source_page_maps
  drop constraint if exists contract_source_page_maps_source_hash_check;
alter table public.contract_source_page_maps
  add constraint contract_source_page_maps_source_hash_check
  check (source_hash ~ '^[0-9a-f]{64}$');

alter table public.contract_source_page_maps
  drop constraint if exists contract_source_page_maps_source_text_hash_check;
alter table public.contract_source_page_maps
  add constraint contract_source_page_maps_source_text_hash_check
  check (source_text_hash is null or source_text_hash ~ '^[0-9a-f]{64}$');

alter table public.contract_source_page_maps
  drop constraint if exists contract_source_page_maps_render_mode_check;
alter table public.contract_source_page_maps
  add constraint contract_source_page_maps_render_mode_check
  check (render_mode in (
    'native-pdf',
    'browser-ooxml',
    'identity-only',
    'docx-to-pdf',
    'word-to-pdf'
  ));

alter table public.contract_source_page_maps
  drop constraint if exists contract_source_page_maps_page_count_check;
alter table public.contract_source_page_maps
  add constraint contract_source_page_maps_page_count_check
  check (page_count > 0);

alter table public.contract_source_page_maps
  drop constraint if exists contract_source_page_maps_locator_check;
alter table public.contract_source_page_maps
  add constraint contract_source_page_maps_locator_check
  check (locator in ('rendered', 'provisional'));

create unique index if not exists uq_contract_source_page_maps_version
  on public.contract_source_page_maps(contract_version_id)
  where contract_version_id is not null;

alter table public.contract_source_page_maps enable row level security;
revoke all on table public.contract_source_page_maps from public, anon, authenticated;
grant select, insert, update, delete on table public.contract_source_page_maps to service_role;

-- Page maps are not independent cache rows. They are the auditable locator for
-- the contract's current source version, so reject any service-side write that
-- tries to publish a stale path, version or hash outside the finalize RPC.
create or replace function public.enforce_current_contract_page_map_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_storage_path text;
  current_version_id uuid;
  current_file_hash text;
  current_text_hash text;
  projected_text_hash text;
begin
  select contract.storage_path,
         contract.current_version_id,
         source_version.file_sha256,
         source_version.text_sha256,
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(coalesce(contract.parsed_text, ''), 'UTF8'), 'sha256'),
           'hex'
         )
    into current_storage_path,
         current_version_id,
         current_file_hash,
         current_text_hash,
         projected_text_hash
    from public.contracts as contract
    join public.contract_versions as source_version
      on source_version.id = contract.current_version_id
     and source_version.contract_id = contract.id
   where contract.id = new.contract_id
   for share of contract, source_version;

  if not found then
    raise exception 'contract current source version no longer exists'
      using errcode = '40001';
  end if;
  if new.contract_version_id is distinct from current_version_id
     or new.storage_path is distinct from current_storage_path
     or new.source_hash is distinct from current_file_hash
     or new.source_text_hash is distinct from current_text_hash
     or new.source_text_hash is distinct from projected_text_hash then
    raise exception 'contract page map source is not current'
      using errcode = '40001';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_current_contract_page_map_source()
  from public, anon, authenticated;
grant execute on function public.enforce_current_contract_page_map_source()
  to service_role;

drop trigger if exists trg_contract_page_map_current_source
  on public.contract_source_page_maps;
create trigger trg_contract_page_map_current_source
before insert or update of contract_id, contract_version_id, storage_path, source_hash, source_text_hash
on public.contract_source_page_maps
for each row execute function public.enforce_current_contract_page_map_source();

alter table public.contract_reviews
  add column if not exists contract_version_id uuid,
  add column if not exists source_storage_path text,
  add column if not exists source_hash text,
  add column if not exists source_text_hash text;

alter table public.contract_reviews
  drop constraint if exists contract_reviews_review_trigger_check;
alter table public.contract_reviews
  add constraint contract_reviews_review_trigger_check
  check (
    review_trigger is null
    or review_trigger in ('direct', 'decision_batch', 'initial_upload')
  ) not valid;

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.contract_reviews'::regclass
       and conname = 'contract_reviews_contract_version_id_fkey'
  ) then
    alter table public.contract_reviews
      add constraint contract_reviews_contract_version_id_fkey
      foreign key (contract_version_id)
      references public.contract_versions(id)
      on delete restrict;
  end if;
end
$$;

update public.contract_reviews as review
   set contract_version_id = (
     select candidate.id
       from public.contract_versions as candidate
      where candidate.contract_id = review.contract_id
        and candidate.source <> 'review_revision'
        and candidate.storage_path = review.source_storage_path
      order by candidate.version_number desc
      limit 1
   )
 where review.contract_version_id is null
   and review.source_storage_path is not null
   and exists (
     select 1
       from public.contract_versions as candidate
      where candidate.contract_id = review.contract_id
        and candidate.source <> 'review_revision'
        and candidate.storage_path = review.source_storage_path
   );

create unique index if not exists uq_contract_reviews_initial_source_version
  on public.contract_reviews(contract_version_id)
  where contract_version_id is not null
    and review_trigger = 'initial_upload';

alter table public.contract_analysis_jobs
  add column if not exists start_request_id uuid,
  add column if not exists lock_token uuid,
  add column if not exists locked_by text;

-- Some reconstructed baselines already carry the same unique partial index
-- under the older idx_ name. Keep one canonical index instead of paying for
-- two identical write paths.
drop index if exists public.idx_contract_analysis_jobs_start_request;
create unique index if not exists uq_contract_analysis_jobs_start_request
  on public.contract_analysis_jobs(start_request_id)
  where start_request_id is not null;

-- Atomically turns one immutable Storage object into one source version and
-- current source identity.  Replaying the same upload UUID returns the same
-- version; a different concurrent upload must pass the original CAS values.
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
as $$
declare
  current_contract public.contracts%rowtype;
  existing_version public.contract_versions%rowtype;
  next_version_number integer;
  next_source text;
  next_parent_version_id uuid;
  created_version_id uuid;
  upload_digest bytea;
  upload_hex text;
  expected_upload_id uuid;
begin
  if p_org_id is null or p_contract_id is null or p_uploaded_by is null or p_upload_id is null then
    raise exception 'complete upload identity is required' using errcode = '23514';
  end if;
  if coalesce(p_storage_path, '') = ''
     or coalesce(p_filename, '') = ''
     or p_file_size is null
     or p_file_size < 1
     or p_file_size > 52428800
     or coalesce(p_file_sha256, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_mime_type, '') not in (
       'application/pdf',
       'application/msword',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.ms-word.document.macroEnabled.12'
     ) then
    raise exception 'invalid finalized source metadata' using errcode = '23514';
  end if;

  upload_digest := pg_catalog.substring(
    extensions.digest(
      pg_catalog.convert_to(
        'contract-source:' || pg_catalog.lower(p_contract_id::text) || ':'
          || pg_catalog.lower(p_file_sha256),
        'UTF8'
      ),
      'sha256'
    ),
    1,
    16
  );
  upload_digest := pg_catalog.set_byte(
    upload_digest,
    6,
    (pg_catalog.get_byte(upload_digest, 6) & 15) | 128
  );
  upload_digest := pg_catalog.set_byte(
    upload_digest,
    8,
    (pg_catalog.get_byte(upload_digest, 8) & 63) | 128
  );
  upload_hex := pg_catalog.encode(upload_digest, 'hex');
  expected_upload_id := (
    pg_catalog.substr(upload_hex, 1, 8) || '-' ||
    pg_catalog.substr(upload_hex, 9, 4) || '-' ||
    pg_catalog.substr(upload_hex, 13, 4) || '-' ||
    pg_catalog.substr(upload_hex, 17, 4) || '-' ||
    pg_catalog.substr(upload_hex, 21, 12)
  )::uuid;
  if p_upload_id is distinct from expected_upload_id
     or p_storage_path is distinct from (
       p_contract_id::text || '/' || expected_upload_id::text || '/source'
     ) then
    raise exception 'upload id is not bound to contract and file hash' using errcode = '23514';
  end if;

  if coalesce(p_ingest_status, '') not in (
    'SOURCE_READY',
    'AWAITING_OCR',
    'AWAITING_CONVERSION'
  ) then
    raise exception 'finalization requires a terminal ingestion state' using errcode = '23514';
  end if;
  if p_ingest_status = 'SOURCE_READY' and (
    coalesce(p_parsed_text, '') = ''
    or coalesce(p_text_sha256, '') !~ '^[0-9a-f]{64}$'
    or p_text_sha256 is distinct from pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(p_parsed_text, 'UTF8'), 'sha256'),
      'hex'
    )
    or p_mime_type = 'application/msword'
    or coalesce(p_render_mode, '') not in ('native-pdf', 'browser-ooxml')
    or coalesce(p_locator, '') not in ('rendered', 'provisional')
    or coalesce(p_page_count, 0) < 1
    or pg_catalog.jsonb_typeof(coalesce(p_page_map, 'null'::jsonb)) <> 'array'
    or pg_catalog.jsonb_array_length(p_page_map) <> p_page_count
    or p_ingest_error is not null
  ) then
    raise exception 'ready source requires matching text hash and page map' using errcode = '23514';
  end if;
  if p_ingest_status = 'AWAITING_OCR' and (
    p_mime_type is distinct from 'application/pdf'
    or coalesce(pg_catalog.btrim(p_ingest_error), '') = ''
    or p_ingest_error is distinct from 'PDF_TEXT_UNAVAILABLE'
    or p_parsed_text is not null
    or p_text_sha256 is not null
    or p_render_mode is not null
    or p_locator is not null
    or p_page_count is not null
    or p_page_map is not null
  ) then
    raise exception 'OCR waiting state must not publish a reviewable identity' using errcode = '23514';
  end if;
  if p_ingest_status = 'AWAITING_CONVERSION' and (
    p_mime_type is distinct from 'application/msword'
    or coalesce(pg_catalog.btrim(p_ingest_error), '') = ''
    or p_ingest_error is distinct from 'LEGACY_DOC_REQUIRES_CONVERSION'
    or p_parsed_text is not null
    or p_text_sha256 is not null
    or p_render_mode is not null
    or p_locator is not null
    or p_page_count is not null
    or p_page_map is not null
  ) then
    raise exception 'legacy DOC must wait for conversion without a review identity' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_upload_id::text, 0));

  select version.*
    into existing_version
    from public.contract_versions as version
   where version.upload_id = p_upload_id;
  if found then
    if existing_version.contract_id is distinct from p_contract_id
       or existing_version.storage_path is distinct from p_storage_path
       or existing_version.file_sha256 is distinct from p_file_sha256
       or existing_version.ingest_status is distinct from p_ingest_status then
      raise exception 'upload id is already bound to another source result' using errcode = '23505';
    end if;
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
     for share;
    if not found
       or current_contract.current_version_id is distinct from existing_version.id
       or current_contract.storage_path is distinct from existing_version.storage_path then
      raise exception 'recovered upload is no longer the current source version' using errcode = '40001';
    end if;
    return query select existing_version.id, existing_version.ingest_status,
      existing_version.version_number, existing_version.source, true;
    return;
  end if;

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
  if current_contract.status in ('PARSING', 'ANALYZING') then
    raise exception 'contract source is locked by an active review' using errcode = '55000';
  end if;
  if current_contract.updated_at is distinct from p_expected_updated_at
     or coalesce(current_contract.storage_path, '') is distinct from coalesce(p_expected_storage_path, '') then
    raise exception 'contract source changed during upload' using errcode = '40001';
  end if;

  select coalesce(max(version.version_number), 0) + 1
    into next_version_number
    from public.contract_versions as version
   where version.contract_id = p_contract_id;
  next_parent_version_id := current_contract.current_version_id;
  next_source := case when next_parent_version_id is null then 'original' else 'manual_revision' end;

  insert into public.contract_versions (
    contract_id,
    version_number,
    source,
    storage_path,
    file_size,
    mime_type,
    parent_version_id,
    change_summary,
    uploaded_by,
    upload_id,
    file_sha256,
    text_sha256,
    parsed_text,
    ingest_status,
    ingest_error
  ) values (
    p_contract_id,
    next_version_number,
    next_source,
    p_storage_path,
    p_file_size,
    p_mime_type,
    next_parent_version_id,
    case when next_source = 'original' then '首次上传源文件' else '上传新源文件版本' end,
    p_uploaded_by,
    p_upload_id,
    p_file_sha256,
    p_text_sha256,
    p_parsed_text,
    p_ingest_status,
    p_ingest_error
  ) returning id into created_version_id;

  update public.contracts
     set filename = p_filename,
         storage_path = p_storage_path,
         size = p_file_size::integer,
         mime_type = p_mime_type,
         parsed_text = p_parsed_text,
         ocr_status = case when p_ingest_status = 'AWAITING_OCR' then 'PENDING' else 'COMPLETED' end,
         ocr_result = case
           when p_ingest_status = 'SOURCE_READY' then pg_catalog.jsonb_build_object(
             'raw_text', p_parsed_text,
             'source', case when p_mime_type = 'application/pdf'
               then 'provisional-pdf-text'
               else 'ooxml-current-body'
             end,
             'source_hash', p_file_sha256,
             'source_text_hash', p_text_sha256,
             'completed_at', pg_catalog.clock_timestamp()
           )
           when p_ingest_status = 'AWAITING_OCR' then pg_catalog.jsonb_build_object(
             'source', 'awaiting-ocr',
             'source_hash', p_file_sha256,
             'reason', p_ingest_error,
             'queued_at', pg_catalog.clock_timestamp()
           )
           else pg_catalog.jsonb_build_object(
             'source', 'awaiting-conversion',
             'source_hash', p_file_sha256,
             'reason', p_ingest_error,
             'saved_at', pg_catalog.clock_timestamp()
           )
         end,
         status = case when p_ingest_status = 'SOURCE_READY' then 'PENDING' else 'DRAFT' end,
         current_version_id = created_version_id,
         updated_at = pg_catalog.clock_timestamp()
   where id = p_contract_id;

  if p_ingest_status = 'SOURCE_READY' then
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
      created_version_id,
      p_storage_path,
      p_file_sha256,
      p_text_sha256,
      p_render_mode,
      p_page_count,
      p_locator,
      p_page_map,
      pg_catalog.clock_timestamp()
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
  else
    delete from public.contract_source_page_maps
     where contract_id = p_contract_id;
  end if;

  return query select created_version_id, p_ingest_status, next_version_number, next_source, false;
end;
$$;

revoke all on function public.finalize_contract_source_version(
  uuid, uuid, uuid, uuid, timestamptz, text, text, text, bigint, text,
  text, text, text, text, text, text, text, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_contract_source_version(
  uuid, uuid, uuid, uuid, timestamptz, text, text, text, bigint, text,
  text, text, text, text, text, text, text, integer, jsonb
) to service_role;

-- Creates or recovers the one initial ReviewRun for the current source version.
-- A failed infrastructure attempt is requeued on the same review/job identity;
-- business re-review continues to use the separate review-runs endpoint.
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
as $$
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
  if p_org_id is null or p_contract_id is null or p_contract_version_id is null or p_requested_by is null then
    raise exception 'complete initial review identity is required' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_contract_version_id::text, 0));

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
  if not found or current_contract.current_version_id is distinct from current_version.id then
    raise exception 'review source version is not current' using errcode = '40001';
  end if;
  stable_start_request_id := coalesce(current_version.upload_id, current_version.id);

  select review.*
    into existing_review
    from public.contract_reviews as review
   where review.contract_version_id = current_version.id
     and review.review_trigger = 'initial_upload'
   order by review.created_at desc nulls last
   limit 1
   for update;

  if found then
    select job.*
      into existing_job
      from public.contract_analysis_jobs as job
     where job.review_id = existing_review.id
     limit 1
     for update;

    if not found then
      insert into public.contract_analysis_jobs (
        contract_id, review_id, requested_by, start_request_id, status, updated_at
      ) values (
        p_contract_id, existing_review.id, p_requested_by, stable_start_request_id, 'queued', now_value
      ) returning id into created_job_id;
      update public.contracts set status = 'PARSING', updated_at = now_value where id = p_contract_id;
      update public.contract_reviews set status = 'PARSING', completed_at = null where id = existing_review.id;
      return query select existing_review.id, created_job_id, 'PARSING'::text, 'queued'::text, true, true;
      return;
    end if;

    if existing_job.status = 'failed' then
      update public.contract_analysis_jobs
         set status = 'queued',
             requested_by = p_requested_by,
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
      update public.contracts set status = 'PARSING', updated_at = now_value where id = p_contract_id;
      return query select existing_review.id, existing_job.id, 'PARSING'::text, 'queued'::text, true, true;
      return;
    end if;

    return query select existing_review.id, existing_job.id, existing_review.status,
      existing_job.status, false, true;
    return;
  end if;

  if current_contract.status is distinct from p_expected_contract_status
     or current_contract.status not in ('PENDING', 'FAILED') then
    raise exception 'contract status changed before initial review setup' using errcode = '40001';
  end if;
  if current_version.ingest_status <> 'SOURCE_READY'
     or current_version.storage_path is distinct from current_contract.storage_path
     or coalesce(current_version.file_sha256, '') !~ '^[0-9a-f]{64}$'
     or coalesce(current_version.text_sha256, '') !~ '^[0-9a-f]{64}$'
     or current_version.parsed_text is distinct from current_contract.parsed_text
     or current_version.text_sha256 is distinct from pg_catalog.encode(
       extensions.digest(pg_catalog.convert_to(coalesce(current_contract.parsed_text, ''), 'UTF8'), 'sha256'),
       'hex'
     ) then
    raise exception 'current source version is not ready for review' using errcode = '23514';
  end if;

  select page_map.*
    into current_page_map
    from public.contract_source_page_maps as page_map
   where page_map.contract_id = p_contract_id
     and page_map.contract_version_id = current_version.id
     and page_map.storage_path = current_version.storage_path
   for share;
  if not found
     or current_page_map.source_hash is distinct from current_version.file_sha256
     or current_page_map.source_text_hash is distinct from current_version.text_sha256 then
    raise exception 'current source page map is not ready for review' using errcode = '23514';
  end if;
  if p_strategy_id is not null and not exists (
    select 1
      from public.review_strategies as strategy
     where strategy.id = p_strategy_id
       and (strategy.org_id is null or strategy.org_id = p_org_id)
  ) then
    raise exception 'review strategy does not belong to the organization' using errcode = '23514';
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

  return query select created_review_id, created_job_id, 'PARSING'::text,
    'queued'::text, true, false;
end;
$$;

revoke all on function public.start_initial_contract_review(uuid, uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.start_initial_contract_review(uuid, uuid, uuid, uuid, text, uuid)
  to service_role;

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
  if p_job_id is null or coalesce(btrim(p_worker_id), '') = '' or p_lock_token is null then
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
         last_error = null,
         updated_at = pg_catalog.clock_timestamp()
   where job.id = p_job_id
     and job.status = 'queued'
  returning job.*;
end;
$$;

revoke all on function public.claim_contract_analysis_job_by_id(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_contract_analysis_job_by_id(uuid, text, uuid)
  to service_role;

commit;
