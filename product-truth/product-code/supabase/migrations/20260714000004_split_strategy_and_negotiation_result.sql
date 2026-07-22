-- G5: persist legal resolution strategy and sales negotiation result as two distinct layers.

alter table public.contract_review_decision_drafts
  add column if not exists resolution_strategy_id text,
  add column if not exists resolution_strategy_snapshot jsonb,
  add column if not exists negotiation_result text,
  add column if not exists translation_input_snapshot jsonb,
  add column if not exists revision_text text;

update public.contract_review_decision_drafts
   set resolution_strategy_id = coalesce(resolution_strategy_id, selected_option_id),
       resolution_strategy_snapshot = coalesce(resolution_strategy_snapshot, selected_option_snapshot),
       negotiation_result = coalesce(negotiation_result, decision_kind)
 where resolution_strategy_id is null
    or resolution_strategy_snapshot is null
    or negotiation_result is null;

alter table public.contract_review_decision_drafts
  alter column decision_kind drop not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'contract_review_decision_drafts_negotiation_result_check'
  ) then
    alter table public.contract_review_decision_drafts
      add constraint contract_review_decision_drafts_negotiation_result_check
      check (negotiation_result is null or negotiation_result in ('customer_agreed', 'customer_feedback', 'exception_requested'));
  end if;
end $$;
