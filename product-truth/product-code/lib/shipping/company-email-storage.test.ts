// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const orgId = '00000000-0000-4000-8000-000000000001'
const otherOrg = '00000000-0000-4000-8000-000000000002'
const codeHash = 'a'.repeat(64), ipHash = 'b'.repeat(64)
let db: PGlite
let sequence = 0

async function reserve(email = `employee${sequence++}@company.example`, org = orgId) {
  const id = randomUUID()
  const result = await db.query<{ result: { status: string; challengeId?: string } }>('select public.reserve_shipping_email_challenge($1,$2,$3,$4,$5) as result', [id, org, email, codeHash, ipHash])
  return { id, email, result: result.rows[0].result }
}
async function verify(id: string, email: string, hash = codeHash, org = orgId) {
  const sessionHash = randomUUID().replaceAll('-', '').repeat(2)
  const result = await db.query<{ result: { status: string; employeeId?: string } }>('select public.verify_shipping_email_challenge($1,$2,$3,$4,$5) as result', [id, org, email, hash, sessionHash])
  return { sessionHash, result: result.rows[0].result }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create table public.organizations(id uuid primary key); create table public.users(id uuid primary key); create table public.shipping_orders(id uuid primary key,org_id uuid,created_at timestamptz default now());')
  await db.query('insert into public.organizations values ($1),($2)', [orgId, otherOrg])
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261008104340_shipping_employee_email_access.sql', import.meta.url), 'utf8'))
  await db.query("insert into public.shipping_email_access_settings(org_id,enabled,allowed_domains) values ($1,true,array['company.example']),($2,true,array['company.example'])", [orgId, otherOrg])
}, 30_000)
afterAll(async () => { await db?.close() })

describe('employee email database boundary (local PostgreSQL engine)', () => {
  it('rolls back identity tables and RPCs if the final workorder ownership constraint fails', async () => {
    const isolated = new PGlite()
    try {
      // A late schema conflict must not leave a partially installed identity system.
      await isolated.exec('create role anon; create role authenticated; create role service_role bypassrls; create table public.organizations(id uuid primary key); create table public.users(id uuid primary key); create table public.shipping_orders(id uuid primary key,org_id text,created_at timestamptz default now());')
      await expect(isolated.exec(readFileSync(new URL('../../supabase/migrations/20261008104340_shipping_employee_email_access.sql', import.meta.url), 'utf8'))).rejects.toThrow()
      await isolated.exec('rollback')
      const result = await isolated.query<{ profiles: string | null; rpc: string | null }>("select to_regclass('public.shipping_employee_profiles')::text as profiles, to_regprocedure('public.verify_shipping_email_challenge(uuid,uuid,text,text,text)')::text as rpc")
      expect(result.rows[0]).toEqual({ profiles: null, rpc: null })
      const columns = await isolated.query("select column_name from information_schema.columns where table_schema='public' and table_name='shipping_orders' and column_name='employee_profile_id'")
      expect(columns.rows).toHaveLength(0)
    } finally { await isolated.close() }
  })
  it('issues a database session lasting exactly 60 days', async () => {
    const challenge = await reserve()
    await verify(challenge.id, challenge.email)
    const result = await db.query<{ seconds: number }>('select extract(epoch from (expires_at-created_at))::int as seconds from public.shipping_employee_sessions order by created_at desc limit 1')
    expect(result.rows[0].seconds).toBe(60 * 24 * 60 * 60)
  })
  it('rejects linking a workorder to an employee of another organization', async () => {
    const id = randomUUID()
    await db.query('insert into public.shipping_employee_profiles(id,org_id,email,email_verified_at) values ($1,$2,$3,now())', [id, orgId, 'ownership@company.example'])
    await expect(db.query('insert into public.shipping_orders(id,org_id,employee_profile_id) values ($1,$2,$3)', [randomUUID(), otherOrg, id])).rejects.toThrow()
    await db.query('insert into public.shipping_orders(id,org_id,employee_profile_id) values ($1,$2,$3)', [randomUUID(), orgId, id])
  })
  it('enables RLS and denies direct public/authenticated access to every private table and RPC', async () => {
    const tables = ['shipping_email_access_settings', 'shipping_employee_profiles', 'shipping_email_challenges', 'shipping_employee_sessions']
    for (const table of tables) {
      const acl = await db.query<{ rls: boolean; anon_read: boolean; auth_write: boolean; service_write: boolean }>('select c.relrowsecurity as rls, has_table_privilege(\'anon\',c.oid,\'SELECT\') as anon_read, has_table_privilege(\'authenticated\',c.oid,\'INSERT\') as auth_write, has_table_privilege(\'service_role\',c.oid,\'INSERT\') as service_write from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=\'public\' and c.relname=$1', [table])
      expect(acl.rows[0]).toEqual({ rls: true, anon_read: false, auth_write: false, service_write: true })
    }
    for (const name of ['reserve_shipping_email_challenge', 'verify_shipping_email_challenge']) {
      const result = await db.query<{ allowed: boolean; service_allowed: boolean }>('select has_function_privilege(\'anon\',$1,\'EXECUTE\') as allowed,has_function_privilege(\'service_role\',$1,\'EXECUTE\') as service_allowed', [`public.${name}(uuid,uuid,text,text,text)`])
      expect(result.rows[0]).toEqual({ allowed: false, service_allowed: true })
    }
    await db.exec('set role anon')
    try { await expect(db.query('select * from public.shipping_employee_profiles')).rejects.toThrow(/permission denied/) }
    finally { await db.exec('reset role') }
  })

  it.each(['worker@outside.example', 'worker@sub.company.example', 'worker@company.example.evil.test', 'worker@company.example@evil.test'])('cannot reserve a challenge for %s', async email => {
    expect((await reserve(email)).result.status).not.toBe('reserved')
  })

  it('enforces cooldown and invalidates the previous challenge on resend', async () => {
    const first = await reserve()
    expect(first.result.status).toBe('reserved')
    expect((await reserve(first.email)).result.status).toBe('rate_limited')
    await db.query("update public.shipping_email_challenges set created_at=now()-interval '61 seconds' where id=$1", [first.id])
    expect((await reserve(first.email)).result.status).toBe('reserved')
    expect((await verify(first.id, first.email)).result.status).toBe('invalid')
  })

  it('rejects a correct code after five incorrect attempts', async () => {
    const challenge = await reserve()
    for (let i = 0; i < 5; i++) expect((await verify(challenge.id, challenge.email, 'c'.repeat(64))).result.status).toBe('invalid')
    expect((await verify(challenge.id, challenge.email)).result.status).toBe('invalid')
    const result = await db.query<{ attempts: number }>('select attempts from public.shipping_email_challenges where id=$1', [challenge.id])
    expect(result.rows[0].attempts).toBe(5)
  })

  it('rejects expired, wrong-organization and wrong-mailbox challenges', async () => {
    const challenge = await reserve()
    expect((await verify(challenge.id, challenge.email, codeHash, otherOrg)).result.status).toBe('invalid')
    expect((await verify(challenge.id, 'other@company.example')).result.status).toBe('invalid')
    await db.query("update public.shipping_email_challenges set expires_at=now()-interval '1 second' where id=$1", [challenge.id])
    expect((await verify(challenge.id, challenge.email)).result.status).toBe('invalid')
  })

  it('consumes one code once and creates only a shipping employee session', async () => {
    const challenge = await reserve()
    const first = await verify(challenge.id, challenge.email)
    expect(first.result.status).toBe('verified')
    expect((await verify(challenge.id, challenge.email)).result.status).toBe('invalid')
    const session = await db.query<{ employee_id: string; org_id: string; issued_version: number }>('select employee_id,org_id,issued_version from public.shipping_employee_sessions where token_hash=$1', [first.sessionHash])
    expect(session.rows[0]).toMatchObject({ employee_id: first.result.employeeId, org_id: orgId, issued_version: 1 })
    const globalUsers = await db.query<{ count: number }>('select count(*)::integer as count from public.users')
    expect(globalUsers.rows[0].count).toBe(0)
  })

  it('does not reactivate a disabled employee through a valid pending code', async () => {
    const challenge = await reserve()
    await db.query('insert into public.shipping_employee_profiles(org_id,email,is_active) values ($1,$2,false)', [orgId, challenge.email])
    expect((await verify(challenge.id, challenge.email)).result.status).toBe('invalid')
    expect((await reserve(challenge.email)).result.status).toBe('unavailable')
  })
})
