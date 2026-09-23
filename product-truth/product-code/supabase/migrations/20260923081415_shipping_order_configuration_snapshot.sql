-- F054 WP16: persisted service matrix and immutable provider/account snapshots.

alter table public.shipping_carrier_connections
  add column if not exists authorized_services jsonb not null default '[]'::jsonb;
alter table public.shipping_carrier_connections
  add constraint shipping_carrier_connections_services_array
  check (jsonb_typeof(authorized_services) = 'array');

alter table public.shipping_orders
  add column if not exists org_id uuid references public.organizations(id) on delete set null,
  add column if not exists carrier_connection_id uuid references public.shipping_carrier_connections(id) on delete set null,
  add column if not exists billing_account_id uuid references public.shipping_billing_accounts(id) on delete set null,
  add column if not exists sender_profile_id uuid references public.shipping_sender_profiles(id) on delete set null,
  add column if not exists connection_environment text check (connection_environment in ('sandbox', 'production')),
  add column if not exists billing_account_tail text check (billing_account_tail is null or billing_account_tail ~ '^[0-9]{4}$'),
  add column if not exists shipping_config_snapshot jsonb not null default '{}'::jsonb;
create index if not exists shipping_orders_connection_account
  on public.shipping_orders(org_id, carrier_connection_id, billing_account_id, created_at desc);

alter table public.shipping_requests
  add column if not exists org_id uuid references public.organizations(id) on delete set null,
  add column if not exists carrier_connection_id uuid references public.shipping_carrier_connections(id) on delete set null,
  add column if not exists billing_account_id uuid references public.shipping_billing_accounts(id) on delete set null,
  add column if not exists sender_profile_id uuid references public.shipping_sender_profiles(id) on delete set null,
  add column if not exists billing_account_tail text check (billing_account_tail is null or billing_account_tail ~ '^[0-9]{4}$'),
  add column if not exists shipping_config_snapshot jsonb not null default '{}'::jsonb;
create index if not exists shipping_requests_configuration_snapshot
  on public.shipping_requests(org_id, carrier_connection_id, billing_account_id, created_at desc);

comment on column public.shipping_orders.shipping_config_snapshot is 'Non-secret immutable carrier, environment, billing-account tail, service, and sender-profile reference used for this order.';
comment on column public.shipping_requests.shipping_config_snapshot is 'Non-secret immutable provider/account settings used for legacy outbox reconciliation.';
