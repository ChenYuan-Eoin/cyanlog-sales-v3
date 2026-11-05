import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { PGlite } from '@electric-sql/pglite'
import { renderBaseline } from '../../../scripts/organization-schema-gate.mjs'

export const baseline = JSON.parse(readFileSync(join(process.cwd(), 'lib/organization-connections/schema-baseline/production.json'), 'utf8'))
export const connectionMigration = readFileSync(join(process.cwd(), 'supabase/migrations/20261103090000_unified_organization_connections.sql'), 'utf8')
export const directoryMigration = readFileSync(join(process.cwd(), 'supabase/migrations/20261103120000_organization_directory_cutover.sql'), 'utf8')

export interface OrganizationTestDatabase {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  exec(sql: string): Promise<unknown>
  close(): Promise<void>
}

// The exact same production-derived schema and tests run in both engines.
// Release rehearsal requires native PostgreSQL 17.6; PGlite is only a fast unit lane.
export async function productionSchemaDatabase(): Promise<OrganizationTestDatabase> {
  const url = process.env.ORGANIZATION_TEST_DATABASE_URL
  let db: OrganizationTestDatabase
  let databaseName: string | undefined
  if (url) {
    const parsed = new URL(url)
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)) {
      throw new Error('Organization database tests require a local disposable PostgreSQL server')
    }
    // pg is already a project dev dependency. Avoid introducing a second schema adapter.
    const { Client } = createRequire(join(process.cwd(), 'package.json'))('pg') as {
      Client: new (options: { connectionString: string }) => {
        connect(): Promise<void>
        query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
        end(): Promise<void>
      }
    }
    const admin = new Client({ connectionString: url })
    await admin.connect()
    const name = `wp92_test_${randomUUID().replaceAll('-', '')}`
    databaseName = name
    await admin.query(`create database "${name}" template template0`)
    parsed.pathname = `/${name}`
    const client = new Client({ connectionString: parsed.toString() })
    await client.connect()
    db = {
      query: (sql, params) => client.query(sql, params),
      exec: sql => client.query(sql),
      close: async () => {
        await client.end()
        await admin.query(`drop database "${name}" with (force)`)
        await admin.end()
      },
    }
    const version = (await db.query<{ version: string }>('show server_version')).rows[0]
    // SHOW returns a column named server_version, not version.
    if (!Object.values(version).some(value => /^17\.6(?:\s|$)/.test(value))) {
      await db.close()
      throw new Error('Release rehearsal requires production PostgreSQL 17.6')
    }
  } else {
    if (process.env.ORGANIZATION_RELEASE_GATE === 'true') throw new Error('Native PostgreSQL release rehearsal is mandatory')
    db = new PGlite()
  }
  try {
    const bootstrapRole = (await db.query<{ role: string }>('select current_user as role')).rows[0].role
    if (url && bootstrapRole === 'postgres') throw new Error('Use a separate local bootstrap superuser so the production postgres role is tested without superuser bypass')
    await db.exec(renderBaseline(baseline, { bootstrapRole }))
    if (databaseName) {
      await db.exec(`alter database "${databaseName}" owner to postgres; set role postgres;`)
    }
    return db
  } catch (error) {
    await db.close()
    throw error
  }
}
