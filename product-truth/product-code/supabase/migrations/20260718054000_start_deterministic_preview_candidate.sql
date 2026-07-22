set lock_timeout = '5s';
set statement_timeout = '60s';

-- Explicit candidate-only analysis start. This freezes the exact bundle behind
-- preview_candidate into a new ReviewRun and queued job. It never consults or
-- mutates the current release channel, and it does not expose the normal start
-- route to candidate execution.
create or replace function public.start_contract_analysis_candidate_job_v1(
  p_org_id uuid,
  p_contract_id uuid,
  p_requested_by uuid,
  p_start_request_id uuid,
  p_expected_contract_status text,
  p_strategy_id uuid,
  p_source_storage_path text,
  p_source_hash text,
  p_source_text_hash text,
  p_preferred_provider text
)
returns table(review_id uuid, job_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bundle public.contract_skill_bundles%rowtype;
  v_policy public.model_policies%rowtype;
  v_contract_status text;
  v_contract_storage_path text;
  v_contract_source_hash text;
  v_contract_source_text_hash text;
  v_parsed_text_hash text;
  v_review_id uuid;
  v_job_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_affected_rows integer;
begin
  if p_org_id is null
     or p_contract_id is null
     or p_requested_by is null
     or p_start_request_id is null then
    raise exception 'CANDIDATE_START_IDENTITY_REQUIRED' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_start_request_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':CONTRACT_REVIEW_DEFAULT', 0)
  );

  if p_expected_contract_status not in ('PENDING', 'FAILED', 'COMPLETED') then
    raise exception 'CANDIDATE_START_CONTRACT_STATUS_INVALID' using errcode = '22023';
  end if;

  if nullif(pg_catalog.btrim(p_source_storage_path), '') is null
     or coalesce(p_source_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_source_text_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'CANDIDATE_START_SOURCE_IDENTITY_REQUIRED' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.users as requester
    join public.user_organizations as membership
      on membership.user_id = requester.id
     and membership.org_id = p_org_id
    where requester.id = p_requested_by
      and requester.status = 'active'
  ) then
    raise exception 'CANDIDATE_START_REQUESTER_FORBIDDEN' using errcode = '42501';
  end if;

  -- The channel primary key makes this resolution unique. Holding a share lock
  -- keeps the selected channel/bundle stable until the ReviewRun is committed.
  select bundle.*
  into v_bundle
  from public.contract_skill_bundle_channels as channel
  join public.contract_skill_bundles as bundle
    on bundle.id = channel.bundle_id
   and bundle.org_id = channel.org_id
   and bundle.key = channel.key
   and bundle.version = channel.bundle_version
  where channel.org_id = p_org_id
    and channel.key = 'CONTRACT_REVIEW_DEFAULT'
    and channel.channel = 'preview_candidate'
  for share of channel, bundle;

  if not found then
    raise exception 'CANDIDATE_START_PREVIEW_CHANNEL_NOT_FOUND' using errcode = '55000';
  end if;

  if v_bundle.status <> 'published'
     or v_bundle.is_current
     or v_bundle.release_meta->>'stage' <> 'candidate'
     or v_bundle.release_meta->>'release_eligible' <> 'false'
     or v_bundle.release_meta->>'criteria_schema_version' <> '1'
     or v_bundle.release_meta->>'adjudicator_version' <> 'deterministic-adjudicator.v1'
     or pg_catalog.jsonb_typeof(v_bundle.output_schema) <> 'object'
     or not (
       v_bundle.output_schema
       @> '{"contract":"contract_review_facts_v1","version":1}'::jsonb
     )
     or v_bundle.output_schema->>'manifest_hash'
          <> 'da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7'
     or v_bundle.model_policy_id is null then
    raise exception 'CANDIDATE_START_BUNDLE_CONTRACT_INVALID' using errcode = '23514';
  end if;

  if v_bundle.rule_snapshot_ids is null
     or pg_catalog.cardinality(v_bundle.rule_snapshot_ids) <> 15
     or pg_catalog.array_position(v_bundle.rule_snapshot_ids, null) is not null
     or pg_catalog.cardinality(v_bundle.rule_snapshot_ids) <> (
       select pg_catalog.count(distinct supplied.rule_snapshot_id)
       from pg_catalog.unnest(v_bundle.rule_snapshot_ids) as supplied(rule_snapshot_id)
     ) then
    raise exception 'CANDIDATE_START_RULE_SNAPSHOTS_INVALID' using errcode = '23514';
  end if;

  if (
    select pg_catalog.count(*)
    from public.contract_rule_snapshots as snapshot
    join public.contract_rules_v2 as rule
      on rule.id = snapshot.rule_id
     and rule.org_id = p_org_id
    where snapshot.id = any(v_bundle.rule_snapshot_ids)
      and snapshot.status = 'published'
      and snapshot.criteria_hash is not null
      and pg_catalog.jsonb_typeof(snapshot.config_snapshot->'review_criteria') = 'object'
      and snapshot.config_snapshot->'review_criteria' <> '{}'::jsonb
      and snapshot.config_snapshot->'review_criteria'->>'schema_version' = '1'
      and snapshot.config_snapshot->'review_criteria'
        ?& array['fact_schema', 'level_a', 'level_b', 'level_c']
      and snapshot.config_snapshot @> '{"criteria_schema_version":1}'::jsonb
      and snapshot.config_snapshot->'review_criteria'->>'absence_decision'
        in ('ignore', 'yellow_review', 'red_risk')
      and pg_catalog.jsonb_typeof(snapshot.config_snapshot->'mutually_exclusive_with') = 'array'
      and pg_catalog.jsonb_typeof(snapshot.config_snapshot->'specificity') = 'number'
      and snapshot.config_snapshot->>'default_unknown'
        in ('yellow_review', 'suppress', 'reject_finding')
  ) <> 15 then
    raise exception 'CANDIDATE_START_RULE_CATALOG_INVALID' using errcode = '23514';
  end if;

  if (
    select pg_catalog.array_agg(
      snapshot.config_snapshot->>'code'
      order by snapshot.config_snapshot->>'code'
    )
    from public.contract_rule_snapshots as snapshot
    where snapshot.id = any(v_bundle.rule_snapshot_ids)
  ) is distinct from array[
    'R001', 'R002', 'R003', 'R004', 'R005',
    'R006', 'R007', 'R008', 'R009', 'R010',
    'R011', 'R012', 'R013', 'R014', 'R015'
  ]::text[] then
    raise exception 'CANDIDATE_START_RULE_CODES_INVALID' using errcode = '23514';
  end if;

  if v_bundle.rule_set_snapshot_ids is null
     or pg_catalog.cardinality(v_bundle.rule_set_snapshot_ids) = 0
     or pg_catalog.array_position(v_bundle.rule_set_snapshot_ids, null) is not null
     or pg_catalog.cardinality(v_bundle.rule_set_snapshot_ids) <> (
       select pg_catalog.count(distinct supplied.rule_set_snapshot_id)
       from pg_catalog.unnest(v_bundle.rule_set_snapshot_ids)
         as supplied(rule_set_snapshot_id)
     ) then
    raise exception 'CANDIDATE_START_RULE_SET_SNAPSHOTS_INVALID' using errcode = '23514';
  end if;

  if (
    select pg_catalog.count(*)
    from public.contract_rule_set_snapshots as snapshot
    where snapshot.id = any(v_bundle.rule_set_snapshot_ids)
      and snapshot.org_id = p_org_id
      and snapshot.status = 'published'
  ) <> pg_catalog.cardinality(v_bundle.rule_set_snapshot_ids)
     or exists (
       select supplied.rule_snapshot_id
       from pg_catalog.unnest(v_bundle.rule_snapshot_ids) as supplied(rule_snapshot_id)
       except
       select included.rule_snapshot_id
       from public.contract_rule_set_snapshots as rule_set_snapshot
       cross join lateral pg_catalog.unnest(rule_set_snapshot.rule_snapshot_ids)
         as included(rule_snapshot_id)
       where rule_set_snapshot.id = any(v_bundle.rule_set_snapshot_ids)
     )
     or exists (
       select included.rule_snapshot_id
       from public.contract_rule_set_snapshots as rule_set_snapshot
       cross join lateral pg_catalog.unnest(rule_set_snapshot.rule_snapshot_ids)
         as included(rule_snapshot_id)
       where rule_set_snapshot.id = any(v_bundle.rule_set_snapshot_ids)
       except
       select supplied.rule_snapshot_id
       from pg_catalog.unnest(v_bundle.rule_snapshot_ids) as supplied(rule_snapshot_id)
     ) then
    raise exception 'CANDIDATE_START_RULE_SET_MEMBERSHIP_INVALID' using errcode = '23514';
  end if;

  select policy.*
  into v_policy
  from public.model_policies as policy
  where policy.id = v_bundle.model_policy_id
    and policy.org_id = p_org_id
    and policy.key = 'CONTRACT_REVIEW_DEFAULT'
    and policy.status = 'published'
    and not policy.is_current
    and policy.routing_policy->>'policy_version'
      = 'g5.deterministic-preview-model-policy.v1'
  for share;

  if not found
     or pg_catalog.jsonb_typeof(v_policy.provider_chain) <> 'array'
     or pg_catalog.jsonb_array_length(v_policy.provider_chain) <> 2
     or pg_catalog.jsonb_typeof(pg_catalog.to_jsonb(v_policy.source_config_ids)) <> 'array'
     or pg_catalog.jsonb_array_length(pg_catalog.to_jsonb(v_policy.source_config_ids)) <> 2 then
    raise exception 'CANDIDATE_START_MODEL_POLICY_INVALID' using errcode = '23514';
  end if;

  -- facts_v1 has no rule-engine fallback. Every frozen provider must be a real
  -- model provider, authorize fact_extraction, and bind an immutable config ID.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_policy.provider_chain) as provider(entry)
    where pg_catalog.jsonb_typeof(provider.entry) <> 'object'
       or nullif(pg_catalog.btrim(provider.entry->>'model'), '') is null
       or pg_catalog.lower(coalesce(provider.entry->>'provider_kind', '')) <> 'lm_studio'
       or pg_catalog.lower(coalesce(provider.entry->>'runtime_location', '')) <> 'local'
       or pg_catalog.lower(coalesce(provider.entry->>'data_boundary', '')) <> 'local_only'
       or nullif(pg_catalog.btrim(provider.entry->>'source_config_id'), '') is null
       or provider.entry->>'source_config_id'
            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or pg_catalog.jsonb_typeof(provider.entry->'stages') <> 'array'
       or not (provider.entry->'stages' @> '["fact_extraction"]'::jsonb)
       or not exists (
         select 1
         from public.configs as config
         where config.id = (provider.entry->>'source_config_id')::uuid
           and config.org_id = p_org_id
           and config.type::text = 'AI_CONFIG'
           and config.status::text = 'PUBLISHED'
           and coalesce(config.value->>'kind', 'provider') = 'provider'
           and config.value->'enabled' is not distinct from 'true'::jsonb
           and config.value->>'provider_kind' = 'lm_studio'
           and config.value->>'model' = provider.entry->>'model'
           and coalesce(config.value->>'base_url', '')
             ~* '^http://(127[.]0[.]0[.]1|localhost|\[::1\])(:[0-9]{1,5})?(/|$)'
           and coalesce(pg_catalog.btrim(config.value->>'api_key'), '') = ''
           and pg_catalog.lower(coalesce(config.value->>'cost_tracking', 'false')) = 'false'
       )
  ) then
    raise exception 'CANDIDATE_START_MODEL_PROVIDER_INVALID' using errcode = '23514';
  end if;

  if pg_catalog.jsonb_array_length(v_policy.provider_chain) <> (
       select pg_catalog.count(distinct provider.entry->>'source_config_id')
       from pg_catalog.jsonb_array_elements(v_policy.provider_chain) as provider(entry)
     )
     or pg_catalog.jsonb_array_length(pg_catalog.to_jsonb(v_policy.source_config_ids)) <> (
       select pg_catalog.count(distinct source_id)
       from pg_catalog.jsonb_array_elements_text(
         pg_catalog.to_jsonb(v_policy.source_config_ids)
       ) as source(source_id)
     )
     or exists (
       select provider.entry->>'source_config_id'
       from pg_catalog.jsonb_array_elements(v_policy.provider_chain) as provider(entry)
       except
       select source_id
       from pg_catalog.jsonb_array_elements_text(
         pg_catalog.to_jsonb(v_policy.source_config_ids)
       ) as source(source_id)
     )
     or exists (
       select source_id
       from pg_catalog.jsonb_array_elements_text(
         pg_catalog.to_jsonb(v_policy.source_config_ids)
       ) as source(source_id)
       except
       select provider.entry->>'source_config_id'
       from pg_catalog.jsonb_array_elements(v_policy.provider_chain) as provider(entry)
     ) then
    raise exception 'CANDIDATE_START_MODEL_POLICY_SOURCES_INVALID' using errcode = '23514';
  end if;

  select contract.status,
         contract.storage_path,
         page_map.source_hash,
         page_map.source_text_hash,
         pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(coalesce(contract.parsed_text, ''), 'UTF8'),
             'sha256'
           ),
           'hex'
         )
  into v_contract_status,
       v_contract_storage_path,
       v_contract_source_hash,
       v_contract_source_text_hash,
       v_parsed_text_hash
  from public.contracts as contract
  join public.contract_source_page_maps as page_map
    on page_map.contract_id = contract.id
   and page_map.storage_path = contract.storage_path
  where contract.id = p_contract_id
    and contract.org_id = p_org_id
  for update of contract, page_map;

  if not found then
    raise exception 'CANDIDATE_START_CONTRACT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_contract_status is distinct from p_expected_contract_status then
    raise exception 'CANDIDATE_START_CONTRACT_STATUS_CHANGED' using errcode = '40001';
  end if;

  if v_contract_storage_path is distinct from p_source_storage_path
     or v_contract_source_hash is distinct from p_source_hash
     or v_contract_source_text_hash is distinct from p_source_text_hash
     or v_parsed_text_hash is distinct from p_source_text_hash then
    raise exception 'CANDIDATE_START_SOURCE_IDENTITY_CHANGED' using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.contract_analysis_jobs as job
    where job.contract_id = p_contract_id
      and job.status in ('preparing', 'queued', 'running')
  ) or exists (
    select 1
    from public.contract_reviews as review
    where review.contract_id = p_contract_id
      and review.status in ('PARSING', 'ANALYZING')
  ) then
    raise exception 'CANDIDATE_START_ANALYSIS_ALREADY_ACTIVE' using errcode = '55000';
  end if;

  if p_strategy_id is not null and not exists (
    select 1
    from public.review_strategies as strategy
    where strategy.id = p_strategy_id
      and (strategy.org_id is null or strategy.org_id = p_org_id)
  ) then
    raise exception 'CANDIDATE_START_STRATEGY_INVALID' using errcode = '23514';
  end if;

  insert into public.contract_reviews (
    contract_id,
    status,
    started_at,
    strategy_id,
    rule_version,
    skill_bundle_id,
    model_policy_id,
    rule_snapshot_ids,
    rule_set_snapshot_ids,
    review_trigger,
    preferred_provider,
    source_storage_path,
    source_hash,
    source_text_hash
  ) values (
    p_contract_id,
    'PARSING',
    v_now,
    p_strategy_id,
    v_bundle.version,
    v_bundle.id,
    v_bundle.model_policy_id,
    v_bundle.rule_snapshot_ids,
    v_bundle.rule_set_snapshot_ids,
    'direct',
    nullif(pg_catalog.btrim(p_preferred_provider), ''),
    p_source_storage_path,
    p_source_hash,
    p_source_text_hash
  ) returning id into v_review_id;

  insert into public.contract_analysis_jobs (
    contract_id,
    review_id,
    requested_by,
    start_request_id,
    status,
    updated_at
  ) values (
    p_contract_id,
    v_review_id,
    p_requested_by,
    p_start_request_id,
    'queued',
    v_now
  ) returning id into v_job_id;

  update public.contracts
  set status = 'PARSING',
      updated_at = v_now
  where id = p_contract_id
    and org_id = p_org_id
    and status = p_expected_contract_status;

  get diagnostics v_affected_rows = row_count;
  if v_affected_rows <> 1 then
    raise exception 'CANDIDATE_START_CONTRACT_STATUS_CHANGED' using errcode = '40001';
  end if;

  return query select v_review_id, v_job_id;
end;
$function$;

revoke all on function public.start_contract_analysis_candidate_job_v1(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.start_contract_analysis_candidate_job_v1(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text, text
) to service_role;
