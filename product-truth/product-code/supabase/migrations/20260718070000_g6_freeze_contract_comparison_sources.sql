-- Migration: 20260718070000_g6_freeze_contract_comparison_sources.sql
-- G6: freeze the old/new source identity used by every auditable comparison.
--
-- Historical contract_comparisons rows remain version 0 with org_id = NULL.
-- They are intentionally unverified and cannot be upgraded in place. Version 1
-- comparisons are created atomically through create_contract_comparison_v1.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $g6_preflight$
declare
  missing_tables text[];
  missing_columns text[];
begin
  select pg_catalog.array_agg(required.name order by required.name)
    into missing_tables
    from pg_catalog.unnest(array[
      'comparison_diffs',
      'contract_comparisons',
      'contract_source_page_maps',
      'contracts',
      'organizations',
      'users'
    ]::text[]) as required(name)
   where pg_catalog.to_regclass(pg_catalog.format('public.%I', required.name)) is null;

  if missing_tables is not null then
    raise exception 'G6 comparison snapshot preflight failed; missing tables: %', missing_tables;
  end if;

  with required(table_name, column_name) as (
    values
      ('contracts', 'org_id'),
      ('contracts', 'filename'),
      ('contracts', 'storage_path'),
      ('contracts', 'size'),
      ('contracts', 'mime_type'),
      ('contracts', 'parsed_text'),
      ('contract_source_page_maps', 'storage_path'),
      ('contract_source_page_maps', 'source_hash'),
      ('contract_source_page_maps', 'source_text_hash'),
      ('contract_source_page_maps', 'render_mode'),
      ('contract_source_page_maps', 'page_map')
  )
  select pg_catalog.array_agg(required.table_name || '.' || required.column_name
                              order by required.table_name, required.column_name)
    into missing_columns
    from required
   where not exists (
     select 1
       from information_schema.columns as existing
      where existing.table_schema = 'public'
        and existing.table_name = required.table_name
        and existing.column_name = required.column_name
   );

  if missing_columns is not null then
    raise exception 'G6 comparison snapshot preflight failed; missing columns: %', missing_columns;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'contract_comparisons'
       and column_name in ('org_id', 'source_snapshot_version')
  ) or pg_catalog.to_regclass('public.contract_comparison_sources') is not null then
    raise exception 'G6 comparison snapshot baseline conflict; resolve the competing schema before applying';
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'G6 comparison snapshot preflight failed; extensions.digest(bytea,text) is unavailable';
  end if;

  if pg_catalog.to_regprocedure('public.contract_utf16_codeunit_length(text)') is null then
    raise exception 'G6 comparison snapshot preflight failed; contract_utf16_codeunit_length(text) is unavailable';
  end if;

  if pg_catalog.to_regprocedure('public.contract_utf16_slice(text,integer,integer)') is null then
    raise exception 'G6 comparison snapshot preflight failed; contract_utf16_slice(text,integer,integer) is unavailable';
  end if;
end
$g6_preflight$;

alter table public.contract_comparisons
  add column org_id uuid references public.organizations(id) on delete restrict,
  add column source_snapshot_version smallint not null default 0;

alter table public.contract_comparisons
  add constraint contract_comparisons_source_snapshot_version_check
  check (
    (source_snapshot_version = 0 and org_id is null)
    or (source_snapshot_version = 1 and org_id is not null)
  );

create index idx_contract_comparisons_org_created_at_v1
  on public.contract_comparisons(org_id, created_at desc)
  where source_snapshot_version = 1;

comment on column public.contract_comparisons.source_snapshot_version is
  '0 = legacy/unverified row; 1 = exactly one immutable old and one immutable new source snapshot.';

create function public.require_contract_comparison_v1_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.source_snapshot_version <> 1 or new.org_id is null then
    raise exception 'G6_LEGACY_COMPARISON_INSERT_FORBIDDEN' using errcode = '55000';
  end if;
  return new;
end;
$function$;

revoke all on function public.require_contract_comparison_v1_insert()
  from public, anon, authenticated;
grant execute on function public.require_contract_comparison_v1_insert()
  to service_role;

create trigger trg_contract_comparisons_require_v1_insert
before insert on public.contract_comparisons
for each row execute function public.require_contract_comparison_v1_insert();

create table public.contract_comparison_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  comparison_id uuid not null
    references public.contract_comparisons(id) on delete cascade,
  role text not null,
  contract_id uuid not null references public.contracts(id) on delete restrict,
  origin_storage_path text not null,
  storage_path text not null,
  file_name text not null,
  file_size bigint not null,
  mime_type text not null,
  file_sha256 text not null,
  text_sha256 text not null,
  parsed_text text not null,
  text_reliability text not null,
  render_mode text not null,
  page_map jsonb not null,
  captured_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint contract_comparison_sources_role_check
    check (role in ('old', 'new')),
  constraint contract_comparison_sources_role_key
    unique (comparison_id, role),
  constraint contract_comparison_sources_storage_path_check
    check (
      pg_catalog.btrim(origin_storage_path) <> ''
      and pg_catalog.btrim(storage_path) <> ''
      and storage_path <> origin_storage_path
    ),
  constraint contract_comparison_sources_frozen_path_key
    unique (storage_path),
  constraint contract_comparison_sources_file_name_check
    check (pg_catalog.btrim(file_name) <> ''),
  constraint contract_comparison_sources_file_size_check
    check (file_size > 0),
  constraint contract_comparison_sources_mime_type_check
    check (pg_catalog.btrim(mime_type) <> ''),
  constraint contract_comparison_sources_file_sha256_check
    check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint contract_comparison_sources_text_sha256_check
    check (
      text_sha256 ~ '^[0-9a-f]{64}$'
      and text_sha256 = pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(parsed_text, 'UTF8'), 'sha256'),
        'hex'
      )
    ),
  constraint contract_comparison_sources_text_reliability_check
    check (
      (text_reliability = 'verified' and pg_catalog.btrim(parsed_text) <> '')
      or (text_reliability = 'unavailable' and parsed_text = '')
    ),
  constraint contract_comparison_sources_render_mode_check
    check (render_mode in ('native-pdf', 'docx-to-pdf', 'word-to-pdf', 'browser-ooxml')),
  constraint contract_comparison_sources_page_map_check
    check (pg_catalog.jsonb_typeof(page_map) = 'array' and pg_catalog.jsonb_array_length(page_map) > 0)
);

create index idx_contract_comparison_sources_org_captured
  on public.contract_comparison_sources(org_id, captured_at desc);

create index idx_contract_comparison_sources_contract
  on public.contract_comparison_sources(contract_id);

alter table public.contract_comparison_sources enable row level security;

revoke all privileges on table public.contract_comparison_sources
  from public, anon, authenticated, service_role;
grant select on table public.contract_comparison_sources to service_role;

create function public.reject_contract_comparison_source_mutation_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'G6_COMPARISON_SOURCE_IMMUTABLE' using errcode = '55000';
end;
$function$;

revoke all on function public.reject_contract_comparison_source_mutation_v1()
  from public, anon, authenticated;
grant execute on function public.reject_contract_comparison_source_mutation_v1()
  to service_role;

create trigger trg_contract_comparison_sources_reject_mutation
before update or delete on public.contract_comparison_sources
for each row execute function public.reject_contract_comparison_source_mutation_v1();

create function public.freeze_contract_comparison_v1_identity()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.org_id is distinct from new.org_id
     or old.source_snapshot_version is distinct from new.source_snapshot_version
     or (
       old.source_snapshot_version = 1
       and (
         old.contract_id is distinct from new.contract_id
         or old.created_by is distinct from new.created_by
         or old.baseline_type is distinct from new.baseline_type
         or old.baseline_doc_id is distinct from new.baseline_doc_id
         or old.compare_doc_id is distinct from new.compare_doc_id
         or old.created_at is distinct from new.created_at
         or (
           old.status in ('completed', 'failed')
           and (
             old.status is distinct from new.status
             or old.error_message is distinct from new.error_message
             or old.ai_summary is distinct from new.ai_summary
             or old.ai_recommendation is distinct from new.ai_recommendation
             or old.completed_at is distinct from new.completed_at
           )
         )
       )
     ) then
    raise exception 'G6_COMPARISON_IDENTITY_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end;
$function$;

revoke all on function public.freeze_contract_comparison_v1_identity()
  from public, anon, authenticated;
grant execute on function public.freeze_contract_comparison_v1_identity()
  to service_role;

create trigger trg_contract_comparisons_freeze_v1_identity
before update on public.contract_comparisons
for each row execute function public.freeze_contract_comparison_v1_identity();

create function public.reject_contract_comparison_v1_delete()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.source_snapshot_version = 1 then
    raise exception 'G6_COMPARISON_IMMUTABLE' using errcode = '55000';
  end if;
  return old;
end;
$function$;

revoke all on function public.reject_contract_comparison_v1_delete()
  from public, anon, authenticated;
grant execute on function public.reject_contract_comparison_v1_delete()
  to service_role;

create trigger trg_contract_comparisons_reject_v1_delete
before delete on public.contract_comparisons
for each row execute function public.reject_contract_comparison_v1_delete();

create function public.guard_contract_comparison_diff_v1_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  parent_id uuid;
  parent_version smallint;
  parent_status text;
begin
  if tg_op = 'UPDATE' and exists (
    select 1
      from public.contract_comparisons as comparison
     where comparison.id in (old.comparison_id, new.comparison_id)
       and comparison.source_snapshot_version = 1
  ) then
    raise exception 'G6_COMPARISON_DIFF_IMMUTABLE' using errcode = '55000';
  end if;

  parent_id := case when tg_op = 'INSERT' then new.comparison_id else old.comparison_id end;
  select comparison.source_snapshot_version, comparison.status
    into parent_version, parent_status
    from public.contract_comparisons as comparison
   where comparison.id = parent_id;

  if tg_op <> 'UPDATE' and found and parent_version = 1
     and (tg_op <> 'INSERT' or parent_status <> 'processing') then
    raise exception 'G6_COMPARISON_DIFF_IMMUTABLE' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.guard_contract_comparison_diff_v1_mutation()
  from public, anon, authenticated;
grant execute on function public.guard_contract_comparison_diff_v1_mutation()
  to service_role;

create trigger trg_comparison_diffs_guard_v1_mutation
before insert or update or delete on public.comparison_diffs
for each row execute function public.guard_contract_comparison_diff_v1_mutation();

create function public.validate_contract_comparison_source_insert_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.storage_path not like 'g6-frozen/' || new.org_id::text || '/%' then
    raise exception 'G6_COMPARISON_SOURCE_FROZEN_PATH_INVALID' using errcode = '23514';
  end if;

  if not exists (
    select 1
      from public.contract_comparisons as comparison
     where comparison.id = new.comparison_id
       and comparison.org_id = new.org_id
       and comparison.source_snapshot_version = 1
  ) then
    raise exception 'G6_COMPARISON_SOURCE_PARENT_INVALID' using errcode = '23514';
  end if;

  perform 1
    from public.contracts as contract
    join public.contract_source_page_maps as page_map
      on page_map.contract_id = contract.id
     and page_map.storage_path = contract.storage_path
   where contract.id = new.contract_id
     and contract.org_id = new.org_id
     and contract.storage_path is not distinct from new.origin_storage_path
     and contract.filename is not distinct from new.file_name
     and contract.size::bigint is not distinct from new.file_size
     and contract.mime_type is not distinct from new.mime_type
     and (
       (new.text_reliability = 'verified'
         and coalesce(contract.parsed_text, '') is not distinct from new.parsed_text)
       or (new.text_reliability = 'unavailable' and new.parsed_text = '')
     )
     and page_map.source_hash is not distinct from new.file_sha256
     and page_map.source_text_hash is not distinct from new.text_sha256
     and page_map.render_mode is not distinct from new.render_mode
     and page_map.page_map is not distinct from new.page_map
   for share of contract, page_map;

  if not found then
    raise exception 'G6_COMPARISON_SOURCE_CURRENT_IDENTITY_MISMATCH' using errcode = '23514';
  end if;

  new.captured_at := pg_catalog.transaction_timestamp();
  return new;
end;
$function$;

revoke all on function public.validate_contract_comparison_source_insert_v1()
  from public, anon, authenticated;
grant execute on function public.validate_contract_comparison_source_insert_v1()
  to service_role;

create trigger trg_contract_comparison_sources_validate_insert
before insert on public.contract_comparison_sources
for each row execute function public.validate_contract_comparison_source_insert_v1();

create function public.enforce_contract_comparison_v1_source_pair()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  source_count integer;
  role_count integer;
begin
  if new.source_snapshot_version <> 1 then
    return new;
  end if;

  select pg_catalog.count(*), pg_catalog.count(distinct source.role)
    into source_count, role_count
    from public.contract_comparison_sources as source
   where source.comparison_id = new.id
     and source.org_id = new.org_id
     and source.role in ('old', 'new');

  if source_count <> 2 or role_count <> 2 then
    raise exception 'G6_COMPARISON_REQUIRES_EXACT_OLD_NEW_PAIR' using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_contract_comparison_v1_source_pair()
  from public, anon, authenticated;
grant execute on function public.enforce_contract_comparison_v1_source_pair()
  to service_role;

create constraint trigger trg_contract_comparisons_require_v1_source_pair
after insert on public.contract_comparisons
deferrable initially deferred
for each row execute function public.enforce_contract_comparison_v1_source_pair();

create function public.create_contract_comparison_v1(
  p_org_id uuid,
  p_created_by uuid,
  p_baseline_type text,
  p_old_source jsonb,
  p_new_source jsonb,
  p_diffs jsonb default '[]'::jsonb,
  p_ai_summary text default null,
  p_ai_recommendation text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_input record;
  page_input record;
  page_entry jsonb;
  diff_input jsonb;
  position_input record;
  old_contract_id uuid;
  new_contract_id uuid;
  comparison_id uuid;
  page_number integer;
  position_start integer;
  position_end integer;
  position_page_map jsonb;
  position_source_text text;
  position_exact_text text;
begin
  if p_org_id is null or p_created_by is null then
    raise exception 'G6_COMPARISON_ORG_AND_CREATOR_REQUIRED' using errcode = '22023';
  end if;

  if p_baseline_type is null
     or p_baseline_type not in ('template', 'previous_version', 'uploaded') then
    raise exception 'G6_COMPARISON_BASELINE_TYPE_INVALID' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.users as creator
      join public.user_organizations as membership
        on membership.user_id = creator.id
       and membership.org_id = p_org_id
     where creator.id = p_created_by
       and creator.status = 'active'
  ) then
    raise exception 'G6_COMPARISON_CREATOR_ORG_MISMATCH' using errcode = '42501';
  end if;

  for source_input in
    select source.role, source.payload
      from (values ('old'::text, p_old_source), ('new'::text, p_new_source))
        as source(role, payload)
  loop
    if source_input.payload is null
       or pg_catalog.jsonb_typeof(source_input.payload) <> 'object'
       or not source_input.payload ?& array[
         'contract_id', 'origin_storage_path', 'storage_path', 'file_name',
         'file_size', 'mime_type', 'file_sha256', 'text_sha256', 'parsed_text',
         'text_reliability', 'render_mode', 'page_map'
       ] then
      raise exception 'G6_COMPARISON_%_SOURCE_INCOMPLETE', pg_catalog.upper(source_input.role)
        using errcode = '22023';
    end if;

    if pg_catalog.jsonb_typeof(source_input.payload->'contract_id') <> 'string'
       or pg_catalog.jsonb_typeof(source_input.payload->'origin_storage_path') <> 'string'
       or pg_catalog.jsonb_typeof(source_input.payload->'storage_path') <> 'string'
       or pg_catalog.jsonb_typeof(source_input.payload->'file_name') <> 'string'
       or pg_catalog.jsonb_typeof(source_input.payload->'file_size') <> 'number'
       or pg_catalog.jsonb_typeof(source_input.payload->'mime_type') <> 'string'
       or pg_catalog.jsonb_typeof(source_input.payload->'file_sha256') <> 'string'
       or pg_catalog.jsonb_typeof(source_input.payload->'text_sha256') <> 'string'
       or pg_catalog.jsonb_typeof(source_input.payload->'parsed_text') <> 'string'
       or pg_catalog.jsonb_typeof(source_input.payload->'text_reliability') <> 'string'
       or pg_catalog.jsonb_typeof(source_input.payload->'render_mode') <> 'string'
       or pg_catalog.jsonb_typeof(source_input.payload->'page_map') <> 'array'
       or pg_catalog.jsonb_array_length(source_input.payload->'page_map') = 0 then
      raise exception 'G6_COMPARISON_%_SOURCE_TYPES_INVALID', pg_catalog.upper(source_input.role)
        using errcode = '22023';
    end if;

    if (source_input.payload->>'file_size')::numeric
         <> pg_catalog.trunc((source_input.payload->>'file_size')::numeric)
       or (source_input.payload->>'file_size')::bigint <= 0
       or pg_catalog.lower(source_input.payload->>'file_sha256') !~ '^[0-9a-f]{64}$'
       or pg_catalog.lower(source_input.payload->>'text_sha256') !~ '^[0-9a-f]{64}$'
       or pg_catalog.lower(source_input.payload->>'text_sha256') <> pg_catalog.encode(
         extensions.digest(
           pg_catalog.convert_to(source_input.payload->>'parsed_text', 'UTF8'),
           'sha256'
         ),
         'hex'
       )
       or source_input.payload->>'origin_storage_path' = source_input.payload->>'storage_path'
       or source_input.payload->>'storage_path'
            not like 'g6-frozen/' || p_org_id::text || '/%'
       or (
         source_input.payload->>'text_reliability' = 'verified'
         and pg_catalog.btrim(source_input.payload->>'parsed_text') = ''
       )
       or (
         source_input.payload->>'text_reliability' = 'unavailable'
         and source_input.payload->>'parsed_text' <> ''
       )
       or source_input.payload->>'text_reliability' not in ('verified', 'unavailable') then
      raise exception 'G6_COMPARISON_%_SOURCE_HASH_OR_SIZE_INVALID', pg_catalog.upper(source_input.role)
        using errcode = '22023';
    end if;

    for page_input in
      select page.value, page.ordinality
        from pg_catalog.jsonb_array_elements(source_input.payload->'page_map')
          with ordinality as page(value, ordinality)
    loop
      page_entry := page_input.value;
      if pg_catalog.jsonb_typeof(page_entry) is distinct from 'object'
         or not page_entry ?& array['page', 'start', 'end', 'locator']
         or pg_catalog.jsonb_typeof(page_entry->'page') is distinct from 'number'
         or pg_catalog.jsonb_typeof(page_entry->'start') is distinct from 'number'
         or pg_catalog.jsonb_typeof(page_entry->'end') is distinct from 'number'
         or pg_catalog.jsonb_typeof(page_entry->'locator') is distinct from 'string' then
        raise exception 'G6_COMPARISON_%_PAGE_MAP_INVALID', pg_catalog.upper(source_input.role)
          using errcode = '22023';
      end if;

      page_number := (page_entry->>'page')::integer;
      position_start := (page_entry->>'start')::integer;
      position_end := (page_entry->>'end')::integer;
      if (page_entry->>'page')::numeric <> pg_catalog.trunc((page_entry->>'page')::numeric)
         or (page_entry->>'start')::numeric <> pg_catalog.trunc((page_entry->>'start')::numeric)
         or (page_entry->>'end')::numeric <> pg_catalog.trunc((page_entry->>'end')::numeric)
         or page_number < 1
         or page_number <> page_input.ordinality::integer
         or position_start < 0
         or position_end < position_start
         or position_end > public.contract_utf16_codeunit_length(
           source_input.payload->>'parsed_text'
         )
         or page_entry->>'locator' not in ('rendered', 'provisional') then
        raise exception 'G6_COMPARISON_%_PAGE_MAP_RANGE_INVALID', pg_catalog.upper(source_input.role)
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  old_contract_id := (p_old_source->>'contract_id')::uuid;
  new_contract_id := (p_new_source->>'contract_id')::uuid;
  if old_contract_id = new_contract_id then
    raise exception 'G6_COMPARISON_REQUIRES_DISTINCT_SOURCE_CONTRACTS' using errcode = '22023';
  end if;

  if p_diffs is null or pg_catalog.jsonb_typeof(p_diffs) <> 'array' then
    raise exception 'G6_COMPARISON_DIFFS_MUST_BE_ARRAY' using errcode = '22023';
  end if;

  if p_old_source->>'text_reliability' <> 'verified'
     or p_new_source->>'text_reliability' <> 'verified' then
    if pg_catalog.jsonb_array_length(p_diffs) <> 0 then
      raise exception 'G6_COMPARISON_UNREADABLE_SOURCE_CANNOT_HAVE_DIFFS' using errcode = '22023';
    end if;
  end if;

  for diff_input in
    select diff.value from pg_catalog.jsonb_array_elements(p_diffs) as diff(value)
  loop
    if pg_catalog.jsonb_typeof(diff_input) is distinct from 'object'
       or not diff_input ?& array[
         'diff_type', 'baseline_text', 'compare_text',
         'baseline_position', 'compare_position'
       ]
       or diff_input->>'diff_type' not in ('deleted', 'added', 'modified', 'moved')
       or pg_catalog.jsonb_typeof(diff_input->'baseline_text') is distinct from 'string'
       or pg_catalog.jsonb_typeof(diff_input->'compare_text') is distinct from 'string'
       or pg_catalog.jsonb_typeof(diff_input->'baseline_position') is distinct from 'object'
       or pg_catalog.jsonb_typeof(diff_input->'compare_position') is distinct from 'object'
       or (
         diff_input ? 'risk_level'
         and diff_input->'risk_level' <> 'null'::jsonb
         and diff_input->>'risk_level' not in ('red', 'yellow', 'green')
       ) then
      raise exception 'G6_COMPARISON_DIFF_INCOMPLETE' using errcode = '22023';
    end if;

    if (diff_input->>'diff_type' = 'added'
          and (diff_input->>'baseline_text' <> '' or diff_input->>'compare_text' = ''))
       or (diff_input->>'diff_type' = 'deleted'
          and (diff_input->>'baseline_text' = '' or diff_input->>'compare_text' <> ''))
       or (diff_input->>'diff_type' = 'modified'
          and (diff_input->>'baseline_text' = ''
            or diff_input->>'compare_text' = ''
            or diff_input->>'baseline_text' = diff_input->>'compare_text'))
       or (diff_input->>'diff_type' = 'moved'
          and (diff_input->>'baseline_text' = ''
            or diff_input->>'compare_text' = ''
            or diff_input->>'baseline_text' <> diff_input->>'compare_text')) then
      raise exception 'G6_COMPARISON_DIFF_TYPE_TEXT_MISMATCH' using errcode = '22023';
    end if;

    for position_input in
      select position.role, position.payload
        from (values
          ('old'::text, diff_input->'baseline_position'),
          ('new'::text, diff_input->'compare_position')
        ) as position(role, payload)
    loop
      if position_input.role = 'old' then
        position_page_map := p_old_source->'page_map';
        position_source_text := p_old_source->>'parsed_text';
        position_exact_text := diff_input->>'baseline_text';
      else
        position_page_map := p_new_source->'page_map';
        position_source_text := p_new_source->>'parsed_text';
        position_exact_text := diff_input->>'compare_text';
      end if;

      if not position_input.payload ?& array['page', 'start', 'end']
         or pg_catalog.jsonb_typeof(position_input.payload->'page') is distinct from 'number'
         or pg_catalog.jsonb_typeof(position_input.payload->'start') is distinct from 'number'
         or pg_catalog.jsonb_typeof(position_input.payload->'end') is distinct from 'number' then
        raise exception 'G6_COMPARISON_DIFF_%_POSITION_INVALID', pg_catalog.upper(position_input.role)
          using errcode = '22023';
      end if;

      page_number := (position_input.payload->>'page')::integer;
      position_start := (position_input.payload->>'start')::integer;
      position_end := (position_input.payload->>'end')::integer;
      if (position_input.payload->>'page')::numeric
           <> pg_catalog.trunc((position_input.payload->>'page')::numeric)
         or (position_input.payload->>'start')::numeric
           <> pg_catalog.trunc((position_input.payload->>'start')::numeric)
         or (position_input.payload->>'end')::numeric
           <> pg_catalog.trunc((position_input.payload->>'end')::numeric)
         or page_number < 1
         or page_number > pg_catalog.jsonb_array_length(
           position_page_map
         )
         or position_start < 0
         or position_end < position_start
         or position_end > public.contract_utf16_codeunit_length(
           position_source_text
         ) then
        raise exception 'G6_COMPARISON_DIFF_%_RANGE_INVALID', pg_catalog.upper(position_input.role)
          using errcode = '22023';
      end if;

      if not exists (
        select 1
          from pg_catalog.jsonb_array_elements(position_page_map) as page(value)
         where (page.value->>'page')::integer = page_number
           and (page.value->>'start')::integer <= position_start
           and (
             (position_end > position_start
               and (page.value->>'end')::integer >= position_end - 1)
             or (position_end = position_start
               and (page.value->>'end')::integer + 1 >= position_start)
           )
      ) then
        raise exception 'G6_COMPARISON_DIFF_%_PAGE_RANGE_MISMATCH', pg_catalog.upper(position_input.role)
          using errcode = '22023';
      end if;

      if position_end = position_start then
        if position_exact_text <> '' then
          raise exception 'G6_COMPARISON_DIFF_%_TEXT_RANGE_MISMATCH', pg_catalog.upper(position_input.role)
            using errcode = '22023';
        end if;
      elsif public.contract_utf16_slice(position_source_text, position_start, position_end)
            is distinct from position_exact_text then
        raise exception 'G6_COMPARISON_DIFF_%_TEXT_RANGE_MISMATCH', pg_catalog.upper(position_input.role)
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  insert into public.contract_comparisons (
    org_id,
    source_snapshot_version,
    contract_id,
    created_by,
    baseline_type,
    baseline_doc_id,
    compare_doc_id,
    ai_summary,
    ai_recommendation,
    status
  ) values (
    p_org_id,
    1,
    old_contract_id,
    p_created_by,
    p_baseline_type,
    old_contract_id,
    new_contract_id,
    p_ai_summary,
    p_ai_recommendation,
    'processing'
  )
  returning id into comparison_id;

  insert into public.contract_comparison_sources (
    org_id,
    comparison_id,
    role,
    contract_id,
    origin_storage_path,
    storage_path,
    file_name,
    file_size,
    mime_type,
    file_sha256,
    text_sha256,
    parsed_text,
    text_reliability,
    render_mode,
    page_map
  )
  select
    p_org_id,
    comparison_id,
    source.role,
    (source.payload->>'contract_id')::uuid,
    source.payload->>'origin_storage_path',
    source.payload->>'storage_path',
    source.payload->>'file_name',
    (source.payload->>'file_size')::bigint,
    source.payload->>'mime_type',
    pg_catalog.lower(source.payload->>'file_sha256'),
    pg_catalog.lower(source.payload->>'text_sha256'),
    source.payload->>'parsed_text',
    source.payload->>'text_reliability',
    source.payload->>'render_mode',
    source.payload->'page_map'
  from (values ('old'::text, p_old_source), ('new'::text, p_new_source))
    as source(role, payload);

  insert into public.comparison_diffs (
    comparison_id,
    diff_type,
    baseline_position,
    compare_position,
    baseline_text,
    compare_text,
    semantic_change,
    risk_level,
    sort_order
  )
  select
    comparison_id,
    diff.value->>'diff_type',
    diff.value->'baseline_position',
    diff.value->'compare_position',
    diff.value->>'baseline_text',
    diff.value->>'compare_text',
    diff.value->>'semantic_change',
    nullif(diff.value->>'risk_level', ''),
    diff.ordinality::integer
  from pg_catalog.jsonb_array_elements(p_diffs) with ordinality as diff(value, ordinality);

  update public.contract_comparisons
     set status = case
           when p_old_source->>'text_reliability' <> 'verified'
             or p_new_source->>'text_reliability' <> 'verified'
           then 'failed'
           else 'completed'
         end,
         error_message = case
           when p_old_source->>'text_reliability' <> 'verified'
             or p_new_source->>'text_reliability' <> 'verified'
           then p_ai_summary
           else null
         end,
         completed_at = pg_catalog.transaction_timestamp()
   where id = comparison_id
     and org_id = p_org_id
     and source_snapshot_version = 1;

  if not found then
    raise exception 'G6_COMPARISON_FINALIZATION_FAILED' using errcode = '40001';
  end if;

  return comparison_id;
end;
$function$;

revoke all on function public.create_contract_comparison_v1(
  uuid, uuid, text, jsonb, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.create_contract_comparison_v1(
  uuid, uuid, text, jsonb, jsonb, jsonb, text, text
) to service_role;

comment on function public.create_contract_comparison_v1(
  uuid, uuid, text, jsonb, jsonb, jsonb, text, text
) is
  'Atomically validates and freezes old/new source identities, writes positioned diffs, and completes one version-1 comparison.';

do $g6_postcondition$
declare
  source_table_oid oid := pg_catalog.to_regclass('public.contract_comparison_sources');
begin
  if exists (
    select 1
      from public.contract_comparisons
     where source_snapshot_version <> 0 or org_id is not null
  ) then
    raise exception 'G6 migration rewrote a legacy comparison as version 1';
  end if;

  if exists (select 1 from public.contract_comparison_sources) then
    raise exception 'G6 migration unexpectedly created source snapshot data';
  end if;

  if not (select relation.relrowsecurity from pg_catalog.pg_class as relation where relation.oid = source_table_oid)
     or pg_catalog.has_table_privilege('anon', source_table_oid, 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', source_table_oid, 'SELECT')
     or not pg_catalog.has_table_privilege('service_role', source_table_oid, 'SELECT')
     or pg_catalog.has_table_privilege('service_role', source_table_oid, 'INSERT')
     or pg_catalog.has_table_privilege('service_role', source_table_oid, 'UPDATE')
     or pg_catalog.has_table_privilege('service_role', source_table_oid, 'DELETE') then
    raise exception 'G6 comparison source ACL/RLS postcondition failed';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.create_contract_comparison_v1(uuid,uuid,text,jsonb,jsonb,jsonb,text,text)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.create_contract_comparison_v1(uuid,uuid,text,jsonb,jsonb,jsonb,text,text)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.create_contract_comparison_v1(uuid,uuid,text,jsonb,jsonb,jsonb,text,text)',
       'EXECUTE'
     ) then
    raise exception 'G6 comparison creation RPC ACL postcondition failed';
  end if;
end
$g6_postcondition$;

commit;
