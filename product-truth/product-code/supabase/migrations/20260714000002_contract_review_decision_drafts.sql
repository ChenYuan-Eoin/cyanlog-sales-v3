-- G5: keep immutable risk facts separate from optimistic sales decision drafts.

create table if not exists public.contract_review_submission_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  source_review_id uuid not null references public.contract_reviews(id) on delete cascade,
  new_review_id uuid references public.contract_reviews(id) on delete set null,
  submitted_by uuid not null references public.users(id) on delete restrict,
  review_style text not null check (review_style in ('lenient', 'balanced', 'strict')),
  status text not null default 'checking' check (status in ('checking', 'conflict', 'review_running', 'completed', 'failed')),
  decision_snapshot jsonb not null default '[]'::jsonb,
  conflict_report jsonb not null default '[]'::jsonb,
  rule_bundle_id uuid references public.contract_skill_bundles(id) on delete set null,
  rule_bundle_version integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.contract_review_decision_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  review_id uuid not null references public.contract_reviews(id) on delete cascade,
  risk_id uuid not null references public.contract_risk_cards(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete cascade,
  status text not null default 'draft_selected' check (status in ('draft_selected', 'batch_submitted')),
  decision_kind text not null check (decision_kind in ('rule_option', 'customer_agreed', 'customer_feedback', 'exception_requested')),
  selected_option_id text,
  selected_option_snapshot jsonb,
  feedback text,
  comment_preview text,
  source_anchor jsonb not null default '{}'::jsonb,
  rule_bundle_id uuid references public.contract_skill_bundles(id) on delete set null,
  rule_bundle_version integer,
  submission_batch_id uuid references public.contract_review_submission_batches(id) on delete set null,
  optimistic_version integer not null default 1,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, risk_id, created_by)
);

create index if not exists idx_contract_review_decision_drafts_workbench
  on public.contract_review_decision_drafts(contract_id, review_id, created_by, status);

create index if not exists idx_contract_review_submission_batches_contract
  on public.contract_review_submission_batches(contract_id, created_at desc);

alter table public.contract_review_decision_drafts enable row level security;
alter table public.contract_review_submission_batches enable row level security;

revoke all on table public.contract_review_decision_drafts from anon, authenticated;
revoke all on table public.contract_review_submission_batches from anon, authenticated;
grant all on table public.contract_review_decision_drafts to service_role;
grant all on table public.contract_review_submission_batches to service_role;
