// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
let db: PGlite
const org = '00000001-0000-0000-0000-000000000000', admin = '30000001-0000-0000-0000-000000000000'
const departments = [{id:1,parentId:0,name:'企业',order:0},{id:2,parentId:1,name:'销售',order:0},{id:3,parentId:2,name:'一组',order:0},{id:4,parentId:1,name:'一组',order:0}]
const members = [{userid:'same-id',name:'员工甲',mobile:'13800000000',departments:['一组'],departmentIds:[3],active:true},{userid:'staff-b',name:'员工乙',mobile:'13900000000',departments:['一组'],departmentIds:[4],active:true}]
async function settings() { return (await db.query<{corp_id:string;updated_at:string}>('select corp_id,updated_at::text from shipping_wecom_settings where org_id=$1',[org])).rows[0] }
async function sync(rows=members, selected:number[]|null=null) {
 const cfg=await settings()
 return db.query('select sync_shipping_wecom_directory_v2($1,$2,7,$3,$4,$5,$6,$7)',[org,cfg.corp_id,cfg.updated_at,'企业',JSON.stringify(departments),JSON.stringify(rows),selected])
}
beforeAll(async()=>{
 db=new PGlite(); await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create table public.organizations(id uuid primary key); create table public.users(id uuid primary key); create table public.shipping_orders(id uuid primary key,org_id uuid,created_at timestamptz default now());')
 await db.query('insert into organizations values($1)',[org]);await db.query('insert into users values($1)',[admin])
 for(const file of ['20261009042436_shipping_employee_email_access.sql','20261010000001_shipping_optional_email_verification.sql','20261010000003_shipping_wecom_identity.sql','20261012072106_shipping_wecom_configuration_lifecycle.sql']) await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8'))
 await db.query("insert into shipping_wecom_settings(org_id,corp_id,agent_id,credentials_ciphertext,updated_by) values($1,'ww-original',7,'encrypted-original',$2)",[org,admin])
},30000)
afterAll(async()=>{await db?.close()})
describe('WeCom configuration lifecycle database boundary',()=>{
 it('preserves individual grants until department selection is explicitly saved',async()=>{
  await sync();await db.query("update shipping_employee_profiles set wecom_allowed=false where org_id=$1 and wechat_userid='staff-b'",[org]);await sync()
  const rows=(await db.query<{wechat_userid:string;wecom_allowed:boolean;department_ids:number[]}>('select wechat_userid,wecom_allowed,department_ids from shipping_employee_profiles order by wechat_userid')).rows
  expect(rows).toEqual([{wechat_userid:'same-id',wecom_allowed:true,department_ids:[3]},{wechat_userid:'staff-b',wecom_allowed:false,department_ids:[4]}])
 })
 it('selects descendants by ID and revokes a moved member with session invalidation',async()=>{
  await sync(members,[2]);const prior=(await db.query<{session_version:number}>("select session_version from shipping_employee_profiles where wechat_userid='same-id'")).rows[0].session_version
  await sync([{...members[0],departmentIds:[4]},members[1]])
  const moved=(await db.query<{wecom_allowed:boolean;session_version:number}>("select wecom_allowed,session_version from shipping_employee_profiles where wechat_userid='same-id'")).rows[0]
  expect(moved).toEqual({wecom_allowed:false,session_version:prior+1})
  const cfg=await settings()
  await expect(db.query('select sync_shipping_wecom_members($1,$2,7,$3,$4,$5)',[org,cfg.corp_id,cfg.updated_at,'企业',JSON.stringify(members)])).rejects.toThrow('Department policy requires')
 })
 it('atomically switches enterprise without rebinding historical orders to reused UserIDs',async()=>{
  await sync(members,[2]);const old=(await db.query<{id:string;session_version:number}>("select id,session_version from shipping_employee_profiles where wechat_userid='same-id'")).rows[0]
  const order=randomUUID();await db.query('insert into shipping_orders(id,org_id,employee_profile_id) values($1,$2,$3)',[order,org,old.id])
  await db.query("insert into shipping_wecom_bots(org_id,corp_id,bot_id,name,credentials_ciphertext,status,updated_by) values($1,'ww-original','old-bot','原机器人','encrypted','active',$2)",[org,admin])
  const draft=randomUUID(),cfg=await settings(),config={corp_id:'ww-new',agent_id:7,credentials_ciphertext:'encrypted-new',order_check_mode:1,fallback_phone:'',denied_message:'无权限',redirect_domain:'app.example',company_name:'新企业'}
  await db.query('insert into shipping_wecom_config_drafts(org_id,id,config,departments,members,base_updated_at,prepared_by) values($1,$2,$3,$4,$5,$6,$7)',[org,draft,JSON.stringify(config),JSON.stringify(departments),JSON.stringify(members),cfg.updated_at,admin])
  await expect(db.query('select activate_shipping_wecom_config($1,$2,$3,$4)',[org,draft,admin,[999]])).rejects.toThrow('Selected department unavailable')
  expect((await settings()).corp_id).toBe('ww-original')
  await db.query('select activate_shipping_wecom_config($1,$2,$3,$4)',[org,draft,admin,[2]])
  const profiles=(await db.query<{id:string;wecom_corp_id:string;is_active:boolean;session_version:number}>("select id,wecom_corp_id,is_active,session_version from shipping_employee_profiles where wechat_userid='same-id' order by wecom_corp_id")).rows
  expect(profiles.find(p=>p.wecom_corp_id==='ww-original')).toMatchObject({id:old.id,is_active:false})
  expect(profiles.find(p=>p.wecom_corp_id==='ww-original')!.session_version).toBeGreaterThan(old.session_version)
  expect(profiles.find(p=>p.wecom_corp_id==='ww-new')!.id).not.toBe(old.id)
  expect((await db.query<{employee_profile_id:string}>('select employee_profile_id from shipping_orders where id=$1',[order])).rows[0].employee_profile_id).toBe(old.id)
  expect((await db.query<{status:string}>("select status from shipping_wecom_bots where bot_id='old-bot'")).rows[0].status).toBe('disabled')
 })
 it('denies browser roles direct access to drafts, encrypted bot keys and callback events',async()=>{
  for(const name of ['shipping_wecom_config_drafts','shipping_wecom_bots','shipping_wecom_bot_events']){
   const row=(await db.query<{rls:boolean;anon:boolean;authenticated:boolean;service:boolean}>("select relrowsecurity as rls,has_table_privilege('anon',oid,'SELECT') as anon,has_table_privilege('authenticated',oid,'UPDATE') as authenticated,has_table_privilege('service_role',oid,'INSERT') as service from pg_class where relname=$1",[name])).rows[0]
   expect(row).toEqual({rls:true,anon:false,authenticated:false,service:true})
  }
 })
})

 it('deduplicates callbacks and leases processing without spawning duplicate work',async()=>{
  const bot=(await db.query<{id:string}>('select id from shipping_wecom_bots limit 1')).rows[0].id
  const event=randomUUID()
  await db.query("insert into shipping_wecom_bot_events(id,bot_id,message_id,payload_hash,payload_ciphertext) values($1,$2,'message-one','hash','cipher')",[event,bot])
  await expect(db.query("insert into shipping_wecom_bot_events(bot_id,message_id,payload_hash,payload_ciphertext) values($1,'message-one','hash','cipher')",[bot])).rejects.toThrow('unique')
  const first=(await db.query<{lease_id:string;attempts:number}>('select * from claim_shipping_wecom_bot_event($1,$2)',[event,bot])).rows
  expect(first).toHaveLength(1);expect(first[0].attempts).toBe(1)
  expect((await db.query('select * from claim_shipping_wecom_bot_event($1,$2)',[event,bot])).rows).toHaveLength(0)
  await db.query("update shipping_wecom_bot_events set updated_at=now()-interval '91 seconds',prepared_ciphertext='frozen-input' where id=$1",[event])
  const recovered=(await db.query<{lease_id:string;attempts:number;prepared_ciphertext:string}>('select * from claim_shipping_wecom_bot_event($1,$2)',[event,bot])).rows[0]
  expect(recovered.attempts).toBe(2);expect(recovered.lease_id).not.toBe(first[0].lease_id);expect(recovered.prepared_ciphertext).toBe('frozen-input')
 })
 it('does not let the legacy individual-permission API override department grants',async()=>{
  const member=(await db.query<{id:string}>("select id from shipping_employee_profiles where wecom_corp_id='ww-new' and wechat_userid='staff-b'")).rows[0]
  await expect(db.query('select set_shipping_wecom_member($1,$2,true,false)',[org,member.id])).rejects.toThrow('department scope')
 })
