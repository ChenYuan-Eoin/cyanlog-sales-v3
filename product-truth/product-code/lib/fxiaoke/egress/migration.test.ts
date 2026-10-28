// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('enforces server-only access, scoped atomic claims, lease fencing and expiry in Postgres', async () => {
  const db = new PGlite()
  const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table organizations(id uuid primary key); insert into organizations values ('${a}'),('${b}');`)
    await db.exec(readFileSync('supabase/migrations/20261028083005_fxiaoke_egress_jobs.sql','utf8'))
    await db.exec(`set role service_role;
      insert into organization_fxiaoke_egress_jobs(id,system_org_id,request_ciphertext,expires_at) values
      ('11111111-1111-4111-8111-111111111111','${a}','encrypted-A',now()+interval '20 seconds'),
      ('22222222-2222-4222-8222-222222222222','${b}','encrypted-B',now()+interval '20 seconds');`)
    const claimed = await db.query<{ id: string; system_org_id: string; lease_token: string }>('select * from claim_fxiaoke_egress_job($1)',[a])
    expect(claimed.rows).toHaveLength(1)
    expect(claimed.rows[0].system_org_id).toBe(a)
    expect(claimed.rows[0].lease_token).toMatch(/^[0-9a-f-]{36}$/)
    expect((await db.query('select * from claim_fxiaoke_egress_job($1)',[a])).rows).toHaveLength(0)
    expect((await db.query("update organization_fxiaoke_egress_jobs set status='finished' where id=$1 and system_org_id=$2 and lease_token=$3 returning id",[claimed.rows[0].id,b,claimed.rows[0].lease_token])).rows).toHaveLength(0)
    expect((await db.query('select * from claim_fxiaoke_egress_job($1)',[b])).rows).toHaveLength(1)
    await db.exec(`insert into organization_fxiaoke_egress_jobs(id,system_org_id,request_ciphertext,created_at,expires_at)
      values ('33333333-3333-4333-8333-333333333333','${a}','expired-secret',now()-interval '30 seconds',now()-interval '10 seconds');`)
    await db.query('select * from claim_fxiaoke_egress_job($1)',[a])
    expect((await db.query("select * from organization_fxiaoke_egress_jobs where request_ciphertext='expired-secret'")).rows).toHaveLength(0)
    for (const role of ['anon','authenticated']) {
      await db.exec(`reset role; set role ${role}`)
      await expect(db.query('select * from organization_fxiaoke_egress_jobs')).rejects.toThrow('permission denied')
      await expect(db.query('select * from organization_fxiaoke_egress')).rejects.toThrow('permission denied')
      await expect(db.query('select * from claim_fxiaoke_egress_job($1)',[a])).rejects.toThrow('permission denied')
    }
  } finally { await db.close() }
})
