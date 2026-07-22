-- Migration: 20260718071000_repair_g6_frozen_bytes_and_diff_immutability.sql
-- G6 forward repair for the already-applied 070000 Preview migration.
--
-- A clean database receives the final 070000 definition before this file, so
-- every schema adjustment below is deliberately safe in both states:
--   1. the earlier Preview definition without frozen-byte columns/guards; and
--   2. the final clean 070000 definition already containing them.
-- No version-1 comparison may exist while this repair changes its contract.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $g6_repair_preflight$
declare
  missing_columns text[];
begin
  if pg_catalog.to_regclass('public.contract_comparison_sources') is null then
    raise exception 'G6 repair preflight failed; contract_comparison_sources is missing';
  end if;

  if pg_catalog.to_regclass('public.contract_comparisons') is null
     or pg_catalog.to_regclass('public.comparison_diffs') is null
     or pg_catalog.to_regclass('public.contracts') is null
     or pg_catalog.to_regclass('public.contract_source_page_maps') is null then
    raise exception 'G6 repair preflight failed; prerequisite tables are missing';
  end if;

  with required(table_name, column_name) as (
    values
      ('contract_comparisons', 'org_id'),
      ('contract_comparisons', 'source_snapshot_version'),
      ('contract_comparison_sources', 'org_id'),
      ('contract_comparison_sources', 'comparison_id'),
      ('contract_comparison_sources', 'role'),
      ('contract_comparison_sources', 'contract_id'),
      ('contract_comparison_sources', 'storage_path'),
      ('contract_comparison_sources', 'file_name'),
      ('contract_comparison_sources', 'file_size'),
      ('contract_comparison_sources', 'mime_type'),
      ('contract_comparison_sources', 'file_sha256'),
      ('contract_comparison_sources', 'text_sha256'),
      ('contract_comparison_sources', 'parsed_text'),
      ('contract_comparison_sources', 'render_mode'),
      ('contract_comparison_sources', 'page_map'),
      ('contract_comparison_sources', 'captured_at')
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
    raise exception 'G6 repair preflight failed; missing columns: %', missing_columns;
  end if;

  if exists (select 1 from public.contract_comparison_sources) then
    raise exception 'G6 repair requires zero source snapshots';
  end if;

  if exists (
    select 1
      from public.contract_comparisons
     where source_snapshot_version = 1
  ) then
    raise exception 'G6 repair requires zero version-1 comparisons';
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null
     or pg_catalog.to_regprocedure('public.contract_utf16_codeunit_length(text)') is null
     or pg_catalog.to_regprocedure('public.contract_utf16_slice(text,integer,integer)') is null then
    raise exception 'G6 repair preflight failed; hash or UTF-16 helpers are unavailable';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'contract_comparison_sources'
       and column_name in ('origin_storage_path', 'text_reliability')
       and data_type <> 'text'
  ) then
    raise exception 'G6 repair baseline conflict; frozen source columns have unexpected types';
  end if;
end
$g6_repair_preflight$;

alter table public.contract_comparison_sources
  add column if not exists origin_storage_path text,
  add column if not exists text_reliability text;

alter table public.contract_comparison_sources
  alter column origin_storage_path set not null,
  alter column text_reliability set not null,
  drop constraint if exists contract_comparison_sources_storage_path_check,
  drop constraint if exists contract_comparison_sources_frozen_path_key,
  drop constraint if exists contract_comparison_sources_text_reliability_check;

alter table public.contract_comparison_sources
  add constraint contract_comparison_sources_storage_path_check
    check (
      pg_catalog.btrim(origin_storage_path) <> ''
      and pg_catalog.btrim(storage_path) <> ''
      and storage_path <> origin_storage_path
    ),
  add constraint contract_comparison_sources_frozen_path_key
    unique (storage_path),
  add constraint contract_comparison_sources_text_reliability_check
    check (
      (text_reliability = 'verified' and pg_catalog.btrim(parsed_text) <> '')
      or (text_reliability = 'unavailable' and parsed_text = '')
    );

comment on column public.contract_comparison_sources.origin_storage_path is
  'Current contract source path whose bytes and identity were verified before capture.';
comment on column public.contract_comparison_sources.storage_path is
  'Immutable G6-owned byte copy; never the mutable current contract path.';
comment on column public.contract_comparison_sources.text_reliability is
  'verified = diffable source text; unavailable = frozen bytes are viewable but diffs must be empty.';

create or replace function public.freeze_contract_comparison_v1_identity()
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

drop trigger if exists trg_contract_comparisons_freeze_v1_identity
  on public.contract_comparisons;
create trigger trg_contract_comparisons_freeze_v1_identity
before update on public.contract_comparisons
for each row execute function public.freeze_contract_comparison_v1_identity();

create or replace function public.reject_contract_comparison_v1_delete()
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

drop trigger if exists trg_contract_comparisons_reject_v1_delete
  on public.contract_comparisons;
create trigger trg_contract_comparisons_reject_v1_delete
before delete on public.contract_comparisons
for each row execute function public.reject_contract_comparison_v1_delete();

create or replace function public.guard_contract_comparison_diff_v1_mutation()
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

drop trigger if exists trg_comparison_diffs_guard_v1_mutation
  on public.comparison_diffs;
create trigger trg_comparison_diffs_guard_v1_mutation
before insert or update or delete on public.comparison_diffs
for each row execute function public.guard_contract_comparison_diff_v1_mutation();

create or replace function public.validate_contract_comparison_source_insert_v1()
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

drop trigger if exists trg_contract_comparison_sources_validate_insert
  on public.contract_comparison_sources;
create trigger trg_contract_comparison_sources_validate_insert
before insert on public.contract_comparison_sources
for each row execute function public.validate_contract_comparison_source_insert_v1();

create or replace function public.create_contract_comparison_v1(
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
  'Atomically validates current source identity, persists G6-owned frozen byte paths, writes immutable positioned diffs, and completes one version-1 comparison.';

alter table public.contract_comparison_sources enable row level security;
revoke all privileges on table public.contract_comparison_sources
  from public, anon, authenticated, service_role;
grant select on table public.contract_comparison_sources to service_role;

do $g6_repair_postcondition$
declare
  source_table_oid oid := pg_catalog.to_regclass('public.contract_comparison_sources');
  rpc_oid oid := pg_catalog.to_regprocedure(
    'public.create_contract_comparison_v1(uuid,uuid,text,jsonb,jsonb,jsonb,text,text)'
  );
  rpc_definition text;
begin
  if exists (select 1 from public.contract_comparison_sources)
     or exists (
       select 1
         from public.contract_comparisons
        where source_snapshot_version = 1
     ) then
    raise exception 'G6 repair postcondition failed; version-1 data appeared during repair';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'contract_comparison_sources'
       and column_name = 'origin_storage_path'
       and data_type = 'text'
       and is_nullable = 'NO'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'contract_comparison_sources'
       and column_name = 'text_reliability'
       and data_type = 'text'
       and is_nullable = 'NO'
  ) then
    raise exception 'G6 repair postcondition failed; frozen source columns are incomplete';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conrelid = source_table_oid
       and constraint_row.conname = 'contract_comparison_sources_frozen_path_key'
       and constraint_row.contype = 'u'
       and constraint_row.convalidated
  ) or not exists (
    select 1
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conrelid = source_table_oid
       and constraint_row.conname = 'contract_comparison_sources_storage_path_check'
       and constraint_row.contype = 'c'
       and constraint_row.convalidated
  ) or not exists (
    select 1
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conrelid = source_table_oid
       and constraint_row.conname = 'contract_comparison_sources_text_reliability_check'
       and constraint_row.contype = 'c'
       and constraint_row.convalidated
  ) then
    raise exception 'G6 repair postcondition failed; frozen source constraints are incomplete';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_trigger as trigger_row
     where trigger_row.tgrelid = 'public.contract_comparisons'::pg_catalog.regclass
       and trigger_row.tgname = 'trg_contract_comparisons_freeze_v1_identity'
       and not trigger_row.tgisinternal
  ) or not exists (
    select 1
      from pg_catalog.pg_trigger as trigger_row
     where trigger_row.tgrelid = 'public.contract_comparisons'::pg_catalog.regclass
       and trigger_row.tgname = 'trg_contract_comparisons_reject_v1_delete'
       and not trigger_row.tgisinternal
  ) or not exists (
    select 1
      from pg_catalog.pg_trigger as trigger_row
     where trigger_row.tgrelid = 'public.comparison_diffs'::pg_catalog.regclass
       and trigger_row.tgname = 'trg_comparison_diffs_guard_v1_mutation'
       and not trigger_row.tgisinternal
  ) or not exists (
    select 1
      from pg_catalog.pg_trigger as trigger_row
     where trigger_row.tgrelid = source_table_oid
       and trigger_row.tgname = 'trg_contract_comparison_sources_validate_insert'
       and not trigger_row.tgisinternal
  ) then
    raise exception 'G6 repair postcondition failed; immutability triggers are incomplete';
  end if;

  if rpc_oid is null then
    raise exception 'G6 repair postcondition failed; creation RPC is missing';
  end if;
  select pg_catalog.pg_get_functiondef(rpc_oid) into rpc_definition;

  if pg_catalog.strpos(rpc_definition, 'pg_catalog.greatest') <> 0
     or pg_catalog.strpos(rpc_definition, 'contract_utf16_codeunit_length') = 0
     or pg_catalog.strpos(rpc_definition, 'origin_storage_path') = 0
     or pg_catalog.strpos(rpc_definition, 'text_reliability') = 0 then
    raise exception 'G6 repair postcondition failed; creation RPC is not the frozen-byte UTF-16 contract';
  end if;

  if not (select relation.relrowsecurity
            from pg_catalog.pg_class as relation
           where relation.oid = source_table_oid)
     or pg_catalog.has_table_privilege('anon', source_table_oid, 'SELECT')
     or pg_catalog.has_table_privilege('authenticated', source_table_oid, 'SELECT')
     or not pg_catalog.has_table_privilege('service_role', source_table_oid, 'SELECT')
     or pg_catalog.has_table_privilege('service_role', source_table_oid, 'INSERT')
     or pg_catalog.has_table_privilege('service_role', source_table_oid, 'UPDATE')
     or pg_catalog.has_table_privilege('service_role', source_table_oid, 'DELETE') then
    raise exception 'G6 repair postcondition failed; comparison source ACL/RLS is unsafe';
  end if;

  if pg_catalog.has_function_privilege(
       'anon', rpc_oid, 'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'authenticated', rpc_oid, 'EXECUTE'
     ) or not pg_catalog.has_function_privilege(
       'service_role', rpc_oid, 'EXECUTE'
     ) then
    raise exception 'G6 repair postcondition failed; creation RPC ACL is unsafe';
  end if;
end
$g6_repair_postcondition$;

commit;
