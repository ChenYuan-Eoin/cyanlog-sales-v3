set lock_timeout = '5s';
set statement_timeout = '60s';

-- Forward-only correction for 068: COALESCE is SQL syntax, not a schema
-- function, so qualifying it as pg_catalog.coalesce makes the PL/pgSQL body
-- fail when the branch is executed.
do $patch$
declare
  v_stage_signature regprocedure := pg_catalog.to_regprocedure(
    'public.stage_contract_review_facts_v1(uuid,uuid,uuid,uuid,jsonb,jsonb)'
  );
  v_stage_definition text;
  v_invalid_fragment text := 'pg_catalog.coalesce(v_matched_level =';
  v_valid_fragment text := 'coalesce(v_matched_level =';
  v_occurrences integer;
begin
  if v_stage_signature is null then
    raise exception 'FACTS_EMPTY_MATCHED_LEVEL_RPC_NOT_FOUND' using errcode = '55000';
  end if;

  select pg_catalog.pg_get_functiondef(v_stage_signature)
    into v_stage_definition;
  v_occurrences := (
    pg_catalog.length(v_stage_definition)
    - pg_catalog.length(
      pg_catalog.replace(v_stage_definition, v_invalid_fragment, '')
    )
  ) / pg_catalog.length(v_invalid_fragment);
  if v_occurrences <> 3 then
    raise exception 'FACTS_EMPTY_MATCHED_LEVEL_COALESCE_PATCH_DRIFT'
      using errcode = '55000';
  end if;

  v_stage_definition := pg_catalog.replace(
    v_stage_definition,
    v_invalid_fragment,
    v_valid_fragment
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
