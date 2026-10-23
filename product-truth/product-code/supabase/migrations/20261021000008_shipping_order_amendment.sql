-- WP30: versioned amendment for shipping work orders that have not been sent.

begin;

alter table public.shipping_orders
  add column if not exists revision integer not null default 1,
  add column if not exists original_shipment_payload jsonb,
  add column if not exists amended_at timestamptz,
  add column if not exists amended_by uuid references public.users(id),
  add column if not exists amend_reason text;

update public.shipping_orders
set
  original_shipment_payload = coalesce(original_shipment_payload, shipment_payload),
  revision = greatest(coalesce(revision, 1), 1)
where original_shipment_payload is null or revision is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shipping_orders'::regclass
      and conname = 'shipping_orders_revision_check'
  ) then
    alter table public.shipping_orders
      add constraint shipping_orders_revision_check check (revision > 0);
  end if;
end
$$;

create table if not exists public.shipping_order_revisions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shipping_orders(id) on delete restrict,
  org_id uuid not null references public.organizations(id) on delete cascade,
  revision integer not null check (revision > 1),
  before_payload jsonb not null,
  after_payload jsonb not null,
  before_payload_hash text not null,
  after_payload_hash text not null,
  actor_id uuid not null references public.users(id),
  reason text not null check (char_length(btrim(reason)) between 2 and 300),
  created_at timestamptz not null default now(),
  unique (order_id, revision)
);

create index if not exists idx_shipping_order_revisions_order
  on public.shipping_order_revisions(order_id, revision desc);

alter table public.shipping_order_revisions enable row level security;
revoke all on public.shipping_order_revisions from public, anon, authenticated;
grant select, insert on public.shipping_order_revisions to service_role;

create or replace function public.amend_shipping_order_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_order_id uuid,
  p_expected_revision integer,
  p_shipment_payload jsonb,
  p_payload_hash text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.shipping_orders%rowtype;
  v_next_revision integer;
begin
  if p_expected_revision < 1 or p_shipment_payload is null
    or char_length(btrim(coalesce(p_payload_hash, ''))) <> 64
    or char_length(btrim(coalesce(p_reason, ''))) < 2 then
    raise exception 'invalid shipping amendment arguments' using errcode = '22023';
  end if;

  select *
  into v_order
  from public.shipping_orders
  where id = p_order_id and org_id = p_org_id
  for update;

  if v_order.id is null then
    return false;
  end if;
  if v_order.revision <> p_expected_revision then
    raise exception 'shipping order revision conflict' using errcode = '40001';
  end if;
  if v_order.status not in ('awaiting_confirmation', 'returned') then
    raise exception 'shipping order is frozen in status %', v_order.status using errcode = '23514';
  end if;
  if exists (
    select 1 from public.shipping_waybills where shipping_order_id = p_order_id
  ) then
    raise exception 'shipping order already has a waybill' using errcode = '23514';
  end if;

  v_next_revision := v_order.revision + 1;

  insert into public.shipping_order_revisions (
    order_id, org_id, revision, before_payload, after_payload,
    before_payload_hash, after_payload_hash, actor_id, reason
  ) values (
    p_order_id, p_org_id, v_next_revision, v_order.shipment_payload, p_shipment_payload,
    v_order.payload_hash, p_payload_hash, p_actor_id, btrim(p_reason)
  );

  update public.shipping_orders
  set
    shipment_payload = p_shipment_payload,
    payload_hash = p_payload_hash,
    revision = v_next_revision,
    status = 'awaiting_confirmation',
    returned_reason = null,
    review_notified_at = null,
    next_review_at = now(),
    amended_at = now(),
    amended_by = p_actor_id,
    amend_reason = btrim(p_reason),
    updated_at = now()
  where id = p_order_id and org_id = p_org_id
    and revision = p_expected_revision;

  if not found then
    raise exception 'shipping order revision conflict' using errcode = '40001';
  end if;

  return true;
end;
$$;

revoke all on function public.amend_shipping_order_v1(uuid, uuid, uuid, integer, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.amend_shipping_order_v1(uuid, uuid, uuid, integer, jsonb, text, text)
  to service_role;

comment on table public.shipping_order_revisions is
  'Immutable before/after snapshots for pre-dispatch work order amendments.';
comment on function public.amend_shipping_order_v1(uuid, uuid, uuid, integer, jsonb, text, text) is
  'Service-role-only optimistic revision update for pre-dispatch shipping orders.';

commit;
