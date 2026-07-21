-- WP04: a browser retry must recover the same contract after an ambiguous
-- create response. The identity is scoped to organization and requester so a
-- token or request ID can never recover another tenant's contract.

alter table public.contracts
  add column if not exists client_request_id uuid;

create unique index if not exists uq_contracts_creation_request
  on public.contracts(org_id, created_by, client_request_id)
  where client_request_id is not null;
