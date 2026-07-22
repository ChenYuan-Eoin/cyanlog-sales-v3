-- Migration: 20260718072000_fix_g6_comparison_creator_membership.sql
-- G6: authorize comparison creation through explicit organization membership.
--
-- The API selects an organization from user_organizations. The database must
-- validate the same membership instead of requiring users.org_id to match,
-- while still requiring the creator account to be active.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $g6_creator_membership_preflight$
begin
  if pg_catalog.to_regclass('public.users') is null
     or pg_catalog.to_regclass('public.user_organizations') is null then
    raise exception 'G6 creator membership repair preflight failed; membership tables are unavailable';
  end if;

  if pg_catalog.to_regprocedure(
    'public.create_contract_comparison_v1(uuid,uuid,text,jsonb,jsonb,jsonb,text,text)'
  ) is null then
    raise exception 'G6 creator membership repair preflight failed; comparison RPC is unavailable';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'users'
       and column_name = 'status'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'user_organizations'
       and column_name = 'user_id'
  ) or not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'user_organizations'
       and column_name = 'org_id'
  ) then
    raise exception 'G6 creator membership repair preflight failed; required membership columns are unavailable';
  end if;
end
$g6_creator_membership_preflight$;

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

do $g6_creator_membership_postcondition$
declare
  rpc_oid oid := pg_catalog.to_regprocedure(
    'public.create_contract_comparison_v1(uuid,uuid,text,jsonb,jsonb,jsonb,text,text)'
  );
  rpc_definition text;
begin
  if rpc_oid is null then
    raise exception 'G6 creator membership repair postcondition failed; comparison RPC is unavailable';
  end if;

  rpc_definition := pg_catalog.pg_get_functiondef(rpc_oid);
  if pg_catalog.strpos(rpc_definition, 'join public.user_organizations as membership') = 0
     or pg_catalog.strpos(rpc_definition, 'membership.user_id = creator.id') = 0
     or pg_catalog.strpos(rpc_definition, 'membership.org_id = p_org_id') = 0
     or pg_catalog.strpos(rpc_definition, 'creator.status = ''active''') = 0
     or pg_catalog.strpos(rpc_definition, 'creator.org_id = p_org_id') > 0
     or pg_catalog.strpos(rpc_definition, 'membership.is_default') > 0 then
    raise exception 'G6 creator membership repair postcondition failed; creator membership semantics are unsafe';
  end if;

  if pg_catalog.has_function_privilege('public', rpc_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', rpc_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', rpc_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', rpc_oid, 'EXECUTE') then
    raise exception 'G6 creator membership repair postcondition failed; comparison RPC ACL is unsafe';
  end if;
end
$g6_creator_membership_postcondition$;

commit;
