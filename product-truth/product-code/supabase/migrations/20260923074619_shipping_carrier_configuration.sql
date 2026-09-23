-- F054 WP15: organization-scoped carrier connection and billing configuration.
-- Provider credentials are application-encrypted before reaching these tables.

create table if not exists public.shipping_carrier_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  carrier_key text not null check (carrier_key = 'sf'),
  environment text not null check (environment in ('sandbox', 'production')),
  credentials_ciphertext text not null,
  partner_id_tail text not null check (partner_id_tail ~ '^[A-Za-z0-9]{4}$'),
  connection_status text not null default 'configured' check (connection_status in ('configured', 'connected', 'failed', 'disabled')),
  order_capability text not null default 'not_tested' check (order_capability in ('not_tested', 'verified', 'unavailable')),
  query_capability text not null default 'not_tested' check (query_capability in ('not_tested', 'verified', 'unavailable')),
  tracking_capability text not null default 'not_tested' check (tracking_capability in ('not_tested', 'verified', 'unavailable')),
  cancel_capability text not null default 'not_tested' check (cancel_capability in ('not_tested', 'verified', 'unavailable')),
  last_tested_at timestamptz,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, carrier_key, environment)
);

create table if not exists public.shipping_billing_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.shipping_carrier_connections(id) on delete cascade,
  account_ciphertext text not null,
  account_fingerprint text not null check (account_fingerprint ~ '^[a-f0-9]{64}$'),
  account_tail text not null check (account_tail ~ '^[0-9]{4}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_default boolean not null default false,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, connection_id, account_fingerprint)
);

create unique index if not exists shipping_billing_accounts_one_default
  on public.shipping_billing_accounts(org_id, connection_id)
  where is_default and status = 'active';
create index if not exists shipping_billing_accounts_org_active
  on public.shipping_billing_accounts(org_id, connection_id, status, created_at desc);

create table if not exists public.shipping_sender_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  name text not null check (char_length(name) between 1 and 80),
  phone text not null check (phone ~ '^[0-9+() -]{6,32}$'),
  province text not null check (char_length(province) between 1 and 80),
  city text not null check (char_length(city) between 1 and 80),
  county text not null check (char_length(county) between 1 and 80),
  address text not null check (char_length(address) between 1 and 240),
  is_default boolean not null default false,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists shipping_sender_profiles_one_default
  on public.shipping_sender_profiles(org_id)
  where is_default;

alter table public.shipping_carrier_connections enable row level security;
alter table public.shipping_billing_accounts enable row level security;
alter table public.shipping_sender_profiles enable row level security;

revoke all on public.shipping_carrier_connections from public, anon, authenticated;
revoke all on public.shipping_billing_accounts from public, anon, authenticated;
revoke all on public.shipping_sender_profiles from public, anon, authenticated;
grant select, insert, update, delete on public.shipping_carrier_connections to service_role;
grant select, insert, update, delete on public.shipping_billing_accounts to service_role;
grant select, insert, update, delete on public.shipping_sender_profiles to service_role;

comment on table public.shipping_carrier_connections is 'Org-scoped carrier machine credentials; credentials_ciphertext uses application-managed authenticated encryption.';
comment on table public.shipping_billing_accounts is 'Org-scoped encrypted monthly billing account references; only masked tails are returned to users.';
comment on table public.shipping_sender_profiles is 'Org-scoped default sender profiles, accessible through authenticated server routes only.';
