begin;

alter table public.shipping_orders
  drop constraint shipping_orders_status_check,
  add constraint shipping_orders_status_check check (status in (
    'accepted', 'awaiting_confirmation', 'returned', 'resubmitted',
    'confirmed', 'ordering', 'order_unknown', 'waybill_created',
    'in_transit', 'delivered', 'cancelled', 'order_failed'
  )),
  add column resubmitted_from_id uuid references public.shipping_orders(id) on delete restrict,
  add column resubmit_request_key uuid,
  add column resubmit_request_hash text,
  add constraint shipping_orders_resubmit_origin_check check (
    (resubmitted_from_id is null and resubmit_request_key is null and resubmit_request_hash is null)
    or (resubmitted_from_id is not null and resubmitted_from_id <> id and intake_source = 'owner_web'
      and resubmit_request_key is not null and resubmit_request_hash is not null
      and resubmit_request_hash ~ '^[0-9a-f]{64}$')
  );

create unique index shipping_orders_resubmitted_from_idx on public.shipping_orders(resubmitted_from_id)
  where resubmitted_from_id is not null;

create function public.resubmit_returned_owner_shipment_v2(
  p_actor_id uuid, p_org_id uuid, p_order_no text, p_expected_revision integer,
  p_request_key uuid, p_request_hash text, p_shipment_payload jsonb, p_payload_hash text,
  p_new_order_no text, p_receipt_token_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_original public.shipping_orders%rowtype;
  v_successor public.shipping_orders%rowtype;
  v_legacy public.shipping_order_revisions%rowtype;
  v_submitted_at timestamptz;
begin
  if p_actor_id is null or p_org_id is null or p_expected_revision is null or p_expected_revision < 1
    or p_request_key is null or coalesce(p_request_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_payload_hash, '') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_shipment_payload) is distinct from 'object'
    or coalesce(p_new_order_no, '') !~ '^SO-[0-9]{8}-[A-Z0-9]{8}$'
    or coalesce(p_receipt_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid owner resubmission' using errcode = '22023';
  end if;

  select * into v_original from public.shipping_orders
  where org_id = p_org_id and created_by = p_actor_id and order_no = p_order_no
    and intake_source = 'owner_web'
  for update;
  if not found then return null; end if;

  -- Lost v1 receipts must replay without creating a second work order.
  select * into v_legacy from public.shipping_order_revisions
  where order_id = v_original.id and org_id = p_org_id and owner_resubmit_key = p_request_key;
  if found then
    if v_legacy.revision - 1 <> p_expected_revision or v_legacy.owner_resubmit_request_hash <> p_request_hash then
      raise exception 'resubmission key conflict' using errcode = '40001';
    end if;
    return jsonb_build_object('orderNo', v_original.order_no, 'status', v_original.status,
      'revision', v_original.revision, 'createdAt', v_original.created_at,
      'nextReviewAt', v_original.next_review_at, 'resubmittedFrom', null, 'replayed', true);
  end if;

  if v_original.revision <> p_expected_revision then
    raise exception 'shipping order revision conflict' using errcode = '40001';
  end if;
  select * into v_successor from public.shipping_orders
  where resubmitted_from_id = v_original.id and org_id = p_org_id and created_by = p_actor_id;
  if found then
    if v_successor.resubmit_request_key <> p_request_key or v_successor.resubmit_request_hash <> p_request_hash then
      raise exception 'resubmission key conflict' using errcode = '40001';
    end if;
    return jsonb_build_object('orderNo', v_successor.order_no, 'status', v_successor.status,
      'revision', v_successor.revision, 'createdAt', v_successor.created_at,
      'nextReviewAt', v_successor.next_review_at, 'resubmittedFrom', v_original.order_no, 'replayed', true);
  end if;

  if v_original.status <> 'returned' or v_original.provider_order_id is not null
    or (v_original.cancellation is not null and v_original.cancellation->>'phase' is distinct from 'not_sent')
    or exists (select 1 from public.shipping_waybills where shipping_order_id = v_original.id) then
    raise exception 'only returned orders with no carrier dispatch may be resubmitted' using errcode = '23514';
  end if;

  -- Reopen review immediately as v1 did. Use the same DB time for ranking and review.
  v_submitted_at := clock_timestamp();
  insert into public.shipping_orders (
    order_no, org_id, created_by, intake_source, confirmation_policy, status,
    sales_ref, customer_ref, assignment_status, shipment_payload,
    payload_hash, idempotency_key, receipt_token_hash, original_shipment_payload,
    created_at, updated_at, next_review_at, resubmitted_from_id, resubmit_request_key, resubmit_request_hash
  ) values (
    p_new_order_no, v_original.org_id, v_original.created_by, 'owner_web', 'scheduled_review', 'awaiting_confirmation',
    v_original.sales_ref, v_original.customer_ref, v_original.assignment_status, p_shipment_payload,
    p_payload_hash, gen_random_uuid(), p_receipt_token_hash, p_shipment_payload,
    v_submitted_at, v_submitted_at, v_submitted_at, v_original.id, p_request_key, p_request_hash
  ) returning * into v_successor;

  update public.shipping_orders
  set status = 'resubmitted', updated_at = v_submitted_at
  where id = v_original.id;

  return jsonb_build_object('orderNo', v_successor.order_no, 'status', v_successor.status,
    'revision', v_successor.revision, 'createdAt', v_successor.created_at,
    'nextReviewAt', v_successor.next_review_at, 'resubmittedFrom', v_original.order_no, 'replayed', false);
end;
$$;

revoke all on function public.resubmit_returned_owner_shipment_v2(uuid,uuid,text,integer,uuid,text,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function public.resubmit_returned_owner_shipment_v2(uuid,uuid,text,integer,uuid,text,jsonb,text,text,text)
  to service_role;

commit;
