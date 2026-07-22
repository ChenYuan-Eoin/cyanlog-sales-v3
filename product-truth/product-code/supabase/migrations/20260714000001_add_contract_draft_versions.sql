-- G4/G7: contract draft task cards and exports must use persisted versions.

alter table public.contract_drafts
  add column if not exists version_number integer not null default 1,
  add column if not exists generated_filename text,
  add column if not exists generated_mime_type text,
  add column if not exists generated_storage_path text,
  add column if not exists submitted_contract_id uuid references public.contracts(id) on delete set null;

alter table public.contract_drafts
  drop constraint if exists contract_drafts_version_number_check;

alter table public.contract_drafts
  add constraint contract_drafts_version_number_check check (version_number > 0);

create index if not exists idx_contract_drafts_version
  on public.contract_drafts(org_id, created_by, version_number desc);
