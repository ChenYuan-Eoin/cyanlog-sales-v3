import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261021000008_shipping_order_amendment.sql'),
  'utf8',
)

const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userId = '11111111-1111-4111-8111-111111111111'
const orderId = '22222222-2222-4222-8222-222222222222'
const payload = {
  sender: { name: '寄件人', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '寄件路1号' },
  recipient: { name: '收件人', phone: '13900000000', province: '浙江省', city: '杭州市', county: '西湖区', address: '收件路1号' },
  cargo: '文件',
  weight: 1,
  remark: '',
  source: 'manual',
}

describe('shipping order amendment migration', () => {
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
        created_by uuid references public.users(id),
        employee_profile_id uuid,
        identity_snapshot jsonb default '{}'::jsonb,
        status text not null,
        shipment_payload jsonb not null,
        payload_hash text not null,
        returned_reason text,
        review_notified_at timestamptz,
        next_review_at timestamptz,
        updated_at timestamptz default now()
      );
      create table public.shipping_waybills (
        id uuid primary key default gen_random_uuid(),
        shipping_order_id uuid not null references public.shipping_orders(id)
      );
      insert into public.organizations (id) values ('${orgId}');
      insert into public.users (id) values ('${userId}');
      insert into public.shipping_orders (
        id, org_id, created_by, employee_profile_id, identity_snapshot,
        status, shipment_payload, payload_hash, next_review_at
      ) values (
        '${orderId}', '${orgId}', '${userId}', '33333333-3333-4333-8333-333333333333',
        '{"provider":"wecom","userId":"employee-1"}'::jsonb,
        'returned', '${JSON.stringify(payload)}'::jsonb,
        '${'a'.repeat(64)}', now()
      );
    `)
    await db.exec(migration)
  })

  afterEach(async () => {
    await db.close()
  })

  it('increments revision, clears return state, preserves identity and records before/after payloads', async () => {
    const changed = { ...payload, cargo: '合同', remark: '修改包装' }
    const result = await db.query<{ ok: boolean }>(`
      select public.amend_shipping_order_v1(
        '${userId}', '${orgId}', '${orderId}', 1,
        '${JSON.stringify(changed)}'::jsonb, '${'b'.repeat(64)}', '客户修改地址与货物'
      ) as ok
    `)
    expect(result.rows[0].ok).toBe(true)

    const state = await db.query<{
      revision: number
      status: string
      cargo: string
      created_by: string
      employee_profile_id: string
      identity_snapshot: Record<string, string>
      original_cargo: string
      revision_count: number
    }>(`
      select
        orders.revision,
        orders.status,
        orders.shipment_payload->>'cargo' as cargo,
        orders.created_by,
        orders.employee_profile_id,
        orders.identity_snapshot,
        orders.original_shipment_payload->>'cargo' as original_cargo,
        (select count(*)::int from public.shipping_order_revisions where order_id = orders.id) as revision_count
      from public.shipping_orders as orders
      where orders.id = '${orderId}'
    `)
    expect(state.rows[0]).toEqual({
      revision: 2,
      status: 'awaiting_confirmation',
      cargo: '合同',
      created_by: userId,
      employee_profile_id: '33333333-3333-4333-8333-333333333333',
      identity_snapshot: { provider: 'wecom', userId: 'employee-1' },
      original_cargo: '文件',
      revision_count: 1,
    })
  })

  it('rejects stale revisions and orders that already have a waybill', async () => {
    await db.query(`
      update public.shipping_orders set revision = 2 where id = '${orderId}'
    `)
    await expect(db.query(`
      select public.amend_shipping_order_v1(
        '${userId}', '${orgId}', '${orderId}', 1,
        '${JSON.stringify(payload)}'::jsonb, '${'b'.repeat(64)}', '过期修改'
      )
    `)).rejects.toThrow(/revision conflict/)

    await db.query(`
      update public.shipping_orders set status = 'waybill_created'
      where id = '${orderId}'
    `)
    await db.query(`
      insert into public.shipping_waybills (shipping_order_id) values ('${orderId}')
    `)
    await expect(db.query(`
      select public.amend_shipping_order_v1(
        '${userId}', '${orgId}', '${orderId}', 2,
        '${JSON.stringify(payload)}'::jsonb, '${'b'.repeat(64)}', '已出号修改'
      )
    `)).rejects.toThrow(/frozen|waybill/)
  })
})
