// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { ShippingInput } from './types'
const mocks = vi.hoisted(() => ({ from: vi.fn(), recipients: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('./operator-access', () => ({ listShippingOperatorRecipients: mocks.recipients }))
import { assignShipmentRelation, createAnonymousShipment, createOwnerShipment, createDueShipmentReviewReminders, listShipmentLedger, listEmployeeShipmentReceipts, listOwnerShipmentReceipts, listPublicShipmentReceipts } from './collaboration'

type Row = Record<string, unknown>
let tables: Record<string, Row[]>
const input: ShippingInput = { sender: { name: '示例前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '示例路1号' }, recipient: { name: '示例收件人', phone: '13800000001', province: '上海市', city: '上海市', county: '浦东新区', address: '示例路2号' }, cargo: '文件', weight: 1, remark: '', source: 'manual' }
function row(id: string, org_id: string | null): Row { return { id, org_id, order_no: id, intake_source: 'anonymous_web', confirmation_policy: 'scheduled_review', status: 'awaiting_confirmation', sales_ref: null, customer_ref: null, assignment_status: 'unassigned', shipment_payload: input, payload_hash: createHash('sha256').update(JSON.stringify(input)).digest('hex'), created_at: '2026-09-27T00:00:00Z', next_review_at: '2026-09-27T01:00:00Z', review_notified_at: null } }

function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let patch: Row | undefined, inserts: Row[] | undefined
  let bounds: [number,number] | undefined
  const ordering: Array<{key:string;ascending:boolean}> = []
  const finish = (single = false) => {
    const data = tables[table] ||= []
    if (inserts) {
      if (table === 'shipping_orders' && inserts.some(item => data.some(old => old.intake_source === item.intake_source && old.idempotency_key === item.idempotency_key))) return { data: null, error: { code: '23505' } }
      for (const item of inserts) data.push({ id: `new-${data.length}`, created_at: new Date().toISOString(), ...item })
      const added = data.slice(-inserts.length)
      return { data: single ? added[0] : added, error: null }
    }
    let matched = data.filter(item => filters.every(filter => filter(item)))
    if (ordering.length) matched.sort((a,b) => { for (const {key,ascending} of ordering) { const diff=String(a[key]).localeCompare(String(b[key])); if(diff)return ascending?diff:-diff } return 0 })
    if (bounds) matched=matched.slice(bounds[0],bounds[1]+1)
    if (patch) matched.forEach(item => Object.assign(item, patch))
    return { data: single ? matched[0] || null : matched, error: null }
  }
  const builder = {
    select: vi.fn(() => builder),
    eq: (key: string, value: unknown) => { filters.push(item => item[key] === value); return builder },
    is: (key: string, value: unknown) => { filters.push(item => item[key] === value); return builder },
    in: (key: string, values: unknown[]) => { filters.push(item => values.includes(item[key])); return builder },
    lte: (key: string, value: string) => { filters.push(item => String(item[key]) <= value); return builder },
    gte: (key: string, value: string) => { filters.push(item => String(item[key]) >= value); return builder },
    lt: (key: string, value: string) => { filters.push(item => String(item[key]) < value); return builder },
    order: (key:string,{ascending}:{ascending:boolean}) => {ordering.push({key,ascending});return builder}, limit: () => builder,
    range: (from:number,to:number) => {bounds=[from,to];return builder},
    update: (value: Row) => { patch = value; return builder },
    insert: (value: Row | Row[]) => { inserts = Array.isArray(value) ? value : [value]; return builder },
    single: async () => finish(true), maybeSingle: async () => finish(true),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(finish()).then(resolve),
  }
  return builder
}
beforeEach(() => {
  tables = { shipping_orders: [row('A-order', 'org-A'), row('B-order', 'org-B'), row('legacy-order', null)], reminders: [] }
  mocks.from.mockReset().mockImplementation(query)
  mocks.recipients.mockReset().mockResolvedValue([{ userId: 'operator-A', orgId: 'org-A' }, { userId: 'operator-B', orgId: 'org-B' }])
  vi.stubEnv('SHIPPING_RECEIPT_SECRET', 's'.repeat(32))
})
afterEach(() => vi.unstubAllEnvs())

describe('shipping collaboration organization boundary', () => {
  it('returns only the authorized organization and excludes legacy unassigned orders', async () => {
    const records = await listShipmentLedger('org-A', { limit: 50 })
    expect(records.map(item => item.id)).toEqual(['A-order'])
  })
  it('returns saved carrier status and events for the authorized ledger', async () => {
    const at = '2026-11-20T10:41:16.000Z'
    const waybill = {
      waybill_no: 'SF5169741550975', latest_status: 'delivered', latest_event_at: at,
      shipping_tracking_events: [{ event_at: at, status: 'delivered', description: '已签收', location: null }],
    }
    Object.assign(tables.shipping_orders[0], { status: 'in_transit', shipping_waybills: [waybill] })
    const records = await listShipmentLedger('org-A', { limit: 50 })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ status: 'delivered', trackingStatus: 'delivered', trackingUpdatedAt: at,
      trackingEvents: [{ time: at, status: 'delivered', description: '已签收', location: '' }] })
  })
  it('filters by submission time before paginating and breaks equal-time ties by ID', async () => {
    tables.shipping_orders = [
      { ...row('C-order', 'org-A'), created_at: '2026-11-18T08:00:00.000Z' },
      { ...row('B-order', 'org-A'), created_at: '2026-11-18T08:00:00.000Z' },
      { ...row('A-order', 'org-A'), created_at: '2026-11-17T16:00:00.000Z' },
      { ...row('future', 'org-A'), created_at: '2026-11-18T16:00:00.000Z' },
      { ...row('past', 'org-A'), created_at: '2026-11-17T15:59:59.999Z' },
      { ...row('foreign', 'org-B'), created_at: '2026-11-18T08:30:00.000Z' },
    ]
    const filters = { limit: 2, submittedFrom: '2026-11-17T16:00:00.000Z', submittedBefore: '2026-11-18T16:00:00.000Z' }
    expect((await listShipmentLedger('org-A', { ...filters, page: 0 })).map(item => item.id)).toEqual(['C-order', 'B-order', 'A-order'])
    expect((await listShipmentLedger('org-A', { ...filters, page: 1 })).map(item => item.id)).toEqual(['A-order'])
  })
  it('does not assign a foreign or unassigned order to the caller', async () => {
    await expect(assignShipmentRelation('B-order', 'org-A', 'new-sales')).rejects.toThrow()
    await expect(assignShipmentRelation('legacy-order', 'org-A', 'new-sales')).rejects.toThrow()
    expect(tables.shipping_orders[1].sales_ref).toBeNull()
    expect(tables.shipping_orders[2].org_id).toBeNull()
  })
  it('isolates employee keys and preserves retries after profile edits', async () => {
    const employee = { id: 'employee-A', sender: input.sender, team: input.submittedBy?.team || '团队' }
    const employeeInput = { ...input, submittedBy: { name: employee.sender.name, phone: employee.sender.phone, team: employee.team } }
    const first = await createAnonymousShipment({ orgId: 'org-A', key: 'same-key', input: employeeInput, employee })
    const retry = await createAnonymousShipment({ orgId: 'org-A', key: 'same-key', input: employeeInput, employee: { ...employee, sender: { ...employee.sender, address: '修改后的新地址' } } })
    expect(retry.order.id).toBe(first.order.id)
    expect(retry.receiptToken).toBe(first.receiptToken)
    const other = await createAnonymousShipment({ orgId: 'org-A', key: 'same-key', input: employeeInput, employee: { ...employee, id: 'employee-B' } })
    expect(other.order.id).not.toBe(first.order.id)
    expect(other.receiptToken).not.toBe(first.receiptToken)
    expect(tables.shipping_orders.at(-1)?.employee_profile_id).toBe('employee-B')
    const own = await listEmployeeShipmentReceipts('org-A', 'employee-A')
    expect(own.map(order => order.orderNo)).toEqual([first.order.orderNo])
    expect(await listEmployeeShipmentReceipts('org-B', 'employee-A')).toEqual([])
    await expect(createAnonymousShipment({ orgId: 'org-A', key: 'new-key', input: employeeInput, employee: { ...employee, sender: { ...employee.sender, name: '另一个人' } } })).rejects.toMatchObject({ status: 409 })
  })
  it('binds new anonymous submissions to the server-resolved organization', async () => {
    await createAnonymousShipment({ orgId: 'org-A', key: 'anonymous-key', input })
    expect(tables.shipping_orders.at(-1)?.org_id).toBe('org-A')
  })
  it('does not expose an anonymous receipt from another organization on a reused key', async () => {
    await createAnonymousShipment({ orgId: 'org-A', key: 'same-key', input })
    await expect(createAnonymousShipment({ orgId: 'org-B', key: 'same-key', input })).rejects.toMatchObject({ status: 409 })
  })
  it('preserves anonymous retry receipts within the original organization', async () => {
    const first = await createAnonymousShipment({ orgId: 'org-A', key: 'repeat-key', input })
    const retry = await createAnonymousShipment({ orgId: 'org-A', key: 'repeat-key', input })
    expect(retry.receiptToken).toBe(first.receiptToken)
    expect(retry.order.id).toBe(first.order.id)
    expect(tables.shipping_orders.filter(item => item.idempotency_key === 'repeat-key')).toHaveLength(1)
  })
  it('does not expose an owner order to another user reusing its key', async () => {
    await createOwnerShipment({ orgId: 'org-A', userId: 'owner-A', key: 'same-owner-key', input })
    await expect(createOwnerShipment({ orgId: 'org-A', userId: 'owner-B', key: 'same-owner-key', input })).rejects.toMatchObject({ status: 409 })
    await expect(createOwnerShipment({ orgId: 'org-B', userId: 'owner-A', key: 'same-owner-key', input })).rejects.toMatchObject({ status: 409 })
  })
  it('creates only a reviewable work order without carrier bindings', async () => {
    const order = await createOwnerShipment({ orgId: 'org-A', userId: 'owner-A', key: 'intake-key', input })
    expect(order).toMatchObject({ status: 'awaiting_confirmation', confirmationPolicy: 'scheduled_review', waybill: null })
    expect(tables.shipping_orders.at(-1)).toMatchObject({ org_id: 'org-A', created_by: 'owner-A', carrier_connection_id: null, billing_account_id: null, connection_environment: null, shipping_config_snapshot: {} })
    expect(mocks.from.mock.calls.every(([table]) => table === 'shipping_orders')).toBe(true)
  })
  it('retrieves the original work order and sender when company defaults change after a lost response', async () => {
    const first = await createOwnerShipment({ orgId: 'org-A', userId: 'owner-A', key: 'stable-intake-key', input, usesDefaultSender: true })
    const retry = await createOwnerShipment({ orgId: 'org-A', userId: 'owner-A', key: 'stable-intake-key', input: { ...input, sender: { ...input.sender, address: '更改后的示例路9号' } }, usesDefaultSender: true })
    expect(retry.id).toBe(first.id)
    expect(retry.input.sender).toEqual(input.sender)
    expect(tables.shipping_orders.filter(item => item.idempotency_key === 'stable-intake-key')).toHaveLength(1)
    await expect(createOwnerShipment({ orgId: 'org-A', userId: 'owner-A', key: 'stable-intake-key', input: { ...input, recipient: { ...input.recipient, name: '另一位示例收件人' } }, usesDefaultSender: true })).rejects.toMatchObject({ status: 409 })
  })
  it('binds the original creation key to its original input after an owner revision', async () => {
    const args = { orgId: 'org-A', userId: 'owner-A', key: 'old-create-key', input }
    const first = await createOwnerShipment(args)
    const stored = tables.shipping_orders.find(item => item.id === first.id)!
    tables.shipping_order_revisions = [{ order_id: first.id, org_id: 'org-A', revision: 2, before_payload_hash: stored.payload_hash }]
    const amended = { ...input, cargo: '合同' }
    Object.assign(stored, { revision: 2, shipment_payload: amended, payload_hash: createHash('sha256').update(JSON.stringify(amended)).digest('hex') })
    await expect(createOwnerShipment(args)).resolves.toMatchObject({ id: first.id, revision: 2, input: amended })
    await expect(createOwnerShipment({ ...args, input: amended })).rejects.toMatchObject({ status: 409 })
    expect(tables.shipping_orders.filter(order => order.idempotency_key === args.key)).toHaveLength(1)
  })
  it('returns the current state of a previously submitted work order without resetting or recreating it', async () => {
    const first = await createOwnerShipment({ orgId: 'org-A', userId: 'owner-A', key: 'finished-intake-key', input })
    const stored = tables.shipping_orders.find(item => item.id === first.id)!
    stored.status = 'waybill_created'
    stored.shipping_waybills = [{ waybill_no: 'SF1234567890123' }]
    const repeated = await createOwnerShipment({ orgId: 'org-A', userId: 'owner-A', key: 'finished-intake-key', input })
    expect(repeated).toMatchObject({ id: first.id, status: 'waybill_created', waybill: 'SF1234567890123' })
    expect(tables.shipping_orders.filter(item => item.idempotency_key === 'finished-intake-key')).toHaveLength(1)
  })
  it('groups reminders by organization without exposing other order numbers', async () => {
    expect(await createDueShipmentReviewReminders(new Date('2026-09-27T12:00:00Z'))).toEqual({ orders: 2, reminders: 2 })
    const a = tables.reminders.find(item => item.org_id === 'org-A')!
    const b = tables.reminders.find(item => item.org_id === 'org-B')!
    expect(a.description).toContain('A-order'); expect(a.description).not.toContain('B-order')
    expect(b.description).toContain('B-order'); expect(b.description).not.toContain('A-order')
    expect(tables.shipping_orders[2].review_notified_at).toBeNull()
  })
})

it('pages every source and employee in one organization with only public receipt fields',async()=>{
 tables.shipping_orders=[...Array.from({length:53},(_,i)=>({...row(`A-${String(i).padStart(3,'0')}`,'org-A'),employee_profile_id:`employee-${i}`,intake_source:i%2?'crm':'owner',shipping_waybills:[{waybill_no:`SF-${i}`}]})),row('B-order','org-B'),row('legacy',null)]
 const first=await listPublicShipmentReceipts('org-A',0),second=await listPublicShipmentReceipts('org-A',1)
 expect(first.orders).toHaveLength(50);expect(first.nextPage).toBe(1)
 expect(second.orders).toHaveLength(3);expect(second.nextPage).toBeNull()
 expect(new Set([...first.orders,...second.orders].map(o=>o.orderNo)).size).toBe(53)
 expect(first.orders[0]).toEqual({orderNo:'A-052',status:'awaiting_confirmation',waybill:'SF-52',createdAt:'2026-09-27T00:00:00Z',nextReviewAt:'2026-09-27T01:00:00Z',customerName:null})
 expect((await listPublicShipmentReceipts('org-A',2)).orders).toEqual([])
 await expect(listPublicShipmentReceipts('',0)).rejects.toMatchObject({status:403})
})

it('includes only the submitted customer name alongside public receipt fields',async()=>{
 tables.shipping_orders=[{...row('customer-order','org-A'),customer_name:'  星河科技  ',customer_ref:'CRM-CUSTOMER-ID'}]
 const {orders}=await listPublicShipmentReceipts('org-A')
 expect(orders[0]).toEqual({orderNo:'customer-order',status:'awaiting_confirmation',waybill:null,createdAt:'2026-09-27T00:00:00Z',nextReviewAt:'2026-09-27T01:00:00Z',customerName:'星河科技'})
 expect(mocks.from.mock.results.at(-1)?.value.select).toHaveBeenCalledWith('order_no,status,next_review_at,created_at,customer_name:shipment_payload->>customerName,shipping_waybills(waybill_no,latest_status,latest_event_at)')
 tables.shipping_orders[0].customer_name=''
 expect((await listPublicShipmentReceipts('org-A')).orders[0].customerName).toBeNull()
})

it('shows only the current account and organization owner-web receipts, never another person waybill or an unattributed old order', async()=>{
 tables.shipping_orders = [
  {...row('mine','org-A'),created_by:'owner-A',intake_source:'owner_web',revision:4,shipping_waybills:[{waybill_no:'SF1234567890123'}]},
  {...row('coworker','org-A'),created_by:'owner-B',intake_source:'owner_web',shipping_waybills:[{waybill_no:'SF9999999999999'}]},
  {...row('old-anonymous','org-A'),created_by:null,intake_source:'anonymous_web',shipping_waybills:[{waybill_no:'SF8888888888888'}]},
  {...row('crm','org-A'),created_by:'owner-A',intake_source:'crm',shipping_waybills:[{waybill_no:'SF7777777777777'}]},
  {...row('other-org','org-B'),created_by:'owner-A',intake_source:'owner_web',shipping_waybills:[{waybill_no:'SF6666666666666'}]},
 ]
 const own=await listOwnerShipmentReceipts('org-A','owner-A')
 expect(own.orders.map(item=>item.orderNo)).toEqual(['mine'])
 expect(own.orders[0]).toMatchObject({revision:4,status:'awaiting_confirmation',waybill:'SF1234567890123'})
 expect((await listOwnerShipmentReceipts('org-A','no-orders')).orders).toEqual([])
 await expect(listOwnerShipmentReceipts('org-A','',0)).rejects.toMatchObject({status:401})
 await expect(listOwnerShipmentReceipts('org-A','owner-A',1001)).rejects.toMatchObject({status:400})
})

it('returns the saved reason only for the owner’s currently returned orders', async () => {
  tables.shipping_orders = [
    { ...row('returned', 'org-A'), created_by: 'owner-A', intake_source: 'owner_web', status: 'returned', returned_reason: '  请补充楼层  ' },
    { ...row('historical', 'org-A'), created_by: 'owner-A', intake_source: 'owner_web', status: 'returned', returned_reason: ' ' },
    { ...row('confirmed', 'org-A'), created_by: 'owner-A', intake_source: 'owner_web', status: 'confirmed', returned_reason: '过期原因' },
    { ...row('coworker', 'org-A'), created_by: 'owner-B', intake_source: 'owner_web', status: 'returned', returned_reason: '同事的原因' },
  ]
  const { orders } = await listOwnerShipmentReceipts('org-A', 'owner-A')
  expect(mocks.from.mock.results.at(-1)?.value.select).toHaveBeenCalledWith(expect.stringContaining('returned_reason'))
  expect(orders.find(order => order.orderNo === 'returned')?.returnedReason).toBe('请补充楼层')
  expect(orders.find(order => order.orderNo === 'historical')?.returnedReason).toBeNull()
  expect(orders.find(order => order.orderNo === 'confirmed')).not.toHaveProperty('returnedReason')
  expect(orders.some(order => order.orderNo === 'coworker')).toBe(false)
  const shared = await listPublicShipmentReceipts('org-A')
  expect(mocks.from.mock.results.at(-1)?.value.select).not.toHaveBeenCalledWith(expect.stringContaining('returned_reason'))
  expect(shared.orders.every(order => !('returnedReason' in order))).toBe(true)
})

it.each(['waybill_created', 'in_transit'])('shows a persisted delivered waybill even if the earlier %s order update did not finish', async status => {
  tables.shipping_orders = [{ ...row('signed', 'org-A'), created_by: 'owner-A', intake_source: 'owner_web',
    status, revision: 1, shipping_waybills: [{ waybill_no: 'SF5169741550975', latest_status: 'delivered', latest_event_at: '2026-11-20T10:41:00Z' }] }]
  const { orders } = await listOwnerShipmentReceipts('org-A', 'owner-A')
  expect(orders[0]).toMatchObject({ status: 'delivered', canCancel: false, deliveredAt: '2026-11-20T10:41:00Z' })
})
