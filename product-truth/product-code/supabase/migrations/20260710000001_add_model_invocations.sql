-- Migration: model_invocations 调用证据表对齐
-- Date: 2026-07-10
-- PURPOSE: 记录模型 / 规则引擎调用、降级、耗时和 token 摘要。
-- NOTE: 该结构对齐线上现有 public.model_invocations，不再另造 provider_key/token 列。

create table if not exists model_invocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete set null,
  contract_id uuid references contracts(id) on delete cascade,
  review_id uuid references contract_reviews(id) on delete cascade,
  skill_bundle_id uuid references contract_skill_bundles(id) on delete set null,
  model_policy_id uuid references model_policies(id) on delete set null,
  provider text not null,
  model text not null,
  phase text not null,
  status text not null
    check (status = any (array['queued', 'running', 'completed', 'failed', 'degraded'])),
  degraded boolean not null default false,
  fallback_reason text,
  latency_ms integer,
  request_meta jsonb not null default '{}'::jsonb,
  response_meta jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_model_invocations_contract_created_at
  on model_invocations(contract_id, created_at desc);

create index if not exists idx_model_invocations_review_created_at
  on model_invocations(review_id, created_at desc);

create index if not exists idx_model_invocations_phase_created_at
  on model_invocations(phase, created_at desc);

alter table model_invocations enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'model_invocations'
      and policyname = 'Same org reads model_invocations'
  ) then
    create policy "Same org reads model_invocations" on model_invocations
      for select
      using (
        org_id is null
        or exists (
          select 1
          from user_organizations uo
          where uo.org_id = model_invocations.org_id
            and uo.user_id = auth.uid()
        )
      );
  end if;
end
$$;
