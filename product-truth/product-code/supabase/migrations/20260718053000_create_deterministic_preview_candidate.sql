set lock_timeout = '5s';
set statement_timeout = '60s';

-- The application and database share one stable JSON representation for the
-- reviewed R001-R015 manifest. The allow-listed digest below is generated from
-- DETERMINISTIC_PREVIEW_RULES after its A/B/C/unknown property tests pass.
create or replace function public.contract_canonical_json_v1(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  v_kind text := jsonb_typeof(p_value);
  v_result text;
begin
  if v_kind = 'object' then
    select '{' || coalesce(
      string_agg(
        to_jsonb(member.key)::text || ':' || public.contract_canonical_json_v1(member.value),
        ',' order by member.key collate "C"
      ),
      ''
    ) || '}'
    into v_result
    from jsonb_each(p_value) as member(key, value);
    return v_result;
  end if;

  if v_kind = 'array' then
    select '[' || coalesce(
      string_agg(
        public.contract_canonical_json_v1(member.value),
        ',' order by member.ordinality
      ),
      ''
    ) || ']'
    into v_result
    from jsonb_array_elements(p_value) with ordinality as member(value, ordinality);
    return v_result;
  end if;

  if v_kind = 'string' then
    return to_jsonb(p_value #>> '{}')::text;
  end if;

  return p_value::text;
end;
$function$;

-- Structural fail-closed validation for the predicate DSL. Semantic
-- disjointness is additionally bound by the immutable manifest digest.
create or replace function public.validate_contract_fact_predicate_v1(
  p_predicate jsonb,
  p_fact_schema jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  v_operator text;
  v_operand jsonb;
  v_keys text[];
begin
  if jsonb_typeof(p_predicate) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_predicate)) <> 1
     or jsonb_typeof(p_fact_schema) <> 'object' then
    return false;
  end if;

  select key, value
  into v_operator, v_operand
  from jsonb_each(p_predicate);

  if v_operator in ('all', 'any') then
    return coalesce(
      jsonb_typeof(v_operand) = 'array'
      and jsonb_array_length(v_operand) > 0
      and not exists (
        select 1
        from jsonb_array_elements(v_operand) as child(value)
        where not public.validate_contract_fact_predicate_v1(child.value, p_fact_schema)
      ),
      false
    );
  end if;

  if v_operator = 'not' then
    return public.validate_contract_fact_predicate_v1(v_operand, p_fact_schema);
  end if;

  if jsonb_typeof(v_operand) is distinct from 'object' then
    return false;
  end if;

  select coalesce(array_agg(key order by key), '{}'::text[])
  into v_keys
  from jsonb_object_keys(v_operand) as object_key(key);

  if v_operator = 'present' then
    return coalesce(v_keys = array['fact']::text[]
      and jsonb_typeof(v_operand->'fact') = 'string'
      and p_fact_schema ? (v_operand->>'fact'), false);
  end if;

  if v_operator = 'eq' then
    return coalesce(v_keys = array['fact', 'value']::text[]
      and jsonb_typeof(v_operand->'fact') = 'string'
      and p_fact_schema ? (v_operand->>'fact'), false);
  end if;

  if v_operator = 'in' then
    return coalesce(v_keys = array['fact', 'values']::text[]
      and jsonb_typeof(v_operand->'fact') = 'string'
      and jsonb_typeof(v_operand->'values') = 'array'
      and jsonb_array_length(v_operand->'values') > 0
      and p_fact_schema ? (v_operand->>'fact'), false);
  end if;

  if v_operator in ('gt', 'gte', 'lt', 'lte') then
    return coalesce(v_keys = array['fact', 'value']::text[]
      and jsonb_typeof(v_operand->'fact') = 'string'
      and jsonb_typeof(v_operand->'value') = 'number'
      and p_fact_schema ? (v_operand->>'fact'), false);
  end if;

  return false;
end;
$function$;

-- Candidate policies are immutable immediately after insertion. Runtime
-- source_config drift is still detected by the existing frozen-chain checks.
create or replace function public.reject_deterministic_preview_model_policy_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if to_jsonb(old)->'routing_policy'->>'policy_version'
       = 'g5.deterministic-preview-model-policy.v1' then
    raise exception 'DETERMINISTIC_PREVIEW_MODEL_POLICY_IMMUTABLE' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists trg_reject_deterministic_preview_model_policy_mutation_v1
  on public.model_policies;
create trigger trg_reject_deterministic_preview_model_policy_mutation_v1
  before update or delete on public.model_policies
  for each row execute function public.reject_deterministic_preview_model_policy_mutation_v1();

-- A frozen policy is not local-only if its source row can later be repointed to
-- a cloud URL or another model. Freeze only configs referenced by this policy
-- family; unrelated configuration-center rows remain editable.
create or replace function public.reject_deterministic_preview_provider_config_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.model_policies as policy
    where policy.routing_policy->>'policy_version'
            = 'g5.deterministic-preview-model-policy.v1'
      and to_jsonb(policy.source_config_ids) @> jsonb_build_array(old.id)
  ) then
    raise exception 'DETERMINISTIC_PREVIEW_PROVIDER_CONFIG_IMMUTABLE' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists trg_reject_deterministic_preview_provider_config_mutation_v1
  on public.configs;
create trigger trg_reject_deterministic_preview_provider_config_mutation_v1
  before update or delete on public.configs
  for each row execute function public.reject_deterministic_preview_provider_config_mutation_v1();

-- While a deterministic Preview channel exists, the release baseline is a
-- protected comparison anchor. Promotion is a later, explicit transaction;
-- legacy publishers and direct column updates may not move current meanwhile.
create or replace function public.reject_release_current_mutation_during_preview_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.is_current is distinct from new.is_current
     and exists (
       select 1
       from public.contract_skill_bundle_channels as channel
       join public.contract_skill_bundles as candidate
         on candidate.id = channel.bundle_id
        and candidate.org_id = channel.org_id
        and candidate.key = channel.key
        and candidate.version = channel.bundle_version
       where channel.org_id = old.org_id
         and channel.key = old.key
         and channel.channel = 'preview_candidate'
         and candidate.output_schema->>'manifest_hash'
           = 'da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7'
     ) then
    raise exception 'RELEASE_CURRENT_FROZEN_DURING_DETERMINISTIC_PREVIEW' using errcode = '55000';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_reject_release_current_mutation_during_preview_v1
  on public.contract_skill_bundles;
create trigger trg_reject_release_current_mutation_during_preview_v1
  before update of is_current on public.contract_skill_bundles
  for each row execute function public.reject_release_current_mutation_during_preview_v1();

-- Preserve the 050 absence gate and additionally prevent a preview pointer
-- from moving while a review job is bound to its existing candidate.
create or replace function public.validate_contract_skill_bundle_channel_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rule_snapshot_ids uuid[];
  v_output_schema jsonb;
  v_channel_manifest jsonb;
  v_channel_manifest_hash text;
begin
  if tg_op = 'DELETE' then
    if old.channel = 'preview_candidate' and exists (
      select 1
      from public.contract_reviews as review
      join public.contract_analysis_jobs as job
        on job.review_id = review.id
       and job.contract_id = review.contract_id
      where review.skill_bundle_id = old.bundle_id
        and review.rule_version = old.bundle_version
        and job.status in ('preparing', 'queued', 'running')
    ) then
      raise exception 'PREVIEW_CANDIDATE_HAS_ACTIVE_REVIEW' using errcode = '55000';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.channel = 'preview_candidate'
     and (
       old.bundle_id is distinct from new.bundle_id
       or old.bundle_version is distinct from new.bundle_version
     )
     and exists (
       select 1
       from public.contract_reviews as review
       join public.contract_analysis_jobs as job
         on job.review_id = review.id
        and job.contract_id = review.contract_id
       where review.skill_bundle_id = old.bundle_id
         and review.rule_version = old.bundle_version
         and job.status in ('preparing', 'queued', 'running')
  ) then
    raise exception 'PREVIEW_CANDIDATE_HAS_ACTIVE_REVIEW' using errcode = '55000';
  end if;

  select bundle.rule_snapshot_ids, bundle.output_schema
  into v_rule_snapshot_ids, v_output_schema
  from public.contract_skill_bundles as bundle
  where bundle.id = new.bundle_id
    and bundle.org_id = new.org_id
    and bundle.key = new.key
    and bundle.version = new.bundle_version
    and bundle.status = 'published'
    and (
      (
        new.channel = 'release_current'
        and bundle.is_current
      ) or (
        new.channel = 'preview_candidate'
        and not bundle.is_current
        and bundle.release_meta->>'stage' = 'candidate'
        and bundle.release_meta->>'release_eligible' = 'false'
      )
    );
  if not found then
    raise exception 'BUNDLE_CHANNEL_TARGET_INVALID' using errcode = '23514';
  end if;

  if new.channel = 'preview_candidate' and (
    coalesce(cardinality(v_rule_snapshot_ids), 0) = 0
    or exists (
      select 1
      from unnest(v_rule_snapshot_ids) as member(rule_snapshot_id)
      left join public.contract_rule_snapshots as snapshot
        on snapshot.id = member.rule_snapshot_id
      where snapshot.id is null
         or snapshot.status <> 'published'
         or snapshot.criteria_hash is null
         or coalesce(
           snapshot.config_snapshot->'review_criteria'->>'absence_decision',
           ''
         ) not in ('ignore', 'yellow_review', 'red_risk')
    )
  ) then
    raise exception 'BUNDLE_CHANNEL_ABSENCE_DECISION_INVALID' using errcode = '23514';
  end if;

  if new.channel = 'preview_candidate' then
    select jsonb_agg(
      jsonb_build_object(
        'code', snapshot.config_snapshot->'code',
        'name', snapshot.config_snapshot->'name',
        'description', snapshot.config_snapshot->'description',
        'clause_category', snapshot.config_snapshot->'clause_category',
        'level_a_action', snapshot.config_snapshot->'level_a_action',
        'level_b_action', snapshot.config_snapshot->'level_b_action',
        'level_c_action', snapshot.config_snapshot->'level_c_action',
        'review_criteria', snapshot.config_snapshot->'review_criteria',
        'default_unknown', snapshot.config_snapshot->'default_unknown',
        'conflict_group', snapshot.config_snapshot->'conflict_group',
        'mutually_exclusive_with', snapshot.config_snapshot->'mutually_exclusive_with',
        'specificity', snapshot.config_snapshot->'specificity',
        'message_template', snapshot.config_snapshot->'message_template'
      ) order by snapshot.config_snapshot->>'code'
    )
    into v_channel_manifest
    from public.contract_rule_snapshots as snapshot
    where snapshot.id = any(v_rule_snapshot_ids);

    v_channel_manifest_hash := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(public.contract_canonical_json_v1(v_channel_manifest), 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    if coalesce(v_output_schema->>'manifest_hash', '')
         <> 'da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7'
       or v_channel_manifest_hash
         <> 'da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7' then
      raise exception 'BUNDLE_CHANNEL_DETERMINISTIC_MANIFEST_INVALID' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_validate_contract_skill_bundle_channel_v1
  on public.contract_skill_bundle_channels;
create trigger trg_validate_contract_skill_bundle_channel_v1
  before insert or update or delete on public.contract_skill_bundle_channels
  for each row execute function public.validate_contract_skill_bundle_channel_v1();

create or replace function public.create_deterministic_preview_candidate_v1(
  p_org_id uuid,
  p_user_id uuid,
  p_expected_base_bundle_id uuid,
  p_expected_base_compiled_hash text,
  p_rule_definitions jsonb,
  p_qwen_config_id uuid,
  p_gemma_config_id uuid,
  p_release_note text default null,
  p_eval_case_ids text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_manifest_hash constant text := 'da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7';
  v_expected_codes constant text[] := array[
    'R001', 'R002', 'R003', 'R004', 'R005',
    'R006', 'R007', 'R008', 'R009', 'R010',
    'R011', 'R012', 'R013', 'R014', 'R015'
  ]::text[];
  v_expected_absence constant jsonb := '{
    "R001":"yellow_review","R002":"ignore","R003":"red_risk",
    "R004":"yellow_review","R005":"yellow_review","R006":"yellow_review",
    "R007":"yellow_review","R008":"red_risk","R009":"yellow_review",
    "R010":"yellow_review","R011":"yellow_review","R012":"yellow_review",
    "R013":"ignore","R014":"ignore","R015":"yellow_review"
  }'::jsonb;
  v_expected_trusted_context constant jsonb := '{
    "R008":["our_party_protection"],
    "R009":["direction"],
    "R010":["authoritative_context_available","bank_account_match","party_match","template_status"],
    "R012":["dpa_present","external_context"],
    "R013":["trusted_deployment_mode"]
  }'::jsonb;
  v_definition jsonb;
  v_definition_keys text[];
  v_fact_schema jsonb;
  v_manifest_actual_hash text;
  v_absence_actual jsonb;
  v_trusted_context_actual jsonb;
  v_base_bundle public.contract_skill_bundles%rowtype;
  v_base_snapshot public.contract_rule_snapshots%rowtype;
  v_base_rule_set_snapshot public.contract_rule_set_snapshots%rowtype;
  v_qwen_config public.configs%rowtype;
  v_gemma_config public.configs%rowtype;
  v_base_policy public.model_policies%rowtype;
  v_candidate_policy public.model_policies%rowtype;
  v_base_policy_json jsonb;
  v_candidate_policy_json jsonb;
  v_provider_chain jsonb;
  v_policy_key text;
  v_policy_version integer;
  v_policy_timeout integer;
  v_policy_hash text;
  v_qwen_profile text;
  v_gemma_profile text;
  v_rule_code text;
  v_rule_config jsonb;
  v_rule_version integer;
  v_rule_snapshot_id uuid;
  v_rule_criteria_hash text;
  v_base_rule_snapshot_ids uuid[] := '{}'::uuid[];
  v_new_rule_snapshot_ids uuid[] := '{}'::uuid[];
  v_new_rule_set_snapshot_ids uuid[] := '{}'::uuid[];
  v_new_set_member_ids uuid[];
  v_rule_set_version integer;
  v_rule_set_snapshot_id uuid;
  v_channel_bundle_id uuid;
  v_channel_bundle_version integer;
  v_bundle_result jsonb;
  v_output_schema constant jsonb := '{"contract":"contract_review_facts_v1","version":1}'::jsonb;
  v_frozen_output_schema constant jsonb := '{
    "contract":"contract_review_facts_v1",
    "version":1,
    "manifest_hash":"da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7"
  }'::jsonb;
  v_now timestamptz := pg_catalog.now();
begin
  if not exists (
    select 1
    from public.users as creator
    join public.user_organizations as membership
      on membership.user_id = creator.id
     and membership.org_id = p_org_id
    where creator.id = p_user_id
      and creator.status = 'active'
  ) then
    raise exception 'DETERMINISTIC_CANDIDATE_CREATOR_FORBIDDEN' using errcode = '42501';
  end if;

  if p_expected_base_bundle_id is null
     or coalesce(btrim(p_expected_base_compiled_hash), '') = ''
     or p_qwen_config_id is null
     or p_gemma_config_id is null
     or p_qwen_config_id = p_gemma_config_id then
    raise exception 'DETERMINISTIC_CANDIDATE_IDENTITY_INVALID' using errcode = '23514';
  end if;

  if p_eval_case_ids is null
     or array_position(p_eval_case_ids, null) is not null
     or cardinality(p_eval_case_ids) <> (
       select count(distinct eval_id) from unnest(p_eval_case_ids) as supplied(eval_id)
     ) then
    raise exception 'DETERMINISTIC_CANDIDATE_EVAL_CASES_INVALID' using errcode = '23514';
  end if;

  if p_rule_definitions is null
     or jsonb_typeof(p_rule_definitions) is distinct from 'array'
     or jsonb_array_length(p_rule_definitions) <> 15 then
    raise exception 'DETERMINISTIC_CANDIDATE_MANIFEST_INVALID' using errcode = '23514';
  end if;

  v_manifest_actual_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(public.contract_canonical_json_v1(p_rule_definitions), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  if v_manifest_actual_hash <> v_manifest_hash then
    raise exception 'DETERMINISTIC_CANDIDATE_MANIFEST_HASH_MISMATCH' using errcode = '23514';
  end if;

  if (
    select array_agg(item->>'code' order by item->>'code')
    from jsonb_array_elements(p_rule_definitions) as supplied(item)
  ) is distinct from v_expected_codes then
    raise exception 'DETERMINISTIC_CANDIDATE_RULE_CODES_INVALID' using errcode = '23514';
  end if;

  for v_definition in
    select item
    from jsonb_array_elements(p_rule_definitions) as supplied(item)
    order by item->>'code'
  loop
    if jsonb_typeof(v_definition) is distinct from 'object' then
      raise exception 'DETERMINISTIC_CANDIDATE_RULE_DEFINITION_INVALID' using errcode = '23514';
    end if;

    select coalesce(array_agg(key order by key), '{}'::text[])
    into v_definition_keys
    from jsonb_object_keys(v_definition) as object_key(key);
    if v_definition_keys <> array[
      'clause_category', 'code', 'conflict_group', 'default_unknown',
      'description', 'level_a_action', 'level_b_action', 'level_c_action',
      'message_template', 'mutually_exclusive_with', 'name', 'review_criteria',
      'specificity'
    ]::text[] then
      raise exception 'DETERMINISTIC_CANDIDATE_RULE_FIELDS_INVALID' using errcode = '23514';
    end if;

    if v_definition->>'default_unknown' is distinct from 'yellow_review'
       or v_definition->>'level_a_action' is distinct from 'auto_accept'
       or v_definition->>'level_b_action' is distinct from 'negotiate_with_counterparty'
       or v_definition->>'level_c_action' is distinct from 'block_or_escalate'
       or jsonb_typeof(v_definition->'mutually_exclusive_with') is distinct from 'array'
       or jsonb_typeof(v_definition->'specificity') is distinct from 'number'
       or jsonb_typeof(v_definition->'message_template') is distinct from 'object'
       or jsonb_typeof(v_definition->'review_criteria') is distinct from 'object' then
      raise exception 'DETERMINISTIC_CANDIDATE_RULE_SEMANTICS_INVALID' using errcode = '23514';
    end if;

    select coalesce(array_agg(key order by key), '{}'::text[])
    into v_definition_keys
    from jsonb_object_keys(v_definition->'review_criteria') as object_key(key);
    if v_definition_keys <> array[
      'absence_decision', 'fact_schema', 'level_a', 'level_b', 'level_c', 'schema_version'
    ]::text[]
       or v_definition->'review_criteria'->>'schema_version' is distinct from '1'
       or coalesce(v_definition->'review_criteria'->>'absence_decision', '')
            not in ('ignore', 'yellow_review', 'red_risk') then
      raise exception 'DETERMINISTIC_CANDIDATE_CRITERIA_FIELDS_INVALID' using errcode = '23514';
    end if;

    v_fact_schema := v_definition->'review_criteria'->'fact_schema';
    if jsonb_typeof(v_fact_schema) is distinct from 'object'
       or v_fact_schema = '{}'::jsonb
       or not coalesce(public.validate_contract_fact_predicate_v1(
         v_definition->'review_criteria'->'level_a', v_fact_schema
       ), false)
       or not coalesce(public.validate_contract_fact_predicate_v1(
         v_definition->'review_criteria'->'level_b', v_fact_schema
       ), false)
       or not coalesce(public.validate_contract_fact_predicate_v1(
         v_definition->'review_criteria'->'level_c', v_fact_schema
       ), false)
       or v_definition->'review_criteria'->'level_a'
            = v_definition->'review_criteria'->'level_b'
       or v_definition->'review_criteria'->'level_a'
            = v_definition->'review_criteria'->'level_c'
       or v_definition->'review_criteria'->'level_b'
            = v_definition->'review_criteria'->'level_c' then
      raise exception 'DETERMINISTIC_CANDIDATE_ABC_CONTRACT_INVALID' using errcode = '23514';
    end if;

    if exists (
      select 1
      from jsonb_each(v_fact_schema) as fact(name, definition)
      where jsonb_typeof(fact.definition) is distinct from 'object'
         or coalesce(fact.definition->>'type', '')
              not in ('string', 'number', 'boolean', 'string_array')
         or fact.definition->>'required' is distinct from 'true'
         or (
           fact.definition->>'source' = 'trusted_context'
           and fact.definition->>'nullable' is distinct from 'true'
         )
    ) then
      raise exception 'DETERMINISTIC_CANDIDATE_FACT_SCHEMA_INVALID' using errcode = '23514';
    end if;
  end loop;

  select jsonb_object_agg(
    item->>'code', item->'review_criteria'->'absence_decision'
    order by item->>'code'
  )
  into v_absence_actual
  from jsonb_array_elements(p_rule_definitions) as supplied(item);
  if v_absence_actual <> v_expected_absence then
    raise exception 'DETERMINISTIC_CANDIDATE_ABSENCE_MAP_INVALID' using errcode = '23514';
  end if;

  select jsonb_object_agg(trusted.code, trusted.fields order by trusted.code)
  into v_trusted_context_actual
  from (
    select
      item->>'code' as code,
      jsonb_agg(fact.name order by fact.name) as fields
    from jsonb_array_elements(p_rule_definitions) as supplied(item)
    cross join lateral jsonb_each(item->'review_criteria'->'fact_schema')
      as fact(name, definition)
    where fact.definition->>'source' = 'trusted_context'
    group by item->>'code'
  ) as trusted;
  if v_trusted_context_actual <> v_expected_trusted_context then
    raise exception 'DETERMINISTIC_CANDIDATE_TRUSTED_CONTEXT_INVALID' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_org_id::text || ':CONTRACT_REVIEW_DEFAULT', 0)
  );

  select bundle.*
  into v_base_bundle
  from public.contract_skill_bundles as bundle
  where bundle.id = p_expected_base_bundle_id
    and bundle.org_id = p_org_id
    and bundle.key = 'CONTRACT_REVIEW_DEFAULT'
    and bundle.version = 21
    and bundle.status = 'published'
    and bundle.is_current
    and bundle.compiled_hash = p_expected_base_compiled_hash
  for share;
  if not found then
    raise exception 'DETERMINISTIC_CANDIDATE_BASE_V21_MISMATCH' using errcode = '23514';
  end if;

  if cardinality(coalesce(v_base_bundle.rule_snapshot_ids, '{}'::uuid[])) <> 15
     or cardinality(coalesce(v_base_bundle.rule_set_snapshot_ids, '{}'::uuid[])) = 0
     or (
       select array_agg(snapshot.config_snapshot->>'code' order by snapshot.config_snapshot->>'code')
       from public.contract_rule_snapshots as snapshot
       join public.contract_rules_v2 as rule on rule.id = snapshot.rule_id
       where snapshot.id = any(v_base_bundle.rule_snapshot_ids)
         and snapshot.status = 'published'
         and rule.org_id = p_org_id
     ) is distinct from v_expected_codes then
    raise exception 'DETERMINISTIC_CANDIDATE_BASE_RULE_CATALOG_INVALID' using errcode = '23514';
  end if;

  select channel.bundle_id, channel.bundle_version
  into v_channel_bundle_id, v_channel_bundle_version
  from public.contract_skill_bundle_channels as channel
  where channel.org_id = p_org_id
    and channel.key = 'CONTRACT_REVIEW_DEFAULT'
    and channel.channel = 'preview_candidate'
  for update;
  if found and exists (
    select 1
    from public.contract_reviews as review
    join public.contract_analysis_jobs as job
      on job.review_id = review.id
     and job.contract_id = review.contract_id
    where review.skill_bundle_id = v_channel_bundle_id
      and review.rule_version = v_channel_bundle_version
      and job.status in ('preparing', 'queued', 'running')
  ) then
    raise exception 'PREVIEW_CANDIDATE_HAS_ACTIVE_REVIEW' using errcode = '55000';
  end if;

  select config.* into v_qwen_config
  from public.configs as config
  where config.id = p_qwen_config_id
    and config.org_id = p_org_id
    and config.type::text = 'AI_CONFIG'
    and config.status::text = 'PUBLISHED'
  for share;
  select config.* into v_gemma_config
  from public.configs as config
  where config.id = p_gemma_config_id
    and config.org_id = p_org_id
    and config.type::text = 'AI_CONFIG'
    and config.status::text = 'PUBLISHED'
  for share;

  if v_qwen_config.id is null or v_gemma_config.id is null then
    raise exception 'DETERMINISTIC_CANDIDATE_LOCAL_PROVIDER_NOT_FOUND' using errcode = '23514';
  end if;

  if coalesce(v_qwen_config.value->>'kind', 'provider') <> 'provider'
     or coalesce(v_gemma_config.value->>'kind', 'provider') <> 'provider'
     or v_qwen_config.value->'enabled' is distinct from 'true'::jsonb
     or v_gemma_config.value->'enabled' is distinct from 'true'::jsonb
     or v_qwen_config.value->>'provider_kind' is distinct from 'lm_studio'
     or v_gemma_config.value->>'provider_kind' is distinct from 'lm_studio'
     or lower(coalesce(v_qwen_config.value->>'model', '')) not like '%qwen%'
     or lower(coalesce(v_gemma_config.value->>'model', '')) not like '%gemma%'
     or coalesce(v_qwen_config.value->>'base_url', '')
          !~* '^http://(127[.]0[.]0[.]1|localhost|\[::1\])(:[0-9]{1,5})?(/|$)'
     or coalesce(v_gemma_config.value->>'base_url', '')
          !~* '^http://(127[.]0[.]0[.]1|localhost|\[::1\])(:[0-9]{1,5})?(/|$)'
     or coalesce(btrim(v_qwen_config.value->>'api_key'), '') <> ''
     or coalesce(btrim(v_gemma_config.value->>'api_key'), '') <> ''
     or lower(coalesce(v_qwen_config.value->>'cost_tracking', 'false')) <> 'false'
     or lower(coalesce(v_gemma_config.value->>'cost_tracking', 'false')) <> 'false'
     or coalesce(v_qwen_config.value->>'timeout_ms', '') !~ '^[0-9]+$'
     or coalesce(v_gemma_config.value->>'timeout_ms', '') !~ '^[0-9]+$' then
    raise exception 'DETERMINISTIC_CANDIDATE_LOCAL_PROVIDER_INVALID' using errcode = '23514';
  end if;

  if (v_qwen_config.value->>'timeout_ms')::numeric not between 1000 and 300000
     or (v_gemma_config.value->>'timeout_ms')::numeric not between 1000 and 300000 then
    raise exception 'DETERMINISTIC_CANDIDATE_LOCAL_PROVIDER_TIMEOUT_INVALID' using errcode = '23514';
  end if;

  v_qwen_profile := coalesce(
    nullif(btrim(v_qwen_config.value->>'instance_id'), ''),
    nullif(btrim(v_qwen_config.value->>'profile'), ''),
    v_qwen_config.key
  );
  v_gemma_profile := coalesce(
    nullif(btrim(v_gemma_config.value->>'instance_id'), ''),
    nullif(btrim(v_gemma_config.value->>'profile'), ''),
    v_gemma_config.key
  );
  if v_qwen_profile = v_gemma_profile then
    raise exception 'DETERMINISTIC_CANDIDATE_LOCAL_PROVIDER_IDENTITY_COLLISION' using errcode = '23514';
  end if;

  select policy.* into v_base_policy
  from public.model_policies as policy
  where policy.id = v_base_bundle.model_policy_id
    and policy.org_id = p_org_id
    and policy.status = 'published'
  for share;
  if not found then
    raise exception 'DETERMINISTIC_CANDIDATE_BASE_MODEL_POLICY_INVALID' using errcode = '23514';
  end if;

  v_base_policy_json := to_jsonb(v_base_policy);
  if not (v_base_policy_json ?& array[
    'id', 'org_id', 'key', 'name', 'version', 'status', 'is_current',
    'timeout_ms', 'routing_policy', 'fallback_policy', 'audit_policy',
    'provider_chain', 'source_config_ids', 'published_at'
  ]) then
    raise exception 'DETERMINISTIC_CANDIDATE_MODEL_POLICY_SCHEMA_UNSUPPORTED' using errcode = '0A000';
  end if;

  v_policy_key := v_base_policy_json->>'key';
  if v_policy_key is distinct from 'CONTRACT_REVIEW_DEFAULT' then
    raise exception 'DETERMINISTIC_CANDIDATE_MODEL_POLICY_KEY_INVALID' using errcode = '23514';
  end if;
  select coalesce(max((to_jsonb(policy)->>'version')::integer), 0) + 1
  into v_policy_version
  from public.model_policies as policy
  where policy.org_id = p_org_id
    and to_jsonb(policy)->>'key' = v_policy_key;

  v_policy_timeout := greatest(
    (v_qwen_config.value->>'timeout_ms')::integer,
    (v_gemma_config.value->>'timeout_ms')::integer
  );
  v_provider_chain := jsonb_build_array(
    jsonb_build_object(
      'role', 'primary',
      'level', 1,
      'profile', v_qwen_profile,
      'provider', 'lm-studio',
      'provider_kind', 'lm_studio',
      'model', v_qwen_config.value->>'model',
      'runtime_location', 'local',
      'timeout_ms', (v_qwen_config.value->>'timeout_ms')::integer,
      'stages', jsonb_build_array('fact_extraction'),
      'capabilities', jsonb_build_array('fact_extraction'),
      'data_boundary', 'local_only',
      'health_check_required', true,
      'source_config_id', v_qwen_config.id
    ),
    jsonb_build_object(
      'role', 'fallback',
      'level', 2,
      'profile', v_gemma_profile,
      'provider', 'lm-studio',
      'provider_kind', 'lm_studio',
      'model', v_gemma_config.value->>'model',
      'runtime_location', 'local',
      'timeout_ms', (v_gemma_config.value->>'timeout_ms')::integer,
      'stages', jsonb_build_array('fact_extraction'),
      'capabilities', jsonb_build_array('fact_extraction'),
      'data_boundary', 'local_only',
      'health_check_required', true,
      'source_config_id', v_gemma_config.id
    )
  );

  v_candidate_policy_json := v_base_policy_json || jsonb_build_object(
    'id', gen_random_uuid(),
    'key', v_policy_key,
    'name', '合同审核确定性 Preview 本地事实提取策略',
    'version', v_policy_version,
    'status', 'published',
    'is_current', false,
    'timeout_ms', v_policy_timeout,
    'routing_policy', jsonb_build_object(
      'strategy', 'local_first',
      'stage_order', jsonb_build_array('fact_extraction'),
      'data_boundary', jsonb_build_object(
        'contract_text', 'local_only',
        'external_provider', false
      ),
      'policy_version', 'g5.deterministic-preview-model-policy.v1'
    ),
    'fallback_policy', jsonb_build_object(
      'fallback_order', jsonb_build_array(v_qwen_profile, v_gemma_profile),
      'final_fallback', 'manual_review',
      'on_timeout', 'next_local_provider_then_manual_review',
      'on_provider_error', 'next_local_provider_then_manual_review',
      'on_schema_error', 'fail_closed',
      'max_attempts_per_provider', 1,
      'preserve_review_run', true,
      'policy_version', 'g5.deterministic-preview-fallback.v1'
    ),
    'audit_policy', jsonb_build_object(
      'required_spans', jsonb_build_array('fact_extraction'),
      'record_stage', true,
      'record_invocation', true,
      'record_provider_chain', true,
      'record_latency_ms', true,
      'redact_api_key', true,
      'require_model_policy_id', true,
      'require_skill_bundle_id', true,
      'persist_request_response_summary_only', true,
      'policy_version', 'g5.deterministic-preview-audit.v1'
    ),
    'provider_chain', v_provider_chain,
    'source_config_ids', jsonb_build_array(v_qwen_config.id, v_gemma_config.id),
    'created_by', p_user_id,
    'published_by', p_user_id,
    'created_at', v_now,
    'updated_at', v_now,
    'published_at', v_now
  );
  select jsonb_populate_record(null::public.model_policies, v_candidate_policy_json)
  into v_candidate_policy;
  insert into public.model_policies
  select (v_candidate_policy).*
  returning * into v_candidate_policy;

  v_policy_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(to_jsonb(v_candidate_policy)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  for v_definition in
    select item
    from jsonb_array_elements(p_rule_definitions) as supplied(item)
    order by item->>'code'
  loop
    v_rule_code := v_definition->>'code';
    select snapshot.* into strict v_base_snapshot
    from public.contract_rule_snapshots as snapshot
    join public.contract_rules_v2 as rule on rule.id = snapshot.rule_id
    where snapshot.id = any(v_base_bundle.rule_snapshot_ids)
      and snapshot.status = 'published'
      and snapshot.config_snapshot->>'code' = v_rule_code
      and rule.org_id = p_org_id;

    v_rule_config := v_base_snapshot.config_snapshot
      || v_definition
      || jsonb_build_object(
        'id', v_base_snapshot.rule_id,
        'criteria_schema_version', 1
      );
    select coalesce(max(snapshot.version), 0) + 1
    into v_rule_version
    from public.contract_rule_snapshots as snapshot
    where snapshot.rule_id = v_base_snapshot.rule_id;

    insert into public.contract_rule_snapshots (
      rule_id, version, config_snapshot, released_by, released_at,
      release_note, is_gray_release, gray_end_at, status
    ) values (
      v_base_snapshot.rule_id, v_rule_version, v_rule_config, p_user_id, v_now,
      p_release_note, false, null, 'published'
    )
    returning id, criteria_hash into v_rule_snapshot_id, v_rule_criteria_hash;

    if v_rule_criteria_hash is null
       or v_rule_criteria_hash <> pg_catalog.encode(
         extensions.digest(
           pg_catalog.convert_to((v_rule_config->'review_criteria')::text, 'UTF8'),
           'sha256'
         ),
         'hex'
       ) then
      raise exception 'DETERMINISTIC_CANDIDATE_RULE_HASH_INVALID' using errcode = '23514';
    end if;

    v_base_rule_snapshot_ids := array_append(v_base_rule_snapshot_ids, v_base_snapshot.id);
    v_new_rule_snapshot_ids := array_append(v_new_rule_snapshot_ids, v_rule_snapshot_id);
  end loop;

  if cardinality(v_new_rule_snapshot_ids) <> 15 then
    raise exception 'DETERMINISTIC_CANDIDATE_RULE_SNAPSHOT_COUNT_INVALID' using errcode = '23514';
  end if;

  for v_base_rule_set_snapshot in
    select snapshot.*
    from public.contract_rule_set_snapshots as snapshot
    where snapshot.id = any(v_base_bundle.rule_set_snapshot_ids)
      and snapshot.org_id = p_org_id
      and snapshot.status = 'published'
    order by snapshot.id
  loop
    if cardinality(coalesce(v_base_rule_set_snapshot.rule_snapshot_ids, '{}'::uuid[])) = 0
       or exists (
         select 1
         from unnest(v_base_rule_set_snapshot.rule_snapshot_ids) as member(rule_snapshot_id)
         where array_position(v_base_rule_snapshot_ids, member.rule_snapshot_id) is null
       ) then
      raise exception 'DETERMINISTIC_CANDIDATE_RULE_SET_MEMBERSHIP_INVALID' using errcode = '23514';
    end if;

    select coalesce(
      array_agg(
        v_new_rule_snapshot_ids[array_position(v_base_rule_snapshot_ids, member.rule_snapshot_id)]
        order by member.ordinality
      ),
      '{}'::uuid[]
    )
    into v_new_set_member_ids
    from unnest(v_base_rule_set_snapshot.rule_snapshot_ids) with ordinality
      as member(rule_snapshot_id, ordinality);

    select coalesce(max(snapshot.version), 0) + 1
    into v_rule_set_version
    from public.contract_rule_set_snapshots as snapshot
    where snapshot.rule_set_id = v_base_rule_set_snapshot.rule_set_id;

    insert into public.contract_rule_set_snapshots (
      org_id, rule_set_id, version, status, rule_snapshot_ids,
      document_snapshot_ids, config_snapshot, test_results,
      released_by, released_at, release_note
    ) values (
      p_org_id,
      v_base_rule_set_snapshot.rule_set_id,
      v_rule_set_version,
      'published',
      v_new_set_member_ids,
      coalesce(v_base_rule_set_snapshot.document_snapshot_ids, '{}'::uuid[]),
      v_base_rule_set_snapshot.config_snapshot || jsonb_build_object(
        'source_rule_set_snapshot_id', v_base_rule_set_snapshot.id,
        'deterministic_manifest_hash', v_manifest_hash,
        'published_rule_count', cardinality(v_new_set_member_ids)
      ),
      jsonb_build_object(
        'status', 'unverified',
        'scope', 'deterministic_preview_candidate',
        'source_rule_set_snapshot_id', v_base_rule_set_snapshot.id,
        'superseded_test_results_hash', pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(
              coalesce(v_base_rule_set_snapshot.test_results, '{}'::jsonb)::text,
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ),
        'deterministic_manifest_hash', v_manifest_hash,
        'verified_rule_snapshot_ids', jsonb_build_array()
      ),
      p_user_id,
      v_now,
      p_release_note
    )
    returning id into v_rule_set_snapshot_id;
    v_new_rule_set_snapshot_ids := array_append(
      v_new_rule_set_snapshot_ids,
      v_rule_set_snapshot_id
    );
  end loop;

  if cardinality(v_new_rule_set_snapshot_ids)
       <> cardinality(v_base_bundle.rule_set_snapshot_ids)
     or exists (
       select candidate.rule_snapshot_id
       from unnest(v_new_rule_snapshot_ids) as candidate(rule_snapshot_id)
       except
       select included.rule_snapshot_id
       from public.contract_rule_set_snapshots as snapshot
       cross join lateral unnest(snapshot.rule_snapshot_ids) as included(rule_snapshot_id)
       where snapshot.id = any(v_new_rule_set_snapshot_ids)
     )
     or exists (
       select included.rule_snapshot_id
       from public.contract_rule_set_snapshots as snapshot
       cross join lateral unnest(snapshot.rule_snapshot_ids) as included(rule_snapshot_id)
       where snapshot.id = any(v_new_rule_set_snapshot_ids)
       except
       select candidate.rule_snapshot_id
       from unnest(v_new_rule_snapshot_ids) as candidate(rule_snapshot_id)
     ) then
    raise exception 'DETERMINISTIC_CANDIDATE_RULE_SET_COVERAGE_INVALID' using errcode = '23514';
  end if;

  v_bundle_result := public.create_contract_review_candidate_bundle_v1(
    p_org_id,
    p_user_id,
    v_candidate_policy.id,
    v_new_rule_snapshot_ids,
    v_new_rule_set_snapshot_ids,
    v_frozen_output_schema,
    p_release_note,
    p_eval_case_ids
  );

  if not exists (
    select 1
    from public.contract_skill_bundles as bundle
    where bundle.id = (v_bundle_result->>'skill_bundle_id')::uuid
      and bundle.org_id = p_org_id
      and bundle.version = (v_bundle_result->>'skill_bundle_version')::integer
      and bundle.status = 'published'
      and not bundle.is_current
      and bundle.release_meta->>'stage' = 'candidate'
      and bundle.release_meta->>'release_eligible' = 'false'
      and bundle.model_policy_id = v_candidate_policy.id
      and bundle.rule_snapshot_ids = v_new_rule_snapshot_ids
      and bundle.rule_set_snapshot_ids = v_new_rule_set_snapshot_ids
      and bundle.output_schema = v_frozen_output_schema
  ) then
    raise exception 'DETERMINISTIC_CANDIDATE_ATOMIC_FREEZE_INVALID' using errcode = '23514';
  end if;

  return v_bundle_result || jsonb_build_object(
    'manifest_hash', v_manifest_hash,
    'model_policy_id', v_candidate_policy.id,
    'model_policy_version', v_policy_version,
    'model_policy_hash', v_policy_hash,
    'rule_snapshot_ids', v_new_rule_snapshot_ids,
    'rule_set_snapshot_ids', v_new_rule_set_snapshot_ids,
    'output_schema', v_frozen_output_schema,
    'base_compiled_hash', p_expected_base_compiled_hash
  );
exception
  when no_data_found or too_many_rows then
    raise exception 'DETERMINISTIC_CANDIDATE_BASE_RULE_MAPPING_INVALID' using errcode = '23514';
end;
$function$;

revoke all on function public.contract_canonical_json_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.validate_contract_fact_predicate_v1(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.reject_deterministic_preview_model_policy_mutation_v1()
  from public, anon, authenticated;
revoke all on function public.reject_deterministic_preview_provider_config_mutation_v1()
  from public, anon, authenticated;
revoke all on function public.reject_release_current_mutation_during_preview_v1()
  from public, anon, authenticated;
revoke all on function public.validate_contract_skill_bundle_channel_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.validate_contract_skill_bundle_channel_v1()
  to service_role;
revoke all on function public.create_deterministic_preview_candidate_v1(
  uuid, uuid, uuid, text, jsonb, uuid, uuid, text, text[]
) from public, anon, authenticated;
grant execute on function public.create_deterministic_preview_candidate_v1(
  uuid, uuid, uuid, text, jsonb, uuid, uuid, text, text[]
) to service_role;

-- Candidate construction and channel movement are intentionally funnelled
-- through the exact-manifest SECURITY DEFINER function above. The earlier
-- generic RPC and direct table DML would otherwise let service code substitute
-- a cloud policy while retaining the same rule manifest.
revoke all on function public.create_contract_review_candidate_bundle_v1(
  uuid, uuid, uuid, uuid[], uuid[], jsonb, text, text[]
) from service_role;
revoke all on table public.contract_skill_bundle_channels from service_role;
grant select on table public.contract_skill_bundle_channels to service_role;
revoke update (is_current, updated_at)
  on table public.contract_skill_bundles from service_role;
revoke all on function public.publish_contract_rule_set_v1(uuid, uuid, uuid, text, jsonb)
  from service_role;
