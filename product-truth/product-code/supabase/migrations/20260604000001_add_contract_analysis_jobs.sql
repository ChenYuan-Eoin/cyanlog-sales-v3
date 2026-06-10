-- Migration: 合同审核任务队列表
-- Date: 2026-06-04
-- PURPOSE: 将合同审核从 fire-and-forget 改为可恢复、可观测的持久化任务

create table if not exists contract_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id) on delete cascade,
  review_id uuid not null references contract_reviews(id) on delete cascade,
  requested_by uuid references users(id),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  attempts integer not null default 0,
  provider text,
  degraded boolean not null default false,
  last_error text,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (review_id)
);

create index if not exists idx_contract_analysis_jobs_status_created_at
  on contract_analysis_jobs(status, created_at asc);

create index if not exists idx_contract_analysis_jobs_contract_id
  on contract_analysis_jobs(contract_id);

create index if not exists idx_contract_analysis_jobs_review_id
  on contract_analysis_jobs(review_id);

drop trigger if exists update_contract_analysis_jobs_updated_at on contract_analysis_jobs;
create trigger update_contract_analysis_jobs_updated_at
  before update on contract_analysis_jobs
  for each row
  execute function update_updated_at_column();

alter table contract_analysis_jobs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'contract_analysis_jobs'
      and policyname = 'Owner reads contract_analysis_jobs'
  ) then
    create policy "Owner reads contract_analysis_jobs" on contract_analysis_jobs
      for select
      using (
        contract_id in (
          select id from contracts where created_by = auth.uid()
        )
      );
  end if;
end
$$;

create or replace function claim_contract_analysis_job(
  p_worker_id text,
  p_stale_after interval default interval '15 minutes'
)
returns setof contract_analysis_jobs
language plpgsql
security definer
as $$
declare
  v_job contract_analysis_jobs%rowtype;
begin
  update contract_analysis_jobs
     set status = 'queued',
         locked_at = null,
         last_error = coalesce(last_error, 'Recovered from stale lock'),
         updated_at = now()
   where status = 'running'
     and locked_at is not null
     and locked_at < now() - p_stale_after;

  select *
    into v_job
    from contract_analysis_jobs
   where status = 'queued'
   order by created_at asc
   for update skip locked
   limit 1;

  if not found then
    return;
  end if;

  update contract_analysis_jobs
     set status = 'running',
         attempts = attempts + 1,
         locked_at = now(),
         started_at = coalesce(started_at, now()),
         last_error = null,
         provider = coalesce(provider, p_worker_id),
         updated_at = now()
   where id = v_job.id
   returning *
    into v_job;

  return next v_job;
end;
$$;
