-- Shared by the operator ledger and the submitting employee; no backfill.
alter table public.shipping_orders add column cancellation jsonb;

create function public.claim_shipping_cancellation_v1(p_org uuid,p_actor uuid,p_reference text,p_owner boolean,p_attempt uuid,p_expected jsonb default null)
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
  if p_owner then
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
  if p_owner and o.status in ('accepted','awaiting_confirmation','confirmed','returned','order_failed') and w.id is null
     and (o.provider_order_id is null or (o.status='order_failed' and o.shipping_config_snapshot#>>'{orderFailure,stage}' = 'provider_not_sent')) then
    update public.shipping_orders set status='cancelled',cancellation=receipt||'{"phase":"local"}'::jsonb, updated_at=now() where id=o.id;
    return jsonb_build_object('result','cancelled','id',o.id);
  end if;
  if o.status in ('ordering','order_unknown','order_failed') then return '{"result":"uncertain"}'; end if;
  if o.status <> 'waybill_created' then return '{"result":"unavailable"}'; end if;
  if w.id is null or nullif(w.waybill_no,'') is null or w.latest_status <> 'waybill_created'
     or nullif(btrim(o.provider_order_id),'') is null or w.provider_order_id is distinct from o.provider_order_id or w.carrier_key is distinct from o.provider_key
     or o.carrier_connection_id is null or o.connection_environment is null then return '{"result":"unavailable"}'; end if;
  update public.shipping_orders set cancellation=receipt||jsonb_build_object('phase','calling','provider_order_id',o.provider_order_id,
    'waybill',w.waybill_no,'connection_id',o.carrier_connection_id,'environment',o.connection_environment), updated_at=now() where id=o.id;
  return jsonb_build_object('result','dispatch','id',o.id,'provider',o.provider_key,'providerOrderId',o.provider_order_id,
    'connectionId',o.carrier_connection_id,'environment',o.connection_environment,'billingAccountId',o.billing_account_id);
end; $$;

create function public.finish_shipping_cancellation_v1(p_org uuid,p_order uuid,p_attempt uuid,p_outcome text,p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.shipping_orders%rowtype; w public.shipping_waybills%rowtype; phase text; end_phase text;
begin
  if p_outcome is null or p_outcome not in ('accepted','unknown','not_sent','rejected') or p_attempt is null then raise exception 'invalid outcome'; end if;
  select * into o from public.shipping_orders where id=p_order and org_id=p_org for update;
  if not found or o.cancellation->>'attempt' is distinct from p_attempt::text then return 'conflict'; end if;
  phase:=o.cancellation->>'phase';
  if phase<>'calling' then return phase; end if;
  end_phase:=p_outcome;
  if p_outcome='accepted' then
    select * into w from public.shipping_waybills where shipping_order_id=o.id for update;
    if o.status not in ('waybill_created','cancelled') or w.id is null or w.latest_status not in ('waybill_created','cancelled')
      or w.waybill_no is distinct from o.cancellation->>'waybill' then
      end_phase:='manual_review';
    else
      update public.shipping_waybills set latest_status='cancelled',updated_at=now() where id=w.id;
    end if;
  end if;
  update public.shipping_orders set status=case when end_phase='accepted' then 'cancelled' else status end,
    cancellation=cancellation||jsonb_build_object('phase',end_phase,'outcome',p_outcome,'reason',left(coalesce(p_reason,''),400),'received_at',clock_timestamp()),
    updated_at=now() where id=o.id;
  return end_phase;
end; $$;
revoke all on function public.claim_shipping_cancellation_v1(uuid,uuid,text,boolean,uuid,jsonb), public.finish_shipping_cancellation_v1(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.claim_shipping_cancellation_v1(uuid,uuid,text,boolean,uuid,jsonb), public.finish_shipping_cancellation_v1(uuid,uuid,uuid,text,text) to service_role;
