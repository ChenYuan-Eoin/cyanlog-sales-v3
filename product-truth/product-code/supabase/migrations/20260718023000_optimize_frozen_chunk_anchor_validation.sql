-- G5 source-anchor performance fix: validate one exact span and one frozen
-- chunk per risk instead of repeatedly rescanning the complete source text.
-- The fast BMP path covers normal Chinese/English contracts; supplementary
-- code points retain the fail-closed UTF-16 helper path.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function public.contract_direct_source_anchor_is_valid(
  p_source_text text,
  p_source_utf16_length integer,
  p_source_all_bmp boolean,
  p_position_start integer,
  p_position_end integer,
  p_evidence jsonb,
  p_job_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_skill_bundle_id uuid,
  p_model_policy_id uuid
)
returns boolean
language plpgsql
stable
set search_path = ''
as $function$
declare
  anchor_status text;
  exact_text text;
  source_exact_slice text;
  first_character_offset integer;
  second_character_offset integer;
  first_utf16_offset integer;
  chunk_index integer;
  chunk_total integer;
  chunk_start integer;
  chunk_end integer;
  chunk_hash text;
  chunk_text text;
begin
  if p_source_text is null
     or p_source_utf16_length is null
     or p_source_all_bmp is null
     or p_position_start is null
     or p_position_end is null
     or jsonb_typeof(p_evidence) is distinct from 'object' then
    return false;
  end if;

  anchor_status := coalesce(p_evidence->>'source_anchor_status', '');
  exact_text := coalesce(p_evidence->>'source_exact_text', '');
  if anchor_status not in ('exact_unique_text', 'exact_frozen_chunk')
     or p_evidence->>'source_anchor_match_field' is distinct from 'source_quote'
     or exact_text = ''
     or p_position_start < 0
     or p_position_end <= p_position_start
     or p_position_end > p_source_utf16_length
     or public.contract_utf16_codeunit_length(exact_text) <> p_position_end - p_position_start then
    return false;
  end if;

  source_exact_slice := case
    when p_source_all_bmp
      then pg_catalog.substr(p_source_text, p_position_start + 1, p_position_end - p_position_start)
    else public.contract_utf16_slice(p_source_text, p_position_start, p_position_end)
  end;
  if source_exact_slice is distinct from exact_text then return false; end if;

  if anchor_status = 'exact_unique_text' then
    if p_evidence ?| array[
      'source_chunk_index', 'source_chunk_total', 'source_chunk_start',
      'source_chunk_end', 'source_chunk_hash'
    ] then
      return false;
    end if;
    first_character_offset := pg_catalog.strpos(p_source_text, exact_text);
    if first_character_offset = 0 then return false; end if;
    first_utf16_offset := case
      when p_source_all_bmp then first_character_offset - 1
      else public.contract_utf16_codeunit_length(
        pg_catalog.substr(p_source_text, 1, first_character_offset - 1)
      )
    end;
    second_character_offset := pg_catalog.strpos(
      pg_catalog.substr(p_source_text, first_character_offset + 1),
      exact_text
    );
    return first_utf16_offset = p_position_start and second_character_offset = 0;
  end if;

  if coalesce(p_evidence->>'source_chunk_index', '') !~ '^[1-9][0-9]{0,8}$'
     or coalesce(p_evidence->>'source_chunk_total', '') !~ '^[1-9][0-9]{0,8}$'
     or coalesce(p_evidence->>'source_chunk_start', '') !~ '^(0|[1-9][0-9]{0,8})$'
     or coalesce(p_evidence->>'source_chunk_end', '') !~ '^[1-9][0-9]{0,8}$'
     or coalesce(p_evidence->>'source_chunk_hash', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_evidence->>'provider', '') = '' then
    return false;
  end if;

  chunk_index := (p_evidence->>'source_chunk_index')::integer;
  chunk_total := (p_evidence->>'source_chunk_total')::integer;
  chunk_start := (p_evidence->>'source_chunk_start')::integer;
  chunk_end := (p_evidence->>'source_chunk_end')::integer;
  chunk_hash := p_evidence->>'source_chunk_hash';

  if chunk_index > chunk_total
     or chunk_start > p_position_start
     or chunk_end < p_position_end
     or chunk_end > p_source_utf16_length
     or chunk_end <= chunk_start then
    return false;
  end if;

  chunk_text := case
    when p_source_all_bmp
      then pg_catalog.substr(p_source_text, chunk_start + 1, chunk_end - chunk_start)
    else public.contract_utf16_slice(p_source_text, chunk_start, chunk_end)
  end;
  if chunk_text is null then return false; end if;

  first_character_offset := pg_catalog.strpos(chunk_text, exact_text);
  if first_character_offset = 0 then return false; end if;
  first_utf16_offset := case
    when p_source_all_bmp then first_character_offset - 1
    else public.contract_utf16_codeunit_length(
      pg_catalog.substr(chunk_text, 1, first_character_offset - 1)
    )
  end;
  second_character_offset := pg_catalog.strpos(
    pg_catalog.substr(chunk_text, first_character_offset + 1),
    exact_text
  );
  if first_utf16_offset <> p_position_start - chunk_start
     or second_character_offset <> 0
     or pg_catalog.encode(
          extensions.digest(pg_catalog.convert_to(chunk_text, 'UTF8'), 'sha256'),
          'hex'
        ) is distinct from chunk_hash then
    return false;
  end if;

  return exists (
    select 1
      from public.model_invocations as invocation
     where invocation.contract_id = p_contract_id
       and invocation.review_id = p_review_id
       and invocation.skill_bundle_id = p_skill_bundle_id
       and invocation.model_policy_id = p_model_policy_id
       and invocation.phase = 'semantic_review'
       and invocation.status = 'completed'
       and invocation.degraded is false
       and invocation.provider is not distinct from p_evidence->>'provider'
       and invocation.request_meta->>'job_id' = p_job_id::text
       and invocation.request_meta#>>'{metadata,chunk_index}' = chunk_index::text
       and invocation.request_meta#>>'{metadata,chunk_total}' = chunk_total::text
       and invocation.request_meta#>>'{metadata,chunk_start}' = chunk_start::text
       and invocation.request_meta#>>'{metadata,chunk_end}' = chunk_end::text
       and invocation.request_meta#>>'{metadata,chunk_hash}' = chunk_hash
  );
end;
$function$;

revoke all on function public.contract_direct_source_anchor_is_valid(
  text, integer, boolean, integer, integer, jsonb,
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.contract_direct_source_anchor_is_valid(
  text, integer, boolean, integer, integer, jsonb,
  uuid, uuid, uuid, uuid, uuid
) to service_role;

create or replace function public.stage_contract_analysis_report(
  p_job_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_lock_token uuid,
  p_strategy_id uuid,
  p_risk_summary jsonb,
  p_compliance_check jsonb,
  p_effectiveness_analysis text,
  p_clauses jsonb,
  p_risks jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job_status text;
  current_lock_token uuid;
  current_storage_path text;
  current_source_hash text;
  current_source_text_hash text;
  current_parsed_text_hash text;
  current_parsed_text text;
  current_parsed_text_utf16_length integer;
  current_parsed_text_all_bmp boolean;
  review_status text;
  review_trigger text;
  review_strategy_id uuid;
  review_skill_bundle_id uuid;
  review_bundle_version integer;
  review_model_policy_id uuid;
  review_rule_snapshot_ids uuid[];
  review_rule_set_snapshot_ids uuid[];
  review_storage_path text;
  review_source_hash text;
  review_source_text_hash text;
  inserted_rows integer;
  v_now timestamptz := now();
begin
  if jsonb_typeof(p_risk_summary) is distinct from 'object'
     or jsonb_typeof(p_compliance_check) is distinct from 'object'
     or jsonb_typeof(p_clauses) is distinct from 'array'
     or jsonb_typeof(p_risks) is distinct from 'array' then
    raise exception 'structured report payload is invalid' using errcode = '22023';
  end if;

  select status, lock_token
    into current_job_status, current_lock_token
    from public.contract_analysis_jobs
   where id = p_job_id
     and contract_id = p_contract_id
     and review_id = p_review_id
   for update;
  if not found
     or current_job_status <> 'running'
     or p_lock_token is null
     or current_lock_token is distinct from p_lock_token then
    raise exception 'analysis job lease is no longer owned by this worker' using errcode = '55000';
  end if;

  select contracts.storage_path,
         page_maps.source_hash,
         page_maps.source_text_hash,
         coalesce(contracts.parsed_text, ''),
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(coalesce(contracts.parsed_text, ''), 'UTF8'), 'sha256'),
           'hex'
         )
    into current_storage_path, current_source_hash, current_source_text_hash,
         current_parsed_text, current_parsed_text_hash
    from public.contracts
    join public.contract_source_page_maps as page_maps
      on page_maps.contract_id = contracts.id
     and page_maps.storage_path = contracts.storage_path
   where contracts.id = p_contract_id
     and contracts.status = 'ANALYZING'
   for update of contracts, page_maps;
  if not found then
    raise exception 'active contract source identity is unavailable' using errcode = '40001';
  end if;
  current_parsed_text_utf16_length := public.contract_utf16_codeunit_length(current_parsed_text);
  current_parsed_text_all_bmp := current_parsed_text_utf16_length = pg_catalog.char_length(current_parsed_text);

  select review.status,
         review.review_trigger,
         review.strategy_id,
         review.skill_bundle_id,
         review.rule_version,
         review.model_policy_id,
         review.rule_snapshot_ids,
         review.rule_set_snapshot_ids,
         review.source_storage_path,
         review.source_hash,
         review.source_text_hash
    into review_status, review_trigger, review_strategy_id,
         review_skill_bundle_id, review_bundle_version, review_model_policy_id,
         review_rule_snapshot_ids, review_rule_set_snapshot_ids,
         review_storage_path, review_source_hash, review_source_text_hash
    from public.contract_reviews as review
   where review.id = p_review_id
     and review.contract_id = p_contract_id
   for update of review;
  if not found
     or review_status <> 'ANALYZING'
     or review_trigger is null
     or review_trigger not in ('direct', 'decision_batch')
     or review_strategy_id is distinct from p_strategy_id
     or review_storage_path is distinct from current_storage_path
     or review_source_hash is distinct from current_source_hash
     or review_source_text_hash is distinct from current_source_text_hash
     or review_source_text_hash is distinct from current_parsed_text_hash then
    raise exception 'ReviewRun source, strategy or execution state changed before report staging' using errcode = '40001';
  end if;
  if review_skill_bundle_id is null
     or review_bundle_version is null
     or not exists (
       select 1
         from public.contract_skill_bundles as bundle
        where bundle.id = review_skill_bundle_id
          and bundle.version = review_bundle_version
          and bundle.status = 'published'
          and bundle.model_policy_id is not distinct from review_model_policy_id
          and bundle.rule_snapshot_ids is not distinct from review_rule_snapshot_ids
          and bundle.rule_set_snapshot_ids is not distinct from review_rule_set_snapshot_ids
     ) then
    raise exception 'ReviewRun frozen rule bundle provenance is invalid' using errcode = '23514';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_clauses) as clause(review_id uuid, contract_id uuid)
     where clause.review_id is distinct from p_review_id
        or clause.contract_id is distinct from p_contract_id
  ) then
    raise exception 'structured clauses contain a foreign ReviewRun identity' using errcode = '23514';
  end if;

  delete from public.contract_clauses where review_id = p_review_id;
  insert into public.contract_clauses (
    review_id, contract_id, clause_number, clause_title, clause_text,
    risk_level, risk_category, risk_description, legal_basis, suggestion,
    suggested_text, matched_library_clause_id, position, start_offset, end_offset
  )
  select clause.review_id,
         clause.contract_id,
         clause.clause_number,
         clause.clause_title,
         clause.clause_text,
         clause.risk_level,
         clause.risk_category,
         clause.risk_description,
         clause.legal_basis,
         clause.suggestion,
         clause.suggested_text,
         clause.matched_library_clause_id,
         clause.position,
         clause.start_offset,
         clause.end_offset
    from jsonb_to_recordset(p_clauses) as clause(
      review_id uuid,
      contract_id uuid,
      clause_number text,
      clause_title text,
      clause_text text,
      risk_level text,
      risk_category text,
      risk_description text,
      legal_basis text,
      suggestion text,
      suggested_text text,
      matched_library_clause_id uuid,
      position integer,
      start_offset integer,
      end_offset integer
    );
  get diagnostics inserted_rows = row_count;
  if inserted_rows <> jsonb_array_length(p_clauses) then
    raise exception 'structured clauses were not staged completely' using errcode = '23514';
  end if;

  if review_trigger = 'direct' then
    if exists (
      select 1
        from jsonb_to_recordset(p_risks) as risk(
          id uuid,
          contract_id uuid,
          review_id uuid,
          level text,
          title text,
          description text,
          suggestion text,
          auto_fixable boolean,
          fix_action jsonb,
          clause_ref text,
          position_start integer,
          position_end integer,
          detected_by text,
          confidence numeric,
          status text,
          fixed_by uuid,
          fixed_at timestamptz,
          rule_id uuid,
          rule_code text,
          rule_version integer,
          evidence jsonb
        )
       where risk.id is null
          or risk.contract_id is distinct from p_contract_id
          or risk.review_id is distinct from p_review_id
          or risk.level not in ('red', 'yellow', 'green', 'white')
          or coalesce(nullif(risk.title, ''), '') = ''
          or risk.description is null
          or risk.suggestion is null
          or risk.auto_fixable is distinct from false
          or risk.fix_action is not null
          or risk.clause_ref is not null
          or risk.detected_by is null
          or risk.detected_by not in ('ai', 'rule', 'manual')
          or risk.confidence is not null
          or risk.status is distinct from 'open'
          or risk.fixed_by is not null
          or risk.fixed_at is not null
          or ((risk.position_start is null) <> (risk.position_end is null))
          or risk.position_start < 0
          or risk.position_end <= risk.position_start
          or risk.position_end > current_parsed_text_utf16_length
          or jsonb_typeof(risk.evidence) is distinct from 'object'
          or risk.evidence->>'analysis_job_id' is distinct from p_job_id::text
          or risk.evidence->>'skill_bundle_id' is distinct from review_skill_bundle_id::text
          or risk.evidence->>'skill_bundle_version' is distinct from review_bundle_version::text
          or (
            risk.position_start is null
            and (
              risk.evidence->>'source_anchor_status' is distinct from 'unresolved'
              or risk.evidence->>'source_exact_text' is not null
              or coalesce((risk.evidence->>'customer_output_eligible')::boolean, false)
            )
          )
          or (
            risk.position_start is not null
            and public.contract_direct_source_anchor_is_valid(
              current_parsed_text,
              current_parsed_text_utf16_length,
              current_parsed_text_all_bmp,
              risk.position_start,
              risk.position_end,
              risk.evidence,
              p_job_id,
              p_contract_id,
              p_review_id,
              review_skill_bundle_id,
              review_model_policy_id
            ) is distinct from true
          )
          or (
            risk.rule_code is null
            and (
              risk.rule_id is not null
              or risk.rule_version is not null
              or risk.evidence->>'rule_snapshot_id' is not null
              or risk.evidence->>'binding_status' is distinct from 'unbound'
              or coalesce((risk.evidence->>'customer_output_eligible')::boolean, false)
            )
          )
          or (
            risk.rule_code is not null
            and (
              coalesce(risk.evidence->>'rule_snapshot_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              or risk.evidence->>'binding_status' is distinct from 'frozen_rule_snapshot'
              or not exists (
                select 1
                  from public.contract_rule_snapshots as snapshot
                 where snapshot.id = (risk.evidence->>'rule_snapshot_id')::uuid
                   and snapshot.id = any(coalesce(review_rule_snapshot_ids, '{}'::uuid[]))
                   and snapshot.version is not distinct from risk.rule_version
                   and snapshot.config_snapshot->>'code' is not distinct from risk.rule_code
                   and (
                     risk.rule_id is null
                     or snapshot.config_snapshot->>'id' is not distinct from risk.rule_id::text
                   )
              )
            )
          )
    ) then
      raise exception 'direct risk facts contain invalid identity, state or source anchors' using errcode = '23514';
    end if;

    delete from public.contract_risk_cards where review_id = p_review_id;
    insert into public.contract_risk_cards (
      id, contract_id, review_id, level, title, description, suggestion,
      auto_fixable, fix_action, clause_ref, position_start, position_end,
      detected_by, confidence, status, fixed_by, fixed_at, created_at, updated_at,
      rule_id, rule_code, rule_version, evidence
    )
    select risk.id,
           risk.contract_id,
           risk.review_id,
           risk.level,
           risk.title,
           risk.description,
           risk.suggestion,
           risk.auto_fixable,
           risk.fix_action,
           risk.clause_ref,
           risk.position_start,
           risk.position_end,
           risk.detected_by,
           risk.confidence,
           risk.status,
           risk.fixed_by,
           risk.fixed_at,
           v_now,
           v_now,
           risk.rule_id,
           risk.rule_code,
           risk.rule_version,
           risk.evidence
      from jsonb_to_recordset(p_risks) as risk(
        id uuid,
        contract_id uuid,
        review_id uuid,
        level text,
        title text,
        description text,
        suggestion text,
        auto_fixable boolean,
        fix_action jsonb,
        clause_ref text,
        position_start integer,
        position_end integer,
        detected_by text,
        confidence numeric,
        status text,
        fixed_by uuid,
        fixed_at timestamptz,
        created_at timestamptz,
        updated_at timestamptz,
        rule_id uuid,
        rule_code text,
        rule_version integer,
        evidence jsonb
      );
    get diagnostics inserted_rows = row_count;
    if inserted_rows <> jsonb_array_length(p_risks) then
      raise exception 'direct risk facts were not staged completely' using errcode = '23514';
    end if;
  elsif jsonb_array_length(p_risks) <> 0 then
    raise exception 'decision ReviewRun risks must use the decision staging function' using errcode = '23514';
  end if;

  update public.contract_reviews
     set risk_summary = p_risk_summary,
         compliance_check = p_compliance_check,
         effectiveness_analysis = p_effectiveness_analysis,
         report_version = 2,
         updated_at = v_now
   where id = p_review_id
     and contract_id = p_contract_id
     and status = 'ANALYZING';
  get diagnostics inserted_rows = row_count;
  if inserted_rows <> 1 then
    raise exception 'structured report was not staged on its ReviewRun' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.stage_contract_analysis_report(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.stage_contract_analysis_report(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, jsonb, jsonb) to service_role;

reset statement_timeout;
reset lock_timeout;
