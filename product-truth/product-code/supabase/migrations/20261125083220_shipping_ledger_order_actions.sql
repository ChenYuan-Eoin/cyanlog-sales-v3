begin;

-- New requests keep the authenticated initiator. Historical owner requests stay readable.
alter table public.shipping_carrier_changes add column requested_by uuid;

create function public.shipping_carrier_change_v1(
  p_org uuid,p_actor uuid,p_order_no text,p_order_id uuid,p_key uuid,p_action text,p_recipient jsonb,p_binding text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.shipping_orders%rowtype;
  w public.shipping_waybills%rowtype;
  req public.shipping_carrier_changes%rowtype;
  latest jsonb;
  ctx jsonb;
  binding text;
  intercept_access text;
  unavailable_reason text;
  dst jsonb;
  matched boolean := false;
begin
  if p_org is null or p_actor is null or (p_order_no is null) = (p_order_id is null) then return null; end if;
  if (p_key is null) <> (p_action is null) or (p_binding is not null and p_key is null)
    or (p_action is not null and p_action not in ('modify_recipient','return_to_sender'))
    or (p_action = 'modify_recipient' and jsonb_typeof(p_recipient) is distinct from 'object')
    or (p_action is distinct from 'modify_recipient' and p_recipient is not null) then
    raise exception 'invalid carrier change' using errcode='22023';
  end if;
  -- Both entry points lock the same order before checking or claiming a request.
  -- Ledger authorization is resolved by the server before it calls the service-only RPC.
  if p_order_id is null then
    select * into o from public.shipping_orders where org_id=p_org and created_by=p_actor
      and intake_source='owner_web' and order_no=p_order_no for update;
  else
    select * into o from public.shipping_orders where org_id=p_org and id=p_order_id for update;
  end if;
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
        o.shipment_payload->'recipient')::text,'UTF8')),'hex'), c.sf_intercept_access
        into binding,intercept_access from public.shipping_carrier_connections c join public.shipping_billing_accounts b
          on b.id=o.billing_account_id and b.org_id=o.org_id and b.connection_id=c.id and b.status='active'
        where c.id=o.carrier_connection_id and c.org_id=o.org_id and c.environment=o.connection_environment
          and c.carrier_key='sf' and c.connection_status='connected'
          and b.account_tail=o.billing_account_tail and b.environment=c.environment for share of c,b;
      if binding is not null and intercept_access is distinct from
        (case when o.connection_environment='production' then 'live' else 'testing' end) then
        unavailable_reason := 'intercept_disabled';
        binding := null;
      end if;
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
    insert into public.shipping_carrier_changes(order_id,request_key,action,original_recipient,destination,status,requested_by)
      values(o.id,p_key,p_action,o.shipment_payload->'recipient',dst,'pending',p_actor);
    return jsonb_build_object('result','dispatch');
  end if;
  return jsonb_build_object('result','detail','orderNo',o.order_no,'context',ctx,'latest',latest,'unavailableReason',unavailable_reason,
    'currentRecipient',case when latest is not null or ctx is not null then o.shipment_payload->'recipient' end,
    'returnDestination',case when ctx is not null then o.shipment_payload->'sender' end);
end;
$$;

create function public.finish_shipping_carrier_change_v1(p_org uuid,p_actor uuid,p_order_no text,p_order_id uuid,p_key uuid,
  p_status text,p_instruction_id text,p_amount text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_status is null or p_status not in ('accepted','unknown','not_sent','rejected')
    or (p_instruction_id is not null and (p_status<>'accepted' or length(p_instruction_id)>80))
    or (p_amount is not null and (p_status<>'accepted' or p_amount !~ '^[0-9]{1,10}([.][0-9]{1,2})?$')) then
    raise exception 'invalid receipt' using errcode='22023';
  end if;
  if (p_order_no is null) = (p_order_id is null) or p_actor is null then return false; end if;
  update public.shipping_carrier_changes r set status=p_status,instruction_id=p_instruction_id,amount=p_amount
    from public.shipping_orders o where o.id=r.order_id and o.org_id=p_org and r.request_key=p_key and r.status='pending'
      and ((p_order_id is null and o.order_no=p_order_no and o.intake_source='owner_web' and o.created_by=p_actor
            and (r.requested_by is null or r.requested_by=p_actor))
        or (p_order_no is null and o.id=p_order_id and r.requested_by=p_actor));
  return found;
end;
$$;

revoke all on function public.shipping_carrier_change_v1(uuid,uuid,text,uuid,uuid,text,jsonb,text),
  public.finish_shipping_carrier_change_v1(uuid,uuid,text,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.shipping_carrier_change_v1(uuid,uuid,text,uuid,uuid,text,jsonb,text),
  public.finish_shipping_carrier_change_v1(uuid,uuid,text,uuid,uuid,text,text,text) to service_role;

-- Keep pre-deployment callers and historical owner requests on the same claim.
create or replace function public.owner_carrier_change_v1(
  p_org uuid,p_actor uuid,p_order_no text,p_key uuid,p_action text,p_recipient jsonb,p_binding text
) returns jsonb language sql security invoker set search_path = '' as $$
  select public.shipping_carrier_change_v1(p_org,p_actor,p_order_no,null,p_key,p_action,p_recipient,p_binding);
$$;

create or replace function public.finish_owner_carrier_change_v1(p_org uuid,p_actor uuid,p_order_no text,p_key uuid,
  p_status text,p_instruction_id text,p_amount text)
returns boolean language sql security invoker set search_path = '' as $$
  select public.finish_shipping_carrier_change_v1(p_org,p_actor,p_order_no,null,p_key,p_status,p_instruction_id,p_amount);
$$;

create or replace function public.claim_shipping_cancellation_v1(p_org uuid,p_actor uuid,p_reference text,p_owner boolean,p_attempt uuid,p_expected jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.shipping_orders%rowtype; w public.shipping_waybills%rowtype; receipt jsonb; phase text; current_snapshot jsonb;
begin
  if p_org is null or p_actor is null or p_attempt is null or p_owner is null then raise exception 'invalid scope'; end if;
  if p_owner then
    select * into o from public.shipping_orders where org_id=p_org and created_by=p_actor and intake_source='owner_web' and order_no=p_reference for update;
  else
    select * into o from public.shipping_orders where org_id=p_org and id=p_reference::uuid for update;
  end if;
  if not found then return '{"result":"missing"}'; end if;
  select * into w from public.shipping_waybills where shipping_order_id=o.id for update;
  current_snapshot := jsonb_build_object('revision',o.revision,'status',o.status,'waybill',w.waybill_no);
  phase := o.cancellation->>'phase';
  if p_owner or p_expected is not null then
    if o.status='cancelled' or (phase is not null and phase <> 'not_sent') then
      if p_expected is null or p_expected is distinct from o.cancellation->'expected' then
        return '{"result":"stale"}';
      end if;
    elsif p_expected is distinct from current_snapshot then
      return '{"result":"stale"}';
    end if;
  end if;
  if o.status='cancelled' then return jsonb_build_object('result','cancelled','id',o.id); end if;
  if phase is not null and phase <> 'not_sent' then
    return jsonb_build_object('result',case when phase='rejected' then 'rejected' else 'pending' end,'id',o.id);
  end if;
  receipt := jsonb_build_object('attempt',p_attempt,'actor',p_actor,'requested_at',clock_timestamp(),'expected',current_snapshot,'source',case when p_owner then 'owner' else 'operator' end);
  if (p_owner or p_expected is not null) and o.status in ('accepted','awaiting_confirmation','confirmed','returned','order_failed') and w.id is null
     and (o.provider_order_id is null or (o.status='order_failed' and o.shipping_config_snapshot#>>'{orderFailure,stage}' = 'provider_not_sent')) then
    update public.shipping_orders set status='cancelled',cancellation=receipt||'{"phase":"local"}'::jsonb, updated_at=now() where id=o.id;
    return jsonb_build_object('result','cancelled','id',o.id);
  end if;
  if o.status in ('ordering','order_unknown','order_failed') then return '{"result":"uncertain"}'; end if;
  if o.status <> 'waybill_created' then return '{"result":"unavailable"}'; end if;
  if exists(select 1 from public.shipping_carrier_changes r where r.order_id=o.id and r.status in ('pending','accepted','unknown')) then
    return '{"result":"unavailable"}';
  end if;
  if w.id is null or nullif(w.waybill_no,'') is null or w.latest_status <> 'waybill_created'
     or nullif(btrim(o.provider_order_id),'') is null or w.provider_order_id is distinct from o.provider_order_id or w.carrier_key is distinct from o.provider_key
     or o.carrier_connection_id is null or o.connection_environment is null then return '{"result":"unavailable"}'; end if;
  update public.shipping_orders set cancellation=receipt||jsonb_build_object('phase','calling','provider_order_id',o.provider_order_id,
    'waybill',w.waybill_no,'connection_id',o.carrier_connection_id,'environment',o.connection_environment), updated_at=now() where id=o.id;
  return jsonb_build_object('result','dispatch','id',o.id,'provider',o.provider_key,'providerOrderId',o.provider_order_id,
    'connectionId',o.carrier_connection_id,'environment',o.connection_environment,'billingAccountId',o.billing_account_id);
end; $$;

commit;
