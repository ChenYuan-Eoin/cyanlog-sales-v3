// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

const db = new PGlite()
const org=randomUUID(), actor=randomUUID(), id=randomUUID(), waybill=randomUUID(), conn=randomUUID(), account=randomUUID()
const operator = randomUUID()
const no='SO-20261118-A01BCD49'
const recipient = {address:'旧址'}, sender={address:'寄件址'}, target={address:'新址'}
beforeAll(async()=>{
  await db.exec(`
    create role service_role; create role anon; create role authenticated;
    create table shipping_carrier_connections(id uuid primary key,org_id uuid,environment text,carrier_key text,credentials_ciphertext text,connection_status text);
    create table shipping_billing_accounts(id uuid primary key,org_id uuid,connection_id uuid,account_ciphertext text,account_tail text,status text,environment text);
    create table shipping_orders(id uuid primary key,org_id uuid,created_by uuid,order_no text,intake_source text,status text,provider_key text,
      provider_order_id text,shipment_payload jsonb,carrier_connection_id uuid,billing_account_id uuid,connection_environment text,billing_account_tail text,
      shipping_config_snapshot jsonb,revision integer not null default 1,updated_at timestamptz);
    create table shipping_waybills(id uuid primary key,shipping_order_id uuid,waybill_no text,carrier_key text,provider_order_id text,latest_status text,
      latest_event_at timestamptz,updated_at timestamptz);
    create table shipping_tracking_events(waybill_id uuid,provider_key text,event_at timestamptz,status text);
  `)
  await db.exec(readFileSync('supabase/migrations/20261118101500_shipping_order_cancellation.sql','utf8'))
  await db.exec(readFileSync('supabase/migrations/20261118123000_owner_carrier_changes.sql','utf8'))
  await db.exec(readFileSync('supabase/migrations/20261125083220_shipping_ledger_order_actions.sql','utf8'))
},30000)
afterAll(async()=>{await db.close()})
beforeEach(async()=>{
  await db.exec('truncate shipping_carrier_changes,shipping_carrier_connections,shipping_billing_accounts,shipping_tracking_events,shipping_orders,shipping_waybills')
  await db.query("insert into shipping_carrier_connections values($1,$2,'production','sf','cipher','connected','testing')",[conn,org])
  await db.query("insert into shipping_billing_accounts values($1,$2,$3,'encrypted-account','1234','active','production')",[account,org,conn])
  await db.query("insert into shipping_orders values($1,$2,$3,$4,'owner_web','in_transit','sf','provider-order',$5,$6,$7,'production','1234',$8)",
    [id,org,actor,no,JSON.stringify({recipient,sender}),conn,account,JSON.stringify({payment:'sender_monthly'})])
  await db.query("insert into shipping_waybills values($1,$2,'SF1234567890123','sf','provider-order','in_transit','2026-11-18T03:00:00Z')",[waybill,id])
  await db.query("insert into shipping_tracking_events values($1,'sf','2026-11-18T03:00:00Z','in_transit')",[waybill])
})
type Input = {org?:string;actor?:string;key?:string;action?:string;addr?:Record<string,string>;binding?:string}
type State = {result:string;context:null|{binding:string};unavailableReason?:string;latest:null|{status:string;amount:string;instructionId:string;destination:typeof target;originalRecipient:typeof recipient}}
async function run(x:Input={}) {
  return (await db.query<{r:State|null}>('select owner_carrier_change_v1($1,$2,$3,$4,$5,$6,$7) r',
    [x.org??org,x.actor??actor,no,x.key??null,x.action??null,x.addr?JSON.stringify(x.addr):null,x.binding??null])).rows[0].r
}
const live=()=>db.exec("update shipping_carrier_connections set sf_intercept_access='live'")
async function finish(key:string,status:string) {
  return (await db.query<{r:boolean}>('select finish_owner_carrier_change_v1($1,$2,$3,$4,$5,$6,$7) r',
    [org,actor,no,key,status,status==='accepted'?'CUS-sample':null,status==='accepted'?'2.50':null])).rows[0].r
}
async function runOperator(x:Input={}) {
  return (await db.query<{r:State|null}>('select shipping_carrier_change_v1($1,$2,null,$3,$4,$5,$6,$7) r',
    [x.org??org,x.actor??operator,id,x.key??null,x.action??null,x.addr?JSON.stringify(x.addr):null,x.binding??null])).rows[0].r
}

async function operatorCancel(expected?: { revision:number; status:string; waybill:string|null }, organization=org) {
  return (await db.query<{r:{result:string}}>('select claim_shipping_cancellation_v1($1,$2,$3,false,$4,$5) r',
    [organization,operator,id,randomUUID(),expected ? JSON.stringify(expected) : null])).rows[0].r
}
it('isolates scope, SF app status and environment; replacing credentials drops authorization',async()=>{
  expect(await run({org:randomUUID()})).toBeNull()
  expect(await run({actor:randomUUID()})).toBeNull()
  expect((await run())?.context).toBeNull()
  expect((await run())?.unavailableReason).toBe('intercept_disabled')
  await live(); expect((await run())?.context).toBeTruthy()
  await db.exec("update shipping_carrier_connections set credentials_ciphertext='new';")
  expect((await run())?.context).toBeNull()
  await db.exec("update shipping_orders set connection_environment='sandbox'; update shipping_carrier_connections set environment='sandbox';")
  expect((await run())?.context).toBeNull()
  await db.exec("update shipping_billing_accounts set environment='sandbox'; update shipping_carrier_connections set sf_intercept_access='testing'; update shipping_orders set status='waybill_created'; update shipping_waybills set latest_status='waybill_created', latest_event_at=null; delete from shipping_tracking_events;")
  expect((await run())?.context).toBeTruthy()
  await db.exec("update shipping_orders set intake_source='crm'");expect(await run()).toBeNull()
})
it.each([
  "update shipping_orders set status='waybill_created'",
  "update shipping_waybills set latest_status='out_for_delivery'",
  "insert into shipping_tracking_events select id,'sf',now(),'unknown' from shipping_waybills",
  "insert into shipping_tracking_events select id,'sf',latest_event_at-interval '1 minute','out_for_delivery' from shipping_waybills",
  "update shipping_orders set cancellation='{\"phase\":\"calling\"}'",
  "update shipping_orders set billing_account_tail='9999'",
  "update shipping_billing_accounts set status='inactive'",
  "update shipping_billing_accounts set environment='sandbox'",
  "update shipping_waybills set provider_order_id='unrelated'",
  "update shipping_orders set shipping_config_snapshot='{}'",
])('blocks an unreliable route, billing, original-order or cancellation state',async(sql)=>{
  await live()
  await db.exec(sql)
  expect((await run())?.context).toBeNull()
})
it('uses the same ordered claim, permits exact replay and records acceptance without mutating the shipment',async()=>{
  await live()
  const binding=(await run())!.context!.binding
  await expect(run({key:randomUUID(),action:'modify_recipient',addr:{...recipient,phone:'different'}})).rejects.toMatchObject({code:'22023'})
  const input={action:'modify_recipient',key:randomUUID(),addr:target}
  expect((await run({...input,binding}))?.result).toBe('dispatch')
  expect((await run(input))?.latest?.status).toBe('pending')
  await expect(run({...input,addr:{address:'another'}})).rejects.toMatchObject({code:'40001'})
  await expect(run({...input,key:randomUUID(),binding})).rejects.toMatchObject({code:'40001'})
  expect(await finish(input.key,'accepted')).toBe(true)
  expect(await finish(input.key,'unknown')).toBe(false)
  expect((await run())?.latest).toMatchObject({status:'accepted',originalRecipient:recipient,destination:target,instructionId:'CUS-sample',amount:'2.50'})
  expect((await db.query('select status,shipment_payload from shipping_orders')).rows).toEqual([{status:'in_transit',shipment_payload:{sender,recipient}}])
  expect((await db.query('select count(*)::int as n from shipping_carrier_changes')).rows).toEqual([{n:1}])
})
it('blocks stale bindings and never resends an ambiguous return; the return snapshot comes from the sender',async()=>{
  await live()
  const original=(await run())!.context!.binding
  const key=randomUUID()
  const args={key,action:'return_to_sender'}
  await db.exec("update shipping_billing_accounts set account_ciphertext='rotated'")
  await expect(run({...args,binding:original})).rejects.toMatchObject({code:'40001'})
  await run({...args,binding:(await run())!.context!.binding})
  expect(await finish(key,'unknown')).toBe(true)
  expect((await run(args))?.latest).toMatchObject({destination:sender,status:'unknown'})
  expect((await run())?.context).toBeNull()
  const access=await db.query("select has_table_privilege('authenticated','shipping_carrier_changes','select') as client_read, has_function_privilege('anon','owner_carrier_change_v1(uuid,uuid,text,uuid,text,jsonb,text)','execute') as client_write, has_function_privilege('service_role','owner_carrier_change_v1(uuid,uuid,text,uuid,text,jsonb,text)','execute') as server")
  expect(access.rows[0]).toEqual({client_read:false,client_write:false,server:true})
})

it('shares one claim and receipt across roles, preserves actor identity and denies restricted roles', async () => {
  await live()
  expect(await runOperator({org:randomUUID()})).toBeNull()
  expect(await run({actor:operator})).toBeNull()
  const binding=(await runOperator())!.context!.binding
  const request={action:'modify_recipient',key:randomUUID(),addr:target,binding}
  expect((await runOperator(request))?.result).toBe('dispatch')
  await expect(run({...request,key:randomUUID()})).rejects.toMatchObject({code:'40001'})
  expect(await finish(request.key,'unknown')).toBe(false)
  const {rows} = await db.query("select finish_shipping_carrier_change_v1($1,$2,null,$3,$4,'accepted','CUS-operator',null) ok",
    [org,operator,id,request.key])
  expect(rows).toEqual([{ok:true}])
  expect((await run())?.latest).toMatchObject({status:'accepted',destination:target,instructionId:'CUS-operator'})
  expect((await db.query('select requested_by from shipping_carrier_changes')).rows).toEqual([{requested_by:operator}])
  const access = await db.query(`select
    has_function_privilege('authenticated','shipping_carrier_change_v1(uuid,uuid,text,uuid,uuid,text,jsonb,text)','execute') request_client,
    has_function_privilege('anon','finish_shipping_carrier_change_v1(uuid,uuid,text,uuid,uuid,text,text,text)','execute') finish_client,
    has_function_privilege('service_role','shipping_carrier_change_v1(uuid,uuid,text,uuid,uuid,text,jsonb,text)','execute') request_server`)
  expect(access.rows).toEqual([{request_client:false,finish_client:false,request_server:true}])
})

it('lets an operator intercept eligible CRM-origin orders without creating an owner entry point', async () => {
  await live()
  await db.exec("update shipping_orders set intake_source='crm'")
  expect(await run()).toBeNull()
  expect((await runOperator())?.context).toBeTruthy()
})

it('allows a matching operator snapshot to cancel a local work order while keeping legacy calls narrow', async () => {
  await db.exec("delete from shipping_waybills; update shipping_orders set status='awaiting_confirmation',provider_order_id=null")
  expect(await operatorCancel()).toEqual({result:'unavailable'})
  const expected={revision:1,status:'awaiting_confirmation',waybill:null}
  expect(await operatorCancel(expected,randomUUID())).toEqual({result:'missing'})
  await db.exec('update shipping_orders set revision=2')
  expect(await operatorCancel(expected)).toEqual({result:'stale'})
  const current={...expected,revision:2}
  expect(await operatorCancel(current)).toMatchObject({result:'cancelled',id})
  expect(await operatorCancel(current)).toMatchObject({result:'cancelled',id})
  const {rows}=await db.query("select status,cancellation->>'actor' actor,cancellation->>'source' source from shipping_orders")
  expect(rows).toEqual([{status:'cancelled',actor:operator,source:'operator'}])
})

it('blocks cancellation while a carrier change is active even when sandbox supports a pre-pickup intercept', async () => {
  await db.exec(`update shipping_orders set connection_environment='sandbox',status='waybill_created';
    update shipping_carrier_connections set environment='sandbox';
    update shipping_carrier_connections set sf_intercept_access='testing';
    update shipping_billing_accounts set environment='sandbox';
    update shipping_waybills set latest_status='waybill_created',latest_event_at=null;
    delete from shipping_tracking_events`)
  const binding=(await runOperator())!.context!.binding
  expect((await runOperator({action:'modify_recipient',key:randomUUID(),addr:target,binding}))?.result).toBe('dispatch')
  expect(await operatorCancel({revision:1,status:'waybill_created',waybill:'SF1234567890123'})).toEqual({result:'unavailable'})
})
