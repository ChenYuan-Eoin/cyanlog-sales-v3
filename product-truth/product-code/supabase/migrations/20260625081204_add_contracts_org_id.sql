-- PURPOSE: Align contracts with the organization-scoped runtime model.
-- The application filters and writes contracts by org_id, but older schema
-- revisions only had created_by. Backfill org_id from quote owner, creator
-- default organization, then creator primary organization.

alter table contracts
  add column if not exists org_id uuid references organizations(id) on delete cascade;

update contracts c
set org_id = q.org_id
from quotes q
where c.org_id is null
  and c.quote_id is not null
  and q.id = c.quote_id
  and q.org_id is not null;

update contracts c
set org_id = uo.org_id
from user_organizations uo
where c.org_id is null
  and c.created_by = uo.user_id
  and uo.is_default = true;

update contracts c
set org_id = u.org_id
from users u
where c.org_id is null
  and c.created_by = u.id
  and u.org_id is not null;

update contracts c
set org_id = fallback_org.id
from (
  select id
  from organizations
  order by created_at asc nulls last
  limit 1
) fallback_org
where c.org_id is null;

create index if not exists idx_contracts_org_id on contracts(org_id);
create index if not exists idx_contracts_org_status on contracts(org_id, status);
create index if not exists idx_contracts_org_created_at on contracts(org_id, created_at desc);

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.contracts'::regclass
      and contype = 'u'
      and conkey = array[
        (
          select attnum
          from pg_attribute
          where attrelid = 'public.contracts'::regclass
            and attname = 'contract_no'
            and not attisdropped
        )
      ]::smallint[]
  loop
    execute format('alter table contracts drop constraint %I', constraint_record.conname);
  end loop;
end $$;

create unique index if not exists idx_contracts_org_contract_no
  on contracts(org_id, contract_no)
  where contract_no is not null;

do $$
begin
  if not exists (select 1 from contracts where org_id is null) then
    alter table contracts alter column org_id set not null;
  end if;
end $$;
