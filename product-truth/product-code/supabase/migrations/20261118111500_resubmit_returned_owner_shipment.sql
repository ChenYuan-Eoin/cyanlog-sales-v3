begin;

alter table public.shipping_order_revisions
  add column owner_resubmit_key uuid,
  add column owner_resubmit_request_hash text,
  add constraint shipping_order_revisions_owner_resubmit_check check (
    (owner_resubmit_key is null and owner_resubmit_request_hash is null) or
    (owner_resubmit_key is not null and owner_resubmit_request_hash is not null
      and owner_resubmit_request_hash ~ '^[0-9a-f]{64}$')
  );

create unique index shipping_order_revisions_owner_resubmit_key
  on public.shipping_order_revisions(order_id, owner_resubmit_key)
  where owner_resubmit_key is not null;

create function public.resubmit_returned_owner_shipment_v1(
  p_actor_id uuid, p_org_id uuid, p_order_no text, p_expected_revision integer,
  p_request_key uuid, p_request_hash text, p_shipment_payload jsonb, p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_order public.shipping_orders%rowtype;
  v_revision public.shipping_order_revisions%rowtype;
begin
  if p_expected_revision is null or p_expected_revision < 1 or p_request_key is null
    or coalesce(p_request_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_payload_hash, '') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_shipment_payload) is distinct from 'object' then
    raise exception 'invalid owner resubmission' using errcode = '22023';
  end if;

  select * into v_order from public.shipping_orders
  where org_id = p_org_id and order_no = p_order_no
    and created_by = p_actor_id and intake_source = 'owner_web'
  for update;
  if not found then return null; end if;

  select * into v_revision from public.shipping_order_revisions
  where order_id = v_order.id and owner_resubmit_key = p_request_key;
  if found then
    if v_revision.revision - 1 <> p_expected_revision or v_revision.owner_resubmit_request_hash <> p_request_hash then
      raise exception 'resubmission key conflict' using errcode = '40001';
    end if;
    return jsonb_build_object('orderNo', v_order.order_no, 'status', v_order.status, 'revision', v_order.revision, 'replayed', true);
  end if;

  if v_order.revision <> p_expected_revision then
    raise exception 'shipping order revision conflict' using errcode = '40001';
  end if;
  if v_order.status <> 'returned' then
    raise exception 'only returned orders may be resubmitted' using errcode = '23514';
  end if;

  -- The existing amendment verifies the waybill freeze, records both snapshots
  -- and reopens review under the same order lock.
  if not public.amend_shipping_order_v1(p_actor_id, p_org_id, v_order.id, v_order.revision,
    p_shipment_payload, p_payload_hash, '提报人修改后重提') then
    raise exception 'shipping order revision conflict' using errcode = '40001';
  end if;
  update public.shipping_order_revisions
    set owner_resubmit_key = p_request_key, owner_resubmit_request_hash = p_request_hash
    where order_id = v_order.id and revision = v_order.revision + 1;
  if not found then
    raise exception 'missing shipping revision' using errcode = '40001';
  end if;

  return jsonb_build_object('orderNo', v_order.order_no, 'status', 'awaiting_confirmation', 'revision', v_order.revision + 1, 'replayed', false);
end;
$$;

revoke all on function public.resubmit_returned_owner_shipment_v1(uuid,uuid,text,integer,uuid,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.resubmit_returned_owner_shipment_v1(uuid,uuid,text,integer,uuid,text,jsonb,text)
  to service_role;

commit;
