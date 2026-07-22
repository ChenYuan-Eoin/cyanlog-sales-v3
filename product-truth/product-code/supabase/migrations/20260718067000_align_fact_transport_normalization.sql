set lock_timeout = '5s';
set statement_timeout = '60s';

-- Keep the SQL uniqueness proof identical to the TypeScript executor. Starting
-- the second search one character after the first match also detects overlapping
-- repetitions such as quote `aaaa` inside source `aaaaa`.
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
       pg_catalog.substr(p_chunk_text, v_first + 1),
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
      pg_catalog.substr(v_chunk_projection, v_first + 1),
      v_candidate_projection
    ) = 0;
end;
$function$;

-- Patch only the two already deployed service-only RPCs. The checkpoint writer
-- must reject legacy unvalidated rows on idempotent replay and bind every
-- normalization count to its audit array. Staging must use the same
-- whitespace-deletion projection as the executor and checkpoint guard.
do $patch$
declare
  v_checkpoint_signature regprocedure := pg_catalog.to_regprocedure(
    'public.checkpoint_contract_review_fact_chunk_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,integer,integer,integer,text,jsonb,jsonb,jsonb,text)'
  );
  v_stage_signature regprocedure := pg_catalog.to_regprocedure(
    'public.stage_contract_review_facts_v1(uuid,uuid,uuid,uuid,jsonb,jsonb)'
  );
  v_checkpoint_definition text;
  v_stage_definition text;
  v_metadata_needle text := $needle$
    raise exception 'FACT_CHUNK_CHECKPOINT_RESPONSE_METADATA_INVALID' using errcode = '23514';
  end if;

  begin
    v_raw_json := p_raw_output::jsonb;$needle$;
  v_metadata_replacement text := $replacement$
    raise exception 'FACT_CHUNK_CHECKPOINT_RESPONSE_METADATA_INVALID' using errcode = '23514';
  end if;
  if not (
    coalesce(p_response_metadata->>'coverage_normalization_count', '') ~ '^[0-9]+$'
    and pg_catalog.jsonb_typeof(p_response_metadata->'coverage_normalizations') = 'array'
    and coalesce(p_response_metadata->>'trusted_context_normalization_count', '') ~ '^[0-9]+$'
    and pg_catalog.jsonb_typeof(p_response_metadata->'trusted_context_normalizations') = 'array'
    and coalesce(p_response_metadata->>'model_fact_normalization_count', '') ~ '^[0-9]+$'
    and pg_catalog.jsonb_typeof(p_response_metadata->'model_fact_normalizations') = 'array'
    and coalesce(p_response_metadata->>'source_anchor_normalization_count', '') ~ '^[0-9]+$'
    and pg_catalog.jsonb_typeof(p_response_metadata->'source_anchor_normalizations') = 'array'
  ) then
    raise exception 'FACT_CHUNK_CHECKPOINT_NORMALIZATION_METADATA_INVALID'
      using errcode = '23514';
  end if;
  if (p_response_metadata->>'coverage_normalization_count')::integer
       <> pg_catalog.jsonb_array_length(p_response_metadata->'coverage_normalizations')
     or (p_response_metadata->>'trusted_context_normalization_count')::integer
       <> pg_catalog.jsonb_array_length(p_response_metadata->'trusted_context_normalizations')
     or (p_response_metadata->>'model_fact_normalization_count')::integer
       <> pg_catalog.jsonb_array_length(p_response_metadata->'model_fact_normalizations')
     or (p_response_metadata->>'source_anchor_normalization_count')::integer
       <> pg_catalog.jsonb_array_length(p_response_metadata->'source_anchor_normalizations') then
    raise exception 'FACT_CHUNK_CHECKPOINT_NORMALIZATION_COUNT_MISMATCH'
      using errcode = '23514';
  end if;

  begin
    v_raw_json := p_raw_output::jsonb;$replacement$;
  v_idempotent_needle text := $needle$
    if v_existing.model_invocation_id = p_invocation_id
       and v_existing.checkpoint_hash = v_checkpoint_hash then$needle$;
  v_idempotent_replacement text := $replacement$
    if v_existing.model_invocation_id = p_invocation_id
       and v_existing.checkpoint_hash = v_checkpoint_hash
       and v_existing.source_anchor_validated then$replacement$;
  v_stage_needle text := $needle$
         or regexp_replace(btrim(v_source_exact_text), '[[:space:]]+', ' ', 'g')
            <> regexp_replace(btrim(v_chunk.candidate_source_quote), '[[:space:]]+', ' ', 'g') then$needle$;
  v_stage_replacement text := $replacement$
         or regexp_replace(btrim(v_source_exact_text), '[[:space:]]+', '', 'g')
            <> regexp_replace(btrim(v_chunk.candidate_source_quote), '[[:space:]]+', '', 'g') then$replacement$;
begin
  if v_checkpoint_signature is null or v_stage_signature is null then
    raise exception 'FACT_TRANSPORT_ALIGNMENT_RPC_NOT_FOUND' using errcode = '55000';
  end if;
  select pg_catalog.pg_get_functiondef(v_checkpoint_signature)
    into v_checkpoint_definition;
  select pg_catalog.pg_get_functiondef(v_stage_signature)
    into v_stage_definition;

  if (
    pg_catalog.length(v_checkpoint_definition)
    - pg_catalog.length(pg_catalog.replace(v_checkpoint_definition, v_metadata_needle, ''))
  ) / pg_catalog.length(v_metadata_needle) <> 1
     or (
       pg_catalog.length(v_checkpoint_definition)
       - pg_catalog.length(pg_catalog.replace(v_checkpoint_definition, v_idempotent_needle, ''))
     ) / pg_catalog.length(v_idempotent_needle) <> 1
     or (
       pg_catalog.length(v_stage_definition)
       - pg_catalog.length(pg_catalog.replace(v_stage_definition, v_stage_needle, ''))
     ) / pg_catalog.length(v_stage_needle) <> 1 then
    raise exception 'FACT_TRANSPORT_ALIGNMENT_PATCH_DRIFT' using errcode = '55000';
  end if;

  v_checkpoint_definition := pg_catalog.replace(
    v_checkpoint_definition, v_metadata_needle, v_metadata_replacement
  );
  v_checkpoint_definition := pg_catalog.replace(
    v_checkpoint_definition, v_idempotent_needle, v_idempotent_replacement
  );
  v_stage_definition := pg_catalog.replace(
    v_stage_definition, v_stage_needle, v_stage_replacement
  );
  execute v_checkpoint_definition;
  execute v_stage_definition;
end;
$patch$;

revoke all on function public.contract_fact_chunk_quote_is_recoverable_v1(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.contract_fact_chunk_quote_is_recoverable_v1(text, text)
  to service_role;

revoke all on function public.checkpoint_contract_review_fact_chunk_v1(
  uuid, uuid, uuid, uuid, uuid, text, text, text, integer, integer, integer,
  text, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.checkpoint_contract_review_fact_chunk_v1(
  uuid, uuid, uuid, uuid, uuid, text, text, text, integer, integer, integer,
  text, jsonb, jsonb, jsonb, text
) to service_role;

revoke all on function public.stage_contract_review_facts_v1(
  uuid, uuid, uuid, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.stage_contract_review_facts_v2(
  uuid, uuid, uuid, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.stage_contract_review_facts_v2(
  uuid, uuid, uuid, uuid, jsonb, jsonb
) to service_role;

reset statement_timeout;
reset lock_timeout;
