-- F054 v1.0 M0: carrier-neutral shipment order, waybill and tracking event spine.
-- Existing shipping_requests stays intact as historical provider outbox.

create table if not exists public.shipping_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique check (order_no ~ '^SO-[0-9]{8}-[A-Z0-9]{8}$'),
  created_by uuid references public.users(id),
  intake_source text not null check (intake_source in ('anonymous_web','owner_web','crm','wechat_bot')),
  confirmation_policy text not null check (confirmation_policy in ('direct','scheduled_review')),
  status text not null check (status in ('accepted','awaiting_confirmation','returned','confirmed','ordering','order_unknown','waybill_created','in_transit','delivered','cancelled','order_failed')),
  sales_ref text,
  customer_ref text,
  assignment_status text not null check (assignment_status in ('assigned','unassigned')),
  raw_input text,
  shipment_payload jsonb not null,
  payload_hash text not null,
  idempotency_key uuid not null,
  receipt_token_hash text not null unique,
  provider_key text not null default 'sf',
  provider_order_id text,
  next_review_at timestamptz,
  review_notified_at timestamptz,
  confirmed_by uuid references public.users(id),
  confirmed_at timestamptz,
  returned_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (intake_source, idempotency_key)
);

create index if not exists shipping_orders_review_queue
  on public.shipping_orders(status, next_review_at, created_at);
create index if not exists shipping_orders_sales
  on public.shipping_orders(sales_ref, created_at desc);
create index if not exists shipping_orders_customer
  on public.shipping_orders(customer_ref, created_at desc);
create index if not exists shipping_orders_created_by
  on public.shipping_orders(created_by, created_at desc);

alter table public.shipping_orders add column if not exists review_notified_at timestamptz;

create table if not exists public.shipping_waybills (
  id uuid primary key default gen_random_uuid(),
  shipping_order_id uuid not null references public.shipping_orders(id) on delete restrict,
  carrier_key text not null,
  waybill_no text not null,
  provider_order_id text,
  latest_status text not null default 'waybill_created',
  latest_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (carrier_key, waybill_no),
  unique (shipping_order_id)
);

create index if not exists shipping_waybills_order
  on public.shipping_waybills(shipping_order_id);

create table if not exists public.shipping_tracking_events (
  id uuid primary key default gen_random_uuid(),
  waybill_id uuid not null references public.shipping_waybills(id) on delete cascade,
  provider_key text not null,
  provider_event_id text,
  status text not null,
  event_at timestamptz not null,
  location text,
  description text not null,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  unique (waybill_id, provider_key, provider_event_id)
);

create index if not exists shipping_tracking_events_timeline
  on public.shipping_tracking_events(waybill_id, event_at desc);

create table if not exists public.shipping_intake_rate_limits (
  bucket_hash text not null,
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (bucket_hash, window_start)
);

create or replace function public.claim_shipping_intake_rate(
  p_bucket_hash text,
  p_now timestamptz,
  p_window_seconds integer,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if length(p_bucket_hash) <> 64 or p_window_seconds < 60 or p_limit < 1 then
    raise exception 'invalid rate-limit arguments';
  end if;
  v_window := to_timestamp(floor(extract(epoch from p_now) / p_window_seconds) * p_window_seconds);
  insert into public.shipping_intake_rate_limits(bucket_hash, window_start, request_count)
  values (p_bucket_hash, v_window, 1)
  on conflict (bucket_hash, window_start)
  do update set request_count = public.shipping_intake_rate_limits.request_count + 1
  returning request_count into v_count;
  return v_count <= p_limit;
end;
$$;

alter table public.shipping_orders enable row level security;
alter table public.shipping_waybills enable row level security;
alter table public.shipping_tracking_events enable row level security;
alter table public.shipping_intake_rate_limits enable row level security;

revoke all on public.shipping_orders from public, anon, authenticated;
revoke all on public.shipping_waybills from public, anon, authenticated;
revoke all on public.shipping_tracking_events from public, anon, authenticated;
revoke all on public.shipping_intake_rate_limits from public, anon, authenticated;
revoke all on function public.claim_shipping_intake_rate(text,timestamptz,integer,integer) from public, anon, authenticated;

grant select, insert, update on public.shipping_orders to service_role;
grant select, insert, update on public.shipping_waybills to service_role;
grant select, insert on public.shipping_tracking_events to service_role;
grant select, insert, update, delete on public.shipping_intake_rate_limits to service_role;
grant execute on function public.claim_shipping_intake_rate(text,timestamptz,integer,integer) to service_role;

comment on table public.shipping_orders is 'F054 carrier-neutral shipment orders. Anonymous access is mediated by server-side receipt tokens.';
comment on table public.shipping_waybills is 'F054 real carrier waybills created only after provider acceptance.';
comment on table public.shipping_tracking_events is 'F054 append-only normalized carrier tracking events.';
