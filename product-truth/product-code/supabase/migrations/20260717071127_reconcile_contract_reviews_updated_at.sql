-- G5 lifecycle reconciliation: all review-state functions update
-- contract_reviews.updated_at, but the registered base migrations never
-- created that column.  Backfill from the best existing lifecycle timestamp
-- so historical rows do not pretend that the migration time was their update
-- time.

set lock_timeout = '5s';
set statement_timeout = '60s';

do $$
declare
  existing_type oid;
begin
  if to_regclass('public.contract_reviews') is null then
    raise exception 'required table public.contract_reviews is missing'
      using errcode = '42P01';
  end if;

  select attribute.atttypid
  into existing_type
  from pg_attribute as attribute
  where attribute.attrelid = 'public.contract_reviews'::regclass
    and attribute.attname = 'updated_at'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if found and existing_type <> 'timestamptz'::regtype then
    raise exception 'contract_reviews.updated_at has incompatible type: %',
      existing_type::regtype
      using errcode = '42804';
  end if;
end;
$$;

alter table public.contract_reviews
  add column if not exists updated_at timestamptz;

update public.contract_reviews
set updated_at = coalesce(completed_at, started_at, created_at, now())
where updated_at is null;

alter table public.contract_reviews
  alter column updated_at set default now(),
  alter column updated_at set not null;

create or replace function public.set_contract_reviews_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_contract_reviews_updated_at()
  from public, anon, authenticated;
grant execute on function public.set_contract_reviews_updated_at()
  to service_role;

drop trigger if exists trg_contract_reviews_updated_at
  on public.contract_reviews;

create trigger trg_contract_reviews_updated_at
before update on public.contract_reviews
for each row
execute function public.set_contract_reviews_updated_at();

do $$
declare
  default_expression text;
begin
  if not exists (
    select 1
    from pg_attribute as attribute
    where attribute.attrelid = 'public.contract_reviews'::regclass
      and attribute.attname = 'updated_at'
      and attribute.atttypid = 'timestamptz'::regtype
      and attribute.attnotnull
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) then
    raise exception 'contract_reviews.updated_at postcondition failed';
  end if;

  if exists (
    select 1 from public.contract_reviews where updated_at is null
  ) then
    raise exception 'contract_reviews.updated_at backfill is incomplete';
  end if;

  select pg_get_expr(attribute_default.adbin, attribute_default.adrelid)
  into default_expression
  from pg_attribute as attribute
  join pg_attrdef as attribute_default
    on attribute_default.adrelid = attribute.attrelid
   and attribute_default.adnum = attribute.attnum
  where attribute.attrelid = 'public.contract_reviews'::regclass
    and attribute.attname = 'updated_at';

  if default_expression is distinct from 'now()' then
    raise exception 'unexpected contract_reviews.updated_at default: %', default_expression;
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.contract_reviews'::regclass
      and tgname = 'trg_contract_reviews_updated_at'
      and tgenabled <> 'D'
      and not tgisinternal
  ) then
    raise exception 'contract_reviews updated_at trigger is missing';
  end if;

  if has_function_privilege(
       'anon',
       'public.set_contract_reviews_updated_at()',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.set_contract_reviews_updated_at()',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.set_contract_reviews_updated_at()',
       'EXECUTE'
     ) then
    raise exception 'updated_at trigger-function ACL postcondition failed';
  end if;
end;
$$;

reset statement_timeout;
reset lock_timeout;
