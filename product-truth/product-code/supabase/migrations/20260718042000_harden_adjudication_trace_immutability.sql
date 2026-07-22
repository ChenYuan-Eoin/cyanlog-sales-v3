set lock_timeout = '5s';
set statement_timeout = '30s';

-- The review runtime uses one-based chunk indices (`1/1` for a single chunk).
-- The initial trace constraint accidentally encoded a zero-based upper bound.
alter table public.contract_review_adjudications
  drop constraint if exists contract_review_adjudications_chunk_check,
  add constraint contract_review_adjudications_chunk_check check (
    (
      source_chunk_index is null
      and source_chunk_total is null
      and source_chunk_start is null
      and source_chunk_end is null
      and source_chunk_hash is null
    ) or (
      source_chunk_index >= 1
      and source_chunk_total > 0
      and source_chunk_index <= source_chunk_total
      and source_chunk_start >= 0
      and source_chunk_end > source_chunk_start
      and source_chunk_hash is not null
      and source_start >= source_chunk_start
      and source_end <= source_chunk_end
    )
  );

-- Adjudication rows are an append-only audit surface. Even service-role code
-- may insert and read them, but cannot rewrite or delete a prior decision.
revoke all on table public.contract_review_adjudications from service_role;
grant select, insert on table public.contract_review_adjudications to service_role;

create or replace function public.reject_contract_review_adjudication_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'ADJUDICATION_TRACE_IMMUTABLE' using errcode = '55000';
end;
$function$;

drop trigger if exists trg_reject_contract_review_adjudication_mutation_v1
  on public.contract_review_adjudications;
create trigger trg_reject_contract_review_adjudication_mutation_v1
  before update or delete on public.contract_review_adjudications
  for each row execute function public.reject_contract_review_adjudication_mutation_v1();

revoke all on function public.reject_contract_review_adjudication_mutation_v1()
  from public, anon, authenticated;
grant execute on function public.reject_contract_review_adjudication_mutation_v1()
  to service_role;
