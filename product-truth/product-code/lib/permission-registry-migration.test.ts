import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261021000005_permission_registry_lifecycle.sql'),
  'utf8',
)

describe('permission registry lifecycle migration', () => {
  let db: PGlite

  beforeEach(async () => {
    db = new PGlite()
    await db.exec(`
      create table public.users (id uuid primary key);
      create table public.permission_points (
        id uuid primary key default gen_random_uuid(),
        code text not null unique,
        name text not null,
        description text,
        scope jsonb default '{}'::jsonb,
        created_at timestamptz default now()
      );
      insert into public.permission_points (code, name, description, scope)
      values (
        'shipping:operate',
        '自助收寄操作',
        'legacy shipping permission',
        '{"legacyAllowlistMigratedOrgIds":["org-a"]}'::jsonb
      );
    `)
    await db.exec(migration)
  })

  afterEach(async () => {
    await db.close()
  })

  it('seeds versioned definitions while preserving existing permission scope metadata', async () => {
    const rows = await db.query<{
      code: string
      status: string
      kind: string
      enforcement_consumer: string | null
      scope: Record<string, unknown>
    }>(`
      select code, status, kind, enforcement_consumer, scope
      from public.permission_points
      order by code
    `)
    const byCode = new Map(rows.rows.map((row) => [row.code, row]))

    expect(rows.rows.length).toBeGreaterThanOrEqual(40)
    expect(byCode.get('config:read')).toMatchObject({
      status: 'published',
      kind: 'atomic',
      enforcement_consumer: 'lib/configs/access.ts',
    })
    expect(byCode.get('report:finance')).toMatchObject({
      status: 'draft',
      kind: 'atomic',
      enforcement_consumer: null,
    })
    expect(byCode.get('shipping:operate')?.scope).toEqual({
      legacyAllowlistMigratedOrgIds: ['org-a'],
    })
  })

  it('records immutable definition snapshots for audit and historical interpretation', async () => {
    const versions = await db.query<{ count: number }>(`
      select count(*)::int as count from public.permission_point_versions
    `)
    const config = await db.query<{ snapshot: Record<string, unknown> }>(`
      select version.snapshot
      from public.permission_point_versions as version
      join public.permission_points as point on point.id = version.permission_point_id
      where point.code = 'config:read'
    `)

    expect(versions.rows[0].count).toBeGreaterThanOrEqual(40)
    expect(config.rows[0].snapshot).toMatchObject({
      key: 'config:read',
      label: '配置中心查看',
      dependencies: [],
      enforcementConsumer: 'lib/configs/access.ts',
    })
  })

  it('rejects unknown lifecycle states at the database boundary', async () => {
    await expect(db.query(`
      update public.permission_points
      set status = 'invented'
      where code = 'config:read'
    `)).rejects.toThrow()
  })
})
