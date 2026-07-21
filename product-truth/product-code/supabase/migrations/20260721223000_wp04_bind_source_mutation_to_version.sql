-- A new source file may legitimately have the same extracted body text as its
-- parent (for example, a DOCX that only adds native comments). Bind source
-- mutations to a new ContractVersion instead of erasing equal parsed text.

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
    raise exception 'contract source is locked by an active review submission batch'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from public.contract_analysis_jobs
     where contract_id = old.id
       and status in ('preparing', 'queued', 'running')
  ) then
    raise exception 'contract source is locked by an active analysis job'
      using errcode = '55000';
  end if;

  -- Source identity changes must be committed together with a new immutable
  -- version. Equal extracted text is valid: comments, revisions, macros and
  -- package metadata can change without changing the current Word body.
  if new.current_version_id is not distinct from old.current_version_id then
    raise exception 'contract source mutation requires a new current version'
      using errcode = '23514';
  end if;

  new.status := 'PENDING';
  new.conclusion := 'PENDING';
  new.conclusion_reason := null;
  new.concluded_at := null;
  new.concluded_by := null;
  return new;
end;
$$;

revoke all on function public.prevent_active_review_source_mutation()
  from public, anon, authenticated;
grant execute on function public.prevent_active_review_source_mutation()
  to service_role;
