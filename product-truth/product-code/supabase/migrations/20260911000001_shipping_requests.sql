-- F054: minimal durable outbox, deliberately no customer/business-order domain.
create table if not exists public.shipping_requests (
  id text primary key check (id ~ '^PV3[a-f0-9]{28}$'),
  created_by uuid not null references public.users(id),
  idempotency_key uuid not null,
  connection_key text not null,
  fingerprint text not null,
  environment text not null check (environment in ('sandbox','production')),
  status text not null check (status in ('pending','unknown','accepted')),
  waybill text,
  created_at timestamptz not null default now(),
  unique (created_by, idempotency_key)
);
create index if not exists shipping_requests_recent on public.shipping_requests(created_by,connection_key,created_at desc);
alter table public.shipping_requests enable row level security;
revoke all on public.shipping_requests from public, anon, authenticated;
grant select, insert, update on public.shipping_requests to service_role;
comment on table public.shipping_requests is 'F054 minimal shipping requests; API verifies identity and allowlist. No direct client access.';
