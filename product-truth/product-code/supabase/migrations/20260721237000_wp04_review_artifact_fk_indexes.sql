begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Review artifacts are read and removed by immutable source version as well as
-- by ReviewRun. Cover every review/version foreign key so a version deletion or
-- version-scoped audit does not degrade into a full artifact-table scan.
create index if not exists idx_ask_items_contract_version
  on public.ask_items(contract_version_id)
  where contract_version_id is not null;

create index if not exists idx_report_versions_contract_version
  on public.report_versions(contract_version_id)
  where contract_version_id is not null;

commit;
