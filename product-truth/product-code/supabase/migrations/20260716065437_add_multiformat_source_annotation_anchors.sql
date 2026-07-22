-- G5 multi-format annotations: bind manual PDF comments to immutable source identity.

create extension if not exists pgcrypto with schema extensions;

-- This release changes the worker lease and ReviewRun source-identity contract.
-- Run only inside a maintenance window after review writes/workers are stopped.
-- The lock closes the in-migration check/write gap; the operational stop closes
-- already-started calls that could otherwise resume an old function body later.
lock table
  public.contract_analysis_jobs,
  public.contract_review_submission_batches,
  public.contracts,
  public.contract_reviews,
  public.contract_source_page_maps,
  public.contract_review_decision_drafts,
  public.contract_risk_cards
in access exclusive mode;

-- Never let a pre-upgrade active job or batch be silently consumed by the new worker.
do $$
begin
  if exists (
    select 1
      from public.contract_analysis_jobs
     where status in ('preparing', 'queued', 'running')
  ) then
    raise exception 'G5 migration requires zero active contract analysis jobs; drain or explicitly cancel them before retrying'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from public.contract_review_submission_batches
     where status in ('checking', 'review_running')
  ) then
    raise exception 'G5 migration requires zero active contract review batches; drain or explicitly cancel them before retrying'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from public.contract_reviews
     where status in ('PARSING', 'ANALYZING')
  ) then
    raise exception 'G5 migration requires zero active ReviewRuns; drain or explicitly cancel them before retrying'
      using errcode = '55000';
  end if;
end;
$$;

alter table public.contract_source_page_maps
  add column if not exists source_text_hash text;

alter table public.contract_source_page_maps
  drop constraint if exists contract_source_page_maps_source_text_hash_check;

alter table public.contract_source_page_maps
  add constraint contract_source_page_maps_source_text_hash_check
  check (source_text_hash is null or source_text_hash ~ '^[0-9a-f]{64}$') not valid;

alter table public.contract_analysis_jobs
  add column if not exists lock_token uuid,
  add column if not exists locked_by text,
  add column if not exists start_request_id uuid;

create unique index if not exists idx_contract_analysis_jobs_start_request
  on public.contract_analysis_jobs (start_request_id)
  where start_request_id is not null;

alter table public.contract_analysis_jobs
  drop constraint if exists contract_analysis_jobs_status_check;

alter table public.contract_analysis_jobs
  add constraint contract_analysis_jobs_status_check
  check (status in ('preparing', 'queued', 'running', 'completed', 'failed'));

alter table public.contract_analysis_jobs
  drop constraint if exists contract_analysis_jobs_running_lease_check;

alter table public.contract_analysis_jobs
  add constraint contract_analysis_jobs_running_lease_check
  check (status <> 'running' or (lock_token is not null and locked_at is not null)) not valid;

alter table public.contract_risk_cards
  add column if not exists rule_id uuid,
  add column if not exists rule_code text,
  add column if not exists rule_version integer,
  add column if not exists evidence jsonb default '{}'::jsonb;

update public.contract_risk_cards set evidence = '{}'::jsonb where evidence is null;
alter table public.contract_risk_cards
  alter column evidence set default '{}'::jsonb,
  alter column evidence set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'contract_risk_cards_rule_id_fkey'
       and conrelid = 'public.contract_risk_cards'::regclass
  ) then
    alter table public.contract_risk_cards
      add constraint contract_risk_cards_rule_id_fkey
      foreign key (rule_id) references public.contract_rules_v2(id) on delete set null
      not valid;
  end if;
end;
$$;

alter table public.contract_risk_cards
  validate constraint contract_risk_cards_rule_id_fkey;

alter table public.contract_reviews
  add column if not exists skill_bundle_id uuid,
  add column if not exists model_policy_id uuid,
  add column if not exists rule_snapshot_ids uuid[] not null default '{}'::uuid[],
  add column if not exists rule_set_snapshot_ids uuid[] not null default '{}'::uuid[],
  add column if not exists review_trigger text,
  add column if not exists parent_review_id uuid,
  add column if not exists preferred_provider text,
  add column if not exists source_storage_path text,
  add column if not exists source_hash text,
  add column if not exists source_text_hash text;

alter table public.contract_reviews
  drop constraint if exists contract_reviews_review_trigger_check;

alter table public.contract_reviews
  add constraint contract_reviews_review_trigger_check
  check (review_trigger is null or review_trigger in ('direct', 'decision_batch')) not valid;

alter table public.contract_reviews
  drop constraint if exists contract_reviews_source_identity_check;

alter table public.contract_reviews
  add constraint contract_reviews_source_identity_check
  check (
    (source_storage_path is null and source_hash is null and source_text_hash is null)
    or (
      source_storage_path is not null
      and btrim(source_storage_path) <> ''
      and source_hash ~ '^[0-9a-f]{64}$'
      and source_text_hash ~ '^[0-9a-f]{64}$'
    )
  ) not valid;

alter table public.contract_annotations
  add column if not exists source_anchor jsonb,
  add column if not exists source_storage_path text,
  add column if not exists source_hash text,
  add column if not exists source_text_hash text,
  add column if not exists client_request_id uuid;

create unique index if not exists idx_contract_annotations_client_request
  on public.contract_annotations (contract_id, author_id, client_request_id)
  where client_request_id is not null;

alter table public.contract_annotations
  drop constraint if exists contract_annotations_source_anchor_shape_check;

alter table public.contract_annotations
  add constraint contract_annotations_source_anchor_shape_check
  check (
    (source_anchor is null and source_storage_path is null and source_hash is null and source_text_hash is null)
    or coalesce((
      jsonb_typeof(source_anchor) = 'object'
      and source_storage_path is not null
      and btrim(source_storage_path) <> ''
      and source_hash is not null
      and source_hash ~ '^[0-9a-f]{64}$'
      and source_text_hash is not null
      and source_text_hash ~ '^[0-9a-f]{64}$'
      and case
        when jsonb_typeof(source_anchor->'page') = 'number' then
          (source_anchor->>'page')::numeric >= 1
          and (source_anchor->>'page')::numeric = trunc((source_anchor->>'page')::numeric)
        else false
      end
      and case source_anchor->>'kind'
        when 'text' then
          case
            when jsonb_typeof(source_anchor->'start') = 'number'
             and jsonb_typeof(source_anchor->'end') = 'number'
             and jsonb_typeof(source_anchor->'exact') = 'string' then
              (source_anchor->>'start')::numeric >= 0
              and (source_anchor->>'start')::numeric = trunc((source_anchor->>'start')::numeric)
              and (source_anchor->>'end')::numeric > (source_anchor->>'start')::numeric
              and (source_anchor->>'end')::numeric = trunc((source_anchor->>'end')::numeric)
              and btrim(source_anchor->>'exact') <> ''
            else false
          end
        when 'point' then
          case
            when jsonb_typeof(source_anchor->'point') = 'object'
             and jsonb_typeof(source_anchor->'point'->'x') = 'number'
             and jsonb_typeof(source_anchor->'point'->'y') = 'number' then
              (source_anchor->'point'->>'x')::numeric between 0 and 1
              and (source_anchor->'point'->>'y')::numeric between 0 and 1
            else false
          end
        when 'region' then
          case
            when jsonb_typeof(source_anchor->'region') = 'object'
             and jsonb_typeof(source_anchor->'region'->'x') = 'number'
             and jsonb_typeof(source_anchor->'region'->'y') = 'number'
             and jsonb_typeof(source_anchor->'region'->'width') = 'number'
             and jsonb_typeof(source_anchor->'region'->'height') = 'number' then
              (source_anchor->'region'->>'x')::numeric between 0 and 1
              and (source_anchor->'region'->>'y')::numeric between 0 and 1
              and (source_anchor->'region'->>'width')::numeric > 0
              and (source_anchor->'region'->>'height')::numeric > 0
              and (source_anchor->'region'->>'x')::numeric + (source_anchor->'region'->>'width')::numeric <= 1
              and (source_anchor->'region'->>'y')::numeric + (source_anchor->'region'->>'height')::numeric <= 1
            else false
          end
        else false
      end
    ), false)
  );

create index if not exists idx_contract_annotations_source_anchor
  on public.contract_annotations (contract_id, source_storage_path, source_hash)
  where source_anchor is not null;

create index if not exists idx_contract_annotations_source_identity
  on public.contract_annotations (contract_id, source_storage_path, source_hash, source_text_hash)
  where source_anchor is not null;

comment on column public.contract_annotations.source_anchor is
  'Immutable page anchor: text, normalized region, or normalized point.';
comment on column public.contract_annotations.source_hash is
  'SHA-256 of the exact source bytes used when the annotation was created.';
comment on column public.contract_annotations.source_text_hash is
  'SHA-256 of the parsed text identity used when the annotation was created.';

alter table public.contract_review_decision_drafts
  add column if not exists source_storage_path text,
  add column if not exists source_hash text,
  add column if not exists source_text_hash text;

alter table public.contract_review_decision_drafts
  drop constraint if exists contract_review_decision_drafts_source_identity_check;

alter table public.contract_review_decision_drafts
  add constraint contract_review_decision_drafts_source_identity_check
  check (
    (source_storage_path is null and source_hash is null and source_text_hash is null)
    or (
      source_storage_path is not null
      and btrim(source_storage_path) <> ''
      and source_hash is not null
      and source_hash ~ '^[0-9a-f]{64}$'
      and source_text_hash is not null
      and source_text_hash ~ '^[0-9a-f]{64}$'
    )
  );

alter table public.contract_review_decision_drafts
  drop constraint if exists contract_review_decision_drafts_source_anchor_shape_check;

alter table public.contract_review_decision_drafts
  add constraint contract_review_decision_drafts_source_anchor_shape_check
  check (
    source_anchor is null
    or coalesce((
      jsonb_typeof(source_anchor) = 'object'
      and case
        when jsonb_typeof(source_anchor->'page') = 'number' then
          (source_anchor->>'page')::numeric >= 1
          and (source_anchor->>'page')::numeric = trunc((source_anchor->>'page')::numeric)
        else false
      end
      and case
        when jsonb_typeof(source_anchor->'start') = 'number'
         and jsonb_typeof(source_anchor->'end') = 'number' then
          (source_anchor->>'start')::numeric >= 0
          and (source_anchor->>'start')::numeric = trunc((source_anchor->>'start')::numeric)
          and (source_anchor->>'end')::numeric >= (source_anchor->>'start')::numeric
          and (source_anchor->>'end')::numeric = trunc((source_anchor->>'end')::numeric)
        else false
      end
      and source_anchor->>'locator' in ('rendered', 'provisional')
      and case coalesce(source_anchor->>'anchor_kind', 'text')
        when 'text' then
          jsonb_typeof(source_anchor->'exact_text') = 'string'
          and btrim(source_anchor->>'exact_text') <> ''
          and (source_anchor->>'end')::numeric > (source_anchor->>'start')::numeric
        when 'point' then
          case
            when jsonb_typeof(source_anchor->'point'->'x') = 'number'
             and jsonb_typeof(source_anchor->'point'->'y') = 'number' then
              (source_anchor->'point'->>'x')::numeric between 0 and 1
              and (source_anchor->'point'->>'y')::numeric between 0 and 1
            else false
          end
        when 'region' then
          case
            when jsonb_typeof(source_anchor->'region'->'x') = 'number'
             and jsonb_typeof(source_anchor->'region'->'y') = 'number'
             and jsonb_typeof(source_anchor->'region'->'width') = 'number'
             and jsonb_typeof(source_anchor->'region'->'height') = 'number' then
              (source_anchor->'region'->>'x')::numeric between 0 and 1
              and (source_anchor->'region'->>'y')::numeric between 0 and 1
              and (source_anchor->'region'->>'width')::numeric > 0
              and (source_anchor->'region'->>'height')::numeric > 0
              and (source_anchor->'region'->>'x')::numeric + (source_anchor->'region'->>'width')::numeric <= 1
              and (source_anchor->'region'->>'y')::numeric + (source_anchor->'region'->>'height')::numeric <= 1
            else false
          end
        else false
      end
    ), false)
  ) not valid;

create index if not exists idx_contract_review_decision_drafts_source_identity
  on public.contract_review_decision_drafts (contract_id, source_storage_path, source_hash, source_text_hash)
  where source_storage_path is not null;

alter table public.contract_review_submission_batches
  add column if not exists source_storage_path text,
  add column if not exists source_hash text,
  add column if not exists source_text_hash text;

alter table public.contract_review_submission_batches
  drop constraint if exists contract_review_submission_batches_source_identity_check;

alter table public.contract_review_submission_batches
  add constraint contract_review_submission_batches_source_identity_check
  check (
    (source_storage_path is null and source_hash is null and source_text_hash is null)
    or (
      source_storage_path is not null
      and btrim(source_storage_path) <> ''
      and source_hash is not null
      and source_hash ~ '^[0-9a-f]{64}$'
      and source_text_hash is not null
      and source_text_hash ~ '^[0-9a-f]{64}$'
    )
  );

do $$
declare
  duplicate_contracts integer;
  existing_index_definition text;
begin
  select count(*)
    into duplicate_contracts
    from (
      select contract_id
        from public.contract_review_submission_batches
       where status in ('checking', 'review_running')
       group by contract_id
      having count(*) > 1
    ) as duplicates;
  if duplicate_contracts > 0 then
    raise exception 'cannot create active review batch guard: % contract(s) have duplicate active batches', duplicate_contracts
      using errcode = '23505';
  end if;

  if to_regclass('public.idx_contract_review_submission_batches_one_active_contract') is not null then
    select pg_get_indexdef(to_regclass('public.idx_contract_review_submission_batches_one_active_contract'))
      into existing_index_definition;
    if position('unique index' in lower(existing_index_definition)) = 0
       or position('(contract_id)' in lower(existing_index_definition)) = 0
       or position('checking' in lower(existing_index_definition)) = 0
       or position('review_running' in lower(existing_index_definition)) = 0 then
      raise exception 'existing active review batch index has an incompatible definition: %', existing_index_definition
        using errcode = '23514';
    end if;
  end if;
end;
$$;

create unique index if not exists idx_contract_review_submission_batches_one_active_contract
  on public.contract_review_submission_batches (contract_id)
  where status in ('checking', 'review_running');

create or replace function public.expire_stale_contract_review_setups(
  p_stale_after interval default interval '15 minutes',
  p_contract_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale_batch public.contract_review_submission_batches%rowtype;
  stale_job public.contract_analysis_jobs%rowtype;
  snapshot jsonb;
  v_now timestamptz := now();
  expired_count integer := 0;
  affected_rows integer;
begin
  if p_stale_after <= interval '0 seconds' then
    raise exception 'stale interval must be positive' using errcode = '22023';
  end if;

  for stale_batch in
    select *
      from public.contract_review_submission_batches
     where status in ('checking', 'review_running')
       and created_at < v_now - p_stale_after
       and (p_contract_id is null or contract_id = p_contract_id)
       and not exists (
         select 1
           from public.contract_analysis_jobs as linked_job
          where (
              linked_job.id = contract_review_submission_batches.analysis_job_id
              or linked_job.review_id = contract_review_submission_batches.new_review_id
            )
       )
     for update skip locked
  loop
    if stale_batch.new_review_id is not null then
      update public.contract_analysis_jobs
         set status = 'failed',
             last_error = 'Review setup expired before durable batch linkage',
             completed_at = v_now,
             locked_at = null,
             lock_token = null,
             locked_by = null,
             updated_at = v_now
       where (id = stale_batch.analysis_job_id or review_id = stale_batch.new_review_id)
         and status in ('preparing', 'queued', 'running');
    end if;

    if jsonb_typeof(stale_batch.decision_snapshot) = 'array' then
      for snapshot in select value from jsonb_array_elements(stale_batch.decision_snapshot)
      loop
        if coalesce(snapshot->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           or coalesce(snapshot->>'risk_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           or jsonb_typeof(snapshot->'optimistic_version') is distinct from 'number' then
          raise exception 'stale review setup has an invalid decision snapshot' using errcode = '23514';
        end if;
        update public.contract_review_decision_drafts
           set workflow_state = 'NEEDS_REVISION', updated_at = v_now
         where id = (snapshot->>'id')::uuid
           and contract_id = stale_batch.contract_id
           and review_id = stale_batch.source_review_id
           and risk_id = (snapshot->>'risk_id')::uuid
           and created_by::text = snapshot->>'created_by'
           and optimistic_version = (snapshot->>'optimistic_version')::integer
           and source_storage_path = stale_batch.source_storage_path
           and source_hash = stale_batch.source_hash
           and source_text_hash = stale_batch.source_text_hash
           and status = 'draft_selected';
        get diagnostics affected_rows = row_count;
        if affected_rows <> 1 then
          raise exception 'stale review setup decision draft changed before recovery' using errcode = '40001';
        end if;
      end loop;
    end if;

    if stale_batch.new_review_id is not null then
      update public.contract_reviews
         set status = 'FAILED',
             results = jsonb_build_object('error', 'Review setup expired before queue activation'),
             completed_at = v_now
       where id = stale_batch.new_review_id
         and status in ('PARSING', 'ANALYZING');
    end if;
    update public.contracts
       set status = 'FAILED', updated_at = v_now
     where id = stale_batch.contract_id
       and status in ('PARSING', 'ANALYZING');
    update public.contract_review_submission_batches
       set status = 'failed',
           conflict_report = jsonb_build_array(jsonb_build_object(
             'code', 'SETUP_EXPIRED',
             'message', 'Review setup expired before durable queue activation'
           )),
           completed_at = v_now
     where id = stale_batch.id
       and status in ('checking', 'review_running');
    expired_count := expired_count + 1;
  end loop;

  for stale_job in
    select *
      from public.contract_analysis_jobs
     where status = 'preparing'
       and created_at < v_now - p_stale_after
       and (p_contract_id is null or contract_id = p_contract_id)
     for update skip locked
  loop
    update public.contract_review_submission_batches
       set status = 'failed',
           conflict_report = jsonb_build_array(jsonb_build_object(
             'code', 'SETUP_EXPIRED',
             'message', 'Preparing analysis job expired before queue activation'
           )),
           completed_at = v_now
     where (analysis_job_id = stale_job.id or new_review_id = stale_job.review_id)
       and status in ('checking', 'review_running');
    update public.contract_review_decision_drafts as draft
       set workflow_state = 'NEEDS_REVISION', updated_at = v_now
     where draft.status = 'draft_selected'
       and exists (
         select 1
           from public.contract_review_submission_batches as batch
           cross join lateral jsonb_array_elements(
             case when jsonb_typeof(batch.decision_snapshot) = 'array'
               then batch.decision_snapshot else '[]'::jsonb end
           ) as item(snapshot)
          where (batch.analysis_job_id = stale_job.id or batch.new_review_id = stale_job.review_id)
            and batch.source_review_id = draft.review_id
            and batch.contract_id = draft.contract_id
            and coalesce(item.snapshot->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            and coalesce(item.snapshot->>'risk_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            and draft.id = (item.snapshot->>'id')::uuid
            and draft.risk_id = (item.snapshot->>'risk_id')::uuid
            and draft.created_by::text = item.snapshot->>'created_by'
            and draft.optimistic_version::text = item.snapshot->>'optimistic_version'
            and draft.source_storage_path = batch.source_storage_path
            and draft.source_hash = batch.source_hash
            and draft.source_text_hash = batch.source_text_hash
       );
    update public.contract_reviews
       set status = 'FAILED',
           results = jsonb_build_object('error', 'Review setup expired before queue activation'),
           completed_at = v_now
     where id = stale_job.review_id
       and status in ('PARSING', 'ANALYZING');
    update public.contracts
       set status = 'FAILED', updated_at = v_now
     where id = stale_job.contract_id
       and status in ('PARSING', 'ANALYZING');
    update public.contract_analysis_jobs
       set status = 'failed',
           last_error = 'Review setup expired before queue activation',
           completed_at = v_now,
           locked_at = null,
           lock_token = null,
           locked_by = null,
           updated_at = v_now
     where id = stale_job.id and status = 'preparing';
    expired_count := expired_count + 1;
  end loop;

  return expired_count;
end;
$$;

revoke all on function public.expire_stale_contract_review_setups(interval, uuid) from public, anon, authenticated;
grant execute on function public.expire_stale_contract_review_setups(interval, uuid) to service_role;

drop function if exists public.start_contract_analysis_job(uuid, uuid, uuid, text, uuid, text, text, text);
drop function if exists public.start_contract_analysis_job(uuid, uuid, uuid, text, uuid, text, text, text, text);

create or replace function public.start_contract_analysis_job(
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
as $$
declare
  current_contract_status text;
  current_storage_path text;
  current_source_hash text;
  current_source_text_hash text;
  current_parsed_text_hash text;
  v_skill_bundle_id uuid;
  v_bundle_version integer;
  v_model_policy_id uuid;
  v_rule_snapshot_ids uuid[];
  v_rule_set_snapshot_ids uuid[];
  v_review_id uuid;
  v_job_id uuid;
  v_now timestamptz := now();
  affected_rows integer;
begin
  if p_start_request_id is null then
    raise exception 'analysis start request id is required' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_start_request_id::text, 0));
  if p_expected_contract_status not in ('PENDING', 'FAILED', 'COMPLETED') then
    raise exception 'invalid source contract status for analysis' using errcode = '22023';
  end if;
  if coalesce(p_source_storage_path, '') = ''
     or coalesce(p_source_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_source_text_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'complete source identity is required' using errcode = '23514';
  end if;
  select bundle.id,
         bundle.version,
         bundle.model_policy_id,
         bundle.rule_snapshot_ids,
         bundle.rule_set_snapshot_ids
    into v_skill_bundle_id, v_bundle_version, v_model_policy_id,
         v_rule_snapshot_ids, v_rule_set_snapshot_ids
    from public.contract_skill_bundles as bundle
   where bundle.org_id = p_org_id
     and bundle.key = 'CONTRACT_REVIEW_DEFAULT'
     and bundle.status = 'published'
     and bundle.is_current = true
   order by bundle.version desc
   limit 1
   for share;
  if not found then
    raise exception 'a current published contract review bundle is required' using errcode = '55000';
  end if;
  select contract.status,
         contract.storage_path,
         page_map.source_hash,
         page_map.source_text_hash,
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(coalesce(contract.parsed_text, ''), 'UTF8'), 'sha256'),
           'hex'
         )
    into current_contract_status, current_storage_path, current_source_hash,
         current_source_text_hash, current_parsed_text_hash
    from public.contracts as contract
    join public.contract_source_page_maps as page_map
      on page_map.contract_id = contract.id
     and page_map.storage_path = contract.storage_path
   where contract.id = p_contract_id
     and contract.org_id = p_org_id
   for update;
  if not found then
    raise exception 'contract was not found in the organization' using errcode = 'P0002';
  end if;
  if current_contract_status is distinct from p_expected_contract_status then
    raise exception 'contract status changed before analysis setup' using errcode = '40001';
  end if;
  if current_storage_path is distinct from p_source_storage_path
     or current_source_hash is distinct from p_source_hash
     or current_source_text_hash is distinct from p_source_text_hash
     or current_parsed_text_hash is distinct from p_source_text_hash then
    raise exception 'contract source identity changed before analysis setup' using errcode = '40001';
  end if;
  if exists (
    select 1
      from public.contract_analysis_jobs as job
     where job.contract_id = p_contract_id
       and job.status in ('preparing', 'queued', 'running')
  ) then
    raise exception 'contract already has an active analysis job' using errcode = '55000';
  end if;
  if p_strategy_id is not null and not exists (
    select 1
      from public.review_strategies as strategy
     where strategy.id = p_strategy_id
       and (strategy.org_id is null or strategy.org_id = p_org_id)
  ) then
    raise exception 'review strategy does not belong to the organization' using errcode = '23514';
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
    v_bundle_version,
    v_skill_bundle_id,
    v_model_policy_id,
    coalesce(v_rule_snapshot_ids, '{}'::uuid[]),
    coalesce(v_rule_set_snapshot_ids, '{}'::uuid[]),
    'direct',
    nullif(btrim(p_preferred_provider), ''),
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
     set status = 'PARSING', updated_at = v_now
   where id = p_contract_id and status = p_expected_contract_status;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract status changed while creating analysis job' using errcode = '40001';
  end if;
  return query select v_review_id, v_job_id;
end;
$$;

revoke all on function public.start_contract_analysis_job(uuid, uuid, uuid, uuid, text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.start_contract_analysis_job(uuid, uuid, uuid, uuid, text, uuid, text, text, text, text) to service_role;

drop function if exists public.recover_contract_analysis_start(uuid, uuid, text, text, text);
drop function if exists public.recover_contract_analysis_start(uuid, uuid, uuid, uuid, uuid, text, text, text, text);

create or replace function public.recover_contract_analysis_start(
  p_org_id uuid,
  p_contract_id uuid,
  p_requested_by uuid,
  p_start_request_id uuid,
  p_strategy_id uuid,
  p_source_storage_path text,
  p_source_hash text,
  p_source_text_hash text,
  p_preferred_provider text
)
returns table(review_id uuid, job_id uuid, job_status text, review_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_review_id uuid;
  v_job_status text;
  v_review_status text;
  current_contract_status text;
  current_storage_path text;
  current_source_hash text;
  current_source_text_hash text;
  current_parsed_text_hash text;
begin
  if p_start_request_id is null then
    raise exception 'analysis start request id is required' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_start_request_id::text, 0));

  select job.id, job.review_id, job.status, review.status
    into v_job_id, v_review_id, v_job_status, v_review_status
    from public.contract_analysis_jobs as job
    join public.contract_reviews as review on review.id = job.review_id
   where job.contract_id = p_contract_id
     and job.requested_by = p_requested_by
     and job.start_request_id = p_start_request_id
     and job.status in ('queued', 'running', 'completed', 'failed')
     and review.contract_id = p_contract_id
     and (
       (job.status = 'queued' and review.status = 'PARSING')
       or (job.status = 'running' and review.status = 'ANALYZING')
       or (job.status = 'completed' and review.status = 'COMPLETED')
       or (job.status = 'failed' and review.status = 'FAILED')
     )
     and review.review_trigger = 'direct'
     and review.strategy_id is not distinct from p_strategy_id
     and review.preferred_provider is not distinct from nullif(btrim(p_preferred_provider), '')
     and review.source_storage_path = p_source_storage_path
     and review.source_hash = p_source_hash
     and review.source_text_hash = p_source_text_hash
     and review.skill_bundle_id is not null
     and review.rule_version is not null
   order by job.created_at desc
   limit 1
   for update of job, review;
  if not found then
    return;
  end if;

  select contracts.status,
         contracts.storage_path,
         page_maps.source_hash,
         page_maps.source_text_hash,
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(coalesce(contracts.parsed_text, ''), 'UTF8'), 'sha256'),
           'hex'
         )
    into current_contract_status, current_storage_path, current_source_hash,
         current_source_text_hash, current_parsed_text_hash
    from public.contracts
    join public.contract_source_page_maps as page_maps
      on page_maps.contract_id = contracts.id
     and page_maps.storage_path = contracts.storage_path
   where contracts.id = p_contract_id
     and contracts.org_id = p_org_id
     and contracts.status in ('PARSING', 'ANALYZING', 'COMPLETED', 'FAILED')
   for update of contracts, page_maps;
  if not found
     or current_storage_path is distinct from p_source_storage_path
     or current_source_hash is distinct from p_source_hash
     or current_source_text_hash is distinct from p_source_text_hash
     or current_parsed_text_hash is distinct from p_source_text_hash then
    raise exception 'cannot recover analysis start after source identity changed' using errcode = '40001';
  end if;
  if not (
    (v_job_status = 'queued' and v_review_status = 'PARSING' and current_contract_status = 'PARSING')
    or (v_job_status = 'running' and v_review_status = 'ANALYZING' and current_contract_status = 'ANALYZING')
    or (v_job_status = 'completed' and v_review_status = 'COMPLETED' and current_contract_status = 'COMPLETED')
    or (v_job_status = 'failed' and v_review_status = 'FAILED' and current_contract_status = 'FAILED')
  ) then
    raise exception 'analysis start recovery found an inconsistent state machine' using errcode = '55000';
  end if;

  return query select v_review_id, v_job_id, v_job_status, v_review_status;
end;
$$;

revoke all on function public.recover_contract_analysis_start(uuid, uuid, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.recover_contract_analysis_start(uuid, uuid, uuid, uuid, uuid, text, text, text, text) to service_role;

create or replace function public.start_contract_review_decision_batch(
  p_org_id uuid,
  p_contract_id uuid,
  p_source_review_id uuid,
  p_submitted_by uuid,
  p_review_style text,
  p_decision_snapshot jsonb,
  p_rule_bundle_id uuid,
  p_rule_bundle_version integer,
  p_model_policy_id uuid,
  p_rule_snapshot_ids uuid[],
  p_rule_set_snapshot_ids uuid[],
  p_source_storage_path text,
  p_source_hash text,
  p_source_text_hash text
)
returns table(batch_id uuid, review_id uuid, job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_contract_status text;
  current_storage_path text;
  current_source_hash text;
  current_source_text_hash text;
  current_parsed_text_hash text;
  expected_risks integer;
  snapshot_risks integer;
  affected_rows integer;
  snapshot jsonb;
  v_now timestamptz := now();
  v_batch_id uuid;
  v_review_id uuid;
  v_job_id uuid;
begin
  if p_review_style not in ('lenient', 'balanced', 'strict') then
    raise exception 'invalid review style' using errcode = '22023';
  end if;
  if jsonb_typeof(p_decision_snapshot) is distinct from 'array' then
    raise exception 'decision snapshot must be a JSON array' using errcode = '22023';
  end if;
  if p_rule_bundle_id is null or p_rule_bundle_version is null or p_rule_bundle_version < 1 then
    raise exception 'published rule bundle identity is required' using errcode = '23514';
  end if;
  if coalesce(p_source_storage_path, '') = ''
     or coalesce(p_source_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_source_text_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'complete source identity is required' using errcode = '23514';
  end if;
  if not exists (
    select 1
      from public.contract_skill_bundles as bundle
     where bundle.id = p_rule_bundle_id
       and bundle.org_id = p_org_id
       and bundle.key = 'CONTRACT_REVIEW_DEFAULT'
       and bundle.status = 'published'
       and bundle.version = p_rule_bundle_version
       and bundle.model_policy_id is not distinct from p_model_policy_id
       and bundle.rule_snapshot_ids is not distinct from coalesce(p_rule_snapshot_ids, '{}'::uuid[])
       and bundle.rule_set_snapshot_ids is not distinct from coalesce(p_rule_set_snapshot_ids, '{}'::uuid[])
  ) then
    raise exception 'published review bundle provenance does not match the organization or snapshots' using errcode = '23514';
  end if;

  select contracts.status,
         contracts.storage_path,
         page_maps.source_hash,
         page_maps.source_text_hash,
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(coalesce(contracts.parsed_text, ''), 'UTF8'), 'sha256'),
           'hex'
         )
    into current_contract_status, current_storage_path, current_source_hash,
         current_source_text_hash, current_parsed_text_hash
    from public.contracts
    join public.contract_source_page_maps as page_maps
      on page_maps.contract_id = contracts.id
     and page_maps.storage_path = contracts.storage_path
   where contracts.id = p_contract_id
     and contracts.org_id = p_org_id
   for update of contracts, page_maps;
  if not found then
    raise exception 'contract or current source page map was not found' using errcode = 'P0002';
  end if;
  if current_contract_status in ('PARSING', 'ANALYZING') then
    raise exception 'contract already has an active analysis' using errcode = '55000';
  end if;
  if current_storage_path is distinct from p_source_storage_path
     or current_source_hash is distinct from p_source_hash
     or current_source_text_hash is distinct from p_source_text_hash
     or current_parsed_text_hash is distinct from p_source_text_hash then
    raise exception 'contract source identity changed before review setup' using errcode = '40001';
  end if;
  if not exists (
    select 1
      from public.contract_reviews
     where id = p_source_review_id
       and contract_id = p_contract_id
       and status = 'COMPLETED'
       and source_storage_path = p_source_storage_path
       and source_hash = p_source_hash
       and source_text_hash = p_source_text_hash
       and skill_bundle_id = p_rule_bundle_id
       and rule_version = p_rule_bundle_version
       and model_policy_id is not distinct from p_model_policy_id
       and rule_snapshot_ids is not distinct from coalesce(p_rule_snapshot_ids, '{}'::uuid[])
       and rule_set_snapshot_ids is not distinct from coalesce(p_rule_set_snapshot_ids, '{}'::uuid[])
  ) then
    raise exception 'source ReviewRun does not belong to the contract' using errcode = '23514';
  end if;
  if exists (
    select 1
      from public.contract_reviews as newer_review
     where newer_review.contract_id = p_contract_id
       and newer_review.status = 'COMPLETED'
       and newer_review.source_storage_path = p_source_storage_path
       and newer_review.source_hash = p_source_hash
       and newer_review.source_text_hash = p_source_text_hash
       and newer_review.created_at > (
         select source_review.created_at
           from public.contract_reviews as source_review
          where source_review.id = p_source_review_id
       )
  ) then
    raise exception 'a newer completed ReviewRun already supersedes this source review' using errcode = '40001';
  end if;

  perform 1
    from public.contract_risk_cards as source_risk
   where source_risk.contract_id = p_contract_id
     and source_risk.review_id = p_source_review_id
   for update;

  select count(*)
    into expected_risks
    from public.contract_risk_cards as source_risk
   where source_risk.contract_id = p_contract_id
     and source_risk.review_id = p_source_review_id
     and source_risk.status = 'open';
  if expected_risks = 0 then
    raise exception 'decision review requires at least one open risk' using errcode = '55000';
  end if;
  if expected_risks <> jsonb_array_length(p_decision_snapshot) then
    raise exception 'decision snapshot does not cover every open risk' using errcode = '40001';
  end if;
  select count(distinct (value->>'risk_id')::uuid)
    into snapshot_risks
    from jsonb_array_elements(p_decision_snapshot) as item(value);
  if snapshot_risks <> expected_risks then
    raise exception 'decision snapshot contains duplicate or missing risk identities' using errcode = '40001';
  end if;

  insert into public.contract_review_submission_batches (
    org_id,
    contract_id,
    source_review_id,
    submitted_by,
    review_style,
    status,
    decision_snapshot,
    conflict_report,
    rule_bundle_id,
    rule_bundle_version,
    source_storage_path,
    source_hash,
    source_text_hash
  ) values (
    p_org_id,
    p_contract_id,
    p_source_review_id,
    p_submitted_by,
    p_review_style,
    'checking',
    p_decision_snapshot,
    '[]'::jsonb,
    p_rule_bundle_id,
    p_rule_bundle_version,
    p_source_storage_path,
    p_source_hash,
    p_source_text_hash
  ) returning id into v_batch_id;

  insert into public.contract_reviews (
    contract_id,
    status,
    started_at,
    rule_version,
    skill_bundle_id,
    model_policy_id,
    rule_snapshot_ids,
    rule_set_snapshot_ids,
    review_trigger,
    parent_review_id,
    source_storage_path,
    source_hash,
    source_text_hash
  ) values (
    p_contract_id,
    'PARSING',
    v_now,
    p_rule_bundle_version,
    p_rule_bundle_id,
    p_model_policy_id,
    coalesce(p_rule_snapshot_ids, '{}'::uuid[]),
    coalesce(p_rule_set_snapshot_ids, '{}'::uuid[]),
    'decision_batch',
    p_source_review_id,
    p_source_storage_path,
    p_source_hash,
    p_source_text_hash
  ) returning id into v_review_id;

  insert into public.contract_analysis_jobs (
    contract_id,
    review_id,
    requested_by,
    status,
    updated_at
  ) values (
    p_contract_id,
    v_review_id,
    p_submitted_by,
    'queued',
    v_now
  ) returning id into v_job_id;

  update public.contract_review_submission_batches
     set status = 'review_running',
         new_review_id = v_review_id,
         analysis_job_id = v_job_id
   where id = v_batch_id
     and status = 'checking';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'review batch linkage failed' using errcode = '40001';
  end if;

  for snapshot in select value from jsonb_array_elements(p_decision_snapshot)
  loop
    if coalesce(snapshot->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(snapshot->>'risk_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(snapshot->'optimistic_version') is distinct from 'number'
       or (snapshot->>'optimistic_version')::numeric < 1
       or (snapshot->>'optimistic_version')::numeric > 2147483647
       or (snapshot->>'optimistic_version')::numeric <> trunc((snapshot->>'optimistic_version')::numeric)
       or snapshot->>'source_storage_path' is distinct from p_source_storage_path
       or snapshot->>'source_hash' is distinct from p_source_hash
       or snapshot->>'source_text_hash' is distinct from p_source_text_hash then
      raise exception 'decision snapshot identity is incomplete or stale' using errcode = '40001';
    end if;

    update public.contract_review_decision_drafts as draft
       set workflow_state = 'REVIEW_QUEUED', updated_at = v_now
     where draft.id = (snapshot->>'id')::uuid
       and draft.org_id = p_org_id
       and draft.contract_id = p_contract_id
       and draft.review_id = p_source_review_id
       and draft.risk_id = (snapshot->>'risk_id')::uuid
       and draft.created_by = p_submitted_by
       and draft.source_storage_path = p_source_storage_path
       and draft.source_hash = p_source_hash
       and draft.source_text_hash = p_source_text_hash
       and draft.optimistic_version = (snapshot->>'optimistic_version')::integer
       and draft.status = 'draft_selected'
       and exists (
         select 1
           from public.contract_risk_cards as risk
          where risk.id = (snapshot->>'risk_id')::uuid
            and risk.contract_id = p_contract_id
            and risk.review_id = p_source_review_id
            and risk.status = 'open'
       );
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception 'decision draft changed before atomic review setup' using errcode = '40001';
    end if;
  end loop;

  update public.contracts
     set status = 'PARSING', updated_at = v_now
   where id = p_contract_id
     and status = current_contract_status;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract status changed before atomic review setup' using errcode = '40001';
  end if;

  return query select v_batch_id, v_review_id, v_job_id;
end;
$$;

revoke all on function public.start_contract_review_decision_batch(
  uuid, uuid, uuid, uuid, text, jsonb, uuid, integer, uuid, uuid[], uuid[], text, text, text
) from public, anon, authenticated;
grant execute on function public.start_contract_review_decision_batch(
  uuid, uuid, uuid, uuid, text, jsonb, uuid, integer, uuid, uuid[], uuid[], text, text, text
) to service_role;

create or replace function public.claim_contract_analysis_job(
  p_worker_id text,
  p_stale_after interval default interval '15 minutes'
)
returns setof public.contract_analysis_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.contract_analysis_jobs%rowtype;
  v_now timestamptz := now();
  v_max_attempts constant integer := 3;
begin
  if coalesce(btrim(p_worker_id), '') = '' then
    raise exception 'worker identity is required' using errcode = '22023';
  end if;
  if p_stale_after <= interval '0 seconds' then
    raise exception 'stale interval must be positive' using errcode = '22023';
  end if;

  perform public.expire_stale_contract_review_setups(p_stale_after, null);

  for v_job in
    select *
      from public.contract_analysis_jobs
     where (status = 'running' and locked_at is not null and locked_at < v_now - p_stale_after)
        or (status = 'queued' and attempts >= v_max_attempts)
     order by created_at asc
     for update skip locked
  loop
    if v_job.attempts >= v_max_attempts then
      update public.contract_review_decision_drafts as draft
         set workflow_state = 'NEEDS_REVISION', updated_at = v_now
       where draft.status = 'draft_selected'
         and exists (
           select 1
             from public.contract_review_submission_batches as batch
             cross join lateral jsonb_array_elements(
               case when jsonb_typeof(batch.decision_snapshot) = 'array'
                 then batch.decision_snapshot else '[]'::jsonb end
             ) as item(snapshot)
            where batch.analysis_job_id = v_job.id
              and batch.contract_id = draft.contract_id
              and batch.source_review_id = draft.review_id
              and coalesce(item.snapshot->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              and coalesce(item.snapshot->>'risk_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              and draft.id = (item.snapshot->>'id')::uuid
              and draft.risk_id = (item.snapshot->>'risk_id')::uuid
              and draft.created_by::text = item.snapshot->>'created_by'
              and draft.optimistic_version::text = item.snapshot->>'optimistic_version'
              and draft.source_storage_path = batch.source_storage_path
              and draft.source_hash = batch.source_hash
              and draft.source_text_hash = batch.source_text_hash
         );
      update public.contract_review_submission_batches
         set status = 'failed',
             conflict_report = jsonb_build_array(jsonb_build_object(
               'code', 'MAX_ATTEMPTS_EXCEEDED',
               'message', 'Analysis job exceeded the maximum lease attempts'
             )),
             completed_at = v_now
       where analysis_job_id = v_job.id
         and status in ('checking', 'review_running');
      delete from public.contract_review_decision_drafts where review_id = v_job.review_id;
      delete from public.contract_risk_cards where review_id = v_job.review_id;
      delete from public.contract_clauses where review_id = v_job.review_id;
      update public.contract_reviews
         set status = 'FAILED',
             results = jsonb_build_object('error', 'Analysis job exceeded the maximum lease attempts'),
             risk_summary = null,
             compliance_check = null,
             effectiveness_analysis = null,
             completed_at = v_now,
             updated_at = v_now
       where id = v_job.review_id
         and contract_id = v_job.contract_id
         and status in ('PARSING', 'ANALYZING');
      update public.contracts
         set status = 'FAILED', updated_at = v_now
       where id = v_job.contract_id
         and status in ('PARSING', 'ANALYZING');
      update public.contract_analysis_jobs
         set status = 'failed',
             last_error = 'Analysis job exceeded the maximum lease attempts',
             completed_at = v_now,
             locked_at = null,
             lock_token = null,
             locked_by = null,
             updated_at = v_now
       where id = v_job.id;
    else
      update public.contract_analysis_jobs
         set status = 'queued',
             locked_at = null,
             lock_token = null,
             locked_by = null,
             last_error = coalesce(last_error, 'Recovered from expired lease'),
             updated_at = v_now
       where id = v_job.id
         and status = 'running';
    end if;
  end loop;

  select *
    into v_job
    from public.contract_analysis_jobs
   where status = 'queued'
     and attempts < v_max_attempts
   order by created_at asc
   for update skip locked
   limit 1;

  if not found then
    return;
  end if;

  update public.contract_analysis_jobs
     set status = 'running',
         attempts = attempts + 1,
         locked_at = v_now,
         lock_token = gen_random_uuid(),
         locked_by = p_worker_id,
         started_at = coalesce(started_at, v_now),
         last_error = null,
         updated_at = v_now
   where id = v_job.id
   returning * into v_job;

  return next v_job;
end;
$$;

revoke all on function public.claim_contract_analysis_job(text, interval) from public, anon, authenticated;
grant execute on function public.claim_contract_analysis_job(text, interval) to service_role;

create or replace function public.heartbeat_contract_analysis_job(
  p_job_id uuid,
  p_lock_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  update public.contract_analysis_jobs
     set locked_at = now(), updated_at = now()
   where id = p_job_id
     and status = 'running'
     and lock_token = p_lock_token;
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

revoke all on function public.heartbeat_contract_analysis_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.heartbeat_contract_analysis_job(uuid, uuid) to service_role;

create or replace function public.activate_contract_analysis_job(
  p_job_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_lock_token uuid,
  p_locked_by text
)
returns setof public.contract_analysis_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.contract_analysis_jobs%rowtype;
  affected_rows integer;
  v_now timestamptz := now();
begin
  if p_lock_token is null or coalesce(btrim(p_locked_by), '') = '' then
    raise exception 'analysis job lease identity is required' using errcode = '22023';
  end if;
  select *
    into v_job
    from public.contract_analysis_jobs
   where id = p_job_id
     and contract_id = p_contract_id
     and review_id = p_review_id
   for update;
  if not found then
    raise exception 'contract analysis job was not found' using errcode = 'P0002';
  end if;
  if v_job.status = 'running' then
    if v_job.lock_token is distinct from p_lock_token then
      raise exception 'analysis job lease is no longer owned by this worker' using errcode = '55000';
    end if;
  elsif v_job.status not in ('preparing', 'queued') then
    raise exception 'analysis job cannot enter running state from %', v_job.status using errcode = '55000';
  end if;

  update public.contracts
     set status = 'ANALYZING', updated_at = v_now
   where id = p_contract_id and status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract cannot enter analysis running state' using errcode = '40001';
  end if;
  update public.contract_reviews
     set status = 'ANALYZING', updated_at = v_now
   where id = p_review_id and contract_id = p_contract_id and status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'ReviewRun cannot enter analysis running state' using errcode = '40001';
  end if;
  update public.contract_analysis_jobs
     set status = 'running',
         attempts = case when v_job.status = 'running' then attempts else attempts + 1 end,
         last_error = null,
         locked_at = v_now,
         lock_token = p_lock_token,
         locked_by = p_locked_by,
         started_at = coalesce(started_at, v_now),
         updated_at = v_now
   where id = p_job_id
     and status = v_job.status
     and (v_job.status <> 'running' or lock_token = p_lock_token)
   returning * into v_job;
  if not found then
    raise exception 'analysis job running state changed concurrently' using errcode = '40001';
  end if;
  return next v_job;
end;
$$;

revoke all on function public.activate_contract_analysis_job(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.activate_contract_analysis_job(uuid, uuid, uuid, uuid, text) to service_role;

create or replace function public.enforce_current_contract_source_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_storage_path text;
  current_source_hash text;
  current_source_text_hash text;
begin
  if (new.source_storage_path is null) <> (new.source_hash is null) then
    raise exception 'source storage path and hash must be provided together' using errcode = '23514';
  end if;
  if new.source_storage_path is null and new.source_hash is null then
    if tg_op = 'UPDATE' then
      if old.source_storage_path is null
         and old.source_hash is null
         and new.contract_id is not distinct from old.contract_id
         and (to_jsonb(new)->'source_anchor') is not distinct from (to_jsonb(old)->'source_anchor') then
        return new;
      end if;
    end if;
    raise exception 'new or identity-changing review rows require source identity' using errcode = '23514';
  end if;
  if to_jsonb(new) ? 'source_text_hash'
     and coalesce(to_jsonb(new)->>'source_text_hash', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'review submission batch requires parsed text identity' using errcode = '23514';
  end if;

  select contracts.storage_path, page_maps.source_hash, page_maps.source_text_hash
    into current_storage_path, current_source_hash, current_source_text_hash
    from public.contracts
    join public.contract_source_page_maps as page_maps
      on page_maps.contract_id = contracts.id
     and page_maps.storage_path = contracts.storage_path
   where contracts.id = new.contract_id
   for share of contracts, page_maps;

  if current_storage_path is null or current_source_hash is null then
    raise exception 'current contract source identity is missing' using errcode = '23514';
  end if;
  if new.source_storage_path is distinct from current_storage_path
     or new.source_hash is distinct from current_source_hash then
    raise exception 'row source identity does not match current contract source' using errcode = '23514';
  end if;
  if to_jsonb(new) ? 'source_text_hash'
     and (to_jsonb(new)->>'source_text_hash') is distinct from current_source_text_hash then
    raise exception 'review submission parsed text identity does not match current page map' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_current_contract_source_identity() from public, anon, authenticated;
grant execute on function public.enforce_current_contract_source_identity() to service_role;

drop trigger if exists trg_contract_review_decision_source_identity on public.contract_review_decision_drafts;
create trigger trg_contract_review_decision_source_identity
before insert or update of contract_id, source_anchor, source_storage_path, source_hash, source_text_hash
on public.contract_review_decision_drafts
for each row execute function public.enforce_current_contract_source_identity();

drop trigger if exists trg_contract_review_batch_source_identity on public.contract_review_submission_batches;
create trigger trg_contract_review_batch_source_identity
before insert or update of contract_id, source_storage_path, source_hash, source_text_hash
on public.contract_review_submission_batches
for each row execute function public.enforce_current_contract_source_identity();

create or replace function public.enforce_current_review_batch_source_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_review_created_at timestamptz;
begin
  select review.created_at
    into source_review_created_at
    from public.contract_reviews as review
   where review.id = new.source_review_id
     and review.contract_id = new.contract_id
     and review.status = 'COMPLETED'
     and review.source_storage_path = new.source_storage_path
     and review.source_hash = new.source_hash
     and review.source_text_hash = new.source_text_hash
   for share;
  if not found then
    raise exception 'review batch source ReviewRun is incomplete or belongs to another source identity' using errcode = '55000';
  end if;
  if exists (
    select 1
      from public.contract_reviews as newer_review
     where newer_review.contract_id = new.contract_id
       and newer_review.status = 'COMPLETED'
       and newer_review.created_at > source_review_created_at
       and newer_review.source_storage_path = new.source_storage_path
       and newer_review.source_hash = new.source_hash
       and newer_review.source_text_hash = new.source_text_hash
  ) then
    raise exception 'review batch source ReviewRun has been superseded' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_current_review_batch_source_review() from public, anon, authenticated;
grant execute on function public.enforce_current_review_batch_source_review() to service_role;

drop trigger if exists trg_contract_review_batch_current_source_review on public.contract_review_submission_batches;
create trigger trg_contract_review_batch_current_source_review
before insert or update of contract_id, source_review_id, source_storage_path, source_hash, source_text_hash
on public.contract_review_submission_batches
for each row execute function public.enforce_current_review_batch_source_review();

drop trigger if exists trg_contract_review_run_source_identity on public.contract_reviews;
create trigger trg_contract_review_run_source_identity
before insert or update of contract_id, source_storage_path, source_hash, source_text_hash
on public.contract_reviews
for each row execute function public.enforce_current_contract_source_identity();

create or replace function public.prevent_active_review_source_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.contract_review_submission_batches
     where contract_id = old.id
       and status in ('checking', 'review_running')
  ) then
    raise exception 'contract source is locked by an active review submission batch' using errcode = '55000';
  end if;
  if exists (
    select 1
      from public.contract_analysis_jobs
     where contract_id = old.id
       and status in ('preparing', 'queued', 'running')
  ) then
    raise exception 'contract source is locked by an active analysis job' using errcode = '55000';
  end if;
  if (
    old.storage_path is distinct from new.storage_path
    or old.filename is distinct from new.filename
    or old.mime_type is distinct from new.mime_type
  ) and new.parsed_text is not distinct from old.parsed_text then
    new.parsed_text := null;
  end if;
  new.status := 'PENDING';
  new.conclusion := 'PENDING';
  new.conclusion_reason := null;
  new.concluded_at := null;
  new.concluded_by := null;
  return new;
end;
$$;

revoke all on function public.prevent_active_review_source_mutation() from public, anon, authenticated;
grant execute on function public.prevent_active_review_source_mutation() to service_role;

drop trigger if exists trg_contract_source_active_review_lock on public.contracts;
create trigger trg_contract_source_active_review_lock
before update of storage_path, parsed_text, filename, mime_type
on public.contracts
for each row
when (
  old.storage_path is distinct from new.storage_path
  or old.parsed_text is distinct from new.parsed_text
  or old.filename is distinct from new.filename
  or old.mime_type is distinct from new.mime_type
)
execute function public.prevent_active_review_source_mutation();

create or replace function public.prevent_active_review_decision_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_review_created_at timestamptz;
  source_review_status text;
begin
  if tg_op = 'UPDATE' and old.status is distinct from 'draft_selected' then
    raise exception 'submitted decision drafts are immutable' using errcode = '55000';
  end if;
  select review.created_at, review.status
    into source_review_created_at, source_review_status
    from public.contract_reviews as review
   where review.id = new.review_id
     and review.contract_id = new.contract_id
   for share;
  if not found then
    raise exception 'decision source ReviewRun does not exist' using errcode = '55000';
  end if;
  if source_review_status is distinct from 'COMPLETED' and not exists (
    select 1
      from public.contract_review_submission_batches as staging_batch
     where staging_batch.id = new.submission_batch_id
       and staging_batch.contract_id = new.contract_id
       and staging_batch.new_review_id = new.review_id
       and staging_batch.status = 'review_running'
       and staging_batch.source_storage_path = new.source_storage_path
       and staging_batch.source_hash = new.source_hash
       and staging_batch.source_text_hash = new.source_text_hash
  ) then
    raise exception 'decision source ReviewRun is incomplete' using errcode = '55000';
  end if;
  perform 1
    from public.contract_risk_cards as risk
   where risk.id = new.risk_id
     and risk.contract_id = new.contract_id
     and risk.review_id = new.review_id
     and risk.status = 'open'
   for share;
  if not found then
    raise exception 'decision risk is no longer open in its source ReviewRun' using errcode = '55000';
  end if;
  if exists (
    select 1
      from public.contract_review_submission_batches
     where contract_id = new.contract_id
       and source_review_id = new.review_id
       and status in ('checking', 'review_running')
  ) then
    raise exception 'decision draft is locked by an active review submission batch' using errcode = '55000';
  end if;
  if exists (
    select 1
      from public.contract_reviews as later_review
     where later_review.contract_id = new.contract_id
       and later_review.status = 'COMPLETED'
       and later_review.created_at > source_review_created_at
       and later_review.source_storage_path = new.source_storage_path
       and later_review.source_hash = new.source_hash
       and later_review.source_text_hash = new.source_text_hash
  ) then
    raise exception 'decision source ReviewRun has been superseded by a completed ReviewRun' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_active_review_decision_mutation() from public, anon, authenticated;
grant execute on function public.prevent_active_review_decision_mutation() to service_role;

drop trigger if exists trg_contract_review_decision_active_batch_lock on public.contract_review_decision_drafts;
create trigger trg_contract_review_decision_active_batch_lock
before insert or update of
  decision_kind,
  selected_option_id,
  selected_option_snapshot,
  feedback,
  resolution_strategy_id,
  resolution_strategy_snapshot,
  negotiation_result,
  internal_note,
  customer_comment,
  revision_text,
  translation_input_snapshot,
  source_anchor,
  source_storage_path,
  source_hash,
  source_text_hash,
  optimistic_version
on public.contract_review_decision_drafts
for each row execute function public.prevent_active_review_decision_mutation();

create or replace function public.prevent_submitted_decision_draft_reopen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'batch_submitted' and (
    new.status is distinct from old.status
    or new.workflow_state is distinct from old.workflow_state
    or new.submission_batch_id is distinct from old.submission_batch_id
    or new.submitted_at is distinct from old.submitted_at
  ) then
    raise exception 'submitted decision draft state is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_submitted_decision_draft_reopen() from public, anon, authenticated;
grant execute on function public.prevent_submitted_decision_draft_reopen() to service_role;

drop trigger if exists trg_contract_review_decision_submitted_state_lock on public.contract_review_decision_drafts;
create trigger trg_contract_review_decision_submitted_state_lock
before update of status, workflow_state, submission_batch_id, submitted_at
on public.contract_review_decision_drafts
for each row execute function public.prevent_submitted_decision_draft_reopen();

create or replace function public.save_contract_review_decision_draft(
  p_org_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_risk_id uuid,
  p_created_by uuid,
  p_expected_version integer,
  p_draft jsonb
)
returns setof public.contract_review_decision_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_storage_path text;
  current_source_hash text;
  current_source_text_hash text;
  current_parsed_text_hash text;
  review_skill_bundle_id uuid;
  review_bundle_version integer;
  existing_draft public.contract_review_decision_drafts%rowtype;
  saved_draft public.contract_review_decision_drafts%rowtype;
  has_existing boolean;
  v_now timestamptz := now();
begin
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'expected decision draft version is invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_draft) is distinct from 'object'
     or coalesce(p_draft->>'source_storage_path', '') = ''
     or coalesce(p_draft->>'source_hash', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_draft->>'source_text_hash', '') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_draft->'source_anchor') is distinct from 'object'
     or jsonb_typeof(p_draft->'evidence_anchors') is distinct from 'array'
     or coalesce(p_draft->>'workflow_state', '') = '' then
    raise exception 'decision draft payload is incomplete' using errcode = '23514';
  end if;

  -- Canonical order shared with batch submission: contract/page map -> source
  -- ReviewRun -> source risk -> decision draft. This prevents draft/contract
  -- lock inversion between a second tab save and a simultaneous submission.
  select contract.storage_path,
         page_map.source_hash,
         page_map.source_text_hash,
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(coalesce(contract.parsed_text, ''), 'UTF8'), 'sha256'),
           'hex'
         )
    into current_storage_path, current_source_hash, current_source_text_hash,
         current_parsed_text_hash
    from public.contracts as contract
    join public.contract_source_page_maps as page_map
      on page_map.contract_id = contract.id
     and page_map.storage_path = contract.storage_path
   where contract.id = p_contract_id
     and contract.org_id = p_org_id
   for update of contract, page_map;
  if not found
     or current_storage_path is distinct from p_draft->>'source_storage_path'
     or current_source_hash is distinct from p_draft->>'source_hash'
     or current_source_text_hash is distinct from p_draft->>'source_text_hash'
     or current_parsed_text_hash is distinct from p_draft->>'source_text_hash' then
    raise exception 'contract source identity changed before decision save' using errcode = '40001';
  end if;

  select review.skill_bundle_id, review.rule_version
    into review_skill_bundle_id, review_bundle_version
    from public.contract_reviews as review
   where review.id = p_review_id
     and review.contract_id = p_contract_id
     and review.status = 'COMPLETED'
     and review.source_storage_path = current_storage_path
     and review.source_hash = current_source_hash
     and review.source_text_hash = current_source_text_hash
   for share;
  if not found
     or review_skill_bundle_id is null
     or review_bundle_version is null
     or p_draft->>'rule_bundle_id' is distinct from review_skill_bundle_id::text
     or p_draft->>'rule_bundle_version' is distinct from review_bundle_version::text then
    raise exception 'decision draft ReviewRun or frozen bundle identity changed' using errcode = '55000';
  end if;

  perform 1
    from public.contract_risk_cards as risk
   where risk.id = p_risk_id
     and risk.contract_id = p_contract_id
     and risk.review_id = p_review_id
     and risk.status = 'open'
   for update;
  if not found then
    raise exception 'decision risk is no longer open' using errcode = '55000';
  end if;

  select *
    into existing_draft
    from public.contract_review_decision_drafts as draft
   where draft.review_id = p_review_id
     and draft.risk_id = p_risk_id
     and draft.created_by = p_created_by
   for update;
  has_existing := found;

  if has_existing then
    if existing_draft.org_id is distinct from p_org_id
       or existing_draft.contract_id is distinct from p_contract_id
       or existing_draft.status is distinct from 'draft_selected'
       or existing_draft.optimistic_version is distinct from p_expected_version then
      raise exception 'decision draft changed before save' using errcode = '40001';
    end if;
    update public.contract_review_decision_drafts
       set status = 'draft_selected',
           decision_kind = nullif(p_draft->>'decision_kind', ''),
           selected_option_id = nullif(p_draft->>'selected_option_id', ''),
           selected_option_snapshot = nullif(p_draft->'selected_option_snapshot', 'null'::jsonb),
           resolution_strategy_id = nullif(p_draft->>'resolution_strategy_id', ''),
           resolution_strategy_snapshot = nullif(p_draft->'resolution_strategy_snapshot', 'null'::jsonb),
           negotiation_result = nullif(p_draft->>'negotiation_result', ''),
           feedback = nullif(p_draft->>'feedback', ''),
           internal_note = nullif(p_draft->>'internal_note', ''),
           customer_comment = nullif(p_draft->>'customer_comment', ''),
           revision_text = nullif(p_draft->>'revision_text', ''),
           translation_input_snapshot = nullif(p_draft->'translation_input_snapshot', 'null'::jsonb),
           comment_preview = nullif(p_draft->>'comment_preview', ''),
           source_anchor = p_draft->'source_anchor',
           source_storage_path = current_storage_path,
           source_hash = current_source_hash,
           source_text_hash = current_source_text_hash,
           evidence_anchors = p_draft->'evidence_anchors',
           workflow_state = p_draft->>'workflow_state',
           rule_bundle_id = review_skill_bundle_id,
           rule_bundle_version = review_bundle_version,
           submission_batch_id = null,
           submitted_at = null,
           optimistic_version = p_expected_version + 1,
           updated_at = v_now
     where id = existing_draft.id
     returning * into saved_draft;
  else
    if p_expected_version <> 0 then
      raise exception 'decision draft was removed or replaced before save' using errcode = '40001';
    end if;
    insert into public.contract_review_decision_drafts (
      org_id, contract_id, review_id, risk_id, created_by, status,
      decision_kind, selected_option_id, selected_option_snapshot,
      resolution_strategy_id, resolution_strategy_snapshot, negotiation_result,
      feedback, internal_note, customer_comment, revision_text,
      translation_input_snapshot, comment_preview, source_anchor,
      source_storage_path, source_hash, source_text_hash, evidence_anchors,
      workflow_state, rule_bundle_id, rule_bundle_version,
      submission_batch_id, submitted_at, optimistic_version, created_at, updated_at
    ) values (
      p_org_id, p_contract_id, p_review_id, p_risk_id, p_created_by, 'draft_selected',
      nullif(p_draft->>'decision_kind', ''),
      nullif(p_draft->>'selected_option_id', ''),
      nullif(p_draft->'selected_option_snapshot', 'null'::jsonb),
      nullif(p_draft->>'resolution_strategy_id', ''),
      nullif(p_draft->'resolution_strategy_snapshot', 'null'::jsonb),
      nullif(p_draft->>'negotiation_result', ''),
      nullif(p_draft->>'feedback', ''),
      nullif(p_draft->>'internal_note', ''),
      nullif(p_draft->>'customer_comment', ''),
      nullif(p_draft->>'revision_text', ''),
      nullif(p_draft->'translation_input_snapshot', 'null'::jsonb),
      nullif(p_draft->>'comment_preview', ''),
      p_draft->'source_anchor',
      current_storage_path, current_source_hash, current_source_text_hash,
      p_draft->'evidence_anchors', p_draft->>'workflow_state',
      review_skill_bundle_id, review_bundle_version,
      null, null, 1, v_now, v_now
    ) returning * into saved_draft;
  end if;

  return next saved_draft;
end;
$$;

revoke all on function public.save_contract_review_decision_draft(uuid, uuid, uuid, uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_contract_review_decision_draft(uuid, uuid, uuid, uuid, uuid, integer, jsonb) to service_role;

create or replace function public.contract_utf16_codeunit_length(p_text text)
returns integer
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  character_count integer := pg_catalog.char_length(p_text);
  codeunit_count integer := 0;
  character_index integer;
  current_character text;
begin
  if character_count = 0 then return 0; end if;
  for character_index in 1..character_count loop
    current_character := pg_catalog.substr(p_text, character_index, 1);
    codeunit_count := codeunit_count + case
      when pg_catalog.ascii(current_character) > 65535 then 2
      else 1
    end;
  end loop;
  return codeunit_count;
end;
$$;

revoke all on function public.contract_utf16_codeunit_length(text) from public, anon, authenticated;
grant execute on function public.contract_utf16_codeunit_length(text) to service_role;

create or replace function public.prevent_active_review_risk_fact_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' and exists (
    select 1
      from public.contract_review_submission_batches
     where contract_id = old.contract_id
       and source_review_id = old.review_id
       and status in ('checking', 'review_running')
  ) then
    raise exception 'source ReviewRun risk facts are immutable while a decision batch is active' using errcode = '55000';
  end if;
  if tg_op <> 'DELETE' and exists (
    select 1
      from public.contract_review_submission_batches
     where contract_id = new.contract_id
       and source_review_id = new.review_id
       and status in ('checking', 'review_running')
  ) then
    raise exception 'source ReviewRun risk facts are immutable while a decision batch is active' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.prevent_active_review_risk_fact_mutation() from public, anon, authenticated;
grant execute on function public.prevent_active_review_risk_fact_mutation() to service_role;

drop trigger if exists trg_contract_risk_fact_active_batch_lock on public.contract_risk_cards;
create trigger trg_contract_risk_fact_active_batch_lock
before insert or update or delete on public.contract_risk_cards
for each row execute function public.prevent_active_review_risk_fact_mutation();

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

  select status, review_trigger, strategy_id, skill_bundle_id, rule_version,
         model_policy_id, rule_snapshot_ids, rule_set_snapshot_ids,
         source_storage_path, source_hash, source_text_hash
    into review_status, review_trigger, review_strategy_id,
         review_skill_bundle_id, review_bundle_version, review_model_policy_id,
         review_rule_snapshot_ids, review_rule_set_snapshot_ids,
         review_storage_path, review_source_hash, review_source_text_hash
    from public.contract_reviews
   where id = p_review_id and contract_id = p_contract_id
   for update;
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
          or risk.position_end > public.contract_utf16_codeunit_length(current_parsed_text)
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
            and (
              risk.evidence->>'source_anchor_status' is distinct from 'exact_unique_text'
              or risk.evidence->>'source_anchor_match_field' is distinct from 'source_quote'
              or coalesce(risk.evidence->>'source_exact_text', '') = ''
              or pg_catalog.strpos(current_parsed_text, risk.evidence->>'source_exact_text') = 0
              or public.contract_utf16_codeunit_length(pg_catalog.substr(
                   current_parsed_text,
                   1,
                   case
                     when pg_catalog.strpos(current_parsed_text, risk.evidence->>'source_exact_text') > 0
                       then pg_catalog.strpos(current_parsed_text, risk.evidence->>'source_exact_text') - 1
                     else 0
                   end
                 )) <> risk.position_start
              or public.contract_utf16_codeunit_length(risk.evidence->>'source_exact_text')
                 <> risk.position_end - risk.position_start
              or pg_catalog.strpos(
                   pg_catalog.substr(
                     current_parsed_text,
                     pg_catalog.strpos(current_parsed_text, risk.evidence->>'source_exact_text') + 1
                   ),
                   risk.evidence->>'source_exact_text'
                 ) <> 0
            )
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

create or replace function public.stage_contract_review_decision_result(
  p_batch_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_job_id uuid,
  p_lock_token uuid,
  p_risk_rows jsonb,
  p_retry_drafts jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job_status text;
  current_lock_token uuid;
  batch_status text;
  batch_source_review_id uuid;
  batch_storage_path text;
  batch_source_hash text;
  batch_source_text_hash text;
  current_storage_path text;
  current_source_hash text;
  current_source_text_hash text;
  current_parsed_text_hash text;
  expected_risks integer;
  inserted_rows integer;
begin
  if jsonb_typeof(p_risk_rows) is distinct from 'array'
     or jsonb_typeof(p_retry_drafts) is distinct from 'array' then
    raise exception 'decision result staging payload is invalid' using errcode = '22023';
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
    raise exception 'decision worker lease is no longer owned' using errcode = '55000';
  end if;

  select status, source_review_id, source_storage_path, source_hash, source_text_hash
    into batch_status, batch_source_review_id, batch_storage_path, batch_source_hash, batch_source_text_hash
    from public.contract_review_submission_batches
   where id = p_batch_id
     and contract_id = p_contract_id
     and new_review_id = p_review_id
     and analysis_job_id = p_job_id
   for update;
  if not found or batch_status <> 'review_running' then
    raise exception 'decision batch is not in its staging state' using errcode = '55000';
  end if;

  select contracts.storage_path,
         page_maps.source_hash,
         page_maps.source_text_hash,
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(coalesce(contracts.parsed_text, ''), 'UTF8'), 'sha256'),
           'hex'
         )
    into current_storage_path, current_source_hash, current_source_text_hash, current_parsed_text_hash
    from public.contracts
    join public.contract_source_page_maps as page_maps
      on page_maps.contract_id = contracts.id
     and page_maps.storage_path = contracts.storage_path
   where contracts.id = p_contract_id
     and contracts.status = 'ANALYZING'
   for update of contracts, page_maps;
  if not found
     or batch_storage_path is distinct from current_storage_path
     or batch_source_hash is distinct from current_source_hash
     or batch_source_text_hash is distinct from current_source_text_hash
     or batch_source_text_hash is distinct from current_parsed_text_hash then
    raise exception 'decision source identity changed before staging' using errcode = '40001';
  end if;
  perform 1
    from public.contract_reviews
   where id = p_review_id
     and contract_id = p_contract_id
     and status = 'ANALYZING'
     and review_trigger = 'decision_batch'
     and parent_review_id = batch_source_review_id
     and source_storage_path = batch_storage_path
     and source_hash = batch_source_hash
     and source_text_hash = batch_source_text_hash
   for update;
  if not found then
    raise exception 'decision ReviewRun identity changed before staging' using errcode = '40001';
  end if;

  select count(*) into expected_risks
    from public.contract_risk_cards
   where contract_id = p_contract_id and review_id = batch_source_review_id;
  if expected_risks <> jsonb_array_length(p_risk_rows) then
    raise exception 'decision risk facts do not cover the complete source ReviewRun' using errcode = '23514';
  end if;
  if (
    select count(distinct risk.value->'evidence'->>'source_risk_id')
      from jsonb_array_elements(p_risk_rows) as risk(value)
  ) <> expected_risks
     or exists (
       select 1
         from public.contract_risk_cards as source_risk
        where source_risk.contract_id = p_contract_id
          and source_risk.review_id = batch_source_review_id
          and not exists (
            select 1
              from jsonb_array_elements(p_risk_rows) as risk(value)
             where risk.value->'evidence'->>'source_risk_id' = source_risk.id::text
          )
     ) then
    raise exception 'decision risk facts do not map one-to-one to source risks' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_risk_rows) as risk(value)
     where risk.value->>'contract_id' is distinct from p_contract_id::text
        or risk.value->>'review_id' is distinct from p_review_id::text
  ) then
    raise exception 'decision risk facts contain a foreign identity' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_retry_drafts) as draft(value)
     where draft.value->>'contract_id' is distinct from p_contract_id::text
        or draft.value->>'review_id' is distinct from p_review_id::text
        or draft.value->>'submission_batch_id' is distinct from p_batch_id::text
        or draft.value->>'source_storage_path' is distinct from batch_storage_path
        or draft.value->>'source_hash' is distinct from batch_source_hash
        or draft.value->>'source_text_hash' is distinct from batch_source_text_hash
  ) then
    raise exception 'retry decision drafts contain a foreign source identity' using errcode = '23514';
  end if;

  delete from public.contract_review_decision_drafts where review_id = p_review_id;
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
         risk.created_at,
         risk.updated_at,
         risk.rule_id,
         risk.rule_code,
         risk.rule_version,
         risk.evidence
    from jsonb_to_recordset(p_risk_rows) as risk(
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
  if inserted_rows <> jsonb_array_length(p_risk_rows) then
    raise exception 'decision risk facts were not staged completely' using errcode = '23514';
  end if;

  insert into public.contract_review_decision_drafts (
    id, org_id, contract_id, review_id, risk_id, created_by, status,
    decision_kind, selected_option_id, selected_option_snapshot, feedback,
    comment_preview, source_anchor, rule_bundle_id, rule_bundle_version,
    submission_batch_id, optimistic_version, submitted_at, created_at, updated_at,
    internal_note, customer_comment, resolution_strategy_id,
    resolution_strategy_snapshot, negotiation_result, translation_input_snapshot,
    revision_text, evidence_anchors, workflow_state, source_storage_path,
    source_hash, source_text_hash
  )
  select draft.id,
         draft.org_id,
         draft.contract_id,
         draft.review_id,
         draft.risk_id,
         draft.created_by,
         draft.status,
         draft.decision_kind,
         draft.selected_option_id,
         draft.selected_option_snapshot,
         draft.feedback,
         draft.comment_preview,
         draft.source_anchor,
         draft.rule_bundle_id,
         draft.rule_bundle_version,
         draft.submission_batch_id,
         draft.optimistic_version,
         draft.submitted_at,
         draft.created_at,
         draft.updated_at,
         draft.internal_note,
         draft.customer_comment,
         draft.resolution_strategy_id,
         draft.resolution_strategy_snapshot,
         draft.negotiation_result,
         draft.translation_input_snapshot,
         draft.revision_text,
         draft.evidence_anchors,
         draft.workflow_state,
         draft.source_storage_path,
         draft.source_hash,
         draft.source_text_hash
    from jsonb_to_recordset(p_retry_drafts) as draft(
      id uuid,
      org_id uuid,
      contract_id uuid,
      review_id uuid,
      risk_id uuid,
      created_by uuid,
      status text,
      decision_kind text,
      selected_option_id text,
      selected_option_snapshot jsonb,
      feedback text,
      comment_preview text,
      source_anchor jsonb,
      rule_bundle_id uuid,
      rule_bundle_version integer,
      submission_batch_id uuid,
      optimistic_version integer,
      submitted_at timestamptz,
      created_at timestamptz,
      updated_at timestamptz,
      internal_note text,
      customer_comment text,
      resolution_strategy_id text,
      resolution_strategy_snapshot jsonb,
      negotiation_result text,
      translation_input_snapshot jsonb,
      revision_text text,
      evidence_anchors jsonb,
      workflow_state text,
      source_storage_path text,
      source_hash text,
      source_text_hash text
    );
  get diagnostics inserted_rows = row_count;
  if inserted_rows <> jsonb_array_length(p_retry_drafts) then
    raise exception 'retry decision drafts were not staged completely' using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.stage_contract_review_decision_result(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.stage_contract_review_decision_result(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb) to service_role;

create or replace function public.complete_contract_analysis_job(
  p_job_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_lock_token uuid,
  p_review_result jsonb,
  p_provider text,
  p_degraded boolean
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
  review_trigger text;
  review_storage_path text;
  review_source_hash text;
  review_source_text_hash text;
  affected_rows integer;
  v_completed_at timestamptz := now();
begin
  if jsonb_typeof(p_review_result) is distinct from 'object' then
    raise exception 'review result must be a JSON object' using errcode = '22023';
  end if;
  select status, lock_token
    into current_job_status, current_lock_token
    from public.contract_analysis_jobs
   where id = p_job_id
     and contract_id = p_contract_id
     and review_id = p_review_id
   for update;
  if not found then
    raise exception 'contract analysis job was not found' using errcode = 'P0002';
  end if;
  if current_job_status = 'completed' then
    if not exists (select 1 from public.contracts where id = p_contract_id and status = 'COMPLETED')
       or not exists (select 1 from public.contract_reviews where id = p_review_id and contract_id = p_contract_id and status = 'COMPLETED') then
      raise exception 'completed analysis job has inconsistent terminal state' using errcode = '23514';
    end if;
    return;
  end if;
  if current_job_status <> 'running'
     or p_lock_token is null
     or current_lock_token is distinct from p_lock_token then
    raise exception 'analysis job lease is no longer owned by this worker' using errcode = '55000';
  end if;

  select contracts.storage_path,
         page_maps.source_hash,
         page_maps.source_text_hash,
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(coalesce(contracts.parsed_text, ''), 'UTF8'), 'sha256'),
           'hex'
         )
    into current_storage_path, current_source_hash, current_source_text_hash, current_parsed_text_hash
    from public.contracts
    join public.contract_source_page_maps as page_maps
      on page_maps.contract_id = contracts.id
     and page_maps.storage_path = contracts.storage_path
   where contracts.id = p_contract_id
     and contracts.status = 'ANALYZING'
   for update of contracts, page_maps;
  if not found then
    raise exception 'active contract source identity is unavailable at completion' using errcode = '40001';
  end if;

  select contract_reviews.review_trigger,
         contract_reviews.source_storage_path,
         contract_reviews.source_hash,
         contract_reviews.source_text_hash
    into review_trigger, review_storage_path, review_source_hash, review_source_text_hash
    from public.contract_reviews
   where id = p_review_id
     and contract_id = p_contract_id
     and status = 'ANALYZING'
   for update;
  if not found
     or review_trigger is distinct from 'direct'
     or review_storage_path is distinct from current_storage_path
     or review_source_hash is distinct from current_source_hash
     or review_source_text_hash is distinct from current_source_text_hash
     or review_source_text_hash is distinct from current_parsed_text_hash then
    raise exception 'direct ReviewRun source identity changed before completion' using errcode = '40001';
  end if;

  update public.contracts
     set status = 'COMPLETED', updated_at = v_completed_at
   where id = p_contract_id and status = 'ANALYZING';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract completion state changed concurrently' using errcode = '40001';
  end if;
  update public.contract_reviews
     set status = 'COMPLETED', results = p_review_result, completed_at = v_completed_at, updated_at = v_completed_at
   where id = p_review_id and contract_id = p_contract_id and status = 'ANALYZING';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'ReviewRun completion state changed concurrently' using errcode = '40001';
  end if;
  update public.contract_analysis_jobs
     set status = 'completed',
         provider = p_provider,
         degraded = p_degraded,
         completed_at = v_completed_at,
         locked_at = null,
         lock_token = null,
         locked_by = null,
         updated_at = v_completed_at
   where id = p_job_id
     and status = 'running'
     and lock_token = p_lock_token;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'analysis job lease changed concurrently' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.complete_contract_analysis_job(uuid, uuid, uuid, uuid, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.complete_contract_analysis_job(uuid, uuid, uuid, uuid, jsonb, text, boolean) to service_role;

create or replace function public.fail_contract_analysis_job(
  p_job_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_lock_token uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job_status text;
  current_lock_token uuid;
  affected_rows integer;
  v_completed_at timestamptz := now();
begin
  select status, lock_token
    into current_job_status, current_lock_token
    from public.contract_analysis_jobs
   where id = p_job_id
     and contract_id = p_contract_id
     and review_id = p_review_id
   for update;
  if not found then
    raise exception 'contract analysis job was not found' using errcode = 'P0002';
  end if;
  if current_job_status = 'completed' then
    raise exception 'completed analysis job cannot be downgraded to failed' using errcode = '55000';
  end if;
  if current_job_status = 'failed' then
    if not exists (select 1 from public.contracts where id = p_contract_id and status = 'FAILED')
       or not exists (select 1 from public.contract_reviews where id = p_review_id and contract_id = p_contract_id and status = 'FAILED') then
      raise exception 'failed analysis job has inconsistent terminal state' using errcode = '23514';
    end if;
    return;
  end if;
  if current_job_status = 'running' and (
    p_lock_token is null or current_lock_token is distinct from p_lock_token
  ) then
    raise exception 'analysis job lease is no longer owned by this worker' using errcode = '55000';
  end if;
  if current_job_status in ('preparing', 'queued') and p_lock_token is not null then
    raise exception 'non-running analysis job cannot be failed with a worker lease' using errcode = '55000';
  end if;

  delete from public.contract_review_decision_drafts where review_id = p_review_id;
  delete from public.contract_risk_cards where review_id = p_review_id;
  delete from public.contract_clauses where review_id = p_review_id;
  update public.contract_reviews
     set status = 'FAILED',
         results = jsonb_build_object('error', coalesce(nullif(p_error, ''), 'Analysis failed')),
         risk_summary = null,
         compliance_check = null,
         effectiveness_analysis = null,
         completed_at = v_completed_at,
         updated_at = v_completed_at
   where id = p_review_id
     and contract_id = p_contract_id
     and status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'ReviewRun failure state changed concurrently' using errcode = '40001';
  end if;
  update public.contracts
     set status = 'FAILED', updated_at = v_completed_at
   where id = p_contract_id and status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract failure state changed concurrently' using errcode = '40001';
  end if;
  update public.contract_analysis_jobs
     set status = 'failed',
         last_error = coalesce(nullif(p_error, ''), 'Analysis failed'),
         completed_at = v_completed_at,
         locked_at = null,
         lock_token = null,
         locked_by = null,
         updated_at = v_completed_at
   where id = p_job_id
     and status = current_job_status
     and (current_job_status <> 'running' or lock_token = p_lock_token);
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'analysis job failure state changed concurrently' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.fail_contract_analysis_job(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_contract_analysis_job(uuid, uuid, uuid, uuid, text) to service_role;

create or replace function public.complete_contract_review_decision_batch(
  p_batch_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_job_id uuid,
  p_lock_token uuid,
  p_outcomes jsonb,
  p_review_result jsonb,
  p_provider text,
  p_degraded boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_snapshot jsonb;
  batch_status text;
  batch_source_review_id uuid;
  batch_source_storage_path text;
  batch_source_hash text;
  batch_source_text_hash text;
  current_storage_path text;
  current_source_hash text;
  current_source_text_hash text;
  current_parsed_text_hash text;
  current_contract_status text;
  current_job_status text;
  current_lock_token uuid;
  snapshot jsonb;
  outcome_count integer;
  outcomes_valid boolean;
  outcome_resolved boolean;
  affected_rows integer;
  v_completed_at timestamptz := now();
begin
  if jsonb_typeof(p_outcomes) is distinct from 'array' then
    raise exception 'decision outcomes must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_typeof(p_review_result) is distinct from 'object' then
    raise exception 'review result must be a JSON object' using errcode = '22023';
  end if;

  select status, lock_token
    into current_job_status, current_lock_token
    from public.contract_analysis_jobs
   where id = p_job_id
     and contract_id = p_contract_id
     and review_id = p_review_id
   for update;
  if not found then
    raise exception 'contract analysis job was not found' using errcode = 'P0002';
  end if;
  select decision_snapshot, status, source_review_id, source_storage_path, source_hash, source_text_hash
    into batch_snapshot, batch_status, batch_source_review_id,
         batch_source_storage_path, batch_source_hash, batch_source_text_hash
    from public.contract_review_submission_batches
   where id = p_batch_id
     and contract_id = p_contract_id
     and new_review_id = p_review_id
     and analysis_job_id = p_job_id
   for update;
  if not found then
    raise exception 'active review submission batch was not found' using errcode = 'P0002';
  end if;

  if batch_status = 'completed' then
    if current_job_status <> 'completed'
       or not exists (
         select 1 from public.contracts
          where id = p_contract_id and status = 'COMPLETED'
       )
       or not exists (
         select 1 from public.contract_reviews
          where id = p_review_id and contract_id = p_contract_id and status = 'COMPLETED'
       ) then
      raise exception 'completed batch has inconsistent terminal state' using errcode = '23514';
    end if;
    return;
  end if;
  if batch_status <> 'review_running'
     or current_job_status <> 'running'
     or p_lock_token is null
     or current_lock_token is distinct from p_lock_token then
    raise exception 'review batch or analysis job is not active' using errcode = '55000';
  end if;
  if jsonb_typeof(batch_snapshot) is distinct from 'array' then
    raise exception 'decision snapshot must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_outcomes) <> jsonb_array_length(batch_snapshot) then
    raise exception 'decision outcomes must match the decision snapshot cardinality' using errcode = '23514';
  end if;

  select contracts.storage_path,
         contracts.status,
         page_maps.source_hash,
         page_maps.source_text_hash,
         pg_catalog.encode(
           extensions.digest(pg_catalog.convert_to(coalesce(contracts.parsed_text, ''), 'UTF8'), 'sha256'),
           'hex'
         )
    into current_storage_path, current_contract_status, current_source_hash,
         current_source_text_hash, current_parsed_text_hash
    from public.contracts
    join public.contract_source_page_maps as page_maps
      on page_maps.contract_id = contracts.id
     and page_maps.storage_path = contracts.storage_path
   where contracts.id = p_contract_id
   for update of contracts, page_maps;
  if not found
     or current_contract_status <> 'ANALYZING'
     or batch_source_storage_path is distinct from current_storage_path
     or batch_source_hash is distinct from current_source_hash
     or batch_source_text_hash is distinct from current_source_text_hash
     or batch_source_text_hash is distinct from current_parsed_text_hash then
    raise exception 'contract source identity changed before review completion' using errcode = '40001';
  end if;
  perform 1
    from public.contract_reviews
   where id = p_review_id
     and contract_id = p_contract_id
     and status = 'ANALYZING'
     and review_trigger = 'decision_batch'
     and parent_review_id = batch_source_review_id
     and source_storage_path = batch_source_storage_path
     and source_hash = batch_source_hash
     and source_text_hash = batch_source_text_hash
   for update;
  if not found then
    raise exception 'decision ReviewRun identity changed before completion' using errcode = '40001';
  end if;

  for snapshot in select value from jsonb_array_elements(batch_snapshot)
  loop
    if coalesce(snapshot->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(snapshot->>'risk_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(snapshot->'optimistic_version') is distinct from 'number'
       or (snapshot->>'optimistic_version')::numeric < 1
       or (snapshot->>'optimistic_version')::numeric > 2147483647
       or (snapshot->>'optimistic_version')::numeric <> trunc((snapshot->>'optimistic_version')::numeric) then
      raise exception 'decision snapshot identity is incomplete' using errcode = '22023';
    end if;

    select count(*),
           bool_and(
             jsonb_typeof(outcome) = 'object'
             and outcome->>'outcome' in ('resolved', 'still_open', 'needs_revision')
           ),
           bool_or(outcome->>'outcome' = 'resolved')
      into outcome_count, outcomes_valid, outcome_resolved
      from jsonb_array_elements(p_outcomes) as outcome
     where outcome->>'source_risk_id' = snapshot->>'risk_id';
    if outcome_count <> 1 or outcomes_valid is distinct from true then
      raise exception 'decision outcome is missing or duplicated for risk %', snapshot->>'risk_id' using errcode = '23514';
    end if;

    update public.contract_review_decision_drafts
       set status = case when outcome_resolved then 'batch_submitted' else 'draft_selected' end,
           workflow_state = case when outcome_resolved then 'REVIEW_PASSED' else 'NEEDS_REVISION' end,
           submission_batch_id = p_batch_id,
           submitted_at = v_completed_at,
           updated_at = v_completed_at
     where id = (snapshot->>'id')::uuid
       and contract_id = p_contract_id
       and review_id = batch_source_review_id
       and risk_id = (snapshot->>'risk_id')::uuid
       and source_storage_path = batch_source_storage_path
       and source_hash = batch_source_hash
       and source_text_hash = batch_source_text_hash
       and optimistic_version = (snapshot->>'optimistic_version')::integer
       and status = 'draft_selected';
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception 'decision draft version changed for risk %', snapshot->>'risk_id' using errcode = '40001';
    end if;
  end loop;

  update public.contract_review_submission_batches
     set status = 'completed', completed_at = v_completed_at
   where id = p_batch_id and status = 'review_running';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'review submission batch could not be completed' using errcode = '40001';
  end if;

  update public.contracts
     set status = 'COMPLETED', updated_at = v_completed_at
   where id = p_contract_id and status = 'ANALYZING';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract completion state changed concurrently' using errcode = '40001';
  end if;

  update public.contract_reviews
     set status = 'COMPLETED', results = p_review_result, completed_at = v_completed_at, updated_at = v_completed_at
   where id = p_review_id and contract_id = p_contract_id and status = 'ANALYZING';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'ReviewRun completion state changed concurrently' using errcode = '40001';
  end if;

  update public.contract_analysis_jobs
     set status = 'completed',
         provider = p_provider,
         degraded = p_degraded,
         completed_at = v_completed_at,
         locked_at = null,
         lock_token = null,
         locked_by = null,
         updated_at = v_completed_at
   where id = p_job_id and status = 'running' and lock_token = p_lock_token;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'analysis job completion state changed concurrently' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.complete_contract_review_decision_batch(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.complete_contract_review_decision_batch(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, boolean) to service_role;

create or replace function public.fail_contract_review_decision_batch(
  p_batch_id uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_job_id uuid,
  p_lock_token uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_snapshot jsonb;
  batch_status text;
  batch_source_review_id uuid;
  batch_source_storage_path text;
  batch_source_hash text;
  batch_source_text_hash text;
  current_job_status text;
  current_lock_token uuid;
  snapshot jsonb;
  affected_rows integer;
  v_completed_at timestamptz := now();
begin
  select status, lock_token
    into current_job_status, current_lock_token
    from public.contract_analysis_jobs
   where id = p_job_id
     and contract_id = p_contract_id
     and review_id = p_review_id
   for update;
  if not found then
    raise exception 'contract analysis job was not found' using errcode = 'P0002';
  end if;
  select decision_snapshot, status, source_review_id, source_storage_path, source_hash, source_text_hash
    into batch_snapshot, batch_status, batch_source_review_id,
         batch_source_storage_path, batch_source_hash, batch_source_text_hash
    from public.contract_review_submission_batches
   where id = p_batch_id
     and contract_id = p_contract_id
     and new_review_id = p_review_id
     and analysis_job_id = p_job_id
   for update;
  if not found then
    raise exception 'active review submission batch was not found' using errcode = 'P0002';
  end if;
  if batch_status = 'completed' or current_job_status = 'completed' then
    raise exception 'completed review batch cannot be downgraded to failed' using errcode = '55000';
  end if;
  if batch_status = 'failed' and current_job_status = 'failed' then
    if not exists (select 1 from public.contracts where id = p_contract_id and status = 'FAILED')
       or not exists (select 1 from public.contract_reviews where id = p_review_id and contract_id = p_contract_id and status = 'FAILED') then
      raise exception 'failed review batch has inconsistent terminal state' using errcode = '23514';
    end if;
    return;
  end if;
  if batch_status not in ('checking', 'review_running')
     or current_job_status <> 'running'
     or p_lock_token is null
     or current_lock_token is distinct from p_lock_token then
    raise exception 'review batch lease is no longer owned by this worker' using errcode = '55000';
  end if;
  if jsonb_typeof(batch_snapshot) is distinct from 'array' then
    raise exception 'decision snapshot must be a JSON array' using errcode = '22023';
  end if;

  for snapshot in select value from jsonb_array_elements(batch_snapshot)
  loop
    if coalesce(snapshot->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(snapshot->>'risk_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(snapshot->'optimistic_version') is distinct from 'number' then
      raise exception 'decision snapshot identity is incomplete' using errcode = '22023';
    end if;
    update public.contract_review_decision_drafts
       set workflow_state = 'NEEDS_REVISION', updated_at = v_completed_at
     where id = (snapshot->>'id')::uuid
       and contract_id = p_contract_id
       and review_id = batch_source_review_id
       and risk_id = (snapshot->>'risk_id')::uuid
       and source_storage_path = batch_source_storage_path
       and source_hash = batch_source_hash
       and source_text_hash = batch_source_text_hash
       and optimistic_version = (snapshot->>'optimistic_version')::integer
       and status = 'draft_selected';
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception 'decision draft version changed while failing risk %', snapshot->>'risk_id' using errcode = '40001';
    end if;
  end loop;

  delete from public.contract_review_decision_drafts where review_id = p_review_id;
  delete from public.contract_risk_cards where review_id = p_review_id;
  delete from public.contract_clauses where review_id = p_review_id;
  update public.contract_review_submission_batches
     set status = 'failed',
         conflict_report = jsonb_build_array(jsonb_build_object(
           'code', 'REVIEW_EXECUTION_FAILED',
           'message', coalesce(nullif(p_error, ''), 'Review execution failed')
         )),
         completed_at = v_completed_at
   where id = p_batch_id and status in ('checking', 'review_running');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'review submission batch failure state changed concurrently' using errcode = '40001';
  end if;
  update public.contract_reviews
     set status = 'FAILED',
         results = jsonb_build_object('error', coalesce(nullif(p_error, ''), 'Review execution failed')),
         risk_summary = null,
         compliance_check = null,
         effectiveness_analysis = null,
         completed_at = v_completed_at,
         updated_at = v_completed_at
   where id = p_review_id and contract_id = p_contract_id and status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'ReviewRun failure state changed concurrently' using errcode = '40001';
  end if;
  update public.contracts
     set status = 'FAILED', updated_at = v_completed_at
   where id = p_contract_id and status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract failure state changed concurrently' using errcode = '40001';
  end if;
  update public.contract_analysis_jobs
     set status = 'failed',
         last_error = coalesce(nullif(p_error, ''), 'Review execution failed'),
         completed_at = v_completed_at,
         locked_at = null,
         lock_token = null,
         locked_by = null,
         updated_at = v_completed_at
   where id = p_job_id and status = 'running' and lock_token = p_lock_token;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'analysis job lease changed while failing review batch' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.fail_contract_review_decision_batch(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_contract_review_decision_batch(uuid, uuid, uuid, uuid, uuid, text) to service_role;

create or replace function public.enforce_contract_annotation_source_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_storage_path text;
  current_source_hash text;
  current_source_text_hash text;
begin
  if new.source_anchor is null then
    if new.source_storage_path is not null or new.source_hash is not null or new.source_text_hash is not null then
      raise exception 'annotation identity requires a source anchor' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.contract_id is distinct from old.contract_id then
      raise exception 'legacy annotation contract identity is immutable' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.source_storage_path is null or new.source_hash is null or new.source_text_hash is null then
    raise exception 'anchored annotation requires source identity' using errcode = '23514';
  end if;

  select contracts.storage_path, page_maps.source_hash, page_maps.source_text_hash
    into current_storage_path, current_source_hash, current_source_text_hash
    from public.contracts
    join public.contract_source_page_maps as page_maps
      on page_maps.contract_id = contracts.id
     and page_maps.storage_path = contracts.storage_path
   where contracts.id = new.contract_id
   for share of contracts, page_maps;

  if current_storage_path is null or current_source_hash is null then
    raise exception 'current contract source identity is missing' using errcode = '23514';
  end if;
  if new.source_storage_path is distinct from current_storage_path
     or new.source_hash is distinct from current_source_hash
     or new.source_text_hash is distinct from current_source_text_hash then
    raise exception 'annotation source identity does not match current contract source' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_contract_annotation_source_identity() from public, anon, authenticated;
grant execute on function public.enforce_contract_annotation_source_identity() to service_role;

drop trigger if exists trg_contract_annotations_source_identity on public.contract_annotations;
create trigger trg_contract_annotations_source_identity
before insert or update of contract_id, source_anchor, source_storage_path, source_hash, source_text_hash
on public.contract_annotations
for each row execute function public.enforce_contract_annotation_source_identity();

alter table public.contract_source_page_maps
  drop constraint if exists contract_source_page_maps_render_mode_check;

alter table public.contract_source_page_maps
  add constraint contract_source_page_maps_render_mode_check
  check (render_mode in ('native-pdf', 'docx-to-pdf', 'word-to-pdf'));
