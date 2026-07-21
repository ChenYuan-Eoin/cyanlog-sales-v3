begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A source version may be reviewed more than once. Negotiation tasks from an
-- older run stay auditable, but they must become immutable once a newer run is
-- current. The contract row lock serializes this decision with the official
-- ReviewRun start RPC, which also locks the contract before creating a run.
create or replace function public.enforce_current_review_ask_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_version_id uuid;
  latest_review_id uuid;
begin
  if new.binding_state is distinct from 'bound' then
    return new;
  end if;

  select contract.current_version_id
    into current_version_id
    from public.contracts as contract
   where contract.id = new.contract_id
   for share;

  if not found
     or current_version_id is distinct from new.contract_version_id then
    raise exception 'ASK mutation requires the current contract source version'
      using errcode = '23514';
  end if;

  select review.id
    into latest_review_id
    from public.contract_reviews as review
   where review.contract_id = new.contract_id
     and review.contract_version_id = new.contract_version_id
   order by review.created_at desc nulls last, review.id desc
   limit 1;

  if latest_review_id is null
     or latest_review_id is distinct from new.review_id then
    raise exception 'ASK mutation requires the latest review for the current source version'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

revoke all on function public.enforce_current_review_ask_mutation()
  from public, anon, authenticated;
grant execute on function public.enforce_current_review_ask_mutation()
  to service_role;

drop trigger if exists trg_ask_items_current_review_mutation
  on public.ask_items;
create trigger trg_ask_items_current_review_mutation
before insert or update of
  status,
  response_id,
  closed_by,
  closed_reason,
  review_id,
  contract_version_id,
  binding_state
on public.ask_items
for each row execute function public.enforce_current_review_ask_mutation();

commit;
