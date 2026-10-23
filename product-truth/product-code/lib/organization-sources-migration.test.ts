import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261021000002_organization_sources.sql'),
  'utf8',
)
const bindingMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261022000004_organization_source_bindings.sql'),
  'utf8',
)

describe('organization sources migration', () => {
  let db: PGlite

  beforeEach(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.organizations (
        id uuid primary key
      );
      create table public.users (
        id uuid primary key
      );
      insert into public.organizations (id) values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
      insert into public.users (id) values
        ('11111111-1111-4111-8111-111111111111');
    `)
    await db.exec(migration)
    await db.exec(bindingMigration)
  })

  afterEach(async () => {
    await db.close()
  })

  it('enforces one active priority per tenant and source identity uniqueness', async () => {
    await db.query(`
      insert into public.organization_sources
        (system_org_id, provider, external_tenant_id, priority, status, sync_mode)
      values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'feishu', 'primary', 1, 'active', 'authoritative')
    `)

    await expect(db.query(`
      insert into public.organization_sources
        (system_org_id, provider, external_tenant_id, priority, status, sync_mode)
      values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'wecom', 'duplicate-priority', 1, 'active', 'enrichment')
    `)).rejects.toThrow()

    const source = await db.query<{ id: string }>(`
      select id from public.organization_sources
      where system_org_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    `)
    await db.query(`
      insert into public.external_identities
        (source_id, system_org_id, external_user_id, match_status)
      values
        ($1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'external-user-1', 'unresolved')
    `, [source.rows[0].id])

    await expect(db.query(`
      insert into public.external_identities
        (source_id, system_org_id, external_user_id, match_status)
      values
        ($1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'external-user-1', 'matched')
    `, [source.rows[0].id])).rejects.toThrow()
  })

  it('rejects an identity whose source belongs to another tenant', async () => {
    await db.query(`
      insert into public.organization_sources
        (system_org_id, provider, external_tenant_id, priority, status, sync_mode)
      values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'feishu', 'primary', 1, 'active', 'authoritative')
    `)
    const source = await db.query<{ id: string }>(`
      select id from public.organization_sources
      where system_org_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    `)

    await expect(db.query(`
      insert into public.external_identities
        (source_id, system_org_id, external_user_id, match_status)
      values
        ($1, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cross-tenant-user', 'unresolved')
    `, [source.rows[0].id])).rejects.toThrow()
  })
  it('atomically replaces the active priority-1 source and rolls back invalid rebinds', async () => {
    await db.query(`
      select * from public.bind_organization_source(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'feishu',
        'primary',
        1,
        'active',
        'authoritative',
        '{}'::jsonb,
        '11111111-1111-4111-8111-111111111111'
      )
    `)
    const rebound = await db.query<{ provider: string; status: string }>(`
      select * from public.bind_organization_source(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'wecom',
        'replacement',
        1,
        'active',
        'authoritative',
        '{}'::jsonb,
        '11111111-1111-4111-8111-111111111111'
      )
    `)
    expect(rebound.rows).toEqual([expect.objectContaining({ provider: 'wecom', status: 'active' })])
    expect((await db.query<{ provider: string; status: string }>(`
      select provider, status from public.organization_sources
      where system_org_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      order by provider
    `)).rows).toEqual([
      { provider: 'feishu', status: 'disabled' },
      { provider: 'wecom', status: 'active' },
    ])

    await expect(db.query(`
      select * from public.bind_organization_source(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'dingtalk',
        'invalid',
        0,
        'active',
        'authoritative',
        '{}'::jsonb,
        '11111111-1111-4111-8111-111111111111'
      )
    `)).rejects.toThrow()
    expect((await db.query<{ provider: string; status: string }>(`
      select provider, status from public.organization_sources
      where system_org_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status = 'active'
    `)).rows).toEqual([{ provider: 'wecom', status: 'active' }])
  })
})
