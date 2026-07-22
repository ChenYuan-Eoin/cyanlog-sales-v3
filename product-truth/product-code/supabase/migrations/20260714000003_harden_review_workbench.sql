-- G5 hardening: rendered page maps, explicit sales intent, concurrency-safe notes, async job evidence.

alter table public.contract_review_decision_drafts
  add column if not exists internal_note text,
  add column if not exists customer_comment text;

update public.contract_review_decision_drafts
   set decision_kind = 'customer_feedback',
       internal_note = coalesce(internal_note, '历史 rule_option 草稿，需销售重新确认处理意图')
 where decision_kind = 'rule_option';

alter table public.contract_review_decision_drafts
  drop constraint if exists contract_review_decision_drafts_decision_kind_check;

alter table public.contract_review_decision_drafts
  add constraint contract_review_decision_drafts_decision_kind_check
  check (decision_kind in ('customer_agreed', 'customer_feedback', 'exception_requested'));

alter table public.contract_review_submission_batches
  add column if not exists analysis_job_id uuid references public.contract_analysis_jobs(id) on delete set null;

create table if not exists public.contract_source_page_maps (
  contract_id uuid primary key references public.contracts(id) on delete cascade,
  storage_path text not null,
  source_hash text not null,
  render_mode text not null check (render_mode in ('native-pdf', 'docx-to-pdf')),
  page_count integer not null check (page_count > 0),
  locator text not null check (locator in ('rendered', 'provisional')),
  page_map jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now()
);

alter table public.contract_source_page_maps enable row level security;
revoke all on table public.contract_source_page_maps from anon, authenticated;
grant all on table public.contract_source_page_maps to service_role;
