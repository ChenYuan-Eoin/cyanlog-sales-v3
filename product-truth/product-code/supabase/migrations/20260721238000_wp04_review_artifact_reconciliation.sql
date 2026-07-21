begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Production migration order is intentional.  230000 added ReviewRun identity
-- and performed the legacy singleton backfill; 238000 reconciles its one unsafe
-- branch and replaces the 231000 publisher before 239000 adds the current-review
-- ASK mutation guard.  No application write can rely on the mistaken binding in
-- a clean Production migration chain.

-- 230000 treated "one version-bound review" as "one review in the contract".
-- That is only safe when every ReviewRun is counted and the total is exactly one.
-- The only wrongly modified population is therefore all_reviews > 1 while the
-- old filter saw bound_reviews = 1.  Reports are released before their ASK owner
-- so the trigger link remains auditable throughout this one-time reconciliation.
with review_counts as (
  select review.contract_id,
         count(*)::integer as all_reviews,
         count(*) filter (
           where review.contract_version_id is not null
         )::integer as bound_reviews,
         (
           array_agg(review.id order by review.created_at nulls last, review.id)
           filter (where review.contract_version_id is not null)
         )[1] as sole_bound_review_id,
         (
           array_agg(
             review.contract_version_id
             order by review.created_at nulls last, review.id
           ) filter (where review.contract_version_id is not null)
         )[1] as sole_bound_version_id
    from public.contract_reviews as review
   where review.contract_id is not null
   group by review.contract_id
)
update public.report_versions as report
   set review_id = null,
       contract_version_id = null,
       binding_state = 'legacy_unbound'
  from review_counts as counts
 where counts.all_reviews > 1
   and counts.bound_reviews = 1
   and report.contract_id = counts.contract_id
   and report.review_id = counts.sole_bound_review_id
   and report.contract_version_id = counts.sole_bound_version_id
   and report.binding_state = 'bound';

with review_counts as (
  select review.contract_id,
         count(*)::integer as all_reviews,
         count(*) filter (
           where review.contract_version_id is not null
         )::integer as bound_reviews,
         (
           array_agg(review.id order by review.created_at nulls last, review.id)
           filter (where review.contract_version_id is not null)
         )[1] as sole_bound_review_id,
         (
           array_agg(
             review.contract_version_id
             order by review.created_at nulls last, review.id
           ) filter (where review.contract_version_id is not null)
         )[1] as sole_bound_version_id
    from public.contract_reviews as review
   where review.contract_id is not null
   group by review.contract_id
)
update public.ask_items as ask
   set review_id = null,
       contract_version_id = null,
       binding_state = 'legacy_unbound'
  from review_counts as counts
 where counts.all_reviews > 1
   and counts.bound_reviews = 1
   and ask.contract_id = counts.contract_id
   and ask.review_id = counts.sole_bound_review_id
   and ask.contract_version_id = counts.sole_bound_version_id
   and ask.binding_state = 'bound';

-- Preserve the artifact rows while removing references that were accepted
-- before review-scoped identity existed.  A clause reference is meaningful
-- only inside the annotation's contract and ReviewRun.  A report trigger is
-- meaningful only when its ASK carries the same complete bound identity.
update public.contract_annotations as annotation
   set clause_id = null,
       updated_at = pg_catalog.clock_timestamp()
 where annotation.clause_id is not null
   and not exists (
     select 1
       from public.contract_clauses as clause
      where clause.id = annotation.clause_id
        and clause.contract_id = annotation.contract_id
        and clause.review_id = annotation.review_id
   );

update public.report_versions as report
   set trigger_ask_id = null
 where report.trigger_ask_id is not null
   and not exists (
     select 1
       from public.ask_items as ask
      where ask.id = report.trigger_ask_id
        and report.binding_state = 'bound'
        and ask.binding_state = 'bound'
        and ask.contract_id = report.contract_id
        and ask.review_id = report.review_id
        and ask.contract_version_id = report.contract_version_id
   );

create or replace function public.enforce_review_artifact_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  owner_contract_id uuid;
  owner_version_id uuid;
  artifact_reference_id uuid;
begin
  if new.binding_state = 'legacy_unbound' then
    if new.review_id is not null or new.contract_version_id is not null then
      raise exception 'legacy review artifact must remain unbound'
        using errcode = '23514';
    end if;
  elsif new.binding_state = 'bound' then
    if new.review_id is null or new.contract_version_id is null then
      raise exception 'review artifact identity is required'
        using errcode = '23514';
    end if;

    select review.contract_id, review.contract_version_id
      into owner_contract_id, owner_version_id
      from public.contract_reviews as review
     where review.id = new.review_id;

    if not found
       or owner_contract_id is distinct from new.contract_id
       or owner_version_id is distinct from new.contract_version_id then
      raise exception 'review artifact identity crosses contract or source version'
        using errcode = '23514';
    end if;
  else
    raise exception 'review artifact identity is required'
      using errcode = '23514';
  end if;

  if tg_table_schema = 'public'
     and tg_table_name = 'contract_annotations' then
    artifact_reference_id := nullif(
      pg_catalog.to_jsonb(new)->>'clause_id',
      ''
    )::uuid;
  else
    artifact_reference_id := null;
  end if;

  if artifact_reference_id is not null then
    perform 1
      from public.contract_clauses as clause
     where clause.id = artifact_reference_id
       and clause.contract_id = new.contract_id
       and clause.review_id = new.review_id;
    if not found then
      raise exception 'annotation clause must belong to the same contract and ReviewRun'
        using errcode = '23514';
    end if;
  end if;

  if tg_table_schema = 'public'
     and tg_table_name = 'report_versions' then
    artifact_reference_id := nullif(
      pg_catalog.to_jsonb(new)->>'trigger_ask_id',
      ''
    )::uuid;
  else
    artifact_reference_id := null;
  end if;

  if artifact_reference_id is not null then
    perform 1
      from public.ask_items as ask
     where ask.id = artifact_reference_id
       and ask.binding_state = 'bound'
       and ask.contract_id = new.contract_id
       and ask.review_id = new.review_id
       and ask.contract_version_id = new.contract_version_id;
    if not found then
      raise exception 'report trigger ASK must share the bound contract, ReviewRun and source version'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$function$;

revoke all on function public.enforce_review_artifact_binding()
  from public, anon, authenticated;
grant execute on function public.enforce_review_artifact_binding()
  to service_role;

drop trigger if exists trg_contract_annotations_review_binding
  on public.contract_annotations;
create trigger trg_contract_annotations_review_binding
before insert or update of
  contract_id,
  review_id,
  contract_version_id,
  binding_state,
  clause_id
on public.contract_annotations
for each row execute function public.enforce_review_artifact_binding();

drop trigger if exists trg_ask_items_review_binding
  on public.ask_items;
create trigger trg_ask_items_review_binding
before insert or update of contract_id, review_id, contract_version_id, binding_state
on public.ask_items
for each row execute function public.enforce_review_artifact_binding();

drop trigger if exists trg_report_versions_review_binding
  on public.report_versions;
create trigger trg_report_versions_review_binding
before insert or update of
  contract_id,
  review_id,
  contract_version_id,
  binding_state,
  trigger_ask_id
on public.report_versions
for each row execute function public.enforce_review_artifact_binding();

-- Replace the 231000 publisher forward.  Generated risk annotations are an
-- analysis artifact and may be replaced.  Human/non-risk annotations are user
-- records: detach their obsolete generated clause reference before clauses are
-- deleted so the legacy ON DELETE CASCADE foreign key cannot erase them.
create or replace function public.publish_contract_analysis_artifacts_fenced(
  p_job_id uuid,
  p_lock_token uuid,
  p_contract_id uuid,
  p_review_id uuid,
  p_risk_rows jsonb,
  p_annotation_rows jsonb,
  p_clause_rows jsonb,
  p_review_patch jsonb,
  p_provider text,
  p_degraded boolean,
  p_result jsonb
)
returns setof public.contract_analysis_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  leased_job public.contract_analysis_jobs%rowtype;
  current_contract public.contracts%rowtype;
  current_review public.contract_reviews%rowtype;
  current_version public.contract_versions%rowtype;
  current_page_map public.contract_source_page_maps%rowtype;
  updated_job public.contract_analysis_jobs%rowtype;
  artifact_version_id uuid;
  affected_rows integer;
  now_value timestamptz := pg_catalog.clock_timestamp();
begin
  if p_job_id is null or p_lock_token is null or p_contract_id is null
     or p_review_id is null
     or p_degraded is null
     or p_result is null or pg_catalog.jsonb_typeof(p_result) <> 'object'
     or p_review_patch is null or pg_catalog.jsonb_typeof(p_review_patch) <> 'object'
     or coalesce(pg_catalog.jsonb_typeof(p_risk_rows), 'array') <> 'array'
     or coalesce(pg_catalog.jsonb_typeof(p_annotation_rows), 'array') <> 'array'
     or coalesce(pg_catalog.jsonb_typeof(p_clause_rows), 'array') <> 'array' then
    raise exception 'complete fenced analysis artifact payload is required'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from pg_catalog.jsonb_to_recordset(
        coalesce(p_annotation_rows, '[]'::jsonb)
      ) as annotation(category text, author_id uuid)
     where annotation.category is distinct from 'risk_finding'
        or annotation.author_id is not null
  ) then
    raise exception 'analysis publication accepts only generated risk_finding annotations'
      using errcode = '23514';
  end if;

  select job.*
    into leased_job
    from public.contract_analysis_jobs as job
   where job.id = p_job_id
     and job.contract_id = p_contract_id
     and job.review_id = p_review_id
     and job.status = 'running'
     and job.lock_token = p_lock_token
   for update;
  if not found then
    return;
  end if;

  select review.*
    into current_review
    from public.contract_reviews as review
   where review.id = p_review_id
     and review.contract_id = p_contract_id
   for update;
  if not found
     or current_review.contract_version_id is null
     or current_review.status not in ('PARSING', 'ANALYZING') then
    raise exception 'review source or state changed outside the active analysis lease'
      using errcode = '55000';
  end if;
  artifact_version_id := current_review.contract_version_id;

  select contract.*
    into current_contract
    from public.contracts as contract
   where contract.id = p_contract_id
   for update;
  if not found
     or current_contract.current_version_id is distinct from artifact_version_id
     or current_contract.status not in ('PARSING', 'ANALYZING') then
    raise exception 'contract source or state changed outside the active analysis lease'
      using errcode = '55000';
  end if;

  select version.*
    into current_version
    from public.contract_versions as version
   where version.id = artifact_version_id
     and version.contract_id = p_contract_id
     and version.ingest_status = 'SOURCE_READY'
   for share;
  if not found
     or current_version.storage_path is distinct from current_review.source_storage_path
     or current_version.file_sha256 is distinct from current_review.source_hash
     or current_version.text_sha256 is distinct from current_review.source_text_hash then
    raise exception 'review source identity no longer matches its source version'
      using errcode = '23514';
  end if;

  select page_map.*
    into current_page_map
    from public.contract_source_page_maps as page_map
   where page_map.contract_id = p_contract_id
     and page_map.contract_version_id = artifact_version_id
     and page_map.storage_path = current_version.storage_path
     and page_map.source_hash = current_version.file_sha256
     and page_map.source_text_hash = current_version.text_sha256
   for share;
  if not found then
    raise exception 'review source page map is missing or stale'
      using errcode = '23514';
  end if;

  update public.contract_annotations as annotation
     set clause_id = null,
         updated_at = now_value
   where annotation.review_id = p_review_id
     and annotation.contract_version_id = artifact_version_id
     and annotation.clause_id is not null
     and (
       annotation.category is distinct from 'risk_finding'
       or annotation.author_id is not null
     );

  delete from public.contract_annotations as annotation
   where annotation.review_id = p_review_id
     and annotation.contract_version_id = artifact_version_id
     and annotation.category = 'risk_finding'
     and annotation.author_id is null;
  delete from public.contract_risk_cards where review_id = p_review_id;
  delete from public.contract_clauses where review_id = p_review_id;

  insert into public.contract_risk_cards (
    id, review_id, contract_id, rule_id, rule_code, rule_version, level,
    title, description, suggestion, auto_fixable, detected_by, confidence,
    evidence, status, clause_ref, position_start, position_end
  )
  select row.id, p_review_id, p_contract_id, row.rule_id, row.rule_code,
         row.rule_version, row.level, row.title, row.description,
         row.suggestion, row.auto_fixable, row.detected_by, row.confidence,
         row.evidence, row.status, row.clause_ref, row.position_start,
         row.position_end
    from pg_catalog.jsonb_to_recordset(coalesce(p_risk_rows, '[]'::jsonb)) as row(
      id uuid,
      rule_id uuid,
      rule_code text,
      rule_version integer,
      level text,
      title text,
      description text,
      suggestion text,
      auto_fixable boolean,
      detected_by text,
      confidence numeric,
      evidence jsonb,
      status text,
      clause_ref text,
      position_start integer,
      position_end integer
    );

  insert into public.contract_annotations (
    id, contract_id, review_id, contract_version_id, binding_state,
    start_offset, end_offset, selected_text, comment, category, priority,
    status, author_id
  )
  select row.id, p_contract_id, p_review_id, artifact_version_id, 'bound',
         row.start_offset, row.end_offset, row.selected_text, row.comment,
         row.category, row.priority, row.status, row.author_id
    from pg_catalog.jsonb_to_recordset(coalesce(p_annotation_rows, '[]'::jsonb)) as row(
      id uuid,
      start_offset integer,
      end_offset integer,
      selected_text text,
      comment text,
      category text,
      priority text,
      status text,
      author_id uuid
    )
   where row.category = 'risk_finding'
     and row.author_id is null;

  insert into public.contract_clauses (
    id, review_id, contract_id, clause_number, clause_title, clause_text,
    risk_level, risk_category, risk_description, legal_basis, suggestion,
    suggested_text, matched_library_clause_id, position, start_offset,
    end_offset
  )
  select row.id, p_review_id, p_contract_id, row.clause_number,
         row.clause_title, row.clause_text, row.risk_level,
         row.risk_category, row.risk_description, row.legal_basis,
         row.suggestion, row.suggested_text, row.matched_library_clause_id,
         row.position, row.start_offset, row.end_offset
    from pg_catalog.jsonb_to_recordset(coalesce(p_clause_rows, '[]'::jsonb)) as row(
      id uuid,
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

  update public.contract_reviews as review
     set strategy_id = nullif(p_review_patch->>'strategy_id', '')::uuid,
         risk_summary = p_review_patch->'risk_summary',
         compliance_check = p_review_patch->'compliance_check',
         effectiveness_analysis = p_review_patch->>'effectiveness_analysis',
         report_version = coalesce((p_review_patch->>'report_version')::integer, 2),
         skill_bundle_id = nullif(p_review_patch->>'skill_bundle_id', '')::uuid,
         model_policy_id = nullif(p_review_patch->>'model_policy_id', '')::uuid,
         plan_snapshot_id = nullif(p_review_patch->>'plan_snapshot_id', '')::uuid,
         rule_snapshot_ids = coalesce(
           array(select value::uuid from pg_catalog.jsonb_array_elements_text(
             coalesce(p_review_patch->'rule_snapshot_ids', '[]'::jsonb)
           ) as value),
           '{}'::uuid[]
         ),
         rule_set_snapshot_ids = coalesce(
           array(select value::uuid from pg_catalog.jsonb_array_elements_text(
             coalesce(p_review_patch->'rule_set_snapshot_ids', '[]'::jsonb)
           ) as value),
           '{}'::uuid[]
         ),
         rule_set_document_ids = coalesce(
           array(select value::uuid from pg_catalog.jsonb_array_elements_text(
             coalesce(p_review_patch->'rule_set_document_ids', '[]'::jsonb)
           ) as value),
           '{}'::uuid[]
         ),
         model_invocation_ids = coalesce(
           array(select value::uuid from pg_catalog.jsonb_array_elements_text(
             coalesce(p_review_patch->'model_invocation_ids', '[]'::jsonb)
           ) as value),
           '{}'::uuid[]
         ),
         review_trigger = nullif(p_review_patch->>'review_trigger', ''),
         status = case when p_degraded then 'DEGRADED' else 'COMPLETED' end,
         results = p_result,
         completed_at = now_value,
         updated_at = now_value
   where review.id = p_review_id
     and review.contract_id = p_contract_id
     and review.contract_version_id = artifact_version_id
     and review.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'review state changed during artifact publication'
      using errcode = '55000';
  end if;

  update public.contracts as contract
     set status = 'COMPLETED', updated_at = now_value
   where contract.id = p_contract_id
     and contract.current_version_id = artifact_version_id
     and contract.status in ('PARSING', 'ANALYZING');
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'contract state changed during artifact publication'
      using errcode = '55000';
  end if;

  update public.contract_analysis_jobs as job
     set status = 'completed',
         provider = coalesce(nullif(pg_catalog.btrim(p_provider), ''), job.provider),
         degraded = p_degraded,
         last_error = null,
         completed_at = now_value,
         locked_at = null,
         lock_token = null,
         locked_by = null,
         updated_at = now_value
   where job.id = p_job_id
     and job.contract_id = p_contract_id
     and job.review_id = p_review_id
     and job.status = 'running'
     and job.lock_token = p_lock_token
  returning job.* into updated_job;
  if not found then
    raise exception 'analysis lease changed during artifact publication'
      using errcode = '55000';
  end if;

  return next updated_job;
end
$function$;

revoke all on function public.publish_contract_analysis_artifacts_fenced(
  uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.publish_contract_analysis_artifacts_fenced(
  uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, boolean, jsonb
) to service_role;

commit;
