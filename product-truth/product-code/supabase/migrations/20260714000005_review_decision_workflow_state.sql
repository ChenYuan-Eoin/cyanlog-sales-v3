-- G5: explicit decision workflow and extensible evidence anchors.

alter table public.contract_review_decision_drafts
  add column if not exists evidence_anchors jsonb not null default '[]'::jsonb,
  add column if not exists workflow_state text not null default 'OPEN';

update public.contract_review_decision_drafts
   set evidence_anchors = case
         when source_anchor is null then '[]'::jsonb
         else jsonb_build_array(source_anchor)
       end
 where evidence_anchors = '[]'::jsonb;

update public.contract_review_decision_drafts
   set workflow_state = case
     when status = 'batch_submitted' then 'REVIEW_PASSED'
     when coalesce(resolution_strategy_id, selected_option_id) is not null
      and coalesce(negotiation_result, decision_kind) is not null
      and (
        coalesce(negotiation_result, decision_kind) not in ('customer_feedback', 'exception_requested')
        or nullif(trim(feedback), '') is not null
      ) then 'DRAFT_READY'
     when coalesce(resolution_strategy_id, selected_option_id) is not null then 'STRATEGY_SELECTED'
     when coalesce(negotiation_result, decision_kind) is not null then 'RESULT_RECORDED'
     else 'OPEN'
   end;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'contract_review_decision_drafts_workflow_state_check'
  ) then
    alter table public.contract_review_decision_drafts
      add constraint contract_review_decision_drafts_workflow_state_check
      check (workflow_state in (
        'OPEN', 'STRATEGY_SELECTED', 'RESULT_RECORDED', 'DRAFT_READY',
        'REVIEW_QUEUED', 'REVIEW_PASSED', 'NEEDS_REVISION'
      ));
  end if;
end $$;
