// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, expect, it } from 'vitest'

const org = randomUUID(), actor = randomUUID(), otherOrg = randomUUID(), otherActor = randomUUID()
const originalCreatedAt = '2026-11-18T00:00:00.000Z'
const requestHash = 'a'.repeat(64), payloadHash = 'b'.repeat(64)
const oldPayload = { recipient: { address: '旧地址' } }, newPayload = { recipient: { address: '新地址' } }
const randomOrderNo = () => 'SO-20261125-' + randomBytes(4).toString('hex').toUpperCase()
const migration = (file: string) => readFileSync('supabase/migrations/' + file, 'utf8')
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.users(id uuid primary key);
    create table public.organizations(id uuid primary key);
  `)
  await db.exec(migration('20260922000001_shipping_collaboration_m0.sql'))
  await db.exec(`
    alter table public.shipping_orders
      add column org_id uuid references public.organizations(id),
      add column carrier_connection_id uuid, add column billing_account_id uuid,
      add column connection_environment text,
      add column shipping_config_snapshot jsonb not null default '{}'::jsonb;
  `)
  await db.exec(migration('20261021000008_shipping_order_amendment.sql'))
  await db.exec(migration('20261118101500_shipping_order_cancellation.sql'))
  await db.exec(migration('20261118111500_resubmit_returned_owner_shipment.sql'))
  await db.exec(migration('20261125033920_shipping_owner_resubmit_successor.sql'))
  await db.query('insert into organizations(id) values ($1), ($2)', [org, otherOrg])
  await db.query('insert into users(id) values ($1), ($2)', [actor, otherActor])
}, 30_000)
afterAll(async () => { await db?.close() })

async function returnedOrder(overrides: { status?: string; source?: string; provider?: string; cancellation?: string } = {}) {
  const order = { id: randomUUID(), no: randomOrderNo() }
  await db.query(`
    insert into shipping_orders (id, order_no, org_id, created_by, intake_source, confirmation_policy, status,
      assignment_status, shipment_payload, original_shipment_payload, payload_hash, idempotency_key, receipt_token_hash,
      created_at, provider_order_id, returned_reason, cancellation)
    values ($1, $2, $3, $4, $5, 'scheduled_review', $6, 'unassigned', $7::jsonb, $7::jsonb, $8, $9, $10, $11, $12, '缺少楼层', $13)
  `, [order.id, order.no, org, actor, overrides.source ?? 'owner_web', overrides.status ?? 'returned',
    JSON.stringify(oldPayload), payloadHash, randomUUID(), randomBytes(32).toString('hex'), originalCreatedAt,
    overrides.provider ?? null, overrides.cancellation ?? null])
  return order
}

type Receipt = { orderNo: string; status: string; revision: number; createdAt: string; nextReviewAt: string; resubmittedFrom: string | null; replayed: boolean }

async function resubmit(no: string, args: { key?: string; hash?: string; revision?: number; user?: string; organization?: string; newNo?: string } = {}) {
  const { rows } = await db.query<{ receipt: Receipt | null }>(
    'select resubmit_returned_owner_shipment_v2($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) receipt',
    [args.user ?? actor, args.organization ?? org, no, args.revision ?? 1, args.key ?? randomUUID(),
      args.hash ?? requestHash, JSON.stringify(newPayload), payloadHash, args.newNo ?? randomOrderNo(), randomBytes(32).toString('hex')],
  )
  return rows[0].receipt
}

async function chain(id: string) {
  const { rows } = await db.query(`
    select order_no, status, revision, created_at, next_review_at, shipment_payload, returned_reason, resubmitted_from_id,
      provider_order_id, cancellation, confirmed_by, review_notified_at
    from shipping_orders where id = $1 or resubmitted_from_id = $1 order by created_at desc
  `, [id])
  return rows
}

it('moves review to precisely one new work order and preserves the original history and timestamp', async () => {
  const order = await returnedOrder(), key = randomUUID()
  await db.query('update shipping_orders set confirmed_by=$1, review_notified_at=now() where id=$2', [actor, order.id])
  await db.exec('set role service_role')
  try {
    const receipt = await resubmit(order.no, { key })
    expect(receipt).toMatchObject({ status: 'awaiting_confirmation', revision: 1, resubmittedFrom: order.no, replayed: false })
    expect(receipt?.orderNo).not.toBe(order.no)
    expect(new Date(receipt!.createdAt).valueOf()).toBeGreaterThan(new Date(originalCreatedAt).valueOf())
    expect(receipt?.nextReviewAt).toBe(receipt?.createdAt)
    expect(await resubmit(order.no, { key })).toEqual({ ...receipt, replayed: true })
    await expect(resubmit(order.no, { key, hash: 'c'.repeat(64) })).rejects.toMatchObject({ code: '40001' })
    await expect(resubmit(order.no, { key, revision: 2 })).rejects.toMatchObject({ code: '40001' })
    await expect(resubmit(order.no)).rejects.toMatchObject({ code: '40001' })

    const rows = await chain(order.id)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ order_no: receipt?.orderNo, status: 'awaiting_confirmation', revision: 1,
      shipment_payload: newPayload, resubmitted_from_id: order.id, provider_order_id: null, cancellation: null,
      returned_reason: null, confirmed_by: null, review_notified_at: null })
    expect(rows[1]).toMatchObject({ order_no: order.no, status: 'resubmitted', revision: 1,
      created_at: new Date(originalCreatedAt), shipment_payload: oldPayload, returned_reason: '缺少楼层', confirmed_by: actor })
  } finally { await db.exec('reset role') }
})

it('rejects foreign ownership, old revisions, non-returned records, and carrier or cancellation evidence', async () => {
  const original = await returnedOrder()
  expect(await resubmit(original.no, { user: otherActor })).toBeNull()
  expect(await resubmit(original.no, { organization: otherOrg })).toBeNull()
  await expect(resubmit(original.no, { revision: 2 })).rejects.toMatchObject({ code: '40001' })
  expect(await resubmit((await returnedOrder({ source: 'crm' })).no)).toBeNull()
  for (const order of await Promise.all([
    returnedOrder({ status: 'awaiting_confirmation' }),
    returnedOrder({ provider: 'uncertain-carrier-order' }),
    returnedOrder({ cancellation: '{"phase":"unknown"}' }),
  ])) {
    await expect(resubmit(order.no)).rejects.toMatchObject({ code: '23514' })
    expect(await chain(order.id)).toHaveLength(1)
  }
  await db.query(`
    insert into shipping_waybills (shipping_order_id, carrier_key, waybill_no)
    values ($1, 'sf', 'SF1234567890')
  `, [original.id])
  await expect(resubmit(original.no)).rejects.toMatchObject({ code: '23514' })
  expect(await chain(original.id)).toHaveLength(1)
})

it('leaves the original returned when insertion fails and can retry the same submitted content', async () => {
  const order = await returnedOrder(), key = randomUUID()
  await expect(resubmit(order.no, { key, newNo: order.no })).rejects.toMatchObject({ code: '23505' })
  expect(await chain(order.id)).toMatchObject([{ order_no: order.no, status: 'returned' }])
  expect(await resubmit(order.no, { key })).toMatchObject({ resubmittedFrom: order.no, replayed: false })
})

it('replays a previously successful v1 request without generating or rewriting history', async () => {
  const order = await returnedOrder(), key = randomUUID()
  await db.query('select resubmit_returned_owner_shipment_v1($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
    [actor, org, order.no, 1, key, requestHash, JSON.stringify(newPayload), payloadHash])
  expect(await resubmit(order.no, { key })).toMatchObject({ orderNo: order.no, status: 'awaiting_confirmation',
    revision: 2, resubmittedFrom: null, replayed: true })
  await expect(resubmit(order.no, { key, hash: 'c'.repeat(64) })).rejects.toMatchObject({ code: '40001' })
  expect(await chain(order.id)).toMatchObject([{ order_no: order.no, status: 'awaiting_confirmation', revision: 2 }])
})

it('keeps RPC execution restricted to the server role', async () => {
  const name = 'resubmit_returned_owner_shipment_v2(uuid,uuid,text,integer,uuid,text,jsonb,text,text,text)'
  const { rows } = await db.query(`select has_function_privilege('anon',$1,'execute') anon,
    has_function_privilege('authenticated',$1,'execute') authenticated,
    has_function_privilege('service_role',$1,'execute') service`, [name])
  expect(rows[0]).toEqual({ anon: false, authenticated: false, service: true })
})
