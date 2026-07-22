set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function public.contract_fact_chunk_quote_is_recoverable_v1(
  p_chunk_text text,
  p_candidate_quote text
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  v_candidate text := pg_catalog.btrim(p_candidate_quote);
  v_chunk_projection text;
  v_candidate_projection text;
  v_first integer;
begin
  if pg_catalog.char_length(v_candidate) < 4
     or pg_catalog.char_length(v_candidate) > 1000 then
    return false;
  end if;

  v_first := pg_catalog.strpos(p_chunk_text, v_candidate);
  if v_first > 0
     and pg_catalog.strpos(
       pg_catalog.substr(
         p_chunk_text,
         v_first + pg_catalog.char_length(v_candidate)
       ),
       v_candidate
     ) = 0 then
    return true;
  end if;

  v_chunk_projection := pg_catalog.regexp_replace(
    p_chunk_text, '[[:space:]]+', '', 'g'
  );
  v_candidate_projection := pg_catalog.regexp_replace(
    v_candidate, '[[:space:]]+', '', 'g'
  );
  if pg_catalog.char_length(v_candidate_projection) < 4 then
    return false;
  end if;
  v_first := pg_catalog.strpos(v_chunk_projection, v_candidate_projection);
  return v_first > 0
    and pg_catalog.strpos(
      pg_catalog.substr(
        v_chunk_projection,
        v_first + pg_catalog.char_length(v_candidate_projection)
      ),
      v_candidate_projection
    ) = 0;
end;
$function$;

revoke all on function public.contract_fact_chunk_quote_is_recoverable_v1(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.contract_fact_chunk_quote_is_recoverable_v1(text, text)
  to service_role;

alter table public.contract_review_fact_chunk_checkpoints
  add column source_anchor_validated boolean not null default false;
alter table public.contract_review_fact_chunk_checkpoints
  add constraint contract_review_fact_chunk_checkpoints_source_anchor_check
  check (source_anchor_validated) not valid;

do $patch$
declare
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.checkpoint_contract_review_fact_chunk_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,integer,integer,integer,text,jsonb,jsonb,jsonb,text)'
  );
  v_definition text;
  v_candidate_needle text := $needle$
       or jsonb_typeof(candidate.item->'source_quote') <> 'string'
  ) or exists ($needle$;
  v_candidate_replacement text := $replacement$
       or jsonb_typeof(candidate.item->'source_quote') <> 'string'
       or not public.contract_fact_chunk_quote_is_recoverable_v1(
         v_chunk_text, candidate.item->>'source_quote'
       )
  ) or exists ($replacement$;
  v_metadata_needle text := $needle$
     or jsonb_typeof(p_response_metadata->'trusted_context_normalizations') <> 'array' then$needle$;
  v_metadata_replacement text := $replacement$
     or jsonb_typeof(p_response_metadata->'trusted_context_normalizations') <> 'array'
     or coalesce(p_response_metadata->>'source_anchor_normalization_count', '') !~ '^[0-9]+$'
     or jsonb_typeof(p_response_metadata->'source_anchor_normalizations') <> 'array' then$replacement$;
  v_columns_needle text := $needle$
    raw_output, raw_output_hash, provider_raw_output_hash, checkpoint_hash, created_at
  ) values ($needle$;
  v_columns_replacement text := $replacement$
    raw_output, raw_output_hash, provider_raw_output_hash, checkpoint_hash,
    source_anchor_validated, created_at
  ) values ($replacement$;
  v_values_needle text := $needle$
    p_raw_output, v_raw_hash, v_provider_raw_hash, v_checkpoint_hash, v_now
  ) returning id into v_checkpoint_id;$needle$;
  v_values_replacement text := $replacement$
    p_raw_output, v_raw_hash, v_provider_raw_hash, v_checkpoint_hash, true, v_now
  ) returning id into v_checkpoint_id;$replacement$;
begin
  if v_signature is null then
    raise exception 'FACT_CHUNK_CHECKPOINT_RPC_NOT_FOUND' using errcode = '55000';
  end if;
  select pg_catalog.pg_get_functiondef(v_signature) into v_definition;
  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_candidate_needle, ''))
  ) / pg_catalog.length(v_candidate_needle) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_metadata_needle, ''))
     ) / pg_catalog.length(v_metadata_needle) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_columns_needle, ''))
     ) / pg_catalog.length(v_columns_needle) <> 1
     or (
       pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_values_needle, ''))
     ) / pg_catalog.length(v_values_needle) <> 1 then
    raise exception 'FACT_CHUNK_CHECKPOINT_RPC_PATCH_DRIFT' using errcode = '55000';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_candidate_needle, v_candidate_replacement);
  v_definition := pg_catalog.replace(v_definition, v_metadata_needle, v_metadata_replacement);
  v_definition := pg_catalog.replace(v_definition, v_columns_needle, v_columns_replacement);
  v_definition := pg_catalog.replace(v_definition, v_values_needle, v_values_replacement);
  execute v_definition;
end;
$patch$;

revoke all on function public.checkpoint_contract_review_fact_chunk_v1(
  uuid, uuid, uuid, uuid, uuid, text, text, text, integer, integer, integer,
  text, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.checkpoint_contract_review_fact_chunk_v1(
  uuid, uuid, uuid, uuid, uuid, text, text, text, integer, integer, integer,
  text, jsonb, jsonb, jsonb, text
) to service_role;

reset statement_timeout;
reset lock_timeout;
