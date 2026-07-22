set lock_timeout = '5s';
set statement_timeout = '60s';

-- Forward fix: overlapping frozen chunks may repeat one identical source fact.
-- The TypeScript runtime intentionally collapses that duplicate into one global
-- adjudication trace. Document coverage still requires every observed rule to
-- have at least one trace and every unobserved rule to have none; raw candidate
-- count must not be forced to equal the deduplicated trace count.
create or replace function public.stage_contract_review_facts_v2(
  p_job_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_lock_token uuid,
  p_chunks jsonb,
  p_adjudications jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_receipt jsonb;
  v_run_id uuid;
  v_run public.contract_review_fact_runs%rowtype;
  v_bundle public.contract_skill_bundles%rowtype;
  v_existing_run public.contract_review_document_runs%rowtype;
  v_rule_catalog jsonb;
  v_coverage_matrix jsonb;
  v_per_rule jsonb;
  v_outcomes jsonb;
  v_persisted_outcomes jsonb;
  v_rule_catalog_hash text;
  v_coverage_matrix_hash text;
  v_adjudication_hash text;
  v_rule_count integer;
  v_outcome_count integer;
  v_document_run_id uuid;
  v_document_idempotent boolean;
  v_now timestamptz := pg_catalog.now();
begin
  v_receipt := public.stage_contract_review_facts_v1(
    p_job_id,
    p_contract_id,
    p_review_id,
    p_lock_token,
    p_chunks,
    p_adjudications
  );

  if coalesce(v_receipt->>'run_id', '')
     !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'DOCUMENT_ADJUDICATION_FACT_RECEIPT_INVALID' using errcode = '23514';
  end if;
  v_run_id := (v_receipt->>'run_id')::uuid;

  select fact_run.*
  into v_run
  from public.contract_review_fact_runs as fact_run
  where fact_run.id = v_run_id
    and fact_run.analysis_job_id = p_job_id
    and fact_run.contract_id = p_contract_id
    and fact_run.review_id = p_review_id
    and fact_run.output_contract = 'facts_v1'
  for share;
  if not found then
    raise exception 'DOCUMENT_ADJUDICATION_FACT_RUN_INVALID' using errcode = '23514';
  end if;

  select bundle.*
  into v_bundle
  from public.contract_skill_bundles as bundle
  where bundle.id = v_run.skill_bundle_id
    and bundle.version = v_run.skill_bundle_version
    and bundle.status = 'published'
    and not bundle.is_current
    and bundle.output_schema @> '{"contract":"contract_review_facts_v1","version":1}'::jsonb
    and bundle.release_meta->>'stage' = 'candidate'
    and bundle.release_meta->>'release_eligible' = 'false'
    and exists (
      select 1
      from public.contract_skill_bundle_channels as channel
      where channel.org_id = bundle.org_id
        and channel.key = bundle.key
        and channel.channel = 'preview_candidate'
        and channel.bundle_id = bundle.id
        and channel.bundle_version = bundle.version
    )
  for share;
  if not found then
    raise exception 'DOCUMENT_ADJUDICATION_CANDIDATE_INVALID' using errcode = '23514';
  end if;

  v_rule_count := coalesce(cardinality(v_bundle.rule_snapshot_ids), 0);
  if v_rule_count = 0 or exists (
    select 1
    from unnest(coalesce(v_bundle.rule_snapshot_ids, '{}'::uuid[]))
      as member(rule_snapshot_id)
    left join public.contract_rule_snapshots as snapshot
      on snapshot.id = member.rule_snapshot_id
    where snapshot.id is null
       or snapshot.status <> 'published'
       or snapshot.criteria_hash is null
       or coalesce(snapshot.config_snapshot->>'code', '') = ''
       or coalesce(
         snapshot.config_snapshot->'review_criteria'->>'absence_decision',
         ''
       ) not in ('ignore', 'yellow_review', 'red_risk')
  ) or exists (
    select snapshot.config_snapshot->>'code'
    from public.contract_rule_snapshots as snapshot
    where snapshot.id = any(v_bundle.rule_snapshot_ids)
    group by snapshot.config_snapshot->>'code'
    having count(*) <> 1
  ) then
    raise exception 'DOCUMENT_ADJUDICATION_RULE_CATALOG_INVALID' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rule_snapshot_id', snapshot.id,
      'rule_code', snapshot.config_snapshot->>'code',
      'criteria_hash', snapshot.criteria_hash,
      'configured_absence_decision',
        snapshot.config_snapshot->'review_criteria'->>'absence_decision'
    ) order by snapshot.config_snapshot->>'code', snapshot.id
  ), '[]'::jsonb)
  into v_rule_catalog
  from public.contract_rule_snapshots as snapshot
  where snapshot.id = any(v_bundle.rule_snapshot_ids);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rule_snapshot_id', coverage.rule_snapshot_id,
      'rule_code', coverage.rule_code,
      'chunk_index', fact_chunk.chunk_index,
      'status', coverage.status
    ) order by coverage.rule_code, coverage.rule_snapshot_id, fact_chunk.chunk_index
  ), '[]'::jsonb)
  into v_coverage_matrix
  from public.contract_review_rule_coverages as coverage
  join public.contract_review_fact_chunks as fact_chunk
    on fact_chunk.id = coverage.fact_chunk_id
   and fact_chunk.run_id = coverage.run_id
  where coverage.run_id = v_run_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rule_snapshot_id', per_rule.rule_snapshot_id,
      'rule_code', per_rule.rule_code,
      'criteria_hash', per_rule.criteria_hash,
      'configured_absence_decision', per_rule.configured_absence_decision,
      'coverage_chunk_count', per_rule.coverage_chunk_count,
      'observed_chunk_count', per_rule.observed_chunk_count,
      'uncertain_chunk_count', per_rule.uncertain_chunk_count,
      'not_observed_chunk_count', per_rule.not_observed_chunk_count
    ) order by per_rule.rule_code, per_rule.rule_snapshot_id
  ), '[]'::jsonb)
  into v_per_rule
  from (
    select
      snapshot.id as rule_snapshot_id,
      snapshot.config_snapshot->>'code' as rule_code,
      snapshot.criteria_hash,
      snapshot.config_snapshot->'review_criteria'->>'absence_decision'
        as configured_absence_decision,
      count(coverage.id)::integer as coverage_chunk_count,
      count(*) filter (where coverage.status = 'observed')::integer
        as observed_chunk_count,
      count(*) filter (where coverage.status = 'uncertain')::integer
        as uncertain_chunk_count,
      count(*) filter (where coverage.status = 'not_observed')::integer
        as not_observed_chunk_count
    from unnest(v_bundle.rule_snapshot_ids) as member(rule_snapshot_id)
    join public.contract_rule_snapshots as snapshot
      on snapshot.id = member.rule_snapshot_id
    left join public.contract_review_rule_coverages as coverage
      on coverage.run_id = v_run_id
     and coverage.rule_snapshot_id = snapshot.id
    group by snapshot.id, snapshot.config_snapshot, snapshot.criteria_hash
  ) as per_rule;

  if jsonb_array_length(v_rule_catalog) <> v_rule_count
     or jsonb_array_length(v_per_rule) <> v_rule_count
     or jsonb_array_length(v_coverage_matrix) <> v_rule_count * v_run.chunk_total
     or exists (
       select 1
       from jsonb_to_recordset(v_per_rule) as per_rule(
         coverage_chunk_count integer,
         observed_chunk_count integer,
         uncertain_chunk_count integer,
         not_observed_chunk_count integer
       )
       where per_rule.coverage_chunk_count <> v_run.chunk_total
          or per_rule.coverage_chunk_count < 1
          or per_rule.coverage_chunk_count <>
             per_rule.observed_chunk_count
             + per_rule.uncertain_chunk_count
             + per_rule.not_observed_chunk_count
     ) then
    raise exception 'DOCUMENT_ADJUDICATION_COVERAGE_MATRIX_INVALID' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_per_rule) as per_rule(
      rule_snapshot_id uuid,
      observed_chunk_count integer
    )
    where (per_rule.observed_chunk_count > 0) is distinct from exists (
      select 1
      from public.contract_review_adjudications as adjudication
      where adjudication.fact_run_id = v_run_id
        and adjudication.rule_snapshot_id = per_rule.rule_snapshot_id
    )
  ) then
    raise exception 'DOCUMENT_ADJUDICATION_SOURCE_TRACE_MATRIX_INVALID' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rule_snapshot_id', per_rule.rule_snapshot_id,
      'rule_code', per_rule.rule_code,
      'criteria_hash', per_rule.criteria_hash,
      'configured_absence_decision', per_rule.configured_absence_decision,
      'evidence_basis', case
        when per_rule.uncertain_chunk_count > 0 then 'uncertain_coverage'
        else 'complete_not_observed_coverage'
      end,
      'decision', case
        when per_rule.uncertain_chunk_count > 0 then 'materialize'
        when per_rule.configured_absence_decision = 'ignore' then 'no_risk'
        else 'materialize'
      end,
      'severity', case
        when per_rule.uncertain_chunk_count > 0 then 'yellow'
        when per_rule.configured_absence_decision = 'ignore' then null
        when per_rule.configured_absence_decision = 'yellow_review' then 'yellow'
        else 'red'
      end,
      'materialize', case
        when per_rule.uncertain_chunk_count > 0 then true
        else per_rule.configured_absence_decision <> 'ignore'
      end,
      'reason_code', case
        when per_rule.uncertain_chunk_count > 0 then 'uncertain_coverage_manual_review'
        when per_rule.configured_absence_decision = 'ignore'
          then 'complete_not_observed_no_finding'
        when per_rule.configured_absence_decision = 'yellow_review'
          then 'required_clause_absent_yellow'
        else 'required_clause_absent_red'
      end,
      'coverage_chunk_count', per_rule.coverage_chunk_count,
      'observed_chunk_count', per_rule.observed_chunk_count,
      'uncertain_chunk_count', per_rule.uncertain_chunk_count,
      'not_observed_chunk_count', per_rule.not_observed_chunk_count,
      'customer_output_eligible', false
    ) order by per_rule.rule_code, per_rule.rule_snapshot_id
  ), '[]'::jsonb)
  into v_outcomes
  from jsonb_to_recordset(v_per_rule) as per_rule(
    rule_snapshot_id uuid,
    rule_code text,
    criteria_hash text,
    configured_absence_decision text,
    coverage_chunk_count integer,
    observed_chunk_count integer,
    uncertain_chunk_count integer,
    not_observed_chunk_count integer
  )
  where per_rule.observed_chunk_count = 0;

  v_outcome_count := jsonb_array_length(v_outcomes);
  v_rule_catalog_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_rule_catalog::text, 'UTF8'), 'sha256'
  ), 'hex');
  v_coverage_matrix_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_coverage_matrix::text, 'UTF8'), 'sha256'
  ), 'hex');
  v_adjudication_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(jsonb_build_object(
      'rule_catalog_hash', v_rule_catalog_hash,
      'coverage_matrix_hash', v_coverage_matrix_hash,
      'outcomes', v_outcomes
    )::text, 'UTF8'),
    'sha256'
  ), 'hex');

  v_document_run_id := null;
  insert into public.contract_review_document_runs (
    fact_run_id,
    rule_catalog_hash,
    coverage_matrix_hash,
    adjudication_hash,
    frozen_rule_count,
    outcome_count,
    created_at
  ) values (
    v_run_id,
    v_rule_catalog_hash,
    v_coverage_matrix_hash,
    v_adjudication_hash,
    v_rule_count,
    v_outcome_count,
    v_now
  ) on conflict (fact_run_id) do nothing
  returning id into v_document_run_id;

  v_document_idempotent := v_document_run_id is null;
  if v_document_idempotent then
    select document_run.*
    into v_existing_run
    from public.contract_review_document_runs as document_run
    where document_run.fact_run_id = v_run_id;
    if not found
       or v_existing_run.rule_catalog_hash is distinct from v_rule_catalog_hash
       or v_existing_run.coverage_matrix_hash is distinct from v_coverage_matrix_hash
       or v_existing_run.adjudication_hash is distinct from v_adjudication_hash
       or v_existing_run.frozen_rule_count is distinct from v_rule_count
       or v_existing_run.outcome_count is distinct from v_outcome_count then
      raise exception 'DOCUMENT_ADJUDICATION_ALREADY_STAGED_CONFLICT' using errcode = '55000';
    end if;
    v_document_run_id := v_existing_run.id;
  else
    insert into public.contract_review_document_adjudications (
      document_run_id,
      fact_run_id,
      rule_snapshot_id,
      rule_code,
      criteria_hash,
      configured_absence_decision,
      evidence_basis,
      decision,
      severity,
      materialize,
      reason_code,
      coverage_chunk_count,
      observed_chunk_count,
      uncertain_chunk_count,
      not_observed_chunk_count,
      customer_output_eligible,
      created_at
    )
    select
      v_document_run_id,
      v_run_id,
      outcome.rule_snapshot_id,
      outcome.rule_code,
      outcome.criteria_hash,
      outcome.configured_absence_decision,
      outcome.evidence_basis,
      outcome.decision,
      outcome.severity,
      outcome.materialize,
      outcome.reason_code,
      outcome.coverage_chunk_count,
      outcome.observed_chunk_count,
      outcome.uncertain_chunk_count,
      outcome.not_observed_chunk_count,
      outcome.customer_output_eligible,
      v_now
    from jsonb_to_recordset(v_outcomes) as outcome(
      rule_snapshot_id uuid,
      rule_code text,
      criteria_hash text,
      configured_absence_decision text,
      evidence_basis text,
      decision text,
      severity text,
      materialize boolean,
      reason_code text,
      coverage_chunk_count integer,
      observed_chunk_count integer,
      uncertain_chunk_count integer,
      not_observed_chunk_count integer,
      customer_output_eligible boolean
    );
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rule_snapshot_id', outcome.rule_snapshot_id,
      'rule_code', outcome.rule_code,
      'criteria_hash', outcome.criteria_hash,
      'configured_absence_decision', outcome.configured_absence_decision,
      'evidence_basis', outcome.evidence_basis,
      'decision', outcome.decision,
      'severity', outcome.severity,
      'materialize', outcome.materialize,
      'reason_code', outcome.reason_code,
      'coverage_chunk_count', outcome.coverage_chunk_count,
      'observed_chunk_count', outcome.observed_chunk_count,
      'uncertain_chunk_count', outcome.uncertain_chunk_count,
      'not_observed_chunk_count', outcome.not_observed_chunk_count,
      'customer_output_eligible', outcome.customer_output_eligible
    ) order by outcome.rule_code, outcome.rule_snapshot_id
  ), '[]'::jsonb)
  into v_persisted_outcomes
  from public.contract_review_document_adjudications as outcome
  where outcome.document_run_id = v_document_run_id
    and outcome.fact_run_id = v_run_id;
  if v_persisted_outcomes is distinct from v_outcomes then
    raise exception 'DOCUMENT_ADJUDICATION_PERSISTED_MATRIX_MISMATCH' using errcode = '55000';
  end if;

  return v_receipt || jsonb_build_object(
    'facts_idempotent', coalesce((v_receipt->>'idempotent')::boolean, false),
    'document_run_id', v_document_run_id,
    'document_idempotent', v_document_idempotent,
    'document_outcome_count', v_outcome_count,
    'risk_cards_materialized', false,
    'review_completed', false
  );
end;
$function$;

revoke all on function public.stage_contract_review_facts_v2(
  uuid, uuid, uuid, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.stage_contract_review_facts_v2(
  uuid, uuid, uuid, uuid, jsonb, jsonb
) to service_role;

revoke all on function public.stage_contract_review_facts_v1(
  uuid, uuid, uuid, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;

