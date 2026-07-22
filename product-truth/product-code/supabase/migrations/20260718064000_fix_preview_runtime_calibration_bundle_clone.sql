set lock_timeout = '5s';
set statement_timeout = '60s';

-- The v23 bundle is a new immutable row, so created_at is expected to differ
-- from v22 just like compiled_at/published_at. Patch only the two exact clone
-- comparison lists in the already-installed service-only function.
do $migration$
declare
  v_function_oid oid;
  v_definition text;
  v_patched_definition text;
  v_old constant text := $needle$'compiled_at', 'published_at', 'updated_at'$needle$;
  v_new constant text := $needle$'compiled_at', 'published_at', 'created_at', 'updated_at'$needle$;
  v_occurrences integer;
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'public.create_preview_runtime_calibration_candidate_v1(uuid,uuid,uuid,integer,uuid,text,text,text,text,text,uuid)'
  )::oid;

  if v_function_oid is null then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_FUNCTION_MISSING' using errcode = '42704';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_function_oid);
  v_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.length(v_old);

  if v_occurrences <> 2 or pg_catalog.strpos(v_definition, v_new) > 0 then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_CLONE_GUARD_DRIFT' using errcode = '23514';
  end if;

  v_patched_definition := pg_catalog.replace(v_definition, v_old, v_new);
  execute v_patched_definition;

  v_definition := pg_catalog.pg_get_functiondef(v_function_oid);
  if pg_catalog.strpos(v_definition, v_old) > 0 or (
    (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_new, ''))
    ) / pg_catalog.length(v_new)
  ) <> 2 then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_CLONE_GUARD_PATCH_FAILED' using errcode = '23514';
  end if;
end;
$migration$;

reset statement_timeout;
reset lock_timeout;
