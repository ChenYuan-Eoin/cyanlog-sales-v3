-- WP97: keep applicant and salesperson separate; reserve one order per CRM shipment.
-- Additive evidence only: existing orders and identity/permission settings are untouched.
-- A duplicate historical logical shipment makes this migration fail for review.

alter table public.shipping_crm_intake_events
  add column if not exists sales_snapshot jsonb
  check (sales_snapshot is null or (jsonb_typeof(sales_snapshot) = 'object'
    and nullif(btrim(sales_snapshot->>'employeeId'), '') is not null));

create unique index if not exists shipping_crm_intake_logical_shipment
  on public.shipping_crm_intake_events
    (org_id, enterprise_id, object_api_name, crm_record_id, shipment_detail_id);

-- Replace the old overload atomically. The new last argument is optional, so
-- existing callers remain valid; PostgREST sees only one function signature.
drop function if exists public.create_shipping_crm_intake(uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text,timestamptz);

create or replace function public.create_shipping_crm_intake(
  p_order_id uuid,
  p_order_no text,
  p_org_id uuid,
  p_idempotency_key uuid,
  p_integration_client_id text,
  p_event_key text,
  p_payload_hash text,
  p_enterprise_id text,
  p_workflow_instance_id text,
  p_object_api_name text,
  p_crm_record_id text,
  p_shipment_detail_id text,
  p_task_id text,
  p_stage_id text,
  p_revision_id text,
  p_applicant_snapshot jsonb,
  p_customer_snapshot jsonb,
  p_shipment_payload jsonb,
  p_raw_input text,
  p_raw_request text,
  p_receipt_token_hash text,
  p_next_review_at timestamptz,
  p_sales_snapshot jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.shipping_orders%rowtype;
  v_event public.shipping_crm_intake_events%rowtype;
  v_waybill_no text;
  v_created boolean := false;
begin
  if p_event_key !~ '^[0-9a-f]{64}$' or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid CRM intake hash' using errcode = '22023';
  end if;

  if p_sales_snapshot is not null and (jsonb_typeof(p_sales_snapshot) <> 'object'
      or nullif(btrim(p_sales_snapshot->>'employeeId'), '') is null) then
    raise exception 'invalid CRM sales identity' using errcode = '22023';
  end if;

  select * into v_event
    from public.shipping_crm_intake_events
   where org_id = p_org_id
     and integration_client_id = p_integration_client_id
     and event_key = p_event_key
   for update;

  if found then
    if v_event.payload_hash <> p_payload_hash then
      raise exception 'CRM_INTAKE_PAYLOAD_CONFLICT' using errcode = 'P0001';
    end if;
    update public.shipping_crm_intake_events
       set replay_count = replay_count + 1,
           last_replayed_at = now()
     where id = v_event.id;
    select * into v_order
      from public.shipping_orders
     where id = v_event.shipping_order_id
       and org_id = p_org_id;
    if not found then
      raise exception 'CRM intake evidence points to a missing order' using errcode = '23503';
    end if;
    select waybill_no into v_waybill_no
      from public.shipping_waybills
     where shipping_order_id = v_order.id
     limit 1;
    return jsonb_build_object(
      'created', false,
      'order_id', v_order.id,
      'order_no', v_order.order_no,
      'status', v_order.status,
      'waybill_no', v_waybill_no
    );
  end if;

  -- Task, workflow, revision, stage and client rotation do not create a new parcel.
  select * into v_event
    from public.shipping_crm_intake_events
   where org_id = p_org_id and enterprise_id = p_enterprise_id
     and object_api_name = p_object_api_name and crm_record_id = p_crm_record_id
     and shipment_detail_id = p_shipment_detail_id;
  if found then
    raise exception 'CRM_SHIPMENT_ALREADY_INTAKEN' using errcode = 'P0001',
      detail = jsonb_build_object('orderId', v_event.shipping_order_id)::text;
  end if;

  begin
    insert into public.shipping_orders (
      id, order_no, org_id, created_by, intake_source, confirmation_policy, status,
      sales_ref, customer_ref, assignment_status, raw_input, shipment_payload,
      payload_hash, idempotency_key, receipt_token_hash, next_review_at,
      identity_snapshot
    ) values (
      p_order_id, p_order_no, p_org_id, null, 'crm', 'scheduled_review', 'awaiting_confirmation',
      p_sales_snapshot->>'employeeId', p_customer_snapshot->>'accountId',
      case when p_sales_snapshot is null then 'unassigned' else 'assigned' end,
      p_raw_input, p_shipment_payload, p_payload_hash, p_idempotency_key,
      p_receipt_token_hash, p_next_review_at,
      jsonb_build_object(
        'provider', 'fxiaoke',
        'integrationClientId', p_integration_client_id,
        'applicant', p_applicant_snapshot,
        'sales', p_sales_snapshot
      )
    ) returning * into v_order;

    insert into public.shipping_crm_intake_events (
      org_id, integration_client_id, event_key, payload_hash, enterprise_id,
      workflow_instance_id, object_api_name, crm_record_id, shipment_detail_id,
      task_id, stage_id, revision_id, applicant_snapshot, customer_snapshot, sales_snapshot,
      raw_request, shipping_order_id
    ) values (
      p_org_id, p_integration_client_id, p_event_key, p_payload_hash, p_enterprise_id,
      p_workflow_instance_id, p_object_api_name, p_crm_record_id, p_shipment_detail_id,
      p_task_id, p_stage_id, p_revision_id, p_applicant_snapshot, p_customer_snapshot, p_sales_snapshot,
      p_raw_request, v_order.id
    );

    v_created := true;
  exception when unique_violation then
    -- A concurrent retry won the unique event/order insert. Its transaction is
    -- authoritative; recover that exact event after the failed subtransaction.
    select * into v_event
      from public.shipping_crm_intake_events
     where org_id = p_org_id
       and integration_client_id = p_integration_client_id
       and event_key = p_event_key
     for update;
    if not found then
      -- The logical-shipment constraint may win before this event is inserted.
      select * into v_event
        from public.shipping_crm_intake_events
       where org_id = p_org_id and enterprise_id = p_enterprise_id
         and object_api_name = p_object_api_name and crm_record_id = p_crm_record_id
         and shipment_detail_id = p_shipment_detail_id;
      if found then
        raise exception 'CRM_SHIPMENT_ALREADY_INTAKEN' using errcode = 'P0001',
          detail = jsonb_build_object('orderId', v_event.shipping_order_id)::text;
      end if;
      raise;
    end if;
    if v_event.payload_hash <> p_payload_hash then
      raise exception 'CRM_INTAKE_PAYLOAD_CONFLICT' using errcode = 'P0001';
    end if;
    update public.shipping_crm_intake_events
       set replay_count = replay_count + 1,
           last_replayed_at = now()
     where id = v_event.id;
    select * into v_order
      from public.shipping_orders
     where id = v_event.shipping_order_id
       and org_id = p_org_id;
    if not found then
      raise exception 'CRM intake evidence points to a missing order' using errcode = '23503';
    end if;
    v_created := false;
  end;

  if not v_created then
    select waybill_no into v_waybill_no
      from public.shipping_waybills
     where shipping_order_id = v_order.id
     limit 1;
  end if;
  return jsonb_build_object(
    'created', v_created,
    'order_id', v_order.id,
    'order_no', v_order.order_no,
    'status', v_order.status,
    'waybill_no', v_waybill_no
  );
end;
$$;

revoke all on function public.create_shipping_crm_intake(uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text,timestamptz,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_shipping_crm_intake(uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text,timestamptz,jsonb) to service_role;

comment on column public.shipping_crm_intake_events.sales_snapshot is
  'Explicit CRM salesperson attribution, independent of the workflow applicant; NULL means not provided, not inferred.';
comment on index public.shipping_crm_intake_logical_shipment is
  'A CRM shipment detail keeps one original order across workflow restarts, revisions, nodes and client rotation. A second parcel requires a distinct shipment detail.';
