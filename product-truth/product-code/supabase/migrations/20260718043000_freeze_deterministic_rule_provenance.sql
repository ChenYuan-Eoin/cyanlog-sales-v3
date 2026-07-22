set lock_timeout = '5s';
set statement_timeout = '30s';

-- PostgreSQL is the only authority for the hash of frozen jsonb criteria.
-- Legacy snapshots remain null; deterministic candidate snapshots receive the
-- hash atomically before insert and cannot be rewritten afterwards.
alter table public.contract_rule_snapshots
  add column if not exists criteria_hash text,
  drop constraint if exists contract_rule_snapshots_criteria_hash_check,
  add constraint contract_rule_snapshots_criteria_hash_check check (
    criteria_hash is null or criteria_hash ~ '^[0-9a-f]{64}$'
  );

create or replace function public.set_contract_rule_snapshot_criteria_hash_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_criteria jsonb;
  v_hash text;
begin
  v_criteria := new.config_snapshot->'review_criteria';
  if jsonb_typeof(v_criteria) = 'object'
     and v_criteria <> '{}'::jsonb
     and v_criteria->>'schema_version' = '1' then
    v_hash := pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(v_criteria::text, 'UTF8'), 'sha256'),
      'hex'
    );
    if new.criteria_hash is not null and new.criteria_hash <> v_hash then
      raise exception 'RULE_SNAPSHOT_CRITERIA_HASH_MISMATCH' using errcode = '23514';
    end if;
    new.criteria_hash := v_hash;
  elsif new.criteria_hash is not null then
    raise exception 'RULE_SNAPSHOT_CRITERIA_HASH_WITHOUT_CRITERIA' using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_set_contract_rule_snapshot_criteria_hash_v1
  on public.contract_rule_snapshots;
create trigger trg_set_contract_rule_snapshot_criteria_hash_v1
  before insert on public.contract_rule_snapshots
  for each row execute function public.set_contract_rule_snapshot_criteria_hash_v1();

create or replace function public.reject_published_contract_asset_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'PUBLISHED_CONTRACT_ASSET_IMMUTABLE' using errcode = '55000';
    end if;
    return old;
  end if;

  if old.status = 'published' or new.status = 'published' then
    raise exception 'PUBLISHED_CONTRACT_ASSET_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_reject_published_contract_rule_snapshot_mutation_v1
  on public.contract_rule_snapshots;
create trigger trg_reject_published_contract_rule_snapshot_mutation_v1
  before update or delete on public.contract_rule_snapshots
  for each row execute function public.reject_published_contract_asset_mutation_v1();

drop trigger if exists trg_reject_published_contract_rule_set_snapshot_mutation_v1
  on public.contract_rule_set_snapshots;
create trigger trg_reject_published_contract_rule_set_snapshot_mutation_v1
  before update or delete on public.contract_rule_set_snapshots
  for each row execute function public.reject_published_contract_asset_mutation_v1();

-- Bundles may move the release pointer through `is_current`, but their frozen
-- contents, model policy, hashes and release metadata cannot be edited.
create or replace function public.guard_published_contract_skill_bundle_update_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'PUBLISHED_CONTRACT_BUNDLE_IMMUTABLE' using errcode = '55000';
    end if;
    return old;
  end if;

  if old.status = 'published' or new.status = 'published' then
    if (to_jsonb(new) - array['is_current', 'updated_at'])
       is distinct from
       (to_jsonb(old) - array['is_current', 'updated_at']) then
      raise exception 'PUBLISHED_CONTRACT_BUNDLE_IMMUTABLE' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_published_contract_skill_bundle_update_v1
  on public.contract_skill_bundles;
create trigger trg_guard_published_contract_skill_bundle_update_v1
  before update or delete on public.contract_skill_bundles
  for each row execute function public.guard_published_contract_skill_bundle_update_v1();

revoke all on table public.contract_rule_snapshots from service_role;
grant select, insert on table public.contract_rule_snapshots to service_role;
revoke all on table public.contract_rule_set_snapshots from service_role;
grant select, insert on table public.contract_rule_set_snapshots to service_role;
revoke all on table public.contract_skill_bundles from service_role;
grant select, insert on table public.contract_skill_bundles to service_role;
grant update (is_current, updated_at) on public.contract_skill_bundles to service_role;

revoke all on function public.set_contract_rule_snapshot_criteria_hash_v1()
  from public, anon, authenticated;
grant execute on function public.set_contract_rule_snapshot_criteria_hash_v1()
  to service_role;
revoke all on function public.reject_published_contract_asset_mutation_v1()
  from public, anon, authenticated;
grant execute on function public.reject_published_contract_asset_mutation_v1()
  to service_role;
revoke all on function public.guard_published_contract_skill_bundle_update_v1()
  from public, anon, authenticated;
grant execute on function public.guard_published_contract_skill_bundle_update_v1()
  to service_role;

-- The trace trigger now compares against the database-generated snapshot hash;
-- applications may keep their own diagnostic fingerprint but cannot submit it
-- as provenance authority.
create or replace function public.validate_contract_review_adjudication_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.contract_reviews as review
    where review.id = new.review_id
      and review.contract_id = new.contract_id
      and review.skill_bundle_id is not distinct from new.skill_bundle_id
      and review.rule_version is not distinct from new.skill_bundle_version
      and new.rule_snapshot_id = any(coalesce(review.rule_snapshot_ids, '{}'::uuid[]))
      and review.source_storage_path is not distinct from new.source_storage_path
      and review.source_hash is not distinct from new.source_hash
      and review.source_text_hash is not distinct from new.source_text_hash
  ) then
    raise exception 'ADJUDICATION_FROZEN_REVIEW_MISMATCH' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.contracts as contract
    join public.contract_source_page_maps as page_map
      on page_map.contract_id = contract.id
    where contract.id = new.contract_id
      and contract.org_id = new.org_id
      and contract.storage_path is not distinct from new.source_storage_path
      and page_map.storage_path is not distinct from new.source_storage_path
      and page_map.source_hash is not distinct from new.source_hash
      and page_map.source_text_hash is not distinct from new.source_text_hash
      and pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(coalesce(contract.parsed_text, ''), 'UTF8'),
          'sha256'
        ),
        'hex'
      ) = new.source_text_hash
      and public.contract_utf16_slice(
        contract.parsed_text,
        new.source_start,
        new.source_end
      ) is not distinct from new.source_exact_text
      and pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(new.source_exact_text, 'UTF8'), 'sha256'),
        'hex'
      ) = new.source_quote_hash
  ) then
    raise exception 'ADJUDICATION_PAGE_MAP_PROVENANCE_INVALID' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.contract_skill_bundles as bundle
    join public.contract_rule_snapshots as snapshot
      on snapshot.id = new.rule_snapshot_id
     and snapshot.id = any(bundle.rule_snapshot_ids)
    where bundle.id = new.skill_bundle_id
      and bundle.org_id = new.org_id
      and bundle.version = new.skill_bundle_version
      and bundle.status = 'published'
      and snapshot.status = 'published'
      and snapshot.config_snapshot->>'code' = new.rule_code
      and snapshot.criteria_hash is not null
      and snapshot.criteria_hash = new.criteria_hash
  ) then
    raise exception 'ADJUDICATION_RULE_PROVENANCE_INVALID' using errcode = '23514';
  end if;

  if new.analysis_job_id is not null and not exists (
    select 1
    from public.contract_analysis_jobs as job
    where job.id = new.analysis_job_id
      and job.review_id = new.review_id
      and job.contract_id = new.contract_id
  ) then
    raise exception 'ADJUDICATION_JOB_PROVENANCE_INVALID' using errcode = '23514';
  end if;

  if new.model_invocation_id is not null and not exists (
    select 1
    from public.model_invocations as invocation
    where invocation.id = new.model_invocation_id
      and invocation.org_id = new.org_id
      and invocation.review_id = new.review_id
      and invocation.contract_id = new.contract_id
      and invocation.skill_bundle_id = new.skill_bundle_id
  ) then
    raise exception 'ADJUDICATION_INVOCATION_PROVENANCE_INVALID' using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_contract_review_adjudication_v1()
  from public, anon, authenticated;
grant execute on function public.validate_contract_review_adjudication_v1()
  to service_role;
