-- G5 / migration 067 Preview-only transaction probe.
--
-- Purpose:
--   1. clone an existing validated chunk entirely inside a transaction;
--   2. insert one whitespace-only difference into a source quote;
--   3. prove checkpoint_contract_review_fact_chunk_v1 ->
--      stage_contract_review_facts_v2 accepts the recoverable quote;
--   4. prove repeated, overlapping, and non-whitespace changes remain rejected;
--   5. roll back every fixture row.
--
-- This script does not call a model, Storage, or Production.

begin;

do $probe$
declare
  v_contract_template public.contracts%rowtype;
  v_review_template public.contract_reviews%rowtype;
  v_job_template public.contract_analysis_jobs%rowtype;
  v_page_map_template public.contract_source_page_maps%rowtype;
  v_checkpoint_template public.contract_review_fact_chunk_checkpoints%rowtype;
  v_invocation_template public.model_invocations%rowtype;
  v_policy public.model_policies%rowtype;

  v_contract_id uuid := gen_random_uuid();
  v_review_id uuid := gen_random_uuid();
  v_job_id uuid := gen_random_uuid();
  v_invocation_id uuid := gen_random_uuid();
  v_lock_token uuid := gen_random_uuid();

  v_source_text text;
  v_source_text_hash text;
  v_chunk_hash text;
  v_raw_original jsonb;
  v_candidate jsonb;
  v_source_quote text;
  v_candidate_quote text;
  v_rule_code text;
  v_facts jsonb;
  v_source_char_start integer;
  v_source_start integer;
  v_source_end integer;
  v_coverage jsonb;
  v_raw_json jsonb;
  v_raw_output text;
  v_raw_hash text;
  v_request_metadata jsonb;
  v_usage jsonb;
  v_response_metadata jsonb;
  v_checkpoint_receipt jsonb;
  v_stage_receipt jsonb;
  v_candidate_id text;
begin
  select * into strict v_contract_template
  from public.contracts
  where id = '5cdabf0a-0d5a-4435-bca5-062ffad52c53'::uuid;

  select * into strict v_review_template
  from public.contract_reviews
  where id = 'f0f0225f-2cbe-47c6-917f-e2af5346e839'::uuid;

  select * into strict v_job_template
  from public.contract_analysis_jobs
  where id = '14541e1d-9df1-450d-91d8-33c32ecdb27c'::uuid;

  select * into strict v_page_map_template
  from public.contract_source_page_maps
  where contract_id = v_contract_template.id;

  select * into strict v_checkpoint_template
  from public.contract_review_fact_chunk_checkpoints
  where analysis_job_id = v_job_template.id
    and chunk_index = 2
    and source_anchor_validated;

  select * into strict v_invocation_template
  from public.model_invocations
  where id = v_checkpoint_template.model_invocation_id;

  select * into strict v_policy
  from public.model_policies
  where id = v_review_template.model_policy_id;

  v_source_text := public.contract_utf16_slice(
    v_contract_template.parsed_text,
    v_checkpoint_template.source_start,
    v_checkpoint_template.source_end
  );
  if coalesce(v_source_text, '') = '' then
    raise exception 'G5_067_PROBE_SOURCE_EMPTY';
  end if;

  v_source_text_hash := encode(
    extensions.digest(convert_to(v_source_text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_chunk_hash := v_source_text_hash;
  v_raw_original := v_checkpoint_template.raw_output::jsonb;
  v_candidate := v_raw_original->'candidates'->0;
  v_source_quote := btrim(v_candidate->>'source_quote');
  v_rule_code := v_candidate->>'rule_code';
  v_facts := v_candidate->'facts';

  if char_length(v_source_quote) < 4
     or strpos(v_source_text, v_source_quote) < 1 then
    raise exception 'G5_067_PROBE_EXACT_TEMPLATE_MISSING';
  end if;

  v_candidate_quote :=
    substr(v_source_quote, 1, 1) || ' ' || substr(v_source_quote, 2);
  v_source_char_start := strpos(v_source_text, v_source_quote) - 1;
  v_source_start := public.contract_utf16_codeunit_length(
    left(v_source_text, v_source_char_start)
  );
  v_source_end := v_source_start
    + public.contract_utf16_codeunit_length(v_source_quote);

  select jsonb_agg(
    jsonb_build_object(
      'rule_code', snapshot.config_snapshot->>'code',
      'status', case
        when snapshot.config_snapshot->>'code' = v_rule_code
          then 'observed'
        else 'not_observed'
      end
    )
    order by snapshot.config_snapshot->>'code'
  )
  into v_coverage
  from public.contract_rule_snapshots as snapshot
  where snapshot.id = any(v_review_template.rule_snapshot_ids);

  v_raw_json := jsonb_build_object(
    'candidates', jsonb_build_array(
      v_candidate || jsonb_build_object('source_quote', v_candidate_quote)
    ),
    'coverage', v_coverage,
    'summary', 'g5-067-transaction-probe'
  );
  v_raw_output := v_raw_json::text;
  v_raw_hash := encode(
    extensions.digest(convert_to(v_raw_output, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.contracts
  select (
    jsonb_populate_record(
      null::public.contracts,
      to_jsonb(v_contract_template) || jsonb_build_object(
        'id', v_contract_id,
        'contract_no', 'G5-067-' || left(v_contract_id::text, 8),
        'status', 'ANALYZING',
        'parsed_text', v_source_text,
        'storage_path', v_review_template.source_storage_path,
        'conclusion', 'PENDING',
        'concluded_at', null,
        'concluded_by', null,
        'created_at', now(),
        'updated_at', now()
      )
    )
  ).*;

  -- Review source-identity triggers require the current page map to exist
  -- before the ReviewRun row is inserted.
  insert into public.contract_source_page_maps
  select (
    jsonb_populate_record(
      null::public.contract_source_page_maps,
      to_jsonb(v_page_map_template) || jsonb_build_object(
        'contract_id', v_contract_id,
        'storage_path', v_review_template.source_storage_path,
        'source_hash', v_review_template.source_hash,
        'source_text_hash', v_source_text_hash,
        'created_at', now(),
        'updated_at', now()
      )
    )
  ).*;

  insert into public.contract_reviews
  select (
    jsonb_populate_record(
      null::public.contract_reviews,
      to_jsonb(v_review_template) || jsonb_build_object(
        'id', v_review_id,
        'contract_id', v_contract_id,
        'status', 'ANALYZING',
        'review_trigger', 'direct',
        'parent_review_id', null,
        'source_storage_path', v_review_template.source_storage_path,
        'source_hash', v_review_template.source_hash,
        'source_text_hash', v_source_text_hash,
        'model_invocation_ids', to_jsonb('{}'::uuid[]),
        'summary', null,
        'result', null,
        'error_message', null,
        'started_at', now(),
        'completed_at', null,
        'created_at', now(),
        'updated_at', now()
      )
    )
  ).*;

  insert into public.contract_analysis_jobs
  select (
    jsonb_populate_record(
      null::public.contract_analysis_jobs,
      to_jsonb(v_job_template) || jsonb_build_object(
        'id', v_job_id,
        'contract_id', v_contract_id,
        'review_id', v_review_id,
        'status', 'running',
        'attempts', 1,
        'start_request_id', null,
        'lock_token', v_lock_token,
        'locked_at', now(),
        'locked_by', 'g5-067-transaction-probe',
        'lock_expires_at', now() + interval '15 minutes',
        'heartbeat_at', now(),
        'last_heartbeat_at', now(),
        'last_error', null,
        'error_message', null,
        'completed_at', null,
        'finished_at', null,
        'created_at', now(),
        'updated_at', now()
      )
    )
  ).*;

  v_request_metadata := jsonb_build_object(
    'output_contract', 'facts_v1',
    'validation_valid', true,
    'chunk_index', 1,
    'chunk_total', 1,
    'chunk_start', 0,
    'chunk_end', public.contract_utf16_codeunit_length(v_source_text),
    'chunk_hash', v_chunk_hash,
    'config_id', v_invocation_template.request_meta->'metadata'->>'config_id',
    'frozen_model_policy_id', v_policy.id,
    'frozen_model_policy_version', v_policy.version
  );
  v_usage := jsonb_build_object(
    'inputTokens', 1,
    'outputTokens', 1,
    'totalTokens', 2
  );
  v_response_metadata := jsonb_build_object(
    'output_contract', 'facts_v1',
    'output_canonicalized', true,
    'raw_output_sha256', v_raw_hash,
    'staged_output_sha256', v_raw_hash,
    'provider_raw_output_sha256', v_raw_hash,
    'chunk_hash', v_chunk_hash,
    'facts_candidate_count', 1,
    'coverage_normalization_count', 0,
    'coverage_normalizations', '[]'::jsonb,
    'trusted_context_normalization_count', 0,
    'trusted_context_normalizations', '[]'::jsonb,
    'model_fact_normalization_count', 0,
    'model_fact_normalizations', '[]'::jsonb,
    'source_anchor_normalization_count', 1,
    'source_anchor_normalizations', jsonb_build_array(
      jsonb_build_object(
        'rule_code', v_rule_code,
        'mode', 'delete_all_whitespace'
      )
    )
  );

  select public.checkpoint_contract_review_fact_chunk_v1(
    v_job_id,
    v_contract_id,
    v_review_id,
    v_lock_token,
    v_invocation_id,
    v_invocation_template.provider,
    v_invocation_template.request_meta->>'provider_name',
    v_invocation_template.model,
    0,
    0,
    1,
    'g5-067-transaction-probe',
    v_request_metadata,
    v_usage,
    v_response_metadata,
    v_raw_output
  )
  into v_checkpoint_receipt;

  if coalesce((v_checkpoint_receipt->>'idempotent')::boolean, true)
     or (v_checkpoint_receipt->>'chunk_index')::integer <> 1
     or not exists (
       select 1
       from public.contract_review_fact_chunk_checkpoints
       where analysis_job_id = v_job_id
         and chunk_index = 1
         and source_anchor_validated
     ) then
    raise exception 'G5_067_PROBE_CHECKPOINT_FAILED';
  end if;

  v_candidate_id := 'fact-' || substr(
    encode(
      extensions.digest(convert_to(v_invocation_id::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    1,
    24
  );

  select public.stage_contract_review_facts_v2(
    v_job_id,
    v_contract_id,
    v_review_id,
    v_lock_token,
    jsonb_build_array(
      jsonb_build_object(
        'model_invocation_id', v_invocation_id,
        'raw_output', v_raw_output
      )
    ),
    jsonb_build_array(
      jsonb_build_object(
        'model_invocation_id', v_invocation_id,
        'candidate_id', v_candidate_id,
        'rule_code', v_rule_code,
        'candidate_source_quote', v_candidate_quote,
        'source_start', v_source_start,
        'source_end', v_source_end,
        'raw_facts', v_facts,
        'normalized_facts', v_facts,
        'level_results', jsonb_build_object(
          'A', false,
          'B', false,
          'C', false
        ),
        'matched_levels', '[]'::jsonb,
        'decision', 'materialize',
        'reason_code', 'default_unknown_yellow',
        'suppressed_by_candidate_id', null
      )
    )
  )
  into v_stage_receipt;

  if (v_stage_receipt->>'chunk_count')::integer <> 1
     or (v_stage_receipt->>'adjudication_count')::integer <> 1
     or coalesce((v_stage_receipt->>'review_completed')::boolean, true)
     or not exists (
       select 1
       from public.contract_review_adjudications
       where review_id = v_review_id
         and candidate_id = v_candidate_id
         and source_exact_text = v_source_quote
         and source_exact_text <> v_candidate_quote
     ) then
    raise exception 'G5_067_PROBE_STAGE_FAILED';
  end if;

  if not public.contract_fact_chunk_quote_is_recoverable_v1(
       '合同金额5%', '合同金额 5%'
     )
     or public.contract_fact_chunk_quote_is_recoverable_v1(
       '合同金额5%以及合同金额5%', '合同金额5%'
     )
     or public.contract_fact_chunk_quote_is_recoverable_v1('aaaaa', 'aaaa')
     or public.contract_fact_chunk_quote_is_recoverable_v1(
       '合同金额5%', '合同金额6%'
     ) then
    raise exception 'G5_067_PROBE_QUOTE_MATRIX_FAILED';
  end if;
end;
$probe$;

rollback;

select
  true as checkpoint_to_stage_whitespace_probe_passed,
  true as transaction_rolled_back,
  true as no_model_call,
  true as production_untouched;
