begin;

-- Set only against the original SF application service list. Existing
-- connections have no inferred authorization from order, tracking or cancel.
alter table public.shipping_carrier_connections add column sf_intercept_access text
  check (sf_intercept_access in ('testing','live'));
create function public.clear_sf_intercept_access_on_rebind()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.sf_intercept_access := null;
  return new;
end;
$$;
create trigger clear_sf_intercept_access_on_rebind before update on public.shipping_carrier_connections
for each row when (old.credentials_ciphertext is distinct from new.credentials_ciphertext
  or old.org_id is distinct from new.org_id or old.environment is distinct from new.environment
  or old.carrier_key is distinct from new.carrier_key)
execute function public.clear_sf_intercept_access_on_rebind();

create table public.shipping_carrier_changes (
  order_id uuid not null references public.shipping_orders(id) on delete restrict,
  request_key uuid not null,
  action text not null check (action in ('modify_recipient','return_to_sender')),
  original_recipient jsonb not null,
  destination jsonb not null,
  status text not null check (status in ('pending','accepted','rejected','unknown','not_sent')),
  requested_at timestamptz not null default clock_timestamp(),
  instruction_id text,
  amount text,
  primary key (order_id,request_key)
);
create unique index shipping_carrier_change_in_progress on public.shipping_carrier_changes(order_id)
where status in ('pending','accepted','unknown');
create index shipping_carrier_changes_recent on public.shipping_carrier_changes(order_id,requested_at desc);
alter table public.shipping_carrier_changes enable row level security;
revoke all on table public.shipping_carrier_changes from public, anon, authenticated, service_role;
grant select on table public.shipping_carrier_changes to service_role;

create function public.owner_carrier_change_v1(
  p_org uuid,p_actor uuid,p_order_no text,p_key uuid,p_action text,p_recipient jsonb,p_binding text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.shipping_orders%rowtype;
  w public.shipping_waybills%rowtype;
  req public.shipping_carrier_changes%rowtype;
  latest jsonb;
  ctx jsonb;
  binding text;
  dst jsonb;
  matched boolean := false;
begin
  if p_org is null or p_actor is null then return null; end if;
  if (p_key is null) <> (p_action is null) or (p_binding is not null and p_key is null)
    or (p_action is not null and p_action not in ('modify_recipient','return_to_sender'))
    or (p_action = 'modify_recipient' and jsonb_typeof(p_recipient) is distinct from 'object')
    or (p_action is distinct from 'modify_recipient' and p_recipient is not null) then
    raise exception 'invalid carrier change' using errcode='22023';
  end if;
  select * into o from public.shipping_orders where org_id=p_org and created_by=p_actor
    and intake_source='owner_web' and order_no=p_order_no for update;
  if not found then return null; end if;
  dst := case when p_action='return_to_sender' then o.shipment_payload->'sender' else p_recipient end;

  if p_key is not null then
    select * into req from public.shipping_carrier_changes where order_id=o.id and request_key=p_key;
    matched := found;
    if matched and (req.action<>p_action or (p_action='modify_recipient' and req.destination is distinct from dst)) then
      raise exception 'request key conflict' using errcode='40001';
    end if;
  end if;
  if not matched then
    select * into req from public.shipping_carrier_changes where order_id=o.id order by requested_at desc limit 1;
  end if;
  if req.order_id is not null then
    latest := jsonb_build_object('action',req.action,'status',req.status,'originalRecipient',req.original_recipient,
      'destination',req.destination,'requestedAt',req.requested_at,'instructionId',req.instruction_id,'amount',req.amount);
  end if;
  if matched then return jsonb_build_object('result','replay','latest',latest); end if;

  if (o.status='in_transit' or (o.connection_environment='sandbox' and o.status='waybill_created'))
    and o.provider_key='sf' and o.provider_order_id is not null
    and coalesce(to_jsonb(o)#>>'{cancellation,phase}','') not in ('calling','unknown','accepted','manual_review')
    and o.shipping_config_snapshot->>'payment'='sender_monthly'
    and req.status is distinct from 'accepted' and req.status is distinct from 'unknown' and req.status is distinct from 'pending' then
    select * into w from public.shipping_waybills where shipping_order_id=o.id and carrier_key='sf'
      and provider_order_id=o.provider_order_id and (
        (latest_status='in_transit' and latest_event_at is not null)
        or (o.connection_environment='sandbox' and latest_status in ('waybill_created','in_transit')))
      for share;
    if w.id is not null and w.waybill_no ~ '^(SF)?[0-9]{10,15}$'
      -- Sandbox MOCK routes are never persisted as live shipment state. Only
      -- the verified sandbox service may obtain them on opening one order.
      and (o.connection_environment='sandbox' or exists(select 1 from public.shipping_tracking_events e where e.waybill_id=w.id
        and e.provider_key='sf' and e.event_at=w.latest_event_at and e.status='in_transit'))
      and not exists(select 1 from public.shipping_tracking_events e where e.waybill_id=w.id and e.provider_key='sf'
        and (e.status in ('out_for_delivery','delivered') or (e.event_at>=w.latest_event_at and e.status<>'in_transit'))) then
      select encode(sha256(convert_to(jsonb_build_array(o.id,o.carrier_connection_id,o.billing_account_id,o.connection_environment,
        c.credentials_ciphertext,b.account_ciphertext,w.id,w.waybill_no,o.provider_order_id,o.shipment_payload->'sender',
        o.shipment_payload->'recipient')::text,'UTF8')),'hex')
        into binding from public.shipping_carrier_connections c join public.shipping_billing_accounts b
          on b.id=o.billing_account_id and b.org_id=o.org_id and b.connection_id=c.id and b.status='active'
        where c.id=o.carrier_connection_id and c.org_id=o.org_id and c.environment=o.connection_environment
          and c.carrier_key='sf' and c.connection_status='connected'
          and ((c.environment='production' and c.sf_intercept_access='live')
             or (c.environment='sandbox' and c.sf_intercept_access='testing'))
          and b.account_tail=o.billing_account_tail and b.environment=c.environment for share of c,b;
      if binding is not null then
        ctx := jsonb_build_object('connectionId',o.carrier_connection_id,'accountId',o.billing_account_id,
          'environment',o.connection_environment,'providerOrderId',o.provider_order_id,'waybill',w.waybill_no,'binding',binding);
      end if;
    end if;
  end if;
  if p_action='modify_recipient' and not exists (
    select 1 from unnest(array['province','city','county','address']) as address_fields(field)
    where dst->>field is distinct from o.shipment_payload->'recipient'->>field
  ) then
    raise exception 'destination address unchanged' using errcode='22023';
  end if;
  if p_binding is not null then
    if binding is null or p_binding<>binding then raise exception 'carrier change no longer eligible' using errcode='40001'; end if;
    insert into public.shipping_carrier_changes(order_id,request_key,action,original_recipient,destination,status)
      values(o.id,p_key,p_action,o.shipment_payload->'recipient',dst,'pending');
    return jsonb_build_object('result','dispatch');
  end if;
  return jsonb_build_object('result','detail','orderNo',o.order_no,'context',ctx,'latest',latest,
    'currentRecipient',case when latest is not null or ctx is not null then o.shipment_payload->'recipient' end,
    'returnDestination',case when ctx is not null then o.shipment_payload->'sender' end);
end;
$$;

create function public.finish_owner_carrier_change_v1(p_org uuid,p_actor uuid,p_order_no text,p_key uuid,
  p_status text,p_instruction_id text,p_amount text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status is null or p_status not in ('accepted','unknown','not_sent','rejected')
    or (p_instruction_id is not null and (p_status<>'accepted' or length(p_instruction_id)>80))
    or (p_amount is not null and (p_status<>'accepted' or p_amount !~ '^[0-9]{1,10}([.][0-9]{1,2})?$')) then
    raise exception 'invalid receipt' using errcode='22023';
  end if;
  update public.shipping_carrier_changes r set status=p_status,instruction_id=p_instruction_id,amount=p_amount
    from public.shipping_orders o where o.id=r.order_id and o.org_id=p_org and o.created_by=p_actor
      and o.order_no=p_order_no and o.intake_source='owner_web' and r.request_key=p_key and r.status='pending';
  return found;
end;
$$;
revoke all on function public.clear_sf_intercept_access_on_rebind(),
  public.owner_carrier_change_v1(uuid,uuid,text,uuid,text,jsonb,text),
  public.finish_owner_carrier_change_v1(uuid,uuid,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.owner_carrier_change_v1(uuid,uuid,text,uuid,text,jsonb,text),
  public.finish_owner_carrier_change_v1(uuid,uuid,text,uuid,text,text,text) to service_role;
commit;
