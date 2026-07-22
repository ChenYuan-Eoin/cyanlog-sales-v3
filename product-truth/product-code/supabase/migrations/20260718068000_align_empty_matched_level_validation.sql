set lock_timeout = '5s';
set statement_timeout = '60s';

-- A candidate that matches none of A/B/C is a valid deterministic outcome:
-- the frozen rule can route it to default_unknown_yellow or suppress it. SQL
-- previously compared FALSE with NULL for each level, so every empty
-- matched_levels array failed before the decision envelope was evaluated.
do $patch$
declare
  v_stage_signature regprocedure := pg_catalog.to_regprocedure(
    'public.stage_contract_review_facts_v1(uuid,uuid,uuid,uuid,jsonb,jsonb)'
  );
  v_stage_definition text;
  v_match_needle text := $needle$
      if (v_chunk.level_results->>'A')::boolean is distinct from (v_matched_level = 'A')
         or (v_chunk.level_results->>'B')::boolean is distinct from (v_matched_level = 'B')
         or (v_chunk.level_results->>'C')::boolean is distinct from (v_matched_level = 'C') then$needle$;
  v_match_replacement text := $replacement$
      if (v_chunk.level_results->>'A')::boolean
           is distinct from pg_catalog.coalesce(v_matched_level = 'A', false)
         or (v_chunk.level_results->>'B')::boolean
           is distinct from pg_catalog.coalesce(v_matched_level = 'B', false)
         or (v_chunk.level_results->>'C')::boolean
           is distinct from pg_catalog.coalesce(v_matched_level = 'C', false) then$replacement$;
begin
  if v_stage_signature is null then
    raise exception 'FACTS_EMPTY_MATCHED_LEVEL_RPC_NOT_FOUND' using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(v_stage_signature)
    into v_stage_definition;
  if (
    pg_catalog.length(v_stage_definition)
    - pg_catalog.length(pg_catalog.replace(v_stage_definition, v_match_needle, ''))
  ) / pg_catalog.length(v_match_needle) <> 1 then
    raise exception 'FACTS_EMPTY_MATCHED_LEVEL_PATCH_DRIFT' using errcode = '55000';
  end if;

  v_stage_definition := pg_catalog.replace(
    v_stage_definition,
    v_match_needle,
    v_match_replacement
  );
  execute v_stage_definition;
end;
$patch$;

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
