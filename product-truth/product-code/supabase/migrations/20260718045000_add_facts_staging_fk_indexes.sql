set lock_timeout = '5s';
set statement_timeout = '60s';

-- Cover every foreign-key column set introduced or retained by facts staging.
-- This is a forward-only performance fix for the already-applied 044 migration;
-- it does not change data, permissions, runtime state, or release channels.
create index if not exists idx_contract_review_adjudications_fact_chunk_run
  on public.contract_review_adjudications(fact_chunk_id, fact_run_id);

create index if not exists idx_contract_review_adjudications_suppressed_rule_snapshot
  on public.contract_review_adjudications(suppressed_by_rule_snapshot_id);

create index if not exists idx_contract_review_rule_coverages_chunk_run
  on public.contract_review_rule_coverages(fact_chunk_id, run_id);
