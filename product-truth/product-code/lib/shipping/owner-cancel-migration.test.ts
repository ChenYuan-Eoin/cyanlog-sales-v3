// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const org=randomUUID(), actor=randomUUID(), other=randomUUID(), op=randomUUID()
let db:PGlite
beforeAll(async () => {
  db=new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table shipping_orders(id uuid primary key,org_id uuid,created_by uuid,intake_source text,order_no text unique,revision integer not null default 1,status text,provider_key text default 'sf',provider_order_id text,carrier_connection_id uuid,connection_environment text,billing_account_id uuid,shipping_config_snapshot jsonb,updated_at timestamptz);
    create table shipping_waybills(id uuid primary key, shipping_order_id uuid unique references shipping_orders, waybill_no text, carrier_key text, provider_order_id text, latest_status text, updated_at timestamptz);
  `)
  await db.exec(readFileSync('supabase/migrations/20261118101500_shipping_order_cancellation.sql','utf8'))
},30000)
afterAll(async()=>{await db?.close()})
const initialSnapshot = new Map<string,{revision:number,status:string,waybill:string|null}>()
async function order(status:string,waybill=false,source='owner_web') {
  const id=randomUUID(), no='SO-'+id
  await db.query("insert into shipping_orders(id,order_no,org_id,created_by,intake_source,status,provider_order_id,carrier_connection_id,connection_environment) values($1,$2,$3,$4,$5,$6,$7,$8,'sandbox')",[id,no,org,actor,source,status,waybill?'original':null,randomUUID()])
  if (waybill) await db.query("insert into shipping_waybills values($1,$2,'waybill','sf','original','waybill_created',now())",[randomUUID(),id])
  initialSnapshot.set(no,{revision:1,status,waybill:waybill?'waybill':null})
  return {id,no}
}
async function claim(ref:string,owner=true,user=actor,organization=org,attempt=randomUUID(),expected:unknown=initialSnapshot.get(ref)) {
  const params:unknown[]=[organization,user,ref,owner,attempt]
  if (owner && expected!=null) params.push(JSON.stringify(expected))
  const args=params.length===5?'$1,$2,$3,$4,$5':'$1,$2,$3,$4,$5,$6::jsonb'
  return (await db.query<{r:{result:string}}>(`select claim_shipping_cancellation_v1(${args}) r`,params)).rows[0].r
}
async function finish(id:string,attempt:string,outcome:string) {
  return (await db.query<{r:string}>('select finish_shipping_cancellation_v1($1,$2,$3,$4,$5) r',[org,id,attempt,outcome,'receipt'])).rows[0].r
}
it('local cancellation is private, atomic against dispatch and unavailable to another intake source',async()=>{
  const {id,no}=await order('awaiting_confirmation')
  expect((await claim(no,true,other)).result).toBe('missing')
  expect((await claim(no,true,actor,other)).result).toBe('missing')
  expect((await claim((await order('awaiting_confirmation',false,'crm')).no)).result).toBe('missing')
  expect((await claim(no)).result).toBe('cancelled')
  expect((await db.query("update shipping_orders set status='ordering' where id=$1 and status='awaiting_confirmation' returning id",[id])).rows).toHaveLength(0)
  expect((await claim(no)).result).toBe('cancelled')
  for(const s of ['ordering','order_unknown','delivered','in_transit']) expect(['uncertain','unavailable']).toContain((await claim((await order(s)).no)).result)
  const ambiguous=await order('order_failed'); await db.query("update shipping_orders set provider_order_id='previous-request',shipping_config_snapshot='{\"orderFailure\":{\"stage\":\"provider_rejected\"}}' where id=$1",[ambiguous.id]);expect((await claim(ambiguous.no)).result).toBe('uncertain')
  const unsafe=await order('awaiting_confirmation',true)
  expect((await claim(unsafe.no)).result).toBe('unavailable')
})
it('rejects an old revision even when another session resubmits into the same status; only a matching retry is idempotent',async()=>{
  const {id,no}=await order('awaiting_confirmation')
  const stale=initialSnapshot.get(no)!
  await db.query('update shipping_orders set revision=2 where id=$1',[id])
  const cancel=(expected:unknown)=>claim(no,true,actor,org,randomUUID(),expected)
  expect((await cancel(stale)).result).toBe('stale')
  expect((await cancel(null)).result).toBe('stale')
  expect((await cancel({revision:2,status:stale.status})).result).toBe('stale')
  expect((await db.query('select status,cancellation from shipping_orders where id=$1',[id])).rows[0]).toEqual({status:stale.status,cancellation:null})
  const current={...stale,revision:2}
  expect((await cancel(current)).result).toBe('cancelled')
  expect((await cancel(current)).result).toBe('cancelled')
  expect((await cancel(stale)).result).toBe('stale')
})
it('rejects a new shipping status or a replaced waybill before any carrier claim',async()=>{
  const {id,no}=await order('confirmed')
  const cancel=(expected:unknown)=>claim(no,true,actor,org,randomUUID(),expected)
  await db.query("update shipping_orders set status='waybill_created',provider_order_id='original' where id=$1",[id])
  await db.query("insert into shipping_waybills values($1,$2,'new-waybill','sf','original','waybill_created',now())",[randomUUID(),id])
  expect((await cancel(initialSnapshot.get(no))).result).toBe('stale')
  const current={revision:1,status:'waybill_created',waybill:'new-waybill'}
  expect((await cancel({...current,status:'confirmed'})).result).toBe('stale')
  expect((await cancel({...current,waybill:'previous-waybill'})).result).toBe('stale')
  expect((await db.query('select cancellation from shipping_orders where id=$1',[id])).rows[0]).toEqual({cancellation:null})
  expect((await cancel(current)).result).toBe('dispatch')
  expect((await cancel(current)).result).toBe('pending')
  expect((await cancel(initialSnapshot.get(no))).result).toBe('stale')
})
it('both entry points contend for the same durable dispatch; unknown never sends again',async()=>{
  const {id,no}=await order('waybill_created',true), token=randomUUID()
  expect(await claim(no,true,actor,org,token)).toMatchObject({result:'dispatch',id,providerOrderId:'original',environment:'sandbox'})
  expect((await claim(id,false,op)).result).toBe('pending')
  expect(await finish(id,randomUUID(),'accepted')).toBe('conflict')
  expect(await finish(id,token,'unknown')).toBe('unknown')
  expect((await claim(no)).result).toBe('pending')
  expect(await finish(id,token,'accepted')).toBe('unknown')
  expect((await db.query('select status from shipping_orders where id=$1',[id])).rows[0]).toEqual({status:'waybill_created'})
})
it('only a matching confirmed receipt cancels both records, and a signed parcel cannot be overwritten',async()=>{
  for(const delivered of [false,true]){
    const {id,no}=await order('waybill_created',true), token=randomUUID()
    await claim(id,false,op,org,token)
    if(delivered) await db.query("update shipping_waybills set latest_status='delivered' where shipping_order_id=$1",[id])
    expect(await finish(id,token,'accepted')).toBe(delivered?'manual_review':'accepted')
    const {rows}=await db.query('select o.status, w.latest_status from shipping_orders o join shipping_waybills w on o.id=w.shipping_order_id where o.id=$1',[id])
    expect(rows[0]).toEqual(delivered?{status:'waybill_created',latest_status:'delivered'}:{status:'cancelled',latest_status:'cancelled'})
    expect((await claim(no)).result).toBe(delivered?'pending':'cancelled')
  }
})
it('denies browser roles execution, and preserves the prior terminal result on retries',async()=>{
  const perms=await db.query("select has_function_privilege('authenticated','claim_shipping_cancellation_v1(uuid,uuid,text,boolean,uuid,jsonb)','execute') client, has_function_privilege('service_role','finish_shipping_cancellation_v1(uuid,uuid,uuid,text,text)','execute') server")
  expect(perms.rows[0]).toEqual({client:false,server:true})
  const {id,no}=await order('waybill_created',true), token=randomUUID()
  await claim(no,true,actor,org,token);await finish(id,token,'rejected')
  expect((await claim(no)).result).toBe('rejected')
})

it.each([
  ['waybill_created', 'in_transit'],
  ['in_transit', 'waybill_created'],
  ['in_transit', 'in_transit'],
])('keeps pickup evidence when cancellation returns after pickup (%s, %s)', async (orderStatus, waybillStatus) => {
  const { id, no } = await order('waybill_created', true)
  const attempt = randomUUID()
  expect((await claim(no, true, actor, org, attempt)).result).toBe('dispatch')
  await db.query('update shipping_orders set status=$1 where id=$2', [orderStatus, id])
  await db.query('update shipping_waybills set latest_status=$1 where shipping_order_id=$2', [waybillStatus, id])

  expect(await finish(id, attempt, 'accepted')).toBe('manual_review')
  const { rows } = await db.query('select o.status, w.latest_status from shipping_orders o join shipping_waybills w on o.id=w.shipping_order_id where o.id=$1', [id])
  expect(rows[0]).toEqual({ status: orderStatus, latest_status: waybillStatus })
  expect((await claim(no)).result).toBe('pending')
})
