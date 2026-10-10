begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.shipping_billing_accounts add column carrier_key text not null default 'sf' check (carrier_key = 'sf');
alter table public.shipping_billing_accounts add column environment text not null default 'production' check (environment in ('sandbox','production'));
update public.shipping_billing_accounts b set environment=c.environment from public.shipping_carrier_connections c where b.connection_id=c.id;
alter table public.shipping_billing_accounts alter column connection_id drop not null;
create unique index shipping_billing_accounts_carrier_identity on public.shipping_billing_accounts(org_id,carrier_key,environment,account_fingerprint);
create unique index shipping_billing_accounts_carrier_default on public.shipping_billing_accounts(org_id,carrier_key,environment) where is_default and status='active';
create table public.shipping_intake_settings (
 org_id uuid primary key references public.organizations(id),
 rules jsonb not null,
 updated_by uuid references public.users(id),
 updated_at timestamptz not null default now()
);
alter table public.shipping_intake_settings enable row level security;
revoke all on public.shipping_intake_settings from anon, authenticated;
grant select,insert,update,delete on public.shipping_intake_settings to service_role;
commit;
