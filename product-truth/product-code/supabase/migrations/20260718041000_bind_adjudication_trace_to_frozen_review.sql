set lock_timeout = '5s';
set statement_timeout = '30s';

-- Forward fix for Preview environments where 20260718040000 was already
-- applied. Function identity, trigger, table data and ACL remain unchanged.
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
      and pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to((snapshot.config_snapshot->'review_criteria')::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      ) = new.criteria_hash
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
