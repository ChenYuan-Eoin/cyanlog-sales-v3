set lock_timeout = '5s';
set statement_timeout = '60s';

-- Clone the exact deterministic Preview candidate into a new immutable bundle
-- with a measured local-runtime budget. The old candidate, release_current and
-- provider configs remain untouched. This function is service-role only and
-- moves preview_candidate with a compare-and-swap after all new rows exist.
create or replace function public.create_preview_runtime_calibration_candidate_v1(
  p_org_id uuid,
  p_user_id uuid,
  p_expected_bundle_id uuid,
  p_expected_bundle_version integer,
  p_expected_model_policy_id uuid,
  p_expected_bundle_row_hash text,
  p_expected_bundle_compiled_hash text,
  p_expected_model_policy_row_hash text,
  p_expected_config_manifest_hash text,
  p_expected_invocation_manifest_hash text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.now();
  v_base_bundle public.contract_skill_bundles%rowtype;
  v_base_policy public.model_policies%rowtype;
  v_existing_policy public.model_policies%rowtype;
  v_existing_bundle public.contract_skill_bundles%rowtype;
  v_new_policy public.model_policies%rowtype;
  v_new_bundle public.contract_skill_bundles%rowtype;
  v_new_policy_json jsonb;
  v_new_provider_chain jsonb;
  v_new_policy_version integer;
  v_new_bundle_id uuid;
  v_new_bundle_version integer;
  v_output_schema_hash text;
  v_compiled_from jsonb;
  v_compiled_hash text;
  v_runtime_calibration jsonb;
  v_bundle_row_hash text;
  v_policy_row_hash text;
  v_config_manifest jsonb;
  v_config_manifest_hash text;
  v_invocation_manifest jsonb;
  v_invocation_manifest_hash text;
  v_invocation_count integer;
  v_current_bundle_anchor jsonb;
  v_release_channel_anchor jsonb;
  v_affected_rows integer;
  v_target_bundle_version constant integer := 23;
  v_target_policy_version constant integer := 3;
  v_qwen_timeout_ms constant integer := 60000;
  v_gemma_timeout_ms constant integer := 75000;
  v_policy_timeout_ms constant integer := 75000;
begin
  if p_org_id is null
     or p_user_id is null
     or p_expected_bundle_id is null
     or p_expected_bundle_version is null
     or p_expected_model_policy_id is null
     or coalesce(p_expected_bundle_row_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_expected_bundle_compiled_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_expected_model_policy_row_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_expected_config_manifest_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_expected_invocation_manifest_hash, '') !~ '^[0-9a-f]{64}$'
     or p_request_id is null then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_IDENTITY_REQUIRED' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.users as app_user
    join public.user_organizations as membership
      on membership.user_id = app_user.id
     and membership.org_id = p_org_id
    where app_user.id = p_user_id
      and app_user.status = 'active'
  ) then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_USER_FORBIDDEN' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':CONTRACT_REVIEW_DEFAULT', 0)
  );

  -- Idempotent transport retry: a committed request must resolve to the same
  -- immutable policy/bundle and the channel must still point at that bundle.
  select bundle.*
  into v_existing_bundle
  from public.contract_skill_bundles as bundle
  where bundle.org_id = p_org_id
    and bundle.key = 'CONTRACT_REVIEW_DEFAULT'
    and bundle.release_meta->'runtime_calibration'->>'request_id' = p_request_id::text
  order by bundle.version desc
  limit 1;

  if found then
    select policy.*
    into v_existing_policy
    from public.model_policies as policy
    where policy.id = v_existing_bundle.model_policy_id
      and policy.org_id = p_org_id;

    if not found
       or v_existing_bundle.version <> v_target_bundle_version
       or v_existing_policy.version <> v_target_policy_version
       or v_existing_bundle.release_meta->'runtime_calibration'->>'source_bundle_id'
            <> p_expected_bundle_id::text
       or v_existing_bundle.release_meta->'runtime_calibration'->>'source_bundle_row_hash'
            <> p_expected_bundle_row_hash
       or v_existing_bundle.release_meta->'runtime_calibration'->>'source_model_policy_id'
            <> p_expected_model_policy_id::text
       or v_existing_bundle.release_meta->'runtime_calibration'->>'source_model_policy_row_hash'
            <> p_expected_model_policy_row_hash
       or v_existing_bundle.release_meta->'runtime_calibration'->'calibrated_timeout_ms'
            <> jsonb_build_object('qwen', v_qwen_timeout_ms, 'gemma', v_gemma_timeout_ms)
       or v_existing_policy.timeout_ms <> v_policy_timeout_ms
       or not exists (
      select 1
      from public.contract_skill_bundle_channels as channel
      where channel.org_id = p_org_id
        and channel.key = 'CONTRACT_REVIEW_DEFAULT'
        and channel.channel = 'preview_candidate'
        and channel.bundle_id = v_existing_bundle.id
        and channel.bundle_version = v_existing_bundle.version
    ) then
      raise exception 'PREVIEW_RUNTIME_CALIBRATION_IDEMPOTENCY_CONFLICT' using errcode = '40001';
    end if;

    return jsonb_build_object(
      'request_id', p_request_id,
      'skill_bundle_id', v_existing_bundle.id,
      'skill_bundle_version', v_existing_bundle.version,
      'model_policy_id', v_existing_policy.id,
      'model_policy_version', v_existing_policy.version,
      'channel', 'preview_candidate',
      'idempotent', true
    );
  end if;

  select bundle.*
  into v_base_bundle
  from public.contract_skill_bundle_channels as channel
  join public.contract_skill_bundles as bundle
    on bundle.id = channel.bundle_id
   and bundle.org_id = channel.org_id
   and bundle.key = channel.key
   and bundle.version = channel.bundle_version
  where channel.org_id = p_org_id
    and channel.key = 'CONTRACT_REVIEW_DEFAULT'
    and channel.channel = 'preview_candidate'
    and channel.bundle_id = p_expected_bundle_id
    and channel.bundle_version = p_expected_bundle_version
  for update of channel, bundle;

  if not found then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_BASE_CHANGED' using errcode = '40001';
  end if;

  v_bundle_row_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        public.contract_canonical_json_v1(to_jsonb(v_base_bundle)),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if p_expected_bundle_version <> 22
     or v_base_bundle.version <> 22
     or v_bundle_row_hash <> p_expected_bundle_row_hash
     or v_base_bundle.compiled_hash <> p_expected_bundle_compiled_hash
     or (
       select pg_catalog.max(bundle.version)
       from public.contract_skill_bundles as bundle
       where bundle.org_id = p_org_id
         and bundle.key = 'CONTRACT_REVIEW_DEFAULT'
     ) <> 22
     or v_base_bundle.status <> 'published'
     or v_base_bundle.is_current
     or v_base_bundle.model_policy_id <> p_expected_model_policy_id
     or v_base_bundle.release_meta->>'stage' <> 'candidate'
     or v_base_bundle.release_meta->>'release_eligible' <> 'false'
     or v_base_bundle.output_schema->>'contract' <> 'contract_review_facts_v1'
     or v_base_bundle.output_schema->>'manifest_hash'
          <> 'da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7'
     or pg_catalog.cardinality(v_base_bundle.rule_snapshot_ids) <> 15
     or pg_catalog.cardinality(v_base_bundle.rule_set_snapshot_ids) <> 13 then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_BASE_INVALID' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.contract_analysis_jobs as job
    where job.status in ('preparing', 'queued', 'running')
  ) or exists (
    select 1 from public.contract_reviews as review
    where review.status in ('PARSING', 'ANALYZING')
  ) then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_ACTIVE_REVIEW' using errcode = '55000';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(bundle) order by bundle.id),
    '[]'::jsonb
  ) into v_current_bundle_anchor
  from public.contract_skill_bundles as bundle
  where bundle.org_id = p_org_id
    and bundle.key = 'CONTRACT_REVIEW_DEFAULT'
    and bundle.is_current;

  select coalesce(
    jsonb_agg(to_jsonb(channel) order by channel.bundle_id),
    '[]'::jsonb
  ) into v_release_channel_anchor
  from public.contract_skill_bundle_channels as channel
  where channel.org_id = p_org_id
    and channel.key = 'CONTRACT_REVIEW_DEFAULT'
    and channel.channel = 'release_current';

  select policy.*
  into v_base_policy
  from public.model_policies as policy
  where policy.id = p_expected_model_policy_id
    and policy.org_id = p_org_id
    and policy.status = 'published'
    and not policy.is_current
  for share;

  if not found
     or v_base_policy.routing_policy->>'policy_version'
          <> 'g5.deterministic-preview-model-policy.v1'
     or pg_catalog.jsonb_typeof(to_jsonb(v_base_policy)->'provider_chain') <> 'array'
     or pg_catalog.jsonb_array_length(to_jsonb(v_base_policy)->'provider_chain') <> 2
     or pg_catalog.jsonb_typeof(to_jsonb(v_base_policy)->'source_config_ids') <> 'array'
     or pg_catalog.jsonb_array_length(to_jsonb(v_base_policy)->'source_config_ids') <> 2 then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_POLICY_INVALID' using errcode = '23514';
  end if;

  v_policy_row_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        public.contract_canonical_json_v1(to_jsonb(v_base_policy)),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if v_base_policy.version <> 2
     or v_policy_row_hash <> p_expected_model_policy_row_hash
     or (
       select pg_catalog.max(policy.version)
       from public.model_policies as policy
       where policy.org_id = p_org_id
         and policy.key = v_base_policy.key
     ) <> 2
     or to_jsonb(v_base_policy)->'provider_chain'->0->>'profile' <> 'local-qwen35-9b'
     or to_jsonb(v_base_policy)->'provider_chain'->1->>'profile' <> 'local-gemma4-e4b' then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_POLICY_DRIFT' using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(config) order by config.id),
    '[]'::jsonb
  ) into v_config_manifest
  from public.configs as config
  where config.id = any(v_base_policy.source_config_ids);
  v_config_manifest_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        public.contract_canonical_json_v1(v_config_manifest),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select coalesce(
    jsonb_agg(to_jsonb(invocation) order by invocation.created_at, invocation.id),
    '[]'::jsonb
  ), pg_catalog.count(*)
  into v_invocation_manifest, v_invocation_count
  from public.model_invocations as invocation
  where invocation.skill_bundle_id = v_base_bundle.id
    and invocation.phase = 'fact_extraction';
  v_invocation_manifest_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        public.contract_canonical_json_v1(v_invocation_manifest),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if pg_catalog.jsonb_array_length(v_config_manifest) <> 2
     or v_config_manifest_hash <> p_expected_config_manifest_hash
     or v_invocation_count < 1
     or v_invocation_manifest_hash <> p_expected_invocation_manifest_hash then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_EVIDENCE_DRIFT' using errcode = '23514';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(to_jsonb(v_base_policy)->'provider_chain') as entry(value)
    where pg_catalog.lower(entry.value->>'model') like '%qwen%'
      and entry.value->>'profile' = 'local-qwen35-9b'
      and entry.value->>'runtime_location' = 'local'
      and entry.value->>'data_boundary' = 'local_only'
      and entry.value->>'provider_kind' = 'lm_studio'
      and entry.value->'stages' @> '["fact_extraction"]'::jsonb
      and (entry.value->>'timeout_ms')::integer = 45000
  ) <> 1 or (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(to_jsonb(v_base_policy)->'provider_chain') as entry(value)
    where pg_catalog.lower(entry.value->>'model') like '%gemma%'
      and entry.value->>'profile' = 'local-gemma4-e4b'
      and entry.value->>'runtime_location' = 'local'
      and entry.value->>'data_boundary' = 'local_only'
      and entry.value->>'provider_kind' = 'lm_studio'
      and entry.value->'stages' @> '["fact_extraction"]'::jsonb
      and (entry.value->>'timeout_ms')::integer = 45000
  ) <> 1 then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_PROVIDER_CHAIN_INVALID' using errcode = '23514';
  end if;

  select pg_catalog.jsonb_agg(
    case
      when pg_catalog.lower(entry.value->>'model') like '%qwen%'
        then entry.value || jsonb_build_object('timeout_ms', v_qwen_timeout_ms)
      when pg_catalog.lower(entry.value->>'model') like '%gemma%'
        then entry.value || jsonb_build_object('timeout_ms', v_gemma_timeout_ms)
      else entry.value
    end
    order by entry.ordinality
  )
  into v_new_provider_chain
  from pg_catalog.jsonb_array_elements(to_jsonb(v_base_policy)->'provider_chain')
    with ordinality as entry(value, ordinality);

  select coalesce(pg_catalog.max(policy.version), 0) + 1
  into v_new_policy_version
  from public.model_policies as policy
  where policy.org_id = p_org_id
    and policy.key = v_base_policy.key;

  if v_new_policy_version <> v_target_policy_version then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_POLICY_VERSION_CONFLICT' using errcode = '40001';
  end if;

  v_runtime_calibration := jsonb_build_object(
    'version', 'g5.local-runtime-calibration.v1',
    'request_id', p_request_id,
    'source_bundle_id', v_base_bundle.id,
    'source_bundle_version', v_base_bundle.version,
    'source_bundle_row_hash', v_bundle_row_hash,
    'source_bundle_compiled_hash', v_base_bundle.compiled_hash,
    'source_model_policy_id', v_base_policy.id,
    'source_model_policy_version', v_base_policy.version,
    'source_model_policy_row_hash', v_policy_row_hash,
    'provider_config_manifest_hash', v_config_manifest_hash,
    'fact_invocation_manifest_hash', v_invocation_manifest_hash,
    'fact_invocation_count', v_invocation_count,
    'source_timeout_ms', jsonb_build_object('qwen', 45000, 'gemma', 45000),
    'calibrated_timeout_ms', jsonb_build_object(
      'qwen', v_qwen_timeout_ms,
      'gemma', v_gemma_timeout_ms
    ),
    'policy_timeout_ms', jsonb_build_object('from', 45000, 'to', v_policy_timeout_ms),
    'chunk_max_chars', 1000,
    'transport_schema', 'facts-v1-compact-rule-enum.v1',
    'reason', 'real Preview chunks exceeded the frozen 45s budget; provider calls remain single-attempt and fail-closed'
  );

  v_new_policy_json := to_jsonb(v_base_policy) || jsonb_build_object(
    'id', gen_random_uuid(),
    'version', v_new_policy_version,
    'status', 'published',
    'is_current', false,
    'timeout_ms', v_policy_timeout_ms,
    'provider_chain', v_new_provider_chain,
    'created_by', p_user_id,
    'published_by', p_user_id,
    'created_at', v_now,
    'updated_at', v_now,
    'published_at', v_now
  );

  select (pg_catalog.jsonb_populate_record(
    null::public.model_policies,
    v_new_policy_json
  )).* into v_new_policy;

  insert into public.model_policies
  select (v_new_policy).*
  returning * into v_new_policy;

  if (
    to_jsonb(v_new_policy) - array[
      'id', 'version', 'timeout_ms', 'provider_chain',
      'created_by', 'published_by', 'created_at', 'updated_at', 'published_at'
    ]::text[]
  ) is distinct from (
    to_jsonb(v_base_policy) - array[
      'id', 'version', 'timeout_ms', 'provider_chain',
      'created_by', 'published_by', 'created_at', 'updated_at', 'published_at'
    ]::text[]
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(to_jsonb(v_base_policy)->'provider_chain')
      with ordinality as old_entry(value, ordinality)
    join pg_catalog.jsonb_array_elements(to_jsonb(v_new_policy)->'provider_chain')
      with ordinality as new_entry(value, ordinality)
      on new_entry.ordinality = old_entry.ordinality
    where old_entry.value - 'timeout_ms' is distinct from new_entry.value - 'timeout_ms'
  ) then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_POLICY_CLONE_DRIFT' using errcode = '23514';
  end if;

  select coalesce(pg_catalog.max(bundle.version), 0) + 1
  into v_new_bundle_version
  from public.contract_skill_bundles as bundle
  where bundle.org_id = p_org_id
    and bundle.key = 'CONTRACT_REVIEW_DEFAULT';

  if v_new_bundle_version <> v_target_bundle_version then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_BUNDLE_VERSION_CONFLICT' using errcode = '40001';
  end if;

  v_output_schema_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        public.contract_canonical_json_v1(v_base_bundle.output_schema),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_compiled_from := jsonb_build_object(
    'source', 'deterministic_preview_runtime_calibration',
    'source_bundle_id', v_base_bundle.id,
    'source_bundle_version', v_base_bundle.version,
    'source_bundle_row_hash', v_bundle_row_hash,
    'source_compiled_hash', v_base_bundle.compiled_hash,
    'source_model_policy_id', v_base_policy.id,
    'source_model_policy_row_hash', v_policy_row_hash,
    'provider_config_manifest_hash', v_config_manifest_hash,
    'fact_invocation_manifest_hash', v_invocation_manifest_hash,
    'rule_snapshot_ids', v_base_bundle.rule_snapshot_ids,
    'rule_set_snapshot_ids', v_base_bundle.rule_set_snapshot_ids,
    'model_policy_id', v_new_policy.id,
    'output_schema', v_base_bundle.output_schema,
    'output_schema_hash', v_output_schema_hash,
    'runtime_calibration', v_runtime_calibration
  );
  v_compiled_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        public.contract_canonical_json_v1(v_compiled_from),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.contract_skill_bundles (
    org_id, key, version, status, is_current,
    rule_snapshot_ids, rule_set_snapshot_ids,
    document_snapshot_ids, template_snapshot_ids,
    output_schema, model_policy_id, eval_case_ids,
    release_meta, compiled_from, compiled_hash,
    created_by, published_by, compiled_at, published_at
  ) values (
    p_org_id,
    'CONTRACT_REVIEW_DEFAULT',
    v_new_bundle_version,
    'published',
    false,
    v_base_bundle.rule_snapshot_ids,
    v_base_bundle.rule_set_snapshot_ids,
    v_base_bundle.document_snapshot_ids,
    v_base_bundle.template_snapshot_ids,
    v_base_bundle.output_schema,
    v_new_policy.id,
    v_base_bundle.eval_case_ids,
    v_base_bundle.release_meta || jsonb_build_object(
      'stage', 'candidate',
      'release_eligible', false,
      'release_note', 'G5 Preview local runtime calibration: compact transport schema and measured timeouts',
      'created_by', p_user_id,
      'created_at', v_now,
      'base_bundle_id', v_base_bundle.id,
      'base_bundle_version', v_base_bundle.version,
      'calibration_request_id', p_request_id,
      'runtime_only', true,
      'rule_snapshots_unchanged', true,
      'rule_sets_unchanged', true,
      'output_contract_unchanged', true,
      'runtime_calibration', v_runtime_calibration,
      'output_schema_hash', v_output_schema_hash
    ),
    v_compiled_from,
    v_compiled_hash,
    p_user_id,
    p_user_id,
    v_now,
    v_now
  ) returning * into v_new_bundle;
  v_new_bundle_id := v_new_bundle.id;

  if (
    to_jsonb(v_new_bundle) - array[
      'id', 'version', 'model_policy_id', 'release_meta',
      'compiled_from', 'compiled_hash', 'created_by', 'published_by',
      'compiled_at', 'published_at', 'updated_at'
    ]::text[]
  ) is distinct from (
    to_jsonb(v_base_bundle) - array[
      'id', 'version', 'model_policy_id', 'release_meta',
      'compiled_from', 'compiled_hash', 'created_by', 'published_by',
      'compiled_at', 'published_at', 'updated_at'
    ]::text[]
  ) then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_BUNDLE_CLONE_DRIFT' using errcode = '23514';
  end if;

  update public.contract_skill_bundle_channels
  set bundle_id = v_new_bundle_id,
      bundle_version = v_new_bundle_version,
      updated_by = p_user_id,
      updated_at = v_now
  where org_id = p_org_id
    and key = 'CONTRACT_REVIEW_DEFAULT'
    and channel = 'preview_candidate'
    and bundle_id = p_expected_bundle_id
    and bundle_version = p_expected_bundle_version;
  get diagnostics v_affected_rows = row_count;

  if v_affected_rows <> 1 then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_CHANNEL_CHANGED' using errcode = '40001';
  end if;

  if not exists (
    select 1
    from public.contract_skill_bundle_channels as channel
    where channel.org_id = p_org_id
      and channel.key = 'CONTRACT_REVIEW_DEFAULT'
      and channel.channel = 'preview_candidate'
      and channel.bundle_id = v_new_bundle.id
      and channel.bundle_version = v_target_bundle_version
  ) or v_current_bundle_anchor is distinct from (
    select coalesce(jsonb_agg(to_jsonb(bundle) order by bundle.id), '[]'::jsonb)
    from public.contract_skill_bundles as bundle
    where bundle.org_id = p_org_id
      and bundle.key = 'CONTRACT_REVIEW_DEFAULT'
      and bundle.is_current
  ) or v_release_channel_anchor is distinct from (
    select coalesce(jsonb_agg(to_jsonb(channel) order by channel.bundle_id), '[]'::jsonb)
    from public.contract_skill_bundle_channels as channel
    where channel.org_id = p_org_id
      and channel.key = 'CONTRACT_REVIEW_DEFAULT'
      and channel.channel = 'release_current'
  ) or p_expected_bundle_row_hash <> (
    select pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          public.contract_canonical_json_v1(to_jsonb(bundle)),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    from public.contract_skill_bundles as bundle
    where bundle.id = p_expected_bundle_id
  ) or p_expected_model_policy_row_hash <> (
    select pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          public.contract_canonical_json_v1(to_jsonb(policy)),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    from public.model_policies as policy
    where policy.id = p_expected_model_policy_id
  ) then
    raise exception 'PREVIEW_RUNTIME_CALIBRATION_POSTFLIGHT_INVALID' using errcode = '23514';
  end if;

  return jsonb_build_object(
    'request_id', p_request_id,
    'skill_bundle_id', v_new_bundle_id,
    'skill_bundle_version', v_new_bundle_version,
    'model_policy_id', v_new_policy.id,
    'model_policy_version', v_new_policy.version,
    'channel', 'preview_candidate',
    'source_bundle_id', v_base_bundle.id,
    'source_bundle_version', v_base_bundle.version,
    'runtime_calibration', v_runtime_calibration,
    'idempotent', false
  );
end;
$function$;

revoke all on function public.create_preview_runtime_calibration_candidate_v1(
  uuid, uuid, uuid, integer, uuid, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_preview_runtime_calibration_candidate_v1(
  uuid, uuid, uuid, integer, uuid, text, text, text, text, text, uuid
) to service_role;

reset statement_timeout;
reset lock_timeout;
