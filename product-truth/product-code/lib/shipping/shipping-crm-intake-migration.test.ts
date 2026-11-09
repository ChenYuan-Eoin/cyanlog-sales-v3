// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261106000001_shipping_crm_intake.sql'), 'utf8')
const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const firstOrderId = '22222222-2222-4222-8222-222222222222'
const secondOrderId = '33333333-3333-4333-8333-333333333333'
const idempotencyKey = '44444444-4444-5444-8444-444444444444'
const eventKey = 'a'.repeat(64)
const payloadHash = 'b'.repeat(64)
const payload = {
  sender: { name: '寄件中心', phone: '13800000000', province: '上海市', city: '上海市', county: '浦东新区', address: '张江路88号' },
  recipient: { name: '收件人', phone: '13900000000', province: '浙江省', city: '杭州市', county: '西湖区', address: '文三路1号' },
  cargo: '合同', weight: 1, source: 'manual', remark: '', payment: 'sender_monthly', customerName: '客户公司',
  submittedBy: { name: '销售', phone: '13700000000', team: '销售部' },
}
const applicant = { employeeId: 'sales-1093', name: '销售', phone: '13700000000', departmentId: 'dept-1', departmentName: '销售部' }
const customer = { accountId: 'account-1', name: '客户公司' }

function callSql(args: { orderId: string; orderNo: string; hash?: string } = { orderId: firstOrderId, orderNo: 'SO-20261106-ABC12345' }) {
  return `
    select public.create_shipping_crm_intake(
      '${args.orderId}'::uuid,
      '${args.orderNo}',
      '${orgId}'::uuid,
      '${idempotencyKey}'::uuid,
      'fxiaoke-prod',
      '${eventKey}',
      '${args.hash || payloadHash}',
      'ea-cyanlog',
      'instance-1',
      'ContractObj',
      'record-1',
      'detail-1',
      'task-1',
      'stage-approved',
      'revision-1',
      '${JSON.stringify(applicant)}'::jsonb,
      '${JSON.stringify(customer)}'::jsonb,
      '${JSON.stringify(payload)}'::jsonb,
      '原始审批寄件文本',
      '${JSON.stringify({ event: 'workflow-approved', source: 'test' })}',
      '${'c'.repeat(64)}',
      '2026-11-06T03:00:00Z'::timestamptz
    ) as result
  `
}

function replaySql(hash = payloadHash) {
  return `
    select public.replay_shipping_crm_intake(
      '${orgId}'::uuid,
      'fxiaoke-prod',
      '${eventKey}',
      '${hash}'
    ) as result
  `
}

describe('CRM shipping intake migration', () => {
  let db: PGlite

  beforeEach(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.organizations (id uuid primary key);
      create table public.users (id uuid primary key);
      create table public.shipping_orders (
        id uuid primary key,
        org_id uuid not null references public.organizations(id),
        order_no text not null unique,
        created_by uuid references public.users(id),
        intake_source text not null,
        confirmation_policy text not null,
        status text not null,
        sales_ref text,
        customer_ref text,
        assignment_status text not null,
        raw_input text,
        shipment_payload jsonb not null,
        payload_hash text not null,
        idempotency_key uuid not null,
        receipt_token_hash text not null unique,
        next_review_at timestamptz,
        identity_snapshot jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        unique (intake_source, idempotency_key)
      );
      create table public.shipping_waybills (
        id uuid primary key default gen_random_uuid(),
        shipping_order_id uuid not null unique references public.shipping_orders(id),
        waybill_no text not null,
        provider_order_id text
      );
      insert into public.organizations (id) values ('${orgId}');
    `)
    await db.exec(migration)
  })

  afterEach(async () => {
    await db.close()
  })

  it('atomically creates one awaiting-confirmation order with explicit CRM evidence', async () => {
    const result = await db.query<{ result: { created: boolean; order_id: string; status: string } }>(callSql())
    expect(result.rows[0].result).toMatchObject({ created: true, order_id: firstOrderId, status: 'awaiting_confirmation' })

    const state = await db.query<{
      intake_source: string
      status: string
      sales_ref: string
      customer_ref: string
      identity_snapshot: Record<string, unknown>
      event_count: number
      replay_count: number
      last_replayed_at: string | null
      workflow_instance_id: string
      applicant_employee_id: string
      customer_account_id: string
      raw_request: string
    }>(`
      select
        orders.intake_source,
        orders.status,
        orders.sales_ref,
        orders.customer_ref,
        orders.identity_snapshot,
        (select count(*)::int from public.shipping_crm_intake_events) as event_count,
        events.replay_count,
        events.last_replayed_at,
        events.workflow_instance_id,
        events.applicant_snapshot->>'employeeId' as applicant_employee_id,
        events.customer_snapshot->>'accountId' as customer_account_id,
        events.raw_request
      from public.shipping_orders as orders
      join public.shipping_crm_intake_events as events on events.shipping_order_id = orders.id
      where orders.id = '${firstOrderId}'
    `)
    expect(state.rows[0]).toMatchObject({
      intake_source: 'crm',
      status: 'awaiting_confirmation',
      sales_ref: 'sales-1093',
      customer_ref: 'account-1',
      event_count: 1,
      replay_count: 0,
      last_replayed_at: null,
      workflow_instance_id: 'instance-1',
      applicant_employee_id: 'sales-1093',
      customer_account_id: 'account-1',
      raw_request: JSON.stringify({ event: 'workflow-approved', source: 'test' }),
      identity_snapshot: { provider: 'fxiaoke', integrationClientId: 'fxiaoke-prod', applicant },
    })
  })

  it('returns the original order for an exact event replay and rejects changed content', async () => {
    await db.query(callSql())
    const replay = await db.query<{ result: { created: boolean; order_id: string } }>(callSql({ orderId: secondOrderId, orderNo: 'SO-20261106-REPLAY01' }))
    expect(replay.rows[0].result).toMatchObject({ created: false, order_id: firstOrderId })

    await db.exec(`
      update public.shipping_orders set status = 'waybill_created' where id = '${firstOrderId}';
      insert into public.shipping_waybills (shipping_order_id, waybill_no, provider_order_id)
      values ('${firstOrderId}', 'SF1234567890123', 'provider-order-1');
    `)
    const auditedReplay = await db.query<{ result: { created: boolean; order_id: string; status: string; waybill_no: string | null } }>(replaySql())
    expect(auditedReplay.rows[0].result).toMatchObject({ created: false, order_id: firstOrderId, status: 'waybill_created', waybill_no: 'SF1234567890123' })

    const counts = await db.query<{ orders: number; events: number; replay_count: number; last_replayed_at: string | null }>(`
      select
        (select count(*)::int from public.shipping_orders) as orders,
        (select count(*)::int from public.shipping_crm_intake_events) as events,
        (select replay_count from public.shipping_crm_intake_events limit 1) as replay_count,
        (select last_replayed_at::text from public.shipping_crm_intake_events limit 1) as last_replayed_at
    `)
    expect(counts.rows[0]).toMatchObject({ orders: 1, events: 1, replay_count: 2 })
    expect(counts.rows[0].last_replayed_at).toBeTruthy()

    await expect(db.query(callSql({ orderId: secondOrderId, orderNo: 'SO-20261106-CONFLICT', hash: 'd'.repeat(64) }))).rejects.toThrow(/CRM_INTAKE_PAYLOAD_CONFLICT/)
    await expect(db.query(replaySql('d'.repeat(64)))).rejects.toThrow(/CRM_INTAKE_PAYLOAD_CONFLICT/)
    const afterConflict = await db.query<{ orders: number; events: number }>(`
      select
        (select count(*)::int from public.shipping_orders) as orders,
        (select count(*)::int from public.shipping_crm_intake_events) as events
    `)
    expect(afterConflict.rows[0]).toEqual({ orders: 1, events: 1 })
  })
})
