begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The first WP04 ingestion migration reconstructed legacy rows too
-- optimistically: every review_revision became SOURCE_READY, a loose page-map
-- match could promote an otherwise unidentified version, and current_version_id
-- fell back to the newest version even when no version matched the contract's
-- storage path. Preserve every source row and artifact, but stop presenting
-- those guesses as reviewable source truth.

create schema if not exists private;

create or replace function private.wp04_expected_source_upload_id(
  p_contract_id uuid,
  p_file_sha256 text
)
returns uuid
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  upload_digest bytea;
  upload_hex text;
begin
  if p_contract_id is null
     or coalesce(p_file_sha256, '') !~ '^[0-9a-f]{64}$' then
    return null;
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

  return (
    pg_catalog.substr(upload_hex, 1, 8) || '-' ||
    pg_catalog.substr(upload_hex, 9, 4) || '-' ||
    pg_catalog.substr(upload_hex, 13, 4) || '-' ||
    pg_catalog.substr(upload_hex, 17, 4) || '-' ||
    pg_catalog.substr(upload_hex, 21, 12)
  )::uuid;
end
$function$;

revoke all on function private.wp04_expected_source_upload_id(uuid, text)
  from public, anon, authenticated;
grant execute on function private.wp04_expected_source_upload_id(uuid, text)
  to service_role;

-- contract_source_page_maps remains the current, browser-facing locator. Keep
-- an immutable version-bound copy so a later source upload cannot erase the
-- evidence that made an older source version reviewable.
create table if not exists public.contract_source_page_map_evidence (
  contract_version_id uuid primary key
    references public.contract_versions(id) on delete cascade,
  contract_id uuid not null
    references public.contracts(id) on delete cascade,
  storage_path text not null,
  source_hash text not null,
  source_text_hash text not null,
  render_mode text not null,
  page_count integer not null,
  locator text not null,
  page_map jsonb not null,
  generated_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint contract_source_page_map_evidence_source_hash_check
    check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint contract_source_page_map_evidence_text_hash_check
    check (source_text_hash ~ '^[0-9a-f]{64}$'),
  constraint contract_source_page_map_evidence_render_mode_check
    check (render_mode in ('native-pdf', 'browser-ooxml')),
  constraint contract_source_page_map_evidence_page_count_check
    check (page_count > 0),
  constraint contract_source_page_map_evidence_locator_check
    check (locator in ('rendered', 'provisional')),
  constraint contract_source_page_map_evidence_page_array_check
    check (
      pg_catalog.jsonb_typeof(page_map) = 'array'
      and pg_catalog.jsonb_array_length(page_map) = page_count
    )
);

create index if not exists idx_contract_source_page_map_evidence_contract
  on public.contract_source_page_map_evidence(contract_id);

alter table public.contract_source_page_map_evidence enable row level security;
revoke all on table public.contract_source_page_map_evidence
  from public, anon, authenticated, service_role;
grant select on table public.contract_source_page_map_evidence
  to service_role;

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
)
select page_map.contract_version_id,
       page_map.contract_id,
       page_map.storage_path,
       page_map.source_hash,
       page_map.source_text_hash,
       page_map.render_mode,
       page_map.page_count,
       page_map.locator,
       page_map.page_map,
       page_map.generated_at
  from public.contract_source_page_maps as page_map
 where page_map.contract_version_id is not null
   and coalesce(page_map.source_hash, '') ~ '^[0-9a-f]{64}$'
   and coalesce(page_map.source_text_hash, '') ~ '^[0-9a-f]{64}$'
   and page_map.render_mode in ('native-pdf', 'browser-ooxml')
   and page_map.locator in ('rendered', 'provisional')
   and page_map.page_count > 0
   and pg_catalog.jsonb_typeof(page_map.page_map) = 'array'
   and pg_catalog.jsonb_array_length(page_map.page_map) = page_map.page_count
on conflict (contract_version_id) do nothing;

create or replace function public.capture_contract_source_page_map_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  captured public.contract_source_page_map_evidence%rowtype;
begin
  if new.contract_version_id is null then
    raise exception 'source page map requires a contract version identity'
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

drop trigger if exists trg_capture_contract_source_page_map_evidence
  on public.contract_source_page_maps;
create trigger trg_capture_contract_source_page_map_evidence
after insert or update
on public.contract_source_page_maps
for each row execute function public.capture_contract_source_page_map_evidence();

create or replace function private.wp04_contract_source_version_ready_truth(
  p_contract_version_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
      from public.contract_versions as version
      join public.contracts as contract
        on contract.id = version.contract_id
      join public.contract_source_page_map_evidence as evidence
        on evidence.contract_version_id = version.id
       and evidence.contract_id = version.contract_id
       and evidence.storage_path = version.storage_path
       and evidence.source_hash = version.file_sha256
       and evidence.source_text_hash = version.text_sha256
     where version.id = p_contract_version_id
       and version.ingest_status = 'SOURCE_READY'
       and version.source in ('original', 'manual_revision')
       and version.uploaded_by is not null
       and version.upload_id is not null
       and version.upload_id = private.wp04_expected_source_upload_id(
         version.contract_id,
         version.file_sha256
       )
       and version.storage_path = (
         version.contract_id::text || '/' || version.upload_id::text || '/source'
       )
       and version.file_size between 1 and 52428800
       and version.mime_type in (
         'application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-word.document.macroEnabled.12'
       )
       and version.file_sha256 ~ '^[0-9a-f]{64}$'
       and version.text_sha256 ~ '^[0-9a-f]{64}$'
       and nullif(pg_catalog.btrim(version.parsed_text), '') is not null
       and version.text_sha256 = pg_catalog.encode(
         extensions.digest(
           pg_catalog.convert_to(version.parsed_text, 'UTF8'),
           'sha256'
         ),
         'hex'
       )
       and version.ingest_error is null
       and evidence.render_mode = case
         when version.mime_type = 'application/pdf' then 'native-pdf'
         else 'browser-ooxml'
       end
       and evidence.locator in ('rendered', 'provisional')
       and evidence.page_count > 0
       and pg_catalog.jsonb_typeof(evidence.page_map) = 'array'
       and pg_catalog.jsonb_array_length(evidence.page_map) = evidence.page_count
       and not exists (
         select 1
           from pg_catalog.jsonb_array_elements(evidence.page_map)
             with ordinality as mapped_page(item, ordinal)
          where not (
            case
              when pg_catalog.jsonb_typeof(mapped_page.item) is distinct from 'object' then false
              when coalesce(mapped_page.item ->> 'page', '') !~ '^[1-9][0-9]*$' then false
              when coalesce(mapped_page.item ->> 'start', '') !~ '^(0|[1-9][0-9]*)$' then false
              when coalesce(mapped_page.item ->> 'end', '') !~ '^(0|[1-9][0-9]*)$' then false
              else (mapped_page.item ->> 'page')::numeric = mapped_page.ordinal::numeric
                and (mapped_page.item ->> 'end')::numeric >= (mapped_page.item ->> 'start')::numeric
                and mapped_page.item ->> 'locator' = evidence.locator
            end
          )
       )
       and (
         contract.current_version_id is distinct from version.id
         or (
           contract.storage_path is not distinct from version.storage_path
           and contract.size::bigint is not distinct from version.file_size
           and contract.mime_type is not distinct from version.mime_type
           and contract.parsed_text is not distinct from version.parsed_text
           and exists (
             select 1
               from public.contract_source_page_maps as current_page_map
              where current_page_map.contract_id = version.contract_id
                and current_page_map.contract_version_id = version.id
                and current_page_map.storage_path = evidence.storage_path
                and current_page_map.source_hash = evidence.source_hash
                and current_page_map.source_text_hash = evidence.source_text_hash
                and current_page_map.render_mode = evidence.render_mode
                and current_page_map.page_count = evidence.page_count
                and current_page_map.locator = evidence.locator
                and current_page_map.page_map = evidence.page_map
                and current_page_map.generated_at = evidence.generated_at
           )
         )
       )
  )
$function$;

revoke all on function private.wp04_contract_source_version_ready_truth(uuid)
  from public, anon, authenticated, service_role;

-- Repair a pointer only when one non-output version matches the complete
-- contract source projection. Keep the existing active-review trigger enabled
-- throughout the migration. Locked, missing and ambiguous cases remain in
-- place; the canonical readiness projection will fail closed and offer source
-- recovery instead of guessing or bypassing an active review lock.
do $pointer_repair$
declare
  candidate record;
begin
  for candidate in
    with exact_source as (
      select contract.id as contract_id,
             count(version.id) as candidate_count,
             max(version.id::text)::uuid as candidate_id
        from public.contracts as contract
        left join public.contract_versions as version
          on version.contract_id = contract.id
         and version.source <> 'review_revision'
         and version.storage_path = contract.storage_path
         and version.file_size is not distinct from contract.size::bigint
         and version.mime_type is not distinct from contract.mime_type
         and version.parsed_text is not distinct from contract.parsed_text
       group by contract.id
    )
    select contract.id as contract_id,
           exact_source.candidate_id
      from public.contracts as contract
      join exact_source on exact_source.contract_id = contract.id
     where exact_source.candidate_count = 1
       and contract.current_version_id is distinct from exact_source.candidate_id
       and not exists (
         select 1
           from public.contract_analysis_jobs as job
          where job.contract_id = contract.id
            and job.status in ('preparing', 'queued', 'running')
       )
  loop
    begin
      update public.contracts as contract
         set current_version_id = candidate.candidate_id
       where contract.id = candidate.contract_id
         and contract.current_version_id is distinct from candidate.candidate_id;
    exception
      when sqlstate '55000' then
        -- An optional review-submission lock may exist in a richer lineage.
        -- Preserve the original pointer and let readiness fail closed.
        null;
    end;
  end loop;
end
$pointer_repair$;

-- No source bytes, versions, reviews or maps are deleted. Output artifacts are
-- retained as stored outputs; legacy DOC remains conversion-recoverable; every
-- other false-ready source becomes an explicit, re-upload-recoverable failure.
update public.contract_versions as version
   set ingest_status = case
         when version.source = 'review_revision' then 'FILE_STORED'
         when version.mime_type = 'application/msword' then 'AWAITING_CONVERSION'
         else 'FAILED'
       end,
       ingest_error = case
         when version.source = 'review_revision' then 'OUTPUT_VERSION_NOT_REVIEW_SOURCE'
         when version.mime_type = 'application/msword' then 'LEGACY_DOC_REQUIRES_CONVERSION'
         else 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE'
       end
 where version.ingest_status = 'SOURCE_READY'
   and not private.wp04_contract_source_version_ready_truth(version.id);

alter table public.contract_versions
  drop constraint if exists contract_versions_source_ready_intrinsic_check;
alter table public.contract_versions
  add constraint contract_versions_source_ready_intrinsic_check
  check (
    ingest_status <> 'SOURCE_READY'
    or (
      source in ('original', 'manual_revision')
      and uploaded_by is not null
      and upload_id is not null
      and upload_id = private.wp04_expected_source_upload_id(contract_id, file_sha256)
      and storage_path = contract_id::text || '/' || upload_id::text || '/source'
      and file_size between 1 and 52428800
      and mime_type in (
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-word.document.macroEnabled.12'
      )
      and file_sha256 ~ '^[0-9a-f]{64}$'
      and text_sha256 ~ '^[0-9a-f]{64}$'
      and nullif(pg_catalog.btrim(parsed_text), '') is not null
      and text_sha256 = pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(parsed_text, 'UTF8'), 'sha256'),
        'hex'
      )
      and ingest_error is null
    )
  ) not valid;
alter table public.contract_versions
  validate constraint contract_versions_source_ready_intrinsic_check;

create or replace function public.enforce_contract_source_ready_truth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate_version_id uuid;
  candidate_version_ids uuid[] := array[]::uuid[];
begin
  if tg_table_name = 'contract_versions' then
    candidate_version_ids := array[new.id];
  elsif tg_table_name = 'contracts' then
    candidate_version_ids := array[new.current_version_id, old.current_version_id];
  elsif tg_table_name in (
    'contract_source_page_maps',
    'contract_source_page_map_evidence'
  ) then
    if tg_op = 'INSERT' then
      candidate_version_ids := array[new.contract_version_id];
    elsif tg_op = 'DELETE' then
      candidate_version_ids := array[old.contract_version_id];
    else
      candidate_version_ids := array[new.contract_version_id, old.contract_version_id];
    end if;
  end if;

  foreach candidate_version_id in array candidate_version_ids
  loop
    if candidate_version_id is not null
       and exists (
         select 1
           from public.contract_versions as version
          where version.id = candidate_version_id
            and version.ingest_status = 'SOURCE_READY'
       )
       and not private.wp04_contract_source_version_ready_truth(candidate_version_id) then
      raise exception 'SOURCE_READY requires complete immutable source and page-map identity'
        using errcode = '23514';
    end if;
  end loop;

  return null;
end
$function$;

revoke all on function public.enforce_contract_source_ready_truth()
  from public, anon, authenticated;
grant execute on function public.enforce_contract_source_ready_truth()
  to service_role;

drop trigger if exists trg_contract_version_source_ready_truth
  on public.contract_versions;
create constraint trigger trg_contract_version_source_ready_truth
after insert or update
on public.contract_versions
deferrable initially deferred
for each row execute function public.enforce_contract_source_ready_truth();

drop trigger if exists trg_contract_current_source_ready_truth
  on public.contracts;
create constraint trigger trg_contract_current_source_ready_truth
after insert or update
on public.contracts
deferrable initially deferred
for each row execute function public.enforce_contract_source_ready_truth();

drop trigger if exists trg_contract_page_map_source_ready_truth
  on public.contract_source_page_maps;
create constraint trigger trg_contract_page_map_source_ready_truth
after insert or update or delete
on public.contract_source_page_maps
deferrable initially deferred
for each row execute function public.enforce_contract_source_ready_truth();

drop trigger if exists trg_contract_page_map_evidence_ready_truth
  on public.contract_source_page_map_evidence;
create constraint trigger trg_contract_page_map_evidence_ready_truth
after insert or update or delete
on public.contract_source_page_map_evidence
deferrable initially deferred
for each row execute function public.enforce_contract_source_ready_truth();

commit;
