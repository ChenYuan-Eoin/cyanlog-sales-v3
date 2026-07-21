begin;

-- Forward reconciliation for Preview databases that had already applied the
-- source-ingestion migration before the duplicate-index cleanup was added.
drop index if exists public.idx_contract_analysis_jobs_start_request;

commit;
