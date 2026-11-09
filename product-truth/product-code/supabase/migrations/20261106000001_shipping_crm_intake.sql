-- WP97: server-to-server CRM intake evidence and atomic create-pending operation.
-- CRM events are explicit records; workflow provenance is not hidden only inside
-- the opaque order payload. This migration performs no migration of existing data.

create table if not exists public.shipping_crm_intake_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  integration_client_id text not null check (length(integration_client_id) between 1 and 80),
  event_key text not null check (event_key ~ '^[0-9a-f]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  enterprise_id text not null check (length(enterprise_id) between 1 and 120),
  workflow_instance_id text not null check (length(workflow_instance_id) between 1 and 160),
  object_api_name text not null check (object_api_name ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  crm_record_id text not null check (length(crm_record_id) between 1 and 160),
  shipment_detail_id text not null check (length(shipment_detail_id) between 1 and 160),
  task_id text not null check (length(task_id) between 1 and 160),
  stage_id text not null check (length(stage_id) between 1 and 160),
  revision_id text not null check (length(revision_id) between 1 and 160),
  applicant_snapshot jsonb not null check (jsonb_typeof(applicant_snapshot) = 'object'),
  customer_snapshot jsonb not null check (jsonb_typeof(customer_snapshot) = 'object'),
  raw_request text not null check (length(raw_request) between 2 and 32768),
  shipping_order_id uuid not null unique references public.shipping_orders(id) on delete restrict,
  replay_count integer not null default 0 check (replay_count >= 0),
  last_replayed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, integration_client_id, event_key)
);

alter table public.shipping_crm_intake_events
  add column if not exists replay_count integer not null default 0,
  add column if not exists last_replayed_at timestamptz;

alter table public.shipping_crm_intake_events
  drop constraint if exists shipping_crm_intake_events_replay_count_check;
alter table public.shipping_crm_intake_events
  add constraint shipping_crm_intake_events_replay_count_check check (replay_count >= 0);

create index if not exists shipping_crm_intake_events_record
  on public.shipping_crm_intake_events(org_id, object_api_name, crm_record_id, created_at desc);
create index if not exists shipping_crm_intake_events_workflow
  on public.shipping_crm_intake_events(org_id, workflow_instance_id, created_at desc);

alter table public.shipping_crm_intake_events enable row level security;
revoke all on public.shipping_crm_intake_events from public, anon, authenticated;
grant select on public.shipping_crm_intake_events to service_role;

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
  p_next_review_at timestamptz
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

  begin
    insert into public.shipping_orders (
      id, order_no, org_id, created_by, intake_source, confirmation_policy, status,
      sales_ref, customer_ref, assignment_status, raw_input, shipment_payload,
      payload_hash, idempotency_key, receipt_token_hash, next_review_at,
      identity_snapshot
    ) values (
      p_order_id, p_order_no, p_org_id, null, 'crm', 'scheduled_review', 'awaiting_confirmation',
      p_applicant_snapshot->>'employeeId', p_customer_snapshot->>'accountId', 'assigned',
      p_raw_input, p_shipment_payload, p_payload_hash, p_idempotency_key,
      p_receipt_token_hash, p_next_review_at,
      jsonb_build_object(
        'provider', 'fxiaoke',
        'integrationClientId', p_integration_client_id,
        'applicant', p_applicant_snapshot
      )
    ) returning * into v_order;

    insert into public.shipping_crm_intake_events (
      org_id, integration_client_id, event_key, payload_hash, enterprise_id,
      workflow_instance_id, object_api_name, crm_record_id, shipment_detail_id,
      task_id, stage_id, revision_id, applicant_snapshot, customer_snapshot,
      raw_request, shipping_order_id
    ) values (
      p_org_id, p_integration_client_id, p_event_key, p_payload_hash, p_enterprise_id,
      p_workflow_instance_id, p_object_api_name, p_crm_record_id, p_shipment_detail_id,
      p_task_id, p_stage_id, p_revision_id, p_applicant_snapshot, p_customer_snapshot,
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

create or replace function public.replay_shipping_crm_intake(
  p_org_id uuid,
  p_integration_client_id text,
  p_event_key text,
  p_payload_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.shipping_crm_intake_events%rowtype;
  v_order public.shipping_orders%rowtype;
  v_waybill_no text;
begin
  if p_event_key !~ '^[0-9a-f]{64}$' or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid CRM intake hash' using errcode = '22023';
  end if;

  select * into v_event
    from public.shipping_crm_intake_events
   where org_id = p_org_id
     and integration_client_id = p_integration_client_id
     and event_key = p_event_key
   for update;
  if not found then
    raise exception 'CRM_INTAKE_EVENT_NOT_FOUND' using errcode = 'P0002';
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
end;
$$;

revoke all on function public.create_shipping_crm_intake(
  uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.create_shipping_crm_intake(
  uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text,timestamptz
) to service_role;

revoke all on function public.replay_shipping_crm_intake(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.replay_shipping_crm_intake(uuid,text,text,text)
  to service_role;

comment on table public.shipping_crm_intake_events is
  'WP97 immutable CRM event identity and applicant/customer evidence linked one-to-one with a shipping order; replay counters prove exact duplicate handling without creating another order.';
comment on function public.create_shipping_crm_intake(
  uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text,timestamptz
) is
  'Atomically create one awaiting_confirmation CRM order and its explicit event evidence; idempotent by event key.';
comment on function public.replay_shipping_crm_intake(uuid,text,text,text) is
  'Audited exact replay of an existing CRM event; increments replay_count and returns the original order without creating another row.';
