// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('keeps encrypted configurations server-only and one per system organization', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table organizations(id uuid primary key); create table users(id uuid primary key);
      insert into organizations values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      insert into users values ('11111111-1111-4111-8111-111111111111');`)
    await db.exec(readFileSync(join(process.cwd(), 'supabase/migrations/20261027105230_fxiaoke_connection_preview.sql'), 'utf8'))
    const insert = `insert into organization_fxiaoke_connections(system_org_id,app_id,expected_ea,api_user_id,credentials_ciphertext,updated_by)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','app','ea','123','v1.test','11111111-1111-4111-8111-111111111111')`
    await db.exec('set role service_role')
    await db.exec(insert)
    expect((await db.query('select * from organization_fxiaoke_connections')).rows).toHaveLength(1)
    await expect(db.exec(insert)).rejects.toThrow()
    await db.exec('reset role; set role anon')
    await expect(db.query('select * from organization_fxiaoke_connections')).rejects.toThrow('permission denied')
    await db.exec('reset role; set role authenticated')
    await expect(db.query('select * from organization_fxiaoke_connections')).rejects.toThrow('permission denied')
    await db.exec('reset role')
    expect((await db.query<{relrowsecurity: boolean}>("select relrowsecurity from pg_class where relname = 'organization_fxiaoke_connections'")).rows[0].relrowsecurity).toBe(true)
  } finally { await db.close() }
})
